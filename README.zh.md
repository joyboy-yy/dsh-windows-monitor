# dsh-windows-monitor

[English](README.md) | 简体中文

[![CI](https://github.com/joyboy-yy/dsh-windows-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/joyboy-yy/dsh-windows-monitor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的本机状态面板：右下角一枚紧凑胶囊，实时显示 CPU 与内存占用，点击展开为明细卡片——磁盘活动与读写吞吐、各磁盘空间、网络状态、连续运行时长与电池。

支持 **Windows**。

![折叠态与展开态](https://unpkg.com/dsh-windows-monitor/docs/preview.png)

## 特性

- **不遮挡中间区域。** 折叠态约 210 px 胶囊，展开态 280 px 卡片，默认与输入框保持间距。
- **可拖动、智能吸附。** 拖胶囊或卡片标题栏可自由移动，拖动时面板略微透明。松手时若距视口任一边不足 20 px，会吸附到最近的**四角或四边中点**（共 8 个锚点），并保留 14 px（窄屏 10 px）的视觉间距；离边较远则停在落点。
- **吸附的是关系，不是坐标。** 吸附后记录锚点与边距；窗口尺寸变化时按锚点重新计算位置，面板始终贴着原边缘、间距不变，展开成卡片时也不会脱离锚点。位置与锚点持久化在 `localStorage`，下次启动恢复；复位按钮回到右下角。
- **一眼可读。** 状态点分色——正常绿、负载偏高琥珀、采集失败红色脉冲。
- **按需展开。** CPU / 内存 / **磁盘活动**以进度条呈现，另有每个磁盘一行、内存总量、网卡状态、运行时长与电池。
- **容量与活动严格区分。** 「磁盘活动」这一格是**繁忙时间**——与任务管理器「性能 → 磁盘」的活动时间同口径，取 `100 − PercentIdleTime`；「还剩多少空间」是下方单独的一行。把静态的「已用 93%」放进仪表盘，会在一枚实时跳动的 CPU 数字旁边显得像卡死或坏掉，所以它永远不出现在那里。
- **未知是一种真实状态。** 磁盘活动是尽力而为的读数：拿不到性能计数器、或还没采到第一个样本时，面板显示 `--` 而不是 `0%`——0 是对「磁盘空闲」的断言，而并没有任何采集器做出过这个断言。
- **失败状态诚实。** 采集失败时胶囊显示「不可用」而不是陈旧数值；**该平台没有采集器时直接说明**，而不是看起来像坏了。
- **跟随主题。** 所有颜色均使用 DSH 主题令牌，自动适配浅色/深色；图标是取自 Harness 自身图标集的内联 SVG，不依赖图标字体。
- **可访问性。** 真实按钮元素带标签、可见焦点环，`prefers-reduced-motion` 下关闭动画。

## 环境要求

- DeepSeek Harness，使用 **Web** profile 与当前的 profile bundle 机制。
- **Windows。** host 进程必须运行在 Windows 上，见[平台支持](#平台支持)。
- 从源码构建需要 Node.js `^22.19.0 || >=24.0.0`。

不需要管理员权限，不会向系统级位置安装任何东西。

## 平台支持

仅支持 Windows，且这是**刻意的取舍**。插件以 Windows 命名，招牌读数（磁盘活动）来自 Windows 性能计数器，而**作者跑不起来的采集器，就是作者复现不了 bug 的采集器**。此前附带的 Linux 与 macOS 采集器是照文档写出来的、作者从未在自己机器上执行过——那等于用一个兑现不了的承诺，换来两条维护不了的分支。

host 按 `process.platform` 选择采集器，**不由请求决定**。

| 平台 | 采集器 |
|---|---|
| **Windows** | PowerShell + CIM/WMI（`Win32_Processor`、`Win32_OperatingSystem`、`Win32_LogicalDisk`、`Win32_Battery`、`Win32_PerfFormattedData_PerfDisk_PhysicalDisk`）与 `Get-NetAdapter`。作者已在 Windows 11 上验证 |
| **其他任何平台** | 无。路由返回 `501` 与明确的「不支持的平台」响应体，面板如实呈现，而不是画一堆空表盘 |

`0.1.0` 确实附带过 `linux` 与 `macOS` 采集器，它们已在 `0.2.0` 移除，见[变更日志](CHANGELOG.md)。

CI 仍在三个 runner 上跑，这同样是刻意的：`windows-latest` 真实执行采集器，而 `ubuntu-latest` 与 `macos-latest` 验证**反向契约**——没有采集器时必须诚实报错，而不是假装能用。见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)。

已知限制：

- 磁盘活动依赖 Windows 性能计数器服务；该服务被禁用或缺失时，读数降级为 `--`，而不是让整份快照失败。
- 采集器会把进程区域固定为 invariant。事实格式是 `key=value` 且以 `.` 为小数点，否则逗号小数区域会输出无法解析的数字。
- 部分驱动会把 `PercentDiskTime` 报成 100 以上数倍，这正是繁忙时间改用「空闲的补数」推导的原因。

## 安装

从 npm 安装——产物已预构建，也是唯一不需要构建授权的路径：

```powershell
dsh plugin --profile web add dsh-windows-monitor
```

从本地目录安装（开发期间用这条）：

```powershell
dsh plugin --profile web add D:\path\to\dsh-windows-monitor
dsh --profile web --dump-config   # 确认 windows-monitor 这一行已被组合进配置树
dsh --profile web
```

从发布压缩包安装（已预构建，无需授予构建权限）：

```powershell
dsh plugin --profile web add .\dsh-windows-monitor-<version>.tgz
```

从固定的源码标签安装——当前标签见 [releases](https://github.com/joyboy-yy/dsh-windows-monitor/releases)：

```powershell
dsh plugin --profile web add github:joyboy-yy/dsh-windows-monitor#v0.2.1
```

git 安装会拉取源码并执行本包的 `prepare` 构建，这意味着**包代码会在 agent 沙箱之外于你的机器上执行**。pnpm 默认会拒绝，直到 profile 的 `pnpm-workspace.yaml` 显式放行：

```yaml
allowBuilds:
  dsh-windows-monitor: true
```

授予该权限前请先阅读源码并固定到具体 tag。发布压缩包内含预构建产物，不需要这一步。

## 配置

本 bundle 插入一行 Host/Client 记录，声明在 [`cordis.patch.yml`](cordis.patch.yml)：

```yaml
- insert:
    - id: windows-monitor
      name: dsh-windows-monitor
      inject: [shell, sandboxPolicy, webServer]
```

在 profile 或用户级 `cordis.patch.yml` 中覆盖这一行即可禁用或调整其在配置树中的位置。

浏览器侧的本地偏好只有一项：面板的位置与吸附锚点，存于 `localStorage` 的 `dsh-windows-monitor:position`。新格式带版本号（`{ version: 2, placement: { kind: 'anchor', x, y, gap } }` 或 `{ kind: 'free', x, y }`），并兼容读取 `0.2.4` 及更早版本写入的纯坐标 `{ x, y }`。仅在拖动结束或吸附时写入，按「复位」时清除。插件不存储任何指标数据。

## 工作原理

**Host 半边**注册一个只读路由，并通过 Harness 的 `shell` 服务执行**本平台**的采集器：

```
GET /api/windows-monitor/snapshot
```

采集器每行输出一条 `key=value`。选择行格式而非 JSON 是刻意的：在 PowerShell 里不依赖 JSON 库而输出正确 JSON 是个可移植性陷阱，而 `key=value` 极易产出，在 TypeScript 侧也极易解析（并单测）。host 把事实转换成客户端渲染的快照，并**自己盖上时间戳**。

shell seam 的**两个入口都会驱动**。DSH 把 `ctx.shell.run(spec)` 改名为 `ctx.shell.execute(spec)`，后者 resolve 出一个句柄，由它的 `result()` 投影带回执行结果，因此 host 优先用 `execute`、回退到 `run`。写死其中任何一个，都会在只提供另一个的 harness 版本上直接失效——`0.2.3` 正是如此，每次轮询都返回 `ctx.shell.run is not a function`。`tests/collectors.test.ts` 现在覆盖两条路径，外加两者都不存在的情况。

结果缓存 5 秒，且并发的轮询会共享同一次进行中的采集而不是互相竞争，因此浏览器的轮询不会成倍放大采集次数。

**Client 半边**注册到全框层的 `shell.overlay` 插槽。该层本身是点击穿透的——面板主动选择接收指针事件，因此不会挡住底下的应用。

两半边都不触碰模型、会话或对话记录。插件不注册任何工具。

## 安全模型

安装前请阅读。

- **采集器是只读的。** 它读取 CIM/WMI 并运行 `Get-NetAdapter`，不写入、不安装、不改变机器状态。
- **沙箱授权范围较宽。** Host 半边解析 `danger-full-access` 沙箱策略以便执行 shell。命令本身是只读的，但该策略不是——这是最需要审查的一点，代码位于 `src/index.ts` 与 `src/collectors/`。
- **执行哪条命令由 host 决定，不由浏览器决定。** 平台取自 `process.platform`，请求无法指定另一个采集器。
- **载荷不含个人数据。** 内容包括主机名、CPU 百分比、内存总量与占用、各磁盘容量与占用、磁盘繁忙时间与读写吞吐、已连接网卡数量、运行小时数，以及存在电池时的电量百分比。不含文件内容、用户名、路径或任何凭据，也不含按进程或按文件的磁盘归属信息。
- **无对外网络请求。** 插件不发起任何出站请求；唯一的 HTTP 面是本机由 Harness 提供的那个路由。
- **不接触任何密钥。** 插件从不读取凭据。
- **所有响应均为 Cache-Control: no-store。**
- **只有一个 localStorage 键**，且仅存面板位置与吸附锚点（含边距），不含任何指标数据。

## 开发

```powershell
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

`pnpm run test` 会在任何平台跑解析器测试；在 Windows 上额外真实执行采集器，在其他平台上则改为验证**反向契约**——`selectCollector` 返回空、路由返回 `501`，而不是提供空表盘。两者都由 CI 覆盖。

`pnpm run build` 产出 `lib/index.js` + `lib/index.d.ts`（Host，ESM）与 `lib/client.js` + `lib/client.js.map`（Client，包裹在 Harness 期望的 `window.__ModuleLoader__` 外壳中）。

`lib/` 是**有意提交进仓库**的：Harness 通过读取磁盘上的 `lib/client.js` 来激活插件，而 GitHub 安装路径不一定会执行构建。若提交的 `lib/` 与干净构建不一致，CI 会失败。

客户端 bundle 绝不能内联 React。`tsdown.config.ts` 把 `react` 与 `react/jsx-runtime` 标记为 never-bundle，让它们从 Harness 的模块表解析。

采集器脚本是 JavaScript 模板字符串，因此字面量 `${` 会在构建期被插值并**静默破坏 shell 脚本**——`tests/collectors.test.ts` 对此有专门的守护测试。同理，脚本内出现一个未转义的反引号会提前终止模板字符串：这一种会在构建期就报错，而不会拖到采集时才暴露，因此不需要额外测试。

## 贡献

欢迎提交 issue 与 PR。构建、测试与平台验证流程见 [CONTRIBUTING.md](CONTRIBUTING.md)；安全相关报告请走 [SECURITY.md](SECURITY.md)。

范围是**刻意限定在 Windows** 的，所以最有价值的贡献都来自 Windows：性能计数器服务不可用的机器、en-US 与 zh-CN 以外的小数区域、某个 CIM 类行为异常的 Windows 版本。把采集器原始的 `key=value` 输出贴到 issue 里就足够定位问题。

## 许可证

[MIT](LICENSE)
