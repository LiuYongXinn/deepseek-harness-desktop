/**
 * Wire contracts shared by the Host gateway and the rendered Client for the
 * built-in file viewer. This module is browser-loadable and must not import
 * Node APIs or reference live Cordis objects: every type here is a plain JSON
 * value and every parser validates an `unknown` value coming off the byte
 * boundary into a discriminated union. The Host and Client both import parsers
 * from here so a discriminant never silently changes meaning on one side.
 * @module dsh-plugin-desktop/file-preview-contract
 */

/**
 * Brand applied to a validated opaque resource token. A token is minted by the
 * Host from a strong source and never contains a path or any recoverable way to
 * locate the underlying file.
 */
declare const filePreviewResourceId: unique symbol

/**
 * Opaque, validated resource token handed to a Client and still held by the
 * resource map. Only {@link FilePreviewResourceId.of} and the parsers brand a
 * value; a raw string is never structurally a valid id.
 */
export type FilePreviewResourceId = string & { readonly [filePreviewResourceId]: unique symbol }

declare const filePreviewRevision: unique symbol

/**
 * Opaque, validated revision token identifying one specific read of a file's
 * text. The Client echoes it back on save as the version guard so a save can
 * never silently overwrite a newer on-disk version. Only the parsers and the
 * Host mint a value; a raw string is never structurally a valid revision.
 */
export type FilePreviewRevision = string & { readonly [filePreviewRevision]: unique symbol }

/**
 * Name of the loopback Connection RPC channel carrying every file-preview
 * endpoint. Both Host handler and Client caller register against this channel
 * so a mistyped string fails loudly at the transport boundary.
 */
export const FILE_PREVIEW_RPC_CHANNEL = '/desktop-file-preview'

/**
 * URL prefix of the loopback HTTP data plane for image payloads. The Host
 * registers a prefix route under this value and every binary URL is a relative
 * path below it; no other origin serves file bytes.
 */
export const FILE_PREVIEW_BINARY_PREFIX = '/desktop-file-preview-content'

/** Endpoint names accepted by the RPC channel, kept together for both sides. */
export const FILE_PREVIEW_ENDPOINTS = ['probe', 'read-text', 'binary-url', 'release', 'save-text'] as const

/** Single source of truth for valid RPC endpoint names. */
export type FilePreviewEndpoint = typeof FILE_PREVIEW_ENDPOINTS[number]

/** RPC endpoint performing the initial classify/authorize/resolve probe. */
export const FILE_PREVIEW_PROBE = 'probe'

/** RPC endpoint returning bounded UTF-8 text for a held resource. */
export const FILE_PREVIEW_READ_TEXT = 'read-text'

/** RPC endpoint returning the relative HTTP URL of a held image resource. */
export const FILE_PREVIEW_BINARY_URL = 'binary-url'

/** RPC endpoint idempotently releasing a held resource. */
export const FILE_PREVIEW_RELEASE = 'release'

/** RPC endpoint performing a version-guarded atomic text save. */
export const FILE_PREVIEW_SAVE_TEXT = 'save-text'

/**
 * Whether the payload is textual source (rendered with the Source family) or a
 * binary image served through the HTTP data plane.
 */
export type FilePreviewContentKind = 'text' | 'image'

/**
 * Descriptor base shared by the available and oversized arms of a probe
 * response. `displayPath` is for UI display only; an explicit system-open
 * must use the original request path retained separately by the controller.
 */
export interface FilePreviewDescriptorBase {
  /** Path to show in the panel header; never used for later authorization. */
  displayPath: string
  /** Final path segment, derived on the Host and passed through verbatim. */
  name: string
  /** Lowercased final extension including the leading dot, or `''`. */
  extension: string
  /** Canonical media type the Provider selection keys off. */
  mediaType: string
  /** Payload family controlling text vs binary image loading. */
  contentKind: FilePreviewContentKind
  /** Finite non-negative byte size reported by the Host stat. */
  size: number
  /** Optional Source-family syntax language identifier. */
  language?: string
}

/**
 * Probe descriptor: either an available resource the reader can load, or an
 * oversized file with no token that only displays metadata plus a system-open
 * action.
 */
export type FilePreviewDescriptor =
  | (FilePreviewDescriptorBase & {
      /** The file is within configuration limits and holds a readable token. */
      availability: 'available'
      /** Token the text/image loaders act on. */
      resourceId: FilePreviewResourceId
    })
  | (FilePreviewDescriptorBase & {
      /** The file exceeded the configured byte limit for its kind. */
      availability: 'oversized'
      /** The kind-specific byte limit that was exceeded. */
      limitBytes: number
    })

/**
 * Probe outcome. `preview` carries a descriptor; `delegate` tells the caller to
 * fall back to the system open path (directory, unauthorized, unsupported
 * format, or non-regular file); `error` is a supported file whose stat/read
 * failed and should be presented in the panel.
 */
export type FilePreviewProbeResult =
  | { status: 'preview'; descriptor: FilePreviewDescriptor }
  | { status: 'delegate' }
  | { status: 'error'; code: string; message: string; retryable: boolean }

/**
 * Text-read outcome. `ok` carries the decoded UTF-8 text, its resource id, and
 * the opaque revision to echo back on save; `stale` means the file changed after
 * probe and should be re-probed; `error` is a user-visible read failure.
 */
export type FilePreviewTextResult =
  | { status: 'ok'; text: string; resourceId: FilePreviewResourceId; revision: FilePreviewRevision }
  | { status: 'stale' }
  | { status: 'error'; code: string; message: string; retryable: boolean }

/**
 * Binary-url outcome. `ok.url` is a relative path under
 * {@link FILE_PREVIEW_BINARY_PREFIX}; `stale` and `error` mirror the text arm.
 */
export type FilePreviewBinaryResult =
  | { status: 'ok'; url: string }
  | { status: 'stale' }
  | { status: 'error'; code: string; message: string; retryable: boolean }

/**
 * Idempotent release outcome. `released` may report `false` only when the
 * gateway has already disposed globally.
 */
export interface FilePreviewReleaseResult {
  released: boolean
}

/**
 * Request payload of the {@link FILE_PREVIEW_SAVE_TEXT} endpoint. `path` is the
 * raw path from the original probe; the Host re-authorizes it against the
 * session's workspace on every save and never trusts the stored resource.
 */
export interface FilePreviewSaveTextRequest {
  /** Active session id authorizing the write. */
  sessionId: string
  /** Raw path of the file to overwrite (relative or absolute). */
  path: string
  /** The revision the editor last read; the Host refuses a stale write. */
  expectedRevision: FilePreviewRevision
  /** Full replacement text content. */
  text: string
}

/**
 * Version-guarded save outcome. `ok` carries the new revision and size; the
 * `conflict` arm means the file changed since the editor read it and the write
 * was refused without touching the disk; `error` is any other failure.
 */
export type FilePreviewSaveTextResult =
  | {
      status: 'ok'
      revision: FilePreviewRevision
      text: string
      size: number
    }
  | {
      status: 'conflict'
      code: 'stale-version'
      message: string
    }
  | {
      status: 'error'
      code: string
      message: string
      retryable: boolean
    }

/**
 * Request payload of the {@link FILE_PREVIEW_PROBE} endpoint.
 */
export interface FilePreviewProbeRequest {
  sessionId: string
  path: string
}

/**
 * Request payload of the {@link FILE_PREVIEW_READ_TEXT} endpoint.
 */
export interface FilePreviewReadTextRequest {
  resourceId: FilePreviewResourceId
}

/**
 * Request payload of the {@link FILE_PREVIEW_BINARY_URL} endpoint.
 */
export interface FilePreviewBinaryUrlRequest {
  resourceId: FilePreviewResourceId
}

/**
 * Request payload of the {@link FILE_PREVIEW_RELEASE} endpoint.
 */
export interface FilePreviewReleaseRequest {
  resourceId: FilePreviewResourceId
}

/** Length cap applied to variable-length wire fields to bound memory cost. */
const MAX_WIRE_FIELD_LENGTH = 64 * 1024

/**
 * Length cap applied to the `save-text` text body specifically. This is far
 * above the generic field cap (an edited Markdown file can exceed 64 KiB) but
 * still bounded so a hostile client cannot ship an unbounded payload. The Host
 * applies its stricter configured byte limit as an additional gate.
 */
const MAX_WIRE_TEXT_LENGTH = 8 * 1024 * 1024

/** Whether a wire value is a non-empty, bounded string. */
function isBoundedNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

/**
 * Validate a wire `unknown` into a {@link FilePreviewResourceId}. Rejects
 * non-string values, empty ids, and ids too long for a URL segment.
 * @param value - value from the wire.
 * @returns the branded id, or `undefined` when the value is not a valid id.
 */
export function parseResourceId(value: unknown): FilePreviewResourceId | undefined {
  if (!isBoundedNonEmptyString(value, MAX_WIRE_FIELD_LENGTH)) return undefined
  return value as FilePreviewResourceId
}

/**
 * Brand a caller-owned trusted string as a {@link FilePreviewResourceId}. The
 * Host mints ids from a strong source and this is the only non-validating
 * brand; parsers and wire validation must never call it on an `unknown`.
 * @param id - a validated raw token held by the Host.
 * @returns the branded id.
 */
export function FilePreviewResourceId(id: string): FilePreviewResourceId {
  return id as FilePreviewResourceId
}

/**
 * Validate a wire `unknown` into a {@link FilePreviewRevision}. Rejects
 * non-string values, empty revisions, and revisions too long for a bounded
 * field.
 * @param value - value from the wire.
 * @returns the branded revision, or `undefined` when the value is not valid.
 */
export function parseRevision(value: unknown): FilePreviewRevision | undefined {
  if (!isBoundedNonEmptyString(value, MAX_WIRE_FIELD_LENGTH)) return undefined
  return value as FilePreviewRevision
}

/**
 * Brand a caller-owned trusted string as a {@link FilePreviewRevision}. The
 * Host mints revisions from a resource version and this is the only
 * non-validating brand; parsers and wire validation must never call it on an
 * `unknown`.
 * @param revision - a validated raw revision held by the Host.
 * @returns the branded revision.
 */
export function FilePreviewRevision(revision: string): FilePreviewRevision {
  return revision as FilePreviewRevision
}

/**
 * Validate a probe request payload.
 * @param value - value from the wire.
 * @returns the validated request, or a structured bad-request error object.
 */
export function parseProbeRequest(value: unknown): { ok: true; value: FilePreviewProbeRequest } | { ok: false; message: string } {
  const record = asPlainRecord(value)
  if (record === undefined) return { ok: false, message: 'probe payload must be a JSON object' }
  const sessionId = record['sessionId']
  const path = record['path']
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > MAX_WIRE_FIELD_LENGTH) {
    return { ok: false, message: 'probe payload requires a non-empty bounded sessionId' }
  }
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_WIRE_FIELD_LENGTH) {
    return { ok: false, message: 'probe payload requires a non-empty bounded path' }
  }
  return { ok: true, value: { sessionId, path } }
}

/**
 * Validate a payload intended to carry a resource id.
 * @param value - value from the wire.
 * @returns the branded id, or an invalid-resource bad-request message.
 */
function parseResourceIdPayload(value: unknown): { ok: true; value: FilePreviewResourceId } | { ok: false; message: string } {
  const record = asPlainRecord(value)
  if (record === undefined) return { ok: false, message: 'payload must be a JSON object' }
  const id = parseResourceId(record['resourceId'])
  if (id === undefined) return { ok: false, message: 'payload requires a valid resourceId' }
  return { ok: true, value: id }
}

/**
 * Validate a read-text request payload.
 * @param value - value from the wire.
 * @returns the validated resource id, or a structured bad-request error object.
 */
export function parseReadTextRequest(value: unknown): { ok: true; value: FilePreviewResourceId } | { ok: false; message: string } {
  return parseResourceIdPayload(value)
}

/**
 * Validate a binary-url request payload.
 * @param value - value from the wire.
 * @returns the validated resource id, or a structured bad-request error object.
 */
export function parseBinaryUrlRequest(value: unknown): { ok: true; value: FilePreviewResourceId } | { ok: false; message: string } {
  return parseResourceIdPayload(value)
}

/**
 * Validate a release request payload.
 * @param value - value from the wire.
 * @returns the validated resource id, or a structured bad-request error object.
 */
export function parseReleaseRequest(value: unknown): { ok: true; value: FilePreviewResourceId } | { ok: false; message: string } {
  return parseResourceIdPayload(value)
}

/**
 * Validate a {@link FILE_PREVIEW_SAVE_TEXT} request payload. Rejects missing or
 * empty session/path/expectedRevision fields and unbounded or over-large text.
 * @param value - value from the wire.
 * @returns the validated request, or a structured bad-request error object.
 */
export function parseSaveTextRequest(value: unknown): { ok: true; value: FilePreviewSaveTextRequest } | { ok: false; message: string } {
  const record = asPlainRecord(value)
  if (record === undefined) return { ok: false, message: 'save-text payload must be a JSON object' }
  const sessionId = record['sessionId']
  const path = record['path']
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > MAX_WIRE_FIELD_LENGTH) {
    return { ok: false, message: 'save-text payload requires a non-empty bounded sessionId' }
  }
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_WIRE_FIELD_LENGTH) {
    return { ok: false, message: 'save-text payload requires a non-empty bounded path' }
  }
  const expectedRevision = parseRevision(record['expectedRevision'])
  if (expectedRevision === undefined) {
    return { ok: false, message: 'save-text payload requires a valid expectedRevision' }
  }
  const text = record['text']
  if (typeof text !== 'string') return { ok: false, message: 'save-text payload requires string text' }
  if (text.length > MAX_WIRE_TEXT_LENGTH) {
    return { ok: false, message: 'save-text payload text exceeds the wire size cap' }
  }
  return { ok: true, value: { sessionId, path, expectedRevision, text } }
}

/**
 * Validate an `unknown` probe result into the {@link FilePreviewProbeResult}
 * union. Rejects unknown discriminants, non-string ids, non-finite/negative
 * sizes, and invalid descriptor shapes.
 * @param value - value from the wire.
 * @returns the validated result, or `undefined` when invalid.
 */
export function parseProbeResult(value: unknown): FilePreviewProbeResult | undefined {
  const record = asPlainRecord(value)
  if (record === undefined) return undefined
  const status = record['status']
  if (status === 'delegate') return { status: 'delegate' }
  if (status === 'error') {
    const parsed = parseErrorRecord(record)
    if (parsed === undefined) return undefined
    return parsed
  }
  if (status !== 'preview') return undefined
  const descriptor = parseDescriptor(record['descriptor'])
  if (descriptor === undefined) return undefined
  return { status: 'preview', descriptor }
}

/**
 * Validate an `unknown` probe descriptor into the {@link FilePreviewDescriptor}
 * union. Rejects non-string identities, invalid ids, non-finite/negative
 * sizes, and malformed extensions.
 * @param value - value from the wire.
 * @returns the validated descriptor, or `undefined` when invalid.
 */
export function parseDescriptor(value: unknown): FilePreviewDescriptor | undefined {
  const record = asPlainRecord(value)
  if (record === undefined) return undefined
  const base = parseDescriptorBase(record)
  if (base === undefined) return undefined
  const availability = record['availability']
  if (availability === 'available') {
    const resourceId = parseResourceId(record['resourceId'])
    if (resourceId === undefined) return undefined
    return { ...base, availability: 'available', resourceId }
  }
  if (availability === 'oversized') {
    const limitBytes = record['limitBytes']
    if (!isFiniteSize(limitBytes)) return undefined
    return { ...base, availability: 'oversized', limitBytes }
  }
  return undefined
}

/** Validate the base descriptor fields shared by both availability arms. */
function parseDescriptorBase(record: Readonly<Record<string, unknown>>): FilePreviewDescriptorBase | undefined {
  const displayPath = record['displayPath']
  const name = record['name']
  const extension = record['extension']
  const mediaType = record['mediaType']
  const contentKind = record['contentKind']
  const size = record['size']
  if (typeof displayPath !== 'string' || typeof name !== 'string'
    || typeof mediaType !== 'string') return undefined
  if (!isValidExtension(extension)) return undefined
  if (contentKind !== 'text' && contentKind !== 'image') return undefined
  if (!isFiniteSize(size)) return undefined
  const base: FilePreviewDescriptorBase = {
    displayPath,
    name,
    extension,
    mediaType,
    contentKind,
    size,
  }
  const language = record['language']
  if (language !== undefined) {
    if (typeof language !== 'string' || language.length > MAX_WIRE_FIELD_LENGTH) return undefined
    base.language = language
  }
  return base
}

/**
 * Validate a descriptor {@link FilePreviewDescriptorBase.extension}: it must be
 * `''` or a dotted, lowercased, bounded extension that never contains a path
 * separator. Rejects the bare classifier spelling (`md`) so a contract
 * mismatch fails loudly on the wire instead of silently redirecting providers.
 * @param value - the wire extension value.
 * @returns true when the value is a well-formed descriptor extension.
 */
function isValidExtension(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_WIRE_FIELD_LENGTH) return false
  if (value.length === 0) return true
  if (value[0] !== '.') return false
  if (value.includes('/') || value.includes('\\')) return false
  if (value !== value.toLowerCase()) return false
  return true
}

/**
 * Validate an `unknown` text-read result into the {@link FilePreviewTextResult}
 * union.
 * @param value - value from the wire.
 * @returns the validated result, or `undefined` when invalid.
 */
export function parseTextResult(value: unknown): FilePreviewTextResult | undefined {
  const record = asPlainRecord(value)
  if (record === undefined) return undefined
  const status = record['status']
  if (status === 'stale') return { status: 'stale' }
  if (status === 'error') {
    const parsed = parseErrorRecord(record)
    if (parsed === undefined) return undefined
    return parsed
  }
  if (status !== 'ok' || typeof record['text'] !== 'string') return undefined
  const resourceId = parseResourceId(record['resourceId'])
  if (resourceId === undefined) return undefined
  const revision = parseRevision(record['revision'])
  if (revision === undefined) return undefined
  return { status: 'ok', text: record['text'], resourceId, revision }
}

/**
 * Validate an `unknown` binary-url result into the
 * {@link FilePreviewBinaryResult} union. The url must be a non-empty relative
 * path under {@link FILE_PREVIEW_BINARY_PREFIX}; absolute URLs are rejected.
 * @param value - value from the wire.
 * @returns the validated result, or `undefined` when invalid.
 */
export function parseBinaryResult(value: unknown): FilePreviewBinaryResult | undefined {
  const record = asPlainRecord(value)
  if (record === undefined) return undefined
  const status = record['status']
  if (status === 'stale') return { status: 'stale' }
  if (status === 'error') {
    const parsed = parseErrorRecord(record)
    if (parsed === undefined) return undefined
    return parsed
  }
  if (status !== 'ok') return undefined
  const url = record['url']
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_WIRE_FIELD_LENGTH) return undefined
  if (!url.startsWith(`${FILE_PREVIEW_BINARY_PREFIX}/`)) return undefined
  return { status: 'ok', url }
}

/**
 * Validate an `unknown` release result into {@link FilePreviewReleaseResult}.
 * @param value - value from the wire.
 * @returns the validated result, or `undefined` when invalid.
 */
export function parseReleaseResult(value: unknown): FilePreviewReleaseResult | undefined {
  const record = asPlainRecord(value)
  if (record === undefined || typeof record['released'] !== 'boolean') return undefined
  return { released: record['released'] }
}

/**
 * Validate an `unknown` save result into the {@link FilePreviewSaveTextResult}
 * union. Rejects unknown discriminants, malformed conflict arms, and invalid
 * ok-arm fields.
 * @param value - value from the wire.
 * @returns the validated result, or `undefined` when invalid.
 */
export function parseSaveTextResult(value: unknown): FilePreviewSaveTextResult | undefined {
  const record = asPlainRecord(value)
  if (record === undefined) return undefined
  const status = record['status']
  if (status === 'conflict') {
    if (record['code'] !== 'stale-version' || typeof record['message'] !== 'string') return undefined
    return { status: 'conflict', code: 'stale-version', message: record['message'] }
  }
  if (status === 'error') {
    const parsed = parseErrorRecord(record)
    if (parsed === undefined) return undefined
    return parsed
  }
  if (status !== 'ok') return undefined
  const revision = parseRevision(record['revision'])
  if (revision === undefined) return undefined
  if (typeof record['text'] !== 'string' || !isFiniteSize(record['size'])) return undefined
  return { status: 'ok', revision, text: record['text'], size: record['size'] }
}

/** Validate the shared `error` arm fields of a business-result union. */
function parseErrorRecord(record: Readonly<Record<string, unknown>>):
  | { status: 'error'; code: string; message: string; retryable: boolean }
  | undefined {
  const code = record['code']
  const message = record['message']
  const retryable = record['retryable']
  if (typeof code !== 'string' || code.length === 0 || code.length > MAX_WIRE_FIELD_LENGTH
    || typeof message !== 'string' || message.length > MAX_WIRE_FIELD_LENGTH
    || typeof retryable !== 'boolean') return undefined
  return { status: 'error', code, message, retryable }
}

/** Whether a wire value is a finite, non-negative number. */
function isFiniteSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Return a value as a plain record, or undefined for anything else. */
function asPlainRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Readonly<Record<string, unknown>>
}
