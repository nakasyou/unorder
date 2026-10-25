import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

const ignoredPaths = ['**/node_modules/**', '**/dist/**', '**/.cache/**']

export default defineConfig({
  resolve: {
    alias: {
      '@unorder/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@unorder/saizeriya': fileURLToPath(
        new URL('./packages/provider-saizeriya/src/index.ts', import.meta.url),
      ),
    },
  },
  fmt: {
    ignorePatterns: ignoredPaths,
    semi: false,
    singleQuote: true,
  },
  lint: {
    ignorePatterns: ignoredPaths,
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      'no-console': 'off',
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
  },
})
