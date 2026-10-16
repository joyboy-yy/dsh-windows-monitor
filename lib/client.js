window.__ModuleLoader__.load({
	id: "dsh-windows-monitor",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/icons.tsx
		/** Icon path data, keyed by semantic name. */
		const ICON_PATHS = {
			chevronUp: "M2.15137 8.5L2.57617 8.07617L5.30273 5.34863C5.55843 5.09294 5.78438 4.86618 5.98828 4.70215C6.20088 4.53117 6.44405 4.38244 6.75 4.33398C6.91565 4.30778 7.08435 4.30778 7.25 4.33398C7.55595 4.38244 7.79912 4.53117 8.01172 4.70215C8.21561 4.86618 8.44157 5.09294 8.69727 5.34863L11.4238 8.07617L11.8486 8.5L11 9.34863L10.5762 8.92383L7.84863 6.19727C7.57405 5.92269 7.40124 5.75152 7.25977 5.6377C7.12709 5.53096 7.07728 5.52187 7.0625 5.51953C7.02105 5.51297 6.97895 5.51297 6.9375 5.51953C6.92272 5.52187 6.87291 5.53096 6.74023 5.6377C6.59876 5.75152 6.42595 5.92268 6.15137 6.19727L3.42383 8.92383L3 9.34863L2.15137 8.5Z",
			chevronDown: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
			refresh: "M1.272 6.21348C1.70645 3.08888 4.59169 0.908064 7.71634 1.34239C8.95495 1.51469 10.0438 2.07331 10.8814 2.87755L11.9458 1.81407C12.1347 1.6255 12.4572 1.75911 12.4575 2.02598V5.08751C12.4574 5.25303 12.3233 5.38731 12.1577 5.38731H9.0972C8.82993 5.38731 8.69629 5.06361 8.88528 4.87462L10.0327 3.72618C9.3732 3.09994 8.52006 2.66569 7.5513 2.53087C5.08313 2.18779 2.80376 3.91044 2.46048 6.37852C2.11747 8.84665 3.84009 11.1261 6.30814 11.4693C8.77612 11.8121 11.0557 10.0896 11.399 7.62169L11.9937 7.70372L12.5874 7.78673C12.153 10.9112 9.26756 13.0919 6.1431 12.6578C3.01854 12.2234 0.837738 9.33809 1.272 6.21348Z"
		};
		/**
		* Render one icon.
		*
		* @param props.name - geometry to draw.
		* @param props.size - square edge in px.
		*/
		function Icon({ name, size = 14 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 14 14",
				fill: "none",
				xmlns: "http://www.w3.org/2000/svg",
				"aria-hidden": "true",
				focusable: "false",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: ICON_PATHS[name],
					fill: "currentColor"
				})
			});
		}
		//#endregion
		//#region src/client/Monitor.tsx
		/**
		* The windows-monitor panel.
		*
		* Lives in the frame-wide `shell.overlay` slot as a fixed corner surface: a
		* compact pill while collapsed, and a detail card while expanded. Both states
		* share one anchor, so the panel never grows into the middle of the page.
		*/
		/** Distance kept between the panel and the viewport edge, in px. */
		const EDGE = 14;
		/** Pointer travel before a press turns into a drag rather than a click, in px. */
		const DRAG_THRESHOLD = 4;
		/** How long a drag keeps swallowing clicks, in ms. */
		const CLICK_SUPPRESS_MS = 350;
		/** Poll interval for the snapshot endpoint, in ms. */
		const REFRESH_MS = 1e4;
		/** Storage key holding a user-dragged position. */
		const POSITION_KEY = "dsh-windows-monitor:position";
		/** Severity bucket for one percentage; `null` (unknown) has no bucket. */
		function level(value, { warn, bad }) {
			if (value === null) return "";
			return value >= bad ? "bad" : value >= warn ? "warn" : "";
		}
		/** Clamp into a 0-100 percentage, mapping non-finite input to 0. */
		function percent(value) {
			if (!Number.isFinite(value)) return 0;
			return Math.max(0, Math.min(100, value));
		}
		/**
		* Read a wire value that may legitimately be unknown.
		*
		* The snapshot is JSON from a separate process, so this treats absent, empty
		* and non-numeric alike: all three mean "we do not know", which is rendered as
		* `--` rather than as a confident zero.
		*/
		function readNumber(value) {
			if (value === null || value === void 0 || value === "") return null;
			const number = Number(value);
			return Number.isFinite(number) ? number : null;
		}
		/** Fixed-precision GB reading, `--` when unknown. */
		function formatGB(value) {
			return value === null ? "--" : `${value.toFixed(1)} GB`;
		}
		/**
		* A free/total pair stated with one unit, e.g. `412.8 / 1000.0 GB`.
		*
		* Repeating "GB" on both numbers overflows the 280 px row on a large volume —
		* which showed up as an ellipsis swallowing the total, the one number the row
		* exists to convey.
		*/
		function formatVolume(free, total) {
			if (free === null || total === null) return formatGB(free ?? total);
			return `${free.toFixed(1)} / ${total.toFixed(1)} GB`;
		}
		/** Throughput, kept readable from a trickle to hundreds of MB/s. */
		function formatThroughput(value) {
			if (value === null) return "";
			if (value < .005) return "0 MB/s";
			if (value < 1) return `${value.toFixed(2)} MB/s`;
			if (value < 10) return `${value.toFixed(1)} MB/s`;
			return `${Math.round(value)} MB/s`;
		}
		/** Read the persisted position, tolerating absent or corrupt storage. */
		function readPosition() {
			try {
				const raw = window.localStorage.getItem(POSITION_KEY);
				if (!raw) return null;
				const parsed = JSON.parse(raw);
				if (typeof parsed !== "object" || parsed === null) return null;
				const { x, y } = parsed;
				if (typeof x !== "number" || typeof y !== "number") return null;
				if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
				return {
					x,
					y
				};
			} catch {
				return null;
			}
		}
		/** Persist, or clear, the dragged position. Storage may be unavailable. */
		function writePosition(position) {
			try {
				if (position) window.localStorage.setItem(POSITION_KEY, JSON.stringify({
					x: Math.round(position.x),
					y: Math.round(position.y)
				}));
				else window.localStorage.removeItem(POSITION_KEY);
			} catch {}
		}
		/** Keep a box of the given size fully inside the viewport. */
		function clampPosition(x, y, width, height) {
			const maxX = Math.max(EDGE, window.innerWidth - width - EDGE);
			const maxY = Math.max(EDGE, window.innerHeight - height - EDGE);
			return {
				x: Math.min(Math.max(EDGE, x), maxX),
				y: Math.min(Math.max(EDGE, y), maxY)
			};
		}
		/**
		* One labelled percentage with a thin progress track.
		*
		* A `null` value renders as `--` with an empty track: an unknown reading must
		* not be drawn as 0%, which would claim the resource is idle.
		*/
		function Metric({ label, value, severity, hint }) {
			const status = level(value, severity);
			const text = value === null ? "--" : `${value}%`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "sm-metric",
				title: hint ?? `${label} ${text}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "sm-metric-head",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "sm-metric-label",
						children: label
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: `sm-metric-value ${status}`,
						children: text
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "sm-track",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: `sm-fill ${status}`,
						style: { width: value === null ? "0%" : `${percent(value)}%` }
					})
				})]
			});
		}
		/** Compact inline reading used by the collapsed pill. */
		function Micro({ label, value, severity }) {
			const status = level(value, severity);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "sm-micro",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "sm-micro-label",
						children: label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "sm-micro-value",
						children: [value, "%"]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "sm-micro-track",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: `sm-micro-fill ${status}`,
							style: { width: `${percent(value)}%` }
						})
					})
				]
			});
		}
		const CPU_SEVERITY = {
			warn: 75,
			bad: 90
		};
		const MEMORY_SEVERITY = {
			warn: 80,
			bad: 90
		};
		/** Busy time, scored against Task Manager's own notion of a saturated disk. */
		const DISK_ACTIVITY_SEVERITY = {
			warn: 75,
			bad: 90
		};
		/** Fullness. Scored separately so one gauge can never stand in for the other. */
		const DISK_CAPACITY_SEVERITY = {
			warn: 85,
			bad: 92
		};
		/** The overlay surface. */
		function Monitor({ ctx }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [data, setData] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)("");
			const [unsupported, setUnsupported] = (0, react.useState)(false);
			const [loading, setLoading] = (0, react.useState)(false);
			const [position, setPosition] = (0, react.useState)(readPosition);
			const [dragging, setDragging] = (0, react.useState)(false);
			const rootRef = (0, react.useRef)(null);
			const dragRef = (0, react.useRef)(null);
			const movedRef = (0, react.useRef)(false);
			const suppressClickRef = (0, react.useRef)(0);
			const refresh = (0, react.useCallback)(async () => {
				setLoading(true);
				try {
					const response = await fetch("/api/windows-monitor/snapshot", { cache: "no-store" });
					const result = await response.json();
					if (!response.ok) {
						setUnsupported(result.unsupported === true);
						throw new Error(result.error ?? `HTTP ${response.status}`);
					}
					setUnsupported(false);
					setData(result);
					setError("");
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : "无法读取本机状态");
				} finally {
					setLoading(false);
				}
			}, []);
			(0, react.useEffect)(() => {
				refresh();
				return ctx.interval(() => void refresh(), REFRESH_MS);
			}, [ctx, refresh]);
			(0, react.useEffect)(() => {
				const reclamp = () => {
					const node = rootRef.current;
					if (!node) return;
					setPosition((current) => {
						if (current === null) return current;
						const next = clampPosition(current.x, current.y, node.offsetWidth, node.offsetHeight);
						return next.x === current.x && next.y === current.y ? current : next;
					});
				};
				window.addEventListener("resize", reclamp);
				reclamp();
				return () => window.removeEventListener("resize", reclamp);
			}, [open]);
			const beginDrag = (event) => {
				if (event.button !== 0) return;
				const target = event.target;
				const button = target instanceof Element ? target.closest("button") : null;
				if (button && button !== event.currentTarget) return;
				const node = rootRef.current;
				if (!node) return;
				const rect = node.getBoundingClientRect();
				dragRef.current = {
					pointerId: event.pointerId,
					startX: event.clientX,
					startY: event.clientY,
					originX: rect.left,
					originY: rect.top,
					width: rect.width,
					height: rect.height,
					last: null
				};
				movedRef.current = false;
				try {
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch {}
			};
			const moveDrag = (event) => {
				const drag = dragRef.current;
				if (!drag || drag.pointerId !== event.pointerId) return;
				const dx = event.clientX - drag.startX;
				const dy = event.clientY - drag.startY;
				if (!movedRef.current) {
					if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
					movedRef.current = true;
					setDragging(true);
				}
				const next = clampPosition(drag.originX + dx, drag.originY + dy, drag.width, drag.height);
				drag.last = next;
				setPosition(next);
			};
			const endDrag = (event) => {
				const drag = dragRef.current;
				if (!drag || drag.pointerId !== event.pointerId) return;
				dragRef.current = null;
				setDragging(false);
				if (!movedRef.current) return;
				suppressClickRef.current = Date.now() + CLICK_SUPPRESS_MS;
				if (drag.last) writePosition(drag.last);
			};
			const toggle = () => {
				if (Date.now() < suppressClickRef.current) {
					suppressClickRef.current = 0;
					return;
				}
				setOpen((value) => !value);
			};
			const resetPosition = () => {
				setPosition(null);
				writePosition(null);
			};
			const cpu = data ? Number(data.cpu) || 0 : 0;
			const memory = data ? Number(data.memory.usedPct) || 0 : 0;
			const capacityPeak = data && data.disks.length > 0 ? Math.max(...data.disks.map((item) => Number(item.usedPct) || 0)) : null;
			const activity = data ? readNumber(data.diskActivity?.activePct) : null;
			const diskRead = data ? readNumber(data.diskActivity?.readMBs) : null;
			const diskWrite = data ? readNumber(data.diskActivity?.writeMBs) : null;
			const throughput = [diskRead !== null && diskRead > 0 ? `读 ${formatThroughput(diskRead)}` : "", diskWrite !== null && diskWrite > 0 ? `写 ${formatThroughput(diskWrite)}` : ""].filter(Boolean).join(" · ");
			const activityText = activity === null ? "--" : `${activity}%`;
			const status = error ? "bad" : cpu >= CPU_SEVERITY.bad || memory >= MEMORY_SEVERITY.bad || (activity ?? 0) >= DISK_ACTIVITY_SEVERITY.bad || (capacityPeak ?? 0) >= DISK_CAPACITY_SEVERITY.bad ? "bad" : cpu >= CPU_SEVERITY.warn || memory >= MEMORY_SEVERITY.warn || (activity ?? 0) >= DISK_ACTIVITY_SEVERITY.warn || (capacityPeak ?? 0) >= DISK_CAPACITY_SEVERITY.warn ? "warn" : "";
			const dotStatus = error ? "bad" : data ? status : "idle";
			const statusText = error ? unsupported ? "不支持的平台" : "采集失败" : status === "bad" ? "需要关注" : status === "warn" ? "负载偏高" : "正常";
			const rows = [];
			if (data) {
				for (const item of data.disks) rows.push(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "sm-row",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: `${item.name} 磁盘空间` }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: item.usedPct >= DISK_CAPACITY_SEVERITY.warn ? "sm-alert" : "",
						title: `${item.name} 已用 ${item.usedPct}% · 剩余 ${formatGB(item.free)} / ${formatGB(item.total)}`,
						children: `已用 ${item.usedPct}% · 剩余 ${formatVolume(item.free, item.total)}`
					})]
				}, item.name));
				rows.push(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "sm-row",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "磁盘活动" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: level(activity, DISK_ACTIVITY_SEVERITY) === "bad" ? "sm-alert" : "",
						title: "与任务管理器「性能 → 磁盘」的活动时间同口径",
						children: throughput ? `${activityText} · ${throughput}` : activityText
					})]
				}, "disk-activity"));
				if (data.memory) rows.push(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "sm-row",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "内存" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: `${data.memory.freeGB} GB 可用 / ${data.memory.totalGB} GB` })]
				}, "memory"));
				rows.push(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "sm-row",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "网络" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: data.network.connected ? "" : "sm-alert",
						children: data.network.connected ? `${data.network.adapters} 个网卡已连接` : "未连接"
					})]
				}, "network"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "sm-row",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "连续运行" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: `${data.uptimeHours} 小时` })]
				}, "uptime"));
				if (data.battery) rows.push(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "sm-row",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "电池" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: data.battery.percent <= 20 ? "sm-alert" : "",
						children: `${data.battery.percent}%`
					})]
				}, "battery"));
			}
			const handleProps = {
				onPointerDown: beginDrag,
				onPointerMove: moveDrag,
				onPointerUp: endDrag,
				onPointerCancel: endDrag
			};
			const rootStyle = position ? {
				left: `${position.x}px`,
				top: `${position.y}px`,
				right: "auto",
				bottom: "auto"
			} : void 0;
			const live = data !== null && error === "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: rootRef,
				className: "sm-root",
				style: rootStyle,
				children: open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: `sm-card${dragging ? " dragging" : ""}`,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "sm-head",
						...handleProps,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `sm-dot ${dotStatus}` }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "sm-title",
								children: data ? data.computer : "本机状态"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: `sm-chip ${status}`,
								children: statusText
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `sm-icon${loading ? " spinning" : ""}`,
								onClick: () => void refresh(),
								disabled: loading,
								title: "立即刷新",
								"aria-label": "立即刷新",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "refresh" })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "sm-icon",
								onClick: toggle,
								title: "收起系统状态",
								"aria-label": "收起系统状态",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "chevronDown" })
							})
						]
					}), error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "sm-error",
						children: unsupported ? error : `采集失败：${error}`
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "sm-body",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "sm-grid",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Metric, {
										label: "CPU",
										value: cpu,
										severity: CPU_SEVERITY
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Metric, {
										label: "内存",
										value: memory,
										severity: MEMORY_SEVERITY
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Metric, {
										label: "磁盘活动",
										value: activity,
										severity: DISK_ACTIVITY_SEVERITY,
										hint: `磁盘活动 ${activityText}（与任务管理器「性能 → 磁盘」同口径）`
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "sm-rows",
								children: rows
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "sm-foot",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "sm-time",
									children: data ? `更新于 ${new Date(data.timestamp).toLocaleTimeString()}` : "正在建立基线"
								}), position !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "sm-reset",
									onClick: resetPosition,
									title: "把面板放回右下角",
									children: "复位"
								})]
							})
						]
					})]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: `sm-pill${dragging ? " dragging" : ""}`,
					onClick: toggle,
					"aria-expanded": false,
					"aria-label": "展开本机状态",
					title: data ? `CPU ${cpu}% · 内存 ${memory}% · 磁盘活动 ${activityText} · 磁盘空间峰值 ${capacityPeak ?? "--"}%（点击展开，可拖动）` : "本机状态（点击展开，可拖动）",
					...handleProps,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `sm-dot ${dotStatus}` }),
						live ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Micro, {
							label: "CPU",
							value: cpu,
							severity: CPU_SEVERITY
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Micro, {
							label: "MEM",
							value: memory,
							severity: MEMORY_SEVERITY
						})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "sm-hint",
							children: error ? unsupported ? "不支持" : "不可用" : "读取中"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "sm-caret",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "chevronUp" })
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* Panel stylesheet.
		*
		* Inserted once per plugin fiber and removed on teardown. Every colour is a DSH
		* theme token so light/dark follow the app; nothing here reaches outside the
		* `.sm-` namespace.
		*/
		const PANEL_CSS = `
.sm-root{position:fixed;right:14px;bottom:14px;z-index:80;pointer-events:none;font-family:inherit;color:var(--dsw-alias-label-primary)}
.sm-root>*{pointer-events:auto}
.sm-pill,.sm-card{background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 4px 16px rgba(0,0,0,.10),0 1px 2px rgba(0,0,0,.05)}
.sm-pill{display:flex;align-items:center;gap:9px;height:30px;padding:0 11px;border-radius:999px;font:inherit;color:inherit;cursor:pointer;touch-action:none;user-select:none;transition:border-color .15s ease,box-shadow .15s ease}
.sm-pill:hover{border-color:var(--dsw-alias-border-l2);box-shadow:0 6px 20px rgba(0,0,0,.14),0 1px 2px rgba(0,0,0,.06)}
.sm-pill.dragging,.sm-card.dragging{cursor:grabbing}
.sm-hint{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.sm-caret{display:flex;align-items:center;color:var(--dsw-alias-label-secondary)}
.sm-micro{display:flex;align-items:center;gap:4px;font-variant-numeric:tabular-nums;white-space:nowrap}
.sm-micro-label{font-size:9px;letter-spacing:.06em;color:var(--dsw-alias-label-secondary)}
.sm-micro-value{font-size:11px;font-weight:600}
.sm-micro-track{display:block;width:20px;height:3px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.sm-micro-fill{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary);transition:width .3s ease}
.sm-micro-fill.warn{background:var(--dsw-alias-state-warn-primary)}
.sm-micro-fill.bad{background:var(--dsw-alias-state-error-primary)}
.sm-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary)}
.sm-dot.warn{background:var(--dsw-alias-state-warn-primary)}
.sm-dot.bad{background:var(--dsw-alias-state-error-primary);animation:sm-pulse 1.6s ease-in-out infinite}
.sm-dot.idle{background:var(--dsw-alias-label-secondary);opacity:.45}
@keyframes sm-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes sm-spin{to{transform:rotate(360deg)}}
.sm-card{width:min(280px,calc(100vw - 24px));border-radius:10px;overflow:hidden}
.sm-head{display:flex;align-items:center;gap:8px;height:38px;padding:0 7px 0 12px;cursor:grab;touch-action:none;user-select:none}
.sm-title{flex:1;font-size:12px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-chip{flex:none;font-size:10px;line-height:1;padding:3px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.sm-chip.warn{color:var(--dsw-alias-state-warn-primary)}
.sm-chip.bad{color:var(--dsw-alias-state-error-primary)}
.sm-icon{width:24px;height:24px;flex:none;display:flex;align-items:center;justify-content:center;padding:0;font:inherit;font-size:14px;line-height:1;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.sm-icon:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sm-icon:disabled{opacity:.45;cursor:default}
.sm-icon svg{display:block}
.sm-icon.spinning svg{animation:sm-spin .9s linear infinite}
.sm-body{border-top:1px solid var(--dsw-alias-border-l1);padding:12px}
.sm-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.sm-metric{display:flex;flex-direction:column;gap:6px;min-width:0}
.sm-metric-head{display:flex;align-items:baseline;justify-content:space-between;gap:5px;min-width:0}
.sm-metric-label{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.sm-metric-value{font-size:12px;font-weight:650;font-variant-numeric:tabular-nums}
.sm-metric-value.warn{color:var(--dsw-alias-state-warn-primary)}
.sm-metric-value.bad{color:var(--dsw-alias-state-error-primary)}
.sm-track{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.sm-fill{height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary);transition:width .3s ease}
.sm-fill.warn{background:var(--dsw-alias-state-warn-primary)}
.sm-fill.bad{background:var(--dsw-alias-state-error-primary)}
.sm-rows{display:flex;flex-direction:column;margin-top:12px;padding-top:9px;border-top:1px solid var(--dsw-alias-border-l1)}
.sm-row{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:23px;font-size:11.5px}
.sm-row>span:first-child{flex:none;color:var(--dsw-alias-label-secondary)}
.sm-row>span:last-child{text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
.sm-alert{color:var(--dsw-alias-state-warn-primary)!important}
.sm-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px;padding-top:9px;border-top:1px solid var(--dsw-alias-border-l1)}
.sm-time{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.sm-reset{padding:2px 5px;font:inherit;font-size:10.5px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.sm-reset:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sm-error{padding:12px;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-state-error-primary);border-top:1px solid var(--dsw-alias-border-l1)}
.sm-pill:focus-visible,.sm-icon:focus-visible,.sm-reset:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
@media(max-width:520px){.sm-root{right:10px;bottom:10px}.sm-card{width:calc(100vw - 20px)}}
@media(prefers-reduced-motion:reduce){.sm-dot.bad{animation:none}.sm-icon.spinning svg{animation:none}.sm-micro-fill,.sm-fill,.sm-pill{transition:none}}
`;
		//#endregion
		//#region src/client/index.tsx
		/** Cordis services the client half cannot start without. */
		const inject = ["slots", "timer"];
		/** Target slot: the frame-wide floating layer above every column. */
		const SLOT = "shell.overlay";
		/** This entry's cell key. A fresh id is added beside the shipped entries. */
		const SLOT_ID = "windows-local-monitor";
		/** Register the panel and own the stylesheet for this plugin's lifetime. */
		function apply(ctx) {
			const style = document.createElement("style");
			style.dataset.dshSystemMonitor = "true";
			style.textContent = PANEL_CSS;
			document.head.appendChild(style);
			ctx.effect(() => () => style.remove(), "windows-monitor: styles");
			ctx.slots.inject(SLOT, () => ctx.slots.register({
				name: SLOT,
				id: SLOT_ID,
				order: 20,
				label: "本机状态"
			}, () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Monitor, { ctx })));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map