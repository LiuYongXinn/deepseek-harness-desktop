# Markdown 渲染能力矩阵（Desktop-owned fixture corpus）

> 状态：活文档。本矩阵固定“全量 Markdown 渲染”的语法范围，并跟踪每条语法族在后续步骤中的落地状态。与
> `docs/file-viewer-markdown-full-render-plan.zh.md` §1（语法范围）、§10.2（corpus）、§11（实施顺序）、§12（验收）保持一致。
> 每完成一个步骤，就同步翻转本文的「状态」列。

## 语法范围

- **范围内**：CommonMark、GFM（表格 / 任务列表 / 删除线 / 自动链接 / 脚注）、DSH 数学分隔符 `$...$` / `$$...$$`、
  YAML front matter、以及经过严格 allowlist 清洗的 raw HTML。
- **范围外（明确不纳入）**：MDX / JSX 是另一种语法，不应被当作普通 `.md` 的隐式扩展；若需支持需单独设计不执行任意 JSX 的解析与安全模型。

## 列说明

- **语法族**：一个可独立验证的语法单元。
- **Preview（`MarkdownText`）**：复用已发布 `@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText` 只读渲染器（见计划 §6.1）。`已支持（需 fixture 验证）` 表示上游实现已覆盖，待后续步骤用 corpus 验证其 DOM 呈现。
- **Editor 节点**：Milkdown schema 节点与编辑支持，全部 `规划中（步骤 N）`，对应计划 §11。
- **Serializer**：source-preserving 序列化能力，`规划中（步骤 N）`，对应计划 §11。
- **旧降级规则**：`checkRoundTripSafety()` 中对应的正则。该函数位于
  `src/client/file-preview/providers/MarkdownPreview.tsx`，目前只读，不在本步骤修改。
- **Corpus fixture id(s)**：`tests/fixtures/markdown/corpus.ts` 中覆盖该语法族的 fixture。
- **状态**：`待实现` 表示尚未建立或验证；`已建 fixture` 表示本步（步骤 1）已为它建立 corpus fixture。

## 能力矩阵

| 语法族 | Preview（`MarkdownText`） | Editor 节点 | Serializer | 旧降级规则 | Corpus fixture id(s) | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| GFM 表格 | 已支持（需 fixture 验证） | 规划中（步骤 3） | 规划中（步骤 3） | `/(^|\n)\s*\|?.+\|.+\r?\n\s*\|?\s*:?-{3,}/` | `gfm-table-basic`, `table-alignments`, `table-chinese-cells`, `table-rich-cells`, `table-escaped-pipe` | 已建 fixture |
| 表格左对齐 | 已支持（需 fixture 验证） | 规划中（步骤 3） | 规划中（步骤 3） | `/(^|\n)\s*\|?.+\|.+\r?\n\s*\|?\s*:?-{3,}/` | `gfm-table-basic`, `table-alignments` | 已建 fixture |
| 表格右对齐 | 已支持（需 fixture 验证） | 规划中（步骤 3） | 规划中（步骤 3） | `/(^|\n)\s*\|?.+\|.+\r?\n\s*\|?\s*:?-{3,}/` | `table-alignments` | 已建 fixture |
| 表格居中 | 已支持（需 fixture 验证） | 规划中（步骤 3） | 规划中（步骤 3） | `/(^|\n)\s*\|?.+\|.+\r?\n\s*\|?\s*:?-{3,}/` | `table-alignments` | 已建 fixture |
| 表格中文单元格 | 已支持（需 fixture 验证） | 规划中（步骤 3） | 规划中（步骤 3） | `/(^|\n)\s*\|?.+\|.+\r?\n\s*\|?\s*:?-{3,}/` | `table-chinese-cells` | 已建 fixture |
| 表格富文本单元格（粗体+链接+数学） | 已支持（需 fixture 验证） | 规划中（步骤 3 / 6） | 规划中（步骤 3 / 6） | `/(^|\n)\s*\|?.+\|.+\r?\n\s*\|?\s*:?-{3,}/` | `table-rich-cells` | 已建 fixture |
| 表格转义竖线 `\|` | 已支持（需 fixture 验证） | 规划中（步骤 3） | 规划中（步骤 3） | `/(^|\n)\s*\|?.+\|.+\r?\n\s*\|?\s*:?-{3,}/` | `table-escaped-pipe` | 已建 fixture |
| 任务列表 | 已支持（需 fixture 验证） | 规划中（步骤 3） | 规划中（步骤 3） | `/(^|\n)\s*[-*+]\s+\[[ xX]\]\s+/` | `task-list-states` | 已建 fixture |
| 行内数学 `$...$` | 已支持（需 fixture 验证） | 规划中（步骤 6） | 规划中（步骤 6） | `/(^|[^\\])\$\$?[\s\S]*?\$\$?/` | `math-inline`, `table-rich-cells` | 已建 fixture |
| 块级数学 `$$...$$` | 已支持（需 fixture 验证） | 规划中（步骤 6） | 规划中（步骤 6） | `/(^|[^\\])\$\$?[\s\S]*?\$\$?/` | `math-display` | 已建 fixture |
| 病理性 TeX | 已支持（需 fixture 验证） | 规划中（步骤 6） | 规划中（步骤 6） | `/(^|[^\\])\$\$?[\s\S]*?\$\$?/` | `math-malformed-tex` | 已建 fixture |
| 脚注引用 | 已支持（需 fixture 验证） | 规划中（步骤 6） | 规划中（步骤 6） | `/(^|\n)\[\^[^\]]+\]:\|\[\^[^\]]+\]/` | `footnote-multiparagraph`, `footnote-multi-ref` | 已建 fixture |
| 脚注多段定义 | 已支持（需 fixture 验证） | 规划中（步骤 6） | 规划中（步骤 6） | `/(^|\n)\[\^[^\]]+\]:\|\[\^[^\]]+\]/` | `footnote-multiparagraph` | 已建 fixture |
| 脚注多次引用 | 已支持（需 fixture 验证） | 规划中（步骤 6） | 规划中（步骤 6） | `/(^|\n)\[\^[^\]]+\]:\|\[\^[^\]]+\]/` | `footnote-multi-ref` | 已建 fixture |
| YAML front matter（含正文） | 未知节点暂忽略（规划中） | 规划中（步骤 5） | 规划中（步骤 5） | `/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n\|$)/` | `front-matter-with-body` | 已建 fixture |
| 仅 front matter | 未知节点暂忽略（规划中） | 规划中（步骤 5） | 规划中（步骤 5） | `/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n\|$)/` | `front-matter-only` | 已建 fixture |
| raw HTML（白名单 inert 标签） | 已支持（需 fixture 验证） | 规划中（步骤 4 / 7） | 规划中（步骤 4 / 7） | `/<\/?[A-Za-z][^>]*>/` | `raw-html-allowlisted` | 已建 fixture |
| raw HTML（script 永不执行） | 已支持（需 fixture 验证） | 规划中（步骤 4 / 7） | 规划中（步骤 4 / 7） | `/<\/?[A-Za-z][^>]*>/` | `raw-html-script-inert` | 已建 fixture |
| raw HTML（事件属性 inert） | 已支持（需 fixture 验证） | 规划中（步骤 4 / 7） | 规划中（步骤 4 / 7） | `/<\/?[A-Za-z][^>]*>/` | `raw-html-event-inert` | 已建 fixture |
| raw HTML（危险 URL / iframe） | 已支持（需 fixture 验证） | 规划中（步骤 4 / 7） | 规划中（步骤 4 / 7） | `/<\/?[A-Za-z][^>]*>/` | `raw-html-dangerous-url` | 已建 fixture |
| HTML 注释 | 已支持（需 fixture 验证） | 规划中（步骤 4 / 7） | 规划中（步骤 4 / 7） | `/<!--[\s\S]*?-->/` | `html-comment` | 已建 fixture |
| GFM 删除线 | 已支持（需 fixture 验证） | 规划中（步骤 3） | 规划中（步骤 3） | 无专门正则（随表格/任务列表移除） | `gfm-strikethrough`, `table-rich-cells` | 已建 fixture |
| 自动链接 | 已支持（需 fixture 验证） | 规划中（步骤 3） | 规划中（步骤 3） | 无专门正则 | `autolink` | 已建 fixture |
| 代码块 | 已支持（需 fixture 验证） | 已支持（CommonMark 内置） | 已支持（CommonMark 内置） | 无专门正则 | `code-block` | 已建 fixture |
| 引用块 | 已支持（需 fixture 验证） | 已支持（CommonMark 内置） | 已支持（CommonMark 内置） | 无专门正则 | `blockquote` | 已建 fixture |
| 未知扩展节点（`:::` / `{% raw %}`） | 未知节点保留（规划中） | 规划中（步骤 6：raw-markdown） | 规划中（步骤 6） | 无专门正则 | `unknown-extension` | 已建 fixture |
| 不完整 Markdown | 已支持（需 fixture 验证，不得崩溃/丢弃） | 规划中（步骤 6：诊断保留） | 规划中（步骤 6） | 无专门正则 | `incomplete-markdown` | 已建 fixture |

## 规则移除里程碑（对照计划 §11）

- 步骤 4：移除 table / task-list 两条降级规则（含表格与任务列表正则），并先验证现有 `html` atom 对 raw HTML / HTML 注释的保留结果。
- 步骤 7：完成 front matter、math、footnote、raw Markdown 节点后，统一移除 `checkRoundTripSafety` 与 256 KiB 的 ViewMode 强制切换。
- 本步骤（步骤 1）不修改 `MarkdownPreview.tsx`、任何降级正则或产品代码。

## 更新约定

- 新增 capability 时：先在 `corpus.ts` 的 `MarkdownCapability` 联合类型与 `MARKDOWN_CAPABILITIES` 中登记，再补充至少一个 fixture，并在本表新增一行。
- 每个能力在「状态」列 = `待实现` 时，即表示该语法尚未有 fixture 或未被验证；当建立 fixture 后翻转为 `已建 fixture`，后续步骤完成实现后再翻转为 `已实现`。
