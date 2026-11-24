import { SecureStoragePlugin } from "capacitor-secure-storage-plugin";
import type { RepoConnection } from "./model";

const CONNECTION_KEY = "skills-manager.mobile.connection";

export function loadConnection(): RepoConnection | null {
  try {
    const raw = localStorage.getItem(CONNECTION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RepoConnection>;
    if (!value.remoteUrl || !value.owner || !value.repo) return null;
    return {
      remoteUrl: value.remoteUrl,
      owner: value.owner,
      repo: value.repo,
      branch: value.branch || "main",
    };
  } catch {
    return null;
  }
}

export function saveConnection(connection: RepoConnection): void {
  localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
}

export function clearConnection(): void {
  localStorage.removeItem(CONNECTION_KEY);
}

function tokenKey(remoteUrl: string): string {
  return `github-pat:${remoteUrl}`;
}

export async function loadToken(remoteUrl: string): Promise<string | null> {
  try {
    return (await SecureStoragePlugin.get({ key: tokenKey(remoteUrl) })).value || null;
  } catch {
    return null;
  }
}

export async function saveToken(remoteUrl: string, token: string): Promise<void> {
  await SecureStoragePlugin.set({ key: tokenKey(remoteUrl), value: token });
}

export async function clearToken(remoteUrl: string): Promise<void> {
  await SecureStoragePlugin.remove({ key: tokenKey(remoteUrl) }).catch(() => undefined);
}
