# Options chips redesign: tap-to-select + type-something + submit

Date: 2026-08-06 · Branch: `feat/options-select-submit` · Status: approved for implementation

## Why

The `<options>` blocks Claude renders at the end of replies are answered by tapping a chip. Today:

- Single tap sends that option immediately.
- Long-press enters a multi-select mode ("Run in sequence" + Cancel).

Charlie's verdict: long-press multi-select is 鸡肋. His natural gesture is "see option 1, tap it; see option 2, tap it too" — no long-press, no mode. He also wants to append free text before anything is sent (the original request that started this branch).

New model (mirrors Claude Code's AskUserQuestion feel): **tap toggles selection; a type-something box + Submit appear below; nothing sends until Submit.**

A debounce/auto-send timer ("wait 1–2 s after the last tap, then send") was considered and **rejected**: it fires while the user is still reading or thinking, cannot coexist with typing a supplement, and turns a mis-timed pause into a wrong message. Do NOT implement any timer. (If the extra Submit tap proves annoying in practice, a visible-countdown auto-submit can be layered on later as a separate feature.)

A previous design on this branch routed the selection into the main session composer via a `composerInjection.ts` event bus. That design is **superseded**; the file has been deleted. Do not recreate it, and do not touch `SessionView.tsx` / `MessageView.tsx` — the existing `onOptionPress` callback contract is kept intact.

## Current code

All changes live in ONE file:

`packages/happy-app/sources/components/markdown/parseMarkdownBlock.ts` parses `<options>` → `{ type: 'options', items: string[] }` (no change needed).

`packages/happy-app/sources/components/markdown/MarkdownView.tsx`:

- `RenderOptionsBlock` (~line 229–356): chip rendering, tap-to-send, long-press selection mode, "Run in sequence" composition, action row.
- Options styles (~line 686–765): `optionItem`, `optionItemSelected`, `optionItemPressed`, `optionRow`, `optionCheckIcon`, `optionCheck`, `optionCheckSelected`, `optionsActionsRow`, `optionsActionButton`, `optionsActionRun`, `optionsActionRunText`, `optionsActionCancel`, `optionsActionCancelText`, `optionsActionDisabled`.

Parent contract (unchanged, in `MessageView.tsx`): `onOptionPress({ title }) → sync.sendMessage(sessionId, title, { source: 'option' })`.

## New behavior

State inside `RenderOptionsBlock` (per-block local, not persisted, dies on unmount — same lifecycle as today):

```ts
const [selected, setSelected] = React.useState<Set<number>>(new Set());
const [note, setNote] = React.useState('');
const active = selected.size > 0 || note.length > 0;
```

1. **Tap a chip = toggle its selection.** Never sends. Remove the instant-send path, the long-press `enterSelection` entry, and the web `onContextMenu` suppression block (it existed only to catch long-press on web).
2. **Selected chip visual:** existing `optionItemSelected` border + a `checkmark-circle` Ionicon (color `optionCheckSelected`) at the start of the row — icon on selected chips ONLY. Unselected chips show no icon (no `ellipse-outline` placeholders; delete the now-unused `optionCheck` style).
3. **Action bar** renders below the chips when `active && props.onOptionPress`, in a column (gap 8):
   - A `TextInput` (import from `react-native`), full width, `multiline`, max height ≈ 3 lines (`maxHeight: 72`-ish with `lineHeight` 24), placeholder `Type something…`, placeholder color `theme.colors.textSecondary`. Surface styling matches `optionItem` (same platform-select background/border/radius/padding family). Do NOT autofocus it when the bar appears — keyboard should only open when the user taps the field.
   - The existing `optionsActionsRow` with two buttons:
     - **Submit** — reuse `optionsActionRun`/`optionsActionRunText` styles, hardcoded label `Submit` (matches the old hardcoded "Run in sequence" precedent; do not add i18n keys). Disabled (`optionsActionDisabled` + `disabled`) when `selected.size === 0 && note.trim().length === 0`.
     - **Cancel** — existing `optionsActionCancel` styles + `t('common.cancel')`. Clears `selected` and `note`, hides the bar.
4. **Submit composes one message** and hands it to the unchanged parent callback `props.onOptionPress({ title: composed })`, then resets state:
   - 0 selected, text only → the text as-is (trimmed).
   - 1 selected, no text → that option verbatim (byte-identical to today's single-tap payload).
   - 1 selected + text → `` `${option}\n${text}` ``.
   - N ≥ 2 selected → `['请依次完成以下事项：', ...chosen.map((t, i) => `${i + 1}. ${t}`)].join('\n')` (keep this exact existing format), plus `` `\n${text}` `` if text non-empty. `chosen` is in display order, as today.
5. **Text selectability:** chips currently pass `selectable={props.selectable && !inSelectionMode}`; new equivalent is `selectable={props.selectable && selected.size === 0}` so idle blocks in history stay copyable but selection gestures don't fight.
6. **SHOULD (skip if fiddly):** on web only, Enter (without Shift) inside the TextInput triggers Submit when enabled; Shift+Enter inserts a newline. Native keeps the button as the only trigger — don't wire `onSubmitEditing` on a multiline input.
7. Rewrite the stale comment block at the top of `RenderOptionsBlock` (currently describes long-press selection mode) to describe the new model.
8. The read-only branch (`props.onOptionPress` undefined, ~line 320–326) is unchanged.

## Non-goals

- No changes to `MessageView.tsx`, `SessionView.tsx`, `parseMarkdownBlock.ts`, AskUserQuestion tool cards, or happy-cli.
- No timers, no auto-send, no settings/flags, no i18n key additions, no draft persistence for `note`.
- Remove styles orphaned by this change (e.g. `optionCheck`); leave everything else untouched.

## Verification

From the worktree root `/Users/charliezong/Developer/happy-wt-options-fill`:

1. `pnpm install` (first run in this fresh worktree; several minutes is normal).
2. `pnpm --filter happy-app typecheck` (runs `tsc --noEmit`) — must pass.
3. No test suites; do NOT run vitest anywhere (happy-cli tests spawn real daemons).
