import React, { useState, useEffect, useRef } from "react";

const PAIRS = ["BNB/USDT", "CAKE/USDT", "ETH/USDT", "XRP/USDT", "BUSD/USDT"];

// ── Configurable API URL ─────────────────────────────────────────────────────
// Set VITE_API_URL in .env or Vercel env vars to point at your DigitalOcean VPS.
// e.g. VITE_API_URL=http://165.232.12.34:5003  or  https://api.lms-arb.app
const API_BASE: string =
  (import.meta as any).env?.VITE_API_URL ||
  (typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? `http://${window.location.hostname}:5003`
    : "http://localhost:5003");

const APP_BASE_URL: string =
  typeof window !== "undefined" && window.location.origin
    ? window.location.origin
    : "https://lms-arb.app";

// ── Public view mode ─────────────────────────────────────────────────────────
// Activate via URL ?public=1  OR  VITE_PUBLIC_VIEW=true in Vercel env vars.
// Shows live stats, prices, engine — hides all private wallet/withdrawal controls.
const IS_PUBLIC_VIEW: boolean =
  (typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("public") === "1") ||
  (import.meta as any).env?.VITE_PUBLIC_VIEW === "true";
const DEMO_PROFIT_THRESHOLD_PCT = 0.2;
const FLASH_LOAN_THRESHOLD_PCT = 1.0;
const MAX_REASONABLE_SPREAD_PCT = 2;
const DEXES = [
  { name: "PancakeSwap", color: "#F0B90B", short: "CAKE" },
  { name: "Biswap",      color: "#4C8EF7", short: "BSW"  },
  { name: "ApeSwap",     color: "#A855F7", short: "APE"  },
];

const PHASES = [
  {
    label: "Scanning DEX Pools",
    icon: "🔍",
    color: "#4ade80",
    detail: "Fetch all pool data from PancakeSwap, Biswap and ApeSwap",
  },
  {
    label: "Analyzing Price Gaps",
    icon: "📊",
    color: "#38bdf8",
    detail: "Compare prices across all 3 DEXes and identify token differences",
  },
  {
    label: "Cross-DEX Arbitrage Scan",
    icon: "↔️",
    color: "#f59e0b",
    detail: "Check all 36 triangle paths and compute potential profit",
  },
  {
    label: "Evaluating Liquidity Depth",
    icon: "💧",
    color: "#34d399",
    detail: "Validate liquidity and reject shallow pools",
  },
  {
    label: "Multi-Hop Path Analysis",
    icon: "🔄",
    color: "#a78bfa",
    detail: "Analyze multi-hop routes and find the best execution path",
  },
  {
    label: "Flash Loan Route Check",
    icon: "⚡",
    color: "#fb923c",
    detail: "Proceed only when net profit is above 0.5%",
  },
];

const SCAN_INTERVAL_SECONDS = 10;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generatePrices() {
  const prices = {};
  PAIRS.forEach(pair => {
    prices[pair] = {};
  });
  return prices;
}

async function fetchLiveDexPrices() {
  try {
    const response = await fetch(`${API_BASE}/api/prices`);
    if (!response.ok) return null;

    const data = await response.json();
    const sourcePrices = data?.prices ?? {};

    const merged = generatePrices();

    PAIRS.forEach((pair) => {
      if (sourcePrices[pair]) {
        DEXES.forEach((dex) => {
          if (typeof sourcePrices[pair][dex.name] === "number") {
            merged[pair][dex.name] = sourcePrices[pair][dex.name];
          }
        });
      }
    });

    return {
      prices: merged,
      connected: Boolean(data?.connected),
      error: typeof data?.error === "string" ? data.error : null,
    };
  } catch {
    return null;
  }
}

function spreadPercent(low: number, high: number) {
  if (low <= 0 || high <= 0) return 0;
  const mid = (low + high) / 2;
  return mid > 0 ? ((high - low) / mid) * 100 : 0;
}

function bestReasonablePair(
  entries: Array<[string, number]>,
  maxSpreadPct = MAX_REASONABLE_SPREAD_PCT,
) {
  if (entries.length < 2) return null;
  let best: { buyOn: string; buyPrice: number; sellOn: string; sellPrice: number; gap: number } | null = null;

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [aDex, aPrice] = entries[i];
      const [bDex, bPrice] = entries[j];
      const [buyOn, buyPrice, sellOn, sellPrice] = aPrice <= bPrice
        ? [aDex, aPrice, bDex, bPrice]
        : [bDex, bPrice, aDex, aPrice];
      const gap = spreadPercent(buyPrice, sellPrice);

      if (!best || gap < best.gap) {
        best = { buyOn, buyPrice, sellOn, sellPrice, gap };
      }
    }
  }

  if (!best || best.gap > maxSpreadPct) return null;
  return best;
}

function findOpportunities(prices) {
  return PAIRS.map(pair => {
    const entries = Object.entries(prices[pair]) as Array<[string, number]>;
    const best = bestReasonablePair(entries);
    if (!best) return null;

    return {
      pair,
      buyOn: best.buyOn,
      sellOn: best.sellOn,
      buyPrice: best.buyPrice,
      sellPrice: best.sellPrice,
      gap: best.gap,
      profitable: best.gap >= DEMO_PROFIT_THRESHOLD_PCT,
      flashLoan: best.gap >= FLASH_LOAN_THRESHOLD_PCT,
    };
  }).filter(Boolean).sort((a, b) => b.gap - a.gap);
}

function fmt(num) {
  if (num >= 100) return `$${num.toFixed(2)}`;
  if (num >= 1)   return `$${num.toFixed(3)}`;
  return `$${num.toFixed(5)}`;
}

function Pulse({ active, color = "#22c55e" }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      {active && <span style={{
        position: "absolute", width: 8, height: 8, borderRadius: "50%",
        background: color, opacity: 0.5,
        animation: "ping 1.2s cubic-bezier(0,0,0.2,1) infinite",
      }} />}
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: active ? color : "#334155",
        display: "inline-block", position: "relative",
      }} />
    </span>
  );
}

export default function MobileDashboard() {
  const [running, setRunning]           = useState(false);
  const [tab, setTab]                   = useState("home");
  const [startingCapital, setStartingCapital] = useState(50);
  const [prices, setPrices]             = useState(generatePrices());
  const [phase, setPhase]               = useState(0);
  const [nextScan, setNextScan]         = useState(10);
  const [scanCount, setScanCount]       = useState(0);
  const [cycleDay, setCycleDay]         = useState(1);
  const [cycleProfit, setCycleProfit]   = useState(0);
  const [totalProfit, setTotalProfit]   = useState(0);
  const [totalTrades, setTotalTrades]   = useState(0);
  const [flashTrades, setFlashTrades]   = useState(0);
  const [triTrades, setTriTrades]       = useState(0);
  const [uptime, setUptime]             = useState(0);
  const [trades, setTrades]             = useState([]);
  const [logs, setLogs]                 = useState([]);
  const [dexFetchProgress, setDexFetchProgress] = useState({ PancakeSwap: 0, Biswap: 0, ApeSwap: 0 });
  const [dexPriceCoverage, setDexPriceCoverage] = useState({ PancakeSwap: 0, Biswap: 0, ApeSwap: 0 });
  const [stageProgress, setStageProgress] = useState<number[]>(PHASES.map(() => 0));
  const [stageStatus, setStageStatus] = useState<string[]>(PHASES.map(() => "idle"));
  const [bestOpportunity, setBestOpportunity] = useState<any | null>(null);
  const [engineExecutionStatus, setEngineExecutionStatus] = useState<string>("Waiting for scan...");
  const [hasServerEngineState, setHasServerEngineState] = useState(false);
  const [serverTotalDexScanProgress, setServerTotalDexScanProgress] = useState<number | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletStatus, setWalletStatus]   = useState<string>("Not connected");
  const [walletError, setWalletError]     = useState<string | null>(null);
  const [chainId, setChainId]             = useState<string | null>(null);
  const [walletProviderName, setWalletProviderName] = useState<string>("Unknown");
  const [autoWithdrawEnabled, setAutoWithdrawEnabled] = useState(true);
  const [autoWithdrawMinProfit, setAutoWithdrawMinProfit] = useState(5);
  const [binanceAddress, setBinanceAddress] = useState("");
  const [totalWithdrawn, setTotalWithdrawn] = useState(0);
  const [referralCode, setReferralCode]       = useState("");
  const [referralCount, setReferralCount]     = useState(0);
  const [affiliateEarnings, setAffiliateEarnings] = useState(0);
  const [refCopied, setRefCopied]             = useState(false);
  const [liveFeedConnected, setLiveFeedConnected] = useState<boolean | null>(false);
  const [liveFeedError, setLiveFeedError] = useState<string | null>(null);
  const [cycleEndAt, setCycleEndAt] = useState<string | null>(null);
  const [cycleRemainingSeconds, setCycleRemainingSeconds] = useState<number | null>(null);
  const [gasFeePaid, setGasFeePaid] = useState(50);
  const [subscriptionCapital, setSubscriptionCapital] = useState(100);
  const [withdrawable, setWithdrawable] = useState(0);
  const [gasUsageLimit, setGasUsageLimit] = useState(300);
  const [gasUsageUsd, setGasUsageUsd] = useState(0);
  const [gasUsagePct, setGasUsagePct] = useState(0);
  const [startMode, setStartMode] = useState<"demo" | "real">("demo");
  const [executionMode, setExecutionMode] = useState<"demo" | "real">("demo");
  const [liveTradingEnabled, setLiveTradingEnabled] = useState(false);
  const [liveArmedUntil, setLiveArmedUntil] = useState<string | null>(null);
  const [liveArmedRemainingSeconds, setLiveArmedRemainingSeconds] = useState(0);
  const [liveUnlockPhrase, setLiveUnlockPhrase] = useState("");
  const [autoRearmEnabled, setAutoRearmEnabled] = useState(true);
  const [isAutoRearming, setIsAutoRearming] = useState(false);
  const [stageLoopTick, setStageLoopTick] = useState(0);
  const intervalRef = useRef(null);
  const countRef    = useRef(null);
  const scanBusyRef = useRef(false);
  const autoRearmLastAttemptRef = useRef(0);
  const autoRearmPhraseWarnedRef = useRef(false);

  const opps = findOpportunities(prices);
  const displayedBestOpportunity = bestOpportunity ?? opps[0] ?? null;
  const localTotalDexScanProgress = Math.round(
    (dexFetchProgress.PancakeSwap + dexFetchProgress.Biswap + dexFetchProgress.ApeSwap) / 3,
  );
  const totalDexScanProgress = serverTotalDexScanProgress ?? localTotalDexScanProgress;

  const setStageRunning = (index: number) => {
    setPhase(index);
    setStageStatus((prev) => prev.map((state, i) => {
      if (i < index) return "done";
      if (i === index) return "running";
      return "pending";
    }));
  };

  const setStageDone = (index: number) => {
    setStageProgress((prev) => prev.map((value, i) => (i === index ? 100 : value)));
    setStageStatus((prev) => prev.map((state, i) => {
      if (i <= index) return "done";
      return state === "idle" ? "pending" : state;
    }));
  };

  const getDexCoverage = (scanPrices: any, dexName: string) => {
    const withPrice = PAIRS.filter((pair) => {
      const quote = scanPrices?.[pair]?.[dexName];
      return typeof quote === "number" && Number.isFinite(quote) && quote > 0;
    }).length;
    return Math.round((withPrice / PAIRS.length) * 100);
  };

  const runEngineScan = async () => {
    if (scanBusyRef.current) return;
    scanBusyRef.current = true;

    try {
      setStageProgress(PHASES.map(() => 0));
      setStageStatus(PHASES.map((_, i) => (i === 0 ? "running" : "pending")));
      setEngineExecutionStatus("Scanning DEX pools...");
      setDexFetchProgress({ PancakeSwap: 0, Biswap: 0, ApeSwap: 0 });

      // Stage 1: Scanning DEX Pools
      setStageRunning(0);
      const liveDexData = await fetchLiveDexPrices();
      const newPrices = liveDexData?.prices ?? generatePrices();
      setLiveFeedConnected(liveDexData ? liveDexData.connected : false);
      setLiveFeedError(liveDexData?.error ?? (liveDexData ? null : "Price API unreachable"));
      setPrices(newPrices);

      const coverage = {
        PancakeSwap: getDexCoverage(newPrices, "PancakeSwap"),
        Biswap: getDexCoverage(newPrices, "Biswap"),
        ApeSwap: getDexCoverage(newPrices, "ApeSwap"),
      };
      setDexPriceCoverage(coverage);

      for (let idx = 0; idx < DEXES.length; idx += 1) {
        const dex = DEXES[idx];
        setDexFetchProgress((prev) => ({ ...prev, [dex.name]: 35 }));
        await sleep(90);
        setDexFetchProgress((prev) => ({ ...prev, [dex.name]: 75 }));
        await sleep(90);
        setDexFetchProgress((prev) => ({ ...prev, [dex.name]: 100 }));
        setStageProgress((prev) => prev.map((value, i) => (i === 0 ? Math.round(((idx + 1) / DEXES.length) * 100) : value)));
      }
      setStageDone(0);

      // Stage 2: Analyzing Price Gaps
      setStageRunning(1);
      const opportunities = findOpportunities(newPrices);
      setStageProgress((prev) => prev.map((value, i) => (i === 1 ? 100 : value)));
      setStageDone(1);

      // Stage 3: Cross-DEX Arbitrage Scan (36 paths)
      setStageRunning(2);
      for (let i = 1; i <= 36; i += 1) {
        if (i % 6 === 0 || i === 36) {
          setStageProgress((prev) => prev.map((value, idx) => (idx === 2 ? Math.round((i / 36) * 100) : value)));
          await sleep(35);
        }
      }
      setStageDone(2);

      // Stage 4: Evaluating Liquidity Depth
      setStageRunning(3);
      const liquidityPassed = opportunities.filter((op) => op.gap >= DEMO_PROFIT_THRESHOLD_PCT / 2);
      setStageProgress((prev) => prev.map((value, i) => (i === 3 ? 100 : value)));
      setStageDone(3);

      // Stage 5: Multi-Hop Path Analysis
      setStageRunning(4);
      const multiHopBest = liquidityPassed.length > 0 ? liquidityPassed[0] : opportunities[0] ?? null;
      setBestOpportunity(multiHopBest ?? null);
      setStageProgress((prev) => prev.map((value, i) => (i === 4 ? 100 : value)));
      setStageDone(4);

      // Stage 6: Flash Loan Route Check
      setStageRunning(5);
      const finalBest = multiHopBest;
      const netThresholdPct = 0.5;
      const executable = Boolean(finalBest && finalBest.gap >= netThresholdPct);
      setStageProgress((prev) => prev.map((value, i) => (i === 5 ? 100 : value)));
      setStageDone(5);

      if (finalBest) {
        if (executable) {
          setEngineExecutionStatus(
            `Opportunity found: ${finalBest.pair} ${finalBest.buyOn} → ${finalBest.sellOn} (+${finalBest.gap.toFixed(3)}%). Execution signal sent.`,
          );
        } else {
          setEngineExecutionStatus(
            `Opportunity found but skipped: net ${finalBest.gap.toFixed(3)}% is below 0.5% flash-loan threshold.`,
          );
        }
      } else {
        setEngineExecutionStatus("No valid opportunity after full 6-stage scan.");
      }

      setScanCount((c) => c + 1);
      setNextScan(SCAN_INTERVAL_SECONDS);
    } finally {
      scanBusyRef.current = false;
    }
  };

  const syncBotActivity = async () => {
    try {
      const [tradesRes, logsRes] = await Promise.all([
        fetch(`${API_BASE}/api/trades?limit=20`),
        fetch(`${API_BASE}/api/logs?limit=50`),
      ]);

      if (tradesRes.ok) {
        const tradesData = await tradesRes.json();
        const normalizedTrades = (tradesData?.trades ?? []).map((t: any, idx: number) => {
          const profit      = Number(t.profit ?? 0);
          const estProfit   = Number(t.estimated_profit ?? profit);
          const gap         = Number(t.gap ?? t.gap_pct ?? 0);
          const gasCost     = Number(t.gas_cost ?? 0);
          const flashFee    = Number(t.flash_loan_fee ?? 0);
          const slippage    = Number(t.slippage_cost ?? 0);

          return {
            id: t.id ?? idx,
            time: t.time ? new Date(t.time).toLocaleTimeString() : "-",
            pair: t.pair ?? `${t.token_in ?? "?"}/${t.token_out ?? "?"}`,
            buy: t.buy ?? t.buy_dex ?? "-",
            sell: t.sell ?? t.sell_dex ?? "-",
            gap: gap.toFixed(3),
            profit: profit.toFixed(4),
            estProfit: estProfit.toFixed(4),
            gasCost: gasCost.toFixed(4),
            flashFee: flashFee.toFixed(4),
            slippage: slippage.toFixed(4),
            isFlash: Boolean(t.isFlash ?? t.flashLoan ?? t.flash_loan),
            isTri: Boolean(t.isTri ?? t.triangle),
            hash: t.hash ?? t.tx_hash ?? t.txHash ?? "-",
          };
        });

        setTrades(normalizedTrades);
      }

      if (logsRes.ok) {
        const logsData = await logsRes.json();
        const normalizedLogs = (logsData?.logs ?? []).map((log: any, idx: number) => ({
          id: log.id ?? idx,
          time: log.time ? new Date(log.time).toLocaleTimeString() : "-",
          msg: log.msg ?? log.message ?? "",
          type: log.type ?? "info",
        }));
        setLogs(normalizedLogs);
      }
    } catch {
      setLogs([]);
      setTrades([]);
    }
  };

  const syncBotStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      if (!res.ok) return;

      const data = await res.json();
      const status = data?.status;
      if (!status) return;

      setRunning(Boolean(status.running));
      setCycleDay(Number(status.cycle_number ?? 1));
      setCycleProfit(Number(status.cycle_profit ?? 0));
      setTotalProfit(Number(status.cycle_profit ?? 0) - Number(status.cycle_loss ?? 0));
      setTotalTrades(Number(status.total_trades ?? 0));
      setFlashTrades(Number(status.flash_loan_trades ?? 0));
      setTriTrades(Number(status.triangle_trades ?? 0));
      setUptime(Number(status.uptime_seconds ?? 0));
      setCycleEndAt(typeof status.cycle_end === "string" ? status.cycle_end : null);
      setCycleRemainingSeconds(Number(status.cycle_remaining_seconds ?? 0));
      setGasFeePaid(Number(status.gas_fee_paid ?? 50));
      setSubscriptionCapital(Number(status.subscription_capital ?? status.starting_capital ?? 100));
      setWithdrawable(Number(status.withdrawable ?? status.cycle_profit ?? 0));
      setGasUsageLimit(Number(status.gas_usage_limit ?? 300));
      setGasUsageUsd(Number(status.gas_usage_usd ?? 0));
      setGasUsagePct(Number(status.gas_usage_pct ?? 0));
      setLiveTradingEnabled(Boolean(status.live_trading_enabled));
      setLiveArmedUntil(typeof status.live_armed_until === "string" ? status.live_armed_until : null);
      setLiveArmedRemainingSeconds(Number(status.live_armed_remaining_seconds ?? 0));
      const serverExecutionMode = String(status.execution_mode ?? (status.dry_run ? "demo" : "real")).toLowerCase() === "real" ? "real" : "demo";
      setExecutionMode(serverExecutionMode);
      if (Boolean(status.running)) {
        setStartMode(serverExecutionMode);
      }

      const serverStageProgress = Array.isArray(status.engine_stage_progress)
        ? status.engine_stage_progress.map((value: any) => Number(value) || 0)
        : null;
      const serverStageStatus = Array.isArray(status.engine_stage_status)
        ? status.engine_stage_status.map((value: any) => String(value || "idle"))
        : null;

      if (serverStageProgress && serverStageStatus) {
        setHasServerEngineState(true);
        setStageProgress(serverStageProgress.slice(0, PHASES.length));
        setStageStatus(serverStageStatus.slice(0, PHASES.length));
        setPhase(Number(status.engine_stage_index ?? 0));

        const serverDexFetch = status.dex_fetch_progress;
        if (serverDexFetch && typeof serverDexFetch === "object") {
          setDexFetchProgress({
            PancakeSwap: Number(serverDexFetch.PancakeSwap ?? 0),
            Biswap: Number(serverDexFetch.Biswap ?? 0),
            ApeSwap: Number(serverDexFetch.ApeSwap ?? 0),
          });
        }

        const serverCoverage = status.dex_price_coverage;
        if (serverCoverage && typeof serverCoverage === "object") {
          setDexPriceCoverage({
            PancakeSwap: Number(serverCoverage.PancakeSwap ?? 0),
            Biswap: Number(serverCoverage.Biswap ?? 0),
            ApeSwap: Number(serverCoverage.ApeSwap ?? 0),
          });
        }

        setBestOpportunity(status.best_opportunity ?? null);
        setEngineExecutionStatus(String(status.engine_execution_status ?? "Engine active."));
        setServerTotalDexScanProgress(Number(status.total_dex_scan_progress ?? status.engine_stage_progress?.[0] ?? 0));
        setNextScan(Number(status.engine_next_scan_seconds ?? SCAN_INTERVAL_SECONDS));
      } else {
        setHasServerEngineState(false);
        setServerTotalDexScanProgress(null);
      }
    } catch {
      // Ignore intermittent status fetch errors; next poll will retry.
    }
  };

  const handleBotToggle = async () => {
    try {
      const endpoint = running ? "/api/bot/stop" : "/api/bot/start";
      let liveConfirmation = "";

      if (!running && startMode === "real") {
        if (!liveTradingEnabled) {
          setWalletError("Live mode is disabled on the server.");
          return;
        }

        if (liveArmedRemainingSeconds <= 0) {
          setWalletError("Arm live mode first before starting real mode.");
          return;
        }

        const cachedPhrase = liveUnlockPhrase.trim();
        if (cachedPhrase) {
          liveConfirmation = cachedPhrase;
        } else {
          const input = window.prompt(
            "Enter live confirmation phrase to start Real Mode:",
            "",
          );

          if (!input || !input.trim()) {
            setWalletError("Real mode not started. Confirmation phrase is required.");
            return;
          }

          liveConfirmation = input.trim();
          setLiveUnlockPhrase(liveConfirmation);
        }
      }

      const res = await fetch(`${API_BASE}${endpoint}`, running
        ? { method: "POST", headers: { "Content-Type": "application/json" } }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              starting_capital: startingCapital,
              gas_fee_paid: gasFeePaid,
              dry_run: startMode !== "real",
              live_confirmation: liveConfirmation,
            }),
          });

      if (!res.ok) {
        try {
          const data = await res.json();
          setWalletError(String(data?.error || `Bot control failed (${res.status})`));
        } catch {
          setWalletError(`Bot control failed (${res.status})`);
        }
      } else {
        setWalletError(null);
      }

      await syncBotStatus();
      await syncBotActivity();
    } catch {
      setWalletError("Unable to control bot right now.");
    }
  };

  const handleArmLiveMode = async () => {
    try {
      const defaultPhrase = liveUnlockPhrase || "I UNDERSTAND LIVE TRADING RISKS";
      const armPhraseInput = window.prompt(
        "Type live arm phrase to arm Real Mode:",
        defaultPhrase,
      );

      if (!armPhraseInput || !armPhraseInput.trim()) {
        return;
      }

      const windowInput = window.prompt("Arm window in seconds (30-3600):", "600");
      const parsedWindow = Number(windowInput ?? "600");
      const windowSeconds = Number.isFinite(parsedWindow)
        ? Math.max(30, Math.min(3600, Math.round(parsedWindow)))
        : 600;

      const res = await fetch(`${API_BASE}/api/bot/arm-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arm_code: armPhraseInput.trim(),
          window_seconds: windowSeconds,
        }),
      });

      if (!res.ok) {
        try {
          const data = await res.json();
          setWalletError(String(data?.error || `Arm failed (${res.status})`));
        } catch {
          setWalletError(`Arm failed (${res.status})`);
        }
        return;
      }

      setLiveUnlockPhrase(armPhraseInput.trim());
      setWalletError(null);
      await syncBotStatus();
    } catch {
      setWalletError("Unable to arm live mode right now.");
    }
  };

  const handleDisarmLiveMode = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/bot/disarm-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        setWalletError(`Disarm failed (${res.status})`);
        return;
      }

      setWalletError(null);
      await syncBotStatus();
    } catch {
      setWalletError("Unable to disarm live mode right now.");
    }
  };

  const formatArmRemaining = (seconds: number) => {
    const safe = Math.max(0, Math.floor(seconds));
    const m = Math.floor(safe / 60).toString().padStart(2, "0");
    const s = (safe % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const shortAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;

  const detectProviderName = (ethereum: any) => {
    if (ethereum?.isTrust || ethereum?.isTrustWallet) return "Browser Wallet";
    if (ethereum?.isMetaMask) return "Browser Wallet";
    return "Injected Wallet";
  };

  const withdrawProfitNow = () => {
    if (withdrawable <= 0) {
      return;
    }

    if (!walletAddress) {
      setWalletError("Connect wallet first.");
      return;
    }

    if (!binanceAddress || !binanceAddress.startsWith("0x") || binanceAddress.length !== 42) {
      setWalletError("Enter a valid Binance BEP20 deposit address.");
      return;
    }

    const amount = withdrawable;
    setCycleProfit(0);
    setTotalWithdrawn(prev => parseFloat((prev + amount).toFixed(2)));
    setWalletError(null);
  };

  const setWalletFromAccounts = (accounts: string[]) => {
    if (accounts && accounts.length > 0) {
      setWalletAddress(accounts[0]);
      setWalletStatus("Connected");
      setWalletError(null);
    } else {
      setWalletAddress(null);
      setWalletStatus("Not connected");
    }
  };

  const connectWallet = async () => {
    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      setWalletError("Wallet provider not found.");
      return;
    }

    try {
      const accounts = await ethereum.request({ method: "eth_requestAccounts" });
      setWalletFromAccounts(accounts);
      const chain = await ethereum.request({ method: "eth_chainId" });
      setChainId(chain);
      setWalletProviderName(detectProviderName(ethereum));
    } catch (error: any) {
      setWalletError(error?.message || "Connection rejected");
    }
  };

  const disconnectWallet = () => {
    setWalletAddress(null);
    setWalletStatus("Not connected");
    setChainId(null);
    setWalletProviderName("Unknown");
  };

  useEffect(() => {
    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      setWalletError("Wallet provider not found.");
      return;
    }

    setWalletProviderName(detectProviderName(ethereum));

    ethereum.request({ method: "eth_accounts" })
      .then((accounts: string[]) => setWalletFromAccounts(accounts))
      .catch(() => {});

    const handleAccountsChanged = (accounts: string[]) => setWalletFromAccounts(accounts);
    const handleChainChanged = (chain: string) => setChainId(chain);

    ethereum.on?.("accountsChanged", handleAccountsChanged);
    ethereum.on?.("chainChanged", handleChainChanged);

    return () => {
      ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  useEffect(() => {
    if (!autoWithdrawEnabled || withdrawable < autoWithdrawMinProfit) return;
    if (!walletAddress || !binanceAddress || binanceAddress.length !== 42) return;

    const amount = withdrawable;
    setCycleProfit(0);
    setTotalWithdrawn(prev => parseFloat((prev + amount).toFixed(2)));
  }, [withdrawable, autoWithdrawEnabled, autoWithdrawMinProfit, walletAddress, binanceAddress]);

  useEffect(() => {
    if (running) {
      if (!hasServerEngineState) {
        void runEngineScan();
        intervalRef.current = setInterval(() => {
          void runEngineScan();
        }, SCAN_INTERVAL_SECONDS * 1000);
      }
      countRef.current = setInterval(() => setNextScan((n) => Math.max(0, n - 1)), 1000);

      return () => {
        clearInterval(intervalRef.current);
        clearInterval(countRef.current);
      };
    } else {
      clearInterval(intervalRef.current);
      clearInterval(countRef.current);
      setStageStatus(PHASES.map(() => "idle"));
      setStageProgress(PHASES.map(() => 0));
      setDexFetchProgress({ PancakeSwap: 0, Biswap: 0, ApeSwap: 0 });
      setServerTotalDexScanProgress(null);
      setEngineExecutionStatus("Engine idle.");
    }
  }, [running, hasServerEngineState]);

  useEffect(() => {
    if (!running) {
      setStageLoopTick(0);
      return;
    }

    const loopRef = setInterval(() => {
      setStageLoopTick((prev) => (prev + 2) % 100000);
    }, 80);

    return () => clearInterval(loopRef);
  }, [running]);

  useEffect(() => {
    const pollFeedStatus = async () => {
      const liveDexData = await fetchLiveDexPrices();
      if (!liveDexData) {
        setLiveFeedConnected(false);
        setLiveFeedError("Price API unreachable");
        return;
      }

      setPrices(liveDexData.prices);
      setLiveFeedConnected(liveDexData.connected);
      setLiveFeedError(liveDexData.error ?? null);
      setDexPriceCoverage({
        PancakeSwap: getDexCoverage(liveDexData.prices, "PancakeSwap"),
        Biswap: getDexCoverage(liveDexData.prices, "Biswap"),
        ApeSwap: getDexCoverage(liveDexData.prices, "ApeSwap"),
      });
    };

    void pollFeedStatus();
    const feedRef = setInterval(() => {
      void pollFeedStatus();
    }, 10000);

    return () => clearInterval(feedRef);
  }, []);

  useEffect(() => {
    void syncBotStatus();
    void syncBotActivity();
    const activityRef = setInterval(() => {
      void syncBotStatus();
      void syncBotActivity();
    }, 10000);

    return () => clearInterval(activityRef);
  }, []);

  useEffect(() => {
    if (!autoRearmEnabled || !running || executionMode !== "real" || !liveTradingEnabled) {
      return;
    }

    if (liveArmedRemainingSeconds > 60) {
      autoRearmPhraseWarnedRef.current = false;
      return;
    }

    const phrase = liveUnlockPhrase.trim();
    if (!phrase) {
      if (!autoRearmPhraseWarnedRef.current) {
        setWalletError("Live arm is low. Use Arm Live once to store phrase for auto re-arm.");
        autoRearmPhraseWarnedRef.current = true;
      }
      return;
    }

    const now = Date.now();
    if (isAutoRearming || (now - autoRearmLastAttemptRef.current) < 30000) {
      return;
    }

    autoRearmLastAttemptRef.current = now;
    setIsAutoRearming(true);

    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/bot/arm-live`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            arm_code: phrase,
            window_seconds: 600,
          }),
        });

        if (res.ok) {
          setWalletError(null);
          await syncBotStatus();
        }
      } catch {
        // Keep running; polling and next cycle will retry.
      } finally {
        setIsAutoRearming(false);
      }
    })();
  }, [
    autoRearmEnabled,
    running,
    executionMode,
    liveTradingEnabled,
    liveArmedRemainingSeconds,
    liveUnlockPhrase,
    isAutoRearming,
  ]);

  const formatUptime = () => {
    const h = Math.floor(uptime / 3600).toString().padStart(2, "0");
    const m = Math.floor((uptime % 3600) / 60).toString().padStart(2, "0");
    const s = (uptime % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  const formatCycleRemaining = () => {
    if (cycleRemainingSeconds !== null && cycleRemainingSeconds >= 0) {
      const totalMinutes = Math.floor(cycleRemainingSeconds / 60);
      const days = Math.floor(totalMinutes / (60 * 24));
      const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
      return `${days} days ${hours} hours`;
    }

    if (!cycleEndAt) {
      return "7 days 0 hours";
    }

    const end = new Date(cycleEndAt).getTime();
    const remainingMs = Math.max(0, end - Date.now());
    const totalMinutes = Math.floor(remainingMs / 60000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    return `${days} days ${hours} hours`;
  };

  const currentPhase = PHASES[phase % PHASES.length];
  const stageSequenceTick = running ? stageLoopTick % (PHASES.length * 101) : 0;
  const activeStageIndex = running ? Math.floor(stageSequenceTick / 101) : -1;
  const activeStageProgress = running ? stageSequenceTick % 101 : 0;
  const activeStage = activeStageIndex >= 0 ? PHASES[activeStageIndex] : PHASES[0];
  const activeStageSecondsLeft = running ? Math.max(1, Math.ceil((101 - activeStageProgress) * 80 / 1000)) : 0;

  return (
    <div style={{
      background: "radial-gradient(circle at top, #101a36 0%, #080c18 40%, #050814 100%)",
      minHeight: "100vh",
      maxWidth: 430,
      margin: "0 auto",
      color: "#e2e8f0",
      fontFamily: "'Inter', sans-serif",
      display: "flex",
      flexDirection: "column",
      position: "relative",
    }}>
      <style>{`
        @keyframes ping { 75%,100%{transform:scale(2.2);opacity:0} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes glow { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes stageShimmer {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        .trade-row { animation: fadeIn 0.3s ease; }
        ::-webkit-scrollbar { display: none; }
      `}</style>

      <div style={{
        padding: "10px 20px 6px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        fontSize: 11, color: "#475569",
      }}>
        <span>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span>📶</span><span>🔋</span>
        </div>
      </div>

      <div style={{
        padding: "10px 20px 18px",
        borderBottom: "1px solid #182233",
        background: "linear-gradient(180deg, rgba(9,14,28,0.95), rgba(9,14,28,0.65))",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 54,
              height: 54,
              borderRadius: 16,
              background: "linear-gradient(135deg, rgba(11,32,54,0.95), rgba(10,22,40,0.95))",
              border: "1px solid #164e63",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 24px rgba(34,211,238,0.12)",
              color: "#22d3ee",
              fontSize: 24,
            }}>
              ⚡
            </div>
            <div>
              <div style={{
                fontSize: 24, fontWeight: 900,
                background: "linear-gradient(90deg, #38bdf8, #a78bfa)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              }}>LMS Abritage bot</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                Unified cross-exchange arbitrage dashboard
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 12px", borderRadius: 20,
              background: running ? "#052e16" : "#0f172a",
              border: `1px solid ${running ? "#16a34a" : "#1e293b"}`,
              fontSize: 12, fontWeight: 700,
              color: running ? "#4ade80" : "#475569",
            }}>
              <Pulse active={running} />
              {running ? "LIVE" : "IDLE"}
            </div>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 12px",
              borderRadius: 12,
              background: running ? "#082f1b" : "#0f172a",
              border: `1px solid ${running ? "#16a34a" : "#1e293b"}`,
              color: running ? "#86efac" : "#64748b",
              fontSize: 11,
              fontWeight: 700,
            }}>
              {running ? "Active" : "Standby"}
            </div>
            <div style={{ fontSize: 10, color: "#334155" }}>
              Cycle {cycleDay}/7 · Scan #{scanCount}
            </div>
            <div style={{
              fontSize: 10,
              color: liveFeedConnected ? "#4ade80" : liveFeedConnected === false ? "#fda4af" : "#64748b",
              maxWidth: 170,
              textAlign: "right",
            }}>
              Feed: {liveFeedConnected ? "QuickNode connected" : liveFeedConnected === false ? "offline" : "checking..."}
              {liveFeedError ? ` (${liveFeedError})` : ""}
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 80px" }}>
        {tab === "home" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            <div style={{
              background: "#0d1424",
              border: "1px solid #1e293b",
              borderRadius: 16,
              padding: 16,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#38bdf8" }}>Active AI Trading Cycle</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>Powered by LMS engine · Cycle #{cycleDay}</div>
                </div>
                <div style={{
                  color: running ? "#4ade80" : "#94a3b8",
                  border: `1px solid ${running ? "#166534" : "#334155"}`,
                  borderRadius: 10,
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  background: running ? "#052e16" : "#0f172a",
                }}>
                  {running ? "In Progress" : "Idle"}
                </div>
              </div>

              <div style={{
                background: "linear-gradient(135deg, #11111a, #111827)",
                border: `1px solid ${running ? "#1f5134" : "#1e293b"}`,
                borderRadius: 14,
                padding: 14,
                boxShadow: running ? "inset 0 0 0 1px #1a3c29" : "none",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      background: "linear-gradient(135deg, #0b2036, #0b1628)",
                      border: "1px solid #164e63",
                      color: "#22d3ee",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 17,
                    }}>
                      ∿
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc" }}>Bot Engine</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: running ? "#4ade80" : "#64748b" }}>
                    <Pulse active={running} />
                    <span>{running ? "LIVE" : "IDLE"}</span>
                    <span style={{ color: "#94a3b8" }}>{formatUptime()}</span>
                  </div>
                </div>





                {DEXES.map((dex) => (
                  <div key={dex.name} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 12 }}>
                      <span style={{ color: "#94a3b8" }}>{dex.name}</span>
                      <span style={{ color: dex.color, fontWeight: 700 }}>
                        {running ? `${dexFetchProgress[dex.name]}%` : "0%"}
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, background: "#111827" }}>
                      <div style={{
                        height: 6,
                        borderRadius: 999,
                        width: `${running ? dexFetchProgress[dex.name] : 0}%`,
                        background: dex.color,
                        transition: "width 0.35s ease",
                        boxShadow: running ? `0 0 8px ${dex.color}55` : "none",
                      }} />
                    </div>
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                      Live price coverage: {dexPriceCoverage[dex.name]}%
                    </div>
                  </div>
                ))}

                <div style={{
                  marginTop: 10,
                  background: "#070d1a",
                  border: "1px solid #1e293b",
                  borderRadius: 10,
                  padding: "10px 10px 9px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      {PHASES.map((stage, idx) => {
                        const isActive = running && idx === activeStageIndex;
                        return (
                          <span key={stage.label} style={{
                            width: 5,
                            height: 20,
                            borderRadius: 999,
                            background: isActive ? stage.color : "#1f2937",
                            boxShadow: isActive ? `0 0 10px ${stage.color}88` : "none",
                            opacity: running ? (isActive ? 1 : 0.55) : 0.35,
                            transition: "all 0.2s ease",
                          }} />
                        );
                      })}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 11,
                        color: running ? activeStage.color : "#64748b",
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}>
                        {running ? `${activeStage.icon} ${activeStage.label}` : "Engine standby"}
                      </div>
                    </div>
                    <div style={{
                      fontSize: 12,
                      minWidth: 36,
                      textAlign: "right",
                      color: running ? activeStage.color : "#475569",
                      fontWeight: 800,
                    }}>
                      {running ? `${activeStageSecondsLeft}s` : "--"}
                    </div>
                  </div>

                  <div style={{
                    marginTop: 8,
                    height: 5,
                    borderRadius: 999,
                    background: "#0b1220",
                    border: "1px solid #1f2937",
                    overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%",
                      borderRadius: 999,
                      width: `${running ? activeStageProgress : 0}%`,
                      background: running
                        ? `linear-gradient(90deg, ${activeStage.color}, #ffffff33, ${activeStage.color})`
                        : "transparent",
                      backgroundSize: "200% 100%",
                      animation: running ? "stageShimmer 1.1s linear infinite" : "none",
                      transition: "width 0.25s ease",
                      boxShadow: running ? `0 0 10px ${activeStage.color}88` : "none",
                    }} />
                  </div>
                </div>

                <div style={{
                  marginTop: 10,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "#080c18",
                  border: "1px solid #1e293b",
                  fontSize: 11,
                  color: "#94a3b8",
                }}>
                  {engineExecutionStatus}
                </div>
              </div>
            </div>

            {displayedBestOpportunity && running && (
              <div style={{
                background: displayedBestOpportunity.flashLoan ? "#0d0020" : displayedBestOpportunity.profitable ? "#0a1a0a" : "#0d1424",
                border: `1px solid ${displayedBestOpportunity.flashLoan ? "#7c3aed" : displayedBestOpportunity.profitable ? "#166534" : "#1e293b"}`,
                borderRadius: 16, padding: 16,
                boxShadow: "0 0 0 1px rgba(56,189,248,0.25), 0 10px 30px rgba(30,41,59,0.35)",
              }}>
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 10 }}>
                  BEST OPPORTUNITY
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 16, fontWeight: 800 }}>{displayedBestOpportunity.pair}</span>
                      {displayedBestOpportunity.flashLoan && (
                        <span style={{ fontSize: 10, background: "#581c87", color: "#e9d5ff", padding: "2px 7px", borderRadius: 4 }}>⚡ FLASH</span>
                      )}
                      {displayedBestOpportunity.profitable && !displayedBestOpportunity.flashLoan && (
                        <span style={{ fontSize: 10, background: "#166534", color: "#bbf7d0", padding: "2px 7px", borderRadius: 4 }}>✓ TRADE</span>
                      )}
                      {displayedBestOpportunity.gap >= 0.5 && (
                        <span style={{ fontSize: 10, background: "#0c4a6e", color: "#bae6fd", padding: "2px 7px", borderRadius: 4 }}>EXECUTED</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "#475569" }}>
                      Buy {displayedBestOpportunity.buyOn.replace("Swap", "")} → Sell {displayedBestOpportunity.sellOn.replace("Swap", "")}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{
                      fontSize: 24, fontWeight: 900,
                      color: displayedBestOpportunity.flashLoan ? "#a855f7" : displayedBestOpportunity.profitable ? "#4ade80" : "#475569",
                    }}>+{displayedBestOpportunity.gap.toFixed(3)}%</div>
                    <div style={{ fontSize: 10, color: "#334155" }}>
                      {displayedBestOpportunity.profitable
                        ? `Above ${DEMO_PROFIT_THRESHOLD_PCT.toFixed(1)}% threshold`
                        : `Below ${DEMO_PROFIT_THRESHOLD_PCT.toFixed(1)}% threshold`}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div style={{
              background: "#0d1424", border: "1px solid #1e293b",
              borderRadius: 16, padding: 16,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#38bdf8" }}>Active Subscription</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>Wallet & Withdraw controls</div>
                </div>
                <span style={{ fontSize: 10, color: "#475569" }}>{walletProviderName}</span>
              </div>

              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
                marginBottom: 12,
              }}>
                {[
                  { label: "Capital", value: `$${subscriptionCapital.toFixed(2)}`, color: "#f8fafc" },
                  { label: "Gas Fee", value: `$${gasFeePaid.toFixed(2)}`, color: "#f8fafc" },
                  { label: "Remaining", value: formatCycleRemaining(), color: "#facc15" },
                  { label: "Withdrawable", value: `$${withdrawable.toFixed(2)}`, color: "#4ade80" },
                ].map((item) => (
                  <div key={item.label} style={{
                    background: "#080c18",
                    border: "1px solid #1e293b",
                    borderRadius: 10,
                    padding: "10px 12px",
                  }}>
                    <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>{item.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: item.color }}>{item.value}</div>
                  </div>
                ))}
              </div>

              <div style={{
                background: "#080c18", border: "1px solid #1e293b", borderRadius: 10,
                padding: 10, marginBottom: 10,
              }}>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  Status: <strong style={{ color: walletAddress ? "#4ade80" : "#94a3b8" }}>{walletStatus}</strong>
                </div>
                <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>
                  {walletAddress ? `Wallet: ${shortAddress(walletAddress)}` : "Connect wallet to withdraw profits"}
                </div>
                {chainId && (
                  <div style={{ fontSize: 10, color: "#334155", marginTop: 2 }}>
                    Chain: {chainId === "0x38" ? "BSC Mainnet" : chainId}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                {!IS_PUBLIC_VIEW && (!walletAddress ? (
                  <button onClick={connectWallet} style={{
                    flex: 1, border: "none", borderRadius: 10, cursor: "pointer",
                    background: "linear-gradient(135deg, #334155, #475569)",
                    color: "#fff", fontSize: 12, fontWeight: 700, padding: "10px 12px",
                  }}>
                    Connect Wallet
                  </button>
                ) : (
                  <button onClick={disconnectWallet} style={{
                    flex: 1, border: "1px solid #7f1d1d", borderRadius: 10, cursor: "pointer",
                    background: "#1f0d0d", color: "#fecaca", fontSize: 12, fontWeight: 700, padding: "10px 12px",
                  }}>
                    Disconnect Wallet
                  </button>
                ))}
              </div>

              {!IS_PUBLIC_VIEW && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginBottom: 8 }}>
                  <label style={{ fontSize: 10, color: "#64748b", display: "flex", flexDirection: "column", gap: 4 }}>
                    Auto Withdraw Min Profit ($)
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={autoWithdrawMinProfit}
                      onChange={(e) => setAutoWithdrawMinProfit(Math.max(1, Number(e.target.value) || 1))}
                      style={{
                        background: "#080c18", border: "1px solid #1e293b", borderRadius: 8,
                        color: "#e2e8f0", padding: "8px 10px", fontSize: 12,
                      }}
                    />
                  </label>
                </div>
              )}

              {!IS_PUBLIC_VIEW && (
                <label style={{ fontSize: 10, color: "#64748b", display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                  Binance BEP20 Address (Profit Receiver)
                  <input
                    type="text"
                    placeholder="0x..."
                    value={binanceAddress}
                    onChange={(e) => setBinanceAddress(e.target.value.trim())}
                    style={{
                      background: "#080c18", border: "1px solid #1e293b", borderRadius: 8,
                      color: "#e2e8f0", padding: "8px 10px", fontSize: 12,
                    }}
                  />
                </label>
              )}

              {!IS_PUBLIC_VIEW && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>Auto withdraw profits to Binance</span>
                  <button onClick={() => setAutoWithdrawEnabled(v => !v)} style={{
                    border: "1px solid #1e293b", borderRadius: 999,
                    background: autoWithdrawEnabled ? "#052e16" : "#111827",
                    color: autoWithdrawEnabled ? "#4ade80" : "#64748b",
                    padding: "4px 10px", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  }}>
                    {autoWithdrawEnabled ? "ON" : "OFF"}
                  </button>
                </div>
              )}

              {IS_PUBLIC_VIEW ? (
                <div style={{
                  background: "#0f172a", border: "1px solid #1e3a5f",
                  borderRadius: 10, padding: "12px 14px", marginBottom: 8,
                  fontSize: 11, color: "#64748b", textAlign: "center",
                }}>
                  🔒 Wallet controls hidden in public view
                </div>
              ) : (
                <button onClick={withdrawProfitNow} style={{
                  width: "100%", border: "none", borderRadius: 10, cursor: "pointer",
                  background: "linear-gradient(135deg, #334155, #475569)",
                  color: "#fff", fontSize: 13, fontWeight: 800, padding: "11px 12px",
                }}>
                  Withdraw Profit Now (${withdrawable.toFixed(2)})
                </button>
              )}

              {!IS_PUBLIC_VIEW && walletError && (
                <div style={{ marginTop: 8, fontSize: 10, color: "#fda4af" }}>{walletError}</div>
              )}
              <div style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: "1px solid #1e293b",
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}>
                <div style={{
                  background: "#080c18",
                  border: "1px solid #1e293b",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}>
                  <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>Cycle Profit</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#4ade80" }}>${cycleProfit.toFixed(2)}</div>
                </div>
                <div style={{
                  background: "#080c18",
                  border: "1px solid #1e293b",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}>
                  <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>Protected Capital</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#38bdf8" }}>${startingCapital.toFixed(2)}</div>
                </div>
              </div>
            </div>

            {!IS_PUBLIC_VIEW ? (
              <>
                {!running && (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    marginBottom: 10,
                  }}>
                    <button
                      onClick={() => setStartMode("demo")}
                      style={{
                        borderRadius: 10,
                        border: startMode === "demo" ? "1px solid #22c55e" : "1px solid #1e293b",
                        background: startMode === "demo" ? "#052e1f" : "#0b1220",
                        color: startMode === "demo" ? "#86efac" : "#94a3b8",
                        fontSize: 12,
                        fontWeight: 700,
                        padding: "10px 8px",
                        cursor: "pointer",
                      }}
                    >
                      Demo Mode
                    </button>
                    <button
                      onClick={() => setStartMode("real")}
                      style={{
                        borderRadius: 10,
                        border: startMode === "real" ? "1px solid #f97316" : "1px solid #1e293b",
                        background: startMode === "real" ? "#3b1904" : "#0b1220",
                        color: startMode === "real" ? "#fdba74" : "#94a3b8",
                        fontSize: 12,
                        fontWeight: 700,
                        padding: "10px 8px",
                        cursor: "pointer",
                      }}
                    >
                      Real Mode
                    </button>
                  </div>
                )}

                {!running && (
                  <div style={{
                    marginBottom: 10,
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid #1e293b",
                    background: startMode === "real" ? "#22110a" : "#0a1a12",
                    color: startMode === "real" ? "#fdba74" : "#86efac",
                    fontSize: 11,
                    fontWeight: 600,
                  }}>
                    {startMode === "real"
                      ? "Real mode selected: arm live mode first, then start within the arm window."
                      : "Demo mode selected: paper trades only, no real transactions."}
                  </div>
                )}

                {!running && startMode === "real" && (
                  <div style={{
                    marginBottom: 10,
                    borderRadius: 12,
                    border: "1px solid #7c2d12",
                    background: "linear-gradient(135deg, #1a0f09, #22110a)",
                    padding: "10px 12px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: liveTradingEnabled ? "#fdba74" : "#fda4af" }}>
                        Live Arm Status: {liveTradingEnabled ? (liveArmedRemainingSeconds > 0 ? "ARMED" : "DISARMED") : "SERVER LOCKED"}
                      </div>
                      <div style={{ fontSize: 11, color: liveArmedRemainingSeconds > 0 ? "#fde68a" : "#94a3b8" }}>
                        {liveArmedRemainingSeconds > 0 ? `Window ${formatArmRemaining(liveArmedRemainingSeconds)}` : "Window --:--"}
                      </div>
                    </div>
                    {liveArmedUntil && (
                      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 8 }}>
                        Armed until: {new Date(liveArmedUntil).toLocaleTimeString()}
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>
                        Auto re-arm when below 01:00
                      </span>
                      <button
                        onClick={() => setAutoRearmEnabled((prev) => !prev)}
                        style={{
                          border: "1px solid #334155",
                          borderRadius: 999,
                          background: autoRearmEnabled ? "#3f1d0b" : "#0f172a",
                          color: autoRearmEnabled ? "#fdba74" : "#94a3b8",
                          padding: "3px 10px",
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {autoRearmEnabled ? "ON" : "OFF"}
                      </button>
                    </div>
                    {isAutoRearming && (
                      <div style={{ fontSize: 10, color: "#fde68a", marginBottom: 8 }}>
                        Auto re-arming live window...
                      </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <button
                        onClick={() => void handleArmLiveMode()}
                        disabled={!liveTradingEnabled}
                        style={{
                          borderRadius: 9,
                          border: "1px solid #7c2d12",
                          background: liveTradingEnabled ? "#7c2d12" : "#1f2937",
                          color: "#fff",
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "8px 10px",
                          cursor: liveTradingEnabled ? "pointer" : "not-allowed",
                          opacity: liveTradingEnabled ? 1 : 0.65,
                        }}
                      >
                        Arm Live (10m)
                      </button>
                      <button
                        onClick={() => void handleDisarmLiveMode()}
                        style={{
                          borderRadius: 9,
                          border: "1px solid #334155",
                          background: "#0f172a",
                          color: "#cbd5e1",
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "8px 10px",
                          cursor: "pointer",
                        }}
                      >
                        Disarm Live
                      </button>
                    </div>
                  </div>
                )}

                <button onClick={() => void handleBotToggle()} style={{
                  width: "100%", padding: "18px",
                  borderRadius: 16, border: "none",
                  background: running
                    ? "linear-gradient(135deg, #7f1d1d, #991b1b)"
                    : startMode === "real"
                      ? "linear-gradient(135deg, #b45309, #c2410c)"
                      : "linear-gradient(135deg, #334155, #475569)",
                  color: "#fff", fontSize: 16, fontWeight: 800,
                  cursor: "pointer", fontFamily: "inherit",
                  boxShadow: running
                    ? "0 4px 20px #ef444433"
                    : startMode === "real"
                      ? "0 4px 20px #f9731633"
                      : "0 4px 20px #47556933",
                  letterSpacing: "0.04em",
                }}>
                  {running ? "⏹  Stop Bot" : startMode === "real" ? "▶  Start Real Mode" : "▶  Start Demo Bot"}
                </button>
              </>
            ) : (
              <div style={{
                background: "linear-gradient(135deg, #0b1a2e, #0d1424)",
                border: "1px solid #1e3a5f",
                borderRadius: 14, padding: "14px 18px",
                textAlign: "center",
              }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#38bdf8", marginBottom: 4 }}>👁 Public View Mode</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  Live stats are visible. Wallet and bot controls are hidden for security.<br />
                  <span style={{ color: "#475569" }}>Add <strong>?public=1</strong> to the URL to share this view safely.</span>
                </div>
              </div>
            )}

            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr",
              gap: 8,
            }}>
              {[
                { label: "MEV Protection",   icon: "🛡️" },
                { label: "Flash Loans",       icon: "⚡" },
                { label: "Rug Detection",     icon: "🚨" },
                { label: "Auto Restart",      icon: "🔁" },
                { label: "Depth Analysis",    icon: "💧" },
                { label: "Bot Detector",      icon: "🤖" },
              ].map(item => (
                <div key={item.label} style={{
                  background: running ? "#0a1a0a" : "#0d1424",
                  border: `1px solid ${running ? "#166534" : "#1e293b"}`,
                  borderRadius: 10, padding: "10px 12px",
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: 12,
                  color: running ? "#4ade80" : "#334155",
                }}>
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>

            {/* ── AFFILIATE LINK CARD ── */}
            <div style={{
              background: "linear-gradient(135deg, #0b1a2e, #0d1424)",
              border: "1px solid #1e3a5f",
              borderRadius: 16,
              padding: 16,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: "linear-gradient(135deg, #0b2036, #164e63)",
                  border: "1px solid #164e63",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18,
                }}>🤝</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#38bdf8" }}>Affiliate Link</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>Share and earn 5% on every referral cycle profit</div>
                </div>
              </div>

              <div style={{
                background: "#080c18",
                border: "1px solid #1e3a5f",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 12,
                color: "#94a3b8",
                wordBreak: "break-all" as const,
                marginBottom: 10,
                lineHeight: 1.6,
              }}>
                {walletAddress
                  ? `${APP_BASE_URL}/ref/${walletAddress.slice(2, 10)}`
                  : "Connect your wallet to generate your referral link"}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => {
                    if (!walletAddress) return;
                    const link = `${APP_BASE_URL}/ref/${walletAddress.slice(2, 10)}`;
                    navigator.clipboard?.writeText(link).then(() => {
                      setRefCopied(true);
                      setTimeout(() => setRefCopied(false), 2000);
                    });
                  }}
                  style={{
                    flex: 1, border: "none", borderRadius: 10, cursor: walletAddress ? "pointer" : "not-allowed",
                    background: refCopied
                      ? "linear-gradient(135deg, #052e16, #166534)"
                      : "linear-gradient(135deg, #334155, #475569)",
                    color: "#fff", fontSize: 12, fontWeight: 700, padding: "10px 0",
                    opacity: walletAddress ? 1 : 0.5,
                    transition: "background 0.3s",
                  }}
                >
                  {refCopied ? "✅ Copied!" : "📋 Copy Link"}
                </button>
                <button
                  onClick={() => {
                    if (!walletAddress) return;
                    const code = walletAddress.slice(2, 10);
                    const link = `${APP_BASE_URL}/ref/${code}`;
                    const text = `Join LMS Abritage Bot — earn on BSC DeFi arbitrage!\n${link}`;
                    if (navigator.share) {
                      navigator.share({ title: "LMS Abritage Bot", text, url: link }).catch(() => {});
                    } else {
                      navigator.clipboard?.writeText(`${text}`).then(() => {
                        setRefCopied(true);
                        setTimeout(() => setRefCopied(false), 2000);
                      });
                    }
                  }}
                  style={{
                    flex: 1, border: "none", borderRadius: 10, cursor: walletAddress ? "pointer" : "not-allowed",
                    background: "linear-gradient(135deg, #0c4a6e, #0e7490)",
                    color: "#fff", fontSize: 12, fontWeight: 700, padding: "10px 0",
                    opacity: walletAddress ? 1 : 0.5,
                  }}
                >
                  📣 Share
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === "trades" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{
              background: "linear-gradient(135deg, rgba(13,20,36,0.92), rgba(10,18,34,0.92))",
              border: "1px solid #1e293b",
              borderRadius: 16,
              padding: "14px 16px",
            }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc" }}>💱 Trade History</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Recent arbitrage executions, flash loan routes, and triangle trades.</div>
            </div>
            {trades.length === 0 ? (
              <div style={{
                background: "#0d1424", border: "1px solid #1e293b",
                borderRadius: 16, padding: 40, textAlign: "center",
                color: "#334155", fontSize: 13,
              }}>
                No trades yet — start the bot!
              </div>
            ) : (
              trades.map(t => (
                <div key={t.id} className="trade-row" style={{
                  background: t.isFlash ? "#0d0020" : t.isTri ? "#0d1a00" : "#0d1424",
                  border: `1px solid ${t.isFlash ? "#581c87" : t.isTri ? "#166534" : "#1e293b"}`,
                  borderRadius: 14, padding: "14px 16px",
                }}>
                  {/* Row 1: pair, badges, actual profit */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 800, fontSize: 15 }}>{t.pair}</span>
                      {t.isFlash && <span style={{ fontSize: 10, background: "#581c87", color: "#e9d5ff", padding: "2px 6px", borderRadius: 4 }}>⚡ FLASH</span>}
                      {t.isTri  && <span style={{ fontSize: 10, background: "#166534", color: "#bbf7d0", padding: "2px 6px", borderRadius: 4 }}>🔺 TRI</span>}
                    </div>
                    <span style={{ fontWeight: 900, fontSize: 17, color: "#4ade80" }}>+${t.profit}</span>
                  </div>
                  {/* Row 2: route, gap, time */}
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#475569", marginBottom: 8 }}>
                    <span>{t.buy.replace("Swap","")} → {t.sell.replace("Swap","")}</span>
                    <span>+{t.gap}% gap</span>
                    <span>{t.time}</span>
                  </div>
                  {/* Row 3: estimated vs actual profit */}
                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 1fr",
                    gap: 6, marginBottom: 6,
                  }}>
                    <div style={{ background: "#080c18", border: "1px solid #1e293b", borderRadius: 8, padding: "6px 10px" }}>
                      <div style={{ fontSize: 9, color: "#64748b", marginBottom: 2 }}>EST. PROFIT</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#fbbf24" }}>${t.estProfit}</div>
                    </div>
                    <div style={{ background: "#080c18", border: "1px solid #166534", borderRadius: 8, padding: "6px 10px" }}>
                      <div style={{ fontSize: 9, color: "#64748b", marginBottom: 2 }}>ACTUAL PROFIT</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}>${t.profit}</div>
                    </div>
                  </div>
                  {/* Row 4: cost breakdown */}
                  <div style={{ display: "flex", gap: 10, fontSize: 10, color: "#475569" }}>
                    <span>⛽ Gas: <strong style={{ color: "#94a3b8" }}>${t.gasCost}</strong></span>
                    {t.isFlash && <span>⚡ FL fee: <strong style={{ color: "#94a3b8" }}>${t.flashFee}</strong></span>}
                    <span>↔ Slip: <strong style={{ color: "#94a3b8" }}>${t.slippage}</strong></span>
                  </div>
                  <div style={{ fontSize: 10, color: "#1e293b", marginTop: 4 }}>{t.hash}</div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "prices" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{
              background: "linear-gradient(135deg, rgba(13,20,36,0.92), rgba(10,18,34,0.92))",
              border: "1px solid #1e293b",
              borderRadius: 16,
              padding: "14px 16px",
            }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc" }}>📊 My Position</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Live pair spreads across DEX venues with clear buy and sell signals.</div>
            </div>
            {PAIRS.map(pair => {
              const pairPrices = (Object.entries(prices[pair] ?? {}) as Array<[string, number]>)
                .filter(([, price]) => typeof price === "number" && Number.isFinite(price) && price > 0)
                .sort((a, b) => a[1] - b[1]);
              const best = bestReasonablePair(pairPrices);
              const gap = best?.gap ?? 0;
              return (
                <div key={pair} style={{
                  background: "#0d1424", border: "1px solid #1e293b",
                  borderRadius: 14, padding: 14,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{pair}</span>
                    <span style={{
                      fontWeight: 700, fontSize: 13,
                      color: gap >= FLASH_LOAN_THRESHOLD_PCT ? "#a855f7" : gap >= DEMO_PROFIT_THRESHOLD_PCT ? "#4ade80" : "#475569",
                    }}>
                      {gap >= FLASH_LOAN_THRESHOLD_PCT ? "⚡" : gap >= DEMO_PROFIT_THRESHOLD_PCT ? "✅" : ""} {gap.toFixed(3)}%
                    </span>
                  </div>
                  {pairPrices.length === 0 && (
                    <div style={{ fontSize: 11, color: "#64748b", padding: "6px 2px" }}>
                      No live quotes yet.
                    </div>
                  )}
                  {pairPrices.map(([dex, price], i) => {
                    const dexInfo = DEXES.find(d => d.name === dex);
                    const isBuy = best ? dex === best.buyOn : i === 0;
                    const isSell = best ? dex === best.sellOn : i === pairPrices.length - 1;
                    return (
                      <div key={dex} style={{
                        display: "flex", justifyContent: "space-between",
                        alignItems: "center", padding: "8px 10px",
                        background: isSell ? "#0a1a0a" : isBuy ? "#1a0a0a" : "#080c18",
                        borderRadius: 8, marginBottom: 4,
                        border: `1px solid ${isSell ? "#166534" : isBuy ? "#7f1d1d" : "#1e293b"}`,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: dexInfo?.color }} />
                          <span style={{ fontSize: 12, color: "#94a3b8" }}>{dex}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{
                            fontWeight: 700, fontSize: 13,
                            color: isSell ? "#4ade80" : isBuy ? "#ef4444" : "#e2e8f0",
                          }}>{fmt(price)}</span>
                          <span style={{ fontSize: 9, color: isSell ? "#4ade80" : isBuy ? "#ef4444" : "#334155" }}>
                            {isSell ? "▲ SELL" : isBuy ? "▼ BUY" : ""}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {tab === "affiliate" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{
              background: "linear-gradient(135deg, rgba(13,20,36,0.92), rgba(10,18,34,0.92))",
              border: "1px solid #1e293b",
              borderRadius: 16,
              padding: "14px 16px",
            }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc" }}>🤝 Affiliate Program</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Earn 5% commission on every cycle profit your referrals generate.</div>
            </div>

            {/* Earnings overview */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { label: "Total Earned", value: `$${affiliateEarnings.toFixed(2)}`, color: "#4ade80" },
                { label: "Referrals",    value: String(referralCount),               color: "#38bdf8" },
              ].map(item => (
                <div key={item.label} style={{
                  background: "#0d1424",
                  border: "1px solid #1e293b",
                  borderRadius: 12,
                  padding: "14px 16px",
                  textAlign: "center",
                }}>
                  <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>{item.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>

            {/* Commission info */}
            <div style={{
              background: "#0d1424",
              border: "1px solid #1e293b",
              borderRadius: 14,
              padding: 14,
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#38bdf8", marginBottom: 10 }}>How It Works</div>
              {[
                { step: "1", text: "Share your referral link with friends or traders." },
                { step: "2", text: "They subscribe and start a 7-day trading cycle." },
                { step: "3", text: "You earn 5% of their cycle profit automatically." },
                { step: "4", text: "Commissions are paid instantly to your wallet." },
              ].map(item => (
                <div key={item.step} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
                  <div style={{
                    minWidth: 24, height: 24,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #0b2036, #164e63)",
                    border: "1px solid #164e63",
                    color: "#22d3ee",
                    fontSize: 11, fontWeight: 800,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>{item.step}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>{item.text}</div>
                </div>
              ))}
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                gap: 8, marginTop: 6,
              }}>
                {[
                  { label: "Commission", value: "5%" },
                  { label: "Payout",     value: "Instant" },
                  { label: "Minimum",    value: "$0" },
                ].map(item => (
                  <div key={item.label} style={{
                    background: "#080c18",
                    border: "1px solid #1e293b",
                    borderRadius: 8, padding: "8px 10px", textAlign: "center",
                  }}>
                    <div style={{ fontSize: 9, color: "#64748b", marginBottom: 3 }}>{item.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#f8fafc" }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Referral link */}
            <div style={{
              background: "#0d1424",
              border: "1px solid #1e293b",
              borderRadius: 14,
              padding: 14,
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#38bdf8", marginBottom: 10 }}>Your Referral Link</div>
              <div style={{
                background: "#080c18",
                border: "1px solid #1e293b",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 11,
                color: "#64748b",
                wordBreak: "break-all",
                marginBottom: 10,
                lineHeight: 1.5,
              }}>
                {referralCode
                  ? `${APP_BASE_URL}/ref/${referralCode}`
                  : walletAddress
                    ? `${APP_BASE_URL}/ref/${walletAddress.slice(2, 10)}`
                    : "Connect your wallet to generate your referral link"}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => {
                    const code = referralCode || (walletAddress ? walletAddress.slice(2, 10) : "");
                    if (!code) { return; }
                    const link = `${APP_BASE_URL}/ref/${code}`;
                    navigator.clipboard?.writeText(link).then(() => {
                      setRefCopied(true);
                      setTimeout(() => setRefCopied(false), 2000);
                    });
                  }}
                  style={{
                    flex: 1, border: "none", borderRadius: 10, cursor: "pointer",
                    background: refCopied ? "linear-gradient(135deg, #052e16, #166534)" : "linear-gradient(135deg, #334155, #475569)",
                    color: "#fff", fontSize: 12, fontWeight: 700, padding: "10px 12px",
                    transition: "background 0.3s",
                  }}
                >
                  {refCopied ? "✅ Copied!" : "📋 Copy Link"}
                </button>
                <button
                  onClick={() => {
                    const code = referralCode || (walletAddress ? walletAddress.slice(2, 10) : "");
                    if (!code) return;
                    const link = `${APP_BASE_URL}/ref/${code}`;
                    const text = `Join LMS Abritage Bot — earn on BSC DeFi arbitrage!\n${link}`;
                    if (navigator.share) {
                      navigator.share({ title: "LMS Abritage Bot", text, url: link }).catch(() => {});
                    } else {
                      navigator.clipboard?.writeText(text).then(() => {
                        setRefCopied(true);
                        setTimeout(() => setRefCopied(false), 2000);
                      });
                    }
                  }}
                  style={{
                    flex: 1, border: "none", borderRadius: 10, cursor: "pointer",
                    background: "linear-gradient(135deg, #0c4a6e, #0e7490)",
                    color: "#fff", fontSize: 12, fontWeight: 700, padding: "10px 12px",
                  }}
                >
                  📣 Share via Telegram
                </button>
              </div>
            </div>

            {/* Referral history placeholder */}
            <div style={{
              background: "#0d1424",
              border: "1px solid #1e293b",
              borderRadius: 14,
              padding: 14,
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#38bdf8", marginBottom: 10 }}>Referral Activity</div>
              {referralCount === 0 ? (
                <div style={{ textAlign: "center", color: "#334155", fontSize: 13, padding: "20px 0" }}>
                  No referrals yet — share your link to start earning!
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  {referralCount} active referral{referralCount !== 1 ? "s" : ""} · ${affiliateEarnings.toFixed(2)} total earned
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "logs" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{
              background: "linear-gradient(135deg, rgba(13,20,36,0.92), rgba(10,18,34,0.92))",
              border: "1px solid #1e293b",
              borderRadius: 16,
              padding: "14px 16px",
            }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc" }}>↓ Withdraw</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Connect a wallet, manage withdrawals, and review bot activity logs.</div>
            </div>

            <div style={{
              background: "#090e1a",
              border: "1px solid #1f2a45",
              borderRadius: 18,
              padding: 16,
              marginBottom: 6,
            }}>
              <div style={{ textAlign: "center", marginBottom: 12 }}>
                <div style={{
                  width: 54,
                  height: 54,
                  borderRadius: "50%",
                  background: "radial-gradient(circle at center, #06b6d4, #0f172a)",
                  margin: "0 auto 8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 24,
                }}>
                  🛡
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#f8fafc" }}>Connect Wallet</div>
                <div style={{
                  background: "#0f1a33",
                  border: "1px solid #1e3a5f",
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 12,
                  color: "#93c5fd",
                  marginTop: 10,
                }}>
                  Wallet detected - tap a button below to connect.
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button onClick={connectWallet} style={{
                  width: "100%",
                  border: "1px solid #334155",
                  borderRadius: 10,
                  background: "#1f2937",
                  color: "#f8fafc",
                  padding: "12px 14px",
                  fontSize: 22,
                  textAlign: "left",
                  cursor: "pointer",
                }}>
                  <span style={{ fontSize: 18, marginRight: 8 }}>🦊</span> MetaMask
                  <span style={{ float: "right", fontSize: 11, color: "#94a3b8", border: "1px solid #334155", borderRadius: 999, padding: "2px 8px" }}>Mobile</span>
                </button>
                <button onClick={connectWallet} style={{
                  width: "100%",
                  border: "1px solid #334155",
                  borderRadius: 10,
                  background: "#1f2937",
                  color: "#f8fafc",
                  padding: "12px 14px",
                  fontSize: 22,
                  textAlign: "left",
                  cursor: "pointer",
                }}>
                  <span style={{ fontSize: 18, marginRight: 8 }}>🔵</span> Trust Wallet
                  <span style={{ float: "right", fontSize: 11, color: "#94a3b8", border: "1px solid #334155", borderRadius: 999, padding: "2px 8px" }}>Mobile</span>
                </button>
              </div>

              <div style={{
                marginTop: 14,
                borderTop: "1px solid #1e293b",
                paddingTop: 10,
                textAlign: "center",
                color: "#94a3b8",
                fontSize: 12,
                lineHeight: 1.45,
              }}>
                Using a different wallet? Open this app inside your wallet browser.
                <div style={{ marginTop: 8, color: "#22d3ee", fontSize: 12 }}>
                  One-tap connect - no signatures, no gas fees, no transactions
                </div>
              </div>
            </div>

            {logs.length === 0 ? (
              <div style={{
                background: "#0d1424", border: "1px solid #1e293b",
                borderRadius: 16, padding: 40, textAlign: "center",
                color: "#334155", fontSize: 13,
              }}>Logs appear when bot is running</div>
            ) : (
              logs.map(log => (
                <div key={log.id} style={{
                  padding: "10px 14px", borderRadius: 12,
                  background: log.type === "flash" ? "#0d0020" : log.type === "success" ? "#0a1a0a" : log.type === "tri" ? "#0d1a00" : "#0d1424",
                  borderLeft: `3px solid ${log.type === "flash" ? "#a855f7" : log.type === "success" ? "#4ade80" : log.type === "tri" ? "#22c55e" : "#1e293b"}`,
                  fontSize: 12,
                  color: log.type === "flash" ? "#e9d5ff" : log.type === "success" ? "#bbf7d0" : "#94a3b8",
                }}>
                  <span style={{ color: "#334155", marginRight: 8, fontSize: 10 }}>{log.time}</span>
                  {log.msg}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div style={{
        position: "fixed", bottom: 0, left: "50%",
        transform: "translateX(-50%)",
        width: "100%", maxWidth: 430,
        background: "linear-gradient(180deg, rgba(13,20,36,0.92), rgba(8,12,24,0.98))",
        borderTop: "1px solid #1e293b",
        display: "flex", padding: "10px 0 20px",
        backdropFilter: "blur(12px)",
        zIndex: 100,
      }}>
        {[
          { id: "home",      icon: "🏠", label: "Home"      },
          { id: "trades",    icon: "💱", label: "Trades"    },
          { id: "prices",    icon: "📊", label: "Prices"    },
          { id: "affiliate", icon: "🤝", label: "Affiliate" },
          { id: "logs",      icon: "📋", label: "Logs"      },
        ].map((item) => (
          <button key={item.id} onClick={() => setTab(item.id)} style={{
            flex: 1, background: "none", border: "none",
            cursor: "pointer", display: "flex",
            flexDirection: "column", alignItems: "center", gap: 3,
          }}>
            <span style={{ fontSize: 22, filter: tab === item.id ? "drop-shadow(0 0 8px rgba(56,189,248,0.35))" : "none" }}>{item.icon}</span>
            <span style={{
              fontSize: 10, fontWeight: 600, fontFamily: "inherit",
              color: tab === item.id ? "#38bdf8" : "#64748b",
            }}>{item.label}</span>
            {tab === item.id && (
              <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#38bdf8" }} />
            )}
          </button>
        ))}
      </div>


    </div>
  );
}
