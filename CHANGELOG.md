# Changelog

## [1.0.0] — TBD

### Added

- **Item Durability Fields** — Adds Hardness, Hit Points (current/max), and Broken Threshold fields to the Details tab of physical item sheets (weapons, armor, equipment, containers, treasure, consumables). Fields bind directly to the existing PF2e data model; no data migration required.
- **Set Item Durability** macro — lets a player edit an owned item's Hardness/HP/Broken Threshold via a dialog, without opening the item sheet.
- **Apply Item Damage** macro — GM-only macro that applies raw damage to a selected token's item, subtracting Hardness and reducing current HP (floored at 0), with a warning when the item becomes broken.
