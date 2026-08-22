"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { localISODate } from "./lib/finance-ui";
import PipelinePage, { STAGE_PROBABILITY } from "./components/PipelinePage";
import BrunoPage from "./components/BrunoPage";
import ClientiPage from "./components/ClientiPage";
import IAGREXPage from "./components/IAGREXPage";
import DecisionsPage from "./components/DecisionsPage";
import LearningPage from "./components/LearningPage";
import SimulatorPage from "./components/SimulatorPage";
import CalculatorPage from "./components/CalculatorPage";
import HabitsPage from "./components/HabitsPage";
import LucchettoSettings from "./components/LucchettoSettings";
import BloccoSchermo from "./components/BloccoSchermo";

const DONE_STATUSES = ["complete","completed","done","chiuso","closed","fatto","completato","completata"];

// "home" non ha un colore fisso: in tema chiaro un bianco pieno sarebbe
// invisibile su sfondo chiaro, quindi il colore effettivo viene risolto
// a runtime in base al tema attivo (vedi NAV_ITEMS_RESOLVED piu' sotto).
const NAV_ITEMS = [
  { id:"home",     icon:"🏠", label:"Dashboard",  color:null },
  // Abitudini (04/08): il tracking per singola routine. In home lo streak
  // dice solo "tutte fatte sì/no"; qui si vede QUALE abitudine salti.
  { id:"abitudini", icon:"✅", label:"Abitudini", color:"#F97316" },
  { id:"pipeline", icon:"🎯", label:"Pipeline",   color:"#8B5CF6" },
  { id:"clienti",  icon:"👥", label:"Clienti",    color:"#10B981" },
  { id:"finanze",  icon:"💰", label:"Finanze",    color:"#F59E0B" },
  { id:"iagrex",   icon:"📊", label:"IAGREX",     color:"#3B82F6" },
  { id:"simulatore", icon:"🚀", label:"Simulatore 1M€", breve:"1M€", color:"#EC4899" },
  { id:"calcolatrice", icon:"🧮", label:"Calcolatrice", breve:"Calc", color:"#14B8A6" },
  // "Sospese" non è più una pagina a parte (10/07): le task sospese si
  // vedono e si gestiscono direttamente dalla card in home, come To Do e
  // Routine — una vista in meno da mantenere sincronizzata.
  // "Idee" è stata rimossa il 07/08: pagina mai usata in due mesi, e ogni
  // pagina viva costa manutenzione. Al suo posto entra "Decisioni", che ha
  // lo scopo opposto — non catturare pensieri al volo, ma obbligare a
  // motivare per iscritto le scelte importanti e poi tornarci sopra.
  { id:"decisioni", icon:"⚖️", label:"Decisioni", breve:"Decis.", color:"#8B5CF6" },
  // Apprendimento (07/08): archivio di quello che impara, alimentato
  // incollando conversazioni coi chatbot. Sta accanto a Decisioni perché
  // sono le due pagine "riflessive" — una traccia cosa scegli, l'altra
  // cosa impari — ma non hanno dati in comune.
  { id:"apprendimento", icon:"📚", label:"Apprendimento", breve:"Studio", color:"#06B6D4" },
];

// Ordine della barra mobile (14/08, deciso da Dario). Sul telefono la
// sequenza non e' quella del desktop: prima quello che apre ogni giorno
// (Dashboard, Abitudini), poi il blocco soldi (IAGREX, Finanze, Calc), poi
// il commerciale (Pipeline, Clienti, 1M€), infine le due pagine riflessive
// (Decisioni, Studio). Non tocca la sidebar desktop, che resta com'era.
// E' una lista di id: se un giorno aggiungi una voce a NAV_ITEMS e ti
// dimentichi di metterla qui, finisce comunque in fondo invece di sparire.
const MOBILE_NAV_ORDER = ["home","abitudini","iagrex","finanze","calcolatrice","pipeline","clienti","simulatore","decisioni","apprendimento"];
const NAV_ITEMS_MOBILE = [...NAV_ITEMS].sort((a,b)=>{
  const ia = MOBILE_NAV_ORDER.indexOf(a.id), ib = MOBILE_NAV_ORDER.indexOf(b.id);
  return (ia<0?999:ia) - (ib<0?999:ib);
});

// "breve" e' l'etichetta usata SOLO nella barra mobile. Con dieci voci in
// fondo allo schermo ognuna ha una cinquantina di pixel: "Apprendimento" a
// 8px non ci sta e veniva tagliato a meta'. Dove manca si usa "label",
// che per le voci corte (Pipeline, Clienti, Finanze) va gia' bene.

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
// Sessione scaduta: il middleware risponde 401 alle chiamate API invece di
// mandare una redirect, perche' una pagina HTML che arriva dentro una fetch()
// diventerebbe un errore di parsing incomprensibile. Al 401 ci pensiamo qui,
// una volta sola per tutte le chiamate: si va al login ricordando dov'eravamo.
// Senza questo, un cookie scaduto si manifesterebbe come una dashboard piena
// di errori invece che come una richiesta di password.
function alLogin() {
  if (typeof window === "undefined") return;
  const da = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(`/login?da=${da}`);
}

async function fetchWithRetry(url, opts={}) {
  try {
    const r = await fetch(url, opts);
    if (r.status === 401) { alLogin(); return null; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch {
    await new Promise(res=>setTimeout(res,500));
    try {
      const r2 = await fetch(url, opts);
      if (r2.status === 401) { alLogin(); return null; }
      if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
      return await r2.json();
    } catch { return null; }
  }
}

function todayBucharest() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Bucharest" }); // YYYY-MM-DD
}

// --- Tema "auto": chiaro dall'alba al tramonto -------------------------
//
// Prima erano due orari fissi (21:00 e 07:00 ora di Bucarest), che d'inverno
// tenevano l'app chiara col buio pesto delle 17 e d'estate scura mentre fuori
// c'era ancora sole alle 20:30. Ora alba e tramonto sono calcolati davvero,
// dalle coordinate e dalla data.
//
// Il calcolo e' locale (nessuna chiamata di rete, funziona anche offline):
// e' l'algoritmo NOAA nella forma divulgata da Wikipedia, precisione di
// qualche minuto — piu' che sufficiente per decidere un colore di sfondo.
const LAT_DEFAULT = 45.7489, LON_DEFAULT = 21.2087; // Timișoara

function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180;
  // Attenzione al segno: il mezzogiorno solare si sposta di 4 minuti per
  // grado di longitudine, quindi invertirlo sbaglia l'alba di ~3 ore a
  // Timișoara (verificato: con il segno opposto usciva alle 09:33 invece che
  // alle 06:43). Con questa forma i valori tornano — Roma 22/08: 06:25 e
  // 20:01, contro i 06:31 e 20:00 reali.
  const lw = lon;
  const jDate = date.getTime() / 86400000 + 2440587.5;      // giorno giuliano
  const n = Math.round(jDate - 2451545.0 + 0.0008);         // giorno solare
  const jStar = n - lw / 360;                               // mezzogiorno solare medio
  const M = (357.5291 + 0.98560028 * jStar) % 360;          // anomalia media del Sole
  const C = 1.9148*Math.sin(M*rad) + 0.02*Math.sin(2*M*rad) + 0.0003*Math.sin(3*M*rad);
  const lambda = (M + C + 180 + 102.9372) % 360;            // longitudine eclittica
  const jTransit = 2451545.0 + jStar + 0.0053*Math.sin(M*rad) - 0.0069*Math.sin(2*lambda*rad);
  const delta = Math.asin(Math.sin(lambda*rad) * Math.sin(23.44*rad)); // declinazione
  // -0.833° tiene conto del raggio del disco solare e della rifrazione
  // atmosferica: e' l'istante in cui il bordo del Sole tocca l'orizzonte.
  const cosOmega = (Math.sin(-0.833*rad) - Math.sin(lat*rad)*Math.sin(delta)) / (Math.cos(lat*rad)*Math.cos(delta));
  // Oltre il circolo polare il Sole puo' non sorgere o non tramontare
  // affatto: in quel caso non c'e' un'alba da calcolare.
  if (cosOmega > 1 || cosOmega < -1) return null;
  const omega = Math.acos(cosOmega) / rad;
  const toDate = (j) => new Date((j - 2440587.5) * 86400000);
  return { alba: toDate(jTransit - omega/360), tramonto: toDate(jTransit + omega/360) };
}

// Ripiego se il calcolo non e' possibile (sole di mezzanotte, notte polare):
// i vecchi orari fissi sull'ora di Bucarest.
function autoThemeByHour() {
  const hour = Number(new Date().toLocaleString("en-US", { timeZone: "Europe/Bucharest", hour: "2-digit", hour12: false }));
  return (hour >= 21 || hour < 7) ? "dark" : "light";
}

// Il confronto e' fra istanti assoluti, non fra orologi: qualunque fuso
// abbia il telefono, "adesso" e "il tramonto di oggi qui" sono due momenti
// sulla stessa linea del tempo. Per questo funziona anche in viaggio.
function autoThemeBySun(lat, lon, now = new Date()) {
  const t = sunTimes(now, lat ?? LAT_DEFAULT, lon ?? LON_DEFAULT);
  if (!t) return autoThemeByHour();
  return (now >= t.alba && now < t.tramonto) ? "light" : "dark";
}

// Scadenze (ClickUp due_date): arrivano come stringa di millisecondi epoch.
// Restituisce {label, state} dove state è "overdue"/"today"/"soon"/null,
// usato per colorare il badge — cosi' una scadenza scaduta salta subito
// all'occhio invece di essere identica a una lontana nel tempo.
function dueDateInfo(dueDateMs) {
  if (!dueDateMs) return null;
  const d = new Date(Number(dueDateMs));
  if (isNaN(d.getTime())) return null;
  // Guardia sulle date corrotte lato ClickUp. Il task "Attendere Simona per
  // fatture Opencode" aveva due_date = -62085822264000 (anno 2 d.C.): isNaN
  // non scatta perche' la data e' formalmente valida, ma en-CA la rende come
  // "2-07-31" — anno NON paddato — e new Date("2-07-31") la reinterpreta come
  // 2031-07-31. Risultato: in home compariva un badge "📅 31 lug" del tutto
  // inventato, senza nessun segnale di scaduta. Fuori da questa finestra la
  // data non e' un dato, e' spazzatura: meglio nessun badge che uno falso.
  const anno = d.getUTCFullYear();
  if (anno < 2000 || anno > 2100) return null;
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
  // Barra mobile scorrevole: quando cambio pagina porto la voce attiva in
  // vista da solo. Senza questo, aprendo "Studio" (ultima delle dieci) il
  // tasto evidenziato resta fuori schermo e sembra che non sia successo nulla.
  const mobileNavRef = useRef(null);
  useEffect(()=>{
    const bar = mobileNavRef.current;
    if(!bar) return;
    const btn = bar.querySelector(`[data-nav="${view}"]`);
    btn?.scrollIntoView({behavior:"smooth",inline:"center",block:"nearest"});
  },[view,isMobile]);
  const [checkedTasks, setCheckedTasks]   = useState({});
  const [showWeightModal, setShowWeightModal] = useState(false);
  const [weightInput, setWeightInput]     = useState("");

  const [clockBucharest, setClockBucharest] = useState("--:--:--");
  const [clockRome, setClockRome]           = useState("--:--");
  const [weather, setWeather]               = useState(null);
  const [homeData, setHomeData]             = useState({todo:[],routine:[],sospeso:[],claudia:[],annarita:[]});
  const [weightData, setWeightData]         = useState(null);
  const [homeLoading, setHomeLoading]       = useState(false);
  const [homeErrors, setHomeErrors]         = useState({});
  const [syncError, setSyncError]           = useState(null);
  const [lastUpdated, setLastUpdated]       = useState(null);
  const [themeMode, setThemeMode]           = useState("auto"); // "dark" | "light" | "auto"
  // Coordinate usate per alba e tramonto. Di base Timișoara; se il meteo
  // sulla posizione attuale e' attivo (permesso gia' concesso) si aggiornano
  // da sole, cosi' in viaggio il tema segue il sole del posto dove sei.
  const [coords, setCoords]                 = useState(null); // {lat, lon} | null
  const [sole, setSole]                     = useState(null); // {alba, tramonto} di oggi
  const [theme, setTheme]                   = useState("dark"); // tema effettivamente applicato
  const [routineStreak, setRoutineStreak]   = useState(0);
  const [streakHistory, setStreakHistory]   = useState([]); // ultimi 30 giorni, da ClickUp
  const [leadDaRicontattare, setLeadDaRicontattare] = useState([]);
  // Valore della pipeline aperta (lordo + ponderato per probabilità di
  // chiusura): portato in home perché è il numero che collega la Pipeline
  // all'obiettivo 1M€ — quanto MRR potenziale sta maturando nelle trattative.
  const [pipelineStats, setPipelineStats] = useState(null); // {leads, lordo, ponderato}
  const [inactivityDays, setInactivityDays] = useState(0);
  // Revisioni in scadenza: solo il conteggio, non l'elenco. Serve al banner
  // in home e al badge sul tab — l'elenco vero lo carica la pagina
  // Decisioni quando ci arrivi. Un conteggio è una riga di JSON, tenerlo
  // qui non pesa; tenere qui tutte le decisioni sì.
  //
  // Conta le REVISIONI e non le decisioni: una stessa decisione può averne
  // tre, e se hai saltato quella di un mese mentre arrivava quella di sei
  // mesi sono due cose da scrivere, non una.
  const [decisioniDaRivedere, setDecisioniDaRivedere] = useState(0);
  const [backupStatus, setBackupStatus]     = useState(null); // null | "loading" | "done" | "error"
  const [deviceTzLabel, setDeviceTzLabel]   = useState(null); // {label,time} se il device è in un fuso diverso da Bucarest
  const [useLocalWeather, setUseLocalWeather] = useState(false);
  const [weatherStatus, setWeatherStatus]   = useState(null); // null | "loading" | "denied" | "error"
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

  // Il body ha sempre avuto lo sfondo bianco di default: finche' il
  // contenitore dell'app copriva tutto lo schermo non si vedeva, ma con le
  // safe area scoperte (viewport-fit=cover) sotto la barra di navigazione
  // resta una striscia alta quanto la barretta home dell'iPhone, e li' il
  // bianco spuntava fuori. Lo tingiamo del colore del tema attivo.
  useEffect(()=>{
    // Colore della barra (T.panel) e non dello sfondo: cosi' la striscia
    // sotto il menu sembra la continuazione del menu stesso, invece di un
    // gradino di colore diverso.
    document.body.style.background = T.panel;
    document.documentElement.style.background = T.panel;
  },[T.panel]);

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
      const c = localStorage.getItem("dario-coords");
      if (c) { const p = JSON.parse(c); if (typeof p?.lat === "number" && typeof p?.lon === "number") setCoords(p); }
    } catch {}
    caricaDecisioniDaRivedere();
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
  // "auto" segue alba e tramonto del posto dove sei. Ricontrolliamo ogni
  // minuto, cosi' l'app cambia da sola al tramonto senza refresh.
  useEffect(()=>{
    function applyAutoTheme() {
      setTheme(themeMode === "auto" ? autoThemeBySun(coords?.lat, coords?.lon) : themeMode);
      // Orari mostrati nelle Impostazioni. Si calcolano qui e non durante il
      // render: un valore che dipende dall'ora corrente, calcolato mentre si
      // disegna, differisce fra server e browser e rompe l'idratazione.
      const t = sunTimes(new Date(), coords?.lat ?? LAT_DEFAULT, coords?.lon ?? LON_DEFAULT);
      const fmtOra = (d) => d.toLocaleTimeString("it-IT", { hour:"2-digit", minute:"2-digit" });
      const nuovo = t ? { alba: fmtOra(t.alba), tramonto: fmtOra(t.tramonto) } : null;
      setSole(prev => (prev?.alba === nuovo?.alba && prev?.tramonto === nuovo?.tramonto) ? prev : nuovo);
    }
    applyAutoTheme();
    if (themeMode !== "auto") return;
    const id = setInterval(applyAutoTheme, 60000);
    return ()=>clearInterval(id);
  },[themeMode, coords]);

  useEffect(()=>{
    const check = ()=>setIsMobile(window.innerWidth<640);
    check();
    window.addEventListener("resize",check);
    return ()=>window.removeEventListener("resize",check);
  },[]);

  // FIX Android: la bottom nav era invisibile su alcuni browser Android.
  // Il root usava height:100dvh, ma dove dvh non è supportato (WebView,
  // Samsung Internet datati) o si comporta male con la barra URL, il
  // contenitore risulta più alto dello schermo visibile e la nav — ultima
  // in colonna, con overflow:hidden — finisce tagliata sotto. Misuriamo
  // l'altezza reale con window.innerHeight (sempre = viewport visibile,
  // su qualunque browser) e la usiamo in px; 100dvh resta solo come
  // valore iniziale prima del mount. visualViewport, dove esiste, segnala
  // anche i resize dovuti a barra URL/tastiera che "resize" non sempre emette.
  const [appHeight, setAppHeight] = useState(null);
  useEffect(()=>{
    // Su iPhone, con l'app aperta dalla schermata home, window.innerHeight
    // e' piu' corto dello schermo fisico: sotto al contenitore resta una
    // fascia (la zona della barretta home piu' un po' di margine di Safari)
    // dove non disegniamo nulla. Dario la vuole dimezzata, cosi' il menu
    // scende senza finire sotto la barretta.
    // Il valore non e' fisso: lo calcoliamo dallo scarto reale del
    // dispositivo (schermo - viewport) e ne riprendiamo meta'. Lo facciamo
    // solo se l'app e' installata e se lo scarto e' plausibile (sotto i
    // 120px), altrimenti su un browser normale — dove quello scarto e'
    // la barra degli indirizzi — l'app finirebbe fuori schermo.
    const measure = ()=>{
      const h = window.innerHeight;
      let extra = 0;
      try {
        const installata = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone;
        const scarto = (window.screen?.height || 0) - h;
        if (installata && scarto > 0 && scarto < 120) extra = Math.round(scarto / 4);
      } catch {}
      setAppHeight(h + extra);
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return ()=>{
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
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
  // Ri-sincronizza con ClickUp quando torni sulla tab/app dopo un po' (es.
  // il giorno dopo, o dopo che il cron notturno ha resettato le routine):
  // senza questo, homeData/checkedTasks potevano restare fermi a quando la
  // pagina era stata caricata l'ultima volta, mostrando uno stato "vecchio"
  // finché non si ricaricava manualmente — stessa famiglia di bug del
  // disallineamento dashboard/ClickUp riscontrato sull'outreach.
  useEffect(()=>{
    const onVisible = () => { if (document.visibilityState==="visible" && view==="home") loadHomeData(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  },[view]);
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
          // Le stesse coordinate servono al tema automatico (alba/tramonto):
          // si salvano cosi' il tema resta corretto anche al riavvio, senza
          // dover richiedere di nuovo la posizione.
          const nuove = { lat: latitude, lon: longitude };
          setCoords(nuove);
          try { localStorage.setItem("dario-coords", JSON.stringify(nuove)); } catch {}
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
      // /api/revenue non viene più chiamato qui: la card Revenue era stata
      // rimossa dalla home il 10/07 su richiesta di Dario, ma la fetch era
      // rimasta — una chiamata a ClickUp a ogni caricamento per un dato che
      // non veniva mostrato da nessuna parte. L'endpoint resta e viene usato
      // dal Simulatore 1M€, dove il numero è azionabile.
      const [tRes,wgRes,pRes,skRes] = await Promise.all([
        fetchWithRetry("/api/tasks",{cache:"no-store"}),
        fetchWithRetry("/api/weight",{cache:"no-store"}),
        fetchWithRetry("/api/pipeline-data",{cache:"no-store"}),
        fetchWithRetry("/api/streak",{cache:"no-store"}),
      ]);
      // tRes.error copre il caso "nessuna lista caricata" (ora la route
      // risponde 500 invece di liste vuote silenziose); tRes.listeNonCaricate
      // copre il caso parziale: mostriamo le liste arrivate e avvisiamo sulle
      // altre, perché una card vuota per errore è indistinguibile da
      // "niente da fare" ed è il modo più facile per perdersi delle task.
      if (tRes && !tRes.error) {
        setHomeData(tRes);
        // Gli override locali valgono solo finche' non sappiamo cosa dice
        // ClickUp. Appena lo sappiamo vanno buttati, altrimenti restano
        // incollati fino a mezzanotte (e' il residuo del bug outreach: la
        // task risultava spuntata in dashboard e "da fare" su ClickUp perche'
        // checkedTasks vince sempre sullo stato del server e nessuno lo
        // ripuliva mai). Teniamo solo gli id NON presenti nella risposta:
        // sono le spunte ancora in volo su task che ClickUp non ci ha
        // restituito (es. gia' chiuse, che con include_closed=false spariscono).
        setCheckedTasks(prev => {
          const noti = new Set(
            ["todo","routine","sospeso","claudia","annarita"]
              .flatMap(k => tRes[k] || [])
              .map(t => t?.id)
              .filter(Boolean)
          );
          const next = {};
          for (const [id, v] of Object.entries(prev)) if (!noti.has(id)) next[id] = v;
          try { localStorage.setItem("dario-checked-tasks",JSON.stringify({date:todayBucharest(),tasks:next})); } catch {}
          return next;
        });
      }
      else                      setHomeData({todo:[],routine:[],sospeso:[],claudia:[],annarita:[]});
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
        // Stesso calcolo di PipelinePage: lead aperti, budget lordo e
        // ponderato con STAGE_PROBABILITY (import condiviso, stessi pesi).
        const aperti = pRes.entries.filter(e=>e.tipo==="lead" && !["chiuso","rifiutato"].includes(e.stage));
        const lordo = aperti.reduce((s,e)=>s+(parseFloat(e.budget)||0),0);
        const ponderato = aperti.reduce((s,e)=>s+(parseFloat(e.budget)||0)*(STAGE_PROBABILITY[e.stage] ?? 0),0);
        setPipelineStats({ leads: aperti.length, lordo, ponderato });
      }
      // Teniamo traccia di QUALI dati non si sono caricati, invece di
      // lasciare che un errore silenzioso si travesta da "0€"/"–" senza
      // che sia chiaro se è un dato vuoto legittimo o un fetch fallito.
      // "weather" viene aggiornato a parte (vedi sopra), non qui.
      setHomeErrors(prev=>({
        ...prev,
        weight:  !wgRes || !!wgRes.error,
        tasks:   !tRes || !!tRes.error,
        tasksParziale: tRes?.listeNonCaricate || null,
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
    const today = todayBucharest();
    const segnatoOggi = streakHistory.some(d=>d.data===today && d.completed);
    // Lo streak deve poter anche SCENDERE. Prima l'effetto usciva subito con
    // "if (!allDone) return", quindi il POST partiva solo con completed:true:
    // se spuntavi tutte le routine e poi ne toglievi una (errore, ripensamento)
    // il giorno restava segnato come completato per sempre. La route accetta
    // gia' completed:false, semplicemente non veniva mai chiamata cosi'.
    if (allDone === segnatoOggi) return; // niente da comunicare al server
    (async ()=>{
      try {
        const res = await fetch("/api/streak",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({data:today,completed:allDone})});
        const data = await res.json();
        if (res.ok) {
          setRoutineStreak(data.streak||0);
          setStreakHistory(prev=>{
            const next = prev.filter(d=>d.data!==today);
            next.push({data:today,completed:allDone});
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
      // Non basta che ClickUp risponda 200: verifichiamo che lo status
      // REALMENTE tornato indietro corrisponda a quanto richiesto. Se la
      // lista di questo task usa nomi di stato diversi da "completata"/"da
      // fare" (es. una lista con vocabolario custom), ClickUp può accettare
      // la PUT senza applicare davvero il cambiamento — è esattamente il
      // tipo di disallineamento dashboard-vs-ClickUp riscontrato a luglio
      // 2026 su una task di outreach. Qui confrontiamo lo stato tornato con
      // DONE_STATUSES: se non coincide con "next", trattiamo come fallimento
      // e facciamo rollback invece di fidarci ciecamente dell'ottimismo locale.
      const data = await res.json();
      const confirmedDone = DONE_STATUSES.includes((data?.status?.status||"").toLowerCase());
      if (confirmedDone !== next) throw new Error("Stato non confermato da ClickUp");
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
    const today = localISODate();
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

  // Solo il numero di decisioni la cui data di revisione è arrivata.
  // Chiamata leggera (?soloConteggio=1): il server fa il filtro e risponde
  // con un intero, così il boot della home non si porta dietro tutto lo
  // storico delle decisioni per accendere un banner.
  //
  // Perché parte al mount e non solo un giorno preciso (come faceva il
  // rito del venerdì): una revisione ha una data sua, non un giorno della
  // settimana. Se il check girasse solo il venerdì, una revisione fissata
  // di lunedì resterebbe invisibile per quattro giorni — cioè esattamente
  // i giorni in cui la decisione è ancora fresca e vale la pena guardarla.
  const caricaDecisioniDaRivedere = async () => {
    try {
      const res = await fetch("/api/decisions?soloConteggio=1");
      if (!res.ok) return;
      const d = await res.json();
      setDecisioniDaRivedere(d.daRivedere || 0);
    } catch {}
  };

  // Backup completo: aggrega ClickUp (to-do/routine/streak/finanze/peso/
  // abitudini/diario/decisioni) e Notion (pipeline), tutto lato server in
  // /api/backup. Il file scaricato è un JSON leggibile, pensato per essere
  // riaperto a mano in caso di disastro, non per un ripristino automatico
  // (che oggi non esiste).
  const downloadBackup = async () => {
    setBackupStatus("loading");
    try {
      const res = await fetch("/api/backup");
      const payload = await res.json();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dario-backup-${localISODate()}.json`;
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

  // Si invoca come funzione — {SettingsContent()} — e non come componente
  // <SettingsContent/>. Essendo definita qui dentro, ad ogni render sarebbe
  // una funzione nuova: come componente React la rimonterebbe da zero,
  // facendo perdere il focus allo slider mentre lo trascini. Chiamandola
  // come funzione il JSX viene inserito senza creare un confine di
  // componente, quindi non c'e' niente da rimontare.
  // Stessa classe di bug che azzerava lo scroll nella griglia Abitudini.
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
        {themeMode==="auto"
          ? (sole
              ? `Auto: chiaro dall'alba (${sole.alba}) al tramonto (${sole.tramonto}), scuro il resto. ${coords ? "Sole della tua posizione attuale." : "Sole di Timișoara — attiva il meteo sulla posizione per seguirti in viaggio."}`
              : "Auto: chiaro dall'alba al tramonto, scuro il resto.")
          : "Si applica a tutta l'app."}
      </div>

      <div style={{marginTop:16,paddingTop:14,borderTop:`1px solid ${T.border}`}}>
        <div style={{fontSize:11,color:"#64748B",marginBottom:6}}>Backup dati</div>
        <button onClick={downloadBackup} disabled={backupStatus==="loading"}
          style={{width:"100%",padding:"8px 0",borderRadius:8,border:"1px solid #8B5CF640",background:backupStatus==="loading"?"#1A1A2E":"#8B5CF610",color:"#8B5CF6",cursor:backupStatus==="loading"?"not-allowed":"pointer",fontSize:11,fontWeight:600}}>
          {backupStatus==="loading" ? "⏳ Preparazione..." : backupStatus==="done" ? "✅ Scaricato" : backupStatus==="error" ? "⚠️ Scaricato con avvisi" : "⬇️ Esporta backup JSON"}
        </button>
        <div style={{fontSize:9,color:"#334155",marginTop:6,lineHeight:1.4}}>Unisce ClickUp (to-do, routine, streak, finanze, peso) e Notion (pipeline) in un unico file.</div>
      </div>
      <LucchettoSettings theme={theme}/>
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",height:appHeight?`${appHeight}px`:"100dvh",paddingTop:"env(safe-area-inset-top)",background:T.bg,color:T.text,fontFamily:"system-ui,-apple-system,sans-serif",overflow:"hidden"}}>
      {/* Richiude l'app quando esci per più di un minuto. Non disegna nulla,
          e sui dispositivi senza lucchetto non fa proprio niente. */}
      <BloccoSchermo/>
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
                {/* Pallino ambra sul tab Decisioni: numero, non solo forma —
                    "3 da rivedere" e "1 da rivedere" richiedono due reazioni
                    diverse, e un pallino muto le appiattirebbe. */}
                {item.id==="decisioni" && decisioniDaRivedere>0 && (
                  <span style={{marginLeft:"auto",minWidth:18,height:18,padding:"0 5px",borderRadius:9,background:"#F59E0B",color:"#0F172A",fontSize:10,fontWeight:800,display:"inline-flex",alignItems:"center",justifyContent:"center"}}>
                    {decisioniDaRivedere}
                  </span>
                )}
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
                  {SettingsContent()}
                </div>
              )}
            </div>
          </div>
        )}

        {/* MAIN AREA */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {view==="iagrex"   && <IAGREXPage fontSize={fontSize} onBack={()=>setView("home")} theme={theme} isMobile={isMobile}/>}
          {view==="finanze"  && <BrunoPage  fontSize={fontSize} theme={theme} isMobile={isMobile}/>}
          {view==="pipeline" && <PipelinePage fontSize={fontSize} theme={theme} onGoToIagrex={()=>setView("iagrex")}/>}
          {view==="clienti"  && <ClientiPage  fontSize={fontSize} theme={theme}/>}
          {view==="decisioni" && <DecisionsPage fontSize={fontSize} theme={theme} isMobile={isMobile} onCountChange={setDecisioniDaRivedere}/>}
          {view==="apprendimento" && <LearningPage fontSize={fontSize} theme={theme} isMobile={isMobile}/>}
          {view==="simulatore" && <SimulatorPage fontSize={fontSize} onBack={()=>setView("home")} theme={theme}/>}
          {view==="calcolatrice" && <CalculatorPage fontSize={fontSize} onBack={()=>setView("home")} theme={theme}/>}
          {view==="abitudini" && <HabitsPage fontSize={fontSize} theme={theme} isMobile={isMobile}/>}

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
                  {SettingsContent()}
                </div>
              )}

              {inactivityDays >= 1 && (
                <div style={{margin:"10px 16px 0",padding:"8px 12px",borderRadius:8,border:"1px solid #8B5CF640",background:"#8B5CF60D",color:"#8B5CF6",fontSize:12,flexShrink:0}}>
                  👋 Bentornato! Non aprivi l'app da {inactivityDays} giorn{inactivityDays===1?"o":"i"}
                  {leadDaRicontattare.length>0 ? ` — hai ${leadDaRicontattare.length} lead in attesa in pipeline.` : "."}
                </div>
              )}

              {/* Promemoria revisione decisioni. Sta in home e non solo sul
                  tab perché una revisione mancata non fa rumore: nessuno te
                  la chiede, nessun cliente aspetta, e sparisce. Il banner è
                  l'unico attrito che la tiene in vita. */}
              {decisioniDaRivedere > 0 && (
                <div onClick={()=>setView("decisioni")}
                  style={{margin:"10px 16px 0",padding:"8px 12px",borderRadius:8,border:"1px solid #F59E0B40",background:"#F59E0B0D",color:"#F59E0B",fontSize:12,flexShrink:0,cursor:"pointer"}}
                  title="Decisioni la cui data di revisione è arrivata">
                  ⚖️ {decisioniDaRivedere} revision{decisioniDaRivedere===1?"e":"i"} da fare — è arrivata la data che ti eri dato.
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

              {/* MRR potenziale che matura in pipeline: il ponte tra le
                  trattative aperte e l'obiettivo 1M€. Il valore ponderato
                  pesa ogni budget per la probabilità del suo stage. */}
              {pipelineStats && pipelineStats.ponderato > 0 && (
                <div onClick={()=>setView("pipeline")}
                  style={{margin:"10px 16px 0",padding:"8px 12px",borderRadius:8,border:"1px solid #8B5CF640",background:"#8B5CF60D",color:"#8B5CF6",fontSize:12,flexShrink:0,cursor:"pointer"}}
                  title="Somma dei budget dei lead aperti, pesata per la probabilità di chiusura di ogni stage">
                  🎯 In pipeline: {pipelineStats.leads} lead · {Math.round(pipelineStats.lordo).toLocaleString("it-IT")}€/mese potenziali · ~<b>{Math.round(pipelineStats.ponderato).toLocaleString("it-IT")}€/mese</b> realistici se chiudi al ritmo atteso
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

                {/* Avviso task non caricate: una card vuota per errore è
                    identica a "niente da fare", ed è il modo più facile per
                    perdere delle task senza accorgersene. */}
                {!homeLoading && (homeErrors.tasks || homeErrors.tasksParziale) && (
                  <div style={{background:"#DC262625",border:"1px solid #DC262660",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:fontSize-2,color:"#FCA5A5"}}>
                    {homeErrors.tasks
                      ? "⚠️ Task non caricate: ClickUp non è raggiungibile. Le card qui sotto sono vuote per errore, non perché non hai niente da fare."
                      : `⚠️ Alcune liste non si sono caricate (${homeErrors.tasksParziale.join(", ")}): quelle card sono vuote per errore, non perché siano vuote davvero.`}
                  </div>
                )}

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
                      {/* Scorciatoia alla pagina Abitudini: lo streak è il
                          punto in cui viene naturale chiedersi "sì, ma quale
                          ho saltato?" — la risposta è a un tap. */}
                      <span onClick={()=>setView("abitudini")} title="Vedi lo storico per singola abitudine"
                        style={{fontSize:fontSize-4,color:"#FED7AA",fontWeight:700,cursor:"pointer",padding:"2px 6px",borderRadius:6,background:"rgba(255,255,255,0.12)"}}>
                        {routineStreak > 0 ? `🔥 ${routineStreak}g` : "📊 storico"}
                      </span>
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

      {/* MOBILE BOTTOM NAV (rifatta 14/08).
          Prima: dieci voci schiacciate in una riga fissa da flex:1, circa 37px
          l'una — sotto i 44px minimi indicati da Apple, quindi si sbagliava
          tasto di continuo. Ora la riga scorre in orizzontale e ogni voce ha
          una larghezza propria: icone e testo grandi il doppio, e il pollice
          ha dove atterrare. L'auto-scroll piu' sotto tiene la voce attiva
          sempre in vista, cosi' le pagine di destra non spariscono.
          Il paddingBottom con env() ora funziona davvero: serviva
          viewport-fit=cover in layout.jsx (senza, env() vale 0). */}
      {isMobile && (
        <div ref={mobileNavRef} className="mobile-nav"
          style={{display:"flex",gap:6,overflowX:"auto",overflowY:"hidden",WebkitOverflowScrolling:"touch",overscrollBehaviorX:"contain",scrollSnapType:"x proximity",
            background:T.panel,borderTop:`1px solid ${T.border}`,
            padding:"6px 10px",paddingBottom:12,
            flexShrink:0,zIndex:100}}>
          {NAV_ITEMS_MOBILE.map(item=>{
            const c = item.color || T.cardText;
            const attivo = view===item.id;
            return (
            <button key={item.id} data-nav={item.id} onClick={()=>setView(item.id)}
              style={{flex:"0 0 auto",minWidth:70,minHeight:54,padding:"7px 8px",borderRadius:12,border:"none",scrollSnapAlign:"center",
                background:attivo?`${c}22`:"transparent",
                boxShadow:attivo?`inset 0 0 0 1.5px ${c}66`:"none",
                color:attivo?c:T.textDim,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,position:"relative",
                WebkitTapHighlightColor:"transparent"}}>
              <span style={{fontSize:22,lineHeight:1}}>{item.icon}</span>
              <span style={{fontSize:10,fontWeight:attivo?700:500,whiteSpace:"nowrap",lineHeight:1}}>{item.breve || item.label}</span>
              {item.id==="decisioni" && decisioniDaRivedere>0 && (
                <span style={{position:"absolute",top:3,right:8,minWidth:16,height:16,padding:"0 4px",borderRadius:8,background:"#F59E0B",color:"#0F172A",fontSize:10,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {decisioniDaRivedere}
                </span>
              )}
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

      <style>{`
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1A1A2E;border-radius:2px}
        button:hover{filter:brightness(1.08)}
        .dcard:hover{transform:translateY(-3px)}
        .mobile-nav::-webkit-scrollbar{display:none}
        .mobile-nav{scrollbar-width:none}
        .mobile-nav button:active{transform:scale(0.94)}
      `}</style>
    </div>
  );
}
