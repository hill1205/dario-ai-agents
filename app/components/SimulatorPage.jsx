"use client";
import { useState, useMemo } from "react";

// Simulatore "cosa succede se" per l'obiettivo di 1.000.000€ di fatturato
// annuo (IAGREX + Imperivm). Modello SaaS-style con churn: ogni mese si
// aggiungono nuovi clienti (dai lead) e se ne perde una quota % (churn).
// L'obiettivo è raggiunto quando MRR*12 (fatturato annualizzato) >= 1M€.
const OBIETTIVO_ANNUO = 1000000;
const MRR_TARGET = OBIETTIVO_ANNUO / 12; // 83.333€/mese
const MESI_SETTIMANE = 4.345; // settimane medie per mese
const MAX_MESI = 240; // cap simulazione a 20 anni, oltre è "non raggiungibile in tempi ragionevoli"

const THEME_VARS = {
  dark:  { "--c-bg":"#09090F", "--c-panel":"#0F0F1A", "--c-panel2":"#0B0B16", "--c-border":"#1A1A2E", "--c-text-strong":"#F8FAFC", "--c-text":"#E2E8F0", "--c-text-dim":"#64748B", "--c-text-faint":"#475569", "--c-text-faintest":"#334155", "--c-text-muted":"#94A3B8" },
  light: { "--c-bg":"#F4F5F7", "--c-panel":"#FFFFFF", "--c-panel2":"#F1F2F5", "--c-border":"#E2E4E9", "--c-text-strong":"#0F172A", "--c-text":"#1A1A2E", "--c-text-dim":"#475569", "--c-text-faint":"#94A3B8", "--c-text-faintest":"#CBD5E1", "--c-text-muted":"#64748B" },
};

function fmtEur(n) {
  return Math.round(n).toLocaleString("it-IT");
}

// Simula mese per mese: MRR(t) = MRR(t-1)*(1-churn) + nuoviClienti*prezzo.
// Ritorna {mesi, raggiunto, mrrFinale, serie} — serie usata per il mini-grafico.
function simula({ leadSettimana, tassoRisposta, tassoConversione, prezzo, churn }) {
  const nuoviClientiMese = leadSettimana * MESI_SETTIMANE * (tassoRisposta/100) * (tassoConversione/100);
  let mrr = 0;
  const serie = [0];
  let mesi = null;
  for (let m = 1; m <= MAX_MESI; m++) {
    mrr = mrr * (1 - churn/100) + nuoviClientiMese * prezzo;
    serie.push(mrr);
    if (mesi === null && mrr * 12 >= OBIETTIVO_ANNUO) { mesi = m; }
  }
  return { mesi, mrrFinale: mrr, nuoviClientiMese, serie };
}

function MiniChart({ serie, target }) {
  const W = 100, H = 100; // percentuale, scalato via viewBox
  const max = Math.max(...serie, target) * 1.05;
  const step = serie.length > 1 ? W / (serie.length - 1) : W;
  const pts = serie.map((v,i)=>`${i*step},${H - (v/max)*H}`).join(" ");
  const targetY = H - (target/max)*H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:120,display:"block"}} preserveAspectRatio="none">
      <line x1={0} y1={targetY} x2={W} y2={targetY} stroke="#F59E0B" strokeWidth="0.6" strokeDasharray="2,2"/>
      <polyline points={pts} fill="none" stroke="#3B82F6" strokeWidth="1.2"/>
    </svg>
  );
}

function Slider({ label, value, onChange, min, max, step, unit, hint, color }) {
  return (
    <div style={{marginBottom:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
        <span style={{fontSize:12,color:"var(--c-text-dim)"}}>{label}</span>
        <span style={{fontSize:14,fontWeight:700,color:color||"var(--c-text-strong)"}}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e=>onChange(Number(e.target.value))}
        style={{width:"100%",accentColor:color||"#8B5CF6",cursor:"pointer"}}/>
      {hint && <div style={{fontSize:10,color:"var(--c-text-faintest)",marginTop:2}}>{hint}</div>}
    </div>
  );
}

export default function SimulatorPage({ fontSize=14, onBack, theme="dark" }) {
  const fs = fontSize;
  const themeVars = THEME_VARS[theme] || THEME_VARS.dark;

  const [leadSettimana, setLeadSettimana]   = useState(50);
  const [tassoRisposta, setTassoRisposta]   = useState(20);
  const [tassoConversione, setTassoConversione] = useState(15);
  const [prezzo, setPrezzo]                 = useState(800);
  const [churn, setChurn]                   = useState(5);

  const params = { leadSettimana, tassoRisposta, tassoConversione, prezzo, churn };
  const risultato = useMemo(()=>simula(params), [leadSettimana, tassoRisposta, tassoConversione, prezzo, churn]);

  // Analisi leva: per ciascun parametro, +20% (o -20% per il churn, dove
  // "meglio" significa più basso) e vediamo di quanti mesi si accorcia il
  // percorso verso l'obiettivo rispetto alla baseline. Leva con impatto
  // maggiore = quella che sposta di più il traguardo.
  const leve = useMemo(() => {
    const baseline = risultato.mesi;
    const test = (overrides) => simula({ ...params, ...overrides }).mesi;
    const rows = [
      { id:"lead",   label:"Lead/settimana +20%",        mesi: test({ leadSettimana: leadSettimana*1.2 }) },
      { id:"risp",   label:"Tasso risposta +20%",        mesi: test({ tassoRisposta: Math.min(100, tassoRisposta*1.2) }) },
      { id:"conv",   label:"Tasso conversione +20%",     mesi: test({ tassoConversione: Math.min(100, tassoConversione*1.2) }) },
      { id:"prezzo", label:"Prezzo medio +20%",          mesi: test({ prezzo: prezzo*1.2 }) },
      { id:"churn",  label:"Churn -20%",                 mesi: test({ churn: Math.max(0, churn*0.8) }) },
    ].map(r => ({
      ...r,
      delta: (baseline==null || r.mesi==null) ? null : baseline - r.mesi,
    }));
    rows.sort((a,b) => (b.delta ?? -9999) - (a.delta ?? -9999));
    return rows;
  }, [leadSettimana, tassoRisposta, tassoConversione, prezzo, churn, risultato.mesi]);

  const dataRaggiungimento = useMemo(() => {
    if (risultato.mesi == null) return null;
    const d = new Date();
    d.setMonth(d.getMonth() + risultato.mesi);
    return d.toLocaleDateString("it-IT", { month:"long", year:"numeric" });
  }, [risultato.mesi]);

  return (
    <div style={{...themeVars, height:"100%", overflow:"auto", background:"var(--c-bg)", color:"var(--c-text)"}}>
      <div style={{maxWidth:900, margin:"0 auto", padding:"16px 16px 40px"}}>

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          {onBack && <button onClick={onBack} style={{padding:"5px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:12}}>← Home</button>}
          <div style={{fontWeight:700,fontSize:15,color:"var(--c-text-strong)"}}>🚀 Simulatore "cosa succede se" — Obiettivo 1M€</div>
        </div>

        {/* Risultato principale */}
        <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:14,padding:"18px 20px",marginBottom:18}}>
          {risultato.mesi != null ? (
            <>
              <div style={{fontSize:fs-1,color:"var(--c-text-dim)"}}>A questo ritmo raggiungi <b style={{color:"var(--c-text-strong)"}}>1.000.000€/anno</b> tra</div>
              <div style={{fontSize:32,fontWeight:800,color:"#10B981",margin:"4px 0"}}>{risultato.mesi} mesi</div>
              <div style={{fontSize:12,color:"var(--c-text-faint)"}}>circa {dataRaggiungimento} · MRR necessario: {fmtEur(MRR_TARGET)}€/mese</div>
            </>
          ) : (
            <>
              <div style={{fontSize:fs-1,color:"var(--c-text-dim)"}}>Con questi parametri il fatturato annualizzato si stabilizza a</div>
              <div style={{fontSize:26,fontWeight:800,color:"#EF4444",margin:"4px 0"}}>{fmtEur(risultato.mrrFinale*12)}€/anno</div>
              <div style={{fontSize:12,color:"var(--c-text-faint)"}}>non raggiunge 1M€ nemmeno in 20 anni: il churn erode i nuovi clienti troppo in fretta rispetto alla crescita. Serve alzare prezzo, conversione o lead, o abbassare il churn.</div>
            </>
          )}
          <div style={{marginTop:14}}>
            <MiniChart serie={risultato.serie} target={MRR_TARGET}/>
            <div style={{fontSize:10,color:"var(--c-text-faintest)",marginTop:2}}>MRR nel tempo (linea tratteggiata arancio = soglia 1M€/anno)</div>
          </div>
        </div>

        {/* Slider */}
        <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:14,padding:"18px 20px",marginBottom:18}}>
          <div style={{fontSize:12,color:"var(--c-text-dim)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:14}}>Le tue leve</div>
          <Slider label="Lead contattati / settimana" value={leadSettimana} onChange={setLeadSettimana} min={5} max={500} step={5} unit="" color="#3B82F6"/>
          <Slider label="Tasso di risposta" value={tassoRisposta} onChange={setTassoRisposta} min={1} max={80} step={1} unit="%" color="#8B5CF6"/>
          <Slider label="Tasso conversione risposta→cliente" value={tassoConversione} onChange={setTassoConversione} min={1} max={80} step={1} unit="%" color="#EC4899"/>
          <Slider label="Prezzo medio mensile per cliente" value={prezzo} onChange={setPrezzo} min={100} max={10000} step={50} unit="€" color="#F59E0B"/>
          <Slider label="Churn mensile (abbandono clienti)" value={churn} onChange={setChurn} min={0} max={30} step={0.5} unit="%" color="#EF4444"
            hint={`≈ ${fmtEur(risultato.nuoviClientiMese)} nuovi clienti/mese da questi lead`}/>
        </div>

        {/* Analisi leva più impattante */}
        <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:14,padding:"18px 20px"}}>
          <div style={{fontSize:12,color:"var(--c-text-dim)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>Quale leva ha più impatto?</div>
          <div style={{fontSize:11,color:"var(--c-text-faintest)",marginBottom:12}}>Ogni riga: effetto di migliorare SOLO quella leva del 20% rispetto alla situazione attuale (mesi risparmiati per arrivare a 1M€).</div>
          {leve.map((r,i)=>{
            const maxDelta = Math.max(...leve.map(x=>Math.abs(x.delta ?? 0)), 1);
            const width = r.delta==null ? 0 : Math.min(100, (Math.abs(r.delta)/maxDelta)*100);
            const positivo = r.delta != null && r.delta > 0;
            return (
              <div key={r.id} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3}}>
                  <span style={{color: i===0 ? "var(--c-text-strong)" : "var(--c-text-dim)", fontWeight: i===0?700:400}}>{i===0 && "🏆 "}{r.label}</span>
                  <span style={{color: positivo ? "#10B981" : r.delta===0 ? "var(--c-text-faint)" : "#EF4444", fontWeight:600}}>
                    {r.delta==null ? "non risolve" : r.delta===0 ? "nessun effetto" : positivo ? `-${r.delta} mesi` : `+${Math.abs(r.delta)} mesi`}
                  </span>
                </div>
                <div style={{height:6,borderRadius:3,background:"var(--c-panel2)",overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${width}%`,borderRadius:3,background: positivo?"#10B981":"#EF4444"}}/>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
