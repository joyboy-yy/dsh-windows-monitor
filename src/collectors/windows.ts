/**
 * Windows collector: PowerShell + CIM/WMI.
 *
 * Verified on Windows 11. Read-only: CIM queries plus `Get-NetAdapter`. The
 * script never writes, installs, or changes machine state.
 *
 * Three details are deliberate rather than incidental:
 *
 *   * `OperationTimeoutSec` (not `TimeoutSec`) bounds a wedged WMI provider, so
 *     one unresponsive namespace cannot eat the host's whole wall-clock budget
 *     and turn a slow reading into a failed one.
 *   * The culture is pinned to invariant before any number is formatted. The
 *     fact format is `key=value` with `.` as the decimal separator, so a host
 *     running a comma-decimal locale would otherwise emit
 *     `disk=C:|263,0|31,6` and be silently unparseable.
 *   * Disk activity is collected best-effort. A host without the performance
 *     counter provider must still yield a usable snapshot, so every failure
 *     inside that block degrades to "unknown" instead of aborting.
 */
export const WINDOWS_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
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
