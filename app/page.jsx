"use client";
import { useState, useEffect, useMemo } from "react";
import PipelinePage from "./components/PipelinePage";
import BrunoPage from "./components/BrunoPage";
import ClientiPage from "./components/ClientiPage";
import IAGREXPage from "./components/IAGREXPage";
import IdeasPage from "./components/IdeasPage";
import SimulatorPage from "./components/SimulatorPage";

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
  { id:"simulatore", icon:"🚀", label:"Simulatore 1M€", color:"#EC4899" },
  // "Sospese" non è più una pagina a parte (10/07): le task sospese si
  // vedono e si gestiscono direttamente dalla card in home, come To Do e
  // Routine — una vista in meno da mantenere sincronizzata.
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

// Tema "auto": notte (dark) dalle 21:00 alle 06:59 ora di Bucarest,
// giorno (light) dalle 07:00 alle 20:59. Usiamo sempre il fuso di
// Bucarest (non quello del device) per coerenza con il resto dell'app.
function autoThemeByHour() {
  const hour = Number(new Date().toLocaleString("en-US", { timeZone: "Europe/Bucharest", hour: "2-digit", hour12: false }));
  return (hour >= 21 || hour < 7) ? "dark" : "light";
}

// Scadenze (ClickUp due_date): arrivano come stringa di millisecondi epoch.
// Restituisce {label, state} dove state è "overdue"/"today"/"soon"/null,
// usato per colorare il badge — cosi' una scadenza scaduta salta subito
// all'occhio invece di essere identica a una lontana nel tempo.
function dueDateInfo(dueDateMs) {
  if (!dueDateMs) return null;
  const d = new Date(Number(dueDateMs));
  if (isNaN(d.getTime())) return null;
  const dayStr = d.toLocaleDateString("en-CA", { timeZone: "Europe/Bucharest" });
  const today = todayBucharest();
  const diffDays = Math.round((new Date(dayStr) - new Date(today)) / 86400000);
  const label = d.toLocaleDateString("it-IT", { timeZone: "Europe/Bucharest", day:"numeric", month:"short" });
  let state = null;
  if (diffDays < 0) state = "overdue";
  else if (diffDays === 0) state = "today";
  else if (diffDays <= 2) state = "soon";
  return { label, state, iso: dayStr };
}
const DUE_STATE_COLOR = { overdue:"#FCA5A5", today:"#FEF3C7", soon:"#FEF3C7" };

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

// Card della home ora hanno tutte sfondo a gradiente pieno (10/07, su
// richiesta di Dario) invece del bordo grigio + barra sottile di prima —
// stessa idea grafica dei due bottoni Pipeline/Finanze che c'erano prima
// in fondo alla griglia (ora rimossi, il menu laterale/bottom basta).
const CARD_GRADIENTS = {
  blue:    "linear-gradient(135deg,#3B82F6,#1D4ED8)",
  orange:  "linear-gradient(135deg,#F59E0B,#D97706)",
  purple:  "linear-gradient(135deg,#8B5CF6,#6D28D9)",
  green:   "linear-gradient(135deg,#10B981,#059669)",
  red:     "linear-gradient(135deg,#EF4444,#B91C1C)",
  orange2: "linear-gradient(135deg,#F97316,#C2410C)",
  pink:    "linear-gradient(135deg,#EC4899,#BE185D)",
  teal:    "linear-gradient(135deg,#14B8A6,#0F766E)",
  fuchsia: "linear-gradient(135deg,#D946EF,#A21CAF)",
};

// Testo/checkbox sempre in bianco/trasparenze: le TaskItem vivono adesso
// solo dentro card a sfondo colorato pieno, quindi i grigi scuri di prima
// (pensati per sfondo neutro) sparirebbero per contrasto.
// Scadenza: badge cliccabile che apre un <input type="date"> nativo per
// impostare/spostare la data, e una piccola "×" per rimuoverla — tutto
// dentro la stessa riga del task, niente modal separato. onSetDueDate
// riceve la stringa "YYYY-MM-DD" oppure null (rimozione).
function DueDateBadge({ task, onSetDueDate, fontSize, editing, onToggleEdit }) {
  const info = dueDateInfo(task.due_date);
  const bg = info ? (DUE_STATE_COLOR[info.state] || "rgba(255,255,255,0.25)") : "rgba(255,255,255,0.15)";
  const fg = info?.state === "overdue" || info?.state === "today" || info?.state === "soon" ? "#1A1A2E" : "rgba(255,255,255,0.8)";
  return (
    <span style={{position:"relative",display:"inline-flex",alignItems:"center",flexShrink:0}} onClick={e=>e.stopPropagation()}>
      <button type="button" onClick={onToggleEdit}
        style={{fontSize:Math.max(8,fontSize-5),fontWeight:700,color:fg,background:bg,border:"none",padding:"1px 6px",borderRadius:6,cursor:"pointer",display:"flex",alignItems:"center",gap:3}}>
        📅 {info ? info.label : "scadenza"}
      </button>
      {editing && (
        <span style={{position:"absolute",top:"120%",right:0,zIndex:20,background:"#0F0F1A",border:"1px solid #334155",borderRadius:8,padding:6,display:"flex",gap:4,boxShadow:"0 6px 20px -8px #000000a0"}}>
          <input type="date" defaultValue={info?.iso||""} autoFocus
            onChange={e=>{ onSetDueDate(e.target.value||null); onToggleEdit(); }}
            style={{background:"#09090F",color:"#E2E8F0",border:"1px solid #334155",borderRadius:5,padding:"3px 5px",fontSize:11}}/>
          {info && (
            <button type="button" onClick={()=>{ onSetDueDate(null); onToggleEdit(); }}
              style={{padding:"3px 7px",borderRadius:5,border:"1px solid #EF444450",background:"#EF444415",color:"#EF4444",cursor:"pointer",fontSize:11}}>
              rimuovi
            </button>
          )}
        </span>
      )}
    </span>
  );
}

function TaskItem({ task, color, onToggle, fontSize=14, isChecked, onSetDueDate, onSaveEdit }) {
  const done = isChecked ?? DONE_STATUSES.includes((task.status?.status||"").toLowerCase());
  const prio = task.priority?.priority;
  const [editingDue, setEditingDue] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(task.name);
  const [priorityDraft, setPriorityDraft] = useState(prio || "normal");
  const [dueDateDraft, setDueDateDraft] = useState(dueDateInfo(task.due_date)?.iso || "");

  const startEdit = (e) => {
    e.stopPropagation();
    setNameDraft(task.name);
    setPriorityDraft(prio || "normal");
    setDueDateDraft(dueDateInfo(task.due_date)?.iso || "");
    setEditing(true);
  };
  const saveEdit = () => {
    const trimmed = nameDraft.trim();
    setEditing(false);
    const patch = {};
    if (trimmed && trimmed !== task.name) patch.name = trimmed;
    if (priorityDraft !== (prio || "normal")) patch.priority = priorityDraft;
    const currentIso = dueDateInfo(task.due_date)?.iso || "";
    if (dueDateDraft !== currentIso) patch.dueDate = dueDateDraft || null;
    if (Object.keys(patch).length) onSaveEdit(task.id, patch);
  };

  return (
    <div style={{display:editing?"block":"flex",alignItems:"center",gap:8,marginBottom:8,cursor:editing?"default":"pointer"}} onClick={()=>{if(!editing) onToggle(task.id);}}>
      {editing ? (
        <div onClick={e=>e.stopPropagation()} style={{background:"rgba(0,0,0,0.2)",border:"1px solid rgba(255,255,255,0.3)",borderRadius:8,padding:8}}>
          <input autoFocus value={nameDraft}
            onChange={e=>setNameDraft(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter") saveEdit(); if(e.key==="Escape") setEditing(false); }}
            style={{width:"100%",fontSize,padding:"4px 6px",borderRadius:5,border:"1px solid rgba(255,255,255,0.5)",background:"rgba(0,0,0,0.25)",color:"#fff",outline:"none",marginBottom:8}}/>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",marginBottom:8}}>
            <PriorityDots value={priorityDraft} onChange={setPriorityDraft}/>
            <span style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:9,color:"rgba(255,255,255,0.6)",textTransform:"uppercase",letterSpacing:"0.05em"}}>Scadenza</span>
              <input type="date" value={dueDateDraft} onChange={e=>setDueDateDraft(e.target.value)}
                style={{background:"rgba(0,0,0,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.4)",borderRadius:5,padding:"2px 5px",fontSize:11,colorScheme:"dark"}}/>
            </span>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button type="button" onClick={saveEdit}
              style={{flex:1,padding:"5px 0",borderRadius:6,border:"none",background:"rgba(255,255,255,0.92)",color:"#1A1A2E",cursor:"pointer",fontSize:fontSize-2,fontWeight:700}}>
              Salva
            </button>
            <button type="button" onClick={()=>setEditing(false)}
              style={{flex:1,padding:"5px 0",borderRadius:6,border:"1px solid rgba(255,255,255,0.4)",background:"transparent",color:"#fff",cursor:"pointer",fontSize:fontSize-2}}>
              Annulla
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{width:18,height:18,borderRadius:4,border:"1.5px solid rgba(255,255,255,0.65)",background:done?"rgba(255,255,255,0.92)":"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>
            {done && <span style={{fontSize:11,color,lineHeight:1,fontWeight:700}}>✓</span>}
          </div>
          <span style={{fontSize,color:done?"rgba(255,255,255,0.55)":"#fff",textDecoration:done?"line-through":"none",lineHeight:1.4,flex:1}}>{task.name}</span>
          {!done && prio && PRIORITY_LABEL[prio] && (
            <span style={{fontSize:Math.max(8,fontSize-5),fontWeight:700,color:"#fff",background:"rgba(255,255,255,0.25)",padding:"1px 6px",borderRadius:6,textTransform:"uppercase",letterSpacing:"0.04em",flexShrink:0}}>
              {PRIORITY_LABEL[prio]}
            </span>
          )}
          {onSaveEdit && (
            <button type="button" onClick={startEdit} title="Modifica testo/priorità/scadenza"
              style={{fontSize:Math.max(8,fontSize-5),background:"none",border:"none",color:"rgba(255,255,255,0.55)",cursor:"pointer",padding:"1px 3px",flexShrink:0}}>
              ✏️
            </button>
          )}
          {onSetDueDate && (
            <DueDateBadge task={task} fontSize={fontSize} editing={editingDue}
              onToggleEdit={()=>setEditingDue(v=>!v)}
              onSetDueDate={d=>onSetDueDate(task.id,d)}/>
          )}
        </>
      )}
    </div>
  );
}

// 4 pallini cliccabili per scegliere la priorità mentre si crea un task
// dalla dashboard (to-do/routine/sospeso) — stessi 4 livelli di ClickUp
// (urgent/high/normal/low), colori coerenti con PRIORITY_LABEL altrove.
const PRIORITY_DOTS = [
  { id:"urgent", color:"#EF4444", title:"Urgente" },
  { id:"high",   color:"#F59E0B", title:"Alta" },
  { id:"normal", color:"#3B82F6", title:"Normale" },
  { id:"low",    color:"#94A3B8", title:"Bassa" },
];
function PriorityDots({ value, onChange }) {
  return (
    <div style={{display:"flex",gap:6,alignItems:"center"}}>
      <span style={{fontSize:9,color:"rgba(255,255,255,0.6)",textTransform:"uppercase",letterSpacing:"0.05em",marginRight:2}}>Priorità</span>
      {PRIORITY_DOTS.map(o=>(
        <button key={o.id} type="button" title={o.title} onClick={()=>onChange(o.id)}
          style={{width:16,height:16,borderRadius:"50%",border:value===o.id?"2px solid #fff":"1px solid rgba(255,255,255,0.4)",background:o.color,cursor:"pointer",padding:0,boxShadow:value===o.id?"0 0 0 2px rgba(0,0,0,0.3)":"none",flexShrink:0}}/>
      ))}
    </div>
  );
}

// Riga "aggiungi task" riusata per To Do / Routine / Sospeso: testo +
// priorità, cosi' le tre liste hanno la stessa capacità di creazione che
// prima c'era solo nel To Do (e senza priorità).
function AddTaskRow({ draft, busy, onTextChange, onPriorityChange, onDueDateChange, onSubmit, fontSize }) {
  return (
    <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid rgba(255,255,255,0.25)"}}>
      <div style={{display:"flex",gap:6,marginBottom:6}}>
        <input value={draft.text} onChange={e=>onTextChange(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter") onSubmit();}}
          placeholder="Nuovo task..." disabled={busy}
          style={{flex:1,minWidth:0,padding:"6px 8px",borderRadius:6,border:"1px solid rgba(255,255,255,0.4)",background:"rgba(0,0,0,0.2)",color:"#fff",fontSize:fontSize-2,outline:"none"}}/>
        <button onClick={onSubmit} disabled={busy||!draft.text.trim()}
          style={{padding:"6px 14px",borderRadius:6,border:"none",background:"rgba(255,255,255,0.92)",color:"#1A1A2E",cursor:busy||!draft.text.trim()?"default":"pointer",fontSize:fontSize-2,fontWeight:700,opacity:busy||!draft.text.trim()?0.5:1,flexShrink:0}}>
          {busy?"...":"+"}
        </button>
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
        <PriorityDots value={draft.priority} onChange={onPriorityChange}/>
        <span style={{display:"flex",alignItems:"center",gap:4}}>
          <span style={{fontSize:9,color:"rgba(255,255,255,0.6)",textTransform:"uppercase",letterSpacing:"0.05em"}}>Scadenza</span>
          <input type="date" value={draft.dueDate||""} disabled={busy} onChange={e=>onDueDateChange(e.target.value)}
            style={{background:"rgba(0,0,0,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.4)",borderRadius:5,padding:"2px 5px",fontSize:11,colorScheme:"dark"}}/>
        </span>
      </div>
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
  const [homeData, setHomeData]             = useState({todo:[],routine:[],sospeso:[],claudia:[],annarita:[]});
  const [revenue, setRevenue]               = useState(null);
  const [weightData, setWeightData]         = useState(null);
  const [homeLoading, setHomeLoading]       = useState(false);
  const [homeErrors, setHomeErrors]         = useState({});
  const [syncError, setSyncError]           = useState(null);
  const [lastUpdated, setLastUpdated]       = useState(null);
  const [themeMode, setThemeMode]           = useState("auto"); // "dark" | "light" | "auto"
  const [theme, setTheme]                   = useState("dark"); // tema effettivamente applicato
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
  // Draft di creazione per ciascuna delle tre liste (to-do/routine/sospeso),
  // ognuna con proprio testo + priorità selezionata — prima esisteva solo
  // per il to-do e senza priorità.
  const [taskDrafts, setTaskDrafts]         = useState({
    todo:    { text:"", priority:"normal", dueDate:"" },
    routine: { text:"", priority:"normal", dueDate:"" },
    sospeso: { text:"", priority:"normal", dueDate:"" },
    claudia: { text:"", priority:"normal", dueDate:"" },
    annarita:{ text:"", priority:"normal", dueDate:"" },
  });
  const [addingTaskList, setAddingTaskList] = useState(null); // null | "todo" | "routine" | "sospeso" | "claudia" | "annarita"

  const T = THEMES[theme] || THEMES.dark;

  // Load settings
  useEffect(()=>{
    try {
      const sr = localStorage.getItem("dario-settings");
      if (sr) { const s=JSON.parse(sr); if(s.fontSize) setFontSize(s.fontSize); if(s.themeMode) setThemeMode(s.themeMode); }
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
    try { localStorage.setItem("dario-settings", JSON.stringify({fontSize,themeMode})); } catch {}
  },[fontSize,themeMode]);

  // Risolve il tema effettivo da themeMode: "dark"/"light" sono fissi,
  // "auto" segue l'orario di Bucarest (21:00-06:59 = notte). Ricontrolliamo
  // ogni minuto cosi' l'app cambia tema da sola allo scoccare delle 21/07
  // senza bisogno di un refresh manuale.
  useEffect(()=>{
    function applyAutoTheme() {
      setTheme(themeMode === "auto" ? autoThemeByHour() : themeMode);
    }
    applyAutoTheme();
    if (themeMode !== "auto") return;
    const id = setInterval(applyAutoTheme, 60000);
    return ()=>clearInterval(id);
  },[themeMode]);

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
      else                    setHomeData({todo:[],routine:[],sospeso:[],claudia:[],annarita:[]});
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

  // Crea un nuovo task direttamente su ClickUp (to-do, routine o sospeso,
  // ognuna con priorità scelta dai 4 pallini) e lo aggiunge subito alla
  // card corrispondente, cosi' non serve un refresh manuale per vederlo.
  // Nessuno stato ottimistico "finto": il task in lista è quello che torna
  // indietro da ClickUp, quindi id/priorità sono già reali.
  const addTask = async (list) => {
    const draft = taskDrafts[list];
    const name = draft.text.trim();
    if (!name || addingTaskList) return;
    setAddingTaskList(list);
    try {
      const res = await fetch("/api/create-task",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,list,priority:draft.priority,dueDate:draft.dueDate||undefined})});
      const data = await res.json();
      if (!res.ok || !data.id) throw new Error("create failed");
      setHomeData(prev=>({...prev, [list]:[...(prev[list]||[]), data]}));
      setTaskDrafts(prev=>({...prev, [list]:{ text:"", priority:"normal", dueDate:"" }}));
    } catch (e) {
      setSyncError(`aggiunta "${name}"`);
      setTimeout(()=>setSyncError(null), 5000);
    }
    setAddingTaskList(null);
  };
  const setDraftText = (list,text) => setTaskDrafts(prev=>({...prev,[list]:{...prev[list],text}}));
  const setDraftPriority = (list,priority) => setTaskDrafts(prev=>({...prev,[list]:{...prev[list],priority}}));
  const setDraftDueDate = (list,dueDate) => setTaskDrafts(prev=>({...prev,[list]:{...prev[list],dueDate}}));

  // Imposta/sposta/rimuove la scadenza di un task già esistente (badge 📅
  // dentro TaskItem). Aggiornamento ottimistico come toggleTask: se la
  // scrittura su ClickUp fallisce, si torna al valore precedente invece di
  // mostrare una scadenza che su ClickUp non esiste davvero.
  const setTaskDueDate = async (list, taskId, dueDate) => {
    const prevTask = homeData[list]?.find(t=>t.id===taskId);
    const prevDue = prevTask?.due_date ?? null;
    const optimisticMs = dueDate ? new Date(`${dueDate}T12:00:00`).getTime() : null;
    setHomeData(prev=>({...prev, [list]: prev[list].map(t=>t.id===taskId?{...t,due_date:optimisticMs?String(optimisticMs):null}:t)}));
    try {
      const res = await fetch("/api/update-task",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({taskId,dueDate})});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setHomeData(prev=>({...prev, [list]: prev[list].map(t=>t.id===taskId?{...t,due_date:prevDue}:t)}));
      setSyncError(`scadenza "${prevTask?.name||"task"}"`);
      setTimeout(()=>setSyncError(null), 5000);
    }
  };

  // Pannello di modifica completo (icona ✏️ dentro TaskItem): testo,
  // priorità e scadenza tutti nella stessa modifica, un'unica chiamata a
  // ClickUp invece di tre separate — richiesto da Dario per correggere un
  // task già creato senza doverlo cancellare e ricrearlo da capo, in tutte
  // e cinque le card (to-do/routine/sospeso/claudia/annarita). Stesso
  // pattern ottimistico delle altre modifiche: se ClickUp non risponde,
  // si torna ai valori precedenti.
  const saveTaskEdit = async (list, taskId, patch) => {
    const prevTask = homeData[list]?.find(t=>t.id===taskId);
    if (!prevTask) return;
    const prevValues = {
      name: prevTask.name,
      due_date: prevTask.due_date ?? null,
      priority: prevTask.priority ?? null,
    };
    const optimisticDueMs = patch.dueDate !== undefined
      ? (patch.dueDate ? new Date(`${patch.dueDate}T12:00:00`).getTime() : null)
      : undefined;
    setHomeData(prev=>({...prev, [list]: prev[list].map(t=>{
      if (t.id!==taskId) return t;
      const next = {...t};
      if (patch.name !== undefined) next.name = patch.name;
      if (optimisticDueMs !== undefined) next.due_date = optimisticDueMs ? String(optimisticDueMs) : null;
      if (patch.priority !== undefined) next.priority = patch.priority ? { priority: patch.priority } : null;
      return next;
    })}));
    try {
      const res = await fetch("/api/update-task",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({taskId, ...patch})});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setHomeData(prev=>({...prev, [list]: prev[list].map(t=>t.id===taskId?{...t,name:prevValues.name,due_date:prevValues.due_date,priority:prevValues.priority}:t)}));
      setSyncError(`modifica "${prevValues.name||"task"}"`);
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
  const DCard = useMemo(()=> ({children,style={},accent,gradient})=>(
    <div className="dcard" style={{position:"relative",background:gradient||T.panel,border:gradient?"none":`1px solid ${T.border}`,borderRadius:18,padding:"18px 16px 16px",overflow:"hidden",boxShadow:accent?`0 10px 28px -14px ${accent}70`:"0 6px 16px -10px #00000040",transition:"transform 0.16s ease, box-shadow 0.16s ease",...style}}>
      {accent && !gradient && <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:accent}}/>}
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
        {[["auto","🌗 Auto"],["dark","🌙 Scuro"],["light","☀️ Chiaro"]].map(([id,label])=>(
          <button key={id} onClick={()=>setThemeMode(id)}
            style={{flex:1,padding:"6px 0",borderRadius:6,border:`1px solid ${themeMode===id?"#8B5CF6":"#1A1A2E"}`,background:themeMode===id?"#8B5CF620":"transparent",color:themeMode===id?"#8B5CF6":"#475569",cursor:"pointer",fontSize:10}}>
            {label}
          </button>
        ))}
      </div>
      <div style={{fontSize:9,color:"#334155",marginTop:6,lineHeight:1.4}}>
        {themeMode==="auto" ? "Auto: notte 21:00-07:00, giorno il resto (ora Bucarest)." : "Si applica a tutta l'app."}
      </div>

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
          {view==="simulatore" && <SimulatorPage fontSize={fontSize} onBack={()=>setView("home")} theme={theme}/>}

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

                {/* Layout a righe distinte invece dell'unica grid "dense" di
                    prima (10/07, su richiesta di Dario: "le card task piene
                    disordinano tutto"). Con auto-flow dense, quando To
                    Do/Routine/Sospeso si riempivano di righe le card corte
                    (Ora/Meteo/Peso) venivano risucchiate negli spazi vuoti
                    lasciati e finivano disallineate in punti imprevedibili.
                    Ora ci sono tre righe fisse e indipendenti: statistiche
                    corte, le tre liste task fianco a fianco (ognuna cresce
                    per conto suo senza spostare le altre, alignItems:start
                    evita che si stirino a vicenda), poi Revenue a tutta
                    larghezza. Su mobile resta tutto a colonna singola. */}

                {/* Riga statistiche corte */}
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(3,1fr)",alignItems:"stretch",gap:12,marginBottom:12}}>
                  <div><DCard accent="#3B82F6" gradient={CARD_GRADIENTS.blue} style={{height:"100%"}}>
                    <DLabel style={{color:"rgba(255,255,255,0.85)",fontSize:fontSize-2}}>🕐 Ora</DLabel>
                    <div style={{fontSize:fontSize+22,fontWeight:800,color:"#fff",letterSpacing:"0.04em",lineHeight:1}}>{clockBucharest}</div>
                    <div style={{fontSize:fontSize,color:"rgba(255,255,255,0.75)",marginTop:6,marginBottom:16}}>Bucarest</div>
                    <div style={{paddingTop:12,borderTop:"1px solid rgba(255,255,255,0.25)"}}>
                      <div style={{fontSize:fontSize+10,fontWeight:700,color:"#fff"}}>{clockRome}</div>
                      <div style={{fontSize:fontSize,color:"rgba(255,255,255,0.7)",marginTop:3}}>Roma / Torremaggiore</div>
                    </div>
                    {/* Etichetta di contesto quando il telefono rileva un fuso
                        diverso da quello rumeno (letta dal sistema operativo,
                        nessun permesso richiesto) — l'ora "ufficiale" sopra
                        resta sempre quella di Bucarest. */}
                    {deviceTzLabel && (
                      <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid rgba(255,255,255,0.25)",fontSize:fontSize-1,color:"#FEF3C7"}}>
                        📍 Sei in {deviceTzLabel.label}, qui sono le {deviceTzLabel.time}
                      </div>
                    )}
                  </DCard></div>
                  <div><DCard accent="#F59E0B" gradient={CARD_GRADIENTS.orange} style={{height:"100%"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                      <DLabel style={{marginBottom:0,color:"rgba(255,255,255,0.85)",fontSize:fontSize-2}}>🌍 {weather?.city || "Timișoara"}</DLabel>
                      <button onClick={toggleLocalWeather} title="Usa la posizione attuale invece della città fissa"
                        style={{padding:"3px 9px",borderRadius:6,border:`1px solid rgba(255,255,255,${useLocalWeather?0.9:0.35})`,background:useLocalWeather?"rgba(255,255,255,0.25)":"transparent",color:"#fff",cursor:"pointer",fontSize:11,fontWeight:600,flexShrink:0}}>
                        {weatherStatus==="loading" ? "⏳" : "📍"}
                      </button>
                    </div>
                    {weather?(
                      <>
                        <div style={{fontSize:48,lineHeight:1,marginBottom:8}}>{getWeatherEmoji(weather.condition)}</div>
                        <div style={{fontSize:fontSize+22,fontWeight:800,color:"#fff"}}>{weather.temp}°C</div>
                        <div style={{fontSize:fontSize+2,color:"rgba(255,255,255,0.85)",marginTop:4,textTransform:"capitalize"}}>{weather.description}</div>
                        <div style={{fontSize:fontSize,color:"rgba(255,255,255,0.7)",marginTop:8}}>💧{weather.humidity}% · 💨{weather.wind}km/h</div>
                      </>
                    ):(
                      <div style={{fontSize:fontSize-2,color:"rgba(255,255,255,0.6)"}}>{homeLoading?"Caricamento...":"–"}</div>
                    )}
                    {weatherStatus==="denied" && (
                      <div style={{fontSize:fontSize-3,color:"#FEE2E2",marginTop:8}}>Permesso posizione negato — resto sul meteo fisso.</div>
                    )}
                  </DCard></div>

                  <div><DCard accent="#F97316" gradient={CARD_GRADIENTS.orange2} style={{height:"100%"}}>
                    <DLabel style={{color:"rgba(255,255,255,0.85)",fontSize:fontSize-2}}>💪 Progressi Fisici</DLabel>
                    {homeErrors.weight && !homeLoading && (
                      <div style={{fontSize:fontSize-3,color:"#FEF3C7",background:"rgba(0,0,0,0.22)",border:"1px solid rgba(255,255,255,0.35)",borderRadius:6,padding:"4px 8px",marginBottom:6}}>⚠️ dati non aggiornati (ClickUp non raggiungibile)</div>
                    )}
                    {weightData?(
                      <>
                        <div style={{fontSize:fontSize+22,fontWeight:800,color:"#fff"}}>{weightData.ultimo?.peso}<span style={{fontSize:fontSize+4,fontWeight:400}}> kg</span></div>
                        <div style={{fontSize:fontSize+2,color:"#D1FAE5",marginTop:4}}>−{weightData.persi} kg persi 🔥</div>
                        <div style={{fontSize:fontSize,color:"rgba(255,255,255,0.75)",marginTop:2}}>Mancano {weightData.mancano} kg all'obiettivo</div>
                        <div style={{marginTop:12,height:5,background:"rgba(255,255,255,0.25)",borderRadius:3}}>
                          <div style={{height:"100%",background:"#fff",borderRadius:3,width:`${Math.min(Math.round(((121.6-(weightData.ultimo?.peso||121.6))/(121.6-85))*100),100)}%`,transition:"width 0.4s"}}/>
                        </div>
                        <div style={{fontSize:fontSize-2,color:"rgba(255,255,255,0.65)",marginTop:5}}>Obiettivo: 85 kg</div>
                        <button onClick={()=>{setWeightInput("");setShowWeightModal(true);}}
                          style={{marginTop:14,width:"100%",padding:"7px 8px",borderRadius:6,border:"1px solid rgba(255,255,255,0.4)",background:"rgba(0,0,0,0.15)",color:"#fff",fontSize:fontSize,textAlign:"left",cursor:"pointer"}}>
                          Registra peso oggi...
                        </button>
                      </>
                    ):(
                      <div style={{fontSize:fontSize-2,color:"rgba(255,255,255,0.6)"}}>{homeLoading?"Caricamento...":"–"}</div>
                    )}
                  </DCard></div>
                </div>

                {/* Riga task: To Do, Routine, In sospeso fianco a fianco,
                    3 colonne uguali con alignItems:start — ognuna cresce
                    in verticale per conto proprio senza stirare o spostare
                    le altre due quando si riempie. */}
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(3,1fr)",alignItems:"start",gap:12,marginBottom:12}}>
                  <div><DCard accent="#8B5CF6" gradient={CARD_GRADIENTS.purple}>
                    <DLabel style={{color:"rgba(255,255,255,0.85)"}}>✅ To Do Oggi</DLabel>
                    {homeData.todo.length===0?(
                      <div style={{fontSize:fontSize-2,color:"rgba(255,255,255,0.6)"}}>{homeLoading?"Caricamento...":"Nessun task 🎉"}</div>
                    ):sortedByPriority(homeData.todo).map(t=>(
                      <TaskItem key={t.id} task={t} color="#6D28D9" onToggle={id=>toggleTask(id,"todo")} fontSize={fontSize} isChecked={checkedTasks[t.id]} onSetDueDate={(id,d)=>setTaskDueDate("todo",id,d)} onSaveEdit={(id,patch)=>saveTaskEdit("todo",id,patch)}/>
                    ))}
                    <AddTaskRow draft={taskDrafts.todo} busy={addingTaskList==="todo"}
                      onTextChange={v=>setDraftText("todo",v)} onPriorityChange={p=>setDraftPriority("todo",p)} onDueDateChange={d=>setDraftDueDate("todo",d)}
                      onSubmit={()=>addTask("todo")} fontSize={fontSize}/>
                  </DCard></div>

                  <div><DCard accent="#10B981" gradient={CARD_GRADIENTS.green}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                      <DLabel style={{marginBottom:0,color:"rgba(255,255,255,0.85)"}}>🔄 Routine</DLabel>
                      {routineStreak > 0 && (
                        <span style={{fontSize:fontSize-4,color:"#FED7AA",fontWeight:700}}>🔥 {routineStreak}g</span>
                      )}
                    </div>
                    {homeData.routine.length===0?(
                      <div style={{fontSize:fontSize-2,color:"rgba(255,255,255,0.6)"}}>{homeLoading?"Caricamento...":"Nessuna routine"}</div>
                    ):sortedByPriority(homeData.routine).map(t=>(
                      <TaskItem key={t.id} task={t} color="#059669" onToggle={id=>toggleTask(id,"routine")} fontSize={fontSize} isChecked={checkedTasks[t.id]} onSetDueDate={(id,d)=>setTaskDueDate("routine",id,d)} onSaveEdit={(id,patch)=>saveTaskEdit("routine",id,patch)}/>
                    ))}
                    <AddTaskRow draft={taskDrafts.routine} busy={addingTaskList==="routine"}
                      onTextChange={v=>setDraftText("routine",v)} onPriorityChange={p=>setDraftPriority("routine",p)} onDueDateChange={d=>setDraftDueDate("routine",d)}
                      onSubmit={()=>addTask("routine")} fontSize={fontSize}/>
                  </DCard></div>

                  {/* In sospeso: stessa card di To Do/Routine, ora anche con
                      la stessa possibilità di crearne di nuove — non serve
                      più una pagina a parte, sparita su richiesta di Dario
                      (10/07): tutto vive qui. */}
                  <div><DCard accent="#EF4444" gradient={CARD_GRADIENTS.red}>
                    <DLabel style={{color:"rgba(255,255,255,0.85)"}}>⏸️ In sospeso</DLabel>
                    {(!homeData.sospeso || homeData.sospeso.length===0)?(
                      <div style={{fontSize:fontSize-2,color:"rgba(255,255,255,0.6)"}}>{homeLoading?"Caricamento...":"Nessuna task in sospeso 🎉"}</div>
                    ):sortedByPriority(homeData.sospeso).map(t=>(
                      <TaskItem key={t.id} task={t} color="#B91C1C" onToggle={id=>toggleTask(id,"sospeso")} fontSize={fontSize} isChecked={checkedTasks[t.id]} onSetDueDate={(id,d)=>setTaskDueDate("sospeso",id,d)} onSaveEdit={(id,patch)=>saveTaskEdit("sospeso",id,patch)}/>
                    ))}
                    <AddTaskRow draft={taskDrafts.sospeso} busy={addingTaskList==="sospeso"}
                      onTextChange={v=>setDraftText("sospeso",v)} onPriorityChange={p=>setDraftPriority("sospeso",p)} onDueDateChange={d=>setDraftDueDate("sospeso",d)}
                      onSubmit={()=>addTask("sospeso")} fontSize={fontSize}/>
                  </DCard></div>
                </div>

                {/* To Do Claudia / To Do Annarita: stesse card di To Do/Routine,
                    stesse due liste ClickUp dedicate create nella cartella BEA
                    (10/07, su richiesta di Dario). Riga separata invece che
                    forzare la griglia da 3 a 5 colonne, cosi' su desktop
                    restano leggibili fianco a fianco senza rimpicciolirsi troppo. */}
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(2,1fr)",alignItems:"start",gap:12,marginBottom:12}}>
                  <div><DCard accent="#D946EF" gradient={CARD_GRADIENTS.fuchsia}>
                    <DLabel style={{color:"rgba(255,255,255,0.85)"}}>📋 To Do Claudia</DLabel>
                    {(!homeData.claudia || homeData.claudia.length===0)?(
                      <div style={{fontSize:fontSize-2,color:"rgba(255,255,255,0.6)"}}>{homeLoading?"Caricamento...":"Nessun task 🎉"}</div>
                    ):sortedByPriority(homeData.claudia).map(t=>(
                      <TaskItem key={t.id} task={t} color="#A21CAF" onToggle={id=>toggleTask(id,"claudia")} fontSize={fontSize} isChecked={checkedTasks[t.id]} onSetDueDate={(id,d)=>setTaskDueDate("claudia",id,d)} onSaveEdit={(id,patch)=>saveTaskEdit("claudia",id,patch)}/>
                    ))}
                    <AddTaskRow draft={taskDrafts.claudia} busy={addingTaskList==="claudia"}
                      onTextChange={v=>setDraftText("claudia",v)} onPriorityChange={p=>setDraftPriority("claudia",p)} onDueDateChange={d=>setDraftDueDate("claudia",d)}
                      onSubmit={()=>addTask("claudia")} fontSize={fontSize}/>
                  </DCard></div>

                  <div><DCard accent="#EC4899" gradient={CARD_GRADIENTS.pink}>
                    <DLabel style={{color:"rgba(255,255,255,0.85)"}}>📋 To Do Annarita</DLabel>
                    {(!homeData.annarita || homeData.annarita.length===0)?(
                      <div style={{fontSize:fontSize-2,color:"rgba(255,255,255,0.6)"}}>{homeLoading?"Caricamento...":"Nessun task 🎉"}</div>
                    ):sortedByPriority(homeData.annarita).map(t=>(
                      <TaskItem key={t.id} task={t} color="#BE185D" onToggle={id=>toggleTask(id,"annarita")} fontSize={fontSize} isChecked={checkedTasks[t.id]} onSetDueDate={(id,d)=>setTaskDueDate("annarita",id,d)} onSaveEdit={(id,patch)=>saveTaskEdit("annarita",id,patch)}/>
                    ))}
                    <AddTaskRow draft={taskDrafts.annarita} busy={addingTaskList==="annarita"}
                      onTextChange={v=>setDraftText("annarita",v)} onPriorityChange={p=>setDraftPriority("annarita",p)} onDueDateChange={d=>setDraftDueDate("annarita",d)}
                      onSubmit={()=>addTask("annarita")} fontSize={fontSize}/>
                  </DCard></div>
                </div>

                {/* Revenue IAGREX rimossa dalla home (10/07, su richiesta di
                    Dario): ha già la pagina dedicata IAGREX per quello.
                    Card Calendario (iframe Google Calendar) provata e poi
                    tolta di nuovo (10/07): il calendario Workspace
                    houseofcreators.com mostrava solo "Non disponibile" al
                    posto dei titoli reali delle call — la condivisione
                    pubblica era limitata a "vedi solo occupato/libero"
                    invece che "tutti i dettagli", probabile blocco lato
                    admin del dominio. Da rivalutare se Dario sblocca la
                    condivisione o passa a un calendario personale. */}
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
