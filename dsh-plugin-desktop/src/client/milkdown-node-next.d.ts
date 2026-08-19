/* Milkdown 7.22.1 publishes extensionless declaration barrels that NodeNext cannot follow. */
declare module '@milkdown/core' {
  import type { Ctx, MilkdownPlugin, SliceType } from '@milkdown/ctx'
  import type { EditorView } from '@milkdown/prose/view'

  export type Cmd<T = undefined> = (payload?: T) => import('@milkdown/prose/state').Command
  export type CmdKey<T = undefined> = SliceType<Cmd<T>>
  export interface CommandManager {
    call<T>(slice: CmdKey<T>, payload?: T): boolean
  }
  export const commandsCtx: SliceType<CommandManager, 'commands'>
  export const defaultValueCtx: SliceType<string | { type: 'html'; dom: HTMLElement } | { type: 'json'; value: Record<string, unknown> }, 'defaultValue'>
  export const editorViewCtx: SliceType<EditorView, 'editorView'>
  export const rootCtx: SliceType<Node | undefined | null | string, 'root'>
  export type Config = (ctx: Ctx) => void
  export class Editor {
    static make(): Editor
    get ctx(): Ctx
    get status(): 'Idle' | 'OnCreate' | 'Created' | 'OnDestroy' | 'Destroyed'
    config(configure: Config): this
    use(plugins: MilkdownPlugin | MilkdownPlugin[]): this
    create(): Promise<Editor>
    destroy(clearPlugins?: boolean): Promise<Editor>
    action<T>(action: (ctx: Ctx) => T): T
  }
}

declare module '@milkdown/ctx' {
  export interface SliceType<T, N extends string = string> {
    readonly id: symbol
    readonly name: N
  }
  export interface Ctx {
    get<T, N extends string>(sliceType: SliceType<T, N> | N): T
    set<T, N extends string>(sliceType: SliceType<T, N> | N, value: T): void
  }
  export type MilkdownPlugin = (ctx: Ctx) => Promise<void> | void
}

declare module '@milkdown/preset-commonmark' {
  import type { CmdKey } from '@milkdown/core'
  import type { MilkdownPlugin } from '@milkdown/ctx'
  export interface UpdateLinkCommandPayload { href?: string; title?: string }
  export const commonmark: MilkdownPlugin[]
  export const createCodeBlockCommand: { key: CmdKey<unknown> }
  export const toggleEmphasisCommand: { key: CmdKey<unknown> }
  export const toggleInlineCodeCommand: { key: CmdKey<unknown> }
  export const toggleLinkCommand: { key: CmdKey<UpdateLinkCommandPayload> }
  export const toggleStrongCommand: { key: CmdKey<unknown> }
  export const turnIntoTextCommand: { key: CmdKey<unknown> }
  export const wrapInBlockquoteCommand: { key: CmdKey<unknown> }
  export const wrapInBulletListCommand: { key: CmdKey<unknown> }
  export const wrapInHeadingCommand: { key: CmdKey<number> }
  export const wrapInOrderedListCommand: { key: CmdKey<unknown> }
}

declare module '@milkdown/plugin-history' {
  import type { CmdKey } from '@milkdown/core'
  import type { MilkdownPlugin } from '@milkdown/ctx'
  export const history: MilkdownPlugin[]
  export const undoCommand: { key: CmdKey<unknown> }
  export const redoCommand: { key: CmdKey<unknown> }
}

declare module '@milkdown/plugin-listener' {
  import type { Ctx, MilkdownPlugin, SliceType } from '@milkdown/ctx'
  export interface ListenerManager {
    markdownUpdated(fn: (ctx: Ctx, markdown: string, prevMarkdown: string) => void): this
  }
  export const listenerCtx: SliceType<ListenerManager, string>
  export const listener: MilkdownPlugin
}
