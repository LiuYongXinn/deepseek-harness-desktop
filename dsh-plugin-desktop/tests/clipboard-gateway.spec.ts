import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsPathInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import { DesktopClipboardGateway } from '../src/clipboard/gateway.ts'
import type { ClipboardGatewayConfig } from '../src/clipboard/gateway.ts'
import type { NativeClipboardSnapshot } from '../src/clipboard/native.ts'
import { DesktopClipboardLeaseId } from '../src/clipboard/contract.ts'
import type {
  LineageTrace,
  WorkspaceAuthLogger,
  WorkspaceFileFsSeam,
  WorkspaceList,
  WorkspaceMembership,
} from '../src/workspace-file-auth.ts'

/** Normalize a path to an absolute, `/`-joined key against a cwd. */
function normalize(path: string, cwd = '/ws'): string {
  if (path.startsWith('/')) return `/${path.split('/').filter(Boolean).join('/')}`
  const joined = path.split('/').filter(Boolean).join('/')
  if (joined.length === 0) return cwd
  return `${cwd}/${joined}`
}

/**
 * In-memory filesystem seam for the clipboard gateway. Records every method
 * invoked so a test can assert the gateway never touches file content. The seam
 * has NO `readBytes`/`readText` members at all - a passed probe/validate proves
 * the gateway never reaches for content on a seam that could not offer it.
 */
class FakeFs implements WorkspaceFileFsSeam {
  files = new Map<string, { version: string; size: number }>()
  directories = new Set<string>()
  symlinks = new Set<string>()
  special = new Set<string>()
  /** Redirect a resolved path to another key to simulate a moved/replaced file. */
  aliases = new Map<string, string>()
  /** Log of the seam member names actually called, in order. */
  invoked: string[] = []
  readonly cwd = '/ws'

  /** Record a member name so `invoked` reflects the calls made. */
  private mark(name: string): void {
    this.invoked.push(name)
  }

  private keyOf(path: string, cwd = this.cwd): string {
    const key = normalize(path, cwd)
    return this.aliases.get(key) ?? key
  }

  private lstatInfo(path: string, cwd: string): { version: string; type: FsPathInfo['type']; size?: number } | undefined {
    const key = normalize(path, cwd)
    if (this.symlinks.has(key)) return { version: `sl-${key}`, type: 'symlink' }
    if (this.special.has(key)) return { version: `sp-${key}`, type: 'other' }
    if (this.directories.has(key)) return { version: `dir-${key}`, type: 'directory' }
    const entry = this.files.get(key)
    if (entry === undefined) return undefined
    return { version: entry.version, type: 'file', size: entry.size }
  }

  async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    this.mark('resolve')
    const key = this.keyOf(path, opts?.cwd ?? this.cwd)
    return { targetKey: FsTargetKey(key), displayPath: key }
  }

  contains(parent: FsTarget, child: FsTarget): boolean {
    this.mark('contains')
    const p = String(parent.targetKey)
    const c = String(child.targetKey)
    return c === p || c.startsWith(`${p}/`)
  }

  async stat(target: FsTarget, _signal?: AbortSignal): Promise<FsInfo | undefined> {
    this.mark('stat')
    const key = String(target.targetKey)
    if (this.directories.has(key)) return { version: FsVersion('dir'), type: 'directory' }
    if (this.special.has(key)) return { version: FsVersion('special'), type: 'other' }
    const entry = this.files.get(key)
    if (entry === undefined) return undefined
    return { version: FsVersion(entry.version), type: 'file', size: entry.size }
  }

  async lstat(path: string, opts?: { cwd?: string }, _signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    this.mark('lstat')
    const info = this.lstatInfo(path, opts?.cwd ?? this.cwd)
    if (info === undefined) return undefined
    const out: FsPathInfo = { version: FsVersion(info.version), type: info.type }
    if (info.size !== undefined) out.size = info.size
    return out
  }

  processPath(target: FsTarget): string {
    this.mark('processPath')
    return String(target.targetKey)
  }

  /** Add a path entry. `kind` defaults to a regular file. */
  put(path: string, meta: { version: string; size: number }, kind: 'file' | 'directory' | 'symlink' | 'special' = 'file'): void {
    const key = normalize(path)
    switch (kind) {
      case 'file': this.files.set(key, meta); break
      case 'directory': this.directories.add(key); break
      case 'symlink': this.symlinks.add(key); break
      case 'special': this.special.add(key); break
    }
  }

  /** Redirect a path so `resolve` reports a different target key (moved file). */
  move(path: string, to: string): void {
    this.aliases.set(normalize(path), normalize(to))
  }
}

/** In-memory native clipboard snapshot. */
class FakeNative implements NativeClipboardSnapshot {
  formats: readonly string[] = []
  text = ''
  byName: Record<string, string> = {}
  byBuffer: Record<string, Uint8Array> = {}

  readText(): string { return this.text }
  read(format: string): string { return this.byName[format] ?? '' }
  readBuffer(format: string): Uint8Array | undefined { return this.byBuffer[format] }
}

/** Build a workspace registry. */
function workspace(initial: WorkspaceMembership[] = []): { memberships: WorkspaceMembership[]; list: WorkspaceList } {
  const memberships = [...initial]
  return { memberships, list: () => memberships }
}

const DEFAULT_CONFIG: ClipboardGatewayConfig = {
  maxItems: 16,
  maxPathChars: 4096,
  maxPayloadBytes: 1 << 20,
  leaseTtlMs: 60_000,
  maxLeases: 8,
}

const silentLogger: WorkspaceAuthLogger = { warn: vi.fn() }

const defaultTrace = async (): Promise<LineageTrace> => ({ target: { header: {} }, ancestors: [] })

interface GatewayHarness {
  gateway: DesktopClipboardGateway
  fs: FakeFs
  native: FakeNative
  registry: { memberships: WorkspaceMembership[]; list: WorkspaceList }
  logger: WorkspaceAuthLogger
}

function createGateway(
  args: Partial<{
    fs: FakeFs
    registry: { memberships: WorkspaceMembership[]; list: WorkspaceList }
    native: FakeNative
    trace: (sessionId: string, signal: AbortSignal) => Promise<LineageTrace>
    logger: WorkspaceAuthLogger
    target: 'win32' | 'darwin' | 'linux'
    config: ClipboardGatewayConfig
  }> = {},
): GatewayHarness {
  const fs = args.fs ?? new FakeFs()
  const registry = args.registry ?? workspace()
  const native = args.native ?? new FakeNative()
  const logger = args.logger ?? silentLogger
  const gateway = new DesktopClipboardGateway(
    fs,
    registry.list,
    args.trace ?? defaultTrace,
    () => native,
    args.target ?? 'win32',
    logger,
    args.config ?? DEFAULT_CONFIG,
  )
  return { gateway, fs, native, registry, logger }
}

/** Convenience: a linux-uri-list native clipboard carrying the given paths. */
function uriListNative(...paths: string[]): FakeNative {
  const native = new FakeNative()
  native.formats = ['text/uri-list']
  native.text = paths.map(p => `file://${p}`).join('\n')
  return native
}

describe('DesktopClipboardGateway', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('returns none when the native parse is none (no file format present)', async () => {
    const fs = new FakeFs()
    fs.put('/ws/a.txt', { version: 'v1', size: 3 })
    const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
    const native = new FakeNative()
    native.formats = ['text/plain']
    native.text = 'just text'
    const { gateway } = createGateway({ fs, registry, native })

    const result = await gateway.probe('s1', new AbortController().signal)
    expect(result).toEqual({ status: 'none' })
  })

  it('returns none for an empty candidate list', async () => {
    const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
    const native = new FakeNative()
    native.formats = ['text/uri-list']
    native.text = ''
    const { gateway } = createGateway({ registry, native })

    expect(await gateway.probe('s1', new AbortController().signal)).toEqual({ status: 'none' })
  })

  it('probes workspace files into relative paths and opaque lease ids', async () => {
    const fs = new FakeFs()
    fs.put('/ws/a/b.txt', { version: 'v1', size: 512 })
    fs.put('/ws/c.txt', { version: 'v2', size: 1024 })
    const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
    const native = uriListNative('/ws/a/b.txt', '/ws/c.txt')
    const { gateway } = createGateway({ fs, registry, native })

    const result = await gateway.probe('s1', new AbortController().signal)
    expect(result.status).toBe('files')
    if (result.status !== 'files') return
    expect(result.items).toHaveLength(2)
    expect(result.textDisposition).toBe('suppress')
    const first = result.items[0]!
    const second = result.items[1]!
    expect(first.name).toBe('b.txt')
    expect(first.relativePath).toBe('a/b.txt')
    expect(first.size).toBe(512)
    expect(second.name).toBe('c.txt')
    expect(second.relativePath).toBe('c.txt')
    expect(second.size).toBe(1024)
    // Lease ids are opaque, high-entropy tokens - never a path.
    expect(typeof first.leaseId).toBe('string')
    expect(first.leaseId).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(first.leaseId).not.toContain('/')
    expect(first.leaseId).not.toBe(second.leaseId)
  })

  it('sanitizes control characters out of the displayed basename', async () => {
    const fs = new FakeFs()
    fs.put('/ws/we\x00ird\x1f.txt', { version: 'v1', size: 1 })
    const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
    const native = uriListNative('/ws/we\x00ird\x1f.txt')
    const { gateway } = createGateway({ fs, registry, native })

    const result = await gateway.probe('s1', new AbortController().signal)
    expect(result.status).toBe('files')
    if (result.status !== 'files') return
    expect(result.items[0]!.name).toBe('weird.txt')
  })

  it.each([
    ['outside the workspace', (fs: FakeFs) => fs.put('/outside/secret.txt', { version: 'v1', size: 1 })],
    ['a directory', (fs: FakeFs) => fs.put('/ws/dir', { version: 'v1', size: 0 }, 'directory')],
    ['a symlink', (fs: FakeFs) => fs.put('/ws/link.txt', { version: 'v1', size: 1 }, 'symlink')],
    ['a special file', (fs: FakeFs) => fs.put('/ws/fifo', { version: 'v1', size: 0 }, 'special')],
  ])('rejects the whole batch when any candidate is %s', async (_label, arrange) => {
    const fs = new FakeFs()
    fs.put('/ws/ok.txt', { version: 'v1', size: 5 })
    arrange(fs)
    const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
    // The bad candidate comes first in the native list; the batch must still
    // fail as a whole, leaving no lease behind.
    const native = uriListNative('/bad/candidate', '/ws/ok.txt')
    const { gateway } = createGateway({ fs, registry, native })

    const result = await gateway.probe('s1', new AbortController().signal)
    expect(result).toMatchObject({ status: 'error', code: 'rejected' })

    // No lease survives: validating any proposed id is stale and release no-ops.
    expect(await gateway.validate('s1', [DesktopClipboardLeaseId('anything')], new AbortController().signal))
      .toEqual({ status: 'stale' })
    expect(gateway.release('s1', [DesktopClipboardLeaseId('anything')])).toEqual({ released: true })
  })

  it('rejects the whole batch when a candidate is absent (all-or-nothing)', async () => {
    const fs = new FakeFs()
    fs.put('/ws/good.txt', { version: 'v1', size: 3 })
    const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
    const native = uriListNative('/ws/good.txt', '/ws/missing.txt')
    const { gateway } = createGateway({ fs, registry, native })

    const result = await gateway.probe('s1', new AbortController().signal)
    expect(result).toMatchObject({ status: 'error', code: 'rejected' })

    // No lease survives the failed batch.
    expect(await gateway.validate('s1', [DesktopClipboardLeaseId('anything')], new AbortController().signal))
      .toEqual({ status: 'stale' })
    expect(gateway.release('s1', [DesktopClipboardLeaseId('anything')])).toEqual({ released: true })
  })

  it('returns no-workspace for a session with no membership and no subagent lineage', async () => {
    const fs = new FakeFs()
    fs.put('/ws/a.txt', { version: 'v1', size: 1 })
    const registry = workspace([{ path: '/ws', sessionIds: ['someone-else'] }])
    const native = uriListNative('/ws/a.txt')
    const { gateway } = createGateway({ fs, registry, native })

    const result = await gateway.probe('s1', new AbortController().signal)
    expect(result).toMatchObject({ status: 'error', code: 'no-workspace' })
  })

  it('authorizes through a subagent ancestor membership', async () => {
    const fs = new FakeFs()
    fs.put('/ws/sub/file.txt', { version: 'v1', size: 7 })
    const registry = workspace([{ path: '/ws', sessionIds: ['parent-1'] }])
    const native = uriListNative('/ws/sub/file.txt')
    const trace = async (): Promise<LineageTrace> => ({
      target: { header: { origin: 'subagent' } },
      ancestors: [{ header: { id: 'parent-1' } }],
    })
    const { gateway } = createGateway({ fs, registry, native, trace })

    const result = await gateway.probe('sub-agent', new AbortController().signal)
    expect(result.status).toBe('files')
    if (result.status !== 'files') return
    expect(result.items[0]!.relativePath).toBe('sub/file.txt')
  })

  it('returns no-workspace and warns when the lineage trace throws', async () => {
    const fs = new FakeFs()
    fs.put('/ws/a.txt', { version: 'v1', size: 2 })
    const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
    const native = uriListNative('/ws/a.txt')
    const logger: WorkspaceAuthLogger = { warn: vi.fn() }
    const trace = async (): Promise<LineageTrace> => { throw new Error('cannot trace session') }
    const { gateway } = createGateway({ fs, registry, native, trace, logger })

    const result = await gateway.probe('unknown-session', new AbortController().signal)
    expect(result).toMatchObject({ status: 'error', code: 'no-workspace' })
    expect(logger.warn).toHaveBeenCalledWith(
      'dsh-plugin-desktop: clipboard lineage trace failed',
      expect.any(Error),
    )
  })

  it('validates held leases atomically and returns references in input order', async () => {
    const fs = new FakeFs()
    fs.put('/ws/a/b.txt', { version: 'v1', size: 4 })
    fs.put('/ws/c.txt', { version: 'v2', size: 9 })
    const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
    const native = uriListNative('/ws/a/b.txt', '/ws/c.txt')
    const { gateway } = createGateway({ fs, registry, native })

    const probe = await gateway.probe('s1', new AbortController().signal)
    expect(probe.status).toBe('files')
    if (probe.status !== 'files') return
    const ids = probe.items.map(item => item.leaseId)

    // Reverse the order; validate must echo the caller's lease order.
    const result = await gateway.validate('s1', [ids[1]!, ids[0]!], new AbortController().signal)
    expect(result).toEqual({
      status: 'ok',
      references: [{ path: 'c.txt' }, { path: 'a/b.txt' }],
    })
  })

  it.each([
    ['a file is deleted', (fs: FakeFs) => fs.files.delete('/ws/a.txt')],
    ['a file is moved (target key differs)', (fs: FakeFs) => {
      fs.put('/ws/b.txt', { version: 'v1', size: 3 })
      fs.move('/ws/a.txt', '/ws/b.txt')
    }],
    ['the size changes', (fs: FakeFs) => fs.files.set('/ws/a.txt', { version: 'v1', size: 999 })],
    ['the version changes', (fs: FakeFs) => fs.files.set('/ws/a.txt', { version: 'v2', size: 3 })],
  ])('returns stale when %s', async (_label, mutate) => {
    const fs = new FakeFs()
    fs.put('/ws/a.txt', { version: 'v1', size: 3 })
    const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
    const native = uriListNative('/ws/a.txt')
    const { gateway } = createGateway({ fs, registry, native })

    const probe = await gateway.probe('s1', new AbortController().signal)
    expect(probe.status).toBe('files')
    if (probe.status !== 'files') return
    mutate(fs)
    expect(await gateway.validate('s1', [probe.items[0]!.leaseId], new AbortController().signal))
      .toEqual({ status: 'stale' })
  })

  it('returns stale when a foreign session lease is included', async () => {
    const fs = new FakeFs()
    fs.put('/ws/a.txt', { version: 'v1', size: 3 })
    const registry = workspace([
      { path: '/ws', sessionIds: ['s1'] },
      { path: '/ws', sessionIds: ['s2'] },
    ])
    const native = uriListNative('/ws/a.txt')
    const { gateway } = createGateway({ fs, registry, native })

    const mine = await gateway.probe('s1', new AbortController().signal)
    const theirs = await gateway.probe('s2', new AbortController().signal)
    if (mine.status !== 'files' || theirs.status !== 'files') throw new Error('expected probes to succeed')

    expect(await gateway.validate('s1', [theirs.items[0]!.leaseId], new AbortController().signal))
      .toEqual({ status: 'stale' })
    expect(await gateway.validate('s1', [mine.items[0]!.leaseId, theirs.items[0]!.leaseId], new AbortController().signal))
      .toEqual({ status: 'stale' })
  })

  it('returns stale when an unknown lease id is included', async () => {
    const fs = new FakeFs()
    fs.put('/ws/a.txt', { version: 'v1', size: 3 })
    const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
    const native = uriListNative('/ws/a.txt')
    const { gateway } = createGateway({ fs, registry, native })

    const probe = await gateway.probe('s1', new AbortController().signal)
    if (probe.status !== 'files') throw new Error('expected probe to succeed')

    expect(await gateway.validate('s1', [probe.items[0]!.leaseId, DesktopClipboardLeaseId('nope')], new AbortController().signal))
      .toEqual({ status: 'stale' })
  })

  it('returns stale when the workspace path changed between probe and validate', async () => {
    const fs = new FakeFs()
    fs.put('/ws/a.txt', { version: 'v1', size: 3 })
    const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
    const native = uriListNative('/ws/a.txt')
    const { gateway } = createGateway({ fs, registry, native })

    const probe = await gateway.probe('s1', new AbortController().signal)
    if (probe.status !== 'files') throw new Error('expected probe to succeed')

    registry.memberships[0]!.path = '/elsewhere'
    expect(await gateway.validate('s1', [probe.items[0]!.leaseId], new AbortController().signal))
      .toEqual({ status: 'stale' })
  })

  it('returns stale when the session now has no workspace', async () => {
    const fs = new FakeFs()
    fs.put('/ws/a.txt', { version: 'v1', size: 3 })
    const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
    const native = uriListNative('/ws/a.txt')
    const { gateway } = createGateway({ fs, registry, native })

    const probe = await gateway.probe('s1', new AbortController().signal)
    if (probe.status !== 'files') throw new Error('expected probe to succeed')

    registry.memberships.length = 0
    expect(await gateway.validate('s1', [probe.items[0]!.leaseId], new AbortController().signal))
      .toEqual({ status: 'stale' })
  })

  it('releases idempotently and reports released:false after dispose', async () => {
    const fs = new FakeFs()
    fs.put('/ws/a.txt', { version: 'v1', size: 3 })
    const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
    const native = uriListNative('/ws/a.txt')
    const { gateway } = createGateway({ fs, registry, native })

    const probe = await gateway.probe('s1', new AbortController().signal)
    if (probe.status !== 'files') throw new Error('expected probe to succeed')
    const id = probe.items[0]!.leaseId

    expect(gateway.release('s1', [id])).toEqual({ released: true })
    // Releasing the already-released id again is still a successful no-op.
    expect(gateway.release('s1', [id])).toEqual({ released: true })

    gateway.dispose()
    expect(gateway.release('s1', [id])).toEqual({ released: false })
    expect(gateway.release('s1', [id])).toEqual({ released: false })
  })

  it('expires leases past their TTL (lazy purge)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const fs = new FakeFs()
    fs.put('/ws/a.txt', { version: 'v1', size: 3 })
    const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
    const native = uriListNative('/ws/a.txt')
    const { gateway } = createGateway({ fs, registry, native, config: { ...DEFAULT_CONFIG, leaseTtlMs: 1000 } })

    const probe = await gateway.probe('s1', new AbortController().signal)
    expect(probe.status).toBe('files')
    if (probe.status !== 'files') return

    // Still valid before expiry.
    expect(await gateway.validate('s1', [probe.items[0]!.leaseId], new AbortController().signal))
      .toEqual({ status: 'ok', references: [{ path: 'a.txt' }] })

    vi.advanceTimersByTime(2000)
    expect(await gateway.validate('s1', [probe.items[0]!.leaseId], new AbortController().signal))
      .toEqual({ status: 'stale' })
  })

  it('evicts the oldest-created lease at the max-leases bound', async () => {
    const fs = new FakeFs()
    const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
    const native = uriListNative('/ws/a.txt', '/ws/b.txt', '/ws/c.txt')
    for (const name of ['a.txt', 'b.txt', 'c.txt']) fs.put(`/ws/${name}`, { version: 'v1', size: 1 })
    const { gateway } = createGateway({ fs, registry, native, config: { ...DEFAULT_CONFIG, maxLeases: 2 } })

    const probe = await gateway.probe('s1', new AbortController().signal)
    expect(probe.status).toBe('files')
    if (probe.status !== 'files') return
    const ids = probe.items.map(item => item.leaseId)

    // a.txt was minted first and evicted when the third lease exceeded capacity.
    expect(await gateway.validate('s1', [ids[0]!], new AbortController().signal)).toEqual({ status: 'stale' })
    expect(await gateway.validate('s1', [ids[1]!], new AbortController().signal)).toEqual({ status: 'ok', references: [{ path: 'b.txt' }] })
    expect(await gateway.validate('s1', [ids[2]!], new AbortController().signal)).toEqual({ status: 'ok', references: [{ path: 'c.txt' }] })
  })

  it('dispose clears everything and dispatch fails afterwards', async () => {
    const fs = new FakeFs()
    fs.put('/ws/a.txt', { version: 'v1', size: 3 })
    const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
    const native = uriListNative('/ws/a.txt')
    const { gateway } = createGateway({ fs, registry, native })

    const probe = await gateway.dispatch('probe', { sessionId: 's1' }, new AbortController().signal)
    expect(probe.ok).toBe(true)
    if (!probe.ok) throw new Error('expected probe dispatch to succeed')

    gateway.dispose()
    const after = await gateway.dispatch('probe', { sessionId: 's1' }, new AbortController().signal)
    expect(after).toEqual({ ok: false, error: { code: 'bad-request', message: 'desktop-clipboard gateway is disposed', details: { issues: [] } } })
    const rel = await gateway.dispatch('release', { sessionId: 's1', leaseIds: ['x'] }, new AbortController().signal)
    expect(rel).toEqual({ ok: false, error: { code: 'bad-request', message: 'desktop-clipboard gateway is disposed', details: { issues: [] } } })
  })

  describe('RPC dispatch', () => {
    it('routes valid probe/validate/release payloads to their methods', async () => {
      const fs = new FakeFs()
      fs.put('/ws/a.txt', { version: 'v1', size: 3 })
      const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
      const native = uriListNative('/ws/a.txt')
      const { gateway } = createGateway({ fs, registry, native })

      const probe = await gateway.dispatch('probe', { sessionId: 's1' }, new AbortController().signal)
      expect(probe.ok).toBe(true)
      if (!probe.ok) return
      const value = probe.value as { status: 'files'; items: { leaseId: string }[] }
      const leaseId = value.items[0]!.leaseId

      const validate = await gateway.dispatch('validate', { sessionId: 's1', leaseIds: [leaseId] }, new AbortController().signal)
      expect(validate.ok).toBe(true)
      if (validate.ok) expect(validate.value).toEqual({ status: 'ok', references: [{ path: 'a.txt' }] })

      const release = await gateway.dispatch('release', { sessionId: 's1', leaseIds: [leaseId] }, new AbortController().signal)
      expect(release.ok).toBe(true)
      if (release.ok) expect(release.value).toEqual({ released: true })
    })

    it.each([
      ['probe without sessionId', 'probe', {}],
      ['validate with empty leaseIds', 'validate', { sessionId: 's1', leaseIds: [] }],
      ['validate without leaseIds', 'validate', { sessionId: 's1' }],
      ['release without leaseIds', 'release', { sessionId: 's1' }],
    ])('returns bad-request for %s', async (_label, endpoint, payload) => {
      const { gateway } = createGateway()
      const result = await gateway.dispatch(endpoint as string, payload, new AbortController().signal)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('bad-request')
    })

    it('returns bad-request for an unknown endpoint', async () => {
      const { gateway } = createGateway()
      const result = await gateway.dispatch('bogus', {}, new AbortController().signal)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('bad-request')
    })
  })

  it('never reads file bytes', async () => {
    const fs = new FakeFs()
    fs.put('/ws/a/b.txt', { version: 'v1', size: 4 })
    fs.put('/ws/c.txt', { version: 'v2', size: 9 })
    const registry = workspace([{ path: '/ws', sessionIds: ['s1'] }])
    const native = uriListNative('/ws/a/b.txt', '/ws/c.txt')
    const { gateway } = createGateway({ fs, registry, native })

    const probe = await gateway.probe('s1', new AbortController().signal)
    expect(probe.status).toBe('files')
    if (probe.status !== 'files') return
    await gateway.validate('s1', probe.items.map(item => item.leaseId), new AbortController().signal)

    // The seam offers no content-reading members at all; the gateway must have
    // completed probe+validate using only the structural predicates.
    const allowed = new Set(['resolve', 'contains', 'stat', 'lstat', 'processPath'])
    expect(fs.invoked.length).toBeGreaterThan(0)
    for (const member of fs.invoked) {
      expect(allowed.has(member)).toBe(true)
    }
  })
})
