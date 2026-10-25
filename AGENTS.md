# AGENTS.md

## Commands

- Run all quality checks (format, lint, and type check): `vp check`
- Auto-fix formatting and safe lint issues: `vp check --fix`
- Run the test suite: `vp test`
- Build every package: `vp run -r pack`

Node.js 22.18 or newer is required by Vite+. The repository records the expected
runtime in `.node-version`. Run commands with Vite+ from the repository root.

## Architecture

- `packages/core` contains provider-independent types, schemas, errors, and the
  provider runtime.
- `packages/provider-saizeriya` is the Saizeriya implementation. It must not
  gain third-party runtime dependencies; use Node's standard APIs and the small
  in-repository HTML parser.
- `packages/cli` provides the `unorder` binary and a stdio MCP server. Its
  stdout is reserved for JSON (or help text); diagnostics belong on stderr.
- Never add tests that send real orders or calls to a live restaurant.
