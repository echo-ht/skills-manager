# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Stack

Capacitor 8 + React 19 + TypeScript + Vite, with a local Git working tree implemented by isomorphic-git and LightningFS.

## Users

People who already manage AI agent skills with Skills Manager on a desktop and need to review, organize, and change the same skills from an Android phone. The phone does not run Claude Code, Codex, Cursor, or another local agent, so agent installation state is not part of the Android job.

## Product Purpose

Give the remote skills repository a capable mobile control surface: browse the library, read skill instructions, create/edit/delete skills, manage presets and membership, then commit and push changes without returning to a computer. Success means a phone edit reaches the remote repository promptly and remains safe across network failures and upstream changes.

## Positioning

The desktop app manages agents locally and the remote repository is the shared truth. Android operates on a real local clone of that same repository rather than inventing a mobile-only database, so presets and metadata stay in the protocol the desktop app already reads.

## Operating Context

Used one-handed on the move, frequently on unreliable networks. The app may be opened after days without syncing. Users need to know whether the visible data is current, whether local edits are committed, and whether they have been pushed. Destructive edits must be explicit and recoverable through Git history.

## Capabilities and Constraints

- Connect with a GitHub HTTPS remote and personal access token. Convert `git@github.com:owner/repo.git` input to an HTTPS remote.
- Clone the repository into persistent app-local storage and reuse it on later launches.
- Pull upstream changes when safe; stop and explain instead of overwriting when histories diverge or files conflict.
- Skills CRUD, tags, preset CRUD, preset ordering, preset membership, icon/description editing, and skill ordering inside presets.
- Preset membership is repository curation only on Android. There is no Apply-to-Agent action because Android has no supported local agents.
- Edits become local Git commits and are pushed automatically. Failed pushes remain visible as pending and retryable.
- All writes preserve the `.skills-manager` JSON schema used by the desktop app.
- Personal access tokens are stored in Android secure storage, never repository files.
- Build APKs in GitHub Actions; local Android packaging is not required.

## Brand Commitments

Preserve the Skills Manager name, green accent, compact operational character, and the existing preset icon vocabulary. Translate the desktop product into Material 3 Android conventions rather than reproducing the desktop sidebar.

## Evidence on Hand

The desktop implementation, backup protocol, Chinese/English product documentation, app icon, and preset icon system exist in this repository. No real user credentials or production repository contents are included.

## Product Principles

1. The repository is the source of truth; local state must never hide pending or failed synchronization.
2. Fast editing never trades away recoverability: every successful change has a Git commit.
3. Mobile navigation shows the small set of primary areas directly and uses system Back predictably.
4. Familiar Android controls outrank decorative novelty.
5. A failed network request must preserve the user's work and offer a clear retry.

## Accessibility & Inclusion

Target Material touch sizes of at least 48 dp, scalable text, visible focus, screen-reader labels, dark theme, and layouts that survive long translated labels and Android font scaling.
