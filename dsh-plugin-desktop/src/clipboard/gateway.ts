/**
 * Host-side gateway for native file-manager clipboard paste: workspace
 * authorization, short-lived leases, atomic validate/release, and RPC dispatch
 * (design §6 P0-2). The gateway holds no Cordis context — narrow dependencies
 * (a filesystem seam, a workspace-list callback, an optional lineage-trace
 * callback, a native clipboard source, a platform target, a logger, and
 * validated config) are injected so the business methods are unit-testable with
 * fakes.
 *
 * Absolute candidate paths and the opaque `FsTarget`/`FsVersion` identities
 * collected during authorization stay Host-internal and never cross an RPC,
 * log, or error message: only Host-sanitized basenames, workspace-relative
 * `/`-separated paths, finite sizes, and opaque lease ids are ever returned.
 * The native clipboard is read at most once per probe RPC; the Host never polls
 * or caches clipboard state.
 * @module dsh-plugin-desktop/clipboard/gateway
 */

import { randomBytes } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { FsTarget, FsVersion } from '@deepseek-ai/dsh-fs'
import {
  parseNativeClipboard,
  type NativeClipboardSnapshot,
  type NativeClipboardTarget,
} from './native.ts'
import {
  DesktopClipboardLeaseId,
  parseProbeRequest,
  parseReleaseRequest,
  parseValidateRequest,
  type ClipboardFileDraft,
  type ClipboardProbeResult,
  type ClipboardReleaseResult,
  type ClipboardValidateResult,
} from './contract.ts'
import {
  authorizeWorkspaceFile,
  resolveWorkspaceMembership,
  type TraceSession,
  type WorkspaceAuthLogger,
  type WorkspaceFileFsSeam,
  type WorkspaceList,
} from '../workspace-file-auth.ts'

/** Validated configuration the gateway reads; never defaulted inside a method. */
export interface ClipboardGatewayConfig {
  /** Inclusive cap on the number of file candidates accepted per probe. */
  maxItems: number
  /** Inclusive cap on UTF-16 code units of any single candidate path. */
  maxPathChars: number
  /** Inclusive cap on total candidate path code units across one probe. */
  maxPayloadBytes: number
  /** Lease lifetime in milliseconds before lazy expiry. */
  leaseTtlMs: number
  /** Maximum concurrently held leases before oldest-created eviction. */
  maxLeases: number
}

/** One held lease record; FsTarget/version stay Host-side and never serialize. */
interface LeaseRecord {
  sessionId: string
  workspacePath: string
  workspaceRoot: FsTarget
  target: FsTarget
  candidatePath: string
  relativePath: string
  version: FsVersion
  size: number
  expiresAt: number
  creationSeq: number
}

/** One RPC envelope frame the dispatcher returns, error branch shaped for the
 * Connection `RpcResult` bad-request arm. */
type DispatchedRpc =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: 'bad-request'; message: string; details: { issues: never[] } } }

/**
 * Desktop native clipboard gateway. Instances are owned by a Cordis Fiber
 * effect; {@link dispose} clears every lease, after which every handler call
 * fails deterministically (disposed probe/validate are rejected; release
 * reports `released: false`).
 */
export class DesktopClipboardGateway {
  private readonly leases = new Map<string, LeaseRecord>()
  private creationSeq = 0
  private disposed = false

  constructor(
    private readonly fs: WorkspaceFileFsSeam,
    private readonly list: WorkspaceList,
    private readonly traceSession: TraceSession | undefined,
    private readonly native: () => NativeClipboardSnapshot,
    private readonly target: NativeClipboardTarget,
    private readonly logger: WorkspaceAuthLogger,
    private readonly config: ClipboardGatewayConfig,
  ) {}

  /**
   * Probe the current native clipboard once and, for a session with a resolved
   * workspace, authorize every parsed candidate path in order. The batch is
   * all-or-nothing: on any failed candidate every lease minted in this batch is
   * released and no partial result is returned. The native clipboard is read
   * exactly once per probe RPC.
   * @param sessionId - the raw session id from the wire.
   * @param signal - cancels the authorization I/O.
   * @returns `none`, `files`, or `error`.
   */
  async probe(sessionId: string, signal: AbortSignal): Promise<ClipboardProbeResult> {
    this.assertNotDisposed()
    this.purgeExpired()
    SessionId(sessionId)

    const workspace = await resolveWorkspaceMembership(
      this.list,
      sessionId,
      this.traceSession,
      signal,
      this.logger,
      'clipboard',
    )
    if (workspace === undefined) {
      return { status: 'error', code: 'no-workspace', message: 'the session has no workspace to receive file references' }
    }

    const snapshot = this.native()
    const parsed = parseNativeClipboard(snapshot, this.target, {
      maxItems: this.config.maxItems,
      maxPathChars: this.config.maxPathChars,
      maxPayloadBytes: this.config.maxPayloadBytes,
    })
    if (parsed.status === 'none') return { status: 'none' }
    if (parsed.status === 'error') return { status: 'error', code: parsed.code, message: parsed.message }
    if (parsed.files.candidates.length === 0) return { status: 'none' }

    const minted: string[] = []
    const items: ClipboardFileDraft[] = []
    for (const candidate of parsed.files.candidates) {
      const authorized = await authorizeWorkspaceFile(this.fs, workspace, candidate, signal)
      if (!authorized.ok) {
        for (const id of minted) this.leases.delete(id)
        return {
          status: 'error',
          code: 'rejected',
          message: 'one or more copied files are outside the workspace or are not regular files',
        }
      }
      const record: LeaseRecord = {
        sessionId,
        workspacePath: workspace.path,
        workspaceRoot: authorized.workspaceRoot,
        target: authorized.target,
        candidatePath: candidate,
        relativePath: authorized.relativePath,
        version: authorized.version,
        size: authorized.size,
        expiresAt: Date.now() + this.config.leaseTtlMs,
        creationSeq: this.creationSeq++,
      }
      const id = this.mintLeaseId()
      this.evictIfOverCapacity(id, record)
      minted.push(id)
      items.push({
        leaseId: id,
        name: this.sanitizeBaseName(authorized.relativePath),
        relativePath: authorized.relativePath,
        size: authorized.size,
      })
    }

    return {
      status: 'files',
      items,
      textDisposition: parsed.files.suppressText ? 'suppress' : 'preserve',
    }
  }

  /**
   * Atomically re-authorize a batch of held leases against the session's still
   * current workspace and file identities (membership, containment, final-path
   * type, version, and size). Any missing, foreign, moved, replaced, resized, or
   * divergent lease makes the whole batch stale — no partial success is ever
   * returned.
   * @param sessionId - the raw session id from the wire.
   * @param leaseIds - the held lease ids in the Client's attachment order.
   * @param signal - cancels the re-authorization I/O.
   * @returns `ok` with references in lease order, `stale`, or `error`.
   */
  async validate(sessionId: string, leaseIds: readonly string[], signal: AbortSignal): Promise<ClipboardValidateResult> {
    this.assertNotDisposed()
    this.purgeExpired()
    SessionId(sessionId)
    if (leaseIds.length === 0) return { status: 'stale' }

    const leases = leaseIds.map(id => this.leases.get(id))
    if (leases.some(lease => lease === undefined || lease.sessionId !== sessionId)) {
      return { status: 'stale' }
    }

    const workspace = await resolveWorkspaceMembership(
      this.list,
      sessionId,
      this.traceSession,
      signal,
      this.logger,
      'clipboard',
    )
    if (workspace === undefined) return { status: 'stale' }

    for (const lease of leases) {
      if (lease === undefined) return { status: 'stale' }
      if (workspace.path !== lease.workspacePath) return { status: 'stale' }
      let authorized
      try {
        authorized = await authorizeWorkspaceFile(this.fs, workspace, lease.candidatePath, signal)
      } catch {
        return { status: 'stale' }
      }
      if (!authorized.ok) return { status: 'stale' }
      if (authorized.target.targetKey !== lease.target.targetKey) return { status: 'stale' }
      if (authorized.version !== lease.version) return { status: 'stale' }
      if (authorized.size !== lease.size) return { status: 'stale' }
    }

    const references = leaseIds.map(id => ({ path: this.leases.get(id)!.relativePath }))
    return { status: 'ok', references }
  }

  /**
   * Idempotently release every lease in the batch held by the session. Leases
   * belonging to another session, unknown ids, and already-released ids are
   * harmless no-ops, so a repeated call returns `released: true` again.
   * @param sessionId - the raw session id from the wire.
   * @param leaseIds - the held lease ids to release.
   * @returns `released: false` only when the gateway is disposed globally.
   */
  release(sessionId: string, leaseIds: readonly string[]): ClipboardReleaseResult {
    this.purgeExpired()
    if (this.disposed) return { released: false }
    for (const id of leaseIds) {
      const lease = this.leases.get(id)
      if (lease !== undefined && lease.sessionId === sessionId) this.leases.delete(id)
    }
    return { released: true }
  }

  /**
   * Global teardown: clear every lease and mark the gateway disposed so all
   * further handler calls fail deterministically. Idempotent.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.leases.clear()
  }

  /**
   * RPC dispatch entry: map an endpoint to its handler with structured
   * bad-request responses for unknown endpoints and malformed payloads.
   * @param endpoint - the channel-relative endpoint name.
   * @param payload - the decoded JSON payload.
   * @param signal - cancels the request.
   * @returns the RPC envelope frame.
   */
  async dispatch(endpoint: string, payload: unknown, signal: AbortSignal): Promise<DispatchedRpc> {
    const badRequest = (message: string): DispatchedRpc => ({
      ok: false,
      error: { code: 'bad-request', message, details: { issues: [] } },
    })
    if (this.disposed) return badRequest('desktop-clipboard gateway is disposed')
    switch (endpoint) {
      case 'probe': {
        const request = parseProbeRequest(payload)
        if (!request.ok) return badRequest(request.message)
        return { ok: true, value: await this.probe(request.value.sessionId, signal) }
      }
      case 'validate': {
        const request = parseValidateRequest(payload)
        if (!request.ok) return badRequest(request.message)
        return { ok: true, value: await this.validate(request.value.sessionId, request.value.leaseIds, signal) }
      }
      case 'release': {
        const request = parseReleaseRequest(payload)
        if (!request.ok) return badRequest(request.message)
        return { ok: true, value: this.release(request.value.sessionId, request.value.leaseIds) }
      }
      default:
        return badRequest(`unknown desktop-clipboard endpoint "${endpoint}"`)
    }
  }

  /** Mint an opaque, high-entropy, URL-safe lease id (256 bit). */
  private mintLeaseId(): DesktopClipboardLeaseId {
    return DesktopClipboardLeaseId(randomBytes(32).toString('base64url'))
  }

  /** Enforce the max-leases bound, evicting the oldest-created record. */
  private evictIfOverCapacity(id: string, record: LeaseRecord): void {
    while (this.leases.size >= this.config.maxLeases) {
      let oldestKey: string | undefined
      let oldestSeq = Number.POSITIVE_INFINITY
      for (const [key, existing] of this.leases) {
        if (existing.creationSeq < oldestSeq) {
          oldestKey = key
          oldestSeq = existing.creationSeq
        }
      }
      if (oldestKey === undefined) break
      this.leases.delete(oldestKey)
    }
    this.leases.set(id, record)
  }

  /** Remove expired leases lazily before a probe/validate/release. */
  private purgeExpired(): void {
    const now = Date.now()
    for (const [key, record] of this.leases) {
      if (record.expiresAt <= now) this.leases.delete(key)
    }
  }

  /** Assert the gateway has not been disposed. */
  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('dsh-plugin-desktop: desktop clipboard gateway is disposed')
  }

  /**
   * Sanitize the basename of a workspace-relative path for display: the last
   * `/` segment with control characters (U+0000–U+001F and U+007F) stripped and
   * surrounding whitespace trimmed, falling back to `'file'` when empty.
   * @param relativePath - the validated workspace-relative path.
   * @returns a non-empty, control-free name for wire/display.
   */
  private sanitizeBaseName(relativePath: string): string {
    const index = relativePath.lastIndexOf('/')
    let base = index === -1 ? relativePath : relativePath.slice(index + 1)
    base = base.replace(/[\u0000-\u001f\u007f]/g, '').trim()
    return base.length === 0 ? 'file' : base
  }
}
