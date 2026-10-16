/**
 * Wire contract between the platform collectors and the panel.
 *
 * The collector on each platform is a single shell command that prints one
 * `key=value` line per fact. A line format — rather than JSON — is deliberate:
 * emitting correct JSON from bash and PowerShell without assuming `jq` is a
 * portability trap, while `key=value` is trivial to produce everywhere and
 * trivial to parse (and unit-test) on the TypeScript side.
 *
 * The host turns those facts into {@link Snapshot}, which is the shape the
 * client renders. The timestamp is stamped host-side so no platform has to
 * agree on date formatting.
 */

/** Per-volume reading. */
export interface DiskSnapshot {
  /** Drive letter on Windows, mount point elsewhere. */
  name: string
  /** Capacity in GB. */
  total: number
  /** Free space in GB. */
  free: number
  /** Used share, 0-100, rounded. */
  usedPct: number
}

/**
 * Disk busy time and throughput for the collection interval.
 *
 * Deliberately separate from {@link DiskSnapshot}. Capacity answers "how full
 * is this volume" and barely moves in an hour; activity answers "is the disk
 * working right now" and changes every second. Rendering one as the other is
 * what makes a storage gauge look stuck next to a live CPU reading.
 *
 * Every field is nullable because the reading is best-effort: it needs the
 * Windows performance-counter provider, which a host may have disabled or not
 * have at all. `null` means unknown, which the panel renders as `--` rather
 * than `0%` — a zero would be a claim about an idle disk that nothing actually
 * measured.
 */
export interface DiskActivitySnapshot {
  /** Share of the interval spent servicing requests, 0-100, or `null`. */
  activePct: number | null
  /** Read throughput in MB/s, or `null`. */
  readMBs: number | null
  /** Write throughput in MB/s, or `null`. */
  writeMBs: number | null
  /** Physical disk instances the provider reported; 0 when unavailable. */
  instances: number
}

/** Physical memory reading. */
export interface MemorySnapshot {
  totalGB: number
  freeGB: number
  usedPct: number
}

/** Connected-adapter summary. */
export interface NetworkSnapshot {
  connected: boolean
  adapters: number
}

/** Battery reading, absent on machines without one. */
export interface BatterySnapshot {
  percent: number
}

/** The JSON document served by the snapshot route. */
export interface Snapshot {
  /** ISO-8601 collection time, stamped by the host. */
  timestamp: string
  /** Host name. */
  computer: string
  /** Processor load, 0-100. */
  cpu: number
  memory: MemorySnapshot
  disks: DiskSnapshot[]
  /** Busy time and throughput; every field `null` when unavailable. */
  diskActivity: DiskActivitySnapshot
  network: NetworkSnapshot
  battery: BatterySnapshot | null
  /** Hours since last boot. */
  uptimeHours: number
}

/** Error body of the snapshot route. */
export interface SnapshotError {
  /** Human-readable reason, shown verbatim by the panel. */
  error: string
  /** Present when this platform has no collector at all. */
  unsupported?: true
  /** The platform that had no collector. */
  platform?: string
}

/** Read-only endpoint the client polls. */
export const SNAPSHOT_ROUTE = '/api/windows-monitor/snapshot'

/** How long a collected snapshot stays fresh. */
export const CACHE_TTL_MS = 5_000

/** Wall-clock ceiling for one collector run. */
export const COLLECT_TIMEOUT_MS = 8_000

/** Upper bound on captured stdout; the fact list is well under a kilobyte. */
export const STDOUT_MAX_BYTES = 65_536

/**
 * Platforms with a shipped collector.
 *
 * A host on anything else gets an explicit unsupported-platform answer rather
 * than a panel that renders empty gauges, so this list is also the set of
 * platforms the plugin claims to work on.
 */
export const SUPPORTED_PLATFORMS = ['win32'] as const

/** One of {@link SUPPORTED_PLATFORMS}. */
export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number]
