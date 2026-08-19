/**
 * Desktop-owned Markdown fixture corpus.
 *
 * This module fixes the "full markdown render" syntax scope described in
 * docs/file-viewer-markdown-full-render-plan.zh.md: CommonMark + GFM + DSH's
 * math delimiters ($...$, $$...$$) + footnotes + YAML front matter + safe raw
 * HTML. MDX/JSX is deliberately out of scope and has no capability member.
 *
 * Every later step (Preview, Editor schema, source-preserving serializer,
 * removal of downgrade rules) must continue to satisfy the invariant spec at
 * tests/file-preview-markdown-corpus.client.spec.tsx. The corpus is the single
 * source of truth: a new capability is added here first as a string-literal
 * member of `MarkdownCapability`, then exercised by at least one fixture.
 *
 * This module is intentionally node-safe: it has no runtime dependencies and
 * never touches the DOM, so it can be imported from both jsdom specs and any
 * future headless tooling.
 */

/**
 * Every Markdown capability the "full render" effort must preserve. The union
 * is closed (string literals only) so a typo anywhere in the corpus fails the
 * typecheck instead of silently widening the scope.
 */
export type MarkdownCapability =
  | 'gfm-table'
  | 'table-align-left'
  | 'table-align-right'
  | 'table-align-center'
  | 'table-cell-chinese'
  | 'table-cell-rich'
  | 'table-escaped-pipe'
  | 'task-list'
  | 'inline-math'
  | 'display-math'
  | 'malformed-tex'
  | 'footnote-reference'
  | 'footnote-definition-multiparagraph'
  | 'footnote-multi-ref'
  | 'front-matter-with-body'
  | 'front-matter-only'
  | 'raw-html-allowlisted'
  | 'raw-html-script-inert'
  | 'raw-html-event-inert'
  | 'raw-html-dangerous-url'
  | 'html-comment'
  | 'gfm-strikethrough'
  | 'autolink'
  | 'code-block'
  | 'blockquote'
  | 'unknown-extension'
  | 'incomplete-markdown'

export interface MarkdownFixture {
  /** kebab-case, unique identifier used by fixtureById / fixturesByCapability. */
  id: string
  /** Short human-readable title; may be Chinese product-facing text. */
  title: string
  /** Pinned Markdown source text. Never normalized by the corpus itself. */
  markdown: string
  /** Capabilities this fixture exercises. Must be a subset of the union. */
  capabilities: readonly MarkdownCapability[]
  /** Optional note record; may be Chinese product-facing text. */
  note?: string
}

export const MARKDOWN_FIXTURES: readonly MarkdownFixture[] = [
  {
    id: 'gfm-table-basic',
    title: 'GFM 基础表格（左对齐）',
    markdown: `| 名称   | 用途         |
| ------ | ------------ |
| parse  | 解析 Markdown |
| render | 渲染 DOM      |
| save   | 序列化回 Markdown |`,
    capabilities: ['gfm-table', 'table-align-left'],
    note: '多列多行的 GFM 管道表格，默认左对齐。',
  },
  {
    id: 'table-alignments',
    title: '表格三种对齐',
    markdown: `| 左   | 居中 | 右 |
| :--- | :--: | --: |
| a    |  b   |  c |
| long | mid  |  d |`,
    capabilities: ['gfm-table', 'table-align-left', 'table-align-right', 'table-align-center'],
    note: '同一表格中同时出现 :---、:---: 和 ---: 三种分隔符。',
  },
  {
    id: 'table-chinese-cells',
    title: '表格中文单元格',
    markdown: `| 字段     | 说明               |
| -------- | ------------------ |
| 标题     | 文档主标题         |
| 作者     | 负责维护此文档的人 |
| 更新日期 | 最近一次的修改日期 |`,
    capabilities: ['gfm-table', 'table-cell-chinese'],
    note: '验证多字节字符在表格中的宽度和对齐不被破坏。',
  },
  {
    id: 'table-rich-cells',
    title: '表格富文本单元格',
    markdown: `| 概念         | 公式           |
| ------------ | -------------- |
| 内积         | $\\langle a, b\\rangle$ |
| [文档](https://example.com) 与 **粗体** | $E = mc^2$ |
| 删除线        | ~~已废弃~~      |`,
    capabilities: ['gfm-table', 'table-cell-rich', 'inline-math', 'gfm-strikethrough'],
    note: '单元格中同时出现链接、粗体、行内数学和删除线。',
  },
  {
    id: 'table-escaped-pipe',
    title: '表格转义竖线',
    markdown: `| key   | value                    |
| ----- | ------------------------ |
| pipe  | a \\| b                  |
| code  | \\|\\|                  |`,
    capabilities: ['gfm-table', 'table-escaped-pipe'],
    note: '单元格内用反斜杠转义的 | 不应被当作列分隔符。',
  },
  {
    id: 'task-list-states',
    title: '任务列表勾选状态',
    markdown: `- [x] 已完成的任务
- [ ] 未开始的任务
- [X] 大写 X 也应视为已勾选
-   [ ] 前后有空白缩进的任务项`,
    capabilities: ['task-list'],
    note: '同时覆盖 [x]、[ ]、[X] 和带前置空格的写法。',
  },
  {
    id: 'math-inline',
    title: '行内数学公式',
    markdown: `设 $a$ 和 $b$ 为实数，则 $(a + b)^2 = a^2 + 2ab + b^2$。公式可混排 $x \\in [0, 1]$ 于正文中。`,
    capabilities: ['inline-math'],
    note: '单个 $ 包裹的行内公式，使用 DSH 数学分隔符。',
  },
  {
    id: 'math-display',
    title: '块级数学公式',
    markdown: `由欧拉公式可得：

$$
e^{i\\pi} + 1 = 0
$$

该式被多行渲染。`,
    capabilities: ['display-math'],
    note: '$$...$$ 包裹的块级公式，独立成段。',
  },
  {
    id: 'math-malformed-tex',
    title: '病理性 TeX',
    markdown: `一个未闭合的公式：\\frac{1}{2 以及残缺的根号 \\sqrt{ 都缺少右花括号。`,
    capabilities: ['malformed-tex'],
    note: '畸形 TeX 必须保留原始文本，不得整体丢弃文档。',
  },
  {
    id: 'footnote-multiparagraph',
    title: '多段脚注定义',
    markdown: `这是正文[^注1]。

[^注1]: 第一段注释。

    第二段注释，缩进之后仍属于同一条脚注。`,
    capabilities: ['footnote-reference', 'footnote-definition-multiparagraph'],
    note: '定义包含多个段落，缩进块继续归属同一脚注。',
  },
  {
    id: 'footnote-multi-ref',
    title: '同一脚注多次引用',
    markdown: `首次引用[^src]，再次引用[^src]，第三次引用[^src]。

[^src]: 这条定义被同页多次引用。`,
    capabilities: ['footnote-reference', 'footnote-multi-ref'],
    note: '同一 [^src] 定义被引用多次，引用号需保持关联。',
  },
  {
    id: 'front-matter-with-body',
    title: 'front matter 与正文',
    markdown: `---
title: 示例文档
tags:
  - markdown
  - desktop
draft: false
---

# 正文标题

这是 front matter 后的正文内容。`,
    capabilities: ['front-matter-with-body'],
    note: 'YAML 块以 --- 分隔，其后是 Markdown 正文。',
  },
  {
    id: 'front-matter-only',
    title: '仅 front matter',
    markdown: `---
title: 仅有元数据
draft: true
---`,
    capabilities: ['front-matter-only'],
    note: '文件只含 YAML 元数据，没有正文。',
  },
  {
    id: 'raw-html-allowlisted',
    title: '白名单安全 HTML',
    markdown: `这是一段 <em>斜体强调</em> 和 <strong>加粗强调</strong> 的文本。`,
    capabilities: ['raw-html-allowlisted'],
    note: 'inert 标签最终应渲染为视觉效果，而不作为文本串展示。',
  },
  {
    id: 'raw-html-script-inert',
    title: 'script 永不执行',
    markdown: `<script>alert(1)</script>

正文继续。`,
    capabilities: ['raw-html-script-inert'],
    note: '<script> 内容绝不能执行或进入 DOM。',
  },
  {
    id: 'raw-html-event-inert',
    title: '事件属性永不触发',
    markdown: `<img src="x" onerror="alert(1)">

<div onclick="alert(2)">点击我</div>`,
    capabilities: ['raw-html-event-inert'],
    note: 'on* 事件处理器必须被剥离或保持 inert。',
  },
  {
    id: 'raw-html-dangerous-url',
    title: '危险 URL/iframe 不加载',
    markdown: `<a href="javascript:alert(1)">危险链接</a>

<iframe src="https://example.com/embed"></iframe>`,
    capabilities: ['raw-html-dangerous-url'],
    note: 'javascript: 协议和 iframe 不得被激活或加载外部资源。',
  },
  {
    id: 'html-comment',
    title: 'HTML 注释',
    markdown: `正文开始。

<!-- 这是不应显示的注释内容 -->

正文结束。`,
    capabilities: ['html-comment'],
    note: '注释应被识别为注释语法，而不是 raw 文本或可执行内容。',
  },
  {
    id: 'gfm-strikethrough',
    title: 'GFM 删除线',
    markdown: '这段是 ~~已删除内容~~，这段是 ~~~~intact~~ 保留。',
    capabilities: ['gfm-strikethrough'],
  },
  {
    id: 'autolink',
    title: '自动链接',
    markdown: '访问 https://example.com 或 www.example.org 或邮箱 user@example.com。',
    capabilities: ['autolink'],
  },
  {
    id: 'code-block',
    title: '代码块',
    markdown: '```ts\nconst answer: number = 42\nexport default answer\n```\n\n行内 \`code\` 保留原样。',
    capabilities: ['code-block'],
    note: '围栏代码块与行内代码均应保留。',
  },
  {
    id: 'blockquote',
    title: '引用块',
    markdown: `> 第一行引用。
>
> 第二行引用，包含 **加粗**。`,
    capabilities: ['blockquote'],
  },
  {
    id: 'unknown-extension',
    title: '未知扩展节点',
    markdown: `:::custom-directive
这段自定义指令应保留为原始节点，绝不能被静默删除。
:::

{% raw %}
Jinja 风格原始块也应作为不透明节点保留。
{% endraw %}`,
    capabilities: ['unknown-extension'],
    note: '不熟悉的语法必须以 source-preserving 方式保留。',
  },
  {
    id: 'incomplete-markdown',
    title: '不完整的 Markdown',
    markdown: '```js\nconst broken = 1\n\n公式也未闭合：$$\\sum_{i=1}^{n} i',
    capabilities: ['incomplete-markdown'],
    note: '未闭合代码围栏与未终止的块级数学，解析器不得崩溃或丢弃其它内容。',
  },
]

/** Canonical ordered list of every capability in the closed union. */
export const MARKDOWN_CAPABILITIES: readonly MarkdownCapability[] = [
  'gfm-table',
  'table-align-left',
  'table-align-right',
  'table-align-center',
  'table-cell-chinese',
  'table-cell-rich',
  'table-escaped-pipe',
  'task-list',
  'inline-math',
  'display-math',
  'malformed-tex',
  'footnote-reference',
  'footnote-definition-multiparagraph',
  'footnote-multi-ref',
  'front-matter-with-body',
  'front-matter-only',
  'raw-html-allowlisted',
  'raw-html-script-inert',
  'raw-html-event-inert',
  'raw-html-dangerous-url',
  'html-comment',
  'gfm-strikethrough',
  'autolink',
  'code-block',
  'blockquote',
  'unknown-extension',
  'incomplete-markdown',
]

const FIXTURE_INDEX: ReadonlyMap<string, MarkdownFixture> = new Map(
  MARKDOWN_FIXTURES.map(fixture => [fixture.id, fixture]),
)

/** Return the fixture with the given id, throwing a descriptive Error if absent. */
export function fixtureById(id: string): MarkdownFixture {
  const fixture = FIXTURE_INDEX.get(id)
  if (fixture === undefined) {
    throw new Error(
      `Unknown markdown fixture id "${id}". Valid ids: ${[...FIXTURE_INDEX.keys()].join(', ')}`,
    )
  }
  return fixture
}

/** All fixtures that exercise the given capability, in canonical order. */
export function fixturesByCapability(capability: MarkdownCapability): readonly MarkdownFixture[] {
  return MARKDOWN_FIXTURES.filter(fixture => fixture.capabilities.includes(capability))
}
