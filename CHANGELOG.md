# Changelog

## [1.0.0] — 2026-07-09

### Added

- **Item Durability Fields** — Adds Hardness, Hit Points (current/max), and Broken Threshold fields to the Details tab of physical item sheets (weapons, armor, equipment, containers, treasure, consumables). Fields bind directly to the existing PF2e data model; no data migration required.
- **Set Item Durability** macro — lets a player edit an owned item's Hardness/HP/Broken Threshold via a dialog, without opening the item sheet.
- **Apply Item Damage** macro — GM-only macro that applies raw damage to a selected token's item, subtracting Hardness and reducing current HP (floored at 0), with a warning when the item becomes broken.
- **Lock Picking Minigame** — An interactive pin-tumbler dial puzzle standing in for a flat Thievery check. Pin count comes from the lock's DC tier; window size and mistake grace period scale with the acting character's live Thievery modifier and proficiency rank against that DC. Reaching the (configurable) mistake threshold breaks the pick as a critical failure; zero mistakes is a critical success. The DC is never shown to players, only rendered GM-only on the chat card.
- **Request Lock Pick** macro — GM-only macro that posts a public chat card for a chosen PC and lock difficulty (a named tier or custom DC). Any owning player can then claim and attempt the puzzle from the card, one attempt in flight at a time.
