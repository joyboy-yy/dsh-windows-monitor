/**
 * Collector selection.
 *
 * The platform is read from the running host process, never from the client, so
 * a browser cannot ask the host to run a command meant for another OS.
 *
 * Only Windows ships a collector. That is a deliberate scope decision rather
 * than an unfinished one: the plugin is named for Windows, its headline reading
 * (disk activity) comes from a Windows performance counter, and a collector the
 * maintainer cannot run is a collector whose bugs they cannot reproduce. Hosts
 * on any other platform are told so explicitly instead of being handed a
 * degraded panel — see the unsupported-platform answer in `src/index.ts`.
 */

import type { SupportedPlatform } from '../protocol.js'
import { WINDOWS_SCRIPT } from './windows.js'

/** One platform's collector. */
export interface Collector {
  platform: SupportedPlatform
  /** Human label used in diagnostics. */
  label: string
  /** Single shell command whose stdout is the shared fact list. */
  command: string
}

/** Every shipped collector, keyed by Node's `process.platform` value. */
export const COLLECTORS: Readonly<Record<SupportedPlatform, Collector>> = {
  win32: { platform: 'win32', label: 'Windows (PowerShell, CIM/WMI)', command: WINDOWS_SCRIPT },
}

/**
 * Resolve the collector for a platform.
 *
 * @param platform - a `process.platform` value.
 * @returns the collector, or `undefined` when this platform has none. Callers
 *          must treat `undefined` as a supported outcome, not as an error.
 */
export function selectCollector(platform: string): Collector | undefined {
  return Object.prototype.hasOwnProperty.call(COLLECTORS, platform)
    ? COLLECTORS[platform as SupportedPlatform]
    : undefined
}
