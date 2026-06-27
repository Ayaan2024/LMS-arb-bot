from web3 import Web3
from web3.middleware import geth_poa_middleware
import time
import requests
import json
import os
import sys
import asyncio
import websockets
import threading
import subprocess
import smtplib
from email.message import EmailMessage
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
import argparse

# ============================================
# YOUR SETTINGS
# ============================================
PRIVATE_KEY        = "your_private_key_here"
WALLET_ADDRESS     = "your_0x_wallet_address_here"
QUICKNODE_URL      = "your_quicknode_bsc_http_url_here"
QUICKNODE_WSS      = "your_quicknode_bsc_wss_here"   # wss://your.bsc.quiknode.pro/abc/
WITHDRAWAL_ADDRESS = "your_binance_deposit_address_here"
TELEGRAM_TOKEN     = "your_telegram_bot_token_here"
TELEGRAM_CHAT_ID   = "your_telegram_chat_id_here"
DRY_RUN            = False  # set via --dry-run flag to avoid live txs

# Allow overriding sensitive values via environment variables
PRIVATE_KEY        = os.environ.get("PRIVATE_KEY", PRIVATE_KEY)
WALLET_ADDRESS     = os.environ.get("WALLET_ADDRESS", WALLET_ADDRESS)
QUICKNODE_URL      = os.environ.get("QUICKNODE_URL", QUICKNODE_URL)
QUICKNODE_WSS      = os.environ.get("QUICKNODE_WSS", QUICKNODE_WSS)
WITHDRAWAL_ADDRESS = os.environ.get("WITHDRAWAL_ADDRESS", WITHDRAWAL_ADDRESS)
TELEGRAM_TOKEN     = os.environ.get("TELEGRAM_TOKEN", TELEGRAM_TOKEN)
TELEGRAM_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", TELEGRAM_CHAT_ID)
SLACK_WEBHOOK_URL  = os.environ.get("SLACK_WEBHOOK_URL", "")
SMTP_HOST          = os.environ.get("SMTP_HOST", "")
SMTP_PORT          = int(os.environ.get("SMTP_PORT", "465")) if os.environ.get("SMTP_PORT") else None
SMTP_USER          = os.environ.get("SMTP_USER", "")
SMTP_PASS          = os.environ.get("SMTP_PASS", "")
SMTP_USE_SSL       = os.environ.get("SMTP_USE_SSL", "true").lower() in ("1","true","yes")
ALERT_EMAIL_TO     = os.environ.get("ALERT_EMAIL_TO", "")

# ============================================
# 7-DAY CYCLE SETTINGS
# ============================================
CYCLE_DAYS           = 7
CYCLE_NUMBER         = 1
CYCLE_START          = datetime.now()
CYCLE_END            = CYCLE_START + timedelta(days=CYCLE_DAYS)

# ============================================
# CAPITAL SETTINGS
# ============================================
STARTING_CAPITAL     = 100
MAX_TRADE_SIZE       = 10
MIN_WITHDRAW_AMOUNT  = 5

# ============================================
# DYNAMIC FLASH LOAN SETTINGS
# ============================================
FLASH_LOAN_MAX       = 50000   # Maximum flash loan cap
FLASH_LOAN_MIN       = 5000    # Minimum flash loan amount
FLASH_LOAN_POOL_PCT  = 0.10    # Use max 10% of pool liquidity

# ============================================
# PROTECTION SETTINGS
# ============================================
MIN_GAP_PCT          = 0.8
MAX_SLIPPAGE_PCT     = 0.5
MAX_GAS_GWEI         = 6
MAX_DAILY_LOSS       = 5
TRADE_TIMEOUT        = 60
MIN_LIQUIDITY_USD    = 50000
MAX_PRICE_IMPACT     = 1.0
PRIORITY_FEE_GWEI    = 1.5

# ============================================
# BACKUP RPC URLS (if QuickNode fails)
# ============================================
BACKUP_RPCS = [
    "https://bsc-dataseed1.binance.org/",
    "https://bsc-dataseed2.binance.org/",
    "https://bsc-dataseed3.binance.org/",
    "https://bsc-dataseed4.binance.org/",
]

# ============================================
# TRACKING
# ============================================
cycle_profit         = 0
cycle_loss           = 0
cycle_trades         = 0
cycle_failed         = 0
flash_loan_trades    = 0
triangle_trades      = 0
daily_stats          = {}
all_cycles           = []
total_withdrawn      = 0
blacklisted_tokens   = set()
competitor_pairs     = set()
crash_count          = 0
current_rpc_index    = 0

# ============================================
# CONNECT TO BSC WITH FAILOVER
# ============================================
def connect_to_bsc():
    global current_rpc_index

    # Try primary QuickNode first
    try:
        w3 = Web3(Web3.HTTPProvider(QUICKNODE_URL))
        w3.middleware_onion.inject(geth_poa_middleware, layer=0)
        if w3.is_connected():
            print("✅ Connected via QuickNode")
            return w3
    except:
        pass

    # Try backup RPCs
    for i, rpc in enumerate(BACKUP_RPCS):
        try:
            w3 = Web3(Web3.HTTPProvider(rpc))
            w3.middleware_onion.inject(geth_poa_middleware, layer=0)
            if w3.is_connected():
                current_rpc_index = i
                print(f"✅ Connected via Backup RPC #{i+1}: {rpc}")
                send_telegram(f"⚠️ QuickNode failed — switched to Backup RPC #{i+1}")
                return w3
        except:
            continue

    print("❌ All RPCs failed!")
    send_telegram("🚨 CRITICAL: All RPC connections failed!")
    return None

w3 = connect_to_bsc()
if not w3:
    sys.exit("Could not connect to BSC")

# Add compatibility wrappers so existing code using w3.to_wei / w3.from_wei works
try:
    w3.to_wei = Web3.to_wei
    w3.from_wei = Web3.from_wei
except Exception:
    pass

# ============================================
# DEX ADDRESSES
# ============================================
PANCAKE_ROUTER   = "0x10ED43C718714eb63d5aA57B78B54704E256024E"
PANCAKE_FACTORY  = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73"
BISWAP_ROUTER    = "0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8"
BISWAP_FACTORY   = "0x858E3312ed3A876947EA49d572A7C42DE08af7EE"
APESWAP_ROUTER   = "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b"
APESWAP_FACTORY  = "0x0841BD0B734E4F5853f0dD8d7Ea041c241fb0Da6"
FLASH_CONTRACT_ADDRESS = "0x_YOUR_DEPLOYED_CONTRACT_ADDRESS"
MDEX_ROUTER       = "0x_MDEX_ROUTER_ADDRESS_HERE"
MDEX_FACTORY      = "0x_MDEX_FACTORY_ADDRESS_HERE"

# ============================================
# TOKENS
# ============================================
TOKENS = {
    "BNB":   "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    "USDT":  "0x55d398326f99059fF775485246999027B3197955",
    "BUSD":  "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
    "CAKE":  "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
    "ETH":   "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    # New tokens added
    "DOT":   "0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402",
    "XRP":   "0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE",
    "ADA":   "0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47",
    "DOGE":  "0xbA2aE424d960c26247Dd6c32edC70B295c744C43",
    "LINK":  "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD",
    "MATIC": "0xCC42724C6683B7E57334c4E856f4c9965ED682bD",
    "SOL":   "0x570A5D26f7765Ecb712C0924E4De545B89fD43dF",
    "ATOM":  "0x0Eb3a705fc54725037CC9e008bDede697f62F335",
    "UNI":   "0xBf5140A22578168FD562DCcF235E5D43A02ce9B1",
    "LTC":   "0x4338665CBB7B2485A8855A139b75D5e34AB0DB94",
    "BTCB":  "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    "TWT":   "0x4B0F1812e5Df2A09796481Ff14017e6005508003",
}

# Triangle arbitrage paths (A→B→C→A)
# Original 4 paths
TRIANGLE_PATHS = [
    ["USDT", "BNB",   "CAKE",  "USDT"],
    ["USDT", "BNB",   "ETH",   "USDT"],
    ["USDT", "BUSD",  "BNB",   "USDT"],
    ["USDT", "ETH",   "BNB",   "USDT"],

    # New paths — more opportunities
    ["USDT", "BNB",   "DOT",   "USDT"],
    ["USDT", "BNB",   "XRP",   "USDT"],
    ["USDT", "BNB",   "ADA",   "USDT"],
    ["USDT", "BNB",   "DOGE",  "USDT"],
    ["USDT", "BNB",   "LINK",  "USDT"],
    ["USDT", "BNB",   "MATIC", "USDT"],
    ["USDT", "BNB",   "SOL",   "USDT"],
    ["USDT", "BNB",   "ATOM",  "USDT"],
    ["USDT", "BNB",   "UNI",   "USDT"],
    ["USDT", "BNB",   "LTC",   "USDT"],
    ["USDT", "ETH",   "LINK",  "USDT"],
    ["USDT", "ETH",   "UNI",   "USDT"],
    ["USDT", "CAKE",  "BNB",   "USDT"],
    ["USDT", "CAKE",  "ETH",   "USDT"],
    ["USDT", "BUSD",  "CAKE",  "USDT"],
    ["USDT", "BUSD",  "ETH",   "USDT"],
    ["USDT", "DOT",   "BNB",   "USDT"],
    ["USDT", "MATIC", "ETH",   "USDT"],
    ["USDT", "SOL",   "BNB",   "USDT"],
    ["USDT", "DOGE",  "BNB",   "USDT"],
    ["USDT", "ADA",   "BNB",   "USDT"],
    ["USDT", "XRP",   "BNB",   "USDT"],
    ["USDT", "LTC",   "BNB",   "USDT"],

    # User-requested additional triangle paths
    ["BNB",  "USDT",  "XRP",   "BNB"],
    ["BNB",  "ETH",   "BTCB",  "BNB"],
    ["USDT", "SOL",   "BNB",   "USDT"],
    ["BNB",  "ADA",   "USDT",  "BNB"],
    ["CAKE", "BNB",   "BUSD",  "CAKE"],
    ["BNB",  "DOT",   "USDT",  "BNB"],
    ["USDT", "MATIC", "BNB",   "USDT"],
    ["BNB",  "LINK",  "USDT",  "BNB"],
    ["USDT", "DOGE",  "BNB",   "USDT"],
    ["BNB",  "TWT",   "CAKE",  "BNB"],

    # Extra paths to make 36 total
    ["USDT", "BTCB",  "BNB",   "USDT"],
    ["USDT", "TWT",   "CAKE",  "USDT"],
]

# ============================================
# ABIs
# ============================================
ROUTER_ABI = [
    {
        "inputs": [
            {"internalType": "uint256",   "name": "amountIn",  "type": "uint256"},
            {"internalType": "address[]", "name": "path",      "type": "address[]"}
        ],
        "name": "getAmountsOut",
        "outputs": [{"internalType": "uint256[]", "name": "amounts", "type": "uint256[]"}],
        "stateMutability": "view", "type": "function"
    },
    {
        "inputs": [
            {"internalType": "uint256",   "name": "amountIn",     "type": "uint256"},
            {"internalType": "uint256",   "name": "amountOutMin", "type": "uint256"},
            {"internalType": "address[]", "name": "path",         "type": "address[]"},
            {"internalType": "address",   "name": "to",           "type": "address"},
            {"internalType": "uint256",   "name": "deadline",     "type": "uint256"}
        ],
        "name": "swapExactTokensForTokens",
        "outputs": [{"internalType": "uint256[]", "name": "amounts", "type": "uint256[]"}],
        "stateMutability": "nonpayable", "type": "function"
    }
]

FACTORY_ABI = [
    {
        "inputs": [
            {"internalType": "address", "name": "tokenA", "type": "address"},
            {"internalType": "address", "name": "tokenB", "type": "address"}
        ],
        "name": "getPair",
        "outputs": [{"internalType": "address", "name": "pair", "type": "address"}],
        "stateMutability": "view", "type": "function"
    }
]

PAIR_ABI = [
    {
        "inputs": [],
        "name": "getReserves",
        "outputs": [
            {"internalType": "uint112", "name": "_reserve0", "type": "uint112"},
            {"internalType": "uint112", "name": "_reserve1", "type": "uint112"},
            {"internalType": "uint32",  "name": "_blockTimestampLast", "type": "uint32"}
        ],
        "stateMutability": "view", "type": "function"
    },
    {
        "inputs": [],
        "name": "token0",
        "outputs": [{"internalType": "address", "name": "", "type": "address"}],
        "stateMutability": "view", "type": "function"
    }
]

ERC20_ABI = [
    {
        "inputs": [
            {"internalType": "address", "name": "to",     "type": "address"},
            {"internalType": "uint256", "name": "amount", "type": "uint256"}
        ],
        "name": "transfer",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "nonpayable", "type": "function"
    },
    {
        "inputs": [{"internalType": "address", "name": "account", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view", "type": "function"
    },
    {
        "inputs": [],
        "name": "totalSupply",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view", "type": "function"
    },
    {
        "inputs": [
            {"internalType": "address", "name": "spender", "type": "address"},
            {"internalType": "uint256", "name": "amount",  "type": "uint256"}
        ],
        "name": "approve",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "nonpayable", "type": "function"
    },
    {
        "inputs": [
            {"internalType": "address", "name": "owner",   "type": "address"},
            {"internalType": "address", "name": "spender", "type": "address"}
        ],
        "name": "allowance",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view", "type": "function"
    }
]

# ============================================
# LOAD CONTRACTS
# ============================================
pancake         = w3.eth.contract(address=Web3.to_checksum_address(PANCAKE_ROUTER),  abi=ROUTER_ABI)
biswap          = w3.eth.contract(address=Web3.to_checksum_address(BISWAP_ROUTER),   abi=ROUTER_ABI)
mdex            = w3.eth.contract(address=Web3.to_checksum_address(MDEX_ROUTER),     abi=ROUTER_ABI)
pancake_factory = w3.eth.contract(address=Web3.to_checksum_address(PANCAKE_FACTORY), abi=FACTORY_ABI)
biswap_factory  = w3.eth.contract(address=Web3.to_checksum_address(BISWAP_FACTORY),  abi=FACTORY_ABI)
mdex_factory    = w3.eth.contract(address=Web3.to_checksum_address(MDEX_FACTORY),    abi=FACTORY_ABI)
usdt_contract   = w3.eth.contract(address=Web3.to_checksum_address(TOKENS["USDT"]),  abi=ERC20_ABI)

ROUTERS = {
    "PancakeSwap": pancake,
    "Biswap":      biswap,
    "MDEX":        mdex,
}
FACTORIES = {
    "PancakeSwap": pancake_factory,
    "Biswap":      biswap_factory,
    "MDEX":        mdex_factory,
}

# ============================================
# WEBSOCKET — REAL TIME PRICE FEED
# ============================================
latest_block     = None
ws_connected     = False
ws_price_cache   = {}  # Cached prices from WebSocket

def start_websocket():
    """Run WebSocket listener in background thread"""
    async def listen():
        global latest_block, ws_connected
        wss_url = QUICKNODE_WSS

        if not wss_url or wss_url == "your_quicknode_bsc_wss_here":
            print("⚠️  WebSocket URL not set — using HTTP polling only")
            return

        while True:
            try:
                async with websockets.connect(wss_url) as ws:
                    ws_connected = True
                    print("⚡ WebSocket connected — real-time price feed active!")
                    send_telegram("⚡ WebSocket connected — ultra-fast mode!")

                    # Subscribe to new blocks
                    await ws.send(json.dumps({
                        "jsonrpc": "2.0",
                        "id":      1,
                        "method":  "eth_subscribe",
                        "params":  ["newHeads"]
                    }))

                    async for message in ws:
                        data = json.loads(message)
                        if "params" in data:
                            block = data["params"]["result"]
                            latest_block = int(block["number"], 16)

            except Exception as e:
                ws_connected = False
                print(f"⚠️  WebSocket disconnected: {e} — reconnecting in 5s...")
                await asyncio.sleep(5)

    def run_async():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(listen())

    ws_thread = threading.Thread(target=run_async, daemon=True)
    ws_thread.start()
    print("🔌 WebSocket listener started in background")

# Note: websocket listener will be started from run_bot() (avoids starting at import)

# ============================================
# FEATURE 1 — TELEGRAM ALERTS
# ============================================
def send_telegram(message):
    # Telegram (optional)
    if TELEGRAM_TOKEN and TELEGRAM_TOKEN != "your_telegram_bot_token_here":
        try:
            if DRY_RUN:
                print(f"  [DRY RUN] Telegram: {message}")
            else:
                url  = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
                data = {"chat_id": TELEGRAM_CHAT_ID, "text": message, "parse_mode": "HTML"}
                requests.post(url, data=data, timeout=5)
        except Exception:
            pass

    # Slack (optional)
    def send_slack(msg):
        if not SLACK_WEBHOOK_URL:
            return
        try:
            if DRY_RUN:
                print(f"  [DRY RUN] Slack: {msg}")
            else:
                requests.post(SLACK_WEBHOOK_URL, json={"text": msg}, timeout=5)
        except Exception:
            pass

    # Email (optional)
    def send_email(msg):
        if not SMTP_HOST or not ALERT_EMAIL_TO:
            return
        try:
            if DRY_RUN:
                print(f"  [DRY RUN] Email to {ALERT_EMAIL_TO}: {msg}")
                return

            em = EmailMessage()
            em["From"] = SMTP_USER or f"noreply@{SMTP_HOST}"
            em["To"] = ALERT_EMAIL_TO
            em["Subject"] = "DEX Arb Alert"
            em.set_content(msg)

            if SMTP_USE_SSL or (SMTP_PORT == 465):
                with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT or 465) as s:
                    if SMTP_USER:
                        s.login(SMTP_USER, SMTP_PASS)
                    s.send_message(em)
            else:
                with smtplib.SMTP(SMTP_HOST, SMTP_PORT or 587) as s:
                    s.starttls()
                    if SMTP_USER:
                        s.login(SMTP_USER, SMTP_PASS)
                    s.send_message(em)
        except Exception:
            pass

    # Deliver to other channels
    send_slack(message)
    send_email(message)

# ============================================
# FEATURE 2 — AUTO RESTART ON CRASH
# ============================================
def restart_bot():
    global crash_count
    crash_count += 1
    print(f"\n🔄 Auto-restarting bot (crash #{crash_count})...")
    send_telegram(f"⚠️ Bot crashed #{crash_count} — auto restarting...")
    time.sleep(10)
    os.execv(sys.executable, [sys.executable] + sys.argv)

# ============================================
# FEATURE 3 — GAS PRICE PREDICTOR
# ============================================
def predict_gas():
    try:
        # Get last 5 blocks gas prices
        block_num    = w3.eth.block_number
        gas_prices   = []
        for i in range(5):
            block = w3.eth.get_block(block_num - i)
            if block and block.get("baseFeePerGas"):
                gas_prices.append(float(w3.from_wei(block["baseFeePerGas"], "gwei")))

        if not gas_prices:
            return float(w3.from_wei(w3.eth.gas_price, "gwei"))

        avg_gas   = sum(gas_prices) / len(gas_prices)
        trend     = gas_prices[0] - gas_prices[-1]
        predicted = avg_gas + (trend * 0.5)

        print(f"  ⛽ Gas predictor: avg={avg_gas:.2f} trend={trend:+.2f} predicted={predicted:.2f} gwei")
        return max(predicted, 1.0)
    except:
        return float(w3.from_wei(w3.eth.gas_price, "gwei"))

# ============================================
# FEATURE 4 — COMPETITOR BOT DETECTOR
# ============================================
def detect_competitors(token_in, token_out):
    try:
        pair_key  = f"{token_in}-{token_out}"
        block_num = w3.eth.block_number
        block     = w3.eth.get_block(block_num, full_transactions=True)

        competitor_count = 0
        for tx in block.get("transactions", [])[:50]:
            to = tx.get("to", "")
            if to and to.lower() in [PANCAKE_ROUTER.lower(), BISWAP_ROUTER.lower()]:
                competitor_count += 1

        if competitor_count > 5:
            print(f"  🤖 High bot activity detected: {competitor_count} bots on this block!")
            competitor_pairs.add(pair_key)
            return True

        if pair_key in competitor_pairs:
            competitor_pairs.discard(pair_key)

        print(f"  🤖 Bot activity: {competitor_count} (safe)")
        return False
    except:
        return False

# ============================================
# FEATURE 5 — PROFIT SIMULATOR
# ============================================
def simulate_profit(buy_dex, sell_dex, token_in, token_out, amount_in):
    try:
        buy_router  = ROUTERS[buy_dex]
        sell_router = ROUTERS[sell_dex]
        path_buy    = [Web3.to_checksum_address(token_in), Web3.to_checksum_address(token_out)]
        path_sell   = [Web3.to_checksum_address(token_out), Web3.to_checksum_address(token_in)]

        # Simulate buy
        buy_amounts  = buy_router.functions.getAmountsOut(amount_in, path_buy).call()
        tokens_out   = buy_amounts[-1]

        # Simulate sell
        sell_amounts = sell_router.functions.getAmountsOut(tokens_out, path_sell).call()
        usdt_back    = sell_amounts[-1]

        # Calculate profit
        gross_profit  = usdt_back - amount_in
        buy_fee       = int(amount_in * 0.002)
        sell_fee      = int(tokens_out * 0.002)
        gas_cost_wei  = w3.to_wei(0.20, "ether")
        net_profit_wei= gross_profit - buy_fee - sell_fee - gas_cost_wei
        net_profit    = float(w3.from_wei(max(net_profit_wei, 0), "ether"))

        print(f"""
  💹 PROFIT SIMULATION:
     Amount in:    {float(w3.from_wei(amount_in, 'ether')):.2f} USDT
     Tokens out:   {float(w3.from_wei(tokens_out, 'ether')):.6f}
     USDT back:    {float(w3.from_wei(usdt_back, 'ether')):.4f}
     Gross profit: {float(w3.from_wei(gross_profit, 'ether')):.4f} USDT
     Fees:         ~$0.20
     NET PROFIT:   ${net_profit:.4f} USDT
     VERDICT:      {"✅ PROFITABLE" if net_profit > 0 else "❌ NOT PROFITABLE"}
        """)
        return net_profit, net_profit > 0

    except Exception as e:
        print(f"  ⚠️  Simulation failed: {e}")
        return 0, False

# ============================================
# FEATURE 6 — FLASH LOAN ROUTE CHECKER
# ============================================
def check_flash_loan_route(buy_dex, sell_dex, token_in, token_out, flash_amount):
    try:
        print(f"  ⚡ Checking flash loan route...")
        buy_router  = ROUTERS[buy_dex]
        sell_router = ROUTERS[sell_dex]
        path_buy    = [Web3.to_checksum_address(token_in), Web3.to_checksum_address(token_out)]
        path_sell   = [Web3.to_checksum_address(token_out), Web3.to_checksum_address(token_in)]

        # Simulate with flash loan amount
        buy_amounts  = buy_router.functions.getAmountsOut(flash_amount, path_buy).call()
        tokens_out   = buy_amounts[-1]
        sell_amounts = sell_router.functions.getAmountsOut(tokens_out, path_sell).call()
        usdt_back    = sell_amounts[-1]

        flash_fee     = int(flash_amount * 0.0009)
        repay_amount  = flash_amount + flash_fee
        gross_profit  = usdt_back - repay_amount
        gas_cost_wei  = w3.to_wei(0.50, "ether")
        net_profit_wei= gross_profit - gas_cost_wei
        net_profit    = float(w3.from_wei(max(net_profit_wei, 0), "ether"))

        print(f"""
  ⚡ FLASH LOAN ROUTE CHECK:
     Borrow:       ${float(w3.from_wei(flash_amount, 'ether')):,.0f} USDT
     Tokens out:   {float(w3.from_wei(tokens_out, 'ether')):.6f}
     USDT back:    {float(w3.from_wei(usdt_back, 'ether')):,.2f}
     Loan fee:     ${float(w3.from_wei(flash_fee, 'ether')):.2f}
     Gas:          ~$0.50
     NET PROFIT:   ${net_profit:.2f}
     ROUTE:        {"✅ VIABLE" if net_profit > 0 else "❌ NOT VIABLE"}
        """)
        return net_profit, net_profit > 0

    except Exception as e:
        print(f"  ⚠️  Flash loan route check failed: {e}")
        return 0, False

# ============================================
# FEATURE 7 — TRIANGLE ARBITRAGE
# ============================================
def check_triangle_arbitrage(router_name):
    global cycle_profit, triangle_trades
    router = ROUTERS[router_name]
    amount_in = w3.to_wei(MAX_TRADE_SIZE, "ether")

    print(f"\n  🔄 Checking triangle arbitrage on {router_name}...")

    for path_names in TRIANGLE_PATHS:
        try:
            path_addresses = [Web3.to_checksum_address(TOKENS[t]) for t in path_names]
            amounts        = router.functions.getAmountsOut(amount_in, path_addresses).call()
            final_amount   = amounts[-1]
            profit_wei     = final_amount - amount_in
            profit         = float(w3.from_wei(profit_wei, "ether"))
            path_str       = " → ".join(path_names)

            if profit > 0.05:
                print(f"""
  🔺 TRIANGLE OPPORTUNITY!
     Path:    {path_str}
     In:      ${float(w3.from_wei(amount_in, 'ether')):.2f}
     Out:     ${float(w3.from_wei(final_amount, 'ether')):.4f}
     Profit:  ${profit:.4f}
                """)

                # Simulate first
                net_profit, is_profitable = simulate_profit(
                    router_name, router_name,
                    TOKENS[path_names[0]], TOKENS[path_names[1]], amount_in
                )

                if is_profitable:
                    print(f"  ✅ Triangle trade viable — executing...")
                    if DRY_RUN:
                        print(f"  [DRY RUN] Would execute triangle swap: {path_str} profit=${profit:.4f}")
                        cycle_profit  += profit
                        triangle_trades += 1
                        record_daily_stats(profit, 0)
                        send_telegram(f"[DRY RUN] 🔺 Triangle Arb simulated: {path_str} Profit: ${profit:.4f}")
                        continue
                    # Execute triangle trade
                    nonce    = w3.eth.get_transaction_count(WALLET_ADDRESS)
                    deadline = int(time.time()) + TRADE_TIMEOUT
                    min_out  = int(amount_in * 1.001)  # Must get back at least 0.1% more

                    tx = router.functions.swapExactTokensForTokens(
                        amount_in, min_out, path_addresses, WALLET_ADDRESS, deadline
                    ).build_transaction({
                        "from":     WALLET_ADDRESS,
                        "gas":      400000,
                        "gasPrice": w3.to_wei(MAX_GAS_GWEI, "gwei"),
                        "nonce":    nonce,
                    })

                    signed  = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
                    tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
                    print(f"  ✅ Triangle TX: https://bscscan.com/tx/{tx_hash.hex()}")

                    cycle_profit  += profit
                    triangle_trades += 1
                    record_daily_stats(profit, 0)
                    send_telegram(
                        f"🔺 Triangle Arb!\n"
                        f"Path: {path_str}\n"
                        f"Profit: ${profit:.4f}"
                    )
            else:
                print(f"  ⏭  {path_str}: ${profit:.4f} (not profitable)")

        except Exception as e:
            print(f"  ⚠️  Triangle path error: {e}")

# ============================================
# SECURITY — RUG PULL DETECTION
# ============================================
def is_safe_token(token_address):
    try:
        token_address = Web3.to_checksum_address(token_address)
        known_safe    = [v.lower() for v in TOKENS.values()]
        if token_address.lower() in known_safe:
            return True
        if token_address.lower() in blacklisted_tokens:
            print(f"  🚫 Blacklisted token — skipping")
            return False

        token  = w3.eth.contract(address=token_address, abi=ERC20_ABI)
        supply = token.functions.totalSupply().call()
        if supply == 0:
            print(f"  🚨 RUG: Zero supply!")
            blacklisted_tokens.add(token_address.lower())
            return False

        print(f"  ✅ Token safe")
        return True
    except:
        return False

# ============================================
# SECURITY — LIQUIDITY CHECK
# ============================================
def check_liquidity(factory, token_in, token_out):
    try:
        pair_addr = factory.functions.getPair(
            Web3.to_checksum_address(token_in),
            Web3.to_checksum_address(token_out)
        ).call()

        if pair_addr == "0x0000000000000000000000000000000000000000":
            print(f"  ⚠️  No pool found")
            return False

        pair     = w3.eth.contract(address=pair_addr, abi=PAIR_ABI)
        reserves = pair.functions.getReserves().call()
        token0   = pair.functions.token0().call()

        usdt_reserve   = reserves[0] if token0.lower() == TOKENS["USDT"].lower() else reserves[1]
        usdt_liquidity = float(w3.from_wei(usdt_reserve, "ether"))

        if usdt_liquidity < MIN_LIQUIDITY_USD:
            print(f"  ⚠️  Low liquidity: ${usdt_liquidity:.0f}")
            return False

        print(f"  ✅ Liquidity: ${usdt_liquidity:,.0f}")
        return True
    except:
        return False

# ============================================
# MEV PROTECTION
# ============================================
def get_mev_safe_params():
    predicted_gas = predict_gas()
    safe_gas      = min(predicted_gas + PRIORITY_FEE_GWEI, MAX_GAS_GWEI)
    deadline      = int(time.time()) + 6

    print(f"  🛡️  MEV: gas={safe_gas:.1f}gwei deadline=2blocks")
    return { "gasPrice": w3.to_wei(safe_gas, "gwei"), "deadline": deadline, "gas": 300000 }

# ============================================
# SMART CONTRACT — EXACT APPROVAL ONLY
# ============================================
def approve_token(token_address, spender_address, amount):
    try:
        if DRY_RUN:
            print(f"  [DRY RUN] Approve {amount} for spender {spender_address}")
            return True
        token   = w3.eth.contract(address=Web3.to_checksum_address(token_address), abi=ERC20_ABI)
        current = token.functions.allowance(WALLET_ADDRESS, spender_address).call()
        if current >= amount:
            return True

        nonce = w3.eth.get_transaction_count(WALLET_ADDRESS)
        tx    = token.functions.approve(
            Web3.to_checksum_address(spender_address), amount
        ).build_transaction({
            "from": WALLET_ADDRESS, "gas": 100000,
            "gasPrice": w3.to_wei(MAX_GAS_GWEI, "gwei"), "nonce": nonce,
        })
        signed  = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
        w3.eth.wait_for_transaction_receipt(tx_hash, timeout=30)
        print(f"  ✅ Token approved (exact amount)")
        return True
    except Exception as e:
        print(f"  ❌ Approval failed: {e}")
        return False

# ============================================
# DYNAMIC FLASH LOAN SIZING
# ============================================
def get_dynamic_flash_amount(buy_dex, token_in, token_out):
    """
    Automatically calculate the safest and most
    profitable flash loan amount based on pool liquidity
    """
    try:
        factory = FACTORIES.get(buy_dex)
        if not factory:
            print(f"  ⚠️  No factory for {buy_dex} — using minimum")
            return w3.to_wei(FLASH_LOAN_MIN, "ether")

        # Get pair address
        pair_addr = factory.functions.getPair(
            Web3.to_checksum_address(token_in),
            Web3.to_checksum_address(token_out)
        ).call()

        if pair_addr == "0x0000000000000000000000000000000000000000":
            print(f"  ⚠️  No pool found — using minimum")
            return w3.to_wei(FLASH_LOAN_MIN, "ether")

        # Get pool reserves
        pair     = w3.eth.contract(address=pair_addr, abi=PAIR_ABI)
        reserves = pair.functions.getReserves().call()
        token0   = pair.functions.token0().call()

        # Get USDT reserve
        if token0.lower() == TOKENS["USDT"].lower():
            usdt_reserve = reserves[0]
        else:
            usdt_reserve = reserves[1]

        pool_size_usd = float(w3.from_wei(usdt_reserve, "ether"))

        # Calculate safe amount (10% of pool)
        safe_amount = pool_size_usd * FLASH_LOAN_POOL_PCT

        # Apply min and max limits
        final_amount = max(FLASH_LOAN_MIN, min(safe_amount, FLASH_LOAN_MAX))

        print(f"""
  ⚡ DYNAMIC FLASH LOAN SIZING:
     Pool size:     ${pool_size_usd:,.0f}
     10% of pool:   ${safe_amount:,.0f}
     Min allowed:   ${FLASH_LOAN_MIN:,}
     Max allowed:   ${FLASH_LOAN_MAX:,}
     Final amount:  ${final_amount:,.0f} ✅
        """)

        return w3.to_wei(int(final_amount), "ether")

    except Exception as e:
        print(f"  ⚠️  Dynamic sizing failed: {e} — using minimum ${FLASH_LOAN_MIN:,}")
        return w3.to_wei(FLASH_LOAN_MIN, "ether")

# ============================================
# FLASH LOAN EXECUTION
# ============================================
def execute_flash_loan(buy_dex, sell_dex, token_in, token_out, gap_pct):
    global flash_loan_trades, cycle_profit

    # Dynamic flash loan amount based on pool liquidity
    flash_amount = get_dynamic_flash_amount(buy_dex, token_in, token_out)
    flash_usd    = float(w3.from_wei(flash_amount, "ether"))

    print(f"  ⚡ Flash loan amount: ${flash_usd:,.0f} USDT (dynamic)")

    # Route check first
    net_profit, viable = check_flash_loan_route(buy_dex, sell_dex, token_in, token_out, flash_amount)
    if not viable:
        print(f"  ❌ Flash loan route not viable — skipping")
        return False
    # In dry-run mode, simulate flash loan without sending transactions
    if DRY_RUN:
        print(f"  [DRY RUN] Flash loan simulated: borrow ${float(w3.from_wei(flash_amount,'ether')):.2f} profit=${net_profit:.2f}")
        if net_profit > 0:
            cycle_profit    += net_profit
            flash_loan_trades += 1
            record_daily_stats(net_profit, 0)
        return True

    try:
        mev_params = get_mev_safe_params()

        router_address = PANCAKE_ROUTER if buy_dex == "PancakeSwap" else BISWAP_ROUTER
        approve_token(TOKENS["USDT"], router_address, flash_amount)

        FLASH_ABI = [{
            "inputs": [
                {"internalType": "address",   "name": "borrowToken",  "type": "address"},
                {"internalType": "uint256",   "name": "borrowAmount", "type": "uint256"},
                {"internalType": "address",   "name": "buyRouter",    "type": "address"},
                {"internalType": "address",   "name": "sellRouter",   "type": "address"},
                {"internalType": "address[]", "name": "path",         "type": "address[]"}
            ],
            "name": "executeArbitrage",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function"
        }]

        flash_contract = w3.eth.contract(
            address=Web3.to_checksum_address(FLASH_CONTRACT_ADDRESS),
            abi=FLASH_ABI
        )

        buy_router  = PANCAKE_ROUTER if buy_dex  == "PancakeSwap" else BISWAP_ROUTER
        sell_router = PANCAKE_ROUTER if sell_dex == "PancakeSwap" else BISWAP_ROUTER
        path        = [Web3.to_checksum_address(TOKENS["USDT"]), Web3.to_checksum_address(TOKENS["BNB"])]
        nonce       = w3.eth.get_transaction_count(WALLET_ADDRESS)

        tx = flash_contract.functions.executeArbitrage(
            Web3.to_checksum_address(TOKENS["USDT"]),
            flash_amount,
            Web3.to_checksum_address(buy_router),
            Web3.to_checksum_address(sell_router),
            path
        ).build_transaction({
            "from":     WALLET_ADDRESS,
            "gas":      500000,
            "gasPrice": mev_params["gasPrice"],
            "nonce":    nonce,
        })

        signed  = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=30)

        if receipt["status"] == 1:
            cycle_profit    += net_profit
            flash_loan_trades += 1
            record_daily_stats(net_profit, 0)
            print(f"  💰 Flash loan profit: ${net_profit:.2f} ✅")
            send_telegram(
                f"⚡ Flash Loan Success!\n"
                f"Pair: {token_in}→{token_out}\n"
                f"Buy: {buy_dex} | Sell: {sell_dex}\n"
                f"Profit: ${net_profit:.2f}\n"
                f"TX: https://bscscan.com/tx/{tx_hash.hex()}"
            )
            return True
        else:
            print(f"  ❌ Flash loan reverted")
            return False

    except Exception as e:
        print(f"  ❌ Flash loan failed: {e}")
        return False

# ============================================
# NORMAL TRADE EXECUTION
# ============================================
def execute_normal_trade(buy_dex, sell_dex, token_in, token_out, amount_in, buy_price):
    global cycle_profit, cycle_loss, cycle_trades, cycle_failed

    try:
        # Simulate first
        net_profit, is_profitable = simulate_profit(buy_dex, sell_dex, token_in, token_out, amount_in)
        if not is_profitable:
            print(f"  ❌ Simulation says not profitable — skipping")
            return False

        mev_params     = get_mev_safe_params()
        router_address = PANCAKE_ROUTER if buy_dex == "PancakeSwap" else BISWAP_ROUTER
        approve_token(token_in, router_address, amount_in)

        router   = ROUTERS[buy_dex]
        min_out  = int(buy_price * (1 - MAX_SLIPPAGE_PCT / 100))
        path     = [Web3.to_checksum_address(token_in), Web3.to_checksum_address(token_out)]
        nonce    = w3.eth.get_transaction_count(WALLET_ADDRESS)

        if DRY_RUN:
            print(f"  [DRY RUN] Would execute normal trade: buy={buy_dex} sell={sell_dex} profit=${net_profit:.4f}")
            cycle_profit += net_profit
            cycle_trades += 1
            record_daily_stats(net_profit, 0)
            send_telegram(f"[DRY RUN] ✅ Trade simulated! Buy: {buy_dex} | Sell: {sell_dex} | Profit: ${net_profit:.4f}")
            return True

        tx = router.functions.swapExactTokensForTokens(
            amount_in, min_out, path, WALLET_ADDRESS, mev_params["deadline"]
        ).build_transaction({
            "from": WALLET_ADDRESS, "gas": mev_params["gas"],
            "gasPrice": mev_params["gasPrice"], "nonce": nonce,
        })

        signed  = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
        print(f"  ✅ TX: https://bscscan.com/tx/{tx_hash.hex()}")

        cycle_profit += net_profit
        cycle_trades += 1
        record_daily_stats(net_profit, 0)
        send_telegram(
            f"✅ Trade Executed!\n"
            f"Buy: {buy_dex} | Sell: {sell_dex}\n"
            f"Profit: ${net_profit:.4f}"
        )
        return True

    except Exception as e:
        print(f"  ❌ Trade failed: {e}")
        cycle_failed += 1
        return False

# ============================================
# GET PRICE
# ============================================
def get_price(router, token_in, token_out, amount_in):
    try:
        path    = [Web3.to_checksum_address(token_in), Web3.to_checksum_address(token_out)]
        amounts = router.functions.getAmountsOut(amount_in, path).call()
        return amounts[-1]
    except:
        return 0

# ============================================
# RECORD DAILY STATS
# ============================================
def record_daily_stats(profit, loss):
    today = datetime.now().strftime("%Y-%m-%d")
    if today not in daily_stats:
        daily_stats[today] = {"profit": 0, "loss": 0, "trades": 0}
    daily_stats[today]["profit"] += profit
    daily_stats[today]["loss"]   += loss
    daily_stats[today]["trades"] += 1

# ============================================
# PROTECTIONS
# ============================================
def gas_is_safe():
    gas_gwei = predict_gas()
    if gas_gwei > MAX_GAS_GWEI:
        print(f"  ⛽ Gas too high: {gas_gwei:.1f} gwei")
        return False
    return True

def within_loss_limit():
    today      = datetime.now().strftime("%Y-%m-%d")
    today_loss = daily_stats.get(today, {}).get("loss", 0)
    if today_loss >= MAX_DAILY_LOSS:
        print(f"  🛑 Daily loss limit reached: ${today_loss:.2f}")
        return False
    return True

def check_balance():
    bnb = float(w3.from_wei(w3.eth.get_balance(WALLET_ADDRESS), "ether"))
    if bnb < 0.005:
        print(f"  ⚠️  Low BNB: {bnb:.5f}")
        send_telegram(f"⚠️ Low BNB balance: {bnb:.5f} — top up needed!")
        return False
    return True

def get_usdt_balance():
    try:
        bal = usdt_contract.functions.balanceOf(Web3.to_checksum_address(WALLET_ADDRESS)).call()
        return float(w3.from_wei(bal, "ether"))
    except:
        return 0

# ============================================
# AUTO WITHDRAW ALL PROFITS
# ============================================
def auto_withdraw():
    global total_withdrawn
    net_profit = cycle_profit - cycle_loss

    if net_profit < MIN_WITHDRAW_AMOUNT:
        print(f"  ⚠️  Profit ${net_profit:.2f} below minimum")
        return

    usdt_balance = get_usdt_balance()
    withdraw_amt = min(net_profit, usdt_balance - STARTING_CAPITAL)

    if withdraw_amt <= 0:
        return

    try:
        withdraw_wei = w3.to_wei(round(withdraw_amt, 2), "ether")
        nonce        = w3.eth.get_transaction_count(WALLET_ADDRESS)

        tx = usdt_contract.functions.transfer(
            Web3.to_checksum_address(WITHDRAWAL_ADDRESS), withdraw_wei
        ).build_transaction({
            "from": WALLET_ADDRESS, "gas": 100000,
            "gasPrice": w3.to_wei(MAX_GAS_GWEI, "gwei"), "nonce": nonce,
        })

        signed  = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
        total_withdrawn += withdraw_amt

        msg = (
            f"💸 Auto Withdrawal!\n"
            f"Amount: ${withdraw_amt:.2f} USDT\n"
            f"To: {WITHDRAWAL_ADDRESS[:6]}...{WITHDRAWAL_ADDRESS[-4:]}\n"
            f"Capital safe: ${STARTING_CAPITAL}\n"
            f"TX: https://bscscan.com/tx/{tx_hash.hex()}"
        )
        print(f"\n✅ WITHDRAWN ${withdraw_amt:.2f} USDT → {WITHDRAWAL_ADDRESS[:6]}...")
        send_telegram(msg)

    except Exception as e:
        print(f"  ❌ Withdrawal failed: {e}")

# ============================================
# CYCLE REPORT
# ============================================
def print_cycle_report():
    net      = cycle_profit - cycle_loss
    win_rate = (cycle_trades + triangle_trades + flash_loan_trades - cycle_failed) / max(cycle_trades + triangle_trades + flash_loan_trades, 1) * 100

    report = f"""
╔══════════════════════════════════════════╗
  📊 CYCLE #{CYCLE_NUMBER} — 7 DAY REPORT
  {CYCLE_START.strftime('%b %d')} → {CYCLE_END.strftime('%b %d %Y')}
╠══════════════════════════════════════════╣
  Normal Trades:     {cycle_trades}
  Flash Loan Trades: {flash_loan_trades}
  Triangle Trades:   {triangle_trades}
  Failed:            {cycle_failed}
  Win Rate:          {win_rate:.1f}%
╠══════════════════════════════════════════╣
  Gross Profit:      ${cycle_profit:.2f}
  Total Loss:        ${cycle_loss:.2f}
  Net Profit:        ${net:.2f}
╠══════════════════════════════════════════╣
  DAILY BREAKDOWN:"""

    print(report)
    for day, stats in sorted(daily_stats.items()):
        net_day = stats["profit"] - stats["loss"]
        emoji   = "✅" if net_day >= 0 else "❌"
        print(f"  {emoji} {day}: ${net_day:.2f} ({stats['trades']} trades)")

    print(f"""
╠══════════════════════════════════════════╣
  Total Withdrawn:   ${total_withdrawn:.2f}
  Crash Restarts:    {crash_count}
╚══════════════════════════════════════════╝""")

    send_telegram(
        f"📊 Cycle #{CYCLE_NUMBER} Complete!\n"
        f"Net Profit: ${net:.2f}\n"
        f"Trades: {cycle_trades + flash_loan_trades + triangle_trades}\n"
        f"Win Rate: {win_rate:.1f}%\n"
        f"Withdrawing profits now..."
    )

# ============================================
# START NEW CYCLE
# ============================================
def start_new_cycle():
    global CYCLE_NUMBER, CYCLE_START, CYCLE_END
    global cycle_profit, cycle_loss, cycle_trades
    global cycle_failed, flash_loan_trades, triangle_trades, daily_stats

    all_cycles.append({
        "cycle":  CYCLE_NUMBER, "profit": cycle_profit,
        "loss":   cycle_loss,   "trades": cycle_trades + flash_loan_trades + triangle_trades,
    })

    CYCLE_NUMBER     += 1
    CYCLE_START       = datetime.now()
    CYCLE_END         = CYCLE_START + timedelta(days=CYCLE_DAYS)
    cycle_profit      = 0
    cycle_loss        = 0
    cycle_trades      = 0
    cycle_failed      = 0
    flash_loan_trades = 0
    triangle_trades   = 0
    daily_stats       = {}

    send_telegram(f"🔄 Cycle #{CYCLE_NUMBER} Started!\nEnds: {CYCLE_END.strftime('%b %d %Y %H:%M')}")
    print(f"\n🔄 CYCLE #{CYCLE_NUMBER} STARTED — Ends {CYCLE_END.strftime('%b %d %Y %H:%M')}")

def check_cycle_end():
    if datetime.now() >= CYCLE_END:
        print_cycle_report()
        auto_withdraw()
        print("⏸  Pausing 60 seconds...")
        time.sleep(60)
        start_new_cycle()
        return True
    return False

def time_remaining():
    r = CYCLE_END - datetime.now()
    return f"{r.days}d {r.seconds//3600}h {(r.seconds%3600)//60}m"

# ============================================
# MAIN ARBITRAGE LOGIC
# ============================================
def check_arbitrage():
    global w3
    if not within_loss_limit(): return
    if not gas_is_safe():       return
    if not check_balance():     return

    # Check RPC connection
    if not w3.is_connected():
        print("  ⚠️  RPC disconnected — reconnecting...")
        w3 = connect_to_bsc()
        if not w3:
            return

    token_in  = TOKENS["USDT"]
    token_out = TOKENS["BNB"]
    amount_in = w3.to_wei(MAX_TRADE_SIZE, "ether")

    # Safety checks
    if not is_safe_token(token_out):       return
    if not check_liquidity(pancake_factory, token_in, token_out): return

    # Check for competitor bots
    if detect_competitors(token_in, token_out):
        print("  🤖 Too many competitors — switching to triangle arb")
        check_triangle_arbitrage("PancakeSwap")
        return

    # Fetch prices from all DEXes in parallel
    print(f"\n  🔍 Scanning all DEXes...")
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {name: executor.submit(get_price, router, token_in, token_out, amount_in)
                   for name, router in ROUTERS.items()}
        prices = {name: future.result() for name, future in futures.items()}

    valid_prices = {k: v for k, v in prices.items() if v > 0}
    if len(valid_prices) < 2:
        print("  ⚠️  Not enough prices")
        return

    for name, price in valid_prices.items():
        print(f"  {name}: {float(w3.from_wei(price, 'ether')):.6f} BNB")

    best_buy   = min(valid_prices, key=valid_prices.get)
    best_sell  = max(valid_prices, key=valid_prices.get)
    buy_price  = valid_prices[best_buy]
    sell_price = valid_prices[best_sell]
    gap_pct    = ((sell_price - buy_price) / buy_price) * 100

    print(f"""
  Gap:      {gap_pct:.3f}%
  Buy on:   {best_buy}
  Sell on:  {best_sell}
  Required: {MIN_GAP_PCT}%
    """)

    if gap_pct < MIN_GAP_PCT:
        print(f"  ⏭  Gap below minimum — checking triangle arb instead")
        check_triangle_arbitrage("PancakeSwap")
        return

    # Use flash loan for gap >= 1%
    if gap_pct >= 1.0:
        print(f"  ⚡ Strong gap — attempting flash loan!")
        execute_flash_loan(best_buy, best_sell, token_in, token_out, gap_pct)
    else:
        print(f"  🚀 Normal trade!")
        execute_normal_trade(best_buy, best_sell, token_in, token_out, amount_in, buy_price)

# ============================================
# RUN BOT WITH AUTO RESTART
# ============================================
def run_bot():
    print(f"""
╔══════════════════════════════════════════╗
  🤖 ULTIMATE DEX ARB BOT — FULL POWER
  Capital:          ${STARTING_CAPITAL} USDT
  Trade Size:       ${MAX_TRADE_SIZE} USDT
    Flash Loans:      ${FLASH_LOAN_MAX:,} USDT
  Cycle:            {CYCLE_DAYS} days
  Withdrawal:       100% profits
  ─────────────────────────────────────────
  DEXes (3 — Quality over quantity):
  ✅ PancakeSwap  ($2B+ TVL)
  ✅ Biswap       ($500M TVL, lowest fees)
  ✅ MDEX         ($500M TVL, deep pools)
  ─────────────────────────────────────────
  Features:
  ✅ WebSocket Real-Time Feed
  ✅ Flash Loan Route Checker
  ✅ Profit Simulator
  ✅ Telegram Alerts
  ✅ Auto Restart on Crash
  ✅ Triangle Arbitrage (26 paths)
  ✅ Competitor Bot Detector
  ✅ Backup Price Feed (4 RPCs)
  ✅ Gas Price Predictor
  ✅ MEV Protection
  ✅ Rug Pull Detection
  ✅ Liquidity Depth Check
  ✅ Smart Contract Security
  ─────────────────────────────────────────
  Cycle #1 Ends:    {CYCLE_END.strftime('%b %d %Y %H:%M')}
╚══════════════════════════════════════════╝
    """)

    send_telegram(
        "🤖 Ultimate DEX Arb Bot Started!\n"
        f"Capital: ${STARTING_CAPITAL}\n"
        f"Flash Loans: ${FLASH_LOAN_MAX:,}\n"
        f"Cycle ends: {CYCLE_END.strftime('%b %d %Y %H:%M')}"
    )

    scan_count = 0
    while True:
        try:
            check_cycle_end()
            scan_count += 1
            print(f"━━━ Scan #{scan_count} | {datetime.now().strftime('%H:%M:%S')} | Cycle #{CYCLE_NUMBER} | {time_remaining()} left ━━━")
            check_arbitrage()
            net = cycle_profit - cycle_loss
            print(f"  📈 P&L: +${cycle_profit:.2f} / -${cycle_loss:.2f} | Net: ${net:.2f} | Withdrawn: ${total_withdrawn:.2f}")
            print(f"⏳ Next scan in 10 seconds...\n")
            time.sleep(10)

        except KeyboardInterrupt:
            print("\n👋 Bot stopped manually")
            send_telegram("⏹ Bot stopped manually")
            break

        except Exception as e:
            print(f"\n❌ Error: {e}")
            send_telegram(f"❌ Bot error: {e}")
            time.sleep(5)
            restart_bot()

# ============================================
# START
# ============================================
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ultimate DEX Arb Bot")
    parser.add_argument("--dry-run", action="store_true", help="Run in dry-run mode (no live transactions)")
    args = parser.parse_args()

    # Apply dry-run flag
    if args.dry_run:
        DRY_RUN = True
        print("🔒 Running in DRY-RUN mode — no live transactions will be sent")

    # Start websocket listener only when not in dry-run and WSS is configured
    if not DRY_RUN and QUICKNODE_WSS and QUICKNODE_WSS != "your_quicknode_bsc_wss_here":
        start_websocket()

    run_bot()
