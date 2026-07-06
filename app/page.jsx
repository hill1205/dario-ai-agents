"use client";
import { useState, useEffect } from "react";
import PipelinePage from "./components/PipelinePage";
import BrunoPage from "./components/BrunoPage";
import IAGREXPage from "./components/IAGREXPage";

const DONE_STATUSES = ["complete","completed","done","chiuso","closed","fatto","completato","completata"];

// "home" non ha un colore fisso: in tema chiaro un bianco pieno sarebbe
// invisibile su sfondo chiaro, quindi il colore effettivo viene risolto
// a runtime in base al tema attivo (vedi NAV_ITEMS_RESOLVED piu' sotto).
const NAV_ITEMS = [
  { id:"home",     icon:"🏠", label:"Dashboard",  color:null },
  { id:"pipeline", icon:"🎯", label:"Pipeline",   color:"#8B5CF6" },
  { id:"finanze",  icon:"💰", label:"Finanze",    color:"#F59E0B" },
  { id:"iagrex",   icon:"📊", label:"IAGREX",     color:"#3B82F6" },
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

// Mini-grafico a barre dell'andamento mensile delle entrate nell'anno in
// corso, verso l'obiettivo 1M€. Niente librerie esterne: un SVG semplice
// basta per far vedere il trend a colpo d'occhio dentro la card Revenue.
function RevenueMiniChart({ data, target }) {
  const W = 220, H = 46, gap = 4;
  const barW = (W - gap * (data.length - 1)) / data.length;
  // La scala include anche il target, cosi' se il ritmo necessario supera
  // le entrate reali la linea tratteggiata resta visibile invece di uscire
  // dal grafico verso l'alto.
  const max = Math.max(...data.map(d => d.entrate), target||0, 1);
  const targetY = target ? H - 12 - (target / max) * (H - 12) : null;
  return (
    <div style={{marginTop:10,paddingTop:8,borderTop:"1px solid #1A1A2E"}}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{display:"block"}}>
        {data.map((d, i) => {
          const h = Math.max((d.entrate / max) * (H - 12), d.entrate > 0 ? 2 : 0);
          const x = i * (barW + gap);
          const isLast = i === data.length - 1;
          return (
            <g key={d.mese}>
              <rect x={x} y={H - 12 - h} width={barW} height={h} rx={1.5}
                fill={isLast ? "#10B981" : "#10B98155"} />
              <text x={x + barW / 2} y={H} textAnchor="middle" fontSize="6" fill="#334155">
                {d.label}
              </text>
            </g>
          );
        })}
        {targetY != null && (
          <line x1={0} y1={targetY} x2={W} y2={targetY} stroke="#3B82F6" strokeWidth="1" strokeDasharray="3,2" />
        )}
      </svg>
      {target != null && (
        <div style={{fontSize:7,color:"#3B82F6",marginTop:2,textAlign:"right"}}>┄ ritmo necessario/mese</div>
      )}
    </div>
  );
}

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
  const [leadDaRicontattare, setLeadDaRicontattare] = useState([]);
  const [inactivityDays, setInactivityDays] = useState(0);
  const [showIdeaModal, setShowIdeaModal]   = useState(false);
  const [ideaText, setIdeaText]             = useState("");
  const [ideas, setIdeas]                   = useState([]);
  const [listening, setListening]           = useState(false);

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
      const ideasRaw = localStorage.getItem("dario-ideas");
      if (ideasRaw) { try { setIdeas(JSON.parse(ideasRaw) || []); } catch {} }
    } catch {}
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
    };
    tick();
    const id=setInterval(tick,1000);
    return ()=>clearInterval(id);
  },[]);

  useEffect(()=>{ if(view==="home") loadHomeData(); },[view]);

  const loadHomeData = async ()=>{
    setHomeLoading(true);
    try {
      // fetchWithRetry assorbe un singolo blip di rete (timeout momentaneo)
      // ritentando una volta prima di arrendersi, cosi' il banner di errore
      // compare solo quando il problema e' persistente e reale.
      const [wRes,tRes,rRes,wgRes,pRes] = await Promise.all([
        fetchWithRetry("/api/weather",{cache:"no-store"}),
        fetchWithRetry("/api/tasks",{cache:"no-store"}),
        fetchWithRetry("/api/revenue",{cache:"no-store"}),
        fetchWithRetry("/api/weight",{cache:"no-store"}),
        fetchWithRetry("/api/pipeline-data",{cache:"no-store"}),
      ]);
      if (wRes&&!wRes.error)  setWeather(wRes);
      if (tRes)               setHomeData(tRes);
      else                    setHomeData({todo:[],routine:[],sospeso:[]});
      if (rRes&&!rRes.error)  setRevenue(rRes);
      if (wgRes&&!wgRes.error) setWeightData(wgRes);
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
      setHomeErrors({
        weather: !wRes || !!wRes.error,
        revenue: !rRes || !!rRes.error,
        weight:  !wgRes || !!wgRes.error,
      });
      setLastUpdated(new Date());
    } catch(e){ console.error("Dashboard error:",e); }
    setHomeLoading(false);
  };

  // Streak routine: se tutte le routine di oggi risultano completate,
  // registriamo il giorno come "fatto" una sola volta e incrementiamo lo
  // streak solo se il giorno precedente registrato e' davvero ieri
  // (altrimenti, se salti un giorno, lo streak si azzera invece di
  // continuare a salire come se nulla fosse).
  useEffect(()=>{
    if (!homeData.routine || homeData.routine.length===0) return;
    const allDone = homeData.routine.every(t=>{
      const cur = checkedTasks[t.id] ?? DONE_STATUSES.includes((t.status?.status||"").toLowerCase());
      return cur;
    });
    if (!allDone) return;
    try {
      const today = todayBucharest();
      const raw = localStorage.getItem("dario-routine-streak");
      const prev = raw ? JSON.parse(raw) : { count:0, lastDate:null };
      if (prev.lastDate === today) return; // già contato oggi
      const yesterday = new Date(Date.now()-86400000).toLocaleDateString("en-CA",{timeZone:"Europe/Bucharest"});
      const newCount = prev.lastDate === yesterday ? (prev.count||0)+1 : 1;
      localStorage.setItem("dario-routine-streak", JSON.stringify({count:newCount,lastDate:today}));
      setRoutineStreak(newCount);
    } catch {}
  },[homeData.routine, checkedTasks]);

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
  // dover aprire una nota separata. Salvate solo in localStorage (nessuna
  // chiamata di rete, nessun costo) — la sync verso ClickUp/Notion si può
  // aggiungere in futuro se serve, per ora è solo un backlog personale.
  const saveIdeasList = (list) => { setIdeas(list); try { localStorage.setItem("dario-ideas", JSON.stringify(list)); } catch {} };
  const addIdea = () => {
    const text = ideaText.trim();
    if (!text) return;
    saveIdeasList([{ id:Date.now().toString(36), text, data:new Date().toISOString() }, ...ideas]);
    setIdeaText("");
  };
  const removeIdea = (id) => saveIdeasList(ideas.filter(i=>i.id!==id));

  // Dettatura vocale gratuita: usa il riconoscimento vocale nativo del
  // browser (Web Speech API, disponibile su Chrome/Edge desktop e Android).
  // Nessuna chiamata API esterna, nessun costo — su Safari/iPhone non è
  // disponibile, ma la tastiera di iOS ha comunque un tasto microfono per
  // dettare direttamente nella casella di testo.
  const speechSupported = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const toggleListening = () => {
    if (!speechSupported) return;
    if (listening) { setListening(false); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "it-IT";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setIdeaText(prev => (prev ? prev + " " : "") + transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    setListening(true);
  };

  const DCard  = ({children,style={}})=>(
    <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:14,padding:16,...style}}>{children}</div>
  );
  const DLabel = ({children,style={}})=>(
    <div style={{fontSize:Math.max(9,fontSize-4),fontWeight:700,color:T.textDim,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10,...style}}>{children}</div>
  );

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
          {view==="finanze"  && <BrunoPage  fontSize={fontSize} theme={theme}/>}
          {view==="pipeline" && <PipelinePage fontSize={fontSize} theme={theme}/>}

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
                  <button onClick={()=>setShowIdeaModal(true)} style={{padding:"4px 10px",borderRadius:7,border:"1px solid #8B5CF640",background:"#8B5CF60D",color:"#8B5CF6",cursor:"pointer",fontSize:11}}>
                    🎙️ Idea
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

                {/* Orologi + Meteo */}
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:10,marginBottom:10}}>
                  <DCard>
                    <DLabel>🕐 Ora</DLabel>
                    <div style={{fontSize:fontSize+12,fontWeight:800,color:T.cardText,letterSpacing:"0.04em",lineHeight:1}}>{clockBucharest}</div>
                    <div style={{fontSize:fontSize-4,color:"#475569",marginTop:3,marginBottom:10}}>Bucarest</div>
                    <div style={{paddingTop:8,borderTop:"1px solid #1A1A2E"}}>
                      <div style={{fontSize:fontSize+2,fontWeight:600,color:"#94A3B8"}}>{clockRome}</div>
                      <div style={{fontSize:fontSize-4,color:"#334155",marginTop:2}}>Roma / Torremaggiore</div>
                    </div>
                  </DCard>
                  <DCard>
                    <DLabel>🌍 Timișoara</DLabel>
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
                  </DCard>
                </div>

                {/* Task */}
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:10,marginBottom:10}}>
                  <DCard>
                    <DLabel>✅ To Do Oggi</DLabel>
                    {homeData.todo.length===0?(
                      <div style={{fontSize:fontSize-2,color:"#334155"}}>{homeLoading?"Caricamento...":"Nessun task 🎉"}</div>
                    ):sortedByPriority(homeData.todo).map(t=>(
                      <TaskItem key={t.id} task={t} color="#8B5CF6" onToggle={id=>toggleTask(id,"todo")} fontSize={fontSize} isChecked={checkedTasks[t.id]}/>
                    ))}
                  </DCard>
                  <DCard>
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
                  </DCard>
                </div>

                {/* Peso + Revenue */}
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:10,marginBottom:16}}>
                  <DCard>
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
                  </DCard>
                  <DCard>
                    <DLabel>💶 Revenue IAGREX</DLabel>
                    {homeErrors.revenue && !homeLoading && (
                      <div style={{fontSize:fontSize-3,color:"#F59E0B",background:"#F59E0B15",border:"1px solid #F59E0B40",borderRadius:6,padding:"4px 8px",marginBottom:6}}>⚠️ dati non aggiornati (ClickUp non raggiungibile)</div>
                    )}
                    {revenue?(
                      <>
                        <div style={{fontSize:fontSize-3,color:"#475569",marginBottom:4}}>{revenue.mese}</div>
                        <div style={{fontSize:fontSize+8,fontWeight:800,color:"#10B981"}}>+{(revenue.entrate_totali||0).toLocaleString("it-IT")}€</div>
                        <div style={{fontSize:fontSize-3,color:"#EF4444",marginTop:2}}>−{(revenue.uscite_totali||0).toLocaleString("it-IT")}€ uscite</div>
                        <div style={{fontSize:fontSize-3,color:"#64748B",marginTop:1}}>Netto: {((revenue.entrate_totali||0)-(revenue.uscite_totali||0)).toLocaleString("it-IT")}€</div>
                        <div style={{marginTop:8,height:3,background:"#1A1A2E",borderRadius:2}}>
                          <div style={{height:"100%",background:"#10B981",borderRadius:2,width:`${Math.max(revenue.percentuale||0,1)}%`,transition:"width 0.4s"}}/>
                        </div>
                        <div style={{fontSize:fontSize-5,color:"#334155",marginTop:3}}>{revenue.percentuale}% verso 1.000.000€</div>
                        {/* Su mobile nascondiamo grafico e dettaglio ritmo per non
                            affollare la card: restano i numeri essenziali + il
                            pulsante per aprire il tracking completo. */}
                        {!isMobile && revenue.storico_mensile && revenue.storico_mensile.length>1 && (
                          <RevenueMiniChart data={revenue.storico_mensile} target={revenue.ritmo_mensile_necessario}/>
                        )}
                        {/* Riformulato per chiarezza: prima si leggeva come "166k€ in
                            totale spalmati su 6 mesi", mentre è una cifra DA RIPETERE
                            ogni singolo mese. Numero grande + "/mese" come unità, e la
                            durata su una riga separata, per togliere l'ambiguità. */}
                        {!isMobile && revenue.ritmo_mensile_necessario != null && (
                          <div style={{marginTop:6,paddingTop:6,borderTop:"1px solid #1A1A2E"}}>
                            <div style={{fontSize:fontSize-5,color:"#3B82F6",textTransform:"uppercase",letterSpacing:"0.06em"}}>🎯 Ritmo necessario</div>
                            <div style={{fontSize:fontSize+2,fontWeight:800,color:"#3B82F6"}}>
                              {revenue.ritmo_mensile_necessario.toLocaleString("it-IT")}€<span style={{fontSize:fontSize-3,fontWeight:400}}>/mese</span>
                            </div>
                            <div style={{fontSize:fontSize-4,color:"#475569"}}>
                              ripetuto per ciascuno dei {revenue.mesi_rimanenti} mes{revenue.mesi_rimanenti===1?"e rimanente":"i rimanenti"} per arrivare a 1.000.000€
                            </div>
                          </div>
                        )}
                        <button onClick={()=>setView("iagrex")}
                          style={{marginTop:10,width:"100%",padding:"6px",borderRadius:7,border:"1px solid #3B82F640",background:"#3B82F610",color:"#3B82F6",cursor:"pointer",fontSize:fontSize-3,fontWeight:600}}>
                          📊 Apri tracking completo
                        </button>
                      </>
                    ):(
                      <div style={{fontSize:fontSize-2,color:"#334155"}}>{homeLoading?"Caricamento...":"–"}</div>
                    )}
                  </DCard>
                </div>

                {/* Quick nav cards */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  <button onClick={()=>setView("pipeline")}
                    style={{padding:14,borderRadius:12,border:"1px solid #8B5CF630",background:"#8B5CF610",color:"#8B5CF6",cursor:"pointer",textAlign:"left",fontWeight:700,fontSize:fontSize-1}}>
                    🎯 Pipeline<br/>
                    <span style={{fontSize:fontSize-4,fontWeight:400,color:"#475569"}}>Lead & Clienti · Outreach AI</span>
                  </button>
                  <button onClick={()=>setView("finanze")}
                    style={{padding:14,borderRadius:12,border:"1px solid #F59E0B30",background:"#F59E0B10",color:"#F59E0B",cursor:"pointer",textAlign:"left",fontWeight:700,fontSize:fontSize-1}}>
                    💰 Finanze<br/>
                    <span style={{fontSize:fontSize-4,fontWeight:400,color:"#475569"}}>Personali</span>
                  </button>
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
      {showIdeaModal && (
        <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowIdeaModal(false)}>
          <div style={{background:"#0F0F1A",border:"1px solid #1A1A2E",borderRadius:16,padding:24,width:"100%",maxWidth:420,maxHeight:"80vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:14,fontWeight:700,color:"#F8FAFC",marginBottom:16}}>🎙️ Idea al volo</div>
            <textarea autoFocus rows={4} placeholder="Scrivi o detta la tua idea..." value={ideaText}
              onChange={e=>setIdeaText(e.target.value)}
              style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #334155",background:"#09090F",color:"#E2E8F0",fontSize:14,outline:"none",marginBottom:12,resize:"vertical",fontFamily:"inherit"}}/>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              {speechSupported && (
                <button onClick={toggleListening}
                  style={{padding:"10px 14px",borderRadius:8,border:`1px solid ${listening?"#EF4444":"#1A1A2E"}`,background:listening?"#EF444420":"transparent",color:listening?"#EF4444":"#94A3B8",cursor:"pointer",fontSize:14}}>
                  {listening?"⏹️ Ascolto...":"🎙️ Detta"}
                </button>
              )}
              <button onClick={()=>setShowIdeaModal(false)} style={{flex:1,padding:10,borderRadius:8,border:"1px solid #1A1A2E",background:"transparent",color:"#475569",cursor:"pointer",fontSize:14}}>Chiudi</button>
              <button onClick={addIdea} style={{flex:1,padding:10,borderRadius:8,border:"none",background:"#8B5CF6",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:700}}>Salva</button>
            </div>
            {ideas.length>0 && (
              <div style={{overflowY:"auto",flex:1,borderTop:"1px solid #1A1A2E",paddingTop:12}}>
                <div style={{fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Da processare ({ideas.length})</div>
                {ideas.map(i=>(
                  <div key={i.id} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:10,fontSize:13,color:"#E2E8F0"}}>
                    <span style={{flex:1,lineHeight:1.4}}>{i.text}</span>
                    <button onClick={()=>removeIdea(i.id)} style={{background:"transparent",border:"none",color:"#475569",cursor:"pointer",fontSize:14,flexShrink:0}}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1A1A2E;border-radius:2px}
        button:hover{filter:brightness(1.08)}
      `}</style>
    </div>
  );
}
