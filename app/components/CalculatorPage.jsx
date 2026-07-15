"use client";
import { useState, useEffect, useMemo, useCallback } from "react";

const THEME_VARS = {
  dark:  { "--c-bg":"#09090F", "--c-panel":"#0F0F1A", "--c-panel2":"#0B0B16", "--c-border":"#1A1A2E", "--c-text-strong":"#F8FAFC", "--c-text":"#E2E8F0", "--c-text-dim":"#64748B", "--c-text-faint":"#475569", "--c-text-faintest":"#334155", "--c-text-muted":"#94A3B8" },
  light: { "--c-bg":"#F4F5F7", "--c-panel":"#FFFFFF", "--c-panel2":"#F1F2F5", "--c-border":"#E2E4E9", "--c-text-strong":"#0F172A", "--c-text":"#1A1A2E", "--c-text-dim":"#475569", "--c-text-faint":"#94A3B8", "--c-text-faintest":"#CBD5E1", "--c-text-muted":"#64748B" },
};

const CURRENCIES = [
  { code:"EUR", label:"€ EUR", flag:"🇪🇺" },
  { code:"RON", label:"RON — Leu rumeno", flag:"🇷🇴" },
  { code:"USD", label:"$ USD", flag:"🇺🇸" },
  { code:"HUF", label:"Ft HUF — Fiorino ungherese", flag:"🇭🇺" },
];

// Tassi di riserva (usati solo se il fetch live fallisce), base EUR —
// stessa filosofia già usata in IAGREXPage/BrunoPage per EUR->RON: mai
// bloccare l'utente, ma segnalare chiaramente se il tasso non è live.
const FALLBACK_RATES = { EUR:1, RON:5, USD:1.08, HUF:395 };

function fmtNumber(n, maxDecimals=6) {
  if (!isFinite(n)) return "0";
  // Mostra fino a maxDecimals cifre decimali ma toglie gli zeri superflui,
  // così 1.500000 diventa 1.5 e 3 resta 3 invece di 3.000000.
  const rounded = Math.round(n * 10**maxDecimals) / 10**maxDecimals;
  return rounded.toLocaleString("it-IT", { maximumFractionDigits: maxDecimals });
}

export default function CalculatorPage({ fontSize=14, onBack, theme="dark" }) {
  const fs = fontSize;
  const themeVars = THEME_VARS[theme] || THEME_VARS.dark;

  // --- Calcolatrice base -------------------------------------------------
  const [display, setDisplay]   = useState("0");
  const [prevValue, setPrevValue] = useState(null);
  const [operator, setOperator] = useState(null);
  const [waitingNext, setWaitingNext] = useState(false);

  const inputDigit = (d) => {
    if (waitingNext) { setDisplay(d); setWaitingNext(false); return; }
    setDisplay(prev => prev === "0" ? d : (prev.length >= 15 ? prev : prev + d));
  };
  const inputDot = () => {
    if (waitingNext) { setDisplay("0."); setWaitingNext(false); return; }
    setDisplay(prev => prev.includes(".") ? prev : prev + ".");
  };
  const clearAll = () => { setDisplay("0"); setPrevValue(null); setOperator(null); setWaitingNext(false); };
  const backspace = () => setDisplay(prev => prev.length > 1 ? prev.slice(0,-1) : "0");
  const toggleSign = () => setDisplay(prev => prev.startsWith("-") ? prev.slice(1) : (prev==="0"?prev:"-"+prev));
  const percent = () => setDisplay(prev => String(parseFloat(prev)/100));

  const compute = (a, b, op) => {
    switch(op) {
      case "+": return a + b;
      case "-": return a - b;
      case "×": return a * b;
      case "÷": return b === 0 ? NaN : a / b;
      default:  return b;
    }
  };

  const inputOperator = (op) => {
    const current = parseFloat(display);
    if (operator && !waitingNext) {
      const result = compute(prevValue, current, operator);
      setDisplay(String(result));
      setPrevValue(result);
    } else {
      setPrevValue(current);
    }
    setOperator(op);
    setWaitingNext(true);
  };

  const equals = () => {
    if (operator == null || prevValue == null) return;
    const current = parseFloat(display);
    const result = compute(prevValue, current, operator);
    setDisplay(String(result));
    setPrevValue(null);
    setOperator(null);
    setWaitingNext(true);
  };

  // --- Convertitore valuta -------------------------------------------------
  const [rates, setRates]       = useState(FALLBACK_RATES);
  const [ratesLive, setRatesLive] = useState(false);
  const [ratesLoading, setRatesLoading] = useState(true);
  const [amount, setAmount]     = useState("1");
  const [fromCur, setFromCur]   = useState("EUR");
  const [toCur, setToCur]       = useState("RON");

  const loadRates = useCallback(async () => {
    setRatesLoading(true);
    try {
      const res = await fetch("https://api.frankfurter.dev/v1/latest?from=EUR&to=RON,USD,HUF");
      const j = await res.json();
      if (res.ok && j.rates) {
        setRates({ EUR:1, RON:j.rates.RON||FALLBACK_RATES.RON, USD:j.rates.USD||FALLBACK_RATES.USD, HUF:j.rates.HUF||FALLBACK_RATES.HUF });
        setRatesLive(true);
      } else { setRates(FALLBACK_RATES); setRatesLive(false); }
    } catch { setRates(FALLBACK_RATES); setRatesLive(false); }
    setRatesLoading(false);
  }, []);

  useEffect(() => { loadRates(); }, [loadRates]);

  const convertedAmount = useMemo(() => {
    const n = parseFloat(amount);
    if (!isFinite(n)) return 0;
    // Tutti i tassi sono già rispetto a EUR: converto in EUR e poi nella valuta target.
    const inEur = n / (rates[fromCur] || 1);
    return inEur * (rates[toCur] || 1);
  }, [amount, fromCur, toCur, rates]);

  const swapCurrencies = () => { setFromCur(toCur); setToCur(fromCur); };
  const useCalcResult = () => { setAmount(display); };

  const BTN = { padding:"16px 0", borderRadius:12, border:"1px solid var(--c-border)", background:"var(--c-panel2)", color:"var(--c-text-strong)", cursor:"pointer", fontSize:18, fontWeight:600 };
  const BTN_OP = { ...BTN, background:"#8B5CF620", color:"#8B5CF6", border:"1px solid #8B5CF640" };
  const BTN_EQ = { ...BTN, background:"#8B5CF6", color:"#fff", border:"none" };
  const BTN_UTIL = { ...BTN, background:"var(--c-border)", color:"var(--c-text-dim)", fontSize:15 };

  return (
    <div style={{...themeVars, height:"100%", overflow:"auto", background:"var(--c-bg)", color:"var(--c-text)"}}>
      <div style={{maxWidth:760, margin:"0 auto", padding:"16px 16px 40px"}}>

        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          {onBack && <button onClick={onBack} style={{padding:"5px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:12}}>← Home</button>}
          <div style={{fontWeight:700,fontSize:15,color:"var(--c-text-strong)"}}>🧮 Calcolatrice & Cambio Valuta</div>
        </div>

        <div className="calc-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>

          {/* Calcolatrice */}
          <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:14,padding:18}}>
            <div style={{background:"var(--c-bg)",border:"1px solid var(--c-border)",borderRadius:10,padding:"18px 16px",marginBottom:14,textAlign:"right"}}>
              <div style={{fontSize:12,color:"var(--c-text-faint)",minHeight:16}}>{prevValue!=null && operator ? `${fmtNumber(prevValue)} ${operator}` : " "}</div>
              <div style={{fontSize:32,fontWeight:700,color:"var(--c-text-strong)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fmtNumber(parseFloat(display)||0, 8)}</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
              <button style={BTN_UTIL} onClick={clearAll}>C</button>
              <button style={BTN_UTIL} onClick={toggleSign}>±</button>
              <button style={BTN_UTIL} onClick={percent}>%</button>
              <button style={BTN_OP} onClick={()=>inputOperator("÷")}>÷</button>

              <button style={BTN} onClick={()=>inputDigit("7")}>7</button>
              <button style={BTN} onClick={()=>inputDigit("8")}>8</button>
              <button style={BTN} onClick={()=>inputDigit("9")}>9</button>
              <button style={BTN_OP} onClick={()=>inputOperator("×")}>×</button>

              <button style={BTN} onClick={()=>inputDigit("4")}>4</button>
              <button style={BTN} onClick={()=>inputDigit("5")}>5</button>
              <button style={BTN} onClick={()=>inputDigit("6")}>6</button>
              <button style={BTN_OP} onClick={()=>inputOperator("-")}>−</button>

              <button style={BTN} onClick={()=>inputDigit("1")}>1</button>
              <button style={BTN} onClick={()=>inputDigit("2")}>2</button>
              <button style={BTN} onClick={()=>inputDigit("3")}>3</button>
              <button style={BTN_OP} onClick={()=>inputOperator("+")}>+</button>

              <button style={{...BTN,gridColumn:"span 2"}} onClick={()=>inputDigit("0")}>0</button>
              <button style={BTN} onClick={inputDot}>,</button>
              <button style={BTN_EQ} onClick={equals}>=</button>

              <button style={{...BTN_UTIL,gridColumn:"span 4"}} onClick={backspace}>⌫ Cancella ultima cifra</button>
            </div>
          </div>

          {/* Convertitore valuta */}
          <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:14,padding:18}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{fontSize:12,color:"var(--c-text-dim)",textTransform:"uppercase",letterSpacing:"0.05em"}}>Cambio valuta</div>
              <div style={{fontSize:10,color: ratesLoading ? "var(--c-text-faint)" : ratesLive ? "#10B981" : "#F59E0B"}}>
                {ratesLoading ? "⏳ caricamento..." : ratesLive ? "✅ tassi live BCE" : "⚠️ tassi fissi di riserva"}
              </div>
            </div>

            <div style={{marginBottom:10}}>
              <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Importo</div>
              <input value={amount} onChange={e=>setAmount(e.target.value.replace(",","."))} inputMode="decimal"
                style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text-strong)",fontSize:18,fontWeight:600,outline:"none"}}/>
              <button onClick={useCalcResult} style={{marginTop:6,padding:"4px 9px",borderRadius:6,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:10}}>
                ⬅️ Usa risultato calcolatrice ({fmtNumber(parseFloat(display)||0)})
              </button>
            </div>

            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
              <select value={fromCur} onChange={e=>setFromCur(e.target.value)}
                style={{flex:1,padding:"9px 8px",borderRadius:8,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13}}>
                {CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
              </select>
              <button onClick={swapCurrencies} title="Inverti"
                style={{width:32,height:32,borderRadius:8,border:"1px solid var(--c-border)",background:"var(--c-panel2)",color:"var(--c-text-dim)",cursor:"pointer",fontSize:14,flexShrink:0}}>⇄</button>
              <select value={toCur} onChange={e=>setToCur(e.target.value)}
                style={{flex:1,padding:"9px 8px",borderRadius:8,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13}}>
                {CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
              </select>
            </div>

            <div style={{background:"var(--c-bg)",border:"1px solid #8B5CF640",borderRadius:10,padding:"16px",textAlign:"center",marginBottom:14}}>
              <div style={{fontSize:11,color:"var(--c-text-faint)",marginBottom:4}}>{fmtNumber(parseFloat(amount)||0)} {fromCur} =</div>
              <div style={{fontSize:26,fontWeight:800,color:"#8B5CF6"}}>{fmtNumber(convertedAmount)} {toCur}</div>
            </div>

            <div style={{fontSize:10,color:"var(--c-text-faintest)",lineHeight:1.6}}>
              {CURRENCIES.filter(c=>c.code!==fromCur).map(c=>(
                <div key={c.code} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderTop:"1px solid var(--c-border)"}}>
                  <span>1 {fromCur} =</span>
                  <span style={{color:"var(--c-text-muted)"}}>{fmtNumber((rates[c.code]||1)/(rates[fromCur]||1))} {c.code}</span>
                </div>
              ))}
            </div>

            <button onClick={loadRates} disabled={ratesLoading}
              style={{width:"100%",marginTop:12,padding:"8px",borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:ratesLoading?"not-allowed":"pointer",fontSize:11}}>
              {ratesLoading ? "⏳ Aggiornamento..." : "↻ Aggiorna tassi"}
            </button>
          </div>

        </div>
      </div>
      <style>{`
        @media (max-width: 720px) {
          .calc-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
