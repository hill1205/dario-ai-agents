"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  MESI_BREVI, MESI_LUNGHI, GIORNI_SETT, THEME_VARS,
  genId, sortByDataDesc, groupByDayDesc, formatDayLabel,
  pad2, ymdStr, fmtShortDate, daysGrid,
  DateRangePicker, VistaToggle, fmt, round2,
  getMonthLabel, getCurrentMonth, lastMonths, localISODate,
  CashFlowMiniChart, CategoryBars, costoCambio,
  SOTTOCAT_TRASPORTI, SOTTOCAT_AUTO, propagaSaldiAiMesiSuccessivi,
} from "../lib/finance-ui";
import {
  applicaRicorrenze, occorrenze, prossimaScadenza, debitoResiduo, totaleRate,
  ratePagate, rateTotaliDi, pianoRate, maxirataInfo, importoCerto,
  storicoRicorrenza, mediaStorico, daConfermare,
} from "../lib/ricorrenze";
import { useUndoStack, UndoButton } from "../lib/undo";
import PianoTasse from "./PianoTasse";

const CAT_ENTRATE = ["Retainer","One-time","Consulenza","Bonus","Conversione","Altro"];
const CAT_USCITE  = ["Keez / Commercialista","Software & Tools","Marketing","Hosting","Personale IAGREX","Tasse & Contributi","Trasporti","Finanziamenti","Abbonamenti","Conversione","Altro"];

// Sottocategorie IAGREX (blocco 6). Su Bruno servono a separare "quanto costa
// l'auto" da "quanto costano i taxi"; qui rispondono alla domanda equivalente
// lato azienda: dentro "Software & Tools" cosa è AI e cosa è pubblicità, dentro
// "Tasse & Contributi" cosa è imposta e cosa è dividendo. Senza questo, una
// categoria da 2.000€/mese resta una scatola nera che non si può tagliare.
const SOTTOCAT_IAGREX = {
  "Software & Tools":       ["AI / LLM","Hosting & Dominio","Design","Automazioni","Ads manager"],
  "Marketing":              ["Meta Ads","Google Ads","Contenuti","Eventi & Fiere","Lead generation"],
  "Personale IAGREX":       ["Stipendi","Collaboratori","Formazione","Rimborsi"],
  "Tasse & Contributi":     ["Imposta sul reddito","Contributi","Dividendi","Sanzioni e interessi"],
  "Keez / Commercialista":  ["Contabilità mensile","Bilancio annuale","Consulenza extra"],
  "Trasporti":              SOTTOCAT_TRASPORTI,
};
const ICONA_SOTTOCAT_IAGREX = {
  "Software & Tools":"🧰", "Marketing":"📣", "Personale IAGREX":"👥",
  "Tasse & Contributi":"🧾", "Keez / Commercialista":"📚", "Trasporti":"🚗",
};
const EUR_RON_FALLBACK = 5; // usato solo se il fetch del cambio live fallisce
const OBIETTIVO_ANNUO = 1000000;

const CONTI_IAGREX = [
  { id: "unicredit_eur", label: "UniCredit Romania — EUR", currency: "€" },
  { id: "unicredit_ron", label: "UniCredit Romania — RON", currency: "RON" },
];
const CONTI_IAGREX_BY_ID = Object.fromEntries(CONTI_IAGREX.map(c=>[c.id,c]));

const EMPTY_MONTH = { entrate: [], uscite: [], saldi: { unicredit_eur: 0, unicredit_ron: 0 } };


function getCurrentYear() { return new Date().getFullYear().toString(); }


export default function IAGREXPage({ fontSize=14, onBack, theme="dark", isMobile: isMobileProp }) {
  const fs = fontSize;
  const themeVars = THEME_VARS[theme] || THEME_VARS.dark;
  // isMobile può arrivare da page.jsx; se non arriva (component usato
  // altrove) lo calcoliamo qui come fallback — stesso pattern di BrunoPage.
  const [isMobileLocal, setIsMobileLocal] = useState(false);
  useEffect(()=>{
    if (isMobileProp !== undefined) return;
    const check = ()=>setIsMobileLocal(window.innerWidth<640);
    check();
    window.addEventListener("resize",check);
    return ()=>window.removeEventListener("resize",check);
  },[isMobileProp]);
  const isMobile = isMobileProp !== undefined ? isMobileProp : isMobileLocal;
  const [allData, setAllData]     = useState({});
  const [month, setMonth]         = useState(getCurrentMonth());
  const [tab, setTab]             = useState("entrate");
  const [filtroConto, setFiltroConto] = useState("");
  // Filtro conto delle Entrate, separato da quello delle Uscite.
  const [filtroContoEntrate, setFiltroContoEntrate] = useState("");
  const [filtroDataDa, setFiltroDataDa] = useState("");
  const [filtroDataA, setFiltroDataA]   = useState("");
  // Vista lista entrate/uscite: "categoria" raggruppa per categoria,
  // "recenti" mostra tutto in un'unica lista ordinata per data decrescente.
  const [vistaEntrate, setVistaEntrate] = useState("recenti");
  const [vistaUscite, setVistaUscite]   = useState("recenti");
  const [loading, setLoading]     = useState(true);
  const [saveStatus, setSaveStatus] = useState(null);
  const [modal, setModal]         = useState(null);
  const [form, setForm]           = useState({});
  const [convModal, setConvModal] = useState(false);

  // Check estratto conto IAGREX: confronto manuale a fine mese tra saldo
  // salvato in app e saldo reale sull'estratto conto (stessa idea di BrunoPage).
  const [checkModal, setCheckModal] = useState(null);
  const [checkForm, setCheckForm]   = useState({});
  const [convForm, setConvForm]   = useState({});
  // Rate e abbonamenti (blocco 3) e budget per categoria (blocco 4): stesse
  // strutture di BrunoPage, storage nello stesso Doc ClickUp di IAGREX.
  const [ricModal, setRicModal]   = useState(null);
  const [ricForm, setRicForm]     = useState({});
  const [estingueId, setEstingueId] = useState(null);
  const [estingueForm, setEstingueForm] = useState({});
  const [budgetModal, setBudgetModal] = useState(false);
  const [budgetForm, setBudgetForm]   = useState({});
  const [autoInfo, setAutoInfo]   = useState(null);
  // MRR vero: somma dei budget mensili dei clienti attivi (database Notion
  // Clienti, lo stesso che alimenta la pagina Clienti). Prima qui c'era
  // totEntrate ribattezzato "MRR stimato": era lo stesso numero di "Entrate
  // mese", quindi non diceva niente di nuovo.
  const [mrrClienti, setMrrClienti] = useState(null);
  const tabsRef       = useRef(null);
  const chipAttivoRef = useRef(null);
  // Riporta in vista il chip attivo quando la scheda cambia. Serve soprattutto
  // su mobile: se apri "Rate e abbonamenti" dalla card in cima, quel chip è in
  // mezzo alla riga e resterebbe fuori schermo, dando l'impressione che
  // nessuna scheda sia selezionata. Scrolliamo il contenitore a mano invece di
  // usare scrollIntoView, che trascinerebbe anche la pagina in verticale.
  useEffect(() => {
    const box = tabsRef.current, chip = chipAttivoRef.current;
    if (!box || !chip) return;
    const sx = chip.offsetLeft - box.offsetWidth / 2 + chip.offsetWidth / 2;
    box.scrollTo({ left: Math.max(0, sx), behavior: "smooth" });
  }, [tab]);
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

  useEffect(()=>{ loadData(); loadRate(); loadMrr(); },[]);

  // MRR = contratti ricorrenti attivi, non incassi del mese. Se il fetch
  // fallisce resta null e la card mostra "—": meglio nessun numero che un
  // numero sbagliato su cui poi ragioni per l'obiettivo 1M€.
  const loadMrr = async () => {
    try {
      const res = await fetch("/api/clients-data", { cache:"no-store" });
      const j = await res.json();
      if (!res.ok || !Array.isArray(j.clients)) return;
      const attivi = j.clients.filter(c=>c.fase==="attivo");
      setMrrClienti({
        valore: attivi.reduce((s,c)=>s+(parseFloat(c.budget)||0),0),
        n: attivi.length,
      });
    } catch {}
  };

  // Ponte dalla Pipeline: se arrivi qui dal tasto "💰 Registra fatturazione
  // IAGREX" su un cliente, un draft con nome/budget già compilati ti aspetta
  // in localStorage — lo consumiamo una sola volta aprendo subito la modale
  // "Nuova entrata" pre-riempita, invece di farti ridigitare da zero dati
  // già presenti in pipeline. Chiave condivisa con PipelinePage.jsx.
  useEffect(()=>{
    try {
      const raw = localStorage.getItem("dario-iagrex-draft-entrata");
      if (!raw) return;
      localStorage.removeItem("dario-iagrex-draft-entrata");
      const draft = JSON.parse(raw);
      setForm({
        descrizione: draft.descrizione||"",
        importo: draft.importo||"",
        categoria: draft.categoria || CAT_ENTRATE[0],
        cliente: draft.cliente||"",
        conto: CONTI_IAGREX[0].id,
        data: draft.data || localISODate(),
      });
      setModal({ tipo:"entrata", mode:"add" });
      setTab("entrate");
    } catch {}
  },[]);

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

  // Riporto automatico dei saldi: se il mese selezionato non ha ancora
  // dati propri, i saldi di partenza sono quelli di chiusura del mese
  // precedente più recente con dati (invece di ripartire sempre da zero).
  // Prima di questo fix, aprire un mese nuovo e iniziare subito a
  // registrare entrate/uscite senza riscrivere a mano il saldo reale
  // portava esattamente allo sfasamento di saldo riscontrato a luglio
  // 2026 (i saldi correnti restano comunque sempre modificabili a mano
  // dalla tab Saldi, per correggere eventuali imprecisioni).
  const getCarriedSaldi = (allData, month) => {
    let [y, m] = month.split("-").map(Number);
    for (let i = 0; i < 24; i++) {
      m -= 1;
      if (m === 0) { m = 12; y -= 1; }
      const ym = `${y}-${String(m).padStart(2, "0")}`;
      if (allData[ym]?.saldi) return allData[ym].saldi;
    }
    return EMPTY_MONTH.saldi;
  };

  const monthData = allData[month] || { ...EMPTY_MONTH, saldi: getCarriedSaldi(allData, month) };

  // Saldi IAGREX più recenti in assoluto (non del mese che stai guardando):
  // servono al Piano Tasse, che deve partire dai soldi che ci sono davvero
  // oggi anche se stai sfogliando un mese passato.
  const saldiIagrexCorrenti = (() => {
    const mesi = Object.keys(allData).filter(k=>/^\d{4}-\d{2}$/.test(k)).sort();
    const ultimo = mesi[mesi.length-1];
    return ultimo ? (allData[ultimo].saldi || {}) : {};
  })();

  // Cronologia Annulla (vedi app/lib/undo.js): stato precedente messo da parte
  // prima di ogni salvataggio.
  const { snapshot, undo, voci: undoVoci } = useUndoStack("iagrex");
  const allDataRef = useRef(allData);
  useEffect(()=>{ allDataRef.current = allData; },[allData]);

  const saveData = useCallback(async (newAllData, opts={}) => {
    if (!loadOk) {
      // Non abbiamo mai confermato di aver letto lo storico reale:
      // rifiutiamo il salvataggio per non rischiare di sovrascrivere
      // mesi precedenti con dati incompleti.
      setSaveStatus("blocked");
      setTimeout(()=>setSaveStatus(null),3500);
      return;
    }
    if (!opts.skipSnapshot) snapshot(allDataRef.current, opts.etichetta || "Modifica IAGREX");
    // Una correzione su un mese passato deve riflettersi sui saldi dei mesi
    // successivi, altrimenti restano fotografati al valore vecchio.
    // L'annullamento passa skipPropagazione: ripristina uno stato già completo.
    const datiFinali = opts.skipPropagazione ? newAllData : propagaSaldiAiMesiSuccessivi(allDataRef.current, newAllData);
    setAllData(datiFinali);
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/iagrex-finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: datiFinali }),
      });
      setSaveStatus(res.ok?"saved":"error");
    } catch { setSaveStatus("error"); }
    setTimeout(()=>setSaveStatus(null),2500);
  },[loadOk, snapshot]);

  const handleUndo = () => {
    const voce = undo();
    if (!voce) return;
    saveData(voce.stato, { skipSnapshot:true, skipPropagazione:true });
  };

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

  // Quando la lista e' filtrata su un conto in RON, accanto al totale in €
  // (che dipende dal cambio) serve la somma in RON: e' quella che deve
  // combaciare con il saldo nell'app della banca. Stringa vuota altrimenti.
  const suffissoRon = (items, contoId) => {
    if (!contoId || CONTI_IAGREX_BY_ID[contoId]?.currency !== "RON") return "";
    const tot = items.filter(isReal).reduce((s,e)=>s+(parseFloat(e.importo)||0),0);
    return ` · ${fmt(tot)} RON`;
  };

  // YTD progress — converte anche le entrate storiche in RON prima di
  // sommarle, altrimenti il progresso verso 1.000.000€ mischierebbe RON e EUR.
  const year = getCurrentYear();
  const ytdRevenue = Object.entries(allData)
    // Solo chiavi in formato YYYY-MM: allData contiene anche chiavi non-mese
    // (checkSaldi, flaggedMovimenti) che non sono dati mensili.
    .filter(([k])=>/^\d{4}-\d{2}$/.test(k) && k.startsWith(year))
    .reduce((s,[,v])=>s+(v.entrate||[]).filter(isReal).reduce((ss,e)=>ss+toEur(e),0),0);
  const ytdPct = Math.min(Math.round((ytdRevenue/OBIETTIVO_ANNUO)*100*10)/10, 100);
  const mesiRimanenti = 13 - (new Date().getMonth()+1); // dicembre incluso = 1
  const ritmoMensileNecessario = Math.round(Math.max(OBIETTIVO_ANNUO-ytdRevenue,0)/mesiRimanenti);

  const totEntrate = monthData.entrate.filter(isReal).reduce((s,e)=>s+toEur(e),0);
  const totUscite  = monthData.uscite.filter(isReal).reduce((s,e)=>s+toEur(e),0);
  const saldoNetto = totEntrate - totUscite;

  // Confronto anno su anno: stesso mese dell'anno precedente, per capire se
  // il trend sta davvero accelerando o è solo l'effetto stagionale del
  // mese. Mostrato solo se esiste storico per quel mese (altrimenti "vs
  // 0€" sarebbe fuorviante, non un vero confronto).
  const [annoSel, meseSel] = month.split("-").map(Number);
  const mesePrecAnno = `${annoSel-1}-${String(meseSel).padStart(2,"0")}`;
  const datiAnnoScorso = allData[mesePrecAnno];
  const entrateAnnoScorso = datiAnnoScorso ? (datiAnnoScorso.entrate||[]).filter(isReal).reduce((s,e)=>s+toEur(e),0) : null;
  const yoyDeltaPct = (entrateAnnoScorso!=null && entrateAnnoScorso>0) ? Math.round(((totEntrate-entrateAnnoScorso)/entrateAnnoScorso)*100) : null;

  // Alert ritmo mensile: confronta quanto fatturato finora nel mese CORRENTE
  // con quanto ci si aspetterebbe di aver fatturato a questo punto del mese,
  // proporzionalmente al ritmo necessario per arrivare a 1.000.000€ entro
  // dicembre. Mostrato solo quando si sta guardando il mese in corso (non ha
  // senso su mesi passati o futuri, già chiusi o non ancora iniziati) — così
  // il numero passivo di "ritmo necessario" diventa un avviso attivo invece
  // di richiedere un calcolo mentale ogni volta.
  const isCurrentMonthView = month === getCurrentMonth();
  const oggi = new Date();
  const giornoOggi = oggi.getDate();
  const giorniNelMese = new Date(oggi.getFullYear(), oggi.getMonth()+1, 0).getDate();
  const attesoAOggi = ritmoMensileNecessario * (giornoOggi/giorniNelMese);
  const scostamentoPct = attesoAOggi>0 ? Math.round(((totEntrate-attesoAOggi)/attesoAOggi)*100) : 0;
  const ritmoStatus = !isCurrentMonthView ? null : (totEntrate < attesoAOggi*0.9 ? "sotto" : totEntrate > attesoAOggi*1.1 ? "sopra" : "linea");
  // Recap "dove vanno i soldi": aggregato per categoria del mese selezionato.
  const usciteByCat  = monthData.uscite.filter(isReal).reduce((acc,e)=>{ acc[e.categoria]=(acc[e.categoria]||0)+toEur(e); return acc; },{});
  const entrateByCat = monthData.entrate.filter(isReal).reduce((acc,e)=>{ acc[e.categoria]=(acc[e.categoria]||0)+toEur(e); return acc; },{});
  // Dettaglio Trasporti per sottocategoria (in EUR), come su BrunoPage:
  // le voci auto sommate a parte, Bolt/Uber fuori dal totale auto.
  const trasportiBySub = monthData.uscite.filter(e=>isReal(e)&&e.categoria==="Trasporti").reduce((acc,e)=>{
    const k = e.sottocategoria || "Senza sottocategoria";
    acc[k]=(acc[k]||0)+toEur(e); return acc;
  },{});
  const totAuto = SOTTOCAT_AUTO.reduce((s,k)=>s+(trasportiBySub[k]||0),0);
  // Dettaglio per sottocategoria di TUTTE le categorie che ne hanno una
  // (blocco 6). Senza questo, "Software & Tools 1.800€" resta una scatola
  // chiusa: il dettaglio è la differenza fra sapere quanto spendi e sapere
  // cosa puoi tagliare.
  const sottoByCat = {};
  for (const e of monthData.uscite) {
    if (!isReal(e) || !e.sottocategoria || !SOTTOCAT_IAGREX[e.categoria]) continue;
    sottoByCat[e.categoria] = sottoByCat[e.categoria] || {};
    sottoByCat[e.categoria][e.sottocategoria] = (sottoByCat[e.categoria][e.sottocategoria]||0) + toEur(e);
  }
  // Totale commissioni bancarie del mese: per IAGREX arrivano dalle
  // conversioni UniCredit (tasso banca vs tasso BCE, vedi saveConversione).
  // Le conversioni sono escluse dalle uscite vere (isReal), ma la loro
  // commissione implicita è un costo reale: qui si somma su TUTTE le uscite.
  const toEurVal = (val, contoId) => { const v = parseFloat(val)||0; return contoCurrency(contoId)==="RON" ? v/rate : v; };
  const totCommissioniMese = monthData.uscite.reduce((s,e)=>s+toEurVal(e.commissioni,e.conto),0);

  // ====================================================================
  // BLOCCO 4 — Budget per categoria
  // Le soglie stanno in allData.budgetCategorie (chiave non-mese: tutte le
  // funzioni che iterano i mesi filtrano già con /^\d{4}-\d{2}$/).
  // ====================================================================
  const budgetCategorie = allData.budgetCategorie || {};
  const budgetEntries = Object.entries(budgetCategorie).filter(([,v])=>parseFloat(v)>0);
  const budgetSforati = budgetEntries.filter(([cat,bud])=>(usciteByCat[cat]||0) > parseFloat(bud));
  const openBudgetModal = () => { setBudgetForm({...budgetCategorie}); setBudgetModal(true); };
  const saveBudget = () => {
    const cleaned = {};
    Object.entries(budgetForm).forEach(([k,v])=>{ const n=parseFloat(v); if (n>0) cleaned[k]=round2(n); });
    saveData({ ...allData, budgetCategorie: cleaned }, { etichetta:"Budget categorie IAGREX" });
    setBudgetModal(false);
  };
  const budgetCatList = [...new Set([...CAT_USCITE, ...Object.keys(usciteByCat), ...Object.keys(budgetCategorie)])]
    .filter(c=>c!=="Conversione");

  // ====================================================================
  // BLOCCO 3 — Rate, abbonamenti e spese fisse
  // Motore condiviso con BrunoPage (lib/ricorrenze.js): funzioni pure, già
  // testate. Qui c'è solo il collegamento all'interfaccia e allo storage.
  // ====================================================================
  const ricorrenze = allData.ricorrenze || [];
  const oggiStr = localISODate();
  const finanziamenti = ricorrenze.filter(r=>r.tipo==="finanziamento");
  const abbonamenti   = ricorrenze.filter(r=>r.tipo==="abbonamento");
  const speseFisse    = ricorrenze.filter(r=>r.tipo==="spesa");

  // Importo atteso di una spesa a cifra variabile, nelle due valute che
  // servono: quella del conto (per l'alert saldo) e l'euro (per budget e
  // proiezione). `importoValuta` dice in quale delle due è scritto.
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
    const media = mediaStorico(storico);
    return { eur: toEurVal(media, r.conto), nativo: media, valuta: ccyConto, stimato: true };
  };

  const statsRicorrenza = (r) => {
    const storico = storicoRicorrenza(allData, r.id);
    const media   = mediaStorico(storico);
    const ultimo  = storico.at(-1) || null;
    const penultimo = storico.length>1 ? storico.at(-2) : null;
    const deltaPct = (ultimo && penultimo && penultimo.importo>0)
      ? Math.round(((ultimo.importo - penultimo.importo)/penultimo.importo)*100) : null;
    const isRon    = contoCurrency(r.conto)==="RON";
    return { storico, media, mediaEur: toEurVal(media, r.conto), ultimo,
      ultimoEur: ultimo ? toEurVal(ultimo.importo, r.conto) : null, penultimo, deltaPct, isRon };
  };

  // Scadenze passate delle spese a cifra variabile senza un movimento
  // corrispondente: la lista "quanto hai pagato al commercialista?".
  const promemoriaSpese = speseFisse.flatMap(r=>{
    const storico = storicoRicorrenza(allData, r.id);
    const registrate = new Set(storico.map(s=>s.ym));
    return daConfermare(r, oggiStr, registrate, { saltati: allData.ricorrenzeSaltate||[] })
      .map(occ=>({ r, occ, atteso: attesoInfo(r, storico) }));
  });

  // Apre il form uscita già compilato: resta da scrivere solo l'importo.
  const openRegistraSpesa = (r, occ) => {
    setForm({
      descrizione: r.nome,
      importo: "",
      categoria: r.categoria || "Altro",
      sottocategoria: r.sottocategoria || "",
      conto: r.conto,
      data: occ.data,
      ricorrenzaId: r.id,
    });
    setModal({ tipo:"uscita", mode:"add" });
  };
  const saltaPromemoria = (r, occ) => {
    const id = `ric-${r.id}-${occ.ym}`;
    saveData({ ...allData, ricorrenzeSaltate: [...new Set([...(allData.ricorrenzeSaltate||[]), id])] }, { etichetta:"Salta promemoria spesa" });
  };

  // Debito residuo in EUR: le rate sono nella valuta del conto che le paga.
  const debitoTotale = finanziamenti.reduce((s,r)=>s+toEurVal(debitoResiduo(r, oggiStr), r.conto), 0);
  const impegnoMensileEur = ricorrenze.reduce((s,r)=>{
    if (r.attiva===false || r.chiusa) return s;
    const p = prossimaScadenza(r, oggiStr);
    if (!p) return s;
    if (!importoCerto(r)) return s + attesoInfo(r, storicoRicorrenza(allData, r.id)).eur;
    return s + toEurVal(p.importo || r.importo, r.conto);
  }, 0);
  const totAbbMeseEur = abbonamenti.filter(r=>r.attiva!==false&&!r.chiusa)
    .reduce((s,r)=>s+toEurVal(r.importo,r.conto),0);
  const maxirateInScadenza = finanziamenti
    .map(r=>({ r, info: maxirataInfo(r, oggiStr) }))
    .filter(x=>x.info && !x.info.scaduta);

  // ====================================================================
  // BLOCCO 5 — Patrimonio netto aziendale
  // Liquidità sui conti (convertita in €) meno il debito ancora da pagare.
  // ====================================================================
  const liquiditaEur = Object.entries(monthData.saldi||{})
    .reduce((s,[id,v])=>s+toEurVal(v, id), 0);
  const patrimonioNetto = liquiditaEur - debitoTotale;

  // Addebiti di questo mese non ancora scattati: senza, il 2 del mese la
  // proiezione ignorerebbe la rata del 20.
  const ricorrenzeResiduaMese = isCurrentMonthView
    ? ricorrenze.filter(r=>r.attiva!==false && !r.chiusa).reduce((s,r)=>{
        const p = prossimaScadenza(r, oggiStr);
        if (!p || p.ym!==month) return s;
        return s + (importoCerto(r)
          ? toEurVal(p.importo || r.importo, r.conto)
          : attesoInfo(r, storicoRicorrenza(allData, r.id)).eur);
      },0)
    : 0;

  // Proiezione uscite a fine mese: run-rate dei giorni già passati più gli
  // addebiti ricorrenti non ancora scattati. Dal giorno 3 in poi, perché su
  // uno o due giorni il run-rate è rumore.
  const proiezioneUscite = (isCurrentMonthView && giornoOggi >= 3 && totUscite > 0)
    ? (totUscite/giornoOggi)*giorniNelMese
    : null;

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

  const openAdd = (tipo) => { setForm({descrizione:"",importo:"",categoria:tipo==="entrata"?CAT_ENTRATE[0]:CAT_USCITE[0],cliente:"",conto:CONTI_IAGREX[0].id,data:localISODate()}); setModal({tipo,mode:"add"}); };
  const openEdit = (tipo,item) => { setForm({...item}); setModal({tipo,mode:"edit",item}); };
  const closeModal = () => { setModal(null); setForm({}); };

  const saveItem = () => {
    if (!form.descrizione?.trim()||!form.importo) return;
    const item = {...form,importo:parseFloat(form.importo),id:modal.mode==="add"?genId():form.id};
    // La sottocategoria vale solo dentro le categorie che ne hanno una lista
    // (SOTTOCAT_IAGREX): se la categoria è un'altra, o il valore non appartiene
    // a quella lista, si butta invece di restare appiccicato al movimento.
    if (!SOTTOCAT_IAGREX[item.categoria]?.includes(item.sottocategoria)) delete item.sottocategoria;
    const isUscita = modal.tipo==="uscita";
    const chiave = isUscita ? "uscite" : "entrate";
    // Un'uscita scala il conto, un'entrata lo accredita.
    const segno = isUscita ? -1 : 1;
    const applicaSaldo = (md, contoId, delta) => {
      if (!contoId || md.saldi[contoId] === undefined) return;
      md.saldi[contoId] = round2((parseFloat(md.saldi[contoId])||0) + delta);
    };
    // Il movimento va archiviato nel mese della sua DATA, non in quello che
    // si sta guardando: altrimenti una spesa datata 1 agosto inserita mentre
    // si e' su luglio resta nei totali di luglio (stessa logica di BrunoPage).
    const meseTarget = (item.data && /^\d{4}-\d{2}/.test(item.data)) ? item.data.slice(0,7) : month;

    let updated = {...monthData, saldi:{...monthData.saldi}};
    if (modal.mode==="edit" && modal.item?.conto) {
      applicaSaldo(updated, modal.item.conto, -segno * (parseFloat(modal.item.importo)||0));
    }

    if (meseTarget === month) {
      applicaSaldo(updated, item.conto, segno * parseFloat(item.importo));
      updated[chiave] = modal.mode==="add"?[...updated[chiave],item]:updated[chiave].map(e=>e.id===item.id?item:e);
      updateMonth(updated);
    } else {
      updated.uscite  = updated.uscite.filter(e=>e.id!==item.id);
      updated.entrate = updated.entrate.filter(e=>e.id!==item.id);
      const base = allData[meseTarget] || { ...EMPTY_MONTH, saldi: getCarriedSaldi(allData, meseTarget) };
      const target = { ...base, uscite:[...(base.uscite||[])], entrate:[...(base.entrate||[])], saldi:{...base.saldi} };
      target[chiave] = [...target[chiave].filter(e=>e.id!==item.id), item];
      applicaSaldo(target, item.conto, segno * parseFloat(item.importo));
      saveData({ ...allData, [month]: updated, [meseTarget]: target });
    }
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
      // I movimenti storici generati dalle ricorrenze (noSaldo) non hanno mai
      // toccato i saldi: annullarne l'effetto creerebbe un effetto dal nulla.
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
    // Un addebito generato da una ricorrenza va anche marcato come "saltato":
    // il suo id è deterministico, quindi senza questo tornerebbe alla prossima
    // apertura della pagina come se non l'avessi mai cancellato.
    if (item?.ricorrenzaId && item?.auto) {
      const saltati = [...new Set([...(allData.ricorrenzeSaltate||[]), id])];
      saveData({ ...allData, [month]: updated, ricorrenzeSaltate: saltati }, { etichetta:"Elimina addebito ricorrente" });
      return;
    }
    updateMonth(updated);
  };

  const updateSaldo = (contoId,val) => {
    updateMonth({...monthData,saldi:{...monthData.saldi,[contoId]:parseFloat(val)||0}});
  };

  // --- Generazione automatica degli addebiti ricorrenti -----------------
  // Gira una volta per sessione (autoRunRef) ed è comunque idempotente lato
  // motore: l'id del movimento è ric-<idRicorrenza>-<YYYY-MM>, quindi
  // rilanciarla non può creare doppioni. skipPropagazione perché la
  // propagazione dei saldi ai mesi successivi la fa già applicaRicorrenze.
  const autoRunRef = useRef(false);
  const generaAddebiti = useCallback((baseAll, lista) => {
    return applicaRicorrenze(baseAll, lista, localISODate(), {
      emptyMonth: EMPTY_MONTH,
      carried: (all, ym) => ({ saldi: getCarriedSaldi(all, ym) }),
      saltati: baseAll?.ricorrenzeSaltate || [],
    });
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[loadOk, generaAddebiti, saveData]);

  // --- CRUD ricorrenze ---------------------------------------------------
  const openRicAdd = (tipo) => {
    setRicForm({
      tipo, nome:"", ente:"", conto: CONTI_IAGREX[0].id, importo:"",
      sottocategoria: "",
      giorno: tipo==="finanziamento" ? 15 : new Date().getDate(),
      dataInizio: localISODate(), rateTotali: "",
      periodi: [], maxirata: null,
      // Default: NON registrare gli arretrati. Un finanziamento partito anni
      // fa creerebbe mesi che nell'app non sono mai esistiti, con saldi a zero
      // e dentro solo la rata: il cash flow e il confronto anno-su-anno li
      // leggerebbero come mesi veri.
      registraArretrati: false,
      importoFinanziato:"", taeg:"",
      categoria: tipo==="finanziamento" ? "Finanziamenti"
        : tipo==="spesa" ? "Keez / Commercialista" : "Software & Tools",
      attiva:true,
    });
    setRicModal({ mode:"add", tipo });
  };
  const openRicEdit = (r) => {
    setRicForm({ ...r, periodi: r.periodi || [],
      maxirataImporto: r.maxirata?.importo || "", maxirataEntro: r.maxirata?.entro || "", maxirataAllaRata: r.maxirata?.allaRata || "" });
    setRicModal({ mode:"edit", tipo:r.tipo });
  };
  const closeRicModal = () => { setRicModal(null); setRicForm({}); };

  // Piano a scaglioni: periodi con rata diversa. Vuoto = rata unica.
  const periodiForm = ricForm.periodi || [];
  const addPeriodo = () => setRicForm(p=>({ ...p, periodi:[...(p.periodi||[]), { rate:"", importo:"" }] }));
  const updPeriodo = (i, campo, val) => setRicForm(p=>({ ...p, periodi:(p.periodi||[]).map((x,j)=>j===i?{...x,[campo]:val}:x) }));
  const delPeriodo = (i) => setRicForm(p=>({ ...p, periodi:(p.periodi||[]).filter((_,j)=>j!==i) }));
  const periodiPuliti = periodiForm
    .map(p=>({ rate: parseInt(p.rate,10)||0, importo: round2(parseFloat(p.importo)||0) }))
    .filter(p=>p.rate>0 && p.importo>0);

  const saveRicorrenza = () => {
    if (!ricForm.nome?.trim() || !ricForm.dataInizio) return;
    if (ricForm.tipo!=="spesa" && !(parseFloat(ricForm.importo)>0) && !periodiPuliti.length) return;
    const g = parseInt(ricForm.giorno,10);
    if (!(g>=1 && g<=31)) return;
    const maxi = (parseFloat(ricForm.maxirataImporto)>0 && ricForm.maxirataEntro)
      ? { importo: round2(parseFloat(ricForm.maxirataImporto)), entro: ricForm.maxirataEntro, allaRata: parseInt(ricForm.maxirataAllaRata,10)||0 }
      : null;
    const categoria = ricForm.categoria || (ricForm.tipo==="finanziamento" ? "Finanziamenti" : ricForm.tipo==="spesa" ? "Keez / Commercialista" : "Abbonamenti");
    const r = {
      id: ricModal.mode==="add" ? genId() : ricForm.id,
      tipo: ricForm.tipo,
      nome: ricForm.nome.trim(),
      ente: (ricForm.ente||"").trim(),
      conto: ricForm.conto,
      importo: round2(parseFloat(ricForm.importo) || periodiPuliti[0]?.importo || 0),
      giorno: g,
      dataInizio: ricForm.dataInizio,
      rateTotali: periodiPuliti.length
        ? periodiPuliti.reduce((s,p)=>s+p.rate,0)
        : (parseInt(ricForm.rateTotali,10) || 0),
      periodi: periodiPuliti,
      maxirata: maxi,
      importoFinanziato: parseFloat(ricForm.importoFinanziato) || 0,
      taeg: parseFloat(ricForm.taeg) || 0,
      categoria,
      sottocategoria: SOTTOCAT_IAGREX[categoria]?.includes(ricForm.sottocategoria) ? ricForm.sottocategoria : "",
      // In quale valuta è scritto l'importo atteso di una spesa variabile.
      importoValuta: ricForm.tipo==="spesa" ? (ricForm.importoValuta || contoCurrency(ricForm.conto)) : undefined,
      attiva: ricForm.attiva !== false,
      chiusa: ricForm.chiusa || null,
      creata: ricForm.creata || new Date().toISOString(),
    };
    const lista = ricModal.mode==="add" ? [...ricorrenze, r] : ricorrenze.map(x=>x.id===r.id?r:x);
    let saltatiBase = allData.ricorrenzeSaltate || [];
    if (ricModal.mode==="add" && !ricForm.registraArretrati) {
      const meseOra = getCurrentMonth();
      const arretrati = occorrenze(r, oggiStr).filter(o=>o.ym < meseOra).map(o=>`ric-${r.id}-${o.ym}`);
      saltatiBase = [...new Set([...saltatiBase, ...arretrati])];
    }
    const { next, creati } = generaAddebiti({ ...allData, ricorrenze: lista, ricorrenzeSaltate: saltatiBase }, lista);
    if (creati.length) setAutoInfo({
      n: creati.length,
      storici: creati.filter(c=>!c.toccaSaldi).length,
      voci: creati.map(c=>`${c.item.descrizione} — ${fmt(c.item.importo)}${contoCurrency(c.item.conto)==="RON"?" RON":"€"} il ${c.item.data}`),
    });
    saveData(next, { skipPropagazione:true, etichetta: ricModal.mode==="add" ? "Nuova ricorrenza IAGREX" : "Modifica ricorrenza IAGREX" });
    closeRicModal();
  };

  const toggleRicAttiva = (r) => {
    saveData({ ...allData, ricorrenze: ricorrenze.map(x=>x.id===r.id?{...x, attiva: x.attiva===false}:x) }, { etichetta:"Pausa/riattiva ricorrenza" });
  };
  const deleteRicorrenza = (r) => {
    if (!confirm(`Eliminare "${r.nome}"? Gli addebiti già registrati restano fra le uscite (sono spese realmente avvenute): vanno cancellati a mano se non li vuoi.`)) return;
    saveData({ ...allData, ricorrenze: ricorrenze.filter(x=>x.id!==r.id) }, { etichetta:"Elimina ricorrenza" });
  };

  // Estinzione anticipata: chiude il finanziamento a una data e, se indicato
  // un conguaglio, registra l'uscita corrispondente nel mese di quella data.
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
      const base = next[ym] || { ...EMPTY_MONTH, saldi: getCarriedSaldi(next, ym) };
      const item = { id:genId(), descrizione:`${r.nome} — estinzione anticipata`, categoria:r.categoria||"Finanziamenti",
        conto:r.conto, importo:round2(imp), data:estingueForm.data, ricorrenzaId:r.id, auto:true };
      const mese = { ...base, uscite:[...(base.uscite||[]), item], entrate:[...(base.entrate||[])], saldi:{ ...(base.saldi||{}) } };
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

  // --- Check estratto conto: log storico dei confronti saldo app vs saldo reale ---
  const checkSaldi = allData.checkSaldi || [];
  function prevMonthYm() {
    const d = new Date();
    d.setMonth(d.getMonth()-1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  }
  const openCheckAdd = () => {
    setCheckForm({ mese: prevMonthYm(), conto: CONTI_IAGREX[0].id, saldoEstratto: "" });
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

  // Evidenziazioni salvate su ClickUp (chiave "flaggedMovimenti") invece che
  // solo in memoria: un reload o il cambio dispositivo le azzerava, facendo
  // perdere la riconciliazione a metà.
  const flaggedIds = new Set(allData.flaggedMovimenti || []);
  const setFlaggedPersistente = (ids) => {
    saveData({ ...allData, flaggedMovimenti: [...ids] });
  };

  const openReconcile = () => {
    setReconcileForm({ mese: prevMonthYm(), conto: CONTI_IAGREX[0].id, file: null });
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
        const candidati = appMovs.filter(a => !usedIds.has(a.id) && Math.abs(round2(Math.abs(a.importo)) - target) < 0.01);
        let best = null, bestDist = Infinity;
        for (const c of candidati) {
          const dist = (c.data && mov.data) ? Math.abs(new Date(c.data) - new Date(mov.data)) : 999*86400000;
          if (dist < bestDist && dist <= 4*86400000) { best = c; bestDist = dist; }
        }
        if (!best && candidati.length) best = candidati[0];
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

  // Filtro data (entrate/uscite): confronto su stringhe "YYYY-MM-DD",
  // ignora le voci senza data quando il filtro è attivo (stessa logica di
  // BrunoPage).
  const inDateRange = (item) => {
    if (!filtroDataDa && !filtroDataA) return true;
    if (!item.data) return false;
    if (filtroDataDa && item.data < filtroDataDa) return false;
    if (filtroDataA && item.data > filtroDataA) return false;
    return true;
  };

  // Esporta in CSV esattamente le righe filtrate visibili a schermo
  // (stesso periodo/conto), generato lato client con un Blob.
  const exportCSV = (items, tipo) => {
    const header = ["Data","Descrizione","Categoria","Sottocategoria","Cliente","Conto","Importo","Valuta"];
    const rows = items.map(e => [
      e.data || "",
      (e.descrizione||"").replace(/"/g,'""'),
      (e.categoria||"").replace(/"/g,'""'),
      (e.sottocategoria||"").replace(/"/g,'""'),
      (e.cliente||"").replace(/"/g,'""'),
      CONTI_IAGREX_BY_ID[e.conto]?.label || e.conto || "",
      e.importo,
      contoCurrency(e.conto)==="RON"?"RON":"EUR",
    ]);
    const csv = [header, ...rows].map(r => r.map(v => `"${v}"`).join(";")).join("\n");
    const blob = new Blob(["﻿"+csv], { type:"text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const periodo = (filtroDataDa||filtroDataA) ? `${filtroDataDa||"inizio"}_${filtroDataA||"fine"}` : month;
    a.href = url;
    a.download = `${tipo}_iagrex_${periodo}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
      // Tasso ufficiale BCE del giorno (fetch live già attivo): la
      // differenza col tasso applicato da UniCredit è la commissione
      // implicita del cambio, salvata sul movimento per il recap.
      tassoBce: (eurRonRate||EUR_RON_FALLBACK).toFixed(4),
      data: localISODate(),
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
    const tassoBce = parseFloat(convForm.tassoBce);
    const descrizione = `Conversione ${CONTI_IAGREX_BY_ID[convForm.da]?.label} → ${CONTI_IAGREX_BY_ID[convForm.a]?.label} (tasso banca ${tasso}${tassoBce?` · BCE ${tassoBce}`:""})`;
    const uscitaItem  = { id:genId(), descrizione, categoria:"Conversione", conto:convForm.da, importo:round2(importoDa), data:convForm.data, isConversione:true, pairId };
    // Commissione implicita del cambio (tasso banca peggiore del BCE):
    // salvata sull'uscita della coppia, nella valuta del conto di partenza.
    const cc = costoCambio(importoDa, tasso, tassoBce, contoCurrency(convForm.da));
    if (cc && cc.costo > 0) { uscitaItem.commissioni = round2(cc.costo); uscitaItem.tassoBce = tassoBce; }
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
    <div style={{...themeVars,display:"flex",flexDirection:"column",height:"100%",overflow:"auto",background:"var(--c-bg)"}}>
      {/* Le card cliccabili della testata hanno bisogno di un feedback al
          tocco, altrimenti sembrano riquadri morti come prima. La classe
          .card-link di BrunoPage vive nel suo <style>, che qui non è montato:
          serve la sua copia locale, con un nome diverso per non collidere. */}
      <style>{`
        .card-link-iagrex { transition: background .12s ease, transform .12s ease; }
        .card-link-iagrex:hover { background: var(--c-panel) !important; }
        .card-link-iagrex:active { transform: scale(.985); }
      `}</style>

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
            <UndoButton voci={undoVoci} onUndo={handleUndo} accent="#8B5CF6" compact/>
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
          {ritmoStatus && (
            <div style={{marginTop:8,padding:"8px 10px",borderRadius:8,display:"flex",alignItems:"center",gap:8,
              background: ritmoStatus==="sotto"?"#EF44441A":ritmoStatus==="sopra"?"#10B9811A":"#3B82F61A",
              border:`1px solid ${ritmoStatus==="sotto"?"#EF444450":ritmoStatus==="sopra"?"#10B98150":"#3B82F650"}`}}>
              <span style={{fontSize:16}}>{ritmoStatus==="sotto"?"⚠️":ritmoStatus==="sopra"?"🚀":"✅"}</span>
              <div style={{fontSize:fs-3,color:"var(--c-text)"}}>
                {ritmoStatus==="sotto" && <>Sei <b style={{color:"#EF4444"}}>sotto ritmo</b> questo mese: a oggi (giorno {giornoOggi}/{giorniNelMese}) ti aspetteresti {fmt(attesoAOggi)}€ fatturati, ne hai {fmt(totEntrate)}€ ({scostamentoPct}%).</>}
                {ritmoStatus==="sopra" && <>Sei <b style={{color:"#10B981"}}>sopra ritmo</b> questo mese: {fmt(totEntrate)}€ fatturati contro {fmt(attesoAOggi)}€ attesi a oggi (+{scostamentoPct}%).</>}
                {ritmoStatus==="linea" && <>Sei <b style={{color:"#3B82F6"}}>in linea</b> col ritmo necessario per il mese ({fmt(totEntrate)}€ contro {fmt(attesoAOggi)}€ attesi).</>}
              </div>
            </div>
          )}
        </div>

        <CashFlowMiniChart allData={allData} marginTop={12} toEur={toEur}/>

        {/* Sintesi del mese (blocco 1, ripreso da BrunoPage).
            Prima qui c'erano quattro riquadri muti tutti della stessa
            dimensione, uno dei quali ("MRR stimato") ripeteva le entrate del
            mese. Ora c'è UNA cifra grande — quanto è avanzato — la barra di
            dove sono finiti i soldi, e tre riquadri cliccabili che portano
            alla scheda giusta: il numero fa venire la domanda, il tocco dà la
            risposta senza passare dai chip. */}
        <div style={{marginTop:12,background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:12,padding:"14px 16px"}}>
          <div style={{fontSize:fs-4,color:"var(--c-text-faint)"}}>{saldoNetto>=0?"Avanzato questo mese":"Bruciato questo mese"}</div>
          <div style={{display:"flex",alignItems:"baseline",gap:12,flexWrap:"wrap"}}>
            <span style={{fontSize:isMobile?30:38,fontWeight:800,lineHeight:1.15,color:saldoNetto>=0?"#10B981":"#EF4444"}}>
              {saldoNetto>=0?"+":"−"}{fmt(Math.abs(saldoNetto))}€
            </span>
            <span style={{fontSize:fs-2,color:"var(--c-text-muted)"}}>
              {fmt(totEntrate)} fatturati · {fmt(totUscite)} usciti
            </span>
          </div>
          {/* Barra delle categorie: le prime tre per peso, il resto in grigio.
              Oltre le tre voci le fette diventano troppo sottili per essere
              distinguibili, e la barra smette di dire qualcosa. */}
          {totUscite>0 && (()=>{
            const voci = Object.entries(usciteByCat).sort((a,b)=>b[1]-a[1]);
            const primi = voci.slice(0,3);
            const restoVal = voci.slice(3).reduce((s,[,v])=>s+v,0);
            const colori = ["#8B5CF6","#10B981","#F97316"];
            const fette = [...primi.map(([k,v],i)=>({k,v,c:colori[i]})), ...(restoVal>0?[{k:"Altro",v:restoVal,c:"#94A3B8"}]:[])];
            return (
              <>
                <div style={{display:"flex",height:6,borderRadius:3,overflow:"hidden",margin:"12px 0 8px"}}>
                  {fette.map(f=><div key={f.k} style={{width:`${(f.v/totUscite)*100}%`,background:f.c}}/>)}
                </div>
                <div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:fs-4,color:"var(--c-text-muted)"}}>
                  {fette.map(f=>(
                    <span key={f.k}>
                      <span style={{display:"inline-block",width:8,height:8,borderRadius:2,background:f.c,marginRight:5}}/>
                      {f.k} {fmt(f.v)}
                    </span>
                  ))}
                </div>
              </>
            );
          })()}
          {/* Le tre cifre che NON si leggono dal mese corrente: quanto vale
              davvero l'azienda al netto dei debiti, quanto è già impegnato
              ogni mese, e quanto vale il ricorrente sotto contratto. */}
          <div style={{display:"grid",gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(3,1fr)",gap:8,marginTop:14}}>
            {[
              { label:"Patrimonio netto", val:`${fmt(patrimonioNetto)}€`, sub: debitoTotale>0?`liquidità ${fmt(liquiditaEur)}€ − debiti ${fmt(debitoTotale)}€`:"liquidità sui conti", vai:"saldi",
                colore: patrimonioNetto>=0?"var(--c-text-strong)":"#EF4444" },
              { label:"Rate e canoni", val:`${fmt(impegnoMensileEur)}€`, sub:"al mese, già impegnati", vai:"ricorrenti" },
              { label:"MRR sotto contratto",
                val: mrrClienti ? `${fmt(mrrClienti.valore)}€` : "—",
                sub: mrrClienti ? `${mrrClienti.n} client${mrrClienti.n===1?"e":"i"} attiv${mrrClienti.n===1?"o":"i"} · ${fmt(mrrClienti.valore*12)}€/anno` : "clienti non raggiungibili",
                vai:"entrate", colore:"#3B82F6" },
            ].map(c=>(
              <button key={c.label} onClick={()=>setTab(c.vai)} className="card-link-iagrex"
                style={{display:"block",width:"100%",textAlign:"left",border:"none",cursor:"pointer",
                  background:"var(--c-panel2)",borderRadius:12,padding:"10px 12px",minWidth:0,overflow:"hidden"}}>
                <div style={{fontSize:fs-4,color:"var(--c-text-faint)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.label}</div>
                <div style={{fontSize:fs+2,fontWeight:700,color:c.colore||"var(--c-text-strong)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.val}</div>
                {c.sub && <div style={{fontSize:fs-5,color:"var(--c-text-faintest)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.sub}</div>}
              </button>
            ))}
          </div>
        </div>

        {entrateAnnoScorso!=null && (
          <div style={{marginTop:8,fontSize:fs-4,color:"var(--c-text-faint)"}}>
            📈 vs {getMonthLabel(mesePrecAnno)}: {fmt(entrateAnnoScorso)}€ entrate
            {yoyDeltaPct!=null && <span style={{marginLeft:6,fontWeight:700,color:yoyDeltaPct>=0?"#10B981":"#EF4444"}}>{yoyDeltaPct>=0?"+":""}{yoyDeltaPct}%</span>}
          </div>
        )}

        {/* Proiezione uscite di fine mese (blocco 4). Il run-rate da solo non
            "vede" le rate non ancora scattate: senza sommarle, il 2 del mese
            la proiezione ignorerebbe la rata del 20. */}
        {proiezioneUscite!=null && (()=>{
          const proiezioneTot = proiezioneUscite + ricorrenzeResiduaMese;
          const sopra = proiezioneTot>totEntrate && totEntrate>0;
          return (
            <div style={{marginTop:8,fontSize:fs-4,color:"var(--c-text-faint)"}}>
              🔮 A questo ritmo ({fmt(totUscite/giornoOggi)}€/giorno) chiudi il mese a ~<b style={{color:sopra?"#EF4444":"var(--c-text)"}}>{fmt(proiezioneTot)}€</b> di uscite
              {ricorrenzeResiduaMese>0 && <span> (di cui {fmt(ricorrenzeResiduaMese)}€ di rate e canoni non ancora addebitati)</span>}
              {sopra && <span style={{color:"#EF4444",fontWeight:700}}> — sopra il fatturato del mese ({fmt(totEntrate)}€)</span>}
            </div>
          );
        })()}

        {/* Avvisi delle spese ricorrenti: addebiti registrati in automatico,
            conti che non coprono l'addebito in arrivo, spese a cifra variabile
            da confermare. */}
        {autoInfo && (
          <div style={{marginTop:8,padding:"8px 10px",borderRadius:8,border:"1px solid #10B98140",background:"#10B9810D",color:"#10B981",fontSize:fs-4}}>
            ✅ Registrat{autoInfo.n===1?"o":"i"} {autoInfo.n} addebit{autoInfo.n===1?"o":"i"} ricorrent{autoInfo.n===1?"e":"i"}
            {autoInfo.storici>0 && <span style={{color:"var(--c-text-faint)"}}> ({autoInfo.storici} come storico, senza toccare i saldi dei mesi già chiusi)</span>}
            <div style={{color:"var(--c-text-faint)",marginTop:2}}>{autoInfo.voci.join(" · ")}</div>
          </div>
        )}
        {alertSaldi.map(a=>(
          <div key={a.conto} style={{marginTop:8,padding:"8px 10px",borderRadius:8,border:"1px solid #EF444440",background:"#EF44440D",color:"#EF4444",fontSize:fs-4}}>
            ⚠️ <b>{CONTI_IAGREX_BY_ID[a.conto]?.label||a.conto}</b>: nei prossimi 7 giorni sono attesi {fmt(a.totale)}{contoCurrency(a.conto)==="RON"?" RON":"€"} di addebiti ma il saldo è {fmt(a.saldo)}{contoCurrency(a.conto)==="RON"?" RON":"€"}.
            <div style={{color:"var(--c-text-faint)",marginTop:2}}>{a.voci.join(" · ")}</div>
          </div>
        ))}
        {promemoriaSpese.length>0 && (
          <div style={{marginTop:8,padding:"8px 10px",borderRadius:8,border:"1px solid #06B6D440",background:"#06B6D40D",fontSize:fs-4,color:"#06B6D4"}}>
            🧾 {promemoriaSpese.length} spes{promemoriaSpese.length===1?"a":"e"} a cifra variabile da confermare:
            {promemoriaSpese.map(({r,occ,atteso})=>(
              <div key={`${r.id}-${occ.ym}`} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginTop:4}}>
                <span style={{color:"var(--c-text)"}}>{r.nome} — scaduta il {occ.data.slice(8)}/{occ.data.slice(5,7)}{atteso.eur>0?` · attesi ~${fmt(atteso.nativo)}${atteso.valuta==="RON"?" RON":"€"}`:""}</span>
                <button onClick={()=>openRegistraSpesa(r,occ)} style={{padding:"3px 10px",borderRadius:6,border:"none",background:"#06B6D4",color:"#fff",cursor:"pointer",fontSize:11,fontWeight:600}}>Registra</button>
                <button onClick={()=>saltaPromemoria(r,occ)} style={{padding:"3px 10px",borderRadius:6,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:11}}>Non pagata</button>
              </div>
            ))}
          </div>
        )}
        {budgetSforati.length>0 && (
          <div style={{marginTop:8,padding:"8px 10px",borderRadius:8,border:"1px solid #F59E0B40",background:"#F59E0B0D",color:"#F59E0B",fontSize:fs-4}}>
            🎯 Budget sforato su {budgetSforati.map(([c])=>c).join(", ")} — <button onClick={()=>setTab("recap")} style={{background:"none",border:"none",color:"#F59E0B",textDecoration:"underline",cursor:"pointer",fontSize:fs-4,padding:0}}>vedi il recap</button>
          </div>
        )}
      </div>

      {/* Tabs a chip su una riga sola (blocco 2, come BrunoPage): su mobile la
          riga scorre in orizzontale, su desktop ci stanno tutte in vista. Il
          chip attivo viene riportato in vista quando cambi scheda da altrove
          (es. dalle card in cima), che altrimenti resterebbe fuori schermo. */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,padding:"10px 16px",borderBottom:"1px solid var(--c-border)",flexShrink:0,background:"var(--c-bg)"}}>
        <div ref={tabsRef}
          style={{display:"flex",gap:6,alignItems:"center",overflowX:"auto",flexWrap:isMobile?"nowrap":"wrap",scrollbarWidth:"none",minWidth:0}}>
          {[["entrate","Entrate"],["uscite","Uscite"],["saldi","Conti"],["ricorrenti","Rate e abbonamenti"],["recap","Recap"],["piano","Piano Tasse"]].map(([t,label])=>(
            <button key={t} onClick={()=>setTab(t)}
              ref={tab===t ? chipAttivoRef : null}
              style={{padding:"6px 14px",borderRadius:16,border:"none",cursor:"pointer",fontSize:fs-2,whiteSpace:"nowrap",flexShrink:0,
                fontWeight:tab===t?700:400,
                background: tab===t ? "var(--c-text-strong)" : "transparent",
                color: tab===t ? "var(--c-bg)" : "var(--c-text-faint)"}}>{label}</button>
          ))}
        </div>
        <button onClick={openConversione} title="Registra un cambio di valuta tra i due conti UniCredit senza contarlo come entrata/uscita reale"
          style={{marginRight:12,padding:"6px 12px",borderRadius:7,border:"1px solid #8B5CF650",background:"#8B5CF61A",color:"#8B5CF6",cursor:"pointer",fontSize:12,fontWeight:600,whiteSpace:"nowrap"}}>
          🔄 Conversione
        </button>
      </div>

      {loading && <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--c-text-faintest)"}}>⏳ Caricamento...</div>}

      {!loading && (
        <div style={{flex:"unset",overflowY:"visible",padding:16}}>

          {tab==="entrate" && (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,gap:8,flexWrap:"wrap"}}>
                <div style={{fontSize:fs-2,color:"var(--c-text-dim)"}}>Totale: <span style={{color:"#10B981",fontWeight:700}}>+{fmt(monthData.entrate.filter(e=>isReal(e)&&(!filtroContoEntrate||e.conto===filtroContoEntrate)&&inDateRange(e)).reduce((s,e)=>s+toEur(e),0))}€{suffissoRon(monthData.entrate.filter(e=>(!filtroContoEntrate||e.conto===filtroContoEntrate)&&inDateRange(e)), filtroContoEntrate)}</span></div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <VistaToggle vista={vistaEntrate} onChange={setVistaEntrate} accent="#10B981"/>
                  <button onClick={()=>openAdd("entrata")} style={{padding:"6px 14px",borderRadius:7,border:"none",background:"#10B981",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600,whiteSpace:"nowrap"}}>+ Aggiungi</button>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:isMobile?"column":"row",alignItems:isMobile?"stretch":"center",gap:6,marginBottom:12,padding:"8px 10px",background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:8}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:11,color:"var(--c-text-faint)",whiteSpace:"nowrap"}}>🏦 Conto</span>
                  <select value={filtroContoEntrate} onChange={e=>setFiltroContoEntrate(e.target.value)} style={{flex:isMobile?1:"none",minWidth:0,padding:"6px 8px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:12}}>
                    <option value="">Tutti i conti</option>
                    {CONTI_IAGREX.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                <DateRangePicker da={filtroDataDa} a={filtroDataA} onChange={(d,a)=>{setFiltroDataDa(d);setFiltroDataA(a);}} accent="#10B981"/>
                <button onClick={()=>exportCSV(monthData.entrate.filter(e=>isReal(e)&&(!filtroContoEntrate||e.conto===filtroContoEntrate)&&inDateRange(e)),"entrate")} title="Esporta le entrate filtrate in CSV"
                  style={{flexShrink:0,padding:"6px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:11,whiteSpace:"nowrap"}}>📥 CSV</button>
              </div>
              {(() => {
                const filtered = monthData.entrate.filter(e=>(!filtroContoEntrate||e.conto===filtroContoEntrate)&&inDateRange(e));
                if (filtered.length===0) return (
                  <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10,padding:20,textAlign:"center",color:"var(--c-text-faintest)",fontSize:fs-2}}>
                    {monthData.entrate.length===0?"Nessuna entrata — aggiungi la prima":"Nessuna entrata nel periodo/conto selezionato"}
                  </div>
                );
                const Row = (e,i) => (
                  <div key={e.id} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:0,borderTop:i===0?"none":"1px solid var(--c-border)",background:flaggedIds.has(e.id)?"#F59E0B1F":(i%2===0?"var(--c-panel)":"var(--c-panel2)"),boxShadow:flaggedIds.has(e.id)?"inset 3px 0 0 #F59E0B":"none"}}>
                    <Cell style={{flexDirection:"column",alignItems:"flex-start",gap:2}}>
                      <span style={{color:"var(--c-text)",fontWeight:600}}>{flaggedIds.has(e.id)?"⚠️ ":""}{e.descrizione}</span>
                      <span style={{fontSize:fs-4,color:"var(--c-text-faint)"}}>{e.data?`${e.data} · `:""}{e.categoria}{e.cliente?` · ${e.cliente}`:""}{e.conto?` · ${CONTI_IAGREX_BY_ID[e.conto]?.label||e.conto}`:""}</span>
                    </Cell>
                    <Cell style={{color:e.isConversione?"#8B5CF6":"#10B981",fontWeight:700}}>{e.isConversione?"↔ ":"+"}{fmt(e.importo)}{contoCurrency(e.conto)==="RON"?" RON":"€"}</Cell>
                    <Cell><button onClick={()=>openEdit("entrata",e)} style={{width:24,height:24,borderRadius:5,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:10}}>✏️</button></Cell>
                    <Cell><button onClick={()=>deleteItem("entrata",e.id)} style={{width:24,height:24,borderRadius:5,border:"1px solid #2A1A1A",background:"transparent",color:"#EF4444",cursor:"pointer",fontSize:12,fontWeight:700}}>×</button></Cell>
                  </div>
                );
                if (vistaEntrate==="recenti") return groupByDayDesc(filtered).map(({key,data,items})=>(
                  <div key={key} style={{marginBottom:12}}>
                    <div style={{fontSize:fs-3,fontWeight:700,color:"var(--c-text-dim)",marginBottom:6,display:"flex",justifyContent:"space-between"}}>
                      <span>{formatDayLabel(data)}</span>
                      <span style={{color:"#10B981"}}>+{fmt(items.filter(isReal).reduce((s,e)=>s+toEur(e),0))}€{suffissoRon(items, filtroContoEntrate)}</span>
                    </div>
                    <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10,overflow:"hidden"}}>
                      {items.map(Row)}
                    </div>
                  </div>
                ));
                const grouped = filtered.reduce((acc,e)=>{ (acc[e.categoria]=acc[e.categoria]||[]).push(e); return acc; },{});
                return Object.entries(grouped).map(([cat,items])=>(
                  <div key={cat} style={{marginBottom:12}}>
                    <div style={{fontSize:fs-3,fontWeight:700,color:"var(--c-text-dim)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6,display:"flex",justifyContent:"space-between"}}>
                      <span>{cat}</span>
                      <span style={{color:"#10B981"}}>+{fmt(items.filter(isReal).reduce((s,e)=>s+toEur(e),0))}€{suffissoRon(items, filtroContoEntrate)}</span>
                    </div>
                    <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10,overflow:"hidden"}}>
                      {items.map(Row)}
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}

          {tab==="uscite" && (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,gap:8,flexWrap:"wrap"}}>
                <div style={{fontSize:fs-2,color:"var(--c-text-dim)"}}>Totale: <span style={{color:"#EF4444",fontWeight:700}}>-{fmt(monthData.uscite.filter(e=>isReal(e)&&(!filtroConto||e.conto===filtroConto)&&inDateRange(e)).reduce((s,e)=>s+toEur(e),0))}€{suffissoRon(monthData.uscite.filter(e=>(!filtroConto||e.conto===filtroConto)&&inDateRange(e)), filtroConto)}</span></div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <VistaToggle vista={vistaUscite} onChange={setVistaUscite} accent="#EF4444"/>
                  <button onClick={()=>openAdd("uscita")} style={{padding:"6px 14px",borderRadius:7,border:"none",background:"#EF4444",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600,whiteSpace:"nowrap"}}>+ Aggiungi</button>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:isMobile?"column":"row",alignItems:isMobile?"stretch":"center",gap:6,marginBottom:12,padding:"8px 10px",background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:8}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:11,color:"var(--c-text-faint)",whiteSpace:"nowrap"}}>🏦 Conto</span>
                  <select value={filtroConto} onChange={e=>setFiltroConto(e.target.value)} style={{flex:isMobile?1:"none",minWidth:0,padding:"6px 8px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:12}}>
                    <option value="">Tutti i conti</option>
                    {CONTI_IAGREX.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6,flex:1}}>
                  <DateRangePicker da={filtroDataDa} a={filtroDataA} onChange={(d,a)=>{setFiltroDataDa(d);setFiltroDataA(a);}} accent="#EF4444"/>
                  <button onClick={()=>exportCSV(monthData.uscite.filter(e=>isReal(e)&&(!filtroConto||e.conto===filtroConto)&&inDateRange(e)),"uscite")} title="Esporta le uscite filtrate in CSV"
                    style={{flexShrink:0,padding:"6px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:11,whiteSpace:"nowrap"}}>📥 CSV</button>
                </div>
              </div>
              {(() => {
                const filtered = monthData.uscite.filter(e=>(!filtroConto || e.conto===filtroConto)&&inDateRange(e));
                if (monthData.uscite.length===0) return <div style={{padding:20,textAlign:"center",color:"var(--c-text-faintest)",fontSize:fs-2,background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10}}>Nessuna uscita — aggiungi la prima</div>;
                if (filtered.length===0) return <div style={{padding:20,textAlign:"center",color:"var(--c-text-faintest)",fontSize:fs-2,background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10}}>Nessuna uscita nel periodo/conto selezionato</div>;
                const Row = (e,i) => (
                  <div key={e.id} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:0,borderTop:i===0?"none":"1px solid var(--c-border)",background:flaggedIds.has(e.id)?"#F59E0B1F":(i%2===0?"var(--c-panel)":"var(--c-panel2)"),boxShadow:flaggedIds.has(e.id)?"inset 3px 0 0 #F59E0B":"none"}}>
                    <Cell style={{flexDirection:"column",alignItems:"flex-start",gap:2}}>
                      <span style={{color:"var(--c-text)",fontWeight:600}}>{flaggedIds.has(e.id)?"⚠️ ":""}{e.descrizione}</span>
                      <span style={{fontSize:fs-4,color:"var(--c-text-faint)"}}>{e.data?`${e.data} · `:""}{e.categoria}{e.sottocategoria?<span style={{color:"#F97316"}}> › {e.sottocategoria}</span>:""}{e.conto?` · ${CONTI_IAGREX_BY_ID[e.conto]?.label||e.conto}`:""}{parseFloat(e.commissioni)>0?<span style={{color:"#06B6D4"}}> · di cui {fmt(e.commissioni)}{contoCurrency(e.conto)==="RON"?" RON":"€"} commissioni</span>:""}</span>
                    </Cell>
                    <Cell style={{color:e.isConversione?"#8B5CF6":"#EF4444",fontWeight:700}}>{e.isConversione?"↔ ":"-"}{fmt(e.importo)}{contoCurrency(e.conto)==="RON"?" RON":"€"}</Cell>
                    <Cell><button onClick={()=>openEdit("uscita",e)} style={{width:24,height:24,borderRadius:5,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:10}}>✏️</button></Cell>
                    <Cell><button onClick={()=>deleteItem("uscita",e.id)} style={{width:24,height:24,borderRadius:5,border:"1px solid #2A1A1A",background:"transparent",color:"#EF4444",cursor:"pointer",fontSize:12,fontWeight:700}}>×</button></Cell>
                  </div>
                );
                if (vistaUscite==="recenti") return groupByDayDesc(filtered).map(({key,data,items})=>(
                  <div key={key} style={{marginBottom:12}}>
                    <div style={{fontSize:fs-3,fontWeight:700,color:"var(--c-text-dim)",marginBottom:6,display:"flex",justifyContent:"space-between"}}>
                      <span>{formatDayLabel(data)}</span>
                      <span style={{color:"#EF4444"}}>-{fmt(items.filter(isReal).reduce((s,e)=>s+toEur(e),0))}€{suffissoRon(items, filtroConto)}</span>
                    </div>
                    <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10,overflow:"hidden"}}>
                      {items.map(Row)}
                    </div>
                  </div>
                ));
                const grouped = filtered.reduce((acc,e)=>{ (acc[e.categoria]=acc[e.categoria]||[]).push(e); return acc; },{});
                return Object.entries(grouped).map(([cat,items])=>(
                  <div key={cat} style={{marginBottom:12}}>
                    <div style={{fontSize:fs-3,fontWeight:700,color:"var(--c-text-dim)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6,display:"flex",justifyContent:"space-between"}}>
                      <span>{cat}</span>
                      <span style={{color:"#EF4444"}}>-{fmt(items.filter(isReal).reduce((s,e)=>s+toEur(e),0))}€{suffissoRon(items, filtroConto)}</span>
                    </div>
                    <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10,overflow:"hidden"}}>
                      {items.map(Row)}
                    </div>
                  </div>
                ));
              })()}
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
                {/* Patrimonio netto (blocco 5): la liquidità da sola dice
                    quanto c'è sul conto oggi, non quanto è davvero tuo. Se ci
                    sono finanziamenti aperti, il debito residuo va sottratto —
                    altrimenti un conto pieno il giorno prima di una maxirata
                    sembra una posizione forte e non lo è. */}
                <div style={{padding:"10px 12px",borderTop:"1px solid var(--c-border)",background:"var(--c-panel)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontSize:fs-2,fontWeight:700,color:patrimonioNetto>=0?"#10B981":"#EF4444"}}>Patrimonio netto</div>
                    <div style={{fontSize:fs-4,color:"var(--c-text-faintest)",marginTop:2}}>
                      liquidità {fmt(liquiditaEur)}€ {debitoTotale>0 ? `− debiti ancora da pagare ${fmt(debitoTotale)}€` : "· nessun finanziamento aperto"}
                    </div>
                  </div>
                  <span style={{fontSize:fs+1,fontWeight:800,color:patrimonioNetto>=0?"#10B981":"#EF4444"}}>{fmt(patrimonioNetto)}€</span>
                </div>
              </div>

              {/* Check estratto conto: confronto a fine mese saldo app vs saldo reale */}
              <div style={{marginTop:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontSize:fs-3,fontWeight:700,color:"#06B6D4",textTransform:"uppercase",letterSpacing:"0.08em"}}>📄 Check Estratto Conto</div>
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={openReconcile} title="Carica il PDF dell'estratto e confronta movimento per movimento con le entrate/uscite registrate"
                      style={{padding:"5px 12px",borderRadius:7,border:"1px solid #06B6D4",background:"transparent",color:"#06B6D4",cursor:"pointer",fontSize:11,fontWeight:600}}>🔍 Confronta movimenti</button>
                    <button onClick={openCheckAdd} style={{padding:"5px 12px",borderRadius:7,border:"none",background:"#06B6D4",color:"#fff",cursor:"pointer",fontSize:11,fontWeight:600}}>+ Nuovo check</button>
                  </div>
                </div>
                {flaggedIds.size > 0 && (
                  <div style={{fontSize:fs-4,color:"#F59E0B",marginBottom:8,background:"#F59E0B15",border:"1px solid #F59E0B40",borderRadius:8,padding:"6px 10px"}}>
                    ⚠️ {flaggedIds.size} movimento{flaggedIds.size>1?"i":""} senza riscontro sull'estratto, evidenziat{flaggedIds.size>1?"i":"o"} in arancione in Entrate/Uscite — <button onClick={()=>setFlaggedPersistente(new Set())} style={{background:"none",border:"none",color:"#F59E0B",textDecoration:"underline",cursor:"pointer",fontSize:fs-4,padding:0}}>pulisci evidenziazione</button>
                  </div>
                )}
                <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10,overflow:"hidden"}}>
                  {checkSaldi.length===0 ? (
                    <div style={{padding:16,textAlign:"center",color:"var(--c-text-faintest)",fontSize:fs-3}}>
                      Nessun check registrato. A inizio mese, manda gli estratti conto IAGREX del mese appena chiuso e confronta i saldi qui.
                    </div>
                  ) : checkSaldi.map((c,i) => {
                    const ok = Math.abs(c.differenza) < 0.01;
                    return (
                      <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",borderTop:i===0?"none":"1px solid var(--c-border)",background:i%2===0?"var(--c-panel)":"var(--c-panel2)"}}>
                        <div>
                          <div style={{fontSize:fs-2,color:"var(--c-text)",fontWeight:600}}>{CONTI_IAGREX_BY_ID[c.conto]?.label||c.conto} · {getMonthLabel(c.mese)}</div>
                          <div style={{fontSize:fs-4,color:"var(--c-text-faint)",marginTop:2}}>
                            App: {fmt(c.saldoApp)} · Estratto: {fmt(c.saldoEstratto)} {CONTI_IAGREX_BY_ID[c.conto]?.currency||"€"}
                          </div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:fs-2,fontWeight:700,color:ok?"#10B981":"#EF4444"}}>
                            {ok ? "✅ combacia" : `⚠️ ${c.differenza>0?"+":""}${fmt(c.differenza)}`}
                          </span>
                          <button onClick={()=>deleteCheck(c.id)} style={{width:22,height:22,borderRadius:5,border:"1px solid #2A1A1A",background:"transparent",color:"#EF4444",cursor:"pointer",fontSize:12,fontWeight:700}}>×</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* RATE E ABBONAMENTI (blocco 3) */}
          {tab==="ricorrenti" && (()=>{
            const ccy = (r) => contoCurrency(r.conto)==="RON" ? " RON" : "€";

            const Riga = ({ r }) => {
              const rateTot = rateTotaliDi(r);
              const pagate  = Math.min(ratePagate(r, oggiStr), rateTot||Infinity);
              const residuo = debitoResiduo(r, oggiStr);
              const prossima= prossimaScadenza(r, oggiStr);
              const scaglioni = (r.periodi||[]).length>1 ? pianoRate(r) : null;
              const maxi    = maxirataInfo(r, oggiStr);
              const rataOra = prossima?.importo || parseFloat(r.importo) || 0;
              const pausa   = r.attiva===false && !r.chiusa;
              const pct     = rateTot ? Math.round((pagate/rateTot)*100) : null;
              const colore  = r.chiusa ? "#10B981" : pausa ? "var(--c-text-faint)"
                : r.tipo==="finanziamento" ? "#EF4444" : r.tipo==="spesa" ? "#06B6D4" : "#3B82F6";
              // Pagata nel mese che stai guardando? Il legame è il movimento
              // con ricorrenzaId: la card diventa verde e si vede a colpo
              // d'occhio cosa resta da pagare senza aprire nulla.
              const pagamentoMese = storicoRicorrenza(allData, r.id).find(s=>s.ym===month);
              const st = !importoCerto(r) ? statsRicorrenza(r) : null;
              return (
                <div style={{background: pagamentoMese ? "#10B9810F" : "var(--c-panel)", border:`1px solid ${pagamentoMese ? "#10B98150" : "var(--c-border)"}`, borderRadius:10, padding:"12px 14px", opacity:(pausa||r.chiusa)?0.65:1}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:fs-1,fontWeight:700,color:"var(--c-text-strong)"}}>
                        {r.nome}
                        {pagamentoMese && <span style={{marginLeft:8,fontSize:fs-4,color:"#10B981",fontWeight:600}}>✅ pagata {pagamentoMese.data.slice(8)}/{pagamentoMese.data.slice(5,7)} · {fmt(pagamentoMese.importo)}{ccy(r)}</span>}
                        {r.chiusa && <span style={{marginLeft:8,fontSize:fs-4,color:"#10B981",fontWeight:600}}>✅ estinto {r.chiusa.data}</span>}
                        {pausa && <span style={{marginLeft:8,fontSize:fs-4,color:"var(--c-text-faint)",fontWeight:600}}>⏸ in pausa</span>}
                      </div>
                      <div style={{fontSize:fs-4,color:"var(--c-text-faint)",marginTop:3}}>
                        {r.ente ? `${r.ente} · ` : ""}{CONTI_IAGREX_BY_ID[r.conto]?.label||r.conto} · ogni {r.giorno} del mese
                        {` · ${r.categoria}`}{r.sottocategoria ? <span style={{color:"#F97316"}}> › {r.sottocategoria}</span> : ""}
                        {rateTot ? ` · ${rateTot} rate` : ""}
                        {scaglioni && <span style={{color:"#F59E0B"}}> · piano a scaglioni: {scaglioni.map(p=>`${p.rate}×${fmt(p.importo)}`).join(" poi ")}</span>}
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      {(()=>{
                        if (importoCerto(r)) return <div style={{fontSize:fs+1,fontWeight:800,color:colore}}>-{fmt(rataOra)}{ccy(r)}</div>;
                        const a = attesoInfo(r, st.storico);
                        // Senza importo atteso e senza storico non c'è nessuna
                        // cifra onesta da mostrare: "~0" sarebbe inventato.
                        if (!(a.eur > 0)) return <div style={{fontSize:fs,fontWeight:700,color:"var(--c-text-faintest)"}} title="Importo variabile: lo scrivi tu quando registri il pagamento">—</div>;
                        return (
                          <>
                            <div style={{fontSize:fs+1,fontWeight:800,color:colore}}>~{fmt(a.nativo)}{ccy(r)}</div>
                            {contoCurrency(r.conto)==="RON" && <div style={{fontSize:fs-5,color:"var(--c-text-faint)"}}>≈ {fmt(a.eur)}€{a.valuta==="€"?" (fisso in €)":""}</div>}
                          </>
                        );
                      })()}
                      {prossima && <div style={{fontSize:fs-5,color:"var(--c-text-faintest)",marginTop:2}}>prossimo: {prossima.data.slice(8)}/{prossima.data.slice(5,7)}</div>}
                    </div>
                  </div>

                  {pct!=null && (
                    <div style={{marginTop:10}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:fs-5,color:"var(--c-text-faint)",marginBottom:4}}>
                        <span>{pagate}/{rateTot} rate pagate ({pct}%)</span>
                        <span title="Somma delle rate ancora da pagare: è quanto resta da sborsare, interessi inclusi">ancora da versare <b style={{color: residuo>0?"#EF4444":"#10B981"}}>{fmt(residuo)}{ccy(r)}</b></span>
                      </div>
                      <div style={{height:6,borderRadius:4,background:"var(--c-border)",overflow:"hidden"}}>
                        <div style={{width:`${pct}%`,height:"100%",background:r.chiusa?"#10B981":"#F59E0B"}}/>
                      </div>
                      {rateTot>0 && !r.chiusa && (()=>{
                        const ultima = occorrenze({ ...r, chiusa:null }, "2099-12-31").at(-1);
                        // Costo del prestito: somma rate meno capitale
                        // ricevuto. Sono due numeri facili da confondere,
                        // quindi stanno scritti uno accanto all'altro.
                        const tot = totaleRate(r);
                        const capitale = parseFloat(r.importoFinanziato)||0;
                        return (
                          <div style={{fontSize:fs-5,color:"var(--c-text-faintest)",marginTop:4}}>
                            {ultima && <>ultima rata: {ultima.data} · </>}
                            somma rate {fmt(tot)}{ccy(r)}
                            {capitale>0 && <> · capitale {fmt(capitale)}{ccy(r)} · <span style={{color:"#EF4444"}}>interessi e spese {fmt(round2(tot-capitale))}{ccy(r)}</span></>}
                          </div>
                        );
                      })()}
                      {maxi && !maxi.scaduta && (
                        <div style={{fontSize:fs-5,color:"#F59E0B",marginTop:4}}>
                          🎯 Puoi chiudere alla rata {maxi.allaRata||"?"} con una maxirata di <b>{fmt(maxi.importo)}{ccy(r)}</b> — da richiedere entro {maxi.entro} ({maxi.giorni} giorni)
                        </div>
                      )}
                    </div>
                  )}

                  {/* Andamento delle spese a cifra variabile: importi e mesi
                      sempre scritti, non solo la forma della barra. */}
                  {st && (st.storico.length===0 ? (
                    <div style={{fontSize:fs-5,color:"var(--c-text-faintest)",marginTop:8}}>
                      Nessun pagamento registrato ancora: al prossimo {r.giorno} del mese te lo ricordo io.
                    </div>
                  ) : (()=>{
                    const ultimi = st.storico.slice(-12);
                    const max = Math.max(...ultimi.map(x=>x.importo), 1);
                    return (
                      <div style={{marginTop:10}}>
                        <div style={{fontSize:fs-5,color:"var(--c-text-faint)",marginBottom:6}}>
                          Ultimo: <b style={{color:"var(--c-text)"}}>{fmt(st.ultimo.importo)}{ccy(r)}</b>
                          {st.isRon && <b style={{color:"var(--c-text)"}}> ≈ {fmt(st.ultimoEur)}€</b>} ({getMonthLabel(st.ultimo.ym)})
                          {st.deltaPct!=null && <span style={{marginLeft:6,fontWeight:700,color: st.deltaPct<=0?"#10B981":"#EF4444"}}>{st.deltaPct>=0?"+":""}{st.deltaPct}% sul mese prima</span>}
                          <span style={{marginLeft:6,color:"var(--c-text-faintest)"}}>· media {fmt(st.media)}{ccy(r)}{st.isRon?` ≈ ${fmt(st.mediaEur)}€`:""}</span>
                        </div>
                        <div style={{display:"flex",alignItems:"flex-end",gap:4,height:56}}>
                          {ultimi.map(x=>(
                            <div key={x.ym} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2,minWidth:0}}>
                              <span style={{fontSize:fs-6,color:"var(--c-text-faint)",whiteSpace:"nowrap"}}>{fmt(x.importo)}</span>
                              <div title={`${x.data}: ${fmt(x.importo)}${ccy(r)}`}
                                style={{width:"100%",height:Math.max(4, Math.round((x.importo/max)*26)),background: x.importo>st.media?"#EF4444":"#06B6D4",borderRadius:3}}/>
                              <span style={{fontSize:fs-6,color:"var(--c-text-faintest)",whiteSpace:"nowrap"}}>{MESI_BREVI[Number(x.ym.slice(5,7))-1]}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })())}

                  <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
                    <button onClick={()=>openRicEdit(r)} style={{padding:"4px 10px",borderRadius:6,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:11}}>✏️ Modifica</button>
                    {!r.chiusa && <button onClick={()=>toggleRicAttiva(r)} style={{padding:"4px 10px",borderRadius:6,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:11}}>{pausa?"▶️ Riattiva":"⏸ Pausa"}</button>}
                    {r.tipo==="finanziamento" && !r.chiusa && <button onClick={()=>openEstingue(r)} style={{padding:"4px 10px",borderRadius:6,border:"1px solid #10B98150",background:"#10B9811A",color:"#10B981",cursor:"pointer",fontSize:11,fontWeight:600}}>💸 Estingui</button>}
                    <button onClick={()=>deleteRicorrenza(r)} style={{padding:"4px 10px",borderRadius:6,border:"1px solid #EF444440",background:"transparent",color:"#EF4444",cursor:"pointer",fontSize:11}}>🗑 Elimina</button>
                  </div>
                </div>
              );
            };

            const Sezione = ({ titolo, colore, tipo, lista, vuoto }) => (
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontSize:fs-3,fontWeight:700,color:colore,textTransform:"uppercase",letterSpacing:"0.08em"}}>{titolo}</div>
                  <button onClick={()=>openRicAdd(tipo)} style={{padding:"5px 12px",borderRadius:7,border:"none",background:colore,color:"#fff",cursor:"pointer",fontSize:11,fontWeight:600}}>+ Aggiungi</button>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {lista.length===0
                    ? <div style={{padding:16,textAlign:"center",color:"var(--c-text-faintest)",fontSize:fs-3,background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10}}>{vuoto}</div>
                    : lista.map(r=><Riga key={r.id} r={r}/>)}
                </div>
              </div>
            );

            return (
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                <div style={{fontSize:fs-4,color:"var(--c-text-faintest)",background:"var(--c-panel2)",border:"1px solid var(--c-border)",borderRadius:8,padding:"8px 10px"}}>
                  ℹ️ Ogni volta che apri Finanze IAGREX, gli addebiti già scaduti vengono registrati fra le Uscite. <b>I saldi dei conti cambiano solo dal mese corrente in poi</b>: le rate dei mesi passati entrano come storico ma non toccano i saldi, che avevi già scritto a mano dalla banca e che quindi le contengono già. Non possono generarsi doppioni.
                </div>

                <div style={{display:"grid",gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(4,1fr)",gap:8}}>
                  {[
                    { label:"Debito residuo", val:debitoTotale, color:"#EF4444" },
                    { label:"Impegno mensile", val:impegnoMensileEur, color:"#F59E0B" },
                    { label:"Abbonamenti/mese", val:totAbbMeseEur, color:"#3B82F6" },
                    { label:"Patrimonio netto", val:patrimonioNetto, color:patrimonioNetto>=0?"#10B981":"#EF4444" },
                  ].map(c=>(
                    <div key={c.label} style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10,padding:"10px 12px",minWidth:0}}>
                      <div style={{fontSize:fs-4,color:"var(--c-text-faint)",marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.label}</div>
                      <div style={{fontSize:isMobile?fs:fs+2,fontWeight:800,color:c.color,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fmt(c.val)}€</div>
                    </div>
                  ))}
                </div>
                {totAbbMeseEur>0 && (
                  <div style={{fontSize:fs-4,color:"var(--c-text-faint)",marginTop:-8}}>
                    📅 Gli abbonamenti costano a IAGREX <b style={{color:"#3B82F6"}}>{fmt(totAbbMeseEur*12)}€ all&apos;anno</b>
                    {totEntrate>0 && <span> — il {Math.round((totAbbMeseEur/totEntrate)*100)}% del fatturato di questo mese.</span>}
                  </div>
                )}
                {maxirateInScadenza.length>0 && (
                  <div style={{fontSize:fs-4,color:"#F59E0B",background:"#F59E0B0D",border:"1px solid #F59E0B40",borderRadius:8,padding:"8px 10px"}}>
                    🎯 {maxirateInScadenza.length} finestra{maxirateInScadenza.length>1?"e":""} di maxirata ancora aperta: {maxirateInScadenza.map(({r,info})=>`${r.nome} entro ${info.entro} (${info.giorni}g)`).join(" · ")}
                  </div>
                )}

                <Sezione titolo="🏦 Finanziamenti & debiti" colore="#EF4444" tipo="finanziamento" lista={finanziamenti}
                  vuoto="Nessun finanziamento aziendale. Qui vanno leasing, prestiti e rateizzazioni: rata, giorno di addebito e numero di rate." />
                <Sezione titolo="🧾 Spese fisse (importo variabile)" colore="#06B6D4" tipo="spesa" lista={speseFisse}
                  vuoto="Commercialista, contributi, utenze dell'ufficio: quelle che paghi ogni mese ma con una cifra diversa. Non le registro da solo — te le ricordo alla scadenza e tu scrivi quanto hai pagato." />
                <Sezione titolo="🔁 Abbonamenti & software" colore="#3B82F6" tipo="abbonamento" lista={abbonamenti}
                  vuoto="Nessun abbonamento. Aggiungi qui i tool ricorrenti (AI, hosting, ads manager, CRM): te li segna da solo ogni mese." />
              </div>
            );
          })()}

          {/* RECAP: dove vanno i soldi, mese per mese */}
          {tab==="recap" && (
            <div>
              <div style={{fontSize:fs-1,fontWeight:700,color:"var(--c-text-strong)",marginBottom:16}}>
                📊 Recap {getMonthLabel(month)}
              </div>

              {/* Budget mensile per categoria (blocco 4): barre spesa/soglia
                  con alert di sforamento. La spesa è quella del mese che stai
                  guardando, già in EUR. */}
              <div style={{marginBottom:24}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{fontSize:fs-3,fontWeight:700,color:"#F59E0B",textTransform:"uppercase",letterSpacing:"0.08em"}}>
                    🎯 Budget mensile{budgetSforati.length>0 && <span style={{color:"#EF4444"}}> — {budgetSforati.length} sforat{budgetSforati.length===1?"o":"i"}</span>}
                  </div>
                  <button onClick={openBudgetModal} style={{padding:"4px 10px",borderRadius:6,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:11}}>
                    {budgetEntries.length>0?"✏️ Modifica":"➕ Imposta budget"}
                  </button>
                </div>
                {budgetEntries.length===0 && (
                  <div style={{fontSize:fs-2,color:"var(--c-text-faintest)",padding:"4px 0 8px"}}>
                    Nessun budget impostato — definisci una soglia mensile per le categorie che vuoi tenere d&apos;occhio (Software &amp; Tools e Marketing sono quelle che crescono senza che te ne accorga).
                  </div>
                )}
                {budgetEntries.sort((a,b)=>((usciteByCat[b[0]]||0)/b[1])-((usciteByCat[a[0]]||0)/a[1])).map(([cat,bud])=>{
                  const spesa = usciteByCat[cat]||0;
                  const pct = (spesa/bud)*100;
                  const color = pct>100 ? "#EF4444" : pct>80 ? "#F59E0B" : "#10B981";
                  return (
                    <div key={cat} style={{marginBottom:10}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:fs-2,marginBottom:4}}>
                        <span style={{color:"var(--c-text)"}}>{pct>100?"⚠️ ":""}{cat}</span>
                        <span style={{color,fontWeight:600}}>
                          {fmt(spesa)}€ / {fmt(bud)}€ · {Math.round(pct)}%{pct>100 && ` · sforato di ${fmt(spesa-bud)}€`}
                        </span>
                      </div>
                      <div style={{height:8,background:"var(--c-border)",borderRadius:4,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${Math.min(pct,100)}%`,background:color,borderRadius:4}}/>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{marginBottom:24}}>
                <div style={{fontSize:fs-3,fontWeight:700,color:"#EF4444",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>
                  🔴 Uscite per categoria — totale {fmt(totUscite)}€
                </div>
                {/* Commissioni implicite dei cambi UniCredit (tasso banca vs
                    BCE): non sommate alle uscite, ma mostrate come costo
                    reale del mese in cambi valuta. */}
                {totCommissioniMese>0 ? (
                  <div style={{fontSize:fs-3,color:"var(--c-text-dim)",marginBottom:10}}>
                    ↳ di cui <b style={{color:"#06B6D4"}}>{fmt(totCommissioniMese)}€</b> · 🏦 commissioni bancarie sui cambi
                  </div>
                ) : <div style={{marginBottom:10}}/>}
                <CategoryBars data={usciteByCat} total={totUscite} color="#EF4444" fs={fs} fmt={fmt}/>
                {/* Dettaglio per sottocategoria, una scheda per categoria che
                    ne ha una. Trasporti tiene la riga in più "auto vs Bolt",
                    perché lì la domanda è specifica. */}
                {Object.entries(sottoByCat).sort((a,b)=>{
                  const tot = (o)=>Object.values(o).reduce((s,v)=>s+v,0);
                  return tot(b[1])-tot(a[1]);
                }).map(([cat,voci])=>{
                  const totCat = Object.values(voci).reduce((s,v)=>s+v,0);
                  return (
                    <div key={cat} style={{marginTop:14,padding:"10px 12px",background:"var(--c-bg)",border:"1px solid var(--c-border)",borderRadius:8}}>
                      <div style={{fontSize:fs-3,fontWeight:700,color:"var(--c-text-dim)",marginBottom:8}}>
                        {ICONA_SOTTOCAT_IAGREX[cat]||"·"} Dettaglio {cat} — totale: {fmt(totCat)}€
                        {cat==="Trasporti" && totAuto>0 && <span> · auto: <span style={{color:"#F97316"}}>{fmt(totAuto)}€</span></span>}
                      </div>
                      {Object.entries(voci).sort((a,b)=>b[1]-a[1]).map(([sc,val])=>(
                        <div key={sc} style={{display:"flex",justifyContent:"space-between",fontSize:fs-3,marginBottom:4}}>
                          <span style={{color:"var(--c-text)"}}>{SOTTOCAT_AUTO.includes(sc)?"🚗 ":sc==="Bolt/Uber"?"🚕 ":"· "}{sc}</span>
                          <span style={{color:"var(--c-text-dim)",fontWeight:600}}>{fmt(val)}€ <span style={{color:"var(--c-text-faintest)",fontWeight:400}}>({Math.round((val/totCat)*100)}%)</span></span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              <div>
                <div style={{fontSize:fs-3,fontWeight:700,color:"#10B981",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>
                  💚 Entrate per categoria — totale {fmt(totEntrate)}€
                </div>
                <CategoryBars data={entrateByCat} total={totEntrate} color="#10B981" fs={fs} fmt={fmt}/>
              </div>
            </div>
          )}

          {/* PIANO TASSE: proiezione di cassa su un debito rateizzato.
              Vive qui (e non in Finanze personali) perché la copertura delle
              rate dipende dai dividendi che IAGREX può distribuire, e perché
              lo stesso strumento serve anche per le tasse rumene. */}
          {tab==="piano" && (
            <PianoTasse
              allData={allData}
              saveData={saveData}
              fs={fs}
              isMobile={isMobile}
              eurRonRate={rate}
              saldiIagrexCorrenti={saldiIagrexCorrenti}
            />
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
                {/* Sottocategoria: per tutte le categorie che ne hanno una
                    (blocco 6), non più solo Trasporti. */}
                {modal.tipo==="uscita" && SOTTOCAT_IAGREX[form.categoria] && (
                  <div style={{marginTop:8}}>
                    <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:6}}>Sottocategoria {ICONA_SOTTOCAT_IAGREX[form.categoria]||""}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {SOTTOCAT_IAGREX[form.categoria].map(sc=>(
                        <button key={sc} onClick={()=>setForm(p=>({...p,sottocategoria:p.sottocategoria===sc?"":sc}))}
                          style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${form.sottocategoria===sc?"#F97316":"var(--c-border)"}`,background:form.sottocategoria===sc?"#F9731620":"transparent",color:form.sottocategoria===sc?"#F97316":"var(--c-text-faint)",cursor:"pointer",fontSize:11}}>
                          {sc}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
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
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Data</div>
                <input type="date" value={form.data||""} onChange={e=>setForm(p=>({...p,data:e.target.value}))}
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
                  Tasso applicato dalla banca (1 EUR = ? RON) *
                </div>
                <input type="number" step="0.0001" value={convForm.tasso||""} onChange={e=>setConvForm(p=>({...p,tasso:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
                <div style={{fontSize:10,color:"var(--c-text-faintest)",marginTop:4}}>Il tasso che vedi scritto sull'home banking UniCredit per questo cambio.</div>
              </div>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>
                  Tasso reale BCE del giorno (1 EUR = ? RON)
                </div>
                <input type="number" step="0.0001" value={convForm.tassoBce||""} onChange={e=>setConvForm(p=>({...p,tassoBce:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
                <div style={{fontSize:10,color:"var(--c-text-faintest)",marginTop:4}}>Precompilato col cambio {rateIsLive?"live BCE di oggi":"fisso di riserva (BCE non raggiungibile)"}. La differenza col tasso banca è la commissione implicita, contata nel recap commissioni.</div>
              </div>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Data</div>
                <input type="date" value={convForm.data||""} onChange={e=>setConvForm(p=>({...p,data:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
              </div>
              <div style={{background:"#8B5CF615",border:"1px solid #8B5CF640",borderRadius:8,padding:"10px 12px",fontSize:12,color:"var(--c-text)"}}>
                Accrediterai su <b>{CONTI_IAGREX_BY_ID[convForm.a]?.label}</b>: <b style={{color:"#8B5CF6"}}>{fmt(calcImportoA(convForm))} {contoCurrency(convForm.a)}</b>
                {(()=>{
                  const cc = costoCambio(convForm.importoDa, convForm.tasso, convForm.tassoBce, contoCurrency(convForm.da));
                  if (!cc || Math.abs(cc.costo) < 0.005) return null;
                  return cc.costo > 0 ? (
                    <div style={{marginTop:6,color:"#06B6D4"}}>
                      🏦 Commissione implicita vs BCE: <b>{fmt(cc.costo)} {contoCurrency(convForm.da)}</b> ({cc.pct.toFixed(2)}%)
                    </div>
                  ) : (
                    <div style={{marginTop:6,color:"#10B981"}}>
                      ✅ Tasso banca migliore del BCE ({Math.abs(cc.pct).toFixed(2)}%) — nessuna commissione da contare.
                    </div>
                  );
                })()}
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button onClick={closeConv} style={{flex:1,padding:10,borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:13}}>Annulla</button>
              <button onClick={saveConversione} style={{flex:2,padding:10,borderRadius:8,border:"none",background:"#8B5CF6",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Registra conversione</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Budget categorie */}
      {budgetModal && (
        <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setBudgetModal(false)}>
          <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:16,padding:24,width:"100%",maxWidth:400,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:15,fontWeight:700,color:"var(--c-text-strong)",marginBottom:6}}>🎯 Budget mensile per categoria</div>
            <div style={{fontSize:11,color:"var(--c-text-faint)",marginBottom:20}}>
              Soglia di spesa mensile in €. Lascia vuota una categoria per non tenerla d&apos;occhio. La soglia vale per tutti i mesi, non solo per quello che stai guardando.
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {budgetCatList.map(cat=>(
                <div key={cat} style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{flex:1,fontSize:12,color:"var(--c-text-dim)"}}>{cat}</span>
                  <input type="number" min="0" placeholder="—" value={budgetForm[cat]??""}
                    onChange={e=>setBudgetForm(p=>({...p,[cat]:e.target.value}))}
                    style={{width:100,padding:"6px 8px",borderRadius:6,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:12,outline:"none",textAlign:"right"}}/>
                  <span style={{fontSize:11,color:"var(--c-text-faintest)"}}>€</span>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button onClick={()=>setBudgetModal(false)} style={{flex:1,padding:10,borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:13}}>Annulla</button>
              <button onClick={saveBudget} style={{flex:2,padding:10,borderRadius:8,border:"none",background:"#F59E0B",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Salva budget</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ricorrenza (finanziamento / spesa fissa / abbonamento) */}
      {ricModal && (()=>{
        const isFin = ricForm.tipo==="finanziamento";
        const isSpesa = ricForm.tipo==="spesa";
        const ccy = contoCurrency(ricForm.conto);
        // Anteprima: si costruisce una ricorrenza "finta" con i valori del
        // form e la si passa alle stesse funzioni usate a regime, così
        // l'anteprima non può divergere da quello che succede davvero.
        const anteprima = (ricForm.dataInizio && ricForm.giorno && (parseFloat(ricForm.importo)>0 || periodiPuliti.length))
          ? (()=>{
              const finto = { ...ricForm, periodi: periodiPuliti,
                rateTotali: periodiPuliti.length ? periodiPuliti.reduce((s,p)=>s+p.rate,0) : (parseInt(ricForm.rateTotali,10)||0),
                importo: parseFloat(ricForm.importo) || periodiPuliti[0]?.importo || 0, chiusa:null };
              const passate = occorrenze(finto, oggiStr);
              const rateTot = rateTotaliDi(finto);
              const ultima = rateTot ? occorrenze(finto, "2099-12-31").at(-1) : null;
              const meseOra = getCurrentMonth();
              const storiche = passate.filter(o=>o.ym < meseOra).length;
              const tot = totaleRate(finto);
              const capitale = parseFloat(ricForm.importoFinanziato)||0;
              return { passate: passate.length, storiche, ultima, totaleRate: tot, capitale,
                residuoOggi: debitoResiduo({ ...finto, tipo:"finanziamento" }, oggiStr),
                interessi: (capitale>0 && tot>0) ? round2(tot-capitale) : 0 };
            })()
          : null;
        return (
        <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={closeRicModal}>
          <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:16,padding:24,width:"100%",maxWidth:420,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:15,fontWeight:700,color:"var(--c-text-strong)",marginBottom:6}}>
              {ricModal.mode==="add" ? (isSpesa?"Nuova":"Nuovo") : "Modifica"} {isFin ? "finanziamento 🏦" : isSpesa ? "spesa fissa 🧾" : "abbonamento 🔁"}
            </div>
            <div style={{fontSize:11,color:"var(--c-text-faint)",marginBottom:20}}>
              {isSpesa
                ? "L'importo cambia ogni mese, quindi non la registro da solo: alla scadenza te la ricordo con il form già pronto e tu scrivi solo la cifra pagata."
                : "L'addebito verrà registrato da solo fra le Uscite ogni mese, nel giorno indicato, scalando il conto scelto."}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Nome *</div>
                <input type="text" value={ricForm.nome||""} onChange={e=>setRicForm(p=>({...p,nome:e.target.value}))}
                  placeholder={isFin?"es. Leasing attrezzatura":isSpesa?"es. Commercialista Keez, contributi":"es. Claude, Meta Business, hosting"}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
              </div>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>{isFin?"Ente erogante":"Fornitore"}</div>
                <input type="text" value={ricForm.ente||""} onChange={e=>setRicForm(p=>({...p,ente:e.target.value}))}
                  placeholder={isFin?"es. UniCredit Leasing":isSpesa?"es. Keez, ANAF":"es. Anthropic"}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
              </div>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Addebitato su 🏦</div>
                <select value={ricForm.conto||""} onChange={e=>setRicForm(p=>({...p,conto:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}>
                  {CONTI_IAGREX.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>{isFin?"Rata":isSpesa?"Importo atteso":"Canone"} {ccy} {isSpesa?"":"*"}</div>
                  <input type="number" step="0.01" value={ricForm.importo||""} onChange={e=>setRicForm(p=>({...p,importo:e.target.value}))} placeholder={isSpesa?"350":"99"}
                    style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Giorno del mese *</div>
                  <input type="number" min="1" max="31" value={ricForm.giorno||""} onChange={e=>setRicForm(p=>({...p,giorno:e.target.value}))}
                    style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
                </div>
              </div>
              {/* Valuta dell'importo atteso: su un conto in RON i due casi sono
                  opposti — il software si paga in euro anche se addebitato sul
                  conto RON, il commercialista è fisso in RON. Senza questa
                  scelta uno dei due verrebbe convertito al contrario. */}
              {isSpesa && contoCurrency(ricForm.conto)==="RON" && (
                <div>
                  <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:6}}>L&apos;importo atteso qui sopra è in...</div>
                  <div style={{display:"flex",gap:6}}>
                    {[["RON","RON — es. commercialista, contributi"],["€","€ — es. tool fatturato in euro"]].map(([v,label])=>{
                      const sel = (ricForm.importoValuta || "RON") === v;
                      return (
                        <button key={v} onClick={()=>setRicForm(p=>({...p,importoValuta:v}))}
                          style={{flex:1,padding:"6px 10px",borderRadius:6,border:`1px solid ${sel?"#06B6D4":"var(--c-border)"}`,background:sel?"#06B6D420":"transparent",color:sel?"#06B6D4":"var(--c-text-faint)",cursor:"pointer",fontSize:10,textAlign:"left"}}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {parseFloat(ricForm.importo)>0 && (
                    <div style={{fontSize:10,color:"var(--c-text-faintest)",marginTop:6}}>
                      {(ricForm.importoValuta||"RON")==="€"
                        ? <>Al cambio di oggi sono circa <b style={{color:"var(--c-text)"}}>{fmt(parseFloat(ricForm.importo)*rate)} RON</b>.</>
                        : <>Al cambio di oggi sono circa <b style={{color:"var(--c-text)"}}>{fmt(parseFloat(ricForm.importo)/rate)}€</b>.</>}
                    </div>
                  )}
                </div>
              )}
              {isSpesa && (
                <div style={{fontSize:10,color:"var(--c-text-faintest)",marginTop:-6}}>
                  L&apos;importo atteso è facoltativo: serve solo alla proiezione di fine mese e all&apos;alert saldo. Lascialo vuoto dove la cifra non si può prevedere.
                </div>
              )}
              {parseInt(ricForm.giorno,10)>28 && (
                <div style={{fontSize:10,color:"var(--c-text-faintest)",marginTop:-6}}>
                  Nei mesi più corti l&apos;addebito slitta all&apos;ultimo giorno disponibile (a febbraio il 28).
                </div>
              )}
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Data {isFin?"prima rata":"primo addebito"} *</div>
                <input type="date" value={ricForm.dataInizio||""} onChange={e=>setRicForm(p=>({...p,dataInizio:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
                <div style={{fontSize:10,color:"var(--c-text-faintest)",marginTop:4}}>
                  I saldi cambiano solo da {getMonthLabel(getCurrentMonth())} in poi, mai sui mesi passati.
                </div>
              </div>

              {/* Arretrati: scelta esplicita, default NO. Registrarli su un
                  contratto vecchio crea mesi che nell'app non sono mai
                  esistiti (saldi a zero, dentro solo la rata) e falsa cash
                  flow e confronto anno-su-anno. */}
              {!isSpesa && ricModal.mode==="add" && anteprima?.storiche>0 && (
                <div style={{border:`1px solid ${ricForm.registraArretrati?"#F59E0B60":"var(--c-border)"}`,borderRadius:8,padding:"10px 12px",background:ricForm.registraArretrati?"#F59E0B0D":"transparent"}}>
                  <label style={{display:"flex",alignItems:"flex-start",gap:8,cursor:"pointer"}}>
                    <input type="checkbox" checked={!!ricForm.registraArretrati} onChange={e=>setRicForm(p=>({...p,registraArretrati:e.target.checked}))} style={{marginTop:2}}/>
                    <span>
                      <span style={{fontSize:11,color:"var(--c-text-dim)",fontWeight:600}}>Registra anche i {anteprima.storiche} addebiti arretrati</span>
                      <span style={{display:"block",fontSize:10,color:"var(--c-text-faintest)",marginTop:3}}>
                        {ricForm.registraArretrati
                          ? `Verranno creati ${anteprima.storiche} movimenti nei mesi passati, creando anche i mesi che nell'app non esistono ancora (con saldi a zero). Utile solo se vuoi lo storico completo.`
                          : "Lasciato spento: si parte dal mese corrente. Rate pagate e debito residuo restano comunque esatti, perché si calcolano dalle date del piano."}
                      </span>
                    </span>
                  </label>
                </div>
              )}
              {isFin && (
                <>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div>
                      <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Numero rate totali</div>
                      <input type="number" min="1" disabled={periodiPuliti.length>0}
                        value={periodiPuliti.length ? periodiPuliti.reduce((s,p)=>s+p.rate,0) : (ricForm.rateTotali||"")}
                        onChange={e=>setRicForm(p=>({...p,rateTotali:e.target.value}))} placeholder="48"
                        title={periodiPuliti.length ? "Calcolato dagli scaglioni qui sotto" : ""}
                        style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:periodiPuliti.length?"var(--c-text-faint)":"var(--c-text)",fontSize:13,outline:"none"}}/>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Importo finanziato {ccy}</div>
                      <input type="number" step="0.01" value={ricForm.importoFinanziato||""} onChange={e=>setRicForm(p=>({...p,importoFinanziato:e.target.value}))} placeholder="18000"
                        style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>TAEG % (facoltativo)</div>
                      <input type="number" step="0.01" value={ricForm.taeg||""} onChange={e=>setRicForm(p=>({...p,taeg:e.target.value}))} placeholder="7,5"
                        style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
                    </div>
                  </div>
                  <div style={{fontSize:10,color:"var(--c-text-faintest)",marginTop:-6}}>
                    &quot;Importo finanziato&quot; = il capitale che ti è stato prestato (quello sul contratto), non la somma delle rate: la differenza sono gli interessi.
                  </div>

                  {/* Piano a scaglioni: rate che cambiano importo a metà piano.
                      Con una rata sola il debito residuo verrebbe sovrastimato. */}
                  <div style={{border:"1px solid var(--c-border)",borderRadius:8,padding:"10px 12px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{fontSize:11,color:"var(--c-text-dim)",fontWeight:600}}>📐 Piano a scaglioni (facoltativo)</div>
                      <button onClick={addPeriodo} style={{padding:"3px 9px",borderRadius:6,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:11}}>+ periodo</button>
                    </div>
                    <div style={{fontSize:10,color:"var(--c-text-faintest)",marginTop:4}}>
                      Usalo se la rata cambia durante il piano (es. 48 rate da 317,52 poi 36 da 238,74). Se lo compili, &quot;Numero rate totali&quot; viene calcolato da qui.
                    </div>
                    {periodiForm.map((p,i)=>(
                      <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"center",marginTop:8}}>
                        <input type="number" min="1" value={p.rate||""} onChange={e=>updPeriodo(i,"rate",e.target.value)} placeholder={i===0?"48 rate":"36 rate"}
                          style={{width:"100%",padding:"7px 9px",borderRadius:6,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:12,outline:"none"}}/>
                        <input type="number" step="0.01" value={p.importo||""} onChange={e=>updPeriodo(i,"importo",e.target.value)} placeholder={`rata ${ccy}`}
                          style={{width:"100%",padding:"7px 9px",borderRadius:6,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:12,outline:"none"}}/>
                        <button onClick={()=>delPeriodo(i)} style={{width:26,height:26,borderRadius:6,border:"1px solid #EF444440",background:"transparent",color:"#EF4444",cursor:"pointer",fontSize:12}}>×</button>
                      </div>
                    ))}
                    {periodiPuliti.length>0 && (
                      <div style={{fontSize:10,color:"var(--c-text-faint)",marginTop:8}}>
                        Totale: <b style={{color:"var(--c-text)"}}>{periodiPuliti.reduce((s,p)=>s+p.rate,0)} rate</b> · {periodiPuliti.map(p=>`${p.rate}×${fmt(p.importo)}`).join(" + ")}
                      </div>
                    )}
                  </div>

                  {/* Maxirata: chiusura anticipata a metà piano. Ha una
                      finestra di richiesta che scade: senza promemoria si perde. */}
                  <div style={{border:"1px solid var(--c-border)",borderRadius:8,padding:"10px 12px"}}>
                    <div style={{fontSize:11,color:"var(--c-text-dim)",fontWeight:600}}>🎯 Opzione maxirata (facoltativo)</div>
                    <div style={{fontSize:10,color:"var(--c-text-faintest)",marginTop:4,marginBottom:8}}>
                      Se il contratto permette di chiudere in anticipo con una maxirata: ti avviso quando la finestra si avvicina.
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      <div>
                        <div style={{fontSize:10,color:"var(--c-text-faint)",marginBottom:3}}>Importo {ccy}</div>
                        <input type="number" step="0.01" value={ricForm.maxirataImporto||""} onChange={e=>setRicForm(p=>({...p,maxirataImporto:e.target.value}))} placeholder="7238,37"
                          style={{width:"100%",padding:"7px 9px",borderRadius:6,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:12,outline:"none"}}/>
                      </div>
                      <div>
                        <div style={{fontSize:10,color:"var(--c-text-faint)",marginBottom:3}}>Da richiedere entro</div>
                        <input type="date" value={ricForm.maxirataEntro||""} onChange={e=>setRicForm(p=>({...p,maxirataEntro:e.target.value}))}
                          style={{width:"100%",padding:"7px 9px",borderRadius:6,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:12,outline:"none"}}/>
                      </div>
                    </div>
                    <div style={{marginTop:8}}>
                      <div style={{fontSize:10,color:"var(--c-text-faint)",marginBottom:3}}>Alla rata numero</div>
                      <input type="number" min="1" value={ricForm.maxirataAllaRata||""} onChange={e=>setRicForm(p=>({...p,maxirataAllaRata:e.target.value}))} placeholder="48"
                        style={{width:"100%",padding:"7px 9px",borderRadius:6,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:12,outline:"none"}}/>
                    </div>
                  </div>
                  <div style={{fontSize:10,color:"var(--c-text-faintest)",marginTop:-6}}>
                    Senza il numero di rate non si può calcolare il debito residuo: l&apos;addebito funziona lo stesso, ma resta a tempo indeterminato.
                  </div>
                </>
              )}
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Categoria dell&apos;uscita</div>
                <select value={ricForm.categoria||""} onChange={e=>setRicForm(p=>({...p,categoria:e.target.value,sottocategoria:""}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}>
                  {[...new Set([...CAT_USCITE.filter(c=>c!=="Conversione"), ricForm.categoria].filter(Boolean))].map(c=><option key={c} value={c}>{c}</option>)}
                </select>
                {/* Sottocategoria sulla ricorrenza: così ogni addebito nasce
                    già taggato e il Recap può separarli senza che tu debba
                    ricordartene ogni volta. */}
                {SOTTOCAT_IAGREX[ricForm.categoria] && (
                  <div style={{marginTop:8}}>
                    <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:6}}>Sottocategoria {ICONA_SOTTOCAT_IAGREX[ricForm.categoria]||""}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {SOTTOCAT_IAGREX[ricForm.categoria].map(sc=>(
                        <button key={sc} onClick={()=>setRicForm(p=>({...p,sottocategoria:p.sottocategoria===sc?"":sc}))}
                          style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${ricForm.sottocategoria===sc?"#F97316":"var(--c-border)"}`,background:ricForm.sottocategoria===sc?"#F9731620":"transparent",color:ricForm.sottocategoria===sc?"#F97316":"var(--c-text-faint)",cursor:"pointer",fontSize:11}}>
                          {sc}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {isSpesa && (
                <div style={{background:"var(--c-bg)",border:"1px solid var(--c-border)",borderRadius:8,padding:"8px 10px",fontSize:12,color:"var(--c-text-dim)"}}>
                  Ogni {ricForm.giorno||"—"} del mese ti comparirà il promemoria in cima a Finanze IAGREX, col tasto <b style={{color:"var(--c-text)"}}>Registra</b>: form già compilato, ti resta da scrivere l&apos;importo. Nessun movimento nasce senza la tua conferma.
                </div>
              )}
              {!isSpesa && anteprima && (
                <div style={{background:"var(--c-bg)",border:"1px solid var(--c-border)",borderRadius:8,padding:"8px 10px",fontSize:12,color:"var(--c-text-dim)"}}>
                  {(ricModal.mode==="add" && !ricForm.registraArretrati && anteprima.storiche>0)
                    ? <>Rate già maturate: <b style={{color:"var(--c-text)"}}>{anteprima.passate}</b> — gli arretrati non verranno registrati fra le uscite, si parte da {getMonthLabel(getCurrentMonth())}.</>
                    : <>Verranno registrati subito <b style={{color:"var(--c-text)"}}>{anteprima.passate}</b> addebiti già maturati
                        {anteprima.storiche>0 && <>, di cui <b style={{color:"var(--c-text)"}}>{anteprima.storiche}</b> come storico senza toccare i saldi</>}</>}
                  {anteprima.ultima && <> · ultima rata <b style={{color:"var(--c-text)"}}>{anteprima.ultima.data}</b></>}
                  {anteprima.totaleRate>0 && (
                    <div style={{marginTop:6}}>
                      Somma di tutte le rate: <b style={{color:"var(--c-text)"}}>{fmt(anteprima.totaleRate)}{ccy}</b>
                      {anteprima.capitale>0
                        ? <> = capitale <b style={{color:"var(--c-text)"}}>{fmt(anteprima.capitale)}{ccy}</b> + interessi e spese <b style={{color:"#EF4444"}}>{fmt(anteprima.interessi)}{ccy}</b></>
                        : <span style={{color:"var(--c-text-faintest)"}}> — non è il capitale finanziato: compila &quot;Importo finanziato&quot; per vedere quanto sono gli interessi.</span>}
                      {isFin && anteprima.residuoOggi>0 && (
                        <div style={{marginTop:4}}>Resterebbero da versare <b style={{color:"#EF4444"}}>{fmt(anteprima.residuoOggi)}{ccy}</b> da oggi in poi.</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button onClick={closeRicModal} style={{flex:1,padding:10,borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:13}}>Annulla</button>
              <button onClick={saveRicorrenza} style={{flex:2,padding:10,borderRadius:8,border:"none",background:isFin?"#EF4444":isSpesa?"#06B6D4":"#3B82F6",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Salva</button>
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
        <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setEstingueId(null)}>
          <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:16,padding:24,width:"100%",maxWidth:400}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:15,fontWeight:700,color:"var(--c-text-strong)",marginBottom:6}}>💸 Estingui &quot;{r.nome}&quot;</div>
            <div style={{fontSize:11,color:"var(--c-text-faint)",marginBottom:20}}>
              Da questa data non verranno più generate rate. Debito residuo a oggi: <b style={{color:"#EF4444"}}>{fmt(residuo)}{ccy}</b>.
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Data estinzione *</div>
                <input type="date" value={estingueForm.data||""} onChange={e=>setEstingueForm(p=>({...p,data:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
              </div>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Importo pagato per chiudere {contoCurrency(r.conto)}</div>
                <input type="number" step="0.01" value={estingueForm.importoEstinzione||""} onChange={e=>setEstingueForm(p=>({...p,importoEstinzione:e.target.value}))} placeholder={fmt(residuo)}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
                <div style={{fontSize:10,color:"var(--c-text-faintest)",marginTop:4}}>
                  Se lo indichi, viene registrata un&apos;uscita di quell&apos;importo che scala il conto. Lascia vuoto se si chiude senza conguaglio.
                </div>
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button onClick={()=>setEstingueId(null)} style={{flex:1,padding:10,borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:13}}>Annulla</button>
              <button onClick={confermaEstinzione} style={{flex:2,padding:10,borderRadius:8,border:"none",background:"#10B981",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Conferma estinzione</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Modal Check estratto conto */}
      {checkModal && (
        <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={closeCheckModal}>
          <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:16,padding:24,width:"100%",maxWidth:400,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:15,fontWeight:700,color:"var(--c-text-strong)",marginBottom:6}}>📄 Check estratto conto IAGREX</div>
            <div style={{fontSize:11,color:"var(--c-text-faint)",marginBottom:20}}>
              Confronta il saldo salvato in app a fine mese con quello reale letto sull'estratto conto.
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Mese estratto conto</div>
                <input type="month" value={checkForm.mese||""} onChange={e=>setCheckForm(p=>({...p,mese:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
              </div>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Conto 🏦</div>
                <select value={checkForm.conto||""} onChange={e=>setCheckForm(p=>({...p,conto:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}>
                  {CONTI_IAGREX.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div style={{background:"var(--c-bg)",border:"1px solid var(--c-border)",borderRadius:8,padding:"8px 10px",fontSize:12,color:"var(--c-text-dim)"}}>
                Saldo salvato in app per {checkForm.mese?getMonthLabel(checkForm.mese):"—"}: <b style={{color:"var(--c-text)"}}>{fmt((allData[checkForm.mese]||{}).saldi?.[checkForm.conto]||0)} {contoCurrency(checkForm.conto)}</b>
              </div>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Saldo reale sull'estratto conto {contoCurrency(checkForm.conto)} *</div>
                <input type="number" value={checkForm.saldoEstratto||""} onChange={e=>setCheckForm(p=>({...p,saldoEstratto:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button onClick={closeCheckModal} style={{flex:1,padding:10,borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:13}}>Annulla</button>
              <button onClick={saveCheck} style={{flex:2,padding:10,borderRadius:8,border:"none",background:"#06B6D4",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Salva check</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confronto movimento per movimento (carica PDF estratto) */}
      {reconcileModal && (
        <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={closeReconcile}>
          <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:16,padding:24,width:"100%",maxWidth:460,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:15,fontWeight:700,color:"var(--c-text-strong)",marginBottom:6}}>🔍 Confronta movimenti</div>
            <div style={{fontSize:11,color:"var(--c-text-faint)",marginBottom:20}}>
              Carica il PDF o il CSV dell'estratto conto IAGREX: lo confronto riga per riga con le entrate/uscite già registrate per il mese e conto scelti. Il CSV (se ha un'intestazione riconoscibile: data/importo o entrata-uscita) è più preciso; il PDF usa un'estrazione euristica dal testo, può sbagliare qualche riga — il risultato va sempre controllato a occhio.
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Mese</div>
                <input type="month" value={reconcileForm.mese||""} onChange={e=>setReconcileForm(p=>({...p,mese:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
              </div>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Conto 🏦</div>
                <select value={reconcileForm.conto||""} onChange={e=>setReconcileForm(p=>({...p,conto:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}>
                  {CONTI_IAGREX.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Estratto conto (PDF o CSV)</div>
                <input type="file" accept="application/pdf,.pdf,.csv,text/csv" onChange={e=>setReconcileForm(p=>({...p,file:e.target.files?.[0]||null}))}
                  style={{width:"100%",fontSize:12,color:"var(--c-text-dim)"}}/>
              </div>
            </div>

            {reconcileResult?.error && (
              <div style={{marginTop:16,background:"#EF444415",border:"1px solid #EF444440",borderRadius:8,padding:"10px 12px",fontSize:12,color:"#EF4444"}}>
                Errore: {reconcileResult.error}
              </div>
            )}
            {reconcileResult && !reconcileResult.error && (
              <div style={{marginTop:16,display:"flex",flexDirection:"column",gap:8}}>
                <div style={{fontSize:12,color:"var(--c-text)"}}>
                  Trovati <b>{reconcileResult.totaleEstratto}</b> movimenti ({reconcileResult.righeRiconosciute}/{reconcileResult.righeTotali} righe riconosciute) · <b style={{color:"#10B981"}}>{reconcileResult.abbinati} abbinati</b>
                  {reconcileResult.modalita && (
                    <span style={{marginLeft:6,fontSize:10,color: reconcileResult.modalita==="csv-strutturato" ? "#10B981" : "#F59E0B"}}>
                      {reconcileResult.modalita==="csv-strutturato" ? "· CSV con intestazione riconosciuta (preciso)" : reconcileResult.modalita==="csv-euristico" ? "· CSV senza intestazione riconosciuta, estrazione euristica" : "· PDF, estrazione euristica"}
                    </span>
                  )}
                </div>
                {reconcileResult.mancantiInApp.length > 0 && (
                  <div style={{background:"#EF444415",border:"1px solid #EF444440",borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#EF4444",marginBottom:4}}>Sull'estratto ma non in app ({reconcileResult.mancantiInApp.length})</div>
                    {reconcileResult.mancantiInApp.map((m,i)=>(
                      <div key={i} style={{fontSize:11,color:"var(--c-text-dim)",padding:"2px 0"}}>{m.data} · {m.descrizione} · {fmt(m.importo)}</div>
                    ))}
                  </div>
                )}
                {reconcileResult.mancantiInEstratto.length > 0 && (
                  <div style={{background:"#F59E0B15",border:"1px solid #F59E0B40",borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#F59E0B",marginBottom:4}}>In app ma non sull'estratto ({reconcileResult.mancantiInEstratto.length}) — evidenziati in arancione in Entrate/Uscite</div>
                    {reconcileResult.mancantiInEstratto.map((m)=>(
                      <div key={m.id} style={{fontSize:11,color:"var(--c-text-dim)",padding:"2px 0"}}>{m.data||"(senza data)"} · {m.descrizione} · {fmt(m.importo)}</div>
                    ))}
                  </div>
                )}
                {reconcileResult.mancantiInApp.length===0 && reconcileResult.mancantiInEstratto.length===0 && (
                  <div style={{fontSize:12,color:"#10B981",fontWeight:600}}>✅ Tutti i movimenti combaciano.</div>
                )}
              </div>
            )}

            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button onClick={closeReconcile} style={{flex:1,padding:10,borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:13}}>Chiudi</button>
              <button onClick={runReconcile} disabled={reconcileLoading || !reconcileForm.file} style={{flex:2,padding:10,borderRadius:8,border:"none",background:"#06B6D4",color:"#fff",cursor:reconcileLoading?"default":"pointer",fontSize:13,fontWeight:700,opacity:(reconcileLoading||!reconcileForm.file)?0.6:1}}>
                {reconcileLoading ? "Confronto in corso..." : "Confronta"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
