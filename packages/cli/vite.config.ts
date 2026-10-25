import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  resolve: {
    alias: {
      '@unorder/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@unorder/saizeriya': fileURLToPath(
        new URL('../provider-saizeriya/src/index.ts', import.meta.url),
      ),
      '@unorder/sushiro': fileURLToPath(
        new URL('../provider-sushiro/src/index.ts', import.meta.url),
      ),
    },
  },
  pack: {
    entry: ['src/cli.ts'],
    dts: false,
    format: ['esm'],
    clean: true,
    deps: { alwaysBundle: [/^@unorder\//] },
  },
})
