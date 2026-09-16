/**
 * Parse the shared `key=value` fact format into a {@link Snapshot}.
 *
 * Kept free of I/O so the whole contract is unit-testable without a real
 * machine: feed it recorded collector output and assert the result.
 */

import type { BatterySnapshot, DiskActivitySnapshot, DiskSnapshot, Snapshot } from '../protocol.js'

/** Value split by the collectors for the repeated `disk` key. */
const DISK_SEPARATOR = '|'

/** Facts every collector must emit for a snapshot to be usable. */
const REQUIRED_KEYS = ['computer', 'cpu', 'mem_total_mb', 'mem_used_mb', 'net_up', 'uptime_s'] as const

/** Round to one decimal, mapping non-finite input to 0. */
function round1(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0
}

/** Round to two decimals, mapping non-finite input to null. */
function round2(value: number): number | null {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
}

/** Whole number 0-100, or 0 when the input is unusable. */
function percentOf(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0
  return Math.round((part / whole) * 100)
}

/**
 * Read a fact that may legitimately be absent into `number | null`.
 *
 * Disk activity is optional: the Windows collector emits it only when the
 * performance-counter provider answers, and the Linux and macOS collectors do
 * not emit it at all. Absent must stay distinguishable from zero, so this
 * returns `null` rather than coercing to 0.
 */
function optionalNumber(facts: Map<string, string>, key: string): number | null {
  const raw = facts.get(key)
  if (raw === undefined || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/** Non-negative integer fact, or 0 when absent or unusable. */
function countOf(facts: Map<string, string>, key: string): number {
  const value = Number(facts.get(key))
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

/** Parse one `disk=name|totalGB|freeGB` value. */
function parseDisk(raw: string): DiskSnapshot | null {
  const parts = raw.split(DISK_SEPARATOR)
  if (parts.length !== 3) return null
  const name = (parts[0] ?? '').trim()
  const total = Number(parts[1])
  const free = Number(parts[2])
  if (!name || !Number.isFinite(total) || !Number.isFinite(free) || total <= 0) return null
  return {
    name,
    total: round1(total),
    free: round1(free),
    usedPct: percentOf(total - free, total),
  }
}

/**
 * Turn collector output into a snapshot.
 *
 * @param text - raw stdout of a collector command.
 * @param now - collection time; injected so tests are deterministic.
 * @throws {Error} when a required fact is missing or unparseable.
 */
export function parseFacts(text: string, now: Date = new Date()): Snapshot {
  const facts = new Map<string, string>()
  const disks: DiskSnapshot[] = []

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    if (key === 'disk') {
      const disk = parseDisk(value)
      if (disk) disks.push(disk)
      continue
    }
    // First occurrence wins so a duplicated key cannot flip a reading.
    if (!facts.has(key)) facts.set(key, value)
  }

  const missing = REQUIRED_KEYS.filter((key) => !facts.has(key))
  if (missing.length > 0) {
    throw new Error(`collector output is missing: ${missing.join(', ')}`)
  }

  const num = (key: string): number => Number(facts.get(key))
  const totalMb = num('mem_total_mb')
  const usedMb = num('mem_used_mb')
  const adapters = Math.max(0, Math.trunc(num('net_up')))
  const cpu = Math.min(100, Math.max(0, Math.round(num('cpu'))))
  const batteryRaw = facts.get('battery')
  const batteryPercent = batteryRaw === undefined ? Number.NaN : Number(batteryRaw)
  const battery: BatterySnapshot | null = Number.isFinite(batteryPercent)
    ? { percent: Math.min(100, Math.max(0, Math.round(batteryPercent))) }
    : null

  const activeRaw = optionalNumber(facts, 'disk_active_pct')
  const diskActivity: DiskActivitySnapshot = {
    activePct: activeRaw === null ? null : Math.min(100, Math.max(0, Math.round(activeRaw))),
    readMBs: round2(optionalNumber(facts, 'disk_read_mbs') ?? Number.NaN),
    writeMBs: round2(optionalNumber(facts, 'disk_write_mbs') ?? Number.NaN),
    instances: countOf(facts, 'disk_instances'),
  }

  return {
    timestamp: now.toISOString(),
    computer: facts.get('computer') ?? '',
    cpu,
    memory: {
      totalGB: round1(totalMb / 1024),
      freeGB: round1((totalMb - usedMb) / 1024),
      usedPct: percentOf(usedMb, totalMb),
    },
    disks,
    diskActivity,
    network: { connected: adapters > 0, adapters },
    battery,
    uptimeHours: round1(num('uptime_s') / 3600),
  }
}
