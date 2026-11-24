---
version: 1
slug: "android-mobile"
primary_target: "android-mobile"
related_targets: []
---

# Android Mobile Repository Manager

## Scope

The compact-width Android application for a Git-backed skills repository. Operate mode. Primary screens are repository status, skills, presets, and settings. Skill and preset editors are full-height sheets or dedicated detail screens, not desktop dialogs.

## Task

Connect once, keep a persistent local clone, inspect current synchronization state, browse and search skills, edit content and metadata, organize presets, and ensure every change ends in a local commit followed by an automatic push attempt.

## Constraints

Material 3 navigation and interaction conventions, system Back support, 48 dp touch targets, safe-area and keyboard insets, dark theme, long labels, large repositories, offline and push-failure recovery. No local-agent controls and no “Apply to Agent” action.

## Direction contract

THESIS: A repository control room that stays useful in one hand. It refuses the desktop sidebar squeezed into a phone and makes sync state part of every editing decision.

OWN-WORLD: Android Material surfaces and tonal roles carry the established zinc neutrals and Skills Manager green. Typography is the system sans adapted to Material roles. Components use filled primary actions, outlined secondary actions, tonal status containers, navigation bar on compact screens and a rail on expanded widths.

STORY: The user sees whether the clone is current, finds a skill or preset in seconds, edits it confidently, and watches one action move from “pending” to “pushed” without wondering what happened.

FIRST VIEWPORT: Top app bar names the active area and exposes repository sync. On the repository screen, a compact status slab leads with branch plus pushed/pending state, followed by a two-up skills/presets count and a short recent-change list. A persistent four-destination navigation bar anchors the bottom; the primary create action is a single FAB only on library screens.

FORM: Established-world Android extension, selected directly from five structures: status dashboard with tab navigation, repository activity feed, library-first tabbed shell, preset-first workflow, and settings-first shell. The repository dashboard wins because sync confidence is the defining mobile problem.

seed: none (unavailable)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
