# @unorder/cli

The `unorder` CLI and stdio MCP server. All built-in providers are bundled into
`dist/cli.mjs`.

## Commands

```text
unorder run <provider> <method> [json|-]
unorder mcp
unorder providers
unorder methods [provider]
unorder --help
unorder --version
```

Options:

```text
--state <file>      Session state file
--menu-url <url>    Saizeriya static menu URL override
--menu-file <path>  Saizeriya local menu JSON
```

## Examples

```bash
unorder run saizeriya menu.list '{"limit":5}' \
  --menu-file ./packages/provider-saizeriya/data/menu.json

cat menu-query.json | unorder run saizeriya menu.list - --menu-file ./menu.json

unorder run saizeriya session.open \
  '{"qrUrl":"https://example.com/saizeriya3/qr?table=...","peopleCount":2}' \
  --state ./.unorder/state.json

unorder run saizeriya cart.add '{"itemId":"1202","quantity":2}' \
  --state ./.unorder/state.json

unorder run saizeriya session.export '{}' --state ./.unorder/state.json
```

`session.export` is implemented by core for every provider. It returns the
stored versioned session envelope, and fails with an `invalid_input` error JSON
when no session is stored for the provider.

Results and errors are JSON on stdout; diagnostics are on stderr. For example an
error exits non-zero and prints:

```json
{ "error": { "code": "auth_required", "message": "..." } }
```

## MCP

`unorder mcp` starts a minimal newline-delimited JSON-RPC server on stdio. It
implements `initialize`, `ping`, `tools/list`, `tools/call`, and `shutdown`.
Every method becomes a tool named `<provider>.<method>`:

- `saizeriya.menu.list`
- `saizeriya.session.open`
- `saizeriya.cart.add`
- `saizeriya.order.send`
- ...

Tool input schemas come from `@unorder/core` descriptors, so they stay in sync with
`unorder --help`. MCP sessions live in process memory; use the CLI when you need a
state file between processes.
