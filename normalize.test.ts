import { describe, expect, test } from "bun:test";
import { requireReadOnlyTools } from "./native";
import { gloomListing, type OrusPortfolio, type OrusPosition, toSnapshot } from "./normalize";

const ADDRESS = "0x1111111111111111111111111111111111111111";

const portfolio: OrusPortfolio = {
  cashUsd: "250.50",
  wealthUsd: "1000.00",
  perp: {
    totalPositionValueUsd: "3000.00",
    totalMarginUsedUsd: "300.00",
    crossMaintenanceMarginUsedUsd: "45.00",
  },
};

function position(overrides: Partial<OrusPosition>): OrusPosition {
  return {
    coin: "BTC",
    side: "long",
    size: "0.01",
    entryPrice: "100000",
    positionValueUsd: "1050",
    unrealizedPnlUsd: "50",
    leverage: { type: "cross", value: 10 },
    ...overrides,
  };
}

describe("gloomListing", () => {
  test("main-DEX crypto joins the coin's USD pair", () => {
    expect(gloomListing("BTC")).toEqual({ ticker: "BTC-USD", exchange: "CCC", assetCategory: "CRYPTO" });
  });

  test("HIP-3 stocks join the listed stock", () => {
    expect(gloomListing("xyz:TSLA")).toEqual({ ticker: "TSLA", exchange: "SMART", assetCategory: "STK" });
  });

  test("crypto on a stock DEX stays crypto", () => {
    expect(gloomListing("flx:BTC").assetCategory).toBe("CRYPTO");
    expect(gloomListing("hyna:SOL").ticker).toBe("SOL-USD");
  });

  test("commodities, indices, FX and rates never resolve to a same-named stock", () => {
    for (const coin of ["xyz:GOLD", "xyz:XYZ100", "xyz:EUR", "km:10Y"]) {
      expect(gloomListing(coin).ticker).toEndWith("-PERP");
      expect(gloomListing(coin).assetCategory).toBe("CFD");
    }
  });
});

describe("toSnapshot", () => {
  test("maps the account from get_portfolio", () => {
    const [account] = toSnapshot({ masterAddress: ADDRESS }, portfolio, []).accounts;
    expect(account).toMatchObject({
      accountId: ADDRESS,
      name: "Farao",
      currency: "USD",
      netLiquidation: 1000,
      totalCashValue: 250.5,
      availableFunds: 250.5,
      grossPositionValue: 3000,
      initMarginReq: 300,
      maintMarginReq: 45,
      unrealizedPnl: 0,
    });
  });

  test("shorts keep positive shares with a short side", () => {
    const { positions } = toSnapshot({ masterAddress: ADDRESS }, portfolio, [
      position({ coin: "xyz:NVDA", side: "short", size: "-4", entryPrice: "180", positionValueUsd: "700", unrealizedPnlUsd: "20" }),
    ]);
    expect(positions).toEqual([{
      ticker: "NVDA",
      exchange: "SMART",
      assetCategory: "STK",
      shares: 4,
      side: "short",
      avgCost: 180,
      currency: "USD",
      accountId: ADDRESS,
      name: "xyz:NVDA perp 10x cross",
      markPrice: 175,
      marketValue: 700,
      unrealizedPnl: 20,
    }]);
  });

  test("drops flat and zero-size rows and sums unrealized PnL", () => {
    const snapshot = toSnapshot({ masterAddress: ADDRESS }, portfolio, [
      position({}),
      position({ coin: "ETH", side: "flat", size: "0" }),
      position({ coin: "SOL", unrealizedPnlUsd: "-80" }),
    ]);
    expect(snapshot.positions.map((p) => p.ticker)).toEqual(["BTC-USD", "SOL-USD"]);
    expect(snapshot.accounts[0]?.unrealizedPnl).toBe(-30);
  });

  test("a missing entry price leaves the cost undefined instead of zero", () => {
    const [mapped] = toSnapshot({ masterAddress: ADDRESS }, portfolio, [position({ entryPrice: null })]).positions;
    expect(mapped?.avgCost).toBeUndefined();
  });
});

describe("requireReadOnlyTools", () => {
  const readOnly = { annotations: { readOnlyHint: true } };
  const tools = ["get_account_status", "get_portfolio", "get_positions"].map((name) => ({ name, ...readOnly }));

  test("accepts the three read-only tools", () => {
    expect(() => requireReadOnlyTools(tools)).not.toThrow();
  });

  test("refuses a missing tool", () => {
    expect(() => requireReadOnlyTools(tools.slice(1))).toThrow("get_account_status");
  });

  test("refuses a tool without the read-only annotation", () => {
    const unmarked = tools.map((tool) => (tool.name === "get_positions" ? { name: tool.name } : tool));
    expect(() => requireReadOnlyTools(unmarked)).toThrow("get_positions");
  });
});
