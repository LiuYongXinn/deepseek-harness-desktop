import { describe, expect, it } from 'vitest'
import {
  FILE_REFERENCE_MARKER_CLOSE,
  FILE_REFERENCE_MARKER_OPEN,
  MAX_SERIALIZED_PATH_LENGTH,
  serializeFileReferences,
} from '../src/clipboard/serialize.ts'
import type { ClipboardValidateResult } from '../src/clipboard/contract.ts'

/**
 * Build a Host `validate` `ok`-shaped result from raw reference objects. This
 * mirrors what the Host validate result parser would hand the serializer.
 */
function okResult(references: Array<{ path: string }>): ClipboardValidateResult {
  return { status: 'ok', references }
}

describe('serializeFileReferences (P0-7 marker serializer)', () => {
  it('serializes a single reference exactly', () => {
    const out = serializeFileReferences([{ path: 'src/client/InputBar.tsx' }])
    expect(out).toBe(
      '<dsh-file-references>\n'
      + JSON.stringify({ path: 'src/client/InputBar.tsx' })
      + '\n</dsh-file-references>',
    )
  })

  it('serializes two references exactly matching the design stanza', () => {
    const out = serializeFileReferences([{ path: 'src/client/InputBar.tsx' }, { path: 'docs/design.md' }])
    expect(out).toBe(
      '<dsh-file-references>\n'
      + '{"path":"src/client/InputBar.tsx"}\n'
      + '{"path":"docs/design.md"}\n'
      + '</dsh-file-references>',
    )
  })

  it('serializes nested/dotted workspace-relative paths verbatim', () => {
    const nested = 'packages/client/ui-conversation/src/client/service.ts'
    const out = serializeFileReferences([{ path: nested }])
    expect(out).toBe(`<dsh-file-references>\n${JSON.stringify({ path: nested })}\n</dsh-file-references>`)
    expect(out).toContain('{"path":"packages/client/ui-conversation/src/client/service.ts"}')
  })

  it('appends user text after the marker with a single newline', () => {
    const refs = [{ path: 'src/client/InputBar.tsx' }, { path: 'docs/design.md' }]
    const userText = '请帮我看看这两个文件'
    const out = serializeFileReferences(refs, userText)
    const marker = `<dsh-file-references>\n{"path":"src/client/InputBar.tsx"}\n{"path":"docs/design.md"}\n</dsh-file-references>`
    expect(out).toBe(`${marker}\n${userText}`)
  })

  it('still returns the full marker text when the user body is empty', () => {
    const refs = [{ path: 'src/client/InputBar.tsx' }]
    const out = serializeFileReferences(refs, '')
    expect(out).toBe(`<dsh-file-references>\n{"path":"src/client/InputBar.tsx"}\n</dsh-file-references>`)
    // References are never dropped because the body is empty.
    expect(serializeFileReferences(refs)).toBe(serializeFileReferences(refs, ''))
  })

  it('returns userText unchanged with empty references; returns empty string with no text', () => {
    expect(serializeFileReferences([], 'some body')).toBe('some body')
    expect(serializeFileReferences([], '')).toBe('')
    expect(serializeFileReferences([])).toBe('')
  })

  it('preserves reference order and duplicates exactly', () => {
    const out = serializeFileReferences([
      { path: 'a.ts' },
      { path: 'b.ts' },
      { path: 'a.ts' },
    ])
    expect(out).toBe(
      '<dsh-file-references>\n'
      + '{"path":"a.ts"}\n'
      + '{"path":"b.ts"}\n'
      + '{"path":"a.ts"}\n'
      + '</dsh-file-references>',
    )
    const firstA = out.indexOf('{"path":"a.ts"}')
    const b = out.indexOf('{"path":"b.ts"}')
    const secondA = out.indexOf('{"path":"a.ts"}', firstA + 1)
    expect(firstA).toBeGreaterThan(-1)
    expect(secondA).toBeGreaterThan(firstA)
    expect(b).toBeGreaterThan(firstA)
    expect(secondA).toBeGreaterThan(b)
  })

  it('rejects a path that is absolute, a Windows drive path, or contains ..', () => {
    for (const bad of ['/etc/passwd', 'C:\\Users\\x\\f.txt', '../secrets.txt']) {
      expect(() => serializeFileReferences([{ path: bad }])).toThrow(
        'dsh-plugin-desktop: file reference path is not workspace-relative',
      )
    }
  })

  it('rejects a path that is too long for the serialized cap', () => {
    expect(() => serializeFileReferences([{ path: 'a'.repeat(MAX_SERIALIZED_PATH_LENGTH + 1) }]))
      .toThrow('dsh-plugin-desktop: file reference path is not workspace-relative')
  })

  it('no-leak invariant: a Host validate ok result serializes only relative paths, no lease/name/size', () => {
    const validateResult = okResult([
      { path: 'src/client/InputBar.tsx' },
      { path: 'docs/design.md' },
      { path: 'packages/client/ui-conversation/src/client/service.ts' },
    ])
    if (validateResult.status !== 'ok') throw new Error('expected an ok result')
    const out = serializeFileReferences(validateResult.references)

    // Never any absolute path, lease, name, or size in the model text.
    expect(out).not.toContain('/etc/')
    expect(out).not.toContain('C:\\')
    expect(out).not.toContain('lease')
    expect(out).not.toContain('leaseId')
    expect(out).not.toContain('"name"')
    expect(out).not.toContain('"size"')

    // Every marker line round-trips to exactly the relative path.
    const lines = out.split('\n')
    expect(lines[0]).toBe(FILE_REFERENCE_MARKER_OPEN)
    expect(lines[lines.length - 1]).toBe(FILE_REFERENCE_MARKER_CLOSE)
    for (let i = 1; i < lines.length - 1; i++) {
      let line = lines[i]
      if (line === undefined) throw new Error('missing marker line')
      const parsed = JSON.parse(line) as { path: unknown }
      expect(parsed).toEqual({ path: expect.any(String) })
      expect(typeof parsed.path).toBe('string')
      const p = parsed.path as string
      expect(p).toEqual(validateResult.references[i - 1]?.path)
      expect(p.startsWith('/')).toBe(false)
      expect(p).not.toContain('\\')
      expect(p).not.toContain('..')
    }
    // Same line count as references plus the two tags.
    expect(lines.length).toBe(validateResult.references.length + 2)
  })

  it('sends the marker text alone when references exist but the body is empty (design §3.4)', () => {
    const validateResult = okResult([{ path: 'src/a.txt' }, { path: 'docs/b.md' }])
    if (validateResult.status !== 'ok') throw new Error('expected an ok result')
    const out = serializeFileReferences(validateResult.references, '')
    expect(out).toBe(
      '<dsh-file-references>\n{"path":"src/a.txt"}\n{"path":"docs/b.md"}\n</dsh-file-references>',
    )
  })
})
