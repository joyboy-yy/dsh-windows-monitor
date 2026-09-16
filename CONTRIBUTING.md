# Contributing

Thanks for taking a look. This is a small plugin with a deliberately narrow surface, so most contributions land quickly. Issues and pull requests are welcome.

Security-relevant reports do **not** belong in an issue — see [SECURITY.md](SECURITY.md). By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## The most useful contribution right now

The **Linux** and **macOS** collectors were written from documentation. The author has never run either of them on real hardware; the CI matrix is the only thing that executes them.

If you have one of those machines, run the suite with the debug hook and paste the block it prints:

```bash
DEBUG_COLLECTOR=1 pnpm run test
```

```powershell
# Windows PowerShell
$env:DEBUG_COLLECTOR=1; pnpm run test
```

It prints the raw `key=value` facts the collector produced on your machine. Open an issue with that block, plus your OS version. Raw output is what makes these two scripts fixable — a summary is not.

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

`pnpm run test` runs the parser suite everywhere plus the collector integration test for **the platform you are on**, so a local run only exercises your own OS. All three are covered in CI.

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
| `src/collectors/{windows,linux,macos}.ts` | One shell script per platform. |
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
- **Collectors are read-only by contract.** They read `/proc`, sysfs, CIM/WMI and run `df` / `top` / `vm_stat` / `pmset`. A collector that writes, installs or changes machine state is a bug, not a feature.
- **The platform is chosen by the host.** `process.platform` decides the collector; nothing in a request may influence it.
- **Facts are `key=value`, not JSON.** Emitting correct JSON from bash and PowerShell without assuming `jq` is a portability trap. The host stamps the timestamp, so no two platforms have to agree on date formatting.
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

- **当前最有价值的贡献**：在真机上跑 Linux 或 macOS 采集器。命令是 `DEBUG_COLLECTOR=1 pnpm run test`（PowerShell：`$env:DEBUG_COLLECTOR=1; pnpm run test`），把打印出来的原始 `key=value` 贴到 issue 里即可——这两个脚本从没在真机上验证过。
- 开发流程：`pnpm install` → `pnpm run typecheck` → `pnpm run test` → `pnpm run build`。
- 几条容易踩的规矩：`lib/` 是**故意提交**的构建产物，改完源码必须 `pnpm run build` 并一起提交（CI 会跑 `git diff --exit-code -- lib` 校验）；客户端 bundle 绝不能内联 React；采集器脚本里不能出现字面量 `${`；采集器必须保持只读；平台由 `process.platform` 决定，不由请求决定；README 中英文两版要同步改。
- 提交信息用约定式前缀（`feat:` / `fix:` / `docs:` / `test:` / `chore:`），PR 尽量小而聚焦。
- 安全问题不要开公开 issue，走 [SECURITY.md](SECURITY.md)。
