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

## Phase 4: The Alibi Matrix

A full logic-grid deduction puzzle ("Zebra puzzle" style), the third investigation minigame alongside lock-picking and the timeline puzzle. Built directly on the timeline puzzle's **final** (already-debugged) architecture rather than its original one — see "Architecture lessons applied from the start" below.

### Flow

1. GM runs `pf2eCustomizations.requestAlibiMatrix()`. Same Dialog shape as the timeline puzzle: target PC, "Investigate Skill" (16 `CONFIG.PF2E.skills` + manually-added Perception), a raw Task Target DC (never clamped — see "DC handling"), a Circumstantial Mod (signed, default 0), an "Allow Critical Outcomes" checkbox (default on).
2. On Send, the macro stores **only the GM's raw inputs** (`actorId, dc, skillSlug, circumstanceMod, allowCriticalOutcomes`) on the `ChatMessage`'s flags, write-once. Nothing derived — matrix dimensions, the suspect/room/motive selection, the solution permutations, and every clue — is generated at request time at all.
3. Claim/outcome state lives on the **actor's** flags (`flags['pf2e-customizations'].alibiMatrix.<messageId>`), same rationale and shape as the other two features.
4. Clicking "Attempt Matrix" claims the attempt (same optimistic-lock pattern), THEN calls `generateAttempt()` fresh (in `onAttempt()`, using the actor's live stat at that moment) to produce the matrix dimensions, solution, grids, and clues, and opens `AlibiMatrixApp` with that freshly-generated content. Re-attempting the same request — including after cancelling — always gets a genuinely new matrix.
5. Same instructions/ready/help/started gate as the timeline puzzle: `#stage` controls the full instructions text (skippable via `alibiMatrixHideInstructions` client setting), `#started` is independent and always starts `false`, and a single `begin` action (shared by the instructions screen's Begin and the compact ready-screen's Start) is the only thing that reveals clues/grids and starts the clock. No Cancel button on the instructions screen (same reasoning as timeline's — the checkbox + titlebar close cover it).
6. The player clicks grid cells to cycle blank → ✗ (impossible) → ✓ (true) → blank, and can click "Check Matrix" any time — a wrong submission is a free, unpenalized visual flash; no mistake counter, no lockout.
7. On a correct submission (all grids simultaneously fully and correctly filled), the clock stops and the outcome is decided by elapsed-time percentage. On expiration, the outcome is decided by how many whole grids ended up fully correct. Closing the window before either (titlebar X) resolves as `cancelled` and never writes `resolved`.

### Architecture lessons applied from the start

Two things the timeline puzzle only arrived at after real bugs are built into this feature from the first draft, not retrofitted:
- **Nothing randomized is baked into the `ChatMessage`.** Timeline originally fixed its solution/clues at request time, which meant re-attempting the same request replayed an identical puzzle — a real complaint that took an architecture change to fix. Alibi Matrix generates everything fresh in `onAttempt()` from day one.
- **CSS uses `!important` on every structural property from the first draft**, and grid cells are plain `<div data-action="cycleCell">` elements, not `<button>` — timeline's move-buttons lost their positioning to (most likely) Foundry's own aggressive base `<button>` styling, and `<div>` sidesteps that class of bug entirely. Foundry's `actions` dispatch framework works on any element carrying `data-action`, not just buttons.

### DC handling

Same principle as the other two features: DC used exactly as entered, never clamped — the DC→dimensions table is open-ended at both extremes.

### DC → matrix dimensions

| DC | Tier | Categories | Items/category | Grids shown |
|---|---|---|---|---|
| ≤15 | Easy | 2 (Suspect, Room) | 3 | 1 (Suspect×Room) |
| 16-25 | Medium | 2 (Suspect, Room) | 4 | 1 (Suspect×Room) |
| 26-35 | Hard | 3 (+ Motive) | 3 | 3 (Suspect×Room, Suspect×Motive, Room×Motive) |
| ≥36 | Expert | 3 (+ Motive) | 4 | 3 |

Three GM-editable content banks (`SUSPECT_BANK`, `ROOM_BANK`, `MOTIVE_BANK` in `alibi-matrix-logic.js`, 12 entries each by default) — each entry used directly, verbatim, as both identifier and displayed text, no localization indirection (the exact lesson learned from timeline's event-bank bug). Each bank needs ≥4 unique entries to cover Expert tier; enforced by convention/comment only, not a runtime check — a GM who trims a bank below 4 entries during Expert-tier play would hit a silent `undefined` from `slice(0, n)`.

### Time allowance

```
totalPcStat = live skill totalModifier (or actor.system.perception.totalModifier for Perception)
              + stored circumstanceMod
baseTimeAllowanceSeconds = totalPcStat * 7 + 50
```

Read **live** in `onAttempt()`, same philosophy as the other two features. Tuned as a "moderate middle ground": more generous than the timeline puzzle's own tuned values (a genuinely harder puzzle type — more categories, more clue types to cross-reference per attempt), but well short of a straight `*10+60`-style formula, which drew explicit "too generous" feedback on the timeline puzzle. Untrained (+0) gets 50s; a +20 stat gets ~3:10.

### Clue completeness → the PC's odds, not the dimension tier

Identical axis to the timeline puzzle: `neededRoll = clamp(dc - totalPcStat, 1, 20)`, `clueMode = neededRoll <= 10 ? 'full' : 'reduced'`. Computed live in `onAttempt()` — not fixed at request time (there is no "request time" generation step at all for this feature, see "Architecture lessons" above).

### Solution generation

One suspect list, one room list, and (if 3-category) one motive list are sampled (shuffle + slice) from their banks. `permRoom` is a random bijection suspect-index → room-index; if 3-category, `permMotive` is a SECOND, INDEPENDENT random bijection suspect-index → motive-index. These permutations ARE the truth — the events are context-free, same philosophy as the timeline puzzle's `sampleTrueOrder`.

### Grid derivation (2-category: 1 grid; 3-category: 3 grids)

Each grid needs a `trueColForRow` array (length N) giving, for each row index, the column index that's actually true. **This needs care for the Room×Motive grid specifically**: `permRoom`/`permMotive` are both indexed by *suspect*, but the Room×Motive grid's rows are *rooms*, not suspects — naively reusing suspect-indexed pairs for that grid would silently misattribute every clue and cell-check on it to the wrong room. The correct derivation inverts through the shared suspect index:

```js
if (gridKey === 'suspectRoom')   trueColForRow[i] = permRoom[i];            // i = suspect index
if (gridKey === 'suspectMotive') trueColForRow[i] = permMotive[i];          // i = suspect index
if (gridKey === 'roomMotive')    trueColForRow[permRoom[i]] = permMotive[i]; // row = room index
```

This is a valid N-length bijection on the Room×Motive grid: `permRoom` is onto, so every room index gets exactly one assignment; `permMotive` is injective, so two different rooms (via two different suspects) can never collide on the same motive. A dedicated Plan-agent validation pass caught this as a real bug in an earlier draft of this design (which used the suspect-indexed pairs directly for all three grids) before any code was written.

### Clue generation

Same accepted philosophy as the timeline puzzle: generate a reasonable clue budget scaled by `clueMode`, do **not** attempt to guarantee unique logical solvability via a real constraint solver — genuine ambiguity is resolved by free, unpenalized, unlimited Check Matrix attempts. Two always-true-by-construction primitives:

- **Negative clue** (one per grid, any of the 1-3 grids): pick a row, pick a column that is NOT that row's true column, state "{row item} was not {col item}" (or, for the Room×Motive grid, an impersonal phrasing per the spec's own "Exclusive Clue" example: "The person motivated by {motive} was not in {room}" — treated as the same underlying primitive, just phrased differently when the grid doesn't name a suspect directly). One clue per row (N total) in `full` mode; one row dropped at random in `reduced` mode (N-1) — independently per grid, never sharing one dropped index across multiple grids.
- **Connected/disjunction clue** (only when `categoryCount === 3` — nothing to connect across with just Suspect×Room): for each suspect, state "{suspect} was either in {decoy or true room} or motivated by {true or decoy motive}" with exactly one side genuinely true (chosen randomly per clue) and the other a deliberate decoy — true by construction regardless of which side is real. One per suspect (N) in `full` mode, one dropped in `reduced` mode (N-1).

**Accepted design gap**: unlike the timeline puzzle's "full" clue mode, which fully chain-determines a unique solution, Alibi Matrix's "full" clue budget does **not** guarantee a uniquely solvable matrix even at N=3 — one negative clue per row eliminates only 1 of the N-1 wrong columns per row, and nothing here mathematically forces uniqueness the way timeline's adjacency chain does. This is consistent with the stated philosophy above, not a bug — flagged explicitly so it isn't mistaken for a regression relative to timeline's stricter guarantee.

### Validation and outcomes

A grid is "fully correct" iff exactly N cells are in `check` state AND every one of them is a true pair — if the count is right but any checked cell is wrong, at least one correct cell is necessarily missing too (since a wrong cell displaced it to keep the count at N), so a simple `length === N && every(isTrue)` check correctly rejects every malformed case (too many checks, too few, right count but wrong cells).

- Correct submission (all grids simultaneously fully correct) within the first 25% of `baseTimeAllowanceSeconds` elapsed → **criticalSuccess**; 26-100% → **success**.
- Timer expires with ≥1 whole grid fully correct → **failure** (per spec, this is still plain failure, not a partial-credit tier). 0 grids fully correct → **criticalFailure**.
- If `allowCriticalOutcomes` is off: criticalSuccess collapses to success, criticalFailure collapses to failure.
- No mistake-penalty or lockout mechanic, same as the timeline puzzle — all four outcomes stay freely re-attemptable via a fresh GM request.

### Data model

**ChatMessage flag** (`flags['pf2e-customizations'].alibiMatrix`, write-once): `{ actorId, dc, skillSlug, circumstanceMod, allowCriticalOutcomes }` — raw GM inputs only, nothing derived.

**Actor flag** (`flags['pf2e-customizations'].alibiMatrix.<messageId>`, mutable): `{ claimedBy, resolved }`, same shape as the other two features.

### Interaction and window sizing

Grid cells are plain `<div data-action="cycleCell" data-grid-index data-row data-col role="button" tabindex="0">` elements (not `<button>` — see "Architecture lessons" above), cycling state on click via a direct DOM patch (class + textContent), never a full re-render — same "don't disrupt the running timer" principle as the timeline puzzle's card reordering. The puzzle window's width varies per attempt: `AlibiMatrixApp.run()` passes `position: { width: categoryCount === 3 ? 1080 : 420 }` as an instance-level constructor option (merged over `DEFAULT_OPTIONS.position` before first paint, since both sibling apps already spread `...options` into `super(options)`), so 3-category puzzles get enough room to show all three grids side by side without a post-render resize/flash.

### Open implementation questions

1. `buildSkillOptions()`/`skillLabel()` are duplicated a third time in `request-alibi-matrix.js` (the timeline puzzle already duplicates rather than importing from lock-picking) — consistent with this module's existing no-shared-logic-module-between-features convention, but worth reconsidering if a fourth skill-based feature appears.
2. Negative/connected clues are generated independently per grid/per suspect with no de-duplication pass — two clues could restate very similar information (e.g. two negative clues on different grids both excluding the same suspect from different wrong values). Not fixed; a minor flavor-variety concern, not a correctness one.
3. See "Clue generation" above for the accepted full-mode-doesn't-guarantee-uniqueness gap relative to the timeline puzzle's stricter chain-determined guarantee.
4. Default content banks (12 suspects/rooms/motives each) are generic mystery-novel names, not matched to any particular campaign setting — same "GM can reskin freely" expectation as the timeline puzzle's event bank, demonstrated by the user replacing that bank's content directly after the feature shipped.
5. **Open bug**: grid cells (the `<div data-action="cycleCell">` elements) are currently reported as not responding to clicks at all. Ruled out so far: Foundry's action-dispatch framework has no tag-type restriction (traced directly in `application.mjs`'s `_attachFrameListeners`/`#onClick`/`#onClickAction` — delegation is via `event.target.closest("[data-action]")`, works on any element); `pointer-events`/`[role="button"]`-keyed base Foundry CSS (checked directly, neither exists). Also clarifying a previously-inaccurate claim: this `<div>`-not-`<button>` choice was a *proactive* design decision for these specific small (36×36px) fixed-size cells, not a retrofit fix for a proven button bug — timeline-puzzle's own small move-buttons are, and always have been, real `<button>` elements with `!important`-forced sizing, and they work correctly today. Root cause still unknown pending browser-console/inspect-element diagnostics. `fact-sifter` (Phase 5) deliberately used `<button>` for its own interactive rows specifically to avoid depending on this unresolved pattern.

## Phase 5: The Fact Sifter

An information-filtration puzzle, the fourth investigation minigame alongside lock-picking, the timeline puzzle, and the alibi matrix. The player is shown a shuffled pool of short text "fragments" — a coherent chain of mutually-supportive true facts mixed with deceptive noise (direct contradictions of specific facts, plus pure filler) — and must highlight exactly the true fragments while filtering out the rest, against a countdown timer. Built directly on alibi-matrix's/timeline-puzzle's **final** (already-debugged) architecture from the start.

### Flow

1. GM runs `pf2eCustomizations.requestFactSifter()`. Same Dialog shape as the other two features: target PC, "Investigate Skill" (16 `CONFIG.PF2E.skills` + manually-added Perception), a raw Task Target DC (never clamped), a Circumstantial Mod (signed, default 0), an "Allow Critical Outcomes" checkbox (default on).
2. On Send, the macro stores only the GM's raw inputs on the `ChatMessage`'s flags, write-once. No pool/scenario generation happens at request time at all.
3. Claim/outcome state lives on the actor's flags, same shape and rationale as the other three features.
4. Clicking "Attempt Sift" claims the attempt, THEN calls `generateAttempt()` fresh (in `onAttempt()`) to produce the fragment pool, and opens `FactSifterApp` with it. Re-attempting the same request — including after cancelling — gets a genuinely regenerated pool each time.
5. Same instructions/ready/help/started gate as the other features — `#stage` controls the full instructions text (skippable via `factSifterHideInstructions` client setting), `#started` is independent and always starts `false`, and a single `begin` action is the only thing that reveals fragments/countdown and starts the clock. No Cancel button.
6. The player clicks fragment rows to toggle highlight on/off (binary, not alibi-matrix's tri-state), and can click "Confirm Findings" any time — a wrong submission is a free, unpenalized visual flash; no mistake counter, no lockout.
7. On an exact-match submission (selected set === true-fact set, both count and content), the clock stops and the outcome is decided by elapsed-time percentage. On expiration, the outcome is decided by the ratio of correct-to-selected fragments. Closing the window before either (titlebar X) resolves as `cancelled` and never writes `resolved`.

### DC handling

Same principle as the other three features: DC used exactly as entered, never clamped. The DC→pool-size table below is a fixed 4-tier lookup, open-ended at both extremes — "never clamped" means the raw DC drives the bucket lookup, not that pool size grows unboundedly with extreme DC values.

### No `neededRoll`/`clueMode` axis

Unlike timeline-puzzle and alibi-matrix (which both have a secondary "clue completeness vs. the PC's odds" axis because their specs explicitly asked for one), Fact Sifter's difficulty is driven by DC alone — pool size and noise ratio come straight from the table below. Deliberately not inventing a secondary axis; not every feature needs identical mechanical depth.

### DC → pool size

| DC | Tier | True Facts | Noise Fragments | Total Pool |
|---|---|---|---|---|
| ≤15 | Easy | 3 | 3 | 6 |
| 16-25 | Medium | 4 | 5 | 9 |
| 26-35 | Hard | 5 | 7 | 12 |
| ≥36 | Expert | 6 | 10 | 16 |

### Content model

Bank content (`FACT_CHAIN_BANK` in `fact-sifter-logic.js`) is pre-authored, GM-editable text used directly, verbatim — no `game.i18n.localize` indirection, the same lesson learned from timeline-puzzle's event-bank bug. Two independent scenarios, each a chain of exactly 6 pre-written `{ fact, noise: [option1, option2] }` links plus a per-scenario `irrelevantNoise` pool of 8 pure-filler texts. Every fact/noise/irrelevantNoise string within a scenario must be pairwise unique (convention only, not runtime-checked).

**Authoring rule for chain links (REQUIRED, learned from a real playtest incident)**: fact `i≥2` must verbatim-restate one specific, checkable token from fact `i-1`'s TRUE value, in **all three** of its own variants (true + both noise options) — varying only its own newly-introduced detail. This is what makes the chain traceable once fragments are shuffled into a flat, order-scrambled list: a player scans the pool for the sentence containing that exact token, and disambiguates among its ~3 candidates using the rest of the chain they've already anchored.

The original v1 content (a sci-fi signal/sector scenario and a ledger/clerk-station scenario, since replaced — see "Fantasy reskin" below) violated this rule by using implicit pronoun references ("that entry", "an offline station") instead of a restated token. A player reported the puzzle was "basically just chance and guessing" and pasted an actual Medium-tier attempt where fact 1 ("4,120 credits") and fact 2 ("That entry was logged under...") shared zero verbatim token — completely unlinked once shuffled, since a pronoun has no fixed antecedent among several candidate sentences. Both scenarios were rewritten to restate a concrete token at every link and verified with a scripted per-link token-presence check plus a full-pool uniqueness/collision check. Any new scenario added to the bank must follow the same rule or risk reintroducing unsolvable content.

**Two follow-up bugs found via a second playtest report, both in the "verified" v2 content** — the initial verification script only checked that the token appeared in all three of the *next* fact's variants, which turned out to be necessary but not sufficient:

- **Not an exact substring.** Fact `i`'s own TRUE text must contain the *literal* token fact `i+1` restates, not a close paraphrase. Scenario A's fact 5 said "six **hours**" while fact 6 restated "six**-hour**"; Scenario B's fact 3 said "entire **prior** shift" while fact 4 restated "entire shift" (no "prior"). Neither is an exact substring match, so a player scanning for the exact phrase from fact 6/4 would never find its source in fact 5/3 — the link silently didn't exist. Fixed by rewording the earlier fact to literally contain the phrase the later fact restates.
- **Token leaking into the fact's own noise.** The forward token must appear in fact `i`'s TRUE variant *only* — if it also appears in one of fact `i`'s own noise options, then restating it one link later no longer disambiguates between them (both look equally corroborated). This is exactly what a player hit: they correctly found 3 fragments containing "vacant" (Scenario A facts 3 and 4's true values, plus one drawn noise option for fact 4), but fact 4's noise option "an unattended relay in **Sector C**..." also contained the literal phrase "unattended relay" — the same token fact 5 restates — so two of the three "vacant"-containing fragments were indistinguishable via that token. Fixed by rewording the colliding noise option to avoid the phrase entirely.

Both issues are now checked by the same verification script (three checks per link: token is an exact substring of fact `i`'s TRUE text; token appears in all three of fact `i+1`'s variants; token does NOT appear in fact `i`'s own noise options) before any chain content is considered done.

**~~Accepted structural limitation~~ (superseded — see "Closing leads" below)**: the *first* fact in a chain has nothing to corroborate against (it's the anchor, but gets corroborated forward via fact 2 restating its token instead), and the *last* fact in any truncated tier-prefix has no forward corroboration for its own newly-introduced detail (the fact that would restate it doesn't exist in the pool at that tier). This was originally accepted as a bounded (~3-way) judgment call mitigated by free retries — a fourth playtest report showed that framing was too generous; see below.

**Fantasy reskin (third playtest round)**: the shipped content — signal relays, sector designations, credits, clerk stations — read as sci-fi/cyberpunk rather than the module's high-fantasy PF2e setting. Both scenarios were rewritten with fantasy flavor while preserving the exact same chain structure and token-chaining rule: Scenario A is now a watchtower's signal-fire investigation (tokens: violet → Ashwatch → empty → watch-sprite → six hours), Scenario B a temple's forged tithe-ledger investigation (tokens: 120 gold → Brother Ostan → pilgrimage → forged → three years old). The reskin also deliberately favors short, distinctive tokens — proper nouns (a tower name, a monk's name) and short noun phrases — over long generic clauses like the old "offline for the entire shift": a name or short phrase is far easier to spot on a re-scan under time pressure than a multi-word clause. Several UI strings that also read as sci-fi chrome (`instructionsTitle`, `verifyDataset` action label, `fragmentsLabel`, `card.inProgressSelf`, `card.alreadyClaimed`, `card.failure`, `card.criticalFailure`) were reworded at the same time — "Verify Dataset" is now "Confirm Findings", "Data Fragments" is now "Fragments", etc.

**Closing leads (fourth playtest round — the real fix for the "last fact" gap)**: despite the fantasy reskin's shorter, more scannable tokens, a player still reported the puzzle "way too hard... this would be a nat 1 every time" and pasted a full Medium-tier transcript. Tracing it confirmed the "accepted structural limitation" above was not a minor inconvenience but a **guaranteed, unsolvable coin-flip** on one of the four required facts, regardless of player skill: the player correctly traced 3 of the 4 required facts via cross-referencing, but the 4th (the tier's last included link) had zero corroborating information anywhere in the generated pool — nothing left to compare it against, by construction.

The fix mirrors what timeline-puzzle and alibi-matrix already do (show given clues separately from the thing being deduced), scoped down to the minimum needed: each scenario now has a `closingLeads` map (`fact-sifter-logic.js`) keyed by `trueFactCount` (3, 4, and 5 — deliberately no entry for 6/Expert), each a single GIVEN sentence containing the exact token the excluded next-link would have restated. `generateAttempt()` now returns `{ fragments, closingLead }` instead of a flat array; `closingLead` is looked up as `scenario.closingLeads[trueFactCount] ?? null` and is `null` at Expert tier by design. The app (`FactSifterApp`) stores and renders it as a `.fact-sifter-lead` line above the fragment list — visually distinct (accent border, italic) and **never** a `data-action`/selectable element, so it can't be mistaken for one of the fragments to pick. It is not counted toward `trueFactCount` or `poolSize`.

This closes exactly the one genuinely unsolvable gap while leaving every other required fact's resolution to real cross-referencing effort — re-tracing the reported transcript with the new Ashwatch-scenario lead ("A passing forester swears a watch-sprite was seen darting around the beacon after midnight.") confirmed the entire 4-fact chain becomes solvable end-to-end via backward propagation from that one given fact. Expert tier (all 6 links, no lead) deliberately keeps its final fact as a narrative-logic inference rather than a token restatement — a genuine capstone judgment call for the hardest tier, not an oversight; revisit if that turns out not to hold up in play either.

**Generation algorithm** (`generateAttempt`, called fresh in `onAttempt()` every time): pick a random scenario; take a *contiguous prefix* of the chain (not a random subset — later facts genuinely build on earlier ones, e.g. "the Ashwatch tower is warded to burn violet" only makes sense once "the signal fire burns violet" is established, so an arbitrary subset like links 2,4,6 without 1,3,5 could read as narratively incoherent); draw one targeted noise option per true fact; fill any remaining noise quota from both noise options of unused chain links plus the `irrelevantNoise` pool; shuffle the combined pool and assign display-order ids; look up the tier's `closingLead` (or `null` at Expert); return `{ fragments, closingLead }`.

**Sufficiency verified** for a 6-link chain + 8-entry `irrelevantNoise` pool per scenario (`extraNeeded = noiseCount - trueFactCount`, `leftoverPool.length = 2×(6 - trueFactCount) + 8`, counting *both* noise options per unused link):

| Tier | trueFactCount | noiseCount | extraNeeded | leftoverPool available |
|---|---|---|---|---|
| Easy | 3 | 3 | 0 | 14 |
| Medium | 4 | 5 | 1 | 12 |
| Hard | 5 | 7 | 2 | 10 |
| Expert | 6 | 10 | 4 | 8 (tightest case, still sufficient) |

**Accepted design consequence**: since the true chain is always a deterministic prefix, the *set of true-fact texts* for a given (scenario, tier) pair is fixed across repeated attempts — only the scenario pick, the decoy/filler mix, and the shuffle order vary. Less remix variety than timeline-puzzle or alibi-matrix (both fully re-permute their solution each time), an unavoidable consequence of preserving narrative coherence via prefix-only sampling. Not a v1 blocker; a future scenario-count increase (mirroring timeline's own event-bank growth from 14→~100 entries) is the natural follow-up if noticeable in play.

### Time allowance

```
totalPcStat = live skill totalModifier (or actor.system.perception.totalModifier for Perception)
              + stored circumstanceMod
baseTimeAllowanceSeconds = totalPcStat * 7 + 60
```

Originally retuned down from the spec's suggested `*10+75` to `*5+40`, following the same pattern as timeline (`*10+60` → `*4+30`) and alibi-matrix (`*12+90` → `*7+50`). Bumped back up after playtesting showed `*5+40` was too tight for what this puzzle actually demands — a report that the connecting thread was "way too hard to realize with the short amount of time" prompted re-examining the earlier "none of alibi-matrix's cross-referencing" assumption below, which turned out to be wrong: solving this puzzle genuinely does require re-scanning the whole pool multiple times to trace a repeated token across fragments, much closer in effort to alibi-matrix's grid deduction than to a flat reading task. The formula now matches alibi-matrix's `*7+50` almost exactly, with a slightly higher base (60 vs. 50) reflecting the larger reading volume (up to 16 rows at Expert tier vs. alibi-matrix's fixed grid size): untrained gets 60s, a +20 stat gets 3:20.

**Watch-item, not a blocker**: at Expert tier, a low-to-moderate stat character (e.g. +8 → 116s) has 16 rows to read plus toggle-time — the tightest combination in the whole {tier}×{stat} matrix. Inherent to a flat per-stat-point formula applied to a tiered reading-volume puzzle; a genuine playtest question, not a design flaw.

### Validation and outcomes

Exact-match check: the player's selected fragment ids must equal the true-fact ids exactly (same count AND same set). Wrong count and wrong content both get the same generic non-blocking glitch flash — no distinct messaging between the two cases, matching the other features' "any wrong submission gets the same flash" precedent.

- Correct submission within the first 25% of `baseTimeAllowanceSeconds` elapsed → **criticalSuccess**; 26-100% → **success**.
- Timer expires: `ratio = selectedCount > 0 ? correctSelectedCount / selectedCount : 0`. `ratio > 0.5` → **failure**. `ratio <= 0.5` → **criticalFailure** (the `selectedCount === 0` case explicitly falls into this bucket, matching the spec's "failed to select any true facts at all" wording). Verified boundary: exactly 50% correct (e.g. 2-of-4 selected true) lands on criticalFailure, matching "half or fewer."
- If `allowCriticalOutcomes` is off: criticalSuccess collapses to success, criticalFailure collapses to failure.
- No mistake-penalty or lockout mechanic — all four outcomes stay freely re-attemptable via a fresh GM request.

### Data model

**ChatMessage flag** (`flags['pf2e-customizations'].factSifter`, write-once): `{ actorId, dc, skillSlug, circumstanceMod, allowCriticalOutcomes }` — raw GM inputs only.

**Actor flag** (`flags['pf2e-customizations'].factSifter.<messageId>`, mutable): `{ claimedBy, resolved }`, same shape as the other features.

### Interaction and element choice

Fragment rows are real `<button type="button" data-action="toggleFragment">` elements (**not** `<div>`, unlike alibi-matrix's grid cells) — binary toggle on click, direct DOM patch (class only, no full re-render). This is a deliberate choice given alibi-matrix's `<div data-action="cycleCell">` cells are currently reported as not responding to clicks at all (see Phase 4's "Open implementation questions" item 5) — `<button data-action>` is the most battle-tested interactive pattern in this codebase, and Fact Sifter's rows are naturally full-width text anyway, so there's no small-fixed-size styling reason to prefer `<div>` here the way there was for alibi-matrix's 36×36px grid squares. `!important` is still applied defensively on `display: block`, `width: 100%`, `text-align: left`, and padding so each row reliably reads as a document/log list line rather than a default centered button. The window uses a static 560px width (no per-attempt variance needed, unlike alibi-matrix's categoryCount-driven width) with the fragment list scrolling via `max-height`/`overflow-y: auto` as a safety net for the 16-row Expert case.

**Row-height bug (found via playtest)**: Foundry's base `button` CSS forces `height`/`min-height: var(--button-size)` (a fixed ~26-28px single-line-label size), which the `display: block` override didn't account for. Wrapped multi-line fragment text overflowed below that fixed-height box and was visually painted over by the next row in the flex-column list — every row but the last had its overflow silently hidden, so only the final fragment was fully readable. Fixed by adding `height: auto !important; min-height: 0 !important;` (plus `white-space: normal !important; overflow-wrap: break-word !important;` as insurance) to `.fact-sifter-fragment-row`.

### Open implementation questions

1. `buildSkillOptions()`/`skillLabel()` duplicated a fourth time — consistent with this module's no-shared-logic-module convention.
2. See "Content model" above for the accepted fixed-true-text-set consequence of prefix-only chain sampling, the required token-chaining authoring rule, and the "Closing leads" fix for the last-fact corroboration gap.
3. See "Time allowance" above for the Expert-tier reading-time watch-item.
4. Both scenario banks now use high-fantasy investigation flavor (a watchtower's signal-fire, a temple's forged tithe-ledger — see "Fantasy reskin" above) rather than any specific campaign setting — same "GM can reskin freely" expectation as the other features' content banks.
5. Expert tier (DC≥36) ships with no `closingLead` at all — its final fact is meant to be solvable via narrative logic rather than a given corroboration. This is the least playtested part of the mechanic; if it turns out to be as unsolvable as the pre-fix Medium tier was, the fix is the same: add a `closingLeads[6]` entry per scenario.
