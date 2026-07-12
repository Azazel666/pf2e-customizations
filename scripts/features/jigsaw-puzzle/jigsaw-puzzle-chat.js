import { JigsawPuzzleApp } from './jigsaw-puzzle-app.js';
import { generateAttempt } from './jigsaw-puzzle-logic.js';

const FLAG_SCOPE = 'pf2e-customizations';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

// ChatMessage documents have no `ownership` schema field in v13, so a player can never be granted
// write access to a GM-authored message. Claim/outcome state instead lives on the acting actor's
// flags (namespaced per message id) since the owning player already has real OWNER permission there.
function getAttemptState(actor, messageId) {
  return actor?.getFlag(FLAG_SCOPE, `jigsawPuzzle.${messageId}`) ?? { claimedBy: null, resolved: null };
}

async function setAttemptState(actor, messageId, patch) {
  const current = getAttemptState(actor, messageId);
  await actor.setFlag(FLAG_SCOPE, `jigsawPuzzle.${messageId}`, { ...current, ...patch });
}

function statusHtml(state, actor) {
  const i18n = (key) => game.i18n.localize(`pf2e-customizations.jigsawPuzzle.card.${key}`);
  const isOwner = actor?.isOwner ?? false;

  if (state.resolved === 'criticalSuccess' || state.resolved === 'success') {
    return `<p class="jigsaw-puzzle-card-outcome is-success">${i18n(state.resolved)}</p>`;
  }

  // No lockout/reset flow — every outcome (including criticalFailure) stays freely re-attemptable
  // via a fresh GM request.
  const failureNote = (state.resolved === 'failure' || state.resolved === 'criticalFailure')
    ? `<p class="jigsaw-puzzle-card-outcome is-failure">${i18n(state.resolved)}</p>`
    : '';

  if (!isOwner) return failureNote;

  if (state.claimedBy) {
    const label = state.claimedBy === game.user.id
      ? i18n('inProgressSelf')
      : game.i18n.format('pf2e-customizations.jigsawPuzzle.card.inProgress', {
          name: escapeHtml(game.users.get(state.claimedBy)?.name ?? '?'),
        });
    return `${failureNote}<p class="jigsaw-puzzle-card-status-text">${label}</p>`;
  }

  return `${failureNote}<button type="button" data-jigsaw-puzzle-action="attempt">${i18n('attempt')}</button>`;
}

async function onAttempt(message, config, actor) {
  const current = getAttemptState(actor, message.id);
  if (current.claimedBy) {
    ui.notifications.warn(game.i18n.localize('pf2e-customizations.jigsawPuzzle.card.alreadyClaimed'));
    return;
  }

  await setAttemptState(actor, message.id, { claimedBy: game.user.id });
  const settled = getAttemptState(actor, message.id);
  if (settled.claimedBy !== game.user.id) {
    ui.notifications.warn(game.i18n.localize('pf2e-customizations.jigsawPuzzle.card.alreadyClaimed'));
    return;
  }

  // Unlike every other randomized element of this feature, `imagePath`/`aspectRatio` are NOT
  // resolved fresh here — they're resolved once by the GM at request time instead (see
  // request-jigsaw-puzzle.js). This is a deliberate exception: resolving the image pool requires
  // FilePicker.browse, which needs the "Use File Browser" permission — commonly GM-only by default
  // in a world's permission config. Browsing here (run by whichever player clicks Attempt) surfaced
  // exactly that wall in practice: players got "No puzzle images are available" even when images
  // existed, because they simply weren't permitted to list them. The GM always has full browse
  // permission, so resolving once at request time sidesteps the problem entirely — at the cost of
  // the chosen image no longer varying across re-attempts of the same request (grid layout and tray
  // shuffle still regenerate fresh every attempt, unaffected).
  const attempt = generateAttempt({ dc: config.dc, imagePath: config.imagePath, aspectRatio: config.aspectRatio });

  const result = await JigsawPuzzleApp.run({
    actor,
    skillSlug: config.skillSlug,
    circumstanceMod: config.circumstanceMod,
    allowCriticalOutcomes: config.allowCriticalOutcomes,
    ...attempt,
  });

  const patch = { claimedBy: null };
  if (result.attempted) patch.resolved = result.outcome;
  await setAttemptState(actor, message.id, patch);
}

function renderCard(message, element) {
  const config = message.getFlag(FLAG_SCOPE, 'jigsawPuzzle');
  if (!config) return;

  // The DC is never shown to players — only rendered into this client's own DOM when the viewing
  // user is a GM, never written into the message's shared/stored content. Same soft-hiding pattern
  // as the other four features.
  const gmDcEl = element.querySelector('[data-jigsaw-puzzle-gm-dc]');
  if (gmDcEl) {
    gmDcEl.style.display = game.user.isGM ? '' : 'none';
    gmDcEl.textContent = game.user.isGM
      ? game.i18n.format('pf2e-customizations.jigsawPuzzle.card.gmOnlyDc', { dc: config.dc })
      : '';
  }

  const container = element.querySelector('[data-jigsaw-puzzle-status]');
  if (!container) return;

  const actor = game.actors.get(config.actorId);
  const state = getAttemptState(actor, message.id);
  container.innerHTML = statusHtml(state, actor);

  container.querySelector('[data-jigsaw-puzzle-action="attempt"]')
    ?.addEventListener('click', () => onAttempt(message, config, actor));
}

function onRenderChatMessage(message, html) {
  const element = html instanceof HTMLElement ? html : html[0];
  renderCard(message, element);
}

// Updating actor flags doesn't trigger a chat re-render on its own (unlike updating the message
// itself would), so any currently-displayed jigsaw-puzzle card for this actor is refreshed by hand.
function onUpdateActor(actor, changes) {
  if (!foundry.utils.hasProperty(changes, `flags.${FLAG_SCOPE}.jigsawPuzzle`)) return;

  for (const message of game.messages) {
    const config = message.getFlag(FLAG_SCOPE, 'jigsawPuzzle');
    if (!config || config.actorId !== actor.id) continue;
    const element = document.querySelector(`[data-message-id="${message.id}"]`);
    if (element) renderCard(message, element);
  }
}

export function initJigsawPuzzle() {
  Hooks.on('renderChatMessageHTML', onRenderChatMessage);
  Hooks.on('updateActor', onUpdateActor);
}
