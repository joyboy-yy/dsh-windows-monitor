# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-16

Windows only, by design. `0.1.0` shipped Linux and macOS collectors that were written from documentation and never run by the author on their own hardware; they worked, but they were a promise the project could not maintain. The name says Windows, the headline reading comes from a Windows performance counter, and a collector the maintainer cannot run is a collector whose bugs they cannot reproduce.

### Removed

- **The Linux and macOS collectors.** `src/collectors/linux.ts` and `src/collectors/macos.ts` are gone; `SUPPORTED_PLATFORMS` is now `['win32']`. Hosts on any other platform get the explicit unsupported-platform answer that was already there, instead of a panel that renders empty gauges. Both scripts remain in git history if anyone wants to restore them.

### Changed

- The CI matrix still spans `ubuntu-latest`, `macos-latest` and `windows-latest`, but its purpose changed: `windows-latest` runs the collector for real, while the other two now assert the negative contract — `selectCollector` returns nothing and the route answers `501` with a usable body. That behaviour was documented but untested before this release.
- README, issue template and contribution guide narrowed to Windows.

## [0.1.0] - 2026-10-16

The first public release. Tagged `v0.1.0` and published to npm as [`dsh-windows-monitor`](https://www.npmjs.com/package/dsh-windows-monitor).

### Added

- Corner pill showing live CPU and memory, expanding into a detail card with disk activity, per-volume capacity, memory totals, network adapter state, uptime and battery.
- **Disk activity** (`100 − PercentIdleTime` over the `_Total` rollup), the same figure as Task Manager's 磁盘 column, plus read/write throughput. Kept on its own field, separate from capacity, so a static fullness number can never be mistaken for a live load reading. Best-effort: a host without the performance-counter provider reports `null`, rendered as `--` rather than a fabricated `0%`.
- Draggable panel, clamped to the viewport, with a reset control and a remembered position (`localStorage` key `dsh-windows-monitor:position`).
- Read-only collectors for Windows (PowerShell + CIM/WMI), Linux (`/proc`, sysfs, `df`) and macOS (`top`, `vm_stat`, `sysctl`, `ifconfig`, `df`, `pmset`), selected by `process.platform` and never by the request.
- Host route `GET /api/windows-monitor/snapshot`, cached for 5 seconds, with concurrent polls sharing one in-flight collection and `Cache-Control: no-store` on every response.
- An explicit `501` unsupported-platform answer instead of a panel that pretends to work.
- Client half registered into the frame-wide `shell.overlay` slot, with every colour taken from DSH theme tokens and animations disabled under `prefers-reduced-motion`.
- CI matrix on `ubuntu-latest`, `macos-latest` and `windows-latest`, including a check that the committed `lib/` matches a clean build.
- Honest failure states: a failed collection renders "unavailable" rather than stale numbers.

### Changed

- The collector process culture is pinned to invariant before any number is formatted. The `key=value` fact format uses `.` as its decimal separator, so a comma-decimal locale would otherwise have produced unparseable output.
- The Windows collector bounds every WMI call with `OperationTimeoutSec`, so one wedged provider cannot consume the host's whole wall-clock budget.

### Known limitations

- **Disk activity is Windows-only.** The Linux and macOS collectors report it as unknown and the panel shows `--`.
- The Linux and macOS collectors were written from documentation and have never been run by the author on their own machine. CI now executes each one for real on its own runner — `ubuntu-latest`, `macos-latest` and `windows-latest` all pass — so they are verified, just not by the author locally. Reports from other distributions and Mac configurations are still the most useful contribution.
- Mount points containing spaces are truncated by `df` parsing on Linux and macOS.
- Linux `operstate` reports `unknown` for some virtual interfaces that are in fact up, so the adapter count can undercount.
- The host half resolves the `danger-full-access` sandbox policy so it can run a shell. The commands are read-only; the granted policy is not. This is disclosed in the README's security model.
