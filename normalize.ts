import type { BrokerPosition } from "gloomberb/types/broker";
import type { BrokerAccount } from "gloomberb/types/trading";

export interface BrokerPortfolioSnapshot {
  accounts: BrokerAccount[];
  positions: BrokerPosition[];
}

/** The fields this plugin reads from Orus `get_account_status`. */
export interface OrusAccountStatus {
  masterAddress: string;
}

/** The fields this plugin reads from Orus `get_portfolio`. All amounts are USD strings. */
export interface OrusPortfolio {
  cashUsd: string;
  wealthUsd: string;
  perp: {
    totalPositionValueUsd: string;
    totalMarginUsedUsd: string;
    crossMaintenanceMarginUsedUsd: string;
  };
}

/** The fields this plugin reads from one Orus `get_positions` row. */
export interface OrusPosition {
  coin: string;
  side: "long" | "short" | "flat";
  size: string;
  entryPrice: string | null;
  positionValueUsd: string;
  unrealizedPnlUsd: string;
  leverage: { type: "cross" | "isolated"; value: number };
}

// Copied from farao packages/farao-core/src/assets.ts. Keep in sync until
// Orus returns the asset class with each position.
const INDEX_SYMBOLS = new Set([
  "BIOTECH", "DEFENSE", "ENERGY", "EWJ", "EWT", "EWY", "EWZ", "GLDMINE", "GOLDJM", "INFOTECH",
  "JP225", "KR200", "MAG7", "NUCLEAR", "ROBOT", "SEMI", "SEMIS", "SILVERJM", "SMALL2000", "SMH",
  "SP500", "URNM", "US500", "USA100", "USA500", "USBOND", "USENERGY", "USTECH", "VIX", "VOL",
  "XYZ100",
]);
const COMMODITY_SYMBOLS = new Set([
  "ALUMINIUM", "BRENTOIL", "CL", "COPPER", "CORN", "GOLD", "NATGAS", "OIL", "PALLADIUM", "PAXG",
  "PLATINUM", "SILVER", "SOY", "USOIL", "WHEAT", "WTI",
]);
const FOREX_SYMBOLS = new Set(["DXY", "EUR", "GBP", "JPY", "KRW"]);
const RATE_SYMBOLS = new Set(["2Y", "10Y", "30Y"]);
const CRYPTO_HIP3_DEXES = new Set(["hyna"]);
const CRYPTO_HIP3_COINS = new Set([
  "flx:BTC", "flx:USDE", "flx:XMR", "para:ANSEM", "para:BTCD", "para:OTHERS", "para:TOTAL2",
  "para:TREAD",
]);

type AssetClass = "crypto" | "equity" | "other";

function baseSymbol(coin: string): string {
  const colon = coin.indexOf(":");
  return (colon > 0 ? coin.slice(colon + 1) : coin).toUpperCase();
}

function assetClassOf(coin: string): AssetClass {
  const base = baseSymbol(coin);
  for (const symbols of [INDEX_SYMBOLS, COMMODITY_SYMBOLS, FOREX_SYMBOLS, RATE_SYMBOLS]) {
    if (symbols.has(base)) return "other";
  }
  const colon = coin.indexOf(":");
  const dex = colon > 0 ? coin.slice(0, colon) : null;
  if (!dex || CRYPTO_HIP3_DEXES.has(dex) || CRYPTO_HIP3_COINS.has(coin)) return "crypto";
  return "equity";
}

/**
 * Where a Hyperliquid perp lands in Gloomberb. Crypto joins the coin's USD pair
 * and HIP-3 stocks join the listed stock, so charts and research open on them.
 */
// ponytail: indices, commodities and FX keep a `-PERP` ticker with no quote source; map them
// to Gloomberb's futures and FX listings, or its PERP market ids, once the maintainers pick one.
export function gloomListing(coin: string): Pick<BrokerPosition, "ticker" | "exchange" | "assetCategory"> {
  const base = baseSymbol(coin);
  switch (assetClassOf(coin)) {
    case "crypto":
      return { ticker: `${base}-USD`, exchange: "CCC", assetCategory: "CRYPTO" };
    case "equity":
      return { ticker: base, exchange: "SMART", assetCategory: "STK" };
    case "other":
      return { ticker: `${base}-PERP`, exchange: "HYPERLIQUID", assetCategory: "CFD" };
  }
}

function usd(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toPosition(row: OrusPosition, accountId: string): BrokerPosition | null {
  const size = usd(row.size);
  if (row.side === "flat" || size === undefined || size === 0) return null;
  const shares = Math.abs(size);
  const marketValue = usd(row.positionValueUsd);
  return {
    ...gloomListing(row.coin),
    shares,
    side: row.side,
    avgCost: usd(row.entryPrice),
    currency: "USD",
    accountId,
    name: `${row.coin} perp ${row.leverage.value}x ${row.leverage.type}`,
    markPrice: marketValue === undefined ? undefined : marketValue / shares,
    marketValue,
    unrealizedPnl: usd(row.unrealizedPnlUsd),
  };
}

export function toSnapshot(
  status: OrusAccountStatus,
  portfolio: OrusPortfolio,
  positions: OrusPosition[],
): BrokerPortfolioSnapshot {
  const accountId = status.masterAddress;
  const mapped = positions.flatMap((row) => toPosition(row, accountId) ?? []);
  const account: BrokerAccount = {
    accountId,
    name: "Farao",
    currency: "USD",
    updatedAt: Date.now(),
    netLiquidation: usd(portfolio.wealthUsd),
    totalCashValue: usd(portfolio.cashUsd),
    availableFunds: usd(portfolio.cashUsd),
    grossPositionValue: usd(portfolio.perp.totalPositionValueUsd),
    initMarginReq: usd(portfolio.perp.totalMarginUsedUsd),
    maintMarginReq: usd(portfolio.perp.crossMaintenanceMarginUsedUsd),
    unrealizedPnl: mapped.reduce((sum, position) => sum + (position.unrealizedPnl ?? 0), 0),
  };
  return { accounts: [account], positions: mapped };
}
