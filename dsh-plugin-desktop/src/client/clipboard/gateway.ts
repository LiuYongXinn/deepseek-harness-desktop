/**
 * Browser Client gateway for the native file-manager clipboard capability. Thin
 * adapter over the loopback Connection RPC caller that issues the three
 * desktop-clipboard endpoints (`probe`, `validate`, `release`) and validates
 * every wire response against the shared clipboard contract parsers so upstream
 * consumers never trust an `unknown` payload (design §3.3, §6 P0-4 "Client
 * Gateway"). Holds no React state and installs no timers, pollers, or global
 * paste listeners; the only injected dependency is the generic RPC caller plus
 * an optional debug logger. Absolute file paths never cross this boundary — the
 * Host resolves the current native clipboard and hands back opaque lease ids
 * and workspace-relative paths only.
 * @module dsh-plugin-desktop/client/clipboard/gateway
 */

import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '../contracts.ts'
import {
  DESKTOP_CLIPBOARD_PROBE,
  DESKTOP_CLIPBOARD_RELEASE,
  DESKTOP_CLIPBOARD_RPC_CHANNEL,
  DESKTOP_CLIPBOARD_VALIDATE,
  parseProbeResult,
  parseReleaseResult,
  parseValidateResult,
  type ClipboardProbeRequest,
  type ClipboardProbeResult,
  type ClipboardReleaseRequest,
  type ClipboardValidateRequest,
  type ClipboardValidateResult,
  type DesktopClipboardLeaseId,
} from '../../clipboard/contract.ts'

/**
 * Error thrown when the outer RPC envelope reports a transport, payload, or
 * handler failure, or when a response fails wire validation. Carries the
 * machine code and a human message so upstream consumers can surface a paste
 * error.
 */
export class ClipboardTransportError extends Error {
  /** Machine-readable error code (an RPC code or `invalid-response`). */
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ClipboardTransportError'
    this.code = code
  }
}

/** Optional debug logger for best-effort operations such as `release`. */
export interface ClipboardDebugLogger {
  debug(message: unknown, ...args: unknown[]): void
}

/** Narrow gateway surface upstream consumers (and fakes) depend on (§6 P0-4). */
export interface ClipboardFilesGateway {
  probe(sessionId: string, signal: AbortSignal): Promise<ClipboardProbeResult>
  validate(
    sessionId: string,
    leaseIds: readonly DesktopClipboardLeaseId[],
    signal: AbortSignal,
  ): Promise<ClipboardValidateResult>
  release(sessionId: string, leaseIds: readonly DesktopClipboardLeaseId[]): Promise<void>
}

/**
 * Client gateway that encodes each call as a Connection RPC request and decodes
 * the response through the shared contract. Aborts and RPC `ok:false` envelope
 * failures surface as thrown errors; business `status` arms come back
 * untouched. `release` is best-effort so a tidy-up path never interferes with
 * the paste the user is currently composing.
 */
export class ConnectionClipboardFilesGateway implements ClipboardFilesGateway {
  constructor(
    private readonly rpc: ClientConnectionRpc,
    private readonly logger: ClipboardDebugLogger | undefined = undefined,
  ) {}

  /**
   * Probe the current native clipboard for a session-owned file list.
   * @param sessionId - current session identity.
   * @param signal - caller cancellation.
   * @returns the validated probe result (`none`, `files`, or `error`).
   */
  async probe(sessionId: string, signal: AbortSignal): Promise<ClipboardProbeResult> {
    const payload: ClipboardProbeRequest = { sessionId }
    const envelope = await this.call(DESKTOP_CLIPBOARD_PROBE, payload, signal)
    const result = parseProbeResult(envelope)
    if (result === undefined) {
      throw new ClipboardTransportError('invalid-response', 'invalid desktop-clipboard probe response')
    }
    return result
  }

  /**
   * Atomically re-authorize a batch of held file leases.
   * @param sessionId - current session identity.
   * @param leaseIds - opaque Host-minted lease ids, order preserved on the wire.
   * @param signal - caller cancellation.
   * @returns the validated validate result (`ok`, `stale`, or `error`).
   */
  async validate(
    sessionId: string,
    leaseIds: readonly DesktopClipboardLeaseId[],
    signal: AbortSignal,
  ): Promise<ClipboardValidateResult> {
    const payload: ClipboardValidateRequest = { sessionId, leaseIds }
    const envelope = await this.call(DESKTOP_CLIPBOARD_VALIDATE, payload, signal)
    const result = parseValidateResult(envelope)
    if (result === undefined) {
      throw new ClipboardTransportError('invalid-response', 'invalid desktop-clipboard validate response')
    }
    return result
  }

  /**
   * Idempotently release a batch of held file leases. Best-effort: a transport
   * or parse failure is logged and swallowed so a tidy-up path never interferes
   * with the paste the user is currently composing.
   * @param sessionId - current session identity.
   * @param leaseIds - opaque Host-minted lease ids being released.
   */
  async release(sessionId: string, leaseIds: readonly DesktopClipboardLeaseId[]): Promise<void> {
    const payload: ClipboardReleaseRequest = { sessionId, leaseIds }
    try {
      const envelope = await this.call(DESKTOP_CLIPBOARD_RELEASE, payload, undefined)
      if (parseReleaseResult(envelope) === undefined) {
        this.logger?.debug('dsh-plugin-desktop: invalid desktop-clipboard release response')
      }
    } catch (error) {
      this.logger?.debug('dsh-plugin-desktop: desktop-clipboard release failed', error)
    }
  }

  /**
   * Perform one generic Connection RPC call and surface an envelope failure as
   * a {@link ClipboardTransportError}. Abort signals propagate: the caller
   * detects an AbortError by name and treats it as cancellation rather than a
   * paste error.
   * @param endpoint - channel-relative endpoint.
   * @param payload - channel-owned request payload.
   * @param signal - optional caller cancellation.
   * @returns the response value when the envelope reports success.
   */
  private async call(
    endpoint: string,
    payload: unknown,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    const envelope = await this.rpc.call(DESKTOP_CLIPBOARD_RPC_CHANNEL, endpoint, payload, signal)
    if (!envelope.ok) {
      throw new ClipboardTransportError(envelope.error.code, envelope.error.message)
    }
    return envelope.value
  }
}

/**
 * Provide the optional native file-manager clipboard service for one
 * plugin-fiber lifetime. Registers the {@link ClipboardFilesGateway} as a
 * Cordis service in every Desktop mode (compatibility and advanced) and removes
 * it on the owning effect's disposal. No timers, pollers, or global paste
 * listeners are installed; RPC takes place only on an explicit user paste
 * gesture. Normal-web bundles without the Desktop client never load this
 * module, so `ctx.get('clipboardFiles')` returns `undefined` there.
 * @param ctx - active browser Cordis context.
 */
export function provideClipboardFiles(ctx: ClientContext): void {
  ctx.effect(
    () => {
      const gateway = new ConnectionClipboardFilesGateway(ctx.connection.rpc, {
        debug: ctx.logger.debug.bind(ctx.logger),
      })
      return ctx.provide('clipboardFiles', gateway)
    },
    'desktop: clipboard files optional service',
  )
}
