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
}
