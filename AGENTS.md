# AGENTS.md

## Commands

- Run all quality checks (format, lint, and type check): `vp check`
- Auto-fix formatting and safe lint issues: `vp check --fix`
- Run the test suite: `vp test`
- Build every package: `vp run -r pack`

Node.js 22.18 or newer is required by Vite+. The repository records the expected
runtime in `.node-version`. Run commands with Vite+ from the repository root.

## Architecture

- `packages/core` contains provider-independent types, schemas, errors, standard
  methods, the provider runtime, the typed Proxy client, and `exportSession`.
- `packages/provider-saizeriya` and `packages/provider-sushiro` are provider
  implementations. They must not gain third-party runtime dependencies; use
  Node's standard APIs and the small in-repository parsers.
- Providers expose a call-only `create<Provider>(config?)` object. Metadata,
  method schemas, runtime state, and serialization live in core helpers.
  `defineProvider` is a type-only identity helper.
- Session serialization is the core function `exportSession(provider, state?)`.
  The provider runtime intentionally has no `exportSession` method.
- `packages/cli` provides the `unorder` binary and a stdio MCP server. Its
  stdout is reserved for JSON (or help text); diagnostics belong on stderr.
- Never add tests that send real orders or calls to a live restaurant.

## Extension policy

Do not create provider-specific extension methods such as `x-saizeriya.*` or
`x-sushiro.*`. When a provider has a concept that does not fit the current
standard surface:

1. (Preferred) Extend the core domain types in `packages/core/src/domain.ts` and
   add a provider-neutral standard method in `packages/core/src/standard.ts`.
   Provider-specific raw data stays in `raw`; anything that can be generalized
   becomes a normalized field. This includes location and shop information such
   as addresses, geo points, distance, shop status, services, wait estimates,
   queues, waitlists, and reservations.
2. If it cannot be generalized, do not expose it publicly. Keep it as an
   internal implementation detail and handle it automatically where possible.

Every standard method is optional per provider. Unsupported methods must fail
with `UnsupportedError`, and support must be reflected in method lists,
`describeProvider`, CLI help, MCP tools, and the typed `MethodMap` client.
