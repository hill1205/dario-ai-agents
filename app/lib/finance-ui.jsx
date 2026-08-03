"use client";
import { useState, useEffect, useRef } from "react";

// Codice condiviso tra le due pagine finanziarie (Finanze personali =
// BrunoPage, Finanze IAGREX = IAGREXPage).
//
// Perché esiste: i due file erano identici per circa l'85% e ogni correzione
// andava applicata due volte, con il rischio concreto che divergessero — è
// già accaduto (fmt e getMonthLabel avevano piccole differenze, e il calcolo
// del fatturato in /api/revenue è rimasto indietro rispetto a IAGREXPage
// finché non è stato allineato).
//
// Qui dentro sta SOLO ciò che era già identico nei due file: helper puri e
// componenti di presentazione senza stato condiviso, verificati riga per riga
// prima dell'estrazione. La logica specifica di ciascuna pagina (conti,
// categorie, storage su ClickUp, riconciliazione estratti conto) resta nei
// rispettivi file, dove le due pagine sono legittimamente diverse.

export const MESI_BREVI = ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"];

// (deploy 2026-07-29: commit di retrigger — Vercel aveva saltato la build
// del commit con le chip nelle pagine, questo forza una build completa)
// Sottocategorie della categoria "Trasporti", condivise tra Finanze personali
// e IAGREX: servono a distinguere i costi dell'AUTO (pratiche amministrative,
// carburante e manutenzione) dalle corse Bolt/Uber, che sono trasporti ma non
// costi dell'auto. Le voci auto compongono il "totale auto" nel Recap.
//
// Dal 2026-08-03 carburante e manutenzione sono due voci separate: finché
// stavano insieme, un tagliando da 400€ finiva nello stesso totale dei pieni e
// il costo al chilometro del carburante era illeggibile (una gomma nuova
// sembrava benzina). Il gasolio è un costo proporzionale ai km, il tagliando
// no: sommarli risponde a "quanto mi costa l'auto", ma non a "quanto consuma".
// Le etichette stanno in auto.js (modulo puro, eseguibile da node per i test)
// e vengono ri-esportate qui, dove le cercano le pagine.
export { SOTTOCAT_CARBURANTE, SOTTOCAT_MANUTENZIONE, SOTTOCAT_AUTO_LEGACY } from "./auto.js";
// "Parcheggi" è una voce a sé e non finisce in Amministrativo: il bollo lo
// paghi una volta l'anno e non dipende da come guidi, il parcheggio è una
// spesa ricorrente e comprimibile. Mescolarli nasconderebbe quanto pesa
// davvero lasciare l'auto al centro commerciale.
export const SOTTOCAT_TRASPORTI = ["Amministrativo auto","Carburante","Manutenzione auto","Parcheggi","Bolt/Uber"];
// Include anche il vecchio nome unico, altrimenti il "totale auto" dei mesi
// passati perderebbe di colpo tutti i rifornimenti già registrati.
export const SOTTOCAT_AUTO = ["Amministrativo auto","Carburante","Manutenzione auto","Parcheggi","Rifornimento + manutenzione"];
// Utenze: separare le bollette serve a rispondere a "sto consumando di più?",
// domanda che sul totale Utenze non si può fare (luce che sale e gas che
// scende si annullano a vicenda).
export const SOTTOCAT_UTENZE = ["Luce","Gas","Internet / Wifi","Acqua e condominio"];
// Cibo: la domanda a cui deve rispondere non è "quanto ho speso di cibo" (quella
// la dà già il totale della categoria) ma "quanto sto spendendo per mangiare
// fuori invece di cucinare". Per questo il taglio è casa vs fuori.
// Delivery sta con "fuori" anche se il pasto lo mangi in casa: costa come il
// ristorante ma nella testa finisce insieme alla spesa, ed è la voce che
// cresce senza che te ne accorga — separarla è l'unico modo per vederla.
export const SOTTOCAT_CIBO = ["Spesa","Ristorante","Bar","Delivery / Asporto"];
export const SOTTOCAT_CIBO_FUORI = ["Ristorante","Bar","Delivery / Asporto"];
// Palestra: separa il costo fisso da quello che decidi mese per mese.
// L'abbonamento lo paghi comunque, integratori e attrezzatura no — e sono
// quelli che fanno oscillare il totale.
// Attenzione a non confondere "Alimentazione" con Cibo: qui vanno proteine e
// integratori, non la spesa al supermercato, altrimenti le due categorie si
// rubano voci a vicenda e nessuna delle due torna.
export const SOTTOCAT_PALESTRA = ["Abbonamento","Alimentazione","Attrezzatura"];
// Mappa categoria -> sottocategorie disponibili: così aggiungere una categoria
// con sottocategorie non richiede di toccare form, CSV e recap uno per uno.
export const SOTTOCATEGORIE = {
  "Trasporti": SOTTOCAT_TRASPORTI,
  "Utenze":    SOTTOCAT_UTENZE,
  "Cibo":      SOTTOCAT_CIBO,
  "Palestra":  SOTTOCAT_PALESTRA,
};
// Emoji del gruppo sottocategorie nel form, per categoria.
export const ICONA_SOTTOCAT = { "Trasporti":"🚗", "Utenze":"💡", "Cibo":"🍽️", "Palestra":"💪" };
// Unità di misura del consumo, per sottocategoria. Registrare il consumo
// accanto all'importo è l'unico modo per distinguere "ho consumato di più" da
// "hanno alzato la tariffa": il rapporto importo/consumo è il costo unitario,
// e quello si muove solo se cambia il prezzo.
// Il valore qui è solo il default: sul singolo movimento resta modificabile,
// perché fornitori diversi fatturano il gas in m³ o in kWh.
// Gas in kWh e non in m³: E.ON Romania fattura in kWh, convertendo i metri
// cubi letti al contatore con il potere calorifico (Pcs ~10,6 kWh/m³). Chi
// avesse un fornitore che fattura in m³ può cambiare unità sul movimento.
export const UNITA_CONSUMO = {
  "Luce":              "kWh",
  "Gas":               "kWh",
  "Acqua e condominio": "m³",
};
export const UNITA_DISPONIBILI = ["kWh", "m³", "GB", "litri"];

export const MESI_LUNGHI = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

export const GIORNI_SETT = ["Lu","Ma","Me","Gi","Ve","Sa","Do"];

export const THEME_VARS = {
  dark:  { "--c-bg":"#09090F", "--c-panel":"#0F0F1A", "--c-panel2":"#0B0B16", "--c-border":"#1A1A2E", "--c-text-strong":"#F8FAFC", "--c-text":"#E2E8F0", "--c-text-dim":"#64748B", "--c-text-faint":"#475569", "--c-text-faintest":"#334155", "--c-text-muted":"#94A3B8" },
  light: { "--c-bg":"#F4F5F7", "--c-panel":"#FFFFFF", "--c-panel2":"#F1F2F5", "--c-border":"#E2E4E9", "--c-text-strong":"#0F172A", "--c-text":"#1A1A2E", "--c-text-dim":"#475569", "--c-text-faint":"#94A3B8", "--c-text-faintest":"#CBD5E1", "--c-text-muted":"#64748B" },
};

export function genId() { return Math.random().toString(36).slice(2,10); }

// Ordina per data decrescente (più recente prima); voci senza data restano
// in fondo invece di rompere l'ordinamento.
export function sortByDataDesc(items) {
  return [...items].sort((a,b) => (b.data||"").localeCompare(a.data||""));
}

// Raggruppa per giorno (vista "più recenti"): un blocco per data, ordinati
// dal più recente, con il totale del giorno in testa. Le voci senza data
// finiscono tutte insieme in fondo sotto "Senza data".
export function groupByDayDesc(items) {
  const sorted = sortByDataDesc(items);
  const groups = [];
  let current = null;
  for (const it of sorted) {
    const key = it.data || "__nodate__";
    if (!current || current.key !== key) {
      current = { key, data: it.data || null, items: [] };
      groups.push(current);
    }
    current.items.push(it);
  }
  return groups;
}

// "2026-07-24" -> "Gio 24 Luglio 2026" (giorno della settimana incluso,
// utile per riconoscere weekend/pattern di spesa a colpo d'occhio).
export function formatDayLabel(ymd) {
  if (!ymd) return "Senza data";
  const d = new Date(ymd + "T00:00:00");
  if (isNaN(d.getTime())) return ymd;
  const giorni = ["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
  const mesi = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
  return `${giorni[d.getDay()]} ${d.getDate()} ${mesi[d.getMonth()]} ${d.getFullYear()}`;
}

export function pad2(n) { return String(n).padStart(2,"0"); }

export function ymdStr(y,m,d) { return `${y}-${pad2(m)}-${pad2(d)}`; }

export function fmtShortDate(ymd) {
  if (!ymd) return "";
  const [y,m,d] = ymd.split("-").map(Number);
  return `${d} ${MESI_BREVI[m-1]}`;
}

export function daysGrid(y,m) {
  const first = new Date(y, m-1, 1);
  const startWeekday = (first.getDay()+6)%7; // Lunedì=0
  const numDays = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i=0;i<startWeekday;i++) cells.push(null);
  for (let d=1; d<=numDays; d++) cells.push(d);
  return cells;
}

// Selettore periodo "da...a" in un unico tasto con calendario a comparsa
// (stile Booking.com): un clic apre il popup, primo giorno cliccato = inizio,
// secondo = fine (le date intermedie si illuminano). Sostituisce i due
// vecchi input <input type="date"> separati.
export function DateRangePicker({ da, a, onChange, accent="#3B82F6" }) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const [viewY, setViewY] = useState(today.getFullYear());
  const [viewM, setViewM] = useState(today.getMonth()+1); // 1-12
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const base = a || da;
    if (base) { const [y,m] = base.split("-").map(Number); setViewY(y); setViewM(m); }
    const onDocClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const label = da && a ? `${fmtShortDate(da)} – ${fmtShortDate(a)}` : da ? `Da ${fmtShortDate(da)}` : "Tutto il periodo";

  const prevMonth = () => { let y=viewY, m=viewM-1; if (m<1){m=12;y--;} setViewY(y); setViewM(m); };
  const nextMonth = () => { let y=viewY, m=viewM+1; if (m>12){m=1;y++;} setViewY(y); setViewM(m); };

  const handleDayClick = (d) => {
    const dstr = ymdStr(viewY, viewM, d);
    if (!da || (da && a)) {
      onChange(dstr, "");
    } else {
      if (dstr < da) onChange(dstr, da); else onChange(da, dstr);
      setOpen(false);
    }
  };

  const cells = daysGrid(viewY, viewM);

  return (
    <div ref={wrapRef} style={{ position:"relative", display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
      <button onClick={()=>setOpen(o=>!o)} title="Filtra per periodo"
        style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 10px", borderRadius:7, border:`1px solid ${(da||a)?accent:"var(--c-border)"}`, background:(da||a)?`${accent}15`:"var(--c-bg)", color:(da||a)?accent:"var(--c-text-dim)", cursor:"pointer", fontSize:12, fontWeight:(da||a)?600:400, whiteSpace:"nowrap", flexShrink:0 }}>
        📅 {label}
      </button>
      {(da||a) && (
        <button onClick={()=>{ onChange("",""); setOpen(false); }} title="Rimuovi filtro periodo"
          style={{ flexShrink:0, padding:"6px 8px", borderRadius:7, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-faint)", cursor:"pointer", fontSize:11 }}>✕</button>
      )}
      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 6px)", left:0, zIndex:100, background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, padding:12, width:240, boxShadow:"0 12px 28px -8px #00000060" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <button onClick={prevMonth} style={{ width:24, height:24, borderRadius:6, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:12 }}>‹</button>
            <span style={{ fontSize:12, fontWeight:700, color:"var(--c-text-strong)" }}>{MESI_LUNGHI[viewM-1]} {viewY}</span>
            <button onClick={nextMonth} style={{ width:24, height:24, borderRadius:6, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:12 }}>›</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:2 }}>
            {GIORNI_SETT.map(g=>(
              <div key={g} style={{ textAlign:"center", fontSize:10, color:"var(--c-text-faint)", padding:"2px 0" }}>{g}</div>
            ))}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2 }}>
            {cells.map((d,i) => {
              if (!d) return <div key={i}/>;
              const dstr = ymdStr(viewY, viewM, d);
              const isStart = dstr===da, isEnd = dstr===a;
              const inRange = da && a && dstr>da && dstr<a;
              const isEdge = isStart || isEnd;
              return (
                <button key={i} onClick={()=>handleDayClick(d)}
                  style={{
                    height:26, borderRadius:6, border:"none", cursor:"pointer", fontSize:11,
                    background: isEdge ? accent : inRange ? `${accent}30` : "transparent",
                    color: isEdge ? "#fff" : "var(--c-text)",
                    fontWeight: isEdge ? 700 : 400,
                  }}>{d}</button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Piccolo toggle "Per categoria / Più recenti" riusato da entrate e uscite.
export function VistaToggle({ vista, onChange, accent }) {
  const opts = [["categoria","📁 Per categoria"],["recenti","🕒 Più recenti"]];
  return (
    <div style={{ display:"flex", gap:4 }}>
      {opts.map(([v,label])=>(
        <button key={v} onClick={()=>onChange(v)}
          style={{ padding:"5px 10px", borderRadius:6, border:`1px solid ${vista===v?accent:"var(--c-border)"}`, background:vista===v?`${accent}20`:"transparent", color:vista===v?accent:"var(--c-text-faint)", cursor:"pointer", fontSize:11, fontWeight:vista===v?700:400, whiteSpace:"nowrap" }}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function fmt(n) {
  const num = parseFloat(n) || 0;
  return num.toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Arrotonda a 2 decimali PRIMA di salvare il saldo (non solo in fase di
// visualizzazione): sottrazioni/addizioni ripetute in floating point
// accumulano rumore tipo 2347.7399999999998, che poi comparirebbe intero
// nell'input numerico del saldo (che mostra il valore grezzo, non fmt()).
export function round2(n) { return Math.round((parseFloat(n)||0) * 100) / 100; }

// Costo implicito di un cambio valuta: quanto la banca "prende" applicando
// un tasso peggiore di quello ufficiale BCE dello stesso giorno. Entrambi i
// tassi sono sempre "1 EUR = tasso RON" (convenzione di tutta l'app).
// Ritorna il costo NELLA VALUTA DEL CONTO DI PARTENZA (coerente col campo
// `commissioni` dei movimenti, che vive nella valuta del conto pagante) e la
// percentuale sul cambiato. Positivo = la banca ha applicato un tasso
// sfavorevole; negativo = meglio del BCE (raro ma possibile).
export function costoCambio(importoDa, tassoBanca, tassoBce, daCcy) {
  const imp = parseFloat(importoDa)||0, tb = parseFloat(tassoBanca)||0, tr = parseFloat(tassoBce)||0;
  if (!imp || !tb || !tr) return null;
  // EUR->RON: ricevi imp*tb invece di imp*tr; ammanco in EUR = imp*(tr-tb)/tr.
  // RON->EUR: ricevi imp/tb invece di imp/tr; ammanco in RON = imp*(1 - tr/tb).
  const pct = daCcy==="€" ? (tr-tb)/tr : (1 - tr/tb);
  return { costo: imp*pct, pct: pct*100 };
}

export function getMonthLabel(ym) {
  const [y, m] = ym.split("-");
  const months = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
  return `${months[parseInt(m)-1]} ${y}`;
}

// Data locale in formato ISO (YYYY-MM-DD). NON usare toISOString(): ragiona
// in UTC, quindi tra la mezzanotte e le 3 di notte in Romania (UTC+3) dava il
// giorno precedente — e il giorno 1 del mese perfino il mese precedente.
export function localISODate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function getCurrentMonth() {
  return localISODate().slice(0,7);
}

// Stessa idea del mini cash-flow di IAGREXPage: ultimi 6 mesi, entrate
// verdi e uscite rosse affiancate, per vedere il trend personale invece
// del solo totale del mese corrente.
// `toEur` è la stessa funzione di conversione usata dalla pagina chiamante
// per i totali del mese: senza, i movimenti in RON venivano sommati come se
// fossero EUR e le colonne del grafico risultavano gonfiate (es. luglio 2026
// mostrava >3000€ contro i 1282€/1492€ reali). Il default somma l'importo
// grezzo solo come fallback per chiamanti senza conti multivaluta.
export function lastMonths(allData, n, toEur) {
  const val = toEur || ((e)=>parseFloat(e.importo)||0);
  const out = [];
  const now = new Date();
  for (let i = n-1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const md = allData[ym] || { entrate:[], uscite:[] };
    // I movimenti di conversione tra conti (isConversione) non sono
    // entrata/uscita vera: escluderli evita di gonfiare il cash flow.
    out.push({
      mese: ym,
      label: getMonthLabel(ym).slice(0,3),
      entrate: (md.entrate||[]).filter(e=>!e.isConversione).reduce((s,e)=>s+val(e),0),
      uscite:  (md.uscite||[]).filter(e=>!e.isConversione).reduce((s,e)=>s+val(e),0),
    });
  }
  return out;
}

// Tooltip fatto a mano invece del <title> nativo SVG: il <title> del
// browser ha un ritardo di ~1s prima di comparire ed è facilmente
// scambiato per "non funziona" — con lo stato React il numero appare
// subito appena il mouse tocca la barra, spostandosi col cursore.
// marginTop è un parametro perché le due pagine usavano margini diversi
// (10px le finanze personali, 12px IAGREX): tenerlo configurabile evita di
// alterare la resa grafica di una delle due ora che il componente è condiviso.
export function CashFlowMiniChart({ allData, marginTop = 10, toEur }) {
  // Toggle 6/12 mesi, ricordato tra una visita e l'altra: la scelta è una
  // preferenza di lettura, non un filtro momentaneo. localStorage si legge
  // in useEffect (non nell'initializer) per non creare differenze tra il
  // render server e quello client (hydration mismatch).
  const [nMesi, setNMesi] = useState(6);
  useEffect(()=>{ try { if (parseInt(localStorage.getItem("dario-cashflow-mesi"))===12) setNMesi(12); } catch {} },[]);
  const setMesi = (n)=>{ setNMesi(n); try { localStorage.setItem("dario-cashflow-mesi", String(n)); } catch {} };
  const data = lastMonths(allData, nMesi, toEur);
  const W = 260, H = 56, gap = nMesi===12 ? 5 : 10;
  const groupW = (W - gap*(data.length-1)) / data.length;
  const barW = groupW/2 - 1;
  const max = Math.max(...data.map(d=>Math.max(d.entrate,d.uscite)), 1);
  const [hover, setHover] = useState(null); // {x,y,label}
  return (
    <div style={{marginTop,background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10,padding:"12px 14px",position:"relative"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{fontSize:11,color:"var(--c-text-dim)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Cash flow ultimi {nMesi} mesi</div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{fontSize:10,color:"var(--c-text-faint)"}}><span style={{color:"#10B981"}}>■</span> entrate <span style={{color:"#EF4444",marginLeft:6}}>■</span> uscite <span style={{color:"#3B82F6",marginLeft:6}}>—</span> netto</div>
          <div style={{display:"flex",border:"1px solid var(--c-border)",borderRadius:6,overflow:"hidden"}}>
            {[6,12].map(n=>(
              <button key={n} onClick={()=>setMesi(n)} style={{padding:"2px 8px",border:"none",cursor:"pointer",fontSize:10,fontWeight:nMesi===n?700:400,background:nMesi===n?"var(--c-border)":"transparent",color:nMesi===n?"var(--c-text-strong)":"var(--c-text-faint)"}}>{n}M</button>
            ))}
          </div>
        </div>
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
          const netto = d.entrate - d.uscite;
          const nettoStr = `${netto>=0?"+":"−"}${fmt(Math.abs(netto))}€`;
          return (
            <g key={d.mese}>
              <rect x={gx} y={H-24-he} width={barW} height={he} rx={1.5} fill="#10B981" style={{cursor:"pointer"}}
                onMouseMove={onMove(`${getMonthLabel(d.mese)} — Entrate: ${fmt(d.entrate)}€ · Netto: ${nettoStr}`)}
                onMouseLeave={()=>setHover(null)}/>
              <rect x={gx+barW+2} y={H-24-hu} width={barW} height={hu} rx={1.5} fill="#EF4444" style={{cursor:"pointer"}}
                onMouseMove={onMove(`${getMonthLabel(d.mese)} — Uscite: ${fmt(d.uscite)}€ · Netto: ${nettoStr}`)}
                onMouseLeave={()=>setHover(null)}/>
            </g>
          );
        })}
        {(()=>{
          // Linea del netto (entrate − uscite) con scala propria: il netto può
          // essere negativo, quindi non condivide la scala delle barre (che
          // parte da zero). Mostra il TREND del netto, non il valore assoluto —
          // i numeri esatti sono nel tooltip delle barre.
          const netti = data.map(d=>d.entrate-d.uscite);
          const nMin = Math.min(...netti, 0), nMax = Math.max(...netti, 0);
          const span = (nMax-nMin) || 1;
          const yOf = v => (H-24) - ((v-nMin)/span)*(H-26) - 1;
          const pts = netti.map((v,i)=>`${i*(groupW+gap)+groupW/2},${yOf(v)}`).join(" ");
          return (
            <g style={{pointerEvents:"none"}}>
              <polyline points={pts} fill="none" stroke="#3B82F6" strokeWidth="1.5" opacity="0.9"/>
              {netti.map((v,i)=>(
                <circle key={i} cx={i*(groupW+gap)+groupW/2} cy={yOf(v)} r="2" fill="#3B82F6"/>
              ))}
            </g>
          );
        })()}
      </svg>
      <div style={{display:"flex",marginTop:4}}>
        {data.map(d=>(
          <div key={d.mese} style={{flex:1,textAlign:"center",fontSize:nMesi===12?10:12,fontWeight:500,color:"var(--c-text-faint)",letterSpacing:"0.01em"}}>{d.label}</div>
        ))}
      </div>
    </div>
  );
}

// Barre orizzontali per il recap "dove vanno i soldi": una riga per
// categoria, ordinate dalla piu' alta alla piu' bassa, con importo e
// percentuale sul totale. Componente a livello di modulo (non ridefinito
// ad ogni render) per evitare lo stesso bug di remount gia' risolto altrove.
export function CategoryBars({ data, total, color, fs, fmt }) {
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

// ---------------------------------------------------------------------------
// Propagazione dei saldi ai mesi successivi.
//
// PERCHE' ESISTE
// Ogni mese conserva i propri saldi, fotografati quando il mese viene creato.
// Finché il mese successivo non esiste, correggere una spesa del mese in corso
// funziona; ma appena esiste (es. agosto), una correzione retroattiva a luglio
// aggiornava solo luglio e agosto restava disallineato — il 2026-08-02 questo
// ha prodotto 4,34€ di scarto su BdM.
//
// COME FUNZIONA
// Si confrontano i saldi prima e dopo il salvataggio: per ogni mese che è
// cambiato si calcola la differenza per conto e la si somma a TUTTI i mesi
// successivi già esistenti. In pratica una correzione nel passato scorre in
// avanti, come succederebbe su un estratto conto reale.
//
// I mesi che l'operazione ha già modificato per conto proprio vengono saltati:
// è il caso di un movimento spostato da luglio ad agosto, dove entrambi i mesi
// sono già stati sistemati e sommare di nuovo la differenza raddoppierebbe
// l'effetto.
// ---------------------------------------------------------------------------
export function propagaSaldiAiMesiSuccessivi(prevAll, nextAll) {
  const isMese = (k) => /^\d{4}-\d{2}$/.test(k);
  const mesi = Object.keys(nextAll || {}).filter(isMese).sort();
  if (mesi.length < 2) return nextAll;

  const saldiDi = (all, m) => (all && all[m] && all[m].saldi) || null;
  const toccati = mesi.filter(m => JSON.stringify(saldiDi(prevAll, m)) !== JSON.stringify(saldiDi(nextAll, m)));
  if (toccati.length === 0) return nextAll;

  const out = { ...nextAll };
  for (const m of toccati) {
    const prima = saldiDi(prevAll, m);
    const dopo  = saldiDi(out, m);
    // Mese appena creato: non c'è un "prima", quindi nessuna differenza da
    // riportare in avanti (i suoi saldi sono già il riporto del mese prima).
    if (!prima || !dopo) continue;

    const delta = {};
    let qualcosaDaPropagare = false;
    for (const conto of new Set([...Object.keys(prima), ...Object.keys(dopo)])) {
      const d = round2((parseFloat(dopo[conto]) || 0) - (parseFloat(prima[conto]) || 0));
      if (Math.abs(d) > 0.001) { delta[conto] = d; qualcosaDaPropagare = true; }
    }
    if (!qualcosaDaPropagare) continue;

    for (const succ of mesi) {
      if (succ <= m || toccati.includes(succ)) continue;
      const saldiSucc = { ...(out[succ].saldi || {}) };
      for (const [conto, d] of Object.entries(delta)) {
        if (saldiSucc[conto] === undefined) continue; // conto non usato in quel mese
        saldiSucc[conto] = round2((parseFloat(saldiSucc[conto]) || 0) + d);
      }
      out[succ] = { ...out[succ], saldi: saldiSucc };
    }
  }
  return out;
}
