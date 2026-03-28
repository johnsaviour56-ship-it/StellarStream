import { logger } from "../logger.js";

const SLIPPAGE_WARN_THRESHOLD = 0.05; // 5%
const STELLAR_HORIZON = "https://horizon.stellar.org";

export interface LiquidityResult {
  asset: string;
  chain: string;
  available: string;
  tradeImpact: number; // 0–1
  slippageWarning: boolean;
  warning?: string;
}

export interface BridgeLiquidityReport {
  stellarSide: LiquidityResult;
  destinationSide: LiquidityResult;
  safe: boolean;
}

export class BridgeLiquidityService {
  /**
   * Query Stellar DEX orderbook depth for a given asset pair and amount.
   * Returns estimated trade impact (price slippage as a fraction).
   */
  private async queryStellarDex(
    sellingAsset: string, // "native" or "CODE:ISSUER"
    buyingAsset: string,
    amount: string
  ): Promise<{ available: string; tradeImpact: number }> {
    try {
      const [sellingCode, sellingIssuer] = sellingAsset === "native"
        ? ["native", ""]
        : sellingAsset.split(":");

      const params = new URLSearchParams({
        selling_asset_type: sellingCode === "native" ? "native" : "credit_alphanum4",
        ...(sellingCode !== "native" && { selling_asset_code: sellingCode, selling_asset_issuer: sellingIssuer }),
        buying_asset_type: buyingAsset === "native" ? "native" : "credit_alphanum4",
        ...(buyingAsset !== "native" && (() => {
          const [c, i] = buyingAsset.split(":");
          return { buying_asset_code: c, buying_asset_issuer: i };
        })()),
        order: "desc",
        limit: "20",
      });

      const res = await fetch(`${STELLAR_HORIZON}/order_book?${params}`);
      if (!res.ok) throw new Error(`Horizon ${res.status}`);

      const book = await res.json() as any;
      const bids: Array<{ price: string; amount: string }> = book.bids ?? [];

      if (bids.length === 0) {
        return { available: "0", tradeImpact: 1 };
      }

      const bestPrice = parseFloat(bids[0].price);
      let filled = 0;
      let totalCost = 0;
      const need = parseFloat(amount);

      for (const bid of bids) {
        const bidAmt = parseFloat(bid.amount);
        const bidPrice = parseFloat(bid.price);
        const take = Math.min(bidAmt, need - filled);
        totalCost += take * bidPrice;
        filled += take;
        if (filled >= need) break;
      }

      const available = filled.toFixed(7);
      const avgPrice = filled > 0 ? totalCost / filled : 0;
      const tradeImpact = bestPrice > 0 ? Math.abs(bestPrice - avgPrice) / bestPrice : 1;

      return { available, tradeImpact };
    } catch (err) {
      logger.warn("Stellar DEX query failed", { err });
      return { available: "0", tradeImpact: 1 };
    }
  }

  /**
   * Query destination-chain AMM liquidity via a public price API.
   * Uses CoinGecko simple price + market data as a proxy for AMM depth.
   */
  private async queryDestinationAmm(
    assetSymbol: string,
    amountUsd: number
  ): Promise<{ available: string; tradeImpact: number }> {
    try {
      const id = assetSymbol.toLowerCase() === "usdc" ? "usd-coin"
        : assetSymbol.toLowerCase() === "xlm" ? "stellar"
        : assetSymbol.toLowerCase();

      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`
      );
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`);

      const data = await res.json() as any;
      const volume24h: number = data.market_data?.total_volume?.usd ?? 0;

      // Rough AMM impact: trade / (volume / 2) — simplified constant-product model
      const tradeImpact = volume24h > 0 ? Math.min(amountUsd / (volume24h / 2), 1) : 1;
      const available = volume24h.toFixed(2);

      return { available, tradeImpact };
    } catch (err) {
      logger.warn("Destination AMM query failed", { err });
      return { available: "0", tradeImpact: 1 };
    }
  }

  /**
   * Check liquidity on both sides of the bridge for a Gas-Swap split.
   */
  async checkBridgeLiquidity(params: {
    stellarAsset: string;   // e.g. "USDC:GA5Z..."
    destAssetSymbol: string; // e.g. "USDC"
    amount: string;          // amount in stroops / base units
    amountUsd: number;
  }): Promise<BridgeLiquidityReport> {
    const [stellar, destination] = await Promise.all([
      this.queryStellarDex("native", params.stellarAsset, params.amount),
      this.queryDestinationAmm(params.destAssetSymbol, params.amountUsd),
    ]);

    const stellarSide: LiquidityResult = {
      asset: params.stellarAsset,
      chain: "stellar",
      available: stellar.available,
      tradeImpact: stellar.tradeImpact,
      slippageWarning: stellar.tradeImpact > SLIPPAGE_WARN_THRESHOLD,
      ...(stellar.tradeImpact > SLIPPAGE_WARN_THRESHOLD && {
        warning: `Stellar DEX trade impact ${(stellar.tradeImpact * 100).toFixed(2)}% exceeds 5% threshold`,
      }),
    };

    const destinationSide: LiquidityResult = {
      asset: params.destAssetSymbol,
      chain: "destination",
      available: destination.available,
      tradeImpact: destination.tradeImpact,
      slippageWarning: destination.tradeImpact > SLIPPAGE_WARN_THRESHOLD,
      ...(destination.tradeImpact > SLIPPAGE_WARN_THRESHOLD && {
        warning: `Destination AMM trade impact ${(destination.tradeImpact * 100).toFixed(2)}% exceeds 5% threshold`,
      }),
    };

    return {
      stellarSide,
      destinationSide,
      safe: !stellarSide.slippageWarning && !destinationSide.slippageWarning,
    };
  }
}
