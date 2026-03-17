-- Dune SQL query template for protocol activity
-- Fetches DEX trades, bridges, and other protocol interactions for a wallet
-- Parameters: @address (wallet address), @start_date (ISO timestamp)

SELECT
  block_time as blockTime,
  tx_hash as txHash,
  protocol as protocolName,
  category,
  "from" as fromAddress,
  "to" as toAddress,
  amount_usd as amountUSD,
  contract_address as contractAddress,
  8453 as chainId
FROM dex.trades
WHERE blockchain = 'base'
  AND (lower("from") = lower(@address) OR lower("to") = lower(@address))
  AND block_time > @start_date
ORDER BY block_time DESC
LIMIT 100;
