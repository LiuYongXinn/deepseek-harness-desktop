import { describe, expect, it } from 'vitest'
import {
  DESKTOP_CLIPBOARD_ENDPOINTS,
  DESKTOP_CLIPBOARD_PROBE,
  DESKTOP_CLIPBOARD_RELEASE,
  DESKTOP_CLIPBOARD_RPC_CHANNEL,
  DESKTOP_CLIPBOARD_VALIDATE,
  DesktopClipboardLeaseId,
  isFiniteNonNegativeNumber,
  isWorkspaceRelativePath,
  parseLeaseId,
  parseProbeRequest,
  parseProbeResult,
  parseReleaseRequest,
  parseReleaseResult,
  parseValidateRequest,
  parseValidateResult,
} from '../src/clipboard/contract.ts'

/** A valid opaque lease token used across valid-arm tests. */
const VALID_LEASE = 'abc123'

/** Build a minimal valid file draft value for parseProbeResult. */
function validDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    leaseId: VALID_LEASE,
    name: 'a.txt',
    relativePath: 'src/a.txt',
    size: 12,
    ...overrides,
  }
}

/** Build a minimal valid reference value for parseValidateResult. */
function validReference(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { path: 'src/a.txt', ...overrides }
}

describe('desktop-clipboard contract constants', () => {
  it('exposes the exact channel, endpoint, and probe/validate/release constants', () => {
    expect(DESKTOP_CLIPBOARD_RPC_CHANNEL).toBe('/desktop-clipboard')
    expect(DESKTOP_CLIPBOARD_ENDPOINTS).toEqual(['probe', 'validate', 'release'])
    expect(DESKTOP_CLIPBOARD_PROBE).toBe('probe')
    expect(DESKTOP_CLIPBOARD_VALIDATE).toBe('validate')
    expect(DESKTOP_CLIPBOARD_RELEASE).toBe('release')
  })
})

describe('parseLeaseId', () => {
  it('accepts a bounded non-empty string and brands it', () => {
    expect(parseLeaseId(VALID_LEASE)).toBe(DesktopClipboardLeaseId(VALID_LEASE))
  })

  it.each([
    ['empty', ''],
    ['non-string', 42],
    ['null', null],
    ['undefined', undefined],
    ['too long', 'x'.repeat(65537)],
  ] as const)('rejects %s', (_name, value) => {
    expect(parseLeaseId(value)).toBeUndefined()
  })
})

describe('probe request', () => {
  it('accepts a well-formed probe request', () => {
    expect(parseProbeRequest({ sessionId: 's-1' }))
      .toEqual({ ok: true, value: { sessionId: 's-1' } })
  })

  it.each([
    ['non-object', 42],
    ['null', null],
    ['array', []],
    ['missing sessionId', {}],
    ['empty sessionId', { sessionId: '' }],
    ['over-long sessionId', { sessionId: 'x'.repeat(65537) }],
  ] as const)('rejects %s', (_name, value) => {
    expect(parseProbeRequest(value).ok).toBe(false)
  })
})

describe('validate request', () => {
  it('accepts a batch of valid lease ids', () => {
    const parsed = parseValidateRequest({ sessionId: 's-1', leaseIds: [VALID_LEASE, 'lease-2'] })
    expect(parsed).toEqual({
      ok: true,
      value: {
        sessionId: 's-1',
        leaseIds: [DesktopClipboardLeaseId(VALID_LEASE), DesktopClipboardLeaseId('lease-2')],
      },
    })
  })

  it('rejects a missing or empty leaseIds array', () => {
    expect(parseValidateRequest({ sessionId: 's-1' }).ok).toBe(false)
    expect(parseValidateRequest({ sessionId: 's-1', leaseIds: [] }).ok).toBe(false)
  })

  it.each([
    ['non-object', null],
    ['empty sessionId', { sessionId: '', leaseIds: [VALID_LEASE] }],
    ['non-array leaseIds', { sessionId: 's-1', leaseIds: VALID_LEASE }],
    ['array with an invalid lease id', { sessionId: 's-1', leaseIds: [VALID_LEASE, ''] }],
    ['over-long batch', { sessionId: 's-1', leaseIds: Array.from({ length: 65 }, (_, i) => `l${i}`) }],
  ] as const)('rejects %s', (_name, value) => {
    expect(parseValidateRequest(value).ok).toBe(false)
  })
})

describe('release request', () => {
  it('accepts a batch of valid lease ids', () => {
    const parsed = parseReleaseRequest({ sessionId: 's-1', leaseIds: [VALID_LEASE] })
    expect(parsed).toEqual({
      ok: true,
      value: { sessionId: 's-1', leaseIds: [DesktopClipboardLeaseId(VALID_LEASE)] },
    })
  })

  it('rejects a missing or empty leaseIds array', () => {
    expect(parseReleaseRequest({ sessionId: 's-1' }).ok).toBe(false)
    expect(parseReleaseRequest({ sessionId: 's-1', leaseIds: [] }).ok).toBe(false)
  })

  it('rejects malformed values', () => {
    expect(parseReleaseRequest(null).ok).toBe(false)
    expect(parseReleaseRequest({ sessionId: '', leaseIds: [VALID_LEASE] }).ok).toBe(false)
    expect(parseReleaseRequest({ sessionId: 's-1', leaseIds: 'nope' }).ok).toBe(false)
  })
})

describe('probe result', () => {
  it('parses the none arm', () => {
    expect(parseProbeResult({ status: 'none' })).toEqual({ status: 'none' })
  })

  it('parses the error arm with machine fields', () => {
    expect(parseProbeResult({ status: 'error', code: 'probe-failed', message: 'boom' }))
      .toEqual({ status: 'error', code: 'probe-failed', message: 'boom' })
  })

  it('parses a files arm with valid drafts and a valid textDisposition', () => {
    const parsed = parseProbeResult({
      status: 'files',
      items: [validDraft(), validDraft({ name: 'b.txt', relativePath: 'docs/b.txt', size: 3 })],
      textDisposition: 'suppress',
    })
    expect(parsed).toEqual({
      status: 'files',
      items: [
        { leaseId: DesktopClipboardLeaseId(VALID_LEASE), name: 'a.txt', relativePath: 'src/a.txt', size: 12 },
        { leaseId: DesktopClipboardLeaseId(VALID_LEASE), name: 'b.txt', relativePath: 'docs/b.txt', size: 3 },
      ],
      textDisposition: 'suppress',
    })
  })

  it('accepts a preserve textDisposition', () => {
    expect(parseProbeResult({ status: 'files', items: [], textDisposition: 'preserve' }))
      .toEqual({ status: 'files', items: [], textDisposition: 'preserve' })
  })

  it.each([
    ['absolute relativePath', validDraft({ relativePath: '/abs/path' })],
    ['dotdot relativePath', validDraft({ relativePath: 'src/../x' })],
    ['backslash relativePath', validDraft({ relativePath: 'src\\x' })],
    ['drive-letter relativePath', validDraft({ relativePath: 'C:/x' })],
  ])('rejects a files arm when a draft has an invalid %s', (_name, draft) => {
    expect(parseProbeResult({ status: 'files', items: [draft], textDisposition: 'suppress' })).toBeUndefined()
  })

  it.each([
    ['unknown status', { status: 'bogus' }],
    ['non-object', null],
    ['bad textDisposition', { status: 'files', items: [validDraft()], textDisposition: 'weird' }],
    ['non-array items', { status: 'files', items: 'nope', textDisposition: 'suppress' }],
    ['draft with invalid leaseId', {
      status: 'files',
      items: [validDraft({ leaseId: '' })],
      textDisposition: 'suppress',
    }],
    ['draft with empty name', {
      status: 'files',
      items: [validDraft({ name: '' })],
      textDisposition: 'suppress',
    }],
    ['draft with negative size', {
      status: 'files',
      items: [validDraft({ size: -1 })],
      textDisposition: 'suppress',
    }],
  ] as const)('rejects %s', (_name, value) => {
    expect(parseProbeResult(value)).toBeUndefined()
  })
})

describe('validate result', () => {
  it('parses an ok arm with references validated as workspace-relative paths', () => {
    expect(parseValidateResult({ status: 'ok', references: [validReference(), validReference({ path: 'docs/b.md' })] }))
      .toEqual({ status: 'ok', references: [{ path: 'src/a.txt' }, { path: 'docs/b.md' }] })
  })

  it('parses the stale and error arms', () => {
    expect(parseValidateResult({ status: 'stale' })).toEqual({ status: 'stale' })
    expect(parseValidateResult({ status: 'error', code: 'x', message: 'm' }))
      .toEqual({ status: 'error', code: 'x', message: 'm' })
  })

  it('rejects an ok arm whose reference path is absolute', () => {
    expect(parseValidateResult({ status: 'ok', references: [validReference({ path: '/abs/path' })] })).toBeUndefined()
    expect(parseValidateResult({ status: 'ok', references: [validReference({ path: '../../x' })] })).toBeUndefined()
    expect(parseValidateResult({ status: 'ok', references: [validReference({ path: 'C:\\x' })] })).toBeUndefined()
    expect(parseValidateResult({ status: 'ok', references: [validReference({ path: '//server/share' })] })).toBeUndefined()
  })

  it.each([
    ['unknown status', { status: 'oops' }],
    ['non-object', null],
    ['missing references', { status: 'ok' }],
    ['non-array references', { status: 'ok', references: 'nope' }],
  ] as const)('rejects %s', (_name, value) => {
    expect(parseValidateResult(value)).toBeUndefined()
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
    expect(parseReleaseResult(null)).toBeUndefined()
  })
})

describe('isWorkspaceRelativePath', () => {
  it('accepts nested, dot-free, slash-separated relative paths', () => {
    expect(isWorkspaceRelativePath('src/a.txt', 256)).toBe(true)
    expect(isWorkspaceRelativePath('a/b/c/d.txt', 256)).toBe(true)
    expect(isWorkspaceRelativePath('a.txt', 256)).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['leading slash', '/a/b'],
    ['backslash', 'a\\b'],
    ['dotdot segment', 'a/../b'],
    ['bare dotdot', '..'],
    ['drive-letter prefix', 'C:/x'],
    ['drive-letter lowercase', 'c:\\x'],
    ['UNC prefix', '//server/share'],
    ['non-string', 42],
    ['over-long', 'a'.repeat(257)],
  ] as const)('rejects %s', (_name, value) => {
    expect(isWorkspaceRelativePath(value, 256)).toBe(false)
  })
})

describe('isFiniteNonNegativeNumber', () => {
  it('accepts finite non-negative numbers', () => {
    expect(isFiniteNonNegativeNumber(0)).toBe(true)
    expect(isFiniteNonNegativeNumber(12)).toBe(true)
    expect(isFiniteNonNegativeNumber(1.5)).toBe(true)
  })

  it.each([
    ['negative', -1],
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['string', '12'],
    ['null', null],
  ] as const)('rejects %s', (_name, value) => {
    expect(isFiniteNonNegativeNumber(value)).toBe(false)
  })
})
