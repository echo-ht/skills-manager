import {
  newId,
  type MobilePreset,
  type MobileRepository,
  type MobileSkill,
  type MutationResult,
  type PresetDraft,
  type RemoteInstallSession,
  type RemoteSkillInstallItem,
  type RepoConnection,
  type RepoSnapshot,
  type SkillDraft,
} from "./model";

const demoConnection: RepoConnection = {
  owner: "echo-ht",
  repo: "skills-demo",
  branch: "main",
  remoteUrl: "https://github.com/echo-ht/skills-demo.git",
};

function skill(
  id: string,
  name: string,
  description: string,
  tags: string[],
  presetIds: string[]
): MobileSkill {
  return {
    id,
    name,
    description,
    path: name,
    pathKey: name.toLocaleLowerCase("en-US"),
    enabled: true,
    tags,
    source: {
      type: "git",
      ref: "echo-ht/skills-demo",
      resolved: "https://github.com/echo-ht/skills-demo.git",
      subpath: name,
      branch: "main",
      revision: "89d45f61c2e4e6d3e7aa08d4e4f42161c39bd010",
    },
    content: `# ${name}\n\n${description}\n\n## When to use\n\nUse this skill when the task benefits from a focused, repeatable workflow.\n\n## Workflow\n\n1. Inspect the available context.\n2. Make the smallest complete change.\n3. Verify the result and report what changed.`,
    frontmatter: null,
    presetIds,
    updateStatus: "up_to_date",
    lastCheckedAt: Date.now() - 1000 * 60 * 5,
    lastCheckError: null,
  };
}

function initialSnapshot(): RepoSnapshot {
  const presets: MobilePreset[] = [
    {
      id: "preset-frontend",
      name: "前端交付",
      description: "设计、实现与浏览器验收",
      icon: "palette",
      sortOrder: 0,
      skillIds: ["skill-design-review", "skill-a11y", "skill-playwright"],
    },
    {
      id: "preset-writing",
      name: "写作与审校",
      description: "长文结构、事实核查和自然语言",
      icon: "notebook-pen",
      sortOrder: 1,
      skillIds: ["skill-writing", "skill-fact-check"],
    },
    {
      id: "preset-release",
      name: "发布检查",
      description: "版本说明与发布前核验",
      icon: "rocket",
      sortOrder: 2,
      skillIds: ["skill-release", "skill-playwright"],
    },
  ];
  const skills: MobileSkill[] = [
    skill("skill-design-review", "frontend-design-review", "审查界面层级、间距与移动端可用性", ["design", "review"], ["preset-frontend"]),
    skill("skill-a11y", "accessibility-audit", "检查触控尺寸、对比度与系统返回行为", ["design", "a11y"], ["preset-frontend"]),
    skill("skill-playwright", "playwright-verification", "驱动浏览器复现交互并收集视觉证据", ["testing"], ["preset-frontend", "preset-release"]),
    skill("skill-writing", "natural-writing", "去除模板化表达，保留事实与作者观点", ["writing"], ["preset-writing"]),
    skill("skill-fact-check", "fact-check", "为关键事实建立来源与证据链", ["writing", "research"], ["preset-writing"]),
    skill("skill-release", "release-check", "核对版本、变更记录与发布产物", ["release", "qa"], ["preset-release"]),
    skill("skill-git", "git-recovery", "诊断未提交改动、分叉与意外 reset", ["git", "recovery"], []),
  ];
  return {
    ...demoConnection,
    skills,
    presets,
    commits: [
      {
        oid: "89d45f61c2e4e6d3e7aa08d4e4f42161c39bd010",
        shortOid: "89d45f6",
        message: "Add accessibility audit workflow",
        author: "Desktop · MacBook",
        timestamp: Date.now() - 1000 * 60 * 38,
      },
      {
        oid: "7b3a641a1b29621ef5ebc7c62eb5f1f01d57cf6b",
        shortOid: "7b3a641",
        message: "Group release skills into preset",
        author: "Desktop · MacBook",
        timestamp: Date.now() - 1000 * 60 * 60 * 19,
      },
      {
        oid: "289c6b439f41507c5b3b1394f4cb3e366b8b530a",
        shortOid: "289c6b4",
        message: "Refine writing checklist",
        author: "Skills Manager Android",
        timestamp: Date.now() - 1000 * 60 * 60 * 26,
      },
    ],
    sync: {
      phase: "current",
      localHead: "89d45f61c2e4e6d3e7aa08d4e4f42161c39bd010",
      remoteHead: "89d45f61c2e4e6d3e7aa08d4e4f42161c39bd010",
      pendingChanges: 0,
      lastSyncedAt: Date.now() - 1000 * 60 * 4,
      message: null,
    },
  };
}

export class DemoRepository implements MobileRepository {
  readonly connection = demoConnection;
  private state = initialSnapshot();

  private result(): MutationResult {
    this.state = {
      ...this.state,
      commits: [
        {
          oid: "d".repeat(40),
          shortOid: "ddddddd",
          message: "Preview change",
          author: "Skills Manager Android",
          timestamp: Date.now(),
        },
        ...this.state.commits,
      ].slice(0, 6),
      sync: {
        ...this.state.sync,
        phase: "current",
        localHead: "d".repeat(40),
        remoteHead: "d".repeat(40),
        lastSyncedAt: Date.now(),
        message: null,
      },
    };
    return { snapshot: this.state, pushed: true, notice: null };
  }

  async snapshot(): Promise<RepoSnapshot> {
    return this.state;
  }

  async sync(): Promise<MutationResult> {
    return this.result();
  }

  async checkpoint(): Promise<MutationResult> {
    return this.result();
  }

  async saveSkill(draft: SkillDraft): Promise<MutationResult> {
    const existing = draft.id ? this.state.skills.find((item) => item.id === draft.id) : null;
    const id = existing?.id || newId();
    const next: MobileSkill = {
      id,
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      path: existing?.path || draft.name.trim().toLocaleLowerCase("en-US").replace(/\s+/g, "-"),
      pathKey: existing?.pathKey || draft.name.trim().toLocaleLowerCase("en-US").replace(/\s+/g, "-"),
      enabled: existing?.enabled ?? true,
      tags: draft.tags,
      source: existing?.source ?? {
        type: "local",
        ref: null,
        resolved: null,
        subpath: null,
        branch: null,
        revision: null,
      },
      content: draft.content,
      frontmatter: existing?.frontmatter ?? null,
      presetIds: existing?.presetIds ?? [],
      updateStatus: existing?.updateStatus ?? "local_only",
      lastCheckedAt: existing?.lastCheckedAt ?? null,
      lastCheckError: null,
    };
    this.state.skills = existing
      ? this.state.skills.map((item) => (item.id === id ? next : item))
      : [next, ...this.state.skills];
    return this.result();
  }

  async deleteSkill(skillId: string): Promise<MutationResult> {
    this.state.skills = this.state.skills.filter((item) => item.id !== skillId);
    this.state.presets = this.state.presets.map((preset) => ({
      ...preset,
      skillIds: preset.skillIds.filter((id) => id !== skillId),
    }));
    return this.result();
  }

  async savePreset(draft: PresetDraft): Promise<MutationResult> {
    const existing = draft.id ? this.state.presets.find((item) => item.id === draft.id) : null;
    const preset: MobilePreset = {
      id: existing?.id || newId(),
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      icon: draft.icon,
      sortOrder: existing?.sortOrder ?? this.state.presets.length,
      skillIds: existing?.skillIds ?? [],
    };
    this.state.presets = existing
      ? this.state.presets.map((item) => (item.id === preset.id ? preset : item))
      : [...this.state.presets, preset];
    return this.result();
  }

  async deletePreset(presetId: string): Promise<MutationResult> {
    const removed = this.state.presets.find((preset) => preset.id === presetId);
    this.state.presets = this.state.presets.filter((preset) => preset.id !== presetId);
    this.state.skills = this.state.skills.map((item) => ({
      ...item,
      presetIds: item.presetIds.filter((id) => id !== presetId),
    }));
    void removed;
    return this.result();
  }

  async setPresetSkill(presetId: string, skillId: string, included: boolean): Promise<MutationResult> {
    this.state.presets = this.state.presets.map((preset) => {
      if (preset.id !== presetId) return preset;
      return {
        ...preset,
        skillIds: included
          ? [...new Set([...preset.skillIds, skillId])]
          : preset.skillIds.filter((id) => id !== skillId),
      };
    });
    this.state.skills = this.state.skills.map((item) => {
      if (item.id !== skillId) return item;
      return {
        ...item,
        presetIds: included
          ? [...new Set([...item.presetIds, presetId])]
          : item.presetIds.filter((id) => id !== presetId),
      };
    });
    return this.result();
  }

  async reorderPreset(presetId: string, direction: -1 | 1): Promise<MutationResult> {
    const next = [...this.state.presets].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = next.findIndex((preset) => preset.id === presetId);
    const destination = index + direction;
    if (index >= 0 && destination >= 0 && destination < next.length) {
      [next[index], next[destination]] = [next[destination], next[index]];
    }
    this.state.presets = next.map((preset, sortOrder) => ({ ...preset, sortOrder }));
    return this.result();
  }

  async reorderPresetSkill(
    presetId: string,
    skillId: string,
    direction: -1 | 1
  ): Promise<MutationResult> {
    this.state.presets = this.state.presets.map((preset) => {
      if (preset.id !== presetId) return preset;
      const ids = [...preset.skillIds];
      const index = ids.indexOf(skillId);
      const destination = index + direction;
      if (index >= 0 && destination >= 0 && destination < ids.length) {
        [ids[index], ids[destination]] = [ids[destination], ids[index]];
      }
      return { ...preset, skillIds: ids };
    });
    return this.result();
  }

  async previewRemoteSkills(repoUrl: string): Promise<RemoteInstallSession> {
    return {
      originalUrl: repoUrl,
      cloneUrl: "https://github.com/example/community-skills.git",
      owner: "example",
      repo: "community-skills",
      branch: "main",
      subpath: null,
      revision: "preview-revision",
      tempDir: "/demo/remote-preview",
      skills: [
        {
          relPath: "skills/remote-review",
          name: "remote-review",
          description: "从 GitHub 仓库预览到的 Skill",
        },
        {
          relPath: "skills/release-notes",
          name: "release-notes",
          description: "生成结构化发布说明",
        },
      ],
    };
  }

  async cancelRemotePreview(): Promise<void> {}

  async installRemoteSkills(
    session: RemoteInstallSession,
    items: RemoteSkillInstallItem[]
  ): Promise<MutationResult> {
    const added = items.map((item) =>
      skill(
        newId(),
        item.name,
        session.skills.find((skill) => skill.relPath === item.relPath)?.description ?? "",
        ["github"],
        []
      )
    );
    for (const item of added) {
      item.source = {
        type: "git",
        ref: session.originalUrl,
        resolved: session.cloneUrl,
        subpath: session.skills.find((skill) => skill.name === item.name)?.relPath ?? null,
        branch: session.branch,
        revision: session.revision,
      };
      item.updateStatus = "up_to_date";
    }
    this.state.skills = [...added, ...this.state.skills];
    return this.result();
  }

  async checkRemoteUpdates(): Promise<MutationResult> {
    const candidates = this.state.skills.filter((item) => item.source.type === "git");
    if (candidates[0]) {
      this.state.skills = this.state.skills.map((item) =>
        item.id === candidates[0].id
          ? {
              ...item,
              updateStatus: "update_available",
              lastCheckedAt: Date.now(),
            }
          : item
      );
    }
    return {
      snapshot: this.state,
      pushed: true,
      notice: candidates.length ? "发现 1 个可更新的 Skill。" : "没有可检查的 GitHub Skill。",
    };
  }

  async updateRemoteSkills(
    skillIds: string[],
    onProgress?: (message: string) => void
  ): Promise<MutationResult> {
    onProgress?.("正在更新 GitHub Skill…");
    const ids = new Set(skillIds);
    this.state.skills = this.state.skills.map((item) =>
      ids.has(item.id)
        ? {
            ...item,
            updateStatus: "up_to_date",
            lastCheckedAt: Date.now(),
            content: `${item.content}\n\n<!-- updated from upstream -->`,
          }
        : item
    );
    return {
      ...this.result(),
      notice: `已更新 ${ids.size} 个 GitHub Skill。`,
    };
  }

  async cancelNetworkOperations(): Promise<void> {}
}
