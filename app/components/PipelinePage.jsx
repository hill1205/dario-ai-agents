"use client";
import { useState, useEffect, useCallback, useRef } from "react";

const LEAD_STAGES = [
  { id:"da_contattare",    label:"Da Contattare",   color:"#475569" },
  { id:"contattato",       label:"Contattato",       color:"#3B82F6" },
  { id:"proposta_inviata", label:"Proposta Inviata", color:"#F59E0B" },
  { id:"in_trattativa",    label:"In Trattativa",    color:"#F97316" },
  { id:"vinto",            label:"Vinto 🎉",          color:"#10B981" },
  { id:"perso",            label:"Perso",             color:"#EF4444" },
];
const CLIENT_STAGES = [
  { id:"attivo",   label:"Attivo ✅", color:"#10B981" },
  { id:"in_pausa", label:"In Pausa",  color:"#F59E0B" },
  { id:"concluso", label:"Concluso",  color:"#475569" },
];
const EMPTY_FORM = {
  id:null, tipo:"lead", nome:"", contatto:"", email:"",
  telefono:"", budget:"", stage:"da_contattare",
  settore:"", data:new Date().toISOString().slice(0,10), note:"",
};

function genId() { return Math.random().toString(36).slice(2,10); }
function stageColor(s,t) { return (t==="cliente"?CLIENT_STAGES:LEAD_STAGES).find(x=>x.id===s)?.color||"#475569"; }
function stageLabel(s,t) { return (t==="cliente"?CLIENT_STAGES:LEAD_STAGES).find(x=>x.id===s)?.label||s; }
function lsGet() { try { const s=localStorage.getItem("dario-pipeline"); return s?JSON.parse(s):[]; } catch { return []; } }
function lsSet(d) { try { localStorage.setItem("dario-pipeline",JSON.stringify(d)); } catch {} }

function InputField({ label, value, onChange, type="text", full=false }) {
  return (
    <div style={{gridColumn:full?"1 / -1":undefined}}>
      <div style={{fontSize:11,color:"#64748B",marginBottom:4}}>{label}</div>
      <input type={type} value={value} onChange={e=>onChange(e.target.value)}
        style={{width:"100%",padding:"7px 10px",borderRadius:7,border:"1px solid #1A1A2E",background:"#09090F",color:"#E2E8F0",fontSize:13,outline:"none"}}/>
    </div>
  );
}

function EntryCard({ entry, onEdit, onDelete, onGenMsg, fs, onDragStart, isDragging }) {
  const color = stageColor(entry.stage, entry.tipo);
  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, entry)}
      style={{
        background:"#0F0F1A",
        border:"1px solid #1A1A2E",
        borderLeft:`3px solid ${color}`,
        borderRadius:8,
        padding:10,
        cursor:"grab",
        opacity: isDragging ? 0.4 : 1,
        transition:"opacity 0.15s",
        userSelect:"none",
      }}
    >
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
        <div style={{fontSize:fs-1,fontWeight:700,color:"#E2E8F0",lineHeight:1.3,flex:1,paddingRight:6}}>{entry.nome}</div>
        <div style={{display:"flex",gap:3,flexShrink:0}}>
          <button onMouseDown={e=>e.stopPropagation()} onClick={()=>onEdit(entry)}
            style={{width:22,height:22,borderRadius:4,border:"none",background:"#1A1A2E",color:"#94A3B8",cursor:"pointer",fontSize:10}}>✏️</button>
          <button onMouseDown={e=>e.stopPropagation()} onClick={()=>onDelete(entry.id)}
            style={{width:22,height:22,borderRadius:4,border:"none",background:"#1A1A2E",color:"#EF4444",cursor:"pointer",fontSize:12,fontWeight:700}}>×</button>
        </div>
      </div>
      {entry.settore  && <div style={{fontSize:fs-5,color:"#8B5CF6",fontWeight:600,marginBottom:2}}>🏷️ {entry.settore}</div>}
      {entry.contatto && <div style={{fontSize:fs-4,color:"#64748B",marginBottom:2}}>👤 {entry.contatto}</div>}
      {entry.email    && <div style={{fontSize:fs-4,color:"#64748B",marginBottom:2}}>📧 {entry.email}</div>}
      {entry.budget   && <div style={{fontSize:fs-3,color:"#10B981",fontWeight:700,marginBottom:4}}>💶 {parseFloat(entry.budget).toLocaleString("it-IT")}€/mese</div>}
      {entry.note     && <div style={{fontSize:fs-4,color:"#475569",lineHeight:1.4,marginBottom:4}}>{entry.note.slice(0,70)}{entry.note.length>70?"…":""}</div>}
      <div style={{fontSize:fs-5,color:"#334155",marginTop:4}}>{entry.data}</div>
      {entry.tipo==="lead" && (
        <button onMouseDown={e=>e.stopPropagation()} onClick={()=>onGenMsg(entry)}
          style={{marginTop:8,width:"100%",padding:"6px 8px",borderRadius:6,border:"1px solid #3B82F650",background:"#3B82F610",color:"#3B82F6",cursor:"pointer",fontSize:fs-4,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
          🤖 Genera Messaggio Outreach
        </button>
      )}
    </div>
  );
}

function KanbanView({ entries, filter, fs, onEdit, onDelete, openAdd, onGenMsg, onDropToStage }) {
  const [draggedId, setDraggedId]     = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null); // "tipo-stageid"

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

  const handleDragOver = (e, colKey) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(colKey);
  };

  const handleDrop = (e, stage, tipo) => {
    e.preventDefault();
    const entryId   = e.dataTransfer.getData("entryId");
    const entryTipo = e.dataTransfer.getData("entryTipo");
    if (entryId && entryTipo === tipo) {
      onDropToStage(entryId, stage);
    }
    setDraggedId(null);
    setDragOverCol(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverCol(null);
  };

  return (
    <div style={{flex:1,overflowX:"auto",overflowY:"hidden",display:"flex",gap:10,padding:16,alignItems:"stretch"}}>
      {cols.map(col => {
        const colKey     = `${col.tipo}-${col.id}`;
        const colEntries = entries.filter(e=>e.stage===col.id&&e.tipo===col.tipo);
        const isOver     = dragOverCol===colKey;
        return (
          <div
            key={colKey}
            onDragOver={e=>handleDragOver(e,colKey)}
            onDrop={e=>handleDrop(e,col.id,col.tipo)}
            onDragLeave={()=>setDragOverCol(null)}
            style={{
              minWidth:220, maxWidth:220,
              display:"flex", flexDirection:"column",
              flexShrink:0,
              borderRadius:10,
              border: isOver ? `2px solid ${col.color}` : "2px solid transparent",
              background: isOver ? `${col.color}08` : "transparent",
              transition:"border 0.15s, background 0.15s",
            }}
          >
            {/* Intestazione colonna */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 10px",borderRadius:8,background:`${col.color}12`,border:`1px solid ${col.color}30`,flexShrink:0,marginBottom:7}}>
              <div>
                <div style={{fontSize:9,color:col.color,opacity:0.6,textTransform:"uppercase",letterSpacing:"0.08em"}}>{col.tipo==="lead"?"Lead":"Cliente"}</div>
                <div style={{fontSize:fs-2,fontWeight:700,color:col.color}}>{col.label}</div>
              </div>
              <div style={{fontSize:fs-3,color:col.color,background:`${col.color}20`,borderRadius:10,padding:"1px 7px",fontWeight:700}}>{colEntries.length}</div>
            </div>

            {/* Card scrollabili */}
            <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:7,paddingRight:2}}>
              {colEntries.map(e=>(
                <EntryCard
                  key={e.id} entry={e} onEdit={onEdit} onDelete={onDelete}
                  onGenMsg={onGenMsg} fs={fs}
                  onDragStart={handleDragStart}
                  isDragging={draggedId===e.id}
                  onDragEnd={handleDragEnd}
                />
              ))}
              {colEntries.length===0 && (
                <div style={{fontSize:fs-4,color:"#1E293B",textAlign:"center",padding:"20px 0",border:"1px dashed #1A1A2E",borderRadius:7}}>
                  Trascina qui
                </div>
              )}
            </div>

            {/* Bottone aggiungi */}
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
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"#334155",fontSize:fs-2}}>
      Nessun record — aggiungi il primo lead o cliente!
    </div>
  );
  return (
    <div style={{flex:1,overflowY:"auto",padding:16}}>
      <div style={{background:"#0F0F1A",border:"1px solid #1A1A2E",borderRadius:10,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"2fr 80px 140px 80px 130px 90px",background:"#09090F",borderBottom:"1px solid #1A1A2E"}}>
          {["Nome","Tipo","Stage","Budget","Contatto",""].map(h=>(
            <div key={h} style={{padding:"9px 12px",fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em"}}>{h}</div>
          ))}
        </div>
        {entries.map((entry,i)=>{
          const color = stageColor(entry.stage,entry.tipo);
          const cell  = {padding:"10px 12px",fontSize:fs-2,color:"#94A3B8",borderTop:i===0?"none":"1px solid #1A1A2E",background:i%2===0?"#0F0F1A":"#0B0B16",display:"flex",alignItems:"center"};
          return (
            <div key={entry.id} style={{display:"grid",gridTemplateColumns:"2fr 80px 140px 80px 130px 90px"}}>
              <div style={{...cell,color:"#E2E8F0",fontWeight:600,flexDirection:"column",alignItems:"flex-start",gap:1}}>
                <span>{entry.nome}</span>
                {entry.settore && <span style={{fontSize:fs-5,color:"#8B5CF6"}}>🏷️ {entry.settore}</span>}
              </div>
              <div style={cell}><span style={{padding:"2px 7px",borderRadius:10,background:entry.tipo==="lead"?"#3B82F620":"#10B98120",color:entry.tipo==="lead"?"#3B82F6":"#10B981",fontSize:10,fontWeight:600}}>{entry.tipo==="lead"?"Lead":"Cliente"}</span></div>
              <div style={cell}><span style={{padding:"2px 8px",borderRadius:10,background:`${color}20`,color,fontSize:10,fontWeight:600}}>{stageLabel(entry.stage,entry.tipo)}</span></div>
              <div style={{...cell,color:"#10B981",fontWeight:700}}>{entry.budget?`${parseFloat(entry.budget).toLocaleString("it-IT")}€`:"–"}</div>
              <div style={cell}>{entry.contatto||"–"}</div>
              <div style={{...cell,gap:4}}>
                <button onClick={()=>onEdit(entry)} style={{width:24,height:24,borderRadius:5,border:"1px solid #1A1A2E",background:"transparent",color:"#64748B",cursor:"pointer",fontSize:10}}>✏️</button>
                <button onClick={()=>onDelete(entry.id)} style={{width:24,height:24,borderRadius:5,border:"1px solid #2A1A1A",background:"transparent",color:"#EF4444",cursor:"pointer",fontSize:12,fontWeight:700}}>×</button>
                {entry.tipo==="lead" && (
                  <button onClick={()=>onGenMsg(entry)} title="Genera messaggio" style={{width:24,height:24,borderRadius:5,border:"1px solid #3B82F640",background:"#3B82F610",color:"#3B82F6",cursor:"pointer",fontSize:11}}>🤖</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function PipelinePage({ fontSize=14 }) {
  const fs = fontSize;
  const [entries, setEntries]       = useState([]);
  const [view, setView]             = useState("kanban");
  const [filter, setFilter]         = useState("tutti");
  const [modal, setModal]           = useState(null);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [loading, setLoading]       = useState(true);
  const [syncing, setSyncing]       = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  const [importing, setImporting]       = useState(false);
  const [importResult, setImportResult] = useState(null);

  const [msgLead, setMsgLead]       = useState(null);
  const [msgType, setMsgType]       = useState("primo_contatto");
  const [msgExtra, setMsgExtra]     = useState("");
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgText, setMsgText]       = useState("");
  const [msgCopied, setMsgCopied]   = useState(false);

  useEffect(()=>{ loadData(); },[]);

  const loadData = async ()=>{
    setLoading(true);
    try {
      const res = await fetch("/api/pipeline-data");
      if (res.ok) {
        const data = await res.json();
        const cuEntries = data.entries||[];
        if (cuEntries.length>0) { setEntries(cuEntries); lsSet(cuEntries); setLoading(false); return; }
      }
    } catch {}
    setEntries(lsGet());
    setLoading(false);
  };

  const syncNow = async ()=>{
    setSyncing(true);
    try {
      const res = await fetch("/api/pipeline-data");
      if (res.ok) { const data=await res.json(); const e=data.entries||[]; setEntries(e); lsSet(e); }
    } catch {} finally { setSyncing(false); }
  };

  const saveData = useCallback(async (updated)=>{
    setEntries(updated); lsSet(updated); setSaveStatus("saving");
    try {
      const res = await fetch("/api/pipeline-data",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entries:updated})});
      setSaveStatus(res.ok?"saved":"error");
    } catch { setSaveStatus("error"); }
    setTimeout(()=>setSaveStatus(null),2500);
  },[]);

  // Drag & drop: sposta uno stage
  const handleDropToStage = useCallback((entryId, newStage) => {
    setEntries(prev => {
      const updated = prev.map(e => e.id===entryId ? {...e, stage:newStage} : e);
      lsSet(updated);
      // Salva su ClickUp in background
      fetch("/api/pipeline-data",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entries:updated})}).catch(()=>{});
      return updated;
    });
  },[]);

  // Import da ClickUp LEAD BEA
  const importFromClickup = async ()=>{
    setImporting(true); setImportResult(null);
    try {
      const res = await fetch("/api/lead-bea");
      if (!res.ok) throw new Error(`Errore API ${res.status}`);
      const data  = await res.json();
      const tasks = data.tasks||[];
      const existingNames = new Set(entries.map(e=>e.nome.toLowerCase().trim()));
      const toAdd = []; let skipped=0;
      tasks.forEach(task=>{
        if (task.nome.startsWith("[RICERCA]")) { skipped++; return; }
        if (existingNames.has(task.nome.toLowerCase().trim())) { skipped++; return; }
        toAdd.push({ id:genId(), tipo:"lead", nome:task.nome, contatto:"", email:"", telefono:"", budget:"", stage:"da_contattare", settore:"", data:new Date().toISOString().slice(0,10), note:"", clickupId:task.clickupId });
      });
      if (toAdd.length>0) await saveData([...entries,...toAdd]);
      setImportResult({added:toAdd.length, skipped});
      setTimeout(()=>setImportResult(null),5000);
    } catch(e) {
      setImportResult({error:e.message});
      setTimeout(()=>setImportResult(null),5000);
    }
    setImporting(false);
  };

  const openAdd    = (tipo="lead",stage=null)=>{ setForm({...EMPTY_FORM,tipo,stage:stage||(tipo==="lead"?"da_contattare":"attivo"),data:new Date().toISOString().slice(0,10)}); setModal("add"); };
  const openEdit   = (entry)=>{ setForm({...entry}); setModal("edit"); };
  const closeModal = ()=>{ setModal(null); setForm(EMPTY_FORM); };

  const saveEntry = ()=>{
    if (!form.nome.trim()) return;
    const updated = modal==="add" ? [...entries,{...form,id:genId()}] : entries.map(e=>e.id===form.id?form:e);
    saveData(updated); closeModal();
  };

  const deleteEntry = (id)=>{
    if (!confirm("Eliminare questo record?")) return;
    saveData(entries.filter(e=>e.id!==id));
  };

  const openGenMsg = (entry)=>{ setMsgLead(entry); setMsgType("primo_contatto"); setMsgExtra(""); setMsgText(""); setMsgCopied(false); };

  const generateMessage = async ()=>{
    if (!msgLead) return;
    setMsgLoading(true); setMsgText(""); setMsgCopied(false);
    const typeMap = {primo_contatto:"primo contatto",follow_up:"follow-up",proposta:"proposta di collaborazione"};
    try {
      const res = await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        model:"claude-sonnet-4-6", max_tokens:1000,
        system:[{type:"text",text:`Sei Mario, responsabile business development di IAGREX SRL — agenzia di performance marketing specializzata in Meta Ads e Shopify per e-commerce italiani. Risultati medi clienti: +30-60% ROAS nei primi 60 giorni.\n\nScrivi messaggi di outreach in italiano: professionali, concisi, personalizzati. Obiettivo: ottenere risposta o call. Max 120 parole. Tono diretto e credibile. Non usare "spero che tu stia bene". Vai subito al punto.`,cache_control:{type:"ephemeral"}}],
        messages:[{role:"user",content:`Scrivi un messaggio di ${typeMap[msgType]||"primo contatto"} per:\n\nAzienda: ${msgLead.nome}\nReferente: ${msgLead.contatto||"non specificato"}\nSettore: ${msgLead.settore||"e-commerce"}\nBudget stimato: ${msgLead.budget?msgLead.budget+"€/mese":"non specificato"}\nNote: ${msgLead.note||"nessuna"}${msgExtra?`\nContesto: ${msgExtra}`:""}`}],
        agentId:"mario"
      })});
      const d = await res.json();
      setMsgText(d.content?.[0]?.text||"Errore.");
    } catch(e) { setMsgText("Errore: "+e.message); }
    setMsgLoading(false);
  };

  const copyMessage = ()=>{ navigator.clipboard.writeText(msgText).then(()=>{ setMsgCopied(true); setTimeout(()=>setMsgCopied(false),2500); }); };

  const filtered      = entries.filter(e=>filter==="tutti"||e.tipo===filter);
  const activeClients = entries.filter(e=>e.tipo==="cliente"&&e.stage==="attivo");
  const mrr           = activeClients.reduce((s,e)=>s+(parseFloat(e.budget)||0),0);
  const pipelineValue = entries.filter(e=>e.tipo==="lead"&&!["vinto","perso"].includes(e.stage)).reduce((s,e)=>s+(parseFloat(e.budget)||0),0);
  const f = (key)=>(val)=>setForm(p=>({...p,[key]:val}));

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",background:"#09090F"}}>

      {/* HEADER */}
      <div style={{padding:"14px 20px",borderBottom:"1px solid #1A1A2E",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <div style={{fontWeight:700,fontSize:15,color:"#F8FAFC"}}>🎯 Pipeline IAGREX</div>
            {syncing               && <span style={{fontSize:11,color:"#64748B"}}>🔄 Sync...</span>}
            {saveStatus==="saving" && <span style={{fontSize:11,color:"#F59E0B"}}>☁️ Salvataggio...</span>}
            {saveStatus==="saved"  && <span style={{fontSize:11,color:"#10B981"}}>✅ Salvato</span>}
            {saveStatus==="error"  && <span style={{fontSize:11,color:"#EF4444"}}>❌ Errore</span>}
            {importResult&&!importResult.error && <span style={{fontSize:11,color:"#10B981"}}>✅ Importati {importResult.added} {importResult.skipped>0?`· ${importResult.skipped} saltati`:""}</span>}
            {importResult?.error   && <span style={{fontSize:11,color:"#EF4444"}}>❌ {importResult.error}</span>}
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            {["tutti","lead","cliente"].map(fi=>(
              <button key={fi} onClick={()=>setFilter(fi)}
                style={{padding:"4px 10px",borderRadius:7,border:`1px solid ${filter===fi?"#8B5CF6":"#1A1A2E"}`,background:filter===fi?"#8B5CF620":"transparent",color:filter===fi?"#8B5CF6":"#475569",cursor:"pointer",fontSize:11}}>
                {fi==="tutti"?"Tutti":fi==="lead"?"Lead":"Clienti"}
              </button>
            ))}
            <div style={{width:1,height:18,background:"#1A1A2E"}}/>
            {[["kanban","📊 Kanban"],["lista","📋 Lista"]].map(([v,label])=>(
              <button key={v} onClick={()=>setView(v)}
                style={{padding:"4px 10px",borderRadius:7,border:`1px solid ${view===v?"#F97316":"#1A1A2E"}`,background:view===v?"#F9731620":"transparent",color:view===v?"#F97316":"#475569",cursor:"pointer",fontSize:11}}>
                {label}
              </button>
            ))}
            <div style={{width:1,height:18,background:"#1A1A2E"}}/>
            <button onClick={importFromClickup} disabled={importing}
              style={{padding:"4px 10px",borderRadius:7,border:"1px solid #8B5CF640",background:importing?"#1A1A2E":"#8B5CF615",color:importing?"#475569":"#8B5CF6",cursor:importing?"not-allowed":"pointer",fontSize:11,fontWeight:600}}>
              {importing?"⏳ Importando...":"⬇️ Importa da ClickUp"}
            </button>
            <button onClick={()=>openAdd("lead")}    style={{padding:"4px 10px",borderRadius:7,border:"none",background:"#3B82F6",color:"#fff",cursor:"pointer",fontSize:11,fontWeight:600}}>+ Lead</button>
            <button onClick={()=>openAdd("cliente")} style={{padding:"4px 10px",borderRadius:7,border:"none",background:"#10B981",color:"#fff",cursor:"pointer",fontSize:11,fontWeight:600}}>+ Cliente</button>
            <button onClick={syncNow} style={{padding:"4px 10px",borderRadius:7,border:"1px solid #1A1A2E",background:"transparent",color:"#475569",cursor:"pointer",fontSize:11}}>{syncing?"⏳":"↻"}</button>
          </div>
        </div>
        <div style={{display:"flex",gap:20,marginTop:8}}>
          <div style={{fontSize:fs-3,color:"#64748B"}}>
            <span style={{color:"#3B82F6",fontWeight:700}}>{entries.filter(e=>e.tipo==="lead").length}</span> lead · pipeline <span style={{color:"#F59E0B",fontWeight:700}}>{pipelineValue.toLocaleString("it-IT")}€/mese</span>
          </div>
          <div style={{fontSize:fs-3,color:"#64748B"}}>
            <span style={{color:"#10B981",fontWeight:700}}>{activeClients.length}</span> clienti attivi · MRR <span style={{color:"#10B981",fontWeight:700}}>{mrr.toLocaleString("it-IT")}€</span>
          </div>
        </div>
      </div>

      {loading && <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"#334155",fontSize:fs-2}}>⏳ Caricamento...</div>}

      {!loading && (view==="kanban"
        ? <KanbanView entries={filtered} filter={filter} fs={fs} onEdit={openEdit} onDelete={deleteEntry} openAdd={openAdd} onGenMsg={openGenMsg} onDropToStage={handleDropToStage}/>
        : <ListView   entries={filtered} fs={fs} onEdit={openEdit} onDelete={deleteEntry} onGenMsg={openGenMsg}/>
      )}

      {/* MODAL FORM */}
      {modal && (
        <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={closeModal}>
          <div style={{background:"#0F0F1A",border:"1px solid #1A1A2E",borderRadius:16,padding:24,width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:15,fontWeight:700,color:"#F8FAFC",marginBottom:20}}>
              {modal==="add"?"➕ Nuovo":"✏️ Modifica"} {form.tipo==="lead"?"Lead":"Cliente"}
            </div>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              {[["lead","🎯 Lead","#3B82F6"],["cliente","✅ Cliente","#10B981"]].map(([t,label,color])=>(
                <button key={t} onClick={()=>setForm(p=>({...p,tipo:t,stage:t==="lead"?"da_contattare":"attivo"}))}
                  style={{flex:1,padding:9,borderRadius:8,border:`1px solid ${form.tipo===t?color:"#1A1A2E"}`,background:form.tipo===t?`${color}20`:"transparent",color:form.tipo===t?color:"#475569",cursor:"pointer",fontSize:12,fontWeight:600}}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <InputField label="Nome azienda *" value={form.nome}        onChange={f("nome")}     full/>
              <InputField label="Settore"         value={form.settore||""} onChange={f("settore")}/>
              <InputField label="Referente"        value={form.contatto}   onChange={f("contatto")}/>
              <InputField label="Email"            value={form.email}      onChange={f("email")}    type="email"/>
              <InputField label="Telefono"         value={form.telefono}   onChange={f("telefono")}/>
              <InputField label="Budget €/mese"    value={form.budget}     onChange={f("budget")}   type="number"/>
              <InputField label="Data"             value={form.data}       onChange={f("data")}     type="date"/>
              <div style={{gridColumn:"1 / -1"}}>
                <div style={{fontSize:11,color:"#64748B",marginBottom:6}}>Stage</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {(form.tipo==="lead"?LEAD_STAGES:CLIENT_STAGES).map(s=>(
                    <button key={s.id} onClick={()=>setForm(p=>({...p,stage:s.id}))}
                      style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${form.stage===s.id?s.color:"#1A1A2E"}`,background:form.stage===s.id?`${s.color}20`:"transparent",color:form.stage===s.id?s.color:"#475569",cursor:"pointer",fontSize:11}}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{gridColumn:"1 / -1"}}>
                <div style={{fontSize:11,color:"#64748B",marginBottom:4}}>Note</div>
                <textarea value={form.note} onChange={e=>setForm(p=>({...p,note:e.target.value}))} rows={3}
                  style={{width:"100%",padding:"7px 10px",borderRadius:7,border:"1px solid #1A1A2E",background:"#09090F",color:"#E2E8F0",fontSize:13,outline:"none",resize:"vertical",fontFamily:"inherit"}}/>
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button onClick={closeModal} style={{flex:1,padding:10,borderRadius:8,border:"1px solid #1A1A2E",background:"transparent",color:"#475569",cursor:"pointer",fontSize:13}}>Annulla</button>
              <button onClick={saveEntry}  style={{flex:2,padding:10,borderRadius:8,border:"none",background:"#8B5CF6",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Salva</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL GENERATORE MESSAGGIO */}
      {msgLead && (
        <div style={{position:"fixed",inset:0,background:"#00000095",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setMsgLead(null)}>
          <div style={{background:"#0F0F1A",border:"1px solid #3B82F640",borderRadius:16,padding:24,width:"100%",maxWidth:560,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
              <div style={{fontSize:15,fontWeight:700,color:"#F8FAFC"}}>🤖 Generatore Messaggio AI</div>
              <button onClick={()=>setMsgLead(null)} style={{width:28,height:28,borderRadius:6,border:"none",background:"#1A1A2E",color:"#64748B",cursor:"pointer",fontSize:14}}>×</button>
            </div>
            <div style={{fontSize:12,color:"#475569",marginBottom:20}}>{msgLead.nome}{msgLead.settore?` · ${msgLead.settore}`:""}</div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,color:"#64748B",marginBottom:8,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em"}}>Tipo di messaggio</div>
              <div style={{display:"flex",gap:8}}>
                {[["primo_contatto","✉️ Primo Contatto"],["follow_up","🔄 Follow-Up"],["proposta","📄 Proposta"]].map(([val,label])=>(
                  <button key={val} onClick={()=>setMsgType(val)}
                    style={{flex:1,padding:"8px 6px",borderRadius:8,border:`1px solid ${msgType===val?"#3B82F6":"#1A1A2E"}`,background:msgType===val?"#3B82F620":"transparent",color:msgType===val?"#3B82F6":"#475569",cursor:"pointer",fontSize:11,fontWeight:msgType===val?600:400}}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:11,color:"#64748B",marginBottom:4}}>Contesto aggiuntivo (opzionale)</div>
              <textarea value={msgExtra} onChange={e=>setMsgExtra(e.target.value)} rows={2}
                placeholder="es. hanno appena lanciato una nuova linea prodotti..."
                style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid #1A1A2E",background:"#09090F",color:"#E2E8F0",fontSize:12,outline:"none",resize:"vertical",fontFamily:"inherit"}}/>
            </div>
            <button onClick={generateMessage} disabled={msgLoading}
              style={{width:"100%",padding:"11px",borderRadius:8,border:"none",background:msgLoading?"#1A1A2E":"#3B82F6",color:msgLoading?"#475569":"#fff",cursor:msgLoading?"not-allowed":"pointer",fontSize:13,fontWeight:700,marginBottom:16}}>
              {msgLoading?"⏳ Generazione in corso...":"🤖 Genera Messaggio"}
            </button>
            {msgText && (
              <div>
                <div style={{fontSize:11,color:"#64748B",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em"}}>Messaggio generato</div>
                <div style={{background:"#09090F",border:"1px solid #1A1A2E",borderRadius:8,padding:14,marginBottom:10}}>
                  <pre style={{margin:0,fontSize:13,color:"#E2E8F0",lineHeight:1.7,whiteSpace:"pre-wrap",fontFamily:"inherit"}}>{msgText}</pre>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={copyMessage}
                    style={{flex:1,padding:"9px",borderRadius:8,border:`1px solid ${msgCopied?"#10B981":"#1A1A2E"}`,background:msgCopied?"#10B98120":"transparent",color:msgCopied?"#10B981":"#94A3B8",cursor:"pointer",fontSize:12,fontWeight:600}}>
                    {msgCopied?"✅ Copiato!":"📋 Copia"}
                  </button>
                  <button onClick={generateMessage} disabled={msgLoading}
                    style={{flex:1,padding:"9px",borderRadius:8,border:"1px solid #3B82F640",background:"#3B82F610",color:"#3B82F6",cursor:"pointer",fontSize:12,fontWeight:600}}>
                    🔄 Rigenera
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width:3px; height:3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1A1A2E; border-radius: 2px; }
        button:hover { filter: brightness(1.08); }
      `}</style>
    </div>
  );
}
