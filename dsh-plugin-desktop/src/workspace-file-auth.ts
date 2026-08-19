/**
 * Host-only narrow workspace-file authorization shared by the file-preview
 * gateway and the clipboard gateway (design §6 P0-2 #2). Both gateways must
 * authorize a candidate path with the same membership, lineage, resolve,
 * contains, lstat, and stat predicates so the two security verdicts never
 * drift. This module carries no Cordis context; callers inject the workspace
 * list, the optional lineage-trace callback, the filesystem seam, and a
 * logger, so the business methods stay unit-testable with fakes.
 *
 * This module is Host-only: it imports `node:path` and `@deepseek-ai/dsh-fs`
 * types and MUST NOT be imported by anything under `src/client/`.
 * @module dsh-plugin-desktop/workspace-file-auth
 */

import { relative } from 'node:path'
import type {
  FsInfo,
  FsPathInfo,
  FsTarget,
  FsVersion,
} from '@deepseek-ai/dsh-fs'

/** One workspace membership entry read from the workspace registry. */
export interface WorkspaceMembership {
  path: string
  sessionIds: readonly string[]
}

/** Narrow lineage shape used for subagent workspace resolution. */
export interface LineageTrace {
  target: { header: { origin?: 'subagent'; parentSession?: string } }
  ancestors: readonly { header: { parentSession?: string; id: string } }[]
}

/** Asynchronously trace a session's subagent lineage to its ancestors. */
export type TraceSession = (sessionId: string, signal: AbortSignal) => Promise<LineageTrace>

/** Minimal logger surface the authorization helper writes diagnostics to. */
export interface WorkspaceAuthLogger {
  warn(message: unknown, ...args: unknown[]): void
}

/** Read the workspace membership list fresh from the registry. */
export type WorkspaceList = () => readonly WorkspaceMembership[]

/**
 * Resolve the workspace that authorizes a session, via direct membership or
 * inherited subagent membership. Mirrors the legacy `file-preview` `resolve`
 * algorithm exactly: direct membership wins first; otherwise the optional
 * lineage trace is consulted and, when the traced target is a subagent, each
 * ancestor (nearest first) is matched against the workspace registry.
 * @param list - registry list read fresh on every call.
 * @param sessionId - the raw session id from the wire.
 * @param traceSession - optional subagent lineage tracer.
 * @param signal - cancels the lineage trace.
 * @param logger - sink for a failed lineage trace.
 * @param label - gateway label for the trace-failure diagnostic.
 * @returns the authorizing workspace, or `undefined` when none authorizes.
 */
export async function resolveWorkspaceMembership(
  list: WorkspaceList,
  sessionId: string,
  traceSession: TraceSession | undefined,
  signal: AbortSignal,
  logger: WorkspaceAuthLogger,
  label: string,
): Promise<WorkspaceMembership | undefined> {
  const memberships = list()
  let matched = memberships.find(membership => membership.sessionIds.includes(sessionId))
  if (matched !== undefined) return matched
  if (traceSession === undefined) return undefined
  let trace: LineageTrace
  try {
    trace = await traceSession(sessionId, signal)
  } catch (error) {
    // An absent target or a failing corpus listing leaves no authoritative
    // ancestor membership; the caller keeps its native/absence behavior.
    logger.warn('dsh-plugin-desktop: ' + label + ' lineage trace failed', error)
    return undefined
  }
  if (trace.target.header.origin !== 'subagent') return undefined
  for (const ancestor of trace.ancestors) {
    matched = memberships.find(membership => membership.sessionIds.includes(ancestor.header.id))
    if (matched !== undefined) return matched
  }
  return undefined
}

/**
 * Narrow filesystem seam the workspace-file authorization runs on.
 * Structurally compatible with {@link FileSystem} for exactly the members used
 * here. Tests supply an in-memory fake and the real Host passes `ctx.fs`. The
 * seam intentionally exposes NO content-reading members (`readBytes`, `readText`,
 * `streamText`, `editText`, `writeText`), so the shared helper can never read
 * file bytes.
 */
export interface WorkspaceFileFsSeam {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>
  contains(parent: FsTarget, child: FsTarget): boolean
  stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>
  lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined>
  processPath(target: FsTarget): string
}

/** Metadata of an authorized workspace file. */
export type WorkspaceFileAuthResult =
  | {
    ok: true
    workspace: WorkspaceMembership
    workspaceRoot: FsTarget
    target: FsTarget
    version: FsVersion
    size: number
    relativePath: string
  }
  | { ok: false; reason: 'path-absent' | 'symlink' | 'not-regular-file' | 'outside-workspace' | 'relative-path-invalid' }

/**
 * Authorize one candidate path against a workspace in the exact order of design
 * §5: lstat to reject the final path entry, resolve the workspace root, resolve
 * the candidate, contain the candidate, then stat for a regular file with a
 * finite non-negative size. Absolute candidate paths and `FsTarget`/`FsVersion`
 * stay Host-internal; only the workspace-relative `/`-separated path is ever
 * derived, and only through `processPath`.
 * @param fs - filesystem seam.
 * @param workspace - the session's authorizing workspace.
 * @param candidatePath - absolute candidate path from the native parse.
 * @param signal - cancels the authorization I/O.
 * @returns the authorized file metadata, or the rejection reason.
 */
export async function authorizeWorkspaceFile(
  fs: WorkspaceFileFsSeam,
  workspace: WorkspaceMembership,
  candidatePath: string,
  signal: AbortSignal,
): Promise<WorkspaceFileAuthResult> {
  const entry = await fs.lstat(candidatePath, { cwd: workspace.path }, signal)
  if (entry === undefined) return { ok: false, reason: 'path-absent' }
  if (entry.type === 'symlink') return { ok: false, reason: 'symlink' }
  if (entry.type !== 'file') return { ok: false, reason: 'not-regular-file' }

  const workspaceRoot = await fs.resolve(workspace.path, { signal })
  const target = await fs.resolve(candidatePath, { cwd: workspace.path, signal })
  if (!fs.contains(workspaceRoot, target)) return { ok: false, reason: 'outside-workspace' }

  const info = await fs.stat(target, signal)
  if (info === undefined) return { ok: false, reason: 'path-absent' }
  if (info.type !== 'file' || typeof info.size !== 'number' || !Number.isFinite(info.size) || info.size < 0) {
    return { ok: false, reason: 'not-regular-file' }
  }

  const relativePath = workspaceRelativePath(fs, workspaceRoot, target)
  if (relativePath === undefined) return { ok: false, reason: 'relative-path-invalid' }

  return {
    ok: true,
    workspace,
    workspaceRoot,
    target,
    version: info.version,
    size: info.size,
    relativePath,
  }
}

/**
 * Derive the workspace-relative, `/`-separated path of an authorized target
 * purely from `processPath` — never by parsing or comparing `targetKey`.
 * `targetKey` is documented as opaque (a remote backend may use a workspace URI
 * or file id, not a local absolute path), so the only trustworthy source of a
 * local path is `processPath`. We reject any result that is empty, absolute,
 * backslash-containing, drive-letter-prefixed, or that contains a `..` segment.
 * @param fs - filesystem seam.
 * @param workspaceRoot - resolved workspace root target.
 * @param target - resolved authorized target.
 * @returns the `/`-separated relative path, or `undefined` when invalid.
 */
export function workspaceRelativePath(
  fs: WorkspaceFileFsSeam,
  workspaceRoot: FsTarget,
  target: FsTarget,
): string | undefined {
  const rel = relative(fs.processPath(workspaceRoot), fs.processPath(target))
  const normalized = rel.replace(/\\/g, '/')
  if (normalized.length === 0) return undefined
  if (normalized.startsWith('/')) return undefined
  if (normalized.includes('\\')) return undefined
  if (/^[A-Za-z]:/.test(normalized)) return undefined
  for (const segment of normalized.split('/')) {
    if (segment === '..') return undefined
  }
  return normalized
}
