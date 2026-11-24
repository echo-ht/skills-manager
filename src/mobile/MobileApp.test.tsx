// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileApp } from "./MobileApp";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
  window.history.replaceState({}, "", "/?mobilePreview=1");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.documentElement.removeAttribute("data-mobile-theme");
  document.body.classList.remove("mobile-body");
  vi.unstubAllGlobals();
});

async function renderApp() {
  await act(async () => {
    root.render(<MobileApp />);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("Android preview navigation", () => {
  it("renders the repository thesis and all four destinations", async () => {
    await renderApp();
    expect(container.textContent).toContain("已与远端同步");
    expect(container.textContent).toContain("最近提交");
    const navigation = [...container.querySelectorAll<HTMLButtonElement>("nav button")];
    expect(navigation.map((button) => button.textContent?.trim())).toEqual([
      "仓库",
      "Skills",
      "Presets",
      "设置",
    ]);
  });

  it("opens a skill, shows its preset assignments, and returns by app-bar back", async () => {
    await renderApp();
    const skillsTab = [...container.querySelectorAll<HTMLButtonElement>("nav button")].find(
      (button) => button.textContent?.includes("Skills")
    )!;
    await act(async () => skillsTab.click());
    const skillRow = [...container.querySelectorAll<HTMLButtonElement>(".mobile-skill-row")].find(
      (button) => button.textContent?.includes("frontend-design-review")
    )!;
    await act(async () => skillRow.click());
    expect(container.textContent).toContain("所属 Preset");
    expect(container.textContent).toContain("SKILL.md");
    expect(container.textContent).toContain("远程仓库");
    expect(container.textContent).toContain("echo-ht/skills-demo");
    expect(container.querySelector("nav")).toBeNull();

    const back = container.querySelector<HTMLButtonElement>('button[aria-label="返回"]')!;
    await act(async () => back.click());
    expect(container.querySelector<HTMLInputElement>('input[aria-label="搜索 Skills"]')?.placeholder).toBe(
      "搜索名称、说明或标签"
    );
  });

  it("opens preset management without exposing an Apply-to-Agent action", async () => {
    await renderApp();
    const presetsTab = [...container.querySelectorAll<HTMLButtonElement>("nav button")].find(
      (button) => button.textContent?.includes("Presets")
    )!;
    await act(async () => presetsTab.click());
    expect(container.textContent).toContain("前端交付");
    expect(container.textContent).not.toContain("应用到 Agent");
  });

  it("preserves the skill search when returning from detail", async () => {
    await renderApp();
    const skillsTab = [...container.querySelectorAll<HTMLButtonElement>("nav button")].find(
      (button) => button.textContent?.includes("Skills")
    )!;
    await act(async () => skillsTab.click());
    const search = container.querySelector<HTMLInputElement>('input[aria-label="搜索 Skills"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(search, "playwright");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const row = container.querySelector<HTMLButtonElement>(".mobile-skill-row")!;
    await act(async () => row.click());
    const back = container.querySelector<HTMLButtonElement>('button[aria-label="返回"]')!;
    await act(async () => back.click());
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="搜索 Skills"]')?.value
    ).toBe("playwright");
  });

  it("installs selected skills from another GitHub repository", async () => {
    await renderApp();
    const skillsTab = [...container.querySelectorAll<HTMLButtonElement>("nav button")].find(
      (button) => button.textContent?.includes("Skills")
    )!;
    await act(async () => skillsTab.click());
    const openInstaller = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("从 GitHub 安装")
    )!;
    await act(async () => openInstaller.click());

    const url = container.querySelector<HTMLInputElement>(
      'input[placeholder="https://github.com/owner/repo"]'
    )!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(url, "https://github.com/example/community-skills");
      url.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const preview = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("预览仓库")
    )!;
    await act(async () => {
      preview.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("remote-review");

    const install = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("安装 2 个")
    )!;
    await act(async () => {
      install.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("remote-review");
    expect(container.textContent).toContain("release-notes");
  });

  it("checks and applies upstream updates", async () => {
    await renderApp();
    const skillsTab = [...container.querySelectorAll<HTMLButtonElement>("nav button")].find(
      (button) => button.textContent?.includes("Skills")
    )!;
    await act(async () => skillsTab.click());
    const check = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("检查更新")
    )!;
    await act(async () => {
      check.click();
      await Promise.resolve();
    });
    const updateAll = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("更新 1 个")
    )!;
    expect(updateAll).toBeTruthy();
    await act(async () => updateAll.click());
    const confirm = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("开始更新")
    )!;
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });
    expect(
      [...container.querySelectorAll(".mobile-update-badge")].some((badge) =>
        badge.textContent?.includes("上游有更新")
      )
    ).toBe(false);
  });

  it("creates a preset through the full-screen editor and reflects it immediately", async () => {
    await renderApp();
    const presetsTab = [...container.querySelectorAll<HTMLButtonElement>("nav button")].find(
      (button) => button.textContent?.includes("Presets")
    )!;
    await act(async () => presetsTab.click());
    const create = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "新建"
    )!;
    await act(async () => create.click());
    expect(container.querySelector('dialog[open]')).not.toBeNull();

    const name = container.querySelector<HTMLInputElement>('input[placeholder="例如：发布检查"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(name, "自动化测试");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("保存并同步")
    )!;
    await act(async () => {
      save.click();
      save.click();
      await Promise.resolve();
    });
    const created = [...container.querySelectorAll(".mobile-preset-row")].filter((row) =>
      row.textContent?.includes("自动化测试")
    );
    expect(created).toHaveLength(1);
  });
});
