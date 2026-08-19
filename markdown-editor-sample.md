# DSH Desktop Markdown 可编辑预览示例

这是一个用于测试 DSH Desktop 内置文件查看器 **Markdown 可编辑预览** 的示例文档。

> 提示：本文件内容都控制在 Milkdown 可安全往返的语法范围内，因此点击后会在右侧面板以**所见即所得编辑**模式打开。编辑后按 `Ctrl/Cmd+S` 立即保存，或停止输入约 800ms 后自动保存；右上角会显示 `未保存 / 保存中 / 已保存 / 保存失败 / 文件冲突` 状态。

## 1. 基础段落与强调

普通的段落文字，包含 **粗体**、*斜体*、***粗体加斜体*** 和 `行内代码`，以及一个[外链示例](https://github.com/anywhere-labs/deepseek-harness-desktop)。

## 2. 列表

### 无序列表

- 第一项
- 第二项
  - 嵌套子项
  - 另一个嵌套子项

### 有序列表

1. 第一步
2. 第二步
3. 第三步

## 3. 引用

> 这是一段引用文字。
> 可以跨越多行。
> - 引用内部也可以包含列表

## 4. 代码块

```ts
export function greet(name: string): string {
  return `Hello, ${name}!`
}
```

```bash
yarn install --immutable
```

## 5. 中文、emoji 与长 URL

这里包含中文内容、emoji 🚀✨ 以及一条较长的 URL：

https://www.example.com/very/long/path/to/a/page?foo=bar&baz=qux#section-123456789

## 6. 说明与边界

- 本文件默认进入 **所见即所得编辑**（`编辑` / `源码` 可切换）。
- 表格、任务列表、数学公式、脚注、front matter 或 raw HTML 会触发往返安全检查，当前版本会自动切换到 **源码编辑** 模式并提示原因。
- 你可以故意改成某种列表符号（`*` / `-` / `+`）再保存，保存会做语义等价的规范化，但不会丢失内容。
