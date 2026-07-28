"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  MESI_BREVI, MESI_LUNGHI, GIORNI_SETT, THEME_VARS,
  genId, sortByDataDesc, groupByDayDesc, formatDayLabel,
  pad2, ymdStr, fmtShortDate, daysGrid,
  DateRangePicker, VistaToggle, fmt, round2,
  getMonthLabel, getCurrentMonth, lastMonths, localISODate,
  CashFlowMiniChart, CategoryBars, costoCambio,
} from "../lib/finance-ui";

// Revolut è diviso in due saldi (EUR/RON) perché Dario spende in RON da
// quel conto: stessa idea di UniCredit Romania su IAGREXPage, con
// conversione automatica nel totale patrimonio (vedi eurRonRate sotto).
const CONTI = [
  { id: "bdm",           label: "BdM Banca",            currency: "€" },
  { id: "trade_republic",label: "Trade Republic",       currency: "€" },
  { id: "revolut_eur",   label: "Revolut — EUR",        currency: "€" },
  { id: "revolut_ron",   label: "Revolut — RON",        currency: "RON" },
  { id: "postepay",      label: "PostePay Evolution",   currency: "€" },
  { id: "hype",          label: "HYPE / Banca Sella",   currency: "€" },
  { id: "unicredit_ron", label: "UniCredit Romania",    currency: "RON" },
];
const CONTI_BY_ID = Object.fromEntries(CONTI.map(c=>[c.id,c]));
const EUR_RON_FALLBACK = 5; // usato solo se il fetch del cambio live fallisce

const CAT_USCITE_FISSE = ["Affitto","Cibo","Palestra","Trasporti","Abbonamenti","Utenze","Salute","Personale","Extra"];
// Categorie che NON vengono mai pre-taggate su un viaggio: sono spese di
// casa che continuano ad arrivare anche mentre Dario è in trasferta
// (bolletta pagata da Budapest ≠ spesa del viaggio a Budapest). Il tag
// resta comunque selezionabile a mano anche per queste.
const CAT_ESCLUSE_VIAGGIO = ["Affitto","Utenze","Abbonamenti"];

const EMPTY_MONTH = {
  entrate: [],
  uscite: [],
  saldi: { bdm:0, trade_republic:0, revolut_eur:0, revolut_ron:0, postepay:0, hype:0, unicredit_ron:0 },
  investimenti: 0,
  risparmi: 0,
};

// Migrazione morbida: UniCredit Romania è solo RON, non c'è mai stato un
// vero conto EUR separato. Vecchie voci con conto "unicredit" o
// "unicredit_eur" (nomi usati prima di questo fix) vengono lette come
// unicredit_ron, così lo storico non si rompe quando riapriamo mesi salvati.
function migrateConto(id) { return (id === "unicredit" || id === "unicredit_eur") ? "unicredit_ron" : id; }
// FIX: la versione precedente rinominava saldi.unicredit -> saldi.unicredit_ron
// SOLO se il valore vecchio era diverso da zero ("niente da migrare" se 0).
// Bug: se il vecchio saldo era 0, la chiave unicredit_ron non veniva mai creata,
// quindi updateSaldi[conto] restava undefined e le entrate/uscite sul conto
// "unicredit_ron" non venivano MAI accreditate/scalate (saveItem controlla
// `updated.saldi[item.conto] !== undefined` prima di sommare). Ora la
// rinomina è incondizionata: se esiste una vecchia chiave (unicredit e/o
// unicredit_eur), sempre spostata su unicredit_ron, anche se vale 0.
function migrateMonth(md) {
  if (!md) return md;
  const hasOldKeys = md.saldi && ("unicredit" in md.saldi || "unicredit_eur" in md.saldi);
  const strayEur = parseFloat(md.saldi?.unicredit_eur)||0;
  const strayOld = parseFloat(md.saldi?.unicredit)||0;
  return {
    ...md,
    entrate: (md.entrate||[]).map(e => e.conto ? { ...e, conto: migrateConto(e.conto) } : e),
    uscite:  (md.uscite||[]).map(e => e.conto ? { ...e, conto: migrateConto(e.conto) } : e),
    saldi: hasOldKeys
      ? { ...md.saldi, unicredit_ron: (parseFloat(md.saldi.unicredit_ron)||0) + strayEur + strayOld, unicredit_eur: undefined, unicredit: undefined }
      : md.saldi,
  };
}


export default function BrunoPage({ fontSize=14, theme="dark", isMobile: isMobileProp }) {
  // isMobile può arrivare da page.jsx (già calcolato lì con window.innerWidth<640);
  // se non arriva (component usato altrove) lo calcoliamo qui come fallback,
  // così la griglia riepilogo non dipende da un prop che potrebbe mancare.
  const [isMobileLocal, setIsMobileLocal] = useState(false);
  useEffect(()=>{
    if (isMobileProp !== undefined) return;
    const check = ()=>setIsMobileLocal(window.innerWidth<640);
    check();
    window.addEventListener("resize",check);
    return ()=>window.removeEventListener("resize",check);
  },[isMobileProp]);
  const isMobile = isMobileProp !== undefined ? isMobileProp : isMobileLocal;

  const fs = fontSize;
  const themeVars = THEME_VARS[theme] || THEME_VARS.dark;
  const [allData, setAllData]   = useState({});
  const [month, setMonth]       = useState(getCurrentMonth());
  const [tab, setTab]           = useState("entrate");
  const [filtroConto, setFiltroConto] = useState("");
  const [filtroDataDa, setFiltroDataDa] = useState("");
  const [filtroDataA, setFiltroDataA]   = useState("");
  // Vista lista entrate/uscite: "categoria" raggruppa per categoria (comportamento
  // storico delle uscite), "recenti" mostra tutto in un'unica lista ordinata
  // per data decrescente (più recente in cima). Scelta indipendente per tab.
  const [vistaEntrate, setVistaEntrate] = useState("recenti");
  const [vistaUscite, setVistaUscite]   = useState("recenti");
  const [loading, setLoading]   = useState(true);
  const [saveStatus, setSaveStatus] = useState(null);
  const [modal, setModal]       = useState(null); // {tipo:"entrata"|"uscita", mode:"add"|"edit", item?}
  const [form, setForm]         = useState({});
  const [customCat, setCustomCat] = useState("");

  // --- Viaggi: budget separato per le trasferte ---
  // I viaggi vivono in allData.viaggi (chiave non-mese, come checkSaldi);
  // il legame spesa->viaggio è il campo `viaggio` (id) sulla singola uscita,
  // così il movimento resta contato normalmente nel mese ma è anche
  // filtrabile/sommabile per viaggio, anche a cavallo di due mesi.
  const [filtroViaggio, setFiltroViaggio] = useState("");
  const [viaggioModal, setViaggioModal] = useState(null); // {mode:"add"|"edit"}
  const [viaggioForm, setViaggioForm]   = useState({});
  const [viaggioSel, setViaggioSel]     = useState(null); // id del viaggio aperto in dettaglio
  // Input per aggiungere voci PRO/CONTRO nel dettaglio viaggio (liste
  // separate per sapere se tornare in quella location).
  const [proInput, setProInput]         = useState("");
  const [controInput, setControInput]   = useState("");

  // Check estratto conto: confronto manuale a fine mese tra il saldo
  // salvato in app e quello reale letto sull'estratto conto, con storico
  // delle discrepanze trovate (vedi sezione "Saldi" più sotto).
  const [checkModal, setCheckModal] = useState(null); // {mode:"add", item?}
  const [checkForm, setCheckForm]   = useState({});
  // Budget mensile per categoria di uscita: soglie in EUR, uguali per tutti
  // i mesi (vivono a livello allData, non nel singolo mese).
  const [budgetModal, setBudgetModal] = useState(false);
  const [budgetForm, setBudgetForm]   = useState({});
  // Stessa protezione introdotta su IAGREXPage: finché non confermiamo di
  // aver letto lo storico vero da ClickUp, blocchiamo il salvataggio per
  // non rischiare di sovrascrivere tutti i mesi con dati vuoti.
  const [loadOk, setLoadOk]       = useState(false);
  const [loadError, setLoadError] = useState(null);
  // Cambio EUR->RON live (stesso meccanismo di IAGREXPage): Frankfurter
  // API, gratuita e senza chiave. Se fallisce usiamo il fisso di riserva,
  // segnalandolo chiaramente invece di spacciarlo per live.
  const [eurRonRate, setEurRonRate] = useState(null);
  const [rateIsLive, setRateIsLive] = useState(false);

  useEffect(()=>{ loadData(); loadRate(); }, []);

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
      const res = await fetch("/api/bruno-finance");
      const json = await res.json();
      if (res.ok) {
        const raw = json.data || {};
        // migrateMonth si aspetta un oggetto mese (entrate/uscite/saldi):
        // applicarlo a chiavi non-mese (es. "checkSaldi", array di check
        // estratto conto) lo spappolerebbe in un oggetto con indici numerici.
        // Migriamo solo le chiavi in formato YYYY-MM.
        const migrated = Object.fromEntries(Object.entries(raw).map(([ym,md])=>[ym, /^\d{4}-\d{2}$/.test(ym) ? migrateMonth(md) : md]));
        setAllData(migrated);
        setLoadOk(true);
      }
      else { setLoadError(json.error || `Errore ${res.status}`); setLoadOk(false); }
    } catch (e) { setLoadError(e.message); setLoadOk(false); }
    setLoading(false);
  };

  // Riporto automatico di saldi/investimenti/risparmi: se il mese
  // selezionato non ha ancora dati propri, si parte dai valori di
  // chiusura del mese precedente più recente con dati invece che da
  // zero. Senza questo, registrare entrate/uscite in un mese nuovo prima
  // di riscrivere a mano il saldo reale porta i saldi a sfasarsi dal
  // conto vero (bug riscontrato e corretto su IAGREX a luglio 2026) — i
  // valori restano comunque sempre modificabili a mano dalla tab Saldi.
  const getCarriedFinancials = (allData, month) => {
    let [y, m] = month.split("-").map(Number);
    for (let i = 0; i < 24; i++) {
      m -= 1;
      if (m === 0) { m = 12; y -= 1; }
      const ym = `${y}-${String(m).padStart(2, "0")}`;
      const md = allData[ym];
      if (md?.saldi) return { saldi: md.saldi, investimenti: md.investimenti ?? EMPTY_MONTH.investimenti, risparmi: md.risparmi ?? EMPTY_MONTH.risparmi };
    }
    return { saldi: EMPTY_MONTH.saldi, investimenti: EMPTY_MONTH.investimenti, risparmi: EMPTY_MONTH.risparmi };
  };

  const monthData = allData[month] || { ...EMPTY_MONTH, ...getCarriedFinancials(allData, month) };

  const saveData = useCallback(async (newAllData) => {
    if (!loadOk) {
      setSaveStatus("blocked");
      setTimeout(()=>setSaveStatus(null), 3500);
      return;
    }
    setAllData(newAllData);
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/bruno-finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: newAllData }),
      });
      setSaveStatus(res.ok ? "saved" : "error");
    } catch { setSaveStatus("error"); }
    setTimeout(()=>setSaveStatus(null), 2500);
  }, [loadOk]);

  const updateMonth = (updated) => {
    saveData({ ...allData, [month]: updated });
  };

  const prevMonth = () => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m-2);
    setMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
  };
  const nextMonth = () => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m);
    setMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
  };

  // SUMMARY
  // I saldi/uscite in RON (Revolut) vengono convertiti in EUR al cambio
  // live prima di essere sommati ai totali aggregati: senza questo, i
  // totali confonderebbero RON e EUR come se fossero la stessa valuta.
  // L'importo della singola uscita resta invece nella sua valuta nativa
  // (quella del conto con cui è stata pagata) — vedi contoCurrency/toEur.
  const rate = eurRonRate || EUR_RON_FALLBACK;
  const contoCurrency = (contoId) => CONTI_BY_ID[contoId]?.currency || "€";
  const toEur = (item) => {
    const val = parseFloat(item.importo)||0;
    return contoCurrency(item.conto)==="RON" ? val/rate : val;
  };
  // Come toEur ma per un valore parziale del movimento (es. la quota
  // commissioni): stessa valuta del conto con cui è stato pagato.
  const toEurVal = (val, contoId) => {
    const v = parseFloat(val)||0;
    return contoCurrency(contoId)==="RON" ? v/rate : v;
  };
  // I movimenti generati dal tasto "Conversione" (spostamento di soldi già
  // esistenti tra Revolut EUR e Revolut RON) non sono entrata/uscita vera:
  // vanno esclusi da entrate/uscite/recap, altrimenti una conversione
  // gonfierebbe artificialmente le uscite o le entrate del mese pur non
  // essendo un vero costo/incasso (stessa logica già usata su IAGREX).
  const isReal = (e) => !e.isConversione;

  const totEntrate  = monthData.entrate.filter(isReal).reduce((s,e)=>s+toEur(e),0);
  const totUscite   = monthData.uscite.filter(isReal).reduce((s,e)=>s+toEur(e),0);
  const saldoNetto  = totEntrate - totUscite;

  // Proiezione fine mese sulle uscite (stessa idea dell'alert "ritmo 1M€" di
  // IAGREX, ma sulle spese): run-rate = uscite finora / giorni passati ×
  // giorni del mese. Solo sul mese corrente (sui mesi chiusi non ha senso) e
  // dal giorno 3 in poi, perché con 1-2 giorni di dati l'estrapolazione
  // spara numeri a caso (es. un affitto pagato il giorno 1 proietterebbe
  // 30 affitti).
  const isCurrentMonthView = month === getCurrentMonth();
  const giornoOggi = new Date().getDate();
  const giorniNelMese = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
  const proiezioneUscite = (isCurrentMonthView && giornoOggi >= 3 && totUscite > 0)
    ? (totUscite / giornoOggi) * giorniNelMese : null;

  // Confronto anno su anno: stesso mese dell'anno precedente, per capire se
  // il trend personale sta davvero migliorando o è solo l'effetto stagionale
  // del mese. Mostrato solo se esiste storico per quel mese.
  const [annoSel, meseSel] = month.split("-").map(Number);
  const mesePrecAnno = `${annoSel-1}-${String(meseSel).padStart(2,"0")}`;
  const datiAnnoScorso = allData[mesePrecAnno];
  const usciteAnnoScorso = datiAnnoScorso ? (datiAnnoScorso.uscite||[]).filter(isReal).reduce((s,e)=>s+toEur(e),0) : null;
  const yoyUsciteDeltaPct = (usciteAnnoScorso!=null && usciteAnnoScorso>0) ? Math.round(((totUscite-usciteAnnoScorso)/usciteAnnoScorso)*100) : null;
  // Recap "dove vanno i soldi": uscite/entrate convertite in EUR (toEur
  // gestisce già i conti in RON) prima di raggrupparle per categoria.
  const usciteByCat  = monthData.uscite.filter(isReal).reduce((acc,e)=>{ acc[e.categoria]=(acc[e.categoria]||0)+toEur(e); return acc; },{});
  const entrateByCat = monthData.entrate.filter(isReal).reduce((acc,e)=>{ acc[e.categoria]=(acc[e.categoria]||0)+toEur(e); return acc; },{});
  const totPatrimonio = Object.entries(monthData.saldi||{}).reduce((s,[id,v])=>{
    const val = parseFloat(v)||0;
    const isRon = CONTI_BY_ID[id]?.currency === "RON";
    return s + (isRon ? val/rate : val);
  },0)
    + (parseFloat(monthData.investimenti)||0)
    + (parseFloat(monthData.risparmi)||0);

  // --- Budget per categoria -------------------------------------------
  // Le soglie stanno in allData.budgetCategorie (chiave non-mese: le API che
  // iterano i mesi filtrano già con /^\d{4}-\d{2}$/, quindi non disturba).
  // La spesa confrontata è usciteByCat del mese visualizzato: già in EUR e
  // già senza conversioni.
  const budgetCategorie = allData.budgetCategorie || {};
  const budgetEntries = Object.entries(budgetCategorie).filter(([,v])=>parseFloat(v)>0);
  const budgetSforati = budgetEntries.filter(([cat,bud])=>(usciteByCat[cat]||0) > parseFloat(bud));
  const openBudgetModal = () => { setBudgetForm({...budgetCategorie}); setBudgetModal(true); };
  const saveBudget = () => {
    const cleaned = {};
    Object.entries(budgetForm).forEach(([k,v])=>{ const n=parseFloat(v); if (n>0) cleaned[k]=round2(n); });
    saveData({ ...allData, budgetCategorie: cleaned });
    setBudgetModal(false);
  };
  // Categorie proponibili nella modale: le fisse + quelle realmente usate
  // nel mese + quelle che hanno già un budget (una categoria custom con
  // budget non deve sparire dalla modale solo perché stavolta non ha spese).
  const budgetCatList = [...new Set([...CAT_USCITE_FISSE, ...Object.keys(usciteByCat), ...Object.keys(budgetCategorie)])]
    .filter(c=>c!=="Conversione");

  // --- Viaggi: helper e CRUD ---
  const viaggi = allData.viaggi || [];
  const viaggiOrdinati = [...viaggi].sort((a,b)=>(b.dataInizio||"").localeCompare(a.dataInizio||""));
  const viaggioById = Object.fromEntries(viaggi.map(v=>[v.id,v]));
  // Viaggio che copre una certa data (dataFine vuota = viaggio ancora
  // aperto, si chiude al ritorno modificandolo).
  const viaggioPerData = (dstr) => {
    if (!dstr) return null;
    return viaggi.find(v => v.dataInizio && dstr >= v.dataInizio && (!v.dataFine || dstr <= v.dataFine)) || null;
  };
  // Pre-selezione automatica nel form uscite: data dentro un viaggio =>
  // tag già messo, MA mai per le categorie di casa (CAT_ESCLUSE_VIAGGIO).
  const autoViaggioFor = (dstr, categoria) =>
    CAT_ESCLUSE_VIAGGIO.includes(categoria) ? "" : (viaggioPerData(dstr)?.id || "");
  // Tutte le uscite taggate su un viaggio, pescate da TUTTI i mesi:
  // così un viaggio 30 lug - 2 ago ha un totale unico, non spezzato.
  const movimentiViaggio = (vid) => {
    const out = [];
    for (const [ym, md] of Object.entries(allData)) {
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      for (const e of (md.uscite||[])) if (e.viaggio===vid && isReal(e)) out.push(e);
    }
    return out;
  };
  const statsViaggio = (v) => {
    const movs = movimentiViaggio(v.id);
    const tot = movs.reduce((s,e)=>s+toEur(e),0);
    const giorni = (v.dataInizio && v.dataFine)
      ? Math.round((new Date(v.dataFine+"T00:00:00") - new Date(v.dataInizio+"T00:00:00"))/86400000) + 1
      : null;
    return { movs, tot, giorni, media: giorni ? tot/giorni : null };
  };
  // Per il Recap mensile: "di cui X€ viaggio Y" — solo la quota di uscite
  // del mese selezionato, raggruppata per viaggio.
  const speseViaggiMese = monthData.uscite.filter(e=>isReal(e)&&e.viaggio).reduce((acc,e)=>{ acc[e.viaggio]=(acc[e.viaggio]||0)+toEur(e); return acc; },{});
  // Totale commissioni bancarie del mese (quota già inclusa nelle uscite,
  // vedi campo "commissioni" in saveItem): non si somma alle uscite, dice
  // solo quanto del totale se n'è andato in cambi valuta e fee.
  // NIENTE filtro isReal qui: le conversioni Revolut sono escluse dalle
  // uscite vere, ma la loro commissione implicita (tasso banca vs BCE) è
  // un costo reale e va contata.
  const totCommissioniMese = monthData.uscite.reduce((s,e)=>s+toEurVal(e.commissioni,e.conto),0);

  const openViaggioAdd  = () => { setViaggioForm({ nome:"", dataInizio:localISODate(), dataFine:"" }); setViaggioModal({ mode:"add" }); };
  const openViaggioEdit = (v) => { setViaggioForm({ ...v }); setViaggioModal({ mode:"edit" }); };
  const closeViaggioModal = () => { setViaggioModal(null); setViaggioForm({}); };
  const saveViaggio = () => {
    if (!viaggioForm.nome?.trim() || !viaggioForm.dataInizio) return;
    if (viaggioForm.dataFine && viaggioForm.dataFine < viaggioForm.dataInizio) return;
    const v = {
      id: viaggioModal.mode==="add" ? genId() : viaggioForm.id,
      nome: viaggioForm.nome.trim(),
      dataInizio: viaggioForm.dataInizio,
      dataFine: viaggioForm.dataFine || "",
      creato: viaggioForm.creato || new Date().toISOString(),
      // Note legacy e liste PRO/CONTRO vanno preservate quando si modifica
      // nome/date dal modal (openViaggioEdit copia tutto il viaggio nel form).
      note: viaggioForm.note || "",
      pro: viaggioForm.pro || [],
      contro: viaggioForm.contro || [],
    };
    saveData({ ...allData, viaggi: viaggioModal.mode==="add" ? [v, ...viaggi] : viaggi.map(x=>x.id===v.id?v:x) });
    closeViaggioModal();
  };
  // PRO & CONTRO: array di stringhe sul viaggio (campi "pro" e "contro").
  // Una voce per riga, aggiunta/rimossa singolarmente — più actionable di
  // un textarea libero quando si decide se tornare in quella location.
  const addVoceViaggio = (vid, campo, testo) => {
    const t = (testo||"").trim();
    if (!t) return;
    saveData({ ...allData, viaggi: viaggi.map(v=>v.id===vid ? { ...v, [campo]: [...(v[campo]||[]), t] } : v) });
  };
  const removeVoceViaggio = (vid, campo, idx) => {
    saveData({ ...allData, viaggi: viaggi.map(v=>v.id===vid ? { ...v, [campo]: (v[campo]||[]).filter((_,i)=>i!==idx) } : v) });
  };
  // Eventuali vecchie note libere (feature sostituita dai PRO/CONTRO):
  // mostrate finché l'utente non le elimina, per non perdere testo scritto.
  const clearNoteViaggio = (vid) => {
    saveData({ ...allData, viaggi: viaggi.map(v=>v.id===vid ? { ...v, note: "" } : v) });
  };
  const deleteViaggio = (vid) => {
    if (!confirm("Eliminare il viaggio? Le spese restano nei movimenti, perdono solo il tag viaggio.")) return;
    // Oltre a togliere il viaggio, va staccato il tag dalle uscite di ogni
    // mese, altrimenti resterebbero riferimenti orfani a un id inesistente.
    const next = { ...allData, viaggi: viaggi.filter(v=>v.id!==vid) };
    for (const [ym, md] of Object.entries(allData)) {
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      if ((md.uscite||[]).some(e=>e.viaggio===vid)) {
        next[ym] = { ...md, uscite: md.uscite.map(e=>e.viaggio===vid ? { ...e, viaggio: undefined } : e) };
      }
    }
    saveData(next);
    if (viaggioSel===vid) setViaggioSel(null);
    if (filtroViaggio===vid) setFiltroViaggio("");
  };

  // MODAL HANDLERS
  const openAdd = (tipo) => {
    const oggi = localISODate();
    // Il viaggio viene pre-selezionato se oggi cade nelle date di un
    // viaggio: mentre sei via non devi fare niente, ogni spesa è taggata
    // da sola. _viaggioManual traccia se l'utente ha toccato il chip a
    // mano: da quel momento data/categoria non sovrascrivono più la scelta.
    setForm({ descrizione:"", importo:"", categoria: tipo==="uscita"?CAT_USCITE_FISSE[0]:"Stipendio", conto: CONTI[0].id, data: oggi,
      viaggio: tipo==="uscita" ? (viaggioPerData(oggi)?.id || "") : "", _viaggioManual: false });
    setCustomCat("");
    setModal({ tipo, mode:"add" });
  };
  const openEdit = (tipo, item) => {
    // In edit il tag esistente è una scelta già fatta: mai sovrascriverlo
    // in automatico cambiando data o categoria.
    setForm({ ...item, _viaggioManual: true });
    setCustomCat(CAT_USCITE_FISSE.includes(item.categoria) ? "" : item.categoria);
    setModal({ tipo, mode:"edit", item });
  };
  const closeModal = () => { setModal(null); setForm({}); };

  const saveItem = () => {
    if (!form.descrizione?.trim() || !form.importo) return;
    if (parseFloat(form.commissioni) > parseFloat(form.importo)) return;
    const cat = customCat.trim() || form.categoria;
    const item = { ...form, categoria: cat, importo: parseFloat(form.importo), id: modal.mode==="add"?genId():form.id };
    // _viaggioManual è solo stato del form, non va salvato; viaggio vuoto
    // si salva come undefined (JSON lo scarta) invece di stringa vuota.
    delete item._viaggioManual;
    if (!item.viaggio) delete item.viaggio;
    // "Di cui commissioni": quota informativa GIÀ inclusa nell'importo
    // (es. pagamento in HUF con carta €: importo = totale addebitato,
    // commissioni = la parte presa dalla banca per il cambio). Non tocca
    // saldi né totali, serve solo a tracciare quanto costano i cambi.
    const comm = parseFloat(form.commissioni);
    if (comm > 0) item.commissioni = round2(comm); else delete item.commissioni;
    const tipo = modal.tipo;
    let updated = { ...monthData, saldi: {...monthData.saldi} };
    if (tipo==="uscita") {
      // Ripristina vecchio importo sul vecchio conto (se edit)
      if (modal.mode==="edit" && modal.item?.conto) {
        updated.saldi[modal.item.conto] = round2((parseFloat(updated.saldi[modal.item.conto])||0) + (parseFloat(modal.item.importo)||0));
      }
      // Scala nuovo importo dal nuovo conto
      if (item.conto && updated.saldi[item.conto] !== undefined) {
        updated.saldi[item.conto] = round2((parseFloat(updated.saldi[item.conto])||0) - parseFloat(item.importo));
      }
      updated.uscite = modal.mode==="add" ? [...updated.uscite, item] : updated.uscite.map(e=>e.id===item.id?item:e);
    } else {
      // Stessa logica delle uscite ma al contrario: l'entrata accredita
      // il conto scelto (in edit prima si toglie il vecchio importo dal
      // vecchio conto, poi si aggiunge il nuovo al nuovo conto).
      if (modal.mode==="edit" && modal.item?.conto) {
        updated.saldi[modal.item.conto] = round2((parseFloat(updated.saldi[modal.item.conto])||0) - (parseFloat(modal.item.importo)||0));
      }
      if (item.conto && updated.saldi[item.conto] !== undefined) {
        updated.saldi[item.conto] = round2((parseFloat(updated.saldi[item.conto])||0) + parseFloat(item.importo));
      }
      updated.entrate = modal.mode==="add" ? [...updated.entrate, item] : updated.entrate.map(e=>e.id===item.id?item:e);
    }
    updateMonth(updated);
    closeModal();
  };

  const deleteItem = (tipo, id) => {
    if (!confirm("Eliminare?")) return;
    let updated = { ...monthData, saldi: {...monthData.saldi} };
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

  const updateSaldo = (contoId, val) => {
    updateMonth({ ...monthData, saldi: { ...monthData.saldi, [contoId]: parseFloat(val)||0 } });
  };

  // --- Check estratto conto: log storico dei confronti saldo app vs saldo reale ---
  const checkSaldi = allData.checkSaldi || [];
  function prevMonthYm() {
    const d = new Date();
    d.setMonth(d.getMonth()-1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  }
  const openCheckAdd = () => {
    setCheckForm({ mese: prevMonthYm(), conto: CONTI[0].id, saldoEstratto: "" });
    setCheckModal({ mode:"add" });
  };
  const closeCheckModal = () => { setCheckModal(null); setCheckForm({}); };
  const saveCheck = () => {
    const { mese, conto, saldoEstratto } = checkForm;
    if (!mese || !conto || saldoEstratto==="" || saldoEstratto===undefined) return;
    const saldoApp = parseFloat((allData[mese]||{}).saldi?.[conto]) || 0;
    const saldoReale = parseFloat(saldoEstratto) || 0;
    const differenza = round2(saldoReale - saldoApp);
    const entry = { id: genId(), mese, conto, saldoApp: round2(saldoApp), saldoEstratto: round2(saldoReale), differenza, creato: new Date().toISOString() };
    saveData({ ...allData, checkSaldi: [entry, ...checkSaldi] });
    closeCheckModal();
  };
  const deleteCheck = (id) => {
    saveData({ ...allData, checkSaldi: checkSaldi.filter(c=>c.id!==id) });
  };

  // --- Confronto movimento per movimento: carica il PDF dell'estratto,
  // lo confronta con le entrate/uscite già registrate per quel mese/conto.
  // Non modifica nulla in automatico: evidenzia solo in arancione (via
  // flaggedIds) le voci in app senza riscontro sull'estratto, così Dario
  // le corregge lui a mano — vedi Row più sotto.
  const [reconcileModal, setReconcileModal] = useState(null);
  const [reconcileForm, setReconcileForm] = useState({});
  const [reconcileResult, setReconcileResult] = useState(null);
  const [reconcileLoading, setReconcileLoading] = useState(false);

  // Le evidenziazioni sono salvate su ClickUp insieme al resto (chiave
  // "flaggedMovimenti"), non solo in memoria: prima un reload o il passaggio
  // da telefono a computer le cancellava, quindi il lavoro di riconciliazione
  // andava perso a metà.
  const flaggedIds = new Set(allData.flaggedMovimenti || []);
  const setFlaggedPersistente = (ids) => {
    saveData({ ...allData, flaggedMovimenti: [...ids] });
  };

  const openReconcile = () => {
    setReconcileForm({ mese: prevMonthYm(), conto: CONTI[0].id, file: null });
    setReconcileResult(null);
    setReconcileModal(true);
  };
  const closeReconcile = () => { setReconcileModal(null); setReconcileForm({}); setReconcileResult(null); };

  const runReconcile = async () => {
    const { mese, conto, file } = reconcileForm;
    if (!mese || !conto || !file) return;
    setReconcileLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-statement", { method:"POST", body: fd });
      const json = await res.json();
      if (!res.ok) { setReconcileResult({ error: json.error || `Errore ${res.status}` }); setReconcileLoading(false); return; }

      const md = allData[mese] || EMPTY_MONTH;
      const appMovs = [
        ...(md.entrate||[]).filter(e=>e.conto===conto).map(e=>({ ...e, tipo:"entrata" })),
        ...(md.uscite ||[]).filter(e=>e.conto===conto).map(e=>({ ...e, tipo:"uscita"  })),
      ];
      const usedIds = new Set();
      const mancantiInApp = [];
      for (const mov of (json.movimenti||[])) {
        const target = Math.abs(round2(mov.importo));
        // Match per importo assoluto (il segno sull'estratto non è
        // affidabile in modo uniforme tra banche) + data entro 3 giorni,
        // scegliendo il più vicino in data tra i candidati non ancora usati.
        const candidati = appMovs.filter(a => !usedIds.has(a.id) && Math.abs(round2(Math.abs(a.importo)) - target) < 0.01);
        let best = null, bestDist = Infinity;
        for (const c of candidati) {
          const dist = (c.data && mov.data) ? Math.abs(new Date(c.data) - new Date(mov.data)) : 999*86400000;
          if (dist < bestDist && dist <= 4*86400000) { best = c; bestDist = dist; }
        }
        if (!best && candidati.length) best = candidati[0]; // nessuna data affidabile: prendi il primo per importo
        if (best) usedIds.add(best.id);
        else mancantiInApp.push(mov);
      }
      const mancantiInEstratto = appMovs.filter(a => !usedIds.has(a.id));
      setFlaggedPersistente(new Set(mancantiInEstratto.map(a=>a.id)));
      setReconcileResult({
        totaleEstratto: (json.movimenti||[]).length,
        abbinati: usedIds.size,
        mancantiInApp,
        mancantiInEstratto,
        righeRiconosciute: json.righeRiconosciute,
        righeTotali: json.righeTotali,
      });
    } catch (e) {
      setReconcileResult({ error: e.message });
    }
    setReconcileLoading(false);
  };

  const updateField = (field, val) => {
    updateMonth({ ...monthData, [field]: parseFloat(val)||0 });
  };

  // --- Conversione tra conti — limitata a Revolut EUR <-> Revolut RON ---
  // Gli altri conti (BdM, Trade Republic, PostePay, HYPE, UniCredit RON)
  // non hanno una controparte nella stessa banca in un'altra valuta, quindi
  // non ha senso offrirli come coppia di conversione: qui l'unico caso
  // reale è il cambio valuta fatto dentro l'app Revolut stessa.
  const CONTI_CONV = CONTI.filter(c=>c.id==="revolut_eur"||c.id==="revolut_ron");
  const otherConto = (contoId) => CONTI_CONV.find(c=>c.id!==contoId)?.id || contoId;
  const [convModal, setConvModal] = useState(false);
  const [convForm, setConvForm]   = useState({});
  const openConversione = () => {
    setConvForm({
      da: "revolut_eur",
      a: "revolut_ron",
      importoDa: "",
      tasso: (eurRonRate||EUR_RON_FALLBACK).toFixed(4),
      // Tasso ufficiale BCE del giorno (fetch live già attivo): il confronto
      // banca-vs-BCE è la commissione implicita del cambio, salvata sul
      // movimento e sommata nel recap "commissioni bancarie".
      tassoBce: (eurRonRate||EUR_RON_FALLBACK).toFixed(4),
      data: localISODate(),
    });
    setConvModal(true);
  };
  const closeConv = () => { setConvModal(false); setConvForm({}); };

  // Il tasso rappresenta sempre "1 EUR = tasso RON", coerente con
  // eurRonRate/toEur usati nel resto della pagina.
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
    const tassoBce = parseFloat(convForm.tassoBce);
    const descrizione = `Conversione ${CONTI_BY_ID[convForm.da]?.label} → ${CONTI_BY_ID[convForm.a]?.label} (tasso banca ${tasso}${tassoBce?` · BCE ${tassoBce}`:""})`;
    const uscitaItem  = { id:genId(), descrizione, categoria:"Conversione", conto:convForm.da, importo:round2(importoDa), data:convForm.data, isConversione:true, pairId };
    // Commissione implicita del cambio (tasso banca peggiore del BCE):
    // salvata sull'uscita della coppia, nella valuta del conto di partenza,
    // così entra nel totale mensile "commissioni bancarie" del Recap.
    const cc = costoCambio(importoDa, tasso, tassoBce, contoCurrency(convForm.da));
    if (cc && cc.costo > 0) { uscitaItem.commissioni = round2(cc.costo); uscitaItem.tassoBce = tassoBce; }
    const entrataItem = { id:genId(), descrizione, categoria:"Conversione", conto:convForm.a,  importo:round2(importoA),  data:convForm.data, isConversione:true, pairId };

    let updated = { ...monthData, saldi: {...monthData.saldi} };
    updated.saldi[convForm.da] = round2((parseFloat(updated.saldi[convForm.da])||0) - importoDa);
    updated.saldi[convForm.a]  = round2((parseFloat(updated.saldi[convForm.a])||0) + importoA);
    updated.uscite  = [...updated.uscite, uscitaItem];
    updated.entrate = [...updated.entrate, entrataItem];
    updateMonth(updated);
    closeConv();
  };

  const f = (key) => (val) => setForm(p=>({...p,[key]:val}));

  // Filtro data (entrate/uscite): confronto su stringhe "YYYY-MM-DD" che
  // funziona correttamente anche senza convertire in Date, e ignora le
  // voci senza data quando il filtro è attivo (altrimenti resterebbero
  // sempre visibili anche fuori range).
  const inDateRange = (item) => {
    if (!filtroDataDa && !filtroDataA) return true;
    if (!item.data) return false;
    if (filtroDataDa && item.data < filtroDataDa) return false;
    if (filtroDataA && item.data > filtroDataA) return false;
    return true;
  };

  // Esporta in CSV esattamente le righe filtrate (stesso periodo/conto
  // visibili a schermo), non l'intero mese: così l'export corrisponde
  // sempre a quello che l'utente sta guardando. Generato lato client con
  // un Blob, senza passare dal server.
  const exportCSV = (items, tipo) => {
    const header = ["Data","Descrizione","Categoria","Conto","Importo","Valuta","Viaggio","Di cui commissioni"];
    const rows = items.map(e => [
      e.data || "",
      (e.descrizione||"").replace(/"/g,'""'),
      (e.categoria||"").replace(/"/g,'""'),
      CONTI_BY_ID[e.conto]?.label || e.conto || "",
      e.importo,
      contoCurrency(e.conto)==="RON"?"RON":"EUR",
      (viaggioById[e.viaggio]?.nome || "").replace(/"/g,'""'),
      e.commissioni || "",
    ]);
    const csv = [header, ...rows].map(r => r.map(v => `"${v}"`).join(";")).join("\n");
    const blob = new Blob(["﻿"+csv], { type:"text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const periodo = (filtroDataDa||filtroDataA) ? `${filtroDataDa||"inizio"}_${filtroDataA||"fine"}` : month;
    a.href = url;
    a.download = `${tipo}_${periodo}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const Cell = ({ style={}, children }) => (
    <div style={{ padding:"10px 12px", fontSize:fs-2, color:"var(--c-text-muted)", display:"flex", alignItems:"center", ...style }}>{children}</div>
  );

  return (
    <div style={{ ...themeVars, display:"flex", flexDirection:"column", height:"100%", overflow: "auto", background:"var(--c-bg)" }}>

      {/* Header */}
      <div style={{ padding:"14px 20px", borderBottom:"1px solid var(--c-border)", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ fontWeight:700, fontSize:15, color:"var(--c-text-strong)" }}>💰 Finanze Personali</div>
            {saveStatus==="saving"  && <span style={{ fontSize:11, color:"#F59E0B" }}>☁️ Salvataggio...</span>}
            {saveStatus==="saved"   && <span style={{ fontSize:11, color:"#10B981" }}>✅ Salvato</span>}
            {saveStatus==="error"   && <span style={{ fontSize:11, color:"#EF4444" }}>❌ Errore</span>}
            {saveStatus==="blocked" && <span style={{ fontSize:11, color:"#EF4444" }}>🚫 Salvataggio bloccato: dati non caricati</span>}
          </div>
          {/* Month selector */}
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <button onClick={prevMonth} style={{ width:28, height:28, borderRadius:6, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:14 }}>‹</button>
            <span style={{ fontSize:fs-1, fontWeight:700, color:"var(--c-text-strong)", minWidth:140, textAlign:"center" }}>{getMonthLabel(month)}</span>
            <button onClick={nextMonth} style={{ width:28, height:28, borderRadius:6, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:14 }}>›</button>
            <button onClick={loadData} style={{ padding:"4px 8px", borderRadius:6, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-faint)", cursor:"pointer", fontSize:11 }}>{loading?"⏳":"↻"}</button>
          </div>
        </div>
        {loadError && (
          <div style={{marginTop:8,padding:"8px 10px",borderRadius:7,border:"1px solid #EF444440",background:"#EF44440D",color:"#EF4444",fontSize:12}}>
            ⚠️ Impossibile caricare i dati da ClickUp ({loadError}). Le modifiche sono bloccate finché non si ricarica correttamente, per non rischiare di cancellare lo storico. Prova "↻".
          </div>
        )}

        {/* Summary cards */}
        {/* Su mobile 4 colonne fisse mandavano l'ultima card ("Patrimonio")
            in overflow orizzontale, tagliata a metà dal contenitore con
            overflow:hidden. Su schermi stretti passiamo a 2x2 e permettiamo
            al numero di andare a capo invece di forzare la card più larga
            della sua colonna. */}
        <div style={{ display:"grid", gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(4,1fr)", gap:8, marginTop:12 }}>
          {[
            { label:"Entrate", val:totEntrate, color:"#10B981", prefix:"+" },
            { label:"Uscite",  val:totUscite,  color:"#EF4444", prefix:"-" },
            { label:"Saldo netto", val:saldoNetto, color:saldoNetto>=0?"#10B981":"#EF4444", prefix:saldoNetto>=0?"+":"" },
            { label:"Patrimonio", val:totPatrimonio, color:"#8B5CF6", prefix:"" },
          ].map(c=>(
            <div key={c.label} style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, padding:"10px 12px", minWidth:0, overflow:"hidden" }}>
              <div style={{ fontSize:fs-4, color:"var(--c-text-faint)", marginBottom:4, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.label}</div>
              <div style={{ fontSize:isMobile?fs:fs+2, fontWeight:800, color:c.color, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.prefix}{fmt(c.val)}€</div>
            </div>
          ))}
        </div>

        <CashFlowMiniChart allData={allData} toEur={toEur}/>

        {proiezioneUscite!=null && (
          <div style={{marginTop:8,fontSize:fs-4,color:"var(--c-text-faint)"}}>
            🔮 A questo ritmo ({fmt(totUscite/giornoOggi)}€/giorno) chiuderai il mese a ~<b style={{color:proiezioneUscite>totEntrate&&totEntrate>0?"#EF4444":"var(--c-text)"}}>{fmt(proiezioneUscite)}€</b> di uscite
            {proiezioneUscite>totEntrate&&totEntrate>0 && <span style={{color:"#EF4444",fontWeight:700}}> — sopra le entrate del mese ({fmt(totEntrate)}€)</span>}
          </div>
        )}
        {usciteAnnoScorso!=null && (
          <div style={{marginTop:8,fontSize:fs-4,color:"var(--c-text-faint)"}}>
            📉 Uscite vs {getMonthLabel(mesePrecAnno)}: {fmt(usciteAnnoScorso)}€
            {yoyUsciteDeltaPct!=null && <span style={{marginLeft:6,fontWeight:700,color:yoyUsciteDeltaPct<=0?"#10B981":"#EF4444"}}>{yoyUsciteDeltaPct>=0?"+":""}{yoyUsciteDeltaPct}%</span>}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:"1px solid var(--c-border)", flexShrink:0, background:"var(--c-bg)" }}>
        <div style={{ display:"flex", flexWrap:"wrap" }}>
          {[["entrate","💚 Entrate"],["uscite","🔴 Uscite"],["saldi","🏦 Saldi & Obiettivi"],["viaggi","✈️ Viaggi"],["recap","📊 Recap"]].map(([t,label])=>(
            <button key={t} onClick={()=>setTab(t)} style={{ padding:"10px 16px", border:"none", background:"transparent", cursor:"pointer", fontSize:fs-2, fontWeight:tab===t?700:400, color:tab===t?"var(--c-text-strong)":"var(--c-text-faint)", borderBottom:tab===t?"2px solid #F59E0B":"2px solid transparent" }}>{label}</button>
          ))}
        </div>
        <button onClick={openConversione} title="Registra un cambio valuta tra Revolut EUR e Revolut RON senza contarlo come entrata/uscita reale"
          style={{ marginRight:12, padding:"6px 12px", borderRadius:7, border:"1px solid #8B5CF650", background:"#8B5CF61A", color:"#8B5CF6", cursor:"pointer", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>
          🔄 Conversione
        </button>
      </div>

      {loading && <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--c-text-faintest)" }}>⏳ Caricamento...</div>}

      {!loading && (
        <div style={{ flex: "unset", overflowY: "visible", padding:16 }}>

          {/* ENTRATE */}
          {tab==="entrate" && (
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10, gap:8, flexWrap:"wrap" }}>
                <div style={{ fontSize:fs-2, color:"var(--c-text-dim)" }}>Totale: <span style={{ color:"#10B981", fontWeight:700 }}>+{fmt(monthData.entrate.filter(e=>isReal(e)&&inDateRange(e)).reduce((s,e)=>s+toEur(e),0))}€</span></div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <VistaToggle vista={vistaEntrate} onChange={setVistaEntrate} accent="#10B981"/>
                  <button onClick={()=>openAdd("entrata")} style={{ padding:"6px 14px", borderRadius:7, border:"none", background:"#10B981", color:"#fff", cursor:"pointer", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>+ Aggiungi</button>
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:isMobile?"column":"row", alignItems:isMobile?"stretch":"center", gap:6, marginBottom:12, padding:"8px 10px", background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:8 }}>
                <DateRangePicker da={filtroDataDa} a={filtroDataA} onChange={(d,a)=>{setFiltroDataDa(d);setFiltroDataA(a);}} accent="#10B981"/>
                <button onClick={()=>exportCSV(monthData.entrate.filter(inDateRange),"entrate")} title="Esporta le entrate filtrate in CSV"
                  style={{ flexShrink:0, padding:"6px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:11, whiteSpace:"nowrap" }}>📥 CSV</button>
              </div>
              {(() => {
                const filtered = monthData.entrate.filter(inDateRange);
                if (filtered.length===0) return (
                  <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, padding:20, textAlign:"center", color:"var(--c-text-faintest)", fontSize:fs-2 }}>
                    {monthData.entrate.length===0?"Nessuna entrata — aggiungi la prima":"Nessuna entrata nel periodo selezionato"}
                  </div>
                );
                const Row = (e,i) => (
                  <div key={e.id} style={{ display:"grid", gridTemplateColumns:"1fr auto auto auto", gap:0, borderTop:i===0?"none":"1px solid var(--c-border)", background:flaggedIds.has(e.id)?"#F59E0B1F":(i%2===0?"var(--c-panel)":"var(--c-panel2)"), boxShadow:flaggedIds.has(e.id)?"inset 3px 0 0 #F59E0B":"none" }}>
                    <Cell style={{ flexDirection:"column", alignItems:"flex-start", gap:2 }}>
                      <span style={{ color:"var(--c-text)", fontWeight:600 }}>{flaggedIds.has(e.id)?"⚠️ ":""}{e.descrizione}</span>
                      <span style={{ fontSize:fs-4, color:"var(--c-text-faint)" }}>{e.data?`${e.data} · `:""}{e.categoria}{e.conto?` · ${CONTI_BY_ID[e.conto]?.label||e.conto}`:""}</span>
                    </Cell>
                    <Cell style={{ color:"#10B981", fontWeight:700 }}>+{fmt(e.importo)}{contoCurrency(e.conto)==="RON"?" RON":"€"}</Cell>
                    <Cell><button onClick={()=>openEdit("entrata",e)} style={{ width:24, height:24, borderRadius:5, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:10 }}>✏️</button></Cell>
                    <Cell><button onClick={()=>deleteItem("entrata",e.id)} style={{ width:24, height:24, borderRadius:5, border:"1px solid #2A1A1A", background:"transparent", color:"#EF4444", cursor:"pointer", fontSize:12, fontWeight:700 }}>×</button></Cell>
                  </div>
                );
                if (vistaEntrate==="recenti") return groupByDayDesc(filtered).map(({key,data,items})=>(
                  <div key={key} style={{ marginBottom:12 }}>
                    <div style={{ fontSize:fs-3, fontWeight:700, color:"var(--c-text-dim)", marginBottom:6, display:"flex", justifyContent:"space-between" }}>
                      <span>{formatDayLabel(data)}</span>
                      <span style={{ color:"#10B981" }}>+{fmt(items.reduce((s,e)=>s+toEur(e),0))}€</span>
                    </div>
                    <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, overflow:"hidden" }}>
                      {items.map(Row)}
                    </div>
                  </div>
                ));
                const grouped = filtered.reduce((acc,e)=>{ (acc[e.categoria]=acc[e.categoria]||[]).push(e); return acc; },{});
                return Object.entries(grouped).map(([cat,items])=>(
                  <div key={cat} style={{ marginBottom:12 }}>
                    <div style={{ fontSize:fs-3, fontWeight:700, color:"var(--c-text-dim)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6, display:"flex", justifyContent:"space-between" }}>
                      <span>{cat}</span>
                      <span style={{ color:"#10B981" }}>+{fmt(items.reduce((s,e)=>s+toEur(e),0))}€</span>
                    </div>
                    <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, overflow:"hidden" }}>
                      {items.map(Row)}
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}

          {/* USCITE */}
          {tab==="uscite" && (
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10, gap:8, flexWrap:"wrap" }}>
                <div style={{ fontSize:fs-2, color:"var(--c-text-dim)" }}>Totale: <span style={{ color:"#EF4444", fontWeight:700 }}>-{fmt(monthData.uscite.filter(e=>isReal(e)&&(!filtroConto||e.conto===filtroConto)&&(!filtroViaggio||e.viaggio===filtroViaggio)&&inDateRange(e)).reduce((s,e)=>s+toEur(e),0))}€</span></div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <VistaToggle vista={vistaUscite} onChange={setVistaUscite} accent="#EF4444"/>
                  <button onClick={()=>openAdd("uscita")} style={{ padding:"6px 14px", borderRadius:7, border:"none", background:"#EF4444", color:"#fff", cursor:"pointer", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>+ Aggiungi</button>
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:isMobile?"column":"row", alignItems:isMobile?"stretch":"center", gap:6, marginBottom:12, padding:"8px 10px", background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:8 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:11, color:"var(--c-text-faint)", whiteSpace:"nowrap" }}>🏦 Conto</span>
                  <select value={filtroConto} onChange={e=>setFiltroConto(e.target.value)} style={{ flex:isMobile?1:"none", minWidth:0, padding:"6px 8px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:12 }}>
                    <option value="">Tutti i conti</option>
                    {CONTI.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                {viaggi.length>0 && (
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ fontSize:11, color:"var(--c-text-faint)", whiteSpace:"nowrap" }}>✈️ Viaggio</span>
                    <select value={filtroViaggio} onChange={e=>setFiltroViaggio(e.target.value)} style={{ flex:isMobile?1:"none", minWidth:0, padding:"6px 8px", borderRadius:7, border:`1px solid ${filtroViaggio?"#F59E0B":"var(--c-border)"}`, background:"var(--c-bg)", color:filtroViaggio?"#F59E0B":"var(--c-text)", fontSize:12 }}>
                      <option value="">Tutti</option>
                      {viaggiOrdinati.map(v=><option key={v.id} value={v.id}>{v.nome}</option>)}
                    </select>
                  </div>
                )}
                <div style={{ display:"flex", alignItems:"center", gap:6, flex:1 }}>
                  <DateRangePicker da={filtroDataDa} a={filtroDataA} onChange={(d,a)=>{setFiltroDataDa(d);setFiltroDataA(a);}} accent="#EF4444"/>
                  <button onClick={()=>exportCSV(monthData.uscite.filter(e=>(!filtroConto||e.conto===filtroConto)&&(!filtroViaggio||e.viaggio===filtroViaggio)&&inDateRange(e)),"uscite")} title="Esporta le uscite filtrate in CSV"
                    style={{ flexShrink:0, padding:"6px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:11, whiteSpace:"nowrap" }}>📥 CSV</button>
                </div>
              </div>
              {(() => {
                const filtered = monthData.uscite.filter(e=>(!filtroConto||e.conto===filtroConto)&&(!filtroViaggio||e.viaggio===filtroViaggio)&&inDateRange(e));
                if (monthData.uscite.length===0) return <div style={{ padding:20, textAlign:"center", color:"var(--c-text-faintest)", fontSize:fs-2, background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10 }}>Nessuna uscita — aggiungi la prima</div>;
                if (filtered.length===0) return <div style={{ padding:20, textAlign:"center", color:"var(--c-text-faintest)", fontSize:fs-2, background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10 }}>Nessuna uscita nel periodo/conto/viaggio selezionato</div>;
                const Row = (e,i) => (
                  <div key={e.id} style={{ display:"grid", gridTemplateColumns:"1fr auto auto auto", gap:0, borderTop:i===0?"none":"1px solid var(--c-border)", background:flaggedIds.has(e.id)?"#F59E0B1F":(i%2===0?"var(--c-panel)":"var(--c-panel2)"), boxShadow:flaggedIds.has(e.id)?"inset 3px 0 0 #F59E0B":"none" }}>
                    <Cell style={{ flexDirection:"column", alignItems:"flex-start", gap:2 }}>
                      <span style={{ color:"var(--c-text)" }}>{flaggedIds.has(e.id)?"⚠️ ":""}{e.descrizione}</span>
                      <span style={{ fontSize:fs-4, color:"var(--c-text-faint)" }}>{e.data?`${e.data}`:""}{e.data?" · ":""}{e.categoria}{e.conto?` · ${CONTI_BY_ID[e.conto]?.label||e.conto}`:""}{e.viaggio&&viaggioById[e.viaggio]?<span style={{color:"#F59E0B"}}> · ✈️ {viaggioById[e.viaggio].nome}</span>:""}{parseFloat(e.commissioni)>0?<span style={{color:"#06B6D4"}}> · di cui {fmt(e.commissioni)}{contoCurrency(e.conto)==="RON"?" RON":"€"} commissioni</span>:""}</span>
                    </Cell>
                    <Cell style={{ color:"#EF4444", fontWeight:700 }}>-{fmt(e.importo)}{contoCurrency(e.conto)==="RON"?" RON":"€"}</Cell>
                    <Cell><button onClick={()=>openEdit("uscita",e)} style={{ width:24, height:24, borderRadius:5, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:10 }}>✏️</button></Cell>
                    <Cell><button onClick={()=>deleteItem("uscita",e.id)} style={{ width:24, height:24, borderRadius:5, border:"1px solid #2A1A1A", background:"transparent", color:"#EF4444", cursor:"pointer", fontSize:12, fontWeight:700 }}>×</button></Cell>
                  </div>
                );
                if (vistaUscite==="recenti") return groupByDayDesc(filtered).map(({key,data,items})=>(
                  <div key={key} style={{ marginBottom:12 }}>
                    <div style={{ fontSize:fs-3, fontWeight:700, color:"var(--c-text-dim)", marginBottom:6, display:"flex", justifyContent:"space-between" }}>
                      <span>{formatDayLabel(data)}</span>
                      <span style={{ color:"#EF4444" }}>-{fmt(items.reduce((s,e)=>s+toEur(e),0))}€</span>
                    </div>
                    <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, overflow:"hidden" }}>
                      {items.map(Row)}
                    </div>
                  </div>
                ));
                const grouped = filtered.reduce((acc,e)=>{ (acc[e.categoria]=acc[e.categoria]||[]).push(e); return acc; },{});
                return Object.entries(grouped).map(([cat,items])=>(
                  <div key={cat} style={{ marginBottom:12 }}>
                    <div style={{ fontSize:fs-3, fontWeight:700, color:"var(--c-text-dim)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6, display:"flex", justifyContent:"space-between" }}>
                      <span>{cat}</span>
                      <span style={{ color:"#EF4444" }}>-{fmt(items.reduce((s,e)=>s+toEur(e),0))}€</span>
                    </div>
                    <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, overflow:"hidden" }}>
                      {items.map(Row)}
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}

          {/* SALDI & OBIETTIVI */}
          {tab==="saldi" && (
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              {/* Saldi conti */}
              <div>
                <div style={{ fontSize:fs-3, fontWeight:700, color:"#8B5CF6", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>🏦 Saldi Conti</div>
                <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, overflow:"hidden" }}>
                  {CONTI.map((c,i)=>(
                    <div key={c.id} style={{ display:"grid", gridTemplateColumns:"1fr auto", borderTop:i===0?"none":"1px solid var(--c-border)", background:i%2===0?"var(--c-panel)":"var(--c-panel2)" }}>
                      <div style={{ padding:"10px 12px", fontSize:fs-2, color:"var(--c-text)", display:"flex", alignItems:"center" }}>{c.label}</div>
                      <div style={{ padding:"6px 12px", display:"flex", alignItems:"center", gap:4 }}>
                        <input
                          type="number"
                          value={monthData.saldi?.[c.id]||""}
                          onChange={e=>updateSaldo(c.id, e.target.value)}
                          placeholder="0"
                          style={{ width:100, padding:"5px 8px", borderRadius:6, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"#8B5CF6", fontSize:fs-2, outline:"none", textAlign:"right", fontWeight:700 }}
                        />
                        <span style={{ fontSize:fs-3, color:"var(--c-text-faint)" }}>{c.currency||"€"}</span>
                      </div>
                    </div>
                  ))}
                  <div style={{ padding:"8px 12px", borderTop:"1px solid var(--c-border)", fontSize:fs-4, color:"var(--c-text-faintest)" }}>
                    Conti in RON convertiti a EUR (÷{rate.toFixed(2)}{rateIsLive?" · cambio live BCE":" · cambio fisso di riserva"})
                  </div>
                  <div style={{ padding:"10px 12px", borderTop:"1px solid var(--c-border)", display:"flex", justifyContent:"space-between", alignItems:"center", background:"var(--c-bg)" }}>
                    <div>
                      <div style={{ fontSize:fs-2, fontWeight:700, color:"#F59E0B" }}>Totale liquidità RON</div>
                      <div style={{ fontSize:fs-4, color:"var(--c-text-faintest)", marginTop:2 }}>Revolut RON + UniCredit Romania</div>
                    </div>
                    <span style={{ fontSize:fs-1, fontWeight:800, color:"#F59E0B" }}>
                      {fmt((parseFloat(monthData.saldi?.revolut_ron)||0) + (parseFloat(monthData.saldi?.unicredit_ron)||0))} RON
                    </span>
                  </div>
                  <div style={{ padding:"10px 12px", borderTop:"1px solid var(--c-border)", display:"flex", justifyContent:"space-between", background:"var(--c-bg)" }}>
                    <span style={{ fontSize:fs-2, fontWeight:700, color:"#8B5CF6" }}>Totale liquidità</span>
                    <span style={{ fontSize:fs-1, fontWeight:800, color:"#8B5CF6" }}>{fmt(totPatrimonio - (parseFloat(monthData.investimenti)||0) - (parseFloat(monthData.risparmi)||0))}€</span>
                  </div>
                </div>
              </div>

              {/* Check estratto conto: confronto a fine mese saldo app vs saldo reale */}
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                  <div style={{ fontSize:fs-3, fontWeight:700, color:"#06B6D4", textTransform:"uppercase", letterSpacing:"0.08em" }}>📄 Check Estratto Conto</div>
                  <div style={{ display:"flex", gap:6 }}>
                    <button onClick={openReconcile} title="Carica il PDF dell'estratto e confronta movimento per movimento con le entrate/uscite registrate"
                      style={{ padding:"5px 12px", borderRadius:7, border:"1px solid #06B6D4", background:"transparent", color:"#06B6D4", cursor:"pointer", fontSize:11, fontWeight:600 }}>🔍 Confronta movimenti</button>
                    <button onClick={openCheckAdd} style={{ padding:"5px 12px", borderRadius:7, border:"none", background:"#06B6D4", color:"#fff", cursor:"pointer", fontSize:11, fontWeight:600 }}>+ Nuovo check</button>
                  </div>
                </div>
                {flaggedIds.size > 0 && (
                  <div style={{ fontSize:fs-4, color:"#F59E0B", marginBottom:8, background:"#F59E0B15", border:"1px solid #F59E0B40", borderRadius:8, padding:"6px 10px" }}>
                    ⚠️ {flaggedIds.size} movimento{flaggedIds.size>1?"i":""} senza riscontro sull'estratto, evidenziat{flaggedIds.size>1?"i":"o"} in arancione in Entrate/Uscite — <button onClick={()=>setFlaggedPersistente(new Set())} style={{ background:"none", border:"none", color:"#F59E0B", textDecoration:"underline", cursor:"pointer", fontSize:fs-4, padding:0 }}>pulisci evidenziazione</button>
                  </div>
                )}
                <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, overflow:"hidden" }}>
                  {checkSaldi.length===0 ? (
                    <div style={{ padding:16, textAlign:"center", color:"var(--c-text-faintest)", fontSize:fs-3 }}>
                      Nessun check registrato. A inizio mese, manda gli estratti conto del mese appena chiuso e confronta i saldi qui.
                    </div>
                  ) : checkSaldi.map((c,i) => {
                    const ok = Math.abs(c.differenza) < 0.01;
                    return (
                      <div key={c.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 12px", borderTop:i===0?"none":"1px solid var(--c-border)", background:i%2===0?"var(--c-panel)":"var(--c-panel2)" }}>
                        <div>
                          <div style={{ fontSize:fs-2, color:"var(--c-text)", fontWeight:600 }}>{CONTI_BY_ID[c.conto]?.label||c.conto} · {getMonthLabel(c.mese)}</div>
                          <div style={{ fontSize:fs-4, color:"var(--c-text-faint)", marginTop:2 }}>
                            App: {fmt(c.saldoApp)} · Estratto: {fmt(c.saldoEstratto)} {CONTI_BY_ID[c.conto]?.currency||"€"}
                          </div>
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <span style={{ fontSize:fs-2, fontWeight:700, color: ok?"#10B981":"#EF4444" }}>
                            {ok ? "✅ combacia" : `⚠️ ${c.differenza>0?"+":""}${fmt(c.differenza)}`}
                          </span>
                          <button onClick={()=>deleteCheck(c.id)} style={{ width:22, height:22, borderRadius:5, border:"1px solid #2A1A1A", background:"transparent", color:"#EF4444", cursor:"pointer", fontSize:12, fontWeight:700 }}>×</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Investimenti & Risparmi */}
              <div>
                <div style={{ fontSize:fs-3, fontWeight:700, color:"#F59E0B", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>🎯 Obiettivi</div>
                <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, overflow:"hidden" }}>
                  {[
                    { key:"investimenti", label:"📈 Investimenti", color:"#3B82F6" },
                    { key:"risparmi",     label:"🐷 Risparmi",     color:"#10B981" },
                  ].map((item,i)=>(
                    <div key={item.key} style={{ display:"grid", gridTemplateColumns:"1fr auto", borderTop:i===0?"none":"1px solid var(--c-border)", background:i%2===0?"var(--c-panel)":"var(--c-panel2)" }}>
                      <div style={{ padding:"10px 12px", fontSize:fs-2, color:"var(--c-text)", display:"flex", alignItems:"center" }}>{item.label}</div>
                      <div style={{ padding:"6px 12px", display:"flex", alignItems:"center", gap:4 }}>
                        <input
                          type="number"
                          value={monthData[item.key]||""}
                          onChange={e=>updateField(item.key, e.target.value)}
                          placeholder="0"
                          style={{ width:100, padding:"5px 8px", borderRadius:6, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:item.color, fontSize:fs-2, outline:"none", textAlign:"right", fontWeight:700 }}
                        />
                        <span style={{ fontSize:fs-3, color:"var(--c-text-faint)" }}>€</span>
                      </div>
                    </div>
                  ))}
                  <div style={{ padding:"10px 12px", borderTop:"1px solid var(--c-border)", display:"flex", justifyContent:"space-between", background:"var(--c-bg)" }}>
                    <span style={{ fontSize:fs-2, fontWeight:700, color:"#F59E0B" }}>Patrimonio totale</span>
                    <span style={{ fontSize:fs-1, fontWeight:800, color:"#F59E0B" }}>{fmt(totPatrimonio)}€</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VIAGGI: budget separato per ogni trasferta */}
          {tab==="viaggi" && (()=>{
            const vSel = viaggioSel ? viaggioById[viaggioSel] : null;

            // Dettaglio viaggio: stesso stile del Recap ma limitato alle
            // spese taggate su quel viaggio (tutti i mesi, totale unico).
            if (vSel) {
              const s = statsViaggio(vSel);
              const byCat = s.movs.reduce((acc,e)=>{ acc[e.categoria]=(acc[e.categoria]||0)+toEur(e); return acc; },{});
              // Quanto del totale viaggio se n'è andato in commissioni di
              // cambio: in trasferta è il costo nascosto più frequente.
              const commViaggio = s.movs.reduce((sum,e)=>sum+toEurVal(e.commissioni,e.conto),0);
              return (
                <div>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, gap:8, flexWrap:"wrap" }}>
                    <button onClick={()=>{setViaggioSel(null);setProInput("");setControInput("");}} style={{ padding:"6px 12px", borderRadius:7, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:12 }}>‹ Tutti i viaggi</button>
                    <div style={{ display:"flex", gap:6 }}>
                      <button onClick={()=>openViaggioEdit(vSel)} style={{ padding:"6px 12px", borderRadius:7, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:12 }}>✏️ Modifica</button>
                      <button onClick={()=>deleteViaggio(vSel.id)} style={{ padding:"6px 12px", borderRadius:7, border:"1px solid #2A1A1A", background:"transparent", color:"#EF4444", cursor:"pointer", fontSize:12 }}>× Elimina</button>
                    </div>
                  </div>
                  <div style={{ fontSize:fs+1, fontWeight:800, color:"var(--c-text-strong)", marginBottom:2 }}>✈️ {vSel.nome}</div>
                  <div style={{ fontSize:fs-3, color:"var(--c-text-faint)", marginBottom:14 }}>
                    {fmtShortDate(vSel.dataInizio)}{vSel.dataFine?` – ${fmtShortDate(vSel.dataFine)}`:" – in corso"}{s.giorni?` · ${s.giorni} giorni`:""}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:isMobile?"repeat(2,1fr)":`repeat(${commViaggio>0?4:3},1fr)`, gap:8, marginBottom:20 }}>
                    {[
                      { label:"Totale speso", val:`${fmt(s.tot)}€`, color:"#F59E0B" },
                      { label:"Movimenti", val:s.movs.length, color:"var(--c-text-strong)" },
                      { label:"Media al giorno", val:s.media!=null?`${fmt(s.media)}€`:"—", color:"#8B5CF6" },
                      ...(commViaggio>0?[{ label:"Di cui commissioni", val:`${fmt(commViaggio)}€`, color:"#06B6D4" }]:[]),
                    ].map(c=>(
                      <div key={c.label} style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, padding:"10px 12px", minWidth:0 }}>
                        <div style={{ fontSize:fs-4, color:"var(--c-text-faint)", marginBottom:4 }}>{c.label}</div>
                        <div style={{ fontSize:fs+1, fontWeight:800, color:c.color, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.val}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginBottom:24 }}>
                    <div style={{ fontSize:fs-3, fontWeight:700, color:"#F59E0B", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>
                      📊 Spese per categoria
                    </div>
                    <CategoryBars data={byCat} total={s.tot} color="#F59E0B" fs={fs} fmt={fmt}/>
                  </div>
                  {/* PRO & CONTRO della meta: due liste affiancate (desktop)
                      o impilate (mobile) per decidere se tornarci. */}
                  <div style={{ marginBottom:24 }}>
                    <div style={{ fontSize:fs-3, fontWeight:700, color:"#8B5CF6", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>
                      ⚖️ PRO & CONTRO di questa meta
                    </div>
                    {vSel.note && (
                      <div style={{ marginBottom:10, background:"var(--c-panel2)", border:"1px dashed var(--c-border)", borderRadius:8, padding:"8px 10px", display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
                        <div>
                          <div style={{ fontSize:fs-5, color:"var(--c-text-faintest)", marginBottom:2 }}>📝 Vecchie note (sposta le voci nelle liste, poi elimina)</div>
                          <div style={{ fontSize:fs-3, color:"var(--c-text-dim)", whiteSpace:"pre-wrap" }}>{vSel.note}</div>
                        </div>
                        <button onClick={()=>clearNoteViaggio(vSel.id)} title="Elimina le vecchie note" style={{ flexShrink:0, width:22, height:22, borderRadius:5, border:"1px solid #2A1A1A", background:"transparent", color:"#EF4444", cursor:"pointer", fontSize:12, fontWeight:700 }}>×</button>
                      </div>
                    )}
                    <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:12, alignItems:"start" }}>
                      {[
                        { campo:"pro",    label:"👍 PRO",    color:"#10B981", input:proInput,    setInput:setProInput,    placeholder:"es. Città economica, hotel ottimo..." },
                        { campo:"contro", label:"👎 CONTRO", color:"#EF4444", input:controInput, setInput:setControInput, placeholder:"es. Cambio in aeroporto pessimo..." },
                      ].map(t=>{
                        const voci = vSel[t.campo]||[];
                        const aggiungi = ()=>{ addVoceViaggio(vSel.id, t.campo, t.input); t.setInput(""); };
                        return (
                          <div key={t.campo} style={{ background:"var(--c-panel)", border:`1px solid ${t.color}30`, borderRadius:10, overflow:"hidden" }}>
                            <div style={{ padding:"10px 12px", borderBottom:"1px solid var(--c-border)", background:`${t.color}10`, fontSize:fs-2, fontWeight:800, color:t.color, letterSpacing:"0.06em", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                              <span>{t.label}</span>
                              <span style={{ fontSize:fs-4, fontWeight:600, color:"var(--c-text-faint)" }}>{voci.length} voc{voci.length===1?"e":"i"}</span>
                            </div>
                            {voci.length===0 && (
                              <div style={{ padding:"12px", textAlign:"center", color:"var(--c-text-faintest)", fontSize:fs-3 }}>Nessuna voce ancora</div>
                            )}
                            {voci.map((txt,idx)=>(
                              <div key={idx} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8, padding:"8px 12px", borderTop:idx===0?"none":"1px solid var(--c-border)", background:idx%2===0?"var(--c-panel)":"var(--c-panel2)" }}>
                                <span style={{ fontSize:fs-2, color:"var(--c-text)", lineHeight:1.4, flex:1 }}>{txt}</span>
                                <button onClick={()=>removeVoceViaggio(vSel.id, t.campo, idx)} title="Elimina voce" style={{ flexShrink:0, width:20, height:20, borderRadius:5, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-faint)", cursor:"pointer", fontSize:11, fontWeight:700 }}>×</button>
                              </div>
                            ))}
                            <div style={{ display:"flex", gap:6, padding:"8px 10px", borderTop:"1px solid var(--c-border)", background:"var(--c-bg)" }}>
                              <input type="text" value={t.input} onChange={e=>t.setInput(e.target.value)} onKeyDown={e=>{ if (e.key==="Enter") aggiungi(); }}
                                placeholder={t.placeholder}
                                style={{ flex:1, minWidth:0, padding:"6px 8px", borderRadius:6, border:"1px solid var(--c-border)", background:"var(--c-panel)", color:"var(--c-text)", fontSize:fs-3, outline:"none" }}/>
                              <button onClick={aggiungi} disabled={!t.input.trim()} style={{ flexShrink:0, padding:"6px 12px", borderRadius:6, border:"none", background:t.color, color:"#fff", cursor:t.input.trim()?"pointer":"default", opacity:t.input.trim()?1:0.4, fontSize:fs-3, fontWeight:700 }}>+</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ fontSize:fs-3, fontWeight:700, color:"var(--c-text-dim)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>
                    🧾 Movimenti del viaggio
                  </div>
                  {s.movs.length===0 && (
                    <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, padding:20, textAlign:"center", color:"var(--c-text-faintest)", fontSize:fs-2 }}>
                      Nessuna spesa ancora taggata su questo viaggio. Aggiungi un'uscita con data dentro il viaggio: il tag si mette da solo.
                    </div>
                  )}
                  {groupByDayDesc(s.movs).map(({key,data,items})=>(
                    <div key={key} style={{ marginBottom:12 }}>
                      <div style={{ fontSize:fs-3, fontWeight:700, color:"var(--c-text-dim)", marginBottom:6, display:"flex", justifyContent:"space-between" }}>
                        <span>{formatDayLabel(data)}</span>
                        <span style={{ color:"#F59E0B" }}>-{fmt(items.reduce((s2,e)=>s2+toEur(e),0))}€</span>
                      </div>
                      <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, overflow:"hidden" }}>
                        {items.map((e,i)=>(
                          <div key={e.id} style={{ display:"grid", gridTemplateColumns:"1fr auto auto", borderTop:i===0?"none":"1px solid var(--c-border)", background:i%2===0?"var(--c-panel)":"var(--c-panel2)" }}>
                            <Cell style={{ flexDirection:"column", alignItems:"flex-start", gap:2 }}>
                              <span style={{ color:"var(--c-text)" }}>{e.descrizione}</span>
                              <span style={{ fontSize:fs-4, color:"var(--c-text-faint)" }}>{e.categoria}{e.conto?` · ${CONTI_BY_ID[e.conto]?.label||e.conto}`:""}</span>
                            </Cell>
                            <Cell style={{ color:"#EF4444", fontWeight:700 }}>-{fmt(e.importo)}{contoCurrency(e.conto)==="RON"?" RON":"€"}</Cell>
                            <Cell><button onClick={()=>openEdit("uscita",e)} style={{ width:24, height:24, borderRadius:5, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:10 }}>✏️</button></Cell>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            }

            // Lista viaggi
            return (
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                  <div style={{ fontSize:fs-1, fontWeight:700, color:"var(--c-text-strong)" }}>✈️ I tuoi viaggi</div>
                  <button onClick={openViaggioAdd} style={{ padding:"6px 14px", borderRadius:7, border:"none", background:"#F59E0B", color:"#fff", cursor:"pointer", fontSize:12, fontWeight:600 }}>+ Nuovo viaggio</button>
                </div>
                {viaggi.length===0 ? (
                  <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, padding:24, textAlign:"center", color:"var(--c-text-faintest)", fontSize:fs-2 }}>
                    Nessun viaggio ancora. Creane uno con nome e date: le spese fatte in quei giorni verranno taggate da sole (tranne Affitto, Utenze e Abbonamenti).
                  </div>
                ) : (
                  <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, overflow:"hidden" }}>
                    {viaggiOrdinati.map((v,i)=>{
                      const s = statsViaggio(v);
                      const inCorso = !v.dataFine || (localISODate() >= v.dataInizio && localISODate() <= v.dataFine);
                      return (
                        <div key={v.id} onClick={()=>{setViaggioSel(v.id);setProInput("");setControInput("");}} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, padding:"12px 14px", borderTop:i===0?"none":"1px solid var(--c-border)", background:i%2===0?"var(--c-panel)":"var(--c-panel2)", cursor:"pointer" }}>
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontSize:fs-1, fontWeight:700, color:"var(--c-text)", display:"flex", alignItems:"center", gap:6 }}>
                              ✈️ {v.nome}{(v.note||v.pro?.length||v.contro?.length)?<span title="Ci sono pro/contro o note su questo viaggio" style={{fontSize:fs-4}}>⚖️</span>:null}
                              {inCorso && <span style={{ fontSize:9, fontWeight:700, color:"#10B981", border:"1px solid #10B98150", background:"#10B98115", borderRadius:5, padding:"1px 6px", textTransform:"uppercase", letterSpacing:"0.05em" }}>in corso</span>}
                            </div>
                            <div style={{ fontSize:fs-4, color:"var(--c-text-faint)", marginTop:2 }}>
                              {fmtShortDate(v.dataInizio)}{v.dataFine?` – ${fmtShortDate(v.dataFine)}`:" – aperto"}{s.giorni?` · ${s.giorni}gg`:""} · {s.movs.length} moviment{s.movs.length===1?"o":"i"}{s.media!=null?` · ${fmt(s.media)}€/giorno`:""}
                            </div>
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
                            <span style={{ fontSize:fs, fontWeight:800, color:"#F59E0B" }}>{fmt(s.tot)}€</span>
                            <span style={{ color:"var(--c-text-faintest)", fontSize:14 }}>›</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {viaggi.length>0 && (
                  <div style={{ marginTop:8, fontSize:fs-4, color:"var(--c-text-faintest)" }}>
                    Le spese con data dentro un viaggio vengono taggate automaticamente (escluse Affitto, Utenze e Abbonamenti). Puoi sempre togliere o cambiare il tag dal form della spesa.
                  </div>
                )}
              </div>
            );
          })()}

          {/* RECAP: dove vanno i soldi, mese per mese */}
          {tab==="recap" && (
            <div>
              <div style={{ fontSize:fs-1, fontWeight:700, color:"var(--c-text-strong)", marginBottom:16 }}>
                📊 Recap {getMonthLabel(month)}
              </div>

              {/* Budget mensile per categoria: barre spesa/soglia con alert
                  sforamento. La spesa è quella del mese visualizzato. */}
              <div style={{ marginBottom:24 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                  <div style={{ fontSize:fs-3, fontWeight:700, color:"#F59E0B", textTransform:"uppercase", letterSpacing:"0.08em" }}>
                    🎯 Budget mensile{budgetSforati.length>0 && <span style={{color:"#EF4444"}}> — {budgetSforati.length} sforat{budgetSforati.length===1?"o":"i"}</span>}
                  </div>
                  <button onClick={openBudgetModal} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:11 }}>
                    {budgetEntries.length>0?"✏️ Modifica":"➕ Imposta budget"}
                  </button>
                </div>
                {budgetEntries.length===0 && (
                  <div style={{ fontSize:fs-2, color:"var(--c-text-faintest)", padding:"4px 0 8px" }}>
                    Nessun budget impostato — definisci una soglia mensile per le categorie che vuoi tenere d'occhio (es. Cibo, Abbonamenti).
                  </div>
                )}
                {budgetEntries.sort((a,b)=>((usciteByCat[b[0]]||0)/b[1])-((usciteByCat[a[0]]||0)/a[1])).map(([cat,bud])=>{
                  const spesa = usciteByCat[cat]||0;
                  const pct = (spesa/bud)*100;
                  const color = pct>100 ? "#EF4444" : pct>80 ? "#F59E0B" : "#10B981";
                  return (
                    <div key={cat} style={{ marginBottom:10 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:fs-2, marginBottom:4 }}>
                        <span style={{ color:"var(--c-text)" }}>{pct>100?"⚠️ ":""}{cat}</span>
                        <span style={{ color, fontWeight:600 }}>
                          {fmt(spesa)}€ / {fmt(bud)}€ · {Math.round(pct)}%{pct>100 && ` · sforato di ${fmt(spesa-bud)}€`}
                        </span>
                      </div>
                      <div style={{ height:8, background:"var(--c-border)", borderRadius:4, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${Math.min(pct,100)}%`, background:color, borderRadius:4 }}/>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginBottom:24 }}>
                <div style={{ fontSize:fs-3, fontWeight:700, color:"#EF4444", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>
                  🔴 Uscite per categoria — totale {fmt(totUscite)}€
                </div>
                {/* "di cui X€ viaggio Y": quota del totale mensile spesa in
                    trasferta, per distinguere il mese caro dal mese viaggiato. */}
                {(Object.keys(speseViaggiMese).length>0 || totCommissioniMese>0) && (
                  <div style={{ marginBottom:10 }}>
                    {Object.entries(speseViaggiMese).sort((a,b)=>b[1]-a[1]).map(([vid,val])=>(
                      <div key={vid} style={{ fontSize:fs-3, color:"var(--c-text-dim)" }}>
                        ↳ di cui <b style={{ color:"#F59E0B" }}>{fmt(val)}€</b> · ✈️ viaggio {viaggioById[vid]?.nome||"eliminato"}
                      </div>
                    ))}
                    {totCommissioniMese>0 && (
                      <div style={{ fontSize:fs-3, color:"var(--c-text-dim)" }}>
                        ↳ di cui <b style={{ color:"#06B6D4" }}>{fmt(totCommissioniMese)}€</b> · 🏦 commissioni bancarie
                      </div>
                    )}
                  </div>
                )}
                {Object.keys(speseViaggiMese).length===0 && totCommissioniMese===0 && <div style={{ marginBottom:10 }}/>}
                <CategoryBars data={usciteByCat} total={totUscite} color="#EF4444" fs={fs} fmt={fmt}/>
              </div>

              <div>
                <div style={{ fontSize:fs-3, fontWeight:700, color:"#10B981", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>
                  💚 Entrate per categoria — totale {fmt(totEntrate)}€
                </div>
                <CategoryBars data={entrateByCat} total={totEntrate} color="#10B981" fs={fs} fmt={fmt}/>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal entrata/uscita */}
      {modal && (
        <div style={{ position:"fixed", inset:0, background:"#00000090", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={closeModal}>
          <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:16, padding:24, width:"100%", maxWidth:400, maxHeight:"90vh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:700, color:"var(--c-text-strong)", marginBottom:20 }}>
              {modal.mode==="add"?"➕ Nuova":"✏️ Modifica"} {modal.tipo==="entrata"?"Entrata":"Uscita"}
            </div>

            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Descrizione *</div>
                <input type="text" value={form.descrizione||""} onChange={e=>setForm(p=>({...p,descrizione:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
              </div>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:6 }}>Categoria</div>
                {modal.tipo==="uscita" ? (
                  <>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
                      {CAT_USCITE_FISSE.map(c=>(
                        <button key={c} onClick={()=>{setForm(p=>({...p,categoria:c, viaggio: p._viaggioManual ? p.viaggio : autoViaggioFor(p.data, c)}));setCustomCat("");}}
                          style={{ padding:"4px 10px", borderRadius:6, border:`1px solid ${form.categoria===c&&!customCat?"#EF4444":"var(--c-border)"}`, background:form.categoria===c&&!customCat?"#EF444420":"transparent", color:form.categoria===c&&!customCat?"#EF4444":"var(--c-text-faint)", cursor:"pointer", fontSize:11 }}>
                          {c}
                        </button>
                      ))}
                    </div>
                    <input type="text" value={customCat} onChange={e=>{ const val=e.target.value; setCustomCat(val); setForm(p=>({...p, viaggio: p._viaggioManual ? p.viaggio : autoViaggioFor(p.data, val.trim()||p.categoria) })); }} placeholder="Oppure categoria personalizzata..."
                      style={{ width:"100%", padding:"7px 10px", borderRadius:7, border:`1px solid ${customCat?"#EF4444":"var(--c-border)"}`, background:"var(--c-bg)", color:"var(--c-text)", fontSize:12, outline:"none" }}/>
                  </>
                ) : (
                  <input type="text" value={form.categoria||""} onChange={e=>setForm(p=>({...p,categoria:e.target.value}))} placeholder="es. Stipendio, Freelance..."
                    style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
                )}
              </div>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>{modal.tipo==="uscita"?"Pagato da 🏦":"Accreditato su 🏦"}</div>
                <select value={form.conto||""} onChange={e=>setForm(p=>({...p,conto:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}>
                  <option value="">-- Seleziona conto --</option>
                  {CONTI.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                {/* La valuta segue il conto selezionato: se paghi/incassi su
                    un conto RON scrivi l'importo in RON, non serve convertirlo
                    a mano — la conversione in € avviene solo nei totali
                    aggregati (vedi toEur). */}
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>
                  Importo {contoCurrency(form.conto)} *
                </div>
                <input type="number" value={form.importo||""} onChange={e=>setForm(p=>({...p,importo:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
              </div>
              {modal.tipo==="uscita" && (
                <div>
                  <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Di cui commissioni {contoCurrency(form.conto)} (opzionale)</div>
                  <input type="number" value={form.commissioni||""} onChange={e=>setForm(p=>({...p,commissioni:e.target.value}))} placeholder="0"
                    style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:`1px solid ${parseFloat(form.commissioni)>parseFloat(form.importo||0)?"#EF4444":"var(--c-border)"}`, background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
                  <div style={{ fontSize:10, color:"var(--c-text-faintest)", marginTop:4 }}>
                    Per pagamenti con cambio valuta (es. HUF con carta €): l'importo sopra è il TOTALE addebitato, qui indichi solo la parte di commissioni già inclusa.
                  </div>
                  {parseFloat(form.commissioni)>parseFloat(form.importo||0) && (
                    <div style={{ fontSize:10, color:"#EF4444", marginTop:2 }}>Le commissioni non possono superare l'importo totale.</div>
                  )}
                </div>
              )}
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Data</div>
                {/* Cambiare la data ricalcola il viaggio pre-selezionato,
                    ma solo finché l'utente non ha toccato i chip a mano. */}
                <input type="date" value={form.data||""} onChange={e=>{ const data=e.target.value; setForm(p=>({...p, data, viaggio: (modal.tipo==="uscita" && !p._viaggioManual) ? autoViaggioFor(data, customCat.trim()||p.categoria) : p.viaggio })); }}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
              </div>
              {modal.tipo==="uscita" && viaggi.length>0 && (
                <div>
                  <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:6 }}>✈️ Viaggio (opzionale)</div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    <button onClick={()=>setForm(p=>({...p, viaggio:"", _viaggioManual:true}))}
                      style={{ padding:"4px 10px", borderRadius:6, border:`1px solid ${!form.viaggio?"#F59E0B":"var(--c-border)"}`, background:!form.viaggio?"#F59E0B20":"transparent", color:!form.viaggio?"#F59E0B":"var(--c-text-faint)", cursor:"pointer", fontSize:11 }}>
                      Nessuno
                    </button>
                    {viaggiOrdinati.map(v=>(
                      <button key={v.id} onClick={()=>setForm(p=>({...p, viaggio:v.id, _viaggioManual:true}))}
                        style={{ padding:"4px 10px", borderRadius:6, border:`1px solid ${form.viaggio===v.id?"#F59E0B":"var(--c-border)"}`, background:form.viaggio===v.id?"#F59E0B20":"transparent", color:form.viaggio===v.id?"#F59E0B":"var(--c-text-faint)", cursor:"pointer", fontSize:11 }}>
                        ✈️ {v.nome}
                      </button>
                    ))}
                  </div>
                  {form.viaggio && !form._viaggioManual && (
                    <div style={{ fontSize:10, color:"var(--c-text-faintest)", marginTop:4 }}>
                      Pre-selezionato perché la data cade nel viaggio — tocca "Nessuno" se è una spesa di casa.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={closeModal} style={{ flex:1, padding:10, borderRadius:8, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-faint)", cursor:"pointer", fontSize:13 }}>Annulla</button>
              <button onClick={saveItem} style={{ flex:2, padding:10, borderRadius:8, border:"none", background:modal.tipo==="entrata"?"#10B981":"#EF4444", color:"#fff", cursor:"pointer", fontSize:13, fontWeight:700 }}>Salva</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nuovo/Modifica viaggio */}
      {viaggioModal && (
        <div style={{ position:"fixed", inset:0, background:"#00000090", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={closeViaggioModal}>
          <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:16, padding:24, width:"100%", maxWidth:400, maxHeight:"90vh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:700, color:"var(--c-text-strong)", marginBottom:6 }}>
              {viaggioModal.mode==="add"?"✈️ Nuovo viaggio":"✏️ Modifica viaggio"}
            </div>
            <div style={{ fontSize:11, color:"var(--c-text-faint)", marginBottom:20 }}>
              Le uscite con data dentro il viaggio verranno taggate automaticamente (escluse Affitto, Utenze e Abbonamenti). Se non sai ancora quando torni, lascia la data fine vuota e chiudila al ritorno.
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Nome viaggio *</div>
                <input type="text" value={viaggioForm.nome||""} onChange={e=>setViaggioForm(p=>({...p,nome:e.target.value}))} placeholder="es. Budapest, Croazia, Italia..."
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
              </div>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Data inizio *</div>
                <input type="date" value={viaggioForm.dataInizio||""} onChange={e=>setViaggioForm(p=>({...p,dataInizio:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
              </div>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Data fine (vuota = viaggio ancora in corso)</div>
                <input type="date" value={viaggioForm.dataFine||""} onChange={e=>setViaggioForm(p=>({...p,dataFine:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
                {viaggioForm.dataFine && viaggioForm.dataInizio && viaggioForm.dataFine < viaggioForm.dataInizio && (
                  <div style={{ fontSize:10, color:"#EF4444", marginTop:4 }}>La data fine è prima della data inizio.</div>
                )}
              </div>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={closeViaggioModal} style={{ flex:1, padding:10, borderRadius:8, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-faint)", cursor:"pointer", fontSize:13 }}>Annulla</button>
              <button onClick={saveViaggio} style={{ flex:2, padding:10, borderRadius:8, border:"none", background:"#F59E0B", color:"#fff", cursor:"pointer", fontSize:13, fontWeight:700 }}>Salva viaggio</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Conversione — solo Revolut EUR <-> Revolut RON */}
      {convModal && (
        <div style={{ position:"fixed", inset:0, background:"#00000090", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={closeConv}>
          <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:16, padding:24, width:"100%", maxWidth:400, maxHeight:"90vh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:700, color:"var(--c-text-strong)", marginBottom:6 }}>🔄 Conversione Revolut</div>
            <div style={{ fontSize:11, color:"var(--c-text-faint)", marginBottom:20 }}>
              Registra un cambio valuta fatto dentro Revolut tra il saldo EUR e quello RON: crea automaticamente un'uscita sul conto di partenza e un'entrata su quello di arrivo, senza contarle come entrata/uscita reale.
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Da conto 🏦</div>
                <select value={convForm.da||""} onChange={e=>{ const da=e.target.value; setConvForm(p=>({...p,da,a:p.a===da?otherConto(da):p.a})); }}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}>
                  {CONTI_CONV.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>A conto 🏦</div>
                <select value={convForm.a||""} onChange={e=>{ const a=e.target.value; setConvForm(p=>({...p,a,da:p.da===a?otherConto(a):p.da})); }}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}>
                  {CONTI_CONV.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>
                  Importo cambiato {contoCurrency(convForm.da)} *
                </div>
                <input type="number" value={convForm.importoDa||""} onChange={e=>setConvForm(p=>({...p,importoDa:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
              </div>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>
                  Tasso applicato dalla banca (1 EUR = ? RON) *
                </div>
                <input type="number" step="0.0001" value={convForm.tasso||""} onChange={e=>setConvForm(p=>({...p,tasso:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
                <div style={{ fontSize:10, color:"var(--c-text-faintest)", marginTop:4 }}>Il tasso che vedi scritto su Revolut per questo cambio.</div>
              </div>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>
                  Tasso reale BCE del giorno (1 EUR = ? RON)
                </div>
                <input type="number" step="0.0001" value={convForm.tassoBce||""} onChange={e=>setConvForm(p=>({...p,tassoBce:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
                <div style={{ fontSize:10, color:"var(--c-text-faintest)", marginTop:4 }}>Precompilato col cambio {rateIsLive?"live BCE di oggi":"fisso di riserva (BCE non raggiungibile)"}. La differenza col tasso banca è la commissione implicita, contata nel recap commissioni.</div>
              </div>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Data</div>
                <input type="date" value={convForm.data||""} onChange={e=>setConvForm(p=>({...p,data:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
              </div>
              <div style={{ background:"#8B5CF615", border:"1px solid #8B5CF640", borderRadius:8, padding:"10px 12px", fontSize:12, color:"var(--c-text)" }}>
                Accrediterai su <b>{CONTI_BY_ID[convForm.a]?.label}</b>: <b style={{ color:"#8B5CF6" }}>{fmt(calcImportoA(convForm))} {contoCurrency(convForm.a)}</b>
                {(()=>{
                  const cc = costoCambio(convForm.importoDa, convForm.tasso, convForm.tassoBce, contoCurrency(convForm.da));
                  if (!cc || Math.abs(cc.costo) < 0.005) return null;
                  return cc.costo > 0 ? (
                    <div style={{ marginTop:6, color:"#06B6D4" }}>
                      🏦 Commissione implicita vs BCE: <b>{fmt(cc.costo)} {contoCurrency(convForm.da)}</b> ({cc.pct.toFixed(2)}%)
                    </div>
                  ) : (
                    <div style={{ marginTop:6, color:"#10B981" }}>
                      ✅ Tasso banca migliore del BCE ({Math.abs(cc.pct).toFixed(2)}%) — nessuna commissione da contare.
                    </div>
                  );
                })()}
              </div>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={closeConv} style={{ flex:1, padding:10, borderRadius:8, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-faint)", cursor:"pointer", fontSize:13 }}>Annulla</button>
              <button onClick={saveConversione} style={{ flex:2, padding:10, borderRadius:8, border:"none", background:"#8B5CF6", color:"#fff", cursor:"pointer", fontSize:13, fontWeight:700 }}>Registra conversione</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Budget per categoria */}
      {budgetModal && (
        <div style={{ position:"fixed", inset:0, background:"#00000090", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={()=>setBudgetModal(false)}>
          <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:16, padding:24, width:"100%", maxWidth:400, maxHeight:"90vh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:700, color:"var(--c-text-strong)", marginBottom:6 }}>🎯 Budget mensile per categoria</div>
            <div style={{ fontSize:11, color:"var(--c-text-faint)", marginBottom:20 }}>
              Soglia di spesa mensile in EUR. Lascia vuoto (o 0) per non monitorare una categoria. Le soglie valgono per tutti i mesi.
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {budgetCatList.map(cat=>(
                <div key={cat} style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ flex:1, fontSize:13, color:"var(--c-text)" }}>{cat}</div>
                  <input type="number" min="0" placeholder="—" value={budgetForm[cat]??""}
                    onChange={e=>setBudgetForm(p=>({...p,[cat]:e.target.value}))}
                    style={{ width:110, padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none", textAlign:"right" }}/>
                  <span style={{ fontSize:12, color:"var(--c-text-faint)" }}>€</span>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={()=>setBudgetModal(false)} style={{ flex:1, padding:10, borderRadius:8, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-faint)", cursor:"pointer", fontSize:13 }}>Annulla</button>
              <button onClick={saveBudget} style={{ flex:2, padding:10, borderRadius:8, border:"none", background:"#F59E0B", color:"#fff", cursor:"pointer", fontSize:13, fontWeight:700 }}>Salva budget</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Check estratto conto */}
      {checkModal && (
        <div style={{ position:"fixed", inset:0, background:"#00000090", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={closeCheckModal}>
          <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:16, padding:24, width:"100%", maxWidth:400, maxHeight:"90vh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:700, color:"var(--c-text-strong)", marginBottom:6 }}>📄 Check estratto conto</div>
            <div style={{ fontSize:11, color:"var(--c-text-faint)", marginBottom:20 }}>
              Confronta il saldo salvato in app a fine mese con quello reale letto sull'estratto conto.
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Mese estratto conto</div>
                <input type="month" value={checkForm.mese||""} onChange={e=>setCheckForm(p=>({...p,mese:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
              </div>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Conto 🏦</div>
                <select value={checkForm.conto||""} onChange={e=>setCheckForm(p=>({...p,conto:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}>
                  {CONTI.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div style={{ background:"var(--c-bg)", border:"1px solid var(--c-border)", borderRadius:8, padding:"8px 10px", fontSize:12, color:"var(--c-text-dim)" }}>
                Saldo salvato in app per {checkForm.mese?getMonthLabel(checkForm.mese):"—"}: <b style={{ color:"var(--c-text)" }}>{fmt((allData[checkForm.mese]||{}).saldi?.[checkForm.conto]||0)} {contoCurrency(checkForm.conto)}</b>
              </div>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Saldo reale sull'estratto conto {contoCurrency(checkForm.conto)} *</div>
                <input type="number" value={checkForm.saldoEstratto||""} onChange={e=>setCheckForm(p=>({...p,saldoEstratto:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
              </div>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={closeCheckModal} style={{ flex:1, padding:10, borderRadius:8, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-faint)", cursor:"pointer", fontSize:13 }}>Annulla</button>
              <button onClick={saveCheck} style={{ flex:2, padding:10, borderRadius:8, border:"none", background:"#06B6D4", color:"#fff", cursor:"pointer", fontSize:13, fontWeight:700 }}>Salva check</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confronto movimento per movimento (carica PDF estratto) */}
      {reconcileModal && (
        <div style={{ position:"fixed", inset:0, background:"#00000090", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={closeReconcile}>
          <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:16, padding:24, width:"100%", maxWidth:460, maxHeight:"90vh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:700, color:"var(--c-text-strong)", marginBottom:6 }}>🔍 Confronta movimenti</div>
            <div style={{ fontSize:11, color:"var(--c-text-faint)", marginBottom:20 }}>
              Carica il PDF o il CSV dell'estratto conto: lo confronto riga per riga con le entrate/uscite già registrate per il mese e conto scelti. Il CSV (se ha un'intestazione riconoscibile: data/importo o entrata-uscita) è più preciso; il PDF usa un'estrazione euristica dal testo, può sbagliare qualche riga — il risultato va sempre controllato a occhio.
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Mese</div>
                <input type="month" value={reconcileForm.mese||""} onChange={e=>setReconcileForm(p=>({...p,mese:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
              </div>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Conto 🏦</div>
                <select value={reconcileForm.conto||""} onChange={e=>setReconcileForm(p=>({...p,conto:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}>
                  {CONTI.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Estratto conto (PDF o CSV)</div>
                <input type="file" accept="application/pdf,.pdf,.csv,text/csv" onChange={e=>setReconcileForm(p=>({...p,file:e.target.files?.[0]||null}))}
                  style={{ width:"100%", fontSize:12, color:"var(--c-text-dim)" }}/>
              </div>
            </div>

            {reconcileResult?.error && (
              <div style={{ marginTop:16, background:"#EF444415", border:"1px solid #EF444440", borderRadius:8, padding:"10px 12px", fontSize:12, color:"#EF4444" }}>
                Errore: {reconcileResult.error}
              </div>
            )}
            {reconcileResult && !reconcileResult.error && (
              <div style={{ marginTop:16, display:"flex", flexDirection:"column", gap:8 }}>
                <div style={{ fontSize:12, color:"var(--c-text)" }}>
                  Trovati <b>{reconcileResult.totaleEstratto}</b> movimenti ({reconcileResult.righeRiconosciute}/{reconcileResult.righeTotali} righe riconosciute) · <b style={{color:"#10B981"}}>{reconcileResult.abbinati} abbinati</b>
                  {reconcileResult.modalita && (
                    <span style={{ marginLeft:6, fontSize:10, color: reconcileResult.modalita==="csv-strutturato" ? "#10B981" : "#F59E0B" }}>
                      {reconcileResult.modalita==="csv-strutturato" ? "· CSV con intestazione riconosciuta (preciso)" : reconcileResult.modalita==="csv-euristico" ? "· CSV senza intestazione riconosciuta, estrazione euristica" : "· PDF, estrazione euristica"}
                    </span>
                  )}
                </div>
                {reconcileResult.mancantiInApp.length > 0 && (
                  <div style={{ background:"#EF444415", border:"1px solid #EF444440", borderRadius:8, padding:"8px 10px" }}>
                    <div style={{ fontSize:12, fontWeight:700, color:"#EF4444", marginBottom:4 }}>Sull'estratto ma non in app ({reconcileResult.mancantiInApp.length})</div>
                    {reconcileResult.mancantiInApp.map((m,i)=>(
                      <div key={i} style={{ fontSize:11, color:"var(--c-text-dim)", padding:"2px 0" }}>{m.data} · {m.descrizione} · {fmt(m.importo)}</div>
                    ))}
                  </div>
                )}
                {reconcileResult.mancantiInEstratto.length > 0 && (
                  <div style={{ background:"#F59E0B15", border:"1px solid #F59E0B40", borderRadius:8, padding:"8px 10px" }}>
                    <div style={{ fontSize:12, fontWeight:700, color:"#F59E0B", marginBottom:4 }}>In app ma non sull'estratto ({reconcileResult.mancantiInEstratto.length}) — evidenziati in arancione in Entrate/Uscite</div>
                    {reconcileResult.mancantiInEstratto.map((m)=>(
                      <div key={m.id} style={{ fontSize:11, color:"var(--c-text-dim)", padding:"2px 0" }}>{m.data||"(senza data)"} · {m.descrizione} · {fmt(m.importo)}</div>
                    ))}
                  </div>
                )}
                {reconcileResult.mancantiInApp.length===0 && reconcileResult.mancantiInEstratto.length===0 && (
                  <div style={{ fontSize:12, color:"#10B981", fontWeight:600 }}>✅ Tutti i movimenti combaciano.</div>
                )}
              </div>
            )}

            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={closeReconcile} style={{ flex:1, padding:10, borderRadius:8, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-faint)", cursor:"pointer", fontSize:13 }}>Chiudi</button>
              <button onClick={runReconcile} disabled={reconcileLoading || !reconcileForm.file} style={{ flex:2, padding:10, borderRadius:8, border:"none", background:"#06B6D4", color:"#fff", cursor:reconcileLoading?"default":"pointer", fontSize:13, fontWeight:700, opacity:(reconcileLoading||!reconcileForm.file)?0.6:1 }}>
                {reconcileLoading ? "Confronto in corso..." : "Confronta"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
