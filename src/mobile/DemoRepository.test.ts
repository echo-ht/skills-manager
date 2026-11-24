import { describe, expect, it } from "vitest";
import { DemoRepository } from "./DemoRepository";

describe("mobile preset membership behavior", () => {
  it("keeps skill.presetIds and preset.skillIds consistent", async () => {
    const repo = new DemoRepository();
    const before = await repo.snapshot();
    const preset = before.presets[0];
    const skill = before.skills.find((candidate) => !candidate.presetIds.includes(preset.id))!;

    const added = await repo.setPresetSkill(preset.id, skill.id, true);
    expect(added.snapshot.presets.find((item) => item.id === preset.id)?.skillIds).toContain(skill.id);
    expect(added.snapshot.skills.find((item) => item.id === skill.id)?.presetIds).toContain(preset.id);

    const removed = await repo.setPresetSkill(preset.id, skill.id, false);
    expect(removed.snapshot.presets.find((item) => item.id === preset.id)?.skillIds).not.toContain(skill.id);
    expect(removed.snapshot.skills.find((item) => item.id === skill.id)?.presetIds).not.toContain(preset.id);
  });

  it("deletes a preset without deleting its member skills", async () => {
    const repo = new DemoRepository();
    const before = await repo.snapshot();
    const preset = before.presets[0];
    const memberIds = new Set(preset.skillIds);
    const result = await repo.deletePreset(preset.id);

    expect(result.snapshot.presets.some((item) => item.id === preset.id)).toBe(false);
    expect(result.snapshot.skills.filter((skill) => memberIds.has(skill.id))).toHaveLength(memberIds.size);
    expect(
      result.snapshot.skills.filter((skill) => memberIds.has(skill.id)).every((skill) => !skill.presetIds.includes(preset.id))
    ).toBe(true);
  });
});
