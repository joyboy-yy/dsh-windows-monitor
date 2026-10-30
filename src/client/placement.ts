/**
 * Placement geometry for the overlay panel.
 *
 * The panel is painted in viewport pixels, but a docked position is remembered
 * as a relation to the usable area — which edge (or edge midpoint) it belongs
 * to and how far it sits from that edge — rather than as a pair of coordinates.
 * A resize can then recompute the pixels from the anchor, so the gap the user
 * chose survives instead of the panel drifting away from its edge.
 *
 * The usable area excludes the window-chrome strip at the top (titlebar and
 * caption buttons). Everything here is pure: no DOM, no storage, no React.
 * The component owns those seams and this module owns the arithmetic.
 */

/** A point in viewport coordinates; the panel's top-left corner. */
export interface Point {
  x: number
  y: number
}

/** A width/height pair, in px. */
export interface Size {
  width: number
  height: number
}

/** The viewport plus the top strip reserved by the window chrome. */
export interface Viewport extends Size {
  /** Height of the reserved strip at the top, in px. */
  insetTop: number
}

/** Horizontal relationship to the usable area. */
export type HorizontalAnchor = 'left' | 'center' | 'right'

/** Vertical relationship to the usable area. */
export type VerticalAnchor = 'top' | 'middle' | 'bottom'

/** A position docked to one edge/corner of the usable area, with a fixed gap. */
export interface AnchorPlacement {
  kind: 'anchor'
  x: HorizontalAnchor
  y: VerticalAnchor
  /** Distance kept from the anchored edge(s), in px. */
  gap: number
}

/** A position the user dropped freely; persisted as viewport coordinates. */
export interface FreePlacement {
  kind: 'free'
  x: number
  y: number
}

/** Everything the panel needs in order to know where it belongs. */
export type Placement = AnchorPlacement | FreePlacement

/** Distance between a docked panel and its edge, in px. */
export const EDGE_GAP = 14

/** Narrower screens keep the panel a little tighter to the edge. */
export const COMPACT_EDGE_GAP = 10

/** Width at or below which {@link COMPACT_EDGE_GAP} applies, in px. */
export const COMPACT_MAX_WIDTH = 520

/** Version of the persisted shape; bumped when its meaning changes. */
export const STORAGE_VERSION = 2

/** Sanity ceiling for a stored gap, so corrupt storage cannot park the panel. */
const MAX_GAP = 64

/** The gap used at this viewport width. */
export function edgeGap(viewport: Size): number {
  return viewport.width <= COMPACT_MAX_WIDTH ? COMPACT_EDGE_GAP : EDGE_GAP
}

/** The default corner: bottom-right, with the standard edge gap. */
export function defaultPlacement(viewport: Size): AnchorPlacement {
  return { kind: 'anchor', x: 'right', y: 'bottom', gap: edgeGap(viewport) }
}

/**
 * Keep the panel's whole box inside the usable area.
 *
 * The lower bound on `y` is the chrome strip, so neither a drag nor a restored
 * free position can put the panel over the window controls.
 */
export function clampToViewport(point: Point, size: Size, viewport: Viewport): Point {
  const minY = viewport.insetTop
  const maxX = Math.max(0, viewport.width - size.width)
  const maxY = Math.max(minY, viewport.height - size.height)
  return {
    x: Math.min(Math.max(0, point.x), maxX),
    y: Math.min(Math.max(minY, point.y), maxY),
  }
}

/** Resolve a docked placement to pixels for the current viewport. */
export function anchorPoint(placement: AnchorPlacement, size: Size, viewport: Viewport): Point {
  const usableHeight = Math.max(0, viewport.height - viewport.insetTop)
  const x =
    placement.x === 'left'
      ? placement.gap
      : placement.x === 'right'
        ? viewport.width - size.width - placement.gap
        : (viewport.width - size.width) / 2
  const y =
    placement.y === 'top'
      ? viewport.insetTop + placement.gap
      : placement.y === 'bottom'
        ? viewport.height - size.height - placement.gap
        : viewport.insetTop + (usableHeight - size.height) / 2
  // A panel larger than the viewport cannot honour both edges; keep its top and
  // left on screen so it still cannot reach the window controls.
  return { x: Math.max(0, x), y: Math.max(viewport.insetTop, y) }
}

/** Resolve any placement to pixels; free positions are also clamped inside. */
export function resolvePlacement(placement: Placement, size: Size, viewport: Viewport): Point {
  return placement.kind === 'anchor'
    ? anchorPoint(placement, size, viewport)
    : clampToViewport(placement, size, viewport)
}

/** Narrow a stored gap into the range the panel can use. */
function readGap(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(Math.max(0, value), MAX_GAP)
}

/** Object predicate that survives arrays and `null`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read one docked placement, rejecting unknown anchor names. */
function readAnchor(value: Record<string, unknown>): AnchorPlacement | null {
  const { x, y } = value
  if (x !== 'left' && x !== 'center' && x !== 'right') return null
  if (y !== 'top' && y !== 'middle' && y !== 'bottom') return null
  // `center`/`middle` would mean the middle of the usable area, not one of the
  // eight documented positions.
  if (x === 'center' && y === 'middle') return null
  const gap = readGap(value.gap)
  if (gap === null) return null
  return { kind: 'anchor', x, y, gap }
}

/** Read one placement object, either shape. */
function readPlacement(value: unknown): Placement | null {
  if (!isRecord(value)) return null
  if (value.kind === 'anchor') return readAnchor(value)
  if (value.kind !== 'free') return null
  const { x, y } = value
  if (typeof x !== 'number' || !Number.isFinite(x)) return null
  if (typeof y !== 'number' || !Number.isFinite(y)) return null
  return { kind: 'free', x, y }
}

/**
 * Parse the localStorage value.
 *
 * Accepts both the versioned shape and the `{ x, y }` shape written by 0.2.4
 * and earlier, so upgrading does not lose the panel's position. Corrupt or
 * unfamiliar data yields `null`, and the panel falls back to its default.
 */
export function parsePlacement(raw: string | null): Placement | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  if ('version' in parsed) {
    if (parsed.version !== STORAGE_VERSION) return null
    return readPlacement(parsed.placement)
  }

  // Versioned storage always nests the placement; a bare object is the old
  // coordinate pair.
  if ('placement' in parsed) return readPlacement(parsed.placement)
  return readPlacement({ kind: 'free', x: parsed.x, y: parsed.y })
}

/** Serialize for localStorage; coordinates are rounded to whole pixels. */
export function serializePlacement(placement: Placement): string {
  if (placement.kind === 'anchor') {
    return JSON.stringify({
      version: STORAGE_VERSION,
      placement: {
        kind: 'anchor',
        x: placement.x,
        y: placement.y,
        gap: Math.round(placement.gap),
      },
    })
  }
  return JSON.stringify({
    version: STORAGE_VERSION,
    placement: {
      kind: 'free',
      x: Math.round(placement.x),
      y: Math.round(placement.y),
    },
  })
}
