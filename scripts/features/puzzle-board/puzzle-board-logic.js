// Pure functions only — no Foundry API calls anywhere in this file, matching every sibling
// feature's own *-logic.js convention. Piece ids are always the string form of a numeric index
// `row * cols + col` (same convention as jigsaw-puzzle-logic.js's pieceBackgroundPosition), so
// col/row are always derived from the id rather than stored redundantly on the piece itself.

export const PUZZLE_BOARD_CONFIG = {
  DEFAULT_PIECE_COUNT: 24,
  // The board is a fixed logical reference frame, independent of any client's viewport/zoom or the
  // source image's actual pixel dimensions — a normalized reference width keeps piece canvas sizes
  // reasonable regardless of whether the GM picked a tiny icon or a huge poster image.
  REFERENCE_IMAGE_WIDTH_PX: 1200,
  // Compact "assembly area on top, tray pile below" layout — a real fix for a real complaint: an
  // early draft scattered pieces across a much larger board (several times the image's own size),
  // which made hunting for pieces via scrolling/zooming genuinely annoying. The tray is the same
  // width as the assembly area, stacked directly beneath it, sized as a fraction of the image's own
  // height — small enough that the whole board comfortably fits without scrolling for a typical
  // piece count, at the cost of pieces piling up and overlapping in the tray (which is also exactly
  // what was asked for: a scrambled pile, not a grid).
  BOARD_MARGIN_PX: 24,
  TRAY_SPACING_PX: 20,
  TRAY_HEIGHT_FRACTION: 0.6,
  // Constant regardless of difficulty tier — only piece SHAPE scales with the roll, per the locked
  // design decision (see CLAUDE.md). Expressed as a fraction of the board's own width/height.
  PLACEMENT_TOLERANCE_BOARD_FRACTION: 0.03,
  // Tier -> shape-irregularity magnitude. PF2e's own four outcome strings are used directly as
  // keys — no separate mapping table between "roll result" and "difficulty tier" is needed.
  //
  // INVERTED from the first draft, after real playtesting feedback: uniform/square pieces turned
  // out to be the HARDER case to solve, not the easier one — with every piece the same plain
  // rectangle, there's no visual distinction between an edge piece and an inner piece, and no cue
  // at all about which neighbor a piece belongs next to (unlike a real jigsaw, where an
  // interlocking tab/blank shape is itself a strong hint about fit). Jagged pieces give exactly
  // that cue back. So a GOOD roll (criticalSuccess) now gives the MOST jagged pieces (easiest), and
  // a BAD roll (criticalFailure) gives perfectly uniform squares (hardest) — the opposite mapping
  // from the first draft. First-draft magnitude constants themselves are unchanged, just reassigned
  // to the opposite tiers; expect a further retuning pass, same as every sibling feature's own
  // constants needed at least one.
  IRREGULARITY_BY_TIER: {
    criticalSuccess: { edgeJitterFraction: 0.3, subdivisionsPerEdge: 3 },
    success: { edgeJitterFraction: 0.16, subdivisionsPerEdge: 2 },
    failure: { edgeJitterFraction: 0.06, subdivisionsPerEdge: 1 },
    criticalFailure: { edgeJitterFraction: 0, subdivisionsPerEdge: 0 },
  },
};

// Derives a cols/rows grid from a requested piece count + the image's own aspect ratio (width /
// height) so cells stay roughly square-ish regardless of a portrait or landscape source image.
// The actual resulting pieceCount (cols * rows) may not exactly equal requestedPieceCount — the
// caller surfaces that real number back to the GM before final confirm, same spirit as jigsaw's
// own DC->grid-dimensions table just computed live instead of tiered.
export function computeGridDimensions(requestedPieceCount, aspectRatio) {
  const cols = Math.max(1, Math.round(Math.sqrt(requestedPieceCount * aspectRatio)));
  const rows = Math.max(1, Math.round(requestedPieceCount / cols));
  return { cols, rows, pieceCount: cols * rows };
}

// The board's fixed logical pixel size, and the two sub-rectangles within it (the "assembly area"
// where the image belongs, and the "tray" where unplaced pieces start piled up) — all computed
// once at puzzle-creation time from the image's aspect ratio alone, never from any client's
// viewport. Assembly area and tray are the same width, stacked vertically with a small gap, each
// wrapped in a small fixed margin — a compact layout instead of a large surrounding void.
export function computeBoardFrame(aspectRatio) {
  const { REFERENCE_IMAGE_WIDTH_PX, BOARD_MARGIN_PX, TRAY_SPACING_PX, TRAY_HEIGHT_FRACTION } = PUZZLE_BOARD_CONFIG;
  const imageWidthPx = REFERENCE_IMAGE_WIDTH_PX;
  const imageHeightPx = imageWidthPx / aspectRatio;
  const trayHeightPx = imageHeightPx * TRAY_HEIGHT_FRACTION;

  const boardWidthPx = Math.round(imageWidthPx + BOARD_MARGIN_PX * 2);
  const boardHeightPx = Math.round(BOARD_MARGIN_PX * 2 + imageHeightPx + TRAY_SPACING_PX + trayHeightPx);

  const imageOffsetXPercent = (BOARD_MARGIN_PX / boardWidthPx) * 100;
  const imageOffsetYPercent = (BOARD_MARGIN_PX / boardHeightPx) * 100;
  const imageWidthPercent = (imageWidthPx / boardWidthPx) * 100;
  const imageHeightPercent = (imageHeightPx / boardHeightPx) * 100;

  const trayOffsetXPercent = imageOffsetXPercent;
  const trayOffsetYPercent = ((BOARD_MARGIN_PX + imageHeightPx + TRAY_SPACING_PX) / boardHeightPx) * 100;
  const trayWidthPercent = imageWidthPercent;
  const trayHeightPercent = (trayHeightPx / boardHeightPx) * 100;

  return {
    boardWidthPx,
    boardHeightPx,
    imageOffsetXPercent,
    imageOffsetYPercent,
    imageWidthPercent,
    imageHeightPercent,
    trayOffsetXPercent,
    trayOffsetYPercent,
    trayWidthPercent,
    trayHeightPercent,
  };
}

// Converts a point expressed as a fraction of the IMAGE itself ([0,1] in both axes) into a
// percent-of-BOARD position (0-100), using the board frame's own image sub-rectangle.
export function imageFractionToBoardPercent(imageXFrac, imageYFrac, frame) {
  return {
    xPercent: frame.imageOffsetXPercent + imageXFrac * frame.imageWidthPercent,
    yPercent: frame.imageOffsetYPercent + imageYFrac * frame.imageHeightPercent,
  };
}

// Random starting position for a freshly-created, not-yet-placed piece, somewhere within the
// tray's own rectangle — deliberately unconstrained beyond that, so pieces naturally pile up and
// overlap within the tray rather than tiling neatly, per the locked "scrambled pile" request.
function randomTrayPosition(frame) {
  return {
    xPercent: frame.trayOffsetXPercent + Math.random() * frame.trayWidthPercent,
    yPercent: frame.trayOffsetYPercent + Math.random() * frame.trayHeightPercent,
  };
}

// Builds the difficulty-independent part of every piece: its target (board-percent position the
// piece's own bounding-box center must reach, inside the assembly area) and a random starting
// `current` position piled somewhere in the tray. `polygon`/`bbox` (the piece's actual cut SHAPE)
// are left null — they don't exist until a difficulty roll locks in a tier and
// finalizePieceGeometry() runs. Called once at puzzle creation.
export function generatePieceLayout({ cols, rows, frame }) {
  const pieces = {};
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const id = String(row * cols + col);
      const target = imageFractionToBoardPercent((col + 0.5) / cols, (row + 0.5) / rows, frame);
      pieces[id] = {
        target,
        current: randomTrayPosition(frame),
        placed: false,
        polygon: null,
        bbox: null,
      };
    }
  }
  return pieces;
}

function edgeKey(kind, col, row) {
  return `${kind}_${col}_${row}`;
}

// A single internal grid edge, subdivided and perpendicular-jittered. Stored once per edge (see
// buildJitteredEdges) and shared by BOTH pieces on either side of it (traversed in reverse by
// whichever piece walks it "backwards") — this shared-point invariant is what keeps the cut lines
// tiling perfectly with no gaps/overlaps, however jagged they look.
function buildJitteredPolyline(start, end, subdivisions, jitterMagnitude, perpendicularAxis) {
  const points = [start];
  for (let i = 1; i <= subdivisions; i++) {
    const t = i / (subdivisions + 1);
    const x = start.x + (end.x - start.x) * t;
    const y = start.y + (end.y - start.y) * t;
    const jitter = jitterMagnitude > 0 ? (Math.random() * 2 - 1) * jitterMagnitude : 0;
    points.push(perpendicularAxis === 'x' ? { x: x + jitter, y } : { x, y: y + jitter });
  }
  points.push(end);
  return points;
}

// Every INTERNAL edge of the cols x rows grid, in image-fraction [0,1] space. Outer-boundary edges
// are deliberately excluded and stay perfectly straight elsewhere — there's no neighboring piece to
// jag against, and a ragged outer silhouette would just look like a torn photo, not a cut puzzle.
function buildJitteredEdges(cols, rows, tierConfig) {
  const { edgeJitterFraction, subdivisionsPerEdge } = tierConfig;
  const cellW = 1 / cols;
  const cellH = 1 / rows;
  const edges = new Map();

  // Internal vertical edges: x = col/cols for col in [1, cols-1], one per row's cell height.
  // Stored top-to-bottom.
  for (let row = 0; row < rows; row++) {
    for (let col = 1; col < cols; col++) {
      const x = col / cols;
      edges.set(
        edgeKey('v', col, row),
        buildJitteredPolyline({ x, y: row / rows }, { x, y: (row + 1) / rows }, subdivisionsPerEdge, edgeJitterFraction * cellW, 'x')
      );
    }
  }

  // Internal horizontal edges: y = row/rows for row in [1, rows-1], one per col's cell width.
  // Stored left-to-right.
  for (let row = 1; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const y = row / rows;
      edges.set(
        edgeKey('h', col, row),
        buildJitteredPolyline({ x: col / cols, y }, { x: (col + 1) / cols, y }, subdivisionsPerEdge, edgeJitterFraction * cellH, 'y')
      );
    }
  }

  return edges;
}

// Walks a single cell's 4 sides clockwise (top, right, bottom, left), substituting the shared
// jittered polyline for any internal side and a straight 2-point line for any outer-boundary side.
function buildPiecePolygon(col, row, cols, rows, edges) {
  const cellW = 1 / cols;
  const cellH = 1 / rows;
  const left = col * cellW;
  const right = (col + 1) * cellW;
  const top = row * cellH;
  const bottom = (row + 1) * cellH;

  const topSide = row === 0
    ? [{ x: left, y: top }, { x: right, y: top }]
    : edges.get(edgeKey('h', col, row));
  const rightSide = col === cols - 1
    ? [{ x: right, y: top }, { x: right, y: bottom }]
    : edges.get(edgeKey('v', col + 1, row));
  const bottomSide = row === rows - 1
    ? [{ x: right, y: bottom }, { x: left, y: bottom }]
    : [...edges.get(edgeKey('h', col, row + 1))].reverse();
  const leftSide = col === 0
    ? [{ x: left, y: bottom }, { x: left, y: top }]
    : [...edges.get(edgeKey('v', col, row))].reverse();

  const points = [...topSide, ...rightSide.slice(1), ...bottomSide.slice(1), ...leftSide.slice(1)];
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 1 && Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) {
    points.pop();
  }
  return points;
}

function computeBbox(polygon) {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  return {
    minXFrac: Math.min(...xs),
    minYFrac: Math.min(...ys),
    maxXFrac: Math.max(...xs),
    maxYFrac: Math.max(...ys),
  };
}

// Called once, when a difficulty-roll outcome locks in a puzzle's tier. Computes every piece's cut
// SHAPE (polygon + bbox) from the stored cols/rows and the tier's jitter magnitude; leaves
// target/current/placed untouched. `polygon` points are stored as a [0,1] fraction of the piece's
// OWN bbox (not the whole image) — this is what the canvas renderer needs for its clip Path2D once
// it knows the bbox's actual pixel size.
export function finalizePieceGeometry(pieces, cols, rows, tier) {
  const tierConfig = PUZZLE_BOARD_CONFIG.IRREGULARITY_BY_TIER[tier];
  const edges = buildJitteredEdges(cols, rows, tierConfig);
  const result = {};

  for (const [id, piece] of Object.entries(pieces)) {
    const col = Number(id) % cols;
    const row = Math.floor(Number(id) / cols);
    const polygonImageFrac = buildPiecePolygon(col, row, cols, rows, edges);
    const bbox = computeBbox(polygonImageFrac);
    const bboxWidth = bbox.maxXFrac - bbox.minXFrac || 1;
    const bboxHeight = bbox.maxYFrac - bbox.minYFrac || 1;
    const polygon = polygonImageFrac.map((p) => ({
      x: (p.x - bbox.minXFrac) / bboxWidth,
      y: (p.y - bbox.minYFrac) / bboxHeight,
    }));
    result[id] = { ...piece, polygon, bbox };
  }

  return result;
}

// Constant-tolerance check, per the locked design decision — never scaled by difficulty tier.
export function isPieceMostlyInPlace(piece, tolerance = PUZZLE_BOARD_CONFIG.PLACEMENT_TOLERANCE_BOARD_FRACTION) {
  const dx = (piece.current.xPercent - piece.target.xPercent) / 100;
  const dy = (piece.current.yPercent - piece.target.yPercent) / 100;
  return Math.hypot(dx, dy) <= tolerance;
}

export function isPuzzleSolved(pieces) {
  return Object.values(pieces).every((piece) => piece.placed);
}
