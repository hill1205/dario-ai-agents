"use client";
import { useState, useEffect, useCallback } from "react";

const CAT_ENTRATE = ["Retainer","One-time","Consulenza","Bonus","Conversione","Altro"];
const CAT_USCITE  = ["Keez / Commercialista","Software & Tools","Marketing","Hosting","Personale IAGREX","Tasse & Contributi","Conversione","Altro"];
const EUR_RON_FALLBACK = 5; // usato solo se il fetch del cambio live fallisce
const OBIETTIVO_ANNUO = 1000000;

const CONTI_IAGREX = [
  { id: "unicredit_eur", label: "UniCredit Romania — EUR", currency: "€" },
  { id: "unicredit_ron", label: "UniCredit Romania — RON", currency: "RON" },
];
const CONTI_IAGREX_BY_ID = Object.fromEntries(CONTI_IAGREX.map(c=>[c.id,c]));

const EMPTY_MONTH = { entrate: [], uscite: [], saldi: { unicredit_eur: 0, unicredit_ron: 0 } };

function genId() { return Math.random().toString(36).slice(2,10); }
function fmt(n) { return (parseFloat(n)||0).toLocaleString("it-IT",{minimumFractionDigits:0,maximumFractionDigits:2}); }
// Arrotonda a 2 decimali PRIMA di salvare il saldo — stesso motivo di
// BrunoPage.jsx: le somme/sottrazioni ripetute in floating point sporcano
// il valore (es. 2347.7399999999998) e l'input numerico del saldo mostra
// il valore grezzo, non passato per fmt().
function round2(n) { return Math.round((parseFloat(n)||0) * 100) / 100; }
function getMonthLabel(ym) {
  const [y,m] = ym.split("-");
  const months=["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
  return `${months[parseInt(m)-1]} ${y}`;
}
function getCurrentMonth() { return new Date().toISOString().slice(0,7); }
function getCurrentYear() { return new Date().getFullYear().toString(); }

const THEME_VARS = {
  dark:  { "--c-bg":"#09090F", "--c-panel":"#0F0F1A", "--c-panel2":"#0B0B16", "--c-border":"#1A1A2E", "--c-text-strong":"#F8FAFC", "--c-text":"#E2E8F0", "--c-text-dim":"#64748B", "--c-text-faint":"#475569", "--c-text-faintest":"#334155", "--c-text-muted":"#94A3B8" },
  light: { "--c-bg":"#F4F5F7", "--c-panel":"#FFFFFF", "--c-panel2":"#F1F2F5", "--c-border":"#E2E4E9", "--c-text-strong":"#0F172A", "--c-text":"#1A1A2E", "--c-text-dim":"#475569", "--c-text-faint":"#94A3B8", "--c-text-faintest":"#CBD5E1", "--c-text-muted":"#64748B" },
};

// Ultimi N mesi (compreso quello corrente) con entrate/uscite totali,
// anche se un mese non ha ancora dati (0€, non saltato) per non rompere
// la continuità visiva del trend.
function lastMonths(allData, n) {
  const out = [];
  const now = new Date();
  for (let i = n-1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const md = allData[ym] || { entrate:[], uscite:[] };
    // I movimenti di conversione tra conti (isConversione) non sono
    // fatturato/spesa vera: escluderli evita di gonfiare artificialmente
    // il cash flow visualizzato nel grafico.
    out.push({
      mese: ym,
      label: getMonthLabel(ym).slice(0,3),
      entrate: (md.entrate||[]).filter(e=>!e.isConversione).reduce((s,e)=>s+(parseFloat(e.importo)||0),0),
      uscite:  (md.uscite||[]).filter(e=>!e.isConversione).reduce((s,e)=>s+(parseFloat(e.importo)||0),0),
    });
  }
  return out;
}

// Mini cash-flow: entrate (verde) e uscite (rosso) affiancate mese per
// mese, per capire a colpo d'occhio se il trend accelera o rallenta
// invece di guardare solo il totale cumulato dell'anno.
// Tooltip fatto a mano invece del <title> nativo SVG: il <title> del
// browser ha un ritardo di ~1s prima di comparire ed è facilmente
// scambiato per "non funziona" — con lo stato React il numero appare
// subito appena il mouse tocca la barra, spostandosi col cursore.
function CashFlowMiniChart({ allData }) {
  const data = lastMonths(allData, 6);
  const W = 260, H = 56, gap = 10;
  const groupW = (W - gap*(data.length-1)) / data.length;
  const barW = groupW/2 - 1;
  const max = Math.max(...data.map(d=>Math.max(d.entrate,d.uscite)), 1);
  const [hover, setHover] = useState(null); // {x,y,label}
  return (
    <div style={{marginTop:12,background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10,padding:"12px 14px",position:"relative"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{fontSize:11,color:"var(--c-text-dim)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Cash flow ultimi 6 mesi</div>
        <div style={{fontSize:10,color:"var(--c-text-faint)"}}><span style={{color:"#10B981"}}>■</span> entrate <span style={{color:"#EF4444",marginLeft:6}}>■</span> uscite</div>
      </div>
      {hover && (
        <div style={{position:"absolute",left:hover.x,top:hover.y,transform:"translate(-50%,-100%)",background:"#000000E0",color:"#fff",fontSize:11,fontWeight:600,padding:"4px 8px",borderRadius:6,whiteSpace:"nowrap",pointerEvents:"none",zIndex:10,marginTop:-6}}>
          {hover.label}
        </div>
      )}
      <svg width="100%" height={H-14} viewBox={`0 0 ${W} ${H-14}`} preserveAspectRatio="none" style={{display:"block"}}>
        {data.map((d,i)=>{
          const gx = i*(groupW+gap);
          const he = Math.max((d.entrate/max)*(H-24), d.entrate>0?2:0);
          const hu = Math.max((d.uscite/max)*(H-24), d.uscite>0?2:0);
          const onMove = (label) => (e) => {
            const rect = e.currentTarget.closest("svg").parentElement.getBoundingClientRect();
            setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, label });
          };
          return (
            <g key={d.mese}>
              <rect x={gx} y={H-24-he} width={barW} height={he} rx={1.5} fill="#10B981" style={{cursor:"pointer"}}
                onMouseMove={onMove(`${getMonthLabel(d.mese)} — Entrate: ${fmt(d.entrate)}€`)}
                onMouseLeave={()=>setHover(null)}/>
              <rect x={gx+barW+2} y={H-24-hu} width={barW} height={hu} rx={1.5} fill="#EF4444" style={{cursor:"pointer"}}
                onMouseMove={onMove(`${getMonthLabel(d.mese)} — Uscite: ${fmt(d.uscite)}€`)}
                onMouseLeave={()=>setHover(null)}/>
            </g>
          );
        })}
      </svg>
      <div style={{display:"flex",marginTop:4}}>
        {data.map(d=>(
          <div key={d.mese} style={{flex:1,textAlign:"center",fontSize:12,fontWeight:500,color:"var(--c-text-faint)",letterSpacing:"0.01em"}}>{d.label}</div>
        ))}
      </div>
    </div>
  );
}

// Stesso componente barre usato in BrunoPage per il recap "dove vanno i
// soldi": una riga per categoria, ordinate dalla piu' alta, con importo e
// percentuale sul totale.
function CategoryBars({ data, total, color, fs, fmt }) {
  const entries = Object.entries(data).sort((a,b)=>b[1]-a[1]);
  if (entries.length===0) {
    return <div style={{fontSize:fs-2,color:"var(--c-text-faintest)",padding:"8px 0"}}>Nessun dato per questo mese</div>;
  }
  return entries.map(([cat,val])=>{
    const pct = total>0 ? (val/total*100) : 0;
    return (
      <div key={cat} style={{marginBottom:10}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:fs-2,marginBottom:4}}>
          <span style={{color:"var(--c-text)"}}>{cat}</span>
          <span style={{color:"var(--c-text-dim)",fontWeight:600}}>{fmt(val)}€ · {pct.toFixed(1)}%</span>
        </div>
        <div style={{height:8,background:"var(--c-border)",borderRadius:4,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${Math.min(pct,100)}%`,background:color,borderRadius:4}}/>
        </div>
      </div>
    );
  });
}

export default function IAGREXPage({ fontSize=14, onBack, theme="dark" }) {
  const fs = fontSize;
  const themeVars = THEME_VARS[theme] || THEME_VARS.dark;
  const [allData, setAllData]     = useState({});
  const [month, setMonth]         = useState(getCurrentMonth());
  const [tab, setTab]             = useState("entrate");
  const [filtroConto, setFiltroConto] = useState("");
  const [loading, setLoading]     = useState(true);
  const [saveStatus, setSaveStatus] = useState(null);
  const [modal, setModal]         = useState(null);
  const [form, setForm]           = useState({});
  const [convModal, setConvModal] = useState(false);
  const [convForm, setConvForm]   = useState({});
  // true finché non abbiamo la certezza di aver letto lo storico vero da
  // ClickUp. Finché resta true, blocchiamo il salvataggio: altrimenti un
  // "allData" ancora vuoto (perché il fetch è fallito, non perché lo
  // storico è davvero vuoto) verrebbe scritto su ClickUp alla prima
  // modifica, cancellando tutti i mesi precedenti.
  const [loadOk, setLoadOk]       = useState(false);
  const [loadError, setLoadError] = useState(null);
  // Cambio EUR->RON: proviamo a prenderlo live (BCE, via Frankfurter API,
  // gratuita e senza chiave). Se il fetch fallisce usiamo il valore fisso
  // di riserva, ma lo segnaliamo chiaramente invece di spacciarlo per live.
  const [eurRonRate, setEurRonRate] = useState(null);
  const [rateIsLive, setRateIsLive] = useState(false);

  useEffect(()=>{ loadData(); loadRate(); },[]);

  const loadRate = async () => {
    try {
      const res = await fetch("https://api.frankfurter.dev/v1/latest?from=EUR&to=RON");
      const j = await res.json();
      if (res.ok && j.rates?.RON) { setEurRonRate(j.rates.RON); setRateIsLive(true); }
      else { setEurRonRate(EUR_RON_FALLBACK); setRateIsLive(false); }
    } catch { setEurRonRate(EUR_RON_FALLBACK); setRateIsLive(false); }
  };

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/iagrex-finance");
      const j = await res.json();
      if (res.ok) { setAllData(j.data||{}); setLoadOk(true); }
      else { setLoadError(j.error || `Errore ${res.status}`); setLoadOk(false); }
    } catch (e) { setLoadError(e.message); setLoadOk(false); }
    setLoading(false);
  };

  const monthData = allData[month] || EMPTY_MONTH;

  const saveData = useCallback(async (newAllData) => {
    if (!loadOk) {
      // Non abbiamo mai confermato di aver letto lo storico reale:
      // rifiutiamo il salvataggio per non rischiare di sovrascrivere
      // mesi precedenti con dati incompleti.
      setSaveStatus("blocked");
      setTimeout(()=>setSaveStatus(null),3500);
      return;
    }
    setAllData(newAllData);
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/iagrex-finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: newAllData }),
      });
      setSaveStatus(res.ok?"saved":"error");
    } catch { setSaveStatus("error"); }
    setTimeout(()=>setSaveStatus(null),2500);
  },[loadOk]);

  const updateMonth = (updated) => saveData({...allData,[month]:updated});

  const prevMonth = () => {
    const [y,m] = month.split("-").map(Number);
    const d = new Date(y,m-2);
    setMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
  };
  const nextMonth = () => {
    const [y,m] = month.split("-").map(Number);
    const d = new Date(y,m);
    setMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
  };

  // Month totals
  // Le entrate/uscite in UniCredit RON restano in RON (stessa logica di
  // BrunoPage): la conversione in € avviene solo nei totali aggregati.
  const rate = eurRonRate || EUR_RON_FALLBACK;
  const contoCurrency = (contoId) => CONTI_IAGREX_BY_ID[contoId]?.currency || "€";
  const toEur = (item) => {
    const val = parseFloat(item.importo)||0;
    return contoCurrency(item.conto)==="RON" ? val/rate : val;
  };

  // I movimenti generati dal tasto "Conversione" (spostamento di soldi
  // già esistenti tra UniCredit EUR e UniCredit RON) non sono fatturato
  // né spesa reale: vanno esclusi da entrate/uscite/YTD, altrimenti una
  // conversione gonfierebbe artificialmente il progresso verso 1.000.000€
  // (o le uscite del mese) pur non essendo un vero incasso/costo.
  const isReal = (e) => !e.isConversione;

  // YTD progress — converte anche le entrate storiche in RON prima di
  // sommarle, altrimenti il progresso verso 1.000.000€ mischierebbe RON e EUR.
  const year = getCurrentYear();
  const ytdRevenue = Object.entries(allData)
    .filter(([k])=>k.startsWith(year))
    .reduce((s,[,v])=>s+(v.entrate||[]).filter(isReal).reduce((ss,e)=>ss+toEur(e),0),0);
  const ytdPct = Math.min(Math.round((ytdRevenue/OBIETTIVO_ANNUO)*100*10)/10, 100);
  const mesiRimanenti = 13 - (new Date().getMonth()+1); // dicembre incluso = 1
  const ritmoMensileNecessario = Math.round(Math.max(OBIETTIVO_ANNUO-ytdRevenue,0)/mesiRimanenti);

  const totEntrate = monthData.entrate.filter(isReal).reduce((s,e)=>s+toEur(e),0);
  const totUscite  = monthData.uscite.filter(isReal).reduce((s,e)=>s+toEur(e),0);
  const saldoNetto = totEntrate - totUscite;
  // Recap "dove vanno i soldi": aggregato per categoria del mese selezionato.
  const usciteByCat  = monthData.uscite.filter(isReal).reduce((acc,e)=>{ acc[e.categoria]=(acc[e.categoria]||0)+toEur(e); return acc; },{});
  const entrateByCat = monthData.entrate.filter(isReal).reduce((acc,e)=>{ acc[e.categoria]=(acc[e.categoria]||0)+toEur(e); return acc; },{});

  const openAdd = (tipo) => { setForm({descrizione:"",importo:"",categoria:tipo==="entrata"?CAT_ENTRATE[0]:CAT_USCITE[0],cliente:"",conto:CONTI_IAGREX[0].id}); setModal({tipo,mode:"add"}); };
  const openEdit = (tipo,item) => { setForm({...item}); setModal({tipo,mode:"edit",item}); };
  const closeModal = () => { setModal(null); setForm({}); };

  const saveItem = () => {
    if (!form.descrizione?.trim()||!form.importo) return;
    const item = {...form,importo:parseFloat(form.importo),id:modal.mode==="add"?genId():form.id};
    let updated = {...monthData, saldi:{...monthData.saldi}};
    if (modal.tipo==="uscita") {
      if (modal.mode==="edit" && modal.item?.conto) {
        updated.saldi[modal.item.conto] = round2((parseFloat(updated.saldi[modal.item.conto])||0) + (parseFloat(modal.item.importo)||0));
      }
      if (item.conto && updated.saldi[item.conto] !== undefined) {
        updated.saldi[item.conto] = round2((parseFloat(updated.saldi[item.conto])||0) - parseFloat(item.importo));
      }
      updated.uscite = modal.mode==="add"?[...updated.uscite,item]:updated.uscite.map(e=>e.id===item.id?item:e);
    } else {
      // L'entrata accredita il conto scelto (logica speculare alle uscite).
      if (modal.mode==="edit" && modal.item?.conto) {
        updated.saldi[modal.item.conto] = round2((parseFloat(updated.saldi[modal.item.conto])||0) - (parseFloat(modal.item.importo)||0));
      }
      if (item.conto && updated.saldi[item.conto] !== undefined) {
        updated.saldi[item.conto] = round2((parseFloat(updated.saldi[item.conto])||0) + parseFloat(item.importo));
      }
      updated.entrate = modal.mode==="add"?[...updated.entrate,item]:updated.entrate.map(e=>e.id===item.id?item:e);
    }
    updateMonth(updated);
    closeModal();
  };

  const deleteItem = (tipo,id) => {
    if (!confirm("Eliminare?")) return;
    let updated = {...monthData, saldi:{...monthData.saldi}};
    const item = (tipo==="uscita"?updated.uscite:updated.entrate).find(e=>e.id===id);
    // Annulla l'effetto sul saldo del conto: un'uscita torna ad accreditare
    // il conto, un'entrata torna a scalarlo (logica inversa di saveItem).
    const reverse = (it, eraUscita) => {
      if (!it?.conto || updated.saldi[it.conto] === undefined) return;
      updated.saldi[it.conto] = round2((parseFloat(updated.saldi[it.conto])||0) + (eraUscita?1:-1)*parseFloat(it.importo));
    };
    reverse(item, tipo==="uscita");
    updated.uscite  = updated.uscite.filter(e=>e.id!==id);
    updated.entrate = updated.entrate.filter(e=>e.id!==id);
    // Le voci create dal tasto "Conversione" sono in coppia (uscita da un
    // conto + entrata sull'altro, stesso pairId). Se l'utente ne cancella
    // una sola, l'altra resterebbe come movimento orfano che sposta un
    // saldo senza contropartita — quindi eliminiamo anche la gemella.
    if (item?.pairId) {
      const pairInUscite  = updated.uscite.find(e=>e.pairId===item.pairId);
      const pairInEntrate = updated.entrate.find(e=>e.pairId===item.pairId);
      const pair = pairInUscite || pairInEntrate;
      if (pair) {
        reverse(pair, !!pairInUscite);
        updated.uscite  = updated.uscite.filter(e=>e.id!==pair.id);
        updated.entrate = updated.entrate.filter(e=>e.id!==pair.id);
      }
    }
    updateMonth(updated);
  };

  const updateSaldo = (contoId,val) => {
    updateMonth({...monthData,saldi:{...monthData.saldi,[contoId]:parseFloat(val)||0}});
  };

  // --- Conversione tra conti (es. cambio EUR->RON fatto in banca) -------
  // Genera automaticamente un'uscita sul conto di partenza e un'entrata
  // sul conto di arrivo, collegate dallo stesso pairId, così l'utente non
  // deve inserirle a mano separatamente né rischiare di farle sballare i
  // saldi se dimentica un lato del movimento.
  const otherConto = (contoId) => CONTI_IAGREX.find(c=>c.id!==contoId)?.id || contoId;
  const openConversione = () => {
    setConvForm({
      da: CONTI_IAGREX[0].id,
      a: CONTI_IAGREX[1].id,
      importoDa: "",
      tasso: (eurRonRate||EUR_RON_FALLBACK).toFixed(4),
      data: new Date().toISOString().slice(0,10),
    });
    setConvModal(true);
  };
  const closeConv = () => { setConvModal(false); setConvForm({}); };

  // Il tasso rappresenta sempre "1 EUR = tasso RON", coerente con
  // eurRonRate/toEur usati nel resto della pagina — così l'utente inserisce
  // lo stesso numero che vede scritto sull'home banking, in qualunque
  // direzione stia convertendo.
  const calcImportoA = (form) => {
    const importoDa = parseFloat(form.importoDa)||0;
    const tasso = parseFloat(form.tasso)||0;
    if (!importoDa || !tasso || !form.da || !form.a) return 0;
    const daCcy = contoCurrency(form.da), aCcy = contoCurrency(form.a);
    if (daCcy===aCcy) return importoDa;
    return daCcy==="€" ? importoDa*tasso : importoDa/tasso;
  };

  const saveConversione = () => {
    const importoDa = parseFloat(convForm.importoDa);
    const tasso = parseFloat(convForm.tasso);
    if (!importoDa || importoDa<=0 || !tasso || tasso<=0 || !convForm.da || !convForm.a || convForm.da===convForm.a) return;
    const importoA = calcImportoA(convForm);
    const pairId = genId();
    const descrizione = `Conversione ${CONTI_IAGREX_BY_ID[convForm.da]?.label} → ${CONTI_IAGREX_BY_ID[convForm.a]?.label} (tasso ${tasso})`;
    const uscitaItem  = { id:genId(), descrizione, categoria:"Conversione", conto:convForm.da, importo:round2(importoDa), data:convForm.data, isConversione:true, pairId };
    const entrataItem = { id:genId(), descrizione, categoria:"Conversione", conto:convForm.a,  importo:round2(importoA),  data:convForm.data, isConversione:true, pairId, cliente:"" };

    let updated = {...monthData, saldi:{...monthData.saldi}};
    updated.saldi[convForm.da] = round2((parseFloat(updated.saldi[convForm.da])||0) - importoDa);
    updated.saldi[convForm.a]  = round2((parseFloat(updated.saldi[convForm.a])||0) + importoA);
    updated.uscite  = [...updated.uscite, uscitaItem];
    updated.entrate = [...updated.entrate, entrataItem];
    updateMonth(updated);
    closeConv();
  };

  const Cell = ({style={},children}) => (
    <div style={{padding:"10px 12px",fontSize:fs-2,color:"var(--c-text-muted)",display:"flex",alignItems:"center",...style}}>{children}</div>
  );

  return (
    <div style={{...themeVars,display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",background:"var(--c-bg)"}}>

      {/* Header */}
      <div style={{padding:"14px 20px",borderBottom:"1px solid var(--c-border)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {onBack && <button onClick={onBack} style={{padding:"5px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:12}}>← Home</button>}
            <div style={{fontWeight:700,fontSize:15,color:"var(--c-text-strong)"}}>📊 Finanze IAGREX</div>
            {saveStatus==="saving"  && <span style={{fontSize:11,color:"#F59E0B"}}>☁️ Salvataggio...</span>}
            {saveStatus==="saved"   && <span style={{fontSize:11,color:"#10B981"}}>✅ Salvato</span>}
            {saveStatus==="error"   && <span style={{fontSize:11,color:"#EF4444"}}>❌ Errore</span>}
            {saveStatus==="blocked" && <span style={{fontSize:11,color:"#EF4444"}}>🚫 Salvataggio bloccato: dati non caricati</span>}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button onClick={prevMonth} style={{width:28,height:28,borderRadius:6,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:14}}>‹</button>
            <span style={{fontSize:fs-1,fontWeight:700,color:"var(--c-text-strong)",minWidth:140,textAlign:"center"}}>{getMonthLabel(month)}</span>
            <button onClick={nextMonth} style={{width:28,height:28,borderRadius:6,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:14}}>›</button>
            <button onClick={loadData} style={{padding:"4px 8px",borderRadius:6,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:11}}>{loading?"⏳":"↻"}</button>
          </div>
        </div>
        {loadError && (
          <div style={{marginTop:8,padding:"8px 10px",borderRadius:7,border:"1px solid #EF444440",background:"#EF44440D",color:"#EF4444",fontSize:12}}>
            ⚠️ Impossibile caricare i dati da ClickUp ({loadError}). Le modifiche sono bloccate finché non si ricarica correttamente, per non rischiare di cancellare lo storico. Prova "↻".
          </div>
        )}

        {/* YTD Progress */}
        <div style={{marginTop:12,background:"var(--c-panel)",border:"1px solid #10B98130",borderRadius:10,padding:"12px 14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <div style={{fontSize:fs-3,color:"var(--c-text-dim)"}}>Progress {year} verso 1.000.000€</div>
            <div style={{fontSize:fs-2,fontWeight:700,color:"#10B981"}}>{fmt(ytdRevenue)}€ · {ytdPct}%</div>
          </div>
          <div style={{height:6,background:"var(--c-border)",borderRadius:3}}>
            <div style={{height:"100%",background:"linear-gradient(90deg,#10B981,#3B82F6)",borderRadius:3,width:`${Math.max(ytdPct,0.5)}%`,transition:"width 0.4s"}}/>
          </div>
          <div style={{fontSize:fs-4,color:"var(--c-text-faintest)",marginTop:4}}>Mancano {fmt(OBIETTIVO_ANNUO-ytdRevenue)}€ all'obiettivo annuo</div>
          <div style={{marginTop:6,paddingTop:6,borderTop:"1px solid var(--c-border)"}}>
            <div style={{fontSize:fs-5,color:"#3B82F6",textTransform:"uppercase",letterSpacing:"0.06em"}}>🎯 Ritmo necessario</div>
            <div style={{fontSize:fs+3,fontWeight:800,color:"#3B82F6"}}>
              {fmt(ritmoMensileNecessario)}€<span style={{fontSize:fs-2,fontWeight:400}}>/mese</span>
            </div>
            <div style={{fontSize:fs-4,color:"var(--c-text-faint)"}}>
              ripetuto per ciascuno dei {mesiRimanenti} mes{mesiRimanenti===1?"e rimanente":"i rimanenti"} per arrivare a 1.000.000€
            </div>
          </div>
        </div>

        <CashFlowMiniChart allData={allData}/>

        {/* Month summary */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8,marginTop:10}}>
          {[
            {label:"Entrate mese",val:totEntrate,color:"#10B981",prefix:"+"},
            {label:"Uscite mese", val:totUscite, color:"#EF4444",prefix:"-"},
            {label:"Saldo netto",  val:saldoNetto,color:saldoNetto>=0?"#10B981":"#EF4444",prefix:saldoNetto>=0?"+":""},
            {label:"MRR stimato",  val:totEntrate,color:"#3B82F6",prefix:""},
          ].map(c=>(
            <div key={c.label} style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:8,padding:"8px 12px"}}>
              <div style={{fontSize:fs-4,color:"var(--c-text-faint)",marginBottom:3}}>{c.label}</div>
              <div style={{fontSize:fs+1,fontWeight:800,color:c.color}}>{c.prefix}{fmt(c.val)}€</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid var(--c-border)",flexShrink:0,background:"var(--c-bg)"}}>
        <div style={{display:"flex"}}>
          {[["entrate","💚 Entrate"],["uscite","🔴 Uscite"],["saldi","🏦 Saldi"],["recap","📊 Recap"]].map(([t,label])=>(
            <button key={t} onClick={()=>setTab(t)} style={{padding:"10px 16px",border:"none",background:"transparent",cursor:"pointer",fontSize:fs-2,fontWeight:tab===t?700:400,color:tab===t?"var(--c-text-strong)":"var(--c-text-faint)",borderBottom:tab===t?"2px solid #3B82F6":"2px solid transparent"}}>{label}</button>
          ))}
        </div>
        <button onClick={openConversione} title="Registra un cambio di valuta tra i due conti UniCredit senza contarlo come entrata/uscita reale"
          style={{marginRight:12,padding:"6px 12px",borderRadius:7,border:"1px solid #8B5CF650",background:"#8B5CF61A",color:"#8B5CF6",cursor:"pointer",fontSize:12,fontWeight:600,whiteSpace:"nowrap"}}>
          🔄 Conversione
        </button>
      </div>

      {loading && <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--c-text-faintest)"}}>⏳ Caricamento...</div>}

      {!loading && (
        <div style={{flex:1,overflowY:"auto",padding:16}}>

          {tab==="entrate" && (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div style={{fontSize:fs-2,color:"var(--c-text-dim)"}}>Totale: <span style={{color:"#10B981",fontWeight:700}}>+{fmt(totEntrate)}€</span></div>
                <button onClick={()=>openAdd("entrata")} style={{padding:"6px 14px",borderRadius:7,border:"none",background:"#10B981",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600}}>+ Aggiungi</button>
              </div>
              <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10,overflow:"hidden"}}>
                {monthData.entrate.length===0
                  ? <div style={{padding:20,textAlign:"center",color:"var(--c-text-faintest)",fontSize:fs-2}}>Nessuna entrata — aggiungi la prima</div>
                  : monthData.entrate.map((e,i)=>(
                    <div key={e.id} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:0,borderTop:i===0?"none":"1px solid var(--c-border)",background:i%2===0?"var(--c-panel)":"var(--c-panel2)"}}>
                      <Cell style={{flexDirection:"column",alignItems:"flex-start",gap:2}}>
                        <span style={{color:"var(--c-text)",fontWeight:600}}>{e.descrizione}</span>
                        <span style={{fontSize:fs-4,color:"var(--c-text-faint)"}}>{e.categoria}{e.cliente?` · ${e.cliente}`:""}{e.conto?` · ${CONTI_IAGREX_BY_ID[e.conto]?.label||e.conto}`:""}</span>
                      </Cell>
                      <Cell style={{color:"#10B981",fontWeight:700}}>+{fmt(e.importo)}{contoCurrency(e.conto)==="RON"?" RON":"€"}</Cell>
                      <Cell><button onClick={()=>openEdit("entrata",e)} style={{width:24,height:24,borderRadius:5,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:10}}>✏️</button></Cell>
                      <Cell><button onClick={()=>deleteItem("entrata",e.id)} style={{width:24,height:24,borderRadius:5,border:"1px solid #2A1A1A",background:"transparent",color:"#EF4444",cursor:"pointer",fontSize:12,fontWeight:700}}>×</button></Cell>
                    </div>
                  ))
                }
              </div>
            </div>
          )}

          {tab==="uscite" && (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:8,flexWrap:"wrap"}}>
                <div style={{fontSize:fs-2,color:"var(--c-text-dim)"}}>Totale: <span style={{color:"#EF4444",fontWeight:700}}>-{fmt(filtroConto ? monthData.uscite.filter(e=>e.conto===filtroConto).reduce((s,e)=>s+toEur(e),0) : totUscite)}€</span></div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <select value={filtroConto} onChange={e=>setFiltroConto(e.target.value)} style={{padding:"6px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-panel)",color:"var(--c-text)",fontSize:12}}>
                    <option value="">Tutti i conti</option>
                    {CONTI_IAGREX.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <button onClick={()=>openAdd("uscita")} style={{padding:"6px 14px",borderRadius:7,border:"none",background:"#EF4444",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600}}>+ Aggiungi</button>
                </div>
              </div>
              <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10,overflow:"hidden"}}>
                {(() => { const filtered = monthData.uscite.filter(e=>!filtroConto || e.conto===filtroConto); return filtered.length===0
                  ? <div style={{padding:20,textAlign:"center",color:"var(--c-text-faintest)",fontSize:fs-2}}>Nessuna uscita</div>
                  : filtered.map((e,i)=>(
                    <div key={e.id} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:0,borderTop:i===0?"none":"1px solid var(--c-border)",background:i%2===0?"var(--c-panel)":"var(--c-panel2)"}}>
                      <Cell style={{flexDirection:"column",alignItems:"flex-start",gap:2}}>
                        <span style={{color:"var(--c-text)",fontWeight:600}}>{e.descrizione}</span>
                        <span style={{fontSize:fs-4,color:"var(--c-text-faint)"}}>{e.categoria}{e.conto?` · ${CONTI_IAGREX_BY_ID[e.conto]?.label||e.conto}`:""}</span>
                      </Cell>
                      <Cell style={{color:"#EF4444",fontWeight:700}}>-{fmt(e.importo)}{contoCurrency(e.conto)==="RON"?" RON":"€"}</Cell>
                      <Cell><button onClick={()=>openEdit("uscita",e)} style={{width:24,height:24,borderRadius:5,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:10}}>✏️</button></Cell>
                      <Cell><button onClick={()=>deleteItem("uscita",e.id)} style={{width:24,height:24,borderRadius:5,border:"1px solid #2A1A1A",background:"transparent",color:"#EF4444",cursor:"pointer",fontSize:12,fontWeight:700}}>×</button></Cell>
                    </div>
                  )); })()}
              </div>
            </div>
          )}

          {tab==="saldi" && (
            <div>
              <div style={{fontSize:fs-3,fontWeight:700,color:"#3B82F6",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>🏦 Saldi Conti IAGREX</div>
              <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10,overflow:"hidden"}}>
                {CONTI_IAGREX.map((c,i)=>(
                  <div key={c.id} style={{display:"grid",gridTemplateColumns:"1fr auto",borderTop:i===0?"none":"1px solid var(--c-border)",background:i%2===0?"var(--c-panel)":"var(--c-panel2)"}}>
                    <div style={{padding:"10px 12px",fontSize:fs-2,color:"var(--c-text)",display:"flex",alignItems:"center"}}>{c.label}</div>
                    <div style={{padding:"6px 12px",display:"flex",alignItems:"center",gap:4}}>
                      <input type="number" value={monthData.saldi?.[c.id]||""} onChange={e=>updateSaldo(c.id,e.target.value)} placeholder="0"
                        style={{width:100,padding:"5px 8px",borderRadius:6,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"#3B82F6",fontSize:fs-2,outline:"none",textAlign:"right",fontWeight:700}}/>
                      <span style={{fontSize:fs-3,color:"var(--c-text-faint)"}}>{c.currency}</span>
                    </div>
                  </div>
                ))}
                <div style={{padding:"10px 12px",borderTop:"1px solid var(--c-border)",background:"var(--c-bg)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                  <div>
                    <div style={{fontSize:fs-2,fontWeight:700,color:"#3B82F6"}}>Totale liquidità aziendale</div>
                    <div style={{fontSize:fs-4,color:"var(--c-text-faintest)",marginTop:2}}>
                      EUR convertiti a RON (×{(eurRonRate||EUR_RON_FALLBACK).toFixed(2)}{rateIsLive?" · cambio live BCE":" · cambio fisso di riserva"})
                    </div>
                  </div>
                  <span style={{fontSize:fs+1,fontWeight:800,color:"#8B5CF6"}}>
                    {fmt((parseFloat(monthData.saldi?.unicredit_eur)||0)*(eurRonRate||EUR_RON_FALLBACK) + (parseFloat(monthData.saldi?.unicredit_ron)||0))} RON
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* RECAP: dove vanno i soldi, mese per mese */}
          {tab==="recap" && (
            <div>
              <div style={{fontSize:fs-1,fontWeight:700,color:"var(--c-text-strong)",marginBottom:16}}>
                📊 Recap {getMonthLabel(month)}
              </div>

              <div style={{marginBottom:24}}>
                <div style={{fontSize:fs-3,fontWeight:700,color:"#EF4444",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>
                  🔴 Uscite per categoria — totale {fmt(totUscite)}€
                </div>
                <CategoryBars data={usciteByCat} total={totUscite} color="#EF4444" fs={fs} fmt={fmt}/>
              </div>

              <div>
                <div style={{fontSize:fs-3,fontWeight:700,color:"#10B981",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>
                  💚 Entrate per categoria — totale {fmt(totEntrate)}€
                </div>
                <CategoryBars data={entrateByCat} total={totEntrate} color="#10B981" fs={fs} fmt={fmt}/>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={closeModal}>
          <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:16,padding:24,width:"100%",maxWidth:400,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:15,fontWeight:700,color:"var(--c-text-strong)",marginBottom:20}}>
              {modal.mode==="add"?"➕ Nuova":"✏️ Modifica"} {modal.tipo==="entrata"?"Entrata":"Uscita"}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Descrizione *</div>
                <input type="text" value={form.descrizione||""} onChange={e=>setForm(p=>({...p,descrizione:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
              </div>
              {modal.tipo==="entrata" && (
                <div>
                  <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Cliente</div>
                  <input type="text" value={form.cliente||""} onChange={e=>setForm(p=>({...p,cliente:e.target.value}))} placeholder="Nome cliente..."
                    style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
                </div>
              )}
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:6}}>Categoria</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {(modal.tipo==="entrata"?CAT_ENTRATE:CAT_USCITE).map(c=>(
                    <button key={c} onClick={()=>setForm(p=>({...p,categoria:c}))}
                      style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${form.categoria===c?(modal.tipo==="entrata"?"#10B981":"#EF4444"):"var(--c-border)"}`,background:form.categoria===c?(modal.tipo==="entrata"?"#10B98120":"#EF444420"):"transparent",color:form.categoria===c?(modal.tipo==="entrata"?"#10B981":"#EF4444"):"var(--c-text-faint)",cursor:"pointer",fontSize:11}}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>{modal.tipo==="uscita"?"Pagato da 🏦":"Accreditato su 🏦"}</div>
                <select value={form.conto||""} onChange={e=>setForm(p=>({...p,conto:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}>
                  <option value="">-- Seleziona conto --</option>
                  {CONTI_IAGREX.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                {/* La valuta segue il conto selezionato: se incassi/paghi su
                    UniCredit RON scrivi l'importo in RON, la conversione
                    in € avviene solo nei totali aggregati (vedi toEur). */}
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>
                  Importo {contoCurrency(form.conto)} *
                </div>
                <input type="number" value={form.importo||""} onChange={e=>setForm(p=>({...p,importo:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button onClick={closeModal} style={{flex:1,padding:10,borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:13}}>Annulla</button>
              <button onClick={saveItem} style={{flex:2,padding:10,borderRadius:8,border:"none",background:modal.tipo==="entrata"?"#10B981":"#EF4444",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Salva</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Conversione tra conti */}
      {convModal && (
        <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={closeConv}>
          <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:16,padding:24,width:"100%",maxWidth:400,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:15,fontWeight:700,color:"var(--c-text-strong)",marginBottom:6}}>🔄 Conversione tra conti</div>
            <div style={{fontSize:11,color:"var(--c-text-faint)",marginBottom:20}}>
              Registra un cambio valuta fatto in banca: crea automaticamente un'uscita sul conto di partenza e un'entrata sul conto di arrivo, senza contarle come fatturato o spesa.
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Da conto 🏦</div>
                <select value={convForm.da||""} onChange={e=>{ const da=e.target.value; setConvForm(p=>({...p,da,a:p.a===da?otherConto(da):p.a})); }}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}>
                  {CONTI_IAGREX.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>A conto 🏦</div>
                <select value={convForm.a||""} onChange={e=>{ const a=e.target.value; setConvForm(p=>({...p,a,da:p.da===a?otherConto(a):p.da})); }}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}>
                  {CONTI_IAGREX.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>
                  Importo cambiato {contoCurrency(convForm.da)} *
                </div>
                <input type="number" value={convForm.importoDa||""} onChange={e=>setConvForm(p=>({...p,importoDa:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
              </div>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>
                  Tasso di cambio (1 EUR = ? RON) *
                </div>
                <input type="number" step="0.0001" value={convForm.tasso||""} onChange={e=>setConvForm(p=>({...p,tasso:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
                <div style={{fontSize:10,color:"var(--c-text-faintest)",marginTop:4}}>Precompilato con il cambio {rateIsLive?"live BCE":"fisso di riserva"} — modificalo con il tasso applicato dalla banca, se diverso.</div>
              </div>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Data</div>
                <input type="date" value={convForm.data||""} onChange={e=>setConvForm(p=>({...p,data:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
              </div>
              <div style={{background:"#8B5CF615",border:"1px solid #8B5CF640",borderRadius:8,padding:"10px 12px",fontSize:12,color:"var(--c-text)"}}>
                Accrediterai su <b>{CONTI_IAGREX_BY_ID[convForm.a]?.label}</b>: <b style={{color:"#8B5CF6"}}>{fmt(calcImportoA(convForm))} {contoCurrency(convForm.a)}</b>
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button onClick={closeConv} style={{flex:1,padding:10,borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:13}}>Annulla</button>
              <button onClick={saveConversione} style={{flex:2,padding:10,borderRadius:8,border:"none",background:"#8B5CF6",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Registra conversione</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
