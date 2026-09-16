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
export const MACOS_SCRIPT = String.raw`# --- CPU: second sample of top; the first is since-boot -------------------
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
df -kP 2>/dev/null | awk 'NR > 1 && $2 > 0 && $1 ~ /^\/dev\// {printf "disk=%s|%.1f|%.1f\n", $6, $2/1048576, $4/1048576}'`
