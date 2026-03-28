## feat: Bridge Liquidity Monitor — Slippage Warning for Gas-Swap Splits

### Description
Monitors liquidity on both sides of the bridge to ensure a Gas-Swap split won't fail due to low liquidity. Returns a slippage warning if trade impact exceeds 5%.

### Changes

**Backend**
- `BridgeLiquidityService` — queries Stellar DEX orderbook depth (via Horizon) and destination-chain AMM depth (via CoinGecko market volume) in parallel, computes trade impact for each side
- Returns `slippageWarning: true` + human-readable `warning` message on either side when impact > 5%
- `GET /api/v2/bridge-liquidity/check?stellarAsset=&destAsset=&amount=&amountUsd=`

### Example Response
```json
{
  "safe": false,
  "stellarSide": {
    "chain": "stellar",
    "tradeImpact": 0.08,
    "slippageWarning": true,
    "warning": "Stellar DEX trade impact 8.00% exceeds 5% threshold"
  },
  "destinationSide": {
    "chain": "destination",
    "tradeImpact": 0.02,
    "slippageWarning": false
  }
}
```

### Labels
`[Backend]` `DeFi` `Hard`
