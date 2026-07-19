# Changelog

## [1.1.0] — 2026-07-19

### Added

- **Chronological Timeline Puzzle** — A drag-and-drop timeline-sorting puzzle standing in for a flat investigation/information-gathering check. Event card count comes from the DC; clue completeness scales separately with the acting character's live odds of success. Wrong guesses are free and unpenalized via **Check Order**.
- **Request Timeline Puzzle** macro — GM-only macro that posts a public chat card for a chosen PC, skill, and DC. Any owning player can then claim and attempt the puzzle, one attempt in flight at a time.
- **The Alibi Matrix** — A full logic-grid ("Zebra puzzle") deduction puzzle standing in for a flat investigation/social check. Matrix size (one 3×3 grid up to three linked 4×4 grids) comes from the DC; clue completeness scales with the character's live odds, same two-axis approach as the timeline puzzle. Cells cycle blank → ✗ → ✓; wrong guesses are free via **Check Matrix**.
- **Request Alibi Matrix** macro — GM-only macro, same request/claim/attempt flow as the timeline puzzle.
- **The Fact Sifter** — An information-filtration puzzle standing in for a flat investigation/research check. The player highlights exactly the true fragments from a shuffled pool mixing a corroborating chain of facts with deceptive noise, using a repeated detail in the fragment text to trace which are true. Pool size and true-fact count come from the DC. At most difficulty levels a given "Lead" fact is also shown, closing an otherwise-unsolvable gap at the tail of the chain. Wrong guesses are free via **Confirm Findings**.
- **Request Fact Sifter** macro — GM-only macro, same request/claim/attempt flow as the other two puzzles.
- **Jigsaw Puzzle Minigame** — An image-reassembly puzzle standing in for a flat investigation/perception check. A picture (random from a bundled/custom image pool, or a GM-pinned specific image) is sliced into a grid of rectangular pieces; the player drags — or click-selects, then click-places — pieces from a scrambled tray into the matching grid, with wrong placements left freely correctable rather than blocked. Grid size (16 to 30 pieces) comes from the DC; the time allowed scales with both piece count and the acting character's live skill total. Wrong or incomplete attempts are free via **Check Puzzle**.
- **Request Jigsaw Puzzle** macro — GM-only macro, same request/claim/attempt flow as the other puzzles, with an added choice between drawing a random image or pinning one specific image for the request.
- **Puzzle Board Minigame** — A persistent, collaborative free-drag puzzle board that, unlike every other minigame in this module, doesn't stand in for a dice roll: a PC's real skill/Perception check permanently sets how hard a given puzzle is to solve, once. Any number of players can work on it together with no timer, across as many sessions as it takes, as a downtime activity. Pieces start piled up in a tray and are dragged freely (not into discrete slots) onto an assembly area; the puzzle completes automatically once every piece is close enough to its correct spot. The board's width tracks the window live. A critical success on the difficulty check cuts the most jagged pieces (easiest to visually sort); a critical failure cuts perfectly uniform squares (hardest, since every piece looks identical).
- **Manage Puzzle Boards** macro — GM-only macro for creating/renaming/deleting puzzles, requesting the difficulty-determining roll from a chosen PC, resolving that roll manually if needed, and revealing a puzzle to the party (which also posts a public chat card with an Open Puzzle button).
- **Open Puzzle Board** macro — player-facing macro (unlike every other request macro, not GM-only) that opens a revealed puzzle directly, or offers a picker if more than one has been revealed.
- **Lock Picking Minigame** — the mini-game has been changed to look like a lock with a pin that is moved around instead of dails. 

## [1.0.0] — 2026-07-09

### Added

- **Item Durability Fields** — Adds Hardness, Hit Points (current/max), and Broken Threshold fields to the Details tab of physical item sheets (weapons, armor, equipment, containers, treasure, consumables). Fields bind directly to the existing PF2e data model; no data migration required.
- **Set Item Durability** macro — lets a player edit an owned item's Hardness/HP/Broken Threshold via a dialog, without opening the item sheet.
- **Apply Item Damage** macro — GM-only macro that applies raw damage to a selected token's item, subtracting Hardness and reducing current HP (floored at 0), with a warning when the item becomes broken.
- **Lock Picking Minigame** — An interactive pin-tumbler dial puzzle standing in for a flat Thievery check. Pin count comes from the lock's DC tier; window size and mistake grace period scale with the acting character's live Thievery modifier and proficiency rank against that DC. Reaching the (configurable) mistake threshold breaks the pick as a critical failure; zero mistakes is a critical success. The DC is never shown to players, only rendered GM-only on the chat card.
- **Request Lock Pick** macro — GM-only macro that posts a public chat card for a chosen PC and lock difficulty (a named tier or custom DC). Any owning player can then claim and attempt the puzzle from the card, one attempt in flight at a time.
