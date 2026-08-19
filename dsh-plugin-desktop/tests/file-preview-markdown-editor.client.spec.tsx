// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { FilePreviewResourceId as brandResourceId, FilePreviewRevision } from '../src/file-preview-contract.ts'
import type { FilePreviewSaveState } from '../src/client/file-preview/controller.ts'
import type { MarkdownEditorProps } from '../src/client/file-preview/providers/MarkdownEditor.tsx'
import {
  MARKDOWN_AUTOSAVE_DELAY_MS,
  MarkdownView,
  type MarkdownViewProps,
} from '../src/client/file-preview/providers/MarkdownPreview.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const editorLifecycle = { mounted: 0, destroyed: 0 }

function FakeMarkdownEditor({ initialMarkdown, onChange, onReady, onDestroy }: MarkdownEditorProps): React.ReactElement {
  useEffect(() => {
    editorLifecycle.mounted += 1
    onReady?.(initialMarkdown, { run: () => true })
    return () => {
      editorLifecycle.destroyed += 1
      onDestroy?.()
    }
  }, [])
  return (
    <textarea
      data-testid="fake-wysiwyg"
      value={initialMarkdown}
      onChange={event => { onChange(event.currentTarget.value) }}
    />
  )
}

function saveState(overrides: Partial<FilePreviewSaveState> = {}): FilePreviewSaveState {
  return {
    baselineRevision: FilePreviewRevision('rev-1'),
    draftText: '# hello',
    dirty: true,
    saving: false,
    saved: false,
    lastSaveError: undefined,
    conflict: undefined,
    ...overrides,
  }
}

function props(overrides: Partial<MarkdownViewProps> = {}): MarkdownViewProps {
  return {
    descriptor: {
      availability: 'available',
      resourceId: brandResourceId('rid-markdown'),
      displayPath: '/w/readme.md',
      name: 'readme.md',
      extension: '.md',
      mediaType: 'text/markdown',
      contentKind: 'text',
      language: 'markdown',
      size: 7,
    },
    content: { kind: 'text', text: '# hello' },
    saveState: saveState(),
    onOpenExternally: () => {},
    EditorComponent: FakeMarkdownEditor,
    ...overrides,
  }
}

function mount(viewProps: MarkdownViewProps) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<MarkdownView {...viewProps} />) })
  const rerender = (next: MarkdownViewProps): void => {
    act(() => { root.render(<MarkdownView {...next} />) })
  }
  const cleanup = (): void => {
    act(() => { root.unmount() })
    container.remove()
  }
  return { container, rerender, cleanup }
}

function changeTextarea(element: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  act(() => {
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('MarkdownView editable adapter integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    editorLifecycle.mounted = 0
    editorLifecycle.destroyed = 0
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('opens ordinary markdown in the editable WYSIWYG view', () => {
    const view = mount(props())
    expect(view.container.querySelector('[data-testid="fake-wysiwyg"]')).not.toBeNull()
    expect(view.container.querySelector('pre')).toBeNull()
    expect(view.container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('编辑')
    view.cleanup()
  })

  it('saves the latest draft immediately on Ctrl/Cmd+S', () => {
    const onSaveRequest = vi.fn().mockResolvedValue({ status: 'ok', revision: FilePreviewRevision('rev-2') })
    const view = mount(props({ onSaveRequest }))
    const editor = view.container.querySelector<HTMLTextAreaElement>('[data-testid="fake-wysiwyg"]')!
    changeTextarea(editor, '# newest')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }))
    })

    expect(onSaveRequest).toHaveBeenCalledTimes(1)
    expect(onSaveRequest).toHaveBeenCalledWith('# newest')
    view.cleanup()
  })

  it('autosaves once after the 800ms typing debounce', () => {
    const onSaveRequest = vi.fn().mockResolvedValue({ status: 'ok', revision: FilePreviewRevision('rev-2') })
    const view = mount(props({ onSaveRequest }))
    changeTextarea(view.container.querySelector<HTMLTextAreaElement>('[data-testid="fake-wysiwyg"]')!, '# debounce')

    act(() => { vi.advanceTimersByTime(MARKDOWN_AUTOSAVE_DELAY_MS - 1) })
    expect(onSaveRequest).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(onSaveRequest).toHaveBeenCalledOnce()
    expect(onSaveRequest).toHaveBeenCalledWith('# debounce')
    view.cleanup()
  })

  it('destroys the editor and clears key and timer listeners on unmount', () => {
    const onSaveRequest = vi.fn().mockResolvedValue({ status: 'ok', revision: FilePreviewRevision('rev-2') })
    const view = mount(props({ onSaveRequest }))
    changeTextarea(view.container.querySelector<HTMLTextAreaElement>('[data-testid="fake-wysiwyg"]')!, '# pending')
    expect(editorLifecycle.mounted).toBe(1)

    view.cleanup()
    expect(editorLifecycle.destroyed).toBe(1)
    act(() => {
      vi.advanceTimersByTime(MARKDOWN_AUTOSAVE_DELAY_MS)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))
    })
    expect(onSaveRequest).not.toHaveBeenCalled()
  })

  it('preserves the local draft and pauses autosave during a conflict', () => {
    const onSaveRequest = vi.fn().mockResolvedValue({ status: 'ok', revision: FilePreviewRevision('rev-2') })
    const onDraftChange = vi.fn()
    const conflicted = saveState({
      draftText: '# local draft',
      conflict: { code: 'stale-version', message: 'disk changed' },
    })
    const view = mount(props({ saveState: conflicted, onSaveRequest, onDraftChange }))
    const editor = view.container.querySelector<HTMLTextAreaElement>('[data-testid="fake-wysiwyg"]')!
    expect(editor.value).toBe('# local draft')
    changeTextarea(editor, '# still local')
    act(() => { vi.advanceTimersByTime(MARKDOWN_AUTOSAVE_DELAY_MS) })

    expect(onDraftChange).toHaveBeenCalledWith('# still local')
    expect(onSaveRequest).not.toHaveBeenCalled()
    view.cleanup()
  })

  it('uses source editing with a notice for unsupported round-trip syntax', () => {
    const view = mount(props({
      content: { kind: 'text', text: '---\ntitle: test\n---\n# hello' },
      saveState: saveState({ draftText: '---\ntitle: test\n---\n# hello' }),
    }))
    expect(view.container.querySelector('.dshDesktopMarkdownSourceEditor')).not.toBeNull()
    expect(view.container.querySelector('[data-testid="fake-wysiwyg"]')).toBeNull()
    expect(view.container.textContent).toContain('front matter')
    view.cleanup()
  })
})
