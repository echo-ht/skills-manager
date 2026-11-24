import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.skillsmanager.android",
  appName: "Skills Manager",
  webDir: "dist",
  backgroundColor: "#f6f8f7",
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
