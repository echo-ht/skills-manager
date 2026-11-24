import { describe, expect, it } from "vitest";
import {
  MobileGitError,
  friendlyGitError,
  parseInstallSource,
  parseRemoteUrl,
  parseSkillMarkdown,
  renderSkillMarkdown,
  sortTags,
} from "./model";

describe("mobile repository model", () => {
  it("normalizes SSH, HTTPS and shorthand GitHub remotes", () => {
    const expected = "https://github.com/echo-ht/skills-manager.git";
    expect(parseRemoteUrl("git@github.com:echo-ht/skills-manager.git").remoteUrl).toBe(expected);
    expect(parseRemoteUrl("https://github.com/echo-ht/skills-manager").remoteUrl).toBe(expected);
    expect(parseRemoteUrl("echo-ht/skills-manager").remoteUrl).toBe(expected);
  });

  it("rejects non-GitHub or incomplete repository addresses", () => {
    expect(() => parseRemoteUrl("https://gitlab.com/echo/skills.git")).toThrow(MobileGitError);
    expect(() => parseRemoteUrl("skills-manager")).toThrow(MobileGitError);
  });

  it("parses a GitHub tree URL into branch and skill subdirectory", () => {
    const source = parseInstallSource(
      "git@github.com:someone/community-skills.git"
    );
    expect(source.remoteUrl).toBe("https://github.com/someone/community-skills.git");
    expect(source.branch).toBe("");
    expect(source.subpath).toBeNull();

    const tree = parseInstallSource(
      "https://github.com/someone/community-skills/tree/dev/skills/review"
    );
    expect(tree.branch).toBe("dev");
    expect(tree.subpath).toBe("skills/review");
    expect(tree.originalUrl).toContain("/tree/dev/");
  });

  it("round-trips the SKILL.md frontmatter without moving frontmatter into the body", () => {
    const markdown = renderSkillMarkdown(
      'Design: "mobile"',
      "A focused workflow\nfor phones",
      "# Workflow\n\n1. Inspect\n2. Edit"
    );
    const parsed = parseSkillMarkdown(markdown);
    expect(parsed.name).toBe('Design: "mobile"');
    expect(parsed.description).toBe("A focused workflow for phones");
    expect(parsed.body).toBe("# Workflow\n\n1. Inspect\n2. Edit");
  });

  it("preserves unknown frontmatter while editing name and description", () => {
    const original =
      '---\nname: "old"\ndescription: "before"\nlicense: MIT\nmetadata:\n  owner: platform\n---\n\n# Body';
    const parsed = parseSkillMarkdown(original);
    const updated = renderSkillMarkdown("new", "after", parsed.body, parsed.frontmatter);
    expect(updated).toContain('name: "new"');
    expect(updated).toContain('description: "after"');
    expect(updated).toContain("license: MIT");
    expect(updated).toContain("metadata:\n  owner: platform");
  });

  it("reads folded and literal description blocks", () => {
    expect(
      parseSkillMarkdown("---\nname: folded\ndescription: >\n  Use this skill\n  for mobile work.\n---\nBody")
        .description
    ).toBe("Use this skill for mobile work.");
    expect(
      parseSkillMarkdown("---\nname: literal\ndescription: |\n  First line.\n  Second line.\n---\nBody")
        .description
    ).toBe("First line.\nSecond line.");
  });

  it("deduplicates and sorts tags deterministically", () => {
    expect(sortTags([" review ", "mobile", "review", ""])).toEqual(["mobile", "review"]);
  });

  it("maps authentication and network failures to actionable messages", () => {
    expect(friendlyGitError(new Error("401 Unauthorized")).code).toBe("AUTH");
    expect(friendlyGitError(new Error("Network request failed")).code).toBe("NETWORK");
    expect(friendlyGitError(new Error("merge conflict")).code).toBe("CONFLICT");
  });
});
