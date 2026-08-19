# DSH Desktop Markdown 全量渲染与编辑改造方案

> 状态：方案文档。本文基于当前工作区代码整理，当前变更只新增本文档，不修改产品实现。

## 1. 目标与结论

用户期望 Markdown 文件中的表格以及其他 Markdown 扩展都能在当前文件面板中正常渲染，不因为语法被识别为“可能丢失”就自动切换到源码编辑。

最终行为应满足：

- `.md` 文件默认进入可视化编辑界面。
- 表格、任务列表、数学公式、脚注、front matter 和受控 HTML 都在可视化界面中呈现。
- 源码编辑是用户主动选择的辅助模式，不是语法不支持时的自动降级路径。
- 编辑过程中不能因为某个节点暂时无法解析而丢掉整份 Markdown。
- 保存继续使用现有 workspace 授权、版本守卫和冲突保护。
- 语法支持和文件大小限制分开处理，不能用“切换源码”掩盖 Host 端没有读到完整内容的问题。

“全部 Markdown”需要有明确语法范围。本文按 CommonMark、GFM、DSH 当前使用的数学分隔符、脚注、YAML front matter 和安全的 raw HTML 定义。MDX/JSX 是另一种语法，不应被当成普通 `.md` 的隐式扩展；若要渲染 MDX，需要单独设计不执行任意 JSX 的解析和安全模型。

## 2. 当前实现的实际数据流

### 2.1 文件加载链路

当前链路如下：

```text
文件链接
  -> WorkspacesOpenPathDecorator
  -> FilePreviewController.preview()
  -> DesktopFilePreviewGateway.probe()
  -> FilePreviewRegistry.resolve()
  -> DesktopFilePreviewGateway.readText()
  -> FilePreviewController.adoptReady()
  -> FilePreviewPanel
  -> MarkdownView
```

对应代码：

- `src/client/file-preview/controller.ts:259` 接收文件打开请求。
- `src/client/file-preview/controller.ts:264-286` 探测文件、解析 Provider 并开始读取。
- `src/client/file-preview/controller.ts:502-626` 按 Provider 的 `loadMode` 读取文本并发布 ready snapshot。
- `src/client/file-preview/FilePreviewPanel.tsx:147-165` 从 registry 找到 Provider 并传入文本、草稿和保存回调。
- `src/client/file-preview/providers/index.ts:20-26` 注册 Markdown、JSON、Image 和 Source Provider。

`MarkdownView` 收到的是一份完整字符串：

```text
content.text / saveState.draftText
  -> MarkdownEditor 的 defaultValueCtx
  -> Milkdown markdownUpdated
  -> updateDraft(markdown)
  -> FilePreviewController.updateDraft()
  -> 800ms 自动保存或 Ctrl/Cmd+S
  -> FilePreviewController.saveText()
  -> DesktopFilePreviewGateway.saveText()
```

### 2.2 当前 Markdown 模式

当前 `MarkdownView` 只有两个模式：

```ts
type ViewMode = 'edit' | 'source'
```

其中 `edit` 是 Milkdown/ProseMirror 所见即所得编辑器，`source` 是可编辑 `<textarea>`。当前没有独立的只读、完整 Markdown 渲染模式。

这导致两个问题被混在了一起：

1. 能否把 Markdown 正确渲染出来。
2. 能否把渲染后的结构无损地重新序列化成 Markdown。

这两个问题必须拆开设计。只读渲染器可以支持比当前编辑器更多的语法；编辑器则必须为每类可编辑语法提供 schema 和 serializer，否则修改后会丢内容。

## 3. 当前强制降级的代码原因

### 3.1 语法正则直接禁用编辑器

`src/client/file-preview/providers/MarkdownPreview.tsx:29-42` 的 `checkRoundTripSafety()` 使用正则检测以下内容：

- front matter。
- 表格。
- 任务列表。
- 数学公式。
- 脚注。
- HTML 注释。
- raw HTML。

命中任意一项后，`safe` 为 `false`。

### 3.2 预算和安全结果共同控制模式

`MarkdownPreview.tsx:129-132`：

```text
withinBudget = 文本不超过 256 KiB
canEditWysiwyg = withinBudget && safety.safe
```

`MarkdownPreview.tsx:199-204` 随后将模式强制改为源码：

```text
effectiveMode = canEditWysiwyg ? mode : 'source'
```

所以即使用户手动点击“编辑”，只要文件含表格或超过 256 KiB，编辑标签仍然会被禁用。

### 3.3 编辑器只加载 CommonMark

`src/client/file-preview/providers/MarkdownEditor.tsx:20-21` 引入 `@milkdown/preset-commonmark`，并在 `:118` 使用：

```text
editor.use(commonmark)
```

当前 `@milkdown/preset-commonmark` 的节点列表没有 table、task-list、footnote、math 或 front matter 节点。它有一个 `html` atom 节点（`node_modules/@milkdown/preset-commonmark/src/node/html.ts:12-55`），这个节点会把 raw HTML 作为带 `data-type="html"` 的文本 span 保留，既不会执行 HTML，也不会把 HTML 标签渲染成实际 DOM。现有 CSS 虽然已经在 `src/client/styles.ts:118-121` 为 `table/th/td` 提供样式，但 CSS 不会增加 Markdown parser 或 serializer 能力。

因此只删除“包含表格”的正则是不安全的：表格进入 CommonMark 编辑器后可能被当成普通段落，Milkdown 序列化时会改变或删除原始结构。raw HTML 则是另一类问题：当前可以安全保留源文本，但还没有满足“完整视觉渲染”的需求。

### 3.4 编辑器失败不会切换到真正的渲染视图

`MarkdownEditor.tsx:137-152` 在 `editor.create()` 失败时只设置 `failed`，并显示“所见即所得编辑器加载失败，请切换到源码编辑”。父组件没有独立的完整渲染路径，因此失败时用户只能看到错误或源码。

失败的直接原因也不是单纯的 React mount 问题：Milkdown Transformer 的 `ParserState.#matchTarget()`（当前 `node_modules/@milkdown/transformer/lib/index.js:66-79`）会为每个 mdast 节点寻找 `parseMarkdown.match`。如果 schema 没有对应节点，会直接抛出 `parserMatchError`，导致 `editor.create()` reject。因此“取消正则降级”后，必须同时为每类目标语法注册 schema，或提供 source-preserving raw 节点；否则应用只是从“主动切源码”变成“编辑器加载失败”。

### 3.5 Host 端还有独立的文件大小限制

语法降级之外，Host 端存在另一组限制：

- `src/index.ts:92-103` 允许配置 `maxTextBytes`，默认值为 2 MiB。
- `src/file-preview-gateway.ts:234-240` 超过该值会返回 `availability: 'oversized'`。
- `FilePreviewPanel.tsx:144-145` 对 oversized 只显示元数据和“系统打开”，不会返回文本。
- `file-preview-contract.ts:224-233` 对 save-text 的 wire 文本设置 8 MiB 上限。
- `file-preview-gateway.ts:313-315` 在进入写入前检查文本字节数，`:628-629` 将底层 `FS_TOO_LARGE` 映射为保存失败；两处都仍受 Host 配置的保存上限约束。

因此“全部渲染”如果也包含超过 2 MiB 的文件，不能只修改 Client；必须改成分块读取和分块提交，或者明确一个新的完整内容上限。简单删除 Client 的 256 KiB 判断仍然无法得到超过 Host 上限的内容。

## 4. 为什么不能只删除表格判断

只改 `MarkdownPreview.tsx` 中的这一条规则会产生以下风险：

1. 表格进入只支持 CommonMark 的 Milkdown schema。
2. 表格可能被解析成普通文本或段落。
3. `markdownUpdated` 回调把序列化结果作为新的完整草稿传回 Controller。
4. 用户按保存后，Host 会忠实地保存这份已经丢失结构的字符串。
5. 现有版本守卫只能防止覆盖外部修改，不能恢复编辑器已经丢掉的语法。

所以正确的修改顺序是：先补齐渲染和数据模型，再移除自动降级；不能反过来。

## 5. 目标架构

### 5.1 三种一等模式

将 Markdown Provider 的模式改为：

```text
edit    可视化编辑
preview 完整只读渲染
source  用户主动选择的源码编辑
```

建议默认进入 `edit`，模式切换由用户控制：

- `edit`：编辑节点，显示渲染后的文档结构。
- `preview`：使用完整安全渲染器查看最终效果，不产生草稿变化。
- `source`：保留原始 Markdown 的直接编辑能力。

语法、解析警告和文件大小都不能自动把用户切到 `source`。如果单个节点无法解析，应在 `edit` 或 `preview` 中显示该节点的原始内容和诊断信息，而不是替换整个文档模式。

### 5.2 以完整草稿文本为保存事实

保存事实仍然是 Controller 中的完整 Markdown 字符串，而不是 React DOM 或 ProseMirror DOM：

- `FilePreviewController.saveText()` 继续接收完整文本。
- `FilePreviewGateway.saveText()` 继续执行 workspace 重新授权和 `replaceIfVersion`。
- 编辑器只负责把结构化编辑转换为完整 draft。
- 预览模式只消费 draft，不改变 draft。
- 源码模式和可视化编辑模式共享同一份 draft，不各自维护互相覆盖的副本。

需要为解析文档保留 source position 和原始片段。对没有专用 schema 的节点使用 `raw-markdown` 节点，保存时直接取原始片段，避免未知内容被静默删除。

### 5.3 共享解析语法，分离渲染和编辑

建议建立 Desktop-owned 的 Markdown 文档层：

```text
Markdown source
  -> parser / mdast with source positions
  -> document model
       -> Preview renderer
       -> ProseMirror editor adapter
       -> source-preserving serializer
```

不能让预览器和编辑器各自使用一套不一致的正则或 parser。相同 fixture 必须同时验证预览 DOM 和编辑器序列化结果。

## 6. 解析和渲染能力

### 6.1 已有能力可以复用

当前已安装的 `@deepseek-ai/dsh-client-ui-primitives` 已导出 `MarkdownText`。其代码位于上游 `ui-primitives` 包，但 Desktop 不应修改 `deepseek-harness/` submodule。

已发布的 `MarkdownText` 当前支持：

- GFM 表格。
- 任务列表。
- 删除线和自动链接。
- GFM 脚注。
- 数学公式和 KaTeX。
- 代码块、链接、图片和常见 Markdown 节点。

上游实现中的依据：

- `packages/client/ui-primitives/src/markdown/parse.ts:26-43` 使用 GFM 和 math extensions。
- `packages/client/ui-primitives/src/markdown/render.tsx:261-296` 处理 HTML、math、table、footnote 等节点。
- `packages/client/ui-primitives/src/markdown/render.tsx:393-433` 完整渲染表格和列对齐。
- `packages/client/ui-primitives/tests/markdown.client.spec.tsx:313-334` 已验证数学公式和表格同时出现的情况。
- `packages/client/ui-primitives/tests/markdown-dom-parity.client.spec.tsx:197-241` 已包含脚注、raw HTML 和数学 fixture。

Desktop 可以直接复用已发布的 `MarkdownText` 作为 Preview renderer，不应从 `@deepseek-ai/dsh-client-ui-primitives/src/*` 引入未公开的源码实现，也不应修改上游 submodule。

### 6.2 需要 Desktop 自己补齐的能力

`MarkdownText` 的安全策略不是完整编辑模型：

- raw HTML 被作为文本保留，不进入 DOM；这保证了安全和 source preservation，但不是 HTML 的视觉渲染。
- front matter 没有专门的渲染分支，未知节点会被忽略。
- 其组件是只读 React renderer，不能直接承担编辑和 Markdown 序列化。

因此 Desktop 需要新增或扩展自有能力：

- `front_matter` block：展示可编辑的 YAML 元数据区域，并保留原始 delimiters。
- `raw_html` block/inline：复用 Milkdown 现有 `html` atom 的 source preservation，再由 Preview renderer 对严格 allowlist 内容进行清理后渲染；禁止 script、事件处理器、危险 URL 和 iframe 执行。
- `raw_markdown` block：保存未知扩展的原始 source span，在可视化界面中以受控的原始节点显示和编辑。
- `math_inline` / `math_block`：编辑时保留 TeX source，显示时复用 KaTeX。
- `footnote_definition` / `footnote_reference`：保持引用和定义关联。

“全部渲染”不意味着执行 Markdown 中任意 JavaScript。raw HTML 必须是 inert/sanitized DOM，否则会破坏当前文件查看器的信任边界。

### 6.3 编辑器依赖

`MarkdownEditor.tsx` 应从 CommonMark preset 扩展为 GFM preset：

- 增加 `@milkdown/preset-gfm: 7.22.1`，与现有 Milkdown 版本一致。
- GFM preset 提供 table schema、table editing、task-list 和 footnote 的基础实现。
- 增加 Desktop-owned math、front matter、raw HTML 和 raw Markdown 节点。
- 每个节点同时实现 DOM renderer、Markdown parser 和 Markdown serializer。
- 表格命令放入现有 toolbar overflow：新增行、删除行、新增列、删除列、对齐和删除表格。

如果 Milkdown 的扩展 API 无法保留某种原始节点的 source span，不能用静默丢弃作为替代；应采用 source-preserving block node 或改用块级 source map 编辑器。

## 7. 文件层面的修改方案

### 7.1 `MarkdownPreview.tsx`

当前核心逻辑：

- `checkRoundTripSafety()`。
- `MARKDOWN_PREVIEW_MAX_BYTES`。
- `canEditWysiwyg`。
- `effectiveMode`。
- `fallbackReason`。

改造后：

- 删除语法正则驱动的强制源码模式。
- 删除 256 KiB 驱动的强制源码模式。
- `ViewMode` 增加 `preview`。
- 维护一份共享 `draft`，三种模式都使用它。
- `preview` 使用 Desktop 完整渲染器。
- `edit` 使用完整节点编辑器。
- `source` 仅响应用户主动点击。
- 解析诊断显示在对应节点或文档顶部，不改变模式。
- editor mount 失败时保留 `preview` 和 `source` 操作，不能只显示空白编辑器。

### 7.2 `MarkdownEditor.tsx`

改造内容：

- `commonmark` 替换为 GFM 加 Desktop 扩展插件。
- 复用现有 `html` atom 的原始文本保留能力，并为 Preview 增加安全 HTML 渲染适配；另外增加表格、任务列表、数学、脚注、front matter、raw Markdown 节点。
- 增加表格结构操作命令。
- 增加 `onDiagnostic` 和 `onDocumentChange` 之类的明确回调，区分初始解析、用户事务和序列化错误。
- 初始加载时不触发 dirty/自动保存。
- 任何序列化失败都保留原始 source span，并在编辑区显示该节点，而不是生成空字符串。
- 编辑器销毁时释放所有插件和事件监听器。

### 7.3 新增 Markdown 文档层

建议新增以下 Desktop-owned 文件，避免把复杂 parser 逻辑继续堆到 React Provider 中：

```text
src/client/file-preview/markdown/
  document.ts
  parser.ts
  serializer.ts
  extensions.ts
  source-spans.ts
  diagnostics.ts
  render/MarkdownRenderView.tsx
  render/sanitize-html.ts
  nodes/FrontMatterNode.ts
  nodes/RawMarkdownNode.ts
  nodes/RawHtmlNode.ts
```

职责：

- `parser.ts`：统一解析 CommonMark/GFM/math/front matter/HTML。
- `document.ts`：保存带 source span 的文档模型。
- `serializer.ts`：把编辑器事务合并回完整 Markdown。
- `source-spans.ts`：保留未知节点和未编辑片段。
- `diagnostics.ts`：记录局部解析失败，不控制 ViewMode。
- `MarkdownRenderView.tsx`：Preview 只读渲染。
- `sanitize-html.ts`：raw HTML 安全清理。

### 7.4 `FilePreviewPanel.tsx` 与 Provider contract

当前 `FilePreviewPanel.tsx:171-174` 通过 `providerId === 'desktop.markdown'` 和 `saveState.draftText` 判断是否显示保存 UI。

需要把以下概念分开：

- Provider 是否支持可视化渲染。
- Provider 是否可编辑。
- 当前模式是否产生 draft。
- 当前是否有保存能力。

Preview 模式不应触发保存，但切换 Preview 前必须遵循现有 `refreshGuarded()`/`closeGuarded()` 的 dirty guard。编辑器内部解析失败不能直接触发 `ProviderErrorBoundary` 的系统打开分支；应优先渲染局部诊断和原始节点。

### 7.5 Host Gateway 和 wire protocol

如果目标只是不因语法切源码，现有 `probe/readText/saveText` 协议可以继续使用，2 MiB 是独立的文件查看上限。

如果目标是字节意义上的“任意大小都完整渲染”，必须新增分块协议：

```text
probe -> opaque resource + revision + total size
read-chunk(resourceId, offset, length) -> bounded UTF-8 chunk
save-begin(session, path, expectedRevision) -> opaque staging id
save-chunk(stagingId, sequence, text) -> acknowledgement
save-commit(stagingId) -> replaceIfVersion + new revision
```

要求：

- 每个 chunk 仍绑定 session、workspace、target、version 和 AbortSignal。
- `save-commit` 才执行原子写入。
- staging id 必须是 opaque branded id，并有 TTL、大小和数量上限。
- stale version 必须在 commit 时拒绝，不得部分写入。
- Controller 要把 chunk 读取/提交纳入现有 dispose、session switch 和 save queue 生命周期。
- 不能只把 `MAX_WIRE_TEXT_LENGTH` 提高到一个更大的固定数字后宣称无限支持。

## 8. 大文档渲染策略

删除 256 KiB 的 ViewMode 开关不等于可以无条件把任意大小文本一次性放进 DOM。

建议：

- Host 使用 chunk read，Client 逐块构建 parser 输入。
- Markdown parser 使用 Worker，避免阻塞 Electron renderer 主线程。
- 以 block 为单位建立 source span 和渲染缓存。
- 编辑器只挂载可见 block，或使用 ProseMirror block virtualization 方案。
- Preview 使用已有 incremental parser 思路，稳定 block 缓存，尾部增量更新。
- 超出安全资源上限时显示明确的资源错误，不切到源码；资源上限和语法模式是两个不同状态。

第一版如果暂不实现 chunk protocol，应在方案验收中明确“完整语法支持范围不包括超过 Host `maxTextBytes` 的文件”，不能把 oversized 元数据页描述为全量渲染。

## 9. 依赖与构建影响

当前 Desktop client bundle 由 `dsh-plugin-desktop/tsdown.config.ts:67-104` 构建：

- client 目标是 browser/CJS。
- 非 `@deepseek-ai/*` 依赖默认打入 bundle。
- `@deepseek-ai/dsh-client-ui-primitives` 是已有依赖，可以复用其公开 `MarkdownText`。
- 当前工作区 `dsh-plugin-desktop/lib/client.js` 的 raw 体积为 1,147,306 bytes，且 client 构建只有单一入口；新增编辑器能力会直接增加这个产物。
- Milkdown、GFM、math 和 sanitizer 依赖会增加 `lib/client.js` 体积。

依赖计划：

- `@milkdown/preset-gfm: 7.22.1`。
- Math/front matter/raw HTML 所需的直接依赖，不能依赖未声明的 transitive package。
- 若引入 sanitizer，优先选择维护中的 allowlist 库，并核对 browser bundle 体积。

每次依赖变化都要检查：

- `dsh-plugin-desktop/package.json`。
- 根 `yarn.lock`。
- `tsconfig.client.json` 和 `src/client/milkdown-node-next.d.ts` 的声明补丁。
- `tsdown.config.ts` 的 browser 条件解析和 noExternal 行为。
- 打包目录中的 `app.asar.unpacked` 依赖闭包。

## 10. 测试方案

### 10.1 Provider 和模式行为

新增或修改 `tests/file-preview-markdown-editor.client.spec.tsx`、`tests/file-preview-panel.client.spec.tsx`：

- 含表格的文档默认进入 edit，不显示降级提示。
- 含任务列表、数学、脚注、front matter、HTML 的文档仍进入 edit/preview。
- source 只有用户点击后才出现。
- edit、preview、source 三种模式切换共享同一份 draft。
- 单个节点解析失败不会让整个文档切到 source。
- 初始解析不会产生 dirty 或自动保存。

### 10.2 解析和渲染 fixture

建立 Desktop-owned corpus，至少覆盖：

- 多列、多行和三种对齐的 GFM 表格。
- 表格单元格中的中文、链接、粗体、数学和转义 `|`。
- 任务列表和勾选状态。
- inline/display math 以及 malformed TeX。
- 多次引用和多段脚注。
- front matter 与正文同时存在。
- 安全 HTML、script、事件属性和危险 URL。
- 未知扩展节点和不完整 Markdown。

每个 fixture 同时断言：

- Preview DOM 中存在对应结构。
- edit DOM 中存在对应节点。
- edit -> serialize 后语义和未编辑 source span 保持不变。
- 不能静默删除未知节点。

### 10.3 编辑器真实交互

使用 Chromium/Electron smoke 验证：

- 表格单元格点击、输入、Tab/Shift+Tab、增删行列。
- 中文 IME、复制粘贴、撤销/重做。
- 数学公式进入编辑态和离开编辑态。
- footnote 引用和定义仍然关联。
- front matter 编辑不会改变正文。
- raw HTML 不执行脚本。
- 窄面板下表格、公式和代码块不遮挡内容。

### 10.4 Host 和 Controller

如果采用 chunk protocol，新增覆盖：

- chunk 顺序、重复 chunk、缺失 chunk 和 abort。
- 多字节 UTF-8 边界。
- stale commit 不写入任何部分内容。
- dispose/session switch 清理 staging 资源。
- staging TTL、最大数量和总字节上限。

现有版本冲突、自动保存和离开守卫测试继续保留，不因新增渲染层绕过 `FilePreviewController`。

## 11. 实施顺序

建议按职责拆分，避免把编辑器、Host 协议和大型依赖混成一次不可回滚的修改：

1. 建立 Desktop-owned Markdown fixture 和能力矩阵，固定“全部渲染”的语法范围。
2. 增加 Preview 模式，复用已发布 `MarkdownText`，验证表格/GFM/math/footnote 的完整呈现。
3. 引入 `@milkdown/preset-gfm@7.22.1`，同步扩展 `milkdown-node-next.d.ts`，补齐 table/task-list/strikethrough 基础编辑和序列化。
4. 先移除 table、task-list 两条降级规则，并反转当前 front matter 回归测试前的行为预期；raw HTML 和 HTML comment 需要先验证现有 html atom 的保留结果，再移除对应规则。
5. 增加 front matter 原子节点和 source-preserving serializer。
6. 增加 math、footnote、raw Markdown 节点；每完成一种能力，就加入 round-trip fixture，再移除该语法的降级规则。
7. 所有目标节点具备 parser/schema/serializer 后，统一移除 `checkRoundTripSafety` 和 256 KiB 的 ViewMode 强制切换，启用三模式共享 draft 和局部诊断。
8. 若验收包含大文件，再实现 chunk read/save、Worker parser 和 block virtualization。
9. 完成 build、typecheck、focused tests、真实 Chromium smoke 和 packaged closure 验证，并记录 `lib/client.js` 体积增量。

中间开发阶段可以拆提交，但不得把“删掉规则、尚未注册对应 schema”的状态作为产品发布状态。最终产品行为不能保留“含已支持语法就自动源码”的旧规则。

## 12. 验收标准

### 语法

- 表格不再触发源码降级。
- CommonMark/GFM、任务列表、数学、脚注、front matter 和安全 HTML 均在可视化界面中呈现。
- 未知节点显示为受控的原始 Markdown 节点，不被静默删除。

### 模式

- `.md` 默认进入 edit。
- preview 是完整只读渲染，不产生草稿变化。
- source 只能由用户主动选择。
- 任何 parser 诊断都不会自动修改 ViewMode。

### 数据

- 未编辑文件不被规范化写回。
- 编辑后保存内容保留表格、公式、脚注、front matter 和 raw 节点。
- 保存仍经过 workspace 授权、`replaceIfVersion` 和 stale conflict 保护。
- 如果支持大文件，读取和保存都必须覆盖完整文本；不能只把界面改成“看起来支持”。

### 安全

- raw HTML 只以 inert/sanitized 形式显示。
- script、事件处理器、危险协议、workspace 外资源不会执行或加载。
- 不修改 `deepseek-harness/` submodule。

## 13. 当前建议的决策

推荐采用“完整 Preview + source-preserving WYSIWYG Editor + 手动 Source”三层方案：

- Preview 先复用已存在的 DSH Markdown 渲染能力，立即覆盖 GFM 表格、数学和脚注。
- Editor 使用 Milkdown GFM，并为现有 renderer 未覆盖的 front matter、raw HTML 和未知节点增加 Desktop-owned 节点。
- 保存继续由现有 Controller/Gateway 负责，不从组件直接写文件。
- 只有在需求明确包含超出 2 MiB Host 上限的文件时，才把 chunk read/save 作为必需的协议改造；否则应将该限制单独记录为文件大小能力边界。

本方案文档不包含产品代码修改。