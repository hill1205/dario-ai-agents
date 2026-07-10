"use client";
import { useState, useEffect, useCallback, useRef } from "react";

const LEAD_STAGES = [
  { id:"da_contattare",    label:"Da Contattare",   color:"var(--c-text-faint)" },
  { id:"contattato",       label:"Contattato",       color:"#3B82F6" },
  { id:"proposta_inviata", label:"Proposta Inviata", color:"#F59E0B" },
  { id:"in_trattativa",    label:"In Trattativa",    color:"#F97316" },
  { id:"chiuso",           label:"Chiuso 🎉",         color:"#10B981" },
  { id:"rifiutato",        label:"Rifiutato",         color:"#EF4444" },
];
const CLIENT_STAGES = [
  { id:"attivo",   label:"Attivo ✅", color:"#10B981" },
  { id:"in_pausa", label:"In Pausa",  color:"#F59E0B" },
  { id:"concluso", label:"Concluso",  color:"var(--c-text-faint)" },
];
const EMPTY_FORM = {
  id:null, tipo:"lead", nome:"", settore:"", contatto:"",
  email:"", telefono:"", sito:"", facebook:"", instagram:"", linkedin:"", linkedin_referente:"",
  budget:"", stage:"da_contattare",
  ultimo_contatto:"", tentativi:0,
  data:new Date().toISOString().slice(0,10), note:"",
};

// Variabili CSS per il tema chiaro/scuro: i colori di sfondo/testo neutri
// sono stati sostituiti nel resto del file con var(--c-...), mentre i
// colori "accent" (verde/rosso/blu/viola/arancio degli stage) restano
// hardcoded perché restano leggibili su entrambi gli sfondi.
const THEME_VARS = {
  dark:  { "--c-bg":"#09090F", "--c-panel":"#0F0F1A", "--c-panel2":"#0B0B16", "--c-border":"#1A1A2E", "--c-text-strong":"#F8FAFC", "--c-text":"#E2E8F0", "--c-text-dim":"#64748B", "--c-text-faint":"#475569", "--c-text-faintest":"#334155", "--c-text-muted":"#94A3B8" },
  light: { "--c-bg":"#F4F5F7", "--c-panel":"#FFFFFF", "--c-panel2":"#F1F2F5", "--c-border":"#E2E4E9", "--c-text-strong":"#0F172A", "--c-text":"#1A1A2E", "--c-text-dim":"#475569", "--c-text-faint":"#94A3B8", "--c-text-faintest":"#CBD5E1", "--c-text-muted":"#64748B" },
};

function genId() { return Math.random().toString(36).slice(2,10); }

// --- Import CSV -------------------------------------------------------
// Parser CSV minimale ma robusto: gestisce virgole dentro campi tra
// virgolette e virgolette doppie escaped (""), sia per file separati da
// virgola che da punto e virgola (Excel IT esporta spesso con ";").
function parseCSV(text) {
  const delimiter = (text.split("\n")[0].split(";").length > text.split("\n")[0].split(",").length) ? ";" : ",";
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i+1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delimiter) { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (field !== "" || row.length) { row.push(field); rows.push(row); row = []; field = ""; }
        if (c === "\r" && next === "\n") i++;
      } else { field += c; }
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim() !== ""));
}

// Alias per campo — includono sia le intestazioni "italiane" (export manuali/
// Excel) sia quelle di Apollo.io (export contatti in inglese), cosi' lo
// stesso importer funziona per entrambi senza dover adattare il file a mano.
// Per campi dove Apollo espone piu' colonne simili (es. 5 tipi di telefono),
// l'elenco tiene tutte le varianti: get() sotto prende la prima non vuota
// invece di fermarsi alla prima colonna che matcha per posizione.
const CSV_FIELD_ALIASES = {
  nome:     ["nome","azienda","company","company name","name","ragione sociale","nome azienda"],
  settore:  ["settore","sector","industry","categoria"],
  contatto: ["contatto","referente","contact","nome contatto","persona"],
  email:    ["email","e-mail","mail"],
  telefono: ["telefono","phone","tel","cellulare","mobile phone","work direct phone","corporate phone","company phone","home phone","other phone"],
  sito:     ["sito","sito web","website","url","web"],
  facebook: ["facebook","fb","facebook url"],
  instagram: ["instagram","ig"],
  linkedin: ["linkedin","company linkedin url"],
  linkedin_referente: ["referente linkedin","linkedin referente","person linkedin url"],
  budget:   ["budget","budget mensile","budget €/mese"],
  note:     ["note","notes","commenti","title"],
};
function normalizeHeader(h) {
  return h.toLowerCase().trim().normalize("NFD").replace(/[̀-ͯ]/g,"");
}
function mapCsvToEntries(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(normalizeHeader);
  // Per ogni campo, tutte le colonne che matchano un alias (non solo la
  // prima) — serve per Apollo dove es. "telefono" ha 5 colonne candidate e
  // solo una e' valorizzata riga per riga.
  const colIndexes = {};
  Object.entries(CSV_FIELD_ALIASES).forEach(([field, aliases]) => {
    colIndexes[field] = headers.reduce((acc,h,i)=>{ if (aliases.includes(h)) acc.push(i); return acc; },[]);
  });
  // "Contatto" (nome referente): gli export manuali hanno spesso una singola
  // colonna, Apollo invece "First Name"/"Last Name" separate — se non c'e'
  // match diretto, le combiniamo.
  const firstNameIdx = headers.indexOf("first name");
  const lastNameIdx  = headers.indexOf("last name");

  const today = new Date().toISOString().slice(0,10);
  return rows.slice(1).map(r => {
    const get = (field) => {
      const idxs = colIndexes[field] || [];
      for (const idx of idxs) {
        const v = (r[idx]||"").trim();
        if (v) return v;
      }
      return "";
    };
    const nome = get("nome");
    if (!nome) return null;
    let contatto = get("contatto");
    if (!contatto && (firstNameIdx !== -1 || lastNameIdx !== -1)) {
      contatto = [firstNameIdx !== -1 ? (r[firstNameIdx]||"").trim() : "", lastNameIdx !== -1 ? (r[lastNameIdx]||"").trim() : ""]
        .filter(Boolean).join(" ");
    }
    return {
      ...EMPTY_FORM,
      id: genId(),
      nome,
      settore: get("settore"),
      contatto,
      email: get("email"),
      telefono: get("telefono"),
      sito: get("sito"),
      facebook: get("facebook"),
      instagram: get("instagram"),
      linkedin: get("linkedin"),
      linkedin_referente: get("linkedin_referente"),
      budget: get("budget"),
      note: get("note"),
      data: today,
    };
  }).filter(Boolean);
}
function stageColor(s,t) { return (t==="cliente"?CLIENT_STAGES:LEAD_STAGES).find(x=>x.id===s)?.color||"var(--c-text-faint)"; }
function stageLabel(s,t) { return (t==="cliente"?CLIENT_STAGES:LEAD_STAGES).find(x=>x.id===s)?.label||s; }
function lsGet() { try { const s=localStorage.getItem("dario-pipeline"); return s?JSON.parse(s):[]; } catch { return []; } }
function lsSet(d) { try { localStorage.setItem("dario-pipeline",JSON.stringify(d)); } catch {} }

function InputField({ label, value, onChange, type="text", full=false, placeholder="" }) {
  return (
    <div style={{gridColumn:full?"1 / -1":undefined}}>
      <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>{label}</div>
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        style={{width:"100%",padding:"7px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
    </div>
  );
}

function InfoRow({ icon, value, href, dim=false, fs }) {
  const style = { fontSize:fs-4, color: dim ? "var(--c-text-faintest)" : "var(--c-text-dim)", marginBottom:3, display:"flex", alignItems:"center", gap:5, lineHeight:1.3 };
  if (href && value) return (
    <div style={style}>
      <span style={{flexShrink:0}}>{icon}</span>
      <a href={href} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}
        style={{color:"#3B82F6",textDecoration:"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
        {value}
      </a>
    </div>
  );
  return (
    <div style={style}>
      <span style={{flexShrink:0}}>{icon}</span>
      <span style={{color: value ? "var(--c-text-muted)" : "var(--c-text-faintest)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
        {value || "—"}
      </span>
    </div>
  );
}

function EntryCard({ entry, onEdit, onDelete, onGenMsg, fs, onDragStart, isDragging, onIncrTentativi }) {
  const color = stageColor(entry.stage, entry.tipo);
  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, entry)}
      style={{
        background:"var(--c-panel)", border:"1px solid var(--c-border)",
        borderLeft:`3px solid ${color}`, borderRadius:9, padding:11,
        cursor:"grab", opacity: isDragging ? 0.4 : 1,
        transition:"opacity 0.15s", userSelect:"none",
      }}
    >
      {/* Header: nome + azioni */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
        <div style={{flex:1,paddingRight:6}}>
          {/* Era color:"#F1F5F9" fisso (bianco quasi puro, pensato per sfondo
              scuro): su tema chiaro il nome diventava illeggibile su sfondo
              bianco. Ora segue il tema come il resto della card. */}
          <div style={{fontSize:fs,fontWeight:700,color:"var(--c-text-strong)",lineHeight:1.3,marginBottom:3}}>{entry.nome}</div>
          {entry.settore
            ? <span style={{fontSize:fs-5,color:color,fontWeight:700,background:`${color}18`,padding:"1px 7px",borderRadius:10}}>{entry.settore}</span>
            : <span style={{fontSize:fs-5,color:"var(--c-text-faint)",background:"var(--c-border)",padding:"1px 7px",borderRadius:10}}>settore —</span>
          }
        </div>
        <div style={{display:"flex",gap:3,flexShrink:0}}>
          <button onMouseDown={e=>e.stopPropagation()} onClick={()=>onEdit(entry)}
            style={{width:22,height:22,borderRadius:4,border:"none",background:"var(--c-border)",color:"var(--c-text-dim)",cursor:"pointer",fontSize:10}}>✏️</button>
          <button onMouseDown={e=>e.stopPropagation()} onClick={()=>onDelete(entry.id)}
            style={{width:22,height:22,borderRadius:4,border:"none",background:"var(--c-border)",color:"#EF4444",cursor:"pointer",fontSize:12,fontWeight:700}}>×</button>
        </div>
      </div>

      {/* Dati contatto */}
      <div style={{borderTop:"1px solid var(--c-border)",paddingTop:7,marginBottom:6}}>
        <InfoRow icon="👤" value={entry.contatto} fs={fs}/>
        <InfoRow icon="📧" value={entry.email} href={entry.email?`mailto:${entry.email}`:null} fs={fs}/>
        <InfoRow icon="📞" value={entry.telefono} fs={fs}/>
        <InfoRow icon="🌐" value={entry.sito ? entry.sito.replace(/^https?:\/\//,"") : ""} href={entry.sito} fs={fs}/>
        <InfoRow icon="📘" value={entry.facebook ? "Facebook" : ""} href={entry.facebook} fs={fs}/>
        <InfoRow icon="📸" value={entry.instagram ? "Instagram" : ""} href={entry.instagram} fs={fs}/>
        <InfoRow icon="💼" value={entry.linkedin ? "LinkedIn" : ""} href={entry.linkedin} fs={fs}/>
        <InfoRow icon="🙋" value={entry.linkedin_referente ? "LinkedIn referente" : ""} href={entry.linkedin_referente} fs={fs}/>
      </div>

      {/* Budget + tentativi */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
        <div style={{fontSize:fs-3,color: entry.budget ? "#10B981" : "var(--c-text-faintest)",fontWeight:700}}>
          {entry.budget ? `💶 ${parseFloat(entry.budget).toLocaleString("it-IT")}€/mese` : "💶 budget —"}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          <span style={{fontSize:fs-5,color:"var(--c-text-faintest)"}}>
            📨 {entry.tentativi||0} tentativi
          </span>
          {entry.tipo==="lead" && (
            <button onMouseDown={e=>e.stopPropagation()} onClick={()=>onIncrTentativi(entry.id)}
              style={{width:18,height:18,borderRadius:4,border:"1px solid var(--c-border)",background:"#0A0F1A",color:"var(--c-text-faint)",cursor:"pointer",fontSize:9,display:"flex",alignItems:"center",justifyContent:"center"}}>
              +1
            </button>
          )}
        </div>
      </div>

      {/* Ultimo contatto */}
      {entry.tipo==="lead" && (
        <div style={{fontSize:fs-5,color: entry.ultimo_contatto ? "var(--c-text-faint)" : "var(--c-text-faintest)",marginBottom:6}}>
          📅 Ultimo contatto: {entry.ultimo_contatto || "—"}
        </div>
      )}

      {/* Note */}
      {entry.note && (
        <div style={{fontSize:fs-4,color:"var(--c-text-faintest)",lineHeight:1.4,marginBottom:6,borderTop:"1px solid var(--c-border)",paddingTop:5}}>
          {entry.note.slice(0,80)}{entry.note.length>80?"…":""}
        </div>
      )}

      {/* Genera messaggio */}
      {entry.tipo==="lead" && (
        <button onMouseDown={e=>e.stopPropagation()} onClick={()=>onGenMsg(entry)}
          style={{width:"100%",padding:"6px",borderRadius:6,border:"1px solid #3B82F650",background:"#3B82F60D",color:"#3B82F6",cursor:"pointer",fontSize:fs-4,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
          🤖 Genera Messaggio Outreach
        </button>
      )}
    </div>
  );
}

function KanbanView({ entries, filter, fs, onEdit, onDelete, openAdd, onGenMsg, onDropToStage, onIncrTentativi }) {
  const [draggedId, setDraggedId]     = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  const cols = filter==="cliente"
    ? CLIENT_STAGES.map(s=>({...s,tipo:"cliente"}))
    : filter==="lead"
    ? LEAD_STAGES.map(s=>({...s,tipo:"lead"}))
    : [...LEAD_STAGES.map(s=>({...s,tipo:"lead"})),...CLIENT_STAGES.map(s=>({...s,tipo:"cliente"}))];

  const handleDragStart = (e, entry) => {
    setDraggedId(entry.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("entryId", entry.id);
    e.dataTransfer.setData("entryTipo", entry.tipo);
  };
  const handleDragOver = (e, colKey) => { e.preventDefault(); e.dataTransfer.dropEffect="move"; setDragOverCol(colKey); };
  const handleDrop = (e, stage, tipo) => {
    e.preventDefault();
    const entryId   = e.dataTransfer.getData("entryId");
    const entryTipo = e.dataTransfer.getData("entryTipo");
    if (entryId && entryTipo===tipo) onDropToStage(entryId, stage);
    setDraggedId(null); setDragOverCol(null);
  };

  return (
    <div style={{flex:1,overflowX:"auto",overflowY:"hidden",display:"flex",gap:10,padding:16,alignItems:"stretch"}}>
      {cols.map(col => {
        const colKey     = `${col.tipo}-${col.id}`;
        const colEntries = entries.filter(e=>e.stage===col.id&&e.tipo===col.tipo);
        const isOver     = dragOverCol===colKey;
        return (
          <div key={colKey} onDragOver={e=>handleDragOver(e,colKey)} onDrop={e=>handleDrop(e,col.id,col.tipo)} onDragLeave={()=>setDragOverCol(null)}
            style={{minWidth:240,maxWidth:240,display:"flex",flexDirection:"column",flexShrink:0,borderRadius:10,border:isOver?`2px solid ${col.color}`:"2px solid transparent",background:isOver?`${col.color}08`:"transparent",transition:"border 0.15s,background 0.15s"}}>
            {/* Header colonna */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 10px",borderRadius:8,background:`${col.color}12`,border:`1px solid ${col.color}30`,flexShrink:0,marginBottom:7}}>
              <div>
                <div style={{fontSize:9,color:col.color,opacity:0.6,textTransform:"uppercase",letterSpacing:"0.08em"}}>{col.tipo==="lead"?"Lead":"Cliente"}</div>
                <div style={{fontSize:fs-2,fontWeight:700,color:col.color}}>{col.label}</div>
              </div>
              <div style={{fontSize:fs-3,color:col.color,background:`${col.color}20`,borderRadius:10,padding:"1px 7px",fontWeight:700}}>{colEntries.length}</div>
            </div>
            {/* Card scrollabili */}
            <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:8,paddingRight:2}}>
              {colEntries.map(e=>(
                <EntryCard key={e.id} entry={e} onEdit={onEdit} onDelete={onDelete} onGenMsg={onGenMsg}
                  fs={fs} onDragStart={handleDragStart} isDragging={draggedId===e.id} onIncrTentativi={onIncrTentativi}/>
              ))}
              {colEntries.length===0 && (
                <div style={{fontSize:fs-4,color:"var(--c-text-faintest)",textAlign:"center",padding:"20px 0",border:"1px dashed var(--c-border)",borderRadius:7,marginTop:4}}>
                  Trascina qui
                </div>
              )}
            </div>
            <button onClick={()=>openAdd(col.tipo,col.id)}
              style={{marginTop:7,padding:"6px",borderRadius:7,border:`1px dashed ${col.color}40`,background:"transparent",color:col.color,cursor:"pointer",fontSize:11,opacity:0.5,flexShrink:0}}>
              + aggiungi
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ListView({ entries, fs, onEdit, onDelete, onGenMsg }) {
  if (!entries.length) return (
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--c-text-faintest)",fontSize:fs-2}}>
      Nessun record — aggiungi il primo lead o importa da ClickUp!
    </div>
  );
  return (
    <div style={{flex:1,overflowY:"auto",padding:16}}>
      <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"2fr 90px 140px 70px 110px 100px 80px",background:"var(--c-bg)",borderBottom:"1px solid var(--c-border)"}}>
          {["Nome / Settore","Tipo","Stage","Budget","Contatto","Sito / Social",""].map(h=>(
            <div key={h} style={{padding:"9px 10px",fontSize:10,fontWeight:700,color:"var(--c-text-faint)",textTransform:"uppercase",letterSpacing:"0.07em"}}>{h}</div>
          ))}
        </div>
        {entries.map((entry,i)=>{
          const color = stageColor(entry.stage,entry.tipo);
          const cell  = {padding:"10px 10px",fontSize:fs-2,color:"var(--c-text-muted)",borderTop:i===0?"none":"1px solid var(--c-border)",background:i%2===0?"var(--c-panel)":"var(--c-panel2)",display:"flex",alignItems:"center"};
          return (
            <div key={entry.id} style={{display:"grid",gridTemplateColumns:"2fr 90px 140px 70px 110px 100px 80px"}}>
              <div style={{...cell,flexDirection:"column",alignItems:"flex-start",gap:2}}>
                <span style={{color:"var(--c-text)",fontWeight:600}}>{entry.nome}</span>
                {entry.settore && <span style={{fontSize:fs-5,color:color,fontWeight:600}}>🏷️ {entry.settore}</span>}
              </div>
              <div style={cell}><span style={{padding:"2px 7px",borderRadius:10,background:entry.tipo==="lead"?"#3B82F620":"#10B98120",color:entry.tipo==="lead"?"#3B82F6":"#10B981",fontSize:10,fontWeight:600}}>{entry.tipo==="lead"?"Lead":"Cliente"}</span></div>
              <div style={cell}><span style={{padding:"2px 7px",borderRadius:10,background:`${color}20`,color,fontSize:10,fontWeight:600}}>{stageLabel(entry.stage,entry.tipo)}</span></div>
              <div style={{...cell,color:"#10B981",fontWeight:700}}>{entry.budget?`${parseFloat(entry.budget).toLocaleString("it-IT")}€`:"—"}</div>
              <div style={{...cell,flexDirection:"column",alignItems:"flex-start",gap:2}}>
                <span style={{color:entry.contatto?"var(--c-text-muted)":"var(--c-text-faintest)"}}>{entry.contatto||"—"}</span>
                {entry.email && <a href={`mailto:${entry.email}`} onClick={e=>e.stopPropagation()} style={{fontSize:fs-5,color:"#3B82F6",textDecoration:"none"}}>{entry.email}</a>}
              </div>
              <div style={{...cell,flexDirection:"column",alignItems:"flex-start",gap:2}}>
                {entry.sito ? <a href={entry.sito} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{fontSize:fs-5,color:"#3B82F6",textDecoration:"none"}}>🌐 sito</a> : <span style={{color:"var(--c-text-faintest)",fontSize:fs-5}}>🌐 —</span>}
                {entry.facebook ? <a href={entry.facebook} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{fontSize:fs-5,color:"#3B82F6",textDecoration:"none"}}>📘 Facebook</a> : <span style={{color:"var(--c-text-faintest)",fontSize:fs-5}}>📘 —</span>}
                {entry.instagram ? <a href={entry.instagram} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{fontSize:fs-5,color:"#3B82F6",textDecoration:"none"}}>📸 Instagram</a> : <span style={{color:"var(--c-text-faintest)",fontSize:fs-5}}>📸 —</span>}
                {entry.linkedin ? <a href={entry.linkedin} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{fontSize:fs-5,color:"#3B82F6",textDecoration:"none"}}>💼 LinkedIn</a> : <span style={{color:"var(--c-text-faintest)",fontSize:fs-5}}>💼 —</span>}
              </div>
              <div style={{...cell,gap:4}}>
                <button onClick={()=>onEdit(entry)} style={{width:24,height:24,borderRadius:5,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-dim)",cursor:"pointer",fontSize:10}}>✏️</button>
                <button onClick={()=>onDelete(entry.id)} style={{width:24,height:24,borderRadius:5,border:"1px solid #2A1A1A",background:"transparent",color:"#EF4444",cursor:"pointer",fontSize:12,fontWeight:700}}>×</button>
                {entry.tipo==="lead" && <button onClick={()=>onGenMsg(entry)} title="Genera messaggio" style={{width:24,height:24,borderRadius:5,border:"1px solid #3B82F640",background:"#3B82F610",color:"#3B82F6",cursor:"pointer",fontSize:11}}>🤖</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function PipelinePage({ fontSize=14, theme="dark" }) {
  const fs = fontSize;
  const themeVars = THEME_VARS[theme] || THEME_VARS.dark;
  const [entries, setEntries]       = useState([]);
  const [view, setView]             = useState("kanban");
  const [filter, setFilter]         = useState("tutti");
  const [modal, setModal]           = useState(null);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [loading, setLoading]       = useState(true);
  const [syncing, setSyncing]       = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [msgLead, setMsgLead]       = useState(null);
  const [msgType, setMsgType]       = useState("primo_contatto");
  const [msgExtra, setMsgExtra]     = useState("");
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgText, setMsgText]       = useState("");
  const [msgCopied, setMsgCopied]   = useState(false);
  const [csvPreview, setCsvPreview] = useState(null); // entries parsate, in attesa di conferma
  const [csvImporting, setCsvImporting] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(()=>{
    // Fix una tantum: pulisce cache locale pre-Notion per evitare doppioni
    // (vecchi lead salvati in localStorage con ID non-Notion venivano
    // reinviati come "nuovi" al primo drag/modifica dopo la migrazione).
    try {
      if (!localStorage.getItem("dario-pipeline-notion-migrated")) {
        localStorage.removeItem("dario-pipeline");
        localStorage.setItem("dario-pipeline-notion-migrated", "1");
      }
    } catch {}
    loadData();
  },[]);

  const loadData = async ()=>{
    setLoading(true);
    try {
      const res = await fetch("/api/pipeline-data");
      if (res.ok) { const data=await res.json(); const e=data.entries||[]; if(e.length>0){setEntries(e);lsSet(e);setLoading(false);return;} }
    } catch {}
    setEntries(lsGet()); setLoading(false);
  };

  const syncNow = async ()=>{
    setSyncing(true);
    try { const res=await fetch("/api/pipeline-data"); if(res.ok){const data=await res.json();const e=data.entries||[];setEntries(e);lsSet(e);} } catch {} finally { setSyncing(false); }
  };

  const saveData = useCallback(async (updated)=>{
    setEntries(updated); lsSet(updated); setSaveStatus("saving");
    try { const res=await fetch("/api/pipeline-data",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entries:updated})}); setSaveStatus(res.ok?"saved":"error"); } catch { setSaveStatus("error"); }
    setTimeout(()=>setSaveStatus(null),2500);
  },[]);

  const handleDropToStage = useCallback((entryId, newStage)=>{
    setEntries(prev=>{
      const updated = prev.map(e=>e.id===entryId?{...e,stage:newStage}:e);
      lsSet(updated);
      fetch("/api/pipeline-data",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entries:updated})}).catch(()=>{});
      return updated;
    });
  },[]);

  const handleIncrTentativi = useCallback((entryId)=>{
    const today = new Date().toISOString().slice(0,10);
    setEntries(prev=>{
      const updated = prev.map(e=>e.id===entryId?{...e,tentativi:(e.tentativi||0)+1,ultimo_contatto:today}:e);
      lsSet(updated);
      fetch("/api/pipeline-data",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entries:updated})}).catch(()=>{});
      return updated;
    });
  },[]);

  const openAdd    = (tipo="lead",stage=null)=>{ setForm({...EMPTY_FORM,tipo,stage:stage||(tipo==="lead"?"da_contattare":"attivo"),data:new Date().toISOString().slice(0,10)}); setModal("add"); };
  const openEdit   = (entry)=>{ setForm({...EMPTY_FORM,...entry}); setModal("edit"); };
  const closeModal = ()=>{ setModal(null); setForm(EMPTY_FORM); };
  const saveEntry  = ()=>{
    if(!form.nome.trim()) return;
    const updated=modal==="add"?[...entries,{...form,id:genId()}]:entries.map(e=>e.id===form.id?form:e);
    saveData(updated); closeModal();
  };
  // Prima questa funzione toglieva solo l'entry dall'array locale e
  // rimandava tutto il resto su Notion via saveData — ma senza dire mai a
  // Notion di archiviare la pagina, che quindi tornava al giro successivo.
  // Ora chiama la DELETE dedicata sull'entry (via notionId, che è anche
  // l'id locale visto che le entry vengono da Notion) e solo dopo il
  // successo aggiorna la lista locale.
  const deleteEntry = async (id)=>{
    if(!confirm("Eliminare questo record?")) return;
    const entry = entries.find(e=>e.id===id);
    const notionId = entry?.notionId || id;
    setEntries(prev=>{ const updated=prev.filter(e=>e.id!==id); lsSet(updated); return updated; });
    try {
      const res = await fetch(`/api/pipeline-data?id=${notionId}`,{method:"DELETE"});
      if (!res.ok) throw new Error("delete failed");
    } catch {
      // Se l'eliminazione su Notion fallisce, ricarichiamo dal server invece
      // di lasciare la dashboard disallineata (entry sparita in locale ma
      // ancora viva su Notion).
      loadData();
    }
  };

  const handleCsvFile = (e)=>{
    const file = e.target.files?.[0];
    e.target.value = ""; // permette di ricaricare lo stesso file due volte
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev)=>{
      try {
        const rows = parseCSV(String(ev.target.result));
        const parsed = mapCsvToEntries(rows);
        setCsvPreview(parsed); // apre il modal di anteprima, anche se vuoto (mostra l'errore all'utente)
      } catch (err) {
        alert("Errore leggendo il CSV: " + err.message);
      }
    };
    reader.readAsText(file, "UTF-8");
  };

  const confirmCsvImport = async ()=>{
    if (!csvPreview || !csvPreview.length) return;
    setCsvImporting(true);
    const updated = [...entries, ...csvPreview];
    await saveData(updated);
    setCsvImporting(false);
    setCsvPreview(null);
  };
  const openGenMsg  = (entry)=>{ setMsgLead(entry);setMsgType("primo_contatto");setMsgExtra("");setMsgText("");setMsgCopied(false); };

  const generateMessage = async ()=>{
    if(!msgLead) return; setMsgLoading(true); setMsgText(""); setMsgCopied(false);
    const typeMap={primo_contatto:"primo contatto",follow_up:"follow-up",proposta:"proposta di collaborazione"};
    try {
      const res=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        model:"claude-sonnet-4-6",max_tokens:1000,
        system:[{type:"text",text:`Sei Mario, responsabile business development di IAGREX SRL — agenzia di performance marketing specializzata in Meta Ads e Shopify per e-commerce italiani. Risultati medi clienti: +30-60% ROAS nei primi 60 giorni.\n\nScrivi messaggi di outreach in italiano: professionali, concisi, personalizzati. Max 120 parole. Tono diretto e credibile. Non usare "spero che tu stia bene". Vai subito al punto con proposta di valore specifica per quel settore.`,cache_control:{type:"ephemeral"}}],
        messages:[{role:"user",content:`Scrivi un messaggio di ${typeMap[msgType]||"primo contatto"} per:\n\nAzienda: ${msgLead.nome}\nSettore: ${msgLead.settore||"e-commerce"}\nReferente: ${msgLead.contatto||"non specificato"}\nBudget stimato: ${msgLead.budget?msgLead.budget+"€/mese":"non specificato"}\nTentativi precedenti: ${msgLead.tentativi||0}\nNote: ${msgLead.note||"nessuna"}${msgExtra?`\nContesto: ${msgExtra}`:""}`}],
        agentId:"mario"
      })});
      const d=await res.json(); setMsgText(d.content?.[0]?.text||"Errore.");
    } catch(e){ setMsgText("Errore: "+e.message); }
    setMsgLoading(false);
  };

  const copyMessage = ()=>{ navigator.clipboard.writeText(msgText).then(()=>{ setMsgCopied(true); setTimeout(()=>setMsgCopied(false),2500); }); };

  const filtered      = entries.filter(e=>filter==="tutti"||e.tipo===filter);
  const activeClients = entries.filter(e=>e.tipo==="cliente"&&e.stage==="attivo");
  const mrr           = activeClients.reduce((s,e)=>s+(parseFloat(e.budget)||0),0);
  const pipelineValue = entries.filter(e=>e.tipo==="lead"&&!["chiuso","rifiutato"].includes(e.stage)).reduce((s,e)=>s+(parseFloat(e.budget)||0),0);
  const f = (key)=>(val)=>setForm(p=>({...p,[key]:val}));

  // Giorni dall'ultimo nuovo lead entrato in pipeline: usa la data di
  // creazione ("data") delle entry tipo lead, non l'ultimo_contatto (che
  // si aggiorna anche su lead vecchi ricontattati). Se la pipeline e' vuota
  // da giorni questo contatore lo rende impossibile da ignorare, invece di
  // doverlo dedurre a occhio scorrendo le colonne.
  const leadDates = entries.filter(e=>e.tipo==="lead").map(e=>e.data).filter(Boolean);
  const ultimoLeadData = leadDates.length ? leadDates.reduce((a,b)=>a>b?a:b) : null;
  const giorniSenzaLead = ultimoLeadData
    ? Math.floor((new Date(new Date().toISOString().slice(0,10)) - new Date(ultimoLeadData)) / 86400000)
    : null;

  return (
    <div style={{...themeVars,display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",background:"var(--c-bg)"}}>

      {/* HEADER */}
      <div style={{padding:"12px 20px",borderBottom:"1px solid var(--c-border)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <div style={{fontWeight:700,fontSize:15,color:"var(--c-text-strong)"}}>🎯 Pipeline IAGREX</div>
            {giorniSenzaLead != null && giorniSenzaLead >= 3 && (
              <span title="Giorni dall'ultimo nuovo lead inserito in pipeline"
                style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:20,
                  color: giorniSenzaLead>=7 ? "#EF4444" : "#F59E0B",
                  background: giorniSenzaLead>=7 ? "#EF444420" : "#F59E0B20",
                  border:`1px solid ${giorniSenzaLead>=7?"#EF4444":"#F59E0B"}40`}}>
                ⏳ {giorniSenzaLead}g senza nuovi lead
              </span>
            )}
            {syncing               && <span style={{fontSize:11,color:"var(--c-text-dim)"}}>🔄</span>}
            {saveStatus==="saving" && <span style={{fontSize:11,color:"#F59E0B"}}>☁️ Salvando...</span>}
            {saveStatus==="saved"  && <span style={{fontSize:11,color:"#10B981"}}>✅ Salvato</span>}
            {saveStatus==="error"  && <span style={{fontSize:11,color:"#EF4444"}}>❌ Errore</span>}
          </div>
          <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
            {["tutti","lead","cliente"].map(fi=>(
              <button key={fi} onClick={()=>setFilter(fi)} style={{padding:"4px 9px",borderRadius:7,border:`1px solid ${filter===fi?"#8B5CF6":"var(--c-border)"}`,background:filter===fi?"#8B5CF620":"transparent",color:filter===fi?"#8B5CF6":"var(--c-text-faint)",cursor:"pointer",fontSize:11}}>
                {fi==="tutti"?"Tutti":fi==="lead"?"Lead":"Clienti"}
              </button>
            ))}
            <div style={{width:1,height:16,background:"var(--c-border)"}}/>
            {[["kanban","📊"],["lista","📋"]].map(([v,icon])=>(
              <button key={v} onClick={()=>setView(v)} style={{padding:"4px 9px",borderRadius:7,border:`1px solid ${view===v?"#F97316":"var(--c-border)"}`,background:view===v?"#F9731620":"transparent",color:view===v?"#F97316":"var(--c-text-faint)",cursor:"pointer",fontSize:11}}>{icon} {v==="kanban"?"Kanban":"Lista"}</button>
            ))}
            <div style={{width:1,height:16,background:"var(--c-border)"}}/>
            <button onClick={()=>openAdd("lead")}    style={{padding:"7px 16px",borderRadius:8,border:"none",background:"#3B82F6",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>+ Lead</button>
            <button onClick={()=>fileInputRef.current?.click()} style={{padding:"4px 9px",borderRadius:7,border:"1px solid #8B5CF640",background:"#8B5CF610",color:"#8B5CF6",cursor:"pointer",fontSize:11,fontWeight:600}}>📥 Importa CSV</button>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleCsvFile} style={{display:"none"}}/>
            <button onClick={syncNow} style={{padding:"4px 9px",borderRadius:7,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:11}}>{syncing?"⏳":"↻"}</button>
          </div>
        </div>
        <div style={{display:"flex",gap:20,marginTop:6}}>
          <div style={{fontSize:fs-3,color:"var(--c-text-dim)"}}><span style={{color:"#3B82F6",fontWeight:700}}>{entries.filter(e=>e.tipo==="lead").length}</span> lead · pipeline <span style={{color:"#F59E0B",fontWeight:700}}>{pipelineValue.toLocaleString("it-IT")}€/mese</span></div>
          <div style={{fontSize:fs-3,color:"var(--c-text-dim)"}}><span style={{color:"#10B981",fontWeight:700}}>{activeClients.length}</span> clienti · MRR <span style={{color:"#10B981",fontWeight:700}}>{mrr.toLocaleString("it-IT")}€</span></div>
        </div>
      </div>

      {loading && <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--c-text-faintest)",fontSize:fs-2}}>⏳ Caricamento...</div>}

      {!loading && (view==="kanban"
        ? <KanbanView entries={filtered} filter={filter} fs={fs} onEdit={openEdit} onDelete={deleteEntry} openAdd={openAdd} onGenMsg={openGenMsg} onDropToStage={handleDropToStage} onIncrTentativi={handleIncrTentativi}/>
        : <ListView   entries={filtered} fs={fs} onEdit={openEdit} onDelete={deleteEntry} onGenMsg={openGenMsg}/>
      )}

      {/* MODAL FORM */}
      {modal && (
        <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={closeModal}>
          <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:16,padding:24,width:"100%",maxWidth:520,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:15,fontWeight:700,color:"var(--c-text-strong)",marginBottom:16}}>{modal==="add"?"➕ Nuovo":"✏️ Modifica"} Lead</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <InputField label="Nome azienda *" value={form.nome}           onChange={f("nome")}     full/>
              <InputField label="Settore"         value={form.settore||""}   onChange={f("settore")}  placeholder="es. fashion, beauty, food"/>
              <InputField label="Referente"        value={form.contatto||""} onChange={f("contatto")} placeholder="Nome cognome"/>
              <InputField label="Email"            value={form.email||""}    onChange={f("email")}    type="email"/>
              <InputField label="Telefono"         value={form.telefono||""} onChange={f("telefono")}/>
              <InputField label="Budget €/mese"    value={form.budget||""}   onChange={f("budget")}   type="number"/>
              <InputField label="Sito web"         value={form.sito||""}     onChange={f("sito")}     placeholder="https://..." full/>
              <InputField label="Facebook"         value={form.facebook||""} onChange={f("facebook")} placeholder="https://facebook.com/..." full/>
              <InputField label="Instagram"        value={form.instagram||""} onChange={f("instagram")} placeholder="https://instagram.com/..." full/>
              <InputField label="LinkedIn"          value={form.linkedin||""} onChange={f("linkedin")} placeholder="https://linkedin.com/company/..."/>
              <InputField label="Referente LinkedIn" value={form.linkedin_referente||""} onChange={f("linkedin_referente")} placeholder="https://linkedin.com/in/..."/>
              <InputField label="Data"             value={form.data}         onChange={f("data")}     type="date"/>
              <InputField label="Ultimo contatto"  value={form.ultimo_contatto||""} onChange={f("ultimo_contatto")} type="date"/>
              <div style={{gridColumn:"1 / -1"}}>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:6}}>Stage</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {(form.tipo==="lead"?LEAD_STAGES:CLIENT_STAGES).map(s=>(
                    <button key={s.id} onClick={()=>setForm(p=>({...p,stage:s.id}))}
                      style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${form.stage===s.id?s.color:"var(--c-border)"}`,background:form.stage===s.id?`${s.color}20`:"transparent",color:form.stage===s.id?s.color:"var(--c-text-faint)",cursor:"pointer",fontSize:11}}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{gridColumn:"1 / -1"}}>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Note</div>
                <textarea value={form.note||""} onChange={e=>setForm(p=>({...p,note:e.target.value}))} rows={3}
                  style={{width:"100%",padding:"7px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none",resize:"vertical",fontFamily:"inherit"}}/>
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button onClick={closeModal} style={{flex:1,padding:10,borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:13}}>Annulla</button>
              <button onClick={saveEntry}  style={{flex:2,padding:10,borderRadius:8,border:"none",background:"#8B5CF6",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Salva</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL GENERATORE MESSAGGIO */}
      {msgLead && (
        <div style={{position:"fixed",inset:0,background:"#00000095",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setMsgLead(null)}>
          <div style={{background:"var(--c-panel)",border:"1px solid #3B82F640",borderRadius:16,padding:24,width:"100%",maxWidth:560,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
              <div style={{fontSize:15,fontWeight:700,color:"var(--c-text-strong)"}}>🤖 Generatore Messaggio AI</div>
              <button onClick={()=>setMsgLead(null)} style={{width:28,height:28,borderRadius:6,border:"none",background:"var(--c-border)",color:"var(--c-text-dim)",cursor:"pointer",fontSize:14}}>×</button>
            </div>
            <div style={{fontSize:12,color:"var(--c-text-faint)",marginBottom:16}}>{msgLead.nome}{msgLead.settore?` · ${msgLead.settore}`:""} {msgLead.tentativi>0?`· ${msgLead.tentativi} tentativi`:""}</div>
            <div style={{display:"flex",gap:8,marginBottom:14}}>
              {[["primo_contatto","✉️ Primo Contatto"],["follow_up","🔄 Follow-Up"],["proposta","📄 Proposta"]].map(([val,label])=>(
                <button key={val} onClick={()=>setMsgType(val)}
                  style={{flex:1,padding:"8px 4px",borderRadius:8,border:`1px solid ${msgType===val?"#3B82F6":"var(--c-border)"}`,background:msgType===val?"#3B82F620":"transparent",color:msgType===val?"#3B82F6":"var(--c-text-faint)",cursor:"pointer",fontSize:11,fontWeight:msgType===val?600:400}}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Contesto aggiuntivo</div>
              <textarea value={msgExtra} onChange={e=>setMsgExtra(e.target.value)} rows={2} placeholder="es. hanno appena lanciato una nuova linea..."
                style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:12,outline:"none",resize:"vertical",fontFamily:"inherit"}}/>
            </div>
            <button onClick={generateMessage} disabled={msgLoading}
              style={{width:"100%",padding:"11px",borderRadius:8,border:"none",background:msgLoading?"var(--c-border)":"#3B82F6",color:msgLoading?"var(--c-text-faint)":"#fff",cursor:msgLoading?"not-allowed":"pointer",fontSize:13,fontWeight:700,marginBottom:14}}>
              {msgLoading?"⏳ Generazione in corso...":"🤖 Genera Messaggio"}
            </button>
            {msgText && (
              <>
                <div style={{background:"var(--c-bg)",border:"1px solid var(--c-border)",borderRadius:8,padding:14,marginBottom:10}}>
                  <pre style={{margin:0,fontSize:13,color:"var(--c-text)",lineHeight:1.7,whiteSpace:"pre-wrap",fontFamily:"inherit"}}>{msgText}</pre>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={copyMessage} style={{flex:1,padding:"9px",borderRadius:8,border:`1px solid ${msgCopied?"#10B981":"var(--c-border)"}`,background:msgCopied?"#10B98120":"transparent",color:msgCopied?"#10B981":"var(--c-text-muted)",cursor:"pointer",fontSize:12,fontWeight:600}}>
                    {msgCopied?"✅ Copiato!":"📋 Copia"}
                  </button>
                  <button onClick={generateMessage} disabled={msgLoading} style={{flex:1,padding:"9px",borderRadius:8,border:"1px solid #3B82F640",background:"#3B82F610",color:"#3B82F6",cursor:"pointer",fontSize:12,fontWeight:600}}>🔄 Rigenera</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* MODAL ANTEPRIMA IMPORT CSV */}
      {csvPreview && (
        <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>!csvImporting && setCsvPreview(null)}>
          <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:16,padding:24,width:"100%",maxWidth:640,maxHeight:"85vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:15,fontWeight:700,color:"var(--c-text-strong)",marginBottom:6}}>📥 Anteprima Import CSV</div>
            {csvPreview.length === 0 ? (
              <div style={{fontSize:13,color:"#EF4444",marginBottom:16}}>
                Nessuna riga valida trovata. Controlla che il CSV abbia una colonna "Nome" (o "Azienda") con l'intestazione nella prima riga.
              </div>
            ) : (
              <>
                <div style={{fontSize:12,color:"var(--c-text-dim)",marginBottom:14}}>
                  Trovate <b style={{color:"#8B5CF6"}}>{csvPreview.length}</b> righe valide. Verranno aggiunte come nuovi <b>Lead</b> in stage "Da Contattare". Controlla l'anteprima prima di confermare.
                </div>
                <div style={{border:"1px solid var(--c-border)",borderRadius:10,overflow:"hidden",marginBottom:16}}>
                  <div style={{display:"grid",gridTemplateColumns:"1.5fr 1fr 1.2fr 1fr",background:"var(--c-bg)",borderBottom:"1px solid var(--c-border)"}}>
                    {["Nome","Settore","Email","Budget"].map(h=>(
                      <div key={h} style={{padding:"7px 9px",fontSize:10,fontWeight:700,color:"var(--c-text-faint)",textTransform:"uppercase"}}>{h}</div>
                    ))}
                  </div>
                  {csvPreview.slice(0,20).map((r,i)=>(
                    <div key={r.id} style={{display:"grid",gridTemplateColumns:"1.5fr 1fr 1.2fr 1fr",borderTop:i===0?"none":"1px solid var(--c-border)",background:i%2===0?"var(--c-panel)":"var(--c-panel2)"}}>
                      <div style={{padding:"7px 9px",fontSize:12,color:"var(--c-text)"}}>{r.nome}</div>
                      <div style={{padding:"7px 9px",fontSize:12,color:"var(--c-text-dim)"}}>{r.settore||"—"}</div>
                      <div style={{padding:"7px 9px",fontSize:12,color:"var(--c-text-dim)"}}>{r.email||"—"}</div>
                      <div style={{padding:"7px 9px",fontSize:12,color:"var(--c-text-dim)"}}>{r.budget||"—"}</div>
                    </div>
                  ))}
                </div>
                {csvPreview.length > 20 && (
                  <div style={{fontSize:11,color:"var(--c-text-faintest)",marginBottom:16,marginTop:-8}}>...e altre {csvPreview.length-20} righe.</div>
                )}
              </>
            )}
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setCsvPreview(null)} disabled={csvImporting} style={{flex:1,padding:10,borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:13}}>Annulla</button>
              {csvPreview.length > 0 && (
                <button onClick={confirmCsvImport} disabled={csvImporting} style={{flex:2,padding:10,borderRadius:8,border:"none",background:csvImporting?"var(--c-border)":"#8B5CF6",color:"#fff",cursor:csvImporting?"not-allowed":"pointer",fontSize:13,fontWeight:700}}>
                  {csvImporting?"⏳ Importazione...":`✅ Conferma import (${csvPreview.length})`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width:3px; height:3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--c-border); border-radius: 2px; }
        button:hover { filter: brightness(1.08); }
      `}</style>
    </div>
  );
}
