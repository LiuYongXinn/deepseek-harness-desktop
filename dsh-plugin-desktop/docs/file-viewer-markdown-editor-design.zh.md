# 右侧文件查看器 Markdown 可编辑预览方案

## 1. 背景

当前 DSH Desktop 高级模式已经具备右侧文件查看器，支持 Source、Markdown、JSON 和 Image Provider。设计上，`.md` 文件应优先进入 Markdown Provider，并在文件不超过 256 KiB 时默认显示渲染后的 Markdown 预览。

实际运行中，普通 `.md` 文件会落入 Source Provider，表现为始终显示 Markdown 源码。与此同时，现有 Markdown 预览基于只读 `MarkdownText`，即使 Provider 正确命中，也不能在渲染后的文档中直接编辑和保存。

本文给出分阶段整改方案：

1. 修复 `.md` 和 `.json` 运行时 Provider 选择错误。
2. 为文件查看器增加受 workspace 约束、带版本冲突保护的文本保存协议。
3. 将 Markdown 默认视图升级为类似 Typora 的可编辑所见即所得界面。
4. 在后续迭代补齐本地图片、相对链接、草稿恢复和高级 Markdown 语法。

所有改动限定在 `dsh-plugin-desktop`，不修改 `deepseek-harness/` pinned 上游子模块。

## 2. 当前实现与确定根因

### 2.1 当前 Markdown 渲染链路

```text
点击 .md 文件
  -> WorkspacesOpenPathDecorator
  -> FilePreviewController.probe()
  -> DesktopFilePreviewGateway
  -> FilePreviewDescriptor
  -> FilePreviewRegistry.resolve()
  -> MarkdownView 或 SourceView
```

Provider 优先级为：

| Provider | Priority | 匹配规则 |
| --- | ---: | --- |
| JSON | 400 | `descriptor.extension === '.json'` |
| Markdown | 350 | `descriptor.extension === '.md'` |
| Image | 300 | `descriptor.contentKind === 'image'` |
| Source | 100 | `descriptor.contentKind === 'text'` |

理论上 `.md` 同时匹配 Markdown 和 Source，最终应由优先级 350 的 Markdown Provider 接管。

### 2.2 扩展名契约错位

`src/file-preview-formats.ts` 中的 `classifyFileName()` 明确返回不带前导点的扩展名：

```text
readme.md -> md
config.json -> json
```

但 `FilePreviewDescriptor.extension` 的合同要求扩展名包含前导点：

```text
.md
.json
```

`src/file-preview-gateway.ts` 的 `createDescriptor()` 和 `oversizedDescriptor()` 当前直接写入 `classifyFileName(...).extension`，因此运行时 descriptor 实际携带的是 `md` 或 `json`。Markdown/JSON Provider 判断的却是 `.md` 和 `.json`，最终都不会匹配，文本文件被通用 Source Provider 接管。

这是 `.md` 文件始终显示源码的直接原因。JSON 树视图也存在同一潜在问题。

### 2.3 现有测试为何没有发现

当前 registry 和 panel 测试手工构造 descriptor，并直接写入：

```ts
extension: '.md'
extension: '.json'
```

测试没有把真实 Host Gateway 生成的 descriptor 交给真实 Provider Registry，因此没有覆盖 Host 分类结果与 Client Provider 匹配之间的合同。

### 2.4 当前 MarkdownView 仍是只读视图

`src/client/file-preview/providers/MarkdownPreview.tsx` 当前行为为：

- 默认 mode 是 `preview`。
- 不超过 256 KiB 时使用 `MarkdownText`。
- 超过 256 KiB 时强制进入 Source。
- Source 使用只读 `<pre>`。

`MarkdownText` 是为不受信任的 assistant 输出设计的安全只读渲染器：

- 没有编辑事务、选区、撤销、光标和 Markdown 序列化能力。
- raw HTML 被省略。
- 相对链接和本地文件图片不会加载。
- 无法通过给外层增加 `contentEditable` 稳定回写 Markdown。

因此 Typora 式能力必须接入专门的 Markdown 编辑内核，不能在 `MarkdownText` 上直接改造。

## 3. 整改目标

整改后应满足：

1. 普通 `.md` 文件默认命中 Markdown Provider。
2. 默认模式为渲染后的可编辑文档，而不是源码。
3. 支持标题、段落、粗体、斜体、链接、列表、任务项、引用、表格和代码块。
4. 支持撤销/重做、保存按钮和 `Ctrl/Cmd+S`。
5. 显示 `已保存`、`未保存`、`保存中`、`保存失败` 和 `文件冲突` 状态。
6. 保存必须是 workspace 内、用户直接发起的原子写入。
7. Agent 或外部程序修改同一文件后，用户保存不得静默覆盖新版本。
8. raw HTML 不执行，`file:` 和 workspace 外资源不能加载。
9. `.mdx` 继续进入 Source Provider，避免 JSX 结构在普通 Markdown 序列化中丢失。
10. 大文件或无法无损解析的文档必须安全退回源码模式，并说明原因。
11. 兼容模式和会话消息流中的 Markdown 渲染行为不变。

## 4. 非目标

第一阶段不实现：

- 完整 IDE 或语言服务。
- Markdown 多人实时协作。
- 无提示强制覆盖外部修改。
- 任意 workspace 外路径写入。
- 把 MDX 当作普通 Markdown 编辑。
- 直接执行 raw HTML、脚本或不受信任 iframe。
- 修改 pinned `deepseek-harness` checkout。

## 5. 技术选型

### 5.1 推荐：Milkdown + ProseMirror

推荐依赖：

- `@milkdown/kit`
- `@milkdown/react`

Milkdown 是 Markdown-first 的 ProseMirror 编辑器，可从 Markdown 建立结构化文档，也能重新序列化为 Markdown。ProseMirror 已处理浏览器选区、中文 IME、撤销、剪贴板和复杂文档事务，适合实现类似 Typora 的所见即所得编辑。

参考：

- <https://milkdown.dev/docs/recipes/react>
- <https://milkdown.dev/docs/guide/interacting-with-editor>

首版不直接采用完整 `@milkdown/crepe` UI。Crepe 提供更多开箱即用的工具栏和 block UI，但会带入自己的视觉体系和更大的客户端体积。Desktop 应使用现有 DSH token 和 UI primitives 构建紧凑工具栏。

### 5.2 不采用的方案

| 方案 | 不采用原因 |
| --- | --- |
| `MarkdownText` + `contentEditable` | 浏览器修改的是渲染 DOM，无法可靠恢复原始 Markdown 结构 |
| Lexical | 富文本优先，Markdown 往返和未知语法保留成本较高 |
| Tiptap | 同为 ProseMirror，但 Markdown 能力不是其最核心的数据模型 |
| CodeMirror 6 | 适合源码编辑和实时装饰，不是真正的所见即所得体验 |
| 自研 Markdown 编辑器 | 光标、IME、选区、历史和解析规则复杂度过高 |

如果未来要求逐字符保留列表符号、空行和强调标记，应重新评估 CodeMirror live preview；Milkdown 保存时可能规范化 Markdown 表达，但应保持语义等价。

## 6. 分阶段实施方案

### 6.1 P0：修复 Provider 选择

修改 `src/file-preview-gateway.ts`，统一 descriptor 扩展名格式：

```ts
const rawExtension = classifyFileName(name).extension
const extension = rawExtension === '' ? '' : `.${rawExtension}`
```

`createDescriptor()` 和 `oversizedDescriptor()` 必须共用同一个转换函数，禁止继续直接写入 classifier 的内部格式。

同时收紧 `src/file-preview-contract.ts`：

- `extension` 必须为 `''` 或以 `.` 开头。
- 必须为小写。
- 长度必须有界。

Provider 匹配改成语义优先：

```text
Markdown:
  contentKind === 'text'
  mediaType === 'text/markdown'
  language === 'markdown'

JSON:
  contentKind === 'text'
  mediaType === 'application/json'
  language === 'json'
```

这样既修复当前扩展名问题，也能继续让 `.mdx` 和 `.jsonc` 进入 Source Provider。

该阶段应独立提交和验证，使只读 Markdown 预览先恢复正常。

### 6.2 P1：增加带版本守卫的保存协议

#### 6.2.1 为什么不能继续使用 resourceId

当前 Controller 在成功读取文本后立即释放 resource token，默认 token TTL 也只有 60 秒。编辑会话可能持续数分钟，不能把现有 resourceId 当作长期保存凭据。

保存协议应使用读取内容对应的 opaque revision，并在每次保存时重新授权路径。

#### 6.2.2 Wire contract

扩展 `src/file-preview-contract.ts`：

```text
RPC endpoint: save-text
```

`read-text` 成功结果增加 revision：

```ts
{
  status: 'ok'
  text: string
  resourceId: FilePreviewResourceId
  revision: FilePreviewRevision
}
```

新增请求：

```ts
interface FilePreviewSaveTextRequest {
  sessionId: string
  path: string
  expectedRevision: FilePreviewRevision
  text: string
}
```

新增结果：

```ts
type FilePreviewSaveTextResult =
  | {
      status: 'ok'
      revision: FilePreviewRevision
      text: string
      size: number
    }
  | {
      status: 'conflict'
      code: 'stale-version'
      message: string
    }
  | {
      status: 'error'
      code: string
      message: string
      retryable: boolean
    }
```

所有请求和响应继续由浏览器安全 parser 逐字段校验。

#### 6.2.3 Host 保存算法

`DesktopFilePreviewGateway.saveText()` 每次保存执行：

1. 校验 payload 和 UTF-8 字节上限。
2. 根据 session membership 或 subagent lineage 找到 workspace。
3. `fs.resolve()` workspace root。
4. 以 workspace 为 cwd 重新解析原始 path。
5. `fs.contains()` 验证目标仍在 workspace 内。
6. 确认目标仍是普通 `.md` 文本文件。
7. 调用带版本守卫的原子写入：

```ts
fs.writeText(
  target,
  text,
  { kind: 'replaceIfVersion', version: expectedRevision },
  signal,
  {
    mode: 'workspace-write',
    workspaceRoot: workspace.path,
    sessionId: SessionId(sessionId),
  },
)
```

该写入来自用户在 loopback Desktop UI 中的直接操作，因此不进入模型审批流程；但能力始终被限制在当前 workspace，禁止使用 `danger-full-access`。

错误映射：

| FsError | UI 结果 |
| --- | --- |
| `FS_STALE_VERSION` | `conflict`，保留本地草稿 |
| `FS_PERMISSION_DENIED` | 保存失败，可重试 |
| `FS_SANDBOX_DENIED` | 保存失败并记录配置错误 |
| `FS_NOT_FOUND` | 文件已删除/移动 |
| `FS_NOT_REGULAR_FILE` | 文件类型已变化 |
| `FS_TOO_LARGE` | 内容超过编辑上限 |
| `FS_ABORTED` | 当作取消，不覆盖当前编辑状态 |

禁止在 stale 后自动读取新 revision 并覆盖，因为这会绕过并发保护。

### 6.3 P2：接入可编辑 Markdown UI

新增：

```text
src/client/file-preview/providers/MarkdownEditor.tsx
```

调整 `MarkdownPreview.tsx`：

- mode 从 `preview | source` 改为 `edit | source`。
- 默认 mode 为 `edit`。
- `edit` 使用 Milkdown/ProseMirror。
- `source` 使用可编辑 textarea，与 Milkdown 文档双向同步。
- 超过编辑阈值或无法安全往返的文档默认进入 source，并显示明确提示。

编辑器工具栏应包含：

- 保存。
- 撤销/重做。
- 段落、H1、H2、H3。
- 粗体、斜体。
- 链接。
- 无序列表、有序列表、任务列表。
- 引用、行内代码、代码块。
- 其余低频操作放入 overflow menu，避免 360 px 宽度下溢出。

交互状态：

```text
clean -> dirty -> saving -> clean
                    |
                    +-> error
                    +-> conflict
```

保存行为：

- `Ctrl/Cmd+S` 立即保存。
- 停止输入约 800 ms 后自动保存。
- 同一时刻只允许一个保存请求。
- 保存期间继续输入时，成功结果只能确认该次请求对应的 draft；新输入保持 dirty 并排队下一次保存。
- 保存成功后更新 baseline revision。
- conflict 后暂停自动保存，不能继续向磁盘发送旧 revision。

冲突 UI：

- `重新加载磁盘版本`：必须确认会丢弃本地草稿。
- `复制本地草稿`：写入剪贴板。
- `继续编辑`：仅保留草稿，不保存。
- 第一版不提供无提示强制覆盖。

### 6.4 Controller 与离开守卫

扩展 `FilePreviewController`：

- `saveText(text, revision)`。
- 注册/释放当前 Provider 的 before-leave guard。
- 打开另一个文件前 flush dirty draft。
- 点击刷新前 flush 或显式确认放弃。
- 点击关闭前 flush。
- 保存失败或冲突时取消离开并保持当前编辑器可见。
- dispose 时 abort 未发布的保存请求。

`AdvancedFrame` 当前在 session identity 变化后同步关闭文件表面。session 已切换时不能可靠阻止导航，因此必须同时依赖自动保存；后续 P3 增加本地草稿恢复，覆盖应用崩溃、窗口强制关闭和 session 快速切换。

### 6.5 Markdown 往返和安全策略

Milkdown 可能规范化：

- 列表使用的 `*`、`-` 或 `+`。
- ATX/Setext 标题形式。
- 强调标记 `_` 和 `*`。
- 空行和表格对齐空格。

规则：

1. 用户未编辑时不得写回文件。
2. 首次编辑后允许语义等价的规范化。
3. 不支持的语法不能静默删除。
4. raw HTML 必须作为 inert 节点保留或触发 source fallback，绝不执行。
5. front matter、数学公式、脚注和 HTML comment 必须进入 round-trip fixture；没有保留能力前不能宣称支持。
6. `.mdx` 始终走 Source Provider。

如果 parser 检测到未知或无法无损表示的节点，WYSIWYG 模式应禁用保存，用户仍可在源码模式编辑。

### 6.6 P3：补齐 Typora 体验

后续独立实现：

1. 本地草稿恢复。
2. 相对 Markdown 链接打开 Desktop 文件查看器。
3. workspace 内相对图片通过受控 token URL 加载。
4. 数学公式、front matter、脚注和 inert raw HTML 节点。
5. 外部修改后的草稿/磁盘 diff。
6. 二次确认后的显式覆盖操作。
7. 大文档性能验证后提高 256 KiB 编辑阈值。

本地图片不能直接使用 `file:` URL。应新增 Host 资源解析接口，重新执行 workspace containment 和 MIME/signature 检查，再返回同源 loopback token URL。

## 7. 文件影响范围

| 文件 | 改动 |
| --- | --- |
| `src/file-preview-formats.ts` | 保持 classifier 内部扩展名格式；可选增加 `.markdown` |
| `src/file-preview-contract.ts` | extension 校验、revision、save endpoint、请求/结果 parser |
| `src/file-preview-gateway.ts` | descriptor 格式修复、保存授权、版本守卫原子写入 |
| `src/index.ts` | 保存上限配置投影；不新增 composition row |
| `src/client/file-preview/gateway.ts` | Client `saveText()` RPC |
| `src/client/file-preview/controller.ts` | 保存、冲突、AbortController 和离开守卫 |
| `src/client/file-preview/registry.ts` | Provider props 增加保存和编辑生命周期 callback |
| `src/client/file-preview/FilePreviewPanel.tsx` | 保存状态、刷新/关闭守卫连接 |
| `src/client/AdvancedFrame.tsx` | 连接 Controller 保存/关闭方法 |
| `src/client/file-preview/providers/MarkdownPreview.tsx` | `edit/source` 策略和安全降级 |
| `src/client/file-preview/providers/MarkdownEditor.tsx` | 新增 Milkdown adapter |
| `src/client/styles.ts` | 编辑器排版、工具栏、状态和响应式样式 |
| `dsh-plugin-desktop/package.json` | Milkdown 直接依赖 |
| 根 `yarn.lock` | Yarn 依赖锁定 |
| `docs/file-viewer-design.zh.md` | 从纯只读查看器更新为 Markdown 特例可编辑 |

不修改：

- `deepseek-harness/` submodule 内容或 pin。
- compatibility 模式 composition。
- Source、Image 的 Host 读取协议。
- 会话消息流中的 `MarkdownText`。

## 8. 自动化测试方案

### 8.1 Provider 合同回归

新增真实联通测试：

```text
DesktopFilePreviewGateway.probe(.md)
  -> descriptor.extension === '.md'
  -> FilePreviewRegistry.resolve()
  -> desktop.markdown
```

同时覆盖：

- `.json -> desktop.json`
- `.jsonc -> desktop.source`
- `.mdx -> desktop.source`
- available 和 oversized descriptor 都使用带点扩展名。
- wire parser 拒绝 `extension: 'md'`。

### 8.2 Host 保存测试

覆盖：

1. 正确 revision 原子更新并返回新 revision。
2. stale revision 返回 conflict，磁盘内容保持不变。
3. workspace 外路径拒绝。
4. workspace 内指向外部的 symlink 拒绝。
5. 非 Markdown 文件不能走 Markdown save endpoint。
6. 超限 UTF-8 文本拒绝。
7. 中文、多字节字符和 LF 行尾正确保存。
8. Abort 不产生部分写入。
9. subagent lineage 使用祖先 workspace 授权。
10. 保存调用传入 `workspace-write` policy，而不是 `danger-full-access`。

### 8.3 Client Gateway 与 Controller

覆盖：

- save wire parser 和 transport error。
- 保存成功后更新 baseline revision。
- 输入期间旧保存完成后仍保持 dirty。
- concurrent save 串行化。
- conflict 不变成整个 Panel 的 error snapshot。
- refresh/open/close 等待 before-leave guard。
- 保存失败时导航取消。
- session switch/dispose abort 未提交请求。

### 8.4 MarkdownEditor 组件

使用 adapter 隔离 Milkdown，使大部分 jsdom 测试不依赖真实 ProseMirror 布局：

- `.md` 默认显示可编辑文档，不显示 Source `<pre>`。
- 标题、列表、表格、任务项和代码块可编辑。
- 中文 IME 不产生重复 transaction。
- `Ctrl/Cmd+S` 保存当前 Markdown。
- 800 ms debounce 自动保存。
- 工具栏命令与 undo/redo。
- edit/source 双向同步。
- conflict 保留本地 draft。
- raw HTML 不执行。
- unmount 时销毁 editor 和事件监听器。

另加真实 Chromium/Electron smoke test验证 ProseMirror DOM、selection 和 IME，jsdom 不能代替这些行为。

## 9. 真实 UI 验收矩阵

| 维度 | 验证值 |
| --- | --- |
| 文件栏宽度 | 360、480、640、900 px |
| 窗口宽度 | 900、1024、1440 px、宽屏 |
| 主题 | 明亮、暗色 |
| 内容 | 中文、emoji、长 URL、标题、列表、表格、任务项、引用、代码块 |
| 状态 | clean、dirty、saving、error、conflict |
| 文件变化 | 用户保存、Agent 同时修改、外部编辑器同时修改、文件删除/移动 |
| 生命周期 | 切换文件、刷新、关闭右栏、切换 session、关闭应用 |

人工确认：

- `.md` 打开后直接进入可编辑渲染视图。
- 工具栏不遮挡内容，窄宽度下使用 overflow menu。
- 光标、选区、中文输入法和复制粘贴正常。
- 保存后重新打开可见磁盘内容。
- Agent 改过文件后保存显示冲突，不覆盖 Agent 修改。
- raw HTML、脚本、`file:` URL 不执行。
- Source、JSON、Image 和 compatibility 模式没有回归。

## 10. 性能与包体积

当前 Desktop client bundle 基线约为：

```text
lib/client.js: 96.6 KiB
 gzip:         22.3 KiB
```

`tsdown.config.ts` 会把非 `@deepseek-ai/*` 依赖打入 client bundle，因此 Milkdown/ProseMirror 会显著增加体积。实施时必须记录：

- `lib/client.js` 原始和 gzip 体积增量。
- 100 KiB Markdown 首次挂载时间。
- 256 KiB Markdown 首次挂载和连续输入延迟。
- Desktop 冷启动和普通非 Markdown 会话的变化。

第一版继续保留 256 KiB WYSIWYG 阈值。只有性能矩阵通过后才提高上限。若静态 bundle 增量不可接受，再单独验证 DSH Client ModuleLoader 对 Markdown editor 动态 chunk 的支持，不能直接假设动态 import 可用。

## 11. 文档和提交顺序

建议按可独立回滚的提交拆分：

1. `fix(desktop): normalize file preview descriptor extensions`
2. `feat(desktop): add guarded markdown save protocol`
3. `feat(desktop): add editable markdown preview`
4. `test(desktop): cover markdown editing and conflicts`
5. `docs(desktop): document editable markdown viewer`

第一个提交立即恢复 Markdown/JSON 专用 Provider；第二个提交只建立写入协议和并发保护；第三个提交才引入编辑器运行时和 UI。禁止把扩展名修复、Host 写入和大型第三方编辑器依赖塞进一个提交。

## 12. 验收标准

以下条件全部满足后，Markdown 可编辑预览才能认为完成：

1. 小型 `.md` 默认命中 `desktop.markdown` 并显示可编辑渲染视图。
2. `.json` 同时恢复 JSON Provider；`.mdx`/`.jsonc` 仍走 Source。
3. 编辑、`Ctrl/Cmd+S` 和自动保存写入原文件。
4. 保存使用 `replaceIfVersion`，stale 时不修改磁盘。
5. workspace 外路径和外向 symlink 无法写入。
6. conflict/error 时本地草稿不丢失。
7. 不支持语法不会被静默删除。
8. raw HTML 和不安全资源不执行、不加载。
9. 360/480/640/900 px、明暗主题、中文 IME 通过实际 Electron 验收。
10. focused tests、typecheck、build、package gate 和运行时 closure 通过；完整测试中的既有平台失败必须与改动前基线一致。
11. `deepseek-harness` submodule 内容与 pin 均无变化。
12. client bundle 体积和编辑器挂载性能已记录并在可接受范围内。
