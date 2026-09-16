# dsh-windows-monitor

English | [简体中文](README.zh.md)

[![CI](https://github.com/joyboy-yy/dsh-windows-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/joyboy-yy/dsh-windows-monitor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A system monitor overlay for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): a compact pill in the bottom-right corner showing live CPU and memory, expanding into a detail card with disk activity and throughput, per-volume capacity, network state, uptime and battery.

Runs on **Windows, Linux and macOS**.

![Collapsed and expanded states](docs/preview.png)

## Features

- **Never covers the middle.** Collapsed it is a ~210 px pill; expanded it is a 280 px card. It sits clear of the composer by default.
- **Draggable.** Drag the pill or the card header anywhere; the position is clamped to the viewport and remembered. A reset control returns it to the corner.
- **Live at a glance.** The status dot is colour-coded — green nominal, amber elevated, pulsing red for collection failure.
- **Detail on demand.** CPU, memory and **disk activity** as bars, plus one row per volume, a memory total, adapter state, uptime and battery.
- **Capacity and activity are never conflated.** The 磁盘 gauge is *busy time* — the same figure as Task Manager's own 磁盘 column, computed as `100 − PercentIdleTime`. Fullness is a separate per-volume row. A static "93% full" number sitting next to a live CPU reading reads as a stuck or broken dial, so it is never what the gauge shows.
- **Unknown is a real state.** Disk activity is best-effort: with no performance-counter provider, or before the first sample, the panel renders `--` rather than `0%`. A zero would be a claim about an idle disk that nothing actually measured.
- **Honest failure states.** A failed collection shows "unavailable" in the pill instead of stale numbers; a platform with no collector says so explicitly rather than looking broken.
- **Theme-native.** Every colour is a DSH theme token, so light and dark mode follow the app. Icons are inline SVG from the harness's own icon set — no icon fonts.
- **Accessible.** Real buttons with labels, visible focus rings, and animations disabled under `prefers-reduced-motion`.

## Requirements

- DeepSeek Harness with the **Web** profile and the current profile-bundle system.
- Node.js `^22.19.0 || >=24.0.0` (to build from source).
- One of the supported platforms below.

No administrator rights are needed, and nothing is installed system-wide.

## Platform support

One collector per platform, each a single read-only shell command. The host picks one from `process.platform`, never from the request.

| Platform | Sources | Verification |
|---|---|---|
| **Windows** | PowerShell + CIM/WMI (`Win32_Processor`, `Win32_OperatingSystem`, `Win32_LogicalDisk`, `Win32_Battery`, `Win32_PerfFormattedData_PerfDisk_PhysicalDisk`) and `Get-NetAdapter` | Verified by the author on Windows 11, including disk activity |
| **Linux** | `/proc/stat`, `/proc/meminfo`, `/proc/uptime`, `/sys/class/net/*/operstate`, `/sys/class/power_supply/BAT*`, `df -kP` | **Not verified on real hardware by the author** — no Linux machine was available. CI runs it on `ubuntu-latest` |
| **macOS** | `top`, `vm_stat` + `sysctl`, `ifconfig`, `df -kP`, `pmset -g batt` | **Not verified on real hardware by the author** — no Mac was available. CI runs it on `macos-latest` |

Any other platform gets an explicit unsupported-platform answer on the route, rendered by the panel — the plugin never pretends to work where it cannot.

CI is the source of truth for Linux and macOS. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — the matrix runs the suite on all three runners, and the collector integration test executes the script for whichever platform it is on.

Known collector limitations:

- **Disk activity is Windows-only.** The Linux and macOS collectors report it as unknown, and the panel shows `--`. Contributions adding `/proc/diskstats` or `iostat` support are welcome.
- Disk activity needs the Windows performance-counter provider. On a host where it is disabled or missing, the reading degrades to `--` instead of failing the snapshot.
- Mount points containing spaces are truncated by `df` parsing on Linux and macOS.
- Linux `operstate` reports `unknown` for some virtual interfaces that are in fact up, so the adapter count can undercount.
- macOS memory follows Activity Monitor's "Memory Used" (active + wired + compressed), not an optimistic "available" figure.
- The collectors pin the process culture to invariant. The fact format is `key=value` with `.` as the decimal separator, so a comma-decimal locale would otherwise emit unparseable numbers.

## Install

From a local checkout — this is the path to use while developing:

```powershell
dsh plugin --profile web add D:\path\to\dsh-windows-monitor
dsh --profile web --dump-config   # confirm the windows-monitor row is composed
dsh --profile web
```

From a release tarball (prebuilt, no build permission needed):

```powershell
dsh plugin --profile web add .\dsh-windows-monitor-0.1.0.tgz
```

From a pinned source tag:

```powershell
dsh plugin --profile web add github:joyboy-yy/dsh-windows-monitor#v0.1.0
```

A git install fetches source and runs this package's `prepare` build, which means package code executes on your machine outside the agent sandbox. pnpm refuses that until the profile's `pnpm-workspace.yaml` explicitly allows it:

```yaml
allowBuilds:
  dsh-windows-monitor: true
```

Read the source and pin a tag before granting that. A release tarball ships prebuilt files and needs no such permission.

## Configuration

This bundle inserts one Host/Client row, declared in [`cordis.patch.yml`](cordis.patch.yml):

```yaml
- insert:
    - id: windows-monitor
      name: dsh-windows-monitor
      inject: [shell, sandboxPolicy, webServer]
```

Override that row in your profile or home `cordis.patch.yml` to disable it or change its position in the tree.

Browser-local preferences are limited to one value: the dragged panel position, stored under the `dsh-windows-monitor:position` `localStorage` key. It is written only when you drag the panel and removed when you press reset. The plugin stores no metrics.

## How it works

The **Host half** registers one read-only route and runs the collector for its own platform through the harness `shell` service:

```
GET /api/windows-monitor/snapshot
```

The collector prints one `key=value` fact per line. A line format — rather than JSON — is deliberate: emitting correct JSON from bash and PowerShell without assuming `jq` is a portability trap, whereas `key=value` is trivial to produce everywhere and trivial to parse (and unit-test) on the TypeScript side. The host converts facts into the snapshot the client renders and stamps the timestamp itself, so no two platforms have to agree on date formatting.

Results are cached for 5 seconds, and concurrent polls share a single in-flight collection instead of racing, so the browser's polling never multiplies collector runs.

The **Client half** registers into the frame-wide `shell.overlay` slot. That layer is click-through by design — the panel opts into pointer events, so it never blocks the app underneath.

Neither half touches the model, the session, or the transcript. The plugin registers no tools.

## Security model

Read this before installing.

- **Every collector is read-only.** They read `/proc`, `/sys`, CIM/WMI and run `df`/`top`/`vm_stat`/`pmset`. Nothing writes, installs, or changes machine state.
- **The sandbox grant is broad.** The Host half resolves the `danger-full-access` sandbox policy so the shell can run. The commands are read-only, but the policy is not — it is the main thing to review, and it lives in `src/index.ts` and `src/collectors/`.
- **The command is chosen by the host, not the browser.** The platform comes from `process.platform`; a request cannot select a different collector.
- **The payload carries no personal data.** It contains the host name, CPU percentage, memory totals and usage, per-volume capacity and usage, disk busy time and read/write throughput, a connected-adapter count, uptime hours, and battery percentage when a battery exists. No file contents, no usernames, no paths, no credentials, and no per-process or per-file disk attribution.
- **No network egress.** The plugin makes no outbound requests. Its only HTTP surface is the local route served by the harness on your machine.
- **No secret material.** The plugin never reads credentials.
- **Cache-Control: no-store** on every response.
- **One localStorage key**, holding only the panel position.

## Development

```powershell
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

`pnpm run test` runs the parser suite everywhere plus the collector integration test for the current platform, so running it locally only exercises your own OS. Run it on all three through CI.

`pnpm run build` produces `lib/index.js` + `lib/index.d.ts` (Host, ESM) and `lib/client.js` + `lib/client.js.map` (Client, wrapped in the `window.__ModuleLoader__` envelope the harness expects).

`lib/` is committed on purpose: the harness activates a plugin by reading `lib/client.js` from disk, and a GitHub install does not necessarily run a build. CI fails if the committed `lib/` drifts from a clean build.

The client bundle must never inline React. `tsdown.config.ts` marks `react` and `react/jsx-runtime` as never-bundle so they resolve from the harness module table.

The collector scripts are JavaScript template literals, so a literal `${` would be interpolated at build time and silently corrupt the shell script — `tests/collectors.test.ts` guards against that. For the same reason a stray backtick inside a script terminates the literal early; that one fails loudly at build time rather than at collection time, so it needs no test.

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the build, test and platform-verification workflow; security-relevant reports go through [SECURITY.md](SECURITY.md).

The most useful contribution right now is running the **Linux** or **macOS** collector on real hardware: both scripts were written from documentation and are exercised only by CI, never by the author on a real machine. A report with the raw `key=value` output is enough to fix them.

## License

[MIT](LICENSE)
