# Skills Manager Design System

## Surface map

- Desktop: dense, keyboard-friendly React/Tauri workspace using the existing zinc and green visual language.
- Android: Operate-mode repository manager using Material 3 structure while retaining the same brand accent and preset icon family.

## Android principles

1. Synchronization state is visible wherever a change can be made.
2. Navigation follows Android conventions: a compact-width navigation bar, an expanded-width rail, and system Back for every detail or sheet.
3. Editing is progressive: list → detail → full-height editor. Destructive actions interrupt through confirmation dialogs.
4. Repository metadata is shown as operational information, not decorative statistics.

## Color roles

Android tokens live in `src/mobile/mobile.css`.

- Background: `--md-bg`
- Surface: `--md-surface`
- Muted and raised surface: `--md-surface-muted`, `--md-surface-raised`
- Primary action: `--md-primary` with `--md-on-primary`
- Primary container: `--md-primary-soft` with `--md-on-primary-soft`
- Outline: `--md-outline`, `--md-outline-soft`
- Semantic containers: success, warning, info, and danger pairs

Light and dark are both first-class. Manual theme changes also update Android system-bar icon appearance.

## Typography

The Android surface uses the system sans face and default root size. Body and form text are 1rem; secondary rows use 0.875rem; labels use 0.75–0.875rem. Text uses `rem` so Android font scaling remains effective. Long names truncate in list rows and wrap in detail views.

## Layout

- Compact widths use a 64 dp top app bar and 74 dp bottom navigation bar with safe-area padding.
- Widths from 840 px use a 96 px navigation rail.
- Content is capped at 920 px.
- Every interactive target is at least 48×48 px.
- Full-height editor sheets become centered large sheets on expanded widths.

## Components

- Filled button: primary action such as save, clone, or sync.
- Outlined button: secondary recovery action.
- Text button: cancel or low-emphasis action.
- FAB: the single create action on Skills and Presets.
- Filter chips: mutually exclusive library filters.
- Switch row: preset membership assignment.
- Snackbar: transient save or sync feedback.
- Confirmation dialog: deletion and disconnect only.

## Interaction and motion

- Sheets enter from the bottom in 220 ms; confirmations use a short scale/fade in 180 ms.
- Loading uses progress copy during clone and inline spinners during network work.
- Reduced-motion preferences reduce all animations to effectively instant.
- Mutations disable their initiating controls and prevent dismissal until the local commit resolves.

## State coverage

Every repository surface supports loading, empty, populated, offline, pending push, diverged history, validation error, and destructive confirmation states. A failed push never removes the local commit; the dashboard and settings expose retry through the normal sync action.

## Accessibility

Controls expose names through visible text or `aria-label`, use native checkbox semantics for switches, and preserve focus styling. Dialogs use the native `<dialog>` element for focus containment and Escape handling. System Back closes the top sheet or returns from a detail view before exiting.
