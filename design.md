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
