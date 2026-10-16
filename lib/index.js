//#endregion
//#region src/collectors/index.ts
/** Every shipped collector, keyed by Node's `process.platform` value. */
const COLLECTORS = { win32: {
	platform: "win32",
	label: "Windows (PowerShell, CIM/WMI)",
	command: String.raw`$ErrorActionPreference = 'Stop'
[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::InvariantCulture

$ci = @{ ErrorAction = 'Stop'; OperationTimeoutSec = 8 }

$cpu = [math]::Round((@(Get-CimInstance Win32_Processor @ci) | Measure-Object LoadPercentage -Average).Average, 0)
$os = Get-CimInstance Win32_OperatingSystem @ci
$totalKb = $os.TotalVisibleMemorySize
$freeKb = $os.FreePhysicalMemory
$adapters = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up')

"computer=$env:COMPUTERNAME"
"cpu=$cpu"
"mem_total_mb=$([math]::Round($totalKb / 1024, 0))"
"mem_used_mb=$([math]::Round(($totalKb - $freeKb) / 1024, 0))"
"uptime_s=$([math]::Round(((Get-Date) - $os.LastBootUpTime).TotalSeconds, 0))"
"net_up=$($adapters.Count)"

$battery = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
if ($battery) { "battery=$($battery.EstimatedChargeRemaining)" }

Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' @ci | ForEach-Object {
  if ($_.Size) {
    "disk=$($_.DeviceID)|$([math]::Round($_.Size / 1GB, 1))|$([math]::Round($_.FreeSpace / 1GB, 1))"
  }
}

# 100 minus PercentIdleTime is chosen over PercentDiskTime on purpose: some
# drivers report the latter several times above 100, while the idle complement
# is the same busy fraction and stays bounded. Queue depth and IOPS are not
# consulted — high IOPS at tiny queue depth is normal and would overstate load.
#
# Property names stay English on a localized Windows, but the _Total rollup
# instance is translated (to _He Ji on zh-CN), so match the leading underscore
# rather than an exact string.
$perfDisks = @()
try { $perfDisks = @(Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk @ci) } catch { $perfDisks = @() }
"disk_instances=$($perfDisks.Count)"

$busiest = $perfDisks | Where-Object { ([string]$_.Name) -like '_*' } | Select-Object -First 1
if (-not $busiest) {
  $busiest = $perfDisks | Where-Object { ([string]$_.Name) -notmatch '^[A-Za-z]:' } | Select-Object -First 1
}

if ($busiest) {
  $idle = [double]$busiest.PercentIdleTime
  $read = [double]$busiest.DiskReadBytesPerSec
  $write = [double]$busiest.DiskWriteBytesPerSec
  "disk_active_pct=$([math]::Round([math]::Max(0, [math]::Min(100, 100 - $idle)), 0))"
  "disk_read_mbs=$([math]::Round($read / 1MB, 2))"
  "disk_write_mbs=$([math]::Round($write / 1MB, 2))"
}`
} };
/**
* Resolve the collector for a platform.
*
* @param platform - a `process.platform` value.
* @returns the collector, or `undefined` when this platform has none. Callers
*          must treat `undefined` as a supported outcome, not as an error.
*/
function selectCollector(platform) {
	return Object.prototype.hasOwnProperty.call(COLLECTORS, platform) ? COLLECTORS[platform] : void 0;
}
//#endregion
//#region src/collectors/format.ts
/** Value split by the collectors for the repeated `disk` key. */
const DISK_SEPARATOR = "|";
/** Facts every collector must emit for a snapshot to be usable. */
const REQUIRED_KEYS = [
	"computer",
	"cpu",
	"mem_total_mb",
	"mem_used_mb",
	"net_up",
	"uptime_s"
];
/** Round to one decimal, mapping non-finite input to 0. */
function round1(value) {
	return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}
/** Round to two decimals, mapping non-finite input to null. */
function round2(value) {
	return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}
/** Whole number 0-100, or 0 when the input is unusable. */
function percentOf(part, whole) {
	if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
	return Math.round(part / whole * 100);
}
/**
* Read a fact that may legitimately be absent into `number | null`.
*
* Disk activity is optional: the Windows collector emits it only when the
* performance-counter provider answers, and the Linux and macOS collectors do
* not emit it at all. Absent must stay distinguishable from zero, so this
* returns `null` rather than coercing to 0.
*/
function optionalNumber(facts, key) {
	const raw = facts.get(key);
	if (raw === void 0 || raw === "") return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}
/** Non-negative integer fact, or 0 when absent or unusable. */
function countOf(facts, key) {
	const value = Number(facts.get(key));
	return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
/** Parse one `disk=name|totalGB|freeGB` value. */
function parseDisk(raw) {
	const parts = raw.split(DISK_SEPARATOR);
	if (parts.length !== 3) return null;
	const name = (parts[0] ?? "").trim();
	const total = Number(parts[1]);
	const free = Number(parts[2]);
	if (!name || !Number.isFinite(total) || !Number.isFinite(free) || total <= 0) return null;
	return {
		name,
		total: round1(total),
		free: round1(free),
		usedPct: percentOf(total - free, total)
	};
}
/**
* Turn collector output into a snapshot.
*
* @param text - raw stdout of a collector command.
* @param now - collection time; injected so tests are deterministic.
* @throws {Error} when a required fact is missing or unparseable.
*/
function parseFacts(text, now = /* @__PURE__ */ new Date()) {
	const facts = /* @__PURE__ */ new Map();
	const disks = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const separator = trimmed.indexOf("=");
		if (separator <= 0) continue;
		const key = trimmed.slice(0, separator).trim();
		const value = trimmed.slice(separator + 1).trim();
		if (key === "disk") {
			const disk = parseDisk(value);
			if (disk) disks.push(disk);
			continue;
		}
		if (!facts.has(key)) facts.set(key, value);
	}
	const missing = REQUIRED_KEYS.filter((key) => !facts.has(key));
	if (missing.length > 0) throw new Error(`collector output is missing: ${missing.join(", ")}`);
	const num = (key) => Number(facts.get(key));
	const totalMb = num("mem_total_mb");
	const usedMb = num("mem_used_mb");
	const adapters = Math.max(0, Math.trunc(num("net_up")));
	const cpu = Math.min(100, Math.max(0, Math.round(num("cpu"))));
	const batteryRaw = facts.get("battery");
	const batteryPercent = batteryRaw === void 0 ? NaN : Number(batteryRaw);
	const battery = Number.isFinite(batteryPercent) ? { percent: Math.min(100, Math.max(0, Math.round(batteryPercent))) } : null;
	const activeRaw = optionalNumber(facts, "disk_active_pct");
	const diskActivity = {
		activePct: activeRaw === null ? null : Math.min(100, Math.max(0, Math.round(activeRaw))),
		readMBs: round2(optionalNumber(facts, "disk_read_mbs") ?? NaN),
		writeMBs: round2(optionalNumber(facts, "disk_write_mbs") ?? NaN),
		instances: countOf(facts, "disk_instances")
	};
	return {
		timestamp: now.toISOString(),
		computer: facts.get("computer") ?? "",
		cpu,
		memory: {
			totalGB: round1(totalMb / 1024),
			freeGB: round1((totalMb - usedMb) / 1024),
			usedPct: percentOf(usedMb, totalMb)
		},
		disks,
		diskActivity,
		network: {
			connected: adapters > 0,
			adapters
		},
		battery,
		uptimeHours: round1(num("uptime_s") / 3600)
	};
}
//#endregion
//#region src/protocol.ts
/** Read-only endpoint the client polls. */
const SNAPSHOT_ROUTE = "/api/windows-monitor/snapshot";
/** Wall-clock ceiling for one collector run. */
const COLLECT_TIMEOUT_MS = 8e3;
/** Upper bound on captured stdout; the fact list is well under a kilobyte. */
const STDOUT_MAX_BYTES = 65536;
/**
* Platforms with a shipped collector.
*
* A host on anything else gets an explicit unsupported-platform answer rather
* than a panel that renders empty gauges, so this list is also the set of
* platforms the plugin claims to work on.
*/
const SUPPORTED_PLATFORMS = ["win32"];
//#endregion
//#region src/index.ts
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
/** Cordis services this plugin cannot start without. */
const inject = [
	"shell",
	"sandboxPolicy",
	"webServer"
];
/** JSON content type used by every response. */
const JSON_HEADERS = {
	"Content-Type": "application/json; charset=utf-8",
	"Cache-Control": "no-store"
};
/** Write a JSON body, honouring HEAD. */
function sendJson(res, status, body, head) {
	res.writeHead(status, JSON_HEADERS);
	res.end(head ? void 0 : JSON.stringify(body));
}
/** Build the snapshot reader bound to one plugin fiber. */
function createReader(ctx, collector) {
	let cached;
	let cachedAt = 0;
	let pending;
	const sandboxPolicy = ctx.sandboxPolicy.resolve({ mode: "danger-full-access" });
	async function collect() {
		const spec = ctx.shell.resolve({
			command: collector.command,
			timeoutMs: COLLECT_TIMEOUT_MS,
			stdoutMaxBytes: STDOUT_MAX_BYTES,
			sandboxPolicy
		});
		const result = await ctx.shell.run(spec);
		if (result.exitCode !== 0) throw new Error(result.stderr.text.trim() || `${collector.label} exited with code ${result.exitCode}`);
		return parseFacts(result.stdout.text);
	}
	return async function snapshot() {
		if (cached !== void 0 && Date.now() - cachedAt < 5e3) return cached;
		pending ??= collect();
		try {
			const fresh = await pending;
			cached = fresh;
			cachedAt = Date.now();
			return fresh;
		} finally {
			pending = void 0;
		}
	};
}
/**
* Mount the snapshot route for the lifetime of this plugin.
*
* @param ctx - the Cordis context slice.
* @param platform - the platform to collect for. Defaults to the running host
*   process, and is injectable so the unsupported-platform path can be
*   exercised on a machine that does have a collector. Cordis always calls this
*   with one argument, so the default is what ships.
*/
function apply(ctx, platform = process.platform) {
	const collector = selectCollector(platform);
	const snapshot = collector === void 0 ? void 0 : createReader(ctx, collector);
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: SNAPSHOT_ROUTE,
		async handler(req, res) {
			if (req.method !== "GET" && req.method !== "HEAD") {
				res.writeHead(405, { Allow: "GET, HEAD" });
				res.end();
				return;
			}
			const head = req.method === "HEAD";
			if (snapshot === void 0) {
				sendJson(res, 501, {
					error: `不支持的平台：${platform}（仅支持 ${SUPPORTED_PLATFORMS.join(" / ")}）`,
					unsupported: true,
					platform
				}, head);
				return;
			}
			try {
				sendJson(res, 200, await snapshot(), head);
			} catch (error) {
				sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }, head);
			}
		}
	}), "windows-monitor: snapshot route");
}
//#endregion
export { apply, inject };
