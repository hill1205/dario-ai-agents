"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  MESI_BREVI, MESI_LUNGHI, GIORNI_SETT, THEME_VARS,
  genId, sortByDataDesc, groupByDayDesc, formatDayLabel,
  pad2, ymdStr, fmtShortDate, daysGrid,
  DateRangePicker, VistaToggle, fmt, round2,
  getMonthLabel, getCurrentMonth, lastMonths, localISODate,
  CashFlowMiniChart, CategoryBars, costoCambio,
  SOTTOCAT_TRASPORTI, SOTTOCAT_AUTO, SOTTOCAT_UTENZE, SOTTOCATEGORIE,
  UNITA_CONSUMO, UNITA_DISPONIBILI, propagaSaldiAiMesiSuccessivi,
} from "../lib/finance-ui";
import {
  SOTTOCAT_CARBURANTE, SOTTOCAT_MANUTENZIONE, SOTTOCAT_AUTO_LEGACY,
  rifornimenti, prezzoAlLitro, letture, anomalie, segmentiConsumo,
  consumoMedio, statsMese, statsPerMese, speseManutenzione,
} from "../lib/auto";
import { useUndoStack, UndoButton } from "../lib/undo";
import {
  applicaRicorrenze, debitoResiduo, ratePagate, prossimaScadenza, occorrenze,
  pianoRate, rateTotaliDi, importoRata, totaleRate, maxirataInfo,
  importoCerto, storicoRicorrenza, daConfermare, mediaStorico, importoAtteso,
  riepilogoAnnuale, letturaDaFare,
} from "../lib/ricorrenze";

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

const CAT_USCITE_FISSE = ["Affitto","Cibo","Palestra","Trasporti","Abbonamenti","Finanziamenti","Utenze","Salute","Personale","Extra"];
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
  // Filtro conto delle Entrate, tenuto separato da quello delle Uscite: sono
  // due liste diverse e non ha senso che cambiare conto in una sposti l'altra.
  const [filtroContoEntrate, setFiltroContoEntrate] = useState("");
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

  // Cronologia Annulla: prima di ogni salvataggio si mette da parte lo stato
  // precedente, così un importo corretto per sbaglio si può ripristinare.
  const { snapshot, undo, voci: undoVoci } = useUndoStack("finanze");
  const allDataRef = useRef(allData);
  useEffect(()=>{ allDataRef.current = allData; },[allData]);

  const saveData = useCallback(async (newAllData, opts={}) => {
    if (!loadOk) {
      setSaveStatus("blocked");
      setTimeout(()=>setSaveStatus(null), 3500);
      return;
    }
    // Lo snapshot va preso PRIMA di sostituire lo stato, e non quando è la
    // funzione Annulla stessa a salvare (altrimenti si annullerebbe l'annulla).
    if (!opts.skipSnapshot) snapshot(allDataRef.current, opts.etichetta || "Modifica finanze");
    // Una correzione su un mese passato deve riflettersi sui saldi dei mesi
    // successivi, altrimenti restano fotografati al valore vecchio.
    // L'annullamento passa skipPropagazione: ripristina uno stato già completo.
    const datiFinali = opts.skipPropagazione ? newAllData : propagaSaldiAiMesiSuccessivi(allDataRef.current, newAllData);
    setAllData(datiFinali);
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/bruno-finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: datiFinali }),
      });
      setSaveStatus(res.ok ? "saved" : "error");
    } catch { setSaveStatus("error"); }
    setTimeout(()=>setSaveStatus(null), 2500);
  }, [loadOk, snapshot]);

  // Ripristina lo stato precedente e lo risalva su ClickUp: senza il salvataggio
  // l'annullamento vivrebbe solo a schermo e tornerebbe indietro al reload.
  const handleUndo = () => {
    const voce = undo();
    if (!voce) return;
    saveData(voce.stato, { skipSnapshot:true, skipPropagazione:true });
  };

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

  // --- Totale nella valuta nativa del conto ---------------------------
  // Quando la lista è filtrata su un conto in RON (UniCredit Romania o
  // Revolut RON), tutte le voci mostrate sono in RON: accanto al totale in €
  // (che dipende dal cambio del giorno) serve anche la somma in RON, perché
  // è quella che deve combaciare con il saldo nell'app della banca.
  // Ritorna stringa vuota se il conto selezionato è in € o se non c'è filtro,
  // così il comportamento di prima resta identico.
  const suffissoRon = (items, contoId) => {
    if (!contoId || CONTI_BY_ID[contoId]?.currency !== "RON") return "";
    const tot = items.filter(isReal).reduce((s,e)=>s+(parseFloat(e.importo)||0),0);
    return ` · ${fmt(tot)} RON`;
  };

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
  // Dettaglio Trasporti per sottocategoria (in EUR): le voci auto
  // (SOTTOCAT_AUTO) sommate a parte rispondono alla domanda "quanto mi
  // costa l'auto questo mese", Bolt/Uber resta fuori da quel totale.
  const trasportiBySub = monthData.uscite.filter(e=>isReal(e)&&e.categoria==="Trasporti").reduce((acc,e)=>{
    const k = e.sottocategoria || "Senza sottocategoria";
    acc[k]=(acc[k]||0)+toEur(e); return acc;
  },{});
  const totTrasporti = Object.values(trasportiBySub).reduce((s,v)=>s+v,0);
  const totAuto = SOTTOCAT_AUTO.reduce((s,k)=>s+(trasportiBySub[k]||0),0);
  // Stesso dettaglio per le Utenze: sul totale bolletta luce che sale e gas
  // che scende si annullano, quindi separarle è l'unico modo per accorgersi
  // di un consumo che cresce.
  const utenzeBySub = monthData.uscite.filter(e=>isReal(e)&&e.categoria==="Utenze").reduce((acc,e)=>{
    const k = e.sottocategoria || "Senza sottocategoria";
    acc[k]=(acc[k]||0)+toEur(e); return acc;
  },{});
  const totUtenze = Object.values(utenzeBySub).reduce((s,v)=>s+v,0);
  // Stesse sottocategorie nel mese precedente: serve la freccia "+12% sulla
  // luce" accanto alla cifra, che è la domanda vera ("sto consumando di più?").
  const mesePrecedente = (()=>{ const [y,m]=month.split("-").map(Number); const d=new Date(y,m-2); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`; })();
  const utenzeBySubPrec = (allData[mesePrecedente]?.uscite||[]).filter(e=>isReal(e)&&e.categoria==="Utenze").reduce((acc,e)=>{
    const k = e.sottocategoria || "Senza sottocategoria";
    acc[k]=(acc[k]||0)+toEur(e); return acc;
  },{});
  // Consumi del mese per sottocategoria (kWh, m³), con l'unità: accanto alla
  // spesa dicono se è aumentato il consumo o solo la tariffa.
  const consumiBySub = monthData.uscite.filter(e=>isReal(e)&&e.categoria==="Utenze"&&parseFloat(e.consumo)>0).reduce((acc,e)=>{
    const k = e.sottocategoria || "Senza sottocategoria";
    acc[k] = acc[k] || { consumo:0, unita:e.unita||"", importoNativo:0, quotaFissa:0 };
    acc[k].consumo += parseFloat(e.consumo)||0;
    acc[k].importoNativo += parseFloat(e.importo)||0;
    acc[k].quotaFissa += parseFloat(e.quotaFissa)||0;
    return acc;
  },{});
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

  // --- Finanziamenti & Abbonamenti (spese ricorrenti) -------------------
  // Vivono in allData.ricorrenze (chiave non-mese, come viaggi/checkSaldi).
  // La logica pura sta in lib/ricorrenze.js ed è testata da
  // scripts/test-ricorrenze.mjs: qui c'è solo il collegamento all'interfaccia.
  const ricorrenze = allData.ricorrenze || [];
  const oggiStr = localISODate();
  const finanziamenti = ricorrenze.filter(r=>r.tipo==="finanziamento");
  const abbonamenti   = ricorrenze.filter(r=>r.tipo==="abbonamento");
  // Spese fisse: affitto e bollette. Importo diverso ogni mese, quindi l'app
  // non le registra da sola — ricorda che sono dovute e ti fa scrivere solo
  // la cifra (vedi importoCerto in lib/ricorrenze.js).
  const speseFisse    = ricorrenze.filter(r=>r.tipo==="spesa");

  // Importo atteso di una spesa fissa, nelle due valute che servono davvero.
  // Due casi opposti e altrettanto reali:
  //   affitto  -> fisso 450€, ma pagato in RON: cambia il RON, non l'euro
  //   bollette -> fisse in RON (l'importo lo fa il consumo), variabili in euro
  // `importoValuta` sulla ricorrenza dice in quale delle due è scritto
  // l'importo atteso; l'altra si ricava al cambio del giorno.
  const attesoInfo = (r, storico) => {
    const dich = parseFloat(r.importo)||0;
    const ccyConto = contoCurrency(r.conto);
    if (dich > 0) {
      const inEuro = (r.importoValuta || ccyConto) === "€";
      return {
        eur:    inEuro ? dich : dich/rate,
        nativo: (ccyConto==="RON" && inEuro) ? dich*rate : dich,
        valuta: inEuro ? "€" : ccyConto,
        stimato: false,
      };
    }
    // Senza importo dichiarato si usa la media dello storico, che è sempre
    // nella valuta del conto (è quello che è stato realmente addebitato).
    const media = mediaStorico(storico);
    return { eur: toEurVal(media, r.conto), nativo: media, valuta: ccyConto, stimato: true };
  };

  // Storico e statistiche per ricorrenza, calcolati una volta sola.
  const statsRicorrenza = (r) => {
    const storico = storicoRicorrenza(allData, r.id);
    const media   = mediaStorico(storico);
    const ultimo  = storico.at(-1) || null;
    const penultimo = storico.length>1 ? storico.at(-2) : null;
    const deltaPct = (ultimo && penultimo && penultimo.importo>0)
      ? Math.round(((ultimo.importo - penultimo.importo)/penultimo.importo)*100) : null;
    // Stesso mese dell'anno precedente: sulle bollette è il confronto che
    // conta davvero, perché il consumo è stagionale (il gas di gennaio non si
    // paragona a quello di luglio).
    const annoScorso = ultimo ? storico.find(s=>s.ym === `${Number(ultimo.ym.slice(0,4))-1}-${ultimo.ym.slice(5,7)}`) : null;
    const deltaAnnoPct = (ultimo && annoScorso && annoScorso.importo>0)
      ? Math.round(((ultimo.importo - annoScorso.importo)/annoScorso.importo)*100) : null;
    // Le percentuali sopra sono nella valuta del conto: su una bolletta in RON
    // misurano il consumo, senza il rumore del cambio. In euro serve invece il
    // valore, perché è quello che pesa sul budget.
    const isRon    = contoCurrency(r.conto)==="RON";
    const mediaEur = toEurVal(media, r.conto);
    const ultimoEur = ultimo ? toEurVal(ultimo.importo, r.conto) : null;
    return { storico, media, mediaEur, ultimo, ultimoEur, penultimo, deltaPct, annoScorso, deltaAnnoPct, isRon };
  };

  // Promemoria: scadenze passate delle spese fisse senza un movimento
  // corrispondente. È la lista "quanto hai pagato questo mese?".
  const promemoriaSpese = speseFisse.flatMap(r=>{
    const storico = storicoRicorrenza(allData, r.id);
    const registrate = new Set(storico.map(s=>s.ym));
    return daConfermare(r, oggiStr, registrate, { saltati: allData.ricorrenzeSaltate||[] })
      .map(occ=>({ r, occ, atteso: attesoInfo(r, storico) }));
  });

  // Autoletture da mandare questo mese (promemoria, non pagamenti).
  const lettureDaFare = speseFisse
    .map(r=>({ r, occ: letturaDaFare(r, oggiStr, allData.lettureFatte||[]) }))
    .filter(x=>x.occ);
  const segnaLetturaFatta = (chiave) => {
    saveData({ ...allData, lettureFatte: [...new Set([...(allData.lettureFatte||[]), chiave])] }, { etichetta:"Autolettura inviata" });
  };

  // Apre il form uscita già compilato: resta da scrivere solo l'importo.
  const openRegistraSpesa = (r, occ) => {
    setForm({
      descrizione: r.nome,
      importo: "",
      categoria: r.categoria || "Utenze",
      sottocategoria: r.sottocategoria || "",
      conto: r.conto,
      data: occ.data,
      ricorrenzaId: r.id,
      viaggio: "", _viaggioManual: true,
    });
    setCustomCat("");
    setModal({ tipo:"uscita", mode:"add" });
  };
  // "Questo mese non l'ho pagata": toglie il promemoria senza inventare una
  // spesa, riusando la stessa lista dei saltati degli addebiti automatici.
  const saltaPromemoria = (r, occ) => {
    const id = `ric-${r.id}-${occ.ym}`;
    saveData({ ...allData, ricorrenzeSaltate: [...new Set([...(allData.ricorrenzeSaltate||[]), id])] }, { etichetta:"Salta promemoria spesa" });
  };

  // Debito residuo totale in EUR: le rate sono nella valuta del conto che le
  // paga, quindi vanno convertite prima di sommarle (stessa regola dei saldi).
  const debitoTotale = finanziamenti.reduce((s,r)=>s+toEurVal(debitoResiduo(r, oggiStr), r.conto), 0);
  // Quanto del mese è già impegnato da rate e canoni ancora attivi.
  // La rata "corrente" la dà prossimaScadenza: con un piano a scaglioni non
  // coincide con l'importo base salvato sulla ricorrenza.
  const impegnoMensileEur = ricorrenze.reduce((s,r)=>{
    if (r.attiva===false || r.chiusa) return s;
    const p = prossimaScadenza(r, oggiStr);
    if (!p) return s;
    // Le spese fisse entrano con l'importo atteso, che può essere dichiarato
    // in euro anche se il conto è in RON (l'affitto): attesoInfo lo sa.
    if (!importoCerto(r)) return s + attesoInfo(r, storicoRicorrenza(allData, r.id)).eur;
    return s + toEurVal(p.importo || r.importo, r.conto);
  }, 0);

  // Maxirata: finestra per chiudere il finanziamento a metà piano. Si avvisa da
  // 120 giorni prima, così c'è il tempo di decidere e mettere da parte i soldi.
  const maxirateInScadenza = finanziamenti
    .map(r=>({ r, info: maxirataInfo(r, oggiStr) }))
    .filter(x=>x.info && !x.info.scaduta);
  // Patrimonio netto = quello che hai davvero, tolti i debiti ancora da pagare.
  const patrimonioNetto = totPatrimonio - debitoTotale;

  // Addebiti di questo mese non ancora scattati: servono alla proiezione
  // uscite (senza, il 2 del mese la proiezione ignora l'affitto del 15).
  const ricorrenzeResiduaMese = isCurrentMonthView
    ? ricorrenze.filter(r=>r.attiva!==false && !r.chiusa).reduce((s,r)=>{
        const p = prossimaScadenza(r, oggiStr);
        if (!p || p.ym!==month) return s;
        return s + (importoCerto(r)
          ? toEurVal(p.importo || r.importo, r.conto)
          : attesoInfo(r, storicoRicorrenza(allData, r.id)).eur);
      },0)
    : 0;

  // Alert saldo insufficiente: addebiti previsti nei prossimi 7 giorni
  // raggruppati per conto, confrontati col saldo attuale di quel conto.
  const alertSaldi = (()=>{
    const limite = new Date(); limite.setDate(limite.getDate()+7);
    const limiteStr = `${limite.getFullYear()}-${pad2(limite.getMonth()+1)}-${pad2(limite.getDate())}`;
    const perConto = {};
    for (const r of ricorrenze) {
      if (r.attiva===false || r.chiusa) continue;
      const p = prossimaScadenza(r, oggiStr);
      if (!p || p.data > limiteStr) continue;
      // Confronto col saldo del conto: serve l'importo nella valuta del conto,
      // che per una spesa dichiarata in euro va riconvertito (attesoInfo.nativo).
      const imp = importoCerto(r)
        ? (parseFloat(p.importo || r.importo)||0)
        : attesoInfo(r, storicoRicorrenza(allData, r.id)).nativo;
      perConto[r.conto] = perConto[r.conto] || { totale:0, voci:[], data:p.data };
      perConto[r.conto].totale += imp;
      perConto[r.conto].voci.push(`${r.nome} ${fmt(imp)}${contoCurrency(r.conto)==="RON"?" RON":"€"} il ${p.data.slice(8)}/${p.data.slice(5,7)}`);
      if (p.data < perConto[r.conto].data) perConto[r.conto].data = p.data;
    }
    return Object.entries(perConto)
      .map(([conto,info])=>({ conto, ...info, saldo: parseFloat(monthData.saldi?.[conto])||0 }))
      .filter(a=>a.saldo < a.totale);
  })();

  // Generazione automatica degli addebiti dovuti. Gira una sola volta per
  // sessione (autoRunRef) ed è comunque idempotente lato motore: rilanciarla
  // non può duplicare nulla. skipPropagazione perché la propagazione dei saldi
  // ai mesi successivi la fa già applicaRicorrenze, in un colpo solo su tutti
  // i mesi coinvolti (propagaSaldiAiMesiSuccessivi salterebbe i mesi toccati).
  const autoRunRef = useRef(false);
  const [autoInfo, setAutoInfo] = useState(null);
  const generaAddebiti = useCallback((baseAll, lista) => {
    const { next, creati } = applicaRicorrenze(baseAll, lista, localISODate(), {
      emptyMonth: EMPTY_MONTH,
      carried: (all, ym) => getCarriedFinancials(all, ym),
      // Addebiti cancellati a mano: non vanno rigenerati (vedi deleteItem).
      saltati: baseAll?.ricorrenzeSaltate || [],
    });
    return { next, creati };
  }, []);
  useEffect(()=>{
    if (!loadOk || autoRunRef.current) return;
    autoRunRef.current = true;
    const lista = allDataRef.current?.ricorrenze || [];
    if (!lista.length) return;
    const { next, creati } = generaAddebiti(allDataRef.current, lista);
    if (!creati.length) return;
    setAutoInfo({
      n: creati.length,
      storici: creati.filter(c=>!c.toccaSaldi).length,
      voci: creati.map(c=>`${c.item.descrizione} — ${fmt(c.item.importo)}${contoCurrency(c.item.conto)==="RON"?" RON":"€"} il ${c.item.data}`),
    });
    saveData(next, { skipPropagazione:true, etichetta:`Addebiti automatici (${creati.length})` });
  }, [loadOk, generaAddebiti, saveData]);

  const [ricModal, setRicModal] = useState(null); // {mode:"add"|"edit", tipo}
  const [ricForm, setRicForm]   = useState({});
  const [estingueId, setEstingueId] = useState(null);
  const [estingueForm, setEstingueForm] = useState({});

  const openRicAdd = (tipo) => {
    setRicForm({
      tipo, nome:"", ente:"", conto: CONTI[0].id, importo:"",
      sottocategoria: "",
      giorno: tipo==="finanziamento" ? 15 : new Date().getDate(),
      dataInizio: localISODate(), rateTotali: "",
      periodi: [], maxirata: null,
      // Default: NON registrare gli arretrati. Un finanziamento partito anni
      // fa creerebbe decine di mesi che nell'app non sono mai esistiti, con
      // saldi a zero e dentro solo la rata — e il cash flow e il confronto
      // anno-su-anno li leggerebbero come mesi veri. Rate pagate e debito
      // residuo si calcolano dalle date, quindi saltarli non falsa nulla.
      registraArretrati: false,
      importoFinanziato:"", taeg:"",
      categoria: tipo==="finanziamento" ? "Finanziamenti" : tipo==="spesa" ? "Utenze" : "Abbonamenti",
      attiva:true,
    });
    setRicModal({ mode:"add", tipo });
  };
  const openRicEdit = (r) => {
    // La maxirata è un oggetto annidato: nel form vive come tre campi piatti.
    setRicForm({ ...r, periodi: r.periodi || [],
      maxirataImporto: r.maxirata?.importo || "", maxirataEntro: r.maxirata?.entro || "", maxirataAllaRata: r.maxirata?.allaRata || "" });
    setRicModal({ mode:"edit", tipo:r.tipo });
  };
  const closeRicModal = () => { setRicModal(null); setRicForm({}); };

  // Piano a scaglioni: periodi con rata diversa (48 da 317,52 + 36 da 238,74).
  // Vuoto = piano a rata unica, cioè il comportamento normale.
  const periodiForm = ricForm.periodi || [];
  const addPeriodo = () => setRicForm(p=>({ ...p, periodi:[...(p.periodi||[]), { rate:"", importo:"" }] }));
  const updPeriodo = (i, campo, val) => setRicForm(p=>({ ...p, periodi:(p.periodi||[]).map((x,j)=>j===i?{...x,[campo]:val}:x) }));
  const delPeriodo = (i) => setRicForm(p=>({ ...p, periodi:(p.periodi||[]).filter((_,j)=>j!==i) }));
  const periodiPuliti = periodiForm
    .map(p=>({ rate: parseInt(p.rate,10)||0, importo: round2(parseFloat(p.importo)||0) }))
    .filter(p=>p.rate>0 && p.importo>0);

  const saveRicorrenza = () => {
    if (!ricForm.nome?.trim() || !ricForm.dataInizio) return;
    // Con gli scaglioni l'importo base può restare vuoto: lo prende dal primo
    // periodo. Per le spese fisse può restare vuoto sempre: l'importo atteso è
    // facoltativo e in mancanza si usa la media dello storico.
    if (ricForm.tipo!=="spesa" && !(parseFloat(ricForm.importo)>0) && !periodiPuliti.length) return;
    const g = parseInt(ricForm.giorno,10);
    if (!(g>=1 && g<=31)) return;
    const maxi = (parseFloat(ricForm.maxirataImporto)>0 && ricForm.maxirataEntro)
      ? { importo: round2(parseFloat(ricForm.maxirataImporto)), entro: ricForm.maxirataEntro, allaRata: parseInt(ricForm.maxirataAllaRata,10)||0 }
      : null;
    const r = {
      id: ricModal.mode==="add" ? genId() : ricForm.id,
      tipo: ricForm.tipo,
      nome: ricForm.nome.trim(),
      ente: (ricForm.ente||"").trim(),
      conto: ricForm.conto,
      importo: round2(parseFloat(ricForm.importo) || periodiPuliti[0]?.importo || 0),
      giorno: g,
      dataInizio: ricForm.dataInizio,
      // Con gli scaglioni il numero rate è la somma dei periodi, così non può
      // esserci disaccordo fra i due campi.
      rateTotali: periodiPuliti.length
        ? periodiPuliti.reduce((s,p)=>s+p.rate,0)
        : (parseInt(ricForm.rateTotali,10) || 0),
      periodi: periodiPuliti,
      maxirata: maxi,
      importoFinanziato: parseFloat(ricForm.importoFinanziato) || 0,
      taeg: parseFloat(ricForm.taeg) || 0,
      categoria: ricForm.categoria || (ricForm.tipo==="finanziamento" ? "Finanziamenti" : ricForm.tipo==="spesa" ? "Utenze" : "Abbonamenti"),
      // Sottocategoria (luce/gas/wifi): viaggia sulla ricorrenza e finisce
      // precompilata sul movimento quando confermi l'importo.
      sottocategoria: SOTTOCATEGORIE[ricForm.categoria]?.includes(ricForm.sottocategoria) ? ricForm.sottocategoria : "",
      // In quale valuta è scritto l'importo atteso (vedi attesoInfo).
      importoValuta: ricForm.tipo==="spesa" ? (ricForm.importoValuta || contoCurrency(ricForm.conto)) : undefined,
      // Giorno dell'autolettura del contatore: scadenza diversa dal pagamento.
      letturaGiorno: (ricForm.tipo==="spesa" && parseInt(ricForm.letturaGiorno,10)>=1 && parseInt(ricForm.letturaGiorno,10)<=31)
        ? parseInt(ricForm.letturaGiorno,10) : 0,
      attiva: ricForm.attiva !== false,
      chiusa: ricForm.chiusa || null,
      creata: ricForm.creata || new Date().toISOString(),
    };
    const lista = ricModal.mode==="add" ? [...ricorrenze, r] : ricorrenze.map(x=>x.id===r.id?r:x);
    // Arretrati non voluti: si marcano come "già saltati" prima di generare,
    // così non nascono proprio invece di essere creati e poi cancellati.
    let saltatiBase = allData.ricorrenzeSaltate || [];
    if (ricModal.mode==="add" && !ricForm.registraArretrati) {
      const meseOra = getCurrentMonth();
      const arretrati = occorrenze(r, oggiStr).filter(o=>o.ym < meseOra).map(o=>`ric-${r.id}-${o.ym}`);
      saltatiBase = [...new Set([...saltatiBase, ...arretrati])];
    }
    // Appena salvata, si generano subito gli addebiti già maturati: se
    // inserisci oggi un finanziamento partito a marzo, le rate arretrate
    // compaiono immediatamente nei mesi giusti invece che al prossimo reload.
    const { next, creati } = generaAddebiti({ ...allData, ricorrenze: lista, ricorrenzeSaltate: saltatiBase }, lista);
    if (creati.length) setAutoInfo({
      n: creati.length,
      storici: creati.filter(c=>!c.toccaSaldi).length,
      voci: creati.map(c=>`${c.item.descrizione} — ${fmt(c.item.importo)}${contoCurrency(c.item.conto)==="RON"?" RON":"€"} il ${c.item.data}`),
    });
    saveData(next, { skipPropagazione:true, etichetta: ricModal.mode==="add" ? "Nuova ricorrenza" : "Modifica ricorrenza" });
    closeRicModal();
  };

  const toggleRicAttiva = (r) => {
    saveData({ ...allData, ricorrenze: ricorrenze.map(x=>x.id===r.id?{...x, attiva: x.attiva===false}:x) }, { etichetta:"Pausa/riattiva ricorrenza" });
  };

  const deleteRicorrenza = (r) => {
    if (!confirm(`Eliminare "${r.nome}"? Gli addebiti già registrati restano fra le uscite (sono spese realmente avvenute): vanno cancellati a mano se non li vuoi.`)) return;
    saveData({ ...allData, ricorrenze: ricorrenze.filter(x=>x.id!==r.id) }, { etichetta:"Elimina ricorrenza" });
  };

  // Estinzione anticipata: chiude il finanziamento a una data (da lì in poi
  // niente più rate) e, se indicato un importo di conguaglio, registra
  // l'uscita corrispondente nel mese di quella data.
  const openEstingue = (r) => {
    setEstingueForm({ data: localISODate(), importoEstinzione:"", motivo:"Estinzione anticipata" });
    setEstingueId(r.id);
  };
  const confermaEstinzione = () => {
    const r = ricorrenze.find(x=>x.id===estingueId);
    if (!r || !estingueForm.data) return;
    const lista = ricorrenze.map(x=>x.id===r.id
      ? { ...x, chiusa: { data: estingueForm.data, motivo: estingueForm.motivo||"Estinzione anticipata", importoEstinzione: round2(parseFloat(estingueForm.importoEstinzione)||0) }, attiva:false }
      : x);
    let next = { ...allData, ricorrenze: lista };
    const imp = parseFloat(estingueForm.importoEstinzione)||0;
    if (imp > 0) {
      const ym = estingueForm.data.slice(0,7);
      const base = next[ym] || { ...EMPTY_MONTH, ...getCarriedFinancials(next, ym) };
      const item = { id:genId(), descrizione:`${r.nome} — estinzione anticipata`, categoria:r.categoria||"Finanziamenti",
        conto:r.conto, importo:round2(imp), data:estingueForm.data, ricorrenzaId:r.id, auto:true };
      const mese = { ...base, uscite:[...(base.uscite||[]), item], saldi:{ ...(base.saldi||{}) } };
      if (mese.saldi[r.conto] !== undefined) mese.saldi[r.conto] = round2((parseFloat(mese.saldi[r.conto])||0) - item.importo);
      next[ym] = mese;
      for (const k of Object.keys(next)) {
        if (!/^\d{4}-\d{2}$/.test(k) || k <= ym) continue;
        const md = next[k];
        if (!md?.saldi || md.saldi[r.conto] === undefined) continue;
        next[k] = { ...md, saldi:{ ...md.saldi, [r.conto]: round2((parseFloat(md.saldi[r.conto])||0) - item.importo) } };
      }
    }
    saveData(next, { skipPropagazione:true, etichetta:"Estinzione finanziamento" });
    setEstingueId(null); setEstingueForm({});
  };

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

  // --- Auto: chilometri, consumo, costo al km -------------------------
  // I rifornimenti si pescano da TUTTI i mesi, non solo da quello aperto: il
  // consumo si misura fra due pieni, e due pieni consecutivi cadono spesso in
  // mesi diversi (l'ultimo di luglio e il primo di agosto). Filtrando per mese
  // il primo tratto di ogni mese sparirebbe.
  const tutteLeUscite = (() => {
    const out = [];
    for (const [ym, md] of Object.entries(allData)) {
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      for (const e of (md.uscite||[])) if (isReal(e)) out.push(e);
    }
    return out;
  })();
  const rifs = rifornimenti(tutteLeUscite, toEur);
  const autoMese = statsMese(rifs, month);
  const autoStorico = statsPerMese(rifs, 12);
  const autoSegmenti = segmentiConsumo(rifs).slice().reverse();
  const autoMedia = consumoMedio(segmentiConsumo(rifs));
  const autoAnomalie = anomalie(rifs);
  const autoManutenzione = speseManutenzione(tutteLeUscite, month, toEur);
  // Ultima lettura buona dell'odometro: serve nel form come riferimento
  // ("l'ultima volta erano 10.240"), così un numero digitato male si vede
  // subito invece di scoprirlo dopo, quando ha già falsato due tratti.
  const ultimaLettura = letture(rifs).filter(r=>r.odometroValido).at(-1) || null;

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
    // La sottocategoria vale solo per le categorie che ne hanno (Trasporti,
    // Utenze): se la categoria è cambiata, o la sottocategoria non appartiene
    // a quella categoria, non va salvata.
    // La vecchia "Rifornimento + manutenzione" resta ammessa in salvataggio
    // anche se non è più fra i pulsanti: senza questa riga, aprire e salvare
    // un movimento di luglio per cambiargli l'importo gli cancellerebbe la
    // sottocategoria, e quel movimento uscirebbe dai totali auto.
    const scAmmesse = [...(SOTTOCATEGORIE[cat] || []), ...(cat === "Trasporti" ? [SOTTOCAT_AUTO_LEGACY] : [])];
    if (!scAmmesse.includes(item.sottocategoria)) delete item.sottocategoria;
    // Rifornimento: litri, odometro e "pieno". I litri da soli danno il prezzo
    // al litro; con l'odometro danno i km percorsi; con "pieno" danno il
    // consumo reale. Sono tre livelli: quello che compili, funziona — quello
    // che salti non rompe il resto.
    const litri = parseFloat(item.litri);
    const odo   = parseFloat(item.odometro);
    if (item.sottocategoria === SOTTOCAT_CARBURANTE || (item.sottocategoria === SOTTOCAT_AUTO_LEGACY && litri > 0)) {
      if (litri > 0) item.litri = round2(litri); else delete item.litri;
      // L'odometro è un intero: i decimali del contachilometri parziale (trip)
      // non c'entrano, e mescolare i due azzererebbe i tratti.
      if (odo > 0) item.odometro = Math.round(odo); else delete item.odometro;
      // "pieno" si salva solo se vero: un false su ogni rifornimento sarebbe
      // rumore nel JSON, e l'assenza significa già "parziale".
      if (item.pieno) item.pieno = true; else delete item.pieno;
    } else { delete item.litri; delete item.odometro; delete item.pieno; }
    // Consumo della bolletta (kWh, m³): tenuto insieme all'importo perché da
    // soli non rispondono alla domanda vera — è il loro rapporto (costo
    // unitario) a dire se è cambiato il consumo o la tariffa.
    const cons = parseFloat(item.consumo);
    if (cons > 0 && item.sottocategoria) {
      item.consumo = round2(cons);
      item.unita = item.unita || UNITA_CONSUMO[item.sottocategoria] || "";
      // Quota fissa (canoni/servizi indipendenti dal consumo, es. "Protect
      // 360 Light" 13,20 lei sulle bollette luce): senza toglierla il costo
      // unitario cresce nei mesi di basso consumo anche a tariffa invariata.
      const qf = parseFloat(item.quotaFissa);
      if (qf > 0 && qf < parseFloat(item.importo)) item.quotaFissa = round2(qf); else delete item.quotaFissa;
      // Periodo fatturato: le bollette non seguono il mese solare (quella del
      // gas di luglio copre 16/06-11/07). Senza le date, confrontare due
      // bollette di durata diversa dice poco; con le date si ricava il
      // consumo giornaliero, che invece è confrontabile.
      if (!item.periodoDa || !item.periodoA || item.periodoA < item.periodoDa) { delete item.periodoDa; delete item.periodoA; }
    } else { delete item.consumo; delete item.unita; delete item.periodoDa; delete item.periodoA; delete item.quotaFissa; }
    // "Di cui commissioni": quota informativa GIÀ inclusa nell'importo
    // (es. pagamento in HUF con carta €: importo = totale addebitato,
    // commissioni = la parte presa dalla banca per il cambio). Non tocca
    // saldi né totali, serve solo a tracciare quanto costano i cambi.
    const comm = parseFloat(form.commissioni);
    if (comm > 0) item.commissioni = round2(comm); else delete item.commissioni;
    const tipo = modal.tipo;
    const isUscita = tipo==="uscita";
    const chiave = isUscita ? "uscite" : "entrate";
    // Segno dell'effetto sul saldo: un'uscita scala il conto, un'entrata lo
    // accredita.
    const segno = isUscita ? -1 : 1;
    // I movimenti storici generati dalle ricorrenze (noSaldo) non hanno mai
    // toccato i saldi — quelli dei mesi passati sono scritti a mano leggendo la
    // banca e già li contengono. Quindi né in modifica né in creazione devono
    // muovere il saldo, altrimenti la rata verrebbe contata due volte.
    const noSaldoNuovo   = !!item.noSaldo;
    const noSaldoVecchio = !!modal.item?.noSaldo;
    const applicaSaldo = (md, contoId, delta) => {
      if (!contoId || md.saldi[contoId] === undefined) return;
      md.saldi[contoId] = round2((parseFloat(md.saldi[contoId])||0) + delta);
    };
    // Mese in cui il movimento deve essere archiviato: quello della sua DATA,
    // non quello che si sta guardando. Senza questo, cambiare la data di una
    // spesa da 31 luglio a 1 agosto la lasciava nei totali di luglio (la data
    // è solo un'etichetta di ordinamento, non sposta il contenitore).
    const meseTarget = (item.data && /^\d{4}-\d{2}/.test(item.data)) ? item.data.slice(0,7) : month;

    let updated = { ...monthData, saldi: {...monthData.saldi} };
    // Annulla l'effetto della versione precedente sul saldo (solo in edit e
    // solo se il movimento stava in questo mese).
    if (modal.mode==="edit" && modal.item?.conto && !noSaldoVecchio) {
      applicaSaldo(updated, modal.item.conto, -segno * (parseFloat(modal.item.importo)||0));
    }

    if (meseTarget === month) {
      // Caso normale: resta nel mese visualizzato.
      if (!noSaldoNuovo) applicaSaldo(updated, item.conto, segno * parseFloat(item.importo));
      updated[chiave] = modal.mode==="add" ? [...updated[chiave], item] : updated[chiave].map(e=>e.id===item.id?item:e);
      updateMonth(updated);
    } else {
      // Il movimento appartiene a un altro mese: lo si toglie da qui e lo si
      // scrive nel contenitore giusto, creandolo se non esiste (con i saldi
      // riportati dall'ultimo mese disponibile, come fa la vista mensile).
      updated.uscite  = updated.uscite.filter(e=>e.id!==item.id);
      updated.entrate = updated.entrate.filter(e=>e.id!==item.id);
      const base = allData[meseTarget] || { ...EMPTY_MONTH, ...getCarriedFinancials(allData, meseTarget) };
      const target = { ...base, uscite:[...(base.uscite||[])], entrate:[...(base.entrate||[])], saldi:{...base.saldi} };
      target[chiave] = [...target[chiave].filter(e=>e.id!==item.id), item];
      if (!noSaldoNuovo) applicaSaldo(target, item.conto, segno * parseFloat(item.importo));
      saveData({ ...allData, [month]: updated, [meseTarget]: target });
    }
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
      // Un movimento storico (noSaldo) non ha mai scalato il conto: annullarlo
      // gli restituirebbe soldi che non erano mai stati tolti.
      if (it.noSaldo) return;
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
    // Se il movimento era generato da una ricorrenza (rata/abbonamento), il
    // suo id è deterministico: senza segnarlo fra i "saltati" tornerebbe da
    // solo al prossimo caricamento, e cancellarlo sarebbe impossibile.
    if (item?.ricorrenzaId) {
      const saltati = [...new Set([...(allData.ricorrenzeSaltate||[]), id])];
      saveData({ ...allData, [month]: updated, ricorrenzeSaltate: saltati }, { etichetta:"Elimina addebito ricorrente" });
    } else {
      updateMonth(updated);
    }
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
    const header = ["Data","Descrizione","Categoria","Sottocategoria","Conto","Importo","Valuta","Viaggio","Di cui commissioni","Consumo","Unità","Tariffa (netto quote fisse)","Quota fissa","Periodo da","Periodo a","Litri","Km (odometro)","Pieno","Prezzo al litro"];
    const rows = items.map(e => [
      e.data || "",
      (e.descrizione||"").replace(/"/g,'""'),
      (e.categoria||"").replace(/"/g,'""'),
      (e.sottocategoria||"").replace(/"/g,'""'),
      CONTI_BY_ID[e.conto]?.label || e.conto || "",
      e.importo,
      contoCurrency(e.conto)==="RON"?"RON":"EUR",
      (viaggioById[e.viaggio]?.nome || "").replace(/"/g,'""'),
      e.commissioni || "",
      e.consumo || "",
      e.unita || "",
      (parseFloat(e.consumo)>0 ? ((parseFloat(e.importo)-(parseFloat(e.quotaFissa)||0))/parseFloat(e.consumo)).toFixed(4) : ""),
      e.quotaFissa || "",
      e.periodoDa || "",
      e.periodoA || "",
      e.litri || "",
      e.odometro || "",
      e.pieno ? "sì" : (e.litri ? "no" : ""),
      // Prezzo al litro nella valuta del conto: è il dato che si confronta
      // fra un distributore e l'altro, e in euro non sarebbe confrontabile
      // fra Romania e Ungheria.
      (parseFloat(e.litri)>0 ? (parseFloat(e.importo)/parseFloat(e.litri)).toFixed(3) : ""),
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
            <UndoButton voci={undoVoci} onUndo={handleUndo} accent="#8B5CF6" compact/>
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
            // Con dei debiti aperti il patrimonio lordo da solo racconta una
            // mezza verità: sotto il numero mostriamo il netto (meno il
            // debito residuo), che è quello che possiedi davvero.
            { label:"Patrimonio", val:totPatrimonio, color:"#8B5CF6", prefix:"",
              sub: debitoTotale>0 ? `netto ${fmt(patrimonioNetto)}€ · debiti ${fmt(debitoTotale)}€` : null },
          ].map(c=>(
            <div key={c.label} style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, padding:"10px 12px", minWidth:0, overflow:"hidden" }}>
              <div style={{ fontSize:fs-4, color:"var(--c-text-faint)", marginBottom:4, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.label}</div>
              <div style={{ fontSize:isMobile?fs:fs+2, fontWeight:800, color:c.color, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.prefix}{fmt(c.val)}€</div>
              {c.sub && <div style={{ fontSize:fs-5, color:"var(--c-text-faintest)", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.sub}</div>}
            </div>
          ))}
        </div>

        <CashFlowMiniChart allData={allData} toEur={toEur}/>

        {/* Avvisi delle spese ricorrenti: addebiti in arrivo che il conto non
            copre, e riepilogo di quelli appena registrati in automatico. */}
        {autoInfo && (
          <div style={{marginTop:8,padding:"8px 10px",borderRadius:8,border:"1px solid #10B98140",background:"#10B9810D",color:"#10B981",fontSize:fs-4}}>
            🔁 Registrati {autoInfo.n} addebiti ricorrenti{autoInfo.storici>0?` (${autoInfo.storici} arretrati, registrati come storico senza toccare i saldi)`:""}: {autoInfo.voci.slice(0,4).join(" · ")}{autoInfo.voci.length>4?` · +${autoInfo.voci.length-4} altri`:""}
            <button onClick={()=>setAutoInfo(null)} style={{marginLeft:8,background:"none",border:"none",color:"#10B981",textDecoration:"underline",cursor:"pointer",fontSize:fs-4,padding:0}}>ok</button>
          </div>
        )}
        {/* Autolettura: promemoria di un'azione, non di un pagamento. Niente
            importo, niente movimento — solo "fatto". */}
        {lettureDaFare.map(({r,occ})=>(
          <div key={occ.chiave} style={{marginTop:8,padding:"8px 10px",borderRadius:8,border:"1px solid #F9731640",background:"#F973160D",color:"#F97316",fontSize:fs-4,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <span>📟 Manda l'autolettura del contatore per <b>{r.nome}</b> — era prevista il {occ.data.slice(8)}/{occ.data.slice(5,7)}</span>
            <button onClick={()=>segnaLetturaFatta(occ.chiave)} style={{ padding:"4px 12px", borderRadius:6, border:"none", background:"#F97316", color:"#fff", cursor:"pointer", fontSize:11, fontWeight:700 }}>Fatto</button>
          </div>
        ))}
        {/* Spese fisse da confermare: l'app sa che sono dovute ma non quanto,
            quindi chiede invece di inventare una cifra. */}
        {promemoriaSpese.map(({r,occ,atteso})=>(
          <div key={`${r.id}-${occ.ym}`} style={{marginTop:8,padding:"8px 10px",borderRadius:8,border:"1px solid #06B6D440",background:"#06B6D40D",color:"#06B6D4",fontSize:fs-4,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <span>
              🧾 <b>{r.nome}</b> era dovuta il {occ.data.slice(8)}/{occ.data.slice(5,7)}
              {atteso.eur>0 && <> — di solito ~<b>{fmt(atteso.nativo)}{contoCurrency(r.conto)==="RON"?" RON":"€"}</b>
                {contoCurrency(r.conto)==="RON" && <> (≈{fmt(atteso.eur)}€)</>}</>}. Quanto hai pagato?
            </span>
            <span style={{ display:"flex", gap:6 }}>
              <button onClick={()=>openRegistraSpesa(r, occ)} style={{ padding:"4px 12px", borderRadius:6, border:"none", background:"#06B6D4", color:"#fff", cursor:"pointer", fontSize:11, fontWeight:700 }}>Registra</button>
              <button onClick={()=>saltaPromemoria(r, occ)} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #06B6D440", background:"transparent", color:"#06B6D4", cursor:"pointer", fontSize:11 }}>Non pagata</button>
            </span>
          </div>
        ))}
        {/* Maxirata: si avvisa da 120 giorni prima della scadenza della
            finestra di richiesta — abbastanza per decidere e mettere da parte
            i soldi, non così presto da diventare rumore di fondo. */}
        {maxirateInScadenza.filter(x=>x.info.giorni<=120).map(({r,info})=>(
          <div key={r.id} style={{marginTop:8,padding:"8px 10px",borderRadius:8,border:"1px solid #F59E0B40",background:"#F59E0B0D",color:"#F59E0B",fontSize:fs-4}}>
            🎯 <b>{r.nome}</b>: puoi chiuderlo con una maxirata di <b>{fmt(info.importo)}{contoCurrency(r.conto)==="RON"?" RON":"€"}</b> invece di pagare le rate restanti ({fmt(debitoResiduo(r, oggiStr))}{contoCurrency(r.conto)==="RON"?" RON":"€"}). Va richiesto entro il {info.entro} — mancano {info.giorni} giorni.
          </div>
        ))}
        {alertSaldi.map(a=>(
          <div key={a.conto} style={{marginTop:8,padding:"8px 10px",borderRadius:8,border:"1px solid #EF444440",background:"#EF44440D",color:"#EF4444",fontSize:fs-4}}>
            ⚠️ Su <b>{CONTI_BY_ID[a.conto]?.label||a.conto}</b> stanno per scalare <b>{fmt(a.totale)}{contoCurrency(a.conto)==="RON"?" RON":"€"}</b> ({a.voci.join(" · ")}) ma il saldo è {fmt(a.saldo)}{contoCurrency(a.conto)==="RON"?" RON":"€"}
          </div>
        ))}
        {proiezioneUscite!=null && (()=>{
          // La proiezione a run-rate non "vede" le rate/canoni non ancora
          // scattati del mese: li sommiamo esplicitamente, altrimenti il 2 del
          // mese la stima ignora 317€ di rata che arriveranno di sicuro.
          const proiezioneTot = proiezioneUscite + ricorrenzeResiduaMese;
          return (
            <div style={{marginTop:8,fontSize:fs-4,color:"var(--c-text-faint)"}}>
              🔮 A questo ritmo ({fmt(totUscite/giornoOggi)}€/giorno) chiuderai il mese a ~<b style={{color:proiezioneTot>totEntrate&&totEntrate>0?"#EF4444":"var(--c-text)"}}>{fmt(proiezioneTot)}€</b> di uscite
              {ricorrenzeResiduaMese>0 && <span style={{color:"var(--c-text-faintest)"}}> (di cui {fmt(ricorrenzeResiduaMese)}€ di rate/abbonamenti ancora da addebitare)</span>}
              {proiezioneTot>totEntrate&&totEntrate>0 && <span style={{color:"#EF4444",fontWeight:700}}> — sopra le entrate del mese ({fmt(totEntrate)}€)</span>}
            </div>
          );
        })()}
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
          {[["entrate","💚 Entrate"],["uscite","🔴 Uscite"],["saldi","🏦 Saldi & Obiettivi"],["ricorrenti","🔁 Rate & Abbonamenti"],["auto","🚗 Auto"],["viaggi","✈️ Viaggi"],["recap","📊 Recap"]].map(([t,label])=>(
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
                <div style={{ fontSize:fs-2, color:"var(--c-text-dim)" }}>Totale: <span style={{ color:"#10B981", fontWeight:700 }}>+{fmt(monthData.entrate.filter(e=>isReal(e)&&(!filtroContoEntrate||e.conto===filtroContoEntrate)&&inDateRange(e)).reduce((s,e)=>s+toEur(e),0))}€{suffissoRon(monthData.entrate.filter(e=>(!filtroContoEntrate||e.conto===filtroContoEntrate)&&inDateRange(e)), filtroContoEntrate)}</span></div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <VistaToggle vista={vistaEntrate} onChange={setVistaEntrate} accent="#10B981"/>
                  <button onClick={()=>openAdd("entrata")} style={{ padding:"6px 14px", borderRadius:7, border:"none", background:"#10B981", color:"#fff", cursor:"pointer", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>+ Aggiungi</button>
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:isMobile?"column":"row", alignItems:isMobile?"stretch":"center", gap:6, marginBottom:12, padding:"8px 10px", background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:8 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:11, color:"var(--c-text-faint)", whiteSpace:"nowrap" }}>🏦 Conto</span>
                  <select value={filtroContoEntrate} onChange={e=>setFiltroContoEntrate(e.target.value)} style={{ flex:isMobile?1:"none", minWidth:0, padding:"6px 8px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:12 }}>
                    <option value="">Tutti i conti</option>
                    {CONTI.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                <DateRangePicker da={filtroDataDa} a={filtroDataA} onChange={(d,a)=>{setFiltroDataDa(d);setFiltroDataA(a);}} accent="#10B981"/>
                <button onClick={()=>exportCSV(monthData.entrate.filter(e=>isReal(e)&&(!filtroContoEntrate||e.conto===filtroContoEntrate)&&inDateRange(e)),"entrate")} title="Esporta le entrate filtrate in CSV"
                  style={{ flexShrink:0, padding:"6px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:11, whiteSpace:"nowrap" }}>📥 CSV</button>
              </div>
              {(() => {
                const filtered = monthData.entrate.filter(e=>(!filtroContoEntrate||e.conto===filtroContoEntrate)&&inDateRange(e));
                if (filtered.length===0) return (
                  <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, padding:20, textAlign:"center", color:"var(--c-text-faintest)", fontSize:fs-2 }}>
                    {monthData.entrate.length===0?"Nessuna entrata — aggiungi la prima":"Nessuna entrata nel periodo/conto selezionato"}
                  </div>
                );
                const Row = (e,i) => (
                  <div key={e.id} style={{ display:"grid", gridTemplateColumns:"1fr auto auto auto", gap:0, borderTop:i===0?"none":"1px solid var(--c-border)", background:flaggedIds.has(e.id)?"#F59E0B1F":(i%2===0?"var(--c-panel)":"var(--c-panel2)"), boxShadow:flaggedIds.has(e.id)?"inset 3px 0 0 #F59E0B":"none" }}>
                    <Cell style={{ flexDirection:"column", alignItems:"flex-start", gap:2 }}>
                      <span style={{ color:"var(--c-text)", fontWeight:600 }}>{flaggedIds.has(e.id)?"⚠️ ":""}{e.descrizione}</span>
                      <span style={{ fontSize:fs-4, color:"var(--c-text-faint)" }}>{e.data?`${e.data} · `:""}{e.categoria}{e.conto?` · ${CONTI_BY_ID[e.conto]?.label||e.conto}`:""}</span>
                    </Cell>
                    <Cell style={{ color:e.isConversione?"#8B5CF6":"#10B981", fontWeight:700 }}>{e.isConversione?"↔ ":"+"}{fmt(e.importo)}{contoCurrency(e.conto)==="RON"?" RON":"€"}</Cell>
                    <Cell><button onClick={()=>openEdit("entrata",e)} style={{ width:24, height:24, borderRadius:5, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:10 }}>✏️</button></Cell>
                    <Cell><button onClick={()=>deleteItem("entrata",e.id)} style={{ width:24, height:24, borderRadius:5, border:"1px solid #2A1A1A", background:"transparent", color:"#EF4444", cursor:"pointer", fontSize:12, fontWeight:700 }}>×</button></Cell>
                  </div>
                );
                if (vistaEntrate==="recenti") return groupByDayDesc(filtered).map(({key,data,items})=>(
                  <div key={key} style={{ marginBottom:12 }}>
                    <div style={{ fontSize:fs-3, fontWeight:700, color:"var(--c-text-dim)", marginBottom:6, display:"flex", justifyContent:"space-between" }}>
                      <span>{formatDayLabel(data)}</span>
                      <span style={{ color:"#10B981" }}>+{fmt(items.filter(isReal).reduce((s,e)=>s+toEur(e),0))}€{suffissoRon(items, filtroContoEntrate)}</span>
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
                      <span style={{ color:"#10B981" }}>+{fmt(items.filter(isReal).reduce((s,e)=>s+toEur(e),0))}€{suffissoRon(items, filtroContoEntrate)}</span>
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
                <div style={{ fontSize:fs-2, color:"var(--c-text-dim)" }}>Totale: <span style={{ color:"#EF4444", fontWeight:700 }}>-{fmt(monthData.uscite.filter(e=>isReal(e)&&(!filtroConto||e.conto===filtroConto)&&(!filtroViaggio||e.viaggio===filtroViaggio)&&inDateRange(e)).reduce((s,e)=>s+toEur(e),0))}€{suffissoRon(monthData.uscite.filter(e=>(!filtroConto||e.conto===filtroConto)&&(!filtroViaggio||e.viaggio===filtroViaggio)&&inDateRange(e)), filtroConto)}</span></div>
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
                  <button onClick={()=>exportCSV(monthData.uscite.filter(e=>isReal(e)&&(!filtroConto||e.conto===filtroConto)&&(!filtroViaggio||e.viaggio===filtroViaggio)&&inDateRange(e)),"uscite")} title="Esporta le uscite filtrate in CSV"
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
                      <span style={{ fontSize:fs-4, color:"var(--c-text-faint)" }}>{e.data?`${e.data}`:""}{e.data?" · ":""}{e.categoria}{e.sottocategoria?<span style={{color:"#F97316"}}> › {e.sottocategoria}</span>:""}{e.conto?` · ${CONTI_BY_ID[e.conto]?.label||e.conto}`:""}{e.viaggio&&viaggioById[e.viaggio]?<span style={{color:"#F59E0B"}}> · ✈️ {viaggioById[e.viaggio].nome}</span>:""}{parseFloat(e.commissioni)>0?<span style={{color:"#06B6D4"}}> · di cui {fmt(e.commissioni)}{contoCurrency(e.conto)==="RON"?" RON":"€"} commissioni</span>:""}{e.noSaldo?<span style={{color:"#94A3B8"}} title="Rata/canone arretrato registrato come storico: il saldo del conto non è stato toccato, perché lo avevi già scritto a mano dalla banca"> · 📎 storico, saldo non toccato</span>:""}{parseFloat(e.consumo)>0?<span style={{color:"#06B6D4"}} title="Consumo del periodo e tariffa al netto delle quote fisse: è la tariffa che dice se è aumentato il prezzo"> · ⚡ {fmt(e.consumo)} {e.unita} · {((parseFloat(e.importo)-(parseFloat(e.quotaFissa)||0))/parseFloat(e.consumo)).toFixed(3)}{contoCurrency(e.conto)==="RON"?" RON":"€"}/{e.unita}{parseFloat(e.periodoDa)!==undefined&&e.periodoDa?` · ${e.periodoDa.slice(8)}/${e.periodoDa.slice(5,7)}→${e.periodoA.slice(8)}/${e.periodoA.slice(5,7)}`:""}</span>:""}{parseFloat(e.litri)>0?<span style={{color:"#10B981"}} title="Rifornimento: litri, prezzo al litro nella valuta pagata e lettura del contachilometri"> · ⛽ {fmt(e.litri)} l · {(parseFloat(e.importo)/parseFloat(e.litri)).toFixed(3)}{contoCurrency(e.conto)==="RON"?" RON":"€"}/l{parseFloat(e.odometro)>0?` · ${fmt(e.odometro)} km`:""}{e.pieno?" · pieno":""}</span>:""}</span>
                    </Cell>
                    {/* Le conversioni non sono spese vere: mostrate in viola con ↔
                        invece del rosso -, così la lista non le fa sembrare uscite. */}
                    <Cell style={{ color:e.isConversione?"#8B5CF6":"#EF4444", fontWeight:700 }}>{e.isConversione?"↔ ":"-"}{fmt(e.importo)}{contoCurrency(e.conto)==="RON"?" RON":"€"}</Cell>
                    <Cell><button onClick={()=>openEdit("uscita",e)} style={{ width:24, height:24, borderRadius:5, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:10 }}>✏️</button></Cell>
                    <Cell><button onClick={()=>deleteItem("uscita",e.id)} style={{ width:24, height:24, borderRadius:5, border:"1px solid #2A1A1A", background:"transparent", color:"#EF4444", cursor:"pointer", fontSize:12, fontWeight:700 }}>×</button></Cell>
                  </div>
                );
                if (vistaUscite==="recenti") return groupByDayDesc(filtered).map(({key,data,items})=>(
                  <div key={key} style={{ marginBottom:12 }}>
                    <div style={{ fontSize:fs-3, fontWeight:700, color:"var(--c-text-dim)", marginBottom:6, display:"flex", justifyContent:"space-between" }}>
                      <span>{formatDayLabel(data)}</span>
                      <span style={{ color:"#EF4444" }}>-{fmt(items.filter(isReal).reduce((s,e)=>s+toEur(e),0))}€{suffissoRon(items, filtroConto)}</span>
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
                      <span style={{ color:"#EF4444" }}>-{fmt(items.filter(isReal).reduce((s,e)=>s+toEur(e),0))}€{suffissoRon(items, filtroConto)}</span>
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

          {/* RATE & ABBONAMENTI: spese ricorrenti addebitate in automatico */}
          {tab==="ricorrenti" && (()=>{
            const ccy = (r) => contoCurrency(r.conto)==="RON" ? " RON" : "€";
            const totAbbMese = abbonamenti.filter(r=>r.attiva!==false&&!r.chiusa).reduce((s,r)=>s+toEurVal(r.importo,r.conto),0);

            const Riga = ({ r }) => {
              const rateTot = rateTotaliDi(r);
              const pagate  = Math.min(ratePagate(r, oggiStr), rateTot||Infinity);
              const residuo = debitoResiduo(r, oggiStr);
              const prossima= prossimaScadenza(r, oggiStr);
              const scaglioni = (r.periodi||[]).length>1 ? pianoRate(r) : null;
              const maxi    = maxirataInfo(r, oggiStr);
              // Con gli scaglioni la rata da mostrare è quella in corso, non
              // l'importo base salvato sulla ricorrenza.
              const rataOra = prossima?.importo || parseFloat(r.importo) || 0;
              const pausa   = r.attiva===false && !r.chiusa;
              const pct     = rateTot ? Math.round((pagate/rateTot)*100) : null;
              const colore  = r.chiusa ? "#10B981" : pausa ? "var(--c-text-faint)"
                : r.tipo==="finanziamento" ? "#EF4444" : r.tipo==="spesa" ? "#06B6D4" : "#3B82F6";
              return (
                <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, padding:"12px 14px", opacity:(pausa||r.chiusa)?0.65:1 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10, flexWrap:"wrap" }}>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:fs-1, fontWeight:700, color:"var(--c-text-strong)" }}>
                        {r.nome}
                        {r.chiusa && <span style={{ marginLeft:8, fontSize:fs-4, color:"#10B981", fontWeight:600 }}>✅ estinto {r.chiusa.data}</span>}
                        {pausa && <span style={{ marginLeft:8, fontSize:fs-4, color:"var(--c-text-faint)", fontWeight:600 }}>⏸ in pausa</span>}
                      </div>
                      <div style={{ fontSize:fs-4, color:"var(--c-text-faint)", marginTop:3 }}>
                        {r.ente ? `${r.ente} · ` : ""}{CONTI_BY_ID[r.conto]?.label||r.conto} · ogni {r.giorno} del mese
                        {parseInt(r.letturaGiorno,10)>0 && <span style={{ color:"#F97316" }}> · 📟 autolettura il {r.letturaGiorno}</span>}
                        {rateTot ? ` · ${rateTot} rate` : ""}
                        {scaglioni && <span style={{ color:"#F59E0B" }}> · piano a scaglioni: {scaglioni.map(p=>`${p.rate}×${fmt(p.importo)}`).join(" poi ")}</span>}
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      {(()=>{
                        if (importoCerto(r)) return (
                          <div style={{ fontSize:fs+1, fontWeight:800, color:colore }}>-{fmt(rataOra)}{ccy(r)}</div>
                        );
                        const a = attesoInfo(r, storicoRicorrenza(allData, r.id));
                        // Senza importo atteso e senza storico non c'è nessuna
                        // cifra da mostrare: "~0" sarebbe un numero inventato,
                        // e su una bolletta è proprio il dato che non si sa.
                        if (!(a.eur > 0)) return (
                          <div style={{ fontSize:fs, fontWeight:700, color:"var(--c-text-faintest)" }} title="Importo variabile: lo scrivi tu quando registri il pagamento">—</div>
                        );
                        return (
                          <>
                            <div style={{ fontSize:fs+1, fontWeight:800, color:colore }}>~{fmt(a.nativo)}{ccy(r)}</div>
                            {contoCurrency(r.conto)==="RON" && (
                              <div style={{ fontSize:fs-5, color:"var(--c-text-faint)" }}>≈ {fmt(a.eur)}€{a.valuta==="€"?" (fisso in €)":""}</div>
                            )}
                          </>
                        );
                      })()}
                      {prossima && <div style={{ fontSize:fs-5, color:"var(--c-text-faintest)", marginTop:2 }}>prossimo: {prossima.data.slice(8)}/{prossima.data.slice(5,7)}</div>}
                    </div>
                  </div>

                  {pct!=null && (
                    <div style={{ marginTop:10 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:fs-5, color:"var(--c-text-faint)", marginBottom:4 }}>
                        <span>{pagate}/{rateTot} rate pagate ({pct}%)</span>
                        <span title="Rate ancora da pagare × importo rata: è quanto ti resta da sborsare, interessi inclusi">ancora da versare <b style={{ color: residuo>0?"#EF4444":"#10B981" }}>{fmt(residuo)}{ccy(r)}</b></span>
                      </div>
                      <div style={{ height:6, borderRadius:4, background:"var(--c-border)", overflow:"hidden" }}>
                        <div style={{ width:`${pct}%`, height:"100%", background:r.chiusa?"#10B981":"#F59E0B" }}/>
                      </div>
                      {rateTot>0 && !r.chiusa && (()=>{
                        const ultima = occorrenze({ ...r, chiusa:null }, "2099-12-31").at(-1);
                        // Costo del prestito: somma rate meno capitale ricevuto.
                        // Sono due numeri che si confondono facilmente, quindi
                        // qui stanno scritti uno accanto all'altro.
                        const tot = totaleRate(r);
                        const capitale = parseFloat(r.importoFinanziato)||0;
                        return (
                          <div style={{ fontSize:fs-5, color:"var(--c-text-faintest)", marginTop:4 }}>
                            {ultima && <>ultima rata: {ultima.data} · </>}
                            somma rate {fmt(tot)}{ccy(r)}
                            {capitale>0 && <> · capitale {fmt(capitale)}{ccy(r)} · <span style={{ color:"#EF4444" }}>interessi e spese {fmt(round2(tot-capitale))}{ccy(r)}</span></>}
                          </div>
                        );
                      })()}
                      {maxi && !maxi.scaduta && (
                        <div style={{ fontSize:fs-5, color:"#F59E0B", marginTop:4 }}>
                          🎯 Puoi chiudere alla rata {maxi.allaRata||"?"} con una maxirata di <b>{fmt(maxi.importo)}{ccy(r)}</b> — da richiedere entro {maxi.entro} ({maxi.giorni} giorni)
                        </div>
                      )}
                    </div>
                  )}

                  {/* Andamento: le ultime rilevazioni con importo e mese
                      sempre scritti (non solo la forma della barra), più i
                      confronti che rispondono a "sto pagando di più?". */}
                  {!importoCerto(r) && (()=>{
                    const st = statsRicorrenza(r);
                    if (!st.storico.length) return (
                      <div style={{ fontSize:fs-5, color:"var(--c-text-faintest)", marginTop:8 }}>
                        Nessun pagamento registrato ancora: al prossimo {r.giorno} del mese te lo chiedo io.
                      </div>
                    );
                    const ultimi = st.storico.slice(-12);
                    const max = Math.max(...ultimi.map(x=>x.importo), 1);
                    return (
                      <div style={{ marginTop:10 }}>
                        <div style={{ fontSize:fs-5, color:"var(--c-text-faint)", marginBottom:6 }}>
                          Ultimo: <b style={{ color:"var(--c-text)" }}>{fmt(st.ultimo.importo)}{ccy(r)}</b>
                          {st.isRon && <b style={{ color:"var(--c-text)" }}> ≈ {fmt(st.ultimoEur)}€</b>} ({getMonthLabel(st.ultimo.ym)})
                          {st.deltaPct!=null && <span style={{ marginLeft:6, fontWeight:700, color: st.deltaPct<=0?"#10B981":"#EF4444" }}>{st.deltaPct>=0?"+":""}{st.deltaPct}% sul mese prima</span>}
                          {st.deltaAnnoPct!=null && <span style={{ marginLeft:6, fontWeight:700, color: st.deltaAnnoPct<=0?"#10B981":"#EF4444" }}>· {st.deltaAnnoPct>=0?"+":""}{st.deltaAnnoPct}% su un anno fa</span>}
                          <span style={{ marginLeft:6, color:"var(--c-text-faintest)" }}>· media {fmt(st.media)}{ccy(r)}{st.isRon?` ≈ ${fmt(st.mediaEur)}€`:""}</span>
                        </div>
                        {st.isRon && (
                          <div style={{ fontSize:fs-6, color:"var(--c-text-faintest)", marginBottom:6 }}>
                            Le percentuali sono calcolate in RON (il consumo vero, senza il rumore del cambio); gli euro sono al cambio di oggi ÷{rate.toFixed(2)}.
                          </div>
                        )}
                        {/* Costo unitario: il numero che separa "consumo di
                            più" da "hanno alzato la tariffa". */}
                        {(()=>{
                          const conConsumo = st.storico.filter(x=>x.consumo>0);
                          if (conConsumo.length<2) return null;
                          // Tariffa al netto della quota fissa: vedi costoUnitario().
                          const cu = (x)=>(x.importo-(x.quotaFissa||0))/x.consumo;
                          const ult = conConsumo.at(-1), pen = conConsumo.at(-2);
                          const dTariffa = Math.round(((cu(ult)-cu(pen))/cu(pen))*100);
                          const dConsumo = Math.round(((ult.consumo-pen.consumo)/pen.consumo)*100);
                          const u = ult.unita || "";
                          return (
                            <div style={{ fontSize:fs-5, color:"var(--c-text-faint)", marginBottom:6, padding:"6px 8px", background:"var(--c-panel2)", borderRadius:6 }}>
                              Consumo <b style={{ color:"var(--c-text)" }}>{fmt(ult.consumo)} {u}</b>
                              <span style={{ marginLeft:6, fontWeight:700, color:dConsumo<=0?"#10B981":"#EF4444" }}>{dConsumo>=0?"+":""}{dConsumo}%</span>
                              <span style={{ marginLeft:10 }}>Tariffa <b style={{ color:"var(--c-text)" }}>{cu(ult).toFixed(3)} {ccy(r)==="€"?"€":"RON"}/{u}</b></span>
                              <span style={{ marginLeft:6, fontWeight:700, color:dTariffa<=0?"#10B981":"#EF4444" }}>{dTariffa>=0?"+":""}{dTariffa}%</span>
                              <span style={{ display:"block", color:"var(--c-text-faintest)", marginTop:2 }}>
                                {Math.abs(dConsumo)>Math.abs(dTariffa) ? "La differenza viene soprattutto dal consumo." : Math.abs(dTariffa)>Math.abs(dConsumo) ? "La differenza viene soprattutto dalla tariffa." : "Consumo e tariffa si muovono insieme."}
                              </span>
                            </div>
                          );
                        })()}
                        <div style={{ display:"flex", alignItems:"flex-end", gap:4, height:56 }}>
                          {ultimi.map(x=>(
                            <div key={x.ym} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2, minWidth:0 }}>
                              <span style={{ fontSize:fs-6, color:"var(--c-text-faint)", whiteSpace:"nowrap" }}>{fmt(x.importo)}</span>
                              <div title={`${x.data}: ${fmt(x.importo)}${ccy(r)}${st.isRon?` ≈ ${fmt(toEurVal(x.importo, r.conto))}€`:""}`}
                                style={{ width:"100%", height:Math.max(4, Math.round((x.importo/max)*26)), background: x.importo>st.media?"#EF4444":"#06B6D4", borderRadius:3 }}/>
                              <span style={{ fontSize:fs-6, color:"var(--c-text-faintest)", whiteSpace:"nowrap" }}>{MESI_BREVI[Number(x.ym.slice(5,7))-1]}</span>
                            </div>
                          ))}
                        </div>
                        {/* Riepilogo per anno: spesa e consumo totali. Da qui
                            si vede l'andamento pluriennale, che sul singolo
                            mese è invisibile. */}
                        {(()=>{
                          const anni = riepilogoAnnuale(st.storico);
                          if (anni.length<1) return null;
                          const isRon = contoCurrency(r.conto)==="RON";
                          return (
                            <div style={{ marginTop:10, borderTop:"1px solid var(--c-border)", paddingTop:8 }}>
                              <div style={{ fontSize:fs-5, fontWeight:700, color:"var(--c-text-dim)", marginBottom:4 }}>Per anno</div>
                              {anni.map(a=>(
                                <div key={a.anno} style={{ display:"flex", justifyContent:"space-between", fontSize:fs-5, color:"var(--c-text-faint)", marginBottom:2, gap:8, flexWrap:"wrap" }}>
                                  <span><b style={{ color:"var(--c-text)" }}>{a.anno}</b> <span style={{ color:"var(--c-text-faintest)" }}>({a.n} bollette)</span></span>
                                  <span>
                                    <b style={{ color:"var(--c-text)" }}>{fmt(a.spesa)}{ccy(r)}</b>
                                    {isRon && <span style={{ color:"var(--c-text-faintest)" }}> ≈ {fmt(toEurVal(a.spesa, r.conto))}€</span>}
                                    {a.consumo>0 && <> · {fmt(a.consumo)} {a.unita}</>}
                                    {a.costoUnitario!=null && <span style={{ color:"var(--c-text-faintest)" }}> · {a.costoUnitario.toFixed(3)}/{a.unita}</span>}
                                    {a.consumoGiornaliero!=null && <span style={{ color:"var(--c-text-faintest)" }}> · {a.consumoGiornaliero} {a.unita}/g</span>}
                                  </span>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}

                  <div style={{ display:"flex", gap:6, marginTop:10, flexWrap:"wrap" }}>
                    <button onClick={()=>openRicEdit(r)} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:11 }}>✏️ Modifica</button>
                    {!r.chiusa && <button onClick={()=>toggleRicAttiva(r)} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:11 }}>{pausa?"▶️ Riattiva":"⏸ Pausa"}</button>}
                    {r.tipo==="finanziamento" && !r.chiusa && <button onClick={()=>openEstingue(r)} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #10B98150", background:"#10B9811A", color:"#10B981", cursor:"pointer", fontSize:11, fontWeight:600 }}>💸 Estingui</button>}
                    <button onClick={()=>deleteRicorrenza(r)} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #EF444440", background:"transparent", color:"#EF4444", cursor:"pointer", fontSize:11 }}>🗑 Elimina</button>
                  </div>
                </div>
              );
            };

            return (
              <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                <div style={{ fontSize:fs-4, color:"var(--c-text-faintest)", background:"var(--c-panel2)", border:"1px solid var(--c-border)", borderRadius:8, padding:"8px 10px" }}>
                  ℹ️ Ogni volta che apri Finanze, gli addebiti già scaduti vengono registrati fra le Uscite. <b>I saldi dei conti cambiano solo dal mese corrente in poi</b>: le rate dei mesi passati entrano come storico ma non toccano i saldi, che avevi già scritto a mano dalla banca e che quindi le contengono già. Non possono generarsi doppioni.
                </div>

                {/* Numeri di sintesi */}
                <div style={{ display:"grid", gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(4,1fr)", gap:8 }}>
                  {[
                    { label:"Debito residuo", val:debitoTotale, color:"#EF4444" },
                    { label:"Impegno mensile", val:impegnoMensileEur, color:"#F59E0B" },
                    { label:"Abbonamenti/mese", val:totAbbMese, color:"#3B82F6" },
                    { label:"Patrimonio netto", val:patrimonioNetto, color:patrimonioNetto>=0?"#10B981":"#EF4444" },
                  ].map(c=>(
                    <div key={c.label} style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, padding:"10px 12px", minWidth:0 }}>
                      <div style={{ fontSize:fs-4, color:"var(--c-text-faint)", marginBottom:4, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.label}</div>
                      <div style={{ fontSize:isMobile?fs:fs+2, fontWeight:800, color:c.color, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{fmt(c.val)}€</div>
                    </div>
                  ))}
                </div>
                {totAbbMese>0 && (
                  <div style={{ fontSize:fs-4, color:"var(--c-text-faint)", marginTop:-8 }}>
                    📅 Gli abbonamenti ti costano <b style={{color:"#3B82F6"}}>{fmt(totAbbMese*12)}€ all'anno</b>.
                  </div>
                )}

                {/* Finanziamenti */}
                <div>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <div style={{ fontSize:fs-3, fontWeight:700, color:"#EF4444", textTransform:"uppercase", letterSpacing:"0.08em" }}>🏦 Finanziamenti & debiti</div>
                    <button onClick={()=>openRicAdd("finanziamento")} style={{ padding:"5px 12px", borderRadius:7, border:"none", background:"#EF4444", color:"#fff", cursor:"pointer", fontSize:11, fontWeight:600 }}>+ Finanziamento</button>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {finanziamenti.length===0
                      ? <div style={{ padding:16, textAlign:"center", color:"var(--c-text-faintest)", fontSize:fs-3, background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10 }}>Nessun finanziamento. Aggiungi quello dell'auto: rata, giorno di addebito e numero di rate.</div>
                      : finanziamenti.map(r=><Riga key={r.id} r={r}/>)}
                  </div>
                </div>

                {/* Spese fisse a importo variabile */}
                <div>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <div style={{ fontSize:fs-3, fontWeight:700, color:"#06B6D4", textTransform:"uppercase", letterSpacing:"0.08em" }}>🧾 Spese fisse (importo variabile)</div>
                    <button onClick={()=>openRicAdd("spesa")} style={{ padding:"5px 12px", borderRadius:7, border:"none", background:"#06B6D4", color:"#fff", cursor:"pointer", fontSize:11, fontWeight:600 }}>+ Spesa fissa</button>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {speseFisse.length===0
                      ? <div style={{ padding:16, textAlign:"center", color:"var(--c-text-faintest)", fontSize:fs-3, background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10 }}>Affitto, luce, gas, wifi: quelle che paghi ogni mese ma con una cifra diversa. Non le registro da solo — te le ricordo alla scadenza e tu scrivi quanto hai pagato.</div>
                      : speseFisse.map(r=><Riga key={r.id} r={r}/>)}
                  </div>
                </div>

                {/* Abbonamenti */}
                <div>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <div style={{ fontSize:fs-3, fontWeight:700, color:"#3B82F6", textTransform:"uppercase", letterSpacing:"0.08em" }}>🔁 Abbonamenti</div>
                    <button onClick={()=>openRicAdd("abbonamento")} style={{ padding:"5px 12px", borderRadius:7, border:"none", background:"#3B82F6", color:"#fff", cursor:"pointer", fontSize:11, fontWeight:600 }}>+ Abbonamento</button>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {abbonamenti.length===0
                      ? <div style={{ padding:16, textAlign:"center", color:"var(--c-text-faintest)", fontSize:fs-3, background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10 }}>Nessun abbonamento. Aggiungi ricarica cellulare, Claude, CapCut e compagnia: te li segna da solo ogni mese.</div>
                      : abbonamenti.map(r=><Riga key={r.id} r={r}/>)}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* AUTO: quanto cammina e quanto beve.
              Tre numeri diversi che è facile confondere:
              - km/litro  -> quanto consuma il motore (solo fra due pieni)
              - €/km      -> quanto ti costa guidare (spesa del mese / km)
              - €/litro   -> quanto costa il gasolio al distributore
              Il primo dipende da te e dall'auto, il terzo solo dal mercato. */}
          {tab==="auto" && (()=>{
            const kmMese = autoMese.km;
            const cards = [
              { label:"Km percorsi", val: kmMese!=null?`${fmt(kmMese)} km`:"—", color:"#3B82F6",
                sub: kmMese==null ? "servono due letture del contachilometri" : (autoMese.kmParziali?"parziale: manca la lettura del mese scorso":null) },
              { label:"Carburante", val: autoMese.spesaEur>0?`${fmt(autoMese.spesaEur)}€`:"—", color:"#F97316",
                sub: autoMese.rifornimenti>0?`${autoMese.rifornimenti} rifornimenti · ${fmt(autoMese.litri)} litri`:null },
              { label:"Consumo", val: autoMese.kmPerLitro!=null?`${autoMese.kmPerLitro} km/l`:"—", color:"#10B981",
                sub: autoMese.kmPerLitro!=null?`${autoMese.litriPer100km} l/100km`:"serve un pieno prima e uno dopo" },
              { label:"Costo al km", val: autoMese.costoEurPerKm!=null?`${autoMese.costoEurPerKm.toFixed(3)}€`:"—", color:"#8B5CF6",
                sub: autoManutenzione>0?`+ ${fmt(autoManutenzione)}€ di manutenzione`:"solo carburante" },
            ];
            return (
              <div>
                <div style={{ fontSize:fs-1, fontWeight:700, color:"var(--c-text-strong)", marginBottom:12 }}>
                  🚗 Auto — {getMonthLabel(month)}
                </div>

                {/* Una lettura più bassa della precedente è quasi sempre una
                    cifra saltata scrivendo. Non la correggiamo da soli: la
                    escludiamo e lo diciamo, perché una lettura sbagliata
                    falsa i due tratti che le stanno intorno, non solo sé. */}
                {autoAnomalie.length>0 && (
                  <div style={{ marginBottom:12, padding:"8px 10px", borderRadius:8, border:"1px solid #EF444440", background:"#EF44440D", color:"#EF4444", fontSize:fs-3 }}>
                    ⚠️ {autoAnomalie.length} letture del contachilometri più basse della precedente (
                    {autoAnomalie.map(a=>`${a.data}: ${a.odometro} km`).join(", ")}
                    ). Le ho escluse dai calcoli: correggile dal movimento per recuperare quei tratti.
                  </div>
                )}

                <div style={{ display:"grid", gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(4,1fr)", gap:8 }}>
                  {cards.map(c=>(
                    <div key={c.label} style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, padding:"10px 12px", minWidth:0 }}>
                      <div style={{ fontSize:fs-4, color:"var(--c-text-dim)" }}>{c.label}</div>
                      <div style={{ fontSize:fs+5, fontWeight:700, color:c.color, wordBreak:"break-word" }}>{c.val}</div>
                      {c.sub && <div style={{ fontSize:fs-5, color:"var(--c-text-faintest)", marginTop:2 }}>{c.sub}</div>}
                    </div>
                  ))}
                </div>

                {autoMedia && (
                  <div style={{ marginTop:10, fontSize:fs-3, color:"var(--c-text-muted)" }}>
                    Media di sempre: <b style={{ color:"var(--c-text)" }}>{autoMedia.kmPerLitro} km/l</b> su {fmt(autoMedia.km)} km misurati con {fmt(autoMedia.litri)} litri.
                    {" "}<span style={{ color:"var(--c-text-faintest)" }}>Il consumo si calcola solo fra due pieni: i rifornimenti parziali in mezzo vengono sommati al tratto, non contati a parte.</span>
                  </div>
                )}

                {/* Storico mese per mese. Barre con il valore SEMPRE scritto
                    accanto: una barra senza numero dice solo "più/meno". */}
                {autoStorico.length>0 && (()=>{
                  const maxKm = Math.max(...autoStorico.map(s=>s.km||0), 1);
                  return (
                    <div style={{ marginTop:16, background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, padding:"12px 14px" }}>
                      <div style={{ fontSize:fs-2, fontWeight:700, color:"var(--c-text-strong)", marginBottom:10 }}>Mese per mese</div>
                      {autoStorico.map(s=>(
                        <div key={s.ym} style={{ marginBottom:10 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:6, fontSize:fs-3, color:"var(--c-text)" }}>
                            <span style={{ fontWeight:600 }}>{getMonthLabel(s.ym)}</span>
                            <span style={{ color:"var(--c-text-muted)" }}>
                              {s.km!=null?<b style={{ color:"#3B82F6" }}>{fmt(s.km)} km</b>:<span style={{ color:"var(--c-text-faintest)" }}>km n/d</span>}
                              {" · "}<b style={{ color:"#F97316" }}>{fmt(s.spesaEur)}€</b>
                              {" · "}{fmt(s.litri)} l
                              {s.kmPerLitro!=null && <> · <b style={{ color:"#10B981" }}>{s.kmPerLitro} km/l</b></>}
                              {s.costoEurPerKm!=null && <> · {s.costoEurPerKm.toFixed(3)} €/km</>}
                            </span>
                          </div>
                          <div style={{ height:6, borderRadius:3, background:"var(--c-panel2)", marginTop:4, overflow:"hidden" }}>
                            <div style={{ width:`${Math.round(((s.km||0)/maxKm)*100)}%`, height:"100%", background:"#3B82F6", borderRadius:3 }}/>
                          </div>
                          {s.kmParziali && <div style={{ fontSize:fs-5, color:"var(--c-text-faintest)", marginTop:2 }}>km parziali: manca la lettura del mese precedente</div>}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Tratti misurati: è il dettaglio che spiega la media. Un
                    tratto autostradale e uno in città danno numeri diversi, e
                    vederli separati evita di dare la colpa all'auto. */}
                {autoSegmenti.length>0 && (
                  <div style={{ marginTop:16, background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, padding:"12px 14px" }}>
                    <div style={{ fontSize:fs-2, fontWeight:700, color:"var(--c-text-strong)", marginBottom:10 }}>Tratti misurati (da pieno a pieno)</div>
                    {autoSegmenti.map((s,i)=>(
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:6, padding:"6px 0", borderBottom:i<autoSegmenti.length-1?"1px solid var(--c-border)":"none", fontSize:fs-3 }}>
                        <span style={{ color:"var(--c-text-muted)" }}>
                          {fmtShortDate(s.daData)} → {fmtShortDate(s.aData)}
                          <span style={{ color:"var(--c-text-faintest)" }}> · {fmt(s.daOdometro)} → {fmt(s.aOdometro)} km</span>
                          {s.parzialiInMezzo>0 && <span style={{ color:"var(--c-text-faintest)" }}> · {s.parzialiInMezzo} parziali inclusi</span>}
                        </span>
                        <span style={{ color:"var(--c-text)" }}>
                          <b>{fmt(s.km)} km</b> · {fmt(s.litri)} l · <b style={{ color:"#10B981" }}>{s.kmPerLitro} km/l</b> · {s.costoEurPerKm.toFixed(3)} €/km
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Rifornimenti del mese: qui il prezzo resta nella valuta in
                    cui hai pagato. Convertirlo in euro mescolerebbe il prezzo
                    del distributore col cambio del giorno. */}
                {(()=>{
                  const delMese = rifs.filter(r=>(r.data||"").slice(0,7)===month).slice().reverse();
                  if (!delMese.length) return (
                    <div style={{ marginTop:16, fontSize:fs-3, color:"var(--c-text-faintest)" }}>
                      Nessun rifornimento registrato in {getMonthLabel(month)}. Si aggiungono come una normale uscita: categoria Trasporti › Carburante, poi litri e chilometri del cruscotto.
                    </div>
                  );
                  return (
                    <div style={{ marginTop:16, background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:10, padding:"12px 14px" }}>
                      <div style={{ fontSize:fs-2, fontWeight:700, color:"var(--c-text-strong)", marginBottom:10 }}>Rifornimenti di {getMonthLabel(month)}</div>
                      {delMese.map((r,i)=>{
                        const pl = prezzoAlLitro(r);
                        const valuta = contoCurrency(r.conto)==="RON"?"RON":"€";
                        return (
                          <div key={r.id||i} style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:6, padding:"6px 0", borderBottom:i<delMese.length-1?"1px solid var(--c-border)":"none", fontSize:fs-3 }}>
                            <span style={{ color:"var(--c-text-muted)" }}>
                              {fmtShortDate(r.data)}
                              {r.pieno ? <span style={{ color:"#10B981" }}> · pieno</span> : <span style={{ color:"var(--c-text-faintest)" }}> · parziale</span>}
                              {r.odometro>0 && <span style={{ color:"var(--c-text-faintest)" }}> · {fmt(r.odometro)} km</span>}
                            </span>
                            <span style={{ color:"var(--c-text)" }}>
                              {fmt(r.importo)} {valuta}{r.litri>0 && <> · {fmt(r.litri)} l</>}
                              {pl!=null && <span style={{ color:"var(--c-text-faintest)" }}> · {pl.toFixed(3)} {valuta}/l</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            );
          })()}

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
                            <Cell style={{ color:e.isConversione?"#8B5CF6":"#EF4444", fontWeight:700 }}>{e.isConversione?"↔ ":"-"}{fmt(e.importo)}{contoCurrency(e.conto)==="RON"?" RON":"€"}</Cell>
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
                {/* Dettaglio Trasporti: quanto costa l'AUTO (amministrativo +
                    rifornimento/manutenzione) rispetto alle corse Bolt/Uber. */}
                {totTrasporti>0 && (
                  <div style={{ marginTop:14, padding:"10px 12px", background:"var(--c-bg)", border:"1px solid var(--c-border)", borderRadius:8 }}>
                    <div style={{ fontSize:fs-3, fontWeight:700, color:"var(--c-text-dim)", marginBottom:8 }}>
                      🚗 Dettaglio Trasporti — auto: <span style={{ color:"#F97316" }}>{fmt(totAuto)}€</span> · totale: {fmt(totTrasporti)}€
                    </div>
                    {Object.entries(trasportiBySub).sort((a,b)=>b[1]-a[1]).map(([sc,val])=>(
                      <div key={sc} style={{ display:"flex", justifyContent:"space-between", fontSize:fs-3, marginBottom:4 }}>
                        <span style={{ color:"var(--c-text)" }}>{SOTTOCAT_AUTO.includes(sc)?"🚗 ":sc==="Bolt/Uber"?"🚕 ":"· "}{sc}</span>
                        <span style={{ color:"var(--c-text-dim)", fontWeight:600 }}>{fmt(val)}€</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Dettaglio Utenze: ogni bolletta col confronto sul mese
                    precedente, perché la cifra da sola non dice se hai
                    consumato di più o se è cambiata la tariffa. */}
                {totUtenze>0 && (
                  <div style={{ marginTop:14, padding:"10px 12px", background:"var(--c-bg)", border:"1px solid var(--c-border)", borderRadius:8 }}>
                    <div style={{ fontSize:fs-3, fontWeight:700, color:"var(--c-text-dim)", marginBottom:8 }}>
                      💡 Dettaglio Utenze — totale: <span style={{ color:"#06B6D4" }}>{fmt(totUtenze)}€</span> <span style={{ fontWeight:400, color:"var(--c-text-faintest)" }}>(confronto con {getMonthLabel(mesePrecedente)})</span>
                    </div>
                    {Object.entries(utenzeBySub).sort((a,b)=>b[1]-a[1]).map(([sc,val])=>{
                      const prec = utenzeBySubPrec[sc];
                      const delta = (prec!=null && prec>0) ? Math.round(((val-prec)/prec)*100) : null;
                      const icona = sc==="Luce"?"💡 ":sc==="Gas"?"🔥 ":sc==="Internet / Wifi"?"📶 ":sc==="Acqua e condominio"?"🚰 ":"· ";
                      const cons = consumiBySub[sc];
                      return (
                        <div key={sc} style={{ marginBottom:6 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", fontSize:fs-3 }}>
                            <span style={{ color:"var(--c-text)" }}>{icona}{sc}</span>
                            <span>
                              {prec!=null && <span style={{ color:"var(--c-text-faintest)", marginRight:8 }}>era {fmt(prec)}€</span>}
                              <span style={{ color:"var(--c-text-dim)", fontWeight:600 }}>{fmt(val)}€</span>
                              {delta!=null && <span style={{ marginLeft:6, fontWeight:700, color: delta<=0?"#10B981":"#EF4444" }}>{delta>=0?"+":""}{delta}%</span>}
                            </span>
                          </div>
                          {cons && cons.consumo>0 && (
                            <div style={{ fontSize:fs-5, color:"var(--c-text-faintest)", marginTop:1 }}>
                              ⚡ {fmt(cons.consumo)} {cons.unita} consumati · {((cons.importoNativo-cons.quotaFissa)/cons.consumo).toFixed(3)}/{cons.unita}{cons.quotaFissa>0?` (netto ${fmt(cons.quotaFissa)} di quote fisse)`:""}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
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
                    {/* Sottocategoria: per Trasporti distingue i costi auto
                        dalle corse Bolt/Uber; per Utenze separa luce, gas e
                        wifi, altrimenti sul totale bolletta non si capisce
                        cosa sia salito. Facoltativa, per non rallentare
                        l'inserimento veloce. */}
                    {SOTTOCATEGORIE[form.categoria] && !customCat && (
                      <div style={{ marginTop:8 }}>
                        <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:6 }}>Sottocategoria {form.categoria==="Utenze"?"💡":"🚗"}</div>
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                          {SOTTOCATEGORIE[form.categoria].map(sc=>(
                            <button key={sc} onClick={()=>setForm(p=>({...p,sottocategoria:p.sottocategoria===sc?"":sc, unita: p.sottocategoria===sc?"":(UNITA_CONSUMO[sc]||"")}))}
                              style={{ padding:"4px 10px", borderRadius:6, border:`1px solid ${form.sottocategoria===sc?"#F97316":"var(--c-border)"}`, background:form.sottocategoria===sc?"#F9731620":"transparent", color:form.sottocategoria===sc?"#F97316":"var(--c-text-faint)", cursor:"pointer", fontSize:11 }}>
                              {sc}
                            </button>
                          ))}
                        </div>
                        {/* Consumo: solo dove esiste un contatore. Facoltativo,
                            ma se lo compili sblocca il costo unitario e lo
                            storico dei consumi anno per anno. */}
                        {UNITA_CONSUMO[form.sottocategoria] && (
                          <div style={{ marginTop:8 }}>
                            <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Consumo del periodo (facoltativo)</div>
                            <div style={{ display:"flex", gap:6 }}>
                              <input type="number" step="0.01" value={form.consumo||""} onChange={e=>setForm(p=>({...p,consumo:e.target.value}))}
                                placeholder={form.sottocategoria==="Luce"?"es. 320":"es. 45"}
                                style={{ flex:2, padding:"7px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:12, outline:"none" }}/>
                              <select value={form.unita||UNITA_CONSUMO[form.sottocategoria]} onChange={e=>setForm(p=>({...p,unita:e.target.value}))}
                                style={{ flex:1, padding:"7px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:12, outline:"none" }}>
                                {[...new Set([UNITA_CONSUMO[form.sottocategoria], ...UNITA_DISPONIBILI])].map(u=><option key={u} value={u}>{u}</option>)}
                              </select>
                            </div>
                            {/* Periodo fatturato: quello del gas E.ON va dal 16
                                del mese all'11 del successivo, quindi il mese
                                solare non basta a confrontare due bollette. */}
                            <div style={{ marginTop:6 }}>
                              <div style={{ fontSize:10, color:"var(--c-text-faintest)", marginBottom:3 }}>
                                Quota fissa inclusa {contoCurrency(form.conto)==="RON"?"RON":"€"} — canoni che non dipendono dal consumo (es. Protect 360: 13,20 lei)
                              </div>
                              <input type="number" step="0.01" value={form.quotaFissa||""} onChange={e=>setForm(p=>({...p,quotaFissa:e.target.value}))} placeholder="13,20"
                                style={{ width:"100%", padding:"7px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:12, outline:"none" }}/>
                            </div>
                            <div style={{ display:"flex", gap:6, marginTop:6, alignItems:"center" }}>
                              <span style={{ fontSize:10, color:"var(--c-text-faintest)", whiteSpace:"nowrap" }}>Periodo</span>
                              <input type="date" value={form.periodoDa||""} onChange={e=>setForm(p=>({...p,periodoDa:e.target.value}))}
                                style={{ flex:1, padding:"6px 8px", borderRadius:6, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:11, outline:"none" }}/>
                              <span style={{ fontSize:10, color:"var(--c-text-faintest)" }}>→</span>
                              <input type="date" value={form.periodoA||""} onChange={e=>setForm(p=>({...p,periodoA:e.target.value}))}
                                style={{ flex:1, padding:"6px 8px", borderRadius:6, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:11, outline:"none" }}/>
                            </div>
                            {parseFloat(form.consumo)>0 && parseFloat(form.importo)>0 && (()=>{
                              const u = form.unita||UNITA_CONSUMO[form.sottocategoria];
                              const valuta = contoCurrency(form.conto)==="RON"?"RON":"€";
                              const gg = (form.periodoDa && form.periodoA && form.periodoA>=form.periodoDa)
                                ? Math.round((new Date(form.periodoA)-new Date(form.periodoDa))/86400000)+1 : null;
                              const qf = parseFloat(form.quotaFissa)||0;
                              const cu = (parseFloat(form.importo)-qf)/parseFloat(form.consumo);
                              return (
                                <div style={{ fontSize:10, color:"var(--c-text-faintest)", marginTop:4 }}>
                                  Tariffa: <b style={{ color:"var(--c-text)" }}>{cu.toFixed(3)} {valuta}/{u}</b>
                                  {contoCurrency(form.conto)==="RON" && <> ≈ {(cu/rate).toFixed(3)} €/{u}</>}
                                  {qf>0 && <span style={{ color:"var(--c-text-faintest)" }}> (al netto di {fmt(qf)} {valuta} di quota fissa)</span>}
                                  {gg && <> · {gg} giorni · <b style={{ color:"var(--c-text)" }}>{(parseFloat(form.consumo)/gg).toFixed(2)} {u}/giorno</b></>}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                        {/* Rifornimento: litri, odometro, pieno. Tre campi che
                            l'app non può ricavare da sola — nessuno sa quanti
                            km hai fatto se non lo scrivi tu. In compenso sono
                            indipendenti: solo i litri danno già il prezzo al
                            litro, con l'odometro arrivano i km, con "pieno" il
                            consumo reale. */}
                        {(form.sottocategoria===SOTTOCAT_CARBURANTE || form.sottocategoria===SOTTOCAT_AUTO_LEGACY) && (
                          <div style={{ marginTop:8 }}>
                            <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Rifornimento ⛽ (facoltativo)</div>
                            <div style={{ display:"flex", gap:6 }}>
                              <input type="number" step="0.01" value={form.litri||""} onChange={e=>setForm(p=>({...p,litri:e.target.value}))} placeholder="litri — es. 28,5"
                                style={{ flex:1, padding:"7px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:12, outline:"none" }}/>
                              <input type="number" step="1" value={form.odometro||""} onChange={e=>setForm(p=>({...p,odometro:e.target.value}))} placeholder={ultimaLettura?`km — ultima: ${ultimaLettura.odometro}`:"km sul cruscotto"}
                                style={{ flex:1.3, padding:"7px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:12, outline:"none" }}/>
                            </div>
                            {/* Spunta spenta di default: Dario fa spesso da
                                100-200 lei, e dichiarare pieno un parziale
                                falserebbe il consumo di tutto il tratto. */}
                            <button onClick={()=>setForm(p=>({...p,pieno:!p.pieno}))}
                              style={{ marginTop:6, padding:"5px 10px", borderRadius:6, border:`1px solid ${form.pieno?"#10B981":"var(--c-border)"}`, background:form.pieno?"#10B98120":"transparent", color:form.pieno?"#10B981":"var(--c-text-faint)", cursor:"pointer", fontSize:11 }}>
                              {form.pieno?"✔ Pieno fatto":"○ Era un pieno completo?"}
                            </button>
                            {(()=>{
                              const l = parseFloat(form.litri)||0;
                              const imp = parseFloat(form.importo)||0;
                              const odo = parseFloat(form.odometro)||0;
                              const valuta = contoCurrency(form.conto)==="RON"?"RON":"€";
                              const kmFatti = (ultimaLettura && odo>ultimaLettura.odometro) ? odo-ultimaLettura.odometro : null;
                              const odoIndietro = ultimaLettura && odo>0 && odo<ultimaLettura.odometro;
                              if (!l && !odo) return null;
                              return (
                                <div style={{ fontSize:10, color:"var(--c-text-faintest)", marginTop:5 }}>
                                  {l>0 && imp>0 && <>Prezzo: <b style={{ color:"var(--c-text)" }}>{(imp/l).toFixed(3)} {valuta}/litro</b>{valuta==="RON" && <> ≈ {(imp/l/rate).toFixed(3)} €/l</>}</>}
                                  {kmFatti!=null && <>{l>0&&imp>0?" · ":""}<b style={{ color:"var(--c-text)" }}>{kmFatti} km</b> dall'ultimo rifornimento{/* Il km/l si mostra solo se ANCHE il rifornimento
                                      precedente era un pieno: altrimenti non
                                      si sa quanto carburante c'era già dentro
                                      e il numero sarebbe una fantasia. */}
                                  {l>0 && form.pieno && ultimaLettura.pieno && <> · {(kmFatti/l).toFixed(2)} km/l su questo tratto</>}</>}
                                  {/* Un odometro più basso del precedente è
                                      quasi sempre una cifra saltata: meglio
                                      dirlo ora che scoprirlo nei grafici. */}
                                  {odoIndietro && <span style={{ color:"#EF4444" }}> · ⚠️ meno dell'ultima lettura ({ultimaLettura.odometro} km): controlla il numero</span>}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}
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

      {/* Modal Finanziamento / Abbonamento */}
      {ricModal && (()=>{
        const isFin = ricForm.tipo==="finanziamento";
        const isSpesa = ricForm.tipo==="spesa";
        const ccy = contoCurrency(ricForm.conto);
        // Anteprima: quante rate risulterebbero già pagate e quando finisce.
        const anteprima = (ricForm.dataInizio && ricForm.giorno && (parseFloat(ricForm.importo)>0 || periodiPuliti.length))
          ? (()=>{
              // Si costruisce una ricorrenza "finta" con i valori del form e la
              // si passa alle stesse funzioni usate a regime: così l'anteprima
              // non può divergere da quello che poi succede davvero.
              const finto = { ...ricForm, periodi: periodiPuliti,
                rateTotali: periodiPuliti.length ? periodiPuliti.reduce((s,p)=>s+p.rate,0) : (parseInt(ricForm.rateTotali,10)||0),
                importo: parseFloat(ricForm.importo) || periodiPuliti[0]?.importo || 0, chiusa:null };
              const passate = occorrenze(finto, oggiStr);
              const rateTot = rateTotaliDi(finto);
              const ultima = rateTot ? occorrenze(finto, "2099-12-31").at(-1) : null;
              const meseOra = getCurrentMonth();
              const storiche = passate.filter(o=>o.ym < meseOra).length;
              // Somma di tutte le rate: NON è il capitale finanziato — la
              // differenza sono interessi e spese.
              const tot = totaleRate(finto);
              const capitale = parseFloat(ricForm.importoFinanziato)||0;
              return { passate: passate.length, storiche, ultima, totaleRate: tot, capitale,
                residuoOggi: debitoResiduo({ ...finto, tipo:"finanziamento" }, oggiStr),
                interessi: (capitale>0 && tot>0) ? round2(tot-capitale) : 0 };
            })()
          : null;
        return (
        <div style={{ position:"fixed", inset:0, background:"#00000090", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={closeRicModal}>
          <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:16, padding:24, width:"100%", maxWidth:420, maxHeight:"90vh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:700, color:"var(--c-text-strong)", marginBottom:6 }}>
              {ricModal.mode==="add" ? (isSpesa?"Nuova":"Nuovo") : "Modifica"} {isFin ? "finanziamento 🏦" : isSpesa ? "spesa fissa 🧾" : "abbonamento 🔁"}
            </div>
            <div style={{ fontSize:11, color:"var(--c-text-faint)", marginBottom:20 }}>
              {isSpesa
                ? "L'importo cambia ogni mese, quindi non la registro da solo: alla scadenza te la ricordo con il form già pronto e tu scrivi solo la cifra pagata."
                : "L'addebito verrà registrato da solo fra le Uscite ogni mese, nel giorno indicato, scalando il conto scelto."}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Nome *</div>
                <input type="text" value={ricForm.nome||""} onChange={e=>setRicForm(p=>({...p,nome:e.target.value}))}
                  placeholder={isFin?"es. Auto BMW":isSpesa?"es. Affitto, Bolletta luce":"es. Claude, CapCut, ricarica cellulare"}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
              </div>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>{isFin?"Ente erogante":isSpesa?"Fornitore / proprietario":"Fornitore"}</div>
                <input type="text" value={ricForm.ente||""} onChange={e=>setRicForm(p=>({...p,ente:e.target.value}))}
                  placeholder={isFin?"es. BdM Banca":isSpesa?"es. Enel, Digi, proprietario":"es. Anthropic"}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
              </div>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Addebitato su 🏦</div>
                <select value={ricForm.conto||""} onChange={e=>setRicForm(p=>({...p,conto:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}>
                  {CONTI.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div>
                  <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>{isFin?"Rata":isSpesa?"Importo atteso":"Canone"} {ccy} {isSpesa?"":"*"}</div>
                  <input type="number" step="0.01" value={ricForm.importo||""} onChange={e=>setRicForm(p=>({...p,importo:e.target.value}))} placeholder={isSpesa?"450":"317,52"}
                    style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
                </div>
                <div>
                  <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Giorno del mese *</div>
                  <input type="number" min="1" max="31" value={ricForm.giorno||""} onChange={e=>setRicForm(p=>({...p,giorno:e.target.value}))}
                    style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
                </div>
              </div>
              {/* Valuta dell'importo atteso: su un conto in RON i due casi
                  sono opposti — l'affitto è fisso in euro e variabile in RON,
                  la bolletta è il contrario. Senza questa scelta uno dei due
                  verrebbe convertito al contrario. */}
              {isSpesa && contoCurrency(ricForm.conto)==="RON" && (
                <div>
                  <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:6 }}>L'importo atteso qui sopra è in...</div>
                  <div style={{ display:"flex", gap:6 }}>
                    {[["RON","RON — es. bolletta (varia il consumo)"],["€","€ — es. affitto (varia solo il cambio)"]].map(([v,label])=>{
                      const sel = (ricForm.importoValuta || "RON") === v;
                      return (
                        <button key={v} onClick={()=>setRicForm(p=>({...p,importoValuta:v}))}
                          style={{ flex:1, padding:"6px 10px", borderRadius:6, border:`1px solid ${sel?"#06B6D4":"var(--c-border)"}`, background:sel?"#06B6D420":"transparent", color:sel?"#06B6D4":"var(--c-text-faint)", cursor:"pointer", fontSize:10, textAlign:"left" }}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {parseFloat(ricForm.importo)>0 && (
                    <div style={{ fontSize:10, color:"var(--c-text-faintest)", marginTop:6 }}>
                      {(ricForm.importoValuta||"RON")==="€"
                        ? <>Al cambio di oggi sono circa <b style={{color:"var(--c-text)"}}>{fmt(parseFloat(ricForm.importo)*rate)} RON</b>.</>
                        : <>Al cambio di oggi sono circa <b style={{color:"var(--c-text)"}}>{fmt(parseFloat(ricForm.importo)/rate)}€</b>.</>}
                    </div>
                  )}
                </div>
              )}
              {isSpesa && (
                <div style={{ fontSize:10, color:"var(--c-text-faintest)", marginTop:-6 }}>
                  L'importo atteso è facoltativo: serve solo alla proiezione di fine mese e all'alert saldo. Lascialo vuoto per le bollette, dove la cifra non si può prevedere.
                </div>
              )}
              {/* Autolettura: seconda scadenza, diversa dal pagamento. */}
              {isSpesa && (
                <div>
                  <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Giorno dell'autolettura del contatore (facoltativo)</div>
                  <input type="number" min="1" max="31" value={ricForm.letturaGiorno||""} onChange={e=>setRicForm(p=>({...p,letturaGiorno:e.target.value}))} placeholder="es. 10"
                    style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
                  <div style={{ fontSize:10, color:"var(--c-text-faintest)", marginTop:4 }}>
                    Se il fornitore vuole l'autolettura entro una certa data (E.ON: dal giorno 8 al 14), ti mando un promemoria a parte da spuntare. Non è un pagamento, quindi non crea nessun movimento.
                  </div>
                </div>
              )}
              {parseInt(ricForm.giorno,10)>28 && (
                <div style={{ fontSize:10, color:"var(--c-text-faintest)", marginTop:-6 }}>
                  Nei mesi più corti l'addebito slitta all'ultimo giorno disponibile (a febbraio il 28).
                </div>
              )}
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Data {isFin?"prima rata":"primo addebito"} *</div>
                <input type="date" value={ricForm.dataInizio||""} onChange={e=>setRicForm(p=>({...p,dataInizio:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
                <div style={{ fontSize:10, color:"var(--c-text-faintest)", marginTop:4 }}>
                  I saldi cambiano solo da {getMonthLabel(getCurrentMonth())} in poi, mai sui mesi passati.
                </div>
              </div>

              {/* Arretrati: scelta esplicita, default NO. Registrarli su un
                  finanziamento vecchio crea mesi che nell'app non sono mai
                  esistiti (saldi a zero, dentro solo la rata) e falsa cash flow
                  e confronto anno-su-anno. Il conteggio rate e il debito
                  residuo si calcolano dalle date, quindi non serve. */}
              {!isSpesa && ricModal.mode==="add" && anteprima?.storiche>0 && (
                <div style={{ border:`1px solid ${ricForm.registraArretrati?"#F59E0B60":"var(--c-border)"}`, borderRadius:8, padding:"10px 12px", background:ricForm.registraArretrati?"#F59E0B0D":"transparent" }}>
                  <label style={{ display:"flex", alignItems:"flex-start", gap:8, cursor:"pointer" }}>
                    <input type="checkbox" checked={!!ricForm.registraArretrati} onChange={e=>setRicForm(p=>({...p,registraArretrati:e.target.checked}))} style={{ marginTop:2 }}/>
                    <span>
                      <span style={{ fontSize:11, color:"var(--c-text-dim)", fontWeight:600 }}>Registra anche i {anteprima.storiche} addebiti arretrati</span>
                      <span style={{ display:"block", fontSize:10, color:"var(--c-text-faintest)", marginTop:3 }}>
                        {ricForm.registraArretrati
                          ? `Verranno creati ${anteprima.storiche} movimenti nei mesi passati, creando anche i mesi che nell'app non esistono ancora (con saldi a zero). Utile solo se vuoi lo storico completo delle spese.`
                          : "Lasciato spento: si parte dal mese corrente. Rate pagate e debito residuo restano comunque esatti, perché si calcolano dalle date del piano."}
                      </span>
                    </span>
                  </label>
                </div>
              )}
              {isFin && (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <div>
                    <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Numero rate totali</div>
                    <input type="number" min="1" disabled={periodiPuliti.length>0}
                      value={periodiPuliti.length ? periodiPuliti.reduce((s,p)=>s+p.rate,0) : (ricForm.rateTotali||"")}
                      onChange={e=>setRicForm(p=>({...p,rateTotali:e.target.value}))} placeholder="60"
                      title={periodiPuliti.length ? "Calcolato dagli scaglioni qui sotto" : ""}
                      style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:periodiPuliti.length?"var(--c-text-faint)":"var(--c-text)", fontSize:13, outline:"none" }}/>
                  </div>
                  <div>
                    <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Importo finanziato {ccy}</div>
                    <input type="number" step="0.01" value={ricForm.importoFinanziato||""} onChange={e=>setRicForm(p=>({...p,importoFinanziato:e.target.value}))} placeholder="18375,76"
                      style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
                  </div>
                  <div>
                    <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>TAEG % (facoltativo)</div>
                    <input type="number" step="0.01" value={ricForm.taeg||""} onChange={e=>setRicForm(p=>({...p,taeg:e.target.value}))} placeholder="7,5"
                      style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
                  </div>
                </div>
              )}
              {isFin && (
                <div style={{ fontSize:10, color:"var(--c-text-faintest)", marginTop:-6 }}>
                  "Importo finanziato" = il capitale che ti ha prestato la banca (quello sul contratto), non la somma delle rate: la differenza sono gli interessi.
                </div>
              )}

              {/* Piano a scaglioni: rate che cambiano importo a metà piano.
                  Molti finanziamenti auto sono così (es. 48 rate + 36 più
                  leggere): con una rata sola il debito residuo verrebbe
                  sovrastimato di migliaia di euro. */}
              {isFin && (
                <div style={{ border:"1px solid var(--c-border)", borderRadius:8, padding:"10px 12px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div style={{ fontSize:11, color:"var(--c-text-dim)", fontWeight:600 }}>📐 Piano a scaglioni (facoltativo)</div>
                    <button onClick={addPeriodo} style={{ padding:"3px 9px", borderRadius:6, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-dim)", cursor:"pointer", fontSize:11 }}>+ periodo</button>
                  </div>
                  <div style={{ fontSize:10, color:"var(--c-text-faintest)", marginTop:4 }}>
                    Usalo se la rata cambia durante il piano. Es. Compass: 48 rate da 317,52 poi 36 da 238,74. Se lo compili, "Numero rate totali" viene calcolato da qui.
                  </div>
                  {periodiForm.map((p,i)=>(
                    <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:8, alignItems:"center", marginTop:8 }}>
                      <input type="number" min="1" value={p.rate||""} onChange={e=>updPeriodo(i,"rate",e.target.value)} placeholder={i===0?"48 rate":"36 rate"}
                        style={{ width:"100%", padding:"7px 9px", borderRadius:6, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:12, outline:"none" }}/>
                      <input type="number" step="0.01" value={p.importo||""} onChange={e=>updPeriodo(i,"importo",e.target.value)} placeholder={`rata ${ccy}`}
                        style={{ width:"100%", padding:"7px 9px", borderRadius:6, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:12, outline:"none" }}/>
                      <button onClick={()=>delPeriodo(i)} style={{ width:26, height:26, borderRadius:6, border:"1px solid #EF444440", background:"transparent", color:"#EF4444", cursor:"pointer", fontSize:12 }}>×</button>
                    </div>
                  ))}
                  {periodiPuliti.length>0 && (
                    <div style={{ fontSize:10, color:"var(--c-text-faint)", marginTop:8 }}>
                      Totale: <b style={{ color:"var(--c-text)" }}>{periodiPuliti.reduce((s,p)=>s+p.rate,0)} rate</b> · {periodiPuliti.map(p=>`${p.rate}×${fmt(p.importo)}`).join(" + ")}
                    </div>
                  )}
                </div>
              )}

              {/* Maxirata: opzione per chiudere il finanziamento a metà piano
                  pagando il capitale residuo in un colpo solo. Ha una finestra
                  di richiesta che scade: senza promemoria si perde. */}
              {isFin && (
                <div style={{ border:"1px solid var(--c-border)", borderRadius:8, padding:"10px 12px" }}>
                  <div style={{ fontSize:11, color:"var(--c-text-dim)", fontWeight:600 }}>🎯 Opzione maxirata (facoltativo)</div>
                  <div style={{ fontSize:10, color:"var(--c-text-faintest)", marginTop:4, marginBottom:8 }}>
                    Se il contratto permette di chiudere in anticipo con una maxirata: ti avviso quando la finestra si avvicina.
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    <div>
                      <div style={{ fontSize:10, color:"var(--c-text-faint)", marginBottom:3 }}>Importo {ccy}</div>
                      <input type="number" step="0.01" value={ricForm.maxirataImporto||""} onChange={e=>setRicForm(p=>({...p,maxirataImporto:e.target.value}))} placeholder="7238,37"
                        style={{ width:"100%", padding:"7px 9px", borderRadius:6, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:12, outline:"none" }}/>
                    </div>
                    <div>
                      <div style={{ fontSize:10, color:"var(--c-text-faint)", marginBottom:3 }}>Da richiedere entro</div>
                      <input type="date" value={ricForm.maxirataEntro||""} onChange={e=>setRicForm(p=>({...p,maxirataEntro:e.target.value}))}
                        style={{ width:"100%", padding:"7px 9px", borderRadius:6, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:12, outline:"none" }}/>
                    </div>
                  </div>
                  <div style={{ marginTop:8 }}>
                    <div style={{ fontSize:10, color:"var(--c-text-faint)", marginBottom:3 }}>Alla rata numero</div>
                    <input type="number" min="1" value={ricForm.maxirataAllaRata||""} onChange={e=>setRicForm(p=>({...p,maxirataAllaRata:e.target.value}))} placeholder="48"
                      style={{ width:"100%", padding:"7px 9px", borderRadius:6, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:12, outline:"none" }}/>
                  </div>
                </div>
              )}
              {isFin && (
                <div style={{ fontSize:10, color:"var(--c-text-faintest)", marginTop:-6 }}>
                  Senza il numero di rate non si può calcolare il debito residuo: l'addebito funziona lo stesso, ma resta a tempo indeterminato.
                </div>
              )}
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Categoria dell'uscita</div>
                <select value={ricForm.categoria||""} onChange={e=>setRicForm(p=>({...p,categoria:e.target.value,sottocategoria:""}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}>
                  {[...new Set([...CAT_USCITE_FISSE, ricForm.categoria].filter(Boolean))].map(c=><option key={c} value={c}>{c}</option>)}
                </select>
                {/* Sottocategoria sulla ricorrenza: così ogni bolletta finisce
                    già taggata luce/gas/wifi quando confermi l'importo, e il
                    Recap può separarle senza che tu debba ricordartene. */}
                {SOTTOCATEGORIE[ricForm.categoria] && (
                  <div style={{ marginTop:8 }}>
                    <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:6 }}>Sottocategoria {ricForm.categoria==="Utenze"?"💡":"🚗"}</div>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                      {SOTTOCATEGORIE[ricForm.categoria].map(sc=>(
                        <button key={sc} onClick={()=>setRicForm(p=>({...p,sottocategoria:p.sottocategoria===sc?"":sc}))}
                          style={{ padding:"4px 10px", borderRadius:6, border:`1px solid ${ricForm.sottocategoria===sc?"#F97316":"var(--c-border)"}`, background:ricForm.sottocategoria===sc?"#F9731620":"transparent", color:ricForm.sottocategoria===sc?"#F97316":"var(--c-text-faint)", cursor:"pointer", fontSize:11 }}>
                          {sc}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {isSpesa && (
                <div style={{ background:"var(--c-bg)", border:"1px solid var(--c-border)", borderRadius:8, padding:"8px 10px", fontSize:12, color:"var(--c-text-dim)" }}>
                  Ogni {ricForm.giorno||"—"} del mese ti comparirà il promemoria in cima a Finanze, con il tasto <b style={{ color:"var(--c-text)" }}>Registra</b>: form già compilato, ti resta da scrivere l'importo. Nessun movimento nasce senza la tua conferma.
                </div>
              )}
              {!isSpesa && anteprima && (
                <div style={{ background:"var(--c-bg)", border:"1px solid var(--c-border)", borderRadius:8, padding:"8px 10px", fontSize:12, color:"var(--c-text-dim)" }}>
                  {(ricModal.mode==="add" && !ricForm.registraArretrati && anteprima.storiche>0)
                    ? <>Rate già maturate: <b style={{ color:"var(--c-text)" }}>{anteprima.passate}</b> — gli arretrati non verranno registrati fra le uscite (vedi sotto), si parte da {getMonthLabel(getCurrentMonth())}.</>
                    : <>Verranno registrati subito <b style={{ color:"var(--c-text)" }}>{anteprima.passate}</b> addebiti già maturati
                        {anteprima.storiche>0 && <>, di cui <b style={{ color:"var(--c-text)" }}>{anteprima.storiche}</b> come storico senza toccare i saldi</>}</>}
                  {anteprima.ultima && <> · ultima rata <b style={{ color:"var(--c-text)" }}>{anteprima.ultima.data}</b></>}
                  {anteprima.totaleRate>0 && (
                    <div style={{ marginTop:6 }}>
                      Somma di tutte le rate: <b style={{ color:"var(--c-text)" }}>{fmt(anteprima.totaleRate)}{ccy}</b>
                      {anteprima.capitale>0
                        ? <> = capitale <b style={{ color:"var(--c-text)" }}>{fmt(anteprima.capitale)}{ccy}</b> + interessi e spese <b style={{ color:"#EF4444" }}>{fmt(anteprima.interessi)}{ccy}</b></>
                        : <span style={{ color:"var(--c-text-faintest)" }}> — non è il capitale finanziato: compila "Importo finanziato" per vedere quanto sono gli interessi.</span>}
                      {isFin && anteprima.residuoOggi>0 && (
                        <div style={{ marginTop:4 }}>Ti resterebbero da versare <b style={{ color:"#EF4444" }}>{fmt(anteprima.residuoOggi)}{ccy}</b> da oggi in poi.</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={closeRicModal} style={{ flex:1, padding:10, borderRadius:8, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-faint)", cursor:"pointer", fontSize:13 }}>Annulla</button>
              <button onClick={saveRicorrenza} style={{ flex:2, padding:10, borderRadius:8, border:"none", background:isFin?"#EF4444":isSpesa?"#06B6D4":"#3B82F6", color:"#fff", cursor:"pointer", fontSize:13, fontWeight:700 }}>Salva</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Modal Estinzione anticipata */}
      {estingueId && (()=>{
        const r = ricorrenze.find(x=>x.id===estingueId);
        if (!r) return null;
        const residuo = debitoResiduo(r, oggiStr);
        const ccy = contoCurrency(r.conto)==="RON" ? " RON" : "€";
        return (
        <div style={{ position:"fixed", inset:0, background:"#00000090", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={()=>setEstingueId(null)}>
          <div style={{ background:"var(--c-panel)", border:"1px solid var(--c-border)", borderRadius:16, padding:24, width:"100%", maxWidth:400 }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:700, color:"var(--c-text-strong)", marginBottom:6 }}>💸 Estingui "{r.nome}"</div>
            <div style={{ fontSize:11, color:"var(--c-text-faint)", marginBottom:20 }}>
              Da questa data non verranno più generate rate. Debito residuo a oggi: <b style={{ color:"#EF4444" }}>{fmt(residuo)}{ccy}</b>.
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Data estinzione *</div>
                <input type="date" value={estingueForm.data||""} onChange={e=>setEstingueForm(p=>({...p,data:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
              </div>
              <div>
                <div style={{ fontSize:11, color:"var(--c-text-dim)", marginBottom:4 }}>Importo pagato per chiudere {contoCurrency(r.conto)}</div>
                <input type="number" step="0.01" value={estingueForm.importoEstinzione||""} onChange={e=>setEstingueForm(p=>({...p,importoEstinzione:e.target.value}))} placeholder={fmt(residuo)}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid var(--c-border)", background:"var(--c-bg)", color:"var(--c-text)", fontSize:13, outline:"none" }}/>
                <div style={{ fontSize:10, color:"var(--c-text-faintest)", marginTop:4 }}>
                  Se lo indichi, viene registrata un'uscita di quell'importo che scala il conto. Lascia vuoto se il finanziamento si chiude senza conguaglio.
                </div>
              </div>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={()=>setEstingueId(null)} style={{ flex:1, padding:10, borderRadius:8, border:"1px solid var(--c-border)", background:"transparent", color:"var(--c-text-faint)", cursor:"pointer", fontSize:13 }}>Annulla</button>
              <button onClick={confermaEstinzione} style={{ flex:2, padding:10, borderRadius:8, border:"none", background:"#10B981", color:"#fff", cursor:"pointer", fontSize:13, fontWeight:700 }}>Conferma estinzione</button>
            </div>
          </div>
        </div>
        );
      })()}

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
