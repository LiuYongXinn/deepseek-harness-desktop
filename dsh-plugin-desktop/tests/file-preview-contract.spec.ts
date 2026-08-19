import { describe, expect, it } from 'vitest'
import {
  FILE_PREVIEW_BINARY_PREFIX,
  FILE_PREVIEW_RPC_CHANNEL,
  FilePreviewResourceId,
  FilePreviewRevision,
  parseBinaryResult,
  parseBinaryUrlRequest,
  parseDescriptor,
  parseProbeRequest,
  parseProbeResult,
  parseReadTextRequest,
  parseReleaseRequest,
  parseReleaseResult,
  parseResourceId,
  parseSaveTextRequest,
  parseSaveTextResult,
  parseTextResult,
} from '../src/file-preview-contract.ts'

/** A valid opaque resource token used across valid-arm tests. */
const VALID_ID = 'aabbccddeeff001122334455'

/** Build a minimal valid descriptor value for parseProbeResult. */
function validDescriptor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    availability: 'available',
    resourceId: VALID_ID,
    displayPath: '/workspace/a.txt',
    name: 'a.txt',
    extension: '.txt',
    mediaType: 'text/plain',
    contentKind: 'text',
    size: 12,
    ...overrides,
  }
}

describe('file-preview-contract parsing', () => {
  it('accepts a valid resource id and rejects empty, non-string, and enormous ids', () => {
    expect(parseResourceId(VALID_ID)).toBe(FilePreviewResourceId(VALID_ID))
    expect(parseResourceId('')).toBeUndefined()
    expect(parseResourceId(42)).toBeUndefined()
    expect(parseResourceId(undefined)).toBeUndefined()
    expect(parseResourceId('x'.repeat(65537))).toBeUndefined()
  })

  describe('probe request', () => {
    it('accepts a well-formed probe request', () => {
      const parsed = parseProbeRequest({ sessionId: 's-1', path: '/a/b.ts' })
      expect(parsed).toEqual({ ok: true, value: { sessionId: 's-1', path: '/a/b.ts' } })
    })

    it.each([
      ['non-object', 42],
      ['null', null],
      ['array', []],
      ['missing sessionId', { path: '/a' }],
      ['empty sessionId', { sessionId: '', path: '/a' }],
      ['missing path', { sessionId: 's' }],
      ['empty path', { sessionId: 's', path: '' }],
      ['over-long path', { sessionId: 's', path: 'x'.repeat(65537) }],
    ] as const)('rejects %s', (_name, value) => {
      expect(parseProbeRequest(value).ok).toBe(false)
    })
  })

  describe('resource-id payloads', () => {
    it('accepts a valid resourceId on every payload type', () => {
      expect(parseReadTextRequest({ resourceId: VALID_ID }).ok).toBe(true)
      expect(parseBinaryUrlRequest({ resourceId: VALID_ID }).ok).toBe(true)
      expect(parseReleaseRequest({ resourceId: VALID_ID }).ok).toBe(true)
    })

    it('rejects missing or empty resource ids', () => {
      expect(parseReadTextRequest({}).ok).toBe(false)
      expect(parseBinaryUrlRequest({ resourceId: '' }).ok).toBe(false)
      expect(parseReleaseRequest({ resourceId: 7 }).ok).toBe(false)
    })
  })

  describe('probe result', () => {
    it('parses the delegate arm', () => {
      expect(parseProbeResult({ status: 'delegate' })).toEqual({ status: 'delegate' })
    })

    it('parses an available preview descriptor', () => {
      const parsed = parseProbeResult({ status: 'preview', descriptor: validDescriptor() })
      expect(parsed).toEqual({
        status: 'preview',
        descriptor: {
          availability: 'available',
          resourceId: FilePreviewResourceId(VALID_ID),
          displayPath: '/workspace/a.txt',
          name: 'a.txt',
          extension: '.txt',
          mediaType: 'text/plain',
          contentKind: 'text',
          size: 12,
        },
      })
    })

    it('parses an oversized preview descriptor', () => {
      const parsed = parseProbeResult({
        status: 'preview',
        descriptor: validDescriptor({ availability: 'oversized', limitBytes: 1024 }),
      })
      const descriptor = parsed?.status === 'preview' ? parsed.descriptor : undefined
      expect(descriptor).toHaveProperty('availability', 'oversized')
      expect(descriptor).toHaveProperty('limitBytes', 1024)
      expect(descriptor).not.toHaveProperty('resourceId')
    })

    it('parses the error arm with machine fields', () => {
      expect(parseProbeResult({ status: 'error', code: 'read-failed', message: 'boom', retryable: true }))
        .toEqual({ status: 'error', code: 'read-failed', message: 'boom', retryable: true })
    })

    it('rejects unknown discriminants', () => {
      expect(parseProbeResult({ status: 'bogus' })).toBeUndefined()
      expect(parseProbeResult({})).toBeUndefined()
    })

    it('rejects a preview with an invalid descriptor', () => {
      expect(parseProbeResult({ status: 'preview', descriptor: validDescriptor({ size: -1 }) })).toBeUndefined()
      expect(parseProbeResult({ status: 'preview', descriptor: validDescriptor({ resourceId: 5 as never }) })).toBeUndefined()
      expect(parseProbeResult({ status: 'preview', descriptor: validDescriptor({ resourceId: '' }) })).toBeUndefined()
    })
  })

  describe('descriptor validation', () => {
    it.each([
      ['negative size', validDescriptor({ size: -5 })],
      ['NaN size', validDescriptor({ size: Number.NaN })],
      ['infinite size', validDescriptor({ size: Number.POSITIVE_INFINITY })],
      ['unknown availability', validDescriptor({ availability: 'stream' })],
      ['bad contentKind', validDescriptor({ contentKind: 'video' })],
      ['empty resource id', validDescriptor({ resourceId: '' })],
      ['non-string name', validDescriptor({ name: 7 })],
      ['bare extension without leading dot', validDescriptor({ extension: 'md' })],
      ['uppercase extension', validDescriptor({ extension: '.MD' })],
      ['extension with a path separator', validDescriptor({ extension: '.a/b' })],
      ['non-string extension', validDescriptor({ extension: 7 })],
    ] as const)('rejects %s', (_name, descriptor) => {
      expect(parseDescriptor(descriptor)).toBeUndefined()
    })

    it('accepts an empty extension and a dotted lowercase extension', () => {
      const emptyExt = parseDescriptor(validDescriptor({ extension: '' }))
      expect(emptyExt?.availability === 'available' ? emptyExt.extension : undefined).toBe('')
      const md = parseDescriptor(validDescriptor({ extension: '.markdown' }))
      expect(md?.availability === 'available' ? md.extension : undefined).toBe('.markdown')
    })

    it('accepts an optional language field', () => {
      const parsed = parseDescriptor(validDescriptor({ language: 'typescript' }))
      expect(parsed?.availability === 'available' ? parsed.language : undefined).toBe('typescript')
    })
  })

  describe('text result', () => {
    it('parses the ok arm', () => {
      expect(parseTextResult({ status: 'ok', text: 'hello', resourceId: VALID_ID, revision: 'rev-1' }))
        .toEqual({ status: 'ok', text: 'hello', resourceId: FilePreviewResourceId(VALID_ID), revision: FilePreviewRevision('rev-1') })
    })

    it('parses stale and error arms', () => {
      expect(parseTextResult({ status: 'stale' })).toEqual({ status: 'stale' })
      expect(parseTextResult({ status: 'error', code: 'x', message: 'm', retryable: false }))
        .toEqual({ status: 'error', code: 'x', message: 'm', retryable: false })
    })

    it('rejects ok arm data faults', () => {
      expect(parseTextResult({ status: 'ok', text: 3, resourceId: VALID_ID })).toBeUndefined()
      expect(parseTextResult({ status: 'ok', text: 'hi', resourceId: '' })).toBeUndefined()
      expect(parseTextResult({ status: 'oops' })).toBeUndefined()
    })
  })

  describe('save-text request', () => {
    it('accepts a valid version-guarded request including empty text', () => {
      expect(parseSaveTextRequest({ sessionId: 's1', path: '/w/readme.md', expectedRevision: 'v1', text: '' }))
        .toEqual({ ok: true, value: { sessionId: 's1', path: '/w/readme.md', expectedRevision: FilePreviewRevision('v1'), text: '' } })
    })

    it.each([
      ['non-object', null],
      ['empty session', { sessionId: '', path: '/w/a.md', expectedRevision: 'v1', text: 'x' }],
      ['empty path', { sessionId: 's', path: '', expectedRevision: 'v1', text: 'x' }],
      ['empty revision', { sessionId: 's', path: '/w/a.md', expectedRevision: '', text: 'x' }],
      ['non-string text', { sessionId: 's', path: '/w/a.md', expectedRevision: 'v1', text: 1 }],
      ['over-large text', { sessionId: 's', path: '/w/a.md', expectedRevision: 'v1', text: 'x'.repeat(8 * 1024 * 1024 + 1) }],
    ] as const)('rejects %s', (_name, value) => {
      expect(parseSaveTextRequest(value).ok).toBe(false)
    })
  })

  describe('save-text result', () => {
    it('accepts ok, conflict, and error arms', () => {
      expect(parseSaveTextResult({ status: 'ok', revision: 'v2', text: '你好', size: 6 }))
        .toEqual({ status: 'ok', revision: FilePreviewRevision('v2'), text: '你好', size: 6 })
      expect(parseSaveTextResult({ status: 'conflict', code: 'stale-version', message: 'changed' }))
        .toEqual({ status: 'conflict', code: 'stale-version', message: 'changed' })
      expect(parseSaveTextResult({ status: 'error', code: 'denied', message: 'no', retryable: true }))
        .toEqual({ status: 'error', code: 'denied', message: 'no', retryable: true })
    })

    it.each([
      { status: 'ok', revision: '', text: 'x', size: 1 },
      { status: 'ok', revision: 'v2', text: 1, size: 1 },
      { status: 'ok', revision: 'v2', text: 'x', size: -1 },
      { status: 'conflict', code: 'other', message: 'x' },
      { status: 'error', code: 'x', message: 'x', retryable: 'yes' },
      { status: 'unknown' },
    ])('rejects invalid result $status', (value) => {
      expect(parseSaveTextResult(value)).toBeUndefined()
    })
  })

  describe('binary result', () => {
    it('parses a relative ok url under the binary prefix', () => {
      const url = `${FILE_PREVIEW_BINARY_PREFIX}/${VALID_ID}`
      expect(parseBinaryResult({ status: 'ok', url })).toEqual({ status: 'ok', url })
    })

    it('parses stale and error arms', () => {
      expect(parseBinaryResult({ status: 'stale' })).toEqual({ status: 'stale' })
      expect(parseBinaryResult({ status: 'error', code: 'x', message: 'm', retryable: true }))
        .toEqual({ status: 'error', code: 'x', message: 'm', retryable: true })
    })

    it('rejects absolute urls and urls outside the binary prefix', () => {
      expect(parseBinaryResult({ status: 'ok', url: `http://127.0.0.1:1${FILE_PREVIEW_BINARY_PREFIX}/${VALID_ID}` })).toBeUndefined()
      expect(parseBinaryResult({ status: 'ok', url: '/other/token' })).toBeUndefined()
      expect(parseBinaryResult({ status: 'ok', url: `${FILE_PREVIEW_BINARY_PREFIX}` })).toBeUndefined()
      expect(parseBinaryResult({ status: 'ok', url: '' })).toBeUndefined()
    })
  })

  describe('release result', () => {
    it('parses a boolean release result', () => {
      expect(parseReleaseResult({ released: true })).toEqual({ released: true })
      expect(parseReleaseResult({ released: false })).toEqual({ released: false })
    })

    it('rejects a non-boolean release result', () => {
      expect(parseReleaseResult({ released: 1 })).toBeUndefined()
      expect(parseReleaseResult({})).toBeUndefined()
    })
  })

  it('exposes the shared channel constants from a single source', () => {
    expect(FILE_PREVIEW_RPC_CHANNEL).toBe('/desktop-file-preview')
    expect(FILE_PREVIEW_BINARY_PREFIX).toBe('/desktop-file-preview-content')
  })
})
