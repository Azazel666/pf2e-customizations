# Changelog

## [1.1.0] — TBD

### Added

- **Chronological Timeline Puzzle** — A drag-and-drop timeline-sorting puzzle standing in for a flat investigation/information-gathering check. Event card count comes from the DC; clue completeness scales separately with the acting character's live odds of success. Wrong guesses are free and unpenalized via **Check Order**.
- **Request Timeline Puzzle** macro — GM-only macro that posts a public chat card for a chosen PC, skill, and DC. Any owning player can then claim and attempt the puzzle, one attempt in flight at a time.
- **The Alibi Matrix** — A full logic-grid ("Zebra puzzle") deduction puzzle standing in for a flat investigation/social check. Matrix size (one 3×3 grid up to three linked 4×4 grids) comes from the DC; clue completeness scales with the character's live odds, same two-axis approach as the timeline puzzle. Cells cycle blank → ✗ → ✓; wrong guesses are free via **Check Matrix**.
- **Request Alibi Matrix** macro — GM-only macro, same request/claim/attempt flow as the timeline puzzle.
- **The Fact Sifter** — An information-filtration puzzle standing in for a flat investigation/research check. The player highlights exactly the true fragments from a shuffled pool mixing a corroborating chain of facts with deceptive noise, using a repeated detail in the fragment text to trace which are true. Pool size and true-fact count come from the DC. At most difficulty levels a given "Lead" fact is also shown, closing an otherwise-unsolvable gap at the tail of the chain. Wrong guesses are free via **Confirm Findings**.
- **Request Fact Sifter** macro — GM-only macro, same request/claim/attempt flow as the other two puzzles.

## [1.0.0] — 2026-07-09

### Added

- **Item Durability Fields** — Adds Hardness, Hit Points (current/max), and Broken Threshold fields to the Details tab of physical item sheets (weapons, armor, equipment, containers, treasure, consumables). Fields bind directly to the existing PF2e data model; no data migration required.
- **Set Item Durability** macro — lets a player edit an owned item's Hardness/HP/Broken Threshold via a dialog, without opening the item sheet.
- **Apply Item Damage** macro — GM-only macro that applies raw damage to a selected token's item, subtracting Hardness and reducing current HP (floored at 0), with a warning when the item becomes broken.
- **Lock Picking Minigame** — An interactive pin-tumbler dial puzzle standing in for a flat Thievery check. Pin count comes from the lock's DC tier; window size and mistake grace period scale with the acting character's live Thievery modifier and proficiency rank against that DC. Reaching the (configurable) mistake threshold breaks the pick as a critical failure; zero mistakes is a critical success. The DC is never shown to players, only rendered GM-only on the chat card.
- **Request Lock Pick** macro — GM-only macro that posts a public chat card for a chosen PC and lock difficulty (a named tier or custom DC). Any owning player can then claim and attempt the puzzle from the card, one attempt in flight at a time.
