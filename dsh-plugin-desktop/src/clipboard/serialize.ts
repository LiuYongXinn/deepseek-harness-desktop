/**
 * Fixed model-visible file-reference marker serializer (P0-7).
 *
 * This module is pure and browser-safe: it imports nothing from Node,
 * Electron, Cordis live objects, or the filesystem. It turns a Host-validated
 * list of workspace-relative paths into the exact text block that P0 places
 * into `session.prompt` (the existing `{ type: 'text', text }` wire variant is
 * unchanged; P0 never adds a structured `file-reference` prompt part). Because
 * the output is assembled model-visible text, callers must snapshot it
 * byte-for-byte.
 *
 * Security contract:
 * - The marker is a *model-visible address hint*, not an access credential.
 *   It does not grant the model any way around the session workspace boundary.
 *   A user (or model) can hand-write the same path text; whether the Agent can
 *   read the file is decided by the existing `read`/filesystem tool, which
 *   re-authorizes the path inside the current session workspace when it is
 *   executed. Every path serialized here is ALWAYS a Host-validated
 *   workspace-relative path (from {@link ClipboardFileReference}), and this
 *   module re-validates it with {@link isWorkspaceRelativePath} so a raw
 *   absolute path can never reach the model text — it fails loud instead.
 * - P0 never includes `name`, `size`, `leaseId`, or absolute paths in the
 *   model text. The marker carries only the workspace-relative `path`.
 *
 * Marker layout (design §3.4): an opening tag, one `{"path":...}` line per
 * reference in input order (using the real `JSON.stringify`), then a closing
 * tag, all joined with `\n` — no blank lines. If the user body is non-empty,
 * it follows a single `\n` after the marker; an empty body still sends the
 * marker alone (references are never dropped because `text === ''`).
 * @module dsh-plugin-desktop/clipboard/clipboard-serialize
 */

import { isWorkspaceRelativePath } from './contract.ts'

import type { ClipboardFileReference } from './contract.ts'

/** Opening tag of the fixed model-visible file-reference marker. */
export const FILE_REFERENCE_MARKER_OPEN = '<dsh-file-references>'

/** Closing tag of the fixed model-visible file-reference marker. */
export const FILE_REFERENCE_MARKER_CLOSE = '</dsh-file-references>'

/**
 * Maximum code-unit length of a serialized reference path. Bounds the size of
 * the assembled marker and matches the Host's own bounded wire-field cap so a
 * single pathological path cannot inflate the sent text.
 */
export const MAX_SERIALIZED_PATH_LENGTH = 64 * 1024

/**
 * A single file reference to serialize. The `path` is ALWAYS a Host-validated
 * workspace-relative `/`-separated path with no leading `/`, drive, UNC, or
 * `..`; this aliases {@link ClipboardFileReference} so the serializer accepts
 * exactly what Host `validate` returns.
 */
export type FileMarkerReference = ClipboardFileReference

/**
 * Serialize a batch of Host-validated file references into the fixed
 * model-visible marker text (design §3.4 / §10.2 #9).
 *
 * - With no references, returns `userText` unchanged (empty when `userText` is
 *   empty).
 * - Every reference path must pass {@link isWorkspaceRelativePath}; if any
 *   fails, this throws rather than silently emitting a raw absolute path into
 *   the model text.
 * - Otherwise returns `OPEN`, one `JSON.stringify({ path })` line per
 *   reference in input order (duplicates preserved), and `CLOSE`, joined by
 *   `\n`. A non-empty `userText` is appended after a single `\n`; an empty
 *   body still returns the full marker text.
 *
 * @param references - Host-validated references in explicit attachment order.
 * @param userText - optional plain user body to append after the marker.
 * @returns the exact model-visible text for `session.prompt`.
 */
export function serializeFileReferences(references: readonly FileMarkerReference[], userText = ''): string {
  if (references.length === 0) return userText

  for (const reference of references) {
    if (!isWorkspaceRelativePath(reference.path, MAX_SERIALIZED_PATH_LENGTH)) {
      throw new Error('dsh-plugin-desktop: file reference path is not workspace-relative')
    }
  }

  const lines: string[] = [FILE_REFERENCE_MARKER_OPEN]
  for (const reference of references) {
    lines.push(JSON.stringify({ path: reference.path }))
  }
  lines.push(FILE_REFERENCE_MARKER_CLOSE)

  const marker = lines.join('\n')
  if (userText === '') return marker
  return `${marker}\n${userText}`
}
