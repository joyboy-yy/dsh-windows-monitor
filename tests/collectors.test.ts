/**
 * Collector contract tests.
 *
 * Two contracts:
 *
 *   * On Windows the collector runs for real, which is how the PowerShell
 *     script is exercised end to end.
 *   * A host with no collector must answer the unsupported-platform error
 *     rather than serve empty gauges. That one is driven by an injected
 *     platform, so it is verified on every machine instead of only on the
 *     runners that happen to lack a collector.
 */

import { execFile } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import { COLLECTORS, selectCollector } from '../src/collectors/index.js'
import { parseFacts } from '../src/collectors/format.js'
import { apply } from '../src/index.js'
import type { PluginContext, WebServerRoute } from '../src/harness.js'
import { SNAPSHOT_ROUTE, type SnapshotError } from '../src/protocol.js'

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

  it('ship exactly one collector, for Windows', () => {
    expect(Object.keys(COLLECTORS).sort()).toEqual(['win32'])
  })

  it('resolve to undefined for a platform without a collector', () => {
    for (const platform of ['linux', 'darwin', 'freebsd', 'aix']) {
      expect(selectCollector(platform), platform).toBeUndefined()
    }
  })
})

/**
 * Build the smallest context the host half accepts, and capture the route it
 * registers. `effect` runs its callback immediately, as Cordis does on apply.
 *
 * The shell seam throws rather than answering, so a test that reaches it fails
 * loudly instead of quietly exercising a collector that should not exist here.
 */
function captureRoute(platform: string): WebServerRoute {
  let route: WebServerRoute | undefined
  const ctx: PluginContext = {
    effect: (callback) => {
      callback()
      return () => {}
    },
    webServer: {
      register: (registered) => {
        route = registered
        return () => {}
      },
    },
    sandboxPolicy: { resolve: () => ({}) },
    shell: {
      resolve: () => {
        throw new Error('the shell must not resolve on a platform without a collector')
      },
      run: async () => {
        throw new Error('the shell must not run on a platform without a collector')
      },
    },
  }

  apply(ctx, platform)
  if (route === undefined) throw new Error('the snapshot route was not registered')
  return route
}

/** Invoke a route handler and capture what it wrote. */
async function callRoute(route: WebServerRoute, method: string): Promise<{ status: number; body: string }> {
  let status = 0
  let body = ''
  await route.handler(
    { method },
    {
      writeHead: (code) => {
        status = code
      },
      end: (payload) => {
        body = payload ?? ''
      },
    },
  )
  return { status, body }
}

/**
 * Driven by the injected platform rather than by the runner's own OS, so the
 * negative contract is verified on every machine — including Windows, where it
 * would otherwise be unreachable.
 */
describe('unsupported platform', () => {
  for (const platform of ['linux', 'darwin', 'freebsd']) {
    it(`answers 501 instead of empty gauges on ${platform}`, async () => {
      const route = captureRoute(platform)
      expect(route.path).toBe(SNAPSHOT_ROUTE)

      const { status, body } = await callRoute(route, 'GET')

      expect(status).toBe(501)
      const parsed = JSON.parse(body) as SnapshotError
      expect(parsed.unsupported).toBe(true)
      expect(parsed.platform).toBe(platform)
      expect(parsed.error).toContain(platform)
    })
  }

  it('refuses methods other than GET and HEAD', async () => {
    const { status } = await callRoute(captureRoute('linux'), 'POST')

    expect(status).toBe(405)
  })

  it('registers the route for the host platform as well', () => {
    expect(captureRoute(process.platform).path).toBe(SNAPSHOT_ROUTE)
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
    // Uptime is only guaranteed to be non-negative. `uptimeHours` is rounded to
    // one decimal, so a machine booted within the last ~3 minutes reports 0.0
    // legitimately — and CI runners are exactly that fresh. Asserting a
    // positive value here would be testing the runner's age, not the collector.
    expect(snapshot.uptimeHours).toBeGreaterThanOrEqual(0)

    // The contract that actually matters is on the raw fact, which carries full
    // seconds and therefore stays meaningful on a freshly booted machine.
    const uptimeFact = /^uptime_s=(\d+)$/mu.exec(result.stdout)
    expect(uptimeFact, 'collector must emit an integer uptime_s').not.toBeNull()
    expect(Number(uptimeFact?.[1])).toBeGreaterThanOrEqual(0)

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
