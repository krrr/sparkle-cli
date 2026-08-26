Ink fork by Google employee jacob314. https://github.com/jacob314/ink
synced git version: 0c5453b
cherry-picked upstream commits: 7c0f383b (vadimdemedes/ink, Update dependencies), 969cae4b (useInput home/end key support), a006d769 (Fix some flicker in incremental rendering, also applied to fork-specific IME cursor branch), 557b029 (Fix handling of terminal resize)


## Changes

该fork相对上游（vadimdemedes/ink）有一些深度定制要注意：针对全屏交互式 TUI、长文本滚动和性能优化进行了大幅扩展与重构。主要改动如下：

---

### 1. 现代化多进程 / Worker 渲染管道（Worker & Terminal Buffer）
* **后台 Worker 渲染 (`renderProcess` / `terminalBuffer`)**：引入 `src/worker/` 体系（包括 `render-worker.ts`、`terminal-writer.ts`、`compositor.ts`、`scene-manager.ts`），将布局计算、视口合成、行差分比对（Diffing）与 ANSI 输出移至后台，避免阻塞主 React 事件循环。
* **增量渲染与行级 Diff (`incrementalRendering`)**：仅对发生变化的行进行输出更新，极大减少频繁刷新时的终端闪烁（Flickering）和 CPU 消耗。
* **`debugRainbow` 模式**：调试时使用彩虹色交替标记每帧发生重绘的区域，便于排查性能瓶颈与多余重绘。

---

### 2. 备用屏幕缓冲区（Alternate Screen Buffer）
* **原生全屏 TUI 支持**：新增 `alternateBuffer` 与 `alternateBufferAlreadyActive` 渲染选项。进入应用时切换到终端的 Alternate Buffer，退出时自动恢复终端原有的输出和滚动记录（类似vim）。
* **上下文控制**：在 `AppContext` 中提供了全屏状态感知与动态配置项（`InkOptions`）。

---

### 3. 完善的滚动与滚动条系统（Scroll & Scrollbar）
* **Flex 滚动容器支持**：Box 组件深度结合 Yoga，支持 `overflow: 'scroll'`、`overflowX`、`overflowY`，并支持最大宽高限制（`maxWidth`、`maxHeight`，支持百分比与像素）。
* **滚动尺寸与状态度量 API**：导出了 `getScrollHeight`、`getScrollWidth`、`getScrollTop`、`getScrollLeft`、`getVerticalScrollbarBoundingBox`、`getHorizontalScrollbarBoundingBox` 等度量方法。
* **原生滚动条组件 (`scrollbar`)**：`<Box>` 增加了 `scrollbar` 属性，能够自动渲染终端滚动条滑块与轨道。
* **平滑滚动与动画支持 (`animatedScroll`)**：支持帧动画滚动并与终端 backbuffer 进行精细的同步管理。

---

### 4. 吸顶 / 吸底头部（Sticky Headers）
* **CSS 类似粘性定位**：`<Box>` 增加了 `sticky`、`stickyChildren` 和 `opaque` 属性。
* **滚动停靠机制**：在可滚动的 Box 容器中，带有 `sticky` 的子组件在滚动向上离开视口时会自动固定在容器顶部，直到被下一个粘性节点推走。
* **Backbuffer 保留**：支持 `stickyHeadersInBackbuffer`，在内容推入终端回滚历史时仍能保持吸顶头部的正确显示。

---

### 5. 新一代 `<StaticRender>` 与离线缓存（替代 `<Static>`）
* **解决 `<Static>` 的历史缺陷**：官方的 `<Static>` 无法在 Alternate Buffer 模式下良好工作，且无法嵌套。
* **`<StaticRender>` 组件**：将子树预先计算并缓存为 Yoga 布局树上的单个叶子节点（Region），大幅提升长列表与复杂组件的渲染帧率。
* **依赖感知与离线渲染**：
  * 支持类似 `useMemo` 的 `deps` 数组进行颗粒度失效与更新。
  * 提供 `renderToRegion(element)` API，支持离线或预计算生成静态区域缓存。

---

### 6. 输入法（IME）光标精准定位
* **硬件光标同步**：在 `<Text>` 组件上新增了 `terminalCursorFocus` 和 `terminalCursorPosition` 属性。
* **输入法弹窗对齐**：解决在终端多行文本输入或复杂 UI 布局下，中/日/韩文等输入法候选框定位飘到屏幕底部或错位的问题，将终端物理光标精准同步至当前输入字符的绝对坐标。

---

### 7. 文本选择与命中测试（Selection & Hit Testing）
* **选中区域管理**：导出了 `Selection`、`Range`、`comparePoints` 及 `selectionStyle`。
* **命中测试与坐标拾取**：新增 `hitTest`、`findNodeAtOffset`、`getText`、`getTextOffset`，支持基于鼠标或键盘在终端 UI 中进行文本划选与坐标定位。

---

### 8. 终端 ResizeObserver 与 React Layout Timing 对齐
* **`ResizeObserver` API**：在终端 DOM 节点上实现类似 Web 端的 `ResizeObserver` / `ResizeObserverEntry`，可监听元素尺寸变化并触发回调。
* **`standardReactLayoutTiming` 选项**：让 Ink 的渲染调度严格对齐标准 React `useLayoutEffect` 执行时机，确保在首帧绘制前能完成 DOM 尺寸度量。

---

### 9. 字符排版与测量底层增强
* **自定义字符宽度测量**：提供 `setStringWidthFunction`，允许外部（如 Gemini CLI）使用更高精度的光标探测法测量特殊字符/全角字符宽度。
* **复杂 Unicode 支持**：修复并增强了 Unicode 组合标记（Combining Marks，如泰语变音符等）和零宽字符的宽度计算与折行逻辑。
* **排版工具导出**：导出了 `StyledLine`、`wrapStyledChars`、`wordBreakStyledChars`、`styledCharsWidth` 等底层分词与排版工具。

---

### 10. 诊断回放（Replay）、基准测试与 Xterm 测试体系
* **录制与回放帧数据**：`AppContext` 新增 `startRecording()`、`stopRecording()`、`dumpCurrentFrame()` 以及 `src/replay.ts`，可将渲染帧序列导出为 JSON / 文本快照用于复现与排查布局 Bug。
* **无头终端端到端测试**：引入 `@xterm/headless` 验证最终 ANSI 序列在真实虚拟终端中的渲染结果，并支持输出为人类可读的 SVG 快照。
