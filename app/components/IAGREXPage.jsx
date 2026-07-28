"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  MESI_BREVI, MESI_LUNGHI, GIORNI_SETT, THEME_VARS,
  genId, sortByDataDesc, groupByDayDesc, formatDayLabel,
  pad2, ymdStr, fmtShortDate, daysGrid,
  DateRangePicker, VistaToggle, fmt, round2,
  getMonthLabel, getCurrentMonth, lastMonths,
  CashFlowMiniChart, CategoryBars, costoCambio,
} from "../lib/finance-ui";

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
        data: draft.data || new Date().toISOString().slice(0,10),
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
  // Totale commissioni bancarie del mese: per IAGREX arrivano dalle
  // conversioni UniCredit (tasso banca vs tasso BCE, vedi saveConversione).
  // Le conversioni sono escluse dalle uscite vere (isReal), ma la loro
  // commissione implicita è un costo reale: qui si somma su TUTTE le uscite.
  const toEurVal = (val, contoId) => { const v = parseFloat(val)||0; return contoCurrency(contoId)==="RON" ? v/rate : v; };
  const totCommissioniMese = monthData.uscite.reduce((s,e)=>s+toEurVal(e.commissioni,e.conto),0);

  const openAdd = (tipo) => { setForm({descrizione:"",importo:"",categoria:tipo==="entrata"?CAT_ENTRATE[0]:CAT_USCITE[0],cliente:"",conto:CONTI_IAGREX[0].id,data:new Date().toISOString().slice(0,10)}); setModal({tipo,mode:"add"}); };
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
    const header = ["Data","Descrizione","Categoria","Cliente","Conto","Importo","Valuta"];
    const rows = items.map(e => [
      e.data || "",
      (e.descrizione||"").replace(/"/g,'""'),
      (e.categoria||"").replace(/"/g,'""'),
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

        {entrateAnnoScorso!=null && (
          <div style={{marginTop:8,fontSize:fs-4,color:"var(--c-text-faint)"}}>
            📈 vs {getMonthLabel(mesePrecAnno)}: {fmt(entrateAnnoScorso)}€ entrate
            {yoyDeltaPct!=null && <span style={{marginLeft:6,fontWeight:700,color:yoyDeltaPct>=0?"#10B981":"#EF4444"}}>{yoyDeltaPct>=0?"+":""}{yoyDeltaPct}%</span>}
          </div>
        )}
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
        <div style={{flex:"unset",overflowY:"visible",padding:16}}>

          {tab==="entrate" && (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,gap:8,flexWrap:"wrap"}}>
                <div style={{fontSize:fs-2,color:"var(--c-text-dim)"}}>Totale: <span style={{color:"#10B981",fontWeight:700}}>+{fmt(monthData.entrate.filter(inDateRange).reduce((s,e)=>s+toEur(e),0))}€</span></div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <VistaToggle vista={vistaEntrate} onChange={setVistaEntrate} accent="#10B981"/>
                  <button onClick={()=>openAdd("entrata")} style={{padding:"6px 14px",borderRadius:7,border:"none",background:"#10B981",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600,whiteSpace:"nowrap"}}>+ Aggiungi</button>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:isMobile?"column":"row",alignItems:isMobile?"stretch":"center",gap:6,marginBottom:12,padding:"8px 10px",background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:8}}>
                <DateRangePicker da={filtroDataDa} a={filtroDataA} onChange={(d,a)=>{setFiltroDataDa(d);setFiltroDataA(a);}} accent="#10B981"/>
                <button onClick={()=>exportCSV(monthData.entrate.filter(inDateRange),"entrate")} title="Esporta le entrate filtrate in CSV"
                  style={{flexShrink:0,padding:"6px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:11,whiteSpace:"nowrap"}}>📥 CSV</button>
              </div>
              {(() => {
                const filtered = monthData.entrate.filter(inDateRange);
                if (filtered.length===0) return (
                  <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10,padding:20,textAlign:"center",color:"var(--c-text-faintest)",fontSize:fs-2}}>
                    {monthData.entrate.length===0?"Nessuna entrata — aggiungi la prima":"Nessuna entrata nel periodo selezionato"}
                  </div>
                );
                const Row = (e,i) => (
                  <div key={e.id} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:0,borderTop:i===0?"none":"1px solid var(--c-border)",background:flaggedIds.has(e.id)?"#F59E0B1F":(i%2===0?"var(--c-panel)":"var(--c-panel2)"),boxShadow:flaggedIds.has(e.id)?"inset 3px 0 0 #F59E0B":"none"}}>
                    <Cell style={{flexDirection:"column",alignItems:"flex-start",gap:2}}>
                      <span style={{color:"var(--c-text)",fontWeight:600}}>{flaggedIds.has(e.id)?"⚠️ ":""}{e.descrizione}</span>
                      <span style={{fontSize:fs-4,color:"var(--c-text-faint)"}}>{e.data?`${e.data} · `:""}{e.categoria}{e.cliente?` · ${e.cliente}`:""}{e.conto?` · ${CONTI_IAGREX_BY_ID[e.conto]?.label||e.conto}`:""}</span>
                    </Cell>
                    <Cell style={{color:"#10B981",fontWeight:700}}>+{fmt(e.importo)}{contoCurrency(e.conto)==="RON"?" RON":"€"}</Cell>
                    <Cell><button onClick={()=>openEdit("entrata",e)} style={{width:24,height:24,borderRadius:5,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:10}}>✏️</button></Cell>
                    <Cell><button onClick={()=>deleteItem("entrata",e.id)} style={{width:24,height:24,borderRadius:5,border:"1px solid #2A1A1A",background:"transparent",color:"#EF4444",cursor:"pointer",fontSize:12,fontWeight:700}}>×</button></Cell>
                  </div>
                );
                if (vistaEntrate==="recenti") return groupByDayDesc(filtered).map(({key,data,items})=>(
                  <div key={key} style={{marginBottom:12}}>
                    <div style={{fontSize:fs-3,fontWeight:700,color:"var(--c-text-dim)",marginBottom:6,display:"flex",justifyContent:"space-between"}}>
                      <span>{formatDayLabel(data)}</span>
                      <span style={{color:"#10B981"}}>+{fmt(items.reduce((s,e)=>s+toEur(e),0))}€</span>
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
                      <span style={{color:"#10B981"}}>+{fmt(items.reduce((s,e)=>s+toEur(e),0))}€</span>
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
                <div style={{fontSize:fs-2,color:"var(--c-text-dim)"}}>Totale: <span style={{color:"#EF4444",fontWeight:700}}>-{fmt(monthData.uscite.filter(e=>(!filtroConto||e.conto===filtroConto)&&inDateRange(e)).reduce((s,e)=>s+toEur(e),0))}€</span></div>
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
                  <button onClick={()=>exportCSV(monthData.uscite.filter(e=>(!filtroConto||e.conto===filtroConto)&&inDateRange(e)),"uscite")} title="Esporta le uscite filtrate in CSV"
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
                      <span style={{fontSize:fs-4,color:"var(--c-text-faint)"}}>{e.data?`${e.data} · `:""}{e.categoria}{e.conto?` · ${CONTI_IAGREX_BY_ID[e.conto]?.label||e.conto}`:""}{parseFloat(e.commissioni)>0?<span style={{color:"#06B6D4"}}> · di cui {fmt(e.commissioni)}{contoCurrency(e.conto)==="RON"?" RON":"€"} commissioni</span>:""}</span>
                    </Cell>
                    <Cell style={{color:"#EF4444",fontWeight:700}}>-{fmt(e.importo)}{contoCurrency(e.conto)==="RON"?" RON":"€"}</Cell>
                    <Cell><button onClick={()=>openEdit("uscita",e)} style={{width:24,height:24,borderRadius:5,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:10}}>✏️</button></Cell>
                    <Cell><button onClick={()=>deleteItem("uscita",e.id)} style={{width:24,height:24,borderRadius:5,border:"1px solid #2A1A1A",background:"transparent",color:"#EF4444",cursor:"pointer",fontSize:12,fontWeight:700}}>×</button></Cell>
                  </div>
                );
                if (vistaUscite==="recenti") return groupByDayDesc(filtered).map(({key,data,items})=>(
                  <div key={key} style={{marginBottom:12}}>
                    <div style={{fontSize:fs-3,fontWeight:700,color:"var(--c-text-dim)",marginBottom:6,display:"flex",justifyContent:"space-between"}}>
                      <span>{formatDayLabel(data)}</span>
                      <span style={{color:"#EF4444"}}>-{fmt(items.reduce((s,e)=>s+toEur(e),0))}€</span>
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
                      <span style={{color:"#EF4444"}}>-{fmt(items.reduce((s,e)=>s+toEur(e),0))}€</span>
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

          {/* RECAP: dove vanno i soldi, mese per mese */}
          {tab==="recap" && (
            <div>
              <div style={{fontSize:fs-1,fontWeight:700,color:"var(--c-text-strong)",marginBottom:16}}>
                📊 Recap {getMonthLabel(month)}
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
