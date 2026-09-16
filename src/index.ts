/**
 * Host half: the read-only snapshot endpoint.
 *
 * Serves one cached reading from the collector for the platform this host
 * process actually runs on. The platform is read from `process.platform`, never
 * from the request, so a browser cannot ask the host to run a command meant for
 * a different OS.
 *
 * Nothing here touches the model, the session, or the transcript.
 */

import { selectCollector, type Collector } from './collectors/index.js'
import { parseFacts } from './collectors/format.js'
import type { HttpResponseLike, PluginContext, ResolvedSandboxPolicy } from './harness.js'
import {
  CACHE_TTL_MS,
  COLLECT_TIMEOUT_MS,
  SNAPSHOT_ROUTE,
  STDOUT_MAX_BYTES,
  SUPPORTED_PLATFORMS,
  type Snapshot,
  type SnapshotError,
} from './protocol.js'

/** Cordis services this plugin cannot start without. */
export const inject = ['shell', 'sandboxPolicy', 'webServer'] as const

/** JSON content type used by every response. */
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } as const

/** Write a JSON body, honouring HEAD. */
function sendJson(res: HttpResponseLike, status: number, body: unknown, head: boolean): void {
  res.writeHead(status, JSON_HEADERS)
  res.end(head ? undefined : JSON.stringify(body))
}

/** Build the snapshot reader bound to one plugin fiber. */
function createReader(ctx: PluginContext, collector: Collector): () => Promise<Snapshot> {
  let cached: Snapshot | undefined
  let cachedAt = 0
  let pending: Promise<Snapshot> | undefined

  // The collectors only read machine state, but a shell has to be free to load
  // its own modules and write its own temp files, which the narrower sandbox
  // modes block.
  const sandboxPolicy: ResolvedSandboxPolicy = ctx.sandboxPolicy.resolve({ mode: 'danger-full-access' })

  async function collect(): Promise<Snapshot> {
    const spec = ctx.shell.resolve({
      command: collector.command,
      timeoutMs: COLLECT_TIMEOUT_MS,
      stdoutMaxBytes: STDOUT_MAX_BYTES,
      sandboxPolicy,
    })
    const result = await ctx.shell.run(spec)
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.text.trim() || `${collector.label} exited with code ${result.exitCode}`)
    }
    return parseFacts(result.stdout.text)
  }

  return async function snapshot(): Promise<Snapshot> {
    const now = Date.now()
    if (cached !== undefined && now - cachedAt < CACHE_TTL_MS) return cached

    // Concurrent polls share one collector run instead of racing.
    pending ??= collect()
    try {
      const fresh = await pending
      cached = fresh
      cachedAt = Date.now()
      return fresh
    } finally {
      pending = undefined
    }
  }
}

/** Mount the snapshot route for the lifetime of this plugin. */
export function apply(ctx: PluginContext): void {
  const platform = process.platform
  const collector = selectCollector(platform)
  const snapshot = collector === undefined ? undefined : createReader(ctx, collector)

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: SNAPSHOT_ROUTE,
        async handler(req, res: HttpResponseLike) {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { Allow: 'GET, HEAD' })
            res.end()
            return
          }
          const head = req.method === 'HEAD'

          if (snapshot === undefined) {
            // Answered before any command runs: this platform has no collector.
            const body: SnapshotError = {
              error: `不支持的平台：${platform}（仅支持 ${SUPPORTED_PLATFORMS.join(' / ')}）`,
              unsupported: true,
              platform,
            }
            sendJson(res, 501, body, head)
            return
          }

          try {
            sendJson(res, 200, await snapshot(), head)
          } catch (error) {
            const body: SnapshotError = {
              error: error instanceof Error ? error.message : String(error),
            }
            sendJson(res, 500, body, head)
          }
        },
      }),
    'windows-monitor: snapshot route',
  )
}
