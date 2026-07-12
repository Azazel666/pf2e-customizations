import { getPuzzleBoard, setPieceCurrent, markSolved } from './puzzle-board-data.js';
import { isPieceMostlyInPlace, isPuzzleSolved } from './puzzle-board-logic.js';

const TEMPLATE_PATH = 'modules/pf2e-customizations/scripts/features/puzzle-board/puzzle-board-app.hbs';
// These are multiplier bounds/step on TOP of the auto-computed fit-to-width baseline (see
// #recomputeBaseZoom), not an absolute zoom level — resizing the window rescales the baseline
// while preserving whatever multiplier the player last set.
const ZOOM_MULTIPLIER_STEP = 0.15;
const ZOOM_MULTIPLIER_MIN = 0.5;
const ZOOM_MULTIPLIER_MAX = 3;

function preloadImageElement(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${path}`));
    img.src = path;
  });
}

// Drawn exactly once per piece, per app open — the canvas is treated as a static sprite
// thereafter (only its wrapper's left/top style changes during drag or remote sync). A full
// board re-render that discarded and redrew every canvas would be both expensive and would
// interrupt any in-progress drag, so this app deliberately never rebuilds piece DOM wholesale
// after first paint (unlike jigsaw-puzzle's freely-rebuilt innerHTML tray/grid).
function drawPieceCanvas(canvas, img, piece, pixelWidth, pixelHeight, naturalWidth, naturalHeight) {
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const ctx = canvas.getContext('2d');

  const path = new Path2D();
  piece.polygon.forEach((p, i) => {
    const x = p.x * pixelWidth;
    const y = p.y * pixelHeight;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
  path.closePath();

  const sx = piece.bbox.minXFrac * naturalWidth;
  const sy = piece.bbox.minYFrac * naturalHeight;
  const sw = (piece.bbox.maxXFrac - piece.bbox.minXFrac) * naturalWidth;
  const sh = (piece.bbox.maxYFrac - piece.bbox.minYFrac) * naturalHeight;

  ctx.save();
  ctx.clip(path);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, pixelWidth, pixelHeight);
  ctx.restore();

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = Math.max(1, pixelWidth * 0.01);
  ctx.stroke(path);
}

export class PuzzleBoardApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static #openInstances = new Map();

  /** Opens a puzzle, or focuses the already-open window for it — unlike every sibling's one-shot
   * minigame, this app can legitimately be reopened and left open/revisited across a whole
   * session, and again across many later sessions. */
  static async run({ journalEntryId }) {
    const existing = PuzzleBoardApp.#openInstances.get(journalEntryId);
    if (existing) {
      existing.render(true);
      existing.bringToFront();
      return existing;
    }

    const journalEntry = game.journal.get(journalEntryId);
    if (!journalEntry) {
      ui.notifications.error(game.i18n.localize('pf2e-customizations.puzzleBoard.app.notFound'));
      return null;
    }

    const app = new PuzzleBoardApp({ journalEntryId });
    PuzzleBoardApp.#openInstances.set(journalEntryId, app);
    app.render(true);
    return app;
  }

  static DEFAULT_OPTIONS = {
    id: 'pf2e-customizations-puzzle-board',
    classes: ['pf2e-customizations', 'puzzle-board-app'],
    tag: 'div',
    window: {
      title: 'pf2e-customizations.puzzleBoard.app.appTitle',
      resizable: true,
      minimizable: true,
    },
    position: { width: 900, height: 700 },
    actions: {
      begin: PuzzleBoardApp.#onBegin,
      zoomIn: PuzzleBoardApp.#onZoomIn,
      zoomOut: PuzzleBoardApp.#onZoomOut,
      centerView: PuzzleBoardApp.#onCenterView,
    },
  };

  static PARTS = {
    board: { template: TEMPLATE_PATH, root: true },
  };

  #journalEntryId;
  #journalEntry;
  #board;
  #pieces = {};
  #image = null;
  #stage = 'loading'; // 'loading' | 'instructions' | 'board' | 'solved'
  #boardBuilt = false;
  // #zoom is the EFFECTIVE scale applied to the board (baseZoom * zoomMultiplier). #baseZoom is
  // recomputed live from the viewport's own current width (see #recomputeBaseZoom) so the board
  // always fits the window's width by default; #zoomMultiplier is the player's own +/- adjustment
  // on top of that baseline, preserved across window resizes.
  #zoom = 1;
  #baseZoom = 1;
  #zoomMultiplier = 1;
  #resizeObserver = null;
  #draggingPieceId = null;
  #updateHookId = null;
  #frontZIndex = 1;

  constructor({ journalEntryId, ...options }) {
    super(options);
    this.#journalEntryId = journalEntryId;
    this.#journalEntry = game.journal.get(journalEntryId);
    this.#board = getPuzzleBoard(this.#journalEntry);
    this.#pieces = foundry.utils.deepClone(this.#board?.pieces ?? {});
    if (this.#board?.solved) this.#stage = 'solved';
  }

  async _prepareContext() {
    const board = this.#board;
    if (!board) return { isLoading: true };

    if (this.#stage === 'solved') {
      return { isSolved: true, puzzleName: board.name, imagePath: board.imagePath };
    }

    if (this.#stage === 'loading') {
      return { isLoading: true, puzzleName: board.name };
    }

    if (this.#stage === 'instructions') {
      return { isInstructions: true, puzzleName: board.name };
    }

    return {
      puzzleName: board.name,
      boardWidthPx: board.boardWidthPx,
      boardHeightPx: board.boardHeightPx,
      imageOffsetXPercent: board.imageOffsetXPercent,
      imageOffsetYPercent: board.imageOffsetYPercent,
      imageWidthPercent: board.imageWidthPercent,
      imageHeightPercent: board.imageHeightPercent,
      trayOffsetXPercent: board.trayOffsetXPercent,
      trayOffsetYPercent: board.trayOffsetYPercent,
      trayWidthPercent: board.trayWidthPercent,
      trayHeightPercent: board.trayHeightPercent,
    };
  }

  async _onRender(context, options) {
    super._onRender(context, options);

    this.#updateHookId ??= Hooks.on('updateJournalEntry', (journalEntry, changes) => this.#onRemoteUpdate(journalEntry, changes));

    if (!this.#board) return;

    if (this.#stage === 'loading' && !this.#image) {
      try {
        this.#image = await preloadImageElement(this.#board.imagePath);
      } catch (err) {
        console.error('pf2e-customizations | puzzle-board: image load failed', err);
        ui.notifications.error(game.i18n.localize('pf2e-customizations.puzzleBoard.app.imageLoadFailed'));
        return;
      }
      // Re-read in case the puzzle was solved by someone else while this client was still loading
      // the image.
      this.#board = getPuzzleBoard(this.#journalEntry);
      if (this.#board?.solved) {
        this.#stage = 'solved';
      } else {
        this.#stage = game.settings.get('pf2e-customizations', 'puzzleBoardHideInstructions') ? 'board' : 'instructions';
      }
      this.render();
      return;
    }

    if (this.#stage === 'board' && !this.#boardBuilt) {
      this.#boardBuilt = true;
      this.#buildPieceDom();
      this.#updatePlacedCounter();
      this.#setupResponsiveZoom();
    }
  }

  _onClose(options) {
    if (this.#updateHookId !== null) {
      Hooks.off('updateJournalEntry', this.#updateHookId);
      this.#updateHookId = null;
    }
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    PuzzleBoardApp.#openInstances.delete(this.#journalEntryId);
    super._onClose(options);
  }

  // Board width tracks the viewport's own current width by default — a real, reported complaint
  // about the earlier fixed-pixel-size board ("the width should match the window"). ResizeObserver
  // (not a Foundry-specific resize hook) is used deliberately: it fires on ANY change to the
  // viewport element's own box size, regardless of cause (window resize, app-window resize-handle
  // drag, flex reflow), with no need to hook into the app's own resize lifecycle at all.
  #setupResponsiveZoom() {
    const viewportEl = this.element.querySelector('[data-puzzle-board-viewport]');
    if (!viewportEl) return;
    this.#resizeObserver = new ResizeObserver(() => this.#recomputeBaseZoom());
    this.#resizeObserver.observe(viewportEl);
    this.#recomputeBaseZoom(); // set an immediate correct value rather than waiting for the first async callback
  }

  #recomputeBaseZoom() {
    const viewportEl = this.element.querySelector('[data-puzzle-board-viewport]');
    if (!viewportEl || !this.#board || viewportEl.clientWidth <= 0) return;
    this.#baseZoom = viewportEl.clientWidth / this.#board.boardWidthPx;
    this.#updateZoom();
  }

  #updateZoom() {
    this.#zoom = this.#baseZoom * this.#zoomMultiplier;
    this.#applyZoom();
  }

  #imageWidthPx() {
    return (this.#board.imageWidthPercent / 100) * this.#board.boardWidthPx;
  }

  #imageHeightPx() {
    return (this.#board.imageHeightPercent / 100) * this.#board.boardHeightPx;
  }

  #buildPieceDom() {
    const boardEl = this.element.querySelector('[data-puzzle-board-board]');
    if (!boardEl) return;

    const imageWidthPx = this.#imageWidthPx();
    const imageHeightPx = this.#imageHeightPx();
    const naturalWidth = this.#image.naturalWidth;
    const naturalHeight = this.#image.naturalHeight;

    for (const [pieceId, piece] of Object.entries(this.#pieces)) {
      const pixelWidth = Math.max(1, Math.round((piece.bbox.maxXFrac - piece.bbox.minXFrac) * imageWidthPx));
      const pixelHeight = Math.max(1, Math.round((piece.bbox.maxYFrac - piece.bbox.minYFrac) * imageHeightPx));
      piece.pixelWidth = pixelWidth;
      piece.pixelHeight = pixelHeight;

      const wrapper = document.createElement('div');
      wrapper.className = 'puzzle-board-piece';
      wrapper.dataset.pieceId = pieceId;
      wrapper.style.width = `${pixelWidth}px`;
      wrapper.style.height = `${pixelHeight}px`;
      this.#positionPieceElement(wrapper, piece);
      if (piece.placed) wrapper.classList.add('is-placed');

      const canvas = document.createElement('canvas');
      drawPieceCanvas(canvas, this.#image, piece, pixelWidth, pixelHeight, naturalWidth, naturalHeight);
      wrapper.appendChild(canvas);

      boardEl.appendChild(wrapper);
      this.#wirePieceDrag(wrapper, pieceId);
    }
  }

  #positionPieceElement(wrapper, piece) {
    const leftPx = (piece.current.xPercent / 100) * this.#board.boardWidthPx - piece.pixelWidth / 2;
    const topPx = (piece.current.yPercent / 100) * this.#board.boardHeightPx - piece.pixelHeight / 2;
    wrapper.style.left = `${leftPx}px`;
    wrapper.style.top = `${topPx}px`;
  }

  #wirePieceDrag(wrapper, pieceId) {
    wrapper.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      wrapper.setPointerCapture(event.pointerId);
      wrapper.classList.add('is-dragging');
      // Pieces pile up and overlap in the tray by design — picking one up brings it to the front
      // of that pile so it can actually be grabbed out from underneath others. Persists after
      // drop (never reset), so the pile's stacking order is just "most recently touched on top",
      // same as a real handful of jumbled puzzle pieces. Purely a local rendering concern, not
      // synced to other clients.
      wrapper.style.zIndex = String(++this.#frontZIndex);
      this.#draggingPieceId = pieceId;

      const startLeftPx = parseFloat(wrapper.style.left);
      const startTopPx = parseFloat(wrapper.style.top);
      const startClientX = event.clientX;
      const startClientY = event.clientY;

      const onMove = (moveEvent) => {
        // Dividing by the current zoom converts screen-pixel pointer movement back into the
        // board's own fixed logical-pixel space, so dragging stays 1:1 regardless of zoom level.
        // Using a movement DELTA (not an absolute cursor-to-board-rect conversion) also means this
        // math is unaffected by the viewport's current scroll position.
        const dxPx = (moveEvent.clientX - startClientX) / this.#zoom;
        const dyPx = (moveEvent.clientY - startClientY) / this.#zoom;
        wrapper.style.left = `${startLeftPx + dxPx}px`;
        wrapper.style.top = `${startTopPx + dyPx}px`;
      };

      const onUp = (upEvent) => {
        wrapper.removeEventListener('pointermove', onMove);
        wrapper.classList.remove('is-dragging');
        wrapper.releasePointerCapture(upEvent.pointerId);
        this.#draggingPieceId = null;
        this.#commitPiecePosition(pieceId, wrapper);
      };

      wrapper.addEventListener('pointermove', onMove);
      wrapper.addEventListener('pointerup', onUp, { once: true });
    });
  }

  async #commitPiecePosition(pieceId, wrapper) {
    const piece = this.#pieces[pieceId];
    if (!piece) return;

    const leftPx = parseFloat(wrapper.style.left);
    const topPx = parseFloat(wrapper.style.top);
    const current = {
      xPercent: ((leftPx + piece.pixelWidth / 2) / this.#board.boardWidthPx) * 100,
      yPercent: ((topPx + piece.pixelHeight / 2) / this.#board.boardHeightPx) * 100,
    };
    const placed = isPieceMostlyInPlace({ current, target: piece.target });

    piece.current = current;
    piece.placed = placed;
    wrapper.classList.toggle('is-placed', placed);
    this.#updatePlacedCounter();

    await setPieceCurrent(this.#journalEntry, pieceId, { current, placed });
    await this.#checkForAutoSolve();
  }

  // Fires on EVERY client (including the one that just wrote it) whenever this journal entry
  // changes. Only the specific piece(s) that actually changed are patched — never a full
  // this.render(), which would discard every already-drawn canvas.
  #onRemoteUpdate(journalEntry, changes) {
    if (journalEntry.id !== this.#journalEntryId || this.#stage !== 'board') return;

    const pieceChanges = foundry.utils.getProperty(changes, 'flags.pf2e-customizations.puzzleBoard.pieces');
    if (pieceChanges) {
      for (const [pieceId, patch] of Object.entries(pieceChanges)) {
        if (pieceId === this.#draggingPieceId) continue; // don't fight the local user's own gesture
        this.#applyRemotePieceUpdate(pieceId, patch);
      }
      this.#updatePlacedCounter();
      this.#checkForAutoSolve();
      return;
    }

    if (foundry.utils.hasProperty(changes, 'flags.pf2e-customizations.puzzleBoard.solved')) {
      this.#board = getPuzzleBoard(this.#journalEntry);
      if (this.#board?.solved) {
        this.#stage = 'solved';
        this.render();
      }
    }
  }

  #applyRemotePieceUpdate(pieceId, patch) {
    const piece = this.#pieces[pieceId];
    const wrapper = this.element.querySelector(`[data-piece-id="${pieceId}"]`);
    if (!piece || !wrapper) return;

    if (patch.current) piece.current = patch.current;
    if (typeof patch.placed === 'boolean') piece.placed = patch.placed;
    this.#positionPieceElement(wrapper, piece);
    wrapper.classList.toggle('is-placed', piece.placed);
  }

  #updatePlacedCounter() {
    const el = this.element.querySelector('[data-puzzle-board-placed-count]');
    if (!el) return;
    const placedCount = Object.values(this.#pieces).filter((p) => p.placed).length;
    el.textContent = game.i18n.format('pf2e-customizations.puzzleBoard.app.placedCountLabel', {
      placed: placedCount,
      total: Object.keys(this.#pieces).length,
    });
  }

  // No single "authoritative solver" client is needed — both a local commit and a remote sync
  // funnel into this same check, so whichever client first observes full placement is the one
  // that writes solved:true (a harmless idempotent double-write race if two clients tie).
  async #checkForAutoSolve() {
    if (this.#stage !== 'board' || !isPuzzleSolved(this.#pieces)) return;
    this.#stage = 'solved';
    await markSolved(this.#journalEntry);
    this.render();
  }

  #applyZoom() {
    const boardEl = this.element.querySelector('[data-puzzle-board-board]');
    if (boardEl) boardEl.style.transform = `scale(${this.#zoom})`;
  }

  static #onBegin() {
    const dontShowAgain = this.element.querySelector('[data-dont-show-again]')?.checked ?? false;
    if (dontShowAgain) game.settings.set('pf2e-customizations', 'puzzleBoardHideInstructions', true);
    this.#stage = 'board';
    this.render();
  }

  static #onZoomIn() {
    this.#zoomMultiplier = Math.min(ZOOM_MULTIPLIER_MAX, this.#zoomMultiplier + ZOOM_MULTIPLIER_STEP);
    this.#updateZoom();
  }

  static #onZoomOut() {
    this.#zoomMultiplier = Math.max(ZOOM_MULTIPLIER_MIN, this.#zoomMultiplier - ZOOM_MULTIPLIER_STEP);
    this.#updateZoom();
  }

  static #onCenterView() {
    const viewportEl = this.element.querySelector('[data-puzzle-board-viewport]');
    if (!viewportEl) return;
    const centerXPercent = this.#board.imageOffsetXPercent + this.#board.imageWidthPercent / 2;
    const centerYPercent = this.#board.imageOffsetYPercent + this.#board.imageHeightPercent / 2;
    const targetXPx = (centerXPercent / 100) * this.#board.boardWidthPx * this.#zoom;
    const targetYPx = (centerYPercent / 100) * this.#board.boardHeightPx * this.#zoom;
    viewportEl.scrollLeft = targetXPx - viewportEl.clientWidth / 2;
    viewportEl.scrollTop = targetYPx - viewportEl.clientHeight / 2;
  }
}
