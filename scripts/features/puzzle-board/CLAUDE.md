# CLAUDE.md

Guidance specific to the puzzle-board feature (see the root `CLAUDE.md` for repo-wide conventions).

## Phase 7: Puzzle Board Minigame

A persistent, collaborative free-drag image-reassembly puzzle. Unlike every other minigame in this
module, it does **not** stand in for a dice roll — a PC's real skill/Perception check instead sets
how hard the puzzle is to solve, permanently, once. The GM maintains a library of named puzzles
(each with its own image), separately reveals individual puzzles to the party, and players (any
number, across any number of sessions, as a downtime activity) drag pieces freely around an
unbounded board until every piece is "close enough" to its target position, at which point the
puzzle auto-completes. There is no timer and no discrete grid — this is the free-drag/no-slots
counterpart to `jigsaw-puzzle`'s bounded-grid/timed design.

- **Target files**: `scripts/features/puzzle-board/` (`puzzle-board-logic.js`, `puzzle-board-data.js`,
  `puzzle-board-roll-listener.js`, `puzzle-board-manager-app.js` + `.hbs`, `puzzle-board-app.js` + `.hbs`,
  `puzzle-board-roll-request-chat-card.hbs`), `scripts/macros/manage-puzzle-boards.js`,
  `scripts/macros/open-puzzle-board.js`.

### Two genuine firsts for this codebase

1. **The only feature that reads a real PF2e roll.** Every sibling feature (lock-picking,
   timeline-puzzle, alibi-matrix, fact-sifter, jigsaw-puzzle) derives PC stats live off actor data
   and simulates its own outcome (a timer or an accuracy ratio) — none of them observe an actual
   rolled chat message. Here, `puzzle-board-roll-listener.js` hooks `Hooks.on('createChatMessage', ...)`
   and reads a real check's `flags.pf2e.context` (`.actor`, `.type`, `.slug`, and `.outcome`) to
   correlate a roll to a puzzle's `pendingRollRequest` and lock in its difficulty tier from PF2e's
   own four outcome strings directly (no separate mapping table). Gated on `game.user.isActiveGM` —
   Foundry core's own idiom for picking exactly one authoritative writer among possibly-multiple
   connected GM clients.
   - **Confirmed bug, fixed after live testing**: `context.actor` is the bare Actor **id** string
     (e.g. `"chOzYBJo1BjDNOhg"`), *not* a `"Actor.<id>"` UUID as first assumed from static PF2e
     source reading. `resolvePendingRoll()` compares against `pending.actorId`, never
     `pending.actorUuid` (still stored on the request, kept only for possible future display use).
     The first draft compared against `actorUuid` and silently never matched any roll — automatic
     resolution AND the manual-resolve candidate list both looked broken, since both paths share
     this same comparison. Worth remembering if any *other* PF2e context field is assumed from
     source reading rather than a live message dump: this codebase's usual "verify new API usage
     before trusting a call signature" discipline applies here too.
   - **Second confirmed bug, same root cause**: `context.slug` doesn't exist on a real check
     context at all — there is no `.slug` field. The statistic's own slug only appears as a
     `check:statistic:<slug>` entry inside `context.options` (e.g. `check:statistic:diplomacy`,
     alongside `check:type:skill`, `<slug>-check`, etc. in `context.domains`). `extractSkillSlug()`
     in `puzzle-board-roll-listener.js` parses this out (`perception-check` is still special-cased
     directly from `context.type`, since Perception never appears as a `check:statistic:` tag) and
     is exported so the manager app's manual-resolve list uses the exact same extraction rather than
     a second, possibly-diverging guess. Both this and the actor-id fix above were only caught by
     dumping a real rolled message's full `flags.pf2e.context` to the console — static source
     reading alone gave a wrong shape for both fields.
   - Also confirmed and fixed live: `skillLabel()` in `puzzle-board-manager-app.js` crashed
     (`Cannot read properties of undefined (reading 'label')`) when building the manual-resolve
     candidate list, because `CONFIG.PF2E.skills[slug]` is `undefined` for any skill not in that
     fixed map — a Lore skill's actor-specific slug, for example. It now falls back to the raw slug
     string instead of assuming every `context.slug` that ever appears in chat is a fixed skill.
   - **Real gap, not just a theoretical one**: a roll made while no GM client is connected never
     retroactively resolves (`createChatMessage` doesn't re-fire later). The manager app's
     "Resolve Manually" action is required scope, not a nice-to-have — it lets the GM pick a past
     chat message from the log after the fact and re-run the exact same `resolvePendingRoll()`.
   - The optional "Roll Now" button on the request chat card calls PF2e's real
     `actor.getStatistic(skillSlug).roll({ dc: { value } })` — first use of `Statistic#roll()` from
     outside a character sheet in this codebase. It's a convenience only; the fallback (the player
     rolls that skill from their own sheet) needs zero new API surface and should keep working even
     if this button misbehaves.
2. **The only feature with multi-writer shared state.** Every sibling's mutable "attempt" state
   lives on the *one attempting player's own actor* flags, specifically because `ChatMessage` has no
   `ownership` schema field in v13 — but here, any player can move any piece, so state can't live on
   a single actor. Confirmed directly against the installed Foundry v13 source: `JournalEntry`
   **does** have a real `ownership` schema field. Each puzzle gets its own `JournalEntry` (folder-
   organized under an auto-created "Puzzle Board Data" folder); at reveal time, `revealPuzzle()`
   (`puzzle-board-data.js`) sets `ownership.default = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER`, which
   is what lets any subsequent player's client legally call `.setFlag()`/`.update()` on it directly —
   no socket-relay plumbing needed. **This single call is the highest-risk, most-novel part of the
   whole feature** — needs a real two-client test (does a genuinely non-GM client's write actually
   succeed afterward with zero further plumbing?) before trusting anything downstream of it.
   - **Piece writes must stop at `.current`/`.placed`, never at the piece's own key.** Foundry
     merges nested plain objects at the exact dotted path given in an `update()`/`setFlag()` call.
     `setPieceCurrent()` in `puzzle-board-data.js` writes
     `flags.pf2e-customizations.puzzleBoard.pieces.<id>.current` and `...pieces.<id>.placed` as two
     sibling dotted keys in one `update()` call — **not** a single write at `pieces.<id>` — because
     that would replace the whole piece object and silently wipe its `target`/`polygon`/`bbox`
     (a real bug caught and fixed during initial implementation, before ever running against a live
     world). This exact-leaf-path discipline is also what makes two different players dragging two
     different pieces at the same moment land independently instead of clobbering each other —
     contrast with `jigsaw-puzzle-chat.js`'s `setAttemptState()`, a full read-modify-write that's
     only safe there because a single actor is never written by two players at once.

### Difficulty axis: piece shape, not placement tolerance

Per the locked design decision, only piece **shape irregularity** scales with the roll outcome —
the "mostly in place" tolerance (`isPieceMostlyInPlace()`, `puzzle-board-logic.js`) is a constant
radius check regardless of tier. No rotation mechanic — position-only, a deliberately deferred idea
(not forgotten), same convention as jigsaw-puzzle's own "ghost overlay, seriously considered" note.

**Shared-edge jitter algorithm** (`buildJitteredEdges`/`buildPiecePolygon` in `puzzle-board-logic.js`):
every *internal* grid edge (never the outer border, which stays straight) is subdivided and
perpendicular-jittered once, then **shared** by the two pieces on either side of it (one traverses
it forward, the other in reverse) — this shared-point invariant is what keeps cut lines tiling
perfectly with no gaps/overlaps no matter how jagged. Tier→magnitude constants
(`IRREGULARITY_BY_TIER`) are first-draft guesses, same as every sibling feature's own constants
needed at least one retuning pass.

**Tier→irregularity direction was inverted after real playtesting feedback.** The first draft gave
a good roll (`criticalSuccess`) perfectly uniform squares and a bad roll (`criticalFailure`) the
most jagged pieces — the intuitive "clean = easy, messy = hard" mapping. In actual play this was
backwards: with every piece an identical plain rectangle, there's no visual difference between an
edge piece and an inner piece, and no cue at all about which neighbor a piece belongs next to. A
real jigsaw's irregular interlocking tab/blank shape is itself a strong hint about fit — jagged
pieces give that same cue back, uniform ones remove it entirely. So `criticalSuccess` now gives the
**most jagged** pieces (easiest to sort) and `criticalFailure` gives **perfectly uniform squares**
(hardest) — see `IRREGULARITY_BY_TIER`'s own comment for the full reasoning. The magnitude constants
themselves didn't change, only which tier they're assigned to.

### Breaking the "no canvas" precedent, deliberately

Every sibling avoids canvas/PIXI — jigsaw-puzzle's pure CSS `background-position` percentage slicing
only works because every tile is an identical-size grid cell. Here, jittered pieces have
**non-uniform** bounding boxes, so each piece gets its own `<canvas>` (`ctx.clip()` with a jittered
`Path2D` + `drawImage()`, in `puzzle-board-app.js`'s `drawPieceCanvas()`), drawn **exactly once** at
board-build time and thereafter treated as a static sprite (only its wrapper's `left`/`top` style
changes during drag or remote sync). **This app must never rebuild piece DOM wholesale after first
paint** — a full re-render (the way jigsaw-puzzle's `#renderBoard()` freely rebuilds `innerHTML`
every render) would discard every already-drawn canvas bitmap and force an expensive full redraw.
`_onRender` guards this with a one-shot `#boardBuilt` flag; local drag commits and remote sync both
patch individual piece elements directly, never calling `this.render()`.

### Free-drag mechanics: pointer-events, not native drag-and-drop

An explicit, deliberate departure from every sibling (all of which use native HTML5
`draggable`/`dragstart`/`drop`, a "pick up from A, drop on discrete target B" model). Free
positioning needs continuous coordinates, which native drag-and-drop has no notion of — so pieces
use `pointerdown`/`pointermove`/`pointerup` + `setPointerCapture()` instead (first use of the
Pointer Events API in this codebase). Drag math uses a **movement delta** from the pointer's own
start position (divided by the current zoom factor), not an absolute cursor-to-board-rect
conversion — this makes the math correct across both the zoom control and the viewport's scroll
position without needing to account for either explicitly.

### Responsive zoom: fit-to-width by default, tracks the window live

**Reworked after real feedback**: the first draft applied a fixed manual zoom (defaulting to `1`,
i.e. the board's own native logical pixel size) with `+`/`-` buttons as the only way to change it —
the board's on-screen size had no relationship to the window's actual size at all, and didn't
change when the window was resized. Replaced with a `ResizeObserver` on `[data-puzzle-board-viewport]`
(`#setupResponsiveZoom()`/`#recomputeBaseZoom()` in `puzzle-board-app.js`) that recomputes
`#baseZoom = viewportEl.clientWidth / board.boardWidthPx` — i.e. "the board's CSS width always
equals the viewport's current width" — on every viewport size change, whatever the cause (browser
window resize, dragging the app window's own resize handle, or a flex reflow). `ResizeObserver` was
used deliberately over hooking any Foundry-specific resize event, since it fires on any change to
the observed element's own box size regardless of cause, with zero coupling to `ApplicationV2`'s
own render/resize lifecycle.

The `+`/`-` zoom buttons still work, but now adjust a separate `#zoomMultiplier` applied **on top**
of that auto-computed baseline (`#zoom = #baseZoom * #zoomMultiplier`) — resizing the window
rescales the baseline while preserving whatever multiplier the player last set, rather than
overwriting a player's manual zoom choice outright.

### Board frame: assembly area + tray, not a large surrounding void

The board is a **fixed logical reference frame** (`computeBoardFrame()`, sized from a normalized
reference image width, not the source image's actual pixel dimensions, so piece sizes stay
reasonable regardless of whether the GM picked a tiny icon or a huge poster). All piece
`target`/`current` positions are stored as percent-of-this-frame, never of any client's
viewport/zoom.

**Reworked after real playtesting feedback**: the first draft centered the assembled image inside
a board **several times larger** in every direction (a `BOARD_MARGIN_MULTIPLIER`), with pieces
scattered uniformly at random across that whole area. This was a real, reported usability problem
— "scrolling around on a big virtual space for pieces is annoying" — since most of that space was
empty and pieces could spawn anywhere in it. Replaced with a compact **assembly area on top, tray
directly below it** layout (same width, small fixed margins, `TRAY_HEIGHT_FRACTION` of the image's
own height) — small enough to need little or no scrolling/zooming for a typical piece count.
Freshly-created pieces now start scattered *within the tray's own rectangle only* (`randomTrayPosition()`),
which — combined with piece size relative to tray size — naturally makes them pile up and overlap,
which is also exactly what was asked for ("pieces can be scrambled and placed on top of each
other"), not a side effect to work around.

Two dashed/solid rectangles render as orientation guides: `.puzzle-board-target-guide` (dashed,
where the assembled image belongs) and `.puzzle-board-tray-guide` (solid, labeled "Tray", where
pieces start and can be set aside). Neither is a ghost overlay of the actual image — each piece's
own canvas already shows its real slice of the picture, same as a real jigsaw piece; showing the
answer separately would trivialize the visual-matching task.

**Breaking data-model change**: any puzzle created before this rework has the old
`imageOffsetXFrac`/`imageOffsetYFrac` field shape (no tray fields at all) and pieces scattered
across the old, much larger frame. There is no migration path — per this feature's own "delete and
recreate, no image/geometry edit" convention (see GM authoring flow below), any such puzzle not
already fully solved needs to be deleted and recreated. An already-*solved* old puzzle is unaffected
(the solved view only ever reads `imagePath`, never any board-frame field).

**Pile z-ordering**: picking a piece up (`pointerdown`) bumps it to the front of a monotonically
increasing local z-index counter (`#frontZIndex` in `puzzle-board-app.js`), so a piece buried under
others in the tray can actually be grabbed out from underneath them, and stays on top after being
dropped (a real pile's "most recently touched is on top" behavior). This is purely a per-client
rendering concern, never synced or persisted — different players can see a different stacking
order for the same overlapping pieces, which is fine since it has no gameplay effect.

**No placement "tell"**: a piece's `.is-placed` class is tracked in JS (for solve detection) but
deliberately has **no visual styling at all**. An early draft added a green drop-shadow to canvas
when a piece was placed correctly — a real, reported problem, since that's a direct answer-key leak
("we don't want to give players these clues"). Placement has to be judged by eye against the
assembly-area guide and the emerging picture, same as a real jigsaw puzzle.

### GM authoring flow

`PuzzleBoardManagerApp` is a persistent list/CRUD `ApplicationV2` window — genuinely novel for this
codebase, since every sibling's "authoring UI" is a single-shot `Dialog`. Status progression per
puzzle: `draft` → (request roll) → `awaiting-roll` → (roll resolves) → `ready` → (GM reveals) →
`revealed`. **Reveal also posts a plain, everyone-visible chat card** (`puzzle-board-reveal-chat-card.hbs`,
`postRevealChatMessage()` in the manager app) with an "Open Puzzle" button wired in
`puzzle-board-roll-listener.js`'s `renderChatMessageHTML` hook — added because players otherwise
have no way to discover a newly revealed puzzle short of already knowing to run the "open puzzle
board" macro. The roll-request Dialog duplicates the actor/skill/DC/circumstance-mod field shape from
`request-jigsaw-puzzle.js` locally rather than importing across features, matching this codebase's
self-contained-feature-folder convention. Deleting a puzzle is delete-and-recreate only — there's no
"replace image" edit action, since swapping the image after pieces/geometry exist would invalidate
all stored `target`/`bbox` data.

### Data model summary

- **World setting `puzzleBoardIndex`** (`config: false`): a thin `{ id, name, journalEntryId,
  revealed, createdAt }[]` index, written only by explicit GM actions in the manager app. Never
  mirrors runtime state (difficulty/solved/pieces) — that's always read straight off the puzzle's
  own JournalEntry, which becomes player-readable exactly when reveal happens anyway.
- **One `JournalEntry` per puzzle**, all mutable state under `flags['pf2e-customizations'].puzzleBoard`
  (see `puzzle-board-data.js` for the full shape: `status`, `imagePath`/`aspectRatio`/`cols`/`rows`,
  the fixed `boardWidthPx`/`boardHeightPx` reference frame plus its assembly-area and tray
  sub-rectangles (`imageOffsetXPercent`/`imageOffsetYPercent`/`imageWidthPercent`/`imageHeightPercent`,
  `trayOffsetXPercent`/`trayOffsetYPercent`/`trayWidthPercent`/`trayHeightPercent` — see "Board frame"
  above),
  `difficultyTier`, `pendingRollRequest`, `pieces` (object keyed by stringified piece id — **never**
  an array, see above), `solved`/`solvedAt`).

### Open implementation questions / first-use risks (needs real in-app smoke-testing, not just review)

1. `ownership.default = OWNER` at reveal, then a genuinely non-GM client successfully `.setFlag()`-ing
   afterward — the crux of the entire architecture.
2. ~~`createChatMessage` correlation against real `flags.pf2e.context` shape~~ — **exercised live**;
   found and fixed two real mismatches (`context.actor` is a bare id not a UUID, and `context.slug`
   doesn't exist at all — see above, both above). Confirmed working end-to-end for a regular skill
   check (Diplomacy). A live Perception check specifically hasn't been exercised yet — worth a
   dedicated check, since `extractSkillSlug()`'s Perception path is still a `context.type`
   special-case rather than something pulled from a real Perception message's `options`/`domains`.
3. GM-offline gap and the manual-resolve recovery path (see above) — should be exercised for real,
   not just trusted from code review.
4. Concurrent scoped dotted-path writes from two different clients on two different pieces —
   confirm they truly land independently rather than one clobbering the other.
5. Per-piece `<canvas>` + `ctx.clip()` rendering correctness, and that a drawn canvas survives being
   repositioned (not redrawn) across many drags without visual artifacts.
6. Pointer-events free-drag coordinate math across the zoom control and a scrolled viewport.
7. `Statistic#roll()` called from outside a sheet (the "Roll Now" button) — nice-to-have only, safe
   fallback exists if it misbehaves.
8. No bundled placeholder images for this feature (unlike jigsaw-puzzle) — each puzzle takes exactly
   one GM-supplied image at creation, no random pool, so there's no content-authoring task blocking
   playability the way jigsaw-puzzle had.

See `design.md`'s "Phase 6: Jigsaw Puzzle Minigame" section for the sibling feature this most closely
parallels and deliberately diverges from (bounded/timed/single-attempt vs. unbounded/untimed/
persistent-collaborative).
