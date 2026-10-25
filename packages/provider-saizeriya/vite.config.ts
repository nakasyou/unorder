import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  resolve: {
    alias: {
      '@unorder/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  pack: {
    entry: ['src/index.ts'],
    dts: true,
    format: ['esm'],
    clean: true,
    external: ['@unorder/core'],
  },
})
