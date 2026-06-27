# ArbBot Wallet Integration Setup

This guide shows how to connect MetaMask / Trust Wallet to control the DEX arbitrage bot through a web UI.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (React + MetaMask/Trust Wallet)                     │
│  - Dashboard UI with wallet connect button                   │
│  - Shows bot status, trades, logs                            │
│  - Wallet address display                                    │
└──────────────────────┬───────────────────────────────────────┘
                       │ HTTP Requests (CORS enabled)
                       │
┌──────────────────────▼───────────────────────────────────────┐
│  Flask API Server (port 5000)                                │
│  - /api/bot/start, /api/bot/stop                             │
│  - /api/wallet/connect                                       │
│  - /api/status, /api/trades, /api/logs                       │
└──────────────────────┬───────────────────────────────────────┘
                       │ Shared state or subprocess
                       │
┌──────────────────────▼───────────────────────────────────────┐
│  Node Proxy Server (port 4000)                               │
│  - /proxy/binance/ticker/price                                │
│  - /proxy/binance/ticker/bookTicker                          │
│  - Provides live Binance market data to the dashboard        │
└──────────────────────┬───────────────────────────────────────┘
                       │ Market data API requests
                       │
┌──────────────────────▼───────────────────────────────────────┐
│  Python Bot (dex arb ultimate (1).py)                        │
│  - Runs trading logic                                        │
│  - Updates state with API server                             │
│  - Withdraws profits to wallet                               │
└──────────────────────────────────────────────────────────────┘
```

## Setup Steps

### 1. Install Flask

```bash
py -3 -m pip install flask flask-cors
```

### 2. Run the API Server

```bash
cd c:\Users\munira\Downloads
py -3 bot_api.py
```

You should see:
```
 * Running on http://0.0.0.0:5000
```

### 3. Run the React Frontend

In a **new terminal**:

```bash
cd c:\Users\munira\Downloads
$env:Path = "C:\Program Files\nodejs;" + $env:Path
npm run dev -- --host --port 5176 --strictPort
```

Open the URL in your browser: `http://localhost:5176`.

On Windows, you can also double-click [run_dashboard.bat](run_dashboard.bat) from the workspace root.
If you want both the dashboard and live-price proxy, double-click [run_all.bat](run_all.bat) instead.

### 4. Run the Live Price Proxy

In a **new terminal**:

```bash
cd c:\Users\munira\Downloads
npm run proxy:dev
```

This starts the Node proxy on `http://localhost:4000` and feeds real Binance prices into the dashboard.

On Windows, you can also double-click [run_proxy.bat](run_proxy.bat) from the workspace root.

### 5. Configure the Python Bot

Edit `c:\Users\munira\Desktop\dex arb ultimate (1).py`:

- `PRIVATE_KEY` = your wallet private key
- `WALLET_ADDRESS` = your wallet address
- `QUICKNODE_URL` = BSC RPC URL
- `WITHDRAWAL_ADDRESS` = where profits are sent
- `STARTING_CAPITAL` = 50 (or your amount)

### 6. Run the Bot

In a **new terminal**:

```bash
cd c:\Users\munira\Desktop
py -3 "dex arb ultimate (1).py" --dry-run
```

(Use `--dry-run` first to test without sending transactions)

---

## How to Use the Wallet UI

### Connect MetaMask / Trust Wallet

1. Click the **"Connect Wallet"** button on the dashboard.
2. If MetaMask/Trust Wallet is installed, a popup appears.
3. Approve the connection → your wallet address appears in the UI.

### Start the Bot

1. Wallet must be connected.
2. Click **"Start"** button (or use API):
   ```
   POST http://localhost:5000/api/bot/start
   {"starting_capital": 50, "dry_run": true}
   ```

### Monitor Trades

- Real-time dashboard shows scans, trades, and profit.
- **Flash Loan** trades show in blue.
- **Triangle** trades show in purple.
- Each trade displays the gap %, pair, and profit.

### View Logs

- Scroll through recent trades and bot activity.
- Logs are color-coded (success, flash, triangle, warning, error).

### Disconnect Wallet

- Click **"Disconnect"** to disconnect the wallet.

---

## API Endpoints Summary

### Status

```
GET /api/status
GET /api/health
```

### Bot Control

```
POST /api/bot/start
  {"starting_capital": 50, "dry_run": false}

POST /api/bot/stop
```

### Trades & Logs

```
GET /api/trades?limit=20
GET /api/logs?limit=50
```

### Wallet

```
POST /api/wallet/connect
  {"address": "0x...", "signature": "0x..."}

GET /api/wallet/current

POST /api/wallet/disconnect
```

### Trade Simulation

```
POST /api/trade/simulate
  {
    "buy_dex": "PancakeSwap",
    "sell_dex": "Biswap",
    "token_in": "USDT",
    "token_out": "BNB",
    "amount": 10
  }
```

---

## Important Notes

### Private Key Security

- **Never** put your private key in the frontend or share it online.
- The Python bot stores it locally and signs transactions.
- The Flask API and React UI do **not** handle private keys — only wallet addresses.

### Dry-Run Mode

- Always test with `--dry-run` flag first.
- No transactions are sent; only logged as "[DRY RUN]".
- Once you confirm, remove the flag to enable live trading.

### BSC Chain

- The bot trades on BSC (Binance Smart Chain).
- MetaMask must be connected to BSC network.
- Gas fees are paid in BNB.

### Starting Capital

- Set `STARTING_CAPITAL` to 50 (or your amount in USDT).
- Bot preserves this capital and withdraws only profits.
- Profits are sent to `WITHDRAWAL_ADDRESS` automatically every 7 days.

---

## Troubleshooting

### "Wallet provider not found"
- Make sure MetaMask or Trust Wallet browser extension is installed.
- On mobile, use Trust Wallet's in-app browser.

### API server not responding
- Check that `py -3 bot_api.py` is running on port 5000.
- Verify `http://localhost:5000/api/health` returns `{"alive": true}`.

### Bot not starting
- Ensure the Python bot is configured with your private key.
- Check the Python bot logs for connection errors.

### Trades not showing
- Refresh the dashboard.
- Check the `GET /api/trades` endpoint directly.

---

## Optional: Advanced Integration

To make the backend and bot more tightly integrated:

1. **Share state** between Flask and bot using a database or shared file.
2. **Run the bot subprocess** from the Flask app instead of manually.
3. **Stream live updates** via WebSocket instead of polling.
4. **Add signatures** to wallet connect for authentication.

For now, this setup provides the essential wallet UI ↔ bot bridge.

---

## Quick Start (All 3 Servers)

```bash
# Terminal 1: API Server
cd c:\Users\munira\Downloads
py -3 bot_api.py

# Terminal 2: React Frontend
cd c:\Users\munira\Downloads
npm run dev -- --host

# Terminal 3: Python Bot
cd c:\Users\munira\Desktop
py -3 "dex arb ultimate (1).py" --dry-run

# Open http://localhost:5173 in browser
# Click "Connect Wallet" → Bot dashboard
```

Enjoy! 🚀

