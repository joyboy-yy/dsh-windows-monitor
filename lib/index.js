//#region src/collectors/linux.ts
/**
* Linux collector: /proc, df and sysfs only.
*
* Deliberately avoids `top`, `free`, `lscpu` and friends: they are not present
* in minimal containers, whereas /proc and /sys always are. Read-only.
*
* NOT verified on a real Linux host by the author — no Linux machine and no WSL
* was available. `.github/workflows/ci.yml` runs it on ubuntu-latest; treat CI
* as the source of truth until that has run.
*
* `${...}` is avoided throughout: these strings are JavaScript template
* literals, where `${` would be interpolated.
*/
const LINUX_SCRIPT = String.raw`# --- CPU: idle/total jiffy delta over a short window ----------------------
read_cpu() { awk '/^cpu /{printf "%d %d\n", $5+$6, $2+$3+$4+$5+$6+$7+$8}' /proc/stat; }
set -- $(read_cpu); idle1=$1; total1=$2
sleep 0.3
set -- $(read_cpu); idle2=$1; total2=$2
dtotal=$((total2 - total1))
didle=$((idle2 - idle1))
if [ "$dtotal" -gt 0 ]; then cpu=$(( (100 * (dtotal - didle)) / dtotal )); else cpu=0; fi

# --- memory ---------------------------------------------------------------
mem_total_kb=$(awk '/^MemTotal:/{print $2}' /proc/meminfo)
mem_avail_kb=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
if [ -z "$mem_avail_kb" ]; then mem_avail_kb=$(awk '/^MemFree:/{print $2}' /proc/meminfo); fi

# --- uptime ---------------------------------------------------------------
uptime_s=$(awk '{printf "%d", $1}' /proc/uptime)

# --- network: interfaces reporting "up", loopback excluded ----------------
net_up=0
for state in /sys/class/net/*/operstate; do
  if [ ! -r "$state" ]; then continue; fi
  case "$state" in */lo/operstate) continue ;; esac
  if [ "$(cat "$state")" = "up" ]; then net_up=$((net_up + 1)); fi
done

echo "computer=$(hostname)"
echo "cpu=$cpu"
echo "mem_total_mb=$((mem_total_kb / 1024))"
echo "mem_used_mb=$(((mem_total_kb - mem_avail_kb) / 1024))"
echo "uptime_s=$uptime_s"
echo "net_up=$net_up"

# --- battery: absent on desktops and most containers ----------------------
for battery in /sys/class/power_supply/BAT*; do
  if [ ! -r "$battery/capacity" ]; then continue; fi
  echo "battery=$(cat "$battery/capacity")"
  break
done

# --- disks: real block devices only; mount points with spaces are truncated
df -kP 2>/dev/null | awk 'NR > 1 && $2 > 0 && $1 ~ /^\/dev\// {printf "disk=%s|%.1f|%.1f\n", $6, $2/1048576, $4/1048576}'`;
//#endregion
//#region src/collectors/macos.ts
/**
* macOS collector: top, vm_stat, df, sysctl and pmset.
*
* Memory follows Activity Monitor's definition of "Memory Used"
* (active + wired + compressed pages), so the number matches what the user
* sees in the OS's own tool rather than an optimistic "available" figure.
*
* NOT verified on a real Mac by the author — no macOS machine was available.
* `.github/workflows/ci.yml` runs it on macos-latest; treat CI as the source of
* truth until that has run.
*
* `${...}` is avoided throughout: these strings are JavaScript template
* literals, where `${` would be interpolated.
*/
const MACOS_SCRIPT = String.raw`# --- CPU: second sample of top; the first is since-boot -------------------
cpu=$(top -l 2 -n 0 -s 1 | awk '/CPU usage/{u=$3; s=$5} END{gsub(/%/,"",u); gsub(/%/,"",s); printf "%d", u+s}')
if [ -z "$cpu" ]; then cpu=0; fi

# --- memory: Activity Monitor's "Memory Used" ------------------------------
page_size=$(sysctl -n hw.pagesize)
mem_bytes=$(sysctl -n hw.memsize)
vm=$(vm_stat)
pages() { printf '%s\n' "$vm" | sed -n "s/^$1: *\([0-9][0-9]*\)[.]*.*/\1/p"; }
active=$(pages 'Pages active')
wired=$(pages 'Pages wired down')
compressed=$(pages 'Pages occupied by compressor')
if [ -z "$active" ]; then active=0; fi
if [ -z "$wired" ]; then wired=0; fi
if [ -z "$compressed" ]; then compressed=0; fi
mem_total_mb=$((mem_bytes / 1048576))
mem_used_mb=$(( (active + wired + compressed) * page_size / 1048576 ))

# --- uptime ----------------------------------------------------------------
boot=$(sysctl -n kern.boottime | awk -F'[ ,]+' '{print $4}')
if [ -z "$boot" ]; then boot=0; fi
uptime_s=$(( $(date +%s) - boot ))

# --- network: active, non-loopback interfaces ------------------------------
net_up=$(ifconfig -a | awk '/^[a-z0-9]+:/{ifc=substr($1,1,length($1)-1)} /status: active/{if (ifc !~ /^lo/) c++} END{print c+0}')

echo "computer=$(hostname)"
echo "cpu=$cpu"
echo "mem_total_mb=$mem_total_mb"
echo "mem_used_mb=$mem_used_mb"
echo "uptime_s=$uptime_s"
echo "net_up=$net_up"

# --- battery: absent on desktops ------------------------------------------
percent=$(pmset -g batt 2>/dev/null | sed -n 's/.*[^0-9]\([0-9][0-9]*\)%.*/\1/p' | head -n 1)
if [ -n "$percent" ]; then echo "battery=$percent"; fi

# --- disks: real block devices only; mount points with spaces are truncated
df -kP 2>/dev/null | awk 'NR > 1 && $2 > 0 && $1 ~ /^\/dev\// {printf "disk=%s|%.1f|%.1f\n", $6, $2/1048576, $4/1048576}'`;
//#endregion
//#region src/collectors/index.ts
/** Every shipped collector, keyed by Node's `process.platform` value. */
const COLLECTORS = {
	win32: {
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
	},
	linux: {
		platform: "linux",
		label: "Linux (/proc, sysfs, df)",
		command: LINUX_SCRIPT
	},
	darwin: {
		platform: "darwin",
		label: "macOS (top, vm_stat, pmset, df)",
		command: MACOS_SCRIPT
	}
};
/**
* Resolve the collector for a platform.
*
* @param platform - a `process.platform` value.
* @returns the collector, or `undefined` when this platform has none.
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
/** Platforms with a shipped collector. */
const SUPPORTED_PLATFORMS = [
	"win32",
	"linux",
	"darwin"
];
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
/** Mount the snapshot route for the lifetime of this plugin. */
function apply(ctx) {
	const platform = process.platform;
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
