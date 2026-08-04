# Pending Branches (待办分支) — Design Spec

Date: 2026-07-25
Status: Closed 2026-07-31 — partially built. Kept as the record of what was
  decided and why, not as a plan to work from.
  - Mechanism 1 (long-press multi-select → run in sequence) **shipped** in
    `3d412b16`, app-side only, exactly as specced below.
  - Mechanism 2 (`pendingBranches` storage + new-session cards) **dropped**:
    cross-session aggregation of pending work grew into its own project, which
    subsumes the todo-card half. Nothing here was implemented.
  - Reviewed as review#11, closed without merging.
Scope: happy-app (fork-only feature; `<options>` rendering does not exist upstream)

> **中文摘要**：解决"agent 给了一组选项，只做了一个，剩下的忘了"的痛点。两个机制：
> ① 长按选项 chip 进入多选模式，可把勾选的几项**合成一条消息依次执行**，或**存为跨设备同步的待办分支**；
> ② 新会话页 composer 上方显示待办分支卡片，点卡片跳回原会话并预填该选项（原会话已回收则填进当前新会话输入框）。
> 不自动记未选项、不识别正文散装建议、不做自动完成检测。

## Problem

When the agent presents an `<options>` block, tapping one option sends it and the
conversation moves on. The remaining options — which are often genuinely wanted
follow-up tasks, not mutually exclusive choices — have no home. The user goes down
one branch (often in a new session) and forgets the others.

Two usage patterns must be covered:

1. **Do several now**: pick multiple options and have the agent work through them
   in sequence.
2. **Do one now, others later**: park un-picked options somewhere durable and be
   reminded when starting a new session.

Auto-remembering un-picked options is explicitly rejected: many options blocks are
one-shot decision forks ("宽口径 vs 窄口径") whose losers must NOT become ghost
todos. The user marks what to keep — marked items are always genuine.

## 1. Data model

New field on the **synced** settings schema (`sources/sync/settings.ts` — Zod
schema + `settingsDefaults`; syncs cross-device via the existing encrypted
settings channel):

```ts
pendingBranches: Array<{
  id: string            // repo's existing uuid helper
  sessionId: string     // source session
  sessionName: string   // snapshot at mark time (session may be reaped later)
  text: string          // option text verbatim
  createdAt: number
}>
```

- Snapshot `sessionName` because the session reaper may delete the source session.
- Dedupe on insert by `(sessionId, text)` — re-marking the same option is a no-op.
- Cap the list at 50 entries (drop oldest) to keep the settings sync payload small.

## 2. Option-chip interaction

Files: `components/markdown/MarkdownView.tsx` (`RenderOptionsBlock`),
`components/MessageView.tsx` (handlers).

- **Single tap: unchanged.** Sends the option immediately via
  `sync.sendMessage(sessionId, option.title, { source: 'option' })`. The fast path
  must not regress.
- **Long-press any chip → selection mode** (`onLongPress`; works with mouse-hold
  on web). Chips show checkmarks; the long-pressed chip starts checked. Two action
  buttons appear below the block, plus Cancel (tapping outside also cancels):
  - **依次执行 (Run in sequence)**: compose ONE message —
    `请依次完成以下事项：\n1. <text>\n2. <text>…` — and send it via the same
    `sendMessage` path (`source: 'option'`). The agent sequences the work itself;
    no client-side turn scheduling.
  - **存为待办 (Save for later)**: append checked options to
    `settings.pendingBranches` (dedupe + cap as above). Brief confirmation toast;
    exit selection mode.
- Selection mode is per-options-block, ephemeral UI state only.
- Desktop hover affordance (small checkbox on hover) is a nice-to-have, NOT in v1.

## 3. New-session strip

File: `app/(app)/new/index.tsx` — insert above the composer (~line 2078 mobile
layout, ~line 2089 desktop `inlineConfigWrap`), as a new component
`components/PendingBranchesStrip.tsx`.

- Renders `settings.pendingBranches`, newest first, as compact cards:
  truncated option text + source session name + relative time + an `×` dismiss
  button (removes the entry from settings).
- Empty list → render nothing at all (zero footprint).
- No automatic "done" detection in v1; `×` is the only removal path besides tap-through.

## 4. Tap-through: jump & prefill

- **Source session still exists** (present in storage sessions): write the option
  text into that session's draft via a new small
  `storage.setSessionDraft(sessionId, text)` (write through the same path the
  composer's draft-save uses; the existing `useDraft` restore then pre-fills the
  composer on entry — only if the session's current draft is empty, never
  overwrite a non-empty draft), then `navigateToSession(sessionId)`. Remove the
  entry from `pendingBranches`.
- **Source session reaped**: do not navigate. Fill the option text into the
  current new-session composer so the user can run it as a fresh session. Remove
  the entry.
- Rationale for remove-on-tap: tapping is an explicit "I'm doing this now"; if the
  user backs out they can re-mark. Keeps the list self-cleaning.

## 5. Non-goals (YAGNI)

- No auto-pending of un-picked options.
- Only `<options>` blocks; no LLM detection of prose suggestions.
- No completion auto-detection (e.g. matching sent messages against entries).
- No sidebar changes; strip lives on the new-session page only.
- No upstream PR: `<options>` rendering is fork-only, so this feature is too.

## 6. Testing & verification

- Unit tests (vitest) for pure helpers: pendingBranches insert/dedupe/cap logic,
  the sequence-message composer, settings schema parse round-trip. Keep logic in
  pure functions — `storage.ts` cannot be imported in vitest (known repo
  limitation), so `setSessionDraft` gets manual verification only.
- UI: screenshots of (a) selection mode with both action buttons, (b) the
  new-session strip on desktop + mobile layouts, (c) tap-through prefill in the
  source session — per the fork's visual-evidence convention.

## 7. Implementation notes

- Branch: `feat/pending-branches` in a fresh worktree off `charlie-main` (never
  develop on `charlie-main` directly; merge back only after Charlie confirms).
  Reminder: no `pnpm install` while sessions are active on happy-integration.
- Touched files (expected): `sync/settings.ts`, `sync/storage.ts` (setSessionDraft),
  `components/markdown/MarkdownView.tsx`, `components/MessageView.tsx`,
  `components/PendingBranchesStrip.tsx` (new), `app/(app)/new/index.tsx`,
  i18n strings.
