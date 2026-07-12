import {
  baseTimeAllowanceSeconds,
  liveTotalPcStat,
  resolveOutcomeOnCorrectSubmission,
  resolveOutcomeOnExpiration,
  isGridFullyCorrect,
} from './alibi-matrix-logic.js';

const TEMPLATE_PATH = 'modules/pf2e-customizations/scripts/features/alibi-matrix/alibi-matrix-app.hbs';
const GLITCH_FLASH_MS = 400;
const CELL_STATE_ORDER = ['blank', 'cross', 'check'];
const CELL_SYMBOL = { blank: '', cross: '✗', check: '✓' };

function formatSeconds(totalSeconds) {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export class AlibiMatrixApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: 'pf2e-customizations-alibi-matrix',
    classes: ['pf2e-customizations', 'alibi-matrix-app'],
    tag: 'div',
    window: {
      title: 'pf2e-customizations.alibiMatrix.appTitle',
      resizable: false,
      minimizable: false,
    },
    position: { width: 420 },
    actions: {
      begin: AlibiMatrixApp.#onBegin,
      cycleCell: AlibiMatrixApp.#onCycleCell,
      checkMatrix: AlibiMatrixApp.#onCheckMatrix,
      showHelp: AlibiMatrixApp.#onShowHelp,
      closeHelp: AlibiMatrixApp.#onCloseHelp,
    },
  };

  static PARTS = {
    puzzle: { template: TEMPLATE_PATH, root: true },
  };

  /** Opens the puzzle and resolves once it ends, for any reason. */
  static async run({ actor, skillSlug, circumstanceMod, allowCriticalOutcomes, categoryCount, n, grids, negativeClues, connectedClues, solution }) {
    return new Promise((resolve) => {
      const app = new AlibiMatrixApp({
        actor, skillSlug, circumstanceMod, allowCriticalOutcomes, categoryCount, n, grids,
        negativeClues, connectedClues, solution, resolve,
        // Instance-level override, merged over DEFAULT_OPTIONS.position before first paint — no
        // post-render setPosition() needed since categoryCount never changes mid-attempt. 3-category
        // puzzles need room for 3 grids side by side; 2-category puzzles get a single small grid.
        position: { width: categoryCount === 3 ? 1080 : 420 },
      });
      app.render(true);
    });
  }

  #actor;
  #skillSlug;
  #circumstanceMod;
  #allowCriticalOutcomes;
  #categoryCount;
  #n;
  #grids;
  #negativeClues;
  #connectedClues;
  #solution;
  #resolve;
  #resolved = false;
  #result = null;
  #inputLocked = false;

  // Same instructions/ready/started/help gate as timeline-puzzle: #stage controls whether the full
  // instructions text is shown; #started is independent and always starts false, so the clock and
  // grids are never revealed automatically even when instructions are hidden by client setting.
  #stage = 'instructions';
  #started = false;
  #helpVisible = false;

  #startTimestamp = null;
  #baseTimeAllowanceSeconds = 0;
  #timerIntervalId = null;
  #glitchTimeoutId = null;
  #cellStates;

  constructor({ actor, skillSlug, circumstanceMod, allowCriticalOutcomes, categoryCount, n, grids, negativeClues, connectedClues, solution, resolve, ...options }) {
    super(options);
    this.#actor = actor;
    this.#skillSlug = skillSlug;
    this.#circumstanceMod = circumstanceMod;
    this.#allowCriticalOutcomes = allowCriticalOutcomes;
    this.#categoryCount = categoryCount;
    this.#n = n;
    this.#grids = grids;
    this.#negativeClues = negativeClues;
    this.#connectedClues = connectedClues;
    this.#solution = solution;
    this.#resolve = resolve;
    this.#cellStates = grids.map(() => Array.from({ length: n }, () => Array(n).fill('blank')));

    if (game.settings.get('pf2e-customizations', 'alibiMatrixHideInstructions')) {
      this.#stage = 'puzzle';
    }
  }

  #categoryLabel(category) {
    return game.i18n.localize(`pf2e-customizations.alibiMatrix.category.${category}`);
  }

  // Bank content (suspects/rooms/motives) is GM-authored display text used directly, verbatim —
  // no localization indirection, same lesson learned from timeline-puzzle's event bank.
  #labelsForCategory(category) {
    if (category === 'suspect') return this.#solution.suspects;
    if (category === 'room') return this.#solution.rooms;
    return this.#solution.motives;
  }

  #clueText(descriptor) {
    const format = (key, data) => game.i18n.format(`pf2e-customizations.alibiMatrix.clue.${key}`, data);
    if (descriptor.type === 'negative') {
      const grid = this.#grids.find((g) => g.key === descriptor.gridKey);
      const rowValue = this.#labelsForCategory(grid.rowCategory)[descriptor.row];
      const colValue = this.#labelsForCategory(grid.colCategory)[descriptor.col];
      if (descriptor.gridKey === 'suspectRoom') return format('negativeSuspectRoom', { suspect: rowValue, room: colValue });
      if (descriptor.gridKey === 'suspectMotive') return format('negativeSuspectMotive', { suspect: rowValue, motive: colValue });
      return format('negativeRoomMotive', { room: rowValue, motive: colValue });
    }
    const suspect = this.#solution.suspects[descriptor.suspect];
    const room = this.#solution.rooms[descriptor.roomIdx];
    const motive = this.#solution.motives[descriptor.motiveIdx];
    return format('connected', { suspect, room, motive });
  }

  #isGridCorrect(gridIndex) {
    const grid = this.#grids[gridIndex];
    const truePairs = new Set(grid.trueColForRow.map((col, row) => `${row},${col}`));
    return isGridFullyCorrect(this.#cellStates[gridIndex], truePairs, this.#n);
  }

  async _prepareContext(_options) {
    return {
      stage: this.#stage,
      started: this.#started,
      helpVisible: this.#helpVisible,
      actorName: this.#actor.name,
      dimensionLabel: `${this.#n}×${this.#n}`,
      clueTexts: [...this.#negativeClues, ...this.#connectedClues].map((descriptor) => this.#clueText(descriptor)),
      grids: this.#grids.map((grid, gridIndex) => {
        const rowLabels = this.#labelsForCategory(grid.rowCategory);
        const colLabels = this.#labelsForCategory(grid.colCategory);
        return {
          gridIndex,
          title: `${this.#categoryLabel(grid.rowCategory)} × ${this.#categoryLabel(grid.colCategory)}`,
          colLabels,
          rows: rowLabels.map((rowLabel, row) => ({
            rowLabel,
            cells: colLabels.map((_, col) => {
              const state = this.#cellStates[gridIndex][row][col];
              return { gridIndex, row, col, state, symbol: CELL_SYMBOL[state] };
            }),
          })),
        };
      }),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // Clues/grids/countdown only exist in the DOM once the puzzle has actually started — nothing to
    // wire up before then.
    if (this.#stage !== 'puzzle' || !this.#started) return;

    // First (and only, by design) render after starting: start the live clock. Cell clicks and help
    // toggles after this all patch the DOM directly or use the #startTimestamp guard below, so the
    // running timer is never disrupted.
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

    const countdownEl = this.element.querySelector('[data-alibi-matrix-countdown]');
    if (countdownEl) countdownEl.textContent = formatSeconds(remainingSeconds);

    if (remainingSeconds <= 0) this.#finishOnExpiration();
  }

  #flashGlitch() {
    this.element.classList.add('is-glitch');
    clearTimeout(this.#glitchTimeoutId);
    this.#glitchTimeoutId = setTimeout(() => this.element.classList.remove('is-glitch'), GLITCH_FLASH_MS);
  }

  // Handles both possible entry points into real play: dismissing the full instructions screen, and
  // clicking Start on the compact "ready" screen (shown instead when instructions are hidden).
  static #onBegin() {
    const dontShowAgain = this.element.querySelector('[data-dont-show-again]')?.checked ?? false;
    if (dontShowAgain) game.settings.set('pf2e-customizations', 'alibiMatrixHideInstructions', true);

    this.#stage = 'puzzle';
    this.#started = true;
    this.render();
  }

  // Direct DOM patch, no full re-render — cycles blank -> cross -> check -> blank.
  static #onCycleCell(_event, target) {
    if (this.#inputLocked) return;
    const gridIndex = Number(target.dataset.gridIndex);
    const row = Number(target.dataset.row);
    const col = Number(target.dataset.col);
    const current = this.#cellStates[gridIndex][row][col];
    const next = CELL_STATE_ORDER[(CELL_STATE_ORDER.indexOf(current) + 1) % CELL_STATE_ORDER.length];
    this.#cellStates[gridIndex][row][col] = next;
    target.classList.remove('is-blank', 'is-cross', 'is-check');
    target.classList.add(`is-${next}`);
    target.textContent = CELL_SYMBOL[next];
  }

  static #onCheckMatrix() {
    if (this.#inputLocked) return;
    const allCorrect = this.#grids.every((_grid, i) => this.#isGridCorrect(i));
    if (allCorrect) this.#finishOnSuccess();
    else this.#flashGlitch();
  }

  // Same full-re-render-is-safe reasoning as timeline-puzzle: the timer-start guard keys off
  // #startTimestamp, not off "is this the first render," so toggling help never restarts the clock
  // or loses cell/clue state (all re-derived fresh from private fields on every _prepareContext call).
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
    const correctGridCount = this.#grids.filter((_grid, i) => this.#isGridCorrect(i)).length;
    const outcome = resolveOutcomeOnExpiration(correctGridCount, this.#allowCriticalOutcomes);
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
