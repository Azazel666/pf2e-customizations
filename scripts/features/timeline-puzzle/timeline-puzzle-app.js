import {
  baseTimeAllowanceSeconds,
  liveTotalPcStat,
  resolveOutcomeOnCorrectSubmission,
  resolveOutcomeOnExpiration,
} from './timeline-puzzle-logic.js';

const TEMPLATE_PATH = 'modules/pf2e-customizations/scripts/features/timeline-puzzle/timeline-puzzle-app.hbs';
const GLITCH_FLASH_MS = 400;

function arraysEqual(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function formatSeconds(totalSeconds) {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export class TimelinePuzzleApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: 'pf2e-customizations-timeline-puzzle',
    classes: ['pf2e-customizations', 'timeline-puzzle-app'],
    tag: 'div',
    window: {
      title: 'pf2e-customizations.timelinePuzzle.appTitle',
      resizable: false,
      minimizable: false,
    },
    position: { width: 780 },
    actions: {
      begin: TimelinePuzzleApp.#onBegin,
      moveLeft: TimelinePuzzleApp.#onMoveLeft,
      moveRight: TimelinePuzzleApp.#onMoveRight,
      checkOrder: TimelinePuzzleApp.#onCheckOrder,
      showHelp: TimelinePuzzleApp.#onShowHelp,
      closeHelp: TimelinePuzzleApp.#onCloseHelp,
    },
  };

  static PARTS = {
    puzzle: { template: TEMPLATE_PATH, root: true },
  };

  /** Opens the puzzle and resolves once it ends, for any reason. */
  static async run({ actor, skillSlug, circumstanceMod, allowCriticalOutcomes, eventCount, solutionOrder, displayOrder, clues }) {
    return new Promise((resolve) => {
      const app = new TimelinePuzzleApp({
        actor, skillSlug, circumstanceMod, allowCriticalOutcomes, eventCount, solutionOrder, displayOrder, clues, resolve,
      });
      app.render(true);
    });
  }

  #actor;
  #skillSlug;
  #circumstanceMod;
  #allowCriticalOutcomes;
  #eventCount;
  #solutionOrder;
  #displayOrder;
  #clueDescriptors;
  #resolve;
  #resolved = false;
  #result = null;
  #inputLocked = false;

  // 'instructions' (full how-to-play text, shown first unless the player opted out) or 'puzzle'
  // (the puzzle screen itself). Within 'puzzle', #started gates a second, always-required step:
  // clues, the grid, and the countdown are withheld until the player explicitly clicks Begin/Start
  // — even if the instructions text itself was skipped, starting the clock is never automatic.
  #stage = 'instructions';
  #started = false;
  #helpVisible = false;

  #startTimestamp = null;
  #baseTimeAllowanceSeconds = 0;
  #timerIntervalId = null;
  #gridEl = null;
  #dragSourceId = null;
  #glitchTimeoutId = null;

  constructor({ actor, skillSlug, circumstanceMod, allowCriticalOutcomes, eventCount, solutionOrder, displayOrder, clues, resolve, ...options }) {
    super(options);
    this.#actor = actor;
    this.#skillSlug = skillSlug;
    this.#circumstanceMod = circumstanceMod;
    this.#allowCriticalOutcomes = allowCriticalOutcomes;
    this.#eventCount = eventCount;
    this.#solutionOrder = solutionOrder;
    this.#displayOrder = [...displayOrder];
    this.#clueDescriptors = clues;
    this.#resolve = resolve;

    if (game.settings.get('pf2e-customizations', 'timelinePuzzleHideInstructions')) {
      this.#stage = 'puzzle';
    }
  }

  // Event bank entries (EVENT_BANK_IDS) are GM-authored display text used directly as both the
  // identifier and the label — no localization indirection, unlike the rest of this module's UI
  // strings. That's deliberate: they're free-form campaign content, not fixed module copy, so
  // there's nothing to translate against.
  #clueText(descriptor) {
    const format = (key, data) => game.i18n.format(`pf2e-customizations.timelinePuzzle.clue.${key}`, data);
    switch (descriptor.type) {
      case 'first':
        return format('first', { event: descriptor.eventId });
      case 'last':
        return format('last', { event: descriptor.eventId });
      case 'adjacent':
        return format('adjacent', { before: descriptor.beforeId, after: descriptor.afterId });
      default:
        return '';
    }
  }

  async _prepareContext(_options) {
    return {
      stage: this.#stage,
      started: this.#started,
      helpVisible: this.#helpVisible,
      actorName: this.#actor.name,
      eventCount: this.#eventCount,
      clueTexts: this.#clueDescriptors.map((descriptor) => this.#clueText(descriptor)),
      eventBlocks: this.#displayOrder.map((id, index) => ({ id, index: index + 1, label: id })),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // Clues/grid/countdown only exist in the DOM once the puzzle has actually started (see #stage/
    // #started above) — nothing to wire up before then.
    if (this.#stage !== 'puzzle' || !this.#started) return;

    this.#gridEl = this.element.querySelector('[data-timeline-puzzle-grid]');
    this.#wireDragAndDrop();
    this.#updateMoveButtonStates();

    // First (and only, by design — see #renderGrid/#paintRemaining below) render after starting:
    // start the live clock. Countdown ticks and reorders after this all patch the DOM directly
    // rather than calling this.render() again, so in-progress drag state and the running timer are
    // never disrupted.
    if (this.#startTimestamp === null) {
      this.#startTimestamp = Date.now();
      this.#baseTimeAllowanceSeconds = baseTimeAllowanceSeconds(
        liveTotalPcStat(this.#actor, this.#skillSlug, this.#circumstanceMod)
      );
      this.#tick();
      this.#timerIntervalId = setInterval(() => this.#tick(), 1000);
    }
  }

  #tick() {
    const elapsedSeconds = (Date.now() - this.#startTimestamp) / 1000;
    const remainingSeconds = Math.max(0, this.#baseTimeAllowanceSeconds - elapsedSeconds);

    const countdownEl = this.element.querySelector('[data-timeline-puzzle-countdown]');
    if (countdownEl) countdownEl.textContent = formatSeconds(remainingSeconds);

    if (remainingSeconds <= 0) this.#finishOnExpiration();
  }

  #wireDragAndDrop() {
    // Scoped to .timeline-event-block, not the broader [data-event-id] — the moveUp/moveDown
    // buttons nested inside each block also carry data-event-id (so their own click handler can
    // read it), so a bare attribute selector here would incorrectly match them too and get them
    // appended directly into the grid as siblings of the blocks on the very first reorder.
    const blocks = this.#gridEl?.querySelectorAll('.timeline-event-block') ?? [];
    for (const block of blocks) {
      block.addEventListener('dragstart', (event) => {
        this.#dragSourceId = block.dataset.eventId;
        // Firefox (and some other browsers) won't actually start a drag unless dataTransfer has
        // data set during dragstart — the id itself isn't read back on drop, #dragSourceId is.
        event.dataTransfer?.setData('text/plain', block.dataset.eventId ?? '');
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      block.addEventListener('dragover', (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        block.classList.add('is-drag-over');
      });
      block.addEventListener('dragleave', () => block.classList.remove('is-drag-over'));
      block.addEventListener('drop', (event) => {
        event.preventDefault();
        block.classList.remove('is-drag-over');
        this.#onDrop(block.dataset.eventId);
      });
    }
  }

  #onDrop(targetId) {
    const sourceId = this.#dragSourceId;
    this.#dragSourceId = null;
    if (this.#inputLocked || !sourceId || sourceId === targetId) return;

    const from = this.#displayOrder.indexOf(sourceId);
    const to = this.#displayOrder.indexOf(targetId);
    if (from === -1 || to === -1) return;

    this.#displayOrder.splice(from, 1);
    this.#displayOrder.splice(to, 0, sourceId);
    this.#renderGrid();
  }

  // Re-appends the existing block nodes (never recreated) into `#displayOrder`'s sequence — this
  // moves DOM nodes rather than replacing them, so drag listeners and focus state survive.
  #renderGrid() {
    if (!this.#gridEl) return;
    const nodesById = new Map();
    for (const node of this.#gridEl.querySelectorAll('.timeline-event-block')) {
      nodesById.set(node.dataset.eventId, node);
    }
    for (const id of this.#displayOrder) {
      const node = nodesById.get(id);
      if (node) this.#gridEl.appendChild(node);
    }
    this.#updateMoveButtonStates();
  }

  // Updates both the ▶/◀ disabled state AND the position badge — both depend purely on live DOM
  // order, so both are refreshed together here rather than via a full re-render (see #renderGrid).
  #updateMoveButtonStates() {
    const blocks = [...(this.#gridEl?.querySelectorAll('.timeline-event-block') ?? [])];
    blocks.forEach((block, index) => {
      const leftButton = block.querySelector('[data-action="moveLeft"]');
      const rightButton = block.querySelector('[data-action="moveRight"]');
      if (leftButton) leftButton.disabled = index === 0;
      if (rightButton) rightButton.disabled = index === blocks.length - 1;
      const indexEl = block.querySelector('.timeline-event-index');
      if (indexEl) indexEl.textContent = String(index + 1);
    });
  }

  #swap(eventId, direction) {
    if (this.#inputLocked) return;
    const index = this.#displayOrder.indexOf(eventId);
    const swapWith = index + direction;
    if (index === -1 || swapWith < 0 || swapWith >= this.#displayOrder.length) return;
    [this.#displayOrder[index], this.#displayOrder[swapWith]] = [this.#displayOrder[swapWith], this.#displayOrder[index]];
    this.#renderGrid();
  }

  #flashGlitch() {
    this.element.classList.add('is-glitch');
    clearTimeout(this.#glitchTimeoutId);
    this.#glitchTimeoutId = setTimeout(() => this.element.classList.remove('is-glitch'), GLITCH_FLASH_MS);
  }

  // Handles both possible entry points into real play: dismissing the full instructions screen,
  // and clicking Start on the compact "ready" screen (shown instead when instructions are hidden).
  // Either way, this is the one and only action that reveals clues/grid and starts the clock.
  static #onBegin() {
    const dontShowAgain = this.element.querySelector('[data-dont-show-again]')?.checked ?? false;
    if (dontShowAgain) game.settings.set('pf2e-customizations', 'timelinePuzzleHideInstructions', true);

    this.#stage = 'puzzle';
    this.#started = true;
    this.render();
  }

  static #onMoveLeft(_event, target) {
    this.#swap(target.dataset.eventId, -1);
  }

  static #onMoveRight(_event, target) {
    this.#swap(target.dataset.eventId, 1);
  }

  static #onCheckOrder() {
    if (this.#inputLocked) return;
    if (arraysEqual(this.#displayOrder, this.#solutionOrder)) {
      this.#finishOnSuccess();
    } else {
      this.#flashGlitch();
    }
  }

  // A full re-render, mirroring lock-picking's help toggle exactly (mutually exclusive with the
  // puzzle content in the template — never both in the DOM at once). Safe to re-render here: the
  // timer-start guard in _onRender keys off #startTimestamp, not off this being the "first" render,
  // so a help-triggered re-render never restarts the clock or loses displayOrder/clue state (both
  // are re-derived fresh from private fields on every _prepareContext call).
  static #onShowHelp() {
    this.#helpVisible = true;
    this.render();
  }

  static #onCloseHelp() {
    this.#helpVisible = false;
    this.render();
  }

  #lockInputs() {
    this.#inputLocked = true;
    this.element.classList.add('is-locked');
    if (this.#timerIntervalId !== null) {
      clearInterval(this.#timerIntervalId);
      this.#timerIntervalId = null;
    }
  }

  #finishOnSuccess() {
    if (this.#resolved) return;
    const elapsedSeconds = (Date.now() - this.#startTimestamp) / 1000;
    const outcome = resolveOutcomeOnCorrectSubmission(elapsedSeconds, this.#baseTimeAllowanceSeconds, this.#allowCriticalOutcomes);
    this.#settle({ outcome, attempted: true });
  }

  #finishOnExpiration() {
    if (this.#resolved) return;
    const outcome = resolveOutcomeOnExpiration(this.#displayOrder, this.#solutionOrder, this.#allowCriticalOutcomes);
    this.#settle({ outcome, attempted: true });
  }

  #settle(result) {
    if (this.#resolved) return;
    this.#resolved = true;
    this.#result = result;
    this.#lockInputs();
    if (this.rendered) this.close();
  }

  _onClose(options) {
    if (this.#timerIntervalId !== null) {
      clearInterval(this.#timerIntervalId);
      this.#timerIntervalId = null;
    }
    if (!this.#resolved) {
      this.#resolved = true;
      this.#result = { outcome: 'cancelled', attempted: false };
    }
    this.#resolve(this.#result);
    super._onClose(options);
  }
}
