/**
 * The windows-monitor panel.
 *
 * Lives in the frame-wide `shell.overlay` slot as a fixed corner surface: a
 * compact pill while collapsed, and a detail card while expanded. Both states
 * share one anchor, so the panel never grows into the middle of the page.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'

import type { Snapshot, SnapshotError } from '../protocol.js'
import type { ClientPluginContext } from './harness.js'
import { Icon } from './icons.js'

/** Distance kept between the panel and the viewport edge, in px. */
const EDGE = 14

/** Pointer travel before a press turns into a drag rather than a click, in px. */
const DRAG_THRESHOLD = 4

/** How long a drag keeps swallowing clicks, in ms. */
const CLICK_SUPPRESS_MS = 350

/** Poll interval for the snapshot endpoint, in ms. */
const REFRESH_MS = 10_000

/** Storage key holding a user-dragged position. */
const POSITION_KEY = 'dsh-windows-monitor:position'

/** Thresholds for one metric. */
interface Severity {
  warn: number
  bad: number
}

/** A dragged panel position in viewport coordinates. */
interface Position {
  x: number
  y: number
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
  last: Position | null
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

/** Throughput, kept readable from a trickle to hundreds of MB/s. */
function formatThroughput(value: number | null): string {
  if (value === null) return ''
  if (value < 0.005) return '0 MB/s'
  if (value < 1) return `${value.toFixed(2)} MB/s`
  if (value < 10) return `${value.toFixed(1)} MB/s`
  return `${Math.round(value)} MB/s`
}

/** Read the persisted position, tolerating absent or corrupt storage. */
function readPosition(): Position | null {
  try {
    const raw = window.localStorage.getItem(POSITION_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { x, y } = parsed as Partial<Position>
    if (typeof x !== 'number' || typeof y !== 'number') return null
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return { x, y }
  } catch {
    return null
  }
}

/** Persist, or clear, the dragged position. Storage may be unavailable. */
function writePosition(position: Position | null): void {
  try {
    if (position) {
      window.localStorage.setItem(
        POSITION_KEY,
        JSON.stringify({ x: Math.round(position.x), y: Math.round(position.y) }),
      )
    } else {
      window.localStorage.removeItem(POSITION_KEY)
    }
  } catch {
    // Private mode or a blocked origin: the in-memory position still applies.
  }
}

/** Keep a box of the given size fully inside the viewport. */
function clampPosition(x: number, y: number, width: number, height: number): Position {
  const maxX = Math.max(EDGE, window.innerWidth - width - EDGE)
  const maxY = Math.max(EDGE, window.innerHeight - height - EDGE)
  return {
    x: Math.min(Math.max(EDGE, x), maxX),
    y: Math.min(Math.max(EDGE, y), maxY),
  }
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
  const [position, setPosition] = useState<Position | null>(readPosition)
  const [dragging, setDragging] = useState(false)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const movedRef = useRef(false)
  const suppressClickRef = useRef(0)

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

  // Keep a dragged panel inside the viewport, and re-clamp whenever the
  // footprint changes (expand/collapse, window resize).
  useEffect(() => {
    const reclamp = (): void => {
      const node = rootRef.current
      if (!node) return
      setPosition((current) => {
        if (current === null) return current
        const next = clampPosition(current.x, current.y, node.offsetWidth, node.offsetHeight)
        return next.x === current.x && next.y === current.y ? current : next
      })
    }
    window.addEventListener('resize', reclamp)
    reclamp()
    return () => window.removeEventListener('resize', reclamp)
  }, [open])

  const beginDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    const target = event.target
    const button = target instanceof Element ? target.closest('button') : null
    // Buttons nested inside a drag surface keep their own click behavior.
    if (button && button !== event.currentTarget) return
    const node = rootRef.current
    if (!node) return

    const rect = node.getBoundingClientRect()
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
    const next = clampPosition(drag.originX + dx, drag.originY + dy, drag.width, drag.height)
    drag.last = next
    setPosition(next)
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (!movedRef.current) return
    // The browser fires one click right after pointerup: swallow that single
    // click, but never a later deliberate one.
    suppressClickRef.current = Date.now() + CLICK_SUPPRESS_MS
    if (drag.last) writePosition(drag.last)
  }

  const toggle = (): void => {
    if (Date.now() < suppressClickRef.current) {
      suppressClickRef.current = 0
      return
    }
    setOpen((value) => !value)
  }

  const resetPosition = (): void => {
    setPosition(null)
    writePosition(null)
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
          >{`已用 ${item.usedPct}% · 剩余 ${formatGB(item.free)} / ${formatGB(item.total)}`}</span>
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

  const rootStyle: CSSProperties | undefined = position
    ? { left: `${position.x}px`, top: `${position.y}px`, right: 'auto', bottom: 'auto' }
    : undefined

  const live = data !== null && error === ''

  return (
    <div ref={rootRef} className="sm-root" style={rootStyle}>
      {open ? (
        <div className={`sm-card${dragging ? ' dragging' : ''}`}>
          <div className="sm-head" {...handleProps}>
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
                {position !== null && (
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
          className={`sm-pill${dragging ? ' dragging' : ''}`}
          onClick={toggle}
          aria-expanded={false}
          aria-label="展开本机状态"
          title={
            data
              ? `CPU ${cpu}% · 内存 ${memory}% · 磁盘活动 ${activityText} · 磁盘空间峰值 ${capacityPeak ?? '--'}%（点击展开，可拖动）`
              : '本机状态（点击展开，可拖动）'
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
