# DSH Desktop 文件管理器复制文件到对话的 P0 实施方案

Status: implementation-ready design

本文定义文件管理器复制文件的地址引用语义、代码级实施步骤、生命周期和验收标准。普通文件不上传字节；浏览器图片继续使用现有图片链路。

## 1. 交付结论

生产交付目标是 compatibility 和 advanced 两种模式都支持文件地址引用，但 compatibility 必须继续使用上游默认客户端的布局、slot 和输入框实现，Desktop 只提供一个可选的原生剪贴板能力。

本仓库的 Desktop 分支不得直接修改 pinned 的 `deepseek-harness/` 子模块；上游输入层的通用能力作为独立上游变更交付，合并后再更新 submodule pin，Desktop 分支只实现 Host、Electron 和可选 Client Provider。

如果上游可选输入能力尚未合入，第一阶段只能交付标记为 advanced-only 的垂直原型，不能宣称 compatibility 支持；原型不得复制或替换上游 `InputBar`。

`file-preview` 是 advanced-only 的现有展示能力，P0 文件引用授权不调用其 preview/read/binary 端点，也不把它的安装条件作为文件引用能力的安装条件。

P0 的最终链路是：Electron 主进程读取一次原生剪贴板格式，Host 在当前 session workspace 内解析并授权路径，Client 显示文件卡片，发送前 Host 再验证租约，Client 将工作区相对路径序列化为固定文本，Agent 后续通过现有 `read`/filesystem 工具读取该相对路径。

## 2. 代码事实与直接缺口

| 现有调用点 | 当前行为 | P0 必须改变的边界 |
| --- | --- | --- |
| [`InputBar.tsx`](../../deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx) 的 `onPaste` | 所有 `DataTransferItem.kind === 'file'` 都调用 `getAsFile()`，随后进入 `intakeImages` | 先尝试 Desktop 原生文件引用探测；探测到路径时走独立引用入口，探测不到时保留现有图片入口 |
| [`contract/slots.ts`](../../deepseek-harness/packages/client/ui-conversation/src/client/contract/slots.ts) 的 `ComposerAttachment` | 只有 `image`、`File`、`previewUrl` | 上游增加 `file-reference` 变体；Desktop 不把文件引用伪装成图片 |
| [`input/contract.ts`](../../deepseek-harness/packages/client/ui-conversation/src/client/input/contract.ts) | `SessionInput`、`InputActions`、`InputState` 都使用 `imageIds` | 上游将提交面提升为有序 `attachmentIds`，图片 API 只保留为兼容迁移别名或内部分区 |
| [`input/facade.ts`](../../deepseek-harness/packages/client/ui-conversation/src/client/input/facade.ts) | `SessionInputShell` 保存图片 id，负责 commit、restore、dispose | 同一套事务同时管理图片和文件引用；文件租约不能进入草稿持久化或 session 日志 |
| [`input/hub.ts`](../../deepseek-harness/packages/client/ui-conversation/src/client/input/hub.ts) | `sink(session, text, imageIds, mode)` 调用 `sendSession` | 改为传递有序附件 id，并在发送失败时恢复文件引用卡片及图片 |
| [`service.ts`](../../deepseek-harness/packages/client/ui-conversation/src/client/service.ts) 的 `sendSession` | 读取 `File.arrayBuffer()`，生成图片 prompt | 只对图片执行现有 base64 序列化；文件引用在发送前调用可选 Clipboard Service 的 validate，再生成固定文本 |
| [`sessions.ts`](../../deepseek-harness/packages/host/apiproxy/src/api/sessions.ts) 与 [`sessions.schema.ts`](../../deepseek-harness/packages/host/apiproxy/src/api/sessions.schema.ts) | `session.prompt` 只接受 text/image | P0 不新增 `file` prompt wire 变体，继续使用 text；P1 再增加结构化 `file-reference` |
| [`dsh-plugin-desktop/src/index.ts`](../src/index.ts) | `file-preview` RPC 只在 `config.mode === 'advanced'` 注册 | 新增独立 `/desktop-clipboard` RPC，并按产品目标在两种模式注册；现有 file-preview 条件不变 |
| [`dsh-plugin-desktop/src/client/index.ts`](../src/client/index.ts) | 非 advanced 直接返回，advanced 才安装 Desktop UI | 原生 Clipboard Provider 在两种模式都可提供；advanced shell 的布局和 file-preview UI 仍只在 advanced 安装 |
| [`electron-runtime.ts`](../src/electron-runtime.ts) | 拥有 Electron 主进程和 BrowserWindow，但没有剪贴板能力 | 通过可测试的 runtime adapter 读取 Electron `clipboard`，不增加 preload、不打开 nodeIntegration |
| [`window-options.ts`](../src/window-options.ts) | `sandbox`、`contextIsolation`、`nodeIntegration: false`、无 preload | 保持不变，Renderer 只能通过 loopback Connection RPC 获取结果 |

当前 `session.prompt` 的图片 admission、`AttachmentStore`、`ContentBlockMap`、`llm-pi-ai` 和历史图片读取均为图片专用；P0 不触碰这些模块。

## 3. P0 合同

### 3.1 输入语义

1. 文件管理器复制的代码、文本、图片、PDF 或其他普通文件都生成 `file-reference` 草稿附件，不因扩展名是图片而读取字节。
2. 浏览器截图、网页图片和浏览器产生的图片 `File` 继续生成现有 `image` 草稿附件并走原有图片限额、base64 和 Host 图片校验。
3. 终端或编辑器复制的普通路径字符串没有原生文件剪贴板格式时，仍按普通文本粘贴，不自动解析或读取路径。
4. P0 只接受当前 session workspace 内的普通文件；目录、不可解析路径、工作区外路径和越过 workspace 的符号链接全部拒绝。
5. P0 不读取普通文件内容、不生成内容 hash、不建立二进制 staging、不上传绝对路径、不把 clipboard lease 写入 session 日志。
6. 文件引用的访问边界不是 Client 卡片或文本标记，而是发送前 Host validate 加上 Agent `read`/filesystem 工具的当前 workspace 校验。

### 3.2 原生剪贴板优先级

在 Desktop Client Provider 存在时，`InputBar` 对包含 `file` item 的一次 paste 先调用原生文件探测，不立即把 `File` 送入图片 intake。

原生探测返回文件时，文件引用优先，浏览器 `File` 不进入 `imageIds`；因此文件管理器复制的图片路径不会意外变成图片字节。

原生探测返回 `none` 时，保留当前行为：浏览器图片 `File` 进入 `intakeImages`，普通 `text/plain` 进入输入机的 `pasteBegin`。

普通文本剪贴板没有 `file` item 时不调用原生探测，直接沿用现有文本粘贴路径。

原生 Provider 不可用或运行在普通 Web 时，`InputBar` 必须完全沿用现有图片/文本分流。

### 3.3 文件引用 wire 数据

共享的浏览器安全合同放在 Desktop 的 `src/clipboard/contract.ts`，所有来自 RPC 的值都要通过同一组 parser；该文件不得导入 Electron、Node、Cordis live object 或文件系统对象。

建议固定以下名称和端点：

```text
channel: /desktop-clipboard
probe:   probe
validate: validate
release: release
```

`probe({ sessionId })` 的返回值只有三类：

```text
{ status: "none" }
{ status: "files", items: [{ leaseId, name, relativePath, size }] }
{ status: "error", code, message }
```

`validate({ sessionId, leaseIds })` 必须对整个批次原子处理：全部租约仍有效时返回 `ok` 和按输入顺序排列的 `FileReference[]`；任一租约过期、移动、修改、越界或不再是普通文件时返回 `stale`/`error`，不返回部分成功结果。

`release({ sessionId, leaseIds })` 是幂等操作，Host 在 session dispose、RPC gateway dispose、TTL 到期和容量驱逐时也会清理租约。

`leaseId` 是只存在于当前 Renderer 草稿和 Host 内存的 opaque id；它不进入 prompt、session event、日志、错误消息或持久化草稿。

`relativePath` 由 Host 生成，只允许 `/` 分隔的 workspace-relative 路径，不能以 `/`、盘符、UNC 前缀或 `..` 开头；Client 不得把原始绝对路径发送回 Host。

`name` 必须是 Host 净化后的 basename；`size` 必须是有限非负整数；P0 不依据 size 拒绝文件内容，内容读取限额仍由现有 Agent 文件工具负责。

### 3.4 发送文本语法

P0 继续使用现有 `{ type: 'text', text }` prompt wire，因此必须定义纯函数 `serializeFileReferences`，并对输出做快照测试。

固定文本格式为一段独立的机器标记，每个引用一行，引用顺序与附件顺序一致：

```text
<dsh-file-references>
{"path":"src/client/InputBar.tsx"}
{"path":"docs/design.md"}
</dsh-file-references>
```

如果用户同时输入正文，机器标记后追加一个换行和用户原始正文；没有正文时仍发送机器标记文本，不能因为 `text === ''` 而丢掉文件引用。

路径只来自 Host validate 的 `relativePath`，由 `JSON.stringify({ path })` 生成；P0 不把名称、大小、leaseId 或绝对路径写入模型文本。

该标记是模型可见的地址提示，不是访问凭证，也不赋予模型绕过 workspace 的能力；用户手写同样的标记也必须由现有文件工具权限决定是否可读。

P1 应把该文本替换为结构化 `file-reference` prompt/content block，并让 session event、replay、工具上下文和版本校验识别该类型；P0 不修改 `PromptContentPart`。

## 4. 组件归属

### 4.1 Desktop Host 与 Electron

Desktop Host 新增独立的 `DesktopClipboardGateway`，它只处理原生剪贴板候选、workspace 授权、短期租约和 RPC dispatch，不处理 UI、不读取文件内容、不参与模型适配。

`ElectronDesktopRuntime` 新增一个窄的原生读取能力，实际实现调用 Electron 43.4.0 的 `clipboard.availableFormats()`、`read()`、`readBuffer()` 和 `readText()`；不得把未在类型中稳定声明的 `readFilePaths()` 作为唯一实现。

原生读取结果只在一次用户 paste 对应的 RPC 调用期间存在于 Host 内存；解析器返回候选绝对路径给 Host gateway 的内部方法后，绝对路径不得穿过 RPC、日志或错误文本。

### 4.2 上游可选 Client 能力

上游需要先提供一个无 UI 的可选 Client Service，建议命名为 `@deepseek-ai/dsh-client-clipboard`，定义 `ClipboardFilesService`、`ClipboardProbeResult`、`ClipboardFileDraft` 和 `ClipboardFileReference` 的纯数据接口，并通过 Cordis Context merge 发布 `ctx.clipboardFiles`。

该 Service 的默认状态是不存在；普通 Web 和不带 Desktop Provider 的上游客户端必须继续工作，`ui-conversation` 只能通过 `ctx.get('clipboardFiles')` 读取可选服务，不能把它加入硬依赖 `inject`。

Desktop Client 在 compatibility 和 advanced 两种模式都提供该 Service；它只注册 RPC gateway 和能力对象，不注册 root、conversation 或 composer replacement slot。

`ui-conversation` 消费者需要把通用附件摄取、草稿状态、发送编排和文件卡片接入上游；这些上游变更必须在独立上游 PR 中完成，Desktop 本地只更新 submodule pin。

### 4.3 UI 归属

文件卡片属于上游通用 composer attachment UI，因为 compatibility 不能通过 Desktop 私有 `InputBar` 获得完整行为。

应扩展现有纯 React 的 `@deepseek-ai/dsh-client-ui-attachment`，让 `AttachmentRail` 支持 image item 和 file-reference item 两种 presentation；组件只接收 JSON 数据和回调，不接触 `ctx`、Electron、Host Service 或文件对象。

advanced shell 仍由 [`advanced-shell.ts`](../src/client/advanced-shell.ts) 负责，P0 不把文件卡片注册到 advanced 专用 root slot，也不复制整个 composer。

## 5. Host 授权判定

`DesktopClipboardGateway` 必须复用现有 file-preview 的 workspace membership 和 session lineage 语义，但使用独立的无内容授权路径。每次 probe 和 validate 都重新执行以下顺序：

1. 根据当前 session id 查找 workspace membership；必要时沿 subagent lineage 查找祖先 workspace。
2. 使用 `ctx.fs.resolve(workspace.path)` 得到 workspace root。
3. 使用 `ctx.fs.lstat(candidatePath, { cwd: workspace.path })` 拒绝最终符号链接和非普通路径。
4. 使用 `ctx.fs.resolve(candidatePath, { cwd: workspace.path })` 得到目标。
5. 使用 `ctx.fs.contains(workspaceRoot, target)` 拒绝 `..`、绝对路径和符号链接解析后的越界目标。
6. 使用 `ctx.fs.stat(target)` 确认普通文件、size 和 opaque version。
7. 使用 `ctx.fs.processPath(target)` 只在 Host 内部产生相对路径，规范化为 `/` 分隔并检查没有绝对前缀和 `..`。

`FsTarget`、`FsVersion`、canonical absolute path 和 raw clipboard bytes 不跨 RPC。P0 的 `validate` 只确认粘贴到发送之间的文件仍是同一授权目标；发送后 Agent 通过现有 `read`/filesystem 工具重新执行 workspace 校验。版本绑定、durable reference 和 replay stale 诊断留给 P1。

## 6. 按执行顺序的实施步骤

### P0-0：垂直可行性闸门

1. 在至少一个目标平台上用真实文件管理器复制一个 workspace 内文件，确认 Electron 43.4.0 的 `availableFormats()` 能读到候选格式。
2. 用纯解析器把候选格式解析成一个绝对路径，Host gateway 返回 workspace-relative path，并明确拒绝 workspace 外路径。
3. 在不写 session、不读文件内容的前提下完成一次 Client 卡片展示和 `read` 工具读取验证。
4. 验证截图粘贴仍进入现有图片链路，普通文本仍进入现有文本链路。
5. 任一目标平台无法满足上述条件时，保留该平台的拖放/显式选择 fallback，不通过 preload 或任意路径 RPC 绕过安全边界。

### P0-1：建立共享协议和纯解析器

1. 新建 `dsh-plugin-desktop/src/clipboard/contract.ts`，定义 channel、端点、JSON 类型、opaque lease 类型和所有 request/response parser。
2. 新建 `dsh-plugin-desktop/src/clipboard/native.ts`，实现 Windows、macOS 和 Linux 的格式选择及无副作用解析函数；先以 P0-0 通过的平台作为发布阻断平台，其余格式通过单元测试和平台 smoke 逐步启用。
3. Windows 解析优先处理 `CF_HDROP`/`FileNameW`，校验结构偏移、Unicode 标志、路径数量和双零结尾；`text/uri-list` 作为 fallback。
4. macOS 解析 `public.file-url`/`NSFilenamesPboardType`，正确处理 URL 编码和不可读格式；`text/uri-list` 作为 fallback。
5. Linux 解析 `text/uri-list`，忽略注释、拒绝非 `file` scheme，并记录 X11/Wayland 空结果为 `none` 而不是错误。
6. 所有解析器应用固定的最大条目数、路径字符数和输入字节数；异常输入只返回稳定错误码，不记录原始路径。

### P0-2：实现 Host workspace 授权和租约

1. 新建 `dsh-plugin-desktop/src/clipboard/gateway.ts`，注入 `ctx.fs`、`workspaceRegistry`、session lineage 查询、`ctx.desktopRuntime` 的 native source、logger 和已校验配置。
2. 从现有 [`file-preview-gateway.ts`](../src/file-preview-gateway.ts) 提取一个只负责 workspace membership、lineage、`resolve`、`contains`、`lstat`、`stat` 的窄授权 helper；保持 file-preview 对外端点和行为不变，避免两套安全谓词长期漂移。
3. `probe` 必须先根据当前 session 和 lineage 找到 workspace，再读取 native clipboard；不得接受 Client 传入的原始 path 作为探测输入。
4. 每个候选依次执行 `lstat`、resolve workspace root、`resolve`、`contains` 和 `stat`；拒绝目录、特殊文件、最终符号链接和解析后越出 workspace 的目标。
5. 在 Host 内部使用 `ctx.fs.processPath(workspaceRoot)` 和 `ctx.fs.processPath(target)` 得到本地绝对路径后，用 Node `path.relative` 计算相对路径；规范化为 `/` 分隔并检查没有 `..`、绝对前缀或空值，不能解析或比较 `targetKey` 字符串。
6. 为每个通过的候选建立 `leaseId -> { sessionId, workspacePath, workspaceRoot, candidate, relativePath, version, size, expiresAt }` 记录；`FsTarget` 和 `FsVersion` 永远不跨 RPC。
7. 任一候选失败时整批拒绝并释放已经建立的租约，避免 Client 出现部分成功；成功时只返回 basename、relativePath、size 和 opaque leaseId。
8. `validate` 重新解析当前 session workspace，重新解析租约目标并执行 `contains`、`lstat`、`stat`，比较当前普通文件和原记录的 identity/version/size；任何变化都返回 stale 并保留卡片为可重试错误。
9. `release`、TTL、容量驱逐和 gateway dispose 必须取消并清空所有租约；P0 不需要 HTTP 数据面。

### P0-3：在 Host 两种模式注册独立 RPC

1. 在 `dsh-plugin-desktop/src/index.ts` 增加 `ClipboardGatewayConfig` 和 `clipboard` 配置段，至少包含 `maxItems`、`maxPathChars`、`maxPayloadBytes`、`leaseTtlMs`、`maxLeases`，所有部署参数通过 schema 校验并提供默认值。
2. `installClipboardGateway(ctx, config.clipboard)` 在 `apply` 中无条件调用；现有 `installFilePreviewGateway(ctx, config.filePreview)` 保持 `config.mode === 'advanced'` 条件不变。
3. 注册方式复制已有 `ctx.connection.rpc.handle(FILE_PREVIEW_RPC_CHANNEL, handler, { authority: 'loopback' })` 模式，但使用独立 `/desktop-clipboard` channel，不能复用 file-preview endpoint 名称。
4. 用一个 Cordis effect 持有 gateway dispose、RPC disposer 和相关资源清理；stop、update、profile reload 和退出后旧 lease 不可用。若与 file-preview 合并安装逻辑，必须保留两个 gateway 的独立端点和独立配置。
5. 不新增 preload、不改变 [`window-options.ts`](../src/window-options.ts)，不允许 Renderer 直接导入 Electron 或 Node API。

### P0-4：提供 Desktop Client 可选能力

1. 新建 `dsh-plugin-desktop/src/client/clipboard/gateway.ts`，通过 `ctx.connection.rpc.call('/desktop-clipboard', endpoint, payload, signal)` 调用 Host，并用共享 parser 验证每个 response。
2. 在 `dsh-plugin-desktop/src/client/index.ts` 中以 `ctx.effect` 注册 `ctx.reflect.provide('clipboardFiles', gateway)`，再按现有逻辑仅在 advanced 模式调用 `applyAdvancedShell`。
3. Provider 的 RPC 调用必须是用户 paste 手势触发的单次调用；不得安装定时器、后台监听器或全局 clipboard poller。
4. compatibility 模式只增加这个可选 Service，不注册 Desktop root、layout、file-preview controller 或样式；上游默认 client 的 slot 拓扑保持不变。
5. 普通 Web bundle 未装 Desktop Provider 时，`ctx.get('clipboardFiles')` 返回 `undefined`，所有现有图片、文本、拖放和 IME 行为保持不变。

### P0-5：上游输入层接入（独立上游 PR）

1. 新增 `@deepseek-ai/dsh-client-clipboard` 上游 package，补齐 `package.json`、`src/client/contract.ts`、`src/client/index.ts`、`src/invariant.ts`、tsconfig、aggregate reference 和 web-app bundle row；该 package 不读取系统剪贴板，只定义可选 Service 合同。
2. 在 `ui-conversation/src/client/contract/slots.ts` 将 `ComposerAttachment` 扩为 `image | file-reference` union，并把 `ComposerBarInjected` 的 `addImages`/`draftImages`/`removeImage` 提升为通用附件入口，同时保留现有图片调用的迁移适配。
3. 在 `input/contract.ts` 将 `imageIds` 提升为有序 `attachmentIds`，更新 `SessionInput`、`InputActions`、`InputState` 和所有测试 fixture；附件 id 仍是浏览器运行时身份，不进入 wire。
4. 在 `input/facade.ts` 将 `imageIds` 字段、`commitSend`、`restoreImages`、`pruneImages`、`compose` 和 dispose 清理改为通用附件；图片和文件引用的释放由 Conversation Controller 分区处理。
5. 在 `input/hub.ts` 将 `defaultSink(text, imageIds, mode)`、`sink`、workspace 切换和 session scope dispose 改为有序附件；发送失败必须恢复原批次附件，后续新增附件的顺序不能被覆盖。
6. 在 `service.ts` 将 `sendSession(session, text, imageIds, mode)` 改为 `sendSession(session, text, attachmentIds, mode)`；先解析附件并保持顺序，再对图片调用现有 `serializeImages`，对文件引用调用可选 `clipboardFiles.validate`，最后生成 file marker text 和原有 user text。
7. 如果 `clipboardFiles` 缺失而草稿中出现文件引用，发送必须失败并保留卡片，不能静默丢弃、降级成绝对路径或当作图片上传。
8. `ConversationController` 新增通用 `createDraftAttachments`、`draftAttachments`、`releaseDraftAttachment(s)`，图片继续创建 object URL，文件引用只保存 Host 返回的 JSON 元数据和 lease id。
9. Session shell teardown、successful send、failed send、session switch 和 HMR dispose 都必须释放或恢复 lease；草稿镜像仍只保存文本，页面刷新后未发送的文件引用可以丢失，P0 不引入持久化草稿协议。
10. 对 slash command 保持现有输入机策略：文件引用只随普通 message default sink 发送；如果附件存在且输入最终被命令 claim 消费，文件引用不得进入命令参数，命令成功/失败后的附件清理行为必须由新增回归测试固定下来。

### P0-6：上游 composer 和附件卡片

1. 在 `ui-conversation/src/client/skeleton/InputBar.tsx` 保留现有图片 intake 函数和 drop listener；只在 paste 分支旁增加 `probeClipboardFiles` 异步路径。
2. paste 处理先收集浏览器 `File`，记录当前 `sessionId`、`input.snapshot.draftRev` 和 textarea selection，再调用可选 Provider；结果返回时检查组件仍挂载、session 未变、draftRev 未变、selection 未变，否则 abort 或丢弃结果。
3. `files` 结果调用通用 `addFileReferences`，不调用 `addImages`；`none` 结果回放原有 `intakeImages` 和 `keyboard.pasteBegin`；无 Provider 时直接走原实现。
4. 为避免系统剪贴板的 URI 文本重复进入 draft，Host 在 `files` 结果中返回 `textDisposition: 'suppress' | 'preserve'`；原生 URI 列表使用 `suppress`，无法证明文本只是路径列表时使用 `preserve`，后者按现有 `pasteBegin` 处理。
5. 探测期间显示稳定尺寸的 loading 状态；批次被 Host 拒绝时显示稳定错误通知，不把半批次放入 rail；发送 validate 返回 stale 时恢复附件并将对应卡片标记为 error。
6. 在 `ui-attachment/src/AttachmentRail.tsx` 扩展纯 props item union；图片 item 保留缩略图和 lightbox，文件 item 显示文件图标、净化名称、workspace-relative path、size、状态和键盘可达 remove button，不读取内容、不生成预览 URL。
7. 更新 `AttachmentRail` CSS 和 locale 文案，使用现有 UI primitive 图标和主题 token；不在卡片中放大说明性文本，不添加新的全局样式或手工 SVG。
8. 文件卡片不提供系统打开操作作为 P0 必需功能；打开原文件属于已有 file-preview/open-path 能力的 advanced UI，不把该行为耦合到引用提交。

### P0-7：发送和 Agent 读取验收

1. Host validate 成功后，Client 立即生成固定 file marker，再调用现有 `session.prompt`；validate 失败时不发送 prompt。
2. `session.prompt` 被接受后释放 lease；transport failure 或 Host business failure 时恢复草稿附件，允许用户重新发送，TTL 仍负责兜底清理。
3. Agent 收到的路径必须是 workspace-relative path；现有 `read` 工具在当前 session workspace 下解析它，文件不存在、权限变化或内容变化由现有工具错误返回。
4. P0 不承诺提交后版本固定；validate 只防止粘贴到发送之间的移动/修改，发送后读取版本一致性属于 P1 的结构化引用和工具协作。
5. 验收日志和模型请求必须没有绝对路径、leaseId、原始 clipboard bytes 或 base64 普通文件内容。

## 7. 文件级变更清单

### 7.1 本 Desktop 仓库新增或修改

| 文件 | 变更 |
| --- | --- |
| `dsh-plugin-desktop/src/runtime.ts` | 为 `DesktopRuntime` 增加窄的 native clipboard source 能力，声明绝对路径只允许在 Host 内部短暂使用 |
| `dsh-plugin-desktop/src/electron-runtime.ts` | 注入 Electron `clipboard` 读取和 native adapter；不改变 BrowserWindow 安全选项 |
| `dsh-plugin-desktop/src/clipboard/contract.ts` | 新增浏览器安全 RPC 类型、端点常量和 parser |
| `dsh-plugin-desktop/src/clipboard/native.ts` | 新增平台格式解析器和输入上限 |
| `dsh-plugin-desktop/src/clipboard/gateway.ts` | 新增 workspace 授权、lease、validate、release 和 RPC dispatch |
| `dsh-plugin-desktop/src/index.ts` | 增加 clipboard config，并在两种 mode 安装独立 gateway；file-preview 条件保持不变 |
| `dsh-plugin-desktop/src/client/clipboard/gateway.ts` | 新增 Client RPC adapter 和 response validation |
| `dsh-plugin-desktop/src/client/index.ts` | 两种 mode 提供可选 `clipboardFiles` Service，advanced shell 分支保持原有条件 |
| `dsh-plugin-desktop/src/client/advanced-shell.ts` | P0 不改变布局、file-preview controller 或 root slot；只在需要共享类型时增加 type-only 引用 |
| `dsh-plugin-desktop/src/window-options.ts` | 不修改 |
| `dsh-plugin-desktop/src/file-preview-gateway.ts` | 仅在提取共享 workspace 授权 helper 时做等价重构，外部端点行为必须保持不变 |
| `dsh-plugin-desktop/cordis.patch.yml` | 不改变 compatibility/advanced mode 语义；只有新增 upstream capability row 时才追加对应行 |
| `dsh-plugin-desktop/tests/clipboard-native.spec.ts` | 新增纯解析器测试 |
| `dsh-plugin-desktop/tests/clipboard-gateway.spec.ts` | 新增 workspace 授权、lease、TTL、stale、dispose 和无字节读取测试 |
| `dsh-plugin-desktop/tests/clipboard-plugin.spec.ts` | 新增两种 mode 的 Host 组合和 RPC disposer 测试 |
| `dsh-plugin-desktop/tests/clipboard-client.client.spec.ts` | 新增 Client RPC parser、abort 和 Service 生命周期测试 |
| `dsh-plugin-desktop/tests/electron-runtime.spec.ts` | 用 fake clipboard provider 验证 native adapter，测试必须 headless-safe |

### 7.2 必须由独立上游 PR 修改的文件

| 文件或目录 | 变更 |
| --- | --- |
| `packages/client/clipboard/` | 新增可选 Clipboard Service Definition package，或按上游维护者约定放入等价的现有 capability package |
| `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` | 增加 native probe 分流、CAS、文件引用 intake 和通用 rail projection |
| `packages/client/ui-conversation/src/client/service.ts` | 通用附件 registry、发送前 validate、固定 file marker 和释放逻辑 |
| `packages/client/ui-conversation/src/client/input/contract.ts` | `attachmentIds` 和通用附件动作合同 |
| `packages/client/ui-conversation/src/client/input/facade.ts` | 通用附件事务、恢复、提交和生命周期 |
| `packages/client/ui-conversation/src/client/input/hub.ts` | 通用附件发送编排、session 切换和失败恢复 |
| `packages/client/ui-conversation/src/client/contract/slots.ts` | `ComposerAttachment` union 和 `ComposerBarInjected` 通用入口 |
| `packages/client/ui-attachment/src/AttachmentRail.tsx` | image/file 两种 item presentation |
| `packages/client/ui-attachment/src/AttachmentRail.module.css` | 文件卡片布局、状态和稳定尺寸 |
| `packages/client/ui-conversation/src/client/locales.ts` 与 `image-labels.ts` | 文件卡片、错误、loading 和移除文案 |
| `packages/client/ui-conversation/tests/` | 输入分流、事务、发送、恢复和命令交互测试 |
| `packages/client/ui-attachment/tests/` | 文件卡片和无缩略图 rail 测试 |
| `packages/bundle/web-app/cordis.patch.yml` | 加入新的上游 capability row，保持 `ui-conversation` 默认 row 和 slot 拓扑不变 |
| `packages/bundle/web-app/package.json` | 声明新的上游 capability workspace dependency |
| `tsconfig.client.json` 及相关 package tsconfig | 加入新 package 的 aggregate/reference |
| `apps/web/tests/shipped-composition.e2e.ts` 或新增同级 snapshot | 固定 file marker 的 assembled model-visible 输出 |

上游 PR 合入并更新 submodule pin 后，Desktop 仓库只提交 pin 变化和本节 7.1 的 Desktop 实现；不得在 Desktop 工作树中直接编辑、复制或 vendor 上游 `InputBar`。

## 8. 生命周期和并发规则

### 8.1 Paste transaction

每次 paste 只允许一个原生 probe transaction 影响当前输入框；第二次 paste、selection 变化、键盘输入、session 切换或组件 dispose 都会 abort 或使旧结果失效。

paste handler 必须在启动异步 RPC 前阻止浏览器默认行为，随后在 `none`/Provider error 分支显式回放原有图片和文本处理；不能等待 RPC 决定是否 `preventDefault`，否则会出现浏览器默认插入和异步附件重复。

probe 结果只能在记录的 `sessionId`、`draftRev` 和 selection 仍匹配时加入草稿；结果过期时不覆盖新文本、不回滚新附件、不产生除明确错误通知外的副作用。

### 8.2 Send transaction

`SessionInputShell.commitSend` 在 default sink 入口移除本次附件，`ConversationController.sendSession` 先完成图片序列化和 file validate，prompt 成功后释放 registry/lease。

任何 validate、图片序列化、prompt admission 或 transport failure 都必须恢复本次原始附件；恢复操作只补回仍属于当前 shell 的 id，不能覆盖用户在等待期间新增的附件。

Host validate 对一批 lease 全部成功或全部失败；Client 不把部分结果提交到 prompt，也不把失败项静默降级为普通文字路径。

固定 marker 的 serializer 必须在 prompt 调用前完成，且只接收 Host validate 返回的相对路径；普通用户正文仍使用现有 trim 和 queue/steer mode 规则。

### 8.3 Session 和 profile 生命周期

Session shell dispose 释放该 session 的 file lease；workspace 切换只迁移现有图片附件，P0 不跨 workspace 重绑 file lease，无法迁移的文件卡片以明确错误结束并要求重新粘贴。

Profile reload、Desktop mode restart、HMR dispose 和 Electron quit 会销毁 Host gateway；旧 lease、旧 RPC response 和旧 Client pending promise 都必须失效。

compatibility 的 Client Provider 可以存在，但不得安装 advanced root/layout/file-preview UI；advanced 额外安装现有 `applyAdvancedShell`，两套生命周期不能共享未注册的全局 listener。

## 9. 安全和隐私检查表

- [ ] Renderer 不接触 Electron `clipboard`、Node `fs`、绝对路径或 preload bridge。
- [ ] Host 只在用户 paste RPC 期间读取原生剪贴板，不轮询、不缓存剪贴板历史。
- [ ] Host 不信任 Client workspace root、绝对 path 或相对 path；probe 由当前系统剪贴板产生候选，validate 由 Host lease 定位目标。
- [ ] RPC 的 `sessionId` 必须对应现存 session，workspace membership 和 subagent lineage 每次 probe/validate 都重新确认。
- [ ] `lstat`、`resolve`、`contains`、`stat` 的顺序覆盖目录、特殊文件、符号链接逃逸和 TOCTOU；最终符号链接按 P0 策略拒绝。
- [ ] `FsTarget`、`FsVersion`、canonical absolute path 和 raw clipboard bytes 不跨 RPC。
- [ ] prompt marker 只包含 Host 生成的 workspace-relative path；日志、错误、session event 和模型请求不含绝对路径或 leaseId。
- [ ] 普通文件不会调用 `File.arrayBuffer()`、`readBytes()`、base64、AttachmentStore 或 image validator。
- [ ] 所有 item 数量、路径长度、wire payload、lease TTL 和内存容量都有配置上限。
- [ ] leaseId 使用不可预测的 Host 生成值，并绑定 session、workspace identity、target identity、version、size 和 generation。
- [ ] gateway 和 Client provider 的每个 disposer 都由当前 Cordis Fiber 持有。

P0 的 plain-text marker 不是授权凭证。用户或模型可以手写同样的路径文本，真正的访问权限仍由 Agent `read`/filesystem 工具在当前 session workspace 内决定。

P0 的 validate 只保护粘贴到发送之间的窗口；发送后如果文件路径被替换，现有 `read` 工具按当前路径重新授权，不能声称它仍然绑定 probe 时的版本。结构化 reference、expected version 和 stale diagnostics 属于 P1。

## 10. 测试计划

### 10.1 Desktop 纯单元测试

1. Windows `CF_HDROP` 的 ANSI、Unicode、多文件、空列表、错误偏移和未终止字符串。
2. macOS file URL 的编码、多个 URL、非 file scheme 和不可读格式。
3. Linux `text/uri-list` 的注释、非本地 scheme、重复路径和空剪贴板。
4. parser 的条目数、路径长度、输入字节上限和异常输入不会泄露原始路径。
5. workspace 内相对和绝对候选通过；workspace 外候选、`..`、目录、special file 和符号链接逃逸拒绝。
6. 当前 session membership、subagent ancestor membership、无 workspace 和错误 lineage 的结果。
7. 文件在 probe 后移动、删除、替换、大小改变或版本改变时 validate 返回 stale。
8. 一批多个文件中任一失败时没有部分 lease、部分 response 或部分 Client attachment。
9. `release` 幂等、TTL 清理、容量驱逐、gateway dispose 和 RPC disposer 清理。
10. fake `ctx.fs` 记录 `readBytes`/`readText` 调用为零，证明 P0 不读取普通文件内容。

### 10.2 上游 Client 单元和组件测试

1. 无 Provider 时现有文本、截图、浏览器图片和拖放测试结果完全不变。
2. 文件管理器图片路径优先生成 `file-reference`，不调用 `addImages`，不进入 `imageIds`。
3. 截图的原生 probe 返回 `none` 后仍调用现有 `intakeImages`，图片 preview、limits、remove 和 lightbox 不回归。
4. 普通文本没有 file item 时不调用 Provider，selection、IME、undo/redo 和 paste upgrade 不回归。
5. probe 的 session、draftRev 或 selection 过期时丢弃结果；第二次 paste 不被旧结果覆盖。
6. 文件卡片显示净化名称、相对路径、size、loading/error 状态，remove 键盘可达且 rail 尺寸稳定。
7. 多附件保持顺序；批次拒绝不出现部分成功；连续粘贴不覆盖前一批。
8. validate 成功生成固定 marker，失败恢复附件并显示错误；prompt transport failure 可重试。
9. `sendSession` 传给 `session.prompt` 的 marker 与纯 serializer 输出逐字节相同，普通用户文本不被重写。
10. slash command、空正文、多图片加文件引用、steer/queue 两种 mode 的清理行为固定在测试中。

### 10.3 真实组合和发布检查

1. 通过上游真实 `cordis.yml`/Loader 组合测试验证 compatibility 默认客户端仍挂载原有 `conversation`/`composer` slots。
2. compatibility 模式验证 Desktop clipboard RPC 可用但没有 advanced root、file-preview resource route 或 Desktop layout 样式。
3. advanced 模式验证 clipboard gateway 与既有 file-preview gateway 同时存在，二者 disposer 不互相泄漏。
4. Headless build、typecheck、unit test、Loader smoke 和 packaged runtime test 使用 fake clipboard provider，不启动 GUI、不依赖真实系统剪贴板。
5. 至少一个目标平台执行 Electron 43.4.0 打包应用的 Explorer/Finder/file-manager 多文件 paste smoke；未通过的平台明确标记为 unsupported。
6. 上游 Client 改动运行 `pnpm run test:gui` 覆盖 Client suites 和 Host GUI packages；由于修改了 composer 和 model-visible marker，再运行 `DSH_SNAPSHOT=replay pnpm run test:web`。
7. 新增或更新一个 keyless assembled snapshot，验证 session log 可重建 marker，且模型请求没有绝对路径。
8. Desktop 包运行 build、typecheck、test、loader/profile smoke 和现有 closure checks；最终检查 `git status`，确认没有意外改动 submodule 内容。

## 11. 模式矩阵

| 能力 | Compatibility | Advanced | 普通 Web |
| --- | --- | --- | --- |
| 上游默认 conversation/composer | 保持原样组合 | 保持原样组合，外加 Desktop layout | 保持原样组合 |
| 浏览器截图/图片字节粘贴 | 支持，现有链路 | 支持，现有链路 | 支持，现有链路 |
| 文件管理器地址引用 | P0 生产目标：可选 Clipboard Service，不替换 UI | P0 生产目标：可选 Clipboard Service 加 advanced UI | 不支持，按普通文本/图片行为 |
| file-preview panel 和 binary route | 不安装 | 现有 advanced 能力 | 不安装 |
| Electron 原生 clipboard RPC | 安装 `/desktop-clipboard` 独立 channel | 安装 `/desktop-clipboard` 独立 channel | 不存在 |
| 未合入上游 optional input capability 时 | 不能交付文件引用，保持图片/文本 | 可做 advanced-only 垂直原型 | 不支持 |

Compatibility 的“保持原样”指不替换上游 layout、slot 和 composer owner；上游通用输入消费者的 additive capability 变更必须通过独立 upstream revision 交付，不能由 Desktop Client 私有复制实现。

## 12. 明确不修改的 P0 范围

P0 不修改 `deepseek-harness/packages/host/apiproxy/src/api/sessions.ts`、`sessions.schema.ts` 或 `api-proxy.ts` 的 prompt/content union，因为引用通过现有 text part 发送。

P0 不修改 `deepseek-harness/packages/attachment/attachment`、`attachment-local`、`ContentBlockMap`、`llm-pi-ai`、DeepSeek provider adapter、token meter、compaction 或历史图片授权。

P0 不读取普通文件内容，不调用 `AttachmentStore` 保存普通文件，不计算内容 hash，不创建二进制 HTTP staging route，不实现 PDF/Office/压缩包抽取。

P0 不启用 preload、不改变 `contextIsolation`、`sandbox`、`nodeIntegration`、`webSecurity` 或 BrowserWindow 导航策略。

P0 不安装全局 document paste 监听器、不轮询系统剪贴板、不实现剪贴板历史、不把终端路径字符串自动转换成文件引用。

P0 不新增结构化 durable `file-reference` session event；固定 text marker 已满足模型可见内容可由日志重建，P1 才建立结构化事件和 replay 版本语义。

P0 不改变 `dsh-plugin-desktop/src/client/advanced-shell.ts` 的 root slot、file-preview controller、layout service 或主题效果；文件卡片由上游通用 composer 负责。

本节“不修改”针对 Desktop 分支的直接源代码；上游 PR 可以按第 7.2 节修改对应 upstream source，合入后只通过 submodule pin 进入 Desktop 构建。

## 13. P1/P2 后续

P1 新增结构化 `file-reference` prompt/content block、durable event、replay parser、工具读取时的 expected version 和 stale diagnostics；这一步才允许 UI、session log 和 Agent 以结构化方式识别引用。

P2 增加用户明确触发的 byte staging/import、受限文本展开、PDF/Office 提取、模型原生文件输入和对应的 AttachmentStore/LLM adapter 支持。

P3 再考虑 workspace 外一次性导入、跨窗口 lease 转移、Wayland/GTK 专用格式、确认策略和隐私审计。

## 14. 完成标准

P0 只有在以下条件同时成立时才算完成：真实目标平台能从文件管理器读取至少一个路径；Host 在当前 workspace 内授权并拒绝越界路径；Client 显示并移除文件卡片；发送前 stale 文件被阻止；Agent 能用现有 `read` 工具读取相对路径；普通文本、截图、浏览器图片、拖放和 IME 无回归。

另外必须证明普通文件从未在 Renderer/Host 之间复制字节或进行 base64 传输，session 日志和模型请求不含绝对路径，compatibility 没有被 Desktop 私有 UI 替换，所有 RPC 和 lease 在 dispose/reload/quit 后可回收。

如果上游 optional input capability 尚未合入，则只报告 advanced-only 原型的结果，不把 compatibility 的模式矩阵标记为通过。

## 15. 参考

- [Electron Clipboard API](https://www.electronjs.org/docs/latest/api/clipboard)
- [Electron: Copy/Paste Files from Desktop into Electron render window](https://github.com/electron/electron/issues/26377)
- [Electron: `text/uri-list` clipboard behavior](https://github.com/electron/electron/issues/39853)
- [Windows `DROPFILES` structure](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/ns-shlobj_core-dropfiles)
- [Apple `NSFilenamesPboardType`](https://developer.apple.com/documentation/appkit/nsfilenamespboardtype)
- [DSH Desktop 仓库规则（pinned 上游子模块约束）](../../AGENTS.md)
- [DeepSeek Harness 仓库规则（插件与上游约定）](../../deepseek-harness/AGENTS.md)

