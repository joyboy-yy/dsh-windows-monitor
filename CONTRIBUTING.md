# Contributing

Thanks for taking a look. This is a small plugin with a deliberately narrow surface, so most contributions land quickly. Issues and pull requests are welcome.

Security-relevant reports do **not** belong in an issue — see [SECURITY.md](SECURITY.md). By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## The most useful contribution right now

The plugin is Windows-only on purpose, and the interesting failures are Windows ones: a machine where the performance-counter provider is unavailable, a locale other than en-US or zh-CN, a Windows build where a CIM class behaves differently, a battery-less desktop. None of those are in the CI matrix.

If your machine is unusual in one of those ways, run the suite with the debug hook and paste the block it prints:

```powershell
$env:DEBUG_COLLECTOR=1; pnpm run test
```

It prints the raw `key=value` facts the collector produced on your machine. Open an issue with that block, plus your Windows version. Raw output is what makes a report actionable — a summary is not.

## Development setup

Node.js `^22.19.0 || >=24.0.0` and pnpm 11.

```bash
git clone https://github.com/joyboy-yy/dsh-windows-monitor.git
cd dsh-windows-monitor
pnpm install          # `prepare` builds lib/ as part of install
pnpm run typecheck
pnpm run test
pnpm run build
```

`pnpm run test` runs the parser suite everywhere. On Windows it also runs the collector for real; on any other platform it asserts the unsupported-platform contract instead — `selectCollector` returns nothing and the route answers `501`. CI covers both sides.

To drive the plugin inside a real harness:

```bash
dsh plugin --profile web add /path/to/dsh-windows-monitor
dsh --profile web --dump-config     # confirm the windows-monitor row is composed
dsh --profile web
```

For UI work there is no test runner in front of the panel: mount `lib/client.js` in a browser page and drive it with pointer events, or verify against a running harness.

## Repository layout

| Path | What it is |
|---|---|
| `src/index.ts` | Host half: the route, the 5-second cache, the sandbox grant. |
| `src/protocol.ts` | Wire protocol, `Snapshot` types, shared constants. |
| `src/collectors/format.ts` | `key=value` fact parser. Pure functions, fully unit-tested. |
| `src/collectors/windows.ts` | The Windows collector: one read-only PowerShell script. |
| `src/collectors/index.ts` | Collector selection by `process.platform`. |
| `src/client/` | React client half: panel, icons, styles, harness types. |
| `tests/` | Parser suite + the collector guard and integration tests. |
| `lib/` | Build output. Committed on purpose — see below. |
| `cordis.patch.yml` | The bundle's Host/Client row. |

## Rules that are not obvious

These are the ones that bite. Everything else is ordinary TypeScript and React.

- **`lib/` is committed deliberately.** The harness activates a plugin by reading `lib/client.js` from disk, and a GitHub install does not necessarily run a build. Run `pnpm run build` and commit the result in the same PR; CI enforces this with `git diff --exit-code -- lib`.
- **Never inline React into the client bundle.** `tsdown.config.ts` marks `react` and `react/jsx-runtime` as `neverBundle` so they resolve from the harness module table.
- **No literal `${` in a collector script.** The scripts are JavaScript template literals, so `${` would be interpolated at build time and silently corrupt the shell script. `tests/collectors.test.ts` guards against it; use `$var` instead.
- **Collectors are read-only by contract.** They read CIM/WMI and run `Get-NetAdapter`. A collector that writes, installs or changes machine state is a bug, not a feature.
- **The platform is chosen by the host.** `process.platform` decides the collector; nothing in a request may influence it.
- **Only Windows has a collector, and adding another platform is a scope decision, not a patch.** `0.1.0` shipped Linux and macOS collectors written from documentation; they were removed in `0.2.0` because the maintainer could not run them. A PR adding a platform needs an owner who can actually run it.
- **Facts are `key=value`, not JSON.** Emitting correct JSON from PowerShell without assuming a JSON library is a portability trap. The host stamps the timestamp.
- **`README.md` and `README.zh.md` are kept in sync.** A PR that changes user-facing behaviour changes both.
- **Panel styling uses theme tokens only** — no hard-coded colours — and classes carry the `sm-` prefix.

## Changing or adding a collector

1. Add or edit the script in `src/collectors/<platform>.ts`, then register it in `COLLECTORS` in `src/collectors/index.ts`.
2. Keep it to **one** shell command, and keep it read-only.
3. Print one fact per line. Required keys: `computer`, `cpu`, `mem_total_mb`, `mem_used_mb`, `net_up`, `uptime_s`. Repeat `disk=<name>|<totalGB>|<freeGB>` once per volume. `battery=<percent>` is optional; omit it entirely on a machine without a battery. Blank lines and `#` comments are ignored, and the first occurrence of a key wins.
4. Run `pnpm run test` on that platform and paste the output in the PR, plus any limitation you found (the README documents the ones already known).
5. Add a case to `tests/format.test.ts` if you changed parsing rather than a script.

## Pull requests

- Conventional commit subjects: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`.
- Small and focused beats large and complete. A PR that fixes one collector is easier to verify than one that also restyles the card.
- Fill in the PR template's verification section — say which platform you actually ran the suite on.
- New behaviour should have a test, or the PR should say why it cannot have one.

## Troubleshooting

- `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` on Windows in a non-interactive shell: set `$env:CI='true'` before `pnpm install`.
- `ERR_PNPM_IGNORED_BUILDS` on install: `pnpm-workspace.yaml` already allows the one build script this repo needs (`esbuild`, pulled in by vitest). Do not widen it without saying why.
- A collector test that times out on the first run of the day is usually a cold PowerShell start; the suite allows 60 seconds per test.

## 中文要点

- **当前最有价值的贡献**：报告 Windows 上的异常环境——性能计数器服务不可用、非 en-US / zh-CN 的小数区域、某个 CIM 类行为异常的 Windows 版本、没有电池的台式机。这些都不在 CI 矩阵里。命令是 `$env:DEBUG_COLLECTOR=1; pnpm run test`，把打印出来的原始 `key=value` 贴到 issue 里即可。
- 开发流程：`pnpm install` → `pnpm run typecheck` → `pnpm run test` → `pnpm run build`。
- 几条容易踩的规矩：`lib/` 是**故意提交**的构建产物，改完源码必须 `pnpm run build` 并一起提交（CI 会跑 `git diff --exit-code -- lib` 校验）；客户端 bundle 绝不能内联 React；采集器脚本里不能出现字面量 `${`；采集器必须保持只读；平台由 `process.platform` 决定，不由请求决定；README 中英文两版要同步改。
- 提交信息用约定式前缀（`feat:` / `fix:` / `docs:` / `test:` / `chore:`），PR 尽量小而聚焦。
- 安全问题不要开公开 issue，走 [SECURITY.md](SECURITY.md)。
