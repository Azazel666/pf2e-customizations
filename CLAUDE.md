# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**pf2e-customizations** is a Foundry Virtual Tabletop (VTT) module — an umbrella for small Pathfinder 2e quality-of-life features, each independently toggleable via GM settings. It targets Foundry VTT v13 and requires the PF2e system.

The project is in early implementation phase. See `design.md` for detailed specifications of planned features.

## No Build Step

This is plain JavaScript loaded directly by Foundry VTT. There is no bundler, transpiler, or test runner. Development workflow:

1. Edit files in `D:\FoundryVTT-Data\Data\modules\pf2e-customizations\`
2. In Foundry VTT, reload the world (`F5` or module reload) to pick up changes
3. Use Foundry's browser DevTools console for debugging

## Architecture

### Module Structure (planned)

```
pf2e-customizations/
├── module.json              # Foundry module manifest
├── scripts/
│   ├── module.js            # Entry point: registers settings, conditionally loads features
│   ├── settings.js          # Centralized setting registration
│   └── features/
│       └── <feature-name>/
│           ├── <feature>.js      # Hook registration and logic
│           └── <feature>.hbs     # Handlebars partial for sheet injection
├── styles/
│   └── features/
│       └── <feature>.css
└── lang/
    └── en.json
```

### Feature Pattern

Each feature is self-contained in `scripts/features/<feature-name>/`. The entry point (`module.js`) reads the GM toggle setting for each feature and only loads/initializes it when enabled (`requiresReload: true` on settings).

Features integrate with PF2e system sheets via Foundry hooks (e.g., `renderWeaponSheetPF2e`). UI is injected as Handlebars partials into existing sheet DOM. Foundry v13 uses the **ApplicationV2** framework — verify hook names and field attribute conventions (`data-property=` vs `name=`) against v13 PF2e source before implementing.

### Settings Pattern

```js
game.settings.register('pf2e-customizations', 'featureName', {
  name: 'PFTC.Settings.FeatureName.Name',
  hint: 'PFTC.Settings.FeatureName.Hint',
  scope: 'world',
  config: true,
  type: Boolean,
  default: false,
  requiresReload: true,
});
```

## Phase 1: Item Durability Feature

Exposes existing `system.hp` and `system.hardness` fields on physical item sheets (details tab), matching how shields already display these fields.

- **Target sheets**: WeaponSheetPF2e, ArmorSheetPF2e, EquipmentSheetPF2e, ContainerSheetPF2e, TreasureSheetPF2e, ConsumableSheetPF2e
- **Injection point**: `.basics` fieldset on the details tab
- **Fields**: `system.hp.value`, `system.hp.max`, `system.hp.brokenThreshold`, `system.hardness`

See `design.md` for draft Handlebars template, field markup conventions, and open implementation questions (v13 hook patterns, BT auto-calculation).
