/**
 * Pure, side-effect-free platform clipboard parsers and native format
 * selection. This module is browser-loadable and must not import Node, Electron,
 * Cordis live objects, or any package: it works only on a narrow "snapshot" seam
 * ({@link NativeClipboardSnapshot}) that the Electron adapter supplies in a
 * later step, and it never touches the filesystem.
 *
 * Absolute candidate paths are Host-internal only and must never cross an RPC
 * boundary. Error codes are stable and messages are generic — they never
 * contain a raw path — so a hostile or malformed clipboard cannot leak a path
 * into a log or error surface.
 * @module dsh-plugin-desktop/clipboard/native
 */

/** A narrow, immutable view of Electron's native clipboard for one read. */
export interface NativeClipboardSnapshot {
  readonly formats: readonly string[]
  readText(): string
  read(format: string): string
  readBuffer(format: string): Uint8Array | undefined
}

/** Bounds applied to every parsed path list. */
export interface NativeClipboardLimits {
  /** Maximum number of paths accepted. */
  maxItems: number
  /** Maximum length in UTF-16 code units of any single path. */
  maxPathChars: number
  /** Maximum total UTF-16 code-unit length across all paths. */
  maxPayloadBytes: number
}

/** Platform the native format selection is running under. */
export type NativeClipboardTarget = 'win32' | 'darwin' | 'linux'

/** Stable, path-free error codes returned by the parsers. */
export type NativeClipboardErrorCode =
  | 'too-many-items'
  | 'path-too-long'
  | 'payload-too-large'
  | 'malformed-format'
  | 'parse-failed'

/**
 * A parsed native file list. `candidates` are absolute paths for Host-internal
 * authorization only; they never cross RPC. `suppressText` is always `true` — a
 * native file-list format carries the same paths as its accompanying text, so
 * no duplicate text should be inserted into the draft.
 */
export interface NativeClipboardFiles {
  readonly candidates: readonly string[]
  readonly suppressText: boolean
}

/** Outcome of a native clipboard parse. */
export type NativeClipboardParseResult =
  | { status: 'none' }
  | { status: 'files'; files: NativeClipboardFiles }
  | { status: 'error'; code: NativeClipboardErrorCode; message: string }

/** Shared return shape of every low-level parser. */
type ParseOutcome = { ok: true; paths: readonly string[] } | { ok: false; code: NativeClipboardErrorCode }

/** Stable, generic message keyed by error code — never leaks a path. */
function messageFor(code: NativeClipboardErrorCode): string {
  switch (code) {
    case 'too-many-items':
      return 'clipboard contains too many file items'
    case 'path-too-long':
      return 'a clipboard file path is too long'
    case 'payload-too-large':
      return 'clipboard file path payload is too large'
    case 'malformed-format':
      return 'clipboard file list format is malformed'
    case 'parse-failed':
      return 'clipboard file list could not be parsed'
  }
}

/**
 * Select the native file-list format for a target platform and parse it. When
 * the preferred format is absent from the snapshot (or the snapshot is an empty
 * X11/Wayland state) this returns `{ status: 'none' }`, never an error.
 *
 * - win32: `CF_HDROP` buffer, then `FileNameW`, then `FileName`, then
 *   `text/uri-list` as the final fallback.
 * - darwin: `public.file-url`, then `text/uri-list`.
 * - linux: `text/uri-list` (an empty/X11-Wayland `none` state parses to none).
 *
 * Every `files` arm sets `suppressText: true`.
 */
export function parseNativeClipboard(
  snapshot: NativeClipboardSnapshot,
  target: NativeClipboardTarget,
  limits: NativeClipboardLimits,
): NativeClipboardParseResult {
  switch (target) {
    case 'win32': {
      if (snapshot.formats.includes('CF_HDROP')) {
        const bytes = snapshot.readBuffer('CF_HDROP')
        if (bytes === undefined) return { status: 'none' }
        return toParseResult(parseWindowsDroFilesBytes(bytes, limits), limits)
      }
      if (snapshot.formats.includes('FileNameW')) {
        return toParseResult(parseWindowsFileNamesText(snapshot.read('FileNameW'), limits), limits)
      }
      if (snapshot.formats.includes('FileName')) {
        return toParseResult(parseWindowsFileNamesText(snapshot.read('FileName'), limits), limits)
      }
      if (snapshot.formats.includes('text/uri-list')) {
        return toParseResult(parseUriList(snapshot.readText(), limits), limits)
      }
      return { status: 'none' }
    }
    case 'darwin': {
      if (snapshot.formats.includes('public.file-url')) {
        return toParseResult(parsePublicFileUrlText(snapshot.read('public.file-url'), limits), limits)
      }
      if (snapshot.formats.includes('text/uri-list')) {
        return toParseResult(parseUriList(snapshot.readText(), limits), limits)
      }
      return { status: 'none' }
    }
    case 'linux': {
      if (!snapshot.formats.includes('text/uri-list')) return { status: 'none' }
      return toParseResult(parseUriList(snapshot.readText(), limits), limits)
    }
  }
}

/**
 * Map a low-level parse outcome to the {@link NativeClipboardParseResult}
 * union, applying limits defensively and mapping an empty list to `none`. Any
 * `files` arm carries `suppressText: true`.
 */
function toParseResult(outcome: ParseOutcome, limits: NativeClipboardLimits): NativeClipboardParseResult {
  if (!outcome.ok) return { status: 'error', code: outcome.code, message: messageFor(outcome.code) }
  const check = enforcePathLimits(outcome.paths, limits)
  if (!check.ok) return { status: 'error', code: check.code, message: messageFor(check.code) }
  if (outcome.paths.length === 0) return { status: 'none' }
  return { status: 'files', files: { candidates: outcome.paths, suppressText: true } }
}

/**
 * Parse the Windows `DROPFILES` structure from a `CF_HDROP` buffer.
 *
 * Layout (little-endian, all offsets from buffer start):
 * - u32 `pFiles` (offset of the first file name; must be `20`, i.e. straight
 *   after the 20-byte header, in sane payloads)
 * - i32 `pt.x`, i32 `pt.y`
 * - u32 `fNC` (BOOL, EOF flag) at offset 12
 * - u32 `fWide` (BOOL) at offset 16
 * - file list begins at offset `pFiles`.
 *
 * When `fWide` is set the remainder is UTF-16LE; otherwise it is ANSI decoded
 * as windows-1252. Both encodings hold null-separated path lists terminated by
 * a final double-null. Truncated or unterminated payloads (including a lone
 * trailing null) are rejected as `malformed-format`. An empty list decodes to
 * `{ ok: true, paths: [] }` and the caller maps it to `none` when empty.
 * @returns the parsed paths, or a stable error code.
 */
export function parseWindowsDroFilesBytes(
  bytes: Uint8Array,
  limits: NativeClipboardLimits,
): ParseOutcome {
  if (bytes.length < 20) return { ok: false, code: 'malformed-format' }
  const pFiles = readU32LE(bytes, 0)
  const fWide = readU32LE(bytes, 16)
  if (pFiles !== 20) return { ok: false, code: 'malformed-format' }
  if (bytes.length < pFiles) return { ok: false, code: 'malformed-format' }
  const payload = bytes.subarray(pFiles)
  if (fWide) {
    let decoded: string
    try {
      decoded = new TextDecoder('utf-16le', { fatal: true }).decode(payload)
    } catch {
      return { ok: false, code: 'malformed-format' }
    }
    const paths = parseNullSeparatedList(decoded)
    if (paths === undefined) return { ok: false, code: 'malformed-format' }
    return applyPathLimits(paths, limits)
  }
  const decoded = new TextDecoder('windows-1252').decode(payload)
  const paths = parseNullSeparatedList(decoded)
  if (paths === undefined) return { ok: false, code: 'malformed-format' }
  return applyPathLimits(paths, limits)
}

/**
 * Parse a null-separated DROPFILES path list that is already decoded to a
 * string, requiring a final double-null terminator.
 *
 * A raw filesystem path can never contain a NUL character, so `\0` is
 * unambiguous as a separator in both ANSI and wide encodings, and `\0\0` marks
 * the end. We therefore require the structure to be well-terminated: the final
 * two characters must both be NUL. A lone trailing NUL (a truncated payload) is
 * ambiguous with a single-path list and is rejected as `malformed-format`.
 * @returns the non-empty path segments, or `undefined` when unterminated.
 */
function parseNullSeparatedList(text: string): readonly string[] | undefined {
  if (text.length < 2) return undefined
  if (text.charCodeAt(text.length - 1) !== 0 || text.charCodeAt(text.length - 2) !== 0) return undefined
  const segments = text.split('\0')
  const paths: string[] = []
  for (const segment of segments) {
    if (segment.length === 0) break
    paths.push(segment)
  }
  return paths
}

/**
 * Parse a `FileNameW`/`FileName` value: a null-separated path list already
 * decoded by the host to a string. Empty trailing entries are dropped; an empty
 * value yields `{ ok: true, paths: [] }`.
 */
export function parseWindowsFileNamesText(text: string, limits: NativeClipboardLimits): ParseOutcome {
  const paths: string[] = []
  for (const segment of text.split('\0')) {
    if (segment.length === 0) continue
    paths.push(segment)
  }
  return applyPathLimits(paths, limits)
}

/**
 * Parse a macOS `public.file-url` value. It is a single `file:` URL (possibly a
 * multi-line `text/uri-list`-style block, in which case only the first line is
 * parsed — a documented limitation; multi-file macOS copies are covered by the
 * `text/uri-list` fallback). The path is percent-decoded, an empty/`localhost`
 * host is treated as local, and query/fragment parts are ignored. A non-`file:`
 * scheme is not a file list at all and yields empty paths. Malformed percent
 * encoding yields `malformed-format`.
 */
export function parsePublicFileUrlText(text: string, limits: NativeClipboardLimits): ParseOutcome {
  const firstLine = text.replace(/\r\n/g, '\n').split('\n', 1)[0] ?? ''
  const trimmed = firstLine.trim()
  if (trimmed.length === 0) return { ok: true, paths: [] }
  if (!/^file:/i.test(trimmed)) return { ok: true, paths: [] }
  const decoded = decodeFileUriLine(trimmed)
  if (decoded.kind === 'none') return { ok: true, paths: [] }
  if (decoded.kind === 'malformed') return { ok: false, code: 'malformed-format' }
  return applyPathLimits([decoded.path], limits)
}

/**
 * Parse a Linux `text/uri-list` (and the generic fallback). Lines are separated
 * by `\r\n` or `\n`; comment lines starting with `#` and blank lines are
 * ignored; every data line must be a `file:` URI. Non-`file:` scheme lines and
 * malformed `file:` lines are skipped, and if no file lines remain the result
 * is `{ ok: true, paths: [] }`. Absolute paths are percent-decoded and returned
 * in order (repeats are preserved).
 */
export function parseUriList(text: string, limits: NativeClipboardLimits): ParseOutcome {
  const paths: string[] = []
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    if (line.startsWith('#')) continue
    if (!/^file:/i.test(line)) continue
    const decoded = decodeFileUriLine(line)
    if (decoded.kind !== 'path') continue
    paths.push(decoded.path)
  }
  return applyPathLimits(paths, limits)
}

/**
 * Decode one `file:` URI line into an absolute local path.
 *
 * - `file:///abs/path` and `file://localhost/abs/path` decode `/abs/path`; a
 *   non-empty non-`localhost` host is not a local file and yields `none`.
 * - `file:/abs/path` (no `//` authority) decodes `/abs/path`.
 * - A missing path yields `none`; a bad percent escape yields `malformed`.
 * Query (`?`) and fragment (`#`) parts are dropped before decoding.
 */
function decodeFileUriLine(line: string): { kind: 'path'; path: string } | { kind: 'none' } | { kind: 'malformed' } {
  const rest = line.startsWith('file://') ? line.slice('file://'.length) : line.slice('file:'.length)
  let pathPart: string
  if (line.startsWith('file://')) {
    const slash = rest.indexOf('/')
    if (slash === -1) return { kind: 'none' }
    const host = rest.slice(0, slash).toLowerCase()
    if (host !== '' && host !== 'localhost') return { kind: 'none' }
    pathPart = rest.slice(slash)
  } else {
    pathPart = rest
  }
  const clean = pathPart.split(/[?#]/, 1)[0] ?? ''
  if (clean.length === 0) return { kind: 'none' }
  try {
    return { kind: 'path', path: decodeURIComponent(clean) }
  } catch {
    return { kind: 'malformed' }
  }
}

/**
 * Enforce the shared limits on a decoded path list. `maxItems` bounds the
 * count, `maxPathChars` bounds each single path in UTF-16 code units, and
 * `maxPayloadBytes` bounds the sum of all path code-unit lengths.
 * @returns the matching stable error code, or ok when within all limits.
 */
function enforcePathLimits(paths: readonly string[], limits: NativeClipboardLimits):
  | { ok: true }
  | { ok: false; code: NativeClipboardErrorCode } {
  if (paths.length > limits.maxItems) return { ok: false, code: 'too-many-items' }
  let total = 0
  for (const path of paths) {
    if (path.length > limits.maxPathChars) return { ok: false, code: 'path-too-long' }
    total += path.length
    if (total > limits.maxPayloadBytes) return { ok: false, code: 'payload-too-large' }
  }
  return { ok: true }
}

/** Enforce limits on a parsed path list and return the outcome. */
function applyPathLimits(paths: readonly string[], limits: NativeClipboardLimits): ParseOutcome {
  const check = enforcePathLimits(paths, limits)
  if (!check.ok) return check
  return { ok: true, paths }
}

/** Read a little-endian unsigned 32-bit value from a byte buffer. */
function readU32LE(bytes: Uint8Array, offset: number): number {
  const b0 = bytes[offset] ?? 0
  const b1 = bytes[offset + 1] ?? 0
  const b2 = bytes[offset + 2] ?? 0
  const b3 = bytes[offset + 3] ?? 0
  return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0
}
