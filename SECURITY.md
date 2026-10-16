# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

Use GitHub's private vulnerability reporting: **[Report a vulnerability](https://github.com/joyboy-yy/dsh-windows-monitor/security/advisories/new)**
(repository → *Security* → *Advisories* → *Report a vulnerability*). If that entry point is unavailable, open an issue that names only the affected area and asks for a private channel — leave exploit details out of it.

This is a hobby project maintained in spare time, so there is no SLA. Expect an initial reply within a couple of weeks, and a fix shipped as a patch release on `main`.

## Supported versions

Only the latest release on `main` is supported. Fixes are not backported.

## What this plugin does with your machine

Worth reading before judging severity. The full picture is in the [security model](README.md#security-model).

- The host half resolves the **`danger-full-access`** sandbox policy so the shell can run. The commands are read-only; the granted policy is not. This is the main thing to review, and it lives in `src/index.ts` and `src/collectors/`.
- The collector runs one fixed shell script. The platform comes from `process.platform`, never from the HTTP request; a platform without a collector gets an explicit error instead of a command.
- The only HTTP surface is `GET /api/windows-monitor/snapshot`, served locally by the harness. There is no outbound network traffic.
- The snapshot carries the host name, CPU percentage, memory totals and usage, per-volume capacity and usage, disk busy time and read/write throughput, a connected-adapter count, uptime hours, and battery percentage when a battery exists. No file contents, usernames, paths, credentials, or per-process and per-file disk attribution.
- The plugin registers no tools and does not touch the model, the session or the transcript.

## In scope

- Any way a browser request can influence which command runs, or how it is composed.
- Command injection or argument smuggling via collector output, environment or platform detection.
- A collector that writes, installs or otherwise changes machine state — they are read-only by contract.
- XSS or injection through the client half, or snapshot data escaping into the app shell.
- Secrets or personal data leaking into the snapshot payload.

## Out of scope

- The `danger-full-access` resolution itself: it is disclosed design, documented in the README. A report that a narrower mode would in fact suffice is welcome as an *issue* rather than a vulnerability — but bring measurements, because narrower modes currently block the shell from loading its own modules.
- Missing code signing, npm provenance or reproducible builds.
- Anything that requires an attacker who can already modify files on the host or in the harness installation.
- Vulnerabilities in DeepSeek Harness itself — report those upstream.

## 中文要点

- 安全问题请**私下**报告：走上面的 GitHub 私密漏洞报告入口，不要开公开 issue。
- 个人业余项目，没有 SLA，一般两周内首次回复；修复以补丁版本发在 `main` 上。
- 只支持 `main` 上的最新版本，不做回溯修复。
- 最需要关注的一点：Host 半边解析的是 `danger-full-access` 沙箱策略——**命令是只读的，但这个策略不是**。这属于**已披露的设计**，本身不算漏洞；如果你能实测证明更窄的模式够用，欢迎以 issue 形式提出。
- 属于漏洞范围的行为：浏览器请求能影响执行哪条命令、命令注入、采集器写入机器状态、客户端 XSS、快照载荷泄露凭据或个人数据。
