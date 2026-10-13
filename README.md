# gloom-farao

Read-only [Farao](https://getfarao.com) position sync for [Gloomberb](https://github.com/gloom-sh/gloomberb), over the [Orus](https://docs.getfarao.com) MCP server.

```bash
gloomberb install openfort-xyz/gloom-farao
```

## Setup

Run `BROKER` (or `Ctrl+P` → "Connect a broker") and pick **Farao**. The first sync opens the Orus sign-in page in your browser; scan its QR code with the Farao app and approve. There is no password or API key to paste. The tokens Orus issues are stored in your local Gloomberb config, and you can revoke the connection at any time from Connected apps in the Farao app.

## What it imports

- One account per Farao wallet: total balance, free cash, position value and margin used.
- Every open Hyperliquid perp, on the main DEX and on every HIP-3 DEX:
  - crypto perps join the coin's USD pair (`BTC` → `BTC-USD`)
  - HIP-3 stock perps join the listed stock (`xyz:TSLA` → `TSLA`)
  - indices, commodities, FX and rates appear as `<SYMBOL>-PERP`, priced from Farao's mark

## What it can do

Nothing but read. The sign-in asks Orus for three scopes, `account:read portfolio:read positions:read`, so the grant cannot place, change or cancel orders. The plugin calls exactly three tools, `get_account_status`, `get_portfolio` and `get_positions`, and refuses to run if any one is not marked read-only.

The OAuth callback listens on `127.0.0.1` with a random state parameter and stops after five minutes.

## Development

```bash
bun install
bun test
bun run typecheck
gloomberb plugin link .
gloomberb plugin doctor gloom-farao
bun scripts/sync-once.ts   # one live sync outside Gloomberb, printed as JSON
```

`FARAO_ORUS_MCP_URL` points the plugin at another Orus deployment.

## License

MIT
