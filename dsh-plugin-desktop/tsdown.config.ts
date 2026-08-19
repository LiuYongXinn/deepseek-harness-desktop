import { defineConfig } from 'tsdown'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = 'dsh-plugin-desktop'

/**
 * `vfile` exposes browser implementations for these private package imports,
 * but the CJS client build resolves conditional exports with Node conditions.
 * Resolve them explicitly so the browser bundle never asks the module table for
 * Node built-ins such as `node:process`.
 */
const VFILE_BROWSER_IMPORTS: Record<string, string> = {
  '#minpath': fileURLToPath(new URL('node_modules/vfile/lib/minpath.browser.js', import.meta.url)),
  '#minproc': fileURLToPath(new URL('node_modules/vfile/lib/minproc.browser.js', import.meta.url)),
  '#minurl': fileURLToPath(new URL('node_modules/vfile/lib/minurl.browser.js', import.meta.url)),
}

export default defineConfig([
  {
    name: PACKAGE_NAME,
    entry: {
      index: 'src/index.ts',
      'module-resolution': 'src/module-resolution.ts',
      profile: 'src/profile.ts',
      'profile-manager': 'src/profile-manager.ts',
      'profile-service': 'src/profile-service.ts',
      pnpm: 'src/pnpm.ts',
      profiles: 'src/profiles.ts',
      runtime: 'src/runtime.ts',
      'electron-runtime': 'src/electron-runtime.ts',
      'desktop-runtime-environment': 'src/desktop-runtime-environment.ts',
      'desktop-terminal': 'src/desktop-terminal.ts',
      'desktop-cli': 'src/desktop-cli.ts',
      terminal: 'src/terminal.ts',
      'update-checker': 'src/update-checker.ts',
      'update-download': 'src/update-download.ts',
      updates: 'src/updates.ts',
      'windows-pwsh-sandbox': 'src/windows-pwsh-sandbox.ts',
      'windows-acl-runner': 'src/windows-acl-runner.ts',
      main: 'src/main.ts',
    },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
  },
  {
    name: `${PACKAGE_NAME}/bin`,
    entry: { bin: 'src/bin.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    outputOptions: {
      banner: '#!/usr/bin/env node',
    },
  },
  {
    name: `${PACKAGE_NAME}/client`,
    entry: { client: 'src/client/index.ts' },
    tsconfig: 'tsconfig.client.json',
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    external: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-runtime/client',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-web-react',
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
    noExternal: (id: string) => id.startsWith('@deepseek-ai/') ? undefined : true,
    plugins: [{
      name: 'dsh-vfile-browser-conditions',
      resolveId(source: string, importer?: string) {
        const isVfileImporter = importer !== undefined
          && /(?:^|[/\\])node_modules[/\\]vfile[/\\]/u.test(importer)
        if (!isVfileImporter) return null
        return VFILE_BROWSER_IMPORTS[source] ?? null
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
