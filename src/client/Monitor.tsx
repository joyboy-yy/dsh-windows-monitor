/**
 * The windows-monitor panel.
 *
 * Lives in the frame-wide `shell.overlay` slot as a fixed corner surface: a
 * compact pill while collapsed, and a detail card while expanded. Both states
 * share one placement, so the panel never grows into the middle of the page.
 *
 * Dragging always produces a free placement — there is no release-time snap.
 * Docking is explicit: the card's 自定义位置 picker offers eight anchors
 * (corners and edge midpoints). Docked placements are recomputed on resize, so
 * the recorded gap survives instead of the pixel coordinate. The usable area
 * starts below the frame's window-chrome strip, so neither a drag nor a docked
 * top position can cover the titlebar or its caption buttons.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react'

import type { Snapshot, SnapshotError } from '../protocol.js'
import type { ClientPluginContext } from './harness.js'
import { Icon } from './icons.js'
import {
  clampToViewport,
  defaultPlacement,
  edgeGap,
  parsePlacement,
  resolvePlacement,
  serializePlacement,
  type AnchorPlacement,
  type HorizontalAnchor,
  type Placement,
  type Point,
  type Size,
  type VerticalAnchor,
  type Viewport,
} from './placement.js'

/** Pointer travel before a press turns into a drag rather than a click, in px. */
const DRAG_THRESHOLD = 4

/** How long a drag keeps swallowing clicks, in ms. */
const CLICK_SUPPRESS_MS = 350

/** How long the move to an explicitly chosen position runs, in ms. */
const PLACE_MS = 220

/** Poll interval for the snapshot endpoint, in ms. */
const REFRESH_MS = 10_000

/** Storage key holding the last placement. Kept from 0.2.4 for migration. */
const POSITION_KEY = 'dsh-windows-monitor:position'

/** DOM id linking the position button to its grid. */
const POSITION_PANEL_ID = 'sm-windows-monitor-positions'

/** One direction offered by the custom-position picker. */
interface PositionChoice {
  x: HorizontalAnchor
  y: VerticalAnchor
  label: string
}

/**
 * The picker grid, row by row: corners, edge midpoints, and an empty centre.
 *
 * The order is the visual order, so adding a target here is enough to add a
 * button in the right cell.
 */
const POSITION_GRID: ReadonlyArray<PositionChoice | null> = [
  { x: 'left', y: 'top', label: '左上角' },
  { x: 'center', y: 'top', label: '顶部居中' },
  { x: 'right', y: 'top', label: '右上角' },
  { x: 'left', y: 'middle', label: '左侧居中' },
  null,
  { x: 'right', y: 'middle', label: '右侧居中' },
  { x: 'left', y: 'bottom', label: '左下角' },
  { x: 'center', y: 'bottom', label: '底部居中' },
  { x: 'right', y: 'bottom', label: '右下角' },
]

/** Thresholds for one metric. */
interface Severity {
  warn: number
  bad: number
}

/** Drag bookkeeping for the in-flight gesture. */
interface DragState {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  width: number
  height: number
  last: Point | null
}

/** Severity bucket for one percentage; `null` (unknown) has no bucket. */
function level(value: number | null, { warn, bad }: Severity): string {
  if (value === null) return ''
  return value >= bad ? 'bad' : value >= warn ? 'warn' : ''
}

/** Clamp into a 0-100 percentage, mapping non-finite input to 0. */
function percent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

/**
 * Read a wire value that may legitimately be unknown.
 *
 * The snapshot is JSON from a separate process, so this treats absent, empty
 * and non-numeric alike: all three mean "we do not know", which is rendered as
 * `--` rather than as a confident zero.
 */
function readNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** Fixed-precision GB reading, `--` when unknown. */
function formatGB(value: number | null): string {
  return value === null ? '--' : `${value.toFixed(1)} GB`
}

/**
 * A free/total pair stated with one unit, e.g. `412.8 / 1000.0 GB`.
 *
 * Repeating "GB" on both numbers overflows the 280 px row on a large volume —
 * which showed up as an ellipsis swallowing the total, the one number the row
 * exists to convey.
 */
function formatVolume(free: number | null, total: number | null): string {
  if (free === null || total === null) return formatGB(free ?? total)
  return `${free.toFixed(1)} / ${total.toFixed(1)} GB`
}

/** Throughput, kept readable from a trickle to hundreds of MB/s. */
function formatThroughput(value: number | null): string {
  if (value === null) return ''
  if (value < 0.005) return '0 MB/s'
  if (value < 1) return `${value.toFixed(2)} MB/s`
  if (value < 10) return `${value.toFixed(1)} MB/s`
  return `${Math.round(value)} MB/s`
}

/**
 * The layout viewport, not `window.innerWidth`.
 *
 * `position: fixed` resolves against the layout viewport, which excludes a
 * document scrollbar; `innerWidth` includes it. Using the same box for the
 * arithmetic as the browser uses for `right`/`bottom` avoids a one-scrollbar
 * jump the first time a docked panel is dragged.
 */
function readViewportSize(): Size {
  const root = document.documentElement
  return {
    width: root.clientWidth || window.innerWidth,
    height: root.clientHeight || window.innerHeight,
  }
}

/**
 * Resolve one frame variable to pixels through a probe.
 *
 * `getComputedStyle(root).getPropertyValue('--x')` may return a `calc(...)`
 * expression rather than a length; putting the variable in a real `height`
 * makes the browser resolve it. A plain browser publishes neither variable,
 * and the `0px` fallback keeps this at zero there.
 */
function readCssLength(variable: string): number {
  const probe = document.createElement('span')
  probe.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'width:0',
    'display:block',
    'visibility:hidden',
    'pointer-events:none',
    `height:var(${variable},0px)`,
  ].join(';')
  const host = document.body ?? document.documentElement
  host.appendChild(probe)
  const length = probe.getBoundingClientRect().height
  probe.remove()
  return Number.isFinite(length) && length > 0 ? length : 0
}

/**
 * The top inset reserved for floating layers.
 *
 * DSH publishes `--dsh-frame-overlay-top` for overlays: the window-chrome strip
 * plus a 20px breathing gap, reduced to 20px in native fullscreen. That is the
 * same top bound the frame's own dockkit floats use, so a floating panel here
 * follows the platform instead of inventing a second safe area. A frame that
 * publishes only the bare strip falls back to `--dsh-frame-top-clearance`;
 * plain browser documents publish neither.
 */
function readInsetTop(): number {
  const overlayTop = readCssLength('--dsh-frame-overlay-top')
  return overlayTop > 0 ? overlayTop : readCssLength('--dsh-frame-top-clearance')
}

/** The layout viewport plus the frame's reserved top strip. */
function readViewport(): Viewport {
  return { ...readViewportSize(), insetTop: readInsetTop() }
}

/** Read the persisted placement, tolerating absent or corrupt storage. */
function readStoredPlacement(): Placement | null {
  try {
    return parsePlacement(window.localStorage.getItem(POSITION_KEY))
  } catch {
    return null
  }
}

/** Persist, or clear, the last placement. Storage may be unavailable. */
function writeStoredPlacement(placement: Placement | null): void {
  try {
    if (placement) {
      window.localStorage.setItem(POSITION_KEY, serializePlacement(placement))
    } else {
      window.localStorage.removeItem(POSITION_KEY)
    }
  } catch {
    // Private mode or a blocked origin: the in-memory placement still applies.
  }
}

/** Render a free/anchor placement with CSS anchoring, before the first measurement. */
function fallbackStyle(placement: Placement): CSSProperties {
  if (placement.kind === 'free') {
    return { left: placement.x, top: placement.y, right: 'auto', bottom: 'auto', transform: 'none' }
  }
  const { gap } = placement
  const style: CSSProperties = { left: 'auto', right: 'auto', top: 'auto', bottom: 'auto' }
  const transforms: string[] = []
  if (placement.x === 'left') style.left = gap
  else if (placement.x === 'right') style.right = gap
  else {
    style.left = '50%'
    transforms.push('translateX(-50%)')
  }
  if (placement.y === 'top') {
    // The fallback runs before the layout effect has measured the frame inset.
    // Using the published overlay inset here keeps even that first paint below
    // the window controls; the measured inset replaces it before paint.
    style.top = `calc(var(--dsh-frame-overlay-top, 0px) + ${gap}px)`
  } else if (placement.y === 'bottom') style.bottom = gap
  else {
    style.top = '50%'
    transforms.push('translateY(-50%)')
  }
  if (transforms.length > 0) style.transform = transforms.join(' ')
  return style
}

/** Whether a docked placement is the direction this grid cell names. */
function isActivePosition(placement: Placement, choice: PositionChoice): boolean {
  return placement.kind === 'anchor' && placement.x === choice.x && placement.y === choice.y
}

/** The 3x3 glyph on the custom-position button. */
function PositionGlyph(): ReactElement {
  return (
    <span className="sm-grid-glyph" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => (
        <span key={index} />
      ))}
    </span>
  )
}

/** Render a measured point. */
function pointStyle(point: Point): CSSProperties {
  return { left: point.x, top: point.y, right: 'auto', bottom: 'auto', transform: 'none' }
}

/**
 * One labelled percentage with a thin progress track.
 *
 * A `null` value renders as `--` with an empty track: an unknown reading must
 * not be drawn as 0%, which would claim the resource is idle.
 */
function Metric({
  label,
  value,
  severity,
  hint,
}: {
  label: string
  value: number | null
  severity: Severity
  hint?: string
}): ReactElement {
  const status = level(value, severity)
  const text = value === null ? '--' : `${value}%`
  return (
    <div className="sm-metric" title={hint ?? `${label} ${text}`}>
      <div className="sm-metric-head">
        <span className="sm-metric-label">{label}</span>
        <span className={`sm-metric-value ${status}`}>{text}</span>
      </div>
      <div className="sm-track">
        <div className={`sm-fill ${status}`} style={{ width: value === null ? '0%' : `${percent(value)}%` }} />
      </div>
    </div>
  )
}

/** Compact inline reading used by the collapsed pill. */
function Micro({ label, value, severity }: { label: string; value: number; severity: Severity }): ReactElement {
  const status = level(value, severity)
  return (
    <span className="sm-micro">
      <span className="sm-micro-label">{label}</span>
      <span className="sm-micro-value">{value}%</span>
      <span className="sm-micro-track">
        <span className={`sm-micro-fill ${status}`} style={{ width: `${percent(value)}%` }} />
      </span>
    </span>
  )
}

const CPU_SEVERITY: Severity = { warn: 75, bad: 90 }
const MEMORY_SEVERITY: Severity = { warn: 80, bad: 90 }
/** Busy time, scored against Task Manager's own notion of a saturated disk. */
const DISK_ACTIVITY_SEVERITY: Severity = { warn: 75, bad: 90 }
/** Fullness. Scored separately so one gauge can never stand in for the other. */
const DISK_CAPACITY_SEVERITY: Severity = { warn: 85, bad: 92 }

/** The overlay surface. */
export function Monitor({ ctx }: { ctx: ClientPluginContext }): ReactElement {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<Snapshot | null>(null)
  const [error, setError] = useState('')
  const [unsupported, setUnsupported] = useState(false)
  const [loading, setLoading] = useState(false)
  const [viewport, setViewport] = useState<Viewport>(() => ({ ...readViewportSize(), insetTop: 0 }))
  const [placement, setPlacement] = useState<Placement>(
    () => readStoredPlacement() ?? defaultPlacement(readViewportSize()),
  )
  const [box, setBox] = useState<Size | null>(null)
  const [dragging, setDragging] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const positionButtonRef = useRef<HTMLButtonElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const movedRef = useRef(false)
  const suppressClickRef = useRef(0)
  const placeTimerRef = useRef<number | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const response = await fetch('/api/windows-monitor/snapshot', { cache: 'no-store' })
      const result = (await response.json()) as Snapshot & Partial<SnapshotError>
      if (!response.ok) {
        setUnsupported(result.unsupported === true)
        throw new Error(result.error ?? `HTTP ${response.status}`)
      }
      setUnsupported(false)
      setData(result)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取本机状态')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    // The timer service ties the poll to this plugin's fiber, so stopping the
    // plugin stops the polling even before React unmounts.
    return ctx.interval(() => void refresh(), REFRESH_MS)
  }, [ctx, refresh])

  // Resolve the frame's reserved top strip before the first paint, then follow
  // window resizes and the desktop's fullscreen/titlebar markers. That strip is
  // what keeps the panel out of the window-control area; the viewport state
  // starts at zero because reading the frame variables needs a DOM probe.
  useLayoutEffect(() => {
    const sync = (): void => {
      const next = readViewport()
      setViewport((current) =>
        current.width === next.width &&
        current.height === next.height &&
        current.insetTop === next.insetTop
          ? current
          : next,
      )
    }
    sync()
    window.addEventListener('resize', sync)
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-fullscreen', 'data-windows-titlebar', 'data-platform'],
    })
    return () => {
      window.removeEventListener('resize', sync)
      observer.disconnect()
    }
  }, [])

  // Measure the rendered box once and whenever expanding/collapsing or opening
  // the position picker changes it. `useLayoutEffect` runs before paint, so a
  // docked panel never draws with the previous state's footprint for a frame.
  useLayoutEffect(() => {
    const node = rootRef.current
    if (!node) return
    const sync = (): void => {
      const rect = node.getBoundingClientRect()
      setBox((current) =>
        current !== null && current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      )
    }
    sync()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    return () => observer.disconnect()
  }, [open, pickerOpen])

  // A collapsed card has no picker; do not reopen it with the card next time.
  useEffect(() => {
    if (!open) setPickerOpen(false)
  }, [open])

  useEffect(
    () => () => {
      if (placeTimerRef.current !== null) window.clearTimeout(placeTimerRef.current)
    },
    [],
  )

  const beginPlacement = (): void => {
    setPlacing(true)
    if (placeTimerRef.current !== null) window.clearTimeout(placeTimerRef.current)
    placeTimerRef.current = window.setTimeout(() => {
      placeTimerRef.current = null
      setPlacing(false)
    }, PLACE_MS)
  }

  const beginDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    const target = event.target
    const button = target instanceof Element ? target.closest('button') : null
    // Buttons nested inside a drag surface keep their own click behavior. The
    // pill itself is a button, so its own press still starts the drag.
    if (button && button !== event.currentTarget) return
    const node = rootRef.current
    if (!node) return

    const rect = node.getBoundingClientRect()
    setBox((current) =>
      current !== null && current.width === rect.width && current.height === rect.height
        ? current
        : { width: rect.width, height: rect.height },
    )
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      width: rect.width,
      height: rect.height,
      last: null,
    }
    movedRef.current = false
    setPlacing(false)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Capture is an optimization: pointermove still bubbles to the handle.
    }
  }

  const moveDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!movedRef.current) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
      movedRef.current = true
      setDragging(true)
    }

    // Clamp inside the usable area: its top edge is below the window chrome,
    // so the panel cannot be dragged over the titlebar or caption buttons.
    const next = clampToViewport(
      { x: drag.originX + dx, y: drag.originY + dy },
      { width: drag.width, height: drag.height },
      viewport,
    )
    drag.last = next
    setPlacement({ kind: 'free', x: next.x, y: next.y })
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (!movedRef.current) return

    // The pill is a button, so the browser fires one click right after its
    // pointerup: swallow that single click, but never a later deliberate one.
    // A card-header drag has no click target of its own, so it needs no guard.
    if (event.currentTarget.classList.contains('sm-pill')) {
      suppressClickRef.current = Date.now() + CLICK_SUPPRESS_MS
    }

    const released = drag.last ?? { x: drag.originX, y: drag.originY }
    // The pill can grow while the snapshot loads; the last measured box is the
    // footprint that is actually on screen at release.
    const size = box ?? { width: drag.width, height: drag.height }
    // No release-time snapping: the drop point is the placement. Docking is
    // an explicit action through the position picker.
    const next: Placement = { kind: 'free', ...clampToViewport(released, size, viewport) }
    setPlacement(next)
    writeStoredPlacement(next)
  }

  const toggle = (): void => {
    if (Date.now() < suppressClickRef.current) {
      suppressClickRef.current = 0
      return
    }
    setOpen((value) => !value)
  }

  const choosePosition = (choice: PositionChoice): void => {
    const next: AnchorPlacement = {
      kind: 'anchor',
      x: choice.x,
      y: choice.y,
      gap: edgeGap(viewport),
    }
    setPlacement(next)
    writeStoredPlacement(next)
    setPickerOpen(false)
    beginPlacement()
    // The pressed grid cell unmounts with the picker; return focus to the
    // control that opened it.
    positionButtonRef.current?.focus()
  }

  const cpu = data ? Number(data.cpu) || 0 : 0
  const memory = data ? Number(data.memory.usedPct) || 0 : 0

  // Capacity ("how full is this volume") and activity ("is the disk working
  // right now") are different questions on different timescales. Capacity
  // barely moves in an hour, so it belongs in the rows; the gauge and the
  // status dot track activity, which is what Task Manager's own 磁盘 column
  // reports. Showing fullness in the gauge is what made the panel read as a
  // stuck or broken dial next to a live CPU number.
  const capacityPeak =
    data && data.disks.length > 0 ? Math.max(...data.disks.map((item) => Number(item.usedPct) || 0)) : null
  const activity = data ? readNumber(data.diskActivity?.activePct) : null
  const diskRead = data ? readNumber(data.diskActivity?.readMBs) : null
  const diskWrite = data ? readNumber(data.diskActivity?.writeMBs) : null
  const throughput = [
    diskRead !== null && diskRead > 0 ? `读 ${formatThroughput(diskRead)}` : '',
    diskWrite !== null && diskWrite > 0 ? `写 ${formatThroughput(diskWrite)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const activityText = activity === null ? '--' : `${activity}%`

  const status = error
    ? 'bad'
    : cpu >= CPU_SEVERITY.bad ||
        memory >= MEMORY_SEVERITY.bad ||
        (activity ?? 0) >= DISK_ACTIVITY_SEVERITY.bad ||
        (capacityPeak ?? 0) >= DISK_CAPACITY_SEVERITY.bad
      ? 'bad'
      : cpu >= CPU_SEVERITY.warn ||
          memory >= MEMORY_SEVERITY.warn ||
          (activity ?? 0) >= DISK_ACTIVITY_SEVERITY.warn ||
          (capacityPeak ?? 0) >= DISK_CAPACITY_SEVERITY.warn
        ? 'warn'
        : ''
  const dotStatus = error ? 'bad' : data ? status : 'idle'
  const statusText = error
    ? unsupported
      ? '不支持的平台'
      : '采集失败'
    : status === 'bad'
      ? '需要关注'
      : status === 'warn'
        ? '负载偏高'
        : '正常'

  const rows: ReactElement[] = []
  if (data) {
    for (const item of data.disks) {
      rows.push(
        <div className="sm-row" key={item.name}>
          <span>{`${item.name} 磁盘空间`}</span>
          <span
            className={item.usedPct >= DISK_CAPACITY_SEVERITY.warn ? 'sm-alert' : ''}
            title={`${item.name} 已用 ${item.usedPct}% · 剩余 ${formatGB(item.free)} / ${formatGB(item.total)}`}
          >{`已用 ${item.usedPct}% · 剩余 ${formatVolume(item.free, item.total)}`}</span>
        </div>,
      )
    }
    rows.push(
      <div className="sm-row" key="disk-activity">
        <span>磁盘活动</span>
        <span
          className={level(activity, DISK_ACTIVITY_SEVERITY) === 'bad' ? 'sm-alert' : ''}
          title="与任务管理器「性能 → 磁盘」的活动时间同口径"
        >
          {throughput ? `${activityText} · ${throughput}` : activityText}
        </span>
      </div>,
    )
    if (data.memory) {
      rows.push(
        <div className="sm-row" key="memory">
          <span>内存</span>
          <span>{`${data.memory.freeGB} GB 可用 / ${data.memory.totalGB} GB`}</span>
        </div>,
      )
    }
    rows.push(
      <div className="sm-row" key="network">
        <span>网络</span>
        <span className={data.network.connected ? '' : 'sm-alert'}>
          {data.network.connected ? `${data.network.adapters} 个网卡已连接` : '未连接'}
        </span>
      </div>,
      <div className="sm-row" key="uptime">
        <span>连续运行</span>
        <span>{`${data.uptimeHours} 小时`}</span>
      </div>,
    )
    if (data.battery) {
      rows.push(
        <div className="sm-row" key="battery">
          <span>电池</span>
          <span className={data.battery.percent <= 20 ? 'sm-alert' : ''}>{`${data.battery.percent}%`}</span>
        </div>,
      )
    }
  }

  const handleProps = {
    onPointerDown: beginDrag,
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  }

  // Before the first measurement the CSS anchor below is already exact for
  // every edge/corner; once measured, the same position is resolved to pixels
  // so a resize can be recomputed from the recorded anchor.
  const point = box === null ? null : resolvePlacement(placement, box, viewport)
  const rootStyle = point === null ? fallbackStyle(placement) : pointStyle(point)

  const live = data !== null && error === ''

  return (
    <div
      ref={rootRef}
      className={`sm-root${dragging ? ' sm-dragging' : ''}${placing ? ' sm-placing' : ''}`}
      style={rootStyle}
      data-placement={placement.kind === 'anchor' ? `${placement.x}-${placement.y}` : 'free'}
    >
      {open ? (
        <div className="sm-card">
          <div className="sm-head" title="按住拖动" {...handleProps}>
            <span className={`sm-dot ${dotStatus}`} />
            <span className="sm-title">{data ? data.computer : '本机状态'}</span>
            <span className={`sm-chip ${status}`}>{statusText}</span>
            <button
              type="button"
              className={`sm-icon${loading ? ' spinning' : ''}`}
              onClick={() => void refresh()}
              disabled={loading}
              title="立即刷新"
              aria-label="立即刷新"
            >
              <Icon name="refresh" />
            </button>
            <button type="button" className="sm-icon" onClick={toggle} title="收起系统状态" aria-label="收起系统状态">
              <Icon name="chevronDown" />
            </button>
          </div>
          {error ? (
            <div className="sm-error">{unsupported ? error : `采集失败：${error}`}</div>
          ) : (
            <div className="sm-body">
              <div className="sm-grid">
                <Metric label="CPU" value={cpu} severity={CPU_SEVERITY} />
                <Metric label="内存" value={memory} severity={MEMORY_SEVERITY} />
                {/* 磁盘 here means activity — Task Manager's own label for busy
                    time. Fullness lives in the rows below as 磁盘空间, so the
                    two can never be mistaken for one another. */}
                <Metric
                  label="磁盘活动"
                  value={activity}
                  severity={DISK_ACTIVITY_SEVERITY}
                  hint={`磁盘活动 ${activityText}（与任务管理器「性能 → 磁盘」同口径）`}
                />
              </div>
              <div className="sm-rows">{rows}</div>
              <div className="sm-foot">
                <span className="sm-time">
                  {data ? `更新于 ${new Date(data.timestamp).toLocaleTimeString()}` : '正在建立基线'}
                </span>
                <button
                  ref={positionButtonRef}
                  type="button"
                  className="sm-positions-toggle"
                  onClick={() => setPickerOpen((value) => !value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && pickerOpen) {
                      event.stopPropagation()
                      setPickerOpen(false)
                    }
                  }}
                  aria-expanded={pickerOpen}
                  aria-controls={POSITION_PANEL_ID}
                  title="选择悬浮窗停靠位置"
                >
                  <PositionGlyph />
                  <span>自定义位置</span>
                </button>
              </div>
              {pickerOpen && (
                <div
                  className="sm-position-panel"
                  id={POSITION_PANEL_ID}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.stopPropagation()
                      setPickerOpen(false)
                      positionButtonRef.current?.focus()
                    }
                  }}
                >
                  <span className="sm-position-label">停靠位置</span>
                  <div className="sm-position-grid" role="group" aria-label="悬浮窗停靠位置">
                    {POSITION_GRID.map((choice, index) =>
                      choice === null ? (
                        <span key={`center-${index}`} className="sm-position-center" aria-hidden="true" />
                      ) : (
                        <button
                          key={`${choice.x}-${choice.y}`}
                          type="button"
                          className={`sm-position${isActivePosition(placement, choice) ? ' active' : ''}`}
                          onClick={() => choosePosition(choice)}
                          aria-label={`停靠到${choice.label}`}
                          aria-pressed={isActivePosition(placement, choice)}
                          title={choice.label}
                        >
                          <span className="sm-position-frame" aria-hidden="true">
                            <span
                              className="sm-position-dot"
                              data-x={choice.x}
                              data-y={choice.y}
                            />
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="sm-pill"
          onClick={toggle}
          aria-expanded={false}
          aria-label="展开本机状态"
          title={
            data
              ? `CPU ${cpu}% · 内存 ${memory}% · 磁盘活动 ${activityText} · 磁盘空间峰值 ${capacityPeak ?? '--'}%（点击展开，可拖动；展开后可自定义位置）`
              : '本机状态（点击展开，可拖动；展开后可自定义位置）'
          }
          {...handleProps}
        >
          <span className={`sm-dot ${dotStatus}`} />
          {live ? (
            <>
              <Micro label="CPU" value={cpu} severity={CPU_SEVERITY} />
              <Micro label="MEM" value={memory} severity={MEMORY_SEVERITY} />
            </>
          ) : (
            <span className="sm-hint">{error ? (unsupported ? '不支持' : '不可用') : '读取中'}</span>
          )}
          <span className="sm-caret">
            <Icon name="chevronUp" />
          </span>
        </button>
      )}
    </div>
  )
}
