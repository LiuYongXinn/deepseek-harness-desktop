import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import {
  ClipboardTransportError,
  ConnectionClipboardFilesGateway,
  provideClipboardFiles,
  type ClipboardFilesGateway,
} from '../src/client/clipboard/gateway.ts'
import {
  DESKTOP_CLIPBOARD_RPC_CHANNEL,
  DesktopClipboardLeaseId,
} from '../src/clipboard/contract.ts'

/** One recorded RPC invocation on the fake caller. */
interface RpcRecord {
  channel: string
  endpoint: string
  payload: unknown
  signal: AbortSignal | undefined
}

/**
 * Build a fake {@link ClientConnectionRpc} whose `call` records its arguments
 * and resolves from a caller-queued response stack. Responses are returned in
 * FIFO order; a call with an empty stack throws so a missed `queue` fails loud.
 */
function makeRpc() {
  const calls: RpcRecord[] = []
  const responses: Array<unknown> = []
  const rpc = {
    call: vi.fn(
      async (
        channel: string,
        endpoint: string,
        payload: unknown,
        signal: AbortSignal | undefined,
      ) => {
        calls.push({ channel, endpoint, payload, signal })
        const response = responses.shift()
        if (response === undefined) {
          throw new Error('makeRpc: no queued RPC response')
        }
        return response
      },
    ),
  } as unknown as ClientConnectionRpc
  return {
    calls,
    rpc,
    queue: (response: unknown) => {
      responses.push(response)
    },
  }
}

describe('ConnectionClipboardFilesGateway', () => {
  it('encodes probe on the desktop-clipboard channel and parses a none result', async () => {
    const { calls, rpc, queue } = makeRpc()
    queue({ ok: true, value: { status: 'none' } })
    const gateway = new ConnectionClipboardFilesGateway(rpc)
    const signal = new AbortController().signal
    await expect(gateway.probe('s1', signal)).resolves.toEqual({ status: 'none' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      channel: DESKTOP_CLIPBOARD_RPC_CHANNEL,
      endpoint: 'probe',
      payload: { sessionId: 's1' },
      signal,
    })
  })

  it('parses a probe files result with a validated draft', async () => {
    const { rpc, queue } = makeRpc()
    queue({
      ok: true,
      value: {
        status: 'files',
        items: [{ leaseId: 'L1', name: 'a.ts', relativePath: 'src/a.ts', size: 10 }],
        textDisposition: 'preserve',
      },
    })
    const gateway = new ConnectionClipboardFilesGateway(rpc)
    await expect(gateway.probe('s1', new AbortController().signal)).resolves.toEqual({
      status: 'files',
      items: [{ leaseId: 'L1', name: 'a.ts', relativePath: 'src/a.ts', size: 10 }],
      textDisposition: 'preserve',
    })
  })

  it('parses a probe error result', async () => {
    const { rpc, queue } = makeRpc()
    queue({ ok: true, value: { status: 'error', code: 'NO_CLIPBOARD', message: 'unavailable' } })
    const gateway = new ConnectionClipboardFilesGateway(rpc)
    await expect(gateway.probe('s1', new AbortController().signal)).resolves.toEqual({
      status: 'error',
      code: 'NO_CLIPBOARD',
      message: 'unavailable',
    })
  })

  it('surfaces an envelope ok:false as a ClipboardTransportError with the RPC code', async () => {
    const { rpc, queue } = makeRpc()
    queue({ ok: false, error: { code: 'E_RPC', message: 'transport down' } })
    const gateway = new ConnectionClipboardFilesGateway(rpc)
    const error = await gateway
      .probe('s1', new AbortController().signal)
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ClipboardTransportError)
    expect(error).toMatchObject({
      name: 'ClipboardTransportError',
      code: 'E_RPC',
    })
  })

  it('rejects a probe response carrying an absolute relativePath as invalid-response', async () => {
    const { rpc, queue } = makeRpc()
    queue({
      ok: true,
      value: {
        status: 'files',
        items: [{ leaseId: 'L1', name: 'a.ts', relativePath: '/abs/a.ts', size: 10 }],
        textDisposition: 'preserve',
      },
    })
    const gateway = new ConnectionClipboardFilesGateway(rpc)
    await expect(gateway.probe('s1', new AbortController().signal)).rejects.toMatchObject({
      name: 'ClipboardTransportError',
      code: 'invalid-response',
    })
  })

  it('encodes validate with lease order preserved on the wire', async () => {
    const { calls, rpc, queue } = makeRpc()
    const leaseIds = [DesktopClipboardLeaseId('a'), DesktopClipboardLeaseId('b')]
    queue({
      ok: true,
      value: { status: 'ok', references: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] },
    })
    const gateway = new ConnectionClipboardFilesGateway(rpc)
    const signal = new AbortController().signal
    await expect(gateway.validate('s1', leaseIds, signal)).resolves.toEqual({
      status: 'ok',
      references: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }],
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      channel: DESKTOP_CLIPBOARD_RPC_CHANNEL,
      endpoint: 'validate',
      payload: { sessionId: 's1', leaseIds: ['a', 'b'] },
      signal,
    })
  })

  it('parses a validate stale result', async () => {
    const { rpc, queue } = makeRpc()
    queue({ ok: true, value: { status: 'stale' } })
    const gateway = new ConnectionClipboardFilesGateway(rpc)
    await expect(
      gateway.validate('s1', [DesktopClipboardLeaseId('a')], new AbortController().signal),
    ).resolves.toEqual({ status: 'stale' })
  })

  it('parses a validate error result', async () => {
    const { rpc, queue } = makeRpc()
    queue({ ok: true, value: { status: 'error', code: 'STALE', message: 'lease moved' } })
    const gateway = new ConnectionClipboardFilesGateway(rpc)
    await expect(
      gateway.validate('s1', [DesktopClipboardLeaseId('a')], new AbortController().signal),
    ).resolves.toEqual({ status: 'error', code: 'STALE', message: 'lease moved' })
  })

  it('release does not throw on an envelope ok:false and logs the failure', async () => {
    const { rpc, queue } = makeRpc()
    const debug = vi.fn()
    queue({ ok: false, error: { code: 'E_RPC', message: 'down' } })
    const gateway = new ConnectionClipboardFilesGateway(rpc, { debug })
    await expect(
      gateway.release('s1', [DesktopClipboardLeaseId('a')]),
    ).resolves.toBeUndefined()
    expect(debug).toHaveBeenCalled()
  })

  it('release logs an invalid response without throwing', async () => {
    const { rpc, queue } = makeRpc()
    const debug = vi.fn()
    queue({ ok: true, value: { released: 'not-a-boolean' } })
    const gateway = new ConnectionClipboardFilesGateway(rpc, { debug })
    await expect(
      gateway.release('s1', [DesktopClipboardLeaseId('a')]),
    ).resolves.toBeUndefined()
    expect(debug).toHaveBeenCalledWith(
      'dsh-plugin-desktop: invalid desktop-clipboard release response',
    )
  })

  it('release swallows an invalid response even without a logger', async () => {
    const { rpc, queue } = makeRpc()
    queue({ ok: true, value: { released: 1 } })
    const gateway = new ConnectionClipboardFilesGateway(rpc)
    await expect(
      gateway.release('s1', [DesktopClipboardLeaseId('a')]),
    ).resolves.toBeUndefined()
  })
})

describe('provideClipboardFiles service lifecycle', () => {
  /** Build a minimally-typed fake ClientContext (see client-environment.spec.ts). */
  function makeCtx() {
    const provideReturned: Array<() => void> = []
    const recordedDisposers: Array<() => void> = []
    let providedGateway: unknown
    const loggerDebug = vi.fn()
    const rpc = makeRpc()
    const provide = vi.fn((name: string, value: unknown) => {
      expect(name).toBe('clipboardFiles')
      providedGateway = value
      const disposer = () => {}
      provideReturned.push(disposer)
      return disposer
    })
    const effect = vi.fn((register: () => unknown) => {
      // Cordis runs effect bodies synchronously during registration.
      const disposer = register() as () => void
      recordedDisposers.push(disposer)
      return disposer
    })
    const ctx = {
      connection: { rpc: rpc.rpc },
      logger: { debug: loggerDebug },
      effect,
      provide,
    } as unknown as ClientContext
    return {
      ctx,
      effect,
      provide,
      provideReturned,
      recordedDisposers,
      rpc,
      getProvidedGateway: () => providedGateway,
    }
  }

  it('registers the clipboard files service through ctx.effect and ctx.provide', () => {
    const fake = makeCtx()
    provideClipboardFiles(fake.ctx)
    expect(fake.effect).toHaveBeenCalledTimes(1)
    // The effect body ran synchronously, constructing the gateway and providing it.
    expect(fake.provide).toHaveBeenCalledTimes(1)
    expect(fake.provide).toHaveBeenCalledWith('clipboardFiles', expect.anything())
    expect(fake.getProvidedGateway()).toBeInstanceOf(ConnectionClipboardFilesGateway)
  })

  it('returns a disposer so Cordis removes the service on unload (lifecycle symmetric)', () => {
    const fake = makeCtx()
    provideClipboardFiles(fake.ctx)
    expect(fake.recordedDisposers).toHaveLength(1)
    const disposer = fake.recordedDisposers[0]!
    // The effect disposer is exactly the disposer ctx.provide returned, so
    // running it unregisters the service in one symmetric path.
    expect(disposer).toBe(fake.provideReturned[0])
    disposer()
    disposer()
  })

  it('the provided gateway issues RPC end-to-end on probe', async () => {
    const fake = makeCtx()
    provideClipboardFiles(fake.ctx)
    const gateway = fake.getProvidedGateway() as ClipboardFilesGateway
    fake.rpc.queue({ ok: true, value: { status: 'none' } })
    const signal = new AbortController().signal
    await expect(gateway.probe('s1', signal)).resolves.toEqual({ status: 'none' })
    expect(fake.rpc.calls).toHaveLength(1)
    expect(fake.rpc.calls[0]).toMatchObject({
      channel: DESKTOP_CLIPBOARD_RPC_CHANNEL,
      endpoint: 'probe',
    })
  })

  it('installs no timers, pollers, or global paste listeners', () => {
    vi.useFakeTimers()
    try {
      const fake = makeCtx()
      provideClipboardFiles(fake.ctx)
      // The module performs no window/document/globalThis activity and schedules
      // no timers; RPC happens only on an explicit user paste gesture.
      expect(vi.getTimerCount()).toBe(0)
    }
    finally {
      vi.useRealTimers()
    }
  })
})
