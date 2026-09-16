/**
 * Parser tests for the shared fact format.
 *
 * These are pure: they feed the parser recorded-looking text and assert the
 * resulting snapshot, so the wire contract is pinned down without needing any
 * particular machine.
 */

import { describe, expect, it } from 'vitest'

import { parseFacts } from '../src/collectors/format.js'

/** A complete fact list, in the shape every collector emits. */
const FULL = [
  'computer=DEVBOX',
  'cpu=13',
  'mem_total_mb=32418',
  'mem_used_mb=23940',
  'uptime_s=44640',
  'net_up=3',
  'battery=76',
  'disk=C:|263.0|31.6',
  'disk=D:|1000.0|412.8',
  'disk_instances=3',
  'disk_active_pct=41',
  'disk_read_mbs=12.34',
  'disk_write_mbs=0.5',
].join('\n')

/** Fixed clock so timestamps are deterministic. */
const NOW = new Date('2026-01-02T03:04:05.000Z')

describe('parseFacts', () => {
  it('converts a complete fact list into a snapshot', () => {
    const snapshot = parseFacts(FULL, NOW)

    expect(snapshot.timestamp).toBe(NOW.toISOString())
    expect(snapshot.computer).toBe('DEVBOX')
    expect(snapshot.cpu).toBe(13)
    expect(snapshot.memory).toEqual({ totalGB: 31.7, freeGB: 8.3, usedPct: 74 })
    expect(snapshot.network).toEqual({ connected: true, adapters: 3 })
    expect(snapshot.battery).toEqual({ percent: 76 })
    expect(snapshot.uptimeHours).toBe(12.4)
  })

  it('computes per-disk usage from capacity and free space', () => {
    const snapshot = parseFacts(FULL, NOW)

    expect(snapshot.disks).toEqual([
      { name: 'C:', total: 263, free: 31.6, usedPct: 88 },
      { name: 'D:', total: 1000, free: 412.8, usedPct: 59 },
    ])
  })

  it('keeps disk activity separate from disk capacity', () => {
    const snapshot = parseFacts(FULL, NOW)

    // Busy time travels on its own field: capacity stays on the volumes, and
    // neither is derived from the other.
    expect(snapshot.diskActivity).toEqual({
      activePct: 41,
      readMBs: 12.34,
      writeMBs: 0.5,
      instances: 3,
    })
  })

  it('reports absent disk activity as unknown, never as zero', () => {
    // The Linux and macOS collectors report no activity at all, and a Windows
    // host without the perf provider reports none either. Both must stay
    // distinguishable from a genuinely idle disk.
    const text = FULL.split('\n')
      .filter((line) => !line.startsWith('disk_'))
      .join('\n')

    expect(parseFacts(text, NOW).diskActivity).toEqual({
      activePct: null,
      readMBs: null,
      writeMBs: null,
      instances: 0,
    })
  })

  it('clamps an out-of-range activity reading', () => {
    expect(parseFacts(FULL.replace('disk_active_pct=41', 'disk_active_pct=250'), NOW).diskActivity.activePct).toBe(100)
    expect(parseFacts(FULL.replace('disk_active_pct=41', 'disk_active_pct=-3'), NOW).diskActivity.activePct).toBe(0)
  })

  it('degrades an unparseable activity reading to unknown', () => {
    const snapshot = parseFacts(FULL.replace('disk_active_pct=41', 'disk_active_pct=n/a'), NOW)

    expect(snapshot.diskActivity.activePct).toBeNull()
  })

  it('reports no battery when the key is absent', () => {
    const snapshot = parseFacts(FULL.replace('battery=76\n', ''), NOW)

    expect(snapshot.battery).toBeNull()
  })

  it('reports a disconnected network when no adapter is up', () => {
    const snapshot = parseFacts(FULL.replace('net_up=3', 'net_up=0'), NOW)

    expect(snapshot.network).toEqual({ connected: false, adapters: 0 })
  })

  it('names every missing required fact', () => {
    expect(() => parseFacts('computer=HOST\ncpu=5', NOW)).toThrowError(
      /mem_total_mb, mem_used_mb, net_up, uptime_s/,
    )
  })

  it('tolerates blank lines, comments and unknown keys', () => {
    const text = `# collected by something\n\n${FULL}\nfuture_key=whatever\n\n`
    const snapshot = parseFacts(text, NOW)

    expect(snapshot.cpu).toBe(13)
    expect(snapshot.disks).toHaveLength(2)
  })

  it('keeps the first value when a key repeats', () => {
    const text = `${FULL}\ncpu=99\n`

    expect(parseFacts(text, NOW).cpu).toBe(13)
  })

  it('splits values on the first separator only', () => {
    const snapshot = parseFacts(FULL.replace('computer=DEVBOX', 'computer=a=b'), NOW)

    expect(snapshot.computer).toBe('a=b')
  })

  it('drops malformed disk lines without failing the snapshot', () => {
    const text = `${FULL}\ndisk=broken\ndisk=E:|notanumber|1\ndisk=F:|0|0\n`

    expect(parseFacts(text, NOW).disks.map((disk) => disk.name)).toEqual(['C:', 'D:'])
  })

  it('clamps an out-of-range cpu reading', () => {
    expect(parseFacts(FULL.replace('cpu=13', 'cpu=420'), NOW).cpu).toBe(100)
    expect(parseFacts(FULL.replace('cpu=13', 'cpu=-9'), NOW).cpu).toBe(0)
  })

  it('survives a machine with no disks reported', () => {
    const text = FULL.split('\n')
      .filter((line) => !line.startsWith('disk='))
      .join('\n')

    expect(parseFacts(text, NOW).disks).toEqual([])
  })
})
