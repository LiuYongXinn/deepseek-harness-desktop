/**
 * Wire contracts shared by the Host gateway and the rendered Client for native
 * file-manager clipboard paste. This module is browser-loadable and must not
 * import Node APIs, Electron, or reference live Cordis objects: every type here
 * is a plain JSON value and every parser validates an `unknown` value coming
 * off the byte boundary into a discriminated union. The Host and Client both
 * import parsers from here so a discriminant never silently changes meaning on
 * one side. Absolute file paths never cross this boundary — only opaque lease
 * ids, Host-sanitized basenames, and workspace-relative `/`-separated paths do.
 * @module dsh-plugin-desktop/clipboard/clipboard-contract
 */

/**
 * Name of the loopback Connection RPC channel carrying every desktop-clipboard
 * endpoint. Both Host handler and Client caller register against this channel
 * so a mistyped string fails loudly at the transport boundary.
 */
export const DESKTOP_CLIPBOARD_RPC_CHANNEL = '/desktop-clipboard'

/** Endpoint names accepted by the RPC channel, kept together for both sides. */
export const DESKTOP_CLIPBOARD_ENDPOINTS = ['probe', 'validate', 'release'] as const

/** Single source of truth for valid RPC endpoint names. */
export type DesktopClipboardEndpoint = typeof DESKTOP_CLIPBOARD_ENDPOINTS[number]

/** RPC endpoint probing the current native clipboard for a file list. */
export const DESKTOP_CLIPBOARD_PROBE = 'probe'

/** RPC endpoint atomically re-authorizing a batch of held file leases. */
export const DESKTOP_CLIPBOARD_VALIDATE = 'validate'

/** RPC endpoint idempotently releasing held file leases. */
export const DESKTOP_CLIPBOARD_RELEASE = 'release'

/**
 * Brand applied to a validated opaque clipboard lease id. A lease id is minted
 * by the Host from an unpredictable source and never contains a path or any
 * recoverable way to locate the underlying file; it exists only in the current
 * Renderer draft and Host memory and never enters a prompt, log, error message,
 * or persisted draft.
 */
declare const desktopClipboardLeaseId: unique symbol

/**
 * Opaque, validated lease id handed to a Client for one held file. Only
 * {@link DesktopClipboardLeaseId} and the parsers brand a value; a raw string
 * is never structurally a valid lease id.
 */
export type DesktopClipboardLeaseId = string & { readonly [desktopClipboardLeaseId]: unique symbol }

/**
 * Brand a caller-owned trusted string as a {@link DesktopClipboardLeaseId}. The
 * Host mints ids from an unpredictable source and this is the only
 * non-validating brand; parsers and wire validation must never call it on an
 * `unknown`.
 * @param id - a validated raw token held by the Host.
 * @returns the branded id.
 */
export function DesktopClipboardLeaseId(id: string): DesktopClipboardLeaseId {
  return id as DesktopClipboardLeaseId
}

/** Length cap applied to variable-length wire fields to bound memory cost. */
const MAX_WIRE_FIELD_LENGTH = 64 * 1024

/** Maximum number of lease ids accepted in one validate/release batch. */
const MAX_LEASE_BATCH = 64

/** Whether a wire value is a non-empty, bounded string. */
function isBoundedNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

/**
 * Validate a wire `unknown` into a {@link DesktopClipboardLeaseId}. Rejects
 * non-string values, empty ids, and ids too long for a bounded field.
 * @param value - value from the wire.
 * @returns the branded id, or `undefined` when the value is not a valid id.
 */
export function parseLeaseId(value: unknown): DesktopClipboardLeaseId | undefined {
  if (!isBoundedNonEmptyString(value, MAX_WIRE_FIELD_LENGTH)) return undefined
  return value as DesktopClipboardLeaseId
}

/**
 * Request payload of the {@link DESKTOP_CLIPBOARD_PROBE} endpoint. The Host
 * resolves the session's workspace, then reads the *current* native clipboard;
 * the Client never supplies a raw path as probe input.
 */
export interface ClipboardProbeRequest {
  sessionId: string
}

/** One validated file offered to the Client by a probe `files` result. */
export interface ClipboardFileDraft {
  /** Opaque Host-minted lease id; never a path. */
  leaseId: DesktopClipboardLeaseId
  /** Host-sanitized basename for display. */
  name: string
  /** `/`-separated workspace-relative path with no leading `/`, drive, UNC, or `..`. */
  relativePath: string
  /** Finite non-negative byte size reported by the Host stat. */
  size: number
}

/**
 * How the Host classifies the native clipboard text that accompanied the file
 * list. A native file-list format means the URI text is just the same paths
 * (`suppress`); otherwise the clipboard text is genuine user text (`preserve`).
 */
export type ClipboardTextDisposition = 'suppress' | 'preserve'

/** Probe outcome: no file list (`none`), a validated file list, or an error. */
export type ClipboardProbeResult =
  | { status: 'none' }
  | { status: 'files'; items: readonly ClipboardFileDraft[]; textDisposition: ClipboardTextDisposition }
  | { status: 'error'; code: string; message: string }

/** Request payload of the {@link DESKTOP_CLIPBOARD_VALIDATE} endpoint. */
export interface ClipboardValidateRequest {
  sessionId: string
  leaseIds: readonly DesktopClipboardLeaseId[]
}

/**
 * A validated workspace-relative reference returned on a successful validate.
 * The path is Host-validated and safe to serialize into the model-visible file
 * marker; it is never a raw absolute path.
 */
export interface ClipboardFileReference {
  path: string
}

/**
 * Validate outcome. `ok.references` preserves lease order and every reference
 * is validated against this module's path rules; `stale` means at least one
 * lease no longer resolves to the same authorized target (the batch is atomic,
 * so no partial success is ever returned).
 */
export type ClipboardValidateResult =
  | { status: 'ok'; references: readonly ClipboardFileReference[] }
  | { status: 'stale' }
  | { status: 'error'; code: string; message: string }

/** Request payload of the {@link DESKTOP_CLIPBOARD_RELEASE} endpoint. */
export interface ClipboardReleaseRequest {
  sessionId: string
  leaseIds: readonly DesktopClipboardLeaseId[]
}

/** Idempotent release outcome. `released` may report `false` only when the gateway has disposed globally. */
export interface ClipboardReleaseResult {
  released: boolean
}

/**
 * Whether a wire value is a valid absolute/UNC-free workspace-relative path. A
 * valid path is non-empty, bounded, `/`-separated, and rejectance-critical: it
 * must reject a leading `/` (absolute), any `\`, a segment equal to `..`, a
 * Windows drive-letter prefix, and a UNC prefix. This keeps an absolute path
 * from ever crossing to the Client. `maxLength` bounds the path in code units.
 */
export function isWorkspaceRelativePath(value: unknown, maxLength: number): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > maxLength) return false
  // Absolute paths (including a UTF-16 leading encoding) are never workspace-relative.
  if (value.startsWith('/')) return false
  // Backslash separators are not canonical and can mask a Windows drive path.
  if (value.includes('\\')) return false
  // Windows drive-letter prefix, e.g. `C:\` or `C:/`.
  if (/^[A-Za-z]:/.test(value)) return false
  // UNC prefix. Already caught by the leading `/` check but kept explicit.
  if (value.startsWith('//')) return false
  const segments = value.split('/')
  for (const segment of segments) {
    // `..` can escape the workspace root; reject it at any depth.
    if (segment === '..') return false
  }
  return true
}

/** Whether a wire value is a finite, non-negative number. */
export function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * Validate a probe request payload.
 * @param value - value from the wire.
 * @returns the validated request, or a structured bad-request error object.
 */
export function parseProbeRequest(value: unknown): { ok: true; value: ClipboardProbeRequest } | { ok: false; message: string } {
  const record = asPlainRecord(value)
  if (record === undefined) return { ok: false, message: 'probe payload must be a JSON object' }
  const sessionId = record['sessionId']
  if (!isBoundedNonEmptyString(sessionId, MAX_WIRE_FIELD_LENGTH)) {
    return { ok: false, message: 'probe payload requires a non-empty bounded sessionId' }
  }
  return { ok: true, value: { sessionId } }
}

/**
 * Validate an `unknown` array of lease ids into a bounded, non-empty batch.
 * Rejects arrays that are empty, longer than {@link MAX_LEASE_BATCH}, or that
 * contain any invalid lease id (the whole batch fails rather than a partial).
 * @param value - value from the wire.
 * @returns the validated lease ids, or `undefined` when invalid.
 */
function parseLeaseIds(value: unknown): readonly DesktopClipboardLeaseId[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LEASE_BATCH) return undefined
  const ids: DesktopClipboardLeaseId[] = []
  for (const item of value) {
    const id = parseLeaseId(item)
    if (id === undefined) return undefined
    ids.push(id)
  }
  return ids
}

/**
 * Validate a validate request payload.
 * @param value - value from the wire.
 * @returns the validated request, or a structured bad-request error object.
 */
export function parseValidateRequest(value: unknown): { ok: true; value: ClipboardValidateRequest } | { ok: false; message: string } {
  const record = asPlainRecord(value)
  if (record === undefined) return { ok: false, message: 'validate payload must be a JSON object' }
  const sessionId = record['sessionId']
  if (!isBoundedNonEmptyString(sessionId, MAX_WIRE_FIELD_LENGTH)) {
    return { ok: false, message: 'validate payload requires a non-empty bounded sessionId' }
  }
  const leaseIds = parseLeaseIds(record['leaseIds'])
  if (leaseIds === undefined) {
    return { ok: false, message: 'validate payload requires a bounded, non-empty array of valid leaseIds' }
  }
  return { ok: true, value: { sessionId, leaseIds } }
}

/**
 * Validate a release request payload.
 * @param value - value from the wire.
 * @returns the validated request, or a structured bad-request error object.
 */
export function parseReleaseRequest(value: unknown): { ok: true; value: ClipboardReleaseRequest } | { ok: false; message: string } {
  const record = asPlainRecord(value)
  if (record === undefined) return { ok: false, message: 'release payload must be a JSON object' }
  const sessionId = record['sessionId']
  if (!isBoundedNonEmptyString(sessionId, MAX_WIRE_FIELD_LENGTH)) {
    return { ok: false, message: 'release payload requires a non-empty bounded sessionId' }
  }
  const leaseIds = parseLeaseIds(record['leaseIds'])
  if (leaseIds === undefined) {
    return { ok: false, message: 'release payload requires a bounded, non-empty array of valid leaseIds' }
  }
  return { ok: true, value: { sessionId, leaseIds } }
}

/**
 * Validate a single {@link ClipboardFileDraft} item of a probe `files` result.
 * A raw absolute or `..`-containing `relativePath` fails the whole item (and
 * therefore the whole files parse), which is what keeps an absolute path from
 * ever crossing to the Client.
 * @param value - value from the wire.
 * @returns the validated draft, or `undefined` when invalid.
 */
function parseFileDraft(value: unknown): ClipboardFileDraft | undefined {
  const record = asPlainRecord(value)
  if (record === undefined) return undefined
  const leaseId = parseLeaseId(record['leaseId'])
  if (leaseId === undefined) return undefined
  const name = record['name']
  if (!isBoundedNonEmptyString(name, MAX_WIRE_FIELD_LENGTH)) return undefined
  const relativePath = record['relativePath']
  if (!isWorkspaceRelativePath(relativePath, MAX_WIRE_FIELD_LENGTH)) return undefined
  const size = record['size']
  if (!isFiniteNonNegativeNumber(size)) return undefined
  return { leaseId, name, relativePath, size }
}

/**
 * Validate an `unknown` probe result into the {@link ClipboardProbeResult}
 * union. Rejects unknown discriminants, invalid file drafts, and invalid
 * text-disposition values.
 * @param value - value from the wire.
 * @returns the validated result, or `undefined` when invalid.
 */
export function parseProbeResult(value: unknown): ClipboardProbeResult | undefined {
  const record = asPlainRecord(value)
  if (record === undefined) return undefined
  const status = record['status']
  if (status === 'none') return { status: 'none' }
  if (status === 'error') return parseErrorRecord(record)
  if (status !== 'files') return undefined
  const rawItems = record['items']
  if (!Array.isArray(rawItems)) return undefined
  const items: ClipboardFileDraft[] = []
  for (const rawItem of rawItems) {
    const item = parseFileDraft(rawItem)
    if (item === undefined) return undefined
    items.push(item)
  }
  const textDisposition = record['textDisposition']
  if (textDisposition !== 'suppress' && textDisposition !== 'preserve') return undefined
  return { status: 'files', items, textDisposition }
}

/**
 * Validate a single {@link ClipboardFileReference} item of a validate `ok`
 * result. The path must pass {@link isWorkspaceRelativePath}, so an absolute or
 * `..`-containing path fails the whole reference validation.
 * @param value - value from the wire.
 * @returns the validated reference, or `undefined` when invalid.
 */
function parseFileReference(value: unknown): ClipboardFileReference | undefined {
  const record = asPlainRecord(value)
  if (record === undefined) return undefined
  const path = record['path']
  if (!isWorkspaceRelativePath(path, MAX_WIRE_FIELD_LENGTH)) return undefined
  return { path }
}

/**
 * Validate an `unknown` validate result into the {@link ClipboardValidateResult}
 * union. Rejects unknown discriminants and invalid references.
 * @param value - value from the wire.
 * @returns the validated result, or `undefined` when invalid.
 */
export function parseValidateResult(value: unknown): ClipboardValidateResult | undefined {
  const record = asPlainRecord(value)
  if (record === undefined) return undefined
  const status = record['status']
  if (status === 'stale') return { status: 'stale' }
  if (status === 'error') return parseErrorRecord(record)
  if (status !== 'ok') return undefined
  const rawReferences = record['references']
  if (!Array.isArray(rawReferences)) return undefined
  const references: ClipboardFileReference[] = []
  for (const rawReference of rawReferences) {
    const reference = parseFileReference(rawReference)
    if (reference === undefined) return undefined
    references.push(reference)
  }
  return { status: 'ok', references }
}

/**
 * Validate an `unknown` release result into {@link ClipboardReleaseResult}.
 * @param value - value from the wire.
 * @returns the validated result, or `undefined` when invalid.
 */
export function parseReleaseResult(value: unknown): ClipboardReleaseResult | undefined {
  const record = asPlainRecord(value)
  if (record === undefined || typeof record['released'] !== 'boolean') return undefined
  return { released: record['released'] }
}

/**
 * Validate the shared `error` arm fields of a clipboard result union. Unlike
 * file-preview, the desktop-clipboard error arm has no `retryable` flag.
 * @param record - the as-yet-unvalidated result record.
 * @returns the validated error arm, or `undefined` when invalid.
 */
function parseErrorRecord(record: Readonly<Record<string, unknown>>):
  | { status: 'error'; code: string; message: string }
  | undefined {
  const code = record['code']
  const message = record['message']
  if (!isBoundedNonEmptyString(code, MAX_WIRE_FIELD_LENGTH)
    || typeof message !== 'string' || message.length > MAX_WIRE_FIELD_LENGTH) return undefined
  return { status: 'error', code, message }
}

/** Return a value as a plain record, or undefined for anything else. */
function asPlainRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Readonly<Record<string, unknown>>
}
