# design.md

Detailed specifications for planned/implemented features. See `CLAUDE.md` for the high-level phase summary and architecture conventions.

## Phase 2: Lock Picking Minigame

### Flow

1. GM runs `pf2eCustomizations.requestLockPick()`. A Dialog lets them pick the target PC (player-owned `character` actor) and the lock difficulty (a named tier, or a custom DC).
2. A `ChatMessage` is posted publicly, rendered from `lock-picking-chat-card.hbs`, storing the immutable `{ actorId, dc, pinCount, mistakeThreshold }` under `flags['pf2e-customizations'].lockPicking`. **`ChatMessage` has no `ownership` field in its v13 schema** (confirmed by reading `common/documents/chat-message.mjs` and `common/abstract/document.mjs#getUserLevel`, which falls straight to `NONE` for any document type lacking that schema field) — a player can never be granted write access to a GM-authored message, no matter what's passed as `ownership` at creation. So this message's flags are write-once; nothing is ever written back onto it.
3. Claim/outcome state instead lives on the **actor's** flags (`flags['pf2e-customizations'].lockPicking.<messageId>`), since the owning player already has real `OWNER` permission on their own PC — confirmed via the actor's stored `ownership` map, which does have explicit per-user `OWNER` entries. `lock-picking-chat.js` reads both: static config from the message, live `{ claimedBy, resolved }` from the actor, keyed by message id so multiple concurrent requests for the same actor don't collide.
4. `Hooks.on('renderChatMessageHTML', ...)` renders the card's status area on every draw. Because the live state now lives on the actor (not the message), updating it doesn't auto-trigger a chat redraw — `Hooks.on('updateActor', ...)` watches for `flags.pf2e-customizations.lockPicking` changes and manually refreshes any currently-rendered card referencing that actor.
5. Clicking "Attempt Lock" claims the attempt (best-effort optimistic check: write `claimedBy` on the actor, then re-read to confirm it settled to your own user id), then opens `LockPickingApp`.
6. The app opens to an **instructions** screen first; "Begin" generates pins fresh and moves to the **puzzle** screen. Closing from instructions (Cancel or the titlebar X) is a no-op `cancelled` result.
7. On resolution, the handler always clears `claimedBy` on the actor; if the puzzle was actually attempted (past Begin), it also writes the outcome to `resolved`. The GM's "Reset" button (critical-failure state) does the same via the actor flag — GM writes always succeed regardless of ownership, per `testUserPermission`'s unconditional GM bypass.

### DC tiers → pin count

Mirrors PF2e's real lock DCs (GM Core):

| Tier | DC | Pins |
|---|---|---|
| Simple | 15 | 2 |
| Average | 20 | 3 |
| Good | 25 | 4 |
| Superior | 30+ | 5 |

`pinCountForDc(dc) = clamp(2 + round((dc - 15) / 5), 2, 5)` — a custom DC buckets into the nearest tier's pin count.

### Modifier diff → window width

The acting character's `actor.system.skills.thievery.totalModifier` (already includes proficiency rank, ability modifier, and any item bonus from equipped thieves' picks — no manual tool detection needed) is compared against the lock's DC:

```
diff = totalModifier - dc
windowWidthPercent = clamp(18 + diff * 1.5, 6, 45)   // % of the 0-100 pin track
```

Read live when the puzzle opens (not snapshotted at request time), so buffs/penalties active at attempt time apply. All constants live in `LOCK_PICKING_CONFIG` in `lock-picking-logic.js` for easy tuning after playtesting — the 18/1.5/6/45 values are first-draft guesses.

### Mistakes and outcomes

- Missing a pin's window is a mistake: the pin resets to unset with a freshly randomized window (prevents memorizing exact position), the global mistake counter increments, the attempt continues.
- `mistakeThreshold` (world setting, default 3) is a "3 strikes" limit: reaching that many mistakes ends the attempt as **critical failure** immediately.
- Completing all pins with 0 mistakes is **critical success**; with ≥1 mistake, plain **success**.
- "Give Up" (or closing mid-puzzle) with ≥1 mistake or ≥1 pin set is a **failure** (matches PF2e RAW: a normal failure just means try again — the card stays attemptable). With zero progress, it's a silent **cancelled** (no chat update).
- A critical failure hides the attempt button and shows a GM-only "Reset" control (clears `resolved`/`claimedBy`) representing new tools being acquired.

### Tension feedback

A continuous visual meter (fill bar graded by proximity, red→green) made the puzzle trivial — a player could just watch for solid green and never actually engage with the mechanic. The current mechanic (rotational dial, `lock-picking-app.js`) gives no continuous visual hint of window position at all — proximity is only *felt*, via a resistance band just outside the tolerance window (jitter + a hard stop, see "Modifier diff → window width" for the tolerance/resistance math) and its accompanying audio, all local-only (`foundry.audio.AudioHelper.play({..}, false)`, never broadcast):

- `strain-loop.mp3` (looping, 0.5 volume): starts the instant the dial enters the resistance band, stops the instant it leaves (either back into the window or past the band into free rotation). This is the only "getting warm" signal — it carries all the proximity information a player has, since sustained strain is what risks a mistake.
- `click.mp3` (one-shot): plays on a successful **Set Pin**, i.e. the dial was inside the tolerance window when clicked.
- `mistake-snap.mp3` (one-shot): plays when sustained strain crosses the `strainMs` threshold and a mistake registers (the pin's window re-randomizes).
- `pick-break.mp3` (one-shot): plays once, on critical failure (mistake count hits `mistakeThreshold`), right before the shatter animation.
- **Known issue**: `strain-loop.mp3` and `mistake-snap.mp3` are perceptually similar (both short synthetic-sounding blips in the same ~2-2.5KB size range, likely from the same placeholder-generation pass) — worth replacing with more clearly distinct assets so a player can tell "I'm in the strain zone" from "that just cost me a mistake" by ear alone.

### Open implementation questions

1. `renderChatMessageHTML` is confirmed correct for v13 (verified directly against `client/documents/chat-message.mjs`, which calls `Hooks.callAll("renderChatMessageHTML", this, html, messageData)` and only fires the legacy jQuery `renderChatMessage` as a deprecated compatibility shim).
2. First use of `foundry.applications.api.ApplicationV2` / `HandlebarsApplicationMixin` in this codebase — smoke-test `DEFAULT_OPTIONS`/`PARTS`/`actions` wiring in-app before assuming the skeleton is exactly right.
3. The claim guard (write-then-reread) is best-effort optimistic locking, not a hard distributed lock — two clients claiming within the same server round-trip could theoretically both briefly believe they've won. Accepted as a low-probability UX edge case for tabletop use, not solved with a server component.
4. **Known limitation**: because live state is read from `actor.getFlag(...)`, a player who cannot see the target actor at all (e.g. its `ownership.default` is `NONE` and they aren't individually granted at least `LIMITED`) never receives the actor document client-side, so they won't see resolution outcomes on the card either — only owners/GM will. Not an issue for actors with the common `default: LIMITED`/`OBSERVER` setup (the tested actor had `default: LIMITED`), but worth knowing if a GM locks an actor down further.
5. Pin order is fixed left-to-right for v1, not randomized per attempt.
6. DC is never shown to players — the public chat card text omits it entirely, and the puzzle app's instructions/header only ever show pin count and actor name. A GM-only DC line is rendered into the chat card's DOM, client-side, only when `game.user.isGM` is true (`renderCard()` in `lock-picking-chat.js`), so it never appears in the message's shared/stored `content`. This is soft hiding (a player could still find it via devtools), matching the same trust model as the existing GM-only "Reset" button.
7. Tension feedback went through two prior versions before landing on audio ticks: a `color-mix()`-driven continuous bar rendered invisibly for at least one tester (likely an unsupported-syntax silent failure dropping the whole `background` declaration), and a plain-`rgb()` continuous fill bar fixed the visibility bug but made the puzzle trivially solvable by sight. See "Tension feedback" above for the current design.
8. The tick-grid approach (checking only the current value every `TICK_STEP` units) can miss a click tick during a very fast drag that jumps past the window entirely between two `input` events — acceptable for v1 since the mechanic rewards a slow, deliberate drag anyway.
9. Pre-existing doc/code mismatch fixed alongside this feature: README's defaults table now matches `itemDurabilityEnabled`'s actual `true` default.
10. **Known limitation**: the original slider-based interaction was keyboard-operable; the pointer-drag rotational dial that replaced it is not. Not solved for v1 — accepted trade-off, not gold-plated.

## Phase 3: Chronological Timeline Puzzle

### Flow

1. GM runs `pf2eCustomizations.requestTimelinePuzzle()`. A Dialog lets them pick the target PC, an "Investigate Skill" (any of PF2e's 16 `CONFIG.PF2E.skills` plus Perception, which isn't a `skills` member and is added as a manual option), a raw Task Target DC (any number — see "DC handling" below), a Circumstantial Mod (signed, default 0), and an "Allow Critical Outcomes" checkbox (default on).
2. On Send, the macro stores only these raw inputs (`actorId, dc, skillSlug, circumstanceMod, allowCriticalOutcomes`) on the `ChatMessage`'s flags, write-once — see "Data model" below for the rationale (mirrors lock-picking: `ChatMessage` has no `ownership` schema field in v13, so the message's flags are write-once). **Unlike an earlier version of this feature, nothing derived is baked in here** — grid size, the sampled event subset/order, the starting shuffle, and the clue set are all generated fresh later, at attempt time (step 4), not at request time. This was a deliberate design change: baking them in here meant re-attempting the same request (including after cancelling) replayed the exact same puzzle every time, which read as "always the same events, same order" — regenerating on each attempt fixes that directly.
3. Claim/outcome state lives on the **actor's** flags (`flags['pf2e-customizations'].timelinePuzzle.<messageId>`), exactly like lock-picking, for the same ownership reason. `Hooks.on('renderChatMessageHTML', ...)` + `Hooks.on('updateActor', ...)` keep the card in sync the same way.
4. Clicking "Attempt Timeline" claims the attempt (same optimistic-lock pattern as lock-picking), THEN generates the grid size, event subset/order, starting shuffle, clue set, and `neededRoll`/`clueMode` fresh (`onAttempt` in `timeline-puzzle-chat.js`, using the actor's live stat), and opens `TimelinePuzzleApp` with that freshly-generated content.
5. `TimelinePuzzleApp` opens to an **instructions** stage first (mirroring lock-picking exactly, including its own Handlebars-branch structure), unless the `timelinePuzzleHideInstructions` client setting is on, in which case it opens straight to a compact **ready** screen instead. Either way, clues, the event grid, and the countdown are **never** shown until the player explicitly clicks Begin/Start — even with instructions hidden, that click is still required, so the clock is never started automatically. A "?" help button is available on both the ready and active-puzzle screens, reusing the same instructions content as a mutually-exclusive Handlebars branch (`{{else if helpVisible}}`, same pattern as lock-picking) — never a CSS-toggled overlay sitting alongside the puzzle content, which was tried first and caused a real bug (the instructions text rendering twice, stacked, whenever the toggle class failed to apply). The clock keeps running in the background while help is open (the countdown element just isn't in the DOM to update, which `#tick()` already tolerates), so opening help never pauses it.
6. The player reorders event cards — a horizontal row, not a vertical list — by native HTML5 drag-and-drop or ◀/▶ buttons, and can click "Check Order" any time — a wrong guess is a free, unpenalized visual flash; there is no mistake counter or threshold (unlike lock-picking).
7. On a correct submission, the clock stops and the outcome is decided by how much of the time allowance was used. On expiration, the outcome is decided by how many blocks are in their correct index. Closing the window before either of those (titlebar X) resolves as `cancelled` and never writes `resolved` on the actor flag, matching lock-picking's fallback exactly.

### DC handling

DC is typically 15-40 but is a real PF2e check DC and can legitimately fall outside that band. The GM's entered DC is used **as-is** everywhere — grid-size lookup, `neededRoll`, and the GM-only display — and is never clamped. This works cleanly because the DC→grid-size table (below) is already open-ended at both extremes, so no special-casing is needed for a DC of, say, 10 or 45. Clamping was considered and rejected: it would have corrupted `neededRoll`'s odds calculation for any real check outside 15-40 (a DC 45 task the PC needs a natural 20-or-better for should compute that way, not as if it were DC 40).

### DC → grid size

Independent of the PC's stat — grid size (number of events) is derived from the DC alone:

| DC | Events |
|---|---|
| ≤15 | 3 |
| 16-25 | 4 |
| 26-35 | 5 |
| ≥36 | 6 |

### Time allowance

```
totalPcStat = live skill totalModifier (actor.system.skills[slug].totalModifier, or
              actor.system.perception.totalModifier for Perception) + stored circumstanceMod
baseTimeAllowanceSeconds = totalPcStat * 4 + 30
```

Read **live** when the puzzle opens (not snapshotted at request time) — buffs/penalties active at attempt time apply.

**Retuned once already**: the original constants were `*10 + 60` (matching the user-provided spec's own worked example, DC25/totalPcStat 6 → 120s). Playtesting found this too generous — an untrained (+0) character got a full minute for what's meant to be an easy puzzle, and a high-stat character could sail well past 2 minutes. Retuned to `*4 + 30`: untrained now gets 30s, and even a +20 stat (a genuinely high-op case) stays under ~2 minutes. Both constants live in `TIMELINE_PUZZLE_CONFIG` (`TIME_ALLOWANCE_PER_STAT_POINT`/`TIME_ALLOWANCE_BASE_SECONDS`) — a one-line change each if further retuning is needed.

### Clue completeness → the PC's odds, not the DC tier

This is a second, independent difficulty axis from grid size, based on how likely the PC is to succeed on the underlying roll:

```
neededRoll = clamp(dc - totalPcStat, 1, 20)   // minimum d20 result that would meet/beat the DC
clueMode = neededRoll <= 10 ? 'full' : 'reduced'
```

`neededRoll`/`clueMode`, like everything else in this section, are computed live at attempt time (not fixed at message creation) — this changed from an earlier version of the feature that fixed them at request time; see "Data model" below for why. **The GM-only chat card line does not show `clueMode` at all** — an earlier version showed a "live preview" of it there, but that phrase reads as unclear/alarming out of context (the GM can't tell from the wording alone that it's just a same-client estimate, not something exposed to players), and duplicating clueMode into the card added a second thing that could get out of sync with the actual attempt for no real benefit. The line now matches lock-picking's exactly: just `Task DC {dc}`, hidden from players the same way (`display:none` set in JS when `!game.user.isGM`, never written into the message's shared content — same soft-hiding caveat as lock-picking's own DC line, inspectable via devtools but absent from the normal UI).

Clue generation (`generateClueDescriptors` in `timeline-puzzle-logic.js`): for a true order of N events, there are N-1 "slots" (slot *i* = "order[i] immediately precedes order[i+1]"). The two boundary slots (touching the true first/last event) phrase as direct anchor clues ("X happens first" / "X happens last"); interior slots phrase as "X happens immediately before Y".
- `clueMode: 'full'` reveals all N-1 slots — this fully chain-determines the unique solution, no guessing required.
- `clueMode: 'reduced'` drops exactly one random slot (boundary or interior, no distinction) entirely, leaving exactly N-2 clues and one genuine gap. The player resolves it by trial — cheap, since a wrong Check Order costs nothing.

An earlier draft of this algorithm tried to *substitute* a weaker clue when a boundary slot was dropped (to avoid ever stating something false), but that kept the total at N-1 in the boundary case instead of N-2, contradicting the "reduced = N-2" requirement. Plain omission (any slot, no substitution) is simpler and always correct.

Edge case: at `eventCount === 3`, both slots are boundary slots — a 3-event full-mode puzzle has only "first"/"last" anchor clues, never "X before Y" phrasing. Accepted: the third event is fully determined by elimination.

### Data model

**ChatMessage flag** (`flags['pf2e-customizations'].timelinePuzzle`, write-once): `{ actorId, dc, skillSlug, circumstanceMod, allowCriticalOutcomes }` — just the GM's raw inputs, nothing derived. **This changed from an earlier version**, which also baked in `eventCount, solutionOrder, displayOrder, neededRoll, clueMode, clues` at request time (mirroring lock-picking's fixed-at-creation `pinCount`). That made sense for lock-picking, where the "lock" is a specific object in the fiction that shouldn't change between attempts — but the timeline puzzle's events are context-free/abstract with no such continuity requirement, and fixing them per-message meant re-attempting the same request (including after cancelling) always replayed the identical puzzle. Moved to generating everything fresh in `onAttempt()` instead (see "Flow" and "Time allowance"/"Clue completeness" above) — every attempt is now a genuinely new puzzle, whether it's a brand new GM request or a re-attempt of an existing one.

`solutionOrder`/`displayOrder` (now transient, held only in `TimelinePuzzleApp`'s private state, never stored on the message) are arrays of event-bank entries — see `EVENT_BANK_IDS` in `timeline-puzzle-logic.js`. `clues` (also transient) is the array of structured clue descriptors generated once per attempt and passed into the app; regenerating per attempt (rather than per chat-render) matters because chat cards redraw often — e.g. via the `updateActor` hook — and re-rolling on every redraw would silently change the puzzle underneath a player mid-attempt. Generation happens exactly once, in `onAttempt()`, before `TimelinePuzzleApp.run()` is called, and stays fixed for the lifetime of that one attempt.

**`EVENT_BANK_IDS` content model changed**: originally a small (14-entry) pool of abstract, flavor-neutral, localized placeholders ("Event Alpha", "Event Beta", ...), matching lock-picking's zero-narrative-content precedent. Replaced with a GM-authored, fantasy-themed pool of ~100 full display-text entries (e.g. `'The Shattering of the Moon'`). Each entry now serves as **both** the internal identifier and the displayed card text directly — there is no localization indirection for these anymore (`#eventLabel` was removed from `TimelinePuzzleApp`; card labels are the raw array entries). This is a deliberate trade-off: GM-authored campaign flavor text doesn't need per-locale translation the way the module's own fixed UI copy does, and routing it through `game.i18n.localize('...event.<entry>')` would require hand-maintaining a matching translation-key entry for every single item — the exact mismatch that caused entries to render as raw untranslated keys when the pool was first swapped in. Two invariants this content model depends on: every entry must be **unique** (duplicates would make two cards indistinguishable and could confuse position-based comparisons), and the pool must have **at least 6 entries** (to cover the Expert grid-size tier).

**Actor flag** (`flags['pf2e-customizations'].timelinePuzzle.<messageId>`, mutable): `{ claimedBy, resolved }` where `resolved` is `null` or one of `'criticalSuccess' | 'success' | 'failure' | 'criticalFailure'` — same shape as lock-picking.

### Outcomes

- Correct submission within the first 25% of `baseTimeAllowanceSeconds` elapsed → **criticalSuccess**.
- Correct submission any time after that (but before expiration) → **success**.
- Timer expires with ≥1 event block in its correct index → **failure**.
- Timer expires with 0 correct → **criticalFailure**.
- If the GM unchecked "Allow Critical Outcomes" at request time: criticalSuccess collapses to success, criticalFailure collapses to failure.
- No mistake-penalty or lockout mechanic: unlike lock-picking's mistake-threshold → broken-pick → GM Reset flow, a wrong Check Order is free and unlimited, and **all four resolved outcomes stay freely re-attemptable** via a fresh GM request — there is no GM Reset control for this feature.

### Open implementation questions

1. Clue-drop algorithm simplified to plain random omission (see "Clue completeness" above) rather than a considered substitute-a-weaker-clue approach, after the substitution version was found to keep the wrong total clue count in the boundary-drop case.
2. GM-only card line shows both `dc` and `clueMode` (full/reduced) — purely additive over lock-picking's DC-only precedent, since clue mode is useful tuning feedback the GM otherwise can't see. Trim if unwanted.
3. Skill dropdown is sorted alphabetically by localized label (16 `CONFIG.PF2E.skills` entries plus a manually-added Perception option) rather than appending Perception at the end.
4. No lockout/reset flow on `criticalFailure` — see "Outcomes" above. Flag for reconsideration if playtesting shows a lockout is actually wanted.
5. First use of native HTML5 drag-and-drop in this codebase (dragstart/dragover/drop) — lock-picking's pointer-drag dial is a different, non-reusable interaction model. Reorders always go through both drag-and-drop and ◀/▶ buttons (`moveLeft`/`moveRight` — the grid is a horizontal row of cards, not a vertical stack), keeping a single `#displayOrder` array as the source of truth; the DOM is patched directly (existing block nodes re-appended in the new order) rather than triggering a full ApplicationV2 re-render, to avoid disrupting the running timer or in-progress drag state — same rationale lock-picking used for updating its dial transform directly via DOM. Each card also shows a live 1-based position badge, updated in the same DOM pass as the button disabled-states. Firefox requires `dataTransfer.setData(...)` to be called during `dragstart` or the drag never initiates at all; the id itself is read back from a private field, not from the transfer payload, but `setData` still has to be called for the drag to start.
6. Instructions gate: `TimelinePuzzleApp` has a `#stage` ('instructions'/'puzzle') exactly like lock-picking, controlled by the `timelinePuzzleHideInstructions` client setting — but unlike lock-picking, hiding the instructions text does **not** skip straight into an already-running puzzle. A second gate, `#started`, is independent of `#stage` and always starts `false`; clues/grid/countdown are absent from the rendered DOM (not just CSS-hidden) until a single `begin` action (shared by both the instructions screen's "Begin" button and the compact ready-screen's "Start" button) sets `#started = true` and re-renders. This guarantees the countdown never starts without an explicit player click, regardless of the instructions-hidden setting.
7. **Fixed bug**: the help button initially reused the instructions content as an always-in-DOM overlay toggled purely by a CSS `.is-visible` class (to dodge a full re-render). If that class ever failed to apply, the overlay rendered as an ordinary block element stacked below the real stage content instead of hidden — showing the instructions text twice, breaking the puzzle's layout, and making the grid unusable. Replaced with a proper `{{else if helpVisible}}` Handlebars branch, exactly mirroring lock-picking's proven approach: instructions/help/puzzle-content are now mutually exclusive by construction, not by a CSS toggle that can silently fail. A full re-render on help toggle is safe here because the timer-start logic keys off `#startTimestamp === null`, not off "is this the first render," so it never restarts the clock or loses `#displayOrder`/clue state.
8. **Fixed bug**: the `moveUp`/`moveDown` buttons carry `data-event-id` (so their click handler can read which event they belong to), but `#wireDragAndDrop`/`#renderGrid`/`#updateMoveButtonStates` all originally queried the grid with the bare attribute selector `[data-event-id]` — which matched those buttons in addition to their parent `.timeline-event-block` `<li>`. On the very first reorder, `#renderGrid()`'s node-by-id map got polluted by the buttons (competing for the same key as their parent), and `appendChild`-ing them ripped them out of their `<li>` and re-parented them as direct siblings in the grid — corrupting the DOM, breaking further clicks, and looking "mixed up" exactly as reported. Fixed by scoping all three call sites to the `.timeline-event-block` class selector, which only the actual blocks carry.
9. The instructions screen originally had a Cancel button (mirroring lock-picking's `cancelInstructions` action) but was removed — the "don't show this again" checkbox already covers the only real reason to back out at that stage, and the titlebar close button still resolves as `cancelled` via the existing `_onClose` fallback, so a dedicated in-content Cancel was redundant.
10. **Superseded**: event bank size was originally 14 entries (see "Data model" above for the switch to a ~100-entry GM-authored fantasy pool, which also resolves the repetition concern this item originally flagged).
