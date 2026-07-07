import { getPhysicalItems, buildItemOptions } from './set-item-durability.js';

function renderItemInfo(root, item) {
  const hp = item.system.hp ?? { value: 0, max: 0, brokenThreshold: 0 };
  const hardness = item.system.hardness ?? 0;
  root.querySelector('.item-damage-hp').textContent = `${hp.value ?? 0} / ${hp.max ?? 0}`;
  root.querySelector('.item-damage-hardness').textContent = `${hardness}`;
}

async function applyItemDamage(token) {
  const i18n = key => game.i18n.localize(`pf2e-customizations.macro.applyItemDamage.${key}`);

  if (!game.user.isGM) {
    ui.notifications.warn(i18n('gmOnly'));
    return;
  }

  token ??= canvas.tokens?.controlled[0];
  if (!token?.actor) {
    ui.notifications.warn(i18n('noToken'));
    return;
  }

  const actor = token.actor;
  const items = getPhysicalItems(actor);
  if (!items.length) {
    ui.notifications.warn(i18n('noItems'));
    return;
  }

  const initialItem = items[0];
  const initialHp = initialItem.system.hp ?? { value: 0, max: 0, brokenThreshold: 0 };
  const initialHardness = initialItem.system.hardness ?? 0;

  const content = `
    <form class="pf2e-customizations-macro-form">
      <div class="form-group">
        <label>${i18n('item')}</label>
        <div class="form-fields">
          <select name="itemId">${buildItemOptions(items, initialItem.id)}</select>
        </div>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize('pf2e-customizations.durability.hp')}</label>
        <div class="form-fields">
          <span class="item-damage-hp">${initialHp.value ?? 0} / ${initialHp.max ?? 0}</span>
        </div>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize('pf2e-customizations.durability.hardness')}</label>
        <div class="form-fields">
          <span class="item-damage-hardness">${initialHardness}</span>
        </div>
      </div>
      <div class="form-group">
        <label>${i18n('damage')}</label>
        <div class="form-fields">
          <input type="number" name="damage" value="0" min="0">
        </div>
      </div>
    </form>
  `;

  return new Promise(resolve => {
    new Dialog({
      title: i18n('title'),
      content,
      buttons: {
        apply: {
          label: i18n('apply'),
          callback: async (html) => {
            const form = html[0].querySelector('form');
            const data = new FormData(form);
            const itemId = data.get('itemId');
            const damage = Number(data.get('damage'));
            const item = actor.items.get(itemId);
            if (!item) { resolve(null); return; }

            const hp = item.system.hp ?? { value: 0, max: 0, brokenThreshold: 0 };
            const hardness = item.system.hardness ?? 0;

            if ((hp.max ?? 0) <= 0 && hardness <= 0) {
              ui.notifications.error(game.i18n.format('pf2e-customizations.macro.applyItemDamage.notConfigured', { name: item.name }));
              resolve(null);
              return;
            }

            if (!Number.isFinite(damage) || damage < 0) {
              resolve(null);
              return;
            }

            const remaining = Math.max(0, damage - hardness);
            const newValue = Math.max(0, (hp.value ?? 0) - remaining);
            await item.update({ 'system.hp.value': newValue });

            ui.notifications.info(game.i18n.format('pf2e-customizations.macro.applyItemDamage.applied', {
              name: item.name,
              damage: remaining,
              value: newValue,
              max: hp.max ?? 0,
            }));

            if (newValue <= (hp.brokenThreshold ?? 0)) {
              ui.notifications.warn(game.i18n.format('pf2e-customizations.macro.applyItemDamage.broken', { name: item.name }));
            }

            resolve(item);
          },
        },
        cancel: {
          label: i18n('cancel'),
          callback: () => resolve(null),
        },
      },
      render: (html) => {
        const root = html[0];
        const itemSelect = root.querySelector('select[name="itemId"]');
        itemSelect.addEventListener('change', () => {
          const item = actor.items.get(itemSelect.value);
          if (item) renderItemInfo(root, item);
        });
      },
      default: 'apply',
    }).render(true);
  });
}

export function initApplyItemDamageMacro() {
  globalThis.pf2eCustomizations ??= {};
  globalThis.pf2eCustomizations.applyItemDamage = applyItemDamage;
}
