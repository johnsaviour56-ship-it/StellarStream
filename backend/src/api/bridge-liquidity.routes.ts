import { Router, Request, Response } from "express";
import { BridgeLiquidityService } from "../services/bridge-liquidity.service.js";

const router = Router();
const svc = new BridgeLiquidityService();

/**
 * GET /api/v2/bridge-liquidity/check
 * Query Stellar DEX + destination AMM and return slippage warning if impact > 5%.
 *
 * Query params:
 *   stellarAsset   — e.g. "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
 *   destAsset      — e.g. "USDC"
 *   amount         — amount in base units (stroops)
 *   amountUsd      — USD equivalent (for AMM depth estimation)
 */
router.get("/check", async (req: Request, res: Response) => {
  const { stellarAsset, destAsset, amount, amountUsd } = req.query;

  if (!stellarAsset || !destAsset || !amount || !amountUsd) {
    res.status(400).json({ error: "stellarAsset, destAsset, amount, amountUsd are required" });
    return;
  }

  const report = await svc.checkBridgeLiquidity({
    stellarAsset: stellarAsset as string,
    destAssetSymbol: destAsset as string,
    amount: amount as string,
    amountUsd: parseFloat(amountUsd as string),
  });

  res.json({ success: true, ...report });
});

export default router;
