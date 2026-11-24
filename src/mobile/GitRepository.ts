import { Buffer } from "buffer";
import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import * as git from "isomorphic-git";
import type { GitHttpRequest, GitHttpResponse, HttpClient } from "isomorphic-git";
import LightningFS from "@isomorphic-git/lightning-fs";
import {
  MOBILE_SCHEMA_VERSION,
  MobileGitError,
  formatJson,
  friendlyGitError,
  newId,
  parseRemoteUrl,
  parseSkillMarkdown,
  renderSkillMarkdown,
  repoStorageKey,
  skillPathKey,
  slugifySkillName,
  sortTags,
  type GitCommitSummary,
  type MobilePreset,
  type MobileSkill,
  type MutationResult,
  type PresetDraft,
  type PresetMembership,
  type PresetMembershipMetaFile,
  type PresetMetaFile,
  type RepoConnection,
  type RepoSnapshot,
  type SkillDraft,
  type SkillMetaFile,
  type SyncPhase,
  type SyncSummary,
} from "./model";

type LightningPromiseFs = InstanceType<typeof LightningFS>["promises"];

const FS_NAME = "skills-manager-mobile";
const REPO_ROOT = "/skills-manager";
const APP_AUTHOR = { name: "Skills Manager Android", email: "android@skills-manager.local" };
const META = ".skills-manager";

const fs = new LightningFS(FS_NAME);
const pfs: LightningPromiseFs = fs.promises;

// isomorphic-git's transitive hash dependencies expect Node's Buffer global
// even though Vite otherwise treats "buffer" as a browser-incompatible builtin.
const runtime = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
runtime.Buffer ??= Buffer;

interface NativeGitHttpPlugin {
  request(options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    data?: string;
  }): Promise<{
    status: number;
    url: string;
    headers: Record<string, string>;
    data: string;
  }>;
}

const NativeGitHttp = registerPlugin<NativeGitHttpPlugin>("GitHttp");

function join(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/^([^/])/, "/$1");
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function safeId(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new MobileGitError(`仓库包含无效的 ${label}`, "INVALID_REPO");
  }
  return value;
}

function safeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (
    !normalized ||
    parts.some((part) => part === "" || part === "." || part === "..") ||
    parts[0] === ".git"
  ) {
    throw new MobileGitError("仓库包含不安全的 Skill 路径", "INVALID_REPO");
  }
  return normalized;
}

async function exists(path: string): Promise<boolean> {
  try {
    await pfs.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function mkdirp(path: string): Promise<void> {
  if (!path || path === "/" || (await exists(path))) return;
  await mkdirp(dirname(path));
  try {
    await pfs.mkdir(path);
  } catch (error) {
    if (!/exist/i.test(String(error))) throw error;
  }
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdirp(dirname(path));
  await pfs.writeFile(path, value, "utf8");
}

async function readText(path: string): Promise<string> {
  return pfs.readFile(path, "utf8");
}

async function removeTree(path: string): Promise<void> {
  if (!(await exists(path))) return;
  const stat = await pfs.stat(path);
  if (!stat.isDirectory()) {
    await pfs.unlink(path);
    return;
  }
  for (const entry of await pfs.readdir(path)) await removeTree(join(path, entry));
  await pfs.rmdir(path);
}

async function walkFiles(root: string, maxDepth = 7): Promise<string[]> {
  if (!(await exists(root))) return [];
  const output: string[] = [];
  async function visit(path: string, depth: number) {
    if (depth > maxDepth) return;
    for (const entry of await pfs.readdir(path)) {
      if (entry === ".git" || entry === META) continue;
      const child = join(path, entry);
      const stat = await pfs.stat(child);
      if (stat.isDirectory()) await visit(child, depth + 1);
      else if (stat.isFile()) output.push(child);
    }
  }
  await visit(root, 0);
  return output;
}

async function readJsonDirectory<T>(path: string): Promise<T[]> {
  if (!(await exists(path))) return [];
  const records: T[] = [];
  for (const entry of await pfs.readdir(path)) {
    if (!entry.endsWith(".json")) continue;
    try {
      records.push(JSON.parse(await readText(join(path, entry))) as T);
    } catch {
      // One malformed record should not make every other skill unreachable.
    }
  }
  return records;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function collectBody(body?: AsyncIterableIterator<Uint8Array>): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  // ponytail: the Capacitor bridge buffers each Git request. Move to a
  // streaming native HTTP plugin if repositories regularly exceed ~100 MB.
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    chunks.push(chunk);
    total += chunk.length;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function oneChunk(body?: Uint8Array): AsyncIterableIterator<Uint8Array> {
  return (async function* iterator() {
    if (body && body.length) yield body;
  })();
}

const nativeGitHttp: HttpClient = {
  async request(request: GitHttpRequest): Promise<GitHttpResponse> {
    try {
      const requestBody = await collectBody(request.body);
      if (isNativeAndroid()) {
        const response = await NativeGitHttp.request({
          url: request.url,
          method: request.method ?? "GET",
          headers: {
            ...(request.headers ?? {}),
            "User-Agent": navigator.userAgent,
            "Accept-Encoding": "identity",
          },
          data: requestBody.length ? bytesToBase64(requestBody) : undefined,
        });
        const bytes = response.data ? base64ToBytes(response.data) : new Uint8Array();
        request.onProgress?.({ phase: "Receiving", loaded: bytes.length, total: bytes.length });
        return {
          url: response.url ?? request.url,
          method: request.method,
          headers: response.headers,
          body: oneChunk(bytes),
          statusCode: response.status,
          statusMessage: String(response.status),
        };
      }

      const headers: Record<string, string> = {
        ...(request.headers ?? {}),
        "x-cap-user-agent": navigator.userAgent,
      };
      const response = await CapacitorHttp.request({
        url: request.url,
        method: request.method ?? "GET",
        headers,
        data: requestBody.length ? bytesToBase64(requestBody) : undefined,
        dataType: requestBody.length ? "file" : undefined,
        responseType: "arraybuffer",
        connectTimeout: 30_000,
        readTimeout: 180_000,
      });
      const bytes =
        typeof response.data === "string"
          ? base64ToBytes(response.data)
          : response.data instanceof ArrayBuffer
            ? new Uint8Array(response.data)
            : new TextEncoder().encode(
                typeof response.data === "string" ? response.data : JSON.stringify(response.data)
              );
      request.onProgress?.({ phase: "Receiving", loaded: bytes.length, total: bytes.length });
      return {
        url: response.url ?? request.url,
        method: request.method,
        headers: response.headers,
        body: oneChunk(bytes),
        statusCode: response.status,
        statusMessage: String(response.status),
      };
    } catch (error) {
      throw friendlyGitError(error);
    }
  },
};

function remoteRef(branch: string): string {
  return `refs/remotes/origin/${branch}`;
}

function phaseFor(localHead: string | null, remoteHead: string | null): SyncPhase {
  if (!localHead && !remoteHead) return "current";
  if (localHead === remoteHead) return "current";
  return "unknown";
}

export class AndroidGitRepository {
  readonly connection: RepoConnection;
  readonly dir: string;
  readonly repoKey: string;
  private readonly token: string;

  constructor(connection: RepoConnection, token: string) {
    this.connection = connection;
    this.token = token;
    this.repoKey = repoStorageKey(connection.remoteUrl);
    this.dir = join(REPO_ROOT, this.repoKey);
  }

  static async connect(
    remoteInput: string,
    token: string,
    onProgress?: (message: string) => void
  ): Promise<AndroidGitRepository> {
    return this.connectConnection(parseRemoteUrl(remoteInput), token, onProgress);
  }

  static async connectConnection(
    connection: RepoConnection,
    token: string,
    onProgress?: (message: string) => void
  ): Promise<AndroidGitRepository> {
    if (!token.trim()) throw new MobileGitError("请输入 GitHub Personal Access Token", "AUTH");
    const repo = new AndroidGitRepository(connection, token.trim());
    await mkdirp(REPO_ROOT);

    if (await exists(join(repo.dir, ".git"))) {
      onProgress?.("正在连接本地仓库…");
      try {
        const info = await git.getRemoteInfo({
          http: nativeGitHttp,
          url: connection.remoteUrl,
          onAuth: () => ({ username: "x-access-token", password: repo.token }),
        });
        const branch = info.HEAD?.replace("refs/heads/", "") || connection.branch;
        repo.connection.branch = branch;
      } catch {
        // The local clone is complete and usable without a network round-trip.
        // Sync will surface the connection problem while the user can still
        // read and edit the on-device repository.
      }
      return repo;
    }

    onProgress?.("正在读取远端仓库…");
    try {
      const info = await git.getRemoteInfo({
        http: nativeGitHttp,
        url: connection.remoteUrl,
        onAuth: () => ({ username: "x-access-token", password: repo.token }),
      });
      const branch = info.HEAD?.replace("refs/heads/", "") || connection.branch;
      repo.connection.branch = branch;
      onProgress?.("正在克隆到手机本地…");
      await git.clone({
        fs,
        http: nativeGitHttp,
        dir: repo.dir,
        url: connection.remoteUrl,
        ref: branch,
        singleBranch: true,
        onAuth: () => ({ username: "x-access-token", password: repo.token }),
        onProgress: (event) =>
          onProgress?.(
            event.total
              ? `正在克隆 ${Math.min(99, Math.round((event.loaded / event.total) * 100))}%`
              : "正在克隆到手机本地…"
          ),
      });
      return repo;
    } catch (error) {
      await removeTree(repo.dir).catch(() => undefined);
      throw friendlyGitError(error);
    }
  }

  private auth() {
    return { username: "x-access-token", password: this.token };
  }

  private async remoteHead(): Promise<string | null> {
    try {
      return await git.resolveRef({
        fs,
        dir: this.dir,
        ref: remoteRef(this.connection.branch),
      });
    } catch {
      return null;
    }
  }

  private async localHead(): Promise<string | null> {
    try {
      return await git.resolveRef({
        fs,
        dir: this.dir,
        ref: this.connection.branch,
      });
    } catch {
      return null;
    }
  }

  private async statusMatrix() {
    return git.statusMatrix({ fs, dir: this.dir });
  }

  private async syncSummary(): Promise<SyncSummary> {
    const [localHead, remoteHead, matrix] = await Promise.all([
      this.localHead(),
      this.remoteHead(),
      this.statusMatrix(),
    ]);
    const pendingChanges = matrix.filter(
      ([, head, workdir, stage]) => head !== workdir || head !== stage
    ).length;
    let phase = phaseFor(localHead, remoteHead);
    if (pendingChanges > 0) phase = "dirty";
    else if (phase === "unknown" && localHead && remoteHead) {
      try {
        const localIsAncestor = await git.isDescendent({
          fs,
          dir: this.dir,
          oid: remoteHead,
          ancestor: localHead,
        });
        const remoteIsAncestor = await git.isDescendent({
          fs,
          dir: this.dir,
          oid: localHead,
          ancestor: remoteHead,
        });
        phase = localIsAncestor ? "behind" : remoteIsAncestor ? "ahead" : "diverged";
      } catch {
        phase = "diverged";
      }
    }
    const lastSynced = Number(localStorage.getItem(`skills-manager.mobile.sync.${this.repoKey}`)) || null;
    return {
      phase,
      localHead,
      remoteHead,
      pendingChanges,
      lastSyncedAt: lastSynced,
      message:
        phase === "diverged"
          ? "本地提交与远端提交已分叉"
          : phase === "dirty"
            ? "存在尚未提交的本地改动"
            : null,
    };
  }

  private markSynced(): void {
    localStorage.setItem(`skills-manager.mobile.sync.${this.repoKey}`, String(Date.now()));
  }

  private async loadSkills(): Promise<MobileSkill[]> {
    const metaDir = join(this.dir, META, "skills");
    const memberships = await this.loadMemberships();
    const presetMap = new Map<string, string[]>();
    for (const membership of memberships) {
      const ids = presetMap.get(membership.skillId) ?? [];
      ids.push(membership.scenarioId);
      presetMap.set(membership.skillId, ids);
    }
    const metas = await readJsonDirectory<SkillMetaFile>(metaDir);
    const skills: MobileSkill[] = [];

    for (const meta of metas) {
      let id: string;
      let relativePath: string;
      try {
        id = safeId(meta.skill_id, "Skill ID");
        relativePath = safeRelativePath(meta.path);
      } catch {
        continue;
      }
      const skillDir = join(this.dir, relativePath);
      const documentPath = join(skillDir, "SKILL.md");
      if (!(await exists(documentPath))) continue;
      const markdown = await readText(documentPath);
      const parsed = parseSkillMarkdown(markdown);
      const fallbackName = meta.path.split("/").filter(Boolean).pop() || meta.skill_id;
      skills.push({
        id,
        name: parsed.name || fallbackName,
        description: parsed.description,
        path: relativePath,
        pathKey: meta.path_key || skillPathKey(relativePath),
        enabled: meta.enabled !== false,
        tags: sortTags(meta.tags ?? []),
        source: {
          type: meta.source?.type || "local",
          ref: meta.source?.ref ?? null,
          subpath: meta.source?.subpath ?? null,
          branch: meta.source?.branch ?? null,
        },
        content: parsed.body,
        frontmatter: parsed.frontmatter,
        presetIds: [...new Set(presetMap.get(id) ?? [])],
      });
    }

    if (skills.length > 0) return skills.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

    // The metadata directory is the source of truth for desktop backups.
    // This fallback keeps an arbitrary skills repository editable before its
    // first mobile write creates metadata.
    const files = await walkFiles(this.dir);
    for (const file of files) {
      if (!/\/(?:SKILL|skill)\.md$/i.test(file)) continue;
      const relativePath = file.slice(this.dir.length + 1);
      const skillPath = dirname(relativePath);
      if (!skillPath || skillPath.startsWith(".skills-manager/")) continue;
      const markdown = await readText(file);
      const parsed = parseSkillMarkdown(markdown);
      const fallbackName = skillPath.split("/").filter(Boolean).pop() || skillPath;
      const id = `mobile-${repoStorageKey(skillPath)}`;
      skills.push({
        id,
        name: parsed.name || fallbackName,
        description: parsed.description,
        path: skillPath,
        pathKey: skillPathKey(skillPath),
        enabled: true,
        tags: [],
        source: { type: "local", ref: null, subpath: null, branch: null },
        content: parsed.body,
        frontmatter: parsed.frontmatter,
        presetIds: presetMap.get(id) ?? [],
      });
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  private async loadMemberships(): Promise<PresetMembership[]> {
    const root = join(this.dir, META, "scenario-skills");
    if (!(await exists(root))) return [];
    const records: PresetMembership[] = [];
    for (const presetDir of await pfs.readdir(root)) {
      const presetPath = join(root, presetDir);
      const stat = await pfs.stat(presetPath);
      if (!stat.isDirectory()) continue;
      for (const record of await readJsonDirectory<PresetMembershipMetaFile>(presetPath)) {
        let scenarioId: string;
        let skillId: string;
        try {
          scenarioId = safeId(record.scenario_id || presetDir, "Preset ID");
          skillId = safeId(record.skill_id, "Skill ID");
        } catch {
          continue;
        }
        records.push({
          scenarioId,
          skillId,
          sortOrder: record.sort_order ?? 0,
          tools: record.tools ?? {},
        });
      }
    }
    return records;
  }

  private async loadPresets(skills: MobileSkill[]): Promise<MobilePreset[]> {
    const presets = await readJsonDirectory<PresetMetaFile>(join(this.dir, META, "scenarios"));
    return presets
      .flatMap((preset) => {
        try {
          const id = safeId(preset.scenario_id, "Preset ID");
          return [{
            id,
            name: preset.name,
            description: preset.description,
            icon: preset.icon,
            sortOrder: preset.sort_order ?? 0,
            skillIds: skills.filter((skill) => skill.presetIds.includes(id)).map((skill) => skill.id),
          }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"));
  }

  private async loadCommits(): Promise<GitCommitSummary[]> {
    try {
      const commits = await git.log({ fs, dir: this.dir, depth: 6 });
      return commits.map(({ oid, commit }) => ({
        oid,
        shortOid: oid.slice(0, 7),
        message: commit.message.trim() || "未命名提交",
        author: commit.author.name,
        timestamp: commit.author.timestamp * 1000,
      }));
    } catch {
      return [];
    }
  }

  async snapshot(): Promise<RepoSnapshot> {
    try {
      const [skills, sync, commits] = await Promise.all([
        this.loadSkills(),
        this.syncSummary(),
        this.loadCommits(),
      ]);
      const presets = await this.loadPresets(skills);
      return {
        ...this.connection,
        skills,
        presets,
        commits,
        sync,
      };
    } catch (error) {
      throw friendlyGitError(error);
    }
  }

  private async fetchRemote(): Promise<string | null> {
    try {
      await git.fetch({
        fs,
        http: nativeGitHttp,
        dir: this.dir,
        remote: "origin",
        ref: this.connection.branch,
        singleBranch: true,
        onAuth: () => this.auth(),
      });
      return await this.remoteHead();
    } catch (error) {
      throw friendlyGitError(error);
    }
  }

  private async fastForwardIfPossible(): Promise<
    "up-to-date" | "updated" | "ahead" | "diverged" | "dirty"
  > {
    await this.fetchRemote();
    const [localHead, remoteHead, matrix] = await Promise.all([
      this.localHead(),
      this.remoteHead(),
      this.statusMatrix(),
    ]);
    if (matrix.some(([, head, workdir, stage]) => head !== workdir || head !== stage)) {
      return "dirty";
    }
    if (!localHead || !remoteHead || localHead === remoteHead) return "up-to-date";
    const remoteContainsLocal = await git.isDescendent({
      fs,
      dir: this.dir,
      oid: remoteHead,
      ancestor: localHead,
    });
    if (remoteContainsLocal) {
      await git.pull({
        fs,
        http: nativeGitHttp,
        dir: this.dir,
        ref: this.connection.branch,
        singleBranch: true,
        fastForwardOnly: true,
        author: APP_AUTHOR,
        onAuth: () => this.auth(),
      });
      return "updated";
    }
    const localContainsRemote = await git.isDescendent({
      fs,
      dir: this.dir,
      oid: localHead,
      ancestor: remoteHead,
    });
    return localContainsRemote ? "ahead" : "diverged";
  }

  private async stageAll(): Promise<number> {
    const matrix = await this.statusMatrix();
    let changed = 0;
    for (const [filepath, head, workdir, stage] of matrix) {
      if (head === workdir && head === stage) continue;
      if (workdir === 0) await git.remove({ fs, dir: this.dir, filepath });
      else await git.add({ fs, dir: this.dir, filepath });
      changed++;
    }
    return changed;
  }

  async checkpoint(message = "mobile: checkpoint local changes"): Promise<MutationResult> {
    const changed = await this.stageAll();
    if (changed > 0) {
      await git.commit({
        fs,
        dir: this.dir,
        message,
        author: APP_AUTHOR,
      });
    }
    return this.pushLocalCommit();
  }

  private async mergeRemoteSafely(): Promise<void> {
    const [localHead, remoteHead, matrix] = await Promise.all([
      this.localHead(),
      this.remoteHead(),
      this.statusMatrix(),
    ]);
    if (!localHead || !remoteHead || localHead === remoteHead) return;
    if (matrix.some(([, head, workdir, stage]) => head !== workdir || head !== stage)) {
      throw new MobileGitError("本地还有未提交改动，已停止自动合并", "CONFLICT");
    }
    try {
      await git.merge({
        fs,
        dir: this.dir,
        ours: this.connection.branch,
        theirs: remoteRef(this.connection.branch),
        fastForward: true,
        abortOnConflict: true,
        message: "mobile: merge remote changes",
        author: APP_AUTHOR,
      });
    } catch (error) {
      throw friendlyGitError(error);
    }
  }

  private async pushLocalCommit(): Promise<MutationResult> {
    let pushed = true;
    let notice: string | null = null;
    try {
      const remoteAfterFetch = await this.fetchRemote();
      const localHead = await this.localHead();
      if (remoteAfterFetch && localHead !== remoteAfterFetch) {
        await this.mergeRemoteSafely();
      }
      await git.push({
        fs,
        http: nativeGitHttp,
        dir: this.dir,
        remote: "origin",
        ref: this.connection.branch,
        remoteRef: this.connection.branch,
        onAuth: () => this.auth(),
      });
      this.markSynced();
    } catch (error) {
      const friendly = friendlyGitError(error);
      if (friendly.code === "CONFLICT") {
        notice = "已保存到本地 Git，但远端有新提交且无法安全自动合并。改动没有丢失。";
      } else if (friendly.code === "NETWORK") {
        notice = "已提交到本地 Git；当前无法连接 GitHub，恢复网络后点“立即同步”即可推送。";
      } else {
        notice = `已提交到本地 Git；推送失败：${friendly.message}`;
      }
      pushed = false;
    }
    return { snapshot: await this.snapshot(), pushed, notice };
  }

  async sync(): Promise<MutationResult> {
    const result = await this.fastForwardIfPossible();
    if (result === "dirty") return this.checkpoint("mobile: commit interrupted local changes");
    if (result === "diverged") {
      throw new MobileGitError(
        "本地与远端已有分叉改动。为避免覆盖任何一方，应用没有自动改写；请先在有冲突处理能力的桌面端合并。",
        "CONFLICT"
      );
    }
    const sync = await this.syncSummary();
    if (sync.phase === "ahead") {
      return this.pushLocalCommit();
    }
    this.markSynced();
    return { snapshot: await this.snapshot(), pushed: true, notice: null };
  }

  async mutate(action: () => Promise<void>, message: string): Promise<MutationResult> {
    const preflight = await this.fastForwardIfPossible();
    if (preflight === "dirty") {
      await this.checkpoint("mobile: commit interrupted local changes");
    }
    if (preflight === "diverged") {
      throw new MobileGitError("远端已有新提交，当前改动尚未开始。请先同步或处理分叉。", "CONFLICT");
    }
    await action();
    const changed = await this.stageAll();
    if (changed === 0) return { snapshot: await this.snapshot(), pushed: true, notice: null };
    await git.commit({
      fs,
      dir: this.dir,
      message,
      author: APP_AUTHOR,
    });
    return this.pushLocalCommit();
  }

  async saveSkill(draft: SkillDraft): Promise<MutationResult> {
    return this.mutate(async () => {
      const currentSkills = await this.loadSkills();
      const existing = draft.id ? currentSkills.find((skill) => skill.id === draft.id) : null;
      let path = existing?.path;
      if (!path) {
        const base = slugifySkillName(draft.name);
        path = base;
        let suffix = 2;
        while (
          currentSkills.some((skill) => skill.pathKey === skillPathKey(path!)) ||
          (await exists(join(this.dir, path!)))
        ) {
          path = `${base}-${suffix++}`;
        }
      }
      const id = existing?.id || draft.id || newId();
      safeId(id, "Skill ID");
      path = safeRelativePath(path);
      await writeText(
        join(this.dir, path, "SKILL.md"),
        renderSkillMarkdown(
          draft.name,
          draft.description,
          draft.content,
          existing?.frontmatter ?? null
        )
      );
      await writeText(join(this.dir, META, "schema.json"), formatJson({
        schema_version: MOBILE_SCHEMA_VERSION,
        app_min_version: "2.0.0",
        created_by: "skills-manager",
      }));
      const meta: SkillMetaFile = {
        schema_version: MOBILE_SCHEMA_VERSION,
        skill_id: id,
        path,
        path_key: skillPathKey(path),
        enabled: existing?.enabled ?? true,
        tags: sortTags(draft.tags),
        source: existing?.source ?? { type: "local", ref: null, subpath: null, branch: null },
      };
      await writeText(join(this.dir, META, "skills", `${id}.json`), formatJson(meta));
    }, draft.id ? `mobile: update skill ${draft.name}` : `mobile: create skill ${draft.name}`);
  }

  async deleteSkill(skillId: string): Promise<MutationResult> {
    return this.mutate(async () => {
      const skill = (await this.loadSkills()).find((candidate) => candidate.id === skillId);
      if (!skill) throw new MobileGitError("找不到要删除的 skill", "INVALID_REPO");
      safeId(skill.id, "Skill ID");
      const memberships = await this.loadMemberships();
      const presetIds = [...new Set(memberships.map((item) => item.scenarioId))];
      await removeTree(join(this.dir, skill.path));
      await removeTree(join(this.dir, META, "skills", `${skill.id}.json`));
      const surviving = memberships.filter((item) => item.skillId !== skill.id);
      for (const presetId of presetIds) {
        await this.rewriteMembershipOrders(
          presetId,
          surviving.filter((item) => item.scenarioId === presetId)
        );
      }
    }, `mobile: delete skill ${skillId}`);
  }

  private async rewriteMembershipOrders(
    presetId: string,
    memberships: PresetMembership[]
  ): Promise<void> {
    const dir = join(this.dir, META, "scenario-skills", presetId);
    await mkdirp(dir);
    const expected = new Set(memberships.map((item) => `${item.skillId}.json`));
    for (const entry of await pfs.readdir(dir)) {
      if (entry.endsWith(".json") && !expected.has(entry)) await pfs.unlink(join(dir, entry));
    }
    const ordered = [...memberships].sort((a, b) => a.sortOrder - b.sortOrder);
    for (let index = 0; index < ordered.length; index++) {
      const member = ordered[index];
      await writeText(
        join(dir, `${member.skillId}.json`),
        formatJson({
          schema_version: MOBILE_SCHEMA_VERSION,
          scenario_id: presetId,
          skill_id: member.skillId,
          sort_order: index,
          tools: member.tools,
        } satisfies PresetMembershipMetaFile)
      );
    }
  }

  async savePreset(draft: PresetDraft): Promise<MutationResult> {
    return this.mutate(async () => {
      const presets = await this.loadPresets(await this.loadSkills());
      const existing = draft.id ? presets.find((preset) => preset.id === draft.id) : null;
      const id = existing?.id || newId();
      safeId(id, "Preset ID");
      const meta: PresetMetaFile = {
        schema_version: MOBILE_SCHEMA_VERSION,
        scenario_id: id,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        icon: draft.icon || null,
        sort_order: existing?.sortOrder ?? (presets.reduce((max, preset) => Math.max(max, preset.sortOrder), -1) + 1),
      };
      await writeText(join(this.dir, META, "scenarios", `${id}.json`), formatJson(meta));
      await writeText(join(this.dir, META, "schema.json"), formatJson({
        schema_version: MOBILE_SCHEMA_VERSION,
        app_min_version: "2.0.0",
        created_by: "skills-manager",
      }));
    }, draft.id ? `mobile: update preset ${draft.name}` : `mobile: create preset ${draft.name}`);
  }

  async deletePreset(presetId: string): Promise<MutationResult> {
    safeId(presetId, "Preset ID");
    return this.mutate(async () => {
      await removeTree(join(this.dir, META, "scenarios", `${presetId}.json`));
      await removeTree(join(this.dir, META, "scenario-skills", presetId));
    }, `mobile: delete preset ${presetId}`);
  }

  async setPresetSkill(presetId: string, skillId: string, included: boolean): Promise<MutationResult> {
    safeId(presetId, "Preset ID");
    safeId(skillId, "Skill ID");
    return this.mutate(async () => {
      const memberships = await this.loadMemberships();
      const current = memberships.filter((member) => member.scenarioId === presetId);
      const next = current.filter((member) => member.skillId !== skillId);
      if (included) {
        next.push({
          scenarioId: presetId,
          skillId,
          sortOrder: next.length,
          tools: current.find((member) => member.skillId === skillId)?.tools ?? {},
        });
      }
      await this.rewriteMembershipOrders(presetId, next);
    }, included
      ? `mobile: add skill ${skillId} to preset ${presetId}`
      : `mobile: remove skill ${skillId} from preset ${presetId}`);
  }

  async reorderPreset(presetId: string, direction: -1 | 1): Promise<MutationResult> {
    safeId(presetId, "Preset ID");
    return this.mutate(async () => {
      const presets = await this.loadPresets(await this.loadSkills());
      const index = presets.findIndex((preset) => preset.id === presetId);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= presets.length) return;
      [presets[index], presets[destination]] = [presets[destination], presets[index]];
      for (let order = 0; order < presets.length; order++) {
        const preset = presets[order];
        const meta: PresetMetaFile = {
          schema_version: MOBILE_SCHEMA_VERSION,
          scenario_id: preset.id,
          name: preset.name,
          description: preset.description,
          icon: preset.icon,
          sort_order: order,
        };
        await writeText(
          join(this.dir, META, "scenarios", `${preset.id}.json`),
          formatJson(meta)
        );
      }
    }, `mobile: reorder preset ${presetId}`);
  }

  async reorderPresetSkill(
    presetId: string,
    skillId: string,
    direction: -1 | 1
  ): Promise<MutationResult> {
    safeId(presetId, "Preset ID");
    safeId(skillId, "Skill ID");
    return this.mutate(async () => {
      const memberships = (await this.loadMemberships())
        .filter((member) => member.scenarioId === presetId)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const index = memberships.findIndex((member) => member.skillId === skillId);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= memberships.length) return;
      [memberships[index], memberships[destination]] = [memberships[destination], memberships[index]];
      await this.rewriteMembershipOrders(presetId, memberships);
    }, `mobile: reorder skill ${skillId} in preset ${presetId}`);
  }
}

export async function removeLocalClone(connection: RepoConnection): Promise<void> {
  await removeTree(join(REPO_ROOT, repoStorageKey(connection.remoteUrl)));
}

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}
