import { formatProviderHelp } from '@unorder/core'
import { asDescribableProviders } from './providers'
import { defaultStatePath } from './state-store'

export const CLI_VERSION = '0.1.0'

export const createUsage = (): string => `unorder ${CLI_VERSION} — unified restaurant ordering SDK

Usage:
  unorder run <provider> <method> [json|-] [options]
  unorder mcp [options]
  unorder providers
  unorder methods [provider]
  unorder --help
  unorder --version

Run examples:
  unorder run saizeriya menu.list '{"query":"パスタ"}'
  unorder run saizeriya menu.list '{"limit":20}' --menu-file ./menu.json
  unorder run saizeriya session.open '{"qrUrl":"https://example.com/qr","peopleCount":2}'
  unorder run saizeriya cart.add '{"itemId":"1202","quantity":2}'

Options:
  --state <file>      Session state file (default: ${defaultStatePath()})
  --menu-url <url>    Override the Saizeriya static menu URL
  --menu-file <path>  Use a local Saizeriya menu JSON file
  -h, --help          Show this help
  -v, --version       Show the version

Environment:
  UNORDER_STATE                 Default session state file
  UNORDER_SAIZERIYA_MENU_URL    Saizeriya menu URL override
  UNORDER_SAIZERIYA_MENU_FILE   Saizeriya local menu file override

JSON results are written to stdout. Errors are written to stdout as
{"error":{"code","message"}} and exit with a non-zero status. Diagnostics go to stderr.
Actions such as order.send, bill.get, receipt.get, and staff.call affect a real
restaurant when used against a live session. Review each method before running it.

${formatProviderHelp(asDescribableProviders())}
`
