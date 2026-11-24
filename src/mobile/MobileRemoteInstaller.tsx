import { useState } from "react";
import { Check, Github, Loader2, PackageSearch } from "lucide-react";
import { MobileSheet } from "./MobileEditors";
import type {
  RemoteInstallSession,
  RemoteSkillInstallItem,
  RemoteSkillPreview,
} from "./model";

interface RemoteInstallerProps {
  open: boolean;
  busy: boolean;
  onPreview: (url: string) => Promise<RemoteInstallSession>;
  onInstall: (
    session: RemoteInstallSession,
    items: RemoteSkillInstallItem[]
  ) => Promise<boolean>;
  onCancelPreview: (tempDir: string) => Promise<void>;
  onClose: () => void;
}

export function RemoteInstaller({
  open,
  busy,
  onPreview,
  onInstall,
  onCancelPreview,
  onClose,
}: RemoteInstallerProps) {
  const [url, setUrl] = useState("");
  const [session, setSession] = useState<RemoteInstallSession | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = async () => {
    if (loading || busy) return;
    if (session) await onCancelPreview(session.tempDir);
    onClose();
  };

  const preview = async () => {
    if (!url.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await onPreview(url.trim());
      setSession(result);
      setSelected(new Set(result.skills.map((skill) => skill.relPath)));
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "预览仓库失败");
    } finally {
      setLoading(false);
    }
  };

  const toggle = (skill: RemoteSkillPreview) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(skill.relPath)) next.delete(skill.relPath);
      else next.add(skill.relPath);
      return next;
    });
  };

  const install = async () => {
    if (!session || selected.size === 0 || loading || busy) return;
    const items = session.skills
      .filter((skill) => selected.has(skill.relPath))
      .map((skill) => ({ relPath: skill.relPath, name: skill.name }));
    const installed = await onInstall(session, items);
    if (installed) onClose();
  };

  return (
    <MobileSheet
      open={open}
      title="从 GitHub 安装"
      description="克隆别人的公开仓库或你有权限访问的私有仓库，选择需要的 Skill 安装到当前管理的仓库。"
      fullScreen
      closeDisabled={loading || busy}
      onClose={() => void close()}
      footer={
        session ? (
          <>
            <button
              className="mobile-button mobile-button-text"
              type="button"
              disabled={loading || busy}
              onClick={() => void close()}
            >
              取消
            </button>
            <button
              className="mobile-button mobile-button-filled"
              type="button"
              disabled={loading || busy || selected.size === 0}
              onClick={() => void install()}
            >
              {busy ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
              安装 {selected.size} 个
            </button>
          </>
        ) : (
          <>
            <button
              className="mobile-button mobile-button-text"
              type="button"
              disabled={loading}
              onClick={() => void close()}
            >
              取消
            </button>
            <button
              className="mobile-button mobile-button-filled"
              type="button"
              disabled={loading || !url.trim()}
              onClick={() => void preview()}
            >
              {loading ? <Loader2 className="spin" size={18} /> : <PackageSearch size={18} />}
              {loading ? "正在克隆并扫描…" : "预览仓库"}
            </button>
          </>
        )
      }
    >
      <div className="mobile-form">
        <label className="mobile-field">
          <span>GitHub 仓库或目录地址</span>
          <input
            autoCapitalize="none"
            autoCorrect="off"
            value={url}
            disabled={Boolean(session) || loading || busy}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
            placeholder="https://github.com/owner/repo"
          />
          <small>
            支持仓库根地址、owner/repo，以及 /tree/branch/path 形式的指定技能目录。
          </small>
        </label>

        {error ? (
          <div className="mobile-inline-error" role="alert">
            <PackageSearch size={20} />
            <p>{error}</p>
          </div>
        ) : null}

        {session ? (
          <section className="mobile-remote-preview">
            <div className="mobile-remote-repo">
              <Github size={20} />
              <div>
                <strong>
                  {session.owner}/{session.repo}
                </strong>
                <span>
                  {session.branch}
                  {session.subpath ? ` · ${session.subpath}` : ""}
                </span>
              </div>
            </div>
            <div className="mobile-choice-list">
              {session.skills.map((skill) => {
                const checked = selected.has(skill.relPath);
                return (
                  <label className="mobile-choice-row" key={skill.relPath}>
                    <span className="mobile-skill-icon">
                      <Github size={19} />
                    </span>
                    <span className="mobile-row-copy">
                      <span className="mobile-row-title">{skill.name}</span>
                      <span className="mobile-row-description">
                        {skill.description || skill.relPath}
                      </span>
                    </span>
                    <input
                      className="mobile-switch"
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={() => toggle(skill)}
                    />
                  </label>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </MobileSheet>
  );
}
