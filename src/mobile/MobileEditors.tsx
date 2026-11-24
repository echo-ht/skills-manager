import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, Loader2, X } from "lucide-react";
import { cn } from "../utils";
import { PRESET_ICON_OPTIONS, getPresetIconOption } from "../lib/presetIcons";
import type { MobilePreset, MobileSkill, PresetDraft, SkillDraft } from "./model";

interface SheetProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  fullScreen?: boolean;
  closeDisabled?: boolean;
}

export function MobileSheet({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  fullScreen = false,
  closeDisabled = false,
}: SheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className={cn("mobile-sheet", fullScreen && "mobile-sheet-full")}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
    >
      <div className="mobile-sheet-surface">
        <header className="mobile-sheet-header">
          <div className="mobile-sheet-heading">
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button
            className="mobile-icon-button"
            type="button"
            disabled={closeDisabled}
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={22} />
          </button>
        </header>
        <div className="mobile-sheet-body">{children}</div>
        <footer className="mobile-sheet-footer">{footer}</footer>
      </div>
    </dialog>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function MobileConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "确认",
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="mobile-confirm"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="mobile-confirm-surface">
        <h2 id={titleId}>{title}</h2>
        <p>{message}</p>
        <div className="mobile-confirm-actions">
          <button className="mobile-button mobile-button-text" type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className={cn("mobile-button", destructive ? "mobile-button-danger" : "mobile-button-filled")}
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? <Loader2 className="spin" size={18} /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

interface SkillEditorProps {
  open: boolean;
  skill: MobileSkill | null;
  busy: boolean;
  onSave: (draft: SkillDraft) => void;
  onClose: () => void;
}

export function SkillEditor({ open, skill, busy, onSave, onClose }: SkillEditorProps) {
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [tags, setTags] = useState(skill?.tags.join(", ") ?? "");
  const [content, setContent] = useState(skill?.content ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) {
      setError("Skill 名称不能为空");
      return;
    }
    onSave({
      id: skill?.id,
      name: name.trim(),
      description: description.trim(),
      tags: tags
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      content,
    });
  };

  return (
    <MobileSheet
      open={open}
      title={skill ? "编辑 Skill" : "新建 Skill"}
      description="保存后会自动创建 Git commit，并尝试 push 到远端。"
      fullScreen
      closeDisabled={busy}
      onClose={onClose}
      footer={
        <>
          <button className="mobile-button mobile-button-text" type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="mobile-button mobile-button-filled" type="button" disabled={busy} onClick={submit}>
            {busy ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
            保存并同步
          </button>
        </>
      }
    >
      <div className="mobile-form">
        <label className="mobile-field">
          <span>名称</span>
          <input
            value={name}
            maxLength={120}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            placeholder="例如：release-check"
            autoFocus={!skill}
          />
          {error ? <small className="mobile-field-error">{error}</small> : null}
        </label>
        <label className="mobile-field">
          <span>一句话说明</span>
          <textarea
            value={description}
            maxLength={400}
            rows={3}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="说明什么时候应该使用这个 Skill"
          />
        </label>
        <label className="mobile-field">
          <span>标签</span>
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="用逗号分隔，例如：review, mobile"
          />
        </label>
        <label className="mobile-field mobile-field-grow">
          <span>SKILL.md 正文</span>
          <textarea
            className="mobile-code-editor"
            value={content}
            rows={18}
            onChange={(event) => setContent(event.target.value)}
            placeholder={"# Workflow\n\n1. ...\n2. ..."}
            spellCheck={false}
          />
        </label>
      </div>
    </MobileSheet>
  );
}

interface PresetEditorProps {
  open: boolean;
  preset: MobilePreset | null;
  busy: boolean;
  onSave: (draft: PresetDraft) => void;
  onClose: () => void;
}

export function PresetEditor({ open, preset, busy, onSave, onClose }: PresetEditorProps) {
  const [name, setName] = useState(preset?.name ?? "");
  const [description, setDescription] = useState(preset?.description ?? "");
  const [icon, setIcon] = useState(() => getPresetIconOption(preset ?? null).key);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) {
      setError("Preset 名称不能为空");
      return;
    }
    onSave({ id: preset?.id, name: name.trim(), description: description.trim(), icon });
  };

  return (
    <MobileSheet
      open={open}
      title={preset ? "编辑 Preset" : "新建 Preset"}
      description="Preset 是仓库里的技能分组；Android 不会把它应用到本地 Agent。"
      fullScreen
      closeDisabled={busy}
      onClose={onClose}
      footer={
        <>
          <button className="mobile-button mobile-button-text" type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="mobile-button mobile-button-filled" type="button" disabled={busy} onClick={submit}>
            {busy ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
            保存并同步
          </button>
        </>
      }
    >
      <div className="mobile-form">
        <label className="mobile-field">
          <span>名称</span>
          <input
            value={name}
            maxLength={80}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            placeholder="例如：发布检查"
            autoFocus={!preset}
          />
          {error ? <small className="mobile-field-error">{error}</small> : null}
        </label>
        <label className="mobile-field">
          <span>说明</span>
          <textarea
            value={description}
            maxLength={300}
            rows={3}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="这个分组适合什么任务？"
          />
        </label>
        <fieldset className="mobile-field">
          <legend>图标</legend>
          <div className="mobile-icon-grid">
            {PRESET_ICON_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = option.key === icon;
              return (
                <button
                  key={option.key}
                  className={cn(
                    "mobile-icon-choice",
                    option.colorClass,
                    selected && `${option.activeClass} mobile-icon-choice-selected`
                  )}
                  type="button"
                  aria-label={option.label}
                  aria-pressed={selected}
                  onClick={() => setIcon(option.key)}
                >
                  <Icon size={21} />
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>
    </MobileSheet>
  );
}
