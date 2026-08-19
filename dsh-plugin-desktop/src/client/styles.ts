import {
  MACOS_DRAG_REGION_HEIGHT,
  MACOS_TITLEBAR_HEIGHT,
  MACOS_TRAFFIC_LIGHT_SAFE_WIDTH,
  WINDOWS_CAPTION_CONTROLS_WIDTH,
  WINDOWS_TITLEBAR_HEIGHT,
} from '../window-chrome.ts'
import { SIDEBAR_COLLAPSED } from './layout-state.ts'

/** Advanced-shell stylesheet kept as a plain string so the package client bundle stays self-contained. */
const ADVANCED_STYLES = `
html, body, #root { width: 100%; height: 100%; }
body[data-dsh-desktop-mode="advanced"] { margin: 0; background: transparent !important; }
.dshDesktopFrame { position: relative; display: grid; grid-template-rows: 100%; width: 100%; height: 100%; overflow: hidden; background: transparent; }
.dshDesktopSidebarSurface { --dsw-specific-sidebar-fill: transparent; position: relative; grid-column: 1; grid-row: 1; min-width: 0; overflow: hidden; background: transparent; border-right: 1px solid var(--dsw-alias-border-l1); }
.dshDesktopUpstreamSidebar { box-sizing: border-box; width: 100%; height: 100%; }
.dshDesktopFrame[data-desktop-platform="darwin"] .dshDesktopUpstreamSidebar { padding-top: ${MACOS_TITLEBAR_HEIGHT}px; -webkit-app-region: no-drag; }
.dshDesktopFrame[data-desktop-platform="darwin"][data-sidebar-collapsed] .dshDesktopUpstreamSidebar { width: ${SIDEBAR_COLLAPSED}px; margin: 0 auto; }
.dshDesktopFrame[data-desktop-platform="darwin"] { grid-template-rows: ${MACOS_TITLEBAR_HEIGHT}px minmax(0, 1fr); }
.dshDesktopFrame[data-desktop-platform="darwin"] .dshDesktopSidebarSurface { grid-row: 1 / -1; -webkit-app-region: no-drag; }
.dshDesktopFrame[data-desktop-platform="darwin"] .dshDesktopConversationSurface,
.dshDesktopFrame[data-desktop-platform="darwin"] .dshDesktopDetailsSurface { grid-row: 2; }
.dshDesktopFrame[data-desktop-platform="darwin"] .dshDesktopSidebarSurface::before { content: ""; position: absolute; top: 0; right: 0; left: ${MACOS_TRAFFIC_LIGHT_SAFE_WIDTH}px; height: ${MACOS_DRAG_REGION_HEIGHT}px; user-select: none; -webkit-app-region: drag; }
.dshDesktopMacCaptionRow { position: relative; grid-column: 2 / -1; grid-row: 1; min-width: 0; background: var(--dsw-alias-bg-base); }
.dshDesktopMacCaptionRow::before { content: ""; position: absolute; top: 0; right: 0; left: 0; height: ${MACOS_DRAG_REGION_HEIGHT}px; user-select: none; -webkit-app-region: drag; }
.dshDesktopConversationSurface { grid-column: 2; grid-row: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--dsw-alias-bg-base); }
.dshDesktopDetailsSurface { grid-column: 3; grid-row: 1; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-base); border-left: 1px solid var(--dsw-alias-border-l2); }
.dshDesktopConversationDetailsSurface, .dshDesktopFilePreviewSurface { box-sizing: border-box; width: 100%; height: 100%; min-height: 0; overflow: hidden; }
.dshDesktopDetailsSurface [hidden] { display: none; }
.dshDesktopFrame[data-desktop-platform="win32"] { grid-template-rows: ${WINDOWS_TITLEBAR_HEIGHT}px minmax(0, 1fr); }
.dshDesktopFrame[data-desktop-platform="win32"] .dshDesktopSidebarSurface { grid-row: 1 / -1; }
.dshDesktopFrame[data-desktop-platform="win32"] .dshDesktopConversationSurface,
.dshDesktopFrame[data-desktop-platform="win32"] .dshDesktopDetailsSurface { grid-row: 2; }
.dshDesktopWindowsCaptionRow { position: relative; grid-column: 2 / -1; grid-row: 1; min-width: 0; background: var(--dsw-alias-bg-base); }
.dshDesktopWindowsCaptionRow::before { content: ""; position: absolute; inset: 0 ${WINDOWS_CAPTION_CONTROLS_WIDTH}px 0 0; user-select: none; -webkit-app-region: drag; }
.dshDesktopFrame[data-sidebar-collapsed] { transition: grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dshDesktopOverlay { position: absolute; z-index: 1000; inset: 0; pointer-events: none; }
.dshDesktopOverlay > * { pointer-events: auto; }
.dshDesktopResizeHandle { position: absolute; z-index: 50; top: 0; bottom: 0; width: 8px; margin-left: -4px; cursor: col-resize; touch-action: none; -webkit-app-region: no-drag; }
.dshDesktopNoDrag, button, input, textarea, select, a, [role="button"], [role="dialog"], [role="presentation"] { -webkit-app-region: no-drag; }
[role="dialog"], [aria-modal="true"] { -webkit-app-region: no-drag !important; }
html:has([aria-modal="true"]) .dshDesktopWindowsCaptionRow::before,
html:has([aria-modal="true"]) .dshDesktopMacCaptionRow::before,
html:has([aria-modal="true"]) .dshDesktopSidebarSurface,
html:has([aria-modal="true"]) .dshDesktopSidebarSurface::before { -webkit-app-region: no-drag !important; }
.dshDesktopFilePreviewPanel { box-sizing: border-box; width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); }
.dshDesktopFileHeader { flex: 0 0 auto; padding: 10px 12px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.dshDesktopFileTitle { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-primary); }
.dshDesktopFilePath { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; color: var(--dsw-alias-label-tertiary); font-size: 12px; margin-top: 2px; }
.dshDesktopFileActions { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; margin-left: auto; }
.dshDesktopSaveStatus { min-width: 42px; color: var(--dsw-alias-label-tertiary); font-size: 12px; white-space: nowrap; }
.dshDesktopSaveStatus.error { color: var(--dsw-alias-state-error-primary); }
.dshDesktopSaveButton { border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 3px 9px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: pointer; }
.dshDesktopSaveButton:disabled { opacity: 0.5; cursor: default; }
.dshDesktopConflictBar { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); font-size: 13px; }
.dshDesktopConflictActions { display: flex; flex-wrap: wrap; gap: 6px; }
.dshDesktopConflictActions button { border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 4px 8px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; }
.dshDesktopIconButton { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: none; border-radius: 50%; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dshDesktopIconButton:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshDesktopFileContent { flex: 1 1 auto; min-height: 0; min-width: 0; max-width: 100%; overflow: auto; }
.dshDesktopScrollSurface { height: 100%; min-height: 0; min-width: 0; max-width: 100%; overflow: auto; }
.dshDesktopFileStatus { box-sizing: border-box; height: 100%; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; color: var(--dsw-alias-label-secondary); text-align: center; }
.dshDesktopFileStatus.error { color: var(--dsw-alias-state-error-primary); }
.dshDesktopFileSpinner { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-state-business-primary); animation: dshDesktopSpin 0.8s linear infinite; }
@keyframes dshDesktopSpin { to { transform: rotate(360deg); } }
.dshDesktopFileStatusActions { display: flex; gap: 8px; }
.dshDesktopNotice { box-sizing: border-box; padding: 8px 12px; margin: 8px 12px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 13px; }
.dshDesktopActionButton { border: none; border-radius: 6px; padding: 6px 14px; background: var(--dsw-alias-button-info-fill); color: var(--dsw-alias-label-primary-foreground); cursor: pointer; }
.dshDesktopActionButton:hover { background: var(--dsw-alias-button-info-hover); }
.dshDesktopOversizedView { box-sizing: border-box; height: 100%; min-height: 0; padding: 16px; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
.dshDesktopMetadataList { margin: 0; display: flex; flex-direction: column; gap: 4px; color: var(--dsw-alias-label-secondary); }
.dshDesktopMetadataList > div { display: flex; gap: 8px; }
.dshDesktopMetadataList dt { color: var(--dsw-alias-label-tertiary); min-width: 40px; }
.dshDesktopMetadataList dd { margin: 0; color: var(--dsw-alias-label-primary); }
.dshDesktopSourceView { box-sizing: border-box; width: 100%; max-width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.dshDesktopSourceToolbar { flex: 0 0 auto; display: flex; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshDesktopSourceToggle { border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-secondary); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 13px; }
.dshDesktopSourceToggle:hover, .dshDesktopSourceToggle[aria-pressed="true"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshDesktopSourceBody { flex: 1 1 auto; min-height: 0; min-width: 0; max-width: 100%; overflow-x: hidden; overflow-y: auto; }
.dshDesktopSourceReadBlock { min-width: 0; max-width: 100%; }
.dshDesktopSourceReadBlock > div:last-child { overflow-x: hidden; }
.dshDesktopSourceReadBlock > div:last-child > div { align-items: flex-start; white-space: pre-wrap; }
.dshDesktopSourceReadBlock > div:last-child > div > span:last-child { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.dshDesktopSourcePlain { box-sizing: border-box; margin: 0; padding: 12px; min-height: 100%; min-width: 0; max-width: 100%; white-space: pre-wrap; overflow-wrap: anywhere; overflow-x: hidden; overflow-y: auto; font-family: var(--dsw-font-mono, monospace); font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary); background: transparent; }
.dshDesktopMarkdownView, .dshDesktopJsonView { box-sizing: border-box; height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.dshDesktopMarkdownViewHeader { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; min-width: 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshDesktopSegmentedControl { flex: 0 0 auto; display: inline-flex; gap: 2px; margin: 8px 12px; padding: 2px; border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover); width: fit-content; }
.dshDesktopSegmentedControl button { border: none; background: transparent; color: var(--dsw-alias-label-secondary); padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.dshDesktopSegmentedControl button[aria-selected="true"] { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-weight: 600; }
.dshDesktopSegmentedControl button:disabled { opacity: 0.45; cursor: default; }
.dshDesktopMarkdownToolbar { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 4px; padding: 6px 12px 6px 0; }
.dshDesktopMarkdownToolbarCommands { min-width: 0; display: flex; align-items: center; gap: 2px; overflow: hidden; }
.dshDesktopMarkdownToolbar button, .dshDesktopMarkdownOverflow summary { box-sizing: border-box; min-height: 26px; border: 1px solid transparent; border-radius: 5px; padding: 3px 7px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 12px; white-space: nowrap; }
.dshDesktopMarkdownToolbar button:hover, .dshDesktopMarkdownOverflow summary:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshDesktopMarkdownToolbar button:disabled { opacity: 0.45; cursor: default; }
.dshDesktopMarkdownToolbarSave { border-color: var(--dsw-alias-border-l2) !important; color: var(--dsw-alias-label-primary) !important; }
.dshDesktopMarkdownOverflow { position: relative; flex: 0 0 auto; }
.dshDesktopMarkdownOverflow summary { display: flex; align-items: center; list-style: none; }
.dshDesktopMarkdownOverflow summary::-webkit-details-marker { display: none; }
.dshDesktopMarkdownOverflowMenu { position: absolute; z-index: 20; top: calc(100% + 4px); right: 0; width: 132px; padding: 4px; display: grid; gap: 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16); }
.dshDesktopMarkdownOverflowMenu button { width: 100%; justify-content: flex-start; text-align: left; }
.dshDesktopMarkdownEditor { box-sizing: border-box; flex: 1 1 auto; min-height: 0; min-width: 0; overflow: auto; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); }
.dshDesktopMarkdownEditorRoot { box-sizing: border-box; min-height: 100%; width: 100%; }
.dshDesktopMarkdownEditor .ProseMirror { box-sizing: border-box; min-height: 100%; width: 100%; padding: 20px clamp(16px, 5%, 48px) 64px; outline: none; white-space: pre-wrap; overflow-wrap: break-word; word-wrap: break-word; color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-sans, sans-serif); font-size: 15px; line-height: 1.7; }
.dshDesktopMarkdownEditor .ProseMirror:focus-visible { box-shadow: inset 0 0 0 2px var(--dsw-alias-state-business-primary); }
.dshDesktopMarkdownEditor .ProseMirror > :first-child { margin-top: 0; }
.dshDesktopMarkdownEditor .ProseMirror h1, .dshDesktopMarkdownEditor .ProseMirror h2, .dshDesktopMarkdownEditor .ProseMirror h3 { margin: 1.35em 0 0.55em; color: var(--dsw-alias-label-primary); font-weight: 650; line-height: 1.28; }
.dshDesktopMarkdownEditor .ProseMirror h1 { font-size: 26px; }
.dshDesktopMarkdownEditor .ProseMirror h2 { padding-bottom: 5px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 21px; }
.dshDesktopMarkdownEditor .ProseMirror h3 { font-size: 17px; }
.dshDesktopMarkdownEditor .ProseMirror p { margin: 0.7em 0; }
.dshDesktopMarkdownEditor .ProseMirror ul, .dshDesktopMarkdownEditor .ProseMirror ol { margin: 0.7em 0; padding-left: 1.8em; }
.dshDesktopMarkdownEditor .ProseMirror li { margin: 0.25em 0; }
.dshDesktopMarkdownEditor .ProseMirror blockquote { margin: 1em 0; padding: 1px 0 1px 14px; border-left: 3px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.dshDesktopMarkdownEditor .ProseMirror code { padding: 1px 4px; border-radius: 4px; background: var(--dsw-alias-interactive-bg-hover); font-family: var(--dsw-font-mono, monospace); font-size: 0.9em; }
.dshDesktopMarkdownEditor .ProseMirror pre { box-sizing: border-box; max-width: 100%; overflow: auto; margin: 1em 0; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-layer-1); white-space: pre; }
.dshDesktopMarkdownEditor .ProseMirror pre code { padding: 0; background: transparent; }
.dshDesktopMarkdownEditor .ProseMirror table { width: 100%; border-collapse: collapse; margin: 1em 0; }
.dshDesktopMarkdownEditor .ProseMirror th, .dshDesktopMarkdownEditor .ProseMirror td { padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l2); text-align: left; }
.dshDesktopMarkdownEditor .ProseMirror a { color: var(--dsw-alias-state-business-primary); text-decoration: underline; }
.dshDesktopMarkdownEditor .ProseMirror input[type="checkbox"] { margin: 0 6px 0 0; accent-color: var(--dsw-alias-state-business-primary); }
.dshDesktopMarkdownSourceEditor { box-sizing: border-box; flex: 1 1 auto; min-height: 0; width: 100%; resize: none; border: none; outline: none; padding: 16px; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 2; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-mono, monospace); font-size: 13px; line-height: 1.6; }
.dshDesktopMarkdownSourceEditor:focus-visible { box-shadow: inset 0 0 0 2px var(--dsw-alias-state-business-primary); }
@media (max-width: 480px) { .dshDesktopMarkdownViewHeader { align-items: stretch; flex-direction: column; gap: 0; } .dshDesktopSegmentedControl { margin-bottom: 2px; } .dshDesktopMarkdownToolbar { justify-content: flex-start; padding: 2px 12px 8px; } .dshDesktopMarkdownToolbarCommands button:nth-child(n+5) { display: none; } .dshDesktopMarkdownEditor .ProseMirror { padding: 16px 14px 48px; } }
.dshDesktopImageSurface { box-sizing: border-box; height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.dshDesktopImageToolbar { flex: 0 0 auto; display: flex; align-items: center; gap: 4px; padding: 6px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshDesktopImageAction { display: inline-flex; align-items: center; gap: 4px; border: none; background: transparent; color: var(--dsw-alias-label-secondary); padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.dshDesktopImageAction:hover, .dshDesktopImageAction.active { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshDesktopImageScaleLabel { margin-left: 4px; color: var(--dsw-alias-label-tertiary); font-size: 12px; min-width: 44px; }
.dshDesktopImageCanvas { position: relative; flex: 1 1 auto; min-height: 0; overflow: auto; }
.dshDesktopImageCanvas img { display: block; }
.dshDesktopImageError { box-sizing: border-box; height: 100%; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
.dshDesktopProviderError { box-sizing: border-box; height: 100%; min-height: 0; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 12px; padding: 16px; }
@media (prefers-reduced-motion: reduce) { .dshDesktopFrame { transition: none !important; } }
`

/** Install and remove the advanced shell's global native-window styles. @returns the style disposer. */
export function installAdvancedStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-plugin-desktop'
  style.dataset.pluginCss = 'dsh-plugin-desktop/advanced-shell'
  style.textContent = ADVANCED_STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}
