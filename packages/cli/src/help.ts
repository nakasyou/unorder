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
  unorder run sushiro x-sushiro.shop.list '{"latitude":35.68,"longitude":139.76,"numResults":3}'
  unorder run sushiro menu.list '{"query":"サーモン"}'

Options:
  --state <file>      Session state file (default: ${defaultStatePath()})
  --menu-url <url>    Override the Saizeriya static menu URL
  --menu-file <path>  Use a local Saizeriya menu JSON file
  -h, --help          Show this help
  -v, --version       Show the version

Environment:
  UNORDER_STATE                    Default session state file
  UNORDER_SAIZERIYA_MENU_URL       Saizeriya menu URL override
  UNORDER_SAIZERIYA_MENU_FILE      Saizeriya local menu file override
  UNORDER_SUSHIRO_STORE_ID         Sushiro store id for menu methods
  UNORDER_SUSHIRO_REGION           Sushiro CRM region (default: ja)
  UNORDER_SUSHIRO_GUID             Sushiro device GUID
  UNORDER_SUSHIRO_PEOPLE           Default party size
  UNORDER_SUSHIRO_TABLE_TYPE       Default table type (T, C, or P)
  UNORDER_SUSHIRO_TAKEOUT_TOKEN    Takeout bearer token override

JSON results are written to stdout. Errors are written to stdout as
{"error":{"code","message"}} and exit with a non-zero status. Diagnostics go to stderr.
Actions such as order.send, bill.get, receipt.get, and staff.call affect a real
restaurant when used against a live session. Sushiro ticket.issue, ticket.cancel,
and ticket.enter are also real-world actions. Review each method before running it.

${formatProviderHelp(asDescribableProviders())}
`
