export const PHYSICAL_TYPES = ['weapon', 'armor', 'equipment', 'backpack', 'treasure', 'consumable'];

export function getPhysicalItems(actor) {
  return actor.items
    .filter(i => PHYSICAL_TYPES.includes(i.type))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildItemOptions(items, selectedId) {
  if (!items.length) return '<option value="" disabled>—</option>';
  return items
    .map(i => `<option value="${i.id}"${i.id === selectedId ? ' selected' : ''}>${i.name}</option>`)
    .join('');
}

function populateItemFields(html, item) {
  if (!item) {
    html.querySelector('input[name="hp.value"]').value = '';
    html.querySelector('input[name="hp.max"]').value = '';
    html.querySelector('input[name="hp.brokenThreshold"]').value = '';
    html.querySelector('input[name="hardness"]').value = '';
    return;
  }
  const hp = item.system.hp ?? { value: 0, max: 0, brokenThreshold: 0 };
  html.querySelector('input[name="hp.value"]').value = hp.value ?? 0;
  html.querySelector('input[name="hp.max"]').value = hp.max ?? 0;
  html.querySelector('input[name="hp.brokenThreshold"]').value = hp.brokenThreshold ?? 0;
  html.querySelector('input[name="hardness"]').value = item.system.hardness ?? 0;
}

async function setItemDurability() {
  const i18n = key => game.i18n.localize(`pf2e-customizations.macro.setItemDurability.${key}`);

  // Resolve actor: prefer controlled token, fall back to owned actors.
  const controlledToken = canvas.tokens?.controlled[0];
  const ownedActors = game.actors.filter(a => a.isOwner).sort((a, b) => a.name.localeCompare(b.name));

  if (!controlledToken && !ownedActors.length) {
    ui.notifications.warn(i18n('noActors'));
    return;
  }

  const initialActor = controlledToken?.actor ?? ownedActors[0];
  const initialItems = getPhysicalItems(initialActor);
  const initialItem = initialItems[0] ?? null;
  const initialHp = initialItem?.system.hp ?? { value: 0, max: 0, brokenThreshold: 0 };
  const initialHardness = initialItem?.system.hardness ?? 0;

  const showActorSelect = ownedActors.length > 1;
  const actorOptions = ownedActors
    .map(a => `<option value="${a.id}"${a.id === initialActor.id ? ' selected' : ''}>${a.name}</option>`)
    .join('');

  const content = `
    <form class="pf2e-customizations-macro-form">
      ${showActorSelect ? `
      <div class="form-group">
        <label>${i18n('actor')}</label>
        <div class="form-fields">
          <select name="actorId">${actorOptions}</select>
        </div>
      </div>` : `<input type="hidden" name="actorId" value="${initialActor.id}">`}
      <div class="form-group">
        <label>${i18n('item')}</label>
        <div class="form-fields">
          <select name="itemId">${buildItemOptions(initialItems, initialItem?.id)}</select>
        </div>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize('pf2e-customizations.durability.hp')}</label>
        <div class="form-fields">
          <input type="number" name="hp.value" value="${initialHp.value ?? 0}" min="0">
          <span class="sep">/</span>
          <input type="number" name="hp.max" value="${initialHp.max ?? 0}" min="0">
        </div>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize('pf2e-customizations.durability.bt')}</label>
        <div class="form-fields">
          <input type="number" name="hp.brokenThreshold" value="${initialHp.brokenThreshold ?? 0}" min="0">
        </div>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize('pf2e-customizations.durability.hardness')}</label>
        <div class="form-fields">
          <input type="number" name="hardness" value="${initialHardness}" min="0">
        </div>
      </div>
    </form>
  `;

  return new Promise(resolve => {
    new Dialog({
      title: i18n('title'),
      content,
      buttons: {
        save: {
          label: i18n('save'),
          callback: async (html) => {
            const form = html[0].querySelector('form');
            const data = new FormData(form);
            const actorId = data.get('actorId');
            const itemId = data.get('itemId');
            const actor = game.actors.get(actorId);
            const item = actor?.items.get(itemId);
            if (!item) { resolve(null); return; }
            await item.update({
              'system.hp.value': Number(data.get('hp.value')),
              'system.hp.max': Number(data.get('hp.max')),
              'system.hp.brokenThreshold': Number(data.get('hp.brokenThreshold')),
              'system.hardness': Number(data.get('hardness')),
            });
            ui.notifications.info(game.i18n.format('pf2e-customizations.macro.setItemDurability.saved', { name: item.name }));
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
        const actorSelect = root.querySelector('select[name="actorId"]');
        const itemSelect = root.querySelector('select[name="itemId"]');

        if (actorSelect) {
          actorSelect.addEventListener('change', () => {
            const actor = game.actors.get(actorSelect.value);
            const items = actor ? getPhysicalItems(actor) : [];
            itemSelect.innerHTML = buildItemOptions(items, items[0]?.id);
            populateItemFields(root, items[0] ?? null);
          });
        }

        itemSelect.addEventListener('change', () => {
          const actor = game.actors.get(root.querySelector('[name="actorId"]').value);
          const item = actor?.items.get(itemSelect.value) ?? null;
          populateItemFields(root, item);
        });
      },
      default: 'save',
    }).render(true);
  });
}

export function initSetItemDurabilityMacro() {
  globalThis.pf2eCustomizations ??= {};
  globalThis.pf2eCustomizations.setItemDurability = setItemDurability;
}
