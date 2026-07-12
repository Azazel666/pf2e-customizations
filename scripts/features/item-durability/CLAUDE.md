# CLAUDE.md

Guidance specific to the item-durability feature (see the root `CLAUDE.md` for repo-wide conventions).

## Phase 1: Item Durability Feature

Exposes existing `system.hp` and `system.hardness` fields on physical item sheets (details tab), matching how shields already display these fields.

- **Target sheets**: WeaponSheetPF2e, ArmorSheetPF2e, EquipmentSheetPF2e, ContainerSheetPF2e, TreasureSheetPF2e, ConsumableSheetPF2e
- **Injection point**: `.basics` fieldset on the details tab
- **Fields**: `system.hp.value`, `system.hp.max`, `system.hp.brokenThreshold`, `system.hardness`

See `design.md` for draft Handlebars template, field markup conventions, and open implementation questions (v13 hook patterns, BT auto-calculation).
