/**
 * The windows-monitor panel.
 *
 * Lives in the frame-wide `shell.overlay` slot as a fixed corner surface: a
 * compact pill while collapsed, and a detail card while expanded. Both states
 * share one anchor, so the panel never grows into the middle of the page.
 *
 * A drag turns the panel into a free placement; releasing it near an edge
 * settles it onto one of eight anchors (corners and edge midpoints). Anchored
 * placements are recomputed on resize, so the recorded gap is what survives,
 * not the pixel coordinate.
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
  isDefaultPlacement,
  parsePlacement,
  resolvePlacement,
  serializePlacement,
  settlePlacement,
  type AnchorPlacement,
  type Placement,
  type Point,
  type Size,
} from './placement.js'

/** Pointer travel before a press turns into a drag rather than a click, in px. */
const DRAG_THRESHOLD = 4

/** How long a drag keeps swallowing clicks, in ms. */
const CLICK_SUPPRESS_MS = 350

/** How long the settle animation runs, in ms. */
const SETTLE_MS = 220

/** Poll interval for the snapshot endpoint, in ms. */
const REFRESH_MS = 10_000

/** Storage key holding the last placement. Kept from 0.2.4 for migration. */
const POSITION_KEY = 'dsh-windows-monitor:position'

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
 * jump the first time a default-anchored panel is dragged.
 */
function readViewport(): Size {
  const root = document.documentElement
  return {
    width: root.clientWidth || window.innerWidth,
    height: root.clientHeight || window.innerHeight,
  }
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
  if (placement.y === 'top') style.top = gap
  else if (placement.y === 'bottom') style.bottom = gap
  else {
    style.top = '50%'
    transforms.push('translateY(-50%)')
  }
  if (transforms.length > 0) style.transform = transforms.join(' ')
  return style
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
  const [viewport, setViewport] = useState<Size>(readViewport)
  const [placement, setPlacement] = useState<Placement>(
    () => readStoredPlacement() ?? defaultPlacement(readViewport()),
  )
  const [box, setBox] = useState<Size | null>(null)
  const [dragging, setDragging] = useState(false)
  const [settling, setSettling] = useState(false)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const movedRef = useRef(false)
  const suppressClickRef = useRef(0)
  const settleTimerRef = useRef<number | null>(null)

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

  // A resize is an instruction to re-resolve the recorded anchor: the panel
  // keeps the same edge gap while the viewport changes around it. Free
  // placements are clamped by `resolvePlacement` so they cannot fall offscreen.
  useEffect(() => {
    const onResize = (): void => {
      const next = readViewport()
      setViewport((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      )
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Measure the rendered box once and whenever expanding/collapsing changes it.
  // `useLayoutEffect` runs before paint, so an anchored panel never draws with
  // the previous state's footprint for a frame.
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
  }, [open])

  useEffect(
    () => () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
    },
    [],
  )

  const beginSettle = (): void => {
    setSettling(true)
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null
      setSettling(false)
    }, SETTLE_MS)
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
    setSettling(false)
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

    // Zero inset while dragging: the user must be able to reach the actual
    // edge for the release-time snap test to mean anything.
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
    const next = settlePlacement(released, size, viewport, edgeGap(viewport))
    setPlacement(next)
    writeStoredPlacement(next)
    // Only a snap moves the panel again after release; animate that hop. A
    // free drop is already exactly where the pointer left it.
    if (next.kind === 'anchor') beginSettle()
  }

  const toggle = (): void => {
    if (Date.now() < suppressClickRef.current) {
      suppressClickRef.current = 0
      return
    }
    setOpen((value) => !value)
  }

  const resetPosition = (): void => {
    setPlacement(defaultPlacement(viewport))
    // Clearing, rather than writing the default, lets a later launch pick the
    // gap appropriate for its own viewport width.
    writeStoredPlacement(null)
    beginSettle()
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
      className={`sm-root${dragging ? ' sm-dragging' : ''}${settling ? ' sm-settling' : ''}`}
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
                {!isDefaultPlacement(placement, viewport) && (
                  <button type="button" className="sm-reset" onClick={resetPosition} title="把面板放回右下角">
                    复位
                  </button>
                )}
              </div>
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
              ? `CPU ${cpu}% · 内存 ${memory}% · 磁盘活动 ${activityText} · 磁盘空间峰值 ${capacityPeak ?? '--'}%（点击展开，可拖动并吸附边缘）`
              : '本机状态（点击展开，可拖动并吸附边缘）'
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
