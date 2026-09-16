/**
 * Collector selection.
 *
 * The platform is read from the running host process, never from the client, so
 * a browser cannot ask the host to run a command meant for another OS.
 */

import type { SupportedPlatform } from '../protocol.js'
import { LINUX_SCRIPT } from './linux.js'
import { MACOS_SCRIPT } from './macos.js'
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
  linux: { platform: 'linux', label: 'Linux (/proc, sysfs, df)', command: LINUX_SCRIPT },
  darwin: { platform: 'darwin', label: 'macOS (top, vm_stat, pmset, df)', command: MACOS_SCRIPT },
}

/**
 * Resolve the collector for a platform.
 *
 * @param platform - a `process.platform` value.
 * @returns the collector, or `undefined` when this platform has none.
 */
export function selectCollector(platform: string): Collector | undefined {
  return Object.prototype.hasOwnProperty.call(COLLECTORS, platform)
    ? COLLECTORS[platform as SupportedPlatform]
    : undefined
}
