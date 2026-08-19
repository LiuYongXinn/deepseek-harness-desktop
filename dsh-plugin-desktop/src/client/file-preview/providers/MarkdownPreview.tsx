import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import type { FilePreviewProvider, FilePreviewRendererProps } from '../registry.ts'
import {
  MarkdownEditor,
  type MarkdownEditorCommand,
  type MarkdownEditorHandle,
  type MarkdownEditorProps,
} from './MarkdownEditor.tsx'

/** WYSIWYG editing is enabled only within this UTF-8 byte budget. */
export const MARKDOWN_PREVIEW_MAX_BYTES = 256 * 1024
export const MARKDOWN_AUTOSAVE_DELAY_MS = 800

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

type ViewMode = 'edit' | 'source'

export interface MarkdownViewProps extends FilePreviewRendererProps {
  EditorComponent?: ComponentType<MarkdownEditorProps>
}

interface RoundTripCheck {
  safe: boolean
  reason?: string
}

/** CommonMark-only Milkdown must not silently remove syntax it does not model. */
function checkRoundTripSafety(markdown: string): RoundTripCheck {
  const checks: Array<[RegExp, string]> = [
    [/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '包含 front matter'],
    [/(^|\n)\s*\|?.+\|.+\r?\n\s*\|?\s*:?-{3,}/, '包含表格'],
    [/(^|\n)\s*[-*+]\s+\[[ xX]\]\s+/, '包含任务列表'],
    [/(^|[^\\])\$\$?[\s\S]*?\$\$?/, '包含数学公式'],
    [/(^|\n)\[\^[^\]]+\]:|\[\^[^\]]+\]/, '包含脚注'],
    [/<!--[\s\S]*?-->/, '包含 HTML 注释'],
    [/<\/?[A-Za-z][^>]*>/, '包含 raw HTML'],
  ]
  const unsupported = checks.find(([pattern]) => pattern.test(markdown))
  return unsupported === undefined ? { safe: true } : { safe: false, reason: unsupported[1] }
}

function ModeTabs({ mode, canEdit, onChange }: { mode: ViewMode; canEdit: boolean; onChange(mode: ViewMode): void }) {
  return (
    <div className="dshDesktopSegmentedControl" role="tablist" aria-label="Markdown 视图">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'edit'}
        aria-disabled={!canEdit}
        disabled={!canEdit}
        tabIndex={mode === 'edit' ? 0 : -1}
        onClick={() => { onChange('edit') }}
      >
        编辑
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'source'}
        tabIndex={mode === 'source' ? 0 : -1}
        onClick={() => { onChange('source') }}
      >
        源码
      </button>
    </div>
  )
}

const PRIMARY_COMMANDS: Array<{ command: MarkdownEditorCommand; label: string }> = [
  { command: 'undo', label: '撤销' },
  { command: 'redo', label: '重做' },
  { command: 'paragraph', label: '段落' },
  { command: 'h1', label: 'H1' },
  { command: 'h2', label: 'H2' },
  { command: 'h3', label: 'H3' },
  { command: 'bold', label: '粗体' },
  { command: 'italic', label: '斜体' },
]

const OVERFLOW_COMMANDS: Array<{ command: MarkdownEditorCommand; label: string }> = [
  { command: 'link', label: '链接' },
  { command: 'bullet-list', label: '无序列表' },
  { command: 'ordered-list', label: '有序列表' },
  { command: 'task-list', label: '任务列表' },
  { command: 'blockquote', label: '引用' },
  { command: 'inline-code', label: '行内代码' },
  { command: 'code-block', label: '代码块' },
]

function Toolbar({ handle, saveDisabled, onSave }: { handle: MarkdownEditorHandle | null; saveDisabled: boolean; onSave(): void }) {
  return (
    <div className="dshDesktopMarkdownToolbar" role="toolbar" aria-label="Markdown 编辑工具栏">
      <button type="button" className="dshDesktopMarkdownToolbarSave" disabled={saveDisabled} onClick={onSave}>保存</button>
      <div className="dshDesktopMarkdownToolbarCommands">
        {PRIMARY_COMMANDS.map(item => (
          <button key={item.command} type="button" disabled={handle === null} onClick={() => { handle?.run(item.command) }}>
            {item.label}
          </button>
        ))}
      </div>
      <details className="dshDesktopMarkdownOverflow">
        <summary aria-label="更多格式">更多</summary>
        <div className="dshDesktopMarkdownOverflowMenu">
          {OVERFLOW_COMMANDS.map(item => (
            <button key={item.command} type="button" disabled={handle === null} onClick={() => { handle?.run(item.command) }}>
              {item.label}
            </button>
          ))}
        </div>
      </details>
    </div>
  )
}

/** Editable Markdown provider with a shared draft across WYSIWYG and source modes. */
export function MarkdownView({
  descriptor,
  content,
  saveState,
  onDraftChange,
  onSaveRequest,
  EditorComponent = MarkdownEditor,
}: MarkdownViewProps): React.ReactElement {
  if (content.kind !== 'text') throw new Error('markdown provider requires text content')

  const resourceKey = descriptor.availability === 'available' ? String(descriptor.resourceId) : descriptor.displayPath
  const safety = useMemo(() => checkRoundTripSafety(content.text), [content.text])
  const withinBudget = useMemo(() => byteLength(content.text) <= MARKDOWN_PREVIEW_MAX_BYTES, [content.text])
  const canEditWysiwyg = withinBudget && safety.safe
  const [mode, setMode] = useState<ViewMode>(canEditWysiwyg ? 'edit' : 'source')
  const [draft, setDraft] = useState(saveState?.draftText ?? content.text)
  const [editorHandle, setEditorHandle] = useState<MarkdownEditorHandle | null>(null)
  const draftRef = useRef(draft)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveStateRef = useRef(saveState)
  const saveRequestRef = useRef(onSaveRequest)

  draftRef.current = draft
  saveStateRef.current = saveState
  saveRequestRef.current = onSaveRequest

  const clearAutosave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }, [])

  const requestSave = useCallback(() => {
    clearAutosave()
    const currentSaveState = saveStateRef.current
    if (currentSaveState?.conflict !== undefined || currentSaveState?.saving === true) return
    void saveRequestRef.current?.(draftRef.current)
  }, [clearAutosave])

  const updateDraft = useCallback((markdown: string) => {
    draftRef.current = markdown
    setDraft(markdown)
    onDraftChange?.(markdown)
    clearAutosave()
    if (saveStateRef.current?.conflict === undefined && saveStateRef.current?.saving !== true && saveRequestRef.current !== undefined) {
      saveTimerRef.current = setTimeout(requestSave, MARKDOWN_AUTOSAVE_DELAY_MS)
    }
  }, [clearAutosave, onDraftChange, requestSave])

  useEffect(() => {
    clearAutosave()
    const nextDraft = saveState?.draftText ?? content.text
    draftRef.current = nextDraft
    setDraft(nextDraft)
    setMode(canEditWysiwyg ? 'edit' : 'source')
    setEditorHandle(null)
  }, [resourceKey])

  useEffect(() => {
    if (saveState?.draftText !== undefined && saveState.draftText !== draftRef.current) {
      draftRef.current = saveState.draftText
      setDraft(saveState.draftText)
    }
    if (saveState?.conflict !== undefined) clearAutosave()
  }, [saveState?.draftText, saveState?.conflict, clearAutosave])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        requestSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      clearAutosave()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [clearAutosave, requestSave])

  const effectiveMode: ViewMode = canEditWysiwyg ? mode : 'source'
  const fallbackReason = !withinBudget
    ? `文档超过 ${MARKDOWN_PREVIEW_MAX_BYTES / 1024} KiB 所见即所得编辑上限，已切换到源码编辑。`
    : !safety.safe
      ? `${safety.reason ?? '文档包含不支持的语法'}，为避免内容丢失已切换到源码编辑。`
      : undefined

  return (
    <div className="dshDesktopMarkdownView">
      <div className="dshDesktopMarkdownViewHeader">
        <ModeTabs mode={effectiveMode} canEdit={canEditWysiwyg} onChange={setMode} />
        {effectiveMode === 'edit' && (
          <Toolbar
            handle={editorHandle}
            saveDisabled={saveState?.saving === true || saveState?.dirty !== true || saveState?.conflict !== undefined}
            onSave={requestSave}
          />
        )}
      </div>
      {fallbackReason !== undefined && <div className="dshDesktopNotice" role="status">{fallbackReason}</div>}
      {effectiveMode === 'edit'
        ? (
          <EditorComponent
            key={resourceKey}
            editorKey={resourceKey}
            initialMarkdown={draft}
            onChange={updateDraft}
            onReady={(_markdown, handle) => { setEditorHandle(handle) }}
            onDestroy={() => { setEditorHandle(null) }}
          />
        )
        : (
          <textarea
            className="dshDesktopMarkdownSourceEditor"
            aria-label="Markdown 源码"
            value={draft}
            onChange={event => { updateDraft(event.currentTarget.value) }}
            spellCheck={false}
          />
        )}
    </div>
  )
}

/** Register the existing semantic Markdown provider without changing its rank. */
export function registerMarkdownProvider(registry: { register(provider: FilePreviewProvider): () => void }): () => void {
  return registry.register({
    id: 'desktop.markdown',
    priority: 350,
    loadMode: 'text',
    supports: descriptor => descriptor.contentKind === 'text'
      && descriptor.mediaType === 'text/markdown'
      && descriptor.language === 'markdown',
    Component: MarkdownView,
  })
}
