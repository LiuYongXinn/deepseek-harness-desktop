import { useEffect, useRef, useState } from 'react'
import {
  Editor,
  commandsCtx,
  defaultValueCtx,
  editorViewCtx,
  rootCtx,
} from '@milkdown/core'
import {
  createCodeBlockCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
  commonmark,
} from '@milkdown/preset-commonmark'
import { history, redoCommand, undoCommand } from '@milkdown/plugin-history'
import { listener, listenerCtx } from '@milkdown/plugin-listener'

export type MarkdownEditorCommand =
  | 'undo'
  | 'redo'
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bold'
  | 'italic'
  | 'link'
  | 'bullet-list'
  | 'ordered-list'
  | 'task-list'
  | 'blockquote'
  | 'inline-code'
  | 'code-block'

export interface MarkdownEditorHandle {
  run(command: MarkdownEditorCommand): boolean
}

export interface MarkdownEditorProps {
  editorKey: string
  initialMarkdown: string
  onChange(markdown: string): void
  onReady?(markdown: string, handle: MarkdownEditorHandle): void
  onDestroy?(): void
}

function insertTaskList(editor: Editor): boolean {
  return editor.action(ctx => {
    const view = ctx.get(editorViewCtx)
    const { from, to } = view.state.selection
    const selected = view.state.doc.textBetween(from, to, '\n')
    const markdown = selected.length > 0
      ? selected.split('\n').map(line => `- [ ] ${line}`).join('\n')
      : '- [ ] '
    view.dispatch(view.state.tr.insertText(markdown, from, to))
    view.focus()
    return true
  })
}

function runCommand(editor: Editor, command: MarkdownEditorCommand): boolean {
  if (command === 'task-list') return insertTaskList(editor)
  return editor.action(ctx => {
    const commands = ctx.get(commandsCtx)
    switch (command) {
      case 'undo': return commands.call(undoCommand.key)
      case 'redo': return commands.call(redoCommand.key)
      case 'paragraph': return commands.call(turnIntoTextCommand.key)
      case 'h1': return commands.call(wrapInHeadingCommand.key, 1)
      case 'h2': return commands.call(wrapInHeadingCommand.key, 2)
      case 'h3': return commands.call(wrapInHeadingCommand.key, 3)
      case 'bold': return commands.call(toggleStrongCommand.key)
      case 'italic': return commands.call(toggleEmphasisCommand.key)
      case 'link': {
        const href = window.prompt('链接地址')
        return href === null || href.trim() === '' ? false : commands.call(toggleLinkCommand.key, { href: href.trim() })
      }
      case 'bullet-list': return commands.call(wrapInBulletListCommand.key)
      case 'ordered-list': return commands.call(wrapInOrderedListCommand.key)
      case 'blockquote': return commands.call(wrapInBlockquoteCommand.key)
      case 'inline-code': return commands.call(toggleInlineCodeCommand.key)
      case 'code-block': return commands.call(createCodeBlockCommand.key)
    }
  })
}

/** A direct React lifecycle adapter for the lean Milkdown packages. */
export function MarkdownEditor({ editorKey, initialMarkdown, onChange, onReady, onDestroy }: MarkdownEditorProps): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  const onReadyRef = useRef(onReady)
  const onDestroyRef = useRef(onDestroy)
  const initialMarkdownRef = useRef(initialMarkdown)
  const [failed, setFailed] = useState(false)

  onChangeRef.current = onChange
  onReadyRef.current = onReady
  onDestroyRef.current = onDestroy

  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    let disposed = false
    let created = false
    const seededMarkdown = initialMarkdownRef.current
    const editor = Editor.make()
      .config(ctx => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, seededMarkdown)
      })
      .use(commonmark)
      .use(history)
      .use(listener)
      .config(ctx => {
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          if (!disposed) onChangeRef.current(markdown)
        })
      })

    void editor.create()
      .then(() => {
        created = true
        if (disposed) {
          void editor.destroy()
          return
        }
        setFailed(false)
        onReadyRef.current?.(seededMarkdown, { run: command => runCommand(editor, command) })
      })
      .catch((error: unknown) => {
        console.error('dsh-plugin-desktop: Milkdown editor failed to mount', error)
        if (!disposed) setFailed(true)
      })

    return () => {
      disposed = true
      onDestroyRef.current?.()
      if (created || editor.status !== 'Destroyed') void editor.destroy()
    }
  }, [editorKey])

  return (
    <div className="dshDesktopMarkdownEditor" data-editor-key={editorKey}>
      {failed && <div className="dshDesktopNotice" role="status">所见即所得编辑器加载失败，请切换到源码编辑</div>}
      <div ref={rootRef} className="dshDesktopMarkdownEditorRoot" />
    </div>
  )
}
