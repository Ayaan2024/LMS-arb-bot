import { useState, useEffect, useRef } from "react";

const PAIRS = ["BNB/USDT", "CAKE/USDT", "ETH/USDT", "XRP/USDT", "BUSD/USDT"];
const DEXES = [
  { name: "PancakeSwap", color: "#F0B90B", short: "CAKE" },
  { name: "Biswap",      color: "#4C8EF7", short: "BSW"  },
  { name: "ApeSwap",     color: "#A855F7", short: "APE"  },
];

const PHASES = [
  { label: "Analysing Price Gaps",       icon: "📊", color: "#38bdf8" },
  { label: "Scanning DEX Pools",          icon: "🔍", color: "#4ade80" },
  { label: "Cross-DEX Arbitrage Scan",    icon: "↔️",  color: "#f59e0b" },
  { label: "Multi-Hop Path Analysis",     icon: "🔄", color: "#a78bfa" },
  { label: "Flash Loan Route Check",      icon: "⚡", color: "#fb923c" },
  { label: "Evaluating Liquidity Depth",  icon: "💧", color: "#34d399" },
];

function rand(min, max) { return Math.random() * (max - min) + min; }

function generatePrices() {
  const base = {
    "BNB/USDT":  590  + rand(-3, 3),
    "CAKE/USDT": 2.41 + rand(-0.05, 0.05),
    "ETH/USDT":  3520 + rand(-10, 10),
    "XRP/USDT":  0.612+ rand(-0.005, 0.005),
    "BUSD/USDT": 1.0  + rand(-0.002, 0.002),
  };
  const prices = {};
  PAIRS.forEach(pair => {
    prices[pair] = {};
    DEXES.forEach(dex => {
      prices[pair][dex.name] = base[pair] * (1 + rand(-0.005, 0.005));
    });
  });
  return prices;
}

function findOpportunities(prices) {
  return PAIRS.map(pair => {
    const entries = Object.entries(prices[pair]);
    const minE = entries.reduce((a, b) => a[1] < b[1] ? a : b);
    const maxE = entries.reduce((a, b) => a[1] > b[1] ? a : b);
    const gap  = ((maxE[1] - minE[1]) / minE[1]) * 100;
    return {
      pair, buyOn: minE[0], sellOn: maxE[0],
      buyPrice: minE[1], sellPrice: maxE[1],
      gap, profitable: gap > 0.8, flashLoan: gap > 1.0,
    };
  }).sort((a, b) => b.gap - a.gap);
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
  const [dexScores, setDexScores]       = useState({ PancakeSwap: 0, Biswap: 0, ApeSwap: 0 });
  const [stageLoopTick, setStageLoopTick] = useState(0);
  const intervalRef = useRef(null);
  const countRef    = useRef(null);
  const uptimeRef   = useRef(null);
  const tradeId     = useRef(0);

  const opps = findOpportunities(prices);

  const addLog = (msg, type = "info") => {
    setLogs(prev => [{ id: Date.now(), time: new Date().toLocaleTimeString(), msg, type }, ...prev.slice(0, 30)]);
  };

  useEffect(() => {
    if (running) {
      uptimeRef.current = setInterval(() => setUptime(u => u + 1), 1000);

      const doScan = () => {
        const newPrices = generatePrices();
        setPrices(newPrices);
        setScanCount(c => c + 1);
        setNextScan(10);
        setPhase(p => (p + 1) % PHASES.length);
        setDexScores({
          PancakeSwap: Math.round(rand(55, 95)),
          Biswap:      Math.round(rand(45, 90)),
          ApeSwap:     Math.round(rand(35, 85)),
        });

        const newOpps     = findOpportunities(newPrices);
        const profitable  = newOpps.filter(o => o.profitable);

        if (profitable.length > 0) {
          const opp     = profitable[0];
          const isFlash = opp.flashLoan;
          const isTri   = !isFlash && Math.random() > 0.7;
          const profit  = isFlash
            ? parseFloat(rand(40, 120).toFixed(2))
            : isTri
            ? parseFloat(rand(0.5, 2).toFixed(2))
            : parseFloat(rand(0.3, 1.5).toFixed(2));

          const trade = {
            id: tradeId.current++,
            time: new Date().toLocaleTimeString(),
            pair: opp.pair,
            buy: opp.buyOn, sell: opp.sellOn,
            gap: opp.gap.toFixed(3),
            profit, isFlash, isTri,
            hash: "0x" + Math.random().toString(16).slice(2, 10) + "...",
          };

          setTrades(prev => [trade, ...prev.slice(0, 19)]);
          setCycleProfit(p => parseFloat((p + profit).toFixed(2)));
          setTotalProfit(p => parseFloat((p + profit).toFixed(2)));
          setTotalTrades(t => t + 1);
          if (isFlash) setFlashTrades(f => f + 1);
          if (isTri)   setTriTrades(t => t + 1);

          addLog(
            isFlash ? `⚡ Flash loan: ${opp.pair} +${opp.gap.toFixed(3)}% → $${profit}`
            : isTri  ? `🔺 Triangle: ${opp.pair} → $${profit}`
            :          `✅ Trade: ${opp.pair} +${opp.gap.toFixed(3)}% → $${profit}`,
            isFlash ? "flash" : isTri ? "tri" : "success"
          );
        } else {
          addLog(`🔍 Scan #${scanCount + 1} — no gap above 0.8%`, "info");
        }
      };

      doScan();
      intervalRef.current = setInterval(doScan, 10000);
      countRef.current    = setInterval(() => setNextScan(n => Math.max(0, n - 1)), 1000);

      return () => {
        clearInterval(intervalRef.current);
        clearInterval(countRef.current);
        clearInterval(uptimeRef.current);
      };
    } else {
      clearInterval(intervalRef.current);
      clearInterval(countRef.current);
      clearInterval(uptimeRef.current);
    }
  }, [running]);

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

  const formatUptime = () => {
    const h = Math.floor(uptime / 3600).toString().padStart(2, "0");
    const m = Math.floor((uptime % 3600) / 60).toString().padStart(2, "0");
    const s = (uptime % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  const currentPhase = PHASES[phase % PHASES.length];
  const activeStageIndex = running ? Math.floor(stageLoopTick / 101) % PHASES.length : phase % PHASES.length;
  const animatedStageProgress = PHASES.map((_, idx) => (running ? (stageLoopTick + idx * 17) % 101 : 0));

  return (
    <div style={{
      background: "#080c18",
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
        @keyframes stageShimmer { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
        .trade-row { animation: fadeIn 0.3s ease; }
        ::-webkit-scrollbar { display: none; }
      `}</style>

      {/* Status Bar */}
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

      {/* Header */}
      <div style={{
        padding: "8px 20px 16px",
        borderBottom: "1px solid #1e293b",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{
              fontSize: 20, fontWeight: 800,
              background: "linear-gradient(90deg, #38bdf8, #a78bfa)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>ArbBot Pro</div>
            <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
              BSC · PancakeSwap · Biswap · ApeSwap
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
            <div style={{ fontSize: 10, color: "#334155" }}>
              Cycle {cycleDay}/7 · Scan #{scanCount}
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 80px" }}>

        {/* HOME TAB */}
        {tab === "home" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Profit Card */}
            <div style={{
              background: "linear-gradient(135deg, #0d2137, #1a0d37)",
              border: "1px solid #1e3a5f",
              borderRadius: 20, padding: "20px",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 11, color: "#475569", marginBottom: 4 }}>
                CYCLE PROFIT
              </div>
              <div style={{
                fontSize: 42, fontWeight: 900,
                color: cycleProfit > 0 ? "#4ade80" : "#e2e8f0",
              }}>
                ${cycleProfit.toFixed(2)}
              </div>
              <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
                All time: <strong style={{ color: "#a78bfa" }}>${totalProfit.toFixed(2)}</strong>
              </div>
              <div style={{
                display: "flex", justifyContent: "center", gap: 20,
                marginTop: 14, paddingTop: 14,
                borderTop: "1px solid #1e3a5f",
              }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#38bdf8" }}>{totalTrades}</div>
                  <div style={{ fontSize: 10, color: "#475569" }}>Trades</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#fb923c" }}>{flashTrades}</div>
                  <div style={{ fontSize: 10, color: "#475569" }}>Flash</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#a78bfa" }}>{triTrades}</div>
                  <div style={{ fontSize: 10, color: "#475569" }}>Triangle</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#4ade80" }}>{formatUptime()}</div>
                  <div style={{ fontSize: 10, color: "#475569" }}>Uptime</div>
                </div>
              </div>
            </div>

            {/* Scan Phase */}
            <div style={{
              background: "#0d1424", border: "1px solid #1e293b",
              borderRadius: 16, padding: 16,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8" }}>BOT ENGINE</span>
                <span style={{ fontSize: 11, color: "#334155" }}>
                  {running ? `Next scan: ${nextScan}s` : "Stopped"}
                </span>
              </div>

              {/* Current Phase */}
              <div style={{
                background: running ? "#0a1a2a" : "#080c18",
                border: `1px solid ${running ? currentPhase.color + "44" : "#1e293b"}`,
                borderRadius: 12, padding: "12px 14px",
                display: "flex", alignItems: "center", gap: 10,
                marginBottom: 12,
              }}>
                <span style={{ fontSize: 22 }}>{running ? currentPhase.icon : "⏸"}</span>
                <div>
                  <div style={{
                    fontSize: 13, fontWeight: 600,
                    color: running ? currentPhase.color : "#334155",
                  }}>
                    {running ? currentPhase.label : "Tap Start to begin"}
                  </div>
                  <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>
                    {running ? `Step ${(phase % PHASES.length) + 1} of ${PHASES.length}` : "Bot is idle"}
                  </div>
                </div>
              </div>

              {/* Phase Steps */}
              <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
                {PHASES.map((p, i) => {
                  const isActive = running && i === activeStageIndex;
                  return (
                    <div key={i} style={{
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: `1px solid ${isActive ? p.color : "#1e293b"}`,
                      boxShadow: isActive ? `0 0 12px ${p.color}55` : "none",
                      transition: "box-shadow 0.25s ease, border-color 0.25s ease",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontSize: 10, color: isActive ? p.color : "#94a3b8", fontWeight: 700 }}>
                          {p.icon} {p.label}
                        </span>
                        <span style={{ fontSize: 10, color: isActive ? p.color : "#94a3b8", fontWeight: 800 }}>
                          {`${Math.round(animatedStageProgress[i])}%`}
                        </span>
                      </div>
                      <div style={{ height: 5, borderRadius: 999, background: "#1e293b", overflow: "hidden" }}>
                        <div style={{
                          height: 5,
                          borderRadius: 999,
                          width: `${animatedStageProgress[i]}%`,
                          background: isActive
                            ? `linear-gradient(90deg, ${p.color}, #ffffff33, ${p.color})`
                            : p.color,
                          backgroundSize: isActive ? "200% 100%" : "100% 100%",
                          animation: isActive ? "stageShimmer 1.1s linear infinite" : "none",
                          transition: "width 0.3s ease",
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* DEX Bars */}
              {DEXES.map(dex => (
                <div key={dex.name} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: "#64748b" }}>{dex.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: dex.color }}>
                      {running ? `${dexScores[dex.name]}%` : "—"}
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: "#1e293b", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 3, background: dex.color,
                      width: running ? `${dexScores[dex.name]}%` : "0%",
                      transition: "width 1s ease",
                      boxShadow: running ? `0 0 6px ${dex.color}66` : "none",
                    }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Best Opportunity */}
            {opps[0] && running && (
              <div style={{
                background: opps[0].flashLoan ? "#0d0020" : opps[0].profitable ? "#0a1a0a" : "#0d1424",
                border: `1px solid ${opps[0].flashLoan ? "#7c3aed" : opps[0].profitable ? "#166534" : "#1e293b"}`,
                borderRadius: 16, padding: 16,
              }}>
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 10 }}>
                  BEST OPPORTUNITY
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 16, fontWeight: 800 }}>{opps[0].pair}</span>
                      {opps[0].flashLoan && (
                        <span style={{ fontSize: 10, background: "#581c87", color: "#e9d5ff", padding: "2px 7px", borderRadius: 4 }}>⚡ FLASH</span>
                      )}
                      {opps[0].profitable && !opps[0].flashLoan && (
                        <span style={{ fontSize: 10, background: "#166534", color: "#bbf7d0", padding: "2px 7px", borderRadius: 4 }}>✓ TRADE</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "#475569" }}>
                      Buy {opps[0].buyOn.replace("Swap", "")} → Sell {opps[0].sellOn.replace("Swap", "")}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{
                      fontSize: 24, fontWeight: 900,
                      color: opps[0].flashLoan ? "#a855f7" : opps[0].profitable ? "#4ade80" : "#475569",
                    }}>+{opps[0].gap.toFixed(3)}%</div>
                    <div style={{ fontSize: 10, color: "#334155" }}>
                      {opps[0].profitable ? "Above 0.8% threshold" : "Below threshold"}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 7-Day Progress */}
            <div style={{
              background: "#0d1424", border: "1px solid #1e293b",
              borderRadius: 16, padding: 16,
            }}>
              <div style={{ fontSize: 11, color: "#475569", marginBottom: 12 }}>
                7-DAY CYCLE PROGRESS
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[1,2,3,4,5,6,7].map(day => (
                  <div key={day} style={{ flex: 1, textAlign: "center" }}>
                    <div style={{
                      height: 36, borderRadius: 8,
                      background: day < cycleDay ? "#0a1a0a" : day === cycleDay ? "#0d2137" : "#080c18",
                      border: `1px solid ${day < cycleDay ? "#166534" : day === cycleDay ? "#1d4ed8" : "#1e293b"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14, marginBottom: 4,
                    }}>
                      {day < cycleDay ? "✅" : day === cycleDay ? "🔄" : "⬜"}
                    </div>
                    <div style={{ fontSize: 9, color: "#334155" }}>D{day}</div>
                  </div>
                ))}
              </div>
              <div style={{
                marginTop: 12, padding: "8px 12px",
                background: "#080c18", borderRadius: 8,
                display: "flex", justifyContent: "space-between",
                fontSize: 11, color: "#475569",
              }}>
                <span>💰 Profit: <strong style={{ color: "#4ade80" }}>${cycleProfit.toFixed(2)}</strong></span>
                <span>🏦 Capital: <strong style={{ color: "#38bdf8" }}>$100 safe</strong></span>
              </div>
            </div>

            {/* Start/Stop Button */}
            <button onClick={() => {
              if (!running) {
                setUptime(0); setCycleProfit(0);
                setTrades([]); setLogs([]); setScanCount(0);
                setTotalTrades(0); setFlashTrades(0); setTriTrades(0);
                setTotalProfit(0);
              }
              setRunning(r => !r);
            }} style={{
              width: "100%", padding: "18px",
              borderRadius: 16, border: "none",
              background: running
                ? "linear-gradient(135deg, #7f1d1d, #991b1b)"
                : "linear-gradient(135deg, #1d4ed8, #7c3aed)",
              color: "#fff", fontSize: 16, fontWeight: 800,
              cursor: "pointer", fontFamily: "inherit",
              boxShadow: running
                ? "0 4px 20px #ef444433"
                : "0 4px 20px #7c3aed44",
              letterSpacing: "0.04em",
            }}>
              {running ? "⏹  Stop Bot" : "▶  Start Bot Engine"}
            </button>

            {/* Protections */}
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
          </div>
        )}

        {/* TRADES TAB */}
        {tab === "trades" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>💱 Trade History</div>
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
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 800, fontSize: 15 }}>{t.pair}</span>
                      {t.isFlash && <span style={{ fontSize: 10, background: "#581c87", color: "#e9d5ff", padding: "2px 7px", borderRadius: 4 }}>⚡ FLASH</span>}
                      {t.isTri  && <span style={{ fontSize: 10, background: "#166534", color: "#bbf7d0", padding: "2px 7px", borderRadius: 4 }}>🔺 TRI</span>}
                    </div>
                    <span style={{ fontWeight: 900, fontSize: 17, color: "#4ade80" }}>+${t.profit}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#475569" }}>
                    <span>{t.buy.replace("Swap","")} → {t.sell.replace("Swap","")}</span>
                    <span>+{t.gap}% gap</span>
                    <span>{t.time}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#334155", marginTop: 4 }}>{t.hash}</div>
                </div>
              ))
            )}
          </div>
        )}

        {/* PRICES TAB */}
        {tab === "prices" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>🔍 Price Screener</div>
            {PAIRS.map(pair => {
              const pairPrices = Object.entries(prices[pair]).sort((a, b) => a[1] - b[1]);
              const gap = ((pairPrices[pairPrices.length-1][1] - pairPrices[0][1]) / pairPrices[0][1]) * 100;
              return (
                <div key={pair} style={{
                  background: "#0d1424", border: "1px solid #1e293b",
                  borderRadius: 14, padding: 14,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{pair}</span>
                    <span style={{
                      fontWeight: 700, fontSize: 13,
                      color: gap > 1.0 ? "#a855f7" : gap > 0.8 ? "#4ade80" : "#475569",
                    }}>
                      {gap > 1.0 ? "⚡" : gap > 0.8 ? "✅" : ""} {gap.toFixed(3)}%
                    </span>
                  </div>
                  {pairPrices.map(([dex, price], i) => {
                    const dexInfo = DEXES.find(d => d.name === dex);
                    const isBest  = i === pairPrices.length - 1;
                    const isWorst = i === 0;
                    return (
                      <div key={dex} style={{
                        display: "flex", justifyContent: "space-between",
                        alignItems: "center", padding: "8px 10px",
                        background: isBest ? "#0a1a0a" : isWorst ? "#1a0a0a" : "#080c18",
                        borderRadius: 8, marginBottom: 4,
                        border: `1px solid ${isBest ? "#166534" : isWorst ? "#7f1d1d" : "#1e293b"}`,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: dexInfo?.color }} />
                          <span style={{ fontSize: 12, color: "#94a3b8" }}>{dex}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{
                            fontWeight: 700, fontSize: 13,
                            color: isBest ? "#4ade80" : isWorst ? "#ef4444" : "#e2e8f0",
                          }}>{fmt(price)}</span>
                          <span style={{ fontSize: 9, color: isBest ? "#4ade80" : isWorst ? "#ef4444" : "#334155" }}>
                            {isBest ? "▲ SELL" : isWorst ? "▼ BUY" : ""}
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

        {/* LOGS TAB */}
        {tab === "logs" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>📋 Bot Logs</span>
              <button onClick={() => setLogs([])} style={{
                background: "none", border: "1px solid #1e293b",
                color: "#475569", padding: "4px 12px",
                borderRadius: 8, cursor: "pointer",
                fontSize: 11, fontFamily: "inherit",
              }}>Clear</button>
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

      {/* Bottom Navigation */}
      <div style={{
        position: "fixed", bottom: 0, left: "50%",
        transform: "translateX(-50%)",
        width: "100%", maxWidth: 430,
        background: "#0d1424",
        borderTop: "1px solid #1e293b",
        display: "flex", padding: "10px 0 20px",
        zIndex: 100,
      }}>
        {[
          { id: "home",   icon: "🏠", label: "Home"   },
          { id: "trades", icon: "💱", label: "Trades"  },
          { id: "prices", icon: "🔍", label: "Prices"  },
          { id: "logs",   icon: "📋", label: "Logs"    },
        ].map(item => (
          <button key={item.id} onClick={() => setTab(item.id)} style={{
            flex: 1, background: "none", border: "none",
            cursor: "pointer", display: "flex",
            flexDirection: "column", alignItems: "center", gap: 3,
          }}>
            <span style={{ fontSize: 22 }}>{item.icon}</span>
            <span style={{
              fontSize: 10, fontWeight: 600, fontFamily: "inherit",
              color: tab === item.id ? "#38bdf8" : "#334155",
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
