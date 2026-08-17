# 右侧文件查看器代码软换行整改方案

## 1. 背景

右侧文件查看器缩小后，带语法高亮的代码行不会跟随面板宽度重新排版，而是在内容区底部出现横向滚动条。用户需要左右拖动才能读取一整行代码。

该现象主要出现在 TypeScript、JavaScript 等能够进入语法高亮路径的小型源码文件中。普通文本降级视图、Markdown 源码视图和 JSON 源码视图已经具备部分软换行能力，因此当前行为并不一致。

本文给出限定在 `dsh-plugin-desktop` 内的整改方案。目标是在不破坏语法高亮、行号、复制和通用会话工具卡行为的前提下，让右侧文件查看器中的源码随面板宽度自动换行，并消除横向滚动条。

## 2. 现状与渲染链路

源码文件的主要渲染链路如下：

```text
点击文件
  -> FilePreviewController
  -> Source Provider
  -> SourceView
  -> ReadBlock
  -> Shiki token spans + 行号 gutter
```

`src/client/file-preview/providers/SourcePreview.tsx` 根据文件大小和逻辑行数选择两条路径：

| 路径 | 条件 | 当前渲染方式 | 当前换行行为 |
| --- | --- | --- | --- |
| 高亮路径 | 不超过 512 KiB 且不超过 10,000 行 | `ReadBlock` | 不换行，横向滚动 |
| 普通文本降级 | 超过任一高亮阈值 | `<pre className="dshDesktopSourcePlain">` | `pre-wrap`，可以换行 |

截图中的 TypeScript 文件体积很小，因此进入的是 `ReadBlock` 高亮路径，而不是已经修复过的普通文本降级路径。

## 3. 根因分析

### 3.1 `ReadBlock` 明确采用不换行设计

已发布的 `@deepseek-ai/dsh-client-ui-primitives@0.1.0-rc.6` 中，`ReadBlock` 的结构为：

```text
div[data-read]
  div banner
  div body
    div line
      span gutter
      span content
        span token...
```

其上游样式包含以下关键规则：

```css
.body {
  overflow-x: auto;
  overflow-y: hidden;
}

.line {
  display: flex;
  white-space: pre;
}
```

`white-space: pre` 强制每个逻辑行保持单行，`overflow-x: auto` 则在内容宽于面板时生成横向滚动条。这是当前问题的直接原因。

### 3.2 上一次修复只覆盖普通文本路径

提交 `d139509f59` 将 `.dshDesktopSourcePlain` 从 `white-space: pre` 改成了：

```css
white-space: pre-wrap;
overflow-wrap: anywhere;
```

该改动覆盖了普通文本降级、Markdown 源码和 JSON 源码，但没有覆盖小文件默认使用的 `ReadBlock` 高亮路径。提交说明和设计文档还明确保留了高亮路径的横向滚动，因此当前现象是整改范围遗漏，不是浏览器偶发问题。

### 3.3 右栏布局不是根因

`src/client/layout-state.ts` 已将文件栏宽度限制为：

```text
FILE_MIN     = 360
FILE_DEFAULT = 640
FILE_MAX     = 900
```

`AdvancedFrame`、第三列容器和文件内容容器也已设置必要的 `min-width: 0`。缩小面板只是暴露了代码行的固有最小宽度，没有造成第三列网格本身被撑开。

本次整改不需要修改：

- `layout-state.ts`
- `AdvancedFrame.tsx`
- `FilePreviewController`
- Host 文件协议和 Gateway
- Provider 分类和高亮阈值

## 4. 整改目标

整改后应满足以下要求：

1. 右侧文件查看器中的高亮源码随面板宽度自动软换行。
2. 长标识符、URL、压缩代码等无空格内容也能够断行。
3. 源码内容区不再出现横向滚动条。
4. 一个逻辑行只显示一次行号，折行部分继续从代码内容列开始。
5. Shiki 高亮 token、文本选择和浏览器查找继续工作。
6. 复制操作仍返回原始文件文本，不包含行号，也不包含软换行产生的视觉换行。
7. 面板拖动时由 CSS 即时重新排版，不触发文件重新读取。
8. 会话消息流中的通用 `ReadBlock` 保持原来的不换行行为。
9. 不新增换行开关，不引入额外 React state 或 `ResizeObserver`。

## 5. 方案选择

### 5.1 推荐方案：桌面文件查看器内的作用域覆盖

`ReadBlock` 已公开 `className` 属性，并将它合并到 `data-read` 根节点。Source Provider 可以利用该入口增加桌面文件查看器专用类名，然后用更高特异性的作用域样式覆盖内部换行和横向溢出规则。

推荐方案的优点：

- 改动限制在 `dsh-plugin-desktop`。
- 不修改或 patch 已发布的 DSH 包。
- 不影响消息流中的 read 工具卡。
- 保留现有 Shiki、行号、复制和懒加载 grammar 行为。
- 不需要改变文件协议、Controller 或 Provider 接口。

### 5.2 不采用的方案

以下方案不建议用于本次整改：

| 方案 | 不采用原因 |
| --- | --- |
| 全局覆盖 `[data-read]` | 会改变会话中所有 read 工具卡的布局，影响面过大 |
| 强制所有源码进入普通 `<pre>` | 会丢失语法高亮、行号和现有复制工具栏 |
| 在 JavaScript 中按宽度插入换行符 | 会污染复制文本和行号语义，并需要复杂的字体测量与 resize 状态 |
| 直接修改相邻 `deepseek-harness` checkout | Desktop 当前固定使用已发布的 rc.6 包，且项目约束要求不改上游 submodule pin |
| 只设置 `overflow-x: hidden` | 只会隐藏超出内容，无法保证代码真正可读 |

未来如果上游 `ReadBlock` 正式提供 `wrapLines` 或类似属性，可以删除本地内部结构选择器并改用公开属性。本次不为此引入上游发布依赖。

## 6. 具体改动方案

### 6.1 为文件查看器中的 `ReadBlock` 增加稳定作用域

修改：

```text
src/client/file-preview/providers/SourcePreview.tsx
```

为 `ReadBlock` 增加调用方类名：

```tsx
<ReadBlock
  className="dshDesktopSourceReadBlock"
  label={descriptor.name}
  lang={descriptor.language}
  lines={lines}
  totalLines={lines.length}
  maxLines={lines.length}
/>
```

同时更新文件头注释，删除“Source always renders non-wrapping”的陈述，明确说明：

- 上游 `ReadBlock` 默认仍不换行。
- Desktop 文件查看器通过作用域类启用软换行。
- 复制继续使用原始文本。

### 6.2 覆盖高亮路径的横向滚动与行布局

修改：

```text
src/client/styles.ts
```

建议样式如下：

```css
.dshDesktopSourceView {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dshDesktopSourceBody {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.dshDesktopSourceReadBlock {
  min-width: 0;
  max-width: 100%;
}

/* ReadBlock 的最后一个直接 div 是源码 body。 */
.dshDesktopSourceReadBlock > div:last-child {
  overflow-x: hidden;
}

/* body 下的直接 div 是带 gutter 的源码逻辑行。 */
.dshDesktopSourceReadBlock > div:last-child > div {
  align-items: flex-start;
  white-space: pre-wrap;
}

/* 每行最后一个直接 span 是源码内容，前一个 span 是固定行号 gutter。 */
.dshDesktopSourceReadBlock > div:last-child > div > span:last-child {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}
```

这些规则承担不同职责，不能只保留其中一部分：

- `white-space: pre-wrap` 保留缩进和原始换行，同时允许视觉折行。
- `overflow-wrap: anywhere` 处理没有空格的长 token。
- `min-width: 0` 允许源码 flex item 缩小到面板宽度。
- `overflow-x: hidden` 关闭 `ReadBlock` 原有横向滚动容器。
- `align-items: flex-start` 使行号稳定停留在折行后的第一视觉行顶部。

选择器必须以 `.dshDesktopSourceReadBlock` 开头，禁止改成全局 `[data-read]` 规则。

### 6.3 收紧普通源码路径的滚动轴

当前 `.dshDesktopSourcePlain` 已具备：

```css
white-space: pre-wrap;
overflow-wrap: anywhere;
```

建议将其模糊的 `overflow: auto` 改为：

```css
overflow-x: hidden;
overflow-y: auto;
```

这样高亮路径、普通文本降级、Markdown 源码和 JSON 源码都具有一致的横向溢出契约。

### 6.4 保持原始文本语义

软换行必须完全由 CSS 实现，不得修改 `content.text`、`ReadBlockLine.text` 或 `toLines()` 的输出。

由此可以保证：

- `ReadBlock` 的复制按钮继续复制 `lines.map(...).join('\n')`。
- 普通文本复制继续使用原始 `content.text`。
- 浏览器文本选择不会包含行号 gutter。
- 面板变宽后视觉折行会自动恢复，不存在人工插入换行残留。

## 7. 文件影响范围

| 文件 | 改动内容 |
| --- | --- |
| `src/client/file-preview/providers/SourcePreview.tsx` | 给 `ReadBlock` 增加作用域类名，更新行为注释 |
| `src/client/styles.ts` | 增加高亮路径软换行规则，明确 Source 两条路径的滚动轴 |
| `tests/file-preview-panel.client.spec.tsx` | 增加 Source Provider 高亮路径、长行、行号和复制测试 |
| `tests/client-environment.spec.ts` | 锁定注入样式中的作用域、`pre-wrap`、`anywhere` 和横向溢出规则 |
| `docs/file-viewer-design.zh.md` | 将三处“高亮路径保留横向滚动”修订为 Desktop 作用域软换行 |
| `docs/file-viewer-wrap-remediation.zh.md` | 本整改方案文档 |

不应修改根 Yarn lock、上游 `deepseek-harness` submodule 或 Host 文件协议。

## 8. 自动化测试方案

### 8.1 Source Provider 组件测试

在 `tests/file-preview-panel.client.spec.tsx` 中增加一个真实 Source Provider 用例，使用低于高亮阈值的 TypeScript 内容，例如：

```ts
export function greet({ name, excited = false }: GreetingOptions): string {
  return excited ? `Hello, ${name}!` : `Hello, ${name}.`
}
```

再加入一个无空格长 token，例如：

```text
https://example.test/a-very-long-path-without-natural-break-points/...
```

主要断言：

1. 渲染结果进入 `ReadBlock`，而不是 `.dshDesktopSourcePlain`。
2. `data-read` 根节点具有 `dshDesktopSourceReadBlock` 类。
3. 行号 gutter 仍按逻辑行数量渲染。
4. 源码文本和 Shiki token span 仍存在。
5. 点击复制后写入剪贴板的是原始文本，没有行号或额外换行。
6. Grammar 懒加载后的重渲染不会移除作用域类名。

### 8.2 注入样式契约测试

`tests/client-environment.spec.ts` 已通过 `installAdvancedStyles()` 捕获最终注入 CSS。应增加针对以下规则的断言：

- `.dshDesktopSourceBody` 使用 `overflow-x: hidden` 和 `overflow-y: auto`。
- `.dshDesktopSourceReadBlock` 的规则存在且被限制在 Desktop 类下。
- 行规则使用 `white-space: pre-wrap`。
- 内容 span 使用 `min-width: 0` 和 `overflow-wrap: anywhere`。
- CSS 中不存在会全局覆盖所有 `[data-read]` 的规则。

### 8.3 jsdom 的能力边界

jsdom 不执行真实字体排版，不能可靠证明 `scrollWidth`、`clientWidth` 和视觉换行。因此组件测试只能锁定结构、样式契约和复制语义，不能代替真实 Chromium 几何验证。

## 9. 真实 UI 验证矩阵

使用实际 Electron/Chromium 页面验证以下组合：

| 项目 | 验证值 |
| --- | --- |
| 文件栏宽度 | 360、480、640、900 px |
| 应用窗口宽度 | 900、1024、1440 px、宽屏 |
| 文件类型 | TypeScript、JavaScript、CSS、Markdown 源码、JSON 源码、diff/patch |
| 内容形态 | 普通长行、长 URL、长标识符、连续空格、Tab、中文、emoji |
| 主题 | 明亮、暗色 |
| 内容规模 | 高亮阈值内、超过高亮阈值的普通文本降级 |

浏览器控制台或自动化探针应检查：

```js
sourceBody.scrollWidth <= sourceBody.clientWidth + 1
readBody.scrollWidth <= readBody.clientWidth + 1
```

同时人工确认：

- 拖动右栏时代码实时重排。
- 内容区底部不出现横向滚动条。
- 垂直滚动保持正常。
- 行号只显示在每个逻辑行的第一视觉行。
- 折行部分与代码内容列对齐，不进入行号 gutter。
- 文本选择、复制和浏览器查找正常。
- 文件栏变宽后折行自然减少。
- Header、语言标签和复制按钮没有重叠。

## 10. 验收标准

以下条件全部满足后才可认为整改完成：

1. 高亮 Source 路径在文件栏最小宽度 360 px 下没有横向滚动条。
2. 长 URL 和无空格 token 不会被裁切。
3. `.dshDesktopSourcePlain` 同样不产生横向滚动。
4. 行号、Shiki 高亮和复制原文行为通过测试。
5. 消息流中的通用 `ReadBlock` 行为没有变化。
6. Markdown 预览、JSON 树和图片 Provider 没有回归。
7. focused tests、完整测试、typecheck、build 和 package gate 全部通过。
8. `deepseek-harness` submodule 文件和 pin 均未发生变化。
9. 在真实 Electron 页面完成 360、480、640 px 文件栏验证。

## 11. 风险与控制措施

### 11.1 依赖 `ReadBlock` 内部 DOM 结构

本地 CSS 需要定位 `ReadBlock` 的 body、line、gutter 和 content。虽然 rc.6 的结构稳定，但它不是完整的公开样式 API。

控制措施：

- 通过 `className` 将覆盖严格限制在 Desktop Source Provider。
- 增加结构契约测试，升级 DSH 包时让 DOM 变化显式失败。
- 在代码注释中写明直接子节点的语义。
- 上游未来提供正式 wrap 属性后迁移并删除本地内部选择器。

### 11.2 `overflow-x: hidden` 掩盖错误

如果只隐藏横向溢出而软换行规则失效，内容可能被裁切。

控制措施：

- 同时设置 `pre-wrap`、`overflow-wrap: anywhere` 和 `min-width: 0`。
- 真实浏览器验收必须检查 `scrollWidth <= clientWidth + 1`，不能只看滚动条是否消失。

### 11.3 超长单行的排版成本

一个接近 512 KiB 的单逻辑行在 360 px 宽度下可能产生大量视觉折行。该方案不会为每个视觉折行创建额外 React 节点，但 Chromium 仍需要执行文本排版。

控制措施：

- 保留现有 512 KiB 和 10,000 行高亮阈值。
- 不在 resize 事件中重新切分字符串或重建 token。
- 真实 UI 验证加入接近阈值的长行样本，观察拖动流畅度。

## 12. 实施顺序

建议按以下顺序实施：

1. 在 `SourcePreview.tsx` 为 `ReadBlock` 增加作用域类名。
2. 在 `styles.ts` 完成高亮行软换行和滚动轴整改。
3. 收紧 `.dshDesktopSourcePlain` 的横向溢出规则。
4. 增加 Source Provider 组件测试和 CSS 契约测试。
5. 更新 `file-viewer-design.zh.md` 中与新行为冲突的三处描述。
6. 执行 focused tests、typecheck 和 build。
7. 执行完整 `check` 和 Git 边界检查。
8. 启动实际 Desktop generation，按 UI 矩阵完成验收。

## 13. 验证命令

在仓库根目录执行：

```powershell
yarn workspace dsh-plugin-desktop test tests/file-preview-panel.client.spec.tsx tests/client-environment.spec.ts
yarn workspace dsh-plugin-desktop typecheck
yarn workspace dsh-plugin-desktop build
yarn workspace dsh-plugin-desktop test
yarn workspace dsh-plugin-desktop check
git diff --check
git diff --submodule=short -- deepseek-harness
git status --short
```

## 14. 构建与当前 GUI 注意事项

当前 `http://127.0.0.1:63961` 由已打包的 `DSH Desktop.exe` 提供，当前没有 `pnpm run dev:web`、Node、pnpm 或 Yarn watcher 在运行。

因此实施后的源码改动不会通过页面刷新自动进入当前 GUI。必须执行以下任一验证路径：

1. 在源码仓库运行 `yarn workspace dsh-plugin-desktop dev`，验证新启动的 Desktop generation。
2. 完成 build/package 后更新实际 Desktop 安装内容并重启应用。

不得在没有重新构建客户端 bundle 的情况下，仅刷新当前页面并据此判断整改是否生效。
