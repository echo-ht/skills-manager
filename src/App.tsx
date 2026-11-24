import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Toaster } from "sonner";
import { AppProvider } from "./context/AppContext";
import { ThemeProvider, useThemeContext } from "./context/ThemeContext";
import { HelpDialog } from "./components/HelpDialog";
import { CloseActionGuard } from "./components/CloseActionGuard";
import { FirstRunRestoreDialog } from "./components/FirstRunRestoreDialog";
import { WhatsNewOnUpdate } from "./components/WhatsNewDialog";
import { Layout } from "./components/Layout";
import { Dashboard } from "./views/Dashboard";
import { MySkills } from "./views/MySkills";
import { WorkspaceView } from "./views/WorkspaceView";
import { CODING_WORKSPACE_CONFIG, LOBSTER_WORKSPACE_CONFIG } from "./views/workspaceConfigs";
import { InstallSkills } from "./views/InstallSkills";
import { Settings } from "./views/Settings";
import { ProjectDetail } from "./views/ProjectDetail";
import { Backup } from "./views/Backup";

const MobileApp = lazy(() =>
  import("./mobile/MobileApp").then((module) => ({ default: module.MobileApp }))
);

function shouldOpenMobileApp() {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") return true;
  const params = new URLSearchParams(window.location.search);
  return params.has("mobilePreview") || (import.meta.env.DEV && params.has("mobile"));
}

function ThemedToaster() {
  const { resolvedTheme } = useThemeContext();
  return (
    <Toaster
      theme={resolvedTheme}
      position="bottom-right"
      toastOptions={{
        style: {
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text-primary)",
        },
      }}
    />
  );
}

function App() {
  if (shouldOpenMobileApp()) {
    return (
      <Suspense
        fallback={
          <div className="flex h-full w-full items-center justify-center bg-background text-[13px] text-muted">
            Loading…
          </div>
        }
      >
        <MobileApp />
      </Suspense>
    );
  }

  return (
    <ThemeProvider>
      <AppProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/my-skills" element={<MySkills />} />
              <Route path="/global-workspace" element={<WorkspaceView config={CODING_WORKSPACE_CONFIG} />} />
              <Route path="/global-workspace/:agentKey" element={<WorkspaceView config={CODING_WORKSPACE_CONFIG} />} />
              <Route path="/lobster-workspace" element={<WorkspaceView config={LOBSTER_WORKSPACE_CONFIG} />} />
              <Route path="/lobster-workspace/:agentKey" element={<WorkspaceView config={LOBSTER_WORKSPACE_CONFIG} />} />
              <Route path="/install" element={<InstallSkills />} />
              <Route path="/backup" element={<Backup />} />
              <Route path="/project/:id" element={<ProjectDetail />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Routes>
          <HelpDialog />
          <CloseActionGuard />
          <FirstRunRestoreDialog />
          <WhatsNewOnUpdate />
        </BrowserRouter>
        <ThemedToaster />
      </AppProvider>
    </ThemeProvider>
  );
}

export default App;
