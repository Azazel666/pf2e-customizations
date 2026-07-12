const CHAT_CARD_TEMPLATE = 'modules/pf2e-customizations/scripts/features/jigsaw-puzzle/jigsaw-puzzle-chat-card.hbs';
const BUNDLED_IMAGE_DIR = 'modules/pf2e-customizations/assets/features/jigsaw-puzzle';
const IMAGE_EXTENSIONS = ['.webp', '.png', '.jpg', '.jpeg', '.svg'];

// FilePicker.browse requires the "Use File Browser" permission, which many worlds restrict to GMs
// by default — resolving the image pool here (always GM-run) rather than in onAttempt() (run by
// whichever player is attempting) sidesteps that permission wall entirely. See
// jigsaw-puzzle-chat.js's onAttempt() for the fuller writeup of why this moved.
async function listImages(folderPath) {
  if (!folderPath) return [];
  try {
    const result = await foundry.applications.apps.FilePicker.browse('data', folderPath, {
      extensions: IMAGE_EXTENSIONS,
    });
    return result.files ?? [];
  } catch (err) {
    console.warn('pf2e-customizations | jigsaw-puzzle: failed to browse', folderPath, err);
    return [];
  }
}

async function buildImagePool() {
  const bundled = await listImages(BUNDLED_IMAGE_DIR);
  const customFolder = game.settings.get('pf2e-customizations', 'jigsawPuzzleCustomImageFolder');
  const custom = customFolder ? await listImages(customFolder) : [];
  if (custom.length === 0) return bundled;
  const includeBundled = game.settings.get('pf2e-customizations', 'jigsawPuzzleIncludeBundledWithCustom');
  return includeBundled ? [...bundled, ...custom] : custom;
}

async function pickRandomImage() {
  const pool = await buildImagePool();
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function preloadImage(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error(`Failed to load image: ${path}`));
    img.src = path;
  });
}

function skillLabel(skillSlug) {
  if (skillSlug === 'perception') {
    return game.i18n.localize('pf2e-customizations.jigsawPuzzle.skill.perception');
  }
  return game.i18n.localize(CONFIG.PF2E.skills[skillSlug].label);
}

function buildSkillOptions() {
  const entries = [
    ...Object.entries(CONFIG.PF2E.skills).map(([slug, def]) => ({ slug, label: game.i18n.localize(def.label) })),
    { slug: 'perception', label: game.i18n.localize('pf2e-customizations.jigsawPuzzle.skill.perception') },
  ];
  entries.sort((a, b) => a.label.localeCompare(b.label));
  return entries.map((entry) => `<option value="${entry.slug}">${entry.label}</option>`).join('');
}

async function requestJigsawPuzzle() {
  const i18n = (key) => game.i18n.localize(`pf2e-customizations.macro.requestJigsawPuzzle.${key}`);

  if (!game.user.isGM) {
    ui.notifications.warn(i18n('gmOnly'));
    return;
  }

  if (!game.settings.get('pf2e-customizations', 'jigsawPuzzleEnabled')) {
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
      <div class="form-group">
        <label>${i18n('imageSourceMode')}</label>
        <div class="form-fields">
          <select name="imageSourceMode" data-image-source-mode>
            <option value="random" selected>${i18n('imageSourceRandom')}</option>
            <option value="specific">${i18n('imageSourceSpecific')}</option>
          </select>
        </div>
      </div>
      <div class="form-group" data-specific-image-row style="display: none;">
        <label>${i18n('specificImage')}</label>
        <div class="form-fields">
          <file-picker type="image" name="specificImagePath" value=""></file-picker>
        </div>
      </div>
    </form>
  `;

  return new Promise((resolve) => {
    new Dialog({
      title: i18n('title'),
      content,
      render: (html) => {
        const root = html instanceof HTMLElement ? html : html[0];
        const modeSelect = root.querySelector('[data-image-source-mode]');
        const specificRow = root.querySelector('[data-specific-image-row]');
        modeSelect?.addEventListener('change', () => {
          specificRow.style.display = modeSelect.value === 'specific' ? '' : 'none';
        });
      },
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
            const imageSourceMode = form.querySelector('[data-image-source-mode]').value;
            // Read directly off the custom element rather than trusting FormData to have picked it
            // up — <file-picker> is form-associated, but this is the first use of it in this
            // codebase inside a bare Dialog-rendered form, unproven here until smoke-tested.
            const specificImagePathRaw = form.querySelector('file-picker[name="specificImagePath"]')?.value ?? '';
            const specificImagePath = imageSourceMode === 'specific' && specificImagePathRaw
              ? specificImagePathRaw
              : null;

            if (!actor || !Number.isFinite(dc) || !Number.isFinite(circumstanceMod)) {
              ui.notifications.error(i18n('invalidDc'));
              resolve(null);
              return;
            }

            if (imageSourceMode === 'specific' && !specificImagePath) {
              ui.notifications.error(i18n('missingSpecificImage'));
              resolve(null);
              return;
            }

            // Resolved here (GM-run) rather than per-attempt, unlike every other randomized element
            // of this feature — see the onAttempt() comment in jigsaw-puzzle-chat.js for why. This
            // means the chosen image no longer varies across re-attempts of the same request (grid
            // layout and tray shuffle still do), a deliberate, documented exception to "nothing
            // derived is baked in at request time."
            const imagePath = imageSourceMode === 'specific' ? specificImagePath : await pickRandomImage();
            if (!imagePath) {
              ui.notifications.error(i18n('noImages'));
              resolve(null);
              return;
            }

            let dimensions;
            try {
              dimensions = await preloadImage(imagePath);
            } catch (err) {
              console.error('pf2e-customizations | jigsaw-puzzle: image preload failed', err);
              ui.notifications.error(i18n('imageLoadFailed'));
              resolve(null);
              return;
            }
            const aspectRatio = `${dimensions.width} / ${dimensions.height}`;

            const cardContent = await renderTemplate(CHAT_CARD_TEMPLATE, {
              actorName: actor.name,
              skillLabel: skillLabel(skillSlug),
            });

            // ChatMessage documents have no `ownership` schema field, so players can never be granted
            // write access to a GM-authored message. This message's flags are write-once (set here,
            // read-only afterward); claim/outcome state lives on the actor instead (see
            // jigsaw-puzzle-chat.js).
            const message = await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor }),
              content: cardContent,
              flags: {
                'pf2e-customizations': {
                  jigsawPuzzle: {
                    actorId: actor.id,
                    dc,
                    skillSlug,
                    circumstanceMod,
                    allowCriticalOutcomes,
                    imagePath,
                    aspectRatio,
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

export function initRequestJigsawPuzzleMacro() {
  globalThis.pf2eCustomizations ??= {};
  globalThis.pf2eCustomizations.requestJigsawPuzzle = requestJigsawPuzzle;
}
