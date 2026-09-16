/**
 * Collector contract tests.
 *
 * The guard test runs everywhere. The integration test runs the collector for
 * the machine it is on, which is how the Linux and macOS scripts get verified:
 * `.github/workflows/ci.yml` runs this suite on ubuntu-latest, macos-latest and
 * windows-latest, so each script is exercised on its own platform even though
 * no single developer has all three.
 */

import { execFile } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import { COLLECTORS, selectCollector } from '../src/collectors/index.js'
import { parseFacts } from '../src/collectors/format.js'

const collector = selectCollector(process.platform)

/** Run one collector command through the shell a real host would use. */
function runCommand(command: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const isWindows = process.platform === 'win32'
  const file = isWindows ? 'powershell.exe' : 'bash'
  const args = isWindows ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command]

  return new Promise((resolve) => {
    execFile(file, args, { timeout: 55_000, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
      resolve({ code: error ? 1 : 0, stdout, stderr })
    })
  })
}

describe('collector scripts', () => {
  it('never contain template-literal interpolation', () => {
    // The scripts are JavaScript template literals: a literal `${` would be
    // interpolated at build time and silently corrupt the shell script.
    for (const entry of Object.values(COLLECTORS)) {
      expect(entry.command, entry.label).not.toContain('${')
    }
  })

  it('ship a collector for each supported platform', () => {
    expect(Object.keys(COLLECTORS).sort()).toEqual(['darwin', 'linux', 'win32'])
  })

  it('resolve to undefined for a platform without a collector', () => {
    expect(selectCollector('freebsd')).toBeUndefined()
    expect(selectCollector('aix')).toBeUndefined()
  })
})

describe.skipIf(collector === undefined)('current platform collector', () => {
  it(`produces a parseable snapshot on ${process.platform}`, async () => {
    const command = collector?.command
    expect(command).toBeTypeOf('string')

    const result = await runCommand(command ?? '')

    // `DEBUG_COLLECTOR=1 pnpm run test` prints the raw facts, which is what a
    // report about an unverified platform needs to be actionable.
    if (process.env.DEBUG_COLLECTOR) {
      console.log(
        `\n--- ${collector?.label ?? process.platform} exit=${result.code} ---\n` +
          `${result.stdout}\n--- stderr ---\n${result.stderr}--- end ---\n`,
      )
    }

    expect(result.stderr, 'collector wrote to stderr').toBeTypeOf('string')
    expect(result.code, `collector exited non-zero.\nstderr:\n${result.stderr}`).toBe(0)

    const snapshot = parseFacts(result.stdout)

    expect(snapshot.computer.length).toBeGreaterThan(0)
    expect(snapshot.cpu).toBeGreaterThanOrEqual(0)
    expect(snapshot.cpu).toBeLessThanOrEqual(100)
    expect(snapshot.memory.totalGB).toBeGreaterThan(0)
    expect(snapshot.memory.usedPct).toBeGreaterThanOrEqual(0)
    expect(snapshot.memory.usedPct).toBeLessThanOrEqual(100)
    expect(snapshot.uptimeHours).toBeGreaterThan(0)
    expect(snapshot.network.adapters).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(snapshot.disks)).toBe(true)

    // Every reported volume must be internally consistent, or the panel would
    // render a bar that contradicts its own numbers.
    for (const disk of snapshot.disks) {
      expect(disk.total).toBeGreaterThan(0)
      expect(disk.free).toBeGreaterThanOrEqual(0)
      expect(disk.usedPct).toBeGreaterThanOrEqual(0)
      expect(disk.usedPct).toBeLessThanOrEqual(100)
    }

    // Disk activity is best-effort, so both outcomes are legitimate: a bounded
    // reading, or no reading at all. What is never legitimate is a fabricated
    // value, so the assertions only apply once something was actually read.
    const activity = snapshot.diskActivity.activePct
    if (activity !== null) {
      expect(activity).toBeGreaterThanOrEqual(0)
      expect(activity).toBeLessThanOrEqual(100)
      expect(snapshot.diskActivity.instances).toBeGreaterThan(0)
      expect(snapshot.diskActivity.readMBs).not.toBeNull()
      expect(snapshot.diskActivity.writeMBs).not.toBeNull()
    }
  })
})
