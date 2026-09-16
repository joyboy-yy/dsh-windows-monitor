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
export const LINUX_SCRIPT = String.raw`# --- CPU: idle/total jiffy delta over a short window ----------------------
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
df -kP 2>/dev/null | awk 'NR > 1 && $2 > 0 && $1 ~ /^\/dev\// {printf "disk=%s|%.1f|%.1f\n", $6, $2/1048576, $4/1048576}'`
