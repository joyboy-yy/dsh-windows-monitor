/**
 * Placement geometry tests.
 *
 * These are pure functions, so the eight docked positions, the safe top strip,
 * the clamp and the storage migration can be pinned down without a browser.
 * The component is a thin adapter over this module.
 */

import { describe, expect, it } from 'vitest'

import {
  COMPACT_EDGE_GAP,
  EDGE_GAP,
  STORAGE_VERSION,
  anchorPoint,
  clampToViewport,
  defaultPlacement,
  edgeGap,
  parsePlacement,
  resolvePlacement,
  serializePlacement,
  type AnchorPlacement,
  type Size,
  type Viewport,
} from '../src/client/placement.js'

/** A desktop-sized viewport with a 60 px window-chrome strip. */
const VIEW: Viewport = { width: 1200, height: 800, insetTop: 60 }

/** A collapsed pill, roughly the shipped size. */
const PILL: Size = { width: 240, height: 36 }

/** The usable top edge, below the reserved strip. */
const TOP = VIEW.insetTop

/** The usable height. */
const USABLE = VIEW.height - TOP

/** Middle of the usable area, for vertical centring. */
const MIDDLE_Y = TOP + (USABLE - PILL.height) / 2

/** All eight anchors, with the pixels each must resolve to. */
const ANCHORS: ReadonlyArray<[AnchorPlacement, { x: number; y: number }]> = [
  [{ kind: 'anchor', x: 'left', y: 'top', gap: 14 }, { x: 14, y: TOP + 14 }],
  [{ kind: 'anchor', x: 'center', y: 'top', gap: 14 }, { x: (VIEW.width - PILL.width) / 2, y: TOP + 14 }],
  [{ kind: 'anchor', x: 'right', y: 'top', gap: 14 }, { x: VIEW.width - PILL.width - 14, y: TOP + 14 }],
  [{ kind: 'anchor', x: 'left', y: 'middle', gap: 14 }, { x: 14, y: MIDDLE_Y }],
  [{ kind: 'anchor', x: 'right', y: 'middle', gap: 14 }, { x: VIEW.width - PILL.width - 14, y: MIDDLE_Y }],
  [{ kind: 'anchor', x: 'left', y: 'bottom', gap: 14 }, { x: 14, y: VIEW.height - PILL.height - 14 }],
  [{ kind: 'anchor', x: 'center', y: 'bottom', gap: 14 }, { x: (VIEW.width - PILL.width) / 2, y: VIEW.height - PILL.height - 14 }],
  [{ kind: 'anchor', x: 'right', y: 'bottom', gap: 14 }, { x: VIEW.width - PILL.width - 14, y: VIEW.height - PILL.height - 14 }],
]

describe('anchorPoint', () => {
  it('resolves all eight custom positions inside the usable area', () => {
    for (const [placement, expected] of ANCHORS) {
      expect(anchorPoint(placement, PILL, VIEW)).toEqual(expected)
    }
  })

  it('never puts a top-docked panel in the window-chrome strip', () => {
    for (const placement of ANCHORS.map(([anchor]) => anchor).filter((anchor) => anchor.y === 'top')) {
      const point = anchorPoint(placement, PILL, VIEW)
      expect(point.y).toBeGreaterThanOrEqual(VIEW.insetTop + placement.gap)
    }
  })

  it('keeps the bottom positions unchanged by the top strip', () => {
    const placement: AnchorPlacement = { kind: 'anchor', x: 'right', y: 'bottom', gap: 14 }
    expect(anchorPoint(placement, PILL, VIEW).y).toBe(VIEW.height - PILL.height - 14)
  })

  it('recomputes a docked position on resize while preserving the gap', () => {
    const placement: AnchorPlacement = { kind: 'anchor', x: 'right', y: 'top', gap: 14 }
    const first = anchorPoint(placement, PILL, VIEW)
    expect(first.x).toBe(VIEW.width - PILL.width - 14)

    const wider: Viewport = { width: 1600, height: 1000, insetTop: 60 }
    const second = anchorPoint(placement, PILL, wider)
    expect(second).toEqual({ x: wider.width - PILL.width - 14, y: TOP + 14 })
    expect(wider.width - second.x - PILL.width).toBe(14)
  })

  it('follows the collapsed strip when native fullscreen shrinks it to 20px', () => {
    const placement: AnchorPlacement = { kind: 'anchor', x: 'center', y: 'top', gap: 14 }
    const fullscreen: Viewport = { ...VIEW, insetTop: 20 }

    expect(anchorPoint(placement, PILL, fullscreen).y).toBe(34)
    expect(anchorPoint(placement, PILL, fullscreen).x).toBe((VIEW.width - PILL.width) / 2)
  })

  it('matches the viewport top in a plain browser, where no strip is published', () => {
    const plain: Viewport = { ...VIEW, insetTop: 0 }
    expect(anchorPoint({ kind: 'anchor', x: 'left', y: 'top', gap: 14 }, PILL, plain).y).toBe(14)
  })

  it('keeps an oversized panel at the safe origin instead of above the strip', () => {
    const huge: Size = { width: 2000, height: 1000 }
    expect(anchorPoint({ kind: 'anchor', x: 'right', y: 'bottom', gap: 14 }, huge, VIEW)).toEqual({
      x: 0,
      y: TOP,
    })
  })
})

describe('clampToViewport', () => {
  it('clamps a free position below the chrome strip and inside the viewport', () => {
    expect(clampToViewport({ x: 10, y: 10 }, PILL, VIEW)).toEqual({ x: 10, y: TOP })
    expect(clampToViewport({ x: -20, y: 900 }, PILL, VIEW)).toEqual({
      x: 0,
      y: VIEW.height - PILL.height,
    })
  })

  it('leaves an in-range point alone', () => {
    expect(clampToViewport({ x: 500, y: 400 }, PILL, VIEW)).toEqual({ x: 500, y: 400 })
  })

  it('keeps the origin at the strip when the panel is larger than the viewport', () => {
    const huge: Size = { width: 2000, height: 1000 }
    expect(clampToViewport({ x: 500, y: 300 }, huge, VIEW)).toEqual({ x: 0, y: TOP })
  })

  it('resolves a free placement through the same clamp', () => {
    expect(resolvePlacement({ kind: 'free', x: -40, y: 40 }, PILL, VIEW)).toEqual({ x: 0, y: TOP })
  })
})

describe('defaults', () => {
  it('keeps the bottom-right corner and widens the gap above the compact width', () => {
    expect(edgeGap({ width: 520, height: 800 })).toBe(COMPACT_EDGE_GAP)
    expect(edgeGap({ width: 521, height: 800 })).toBe(EDGE_GAP)
    expect(defaultPlacement(VIEW)).toEqual({ kind: 'anchor', x: 'right', y: 'bottom', gap: EDGE_GAP })
  })
})

describe('persisted placement', () => {
  it('reads the legacy coordinate pair as a free placement', () => {
    expect(parsePlacement('{"x":1057,"y":162}')).toEqual({ kind: 'free', x: 1057, y: 162 })
  })

  it('round-trips the versioned anchor shape', () => {
    const placement: AnchorPlacement = { kind: 'anchor', x: 'left', y: 'top', gap: 14 }
    const raw = serializePlacement(placement)

    expect(JSON.parse(raw)).toEqual({ version: STORAGE_VERSION, placement })
    expect(parsePlacement(raw)).toEqual(placement)
  })

  it('round-trips a versioned free placement with rounded coordinates', () => {
    const raw = serializePlacement({ kind: 'free', x: 12.6, y: 40.2 })
    expect(parsePlacement(raw)).toEqual({ kind: 'free', x: 13, y: 40 })
  })

  it('rejects corrupt, unknown or out-of-range data', () => {
    expect(parsePlacement(null)).toBeNull()
    expect(parsePlacement('not json')).toBeNull()
    expect(parsePlacement('null')).toBeNull()
    expect(parsePlacement('{"x":"1057","y":162}')).toBeNull()
    expect(parsePlacement('{"version":1,"placement":{"kind":"free","x":1,"y":2}}')).toBeNull()
    expect(parsePlacement('{"version":2,"placement":{"kind":"anchor","x":"center","y":"middle","gap":14}}')).toBeNull()
    expect(parsePlacement('{"version":2,"placement":{"kind":"anchor","x":"right","y":"top","gap":null}}')).toBeNull()
  })

  it('clamps an out-of-range stored gap', () => {
    expect(parsePlacement('{"version":2,"placement":{"kind":"anchor","x":"left","y":"top","gap":999}}')).toMatchObject({
      gap: 64,
    })
    expect(parsePlacement('{"version":2,"placement":{"kind":"anchor","x":"left","y":"top","gap":-4}}')).toMatchObject({
      gap: 0,
    })
  })
})
