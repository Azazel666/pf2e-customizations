const CHAT_CARD_TEMPLATE = 'modules/pf2e-customizations/scripts/features/timeline-puzzle/timeline-puzzle-chat-card.hbs';

function skillLabel(skillSlug) {
  if (skillSlug === 'perception') {
    return game.i18n.localize('pf2e-customizations.timelinePuzzle.skill.perception');
  }
  return game.i18n.localize(CONFIG.PF2E.skills[skillSlug].label);
}

function buildSkillOptions() {
  const entries = [
    ...Object.entries(CONFIG.PF2E.skills).map(([slug, def]) => ({ slug, label: game.i18n.localize(def.label) })),
    { slug: 'perception', label: game.i18n.localize('pf2e-customizations.timelinePuzzle.skill.perception') },
  ];
  entries.sort((a, b) => a.label.localeCompare(b.label));
  return entries.map((entry) => `<option value="${entry.slug}">${entry.label}</option>`).join('');
}

async function requestTimelinePuzzle() {
  const i18n = (key) => game.i18n.localize(`pf2e-customizations.macro.requestTimelinePuzzle.${key}`);

  if (!game.user.isGM) {
    ui.notifications.warn(i18n('gmOnly'));
    return;
  }

  if (!game.settings.get('pf2e-customizations', 'timelinePuzzleEnabled')) {
    ui.notifications.warn(i18n('disabled'));
    return;
  }

  const controlledToken = canvas.tokens?.controlled[0];
  const pcActors = game.actors
    .filter((a) => a.type === 'character' && a.hasPlayerOwner)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!pcActors.length) {
    ui.notifications.warn(i18n('noActors'));
    return;
  }

  const controlledActor = controlledToken?.actor;
  const initialActor = (controlledActor?.type === 'character' && controlledActor.hasPlayerOwner)
    ? controlledActor
    : pcActors[0];

  const actorOptions = pcActors
    .map((a) => `<option value="${a.id}"${a.id === initialActor.id ? ' selected' : ''}>${a.name}</option>`)
    .join('');

  const content = `
    <form class="pf2e-customizations-macro-form">
      <div class="form-group">
        <label>${i18n('actor')}</label>
        <div class="form-fields">
          <select name="actorId">${actorOptions}</select>
        </div>
      </div>
      <div class="form-group">
        <label>${i18n('skill')}</label>
        <div class="form-fields">
          <select name="skillSlug">${buildSkillOptions()}</select>
        </div>
      </div>
      <div class="form-group">
        <label>${i18n('dc')}</label>
        <div class="form-fields">
          <input type="number" name="dc" value="20">
        </div>
      </div>
      <div class="form-group">
        <label>${i18n('circumstanceMod')}</label>
        <div class="form-fields">
          <input type="number" name="circumstanceMod" value="0" step="1">
        </div>
      </div>
      <div class="form-group">
        <label>${i18n('allowCriticalOutcomes')}</label>
        <div class="form-fields">
          <input type="checkbox" name="allowCriticalOutcomes" checked>
        </div>
      </div>
    </form>
  `;

  return new Promise((resolve) => {
    new Dialog({
      title: i18n('title'),
      content,
      buttons: {
        send: {
          label: i18n('send'),
          callback: async (html) => {
            const form = html[0].querySelector('form');
            const data = new FormData(form);
            const actor = game.actors.get(data.get('actorId'));
            const skillSlug = data.get('skillSlug');
            const dc = Number(data.get('dc'));
            const circumstanceModRaw = data.get('circumstanceMod');
            const circumstanceMod = circumstanceModRaw === '' ? 0 : Number(circumstanceModRaw);
            const allowCriticalOutcomes = form.querySelector('[name="allowCriticalOutcomes"]').checked;

            if (!actor || !Number.isFinite(dc) || !Number.isFinite(circumstanceMod)) {
              ui.notifications.error(i18n('invalidDc'));
              resolve(null);
              return;
            }

            // DC is used exactly as entered — never clamped to 15-40. The DC->grid-size table is
            // open-ended at both extremes, and clamping would corrupt neededRoll's odds calculation
            // for any real check outside that band.
            //
            // Only the GM's raw inputs are stored here — event sampling, display shuffle, clue
            // generation, and the neededRoll/clueMode odds calculation are NOT baked in at request
            // time. They're computed fresh every time a player clicks "Attempt Timeline" (see
            // onAttempt in timeline-puzzle-chat.js), so re-attempting the same request — including
            // after cancelling — gets a genuinely new puzzle each time, not a replay of the first one.
            const cardContent = await renderTemplate(CHAT_CARD_TEMPLATE, {
              actorName: actor.name,
              skillLabel: skillLabel(skillSlug),
            });

            // ChatMessage documents have no `ownership` schema field, so players can never be granted
            // write access to a GM-authored message. This message's flags are write-once (set here,
            // read-only afterward); claim/outcome state lives on the actor instead (see
            // timeline-puzzle-chat.js).
            const message = await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor }),
              content: cardContent,
              flags: {
                'pf2e-customizations': {
                  timelinePuzzle: {
                    actorId: actor.id,
                    dc,
                    skillSlug,
                    circumstanceMod,
                    allowCriticalOutcomes,
                  },
                },
              },
            });

            resolve(message);
          },
        },
        cancel: {
          label: i18n('cancel'),
          callback: () => resolve(null),
        },
      },
      default: 'send',
    }).render(true);
  });
}

export function initRequestTimelinePuzzleMacro() {
  globalThis.pf2eCustomizations ??= {};
  globalThis.pf2eCustomizations.requestTimelinePuzzle = requestTimelinePuzzle;
}
