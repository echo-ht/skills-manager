// @vitest-environment node
import "fake-indexeddb/auto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { HttpOptions, HttpResponse } from "@capacitor/core";
import type { AndroidGitRepository } from "../src/mobile/GitRepository";
import { repoStorageKey } from "../src/mobile/model";

const httpRequest = vi.hoisted(() => vi.fn());
vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return {
    ...actual,
    CapacitorHttp: {
      ...actual.CapacitorHttp,
      request: httpRequest,
    },
  };
});

const alphaId = "11111111-1111-4111-8111-111111111111";
const betaId = "22222222-2222-4222-8222-222222222222";
const presetId = "33333333-3333-4333-8333-333333333333";

let tempRoot = "";
let remoteDir = "";
let communityWork = "";
let communityRemote = "";
let server: ReturnType<typeof createServer> | null = null;
let repository: AndroidGitRepository;
let RepositoryClass: typeof AndroidGitRepository;
let serverUrl = "";
let localHttpBase = "";
let liveHttpRequest: (options: HttpOptions) => Promise<HttpResponse>;

Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "skills-manager-integration-test" },
  configurable: true,
});
const storedValues = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storedValues.get(key) ?? null,
    setItem: (key: string, value: string) => storedValues.set(key, value),
    removeItem: (key: string) => storedValues.delete(key),
  },
  configurable: true,
});

function runGit(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      HOME: pathJoin(tempRoot, "home"),
    },
  });
}

function runGitBuffer(args: string[]): Buffer {
  return execFileSync("git", args, {
    encoding: "buffer",
    stdio: ["ignore", "pipe", "ignore"],
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      HOME: pathJoin(tempRoot, "home"),
    },
  });
}

async function writeSkillSeed(root: string, id: string, name: string) {
  const skillName = name.split("/").filter(Boolean).pop() || name;
  await mkdir(pathJoin(root, name), { recursive: true });
  await writeFile(
    pathJoin(root, name, "SKILL.md"),
    `---\nname: "${skillName}"\ndescription: "${skillName} test skill"\n---\n\n# ${skillName}\n`
  );
  await mkdir(pathJoin(root, ".skills-manager", "skills"), { recursive: true });
  await writeFile(
    pathJoin(root, ".skills-manager", "skills", `${id}.json`),
    JSON.stringify(
      {
        schema_version: 1,
        skill_id: id,
        path: name,
        path_key: name,
        enabled: true,
        tags: [],
        source: { type: "local", ref: null, subpath: null, branch: null },
      },
      null,
      2
    ) + "\n"
  );
}

async function seedRemote() {
  const work = pathJoin(tempRoot, "work");
  await mkdir(pathJoin(tempRoot, "home"), { recursive: true });
  await writeSkillSeed(work, alphaId, "alpha");
  await writeSkillSeed(work, betaId, "beta");
  await mkdir(pathJoin(work, ".skills-manager", "scenarios"), { recursive: true });
  await writeFile(
    pathJoin(work, ".skills-manager", "schema.json"),
    JSON.stringify({ schema_version: 1, app_min_version: "2.0.0", created_by: "test" }, null, 2) + "\n"
  );
  await writeFile(
    pathJoin(work, ".skills-manager", "scenarios", `${presetId}.json`),
    JSON.stringify(
      {
        schema_version: 1,
        scenario_id: presetId,
        name: "Release",
        description: null,
        icon: "rocket",
        sort_order: 0,
      },
      null,
      2
    ) + "\n"
  );
  for (const [index, id] of [alphaId, betaId].entries()) {
    await mkdir(pathJoin(work, ".skills-manager", "scenario-skills", presetId), { recursive: true });
    await writeFile(
      pathJoin(work, ".skills-manager", "scenario-skills", presetId, `${id}.json`),
      JSON.stringify(
        {
          schema_version: 1,
          scenario_id: presetId,
          skill_id: id,
          sort_order: index,
          tools: {},
        },
        null,
        2
      ) + "\n"
    );
  }

  runGit(["init", "-b", "main"], work);
  runGit(["config", "user.name", "Integration Test"], work);
  runGit(["config", "user.email", "test@skills-manager.local"], work);
  runGit(["add", "-A"], work);
  runGit(["commit", "-m", "seed repository"], work);

  remoteDir = pathJoin(tempRoot, "remotes", "repo.git");
  await mkdir(pathJoin(tempRoot, "remotes"), { recursive: true });
  runGit(["init", "--bare", "-b", "main", remoteDir]);
  runGit(["--git-dir", remoteDir, "config", "http.receivepack", "true"]);
  runGit(["--git-dir", remoteDir, "symbolic-ref", "HEAD", "refs/heads/main"]);
  runGit(["remote", "add", "origin", remoteDir], work);
  runGit(["push", "origin", "main"], work);

  communityWork = pathJoin(tempRoot, "community-work");
  await writeSkillSeed(communityWork, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "skills/remote-alpha");
  await writeSkillSeed(communityWork, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "skills/remote-beta");
  runGit(["init", "-b", "main"], communityWork);
  runGit(["config", "user.name", "Community Author"], communityWork);
  runGit(["config", "user.email", "community@skills-manager.local"], communityWork);
  runGit(["add", "-A"], communityWork);
  runGit(["commit", "-m", "seed community skills"], communityWork);
  communityRemote = pathJoin(tempRoot, "remotes", "community.git");
  runGit(["init", "--bare", "-b", "main", communityRemote]);
  runGit(["--git-dir", communityRemote, "config", "http.receivepack", "true"]);
  runGit(["remote", "add", "origin", communityRemote], communityWork);
  runGit(["push", "origin", "main"], communityWork);
}

async function startGitHttpServer(): Promise<number> {
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const child = spawn("git", ["http-backend"], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: pathJoin(tempRoot, "remotes"),
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: request.url?.split("?")[0] || "/",
        QUERY_STRING: request.url?.split("?")[1] || "",
        REQUEST_METHOD: request.method || "GET",
        CONTENT_TYPE: String(request.headers["content-type"] || ""),
        CONTENT_LENGTH: String(body.length),
        REMOTE_ADDR: "127.0.0.1",
        SERVER_PROTOCOL: "HTTP/1.1",
        GATEWAY_INTERFACE: "CGI/1.1",
      },
    });
    const output: Buffer[] = [];
    child.stdout.on("data", (chunk) => output.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.stdin.on("error", () => {
      // The client may abort an offline-open probe while git http-backend is
      // starting. That is expected in the network-loss test.
    });
    child.stdin.end(body);
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`git http-backend exited ${code}`))));
    });
    const raw = Buffer.concat(output);
    const separator = raw.indexOf("\r\n\r\n");
    if (separator < 0) throw new Error("git http-backend returned no headers");
    const headerLines = raw.subarray(0, separator).toString("utf8").split("\r\n");
    let status = 200;
    const headers: Record<string, string> = {};
    for (const line of headerLines) {
      const index = line.indexOf(":");
      if (index < 0) continue;
      const key = line.slice(0, index);
      const value = line.slice(index + 1).trim();
      if (key.toLowerCase() === "status") status = Number.parseInt(value, 10);
      else headers[key] = value;
    }
    if (!response.destroyed) {
      response.writeHead(status, headers);
      response.end(raw.subarray(separator + 4));
    }
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  localHttpBase = `http://127.0.0.1:${port}`;
  return port;
}

beforeAll(async () => {
  tempRoot = await mkdtemp(pathJoin(tmpdir(), "skills-manager-mobile-"));
  await seedRemote();
  const port = await startGitHttpServer();
  serverUrl = `http://127.0.0.1:${port}/repo.git`;

  liveHttpRequest = async (options) => {
    const apiContents = options.url.match(
      /^https:\/\/api\.github\.com\/repos\/test\/community\/contents\/(.*?)\?ref=[^&]+$/
    );
    if (apiContents) {
      const requestedPath = decodeURIComponent(apiContents[1]).replace(/\/+$/, "");
      const rows = runGit(["--git-dir", communityRemote, "ls-tree", "-r", "main"])
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [meta, path] = line.split("\t");
          const [, , sha] = meta.split(/\s+/);
          return { path, sha };
        });
      const prefix = requestedPath ? `${requestedPath}/` : "";
      const entries = new Map<string, { name: string; path: string; type: string; sha: string }>();
      for (const row of rows) {
        if (!row.path.startsWith(prefix)) continue;
        const remainder = row.path.slice(prefix.length);
        const [name, ...rest] = remainder.split("/");
        if (!name) continue;
        const path = prefix ? `${prefix}${name}` : name;
        entries.set(path, {
          name,
          path,
          type: rest.length > 0 ? "dir" : "file",
          sha: rest.length > 0 ? "" : row.sha,
        });
      }
      const encoded = new TextEncoder().encode(JSON.stringify([...entries.values()]));
      return {
        data: encoded.buffer,
        status: 200,
        headers: { "content-type": "application/json" },
        url: options.url,
      };
    }
    const apiTree = options.url.match(
      /^https:\/\/api\.github\.com\/repos\/test\/community\/git\/trees\/[^?]+\?recursive=1$/
    );
    if (apiTree) {
      const rows = runGit(["--git-dir", communityRemote, "ls-tree", "-r", "main"])
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [meta, path] = line.split("\t");
          const [mode, type, sha] = meta.split(/\s+/);
          return { path, type, mode, sha };
        });
      const encoded = new TextEncoder().encode(JSON.stringify({ tree: rows }));
      return {
        data: encoded.buffer,
        status: 200,
        headers: { "content-type": "application/json" },
        url: options.url,
      };
    }
    const apiBlob = options.url.match(
      /^https:\/\/api\.github\.com\/repos\/test\/community\/git\/blobs\/([0-9a-f]+)$/
    );
    if (apiBlob) {
      const bytes = runGitBuffer([
        "--git-dir",
        communityRemote,
        "cat-file",
        "-p",
        apiBlob[1],
      ]);
      const encoded = new TextEncoder().encode(
        JSON.stringify({ content: bytes.toString("base64"), encoding: "base64" })
      );
      return {
        data: encoded.buffer,
        status: 200,
        headers: { "content-type": "application/json" },
        url: options.url,
      };
    }
    const body = options.data
      ? Buffer.from(String(options.data), "base64")
      : undefined;
    const upstreamUrl = options.url.replace(
      "https://github.com/test/",
      `${localHttpBase}/`
    );
    const response = await fetch(upstreamUrl, {
      method: options.method,
      headers: options.headers,
      body,
    });
    return {
      data: await response.arrayBuffer(),
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      url: response.url,
    };
  };
  httpRequest.mockImplementation(liveHttpRequest);

  const { AndroidGitRepository: Repository } = await import("../src/mobile/GitRepository");
  RepositoryClass = Repository;
  repository = await Repository.connectConnection(
    {
      owner: "test",
      repo: "skills",
      branch: "main",
      remoteUrl: serverUrl,
    },
    "test-token"
  );
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  await rm(tempRoot, { recursive: true, force: true });
});

describe("Android Git repository integration", () => {
  it("clones, commits, pushes, manages preset membership and preserves surviving skills", async () => {
    const initial = await repository.snapshot();
    expect(initial.skills.map((skill) => skill.name).sort()).toEqual(["alpha", "beta"]);
    expect(initial.presets[0].skillIds.sort()).toEqual([alphaId, betaId].sort());

    const created = await repository.saveSkill({
      name: "gamma",
      description: "created on Android",
      tags: ["mobile"],
      content: "# Gamma\n\nCreated through the mobile repository layer.",
    });
    const gamma = created.snapshot.skills.find((skill) => skill.name === "gamma")!;
    expect(gamma).toBeTruthy();

    const assigned = await repository.setPresetSkill(presetId, gamma.id, true);
    expect(assigned.snapshot.presets[0].skillIds).toContain(gamma.id);

    const deleted = await repository.deleteSkill(alphaId);
    expect(deleted.snapshot.skills.some((skill) => skill.id === alphaId)).toBe(false);
    expect(deleted.snapshot.skills.some((skill) => skill.id === betaId)).toBe(true);
    expect(deleted.snapshot.skills.some((skill) => skill.id === gamma.id)).toBe(true);
    expect(deleted.snapshot.presets[0].skillIds.sort()).toEqual([betaId, gamma.id].sort());

    const betaMembership = runGit([
      "--git-dir",
      remoteDir,
      "show",
      `main:.skills-manager/scenario-skills/${presetId}/${betaId}.json`,
    ]);
    expect(JSON.parse(betaMembership).skill_id).toBe(betaId);
    expect(() =>
      runGit([
        "--git-dir",
        remoteDir,
        "show",
        `main:.skills-manager/skills/${alphaId}.json`,
      ])
    ).toThrow();
    expect(
      runGit(["--git-dir", remoteDir, "show", "main:gamma/SKILL.md"])
    ).toContain("created on Android");
  });

  it("keeps a committed local change when push fails, then recovers on sync", async () => {
    httpRequest.mockImplementation(async (options) => {
      if (options.method === "POST" && options.url.includes("git-receive-pack")) {
        throw new Error("Network request failed");
      }
      return liveHttpRequest(options);
    });

    const saved = await repository.saveSkill({
      name: "offline-change",
      description: "written while the push endpoint is unavailable",
      tags: ["offline"],
      content: "# Offline\n\nThe local commit must survive.",
    });
    expect(saved.pushed).toBe(false);
    expect(saved.notice).toContain("已提交到本地 Git");
    expect(saved.snapshot.skills.some((skill) => skill.name === "offline-change")).toBe(true);
    expect(() =>
      runGit(["--git-dir", remoteDir, "show", "main:offline-change/SKILL.md"])
    ).toThrow();

    httpRequest.mockImplementation(liveHttpRequest);
    const recovered = await repository.sync();
    expect(recovered.pushed).toBe(true);
    expect(
      runGit(["--git-dir", remoteDir, "show", "main:offline-change/SKILL.md"])
    ).toContain("The local commit must survive.");
  });

  it("installs a skill from another GitHub repository and follows upstream updates", async () => {
    const preview = await repository.previewRemoteSkills(
      "https://github.com/test/community.git"
    );
    expect(preview.skills.map((skill) => skill.name).sort()).toEqual([
      "remote-alpha",
      "remote-beta",
    ]);
    const alphaPreview = preview.skills.find((skill) => skill.name === "remote-alpha")!;

    const installed = await repository.installRemoteSkills(preview, [
      { relPath: alphaPreview.relPath, name: alphaPreview.name },
    ]);
    const installedAlpha = installed.snapshot.skills.find(
      (skill) => skill.name === "remote-alpha"
    )!;
    expect(installedAlpha.source.type).toBe("git");
    expect(installedAlpha.source.ref).toBe("https://github.com/test/community.git");
    expect(installedAlpha.source.subpath).toBe("skills/remote-alpha");
    expect(installedAlpha.updateStatus).toBe("up_to_date");

    const updateStateKey = `skills-manager.mobile.updates.${repoStorageKey(serverUrl)}`;
    const savedUpdateStates = localStorage.getItem(updateStateKey);
    expect(savedUpdateStates).not.toBeNull();
    localStorage.removeItem(updateStateKey);
    const withoutBaseline = await repository.checkRemoteUpdates();
    expect(
      withoutBaseline.snapshot.skills.find((skill) => skill.id === installedAlpha.id)
        ?.updateStatus
    ).toBe("unknown");
    const baseline = await repository.establishRemoteBaseline(installedAlpha.id);
    expect(
      baseline.snapshot.skills.find((skill) => skill.id === installedAlpha.id)?.updateStatus
    ).toBe("up_to_date");

    await repository.saveSkill({
      id: installedAlpha.id,
      name: installedAlpha.name,
      description: installedAlpha.description ?? "",
      tags: ["keep-me"],
      content: installedAlpha.content,
    });

    await writeFile(
      pathJoin(communityWork, "skills", "remote-alpha", "SKILL.md"),
      '---\nname: "remote-alpha"\ndescription: "updated upstream"\n---\n\n# Updated upstream\n'
    );
    runGit(["add", "-A"], communityWork);
    runGit(["commit", "-m", "update remote alpha"], communityWork);
    runGit(["push", "origin", "main"], communityWork);

    const checked = await repository.checkRemoteUpdates();
    const withUpdate = checked.snapshot.skills.find(
      (skill) => skill.id === installedAlpha.id
    )!;
    expect(withUpdate.lastCheckError).toBeNull();
    expect(withUpdate.updateStatus).toBe("update_available");
    expect(
      checked.snapshot.skills.find((skill) => skill.id === betaId)?.updateStatus
    ).toBe("local_only");
    expect(checked.notice).toContain("已跳过");

    const rechecked = await repository.checkRemoteUpdates();
    expect(
      rechecked.snapshot.skills.find((skill) => skill.id === installedAlpha.id)?.updateStatus
    ).toBe("update_available");

    const updated = await repository.updateRemoteSkills([installedAlpha.id]);
    const updatedSkill = updated.snapshot.skills.find(
      (skill) => skill.id === installedAlpha.id
    )!;
    expect(updatedSkill.updateStatus).toBe("up_to_date");
    expect(updatedSkill.content).toContain("Updated upstream");
    expect(updatedSkill.tags).toEqual(["keep-me"]);

    const afterUpdate = await repository.checkRemoteUpdates();
    expect(
      afterUpdate.snapshot.skills.find((skill) => skill.id === installedAlpha.id)?.updateStatus
    ).toBe("up_to_date");
  });

  it("opens an existing clone when the network is unavailable", async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    server = null;
    const offline = await RepositoryClass.connectConnection(
      {
        owner: "test",
        repo: "skills",
        branch: "main",
        remoteUrl: serverUrl,
      },
      "test-token"
    );
    const snapshot = await offline.snapshot();
    expect(snapshot.skills.some((skill) => skill.name === "offline-change")).toBe(true);

    const saved = await offline.saveSkill({
      name: "offline-edit",
      description: "edited with no network",
      tags: ["offline"],
      content: "# Offline edit\n\nQueue this commit for the next network connection.",
    });
    expect(saved.pushed).toBe(false);
    expect(saved.notice).toContain("已提交到本地 Git");
    expect(saved.snapshot.skills.some((skill) => skill.name === "offline-edit")).toBe(true);
    expect(saved.snapshot.sync.phase).not.toBe("dirty");
  });
});
