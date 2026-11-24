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
import { RemoteInstaller } from "./MobileRemoteInstaller";
import {
  MobileGitError,
  friendlyGitError,
  type MobilePreset,
  type MobileRepository,
  type MobileSkill,
  type PresetDraft,
  type RepoSnapshot,
  type RemoteInstallSession,
  type RemoteSkillInstallItem,
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
  | { kind: "remote-install" }
  | { kind: "update-skills"; skillIds: string[] }
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
  const [busyMessage, setBusyMessage] = useState("正在提交到本地 Git…");
  const [syncing, setSyncing] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [route, setRoute] = useState<Route>({ kind: "tab", tab: "home" });
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [theme, setTheme] = useState<MobileTheme>(readTheme);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillFilter, setSkillFilter] = useState<"all" | "untagged">("all");
  const noticeTimer = useRef<number | null>(null);
  const routeRef = useRef(route);
  const sheetRef = useRef(sheet);
  const busyRef = useRef(busy);
  const operationLockRef = useRef(false);
  const cancelOperationRef = useRef<null | (() => Promise<void>)>(null);
  const tabScrollRef = useRef<Record<MainTab, number>>({
    home: 0,
    skills: 0,
    presets: 0,
    settings: 0,
  });

  routeRef.current = route;
  sheetRef.current = sheet;

  const showNotice = (message: string, tone: Notice["tone"]) => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice({ message, tone });
    noticeTimer.current = window.setTimeout(() => setNotice(null), 5200);
  };

  const beginOperation = () => {
    if (operationLockRef.current) return false;
    operationLockRef.current = true;
    return true;
  };

  const endOperation = () => {
    operationLockRef.current = false;
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
      setSnapshot((current) =>
        current
          ? {
              ...current,
              sync: { ...current.sync, phase: "unknown", message: friendly.message },
            }
          : current
      );
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
      if (!beginOperation()) return;
      busyRef.current = "boot";
      try {
        const opened = await AndroidGitRepository.connect(saved.remoteUrl, token, setBootMessage);
        if (cancelled) return;
        await openRepository(opened, { persist: false });
      } catch (error) {
        if (!cancelled) {
          setBootError(messageFor(error));
          setBooting(false);
        }
      } finally {
        busyRef.current = null;
        endOperation();
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
      if (busyRef.current) {
        if (cancelOperationRef.current) {
          setBusyMessage("正在取消更新…");
          void cancelOperationRef.current();
        }
        return;
      }
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

  useEffect(() => {
    if (route.kind !== "tab") return;
    const frame = window.requestAnimationFrame(() => {
      const container =
        route.tab === "skills" || route.tab === "presets"
          ? document.querySelector<HTMLElement>(".mobile-list-region")
          : document.querySelector<HTMLElement>(".mobile-content");
      if (container) container.scrollTop = tabScrollRef.current[route.tab];
    });
    return () => window.cancelAnimationFrame(frame);
  }, [route]);

  const captureTabScroll = () => {
    const current = routeRef.current;
    if (current.kind !== "tab") return;
    const container =
      current.tab === "skills" || current.tab === "presets"
        ? document.querySelector<HTMLElement>(".mobile-list-region")
        : document.querySelector<HTMLElement>(".mobile-content");
    if (container) tabScrollRef.current[current.tab] = container.scrollTop;
  };

  const goToTab = (tab: MainTab) => {
    captureTabScroll();
    setRoute({ kind: "tab", tab });
  };

  const connect = async (remote: string, token: string) => {
    if (!beginOperation()) return;
    busyRef.current = "connect";
    setBusy("connect");
    setBootError(null);
    setBootMessage("正在读取远端仓库…");
    try {
      const opened = await AndroidGitRepository.connect(remote, token, setBootMessage);
      await openRepository(opened, { persist: true, token });
    } catch (error) {
      setBootError(messageFor(error));
    } finally {
      busyRef.current = null;
      setBusy(null);
      endOperation();
    }
  };

  const applyMutation = async (
    action: () => Promise<{ snapshot: RepoSnapshot; pushed: boolean; notice: string | null }>,
    successMessage: string,
    done?: () => void
  ): Promise<boolean> => {
    if (!beginOperation()) return false;
    busyRef.current = "mutation";
    setBusyMessage("正在准备提交…");
    setBusy("mutation");
    try {
      const result = await action();
      setSnapshot(result.snapshot);
      done?.();
      showNotice(result.notice || successMessage, result.notice ? "warning" : "success");
      return true;
    } catch (error) {
      showNotice(messageFor(error), "error");
      return false;
    } finally {
      busyRef.current = null;
      setBusyMessage("正在提交到本地 Git…");
      setBusy(null);
      endOperation();
    }
  };

  const previewRemote = async (url: string): Promise<RemoteInstallSession> => {
    if (!repo) throw new MobileGitError("仓库尚未连接", "INVALID_REPO");
    if (!beginOperation()) throw new MobileGitError("另一个操作正在进行，请稍后再试", "UNKNOWN");
    busyRef.current = "preview";
    setBusy("preview");
    try {
      return await repo.previewRemoteSkills(url);
    } catch (error) {
      throw friendlyGitError(error);
    } finally {
      busyRef.current = null;
      setBusy(null);
      endOperation();
    }
  };

  const cancelRemotePreview = async (tempDir: string) => {
    if (!repo) return;
    await repo.cancelRemotePreview(tempDir).catch(() => undefined);
  };

  const installRemote = async (
    session: RemoteInstallSession,
    items: RemoteSkillInstallItem[]
  ): Promise<boolean> => {
    if (!repo) return false;
    return applyMutation(
      () => repo.installRemoteSkills(session, items),
      `已安装 ${items.length} 个 GitHub Skill`,
      () => setRoute({ kind: "tab", tab: "skills" })
    );
  };

  const checkUpdates = async () => {
    if (!repo || !beginOperation()) return;
    busyRef.current = "check-updates";
    setBusy("check-updates");
    setCheckingUpdates(true);
    try {
      const result = await repo.checkRemoteUpdates();
      setSnapshot(result.snapshot);
      showNotice(result.notice || "更新检查完成", result.pushed ? "success" : "warning");
    } catch (error) {
      showNotice(messageFor(error), "error");
    } finally {
      setCheckingUpdates(false);
      busyRef.current = null;
      setBusy(null);
      endOperation();
    }
  };

  const establishBaseline = async (skillId: string) => {
    if (!repo || !beginOperation()) return;
    busyRef.current = "baseline";
    setBusy("baseline");
    setBusyMessage("正在比较本地与上游文件…");
    cancelOperationRef.current = () => repo.cancelNetworkOperations();
    try {
      const result = await repo.establishRemoteBaseline(skillId);
      setSnapshot(result.snapshot);
      showNotice(result.notice || "基线检查完成", "success");
    } catch (error) {
      showNotice(messageFor(error), "error");
    } finally {
      cancelOperationRef.current = null;
      busyRef.current = null;
      setBusyMessage("正在提交到本地 Git…");
      setBusy(null);
      endOperation();
    }
  };

  const syncNow = async () => {
    if (!repo || !beginOperation()) return;
    busyRef.current = "sync";
    setBusy("sync");
    setSyncing(true);
    try {
      const result = await repo.sync();
      setSnapshot(result.snapshot);
      showNotice(result.notice || "仓库已同步", result.notice ? "warning" : "success");
    } catch (error) {
      const friendly = friendlyGitError(error);
      setSnapshot((current) =>
        current
          ? {
              ...current,
              sync: { ...current.sync, phase: "unknown", message: friendly.message },
            }
          : current
      );
      showNotice(friendly.message, "error");
    } finally {
      setSyncing(false);
      busyRef.current = null;
      setBusy(null);
      endOperation();
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
    if (!repo || !beginOperation()) return;
    busyRef.current = "disconnect";
    setBusy("disconnect");
    try {
      const remoteUrl = repo.connection.remoteUrl;
      await clearToken(remoteUrl);
      clearConnection();
      setSheet(null);
      setRepo(null);
      setSnapshot(null);
      setBooting(false);
      setInitialRemote(remoteUrl);
      showNotice("已断开远程仓库。本地 Git 副本仍保留在应用私有存储中。", "success");
    } finally {
      busyRef.current = null;
      setBusy(null);
      endOperation();
    }
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
            onUpdate={() => setSheet({ kind: "update-skills", skillIds: [activeSkill.id] })}
            onEstablishBaseline={() => void establishBaseline(activeSkill.id)}
            onCopyRemote={(url) => {
              if (!navigator.clipboard) {
                showNotice("当前环境无法访问剪贴板", "error");
                return;
              }
              void navigator.clipboard
                .writeText(url)
                .then(() => showNotice("远程仓库地址已复制", "success"))
                .catch(() => showNotice("复制远程仓库地址失败", "error"));
            }}
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
            query={skillQuery}
            filter={skillFilter}
            onQueryChange={setSkillQuery}
            onFilterChange={setSkillFilter}
            onCreate={() => setSheet({ kind: "skill", skill: null })}
            onInstallRemote={() => setSheet({ kind: "remote-install" })}
            onCheckUpdates={() => void checkUpdates()}
            onUpdateAll={(skillIds) => setSheet({ kind: "update-skills", skillIds })}
            checkingUpdates={checkingUpdates}
            busy={Boolean(busy)}
            onOpenSkill={(skill) => {
              captureTabScroll();
              setRoute({ kind: "skill", id: skill.id, from: "skills" });
            }}
          />
        ) : activeTab === "presets" ? (
          <PresetsScreen
            snapshot={snapshot}
            onCreate={() => setSheet({ kind: "preset", preset: null })}
            onOpenPreset={(preset) => {
              captureTabScroll();
              setRoute({ kind: "preset", id: preset.id, from: "presets" });
            }}
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
            onOpenSkills={() => goToTab("skills")}
            onOpenPresets={() => goToTab("presets")}
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
                onClick={() => goToTab(tab.key)}
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

      {busy === "mutation" || busy === "baseline" ? (
        <div className="mobile-working" role="status" aria-live="polite">
          <Loader2 className="spin" size={17} />
          {busyMessage}
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
      <RemoteInstaller
        key={sheet?.kind === "remote-install" ? "remote-install" : "closed"}
        open={sheet?.kind === "remote-install"}
        busy={busy === "mutation"}
        onPreview={previewRemote}
        onInstall={installRemote}
        onCancelPreview={cancelRemotePreview}
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
        open={sheet?.kind === "update-skills"}
        title={`更新 ${sheet?.kind === "update-skills" ? sheet.skillIds.length : 0} 个 Skill？`}
        message="会用 GitHub 上游内容替换本地 Skill 文件，同时保留标签、Preset 归属和来源信息。失败的项目不会修改。"
        confirmLabel="开始更新"
        busy={busy === "mutation"}
        onClose={() => setSheet(null)}
        onConfirm={() => {
          if (!repo || sheet?.kind !== "update-skills") return;
          const ids = sheet.skillIds;
          cancelOperationRef.current = () => repo.cancelNetworkOperations();
          void applyMutation(
            () => repo.updateRemoteSkills(ids, setBusyMessage),
            `已更新 ${ids.length} 个 GitHub Skill`,
            () => setSheet(null)
          ).finally(() => {
            cancelOperationRef.current = null;
          });
        }}
        onCancelWhileBusy={() => {
          setBusyMessage("正在取消更新…");
          void cancelOperationRef.current?.();
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
