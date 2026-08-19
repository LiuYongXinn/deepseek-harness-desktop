import { describe, expect, it } from 'vitest'
import {
  parseNativeClipboard,
  parsePublicFileUrlText,
  parseUriList,
  parseWindowsDroFilesBytes,
  parseWindowsFileNamesText,
} from '../src/clipboard/native.ts'
import type { NativeClipboardLimits, NativeClipboardSnapshot } from '../src/clipboard/native.ts'

/**
 * Per-parse result shape helper: assert a `{ ok: true; paths }` low-level parse
 * yields exactly the expected paths.
 */
function expectOk(result: { ok: true; paths: readonly string[] } | { ok: false; code: string }, paths: readonly string[]): void {
  expect(result).toEqual({ ok: true, paths })
}

/** Encode a string to windows-1252 bytes (test paths are ASCII-compatible). */
function encodeAnsi(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

/** Encode a string to UTF-16LE bytes. */
function encodeUtf16le(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    out[i * 2] = code & 0xff
    out[i * 2 + 1] = (code >> 8) & 0xff
  }
  return out
}

/**
 * Build a Windows `CF_HDROP` (DROPFILES) buffer with fWide=0 (ANSI) from a list
 * of paths. Layout: 20-byte header (pFiles=20, fNC=0, fWide=0) then the
 * null-separated path list terminated by a double-null.
 */
function makeAnsiDroFiles(paths: readonly string[]): Uint8Array {
  const body = `${paths.join('\0')}\0\0`
  const bytes = encodeAnsi(body)
  const out = new Uint8Array(20 + bytes.length)
  out[0] = 20 // pFiles
  out.set(bytes, 20)
  return out
}

/** Build a `CF_HDROP` buffer with fWide=1 (UTF-16LE) from a list of paths. */
function makeWideDroFiles(paths: readonly string[]): Uint8Array {
  const body = `${paths.join('\0')}\0\0`
  const bytes = encodeUtf16le(body)
  const out = new Uint8Array(20 + bytes.length)
  out[0] = 20 // pFiles
  out[16] = 1 // fWide
  out.set(bytes, 20)
  return out
}

/** Build a snapshot whose `read`/`readText`/`readBuffer` come from plain maps. */
function snapshot(
  formats: readonly string[],
  data: Record<string, string> = {},
  buffers: Record<string, Uint8Array> = {},
): NativeClipboardSnapshot {
  return {
    formats,
    readText: () => data['text/plain'] ?? '',
    read: (format) => data[format] ?? '',
    readBuffer: (format) => buffers[format],
  }
}

const DEFAULT_LIMITS: NativeClipboardLimits = {
  maxItems: 1000,
  maxPathChars: 1024,
  maxPayloadBytes: 1024 * 1024,
}

describe('Windows CF_HDROP (DROPFILES)', () => {
  it('parses an ANSI single-file list', () => {
    expectOk(parseWindowsDroFilesBytes(makeAnsiDroFiles(['C:\\a.txt']), DEFAULT_LIMITS), ['C:\\a.txt'])
  })

  it('parses an ANSI multi-file list', () => {
    expectOk(
      parseWindowsDroFilesBytes(makeAnsiDroFiles(['C:\\a.txt', 'C:\\b.txt']), DEFAULT_LIMITS),
      ['C:\\a.txt', 'C:\\b.txt'],
    )
  })

  it('parses a wide (UTF-16LE) multi-file list', () => {
    expectOk(
      parseWindowsDroFilesBytes(makeWideDroFiles(['C:\\a.txt', 'C:\\b.txt']), DEFAULT_LIMITS),
      ['C:\\a.txt', 'C:\\b.txt'],
    )
  })

  it('parses an empty list to an empty path set', () => {
    expectOk(parseWindowsDroFilesBytes(makeAnsiDroFiles([]), DEFAULT_LIMITS), [])
    expectOk(parseWindowsDroFilesBytes(makeWideDroFiles([]), DEFAULT_LIMITS), [])
  })

  it('rejects a buffer shorter than the 20-byte header', () => {
    const truncated = new Uint8Array(10)
    const result = parseWindowsDroFilesBytes(truncated, DEFAULT_LIMITS)
    expect(result).toEqual({ ok: false, code: 'malformed-format' })
  })

  it('rejects a wrong pFiles offset', () => {
    const bytes = makeAnsiDroFiles(['C:\\a.txt'])
    bytes[0] = 24 // pFiles != 20
    const result = parseWindowsDroFilesBytes(bytes, DEFAULT_LIMITS)
    expect(result).toEqual({ ok: false, code: 'malformed-format' })
  })

  it('rejects an unterminated ANSI list (single trailing null)', () => {
    const body = encodeAnsi('C:\\a.txt\0')
    const out = new Uint8Array(20 + body.length)
    out[0] = 20
    out.set(body, 20)
    const result = parseWindowsDroFilesBytes(out, DEFAULT_LIMITS)
    expect(result).toEqual({ ok: false, code: 'malformed-format' })
  })
})

describe('Windows FileNameW / FileName text', () => {
  it('parses null-separated paths and drops empty trailing entries', () => {
    expectOk(parseWindowsFileNamesText('C:\\a.txt\0C:\\b.txt\0', DEFAULT_LIMITS), ['C:\\a.txt', 'C:\\b.txt'])
    expectOk(parseWindowsFileNamesText('C:\\a.txt\0', DEFAULT_LIMITS), ['C:\\a.txt'])
  })

  it('parses an empty value to an empty path set', () => {
    expectOk(parseWindowsFileNamesText('', DEFAULT_LIMITS), [])
  })
})

describe('macOS public.file-url', () => {
  it('percent-decodes a file URL', () => {
    expectOk(parsePublicFileUrlText('file:///C:/My%20Docs/a.txt', DEFAULT_LIMITS), ['/C:/My Docs/a.txt'])
  })

  it('treats a localhost host as a local path', () => {
    expectOk(parsePublicFileUrlText('file://localhost/Users/me/a.txt', DEFAULT_LIMITS), ['/Users/me/a.txt'])
  })

  it('ignores query and fragment parts', () => {
    expectOk(parsePublicFileUrlText('file:///a/b.txt?x=1#frag', DEFAULT_LIMITS), ['/a/b.txt'])
  })

  it('a non-file scheme is not a file list (empty paths)', () => {
    expectOk(parsePublicFileUrlText('https://example.com/x', DEFAULT_LIMITS), [])
  })

  it('a remote host is not a local file (empty paths)', () => {
    expectOk(parsePublicFileUrlText('file://remote-server/share/a.txt', DEFAULT_LIMITS), [])
  })

  it('parses only the first line of a multi-line block', () => {
    expectOk(parsePublicFileUrlText('file:///a\nfile:///b', DEFAULT_LIMITS), ['/a'])
  })

  it('rejects malformed percent-encoding', () => {
    const result = parsePublicFileUrlText('file:///a%ZZ', DEFAULT_LIMITS)
    expect(result).toEqual({ ok: false, code: 'malformed-format' })
  })
})

describe('Linux text/uri-list', () => {
  it('Ignores comments and blank lines', () => {
    expectOk(parseUriList('# a comment\n\nfile:///a\nfile:///b\n', DEFAULT_LIMITS), ['/a', '/b'])
  })

  it('skips non-local scheme lines', () => {
    expectOk(parseUriList('file:///a\nhttps://x/y\nsmb://server/share\nfile:///b', DEFAULT_LIMITS), ['/a', '/b'])
  })

  it('preserves repeated paths in order', () => {
    expectOk(parseUriList('file:///a\nfile:///a\nfile:///b', DEFAULT_LIMITS), ['/a', '/a', '/b'])
  })

  it('handles CRLF line separators', () => {
    expectOk(parseUriList('file:///a\r\nfile:///b\r\n', DEFAULT_LIMITS), ['/a', '/b'])
  })

  it('an empty clipboard is an empty path set', () => {
    expectOk(parseUriList('', DEFAULT_LIMITS), [])
  })

  it('percent-decodes file URIs', () => {
    expectOk(parseUriList('file:///home/user/My%20File.txt', DEFAULT_LIMITS), ['/home/user/My File.txt'])
  })
})

describe('limits applied across parsers', () => {
  const tight: NativeClipboardLimits = { ...DEFAULT_LIMITS, maxItems: 1 }

  it('rejects too-many-items in DROPFILES', () => {
    const result = parseWindowsDroFilesBytes(makeAnsiDroFiles(['C:\\a.txt', 'C:\\b.txt']), tight)
    expect(result).toEqual({ ok: false, code: 'too-many-items' })
  })

  it('rejects too-many-items in uri-list', () => {
    const result = parseUriList('file:///a\nfile:///b', tight)
    expect(result).toEqual({ ok: false, code: 'too-many-items' })
  })

  it('rejects path-too-long', () => {
    const pathLimited: NativeClipboardLimits = { ...DEFAULT_LIMITS, maxPathChars: 5 }
    const result = parseUriList('file:///very/long/path.txt', pathLimited)
    expect(result).toEqual({ ok: false, code: 'path-too-long' })
  })

  it('rejects payload-too-large', () => {
    const payloadLimited: NativeClipboardLimits = { ...DEFAULT_LIMITS, maxPayloadBytes: 10 }
    const result = parseWindowsFileNamesText('C:\\aaaa.txt\0C:\\bbbb.txt', payloadLimited)
    expect(result).toEqual({ ok: false, code: 'payload-too-large' })
  })
})

describe('parseNativeClipboard format selection', () => {
  it('returns none when the preferred format is absent', () => {
    expect(parseNativeClipboard(snapshot(['text/plain']), 'linux', DEFAULT_LIMITS)).toEqual({ status: 'none' })
    expect(parseNativeClipboard(snapshot(['text/plain']), 'win32', DEFAULT_LIMITS)).toEqual({ status: 'none' })
    expect(parseNativeClipboard(snapshot(['text/plain']), 'darwin', DEFAULT_LIMITS)).toEqual({ status: 'none' })
  })

  it('win32 prefers FileNameW over FileName over uri-list', () => {
    const wide = parseNativeClipboard(
      snapshot(['FileNameW', 'FileName', 'text/uri-list'], {
        FileNameW: 'C:\\wide.txt',
        FileName: 'C:\\ansiname.txt',
        'text/plain': 'file:///C:/urilist.txt',
      }),
      'win32',
      DEFAULT_LIMITS,
    )
    expect(wide).toEqual({ status: 'files', files: { candidates: ['C:\\wide.txt'], suppressText: true } })

    const ansi = parseNativeClipboard(
      snapshot(['FileName', 'text/uri-list'], { FileName: 'C:\\ansiname.txt', 'text/plain': 'file:///C:/urilist.txt' }),
      'win32',
      DEFAULT_LIMITS,
    )
    expect(ansi).toEqual({ status: 'files', files: { candidates: ['C:\\ansiname.txt'], suppressText: true } })
  })

  it('win32 uses CF_HDROP when present', () => {
    const result = parseNativeClipboard(
      snapshot(['CF_HDROP', 'FileNameW'], {}, { CF_HDROP: makeWideDroFiles(['C:\\drop.txt']) }),
      'win32',
      DEFAULT_LIMITS,
    )
    expect(result).toEqual({ status: 'files', files: { candidates: ['C:\\drop.txt'], suppressText: true } })
  })

  it('darwin prefers public.file-url over uri-list', () => {
    const result = parseNativeClipboard(
      snapshot(['public.file-url', 'text/uri-list'], {
        'public.file-url': 'file:///Users/me/a.txt',
        'text/plain': 'file:///Users/me/b.txt',
      }),
      'darwin',
      DEFAULT_LIMITS,
    )
    expect(result).toEqual({ status: 'files', files: { candidates: ['/Users/me/a.txt'], suppressText: true } })
  })

  it('linux uses uri-list', () => {
    const result = parseNativeClipboard(
      snapshot(['text/uri-list'], { 'text/plain': 'file:///etc/hostname' }),
      'linux',
      DEFAULT_LIMITS,
    )
    expect(result).toEqual({ status: 'files', files: { candidates: ['/etc/hostname'], suppressText: true } })
  })

  it('every files arm sets suppressText to true', () => {
    const arms = [
      parseNativeClipboard(snapshot(['FileNameW'], { FileNameW: 'C:\\a.txt' }), 'win32', DEFAULT_LIMITS),
      parseNativeClipboard(snapshot(['public.file-url'], { 'public.file-url': 'file:///a' }), 'darwin', DEFAULT_LIMITS),
      parseNativeClipboard(snapshot(['text/uri-list'], { 'text/plain': 'file:///a' }), 'linux', DEFAULT_LIMITS),
    ]
    for (const arm of arms) {
      expect(arm.status).toBe('files')
      if (arm.status === 'files') expect(arm.files.suppressText).toBe(true)
    }
  })

  it('maps a limit violation to an error whose message contains no raw path', () => {
    const tiny: NativeClipboardLimits = { ...DEFAULT_LIMITS, maxItems: 1 }
    const secret = '/secret/very/private/path.txt'
    const result = parseNativeClipboard(
      snapshot(['text/uri-list'], { 'text/plain': `file://${secret}\nfile://${secret}` }),
      'linux',
      tiny,
    )
    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.code).toBe('too-many-items')
      expect(result.message).not.toContain('secret')
      expect(result.message).not.toContain(secret)
    }
  })

  it('maps a malformed format to an error with a stable message', () => {
    const bytes = makeAnsiDroFiles([])
    bytes[0] = 99 // corrupt pFiles
    const result = parseNativeClipboard(snapshot(['CF_HDROP'], {}, { CF_HDROP: bytes }), 'win32', DEFAULT_LIMITS)
    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.code).toBe('malformed-format')
  })
})
