export const MOBILE_SCHEMA_VERSION = 1;

export type SourceType = "git" | "local" | "import" | "skills.sh" | "url" | string;

export interface SkillSource {
  type: SourceType;
  ref: string | null;
  subpath: string | null;
  branch: string | null;
}

export interface MobileSkill {
  id: string;
  name: string;
  description: string | null;
  path: string;
  pathKey: string;
  enabled: boolean;
  tags: string[];
  source: SkillSource;
  content: string;
  frontmatter: string | null;
  presetIds: string[];
}

export interface MobilePreset {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  skillIds: string[];
}

export interface PresetMembership {
  scenarioId: string;
  skillId: string;
  sortOrder: number;
  tools: Record<string, boolean>;
}

export interface GitCommitSummary {
  oid: string;
  shortOid: string;
  message: string;
  author: string;
  timestamp: number;
}

export type SyncPhase = "current" | "ahead" | "behind" | "diverged" | "dirty" | "unknown";

export interface SyncSummary {
  phase: SyncPhase;
  localHead: string | null;
  remoteHead: string | null;
  pendingChanges: number;
  lastSyncedAt: number | null;
  message: string | null;
}

export interface RepoSnapshot {
  remoteUrl: string;
  owner: string;
  repo: string;
  branch: string;
  skills: MobileSkill[];
  presets: MobilePreset[];
  commits: GitCommitSummary[];
  sync: SyncSummary;
}

export interface SkillDraft {
  id?: string;
  name: string;
  description: string;
  tags: string[];
  content: string;
}

export interface PresetDraft {
  id?: string;
  name: string;
  description: string;
  icon: string;
}

export interface RepoConnection {
  remoteUrl: string;
  owner: string;
  repo: string;
  branch: string;
}

export interface MutationResult {
  snapshot: RepoSnapshot;
  pushed: boolean;
  notice: string | null;
}

export interface MobileRepository {
  readonly connection: RepoConnection;
  snapshot(): Promise<RepoSnapshot>;
  sync(): Promise<MutationResult>;
  checkpoint(): Promise<MutationResult>;
  saveSkill(draft: SkillDraft): Promise<MutationResult>;
  deleteSkill(skillId: string): Promise<MutationResult>;
  savePreset(draft: PresetDraft): Promise<MutationResult>;
  deletePreset(presetId: string): Promise<MutationResult>;
  setPresetSkill(presetId: string, skillId: string, included: boolean): Promise<MutationResult>;
  reorderPreset(presetId: string, direction: -1 | 1): Promise<MutationResult>;
  reorderPresetSkill(presetId: string, skillId: string, direction: -1 | 1): Promise<MutationResult>;
}

export interface SkillMetaFile {
  schema_version: number;
  skill_id: string;
  path: string;
  path_key: string;
  enabled: boolean;
  tags: string[];
  source: {
    type: string;
    ref: string | null;
    subpath: string | null;
    branch: string | null;
  };
}

export interface PresetMetaFile {
  schema_version: number;
  scenario_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
}

export interface PresetMembershipMetaFile {
  schema_version: number;
  scenario_id: string;
  skill_id: string;
  sort_order: number;
  tools: Record<string, boolean>;
}

export class MobileGitError extends Error {
  readonly code: "AUTH" | "NETWORK" | "CONFLICT" | "INVALID_REPO" | "UNKNOWN";

  constructor(message: string, code: MobileGitError["code"] = "UNKNOWN") {
    super(message);
    this.name = "MobileGitError";
    this.code = code;
  }
}

export function parseRemoteUrl(input: string): RepoConnection {
  const raw = input.trim().replace(/\/+$/, "");
  if (!raw) throw new MobileGitError("请输入 GitHub 仓库地址", "INVALID_REPO");

  let owner = "";
  let repo = "";
  let branch = "main";
  const ssh = raw.match(/^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?$/i);
  const https = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/tree\/([^/?#]+))?$/i);
  const shorthand = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/tree\/([^/?#]+))?$/);

  if (ssh) {
    [, owner, repo] = ssh;
  } else if (https) {
    [, owner, repo, branch = "main"] = https;
  } else if (shorthand) {
    [, owner, repo, branch = "main"] = shorthand;
  } else {
    throw new MobileGitError("仓库地址应类似 git@github.com:owner/repo.git", "INVALID_REPO");
  }

  if (!owner || !repo) throw new MobileGitError("仓库地址缺少 owner 或 repo", "INVALID_REPO");
  return {
    owner,
    repo: repo.replace(/\.git$/i, ""),
    branch,
    remoteUrl: `https://github.com/${owner}/${repo.replace(/\.git$/i, "")}.git`,
  };
}

export function repoStorageKey(remoteUrl: string): string {
  let hash = 2166136261;
  for (let index = 0; index < remoteUrl.length; index++) {
    hash ^= remoteUrl.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `repo-${(hash >>> 0).toString(36)}`;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function skillPathKey(path: string): string {
  return path
    .split("/")
    .map((part) => part.normalize("NFC").toLocaleLowerCase("en-US"))
    .join("/");
}

export function slugifySkillName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || `skill-${newId().slice(0, 8)}`;
}

export function sortTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-CN")
  );
}

export function parseSkillMarkdown(markdown: string): {
  name: string | null;
  description: string | null;
  body: string;
  frontmatter: string | null;
} {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { name: null, description: null, body: normalized, frontmatter: null };
  }
  const rest = normalized.slice(4);
  const closing = /(?:^|\n)---(?:\n|$)/.exec(rest);
  if (!closing) return { name: null, description: null, body: normalized, frontmatter: null };

  const frontmatter = rest.slice(0, closing.index).replace(/\n$/, "");
  const body = rest.slice(closing.index + closing[0].length);
  const values = new Map<string, string>();
  const lines = frontmatter.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (value === "|" || value === ">") {
      const block: string[] = [];
      while (index + 1 < lines.length && /^(?:\s+|$)/.test(lines[index + 1])) {
        block.push(lines[++index]);
      }
      const indented = block.filter((item) => item.trim());
      const indent = Math.min(
        ...indented.map((item) => item.match(/^\s*/)?.[0].length ?? 0),
        Number.POSITIVE_INFINITY
      );
      const cleaned = block.map((item) => item.slice(Number.isFinite(indent) ? indent : 0));
      value = value === "|"
        ? cleaned.join("\n").trim()
        : cleaned.join(" ").replace(/\s+/g, " ").trim();
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
      if (rawValue.trim().startsWith('"')) {
        try {
          value = JSON.parse(rawValue.trim()) as string;
        } catch {
          // A malformed quote should not make the whole skill unreadable.
        }
      }
    }
    values.set(key, value);
  }
  return {
    name: values.get("name")?.trim() || null,
    description: values.get("description")?.trim() || null,
    body: body.trim(),
    frontmatter,
  };
}

function isBlockContinuation(lines: string[], index: number): boolean {
  return /^(?:\s+|$)/.test(lines[index] ?? "");
}

export function renderSkillMarkdown(
  name: string,
  description: string,
  body: string,
  frontmatter: string | null = null
): string {
  const safeName = name.trim().replace(/\n/g, " ");
  const safeDescription = description.trim().replace(/\n/g, " ");
  const original = frontmatter?.split("\n") ?? [];
  const fields: string[] = [];
  let hasName = false;
  let hasDescription = false;
  for (let index = 0; index < original.length; index++) {
    const line = original[index];
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    const key = match?.[1];
    const value = match?.[2]?.trim() ?? "";
    if (key === "name") {
      hasName = true;
      fields.push(`name: ${JSON.stringify(safeName)}`);
      if (value === "|" || value === ">") {
        while (isBlockContinuation(original, index + 1)) index++;
      }
      continue;
    }
    if (key === "description") {
      hasDescription = true;
      if (safeDescription) fields.push(`description: ${JSON.stringify(safeDescription)}`);
      if (value === "|" || value === ">") {
        while (isBlockContinuation(original, index + 1)) index++;
      }
      continue;
    }
    fields.push(line);
  }
  if (!hasName) fields.unshift(`name: ${JSON.stringify(safeName)}`);
  if (!hasDescription && safeDescription) {
    const nameIndex = fields.findIndex((line) => /^name:/.test(line));
    fields.splice(nameIndex + 1, 0, `description: ${JSON.stringify(safeDescription)}`);
  }
  return ["---", ...fields, "---", "", body.trim(), ""].join("\n");
}

export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(timestamp);
}

export function friendlyGitError(error: unknown): MobileGitError {
  if (error instanceof MobileGitError) return error;
  const raw = error instanceof Error ? error.message : String(error);
  if (/401|403|auth|credential|password|token/i.test(raw)) {
    return new MobileGitError("GitHub 拒绝了凭据。请确认 PAT 未过期，且有该仓库的 Contents 读写权限。", "AUTH");
  }
  if (/conflict|not.?fast.?forward|merge/i.test(raw)) {
    return new MobileGitError("远端仓库已有冲突修改。改动已安全保留在本地，请先处理分叉后重试。", "CONFLICT");
  }
  if (
    /network|fetch|timeout|offline|failed to fetch|request failed|end of stream|stream reset|connection reset|broken pipe|ssl/i.test(
      raw
    )
  ) {
    return new MobileGitError("无法连接 GitHub。本地内容没有被删除，恢复网络后可重试。", "NETWORK");
  }
  if (/repository|repo|not found/i.test(raw)) {
    return new MobileGitError("找不到仓库，或当前令牌没有访问权限。", "INVALID_REPO");
  }
  return new MobileGitError(raw || "Git 操作失败", "UNKNOWN");
}
