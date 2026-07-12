import {
  getPuzzleIndex, getPuzzleBoard, createPuzzle, renamePuzzle, deletePuzzle,
  setPendingRollRequest, revealPuzzle,
} from './puzzle-board-data.js';
import { computeGridDimensions, PUZZLE_BOARD_CONFIG } from './puzzle-board-logic.js';
import { resolvePendingRoll, CHECK_TYPES, extractSkillSlug } from './puzzle-board-roll-listener.js';

const TEMPLATE_PATH = 'modules/pf2e-customizations/scripts/features/puzzle-board/puzzle-board-manager-app.hbs';
const CHAT_CARD_TEMPLATE = 'modules/pf2e-customizations/scripts/features/puzzle-board/puzzle-board-roll-request-chat-card.hbs';
const REVEAL_CHAT_CARD_TEMPLATE = 'modules/pf2e-customizations/scripts/features/puzzle-board/puzzle-board-reveal-chat-card.hbs';
const FLAG_SCOPE = 'pf2e-customizations';

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
    return game.i18n.localize('pf2e-customizations.puzzleBoard.skill.perception');
  }
  // Falls back to the raw slug for anything not in the fixed skill list (e.g. a Lore skill's
  // dynamic, actor-specific slug) — a real crash caught during live testing when the "Resolve
  // Manually" candidate list included a check whose slug had no CONFIG.PF2E.skills entry.
  const label = CONFIG.PF2E.skills[skillSlug]?.label;
  return label ? game.i18n.localize(label) : (skillSlug ?? '?');
}

function buildSkillOptions() {
  const entries = [
    ...Object.entries(CONFIG.PF2E.skills).map(([slug, def]) => ({ slug, label: game.i18n.localize(def.label) })),
    { slug: 'perception', label: game.i18n.localize('pf2e-customizations.puzzleBoard.skill.perception') },
  ];
  entries.sort((a, b) => a.label.localeCompare(b.label));
  return entries.map((entry) => `<option value="${entry.slug}">${entry.label}</option>`).join('');
}

// Same request-Dialog shape as every sibling feature's own GM request form (actor/skill/DC/
// circumstance mod), duplicated locally per this codebase's self-contained-feature-folder
// convention rather than importing across features.
async function promptForDifficultyRoll(puzzleName) {
  const i18n = (key) => game.i18n.localize(`pf2e-customizations.puzzleBoard.manager.rollDialog.${key}`);

  const controlledToken = canvas.tokens?.controlled[0];
  const pcActors = game.actors
    .filter((a) => a.type === 'character' && a.hasPlayerOwner)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!pcActors.length) {
    ui.notifications.warn(i18n('noActors'));
    return null;
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
        <div class="form-fields"><select name="actorId">${actorOptions}</select></div>
      </div>
      <div class="form-group">
        <label>${i18n('skill')}</label>
        <div class="form-fields"><select name="skillSlug">${buildSkillOptions()}</select></div>
      </div>
      <div class="form-group">
        <label>${i18n('dc')}</label>
        <div class="form-fields"><input type="number" name="dc" value="20"></div>
      </div>
      <div class="form-group">
        <label>${i18n('circumstanceMod')}</label>
        <div class="form-fields"><input type="number" name="circumstanceMod" value="0" step="1"></div>
      </div>
      <p class="notes">${i18n('circumstanceModNote')}</p>
    </form>
  `;

  return new Promise((resolve) => {
    new Dialog({
      title: game.i18n.format('pf2e-customizations.puzzleBoard.manager.rollDialog.title', { name: puzzleName }),
      content,
      buttons: {
        send: {
          label: i18n('send'),
          callback: (html) => {
            const form = html[0].querySelector('form');
            const data = new FormData(form);
            const actor = game.actors.get(data.get('actorId'));
            const skillSlug = data.get('skillSlug');
            const dc = Number(data.get('dc'));
            const circumstanceModRaw = data.get('circumstanceMod');
            const circumstanceMod = circumstanceModRaw === '' ? 0 : Number(circumstanceModRaw);

            if (!actor || !Number.isFinite(dc) || !Number.isFinite(circumstanceMod)) {
              ui.notifications.error(i18n('invalidDc'));
              resolve(null);
              return;
            }
            resolve({ actor, skillSlug, dc, circumstanceMod });
          },
        },
        cancel: { label: i18n('cancel'), callback: () => resolve(null) },
      },
      default: 'send',
    }).render(true);
  });
}

async function promptForText({ title, label, initialValue }) {
  return new Promise((resolve) => {
    new Dialog({
      title,
      content: `
        <form>
          <div class="form-group">
            <label>${label}</label>
            <div class="form-fields"><input type="text" name="value" value="${initialValue.replace(/"/g, '&quot;')}"></div>
          </div>
        </form>
      `,
      buttons: {
        save: {
          label: game.i18n.localize('pf2e-customizations.puzzleBoard.manager.save'),
          callback: (html) => resolve(html[0].querySelector('[name="value"]').value.trim()),
        },
        cancel: { label: game.i18n.localize('pf2e-customizations.puzzleBoard.manager.cancel'), callback: () => resolve(null) },
      },
      default: 'save',
    }).render(true);
  });
}

async function postRollRequestChatMessage(journalEntry, pendingRollRequest) {
  const actor = game.actors.get(pendingRollRequest.actorId);
  const board = getPuzzleBoard(journalEntry);
  const cardContent = await foundry.applications.handlebars.renderTemplate(CHAT_CARD_TEMPLATE, {
    actorName: actor?.name ?? '?',
    skillLabel: skillLabel(pendingRollRequest.skillSlug),
    puzzleName: board?.name ?? journalEntry.name,
  });

  // Write-once display cache on the message itself — the actual correlation source of truth is
  // the journal entry's own pendingRollRequest (see puzzle-board-roll-listener.js).
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: cardContent,
    flags: {
      [FLAG_SCOPE]: {
        rollRequest: {
          actorId: pendingRollRequest.actorId,
          dc: pendingRollRequest.dc,
          skillSlug: pendingRollRequest.skillSlug,
        },
      },
    },
  });
}

// Posted once per reveal, visible to everyone — this is what lets players discover a newly
// revealed puzzle without already knowing to run the "open puzzle board" macro. The button's
// click handler is wired in puzzle-board-roll-listener.js's renderChatMessageHTML hook.
async function postRevealChatMessage(journalEntry) {
  const board = getPuzzleBoard(journalEntry);
  const cardContent = await foundry.applications.handlebars.renderTemplate(REVEAL_CHAT_CARD_TEMPLATE, {
    puzzleName: board?.name ?? journalEntry.name,
  });

  await ChatMessage.create({
    content: cardContent,
    flags: {
      [FLAG_SCOPE]: {
        reveal: { journalEntryId: journalEntry.id },
      },
    },
  });
}

function journalEntryFromRow(target) {
  const journalEntryId = target.closest('[data-journal-entry-id]')?.dataset.journalEntryId;
  return journalEntryId ? game.journal.get(journalEntryId) : null;
}

export class PuzzleBoardManagerApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static #instance = null;

  static show() {
    this.#instance ??= new PuzzleBoardManagerApp();
    this.#instance.render(true);
    return this.#instance;
  }

  static DEFAULT_OPTIONS = {
    id: 'pf2e-customizations-puzzle-board-manager',
    classes: ['pf2e-customizations', 'puzzle-board-manager-app'],
    tag: 'div',
    window: {
      title: 'pf2e-customizations.puzzleBoard.manager.appTitle',
      resizable: true,
      minimizable: true,
    },
    position: { width: 640, height: 640 },
    actions: {
      showCreateForm: PuzzleBoardManagerApp.#onShowCreateForm,
      cancelCreateForm: PuzzleBoardManagerApp.#onCancelCreateForm,
      submitCreateForm: PuzzleBoardManagerApp.#onSubmitCreateForm,
      requestRoll: PuzzleBoardManagerApp.#onRequestRoll,
      resolveManually: PuzzleBoardManagerApp.#onResolveManually,
      reveal: PuzzleBoardManagerApp.#onReveal,
      rename: PuzzleBoardManagerApp.#onRename,
      delete: PuzzleBoardManagerApp.#onDelete,
    },
  };

  static PARTS = {
    manager: { template: TEMPLATE_PATH, root: true },
  };

  #creatingPuzzle = false;
  #hookId = null;

  async _prepareContext() {
    const index = getPuzzleIndex();
    const rows = index.puzzles.map((entry) => {
      const journalEntry = game.journal.get(entry.journalEntryId);
      const board = getPuzzleBoard(journalEntry);
      const status = board?.status ?? 'missing';
      return {
        journalEntryId: entry.journalEntryId,
        name: entry.name,
        statusLabel: game.i18n.localize(`pf2e-customizations.puzzleBoard.manager.status.${status}`),
        difficultyLabel: board?.difficultyTier
          ? game.i18n.localize(`pf2e-customizations.puzzleBoard.manager.difficulty.${board.difficultyTier}`)
          : null,
        pendingActorName: board?.pendingRollRequest?.actorName ?? null,
        pieceCount: board?.pieceCount ?? 0,
        solved: board?.solved ?? false,
        revealed: entry.revealed,
        canRequestRoll: status === 'draft',
        canResolveManually: status === 'awaiting-roll',
        canReveal: status === 'ready',
      };
    });

    return {
      rows,
      hasRows: rows.length > 0,
      creatingPuzzle: this.#creatingPuzzle,
      defaultPieceCount: PUZZLE_BOARD_CONFIG.DEFAULT_PIECE_COUNT,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Any journal-entry change (a roll resolving, a reveal from elsewhere) should refresh this
    // list live while it's open — registered per-instance, removed on close, same lifecycle
    // discipline as the player-facing app's own live-sync hook.
    this.#hookId ??= Hooks.on('updateJournalEntry', () => this.render());
  }

  _onClose(options) {
    if (this.#hookId !== null) {
      Hooks.off('updateJournalEntry', this.#hookId);
      this.#hookId = null;
    }
    super._onClose(options);
  }

  static #onShowCreateForm() {
    this.#creatingPuzzle = true;
    this.render();
  }

  static #onCancelCreateForm() {
    this.#creatingPuzzle = false;
    this.render();
  }

  static async #onSubmitCreateForm() {
    const form = this.element.querySelector('[data-puzzle-board-create-form]');
    const name = form.querySelector('[name="name"]').value.trim();
    const requestedPieceCount = Number(form.querySelector('[name="pieceCount"]').value);
    // Read directly off the custom element rather than trusting FormData to have picked it up —
    // same defensive convention as request-jigsaw-puzzle.js's own first use of <file-picker>.
    const imagePath = form.querySelector('file-picker[name="imagePath"]')?.value ?? '';

    const i18n = (key) => game.i18n.localize(`pf2e-customizations.puzzleBoard.manager.createForm.${key}`);

    if (!name) { ui.notifications.error(i18n('missingName')); return; }
    if (!imagePath) { ui.notifications.error(i18n('missingImage')); return; }
    if (!Number.isFinite(requestedPieceCount) || requestedPieceCount < 4) {
      ui.notifications.error(i18n('invalidPieceCount'));
      return;
    }

    let dimensions;
    try {
      dimensions = await preloadImage(imagePath);
    } catch (err) {
      console.error('pf2e-customizations | puzzle-board: image preload failed', err);
      ui.notifications.error(i18n('imageLoadFailed'));
      return;
    }

    const aspectRatio = dimensions.width / dimensions.height;
    const { cols, rows, pieceCount } = computeGridDimensions(requestedPieceCount, aspectRatio);
    await createPuzzle({ name, imagePath, aspectRatio, requestedPieceCount, cols, rows, pieceCount });

    this.#creatingPuzzle = false;
    this.render();
  }

  static async #onRequestRoll(_event, target) {
    const journalEntry = journalEntryFromRow(target);
    if (!journalEntry) return;
    const board = getPuzzleBoard(journalEntry);

    const result = await promptForDifficultyRoll(board?.name ?? journalEntry.name);
    if (!result) return;

    // Soft-warn (not hard-block) if this actor already has another puzzle's pendingRollRequest
    // open — reduces (but doesn't eliminate) ambiguous-match races where the actor's next roll
    // could resolve the wrong puzzle. Full disambiguation would need per-roll correlation IDs
    // threaded through the PF2e roll dialog, which isn't a supported extension point.
    const index = getPuzzleIndex();
    const conflict = index.puzzles.find((entry) => {
      if (entry.journalEntryId === journalEntry.id) return false;
      const otherBoard = getPuzzleBoard(game.journal.get(entry.journalEntryId));
      return otherBoard?.pendingRollRequest?.actorId === result.actor.id;
    });
    if (conflict) {
      const proceed = await Dialog.confirm({
        title: game.i18n.localize('pf2e-customizations.puzzleBoard.manager.rollDialog.conflictTitle'),
        content: `<p>${game.i18n.format('pf2e-customizations.puzzleBoard.manager.rollDialog.conflictBody', {
          actor: result.actor.name, other: conflict.name,
        })}</p>`,
      });
      if (!proceed) return;
    }

    const pendingRollRequest = {
      requestId: foundry.utils.randomID(),
      actorId: result.actor.id,
      actorUuid: result.actor.uuid,
      actorName: result.actor.name,
      skillSlug: result.skillSlug,
      dc: result.dc,
      circumstanceMod: result.circumstanceMod,
      requestedAt: Date.now(),
      requestedByUserId: game.user.id,
    };
    await setPendingRollRequest(journalEntry, pendingRollRequest);
    await postRollRequestChatMessage(journalEntry, pendingRollRequest);
    this.render();
  }

  static async #onResolveManually(_event, target) {
    const journalEntry = journalEntryFromRow(target);
    if (!journalEntry) return;

    const i18n = (key) => game.i18n.localize(`pf2e-customizations.puzzleBoard.manager.resolveManually.${key}`);
    const candidates = game.messages.contents
      .filter((m) => CHECK_TYPES.has(m.flags?.pf2e?.context?.type) && m.flags?.pf2e?.context?.outcome)
      .slice(-50)
      .reverse();

    if (!candidates.length) {
      ui.notifications.warn(i18n('noCandidates'));
      return;
    }

    const options = candidates.map((m) => {
      const ctx = m.flags.pf2e.context;
      const actorName = m.speaker?.alias ?? '?';
      const skill = skillLabel(extractSkillSlug(ctx));
      return `<option value="${m.id}">${actorName} — ${skill} (${ctx.outcome})</option>`;
    }).join('');

    const messageId = await new Promise((resolve) => {
      new Dialog({
        title: i18n('title'),
        content: `<form><div class="form-group"><select name="messageId">${options}</select></div></form>`,
        buttons: {
          resolve: { label: i18n('resolve'), callback: (html) => resolve(html[0].querySelector('[name="messageId"]').value) },
          cancel: { label: i18n('cancel'), callback: () => resolve(null) },
        },
        default: 'resolve',
      }).render(true);
    });

    if (!messageId) return;
    const message = game.messages.get(messageId);
    const resolved = await resolvePendingRoll(journalEntry, message.flags.pf2e.context);
    ui.notifications[resolved ? 'info' : 'warn'](i18n(resolved ? 'success' : 'mismatch'));
    this.render();
  }

  static async #onReveal(_event, target) {
    const journalEntry = journalEntryFromRow(target);
    if (!journalEntry) return;
    await revealPuzzle(journalEntry);
    await postRevealChatMessage(journalEntry);
    this.render();
  }

  static async #onRename(_event, target) {
    const journalEntry = journalEntryFromRow(target);
    if (!journalEntry) return;
    const name = await promptForText({
      title: game.i18n.localize('pf2e-customizations.puzzleBoard.manager.renameDialog.title'),
      label: game.i18n.localize('pf2e-customizations.puzzleBoard.manager.renameDialog.name'),
      initialValue: journalEntry.name,
    });
    if (!name) return;
    await renamePuzzle(journalEntry, name);
    this.render();
  }

  static async #onDelete(_event, target) {
    const journalEntry = journalEntryFromRow(target);
    if (!journalEntry) return;
    const confirmed = await Dialog.confirm({
      title: game.i18n.localize('pf2e-customizations.puzzleBoard.manager.deleteDialog.title'),
      content: `<p>${game.i18n.format('pf2e-customizations.puzzleBoard.manager.deleteDialog.body', { name: journalEntry.name })}</p>`,
    });
    if (!confirmed) return;
    await deletePuzzle(journalEntry);
    this.render();
  }
}
