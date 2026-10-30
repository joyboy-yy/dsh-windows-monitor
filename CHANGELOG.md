# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Explicit custom-position picker.** The card's 自定义位置 control opens a 3×3 grid with the eight real anchors — four corners and four edge midpoints — and marks the current one. Selecting a direction docks the panel with a 14 px gap (10 px on narrow screens), writes the anchor, and animates the move. Bottom-right is one of the eight choices, so no separate reset control is needed.
- **Window-chrome safe area.** Top anchors, free-placement clamps and drag limits now start at the frame's floating-layer inset — `--dsh-frame-overlay-top`, with `--dsh-frame-top-clearance` as fallback — the same bound the frame's own floating dockkit uses (titlebar plus 20px, 20px in native fullscreen). The panel cannot cover the titlebar or the caption buttons. A `MutationObserver` follows the titlebar/fullscreen markers while a `resize` follows the viewport.
- **Drag feedback.** While a drag is in motion the pill or card fades to 72% opacity and shows the grabbing cursor.
- **Anchor-aware resize.** A docked placement is stored as `{ anchor, gap }` instead of a pixel coordinate. On `resize` (and on expand/collapse or picker expansion) the position is re-resolved from that anchor, so the panel stays attached to the same edge with the same gap instead of drifting into the middle.
- **Versioned persistence with migration.** The last drag or dock is written under the existing `dsh-windows-monitor:position` key as `{ version: 2, placement }`; the legacy plain `{ x, y }` written by 0.2.4 and earlier is read as a free placement, so upgrading does not move the panel. Coordinates are still clamped to the usable area.

### Changed

- **Automatic release-time snapping was removed.** Dropping the panel near an edge no longer moves it: a drag always produces a free placement at the release point. Docking is now an explicit action through the custom-position picker.
- The panel measures the layout viewport (`documentElement.clientWidth/Height`) rather than `window.innerWidth/Height`, keeping its arithmetic consistent with `position: fixed` when a document scrollbar is present.
- Drag clamping uses the usable area's top edge (below the window chrome), not the viewport edge, so the panel cannot be dragged into the header.

## [0.2.4] - 2026-10-16

### Fixed

- **The host half could not collect anything on a current harness.** It called `ctx.shell.run(spec)`, which no longer exists: DSH renamed the entry point to `execute(spec)`, resolving with a handle whose `result()` projection carries the outcome. Every poll answered `采集失败：ctx.shell.run is not a function` — the panel rendered, the route was served, and only the collection failed. The plugin now prefers `execute(spec)` and falls back to `run(spec)`, driving both the current and the older seam.

  This is the failure that shipping untested code earns. `0.1.0` through `0.2.3` passed typecheck, a 24-case suite and CI on three platforms — none of which ever loaded the plugin into a running harness. The first real installation found it in seconds. Four cases now cover the seam: `execute`, `run`, neither, and a non-zero exit.

  Worth recording what the report *did* prove: the panel rendered the error, so the client bundle loaded, the slot registration worked, `ctx.effect` and `ctx.webServer.register` were accepted, and `ctx.sandboxPolicy.resolve` returned. Only the shell call was wrong.

## [0.2.3] - 2026-10-16

### Fixed

- **The README image was still broken on npm, and `0.2.2`'s fix was wrong.** That release pointed it at `gcore.jsdelivr.net` on the strength of a single 4/4 measurement. Re-testing gave 0/4, and every GitHub-backed CDN measured 0–1 successes in 4 from the maintainer's network: `raw.githubusercontent.com`, `cdn.jsdelivr.net`, `gcore.jsdelivr.net`, `fastly.jsdelivr.net`, `cdn.statically.io`, `raw.githack.com`. A one-shot measurement had been mistaken for a stable result — the same error this project already caught once, with `raw.githubusercontent.com`.

  The image now ships **inside the package**: `docs/preview.png` joined `files`, and the README points at `https://unpkg.com/dsh-windows-monitor/docs/preview.png`, which serves npm tarball contents. unpkg answered 4/4 where the alternatives answered 0–1/4, and served this package's own files 3/3, measured across three separate sessions. The cost is ~30 KB on the published tarball — a deliberate trade for an image that actually loads.

## [0.2.2] - 2026-10-16

Everything here was visible on the **npm page**, which renders its README from the published tarball rather than from the repository — so none of it was fixed by pushing to `main`.

### Fixed

- **The preview image was broken on npm.** npm does not serve package files, so the relative path `docs/preview.png` rendered on GitHub and silently failed on npm. It is now an absolute URL, and the host was chosen by measurement rather than habit: from the maintainer's network `raw.githubusercontent.com` answered 0/3 and `cdn.jsdelivr.net` — the usual choice — 0/4, while `gcore.jsdelivr.net` served the image 4/4. The rule is recorded in CONTRIBUTING.md so a future cleanup does not turn it back into a relative path.
- Both READMEs' install examples named `0.1.0` — the release that still shipped the Linux and macOS collectors — in a document that says those were removed in `0.2.0`. The tarball example no longer hardcodes a version.
- `SECURITY.md` still described "one fixed shell script per platform" and a payload that predated disk activity.
- The bug-report template's version placeholder said `v0.1.0`, and its contact link still offered help with the removed collectors.

### Changed

- The client slot id is now `windows-local-monitor`, matching the plugin's name. It had stayed `system-local-monitor` from before the rename — the sweep missed it because the string never contained `system-monitor`.

## [0.2.1] - 2026-10-16

Metadata only; no behaviour changed.

### Fixed

- The published `description` still ended with "Collectors for Windows, Linux and macOS", which `0.2.0` had just stopped being true. The repository description was updated at release time but the manifest was missed. Because npm refuses to republish a version, the correction ships as `0.2.1`.
- Two comments still referred to the removed Linux and macOS collectors: one in `src/protocol.ts`, and one on a runtime function in `src/collectors/format.ts` that the bundler preserves — so the latter shipped inside `lib/index.js` in the `0.2.0` tarball. Found by grepping the built output rather than the source, which is how the first pass missed it.

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
