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
      await Promise.resolve();
    });
    expect(container.textContent).toContain("自动化测试");
  });
});
