"use client";
import { useState, useEffect, useMemo } from "react";
import PipelinePage from "./components/PipelinePage";
import BrunoPage from "./components/BrunoPage";
import ClientiPage from "./components/ClientiPage";
import IAGREXPage from "./components/IAGREXPage";
import IdeasPage from "./components/IdeasPage";

const DONE_STATUSES = ["complete","completed","done","chiuso","closed","fatto","completato","completata"];

// "home" non ha un colore fisso: in tema chiaro un bianco pieno sarebbe
// invisibile su sfondo chiaro, quindi il colore effettivo viene risolto
// a runtime in base al tema attivo (vedi NAV_ITEMS_RESOLVED piu' sotto).
const NAV_ITEMS = [
  { id:"home",     icon:"🏠", label:"Dashboard",  color:null },
  { id:"pipeline", icon:"🎯", label:"Pipeline",   color:"#8B5CF6" },
  { id:"clienti",  icon:"👥", label:"Clienti",    color:"#10B981" },
  { id:"finanze",  icon:"💰", label:"Finanze",    color:"#F59E0B" },
  { id:"iagrex",   icon:"📊", label:"IAGREX",     color:"#3B82F6" },
  { id:"sospeso",  icon:"⏸️", label:"Sospese",    color:"#EF4444" },
  // Colore neutro (null, come Dashboard) di proposito: non deve saltare
  // all'occhio come le altre — è una voce di servizio, non un'area
  // principale del lavoro quotidiano.
  { id:"idee",     icon:"🎙️", label:"Idee",       color:null },
];

// Priorità ClickUp: urgent(0) > high(1) > normal(2) > low(3) > nessuna(4).
// Ordiniamo To Do/Routine di conseguenza invece di lasciarli nell'ordine
// grezzo restituito da ClickUp, cosi' le cose piu' urgenti stanno in cima.
const PRIORITY_RANK = { urgent:0, high:1, normal:2, low:3 };
function priorityRank(task) {
  const p = task.priority?.priority;
  return p != null && PRIORITY_RANK[p] != null ? PRIORITY_RANK[p] : 4;
}
function sortedByPriority(list) {
  return [...list].sort((a,b)=>priorityRank(a)-priorityRank(b));
}

// Palette dei due temi, condivisa con Pipeline/Finanze/IAGREX (che la
// ricevono come prop "theme" e la applicano tramite le proprie variabili
// CSS --c-*). I colori "accent" (verde/rosso/blu/viola/arancio di stage,
// stati, grafici) restano hardcoded perche' restano leggibili su entrambi
// gli sfondi.
const THEMES = {
  dark:  { bg:"#09090F", panel:"#0F0F1A", border:"#1A1A2E", text:"#E2E8F0", textDim:"#475569", textFaint:"#334155", cardText:"#F8FAFC" },
  light: { bg:"#F4F5F7", panel:"#FFFFFF", border:"#E2E4E9", text:"#1A1A2E", textDim:"#64748B", textFaint:"#94A3B8", cardText:"#0F172A" },
};

// Retry silenzioso: un blip di rete non deve subito accendere il banner
// di errore. Un solo ritentativo dopo mezzo secondo copre la maggior
// parte dei timeout momentanei senza allungare troppo il caricamento.
async function fetchWithRetry(url, opts={}) {
  try {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch {
    await new Promise(res=>setTimeout(res,500));
    try {
      const r2 = await fetch(url, opts);
      if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
      return await r2.json();
    } catch { return null; }
  }
}

function todayBucharest() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Bucharest" }); // YYYY-MM-DD
}

function getWeatherEmoji(condition) {
  const c = (condition||"").toLowerCase();
  if (c.includes("thunder")) return "⛈️";
  if (c.includes("snow"))    return "❄️";
  if (c.includes("rain"))    return "🌧️";
  if (c.includes("drizzle")) return "🌦️";
  if (c.includes("mist")||c.includes("fog")||c.includes("haze")) return "🌫️";
  if (c.includes("cloud"))   return "☁️";
  if (c.includes("clear"))   return "☀️";
  return "🌤️";
}

// Etichetta leggibile per i fusi orari più probabili quando si viaggia
// (Italia soprattutto, dato dove vive la famiglia/i clienti di Dario).
// Per fusi non mappati mostriamo comunque qualcosa di leggibile invece
// della stringa IANA grezza (es. "Europe/Rome" -> "Rome").
function tzToLabel(tz) {
  const known = {
    "Europe/Rome": "Italia", "Europe/Vatican": "Italia", "Europe/San_Marino": "Italia",
    "Europe/London": "Regno Unito", "Europe/Paris": "Francia", "Europe/Berlin": "Germania",
    "Europe/Madrid": "Spagna", "Europe/Brussels": "Belgio", "Europe/Amsterdam": "Paesi Bassi",
    "Europe/Vienna": "Austria", "Europe/Zurich": "Svizzera", "Europe/Lisbon": "Portogallo",
    "Europe/Athens": "Grecia", "America/New_York": "New York", "America/Los_Angeles": "California",
  };
  if (known[tz]) return known[tz];
  const city = tz.split("/").pop()?.replace(/_/g," ");
  return city || tz;
}

// Etichette italiane per le 4 priorità di ClickUp, cosi' invece di un
// pallino colorato (che richiede ricordarsi cosa significa ogni colore)
// si legge subito "Urgente"/"Alta"/ecc.
const PRIORITY_LABEL = { urgent:"Urgente", high:"Alta", normal:"Normale", low:"Bassa" };

function TaskItem({ task, color, onToggle, fontSize=14, isChecked }) {
  const done = isChecked ?? DONE_STATUSES.includes((task.status?.status||"").toLowerCase());
  const prio = task.priority?.priority;
  const prioColor = task.priority?.color;
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,cursor:"pointer"}} onClick={()=>onToggle(task.id)}>
      <div style={{width:18,height:18,borderRadius:4,border:`1.5px solid ${color}60`,background:done?color:"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>
        {done && <span style={{fontSize:11,color:"#fff",lineHeight:1}}>✓</span>}
      </div>
      <span style={{fontSize,color:done?"#334155":"#94A3B8",textDecoration:done?"line-through":"none",lineHeight:1.4,flex:1}}>{task.name}</span>
      {!done && prio && PRIORITY_LABEL[prio] && (
        <span style={{fontSize:Math.max(8,fontSize-5),fontWeight:700,color:prioColor||"#64748B",textTransform:"uppercase",letterSpacing:"0.04em",flexShrink:0}}>
          {PRIORITY_LABEL[prio]}
        </span>
      )}
    </div>
  );
}

// I mini-grafici Revenue/Peso che stavano qui sono stati rimossi su
// richiesta esplicita di Dario (10/07): non convincevano graficamente e
// appesantivano le card. I dati restano disponibili come numeri + barra
// di progresso nelle rispettive card.

export default function App() {
  const [view, setView]                   = useState("home");
  const [fontSize, setFontSize]           = useState(14);
  const [showSettings, setShowSettings]   = useState(false);
  const [isMobile, setIsMobile]           = useState(false);
  const [checkedTasks, setCheckedTasks]   = useState({});
  const [showWeightModal, setShowWeightModal] = useState(false);
  const [weightInput, setWeightInput]     = useState("");

  const [clockBucharest, setClockBucharest] = useState("--:--:--");
  const [clockRome, setClockRome]           = useState("--:--");
  const [weather, setWeather]               = useState(null);
  const [homeData, setHomeData]             = useState({todo:[],routine:[],sospeso:[]});
  const [revenue, setRevenue]               = useState(null);
  const [weightData, setWeightData]         = useState(null);
  const [homeLoading, setHomeLoading]       = useState(false);
  const [homeErrors, setHomeErrors]         = useState({});
  const [syncError, setSyncError]           = useState(null);
  const [lastUpdated, setLastUpdated]       = useState(null);
  const [theme, setTheme]                   = useState("dark");
  const [routineStreak, setRoutineStreak]   = useState(0);
  const [streakHistory, setStreakHistory]   = useState([]); // ultimi 30 giorni, da ClickUp
  const [leadDaRicontattare, setLeadDaRicontattare] = useState([]);
  const [inactivityDays, setInactivityDays] = useState(0);
  // Idee vocali: catturarle/leggerle ora vive tutto nella pagina dedicata
  // "Idee" (IdeasPage), non più qui. Qui resta solo "ideas" — la lista
  // "da valutare" per il popup del rito del venerdì — popolata da un check
  // leggero SOLO il venerdì (vedi checkFridayRitual), non ad ogni apertura
  // app: prima loadIdeas() partiva sempre al mount, aggiungendo una
  // chiamata Notion in più al boot della home tutti i giorni per un
  // popup che serve solo una volta a settimana.
  const [ideas, setIdeas]                   = useState([]);
  const [backupStatus, setBackupStatus]     = useState(null); // null | "loading" | "done" | "error"
  const [deviceTzLabel, setDeviceTzLabel]   = useState(null); // {label,time} se il device è in un fuso diverso da Bucarest
  const [useLocalWeather, setUseLocalWeather] = useState(false);
  const [weatherStatus, setWeatherStatus]   = useState(null); // null | "loading" | "denied" | "error"
  const [showFridayRitual, setShowFridayRitual] = useState(false);
  const [fridayBusyId, setFridayBusyId]     = useState(null);
  const [newTaskText, setNewTaskText]       = useState("");
  const [addingTask, setAddingTask]         = useState(false);

  const T = THEMES[theme] || THEMES.dark;

  // Load settings
  useEffect(()=>{
    try {
      const sr = localStorage.getItem("dario-settings");
      if (sr) { const s=JSON.parse(sr); if(s.fontSize) setFontSize(s.fontSize); if(s.theme) setTheme(s.theme); }
      const st = localStorage.getItem("dario-routine-streak");
      if (st) { try { setRoutineStreak(JSON.parse(st).count || 0); } catch {} }
      const ct = localStorage.getItem("dario-checked-tasks");
      if (ct) {
        const parsed = JSON.parse(ct);
        // Nuovo formato: { date, tasks }. Se la data salvata non è oggi
        // (fuso Bucarest, stesso usato dal cron di reset notturno),
        // scartiamo lo stato vecchio: la dashboard deve ripartire dallo
        // stato reale di ClickUp, non da un "completata" di ieri rimasto
        // bloccato nel browser dopo il reset delle routine.
        if (parsed && parsed.date === todayBucharest()) {
          setCheckedTasks(parsed.tasks || {});
        } else {
          localStorage.removeItem("dario-checked-tasks");
        }
      }
      // Preferenza "meteo posizione attuale": per-dispositivo, non sincronizzata
      // altrove di proposito — ha senso solo se attivata sul telefono che stai
      // usando in quel momento, non su tutti e tre insieme.
      if (localStorage.getItem("dario-use-local-weather") === "1") setUseLocalWeather(true);
    } catch {}
    checkFridayRitual();
  },[]);

  // Banner "bentornato": calcolato interamente in locale (nessuna chiamata
  // di rete, nessun costo) confrontando la data dell'ultima apertura salvata
  // in localStorage con oggi, prima di sovrascriverla con la data odierna.
  useEffect(()=>{
    try {
      const last = localStorage.getItem("dario-last-visit");
      const today = todayBucharest();
      if (last && last !== today) {
        const days = Math.round((new Date(today) - new Date(last)) / 86400000);
        if (days >= 1) setInactivityDays(days);
      }
      localStorage.setItem("dario-last-visit", today);
    } catch {}
  },[]);

  useEffect(()=>{
    try { localStorage.setItem("dario-settings", JSON.stringify({fontSize,theme})); } catch {}
  },[fontSize,theme]);

  useEffect(()=>{
    const check = ()=>setIsMobile(window.innerWidth<640);
    check();
    window.addEventListener("resize",check);
    return ()=>window.removeEventListener("resize",check);
  },[]);

  // Clock
  useEffect(()=>{
    const tick=()=>{
      const now=new Date();
      setClockBucharest(now.toLocaleTimeString("it-IT",{timeZone:"Europe/Bucharest",hour:"2-digit",minute:"2-digit",second:"2-digit"}));
      setClockRome(now.toLocaleTimeString("it-IT",{timeZone:"Europe/Rome",hour:"2-digit",minute:"2-digit"}));
      // Fuso orario del dispositivo: letto dal sistema operativo del telefono
      // via Intl (nessun permesso richiesto, a differenza della geolocalizzazione
      // usata per il meteo). L'ora "ufficiale" mostrata in giro nell'app resta
      // sempre quella rumena — questa è solo un'etichetta di contesto per non
      // confondersi mentre si è in viaggio e si parla con qualcuno sul posto.
      try {
        const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (deviceTz && deviceTz !== "Europe/Bucharest") {
          const time = now.toLocaleTimeString("it-IT",{timeZone:deviceTz,hour:"2-digit",minute:"2-digit"});
          setDeviceTzLabel({ label: tzToLabel(deviceTz), time });
        } else {
          setDeviceTzLabel(null);
        }
      } catch { setDeviceTzLabel(null); }
    };
    tick();
    const id=setInterval(tick,1000);
    return ()=>clearInterval(id);
  },[]);

  useEffect(()=>{ if(view==="home") loadHomeData(); },[view]);
  useEffect(()=>{ if(view==="home" && useLocalWeather) loadLocalWeather(); },[view, useLocalWeather]);

  // Meteo sulla posizione attuale: a differenza del fuso orario (letto senza
  // permessi dal sistema), qui serve la Geolocation API del browser, che
  // chiede un permesso esplicito la prima volta su ogni dispositivo. Per
  // questo è un toggle manuale e non un comportamento sempre-attivo: utile
  // solo quando si viaggia davvero, altrimenti è solo un permesso in più
  // da concedere per nulla.
  const loadLocalWeather = () => {
    if (!navigator.geolocation) { setWeatherStatus("error"); return; }
    setWeatherStatus("loading");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(`/api/weather?lat=${latitude}&lon=${longitude}`,{cache:"no-store"});
          const data = await res.json();
          if (res.ok && !data.error) { setWeather(data); setWeatherStatus(null); }
          else setWeatherStatus("error");
        } catch { setWeatherStatus("error"); }
      },
      () => setWeatherStatus("denied"), // permesso negato o non disponibile: si resta sul meteo fisso già caricato
      { timeout: 8000 }
    );
  };
  const toggleLocalWeather = () => {
    const next = !useLocalWeather;
    setUseLocalWeather(next);
    try { localStorage.setItem("dario-use-local-weather", next ? "1" : "0"); } catch {}
    if (next) loadLocalWeather();
    else loadHomeData(); // torna al meteo fisso (Timișoara) ricaricando il default
  };

  const loadHomeData = async ()=>{
    setHomeLoading(true);
    // Il meteo (OpenWeather, piano gratuito) può impiegare 8-10s a rispondere
    // — misurato: le altre 5 chiamate insieme ci mettono meno di 1.5s. Prima
    // era dentro lo stesso Promise.all delle altre, quindi bastava il meteo
    // lento a tenere ferma l'intera dashboard per 10 secondi. Ora parte in
    // parallelo ma FUORI dal blocco che decide quando homeLoading torna
    // false: il resto della home appare subito, il meteo si aggiorna da solo
    // (con un piccolo "..." mentre arriva) appena pronto.
    fetchWithRetry("/api/weather",{cache:"no-store"}).then(wRes=>{
      if (wRes&&!wRes.error) setWeather(wRes);
      setHomeErrors(prev=>({...prev, weather: !wRes || !!wRes.error}));
    });
    try {
      // fetchWithRetry assorbe un singolo blip di rete (timeout momentaneo)
      // ritentando una volta prima di arrendersi, cosi' il banner di errore
      // compare solo quando il problema e' persistente e reale.
      const [tRes,rRes,wgRes,pRes,skRes] = await Promise.all([
        fetchWithRetry("/api/tasks",{cache:"no-store"}),
        fetchWithRetry("/api/revenue",{cache:"no-store"}),
        fetchWithRetry("/api/weight",{cache:"no-store"}),
        fetchWithRetry("/api/pipeline-data",{cache:"no-store"}),
        fetchWithRetry("/api/streak",{cache:"no-store"}),
      ]);
      if (tRes)               setHomeData(tRes);
      else                    setHomeData({todo:[],routine:[],sospeso:[]});
      if (rRes&&!rRes.error)  setRevenue(rRes);
      if (wgRes&&!wgRes.error) setWeightData(wgRes);
      // Lo streak vive ora sul Doc ClickUp (persiste cross-dispositivo):
      // il valore server e' la fonte di verita', localStorage resta solo
      // come cache per mostrare qualcosa mentre la fetch e' in corso.
      if (skRes&&!skRes.error) {
        setRoutineStreak(skRes.streak||0);
        setStreakHistory(skRes.ultimi_30||[]);
      }
      if (pRes&&!pRes.error && Array.isArray(pRes.entries)) {
        // Lead ancora aperti (non chiusi/rifiutati) senza contatto da 3+
        // giorni, o mai contattati: sono quelli a rischio di essere
        // dimenticati mentre l'attenzione va altrove.
        const today = new Date();
        const stale = pRes.entries.filter(e=>{
          if (e.tipo!=="lead" || ["chiuso","rifiutato"].includes(e.stage)) return false;
          if (!e.ultimo_contatto) return true;
          const days = (today - new Date(e.ultimo_contatto)) / 86400000;
          return days >= 3;
        });
        setLeadDaRicontattare(stale);
      }
      // Teniamo traccia di QUALI dati non si sono caricati, invece di
      // lasciare che un errore silenzioso si travesta da "0€"/"–" senza
      // che sia chiaro se è un dato vuoto legittimo o un fetch fallito.
      // "weather" viene aggiornato a parte (vedi sopra), non qui.
      setHomeErrors(prev=>({
        ...prev,
        revenue: !rRes || !!rRes.error,
        weight:  !wgRes || !!wgRes.error,
      }));
      setLastUpdated(new Date());
    } catch(e){ console.error("Dashboard error:",e); }
    setHomeLoading(false);
  };

  // Streak routine: se tutte le routine di oggi risultano completate,
  // segnaliamo il giorno come "fatto" sul Doc ClickUp (una sola volta per
  // giorno) cosi' lo streak sopravvive a cambio browser/dispositivo invece
  // di vivere solo in localStorage. Il conteggio vero e proprio (quanti
  // giorni consecutivi) lo calcola il server in /api/streak.
  useEffect(()=>{
    if (!homeData.routine || homeData.routine.length===0) return;
    const allDone = homeData.routine.every(t=>{
      const cur = checkedTasks[t.id] ?? DONE_STATUSES.includes((t.status?.status||"").toLowerCase());
      return cur;
    });
    if (!allDone) return;
    const today = todayBucharest();
    if (streakHistory.some(d=>d.data===today && d.completed)) return; // già segnato oggi
    (async ()=>{
      try {
        const res = await fetch("/api/streak",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({data:today,completed:true})});
        const data = await res.json();
        if (res.ok) {
          setRoutineStreak(data.streak||0);
          setStreakHistory(prev=>{
            const next = prev.filter(d=>d.data!==today);
            next.push({data:today,completed:true});
            return next;
          });
        }
      } catch {}
    })();
  },[homeData.routine, checkedTasks, streakHistory]);

  const toggleTask = async (taskId,type)=>{
    const task = homeData[type]?.find(t=>t.id===taskId);
    if (!task) return;
    const cur  = checkedTasks[taskId] ?? DONE_STATUSES.includes((task.status?.status||"").toLowerCase());
    const next = !cur;
    const newChecked = {...checkedTasks,[taskId]:next};
    setCheckedTasks(newChecked);
    try { localStorage.setItem("dario-checked-tasks",JSON.stringify({date:todayBucharest(),tasks:newChecked})); } catch {}
    // Aggiornamento ottimistico: se la scrittura su ClickUp fallisce,
    // riportiamo indietro la checkbox e lo segnaliamo, invece di lasciare
    // che la dashboard mostri uno stato "completato" che su ClickUp non
    // esiste davvero — è esattamente il tipo di disallineamento che ha
    // fatto partire questo progetto.
    try {
      const res = await fetch("/api/update-task",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({taskId,status:next?"completata":"da fare"})});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      const reverted = {...newChecked,[taskId]:cur};
      setCheckedTasks(reverted);
      try { localStorage.setItem("dario-checked-tasks",JSON.stringify({date:todayBucharest(),tasks:reverted})); } catch {}
      setSyncError(task.name || "task");
      setTimeout(()=>setSyncError(null), 5000);
    }
  };

  // Crea un nuovo task direttamente su ClickUp (lista To Do Daily) e lo
  // aggiunge subito alla card, cosi' non serve un refresh manuale per
  // vederlo. Nessuno stato ottimistico "finto": il task in lista è quello
  // che torna indietro da ClickUp, quindi id/priorità sono già reali.
  const addTodoTask = async () => {
    const name = newTaskText.trim();
    if (!name || addingTask) return;
    setAddingTask(true);
    try {
      const res = await fetch("/api/create-task",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,list:"todo"})});
      const data = await res.json();
      if (!res.ok || !data.id) throw new Error("create failed");
      setHomeData(prev=>({...prev, todo:[...(prev.todo||[]), data]}));
      setNewTaskText("");
    } catch (e) {
      setSyncError(`aggiunta "${name}"`);
      setTimeout(()=>setSyncError(null), 5000);
    }
    setAddingTask(false);
  };

  const saveWeightModal = async ()=>{
    const p = parseFloat(weightInput.replace(",","."));
    if (!weightInput||isNaN(p)) return;
    const today = new Date().toISOString().slice(0,10);
    try {
      const res  = await fetch("/api/weight",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({data:today,peso:p})});
      const data = await res.json();
      if (data.success){
        const last = data.entries[data.entries.length-1];
        setWeightData(prev=>({...prev,entries:data.entries,ultimo:last,persi:Math.round((121.6-last.peso)*10)/10,mancano:Math.round((last.peso-85)*10)/10}));
        setShowWeightModal(false);
        setWeightInput("");
      }
    } catch {}
  };

  const getGreeting = ()=>{
    const h = parseInt(new Date().toLocaleString("en-US",{timeZone:"Europe/Bucharest",hour:"numeric",hour12:false}));
    return h<12?"Buongiorno":h<18?"Buon pomeriggio":"Buonasera";
  };

  // Idee al volo: cattura veloce di pensieri/idee imprenditoriali senza
  // dover aprire una nota separata. Vivevano solo in localStorage (sparivano
  // cambiando browser/dispositivo); ora vivono su Notion, nello stesso
  // database della pipeline, così sopravvivono e possono alimentare il
  // rito settimanale del venerdì (serve sapere quali sono ancora "Da
  // valutare" contro quelle già smaltite, cosa che localStorage da solo
  // non poteva modellare).
  // Check leggero per il rito del venerdì: la chiamata a Notion parte SOLO
  // se oggi è venerdì (fuso Bucarest) e non l'abbiamo già mostrato oggi —
  // gli altri sei giorni della settimana questa funzione non fa alcuna
  // richiesta di rete. La lista idee completa (con aggiunta/rimozione/
  // dettatura) vive ora solo nella pagina "Idee" dedicata.
  const checkFridayRitual = async () => {
    const oggi = todayBucharest();
    const giornoSettimana = new Date().toLocaleString("en-US",{timeZone:"Europe/Bucharest",weekday:"short"});
    const giaVistoOggi = localStorage.getItem("dario-friday-ritual-shown") === oggi;
    if (giornoSettimana !== "Fri" || giaVistoOggi) return;
    try {
      const res = await fetch("/api/ideas-data");
      if (!res.ok) return;
      const dataRes = await res.json();
      const loaded = dataRes.ideas || [];
      const daValutare = loaded.filter(i=>(i.stato||"Da valutare")==="Da valutare");
      if (daValutare.length > 0) {
        setIdeas(loaded);
        setShowFridayRitual(true);
        localStorage.setItem("dario-friday-ritual-shown", oggi);
      }
    } catch {}
  };

  // Le tre azioni del rito del venerdì: "diventa task" crea davvero il
  // task nel To-Do di ClickUp (stessa API del bottone + task manuale),
  // "scarta" e "ignora ancora" aggiornano solo lo stato su Notion — quarta
  // opzione implicita è chiudere il modal, che lascia tutto "Da valutare"
  // per la prossima volta.
  const fridayIdeaToTask = async (idea) => {
    setFridayBusyId(idea.notionId);
    try {
      await fetch("/api/create-task",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:idea.text,list:"todo"})});
      await setIdeaStato(idea.notionId, "Diventata task");
    } catch {}
    setFridayBusyId(null);
  };
  const fridayIdeaScarta = async (idea) => {
    setFridayBusyId(idea.notionId);
    await setIdeaStato(idea.notionId, "Scartata");
    setFridayBusyId(null);
  };
  // Usato dal rito del venerdì per marcare lo stato di un'idea senza
  // rimuoverla dalla lista (a differenza di removeIdea, che la archivia).
  const setIdeaStato = async (notionId, stato) => {
    setIdeas(prev=>prev.map(i=>i.notionId===notionId?{...i,stato}:i));
    try { await fetch("/api/ideas-data",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({notionId,stato})}); } catch {}
  };

  // Backup completo: aggrega ClickUp (to-do/routine/streak/finanze/peso) e
  // Notion (pipeline) lato server (/api/backup), poi aggiunge qui le idee
  // vocali che invece vivono solo in localStorage — nessuna delle due fonti
  // da sola basterebbe a ricostruire tutto. Il file scaricato è un JSON
  // leggibile, pensato per essere riaperto a mano in caso di disastro, non
  // per un ripristino automatico (che oggi non esiste).
  const downloadBackup = async () => {
    setBackupStatus("loading");
    try {
      const res = await fetch("/api/backup");
      const payload = await res.json();
      // Le idee non sono più tenute in stato qui (vivono nella pagina
      // "Idee" dedicata): per il backup le recuperiamo fresche al momento,
      // unica occasione in cui vale la chiamata extra a Notion.
      try {
        const ideasRes = await fetch("/api/ideas-data");
        payload.data.ideas_vocali = ideasRes.ok ? (await ideasRes.json()).ideas || [] : [];
      } catch { payload.data.ideas_vocali = []; }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dario-backup-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setBackupStatus(payload.errors?.length ? "error" : "done");
    } catch {
      setBackupStatus("error");
    }
    setTimeout(()=>setBackupStatus(null), 4000);
  };

  // DCard/DLabel sono avvolti in useMemo con dipendenze stabili (T,
  // fontSize) invece di essere ridefiniti a ogni render: l'orologio in
  // homepage aggiorna lo stato ogni secondo, e se questi componenti
  // venissero ricreati ogni volta React li smonterebbe e rimonterebbe da
  // capo — su mobile questo chiude la tastiera virtuale ogni secondo,
  // rendendo impossibile scrivere negli input (es. "Nuovo task...").
  // "accent" aggiunge una barra colorata in alto + un'ombra soffusa dello
  // stesso colore, cosi' ogni card ha un'identita' visiva immediata (task
  // viola, routine verde, sospeso rosso, ecc.) invece del bordo grigio
  // uniforme di prima — coerente con la direzione "colorato/energico".
  const DCard = useMemo(()=> ({children,style={},accent})=>(
    <div className="dcard" style={{position:"relative",background:T.panel,border:`1px solid ${T.border}`,borderRadius:18,padding:"18px 16px 16px",overflow:"hidden",boxShadow:accent?`0 10px 28px -14px ${accent}70`:"0 6px 16px -10px #00000040",transition:"transform 0.16s ease, box-shadow 0.16s ease",...style}}>
      {accent && <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:accent}}/>}
      {children}
    </div>
  ), [T]);
  const DLabel = useMemo(()=> ({children,style={}})=>(
    <div style={{fontSize:Math.max(9,fontSize-4),fontWeight:700,color:T.textDim,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10,...style}}>{children}</div>
  ), [T,fontSize]);

  const SettingsContent = ()=>(
    <div style={{padding:12}}>
      <div style={{fontSize:11,color:"#64748B",marginBottom:6}}>Dimensione testo: {fontSize}px</div>
      <input type="range" min={12} max={18} step={1} value={fontSize} onChange={e=>setFontSize(Number(e.target.value))}
        style={{width:"100%",accentColor:"#8B5CF6",cursor:"pointer",marginBottom:8}}/>
      <div style={{display:"flex",gap:3,marginBottom:14}}>
        {[12,13,14,15,16,17,18].map(s=>(
          <button key={s} onClick={()=>setFontSize(s)}
            style={{flex:1,padding:"3px 0",borderRadius:4,border:`1px solid ${fontSize===s?"#8B5CF6":"#1A1A2E"}`,background:fontSize===s?"#8B5CF620":"transparent",color:fontSize===s?"#8B5CF6":"#475569",cursor:"pointer",fontSize:9}}>
            {s}
          </button>
        ))}
      </div>
      <div style={{fontSize:11,color:"#64748B",marginBottom:6}}>Tema (solo dashboard)</div>
      <div style={{display:"flex",gap:6}}>
        {[["dark","🌙 Scuro"],["light","☀️ Chiaro"]].map(([id,label])=>(
          <button key={id} onClick={()=>setTheme(id)}
            style={{flex:1,padding:"6px 0",borderRadius:6,border:`1px solid ${theme===id?"#8B5CF6":"#1A1A2E"}`,background:theme===id?"#8B5CF620":"transparent",color:theme===id?"#8B5CF6":"#475569",cursor:"pointer",fontSize:10}}>
            {label}
          </button>
        ))}
      </div>
      <div style={{fontSize:9,color:"#334155",marginTop:6,lineHeight:1.4}}>Si applica a tutta l'app.</div>

      <div style={{marginTop:16,paddingTop:14,borderTop:`1px solid ${T.border}`}}>
        <div style={{fontSize:11,color:"#64748B",marginBottom:6}}>Backup dati</div>
        <button onClick={downloadBackup} disabled={backupStatus==="loading"}
          style={{width:"100%",padding:"8px 0",borderRadius:8,border:"1px solid #8B5CF640",background:backupStatus==="loading"?"#1A1A2E":"#8B5CF610",color:"#8B5CF6",cursor:backupStatus==="loading"?"not-allowed":"pointer",fontSize:11,fontWeight:600}}>
          {backupStatus==="loading" ? "⏳ Preparazione..." : backupStatus==="done" ? "✅ Scaricato" : backupStatus==="error" ? "⚠️ Scaricato con avvisi" : "⬇️ Esporta backup JSON"}
        </button>
        <div style={{fontSize:9,color:"#334155",marginTop:6,lineHeight:1.4}}>Unisce ClickUp (to-do, routine, streak, finanze, peso) e Notion (pipeline) in un unico file.</div>
      </div>
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100dvh",background:T.bg,color:T.text,fontFamily:"system-ui,-apple-system,sans-serif",overflow:"hidden"}}>
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>

        {/* SIDEBAR DESKTOP */}
        {!isMobile && (
          <div style={{width:180,background:T.panel,borderRight:`1px solid ${T.border}`,display:"flex",flexDirection:"column",padding:"16px 10px",flexShrink:0}}>
            {NAV_ITEMS.map(item=>{
              const c = item.color || T.cardText;
              return (
              <button key={item.id} onClick={()=>setView(item.id)}
                style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",marginBottom:4,borderRadius:10,border:"none",
                  background:view===item.id?`${c}15`:"transparent",
                  borderLeft:`3px solid ${view===item.id?c:"transparent"}`,
                  color:view===item.id?c:T.textDim,cursor:"pointer",fontSize:13,fontWeight:600,textAlign:"left"}}>
                <span>{item.icon}</span>{item.label}
              </button>
              );
            })}
            <div style={{marginTop:"auto",paddingTop:12,borderTop:`1px solid ${T.border}`}}>
              <button onClick={()=>setShowSettings(s=>!s)}
                style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1px solid ${showSettings?"#334155":T.border}`,background:showSettings?`${T.border}`:"transparent",color:T.textDim,cursor:"pointer",fontSize:12,textAlign:"left"}}>
                ⚙️ Impostazioni
              </button>
              {showSettings && (
                <div style={{marginTop:8,background:T.bg,borderRadius:8,border:`1px solid ${T.border}`}}>
                  <SettingsContent/>
                </div>
              )}
            </div>
          </div>
        )}

        {/* MAIN AREA */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {view==="iagrex"   && <IAGREXPage fontSize={fontSize} onBack={()=>setView("home")} theme={theme}/>}
          {view==="finanze"  && <BrunoPage  fontSize={fontSize} theme={theme} isMobile={isMobile}/>}
          {view==="pipeline" && <PipelinePage fontSize={fontSize} theme={theme}/>}
          {view==="clienti"  && <ClientiPage  fontSize={fontSize} theme={theme}/>}
          {view==="idee"     && <IdeasPage    fontSize={fontSize} theme={theme}/>}

          {view==="sospeso" && (
            <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>
              <div style={{padding:"14px 20px",borderBottom:`1px solid ${T.border}`,background:T.bg,flexShrink:0}}>
                <div style={{fontWeight:700,fontSize:15,color:T.cardText}}>⏸️ Task in sospeso</div>
                <div style={{fontSize:11,color:T.textDim,marginTop:2}}>Da controllare ogni giorno: valuta se ora puoi sbloccarle.</div>
              </div>
              <div style={{flex:1,overflowY:"auto",padding:16}}>
                <DCard>
                  {(!homeData.sospeso || homeData.sospeso.length===0) ? (
                    <div style={{fontSize:fontSize-2,color:"#334155"}}>{homeLoading?"Caricamento...":"Nessuna task in sospeso 🎉"}</div>
                  ) : sortedByPriority(homeData.sospeso).map(t=>(
                    <TaskItem key={t.id} task={t} color="#EF4444" onToggle={id=>toggleTask(id,"sospeso")} fontSize={fontSize} isChecked={checkedTasks[t.id]}/>
                  ))}
                </DCard>
              </div>
            </div>
          )}

          {view==="home" && (
            <>
              {/* Header */}
              <div style={{padding:"14px 20px",borderBottom:`1px solid ${T.border}`,background:T.bg,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{fontWeight:700,fontSize:15,color:T.cardText}}>🏠 Dashboard</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  {lastUpdated && !homeLoading && (
                    <div style={{fontSize:10,color:"#334155"}}>
                      aggiornato alle {lastUpdated.toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"})}
                    </div>
                  )}
                  <button onClick={loadHomeData} style={{padding:"4px 10px",borderRadius:7,border:"1px solid #1A1A2E",background:"transparent",color:"#475569",cursor:"pointer",fontSize:11}}>
                    {homeLoading?"⏳":"↻ Aggiorna"}
                  </button>
                  {isMobile && (
                    <button onClick={()=>setShowSettings(s=>!s)}
                      style={{padding:"4px 10px",borderRadius:7,border:`1px solid ${showSettings?"#8B5CF6":"#1A1A2E"}`,background:showSettings?"#8B5CF620":"transparent",color:showSettings?"#8B5CF6":"#64748B",cursor:"pointer",fontSize:11}}>
                      ⚙️
                    </button>
                  )}
                </div>
              </div>

              {isMobile && showSettings && (
                <div style={{background:T.panel,borderBottom:`1px solid ${T.border}`,flexShrink:0}}>
                  <SettingsContent/>
                </div>
              )}

              {inactivityDays >= 1 && (
                <div style={{margin:"10px 16px 0",padding:"8px 12px",borderRadius:8,border:"1px solid #8B5CF640",background:"#8B5CF60D",color:"#8B5CF6",fontSize:12,flexShrink:0}}>
                  👋 Bentornato! Non aprivi l'app da {inactivityDays} giorn{inactivityDays===1?"o":"i"}
                  {leadDaRicontattare.length>0 ? ` — hai ${leadDaRicontattare.length} lead in attesa in pipeline.` : "."}
                </div>
              )}

              {syncError && (
                <div style={{margin:"10px 16px 0",padding:"8px 12px",borderRadius:8,border:"1px solid #EF444450",background:"#EF44440D",color:"#EF4444",fontSize:12,flexShrink:0}}>
                  ⚠️ Non sono riuscito ad aggiornare "{syncError}" su ClickUp — la modifica è stata annullata, riprova.
                </div>
              )}

              {leadDaRicontattare.length > 0 && (
                <div onClick={()=>setView("pipeline")}
                  style={{margin:"10px 16px 0",padding:"8px 12px",borderRadius:8,border:"1px solid #F59E0B40",background:"#F59E0B0D",color:"#F59E0B",fontSize:12,flexShrink:0,cursor:"pointer"}}>
                  📨 {leadDaRicontattare.length} lead da ricontattare: {leadDaRicontattare.slice(0,3).map(l=>l.nome).join(", ")}{leadDaRicontattare.length>3?"…":""}
                </div>
              )}

              {/* Dashboard content */}
              <div style={{flex:1,overflowY:"auto",padding:"16px 16px 24px",fontSize}}>
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:fontSize+6,fontWeight:700,color:T.cardText}}>{getGreeting()}, Dario 👋</div>
                  <div style={{color:"#475569",fontSize:fontSize-2,marginTop:3}}>
                    {new Date().toLocaleDateString("it-IT",{timeZone:"Europe/Bucharest",weekday:"long",day:"numeric",month:"long"})}
                  </div>
                </div>

                {/* Griglia unica "bento": su desktop tutte le card vivono in
                    un'unica grid a 3 colonne con auto-flow dense, cosi' le
                    card corte (Ora/Meteo/Sospeso/Routine/Peso) riempiono gli
                    spazi lasciati da quelle piu' alte (To Do) invece di
                    impilarsi in righe separate a tutta larghezza — meno
                    scroll verticale, schermo sfruttato per intero. Su
                    mobile resta tutto a colonna singola come prima. */}
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(3,1fr)",gridAutoFlow:isMobile?"row":"dense",gap:12,marginBottom:16}}>
                  <div style={{gridColumn:isMobile?"auto":"span 1"}}><DCard accent="#3B82F6">
                    <DLabel>🕐 Ora</DLabel>
                    <div style={{fontSize:fontSize+12,fontWeight:800,color:T.cardText,letterSpacing:"0.04em",lineHeight:1}}>{clockBucharest}</div>
                    <div style={{fontSize:fontSize-4,color:"#475569",marginTop:3,marginBottom:10}}>Bucarest</div>
                    <div style={{paddingTop:8,borderTop:"1px solid #1A1A2E"}}>
                      <div style={{fontSize:fontSize+2,fontWeight:600,color:"#94A3B8"}}>{clockRome}</div>
                      <div style={{fontSize:fontSize-4,color:"#334155",marginTop:2}}>Roma / Torremaggiore</div>
                    </div>
                    {/* Etichetta di contesto quando il telefono rileva un fuso
                        diverso da quello rumeno (letta dal sistema operativo,
                        nessun permesso richiesto) — l'ora "ufficiale" sopra
                        resta sempre quella di Bucarest. */}
                    {deviceTzLabel && (
                      <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid #1A1A2E",fontSize:fontSize-4,color:"#F59E0B"}}>
                        📍 Sei in {deviceTzLabel.label}, qui sono le {deviceTzLabel.time}
                      </div>
                    )}
                  </DCard></div>
                  <div style={{gridColumn:isMobile?"auto":"span 1"}}><DCard accent="#F59E0B">
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:2}}>
                      <DLabel style={{marginBottom:0}}>🌍 {weather?.city || "Timișoara"}</DLabel>
                      <button onClick={toggleLocalWeather} title="Usa la posizione attuale invece della città fissa"
                        style={{padding:"2px 7px",borderRadius:6,border:`1px solid ${useLocalWeather?"#3B82F6":"#1A1A2E"}`,background:useLocalWeather?"#3B82F620":"transparent",color:useLocalWeather?"#3B82F6":"#475569",cursor:"pointer",fontSize:9,fontWeight:600,flexShrink:0}}>
                        {weatherStatus==="loading" ? "⏳" : "📍"}
                      </button>
                    </div>
                    {weather?(
                      <>
                        <div style={{fontSize:32,lineHeight:1,marginBottom:4}}>{getWeatherEmoji(weather.condition)}</div>
                        <div style={{fontSize:fontSize+12,fontWeight:800,color:T.cardText}}>{weather.temp}°C</div>
                        <div style={{fontSize:fontSize-3,color:"#64748B",marginTop:2,textTransform:"capitalize"}}>{weather.description}</div>
                        <div style={{fontSize:fontSize-4,color:"#334155",marginTop:4}}>💧{weather.humidity}% · 💨{weather.wind}km/h</div>
                      </>
                    ):(
                      <div style={{fontSize:fontSize-2,color:"#334155"}}>{homeLoading?"Caricamento...":"–"}</div>
                    )}
                    {weatherStatus==="denied" && (
                      <div style={{fontSize:fontSize-5,color:"#EF4444",marginTop:6}}>Permesso posizione negato — resto sul meteo fisso.</div>
                    )}
                  </DCard></div>

                  <div style={{gridColumn:isMobile?"auto":"span 2"}}><DCard accent="#8B5CF6" style={{height:"100%"}}>
                    <DLabel>✅ To Do Oggi</DLabel>
                    {homeData.todo.length===0?(
                      <div style={{fontSize:fontSize-2,color:"#334155"}}>{homeLoading?"Caricamento...":"Nessun task 🎉"}</div>
                    ):sortedByPriority(homeData.todo).map(t=>(
                      <TaskItem key={t.id} task={t} color="#8B5CF6" onToggle={id=>toggleTask(id,"todo")} fontSize={fontSize} isChecked={checkedTasks[t.id]}/>
                    ))}
                    <div style={{display:"flex",gap:6,marginTop:homeData.todo.length===0?0:8,paddingTop:8,borderTop:"1px solid #1A1A2E"}}>
                      <input value={newTaskText} onChange={e=>setNewTaskText(e.target.value)}
                        onKeyDown={e=>{if(e.key==="Enter") addTodoTask();}}
                        placeholder="Nuovo task..." disabled={addingTask}
                        style={{flex:1,minWidth:0,padding:"6px 8px",borderRadius:6,border:`1px solid ${T.border}`,background:T.bg,color:T.text,fontSize:fontSize-2,outline:"none"}}/>
                      <button onClick={addTodoTask} disabled={addingTask||!newTaskText.trim()}
                        style={{padding:"6px 14px",borderRadius:6,border:"none",background:"#8B5CF6",color:"#fff",cursor:addingTask||!newTaskText.trim()?"default":"pointer",fontSize:fontSize-2,fontWeight:700,opacity:addingTask||!newTaskText.trim()?0.5:1,flexShrink:0}}>
                        {addingTask?"...":"+"}
                      </button>
                    </div>
                  </DCard></div>

                  <div style={{gridColumn:isMobile?"auto":"span 1"}}><DCard accent="#10B981">
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                      <DLabel style={{marginBottom:0}}>🔄 Routine</DLabel>
                      {routineStreak > 0 && (
                        <span style={{fontSize:fontSize-4,color:"#F97316",fontWeight:700}}>🔥 {routineStreak}g</span>
                      )}
                    </div>
                    {homeData.routine.length===0?(
                      <div style={{fontSize:fontSize-2,color:"#334155"}}>{homeLoading?"Caricamento...":"Nessuna routine"}</div>
                    ):sortedByPriority(homeData.routine).map(t=>(
                      <TaskItem key={t.id} task={t} color="#10B981" onToggle={id=>toggleTask(id,"routine")} fontSize={fontSize} isChecked={checkedTasks[t.id]}/>
                    ))}
                  </DCard></div>

                  {/* In sospeso: stessa card di To Do/Routine, ma qui in Home
                      cosi' Dario la vede ogni giorno senza dover andare nella
                      tab dedicata — l'obiettivo e' controllarla spesso per
                      capire se una task ora si sblocca. */}
                  <div style={{gridColumn:isMobile?"auto":"span 1"}}><DCard accent="#EF4444">
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                      <DLabel style={{marginBottom:0}}>⏸️ In sospeso</DLabel>
                      <button onClick={()=>setView("sospeso")}
                        style={{padding:"2px 8px",borderRadius:6,border:"1px solid #EF444440",background:"transparent",color:"#EF4444",cursor:"pointer",fontSize:10,fontWeight:600}}>
                        Vedi tutte
                      </button>
                    </div>
                    {(!homeData.sospeso || homeData.sospeso.length===0)?(
                      <div style={{fontSize:fontSize-2,color:"#334155"}}>{homeLoading?"Caricamento...":"Nessuna task in sospeso 🎉"}</div>
                    ):sortedByPriority(homeData.sospeso).map(t=>(
                      <TaskItem key={t.id} task={t} color="#EF4444" onToggle={id=>toggleTask(id,"sospeso")} fontSize={fontSize} isChecked={checkedTasks[t.id]}/>
                    ))}
                  </DCard></div>

                  {/* Peso e Revenue: tolti i mini-grafici (non convincevano) —
                      restano i numeri chiave e la barra di progresso, card
                      piu' corte e dirette invece di "quadrettoni" con grafici
                      dentro. */}
                  <div style={{gridColumn:isMobile?"auto":"span 1"}}><DCard accent="#F97316">
                    <DLabel>💪 Progressi Fisici</DLabel>
                    {homeErrors.weight && !homeLoading && (
                      <div style={{fontSize:fontSize-3,color:"#F59E0B",background:"#F59E0B15",border:"1px solid #F59E0B40",borderRadius:6,padding:"4px 8px",marginBottom:6}}>⚠️ dati non aggiornati (ClickUp non raggiungibile)</div>
                    )}
                    {weightData?(
                      <>
                        <div style={{fontSize:fontSize+12,fontWeight:800,color:"#F97316"}}>{weightData.ultimo?.peso}<span style={{fontSize:fontSize-1,fontWeight:400}}> kg</span></div>
                        <div style={{fontSize:fontSize-3,color:"#10B981",marginTop:2}}>−{weightData.persi} kg persi 🔥</div>
                        <div style={{fontSize:fontSize-4,color:"#475569",marginTop:1}}>Mancano {weightData.mancano} kg all'obiettivo</div>
                        <div style={{marginTop:8,height:3,background:"#1A1A2E",borderRadius:2}}>
                          <div style={{height:"100%",background:"#F97316",borderRadius:2,width:`${Math.min(Math.round(((121.6-(weightData.ultimo?.peso||121.6))/(121.6-85))*100),100)}%`,transition:"width 0.4s"}}/>
                        </div>
                        <div style={{fontSize:fontSize-5,color:"#334155",marginTop:3}}>Obiettivo: 85 kg</div>
                        <button onClick={()=>{setWeightInput("");setShowWeightModal(true);}}
                          style={{marginTop:10,width:"100%",padding:"5px 8px",borderRadius:6,border:`1px solid ${T.border}`,background:T.bg,color:T.textDim,fontSize:fontSize-2,textAlign:"left",cursor:"pointer"}}>
                          Registra peso oggi...
                        </button>
                      </>
                    ):(
                      <div style={{fontSize:fontSize-2,color:"#334155"}}>{homeLoading?"Caricamento...":"–"}</div>
                    )}
                  </DCard></div>
                  <div style={{gridColumn:isMobile?"auto":"span 2"}}><DCard accent="#10B981">
                    <DLabel>💶 Revenue IAGREX</DLabel>
                    {homeErrors.revenue && !homeLoading && (
                      <div style={{fontSize:fontSize-3,color:"#F59E0B",background:"#F59E0B15",border:"1px solid #F59E0B40",borderRadius:6,padding:"4px 8px",marginBottom:6}}>⚠️ dati non aggiornati (ClickUp non raggiungibile)</div>
                    )}
                    {revenue?(
                      <>
                        <div style={{display:"flex",alignItems:"baseline",gap:16,flexWrap:"wrap"}}>
                          <div>
                            <div style={{fontSize:fontSize-3,color:"#475569",marginBottom:4}}>{revenue.mese}</div>
                            <div style={{fontSize:fontSize+8,fontWeight:800,color:"#10B981"}}>+{(revenue.entrate_totali||0).toLocaleString("it-IT")}€</div>
                            <div style={{fontSize:fontSize-3,color:"#EF4444",marginTop:2}}>−{(revenue.uscite_totali||0).toLocaleString("it-IT")}€ uscite</div>
                            <div style={{fontSize:fontSize-3,color:"#64748B",marginTop:1}}>Netto: {((revenue.entrate_totali||0)-(revenue.uscite_totali||0)).toLocaleString("it-IT")}€</div>
                          </div>
                          {revenue.ritmo_mensile_necessario != null && (
                            <div style={{marginLeft:"auto"}}>
                              <div style={{fontSize:fontSize-5,color:"#3B82F6",textTransform:"uppercase",letterSpacing:"0.06em"}}>🎯 Ritmo necessario</div>
                              <div style={{fontSize:fontSize+2,fontWeight:800,color:"#3B82F6"}}>
                                {revenue.ritmo_mensile_necessario.toLocaleString("it-IT")}€<span style={{fontSize:fontSize-3,fontWeight:400}}>/mese</span>
                              </div>
                              <div style={{fontSize:fontSize-4,color:"#475569",maxWidth:220}}>
                                per {revenue.mesi_rimanenti} mes{revenue.mesi_rimanenti===1?"e rimanente":"i rimanenti"} verso 1.000.000€
                              </div>
                            </div>
                          )}
                        </div>
                        <div style={{marginTop:8,height:3,background:"#1A1A2E",borderRadius:2}}>
                          <div style={{height:"100%",background:"#10B981",borderRadius:2,width:`${Math.max(revenue.percentuale||0,1)}%`,transition:"width 0.4s"}}/>
                        </div>
                        <div style={{fontSize:fontSize-5,color:"#334155",marginTop:3}}>{revenue.percentuale}% verso 1.000.000€</div>
                        <button onClick={()=>setView("iagrex")}
                          style={{marginTop:10,width:"100%",padding:"6px",borderRadius:7,border:"1px solid #3B82F640",background:"#3B82F610",color:"#3B82F6",cursor:"pointer",fontSize:fontSize-3,fontWeight:600}}>
                          📊 Apri tracking completo
                        </button>
                      </>
                    ):(
                      <div style={{fontSize:fontSize-2,color:"#334155"}}>{homeLoading?"Caricamento...":"–"}</div>
                    )}
                  </DCard></div>

                  {/* Quick nav: gradient pieno invece del tint sottile, per
                      restare coerenti con la direzione "colorato/energico". */}
                  <div style={{gridColumn:isMobile?"auto":"span 1"}}>
                    <button onClick={()=>setView("pipeline")}
                      style={{width:"100%",height:"100%",padding:16,borderRadius:18,border:"none",background:"linear-gradient(135deg,#8B5CF6,#6D28D9)",color:"#fff",cursor:"pointer",textAlign:"left",fontWeight:700,fontSize:fontSize,boxShadow:"0 8px 24px -12px #8B5CF680"}}>
                      🎯 Pipeline<br/>
                      <span style={{fontSize:fontSize-4,fontWeight:400,color:"#EDE9FE"}}>Lead & Clienti · Outreach AI</span>
                    </button>
                  </div>
                  <div style={{gridColumn:isMobile?"auto":"span 2"}}>
                    <button onClick={()=>setView("finanze")}
                      style={{width:"100%",height:"100%",padding:16,borderRadius:18,border:"none",background:"linear-gradient(135deg,#F59E0B,#D97706)",color:"#fff",cursor:"pointer",textAlign:"left",fontWeight:700,fontSize:fontSize,boxShadow:"0 8px 24px -12px #F59E0B80"}}>
                      💰 Finanze<br/>
                      <span style={{fontSize:fontSize-4,fontWeight:400,color:"#FEF3C7"}}>Personali</span>
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* MOBILE BOTTOM NAV */}
      {isMobile && (
        <div style={{display:"flex",background:T.panel,borderTop:`1px solid ${T.border}`,padding:"4px 2px",flexShrink:0,zIndex:100}}>
          {NAV_ITEMS.map(item=>{
            const c = item.color || T.cardText;
            return (
            <button key={item.id} onClick={()=>setView(item.id)}
              style={{flex:1,padding:"6px 2px",borderRadius:8,border:"none",background:view===item.id?T.border:"transparent",color:view===item.id?c:T.textDim,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
              <span style={{fontSize:18}}>{item.icon}</span>
              <span style={{fontSize:8}}>{item.label}</span>
            </button>
            );
          })}
        </div>
      )}

      {/* WEIGHT MODAL */}
      {showWeightModal && (
        <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowWeightModal(false)}>
          <div style={{background:"#0F0F1A",border:"1px solid #1A1A2E",borderRadius:16,padding:24,width:"100%",maxWidth:320}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:14,fontWeight:700,color:"#F8FAFC",marginBottom:16}}>💪 Peso di oggi</div>
            <input autoFocus type="text" inputMode="decimal" placeholder="es. 102.5" value={weightInput}
              onChange={e=>setWeightInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter") saveWeightModal();}}
              style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #334155",background:"#09090F",color:"#E2E8F0",fontSize:18,outline:"none",marginBottom:12}}/>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowWeightModal(false)} style={{flex:1,padding:10,borderRadius:8,border:"1px solid #1A1A2E",background:"transparent",color:"#475569",cursor:"pointer",fontSize:14}}>Annulla</button>
              <button onClick={saveWeightModal} style={{flex:1,padding:10,borderRadius:8,border:"none",background:"#F97316",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:700}}>Salva</button>
            </div>
          </div>
        </div>
      )}

      {/* IDEA MODAL */}
      {/* RITO DEL VENERDÌ: revisione idee "Da valutare" accumulate durante
          la settimana. Per ciascuna, tre scelte esplicite invece di
          lasciarle marcire in una lista che non si riguarda mai. */}
      {showFridayRitual && (
        <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:998,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowFridayRitual(false)}>
          <div style={{background:"#0F0F1A",border:"1px solid #8B5CF640",borderRadius:16,padding:24,width:"100%",maxWidth:480,maxHeight:"80vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
              <div style={{fontSize:14,fontWeight:700,color:"#F8FAFC"}}>🗓️ Rito del venerdì — Idee da rivedere</div>
              <button onClick={()=>setShowFridayRitual(false)} style={{width:26,height:26,borderRadius:6,border:"none",background:"#1A1A2E",color:"#94A3B8",cursor:"pointer",fontSize:13}}>×</button>
            </div>
            <div style={{fontSize:11,color:"#64748B",marginBottom:14}}>Per ognuna: la trasformi in task, la scarti, o la lasci per la prossima volta.</div>
            <div style={{overflowY:"auto",flex:1,display:"flex",flexDirection:"column",gap:10}}>
              {ideas.filter(i=>(i.stato||"Da valutare")==="Da valutare").map(i=>(
                <div key={i.notionId} style={{background:"#09090F",border:"1px solid #1A1A2E",borderRadius:10,padding:12}}>
                  <div style={{fontSize:13,color:"#E2E8F0",lineHeight:1.4,marginBottom:10}}>{i.text}</div>
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={()=>fridayIdeaToTask(i)} disabled={fridayBusyId===i.notionId}
                      style={{flex:1,padding:"7px 0",borderRadius:7,border:"1px solid #10B98140",background:"#10B98115",color:"#10B981",cursor:"pointer",fontSize:11,fontWeight:600}}>
                      ✅ Diventa task
                    </button>
                    <button onClick={()=>fridayIdeaScarta(i)} disabled={fridayBusyId===i.notionId}
                      style={{flex:1,padding:"7px 0",borderRadius:7,border:"1px solid #EF444440",background:"#EF444415",color:"#EF4444",cursor:"pointer",fontSize:11,fontWeight:600}}>
                      🗑️ Scarta
                    </button>
                  </div>
                </div>
              ))}
              {ideas.filter(i=>(i.stato||"Da valutare")==="Da valutare").length===0 && (
                <div style={{fontSize:12,color:"#475569",textAlign:"center",padding:"20px 0"}}>Tutto smaltito 🎉</div>
              )}
            </div>
            <button onClick={()=>setShowFridayRitual(false)} style={{marginTop:14,padding:10,borderRadius:8,border:"1px solid #1A1A2E",background:"transparent",color:"#475569",cursor:"pointer",fontSize:13}}>
              Ignora ancora tutte — richiedi il prossimo venerdì
            </button>
          </div>
        </div>
      )}

      <style>{`
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1A1A2E;border-radius:2px}
        button:hover{filter:brightness(1.08)}
        .dcard:hover{transform:translateY(-3px)}
      `}</style>
    </div>
  );
}
