/**
 * Placement geometry for the overlay panel.
 *
 * The panel is painted in viewport pixels, but a snapped position is remembered
 * as a relation to the viewport — which edge (or edge midpoint) it belongs to
 * and how far it sits from that edge — rather than as a pair of coordinates.
 * A resize can then recompute the pixels from the anchor, so the gap the user
 * chose survives instead of the panel drifting away from its edge.
 *
 * Everything here is pure: no DOM, no storage, no React. The component owns
 * those seams and this module owns the arithmetic.
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

/** Horizontal relationship to the viewport. */
export type HorizontalAnchor = 'left' | 'center' | 'right'

/** Vertical relationship to the viewport. */
export type VerticalAnchor = 'top' | 'middle' | 'bottom'

/** A position attached to one edge or corner, with a fixed gap. */
export interface AnchorPlacement {
  kind: 'anchor'
  x: HorizontalAnchor
  y: VerticalAnchor
  /** Distance kept from the anchored edge(s), in px. */
  gap: number
}

/** A position the user dropped away from every edge. */
export interface FreePlacement {
  kind: 'free'
  x: number
  y: number
}

/** Everything the panel needs in order to know where it belongs. */
export type Placement = AnchorPlacement | FreePlacement

/** Distance between a snapped panel and its edge, in px. */
export const EDGE_GAP = 14

/** Narrower screens keep the panel a little tighter to the edge. */
export const COMPACT_EDGE_GAP = 10

/** Width at or below which {@link COMPACT_EDGE_GAP} applies, in px. */
export const COMPACT_MAX_WIDTH = 520

/**
 * Distance to an edge that triggers a snap, in px.
 *
 * The comparison is strict (`<`): a panel released at exactly this distance
 * stays where it was dropped, matching "less than 20 px" literally.
 */
export const SNAP_THRESHOLD = 20

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

/** Keep the panel's whole box inside the viewport during a drag. */
export function clampToViewport(point: Point, size: Size, viewport: Size): Point {
  const maxX = Math.max(0, viewport.width - size.width)
  const maxY = Math.max(0, viewport.height - size.height)
  return {
    x: Math.min(Math.max(0, point.x), maxX),
    y: Math.min(Math.max(0, point.y), maxY),
  }
}

/** Resolve an anchored placement to pixels for the current viewport. */
export function anchorPoint(placement: AnchorPlacement, size: Size, viewport: Size): Point {
  const x =
    placement.x === 'left'
      ? placement.gap
      : placement.x === 'right'
        ? viewport.width - size.width - placement.gap
        : (viewport.width - size.width) / 2
  const y =
    placement.y === 'top'
      ? placement.gap
      : placement.y === 'bottom'
        ? viewport.height - size.height - placement.gap
        : (viewport.height - size.height) / 2
  return { x, y }
}

/** Resolve any placement to pixels; free positions are also clamped inside. */
export function resolvePlacement(placement: Placement, size: Size, viewport: Size): Point {
  return placement.kind === 'anchor'
    ? anchorPoint(placement, size, viewport)
    : clampToViewport(placement, size, viewport)
}

/**
 * Decide where a released panel belongs.
 *
 * Any edge closer than `threshold` is a candidate. Both axes candidates become a
 * corner; a single axis candidate becomes that edge's midpoint, because the
 * other axis has no edge to hold on to. That yields the eight anchors the panel
 * documents: four corners plus four edge midpoints.
 *
 * @returns the anchor to settle on, or `null` when the panel was dropped clear
 *          of every edge and should stay at the free position.
 */
export function snapPlacement(
  point: Point,
  size: Size,
  viewport: Size,
  gap: number = edgeGap(viewport),
  threshold: number = SNAP_THRESHOLD,
): AnchorPlacement | null {
  const left = point.x
  const right = viewport.width - point.x - size.width
  const top = point.y
  const bottom = viewport.height - point.y - size.height

  let x: HorizontalAnchor | undefined
  if (left < threshold && right < threshold) x = left <= right ? 'left' : 'right'
  else if (left < threshold) x = 'left'
  else if (right < threshold) x = 'right'

  let y: VerticalAnchor | undefined
  if (top < threshold && bottom < threshold) y = top <= bottom ? 'top' : 'bottom'
  else if (top < threshold) y = 'top'
  else if (bottom < threshold) y = 'bottom'

  if (x === undefined && y === undefined) return null
  return { kind: 'anchor', x: x ?? 'center', y: y ?? 'middle', gap }
}

/** Turn the release point into its final placement, snapping when eligible. */
export function settlePlacement(
  point: Point,
  size: Size,
  viewport: Size,
  gap: number = edgeGap(viewport),
  threshold: number = SNAP_THRESHOLD,
): Placement {
  return snapPlacement(point, size, viewport, gap, threshold) ?? { kind: 'free', x: point.x, y: point.y }
}

/** Whether the placement is the default bottom-right corner for this viewport. */
export function isDefaultPlacement(placement: Placement, viewport: Size): boolean {
  const fallback = defaultPlacement(viewport)
  return (
    placement.kind === 'anchor' &&
    placement.x === fallback.x &&
    placement.y === fallback.y &&
    placement.gap === fallback.gap
  )
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

/** Read one anchored placement, rejecting unknown anchor names. */
function readAnchor(value: Record<string, unknown>): AnchorPlacement | null {
  const { x, y } = value
  if (x !== 'left' && x !== 'center' && x !== 'right') return null
  if (y !== 'top' && y !== 'middle' && y !== 'bottom') return null
  // `center`/`middle` would mean the middle of the viewport, not one of the
  // eight documented anchors.
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
