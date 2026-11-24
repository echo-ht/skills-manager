import { useEffect, useMemo, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import {
  CheckCircle2,
  CircleAlert,
  HardDrive,
  Layers3,
  Loader2,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "../utils";
import { AndroidGitRepository, isNativeAndroid } from "./GitRepository";
import { DemoRepository } from "./DemoRepository";
import {
  ConnectScreen,
  HomeScreen,
  PresetDetail,
  PresetsScreen,
  RepoLoadingScreen,
  SettingsScreen,
  SkillDetail,
  SkillsScreen,
  type MobileTheme,
} from "./MobileScreens";
import { MobileConfirmDialog, PresetEditor, SkillEditor } from "./MobileEditors";
import {
  friendlyGitError,
  type MobilePreset,
  type MobileRepository,
  type MobileSkill,
  type PresetDraft,
  type RepoSnapshot,
  type SkillDraft,
} from "./model";
import {
  clearConnection,
  clearToken,
  loadConnection,
  loadToken,
  saveConnection,
  saveToken,
} from "./session";
import "./mobile.css";

type MainTab = "home" | "skills" | "presets" | "settings";
type Route =
  | { kind: "tab"; tab: MainTab }
  | { kind: "skill"; id: string; from: MainTab }
  | { kind: "preset"; id: string; from: MainTab };

type SheetState =
  | { kind: "skill"; skill: MobileSkill | null }
  | { kind: "preset"; preset: MobilePreset | null }
  | { kind: "delete-skill"; skill: MobileSkill }
  | { kind: "delete-preset"; preset: MobilePreset }
  | { kind: "disconnect" };

interface Notice {
  message: string;
  tone: "success" | "warning" | "error";
}

const THEME_KEY = "skills-manager.mobile.theme";

function readTheme(): MobileTheme {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function routeTab(route: Route): MainTab {
  return route.kind === "tab" ? route.tab : route.from;
}

function messageFor(error: unknown): string {
  const friendly = friendlyGitError(error);
  return friendly.message;
}

function previewMode(): boolean {
  return new URLSearchParams(window.location.search).has("mobilePreview");
}

export function MobileApp() {
  const preview = previewMode();
  const [repo, setRepo] = useState<MobileRepository | null>(null);
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootMessage, setBootMessage] = useState("正在打开本地仓库…");
  const [bootError, setBootError] = useState<string | null>(null);
  const [initialRemote, setInitialRemote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [route, setRoute] = useState<Route>({ kind: "tab", tab: "home" });
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [theme, setTheme] = useState<MobileTheme>(readTheme);
  const noticeTimer = useRef<number | null>(null);
  const routeRef = useRef(route);
  const sheetRef = useRef(sheet);
  const busyRef = useRef(busy);

  routeRef.current = route;
  sheetRef.current = sheet;
  busyRef.current = busy;

  const showNotice = (message: string, tone: Notice["tone"]) => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice({ message, tone });
    noticeTimer.current = window.setTimeout(() => setNotice(null), 5200);
  };

  const openRepository = async (
    nextRepo: MobileRepository,
    options: { persist: boolean; token?: string }
  ) => {
    setBootMessage(options.persist ? "正在连接本地仓库…" : "正在克隆到手机本地…");
    const initial = await nextRepo.snapshot();
    setRepo(nextRepo);
    setSnapshot(initial);
    setRoute({ kind: "tab", tab: "home" });
    setBootError(null);

    if (options.persist) {
      saveConnection(nextRepo.connection);
      if (options.token) {
        await saveToken(nextRepo.connection.remoteUrl, options.token).catch(() => {
          showNotice("仓库已连接，但令牌没有写入安全存储；下次打开时需要重新输入。", "warning");
        });
      }
    }

    try {
      setSyncing(true);
      const result = await nextRepo.sync();
      setSnapshot(result.snapshot);
      if (result.notice) showNotice(result.notice, "warning");
    } catch (error) {
      const friendly = friendlyGitError(error);
      showNotice(friendly.message, friendly.code === "CONFLICT" ? "warning" : "error");
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      void navigator.storage?.persist?.().catch(() => undefined);
      if (preview) {
        const demo = new DemoRepository();
        const demoSnapshot = await demo.snapshot();
        if (cancelled) return;
        setRepo(demo);
        setSnapshot(demoSnapshot);
        setBooting(false);
        return;
      }

      const saved = loadConnection();
      setInitialRemote(saved?.remoteUrl ?? "");
      if (!saved) {
        setBooting(false);
        return;
      }
      const token = await loadToken(saved.remoteUrl);
      if (!token) {
        setBootError("安全存储中没有这个仓库的令牌，请重新输入。");
        setBooting(false);
        return;
      }
      try {
        const opened = await AndroidGitRepository.connect(saved.remoteUrl, token, setBootMessage);
        if (cancelled) return;
        await openRepository(opened, { persist: false });
      } catch (error) {
        if (!cancelled) {
          setBootError(messageFor(error));
          setBooting(false);
        }
      }
    }
    boot();
    return () => {
      cancelled = true;
    };
    // The boot sequence reads storage once and owns the initial connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  useEffect(() => {
    if (snapshot) setBooting(false);
  }, [snapshot]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.dataset.mobileTheme = theme;
    if (isNativeAndroid()) {
      void SystemBars.setStyle({
        style:
          theme === "dark"
            ? SystemBarsStyle.Dark
            : theme === "light"
              ? SystemBarsStyle.Light
              : SystemBarsStyle.Default,
      }).catch(() => undefined);
    }
    return () => {
      delete document.documentElement.dataset.mobileTheme;
    };
  }, [theme]);

  useEffect(() => {
    document.body.classList.add("mobile-body");
    document.documentElement.style.colorScheme =
      theme === "system" ? "light dark" : theme;
    return () => document.body.classList.remove("mobile-body");
  }, [theme]);

  useEffect(() => {
    if (!isNativeAndroid()) return;
    let disposed = false;
    let removeListener: (() => void) | undefined;
    CapacitorApp.addListener("backButton", () => {
      if (busyRef.current) return;
      if (sheetRef.current) {
        setSheet(null);
        return;
      }
      if (routeRef.current.kind !== "tab") {
        const current = routeRef.current;
        setRoute({ kind: "tab", tab: current.from });
        return;
      }
      CapacitorApp.exitApp();
    }).then((listener) => {
      if (disposed) listener.remove();
      else removeListener = () => listener.remove();
    });
    return () => {
      disposed = true;
      removeListener?.();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  const activeSkill = useMemo(
    () =>
      route.kind === "skill"
        ? snapshot?.skills.find((skill) => skill.id === route.id) ?? null
        : null,
    [route, snapshot]
  );
  const activePreset = useMemo(
    () =>
      route.kind === "preset"
        ? snapshot?.presets.find((preset) => preset.id === route.id) ?? null
        : null,
    [route, snapshot]
  );

  useEffect(() => {
    if (!snapshot) return;
    if (route.kind === "skill" && !snapshot.skills.some((skill) => skill.id === route.id)) {
      setRoute({ kind: "tab", tab: route.from });
    }
    if (route.kind === "preset" && !snapshot.presets.some((preset) => preset.id === route.id)) {
      setRoute({ kind: "tab", tab: route.from });
    }
  }, [route, snapshot]);

  const connect = async (remote: string, token: string) => {
    setBusy("connect");
    setBootError(null);
    setBootMessage("正在读取远端仓库…");
    try {
      const opened = await AndroidGitRepository.connect(remote, token, setBootMessage);
      await openRepository(opened, { persist: true, token });
    } catch (error) {
      setBootError(messageFor(error));
    } finally {
      setBusy(null);
    }
  };

  const applyMutation = async (
    action: () => Promise<{ snapshot: RepoSnapshot; pushed: boolean; notice: string | null }>,
    successMessage: string,
    done?: () => void
  ) => {
    if (busy) return;
    setBusy("mutation");
    try {
      const result = await action();
      setSnapshot(result.snapshot);
      done?.();
      showNotice(result.notice || successMessage, result.notice ? "warning" : "success");
    } catch (error) {
      showNotice(messageFor(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const syncNow = async () => {
    if (!repo || syncing || busy) return;
    setSyncing(true);
    try {
      const result = await repo.sync();
      setSnapshot(result.snapshot);
      showNotice(result.notice || "仓库已同步", result.notice ? "warning" : "success");
    } catch (error) {
      showNotice(messageFor(error), "error");
    } finally {
      setSyncing(false);
    }
  };

  const saveSkill = (draft: SkillDraft) => {
    if (!repo) return;
    void applyMutation(
      () => repo.saveSkill(draft),
      draft.id ? "Skill 已更新并提交" : "Skill 已创建并提交",
      () => setSheet(null)
    );
  };

  const savePreset = (draft: PresetDraft) => {
    if (!repo) return;
    void applyMutation(
      () => repo.savePreset(draft),
      draft.id ? "Preset 已更新并提交" : "Preset 已创建并提交",
      () => setSheet(null)
    );
  };

  const disconnect = async () => {
    if (!repo) return;
    setBusy("disconnect");
    const remoteUrl = repo.connection.remoteUrl;
    await clearToken(remoteUrl);
    clearConnection();
    setSheet(null);
    setRepo(null);
    setSnapshot(null);
    setBooting(false);
    setInitialRemote(remoteUrl);
    setBusy(null);
    showNotice("已断开远程仓库。本地 Git 副本仍保留在应用私有存储中。", "success");
  };

  if (booting && !snapshot) {
    return <RepoLoadingScreen message={bootMessage} />;
  }

  if (!repo || !snapshot) {
    return (
      <ConnectScreen
        initialRemote={initialRemote}
        busy={busy === "connect"}
        progress={bootMessage}
        error={bootError}
        onConnect={connect}
      />
    );
  }

  const activeTab = routeTab(route);
  const tabs = [
    { key: "home" as const, label: "仓库", icon: HardDrive },
    { key: "skills" as const, label: "Skills", icon: Layers3 },
    { key: "presets" as const, label: "Presets", icon: Sparkles },
    { key: "settings" as const, label: "设置", icon: Settings },
  ];

  return (
    <div className="mobile-shell">
      <div className="mobile-stage">
        {activeSkill ? (
          <SkillDetail
            skill={activeSkill}
            presets={snapshot.presets}
            busy={Boolean(busy)}
            onBack={() => setRoute({ kind: "tab", tab: routeTab(route) })}
            onEdit={() => setSheet({ kind: "skill", skill: activeSkill })}
            onDelete={() => setSheet({ kind: "delete-skill", skill: activeSkill })}
            onTogglePreset={(presetId, included) => {
              void applyMutation(
                () => repo.setPresetSkill(presetId, activeSkill.id, included),
                included ? "已加入 Preset" : "已从 Preset 移除"
              );
            }}
          />
        ) : activePreset ? (
          <PresetDetail
            preset={activePreset}
            snapshot={snapshot}
            busy={Boolean(busy)}
            onBack={() => setRoute({ kind: "tab", tab: routeTab(route) })}
            onEdit={() => setSheet({ kind: "preset", preset: activePreset })}
            onDelete={() => setSheet({ kind: "delete-preset", preset: activePreset })}
            onMovePreset={(direction) => {
              void applyMutation(
                () => repo.reorderPreset(activePreset.id, direction),
                "Preset 顺序已更新"
              );
            }}
            onToggleSkill={(skillId, included) => {
              void applyMutation(
                () => repo.setPresetSkill(activePreset.id, skillId, included),
                included ? "Skill 已加入 Preset" : "Skill 已从 Preset 移除"
              );
            }}
            onMoveSkill={(skillId, direction) => {
              void applyMutation(
                () => repo.reorderPresetSkill(activePreset.id, skillId, direction),
                "Skill 顺序已更新"
              );
            }}
          />
        ) : activeTab === "skills" ? (
          <SkillsScreen
            snapshot={snapshot}
            onCreate={() => setSheet({ kind: "skill", skill: null })}
            onOpenSkill={(skill) => setRoute({ kind: "skill", id: skill.id, from: "skills" })}
          />
        ) : activeTab === "presets" ? (
          <PresetsScreen
            snapshot={snapshot}
            onCreate={() => setSheet({ kind: "preset", preset: null })}
            onOpenPreset={(preset) =>
              setRoute({ kind: "preset", id: preset.id, from: "presets" })
            }
          />
        ) : activeTab === "settings" ? (
          <SettingsScreen
            snapshot={snapshot}
            theme={theme}
            syncing={syncing || busy === "mutation"}
            busy={Boolean(busy)}
            onSync={() => void syncNow()}
            onThemeChange={setTheme}
            onDisconnect={() => setSheet({ kind: "disconnect" })}
          />
        ) : (
          <HomeScreen
            snapshot={snapshot}
            syncing={syncing || busy === "mutation"}
            onSync={() => void syncNow()}
            onOpenSkills={() => setRoute({ kind: "tab", tab: "skills" })}
            onOpenPresets={() => setRoute({ kind: "tab", tab: "presets" })}
          />
        )}
      </div>

      {route.kind === "tab" ? (
        <nav className="mobile-nav" aria-label="主导航">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = route.kind === "tab" && route.tab === tab.key;
            return (
              <button
                type="button"
                key={tab.key}
                className={cn(selected && "mobile-nav-selected")}
                aria-current={selected ? "page" : undefined}
                onClick={() => setRoute({ kind: "tab", tab: tab.key })}
              >
                <span>
                  <Icon size={23} />
                </span>
                {tab.label}
              </button>
            );
          })}
        </nav>
      ) : null}

      {busy === "mutation" ? (
        <div className="mobile-working" role="status" aria-live="polite">
          <Loader2 className="spin" size={17} />
          正在提交到本地 Git…
        </div>
      ) : null}

      {notice ? (
        <div className={cn("mobile-snackbar", `mobile-snackbar-${notice.tone}`)} role="status" aria-live="polite">
          {notice.tone === "success" ? <CheckCircle2 size={20} /> : <CircleAlert size={20} />}
          <p>{notice.message}</p>
          <button type="button" aria-label="关闭提示" onClick={() => setNotice(null)}>
            <X size={19} />
          </button>
        </div>
      ) : null}

      <SkillEditor
        key={sheet?.kind === "skill" ? sheet.skill?.id ?? "new" : "closed"}
        open={sheet?.kind === "skill"}
        skill={sheet?.kind === "skill" ? sheet.skill : null}
        busy={busy === "mutation"}
        onSave={saveSkill}
        onClose={() => setSheet(null)}
      />
      <PresetEditor
        key={sheet?.kind === "preset" ? sheet.preset?.id ?? "new" : "closed"}
        open={sheet?.kind === "preset"}
        preset={sheet?.kind === "preset" ? sheet.preset : null}
        busy={busy === "mutation"}
        onSave={savePreset}
        onClose={() => setSheet(null)}
      />
      <MobileConfirmDialog
        open={sheet?.kind === "delete-skill"}
        title="删除 Skill？"
        message={
          sheet?.kind === "delete-skill"
            ? `会从仓库删除 “${sheet.skill.name}” 的整个目录，并创建一条可恢复的 Git 提交。`
            : ""
        }
        confirmLabel="删除并同步"
        destructive
        busy={busy === "mutation"}
        onClose={() => setSheet(null)}
        onConfirm={() => {
          if (!repo || sheet?.kind !== "delete-skill") return;
          const skill = sheet.skill;
          void applyMutation(
            () => repo.deleteSkill(skill.id),
            "Skill 已删除并提交",
            () => {
              setSheet(null);
              setRoute({ kind: "tab", tab: "skills" });
            }
          );
        }}
      />
      <MobileConfirmDialog
        open={sheet?.kind === "delete-preset"}
        title="删除 Preset？"
        message={
          sheet?.kind === "delete-preset"
            ? `会删除 “${sheet.preset.name}” 及其分配关系，但不会删除任何 Skill。`
            : ""
        }
        confirmLabel="删除并同步"
        destructive
        busy={busy === "mutation"}
        onClose={() => setSheet(null)}
        onConfirm={() => {
          if (!repo || sheet?.kind !== "delete-preset") return;
          const preset = sheet.preset;
          void applyMutation(
            () => repo.deletePreset(preset.id),
            "Preset 已删除并提交",
            () => {
              setSheet(null);
              setRoute({ kind: "tab", tab: "presets" });
            }
          );
        }}
      />
      <MobileConfirmDialog
        open={sheet?.kind === "disconnect"}
        title="断开当前仓库？"
        message="会从设备安全存储中删除 token，并停止自动同步。应用私有存储中的本地 Git 副本会保留。"
        confirmLabel="断开连接"
        busy={busy === "disconnect"}
        onClose={() => setSheet(null)}
        onConfirm={() => void disconnect()}
      />
    </div>
  );
}
