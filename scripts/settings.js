export function registerSettings() {
  game.settings.register('pf2e-customizations', 'itemDurabilityEnabled', {
    name: 'pf2e-customizations.settings.itemDurability.name',
    hint: 'pf2e-customizations.settings.itemDurability.hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  game.settings.register('pf2e-customizations', 'lockPickingEnabled', {
    name: 'pf2e-customizations.settings.lockPicking.name',
    hint: 'pf2e-customizations.settings.lockPicking.hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
  });

  game.settings.register('pf2e-customizations', 'lockPickingMistakeThreshold', {
    name: 'pf2e-customizations.settings.lockPickingMistakeThreshold.name',
    hint: 'pf2e-customizations.settings.lockPickingMistakeThreshold.hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 3,
    range: { min: 1, max: 10, step: 1 },
    requiresReload: false,
  });

  game.settings.register('pf2e-customizations', 'lockPickingHideInstructions', {
    name: 'pf2e-customizations.settings.lockPickingHideInstructions.name',
    hint: 'pf2e-customizations.settings.lockPickingHideInstructions.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false,
  });

  game.settings.register('pf2e-customizations', 'lockPickingDebugShowWindow', {
    name: 'pf2e-customizations.settings.lockPickingDebugShowWindow.name',
    hint: 'pf2e-customizations.settings.lockPickingDebugShowWindow.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false,
  });

  game.settings.register('pf2e-customizations', 'timelinePuzzleEnabled', {
    name: 'pf2e-customizations.settings.timelinePuzzle.name',
    hint: 'pf2e-customizations.settings.timelinePuzzle.hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
  });

  game.settings.register('pf2e-customizations', 'timelinePuzzleHideInstructions', {
    name: 'pf2e-customizations.settings.timelinePuzzleHideInstructions.name',
    hint: 'pf2e-customizations.settings.timelinePuzzleHideInstructions.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false,
  });

  game.settings.register('pf2e-customizations', 'alibiMatrixEnabled', {
    name: 'pf2e-customizations.settings.alibiMatrix.name',
    hint: 'pf2e-customizations.settings.alibiMatrix.hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
  });

  game.settings.register('pf2e-customizations', 'alibiMatrixHideInstructions', {
    name: 'pf2e-customizations.settings.alibiMatrixHideInstructions.name',
    hint: 'pf2e-customizations.settings.alibiMatrixHideInstructions.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false,
  });

  game.settings.register('pf2e-customizations', 'factSifterEnabled', {
    name: 'pf2e-customizations.settings.factSifter.name',
    hint: 'pf2e-customizations.settings.factSifter.hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
  });

  game.settings.register('pf2e-customizations', 'factSifterHideInstructions', {
    name: 'pf2e-customizations.settings.factSifterHideInstructions.name',
    hint: 'pf2e-customizations.settings.factSifterHideInstructions.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false,
  });
}
