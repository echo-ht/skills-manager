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
  parseInstallSource,
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
  type ParsedInstallSource,
  type PresetDraft,
  type PresetMembership,
  type PresetMembershipMetaFile,
  type PresetMetaFile,
  type RemoteInstallSession,
  type RemoteSkillInstallItem,
  type RemoteSkillPreview,
  type RepoConnection,
  type RepoSnapshot,
  type SkillDraft,
  type SkillMetaFile,
  type SkillUpdateStatus,
  type SyncPhase,
  type SyncSummary,
} from "./model";

type LightningPromiseFs = InstanceType<typeof LightningFS>["promises"];

const FS_NAME = "skills-manager-mobile";
const REPO_ROOT = "/skills-manager";
const CACHE_ROOT = "/skills-manager-cache";
const REMOTE_PREVIEW_PREFIX = "remote-preview-";
const APP_AUTHOR = { name: "Skills Manager Android", email: "android@skills-manager.local" };
const META = ".skills-manager";

interface StoredUpdateState {
  stateVersion: number;
  status: SkillUpdateStatus;
  lastCheckedAt: number | null;
  error: string | null;
  resolvedUrl: string | null;
  revision: string | null;
  remoteRevision: string | null;
}

interface GithubContentEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  sha: string;
  size?: number;
}

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
    timeoutMs?: number;
  }): Promise<{
    status: number;
    url: string;
    headers: Record<string, string>;
    data: string;
  }>;
  cancel(): Promise<void>;
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

async function hasSkillDocument(path: string): Promise<boolean> {
  for (const name of ["SKILL.md", "skill.md"]) {
    if (await exists(join(path, name))) return true;
  }
  return false;
}

async function findSkillDirectories(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];
  if (await hasSkillDocument(root)) return [root];

  const found: string[] = [];
  async function visit(path: string, depth: number) {
    if (depth > 8) return;
    for (const entry of (await pfs.readdir(path)).sort()) {
      if (
        entry === ".git" ||
        entry === META ||
        entry === "node_modules" ||
        entry === ".venv" ||
        entry === "dist"
      ) {
        continue;
      }
      const child = join(path, entry);
      if (!(await pfs.stat(child)).isDirectory()) continue;
      if (await hasSkillDocument(child)) {
        found.push(child);
      } else {
        await visit(child, depth + 1);
      }
    }
  }
  await visit(root, 0);
  return found;
}

async function copyTree(source: string, destination: string): Promise<void> {
  const stat = await pfs.stat(source);
  if (!stat.isDirectory()) {
    await mkdirp(dirname(destination));
    await pfs.writeFile(destination, await pfs.readFile(source));
    return;
  }
  await mkdirp(destination);
  for (const entry of await pfs.readdir(source)) {
    if (entry === ".git" || entry === META) continue;
    await copyTree(join(source, entry), join(destination, entry));
  }
}

async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const payload = new Uint8Array(header.length + bytes.length);
  payload.set(header);
  payload.set(bytes, header.length);
  const digest = await crypto.subtle.digest("SHA-1", payload);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function cleanupRemotePreviews(): Promise<void> {
  if (!(await exists(CACHE_ROOT))) return;
  for (const entry of await pfs.readdir(CACHE_ROOT)) {
    if (entry.startsWith(REMOTE_PREVIEW_PREFIX)) await removeTree(join(CACHE_ROOT, entry));
  }
}

function safeRepoRelativePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (
    !normalized ||
    normalized.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new MobileGitError("上游 Skill 路径不安全", "INVALID_REPO");
  }
  return normalized;
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
          timeoutMs: request.fetchOptions?.timeoutMs as number | undefined,
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

  private updateStateKey(): string {
    return `skills-manager.mobile.updates.${this.repoKey}`;
  }

  private loadUpdateStates(): Record<string, StoredUpdateState> {
    try {
      const states = JSON.parse(localStorage.getItem(this.updateStateKey()) || "{}") as Record<
        string,
        StoredUpdateState
      >;
      for (const [id, state] of Object.entries(states)) {
        if (state.stateVersion === 2) continue;
        const trustedRevision = state.status === "up_to_date" ? state.revision : null;
        states[id] = {
          ...state,
          // Before v2, update checks overwrote the installed revision with the
          // remote head, so a pending update could look "up to date" next time.
          revision: trustedRevision,
          status: trustedRevision
            ? state.status
            : state.status === "local_only" ||
                state.status === "no_upstream" ||
                state.status === "error"
              ? state.status
              : "unknown",
          remoteRevision: state.remoteRevision ?? state.revision ?? null,
          stateVersion: 2,
        };
      }
      return states;
    } catch {
      return {};
    }
  }

  private saveUpdateStates(states: Record<string, StoredUpdateState>): void {
    localStorage.setItem(this.updateStateKey(), JSON.stringify(states));
  }

  private setUpdates(
    updates: Array<{
      id: string;
      status: SkillUpdateStatus;
      resolvedUrl?: string | null;
      revision?: string | null;
      remoteRevision?: string | null;
      error?: string | null;
    }>
  ): void {
    const states = this.loadUpdateStates();
    const checkedAt = Date.now();
    for (const update of updates) {
      states[update.id] = {
        stateVersion: 2,
        status: update.status,
        lastCheckedAt: checkedAt,
        error: update.error ?? null,
        resolvedUrl: update.resolvedUrl ?? states[update.id]?.resolvedUrl ?? null,
        revision: update.revision ?? states[update.id]?.revision ?? null,
        remoteRevision:
          update.remoteRevision ??
          update.revision ??
          states[update.id]?.remoteRevision ??
          null,
      };
    }
    this.saveUpdateStates(states);
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
    await cleanupRemotePreviews();

    if (await exists(join(repo.dir, ".git"))) {
      onProgress?.("正在连接本地仓库…");
      let usable = false;
      try {
        const head = await git.resolveRef({ fs, dir: repo.dir, ref: "HEAD" });
        await git.readCommit({ fs, dir: repo.dir, oid: head });
        usable = true;
      } catch {
        // A process can die while cloning, leaving a .git directory without a
        // readable HEAD commit. Replace that partial clone instead of opening
        // a repository whose reads and writes will fail.
      }
      if (usable) {
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
      await removeTree(repo.dir);
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
    const updateStates = this.loadUpdateStates();
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
      const sourceType = meta.source?.type || "local";
      const hasUpstream = sourceType === "git" && Boolean(meta.source?.ref);
      const persisted = hasUpstream ? updateStates[id] : null;
      const defaultUpdateStatus: SkillUpdateStatus =
        sourceType === "local" || sourceType === "import"
          ? "local_only"
          : hasUpstream
            ? "unknown"
            : "no_upstream";
      skills.push({
        id,
        name: parsed.name || fallbackName,
        description: parsed.description,
        path: relativePath,
        pathKey: meta.path_key || skillPathKey(relativePath),
        enabled: meta.enabled !== false,
        tags: sortTags(meta.tags ?? []),
        source: {
          type: sourceType,
          ref: meta.source?.ref ?? null,
          resolved: persisted?.resolvedUrl ?? meta.source?.ref ?? null,
          subpath: meta.source?.subpath ?? null,
          branch: meta.source?.branch ?? null,
          revision: persisted?.revision ?? null,
        },
        content: parsed.body,
        frontmatter: parsed.frontmatter,
        presetIds: [...new Set(presetMap.get(id) ?? [])],
        updateStatus: persisted?.status ?? defaultUpdateStatus,
        lastCheckedAt: persisted?.lastCheckedAt ?? null,
        lastCheckError: persisted?.error ?? null,
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
        source: {
          type: "local",
          ref: null,
          resolved: null,
          subpath: null,
          branch: null,
          revision: null,
        },
        content: parsed.body,
        frontmatter: parsed.frontmatter,
        presetIds: presetMap.get(id) ?? [],
        updateStatus: "local_only",
        lastCheckedAt: null,
        lastCheckError: null,
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
    const [localHead, matrix] = await Promise.all([
      this.localHead(),
      this.statusMatrix(),
    ]);
    if (matrix.some(([, head, workdir, stage]) => head !== workdir || head !== stage)) {
      return "dirty";
    }
    await this.fetchRemote();
    const remoteHead = await this.remoteHead();
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
    await this.commitWorktree(message);
    return this.pushLocalCommit();
  }

  private async commitWorktree(message: string): Promise<boolean> {
    const changed = await this.stageAll();
    if (changed === 0) return false;
    await git.commit({
      fs,
      dir: this.dir,
      message,
      author: APP_AUTHOR,
    });
    return true;
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

  private async pushLocalCommit(onProgress?: (message: string) => void): Promise<MutationResult> {
    let pushed = true;
    let notice: string | null = null;
    try {
      onProgress?.("正在检查主仓库远端…");
      const remoteAfterFetch = await this.fetchRemote();
      const localHead = await this.localHead();
      if (remoteAfterFetch && localHead !== remoteAfterFetch) {
        await this.mergeRemoteSafely();
      }
      onProgress?.("正在推送主仓库…");
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

  async mutate(
    action: () => Promise<void>,
    message: string,
    onProgress?: (message: string) => void
  ): Promise<MutationResult> {
    await this.commitWorktree("mobile: checkpoint interrupted local changes");
    await action();
    onProgress?.("正在写入本地 Git…");
    const changed = await this.commitWorktree(message);
    if (!changed) return { snapshot: await this.snapshot(), pushed: true, notice: null };
    return this.pushLocalCommit(onProgress);
  }

  private async cloneUpstream(source: ParsedInstallSource): Promise<{
    tempDir: string;
    branch: string;
    revision: string;
  }> {
    await mkdirp(CACHE_ROOT);
    const tempDir = join(CACHE_ROOT, `${REMOTE_PREVIEW_PREFIX}${newId()}`);
    try {
      const info = await git.getRemoteInfo({
        http: nativeGitHttp,
        url: source.remoteUrl,
        onAuth: () => this.auth(),
      });
      const branch = source.branch || info.HEAD?.replace("refs/heads/", "") || "main";
      await git.clone({
        fs,
        http: nativeGitHttp,
        dir: tempDir,
        url: source.remoteUrl,
        ref: branch,
        singleBranch: true,
        depth: 1,
        onAuth: () => this.auth(),
      });
      const revision = await git.resolveRef({ fs, dir: tempDir, ref: "HEAD" });
      return { tempDir, branch, revision };
    } catch (error) {
      await removeTree(tempDir).catch(() => undefined);
      throw friendlyGitError(error);
    }
  }

  private async remoteBranchHead(source: ParsedInstallSource): Promise<{
    branch: string;
    revision: string;
  }> {
    try {
      const refs = await git.listServerRefs({
        http: nativeGitHttp,
        url: source.remoteUrl,
        protocolVersion: 2,
        symrefs: true,
        onAuth: () => this.auth(),
      });
      const headRef = refs.find((ref) => ref.ref === "HEAD");
      const branch =
        source.branch ||
        headRef?.target?.replace("refs/heads/", "") ||
        "main";
      const fullRef = `refs/heads/${branch}`;
      const revision = refs.find((ref) => ref.ref === fullRef)?.oid;
      if (!revision) {
        throw new MobileGitError(`上游分支 ${branch} 不存在`, "INVALID_REPO");
      }
      return { branch, revision };
    } catch (error) {
      throw friendlyGitError(error);
    }
  }

  private async githubApi<T>(path: string): Promise<T> {
    const response = await nativeGitHttp.request({
      url: `https://api.github.com${path}`,
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": navigator.userAgent,
      },
      fetchOptions: { timeoutMs: 30_000 },
    });
    const bytes = await collectBody(response.body);
    const text = new TextDecoder().decode(bytes);
    if (response.statusCode >= 400) {
      let message = `GitHub API ${response.statusCode}`;
      try {
        const error = JSON.parse(text) as { message?: string };
        if (error.message) message = error.message;
      } catch {
        // Keep the HTTP status when GitHub did not return JSON.
      }
      const code =
        response.statusCode === 401 || response.statusCode === 403
          ? "AUTH"
          : response.statusCode === 404
            ? "INVALID_REPO"
            : "NETWORK";
      throw new MobileGitError(message, code);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new MobileGitError("GitHub 返回了无法解析的数据", "NETWORK");
    }
  }

  private async githubContents(
    source: ParsedInstallSource,
    revision: string,
    repositoryPath: string | null
  ): Promise<GithubContentEntry[]> {
    const path = repositoryPath
      ? repositoryPath.split("/").map(encodeURIComponent).join("/")
      : "";
    const response = await this.githubApi<GithubContentEntry | GithubContentEntry[]>(
      `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/contents/${path}?ref=${encodeURIComponent(revision)}`
    );
    return Array.isArray(response) ? response : [response];
  }

  private async collectGithubFiles(
    source: ParsedInstallSource,
    revision: string,
    repositoryPath: string | null
  ): Promise<Array<{ path: string; sha: string }>> {
    const rootPath = repositoryPath ? safeRepoRelativePath(repositoryPath) : "";
    const files: Array<{ path: string; sha: string }> = [];
    const collect = async (remotePath: string | null) => {
      const entries = await this.githubContents(source, revision, remotePath);
      for (const entry of entries) {
        if (entry.type === "dir") await collect(entry.path);
        else if (entry.type === "file" || entry.type === "symlink") {
          files.push({ path: entry.path, sha: entry.sha });
        }
      }
    };
    await collect(rootPath || null);
    return files;
  }

  private async downloadGithubSkill(
    source: ParsedInstallSource,
    revision: string,
    repositoryPath: string | null,
    destination: string
  ): Promise<void> {
    const rootPath = repositoryPath ? safeRepoRelativePath(repositoryPath) : "";
    const files = await this.collectGithubFiles(source, revision, repositoryPath);

    if (!files.some((entry) => /(?:^|\/)skill\.md$/i.test(entry.path))) {
      throw new MobileGitError("上游已不存在这个 Skill 目录", "INVALID_REPO");
    }
    await removeTree(destination);
    await mkdirp(destination);
    for (let index = 0; index < files.length; index += 4) {
      const batch = files.slice(index, index + 4);
      const downloaded = await Promise.all(
        batch.map(async (entry) => {
          const blob = await this.githubApi<{ content: string; encoding: string }>(
            `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/git/blobs/${entry.sha}`
          );
          if (blob.encoding !== "base64") {
            throw new MobileGitError("GitHub 返回了不支持的二进制编码", "NETWORK");
          }
          return { entry, bytes: base64ToBytes(blob.content) };
        })
      );
      for (const { entry, bytes } of downloaded) {
        const relative = rootPath && entry.path.startsWith(`${rootPath}/`)
          ? entry.path.slice(rootPath.length + 1)
          : entry.path;
        if (!relative) continue;
        await mkdirp(dirname(join(destination, relative)));
        await pfs.writeFile(join(destination, relative), bytes);
      }
    }
  }

  async previewRemoteSkills(repoUrl: string): Promise<RemoteInstallSession> {
    const source = parseInstallSource(repoUrl);
    const cloned = await this.cloneUpstream(source);
    try {
      const scanRoot = source.subpath
        ? join(cloned.tempDir, safeRepoRelativePath(source.subpath))
        : cloned.tempDir;
      if (!(await exists(scanRoot))) {
        throw new MobileGitError(`仓库中不存在目录 ${source.subpath}`, "INVALID_REPO");
      }
      const dirs = await findSkillDirectories(scanRoot);
      if (dirs.length === 0) {
        throw new MobileGitError("这个仓库中没有找到含 SKILL.md 的 Skill", "INVALID_REPO");
      }
      const skills = await Promise.all(
        dirs.map(async (dir) => {
          const relPath =
            dir === cloned.tempDir ? "." : dir.slice(cloned.tempDir.length).replace(/^\/+/, "");
          const markdownPath = (await exists(join(dir, "SKILL.md")))
            ? join(dir, "SKILL.md")
            : join(dir, "skill.md");
          const parsed = parseSkillMarkdown(await readText(markdownPath));
          const fallback = relPath === "." ? source.repo : relPath.split("/").pop() || relPath;
          return {
            relPath,
            name: parsed.name || fallback,
            description: parsed.description,
          } satisfies RemoteSkillPreview;
        })
      );
      return {
        originalUrl: source.originalUrl,
        cloneUrl: source.remoteUrl,
        owner: source.owner,
        repo: source.repo,
        branch: cloned.branch,
        subpath: source.subpath,
        revision: cloned.revision,
        tempDir: cloned.tempDir,
        skills: skills.sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
      };
    } catch (error) {
      await removeTree(cloned.tempDir).catch(() => undefined);
      throw friendlyGitError(error);
    }
  }

  async cancelRemotePreview(tempDir: string): Promise<void> {
    const expectedPrefix = `${CACHE_ROOT}/${REMOTE_PREVIEW_PREFIX}`;
    if (!tempDir.startsWith(expectedPrefix) || tempDir.includes("..")) return;
    await removeTree(tempDir);
  }

  async installRemoteSkills(
    session: RemoteInstallSession,
    items: RemoteSkillInstallItem[]
  ): Promise<MutationResult> {
    const expectedPrefix = `${CACHE_ROOT}/${REMOTE_PREVIEW_PREFIX}`;
    if (!session.tempDir.startsWith(expectedPrefix) || session.tempDir.includes("..")) {
      throw new MobileGitError("上游预览已失效，请重新预览", "INVALID_REPO");
    }
    try {
      const installedIds: string[] = [];
      const result = await this.mutate(async () => {
        const currentSkills = await this.loadSkills();
        const usedPaths = new Set(currentSkills.map((skill) => skill.pathKey));
        const uniqueItems = [...new Map(items.map((item) => [item.relPath, item])).values()];
        for (const item of uniqueItems) {
          const remoteDir =
            item.relPath === "."
              ? session.tempDir
              : join(session.tempDir, safeRepoRelativePath(item.relPath));
          if (!(await hasSkillDocument(remoteDir))) continue;
          const preview = session.skills.find((skill) => skill.relPath === item.relPath);
          const preferredName = item.name.trim() || preview?.name || "skill";
          const base = slugifySkillName(preferredName);
          let destination = base;
          let suffix = 2;
          while (
            usedPaths.has(skillPathKey(destination)) ||
            (await exists(join(this.dir, destination)))
          ) {
            destination = `${base}-${suffix++}`;
          }
          usedPaths.add(skillPathKey(destination));
          await copyTree(remoteDir, join(this.dir, destination));
          const id = newId();
          const meta: SkillMetaFile = {
            schema_version: MOBILE_SCHEMA_VERSION,
            skill_id: id,
            path: destination,
            path_key: skillPathKey(destination),
            enabled: true,
            tags: [],
            source: {
              type: "git",
              ref: session.originalUrl,
              subpath: item.relPath === "." ? null : item.relPath,
              branch: session.branch,
            },
          };
          await writeText(join(this.dir, META, "skills", `${id}.json`), formatJson(meta));
          installedIds.push(id);
        }
        await writeText(join(this.dir, META, "schema.json"), formatJson({
          schema_version: MOBILE_SCHEMA_VERSION,
          app_min_version: "2.0.0",
          created_by: "skills-manager",
        }));
        this.setUpdates(
          installedIds.map((id) => ({
            id,
            status: "up_to_date",
            resolvedUrl: session.cloneUrl,
            revision: session.revision,
          }))
        );
      }, `mobile: install ${items.length} upstream skill${items.length === 1 ? "" : "s"}`);
      if (installedIds.length === 0) {
        throw new MobileGitError("没有可安装的 Skill", "INVALID_REPO");
      }
      return result;
    } finally {
      await removeTree(session.tempDir).catch(() => undefined);
    }
  }

  async checkRemoteUpdates(): Promise<MutationResult> {
    const allSkills = await this.loadSkills();
    const skipped = allSkills.filter(
      (skill) => skill.source.type !== "git" || !skill.source.ref
    );
    if (skipped.length > 0) {
      this.setUpdates(
        skipped.map((skill) => ({
          id: skill.id,
          status:
            skill.source.type === "local" || skill.source.type === "import"
              ? ("local_only" as const)
              : ("no_upstream" as const),
        }))
      );
    }
    const skills = allSkills.filter(
      (skill) => skill.source.type === "git" && skill.source.ref
    );
    if (skills.length === 0) {
      return {
        snapshot: await this.snapshot(),
        pushed: true,
        notice:
          skipped.length > 0
            ? `没有可检查的 GitHub 上游，已跳过 ${skipped.length} 个 Skill。`
            : "当前没有可检查更新的 Skill。",
      };
    }

    const groups = new Map<string, { source: ParsedInstallSource; skills: MobileSkill[] }>();
    const failures: string[] = [];
    let skippedCount = skipped.length;
    for (const skill of skills) {
      try {
        const source = parseInstallSource(skill.source.ref!);
        source.branch = skill.source.branch || source.branch;
        source.subpath = null;
        const key = `${source.remoteUrl}|${source.branch}`;
        const group = groups.get(key) ?? { source, skills: [] };
        group.skills.push(skill);
        groups.set(key, group);
      } catch {
        this.setUpdates([{ id: skill.id, status: "no_upstream", error: null }]);
        skippedCount++;
      }
    }

    let updateCount = 0;
    let unknownCount = 0;
    const storedUpdates = this.loadUpdateStates();
    for (const group of groups.values()) {
      try {
        const head = await this.remoteBranchHead(group.source);
        for (const skill of group.skills) {
          const installedRevision = storedUpdates[skill.id]?.revision ?? skill.source.revision;
          const status: SkillUpdateStatus =
            installedRevision === null || installedRevision === undefined
              ? "unknown"
              : installedRevision === head.revision
                ? "up_to_date"
                : "update_available";
          if (status === "update_available") updateCount++;
          else if (status === "unknown") unknownCount++;
          this.setUpdates([
            {
              id: skill.id,
              status,
              resolvedUrl: group.source.remoteUrl,
              remoteRevision: head.revision,
            },
          ]);
        }
      } catch (error) {
        const message = friendlyGitError(error).message;
        this.setUpdates(
          group.skills.map((skill) => ({
            id: skill.id,
            status: "error",
            error: message,
          }))
        );
        failures.push(...group.skills.map((skill) => `${skill.name}: ${message}`));
      }
    }

    const parts: string[] = [];
    if (updateCount > 0) parts.push(`发现 ${updateCount} 个可更新的 Skill`);
    else if (unknownCount === 0) parts.push("所有可检查的 GitHub Skill 都是最新版本");
    if (failures.length > 0) parts.push(`${failures.length} 个检查失败`);
    if (unknownCount > 0) parts.push(`${unknownCount} 个缺少本地上游基线，无法比较`);
    if (skippedCount > 0) parts.push(`已跳过 ${skippedCount} 个无上游 Skill`);
    const notice = `${parts.join("，")}。`;
    return { snapshot: await this.snapshot(), pushed: failures.length === 0, notice };
  }

  async updateRemoteSkills(
    skillIds: string[],
    onProgress?: (message: string) => void
  ): Promise<MutationResult> {
    const requested = new Set(skillIds);
    const allSkills = await this.loadSkills();
    const selected = allSkills.filter(
      (skill) => requested.has(skill.id) && skill.source.type === "git" && skill.source.ref
    );
    if (selected.length === 0) {
      return {
        snapshot: await this.snapshot(),
        pushed: true,
        notice: "没有选择可更新的 GitHub Skill。",
      };
    }

    const groups = new Map<string, { source: ParsedInstallSource; skills: MobileSkill[] }>();
    for (const skill of selected) {
      const source = parseInstallSource(skill.source.ref!);
      source.branch = skill.source.branch || source.branch;
      const key = `${source.remoteUrl}|${source.branch}`;
      const group = groups.get(key) ?? { source, skills: [] };
      group.skills.push(skill);
      groups.set(key, group);
    }

    const failures: string[] = [];
    let updatedCount = 0;
    const result = await this.mutate(async () => {
      for (const group of groups.values()) {
        try {
          onProgress?.("正在检查上游提交…");
          const head = await this.remoteBranchHead(group.source);
          for (const skill of group.skills) {
            const installedRevision = this.loadUpdateStates()[skill.id]?.revision;
            if (installedRevision === head.revision) {
              this.setUpdates([
                {
                  id: skill.id,
                  status: "up_to_date",
                  resolvedUrl: group.source.remoteUrl,
                  revision: head.revision,
                },
              ]);
              continue;
            }
            const stage = join(CACHE_ROOT, `stage-${newId()}`);
            try {
              const localDir = join(this.dir, skill.path);
              onProgress?.(`正在下载 ${skill.name}…`);
              await this.downloadGithubSkill(
                group.source,
                head.revision,
                skill.source.subpath,
                stage
              );
              onProgress?.(`正在写入 ${skill.name}…`);
              await removeTree(localDir);
              await pfs.rename(stage, localDir);
              await writeText(join(this.dir, META, "skills", `${skill.id}.json`), formatJson({
                schema_version: MOBILE_SCHEMA_VERSION,
                skill_id: skill.id,
                path: skill.path,
                path_key: skill.pathKey,
                enabled: skill.enabled,
                tags: skill.tags,
                source: {
                  type: "git",
                  ref: skill.source.ref,
                  subpath: skill.source.subpath,
                  branch: head.branch,
                },
              } satisfies SkillMetaFile));
              this.setUpdates([
                {
                  id: skill.id,
                  status: "up_to_date",
                  resolvedUrl: group.source.remoteUrl,
                  revision: head.revision,
                },
              ]);
              updatedCount++;
            } catch (error) {
              await removeTree(stage).catch(() => undefined);
              const message = friendlyGitError(error).message;
              this.setUpdates([{ id: skill.id, status: "error", error: message }]);
              failures.push(`${skill.name}: ${message}`);
            }
          }
        } catch (error) {
          const message = friendlyGitError(error).message;
          this.setUpdates(
            group.skills.map((skill) => ({
              id: skill.id,
              status: "error",
              error: message,
            }))
          );
          failures.push(...group.skills.map((skill) => `${skill.name}: ${message}`));
        }
      }
    }, `mobile: update ${selected.length} upstream skill${selected.length === 1 ? "" : "s"}`, onProgress);

    return {
      ...result,
      notice:
        failures.length > 0
          ? [`已更新 ${updatedCount} 个 Skill，${failures.length} 个失败。`, result.notice]
              .filter(Boolean)
              .join(" ")
          : result.notice,
    };
  }

  private async skillMatchesRemote(
    skill: MobileSkill,
    source: ParsedInstallSource,
    revision: string
  ): Promise<boolean> {
    const remoteFiles = await this.collectGithubFiles(
      source,
      revision,
      skill.source.subpath
    );
    if (!remoteFiles.some((file) => /(?:^|\/)skill\.md$/i.test(file.path))) {
      throw new MobileGitError("上游已不存在这个 Skill 目录", "INVALID_REPO");
    }
    const rootPath = skill.source.subpath
      ? safeRepoRelativePath(skill.source.subpath)
      : "";
    const remoteMap = new Map(
      remoteFiles.map((file) => [
        rootPath && file.path.startsWith(`${rootPath}/`)
          ? file.path.slice(rootPath.length + 1)
          : file.path,
        file.sha,
      ])
    );
    const localDir = join(this.dir, skill.path);
    const localFiles = await walkFiles(localDir);
    const localEntries = await Promise.all(
      localFiles.map(async (file) => {
        const relative = file.slice(localDir.length + 1);
        return [relative, await gitBlobSha(await pfs.readFile(file))] as const;
      })
    );
    const localMap = new Map(localEntries);
    return (
      localMap.size === remoteMap.size &&
      [...localMap].every(([path, sha]) => remoteMap.get(path) === sha)
    );
  }

  async establishRemoteBaseline(skillId: string): Promise<MutationResult> {
    const skill = (await this.loadSkills()).find((candidate) => candidate.id === skillId);
    if (!skill || skill.source.type !== "git" || !skill.source.ref) {
      throw new MobileGitError("这个 Skill 没有可比较的 GitHub 上游", "INVALID_REPO");
    }
    const source = parseInstallSource(skill.source.ref);
    source.branch = skill.source.branch || source.branch;
    const head = await this.remoteBranchHead(source);
    const same = await this.skillMatchesRemote(skill, source, head.revision);
    this.setUpdates([
      same
        ? {
            id: skill.id,
            status: "up_to_date",
            resolvedUrl: source.remoteUrl,
            revision: head.revision,
          }
        : {
            id: skill.id,
            status: "update_available",
            resolvedUrl: source.remoteUrl,
            remoteRevision: head.revision,
          },
    ]);
    return {
      snapshot: await this.snapshot(),
      pushed: true,
      notice: same
        ? "本地内容与上游一致，已建立更新基线。"
        : "上游当前版本与本地内容不同，已标记为可更新。",
    };
  }

  async establishAllRemoteBaselines(
    onProgress?: (message: string) => void
  ): Promise<MutationResult> {
    const candidates = (await this.loadSkills()).filter(
      (skill) =>
        skill.updateStatus === "unknown" &&
        skill.source.type === "git" &&
        skill.source.ref
    );
    if (candidates.length === 0) {
      return {
        snapshot: await this.snapshot(),
        pushed: true,
        notice: "没有需要建立基线的 Skill。",
      };
    }

    const groups = new Map<
      string,
      { source: ParsedInstallSource; skills: MobileSkill[] }
    >();
    let skipped = 0;
    for (const skill of candidates) {
      try {
        const source = parseInstallSource(skill.source.ref!);
        source.branch = skill.source.branch || source.branch;
        source.subpath = null;
        const key = `${source.remoteUrl}|${source.branch}`;
        const group = groups.get(key) ?? { source, skills: [] };
        group.skills.push(skill);
        groups.set(key, group);
      } catch {
        skipped++;
        this.setUpdates([{ id: skill.id, status: "no_upstream", error: null }]);
      }
    }

    let matched = 0;
    let available = 0;
    const failures: string[] = [];
    for (const group of groups.values()) {
      try {
        onProgress?.("正在读取上游提交…");
        const head = await this.remoteBranchHead(group.source);
        for (const skill of group.skills) {
          try {
            onProgress?.(`正在比较 ${skill.name}…`);
            const same = await this.skillMatchesRemote(skill, group.source, head.revision);
            if (same) matched++;
            else available++;
            this.setUpdates([
              same
                ? {
                    id: skill.id,
                    status: "up_to_date",
                    resolvedUrl: group.source.remoteUrl,
                    revision: head.revision,
                  }
                : {
                    id: skill.id,
                    status: "update_available",
                    resolvedUrl: group.source.remoteUrl,
                    remoteRevision: head.revision,
                  },
            ]);
          } catch (error) {
            const message = friendlyGitError(error).message;
            this.setUpdates([{ id: skill.id, status: "error", error: message }]);
            failures.push(`${skill.name}: ${message}`);
          }
        }
      } catch (error) {
        const message = friendlyGitError(error).message;
        this.setUpdates(
          group.skills.map((skill) => ({
            id: skill.id,
            status: "error",
            error: message,
          }))
        );
        failures.push(...group.skills.map((skill) => `${skill.name}: ${message}`));
      }
    }

    const parts = [`${matched} 个已建立基线`];
    if (available > 0) parts.push(`${available} 个与上游不同，已标记可更新`);
    if (failures.length > 0) parts.push(`${failures.length} 个检查失败`);
    if (skipped > 0) parts.push(`${skipped} 个无可用上游`);
    return {
      snapshot: await this.snapshot(),
      pushed: failures.length === 0,
      notice: `${parts.join("，")}。`,
    };
  }

  async cancelNetworkOperations(): Promise<void> {
    if (isNativeAndroid()) await NativeGitHttp.cancel();
  }

  async saveSkill(draft: SkillDraft): Promise<MutationResult> {
    if (!draft.name.trim()) throw new MobileGitError("Skill 名称不能为空", "INVALID_REPO");
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
      const source = existing?.source ?? {
        type: "local",
        ref: null,
        resolved: null,
        subpath: null,
        branch: null,
        revision: null,
      };
      const meta: SkillMetaFile = {
        schema_version: MOBILE_SCHEMA_VERSION,
        skill_id: id,
        path,
        path_key: skillPathKey(path),
        enabled: existing?.enabled ?? true,
        tags: sortTags(draft.tags),
        source: {
          type: source.type,
          ref: source.ref,
          subpath: source.subpath,
          branch: source.branch,
        },
      };
      await writeText(join(this.dir, META, "skills", `${id}.json`), formatJson(meta));
      if (source.type === "git") {
        this.setUpdates([{ id, status: "unknown" }]);
      }
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
      const updateStates = this.loadUpdateStates();
      delete updateStates[skill.id];
      this.saveUpdateStates(updateStates);
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
    if (!draft.name.trim()) throw new MobileGitError("Preset 名称不能为空", "INVALID_REPO");
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
