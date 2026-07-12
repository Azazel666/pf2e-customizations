import {
  baseTimeAllowanceSeconds,
  liveTotalPcStat,
  pieceBackgroundPosition,
  resolveOutcomeOnCorrectSubmission,
  resolveOutcomeOnExpiration,
} from './jigsaw-puzzle-logic.js';

const TEMPLATE_PATH = 'modules/pf2e-customizations/scripts/features/jigsaw-puzzle/jigsaw-puzzle-app.hbs';
const GLITCH_FLASH_MS = 400;

function formatSeconds(totalSeconds) {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function escapeAttr(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export class JigsawPuzzleApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: 'pf2e-customizations-jigsaw-puzzle',
    classes: ['pf2e-customizations', 'jigsaw-puzzle-app'],
    tag: 'div',
    window: {
      title: 'pf2e-customizations.jigsawPuzzle.appTitle',
      resizable: false,
      minimizable: false,
    },
    // Static width — like fact-sifter, the puzzle's overall look is driven by the locked aspect
    // ratio, not the column count, so there's no per-attempt sizing need the way alibi-matrix has.
    // Widened across three retuning passes (520 -> 680 -> 840 -> 1000): first so the grid and tray
    // could sit side by side (see .jigsaw-puzzle-board) instead of stacked, spending the window's
    // width instead of its height; then again once the tray was changed to mirror the grid's own
    // cols/rows exactly (so every piece is always visible with no scrolling) — that doubled the
    // footprint needed compared to a single grid alone, so the window widened to match and keep
    // individual pieces a reasonable size.
    position: { width: 1000 },
    actions: {
      begin: JigsawPuzzleApp.#onBegin,
      tileClick: JigsawPuzzleApp.#onTileClick,
      checkPuzzle: JigsawPuzzleApp.#onCheckPuzzle,
      showHelp: JigsawPuzzleApp.#onShowHelp,
      closeHelp: JigsawPuzzleApp.#onCloseHelp,
    },
  };

  static PARTS = {
    puzzle: { template: TEMPLATE_PATH, root: true },
  };

  /** Opens the puzzle and resolves once it ends, for any reason. */
  static async run({
    actor, skillSlug, circumstanceMod, allowCriticalOutcomes, imagePath, aspectRatio, cols, rows, pieceCount, trayOrder,
  }) {
    return new Promise((resolve) => {
      const app = new JigsawPuzzleApp({
        actor, skillSlug, circumstanceMod, allowCriticalOutcomes, imagePath, aspectRatio, cols, rows, pieceCount, trayOrder, resolve,
      });
      app.render(true);
    });
  }

  #actor;
  #skillSlug;
  #circumstanceMod;
  #allowCriticalOutcomes;
  #imagePath;
  #aspectRatio;
  #cols;
  #rows;
  #pieceCount;
  #resolve;
  #resolved = false;
  #result = null;
  #inputLocked = false;

  // Same instructions/ready/started/help gate as the sibling features: #stage controls the full
  // instructions text; #started is independent and always starts false, so the tray/grid/countdown
  // are never revealed automatically even when instructions are hidden by client setting.
  #stage = 'instructions';
  #started = false;
  #helpVisible = false;

  #startTimestamp = null;
  #baseTimeAllowanceSeconds = 0;
  #timerIntervalId = null;
  #glitchTimeoutId = null;

  // #tray: piece ids not yet placed. #slots: length pieceCount, each null or a piece id — a piece id
  // equal to its own slot index means that slot is correctly filled. Neither array is ever rendered
  // via _prepareContext/Handlebars — both are patched directly into the DOM by #renderBoard(), the
  // same "don't disrupt the running timer/in-progress drag" rationale timeline-puzzle's grid uses.
  #tray = [];
  #slots = [];
  #selectedSource = null; // click-fallback pending source: {kind:'tray',pieceId} | {kind:'slot',slotIndex,pieceId}
  #dragSource = null; // native drag pending source, same shape
  #suppressNextClick = false; // guards a completed drag from also firing the click-fallback handler

  constructor({
    actor, skillSlug, circumstanceMod, allowCriticalOutcomes, imagePath, aspectRatio, cols, rows, pieceCount, trayOrder, resolve, ...options
  }) {
    super(options);
    this.#actor = actor;
    this.#skillSlug = skillSlug;
    this.#circumstanceMod = circumstanceMod;
    this.#allowCriticalOutcomes = allowCriticalOutcomes;
    this.#imagePath = imagePath;
    this.#aspectRatio = aspectRatio;
    this.#cols = cols;
    this.#rows = rows;
    this.#pieceCount = pieceCount;
    this.#tray = [...trayOrder];
    this.#slots = new Array(pieceCount).fill(null);
    this.#resolve = resolve;

    if (game.settings.get('pf2e-customizations', 'jigsawPuzzleHideInstructions')) {
      this.#stage = 'puzzle';
    }
  }

  async _prepareContext(_options) {
    return {
      stage: this.#stage,
      started: this.#started,
      helpVisible: this.#helpVisible,
      actorName: this.#actor.name,
      cols: this.#cols,
      rows: this.#rows,
      pieceCount: this.#pieceCount,
      aspectRatio: this.#aspectRatio,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // Tray/grid/countdown only exist meaningfully once the puzzle has actually started — nothing to
    // wire up before then.
    if (this.#stage !== 'puzzle' || !this.#started) return;

    if (this.#startTimestamp === null) {
      this.#startTimestamp = Date.now();
      this.#baseTimeAllowanceSeconds = baseTimeAllowanceSeconds(
        liveTotalPcStat(this.#actor, this.#skillSlug, this.#circumstanceMod),
        this.#pieceCount
      );
      this.#tick();
      this.#timerIntervalId = setInterval(() => this.#tick(), 1000);
    }

    // Safe on every render (including help-toggle re-renders), same reasoning as the sibling
    // features: this only rebuilds the tray/grid DOM from the private #tray/#slots arrays, which
    // are never reset by a re-render, so toggling help never loses placement progress.
    this.#renderBoard();
  }

  #tick() {
    const elapsedSeconds = (Date.now() - this.#startTimestamp) / 1000;
    const remainingSeconds = Math.max(0, this.#baseTimeAllowanceSeconds - elapsedSeconds);

    const countdownEl = this.element.querySelector('[data-jigsaw-puzzle-countdown]');
    if (countdownEl) countdownEl.textContent = formatSeconds(remainingSeconds);

    if (remainingSeconds <= 0) this.#finishOnExpiration();
  }

  #flashGlitch() {
    this.element.classList.add('is-glitch');
    clearTimeout(this.#glitchTimeoutId);
    this.#glitchTimeoutId = setTimeout(() => this.element.classList.remove('is-glitch'), GLITCH_FLASH_MS);
  }

  #describeTarget(el) {
    const kind = el.dataset.kind;
    if (kind === 'tray') return { kind: 'tray', pieceId: Number(el.dataset.pieceId) };
    const slotIndex = Number(el.dataset.slotIndex);
    const pieceId = el.dataset.pieceId !== undefined ? Number(el.dataset.pieceId) : null;
    return { kind: 'slot', slotIndex, pieceId };
  }

  #tileHTML({ kind, pieceId = null, slotIndex = null }) {
    const filled = pieceId !== null;
    const isSelected = this.#selectedSource
      && this.#selectedSource.kind === kind
      && (kind === 'tray' ? this.#selectedSource.pieceId === pieceId : this.#selectedSource.slotIndex === slotIndex);

    const classes = ['jigsaw-puzzle-tile', kind === 'tray' ? 'jigsaw-puzzle-tray-tile' : 'jigsaw-puzzle-slot'];
    if (filled) classes.push('is-filled');
    if (isSelected) classes.push('is-selected');

    // No per-tile aspect-ratio needed anymore — the tray now mirrors the grid's own cols/rows/
    // aspect-ratio exactly (see jigsaw-puzzle-app.hbs), so every tile's box shape already comes
    // for free from its parent CSS Grid, the same way the grid's own slots get theirs.
    let style = '';
    if (filled) {
      const { backgroundSize, backgroundPositionX, backgroundPositionY } = pieceBackgroundPosition(pieceId, this.#cols, this.#rows);
      style = `background-image:url('${escapeAttr(this.#imagePath)}');background-size:${backgroundSize};`
        + `background-position:${backgroundPositionX} ${backgroundPositionY};`;
    }

    const dataAttrs = kind === 'tray'
      ? `data-kind="tray" data-piece-id="${pieceId}"`
      : `data-kind="slot" data-slot-index="${slotIndex}"${filled ? ` data-piece-id="${pieceId}"` : ''}`;
    const draggable = kind === 'tray' || filled ? 'true' : 'false';

    return `<button type="button" class="${classes.join(' ')}" data-action="tileClick" ${dataAttrs} `
      + `draggable="${draggable}" style="${style}"></button>`;
  }

  #renderBoard() {
    const trayEl = this.element.querySelector('[data-jigsaw-puzzle-tray]');
    const gridEl = this.element.querySelector('[data-jigsaw-puzzle-grid]');
    if (!trayEl || !gridEl) return;

    trayEl.innerHTML = this.#tray.map((pieceId) => this.#tileHTML({ kind: 'tray', pieceId })).join('');
    gridEl.innerHTML = this.#slots
      .map((pieceId, slotIndex) => this.#tileHTML({ kind: 'slot', pieceId, slotIndex }))
      .join('');

    this.#wireDragAndDrop();
    this.#updatePlacedCounter();
  }

  #updatePlacedCounter() {
    const el = this.element.querySelector('[data-jigsaw-puzzle-placed-count]');
    if (!el) return;
    const placedCount = this.#slots.filter((id) => id !== null).length;
    el.textContent = game.i18n.format('pf2e-customizations.jigsawPuzzle.placedCountLabel', {
      placed: placedCount,
      total: this.#pieceCount,
    });
  }

  // Scoped to .jigsaw-puzzle-tile (and the tray container itself as an extra drop target for
  // "return to open tray space"), re-wired after every #renderBoard() DOM rebuild since innerHTML
  // replacement drops all previously attached listeners.
  #wireDragAndDrop() {
    const tiles = this.element.querySelectorAll('.jigsaw-puzzle-tile[draggable="true"]');
    for (const tile of tiles) {
      tile.addEventListener('dragstart', (event) => {
        this.#dragSource = this.#describeTarget(tile);
        // Firefox won't actually start a drag unless dataTransfer has data set during dragstart —
        // the id itself is read back from #dragSource, not the transfer payload.
        event.dataTransfer?.setData('text/plain', tile.dataset.pieceId ?? '');
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      tile.addEventListener('dragend', () => {
        this.#dragSource = null;
        // Guards against a completed drag also firing this same element's click-fallback handler.
        // Cleared on the next microtask rather than left permanently set, so it only swallows a
        // click that fires in the same event cascade as this drop, not some later legitimate click.
        this.#suppressNextClick = true;
        setTimeout(() => { this.#suppressNextClick = false; }, 0);
      });
    }

    // Tray tiles are nested inside the tray container, which is itself a drop target (for
    // "return to open tray space") — dragover/drop bubble by default, so without stopPropagation a
    // single drop on a tray tile would also re-fire on its parent container. stopPropagation keeps
    // each drop resolving against exactly the innermost element the pointer actually released over.
    const dropTargets = this.element.querySelectorAll('.jigsaw-puzzle-tile, [data-jigsaw-puzzle-tray]');
    for (const el of dropTargets) {
      el.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        el.classList.add('is-drag-over');
      });
      el.addEventListener('dragleave', () => el.classList.remove('is-drag-over'));
      el.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        el.classList.remove('is-drag-over');
        const source = this.#dragSource;
        this.#dragSource = null;
        if (!source) return;
        const target = el.hasAttribute('data-jigsaw-puzzle-tray') ? { kind: 'tray' } : this.#describeTarget(el);
        this.#move(source, target);
      });
    }
  }

  // Single source of truth for both drag-and-drop and the click-fallback below — covers every case
  // in the locked design: tray->empty slot (place), tray->filled slot (swap in/out), slot->slot
  // (swap), slot->tray (unplace). tray->tray matches no branch and is a harmless no-op re-render —
  // there's nothing meaningful to swap between two unplaced pieces.
  #move(source, target) {
    if (this.#inputLocked || !source || !target) return;
    if (source.kind === 'tray' && target.kind === 'slot') {
      const displaced = this.#slots[target.slotIndex];
      this.#slots[target.slotIndex] = source.pieceId;
      this.#tray = this.#tray.filter((id) => id !== source.pieceId);
      if (displaced !== null) this.#tray.push(displaced);
    } else if (source.kind === 'slot' && target.kind === 'slot') {
      if (source.slotIndex === target.slotIndex) { this.#renderBoard(); return; }
      [this.#slots[source.slotIndex], this.#slots[target.slotIndex]] =
        [this.#slots[target.slotIndex], this.#slots[source.slotIndex]];
    } else if (source.kind === 'slot' && target.kind === 'tray') {
      const pieceId = this.#slots[source.slotIndex];
      if (pieceId === null) { this.#renderBoard(); return; }
      this.#slots[source.slotIndex] = null;
      this.#tray.push(pieceId);
    }
    this.#renderBoard();
  }

  static #onBegin() {
    const dontShowAgain = this.element.querySelector('[data-dont-show-again]')?.checked ?? false;
    if (dontShowAgain) game.settings.set('pf2e-customizations', 'jigsawPuzzleHideInstructions', true);

    this.#stage = 'puzzle';
    this.#started = true;
    this.render();
  }

  // Handles both native-drag's element and the click-fallback's element identically — same
  // data-action, same describeTarget shape.
  static #onTileClick(_event, target) {
    if (this.#suppressNextClick) {
      this.#suppressNextClick = false;
      return;
    }
    if (this.#inputLocked) return;
    this.#handleClick(this.#describeTarget(target));
  }

  #handleClick(clicked) {
    if (!this.#selectedSource) {
      if (clicked.kind === 'slot' && clicked.pieceId === null) return; // nothing to pick up
      this.#selectedSource = clicked;
      this.#renderBoard();
      return;
    }

    const isSameElement = this.#selectedSource.kind === clicked.kind
      && (clicked.kind === 'tray'
        ? this.#selectedSource.pieceId === clicked.pieceId
        : this.#selectedSource.slotIndex === clicked.slotIndex);

    const source = this.#selectedSource;
    this.#selectedSource = null;
    if (isSameElement) { this.#renderBoard(); return; } // clicking the same tile again deselects it
    this.#move(source, clicked);
  }

  static #onCheckPuzzle() {
    if (this.#inputLocked) return;
    const isFullyCorrect = this.#slots.every((pieceId, index) => pieceId === index);
    if (isFullyCorrect) this.#finishOnSuccess();
    else this.#flashGlitch();
  }

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
    const correctSlotCount = this.#slots.filter((pieceId, index) => pieceId === index).length;
    const outcome = resolveOutcomeOnExpiration(correctSlotCount, this.#pieceCount, this.#allowCriticalOutcomes);
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
