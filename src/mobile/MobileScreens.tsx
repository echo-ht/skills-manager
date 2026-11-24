import { useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  Cloud,
  CloudOff,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  Github,
  Layers3,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { cn } from "../utils";
import { getPresetIconOption } from "../lib/presetIcons";
import {
  formatRelativeTime,
  type MobilePreset,
  type MobileSkill,
  type RepoSnapshot,
  type SyncSummary,
} from "./model";

function AppBar({
  title,
  subtitle,
  leading,
  action,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mobile-appbar">
      <div className="mobile-appbar-leading">{leading}</div>
      <div className="mobile-appbar-title">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="mobile-appbar-action">{action}</div>
    </header>
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="mobile-empty">
      <div className="mobile-empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function RepoLoadingScreen({ message }: { message: string }) {
  return (
    <main className="mobile-loading-screen" aria-busy="true" aria-live="polite">
      <header className="mobile-loading-header">
        <img src="/icons/128x128.png" alt="" />
        <div>
          <h1>Skills Manager</h1>
          <p>
            <Loader2 className="spin" size={16} />
            {message}
          </p>
        </div>
      </header>
      <div className="mobile-loading-content" aria-hidden="true">
        <div className="mobile-loading-block mobile-loading-hero" />
        <div className="mobile-loading-grid">
          <div className="mobile-loading-block" />
          <div className="mobile-loading-block" />
        </div>
        <div className="mobile-loading-block mobile-loading-list" />
      </div>
    </main>
  );
}

interface ConnectScreenProps {
  initialRemote: string;
  busy: boolean;
  progress: string;
  error: string | null;
  onConnect: (remote: string, token: string) => void;
}

export function ConnectScreen({
  initialRemote,
  busy,
  progress,
  error,
  onConnect,
}: ConnectScreenProps) {
  const [remote, setRemote] = useState(initialRemote);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  return (
    <main className="mobile-connect">
      <header className="mobile-connect-brand">
        <img src="/icons/128x128.png" alt="Skills Manager" />
        <div>
          <p>SKILLS MANAGER</p>
          <h1>把技能仓库握在手里</h1>
        </div>
      </header>

      <section className="mobile-connect-card">
        <div className="mobile-connect-intro">
          <h2>连接 GitHub 仓库</h2>
          <p>手机会保留一份真实 Git 副本。每次编辑先提交到本地，再自动推送到远端。</p>
        </div>

        <label className="mobile-field">
          <span>仓库地址</span>
          <input
            autoCapitalize="none"
            autoCorrect="off"
            value={remote}
            onChange={(event) => setRemote(event.target.value)}
            placeholder="git@github.com:owner/repo.git"
          />
          <small>支持 SSH 地址、HTTPS 地址或 owner/repo；连接时统一转换成 HTTPS。</small>
        </label>

        <label className="mobile-field">
          <span>Personal Access Token</span>
          <div className="mobile-token-field">
            <input
              autoCapitalize="none"
              autoCorrect="off"
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="github_pat_..."
            />
            <button type="button" onClick={() => setShowToken((value) => !value)}>
              {showToken ? "隐藏" : "显示"}
            </button>
          </div>
          <small>令牌保存在 Android 安全存储中，不会写入仓库或 Git 配置。</small>
        </label>

        {error ? (
          <div className="mobile-inline-error" role="alert">
            <CircleAlert size={20} />
            <p>{error}</p>
          </div>
        ) : null}

        <button
          type="button"
          className="mobile-button mobile-button-filled mobile-connect-submit"
          disabled={busy || !remote.trim() || !token.trim()}
          onClick={() => onConnect(remote, token)}
        >
          {busy ? <Loader2 className="spin" size={20} /> : <Cloud size={20} />}
          {busy ? progress || "正在连接…" : "克隆并打开仓库"}
        </button>
      </section>

      <footer className="mobile-connect-footer">
        <ShieldCheck size={18} />
        <p>建议使用仅授权目标仓库、Contents 读写权限且设置了有效期的 fine-grained PAT。</p>
      </footer>
    </main>
  );
}

function syncCopy(sync: SyncSummary) {
  switch (sync.phase) {
    case "current":
      return {
        title: "已与远端同步",
        body: sync.lastSyncedAt ? `最近同步于 ${formatRelativeTime(sync.lastSyncedAt)}` : "本地与远端一致",
        tone: "success",
        icon: Cloud,
      };
    case "ahead":
      return {
        title: "本地提交待推送",
        body: "内容已经安全提交，点同步即可重试 push。",
        tone: "warning",
        icon: CloudOff,
      };
    case "behind":
      return {
        title: "远端有新提交",
        body: "点同步以安全 fast-forward 到最新版本。",
        tone: "info",
        icon: Cloud,
      };
    case "diverged":
      return {
        title: "本地与远端已分叉",
        body: "应用不会自动覆盖任何一方。建议在桌面端合并后再同步。",
        tone: "danger",
        icon: CircleAlert,
      };
    case "dirty":
      return {
        title: "有未提交改动",
        body: `${sync.pendingChanges} 个文件等待形成 commit。`,
        tone: "warning",
        icon: FileCode2,
      };
    default:
      return {
        title: "尚未与远端核对",
        body: sync.message || "连接 GitHub 后重新检查。",
        tone: sync.message ? "warning" : "info",
        icon: Cloud,
      };
  }
}

interface HomeScreenProps {
  snapshot: RepoSnapshot;
  syncing: boolean;
  onSync: () => void;
  onOpenSkills: () => void;
  onOpenPresets: () => void;
}

export function HomeScreen({
  snapshot,
  syncing,
  onSync,
  onOpenSkills,
  onOpenPresets,
}: HomeScreenProps) {
  const sync = syncCopy(snapshot.sync);
  const SyncIcon = sync.icon;
  return (
    <div className="mobile-screen">
      <AppBar
        title="仓库"
        subtitle={`${snapshot.owner}/${snapshot.repo}`}
        action={
          <button
            className="mobile-icon-button"
            type="button"
            aria-label="同步仓库"
            disabled={syncing}
            onClick={onSync}
          >
            {syncing ? <Loader2 className="spin" size={22} /> : <RefreshCw size={22} />}
          </button>
        }
      />

      <div className="mobile-content">
        <section className={cn("mobile-sync-card", `mobile-tone-${sync.tone}`)}>
          <div className="mobile-sync-icon">
            <SyncIcon size={24} />
          </div>
          <div>
            <h2>{sync.title}</h2>
            <p>{sync.body}</p>
            <div className="mobile-sync-meta">
              <span>
                <GitBranch size={15} />
                {snapshot.branch}
              </span>
              {snapshot.sync.localHead ? <span>{snapshot.sync.localHead.slice(0, 7)}</span> : null}
            </div>
          </div>
        </section>

        <div className="mobile-overview-actions">
          <button type="button" onClick={onOpenSkills} className="mobile-overview-link">
            <span className="mobile-overview-count">{snapshot.skills.length}</span>
            <span>Skills</span>
            <ChevronRight size={18} />
          </button>
          <button type="button" onClick={onOpenPresets} className="mobile-overview-link">
            <span className="mobile-overview-count">{snapshot.presets.length}</span>
            <span>Presets</span>
            <ChevronRight size={18} />
          </button>
        </div>

        <section className="mobile-section">
          <div className="mobile-section-heading">
            <h2>最近提交</h2>
            <span>{snapshot.commits.length} 条</span>
          </div>
          {snapshot.commits.length ? (
            <div className="mobile-commit-list">
              {snapshot.commits.slice(0, 5).map((commit) => (
                <div className="mobile-commit-row" key={commit.oid}>
                  <span className="mobile-commit-dot">
                    <GitCommitHorizontal size={18} />
                  </span>
                  <div>
                    <p>{commit.message}</p>
                    <small>
                      {commit.shortOid} · {commit.author} · {formatRelativeTime(commit.timestamp)}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<GitCommitHorizontal size={26} />}
              title="还没有提交"
              body="第一次编辑 Skill 或 Preset 后，这里会显示 Git 历史。"
            />
          )}
        </section>
      </div>
    </div>
  );
}

interface SkillsScreenProps {
  snapshot: RepoSnapshot;
  query: string;
  filter: "all" | "untagged";
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: "all" | "untagged") => void;
  onOpenSkill: (skill: MobileSkill) => void;
  onCreate: () => void;
  onInstallRemote: () => void;
  onCheckUpdates: () => void;
  onUpdateAll: (skillIds: string[]) => void;
  checkingUpdates: boolean;
  busy: boolean;
}

export function SkillsScreen({
  snapshot,
  query,
  filter,
  onQueryChange,
  onFilterChange,
  onOpenSkill,
  onCreate,
  onInstallRemote,
  onCheckUpdates,
  onUpdateAll,
  checkingUpdates,
  busy,
}: SkillsScreenProps) {
  const skills = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return snapshot.skills.filter((skill) => {
      if (filter === "untagged" && skill.tags.length > 0) return false;
      if (!normalized) return true;
      return [skill.name, skill.description, skill.path, ...skill.tags]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("zh-CN").includes(normalized));
    });
  }, [filter, query, snapshot.skills]);
  const updateIds = snapshot.skills
    .filter((skill) => skill.updateStatus === "update_available")
    .map((skill) => skill.id);

  return (
    <div className="mobile-screen mobile-library-screen">
      <AppBar title="Skills" subtitle={`${snapshot.skills.length} 个技能`} />
      <div className="mobile-search-wrap">
        <Search size={20} />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索名称、说明或标签"
          aria-label="搜索 Skills"
        />
      </div>
      <div className="mobile-filter-row" role="group" aria-label="Skill 筛选">
        <button
          type="button"
          className={cn("mobile-chip", filter === "all" && "mobile-chip-selected")}
          onClick={() => onFilterChange("all")}
        >
          全部
        </button>
        <button
          type="button"
          className={cn("mobile-chip", filter === "untagged" && "mobile-chip-selected")}
          onClick={() => onFilterChange("untagged")}
        >
          未加标签
        </button>
      </div>
      <div className="mobile-library-actions">
        <button
          className="mobile-button mobile-button-outlined"
          type="button"
          disabled={busy || checkingUpdates}
          onClick={onInstallRemote}
        >
          <Github size={18} />
          从 GitHub 安装
        </button>
        <button
          className="mobile-button mobile-button-text"
          type="button"
          disabled={busy || checkingUpdates}
          onClick={onCheckUpdates}
        >
          {checkingUpdates ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          {checkingUpdates ? "正在检查…" : "检查更新"}
        </button>
        {updateIds.length > 0 ? (
          <button
            className="mobile-button mobile-button-filled"
            type="button"
            disabled={busy || checkingUpdates}
            onClick={() => onUpdateAll(updateIds)}
          >
            更新 {updateIds.length} 个
          </button>
        ) : null}
      </div>
      <div className="mobile-list-region">
        {skills.length ? (
          <div className="mobile-skill-list">
            {skills.map((skill) => (
              <button
                type="button"
                className="mobile-skill-row"
                key={skill.id}
                onClick={() => onOpenSkill(skill)}
              >
                <span className="mobile-skill-icon">
                  <FileCode2 size={21} />
                </span>
                <span className="mobile-row-copy">
                  <span className="mobile-row-title">{skill.name}</span>
                  {skill.updateStatus === "update_available" ? (
                    <span className="mobile-update-badge">上游有更新</span>
                  ) : skill.updateStatus === "error" ? (
                    <span className="mobile-update-badge mobile-update-error">检查失败</span>
                  ) : null}
                  <span className="mobile-row-description">
                    {skill.description || "暂无说明"}
                  </span>
                  {skill.tags.length ? (
                    <span className="mobile-row-tags">
                      {skill.tags.slice(0, 3).map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </span>
                  ) : null}
                </span>
                <ChevronRight className="mobile-row-chevron" size={20} />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Search size={26} />}
            title="没有匹配的 Skill"
            body={query || filter !== "all" ? "换个关键词或清除筛选条件。" : "从右下角创建一个新的 SKILL.md。"}
            action={
              query || filter !== "all" ? (
                <button
                  className="mobile-button mobile-button-outlined"
                  type="button"
                  onClick={() => {
                    onQueryChange("");
                    onFilterChange("all");
                  }}
                >
                  清除筛选
                </button>
              ) : null
            }
          />
        )}
      </div>
      <button className="mobile-fab" type="button" disabled={busy} onClick={onCreate}>
        <Plus size={22} />
        新建
      </button>
    </div>
  );
}

interface SkillDetailProps {
  skill: MobileSkill;
  presets: MobilePreset[];
  busy: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUpdate: () => void;
  onTogglePreset: (presetId: string, included: boolean) => void;
}

export function SkillDetail({
  skill,
  presets,
  busy,
  onBack,
  onEdit,
  onDelete,
  onUpdate,
  onTogglePreset,
}: SkillDetailProps) {
  return (
    <div className="mobile-screen">
      <AppBar
        title={skill.name}
        subtitle={skill.path}
        leading={
          <button className="mobile-icon-button" type="button" aria-label="返回" onClick={onBack}>
            <ArrowLeft size={23} />
          </button>
        }
        action={
          <button className="mobile-icon-button" type="button" aria-label="编辑 Skill" onClick={onEdit}>
            <Pencil size={21} />
          </button>
        }
      />
      <div className="mobile-content mobile-detail-content">
        <section className="mobile-detail-summary">
          <p>{skill.description || "暂无说明"}</p>
          <div className="mobile-meta-chips">
            <span>
              <GitBranch size={15} />
              {skill.source.type}
            </span>
            <span>{skill.content.split(/\s+/).length} 词</span>
            {skill.source.type === "git" ? (
              <span>
                {skill.updateStatus === "update_available"
                  ? "上游有更新"
                  : skill.updateStatus === "error"
                    ? "检查失败"
                    : skill.updateStatus === "up_to_date"
                      ? "已是最新"
                      : "待检查"}
              </span>
            ) : null}
          </div>
          {skill.tags.length ? (
            <div className="mobile-tag-list">
              {skill.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          ) : null}
          {skill.updateStatus === "update_available" ? (
            <button
              className="mobile-button mobile-button-filled mobile-detail-update"
              type="button"
              disabled={busy}
              onClick={onUpdate}
            >
              <RefreshCw size={18} />
              用上游版本更新
            </button>
          ) : null}
        </section>

        <section className="mobile-section">
          <div className="mobile-section-heading">
            <h2>所属 Preset</h2>
            <span>{skill.presetIds.length} 个</span>
          </div>
          {presets.length ? (
            <div className="mobile-choice-list">
              {presets.map((preset) => {
                const Icon = getPresetIconOption(preset).icon;
                const checked = preset.id ? skill.presetIds.includes(preset.id) : false;
                return (
                  <label className="mobile-choice-row" key={preset.id}>
                    <span className={cn("mobile-choice-icon", getPresetIconOption(preset).colorClass)}>
                      <Icon size={19} />
                    </span>
                    <span className="mobile-row-copy">
                      <span className="mobile-row-title">{preset.name}</span>
                      <span className="mobile-row-description">
                        {preset.skillIds.length} 个 Skills
                      </span>
                    </span>
                    <input
                      className="mobile-switch"
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={(event) => onTogglePreset(preset.id, event.target.checked)}
                    />
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="mobile-muted-copy">还没有 Preset。先在 Presets 页创建分组。</p>
          )}
        </section>

        <section className="mobile-markdown-card">
          <div className="mobile-section-heading">
            <h2>SKILL.md</h2>
            <FileCode2 size={19} />
          </div>
          <article className="mobile-markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children, ...props }) => (
                  <a
                    href={href && !/^(javascript|vbscript|data):/i.test(href) ? href : undefined}
                    target="_blank"
                    rel="noreferrer"
                    {...props}
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {skill.content}
            </ReactMarkdown>
          </article>
        </section>

        <button className="mobile-danger-row" type="button" disabled={busy} onClick={onDelete}>
          <Trash2 size={20} />
          删除 Skill
        </button>
      </div>
    </div>
  );
}

interface PresetsScreenProps {
  snapshot: RepoSnapshot;
  onOpenPreset: (preset: MobilePreset) => void;
  onCreate: () => void;
}

export function PresetsScreen({ snapshot, onOpenPreset, onCreate }: PresetsScreenProps) {
  return (
    <div className="mobile-screen mobile-library-screen">
      <AppBar title="Presets" subtitle={`${snapshot.presets.length} 个技能分组`} />
      <div className="mobile-list-region mobile-preset-region">
        {snapshot.presets.length ? (
          <div className="mobile-preset-list">
            {snapshot.presets.map((preset) => {
              const option = getPresetIconOption(preset);
              const Icon = option.icon;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className="mobile-preset-row"
                  onClick={() => onOpenPreset(preset)}
                >
                  <span className={cn("mobile-preset-icon", option.colorClass, option.activeClass)}>
                    <Icon size={24} />
                  </span>
                  <span className="mobile-row-copy">
                    <span className="mobile-row-title">{preset.name}</span>
                    <span className="mobile-row-description">
                      {preset.description || "暂无说明"}
                    </span>
                    <span className="mobile-preset-count">{preset.skillIds.length} 个 Skills</span>
                  </span>
                  <ChevronRight className="mobile-row-chevron" size={20} />
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<Sparkles size={27} />}
            title="还没有 Preset"
            body="按任务把 Skills 分组，桌面端会直接读取这些归属关系。"
            action={
              <button className="mobile-button mobile-button-filled" type="button" onClick={onCreate}>
                <Plus size={18} />
                新建 Preset
              </button>
            }
          />
        )}
      </div>
      <button className="mobile-fab" type="button" onClick={onCreate}>
        <Plus size={22} />
        新建
      </button>
    </div>
  );
}

interface PresetDetailProps {
  preset: MobilePreset;
  snapshot: RepoSnapshot;
  busy: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMovePreset: (direction: -1 | 1) => void;
  onToggleSkill: (skillId: string, included: boolean) => void;
  onMoveSkill: (skillId: string, direction: -1 | 1) => void;
}

export function PresetDetail({
  preset,
  snapshot,
  busy,
  onBack,
  onEdit,
  onDelete,
  onMovePreset,
  onToggleSkill,
  onMoveSkill,
}: PresetDetailProps) {
  const option = getPresetIconOption(preset);
  const Icon = option.icon;
  const index = snapshot.presets.findIndex((item) => item.id === preset.id);
  const members = preset.skillIds
    .map((id) => snapshot.skills.find((skill) => skill.id === id))
    .filter((skill): skill is MobileSkill => Boolean(skill));

  return (
    <div className="mobile-screen">
      <AppBar
        title={preset.name}
        subtitle={`${members.length} 个 Skills`}
        leading={
          <button className="mobile-icon-button" type="button" aria-label="返回" onClick={onBack}>
            <ArrowLeft size={23} />
          </button>
        }
        action={
          <span aria-hidden="true" />
        }
      />
      <div className="mobile-content mobile-detail-content">
        <section className="mobile-preset-hero">
          <span className={cn("mobile-preset-icon mobile-preset-icon-large", option.colorClass, option.activeClass)}>
            <Icon size={30} />
          </span>
          <div>
            <p>{preset.description || "暂无说明"}</p>
            <div className="mobile-preset-toolbar">
              <button type="button" onClick={onEdit}>
                <Pencil size={17} />
                编辑
              </button>
              <button type="button" disabled={busy || index <= 0} onClick={() => onMovePreset(-1)}>
                <ArrowUp size={17} />
                前移
              </button>
              <button
                type="button"
                disabled={busy || index >= snapshot.presets.length - 1}
                onClick={() => onMovePreset(1)}
              >
                <ArrowDown size={17} />
                后移
              </button>
            </div>
          </div>
        </section>

        <section className="mobile-section">
          <div className="mobile-section-heading">
            <h2>分配 Skills</h2>
            <span>{members.length}/{snapshot.skills.length}</span>
          </div>
          <div className="mobile-choice-list">
            {snapshot.skills.map((skill) => {
              const included = preset.skillIds.includes(skill.id);
              const memberIndex = preset.skillIds.indexOf(skill.id);
              return (
                <div className="mobile-assignment-row" key={skill.id}>
                  <label className="mobile-choice-row mobile-assignment-main">
                    <span className="mobile-skill-icon">
                      <Layers3 size={19} />
                    </span>
                    <span className="mobile-row-copy">
                      <span className="mobile-row-title">{skill.name}</span>
                      <span className="mobile-row-description">
                        {skill.description || skill.path}
                      </span>
                    </span>
                    <input
                      className="mobile-switch"
                      type="checkbox"
                      checked={included}
                      disabled={busy}
                      onChange={(event) => onToggleSkill(skill.id, event.target.checked)}
                    />
                  </label>
                  {included ? (
                    <div className="mobile-order-buttons">
                      <button
                        type="button"
                        aria-label={`向前移动 ${skill.name}`}
                        disabled={busy || memberIndex <= 0}
                        onClick={() => onMoveSkill(skill.id, -1)}
                      >
                        <ArrowUp size={17} />
                        上移
                      </button>
                      <button
                        type="button"
                        aria-label={`向后移动 ${skill.name}`}
                        disabled={busy || memberIndex >= members.length - 1}
                        onClick={() => onMoveSkill(skill.id, 1)}
                      >
                        <ArrowDown size={17} />
                        下移
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <button className="mobile-danger-row" type="button" disabled={busy} onClick={onDelete}>
          <Trash2 size={20} />
          删除 Preset
        </button>
      </div>
    </div>
  );
}

export type MobileTheme = "system" | "light" | "dark";

interface SettingsScreenProps {
  snapshot: RepoSnapshot;
  theme: MobileTheme;
  syncing: boolean;
  busy: boolean;
  onSync: () => void;
  onThemeChange: (theme: MobileTheme) => void;
  onDisconnect: () => void;
}

export function SettingsScreen({
  snapshot,
  theme,
  syncing,
  busy,
  onSync,
  onThemeChange,
  onDisconnect,
}: SettingsScreenProps) {
  return (
    <div className="mobile-screen">
      <AppBar title="设置" subtitle="仓库、外观与本机数据" />
      <div className="mobile-content">
        <section className="mobile-section">
          <div className="mobile-section-heading">
            <h2>仓库连接</h2>
          </div>
          <div className="mobile-settings-card">
            <div className="mobile-settings-row">
              <span>
                <GitBranch size={20} />
                仓库
              </span>
              <strong>
                {snapshot.owner}/{snapshot.repo}
              </strong>
            </div>
            <div className="mobile-settings-row">
              <span>
                <Layers3 size={20} />
                分支
              </span>
              <strong>{snapshot.branch}</strong>
            </div>
            <div className="mobile-settings-row">
              <span>
                <GitCommitHorizontal size={20} />
                本地 HEAD
              </span>
              <strong>{snapshot.sync.localHead?.slice(0, 7) || "—"}</strong>
            </div>
            <div className="mobile-settings-row">
              <span>
                <RefreshCw size={20} />
                最近同步
              </span>
              <strong>
                {snapshot.sync.lastSyncedAt
                  ? formatRelativeTime(snapshot.sync.lastSyncedAt)
                  : "尚未同步"}
              </strong>
            </div>
          </div>
          <button
            className="mobile-button mobile-button-outlined mobile-settings-action"
            type="button"
            disabled={syncing}
            onClick={onSync}
          >
            {syncing ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
            立即同步
          </button>
        </section>

        <section className="mobile-section">
          <div className="mobile-section-heading">
            <h2>外观</h2>
          </div>
          <div className="mobile-theme-control" role="group" aria-label="外观主题">
            {(["system", "light", "dark"] as const).map((value) => (
              <button
                type="button"
                key={value}
                className={cn(theme === value && "mobile-theme-selected")}
                onClick={() => onThemeChange(value)}
              >
                {theme === value ? <Check size={16} /> : null}
                {value === "system" ? "跟随系统" : value === "light" ? "浅色" : "深色"}
              </button>
            ))}
          </div>
        </section>

        <section className="mobile-section">
          <div className="mobile-section-heading">
            <h2>本机数据</h2>
          </div>
          <p className="mobile-muted-copy">
            本地 Git 副本保存在应用私有存储中。断开连接不会删除已经推送的远端内容。
          </p>
          <button
            className="mobile-danger-row"
            type="button"
            disabled={busy}
            onClick={onDisconnect}
          >
            <CloudOff size={20} />
            断开当前仓库
          </button>
        </section>

        <footer className="mobile-settings-footer">
          <img src="/icons/32x32.png" alt="" />
          <div>
            <strong>Skills Manager Android</strong>
            <span>远程仓库管理模式 · v{__APP_VERSION__}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
