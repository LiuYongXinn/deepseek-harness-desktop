# DSH Desktop 剪贴板文件粘贴 P0 实施状态

Status: **implementation-complete（Desktop 侧代码完成）**；真实平台闸门与上游 PR 未执行。

本文对照 [`clipboard-file-paste-design.zh.md`](./clipboard-file-paste-design.zh.md) 记录 Desktop 仓库已交付的范围、
提交历史、与上游/真实平台的边界，以及剩余验收动作。代码实现保留「普通文件不上传字节、只传 workspace 相对路径地址引用、纯文本 marker 不读文件内容」的 P0 语义。

## 1. 已交付步骤（按实施顺序）

| 设计步骤 | 交付内容 | 提交 |
| --- | --- | --- |
| P0-1 共享协议与纯解析器 | `src/clipboard/contract.ts`（浏览器安全的 `/desktop-clipboard` probe/validate/release 合同、opaque lease、workspace 相对路径校验）、`src/clipboard/native.ts`（Windows CF_HDROP/FileNameW、macOS public.file-url、Linux text/uri-list 纯解析器与上限）及单测 | `4c65134c79` |
| P0-2 Host workspace 授权与租约 | `src/workspace-file-auth.ts` 共享授权 helper（membership/lineage/lstat/resolve/contains/stat/processPath；file-preview 等价重构为复用）、`src/clipboard/gateway.ts`（probe/validate/release、批量全有或全无、TTL/容量/释放/停止清理）、`src/runtime.ts` + `src/electron-runtime.ts` 窄原生剪贴板快照，及网关/运行时单测 | `8afe92b416` |
| P0-3 两种模式注册独立 RPC | `src/index.ts` 增加 `clipboard` 配置段（maxItems/maxPathChars/maxPayloadBytes/leaseTtlMs/maxLeases + schema 默认值）；`installClipboardGateway` 无条件注册 `/desktop-clipboard`；file-preview 仍仅 advanced，两 gateway 端点与 disposer 独立 | `62c1562620` |
| P0-4 Desktop Client 可选能力 | `src/client/clipboard/gateway.ts`（Client RPC adapter + 共享 parser 校验响应）、`src/client/index.ts` 两模式 `ctx.provide('clipboardFiles', ...)`、`src/client/contracts.ts` 类型声明；普通 Web 不加载即 `ctx.get('clipboardFiles') === undefined` | `f30fc55d2a` |
| P0-7 发送与 Agent 读取验收（Desktop 侧） | `src/clipboard/serialize.ts` 纯函数 `serializeFileReferences`（固定 `<dsh-file-references>` 标记 + 逐行 `JSON.stringify({path})` + 用户正文），快照测试固定输出；非 workspace 相对路径 fail-loud，杜绝绝对路径进入模型文本 | `a12b5b4d65` |

补充：P0-2 因 `DesktopRuntime` 接口新增方法，同步为 `tests/plugin.spec.ts` 的 fake runtime 补了 stub。

## 2. Desktop 文件级变更对照（设计 §7.1）

- [x] `src/runtime.ts`：`DesktopClipboardSnapshot` + `readNativeClipboardSnapshot()`
- [x] `src/electron-runtime.ts`：Electron `clipboard.availableFormats/read/readBuffer/readText` 窄 adapter；未改 BrowserWindow 安全选项，未加 preload
- [x] `src/clipboard/contract.ts` / `native.ts` / `gateway.ts` / `serialize.ts`
- [x] `src/index.ts`：clipboard config + 两种模式安装；file-preview 条件不变
- [x] `src/client/clipboard/gateway.ts`、`src/client/index.ts`、`src/client/contracts.ts`
- [x] `src/file-preview-gateway.ts`：仅做等价重构（抽 `resolveWorkspaceMembership` 复用），外部端点行为不变；file-preview 测试无改动通过
- [x] `src/window-options.ts`：未修改
- [x] `tests/clipboard-*.spec.ts`、`tests/clipboard-*.client.spec.ts`、`tests/electron-runtime.spec.ts`、`tests/plugin.spec.ts`

新增测试覆盖设计 §10.1 全部 10 项（纯协议、原生解析、workspace 授权、成员/lineage、stale 判定、批量原子性、release/TTL/容量/dispose、`readBytes/readText` 调用为零）+ §10.2 #9 的逐字节快照。

## 3. 未执行（明确边界）

### 3.1 P0-0 垂直可行性闸门（真实平台）
P0-0 要求至少一个目标平台用真实文件管理器复制 workspace 内文件，验证 Electron `availableFormats()` 能读取候选、Host 授权并返回相对路径、Client 卡片 + `read` 工具可用、截图与普通文本仍走原链路。**这是真实 GUI/平台手工验证，无法在 headless 环境执行**，视为发布阻断闸门；发布前须按设计 §6 P0-0 在目标平台执行。未通过的平台保留拖放/显式选择 fallback，不绕安全边界。

### 3.2 P0-5 / P0-6 上游可选输入能力与 composer（独立上游 PR）
按设计 §6/§7.2，以下属于 **pinned `deepseek-harness/` 上游的独立 PR**，Desktop 分支不得直接修改子模块：

- 新增 `@deepseek-ai/dsh-client-clipboard` 可选 Service（`ctx.clipboardFiles` 合同），默认不存在、非硬依赖
- `ui-conversation` 的 `InputBar` paste 分流（原生 probe 优先，`none`/无 Provider 回放原图片/文本链路）、`service.ts` 发送前 validate + 固定 marker、`input/{contract,facade,hub}.ts` 的通用 `attachmentIds` 迁移
- `ComposerAttachment`/`ComposerBarInjected` union 与通用附件入口、`ui-attachment` 文件卡片

上游 PR 合入并更新 submodule pin 后，Desktop 仓库只会提交 pin 变化与本表 §2 的实现；**不得**在 Desktop 工作树复制/vendor 上游 `InputBar`。上游可选能力未合入时，本实现仅能算 advanced-only 垂直原型，不宣称 compatibility 生产支持（设计 §14/§11）。

### 3.3 发送编排与 UI 生效（依赖上游）
本实现交付了 Host/Electron/Client Provider/序列化四层；「paste 触发 probe → draft 卡片 → 发送前 validate → 提交 prompt → 失败恢复」的完整交互入口在上游 `ui-conversation`，不在此仓库。P0 不新增结构化 `file-reference` prompt 变体，`sessions.ts`/`sessions.schema.ts` 未改。

## 4. 安全与验收对照（设计 §9/§14）

- [x] Renderer 不接触 Electron `clipboard`、Node fs、绝对路径、preload bridge
- [x] Host 只在 probe RPC 内读一次原生剪贴板，无轮询/缓存
- [x] probe 由系统剪贴板产生候选；validate 由 Host lease 定位，不信任 Client 路径
- [x] lstat/resolve/contains/stat 序覆盖目录、特殊文件、符号链接逃逸、TOCTOU；最终符号链接按 P0 拒绝
- [x] `FsTarget`/`FsVersion`/canonical 绝对路径/原始剪贴板字节不跨 RPC（契约 parser 强校验 + gateway 只返 leaseId/name/relativePath/size）
- [x] prompt marker 只含 Host 校验的 workspace 相对路径；`serializeFileReferences` 对非法路径 fail-loud
- [x] 普通文件不调用 `File.arrayBuffer()`/`readBytes()`/base64/AttachmentStore（fs seam 无读取成员，测试断言零读取）
- [x] 条目数/路径长度/payload/lease TTL/容量均有配置上限
- [x] leaseId 为 Host 随机 256-bit opaque id，绑定 session/workspace/target/version/size
- [ ] P0-0 真实平台手工验证（未执行，见 3.1）
- [ ] 上游组合/凭据快照（未执行，见 3.2/3.3）

代码级验证：`yarn run typecheck` 全绿；新增 clipboard/unittest 全绿；`file-preview-*` 回归无改动。已知的 `electron-runtime.spec.ts`（3 个）与 `plugin.spec.ts`（3 个）失败为 Windows 宿主上**测试文件原有**的路径分隔符/平台硬编码问题（HEAD 基线同样失败），与本次改动无关。
