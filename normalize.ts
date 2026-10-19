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
  assetClass: "crypto" | "equity" | "index" | "commodity" | "forex" | "rate";
  side: "long" | "short" | "flat";
  size: string;
  entryPrice: string | null;
  positionValueUsd: string;
  unrealizedPnlUsd: string;
  leverage: { type: "cross" | "isolated"; value: number };
}

function baseSymbol(coin: string): string {
  const colon = coin.indexOf(":");
  return (colon > 0 ? coin.slice(colon + 1) : coin).toUpperCase();
}

/**
 * Where a Hyperliquid perp lands in Gloomberb. Crypto joins the coin's USD pair
 * and HIP-3 stocks join the listed stock, so charts and research open on them.
 */
// ponytail: indices, commodities and FX keep a `-PERP` ticker with no quote source; map them
// to Gloomberb's futures and FX listings, or its PERP market ids, once the maintainers pick one.
export function gloomListing(
  row: Pick<OrusPosition, "coin" | "assetClass">,
): Pick<BrokerPosition, "ticker" | "exchange" | "assetCategory"> {
  const base = baseSymbol(row.coin);
  switch (row.assetClass) {
    case "crypto":
      return { ticker: `${base}-USD`, exchange: "CCC", assetCategory: "CRYPTO" };
    case "equity":
      return { ticker: base, exchange: "SMART", assetCategory: "STK" };
    default:
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
    ...gloomListing(row),
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
