"use client";
import { useState, useEffect, useCallback } from "react";

const FASI = [
  { id:"attivo",   label:"Attivo ✅", color:"#10B981" },
  { id:"in_pausa", label:"In Pausa",  color:"#F59E0B" },
  { id:"concluso", label:"Concluso",  color:"var(--c-text-faint)" },
];
const CATEGORIE = ["Fashion","Beauty","Food","Pet","Jewelry","Home Decor","Children","Sport","Altro"];
const EMPTY_FORM = {
  id:null, nome:"", fase:"attivo", categoria:"", contatto:"", email:"",
  telefono:"", sito:"", budget:"", data_inizio:new Date().toISOString().slice(0,10),
  note:"", fatturazione:[],
};

const THEME_VARS = {
  dark:  { "--c-bg":"#09090F", "--c-panel":"#0F0F1A", "--c-panel2":"#0B0B16", "--c-border":"#1A1A2E", "--c-text-strong":"#F8FAFC", "--c-text":"#E2E8F0", "--c-text-dim":"#64748B", "--c-text-faint":"#475569", "--c-text-faintest":"#334155", "--c-text-muted":"#94A3B8" },
  light: { "--c-bg":"#F4F5F7", "--c-panel":"#FFFFFF", "--c-panel2":"#F1F2F5", "--c-border":"#E2E4E9", "--c-text-strong":"#0F172A", "--c-text":"#1A1A2E", "--c-text-dim":"#475569", "--c-text-faint":"#94A3B8", "--c-text-faintest":"#CBD5E1", "--c-text-muted":"#64748B" },
};

function currentMonthKey() { return new Date().toISOString().slice(0,7); } // YYYY-MM
function monthLabel(key) {
  const [y,m] = key.split("-");
  const mesi = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
  return `${mesi[parseInt(m)-1]} ${y}`;
}
// Ogni cliente porta con sé lo storico fatturazione (array di {mese,
// importo, fattura_inviata}), ma il mese corrente potrebbe non esserci
// ancora la prima volta che lo si apre dopo il cambio mese — qui lo
// creiamo al volo con l'importo di default preso dal budget mensile,
// stesso schema usato per i mesi in Bruno/IAGREX finance.
function ensureCurrentMonth(client) {
  const key = currentMonthKey();
  if (client.fatturazione.some(f=>f.mese===key)) return client;
  return { ...client, fatturazione:[...client.fatturazione, { mese:key, importo:parseFloat(client.budget)||0, fattura_inviata:false }] };
}
function faseInfo(id) { return FASI.find(f=>f.id===id) || FASI[0]; }

function InputField({ label, value, onChange, type="text", full=false, placeholder="" }) {
  return (
    <div style={{gridColumn:full?"1 / -1":undefined}}>
      <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>{label}</div>
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        style={{width:"100%",padding:"7px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none"}}/>
    </div>
  );
}

function ClientCard({ client, fs, onEdit, onDelete, onToggleFattura, onEditImporto, onEditImportoBlur, onDragStart, isDragging }) {
  const [showStorico, setShowStorico] = useState(false);
  const mese = currentMonthKey();
  const corrente = client.fatturazione.find(f=>f.mese===mese) || { mese, importo:0, fattura_inviata:false };
  const storicoOrdinato = [...client.fatturazione].sort((a,b)=>b.mese.localeCompare(a.mese)).filter(f=>f.mese!==mese);

  return (
    <div draggable onDragStart={e=>onDragStart(e,client)}
      style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderLeft:`3px solid ${faseInfo(client.fase).color}`,borderRadius:9,padding:11,cursor:"grab",opacity:isDragging?0.4:1,userSelect:"none"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
        <div style={{flex:1,paddingRight:6}}>
          <div style={{fontSize:fs,fontWeight:700,color:"var(--c-text-strong)",lineHeight:1.3,marginBottom:3}}>{client.nome}</div>
          {client.categoria
            ? <span style={{fontSize:fs-5,color:faseInfo(client.fase).color,fontWeight:700,background:`${faseInfo(client.fase).color}18`,padding:"1px 7px",borderRadius:10}}>{client.categoria}</span>
            : <span style={{fontSize:fs-5,color:"var(--c-text-faint)",background:"var(--c-border)",padding:"1px 7px",borderRadius:10}}>categoria —</span>}
        </div>
        <div style={{display:"flex",gap:3,flexShrink:0}}>
          <button onMouseDown={e=>e.stopPropagation()} onClick={()=>onEdit(client)} style={{width:22,height:22,borderRadius:4,border:"none",background:"var(--c-border)",color:"var(--c-text-dim)",cursor:"pointer",fontSize:10}}>✏️</button>
          <button onMouseDown={e=>e.stopPropagation()} onClick={()=>onDelete(client.id)} style={{width:22,height:22,borderRadius:4,border:"none",background:"var(--c-border)",color:"#EF4444",cursor:"pointer",fontSize:12,fontWeight:700}}>×</button>
        </div>
      </div>

      <div style={{fontSize:fs-3,color:"var(--c-text-muted)",marginBottom:6}}>
        {client.contatto && <div>👤 {client.contatto}</div>}
        {client.email && <div>📧 {client.email}</div>}
        {client.telefono && <div>📞 {client.telefono}</div>}
      </div>

      {/* Fatturazione mese corrente: il pezzo che serviva davvero — importo
          e stato fattura visibili e modificabili senza aprire il form. */}
      <div style={{borderTop:"1px solid var(--c-border)",paddingTop:8,marginTop:4}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontSize:fs-4,color:"var(--c-text-faint)",textTransform:"uppercase",letterSpacing:"0.05em"}}>{monthLabel(mese)}</span>
          <button onMouseDown={e=>e.stopPropagation()} onClick={()=>onToggleFattura(client,mese)}
            style={{padding:"2px 8px",borderRadius:6,border:`1px solid ${corrente.fattura_inviata?"#10B98160":"#EF444460"}`,background:corrente.fattura_inviata?"#10B98115":"#EF444410",color:corrente.fattura_inviata?"#10B981":"#EF4444",cursor:"pointer",fontSize:10,fontWeight:600}}>
            {corrente.fattura_inviata ? "✅ Fattura inviata" : "🚫 Da fatturare"}
          </button>
        </div>
        <input type="number" value={corrente.importo||""} placeholder="importo €"
          onMouseDown={e=>e.stopPropagation()}
          onChange={e=>onEditImporto(client,mese,e.target.value)}
          onBlur={()=>onEditImportoBlur(client)}
          style={{width:"100%",padding:"5px 8px",borderRadius:6,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:12,outline:"none"}}/>
      </div>

      {storicoOrdinato.length>0 && (
        <div style={{marginTop:8}}>
          <button onMouseDown={e=>e.stopPropagation()} onClick={()=>setShowStorico(s=>!s)}
            style={{width:"100%",padding:"5px",borderRadius:6,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:10}}>
            {showStorico?"▲ Nascondi storico":`▼ Storico (${storicoOrdinato.length} mesi)`}
          </button>
          {showStorico && (
            <div style={{marginTop:6,display:"flex",flexDirection:"column",gap:3}}>
              {storicoOrdinato.map(f=>(
                <div key={f.mese} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:fs-4,padding:"3px 6px",background:"var(--c-panel2)",borderRadius:5}}>
                  <span style={{color:"var(--c-text-faint)"}}>{monthLabel(f.mese)}</span>
                  <span style={{color:"var(--c-text-muted)"}}>{f.importo?`${f.importo.toLocaleString("it-IT")}€`:"—"}</span>
                  <span>{f.fattura_inviata?"✅":"🚫"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ClientiPage({ fontSize=14, theme="dark" }) {
  const fs = fontSize;
  const themeVars = THEME_VARS[theme] || THEME_VARS.dark;
  const [clients, setClients]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [modal, setModal]           = useState(null);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [saveStatus, setSaveStatus] = useState(null);
  const [draggedId, setDraggedId]   = useState(null);

  const loadClients = async ()=>{
    setLoading(true);
    try {
      const res = await fetch("/api/clients-data",{cache:"no-store"});
      if (res.ok) {
        const data = await res.json();
        const withMonth = (data.clients||[]).map(ensureCurrentMonth);
        setClients(withMonth);
        // Se qualche cliente non aveva ancora il mese corrente, salviamo
        // subito su Notion la nuova riga appena creata (altrimenti resta
        // solo locale e sparisce al prossimo refresh).
        withMonth.forEach((c,i)=>{
          const original = (data.clients||[])[i];
          if (original && c.fatturazione.length !== original.fatturazione.length) saveClient(c, false);
        });
      }
    } catch {}
    setLoading(false);
  };
  useEffect(()=>{ loadClients(); },[]);

  const saveClient = async (client, updateState=true)=>{
    if (updateState) { setSaveStatus("saving"); setClients(prev=>prev.map(c=>c.id===client.id?client:c)); }
    try {
      const res = await fetch("/api/clients-data",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(client)});
      const d = await res.json();
      if (updateState) {
        setSaveStatus(res.ok?"saved":"error");
        if (res.ok && d.client) setClients(prev=>prev.map(c=>c.id===client.id?{...d.client,id:d.client.notionId}:c));
        setTimeout(()=>setSaveStatus(null),2000);
      }
    } catch { if (updateState) setSaveStatus("error"); }
  };

  const toggleFattura = (client, mese)=>{
    const updated = { ...client, fatturazione: client.fatturazione.map(f=>f.mese===mese?{...f,fattura_inviata:!f.fattura_inviata}:f) };
    saveClient(updated);
  };
  const editImporto = (client, mese, val)=>{
    const updated = { ...client, fatturazione: client.fatturazione.map(f=>f.mese===mese?{...f,importo:parseFloat(val)||0}:f) };
    setClients(prev=>prev.map(c=>c.id===client.id?updated:c)); // aggiorna subito la UI mentre scrivi
  };
  const editImportoBlur = (client)=>{ const c = clients.find(x=>x.id===client.id); if (c) saveClient(c); };

  const openAdd  = (fase="attivo")=>{ setForm({...EMPTY_FORM,fase}); setModal("add"); };
  const openEdit = (client)=>{ setForm(client); setModal("edit"); };
  const closeModal = ()=>{ setModal(null); setForm(EMPTY_FORM); };
  const submitForm = ()=>{
    if (!form.nome.trim()) return;
    const client = modal==="add" ? ensureCurrentMonth({...form, fatturazione:[]}) : form;
    if (modal==="add") setClients(prev=>[...prev,client]);
    saveClient(client);
    closeModal();
  };
  const deleteClient = async (id)=>{
    if (!confirm("Eliminare questo cliente?")) return;
    const client = clients.find(c=>c.id===id);
    setClients(prev=>prev.filter(c=>c.id!==id));
    try { await fetch(`/api/clients-data?id=${client?.notionId||id}`,{method:"DELETE"}); } catch { loadClients(); }
  };

  const handleDragStart = (e, client)=>{ setDraggedId(client.id); e.dataTransfer.setData("clientId",client.id); };
  const handleDrop = (e, fase)=>{
    e.preventDefault();
    const id = e.dataTransfer.getData("clientId");
    const client = clients.find(c=>c.id===id);
    if (client && client.fase!==fase) saveClient({...client,fase});
    setDraggedId(null);
  };

  const mrr = clients.filter(c=>c.fase==="attivo").reduce((s,c)=>s+(parseFloat(c.budget)||0),0);
  const meseCorr = currentMonthKey();
  const daFatturare = clients.filter(c=>{
    const f = c.fatturazione.find(x=>x.mese===meseCorr);
    return c.fase==="attivo" && f && !f.fattura_inviata;
  }).length;
  const f = (key)=>(val)=>setForm(p=>({...p,[key]:val}));

  return (
    <div style={{...themeVars,display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",background:"var(--c-bg)"}}>
      <div style={{padding:"12px 20px",borderBottom:"1px solid var(--c-border)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <div style={{fontWeight:700,fontSize:15,color:"var(--c-text-strong)"}}>👥 Clienti</div>
            {daFatturare>0 && (
              <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:20,color:"#EF4444",background:"#EF444420",border:"1px solid #EF444440"}}>
                🧾 {daFatturare} da fatturare questo mese
              </span>
            )}
            {saveStatus==="saving" && <span style={{fontSize:11,color:"#F59E0B"}}>☁️ Salvando...</span>}
            {saveStatus==="saved"  && <span style={{fontSize:11,color:"#10B981"}}>✅ Salvato</span>}
            {saveStatus==="error"  && <span style={{fontSize:11,color:"#EF4444"}}>❌ Errore</span>}
          </div>
          <button onClick={()=>openAdd()} style={{padding:"7px 16px",borderRadius:8,border:"none",background:"#10B981",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>+ Cliente</button>
        </div>
        <div style={{fontSize:fs-3,color:"var(--c-text-dim)",marginTop:6}}>
          <span style={{color:"#10B981",fontWeight:700}}>{clients.filter(c=>c.fase==="attivo").length}</span> attivi · MRR <span style={{color:"#10B981",fontWeight:700}}>{mrr.toLocaleString("it-IT")}€</span>
        </div>
      </div>

      {loading && <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--c-text-faintest)"}}>⏳ Caricamento...</div>}

      {!loading && (
        <div style={{flex:1,overflowX:"auto",overflowY:"hidden",display:"flex",gap:10,padding:16}}>
          {FASI.map(fase=>{
            const col = clients.filter(c=>c.fase===fase.id);
            return (
              <div key={fase.id} onDragOver={e=>e.preventDefault()} onDrop={e=>handleDrop(e,fase.id)}
                style={{minWidth:260,maxWidth:260,display:"flex",flexDirection:"column",flexShrink:0}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 10px",borderRadius:8,background:`${fase.color}12`,border:`1px solid ${fase.color}30`,marginBottom:7}}>
                  <div style={{fontSize:fs-2,fontWeight:700,color:fase.color}}>{fase.label}</div>
                  <div style={{fontSize:fs-3,color:fase.color,background:`${fase.color}20`,borderRadius:10,padding:"1px 7px",fontWeight:700}}>{col.length}</div>
                </div>
                <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:8,paddingRight:2}}>
                  {col.map(c=>(
                    <ClientCard key={c.id} client={c} fs={fs} onEdit={openEdit} onDelete={deleteClient}
                      onToggleFattura={toggleFattura} onEditImporto={(cl,m,v)=>editImporto(cl,m,v)}
                      onEditImportoBlur={editImportoBlur}
                      onDragStart={handleDragStart} isDragging={draggedId===c.id}/>
                  ))}
                  {col.length===0 && <div style={{fontSize:fs-4,color:"var(--c-text-faintest)",textAlign:"center",padding:"20px 0",border:"1px dashed var(--c-border)",borderRadius:7}}>Trascina qui</div>}
                </div>
                <button onClick={()=>openAdd(fase.id)} style={{marginTop:7,padding:"6px",borderRadius:7,border:`1px dashed ${fase.color}40`,background:"transparent",color:fase.color,cursor:"pointer",fontSize:11,opacity:0.6}}>+ aggiungi</button>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={closeModal}>
          <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:16,padding:24,width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:15,fontWeight:700,color:"var(--c-text-strong)",marginBottom:16}}>{modal==="add"?"➕ Nuovo":"✏️ Modifica"} Cliente</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <InputField label="Nome *" value={form.nome} onChange={f("nome")} full/>
              <div>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Categoria</div>
                <select value={form.categoria} onChange={e=>setForm(p=>({...p,categoria:e.target.value}))}
                  style={{width:"100%",padding:"7px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13}}>
                  <option value="">—</option>
                  {CATEGORIE.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <InputField label="Budget mensile €" value={form.budget} onChange={f("budget")} type="number"/>
              <InputField label="Referente" value={form.contatto} onChange={f("contatto")}/>
              <InputField label="Email" value={form.email} onChange={f("email")} type="email"/>
              <InputField label="Telefono" value={form.telefono} onChange={f("telefono")}/>
              <InputField label="Sito web" value={form.sito} onChange={f("sito")} full/>
              <InputField label="Data inizio" value={form.data_inizio} onChange={f("data_inizio")} type="date"/>
              <div style={{gridColumn:"1 / -1"}}>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:6}}>Fase</div>
                <div style={{display:"flex",gap:6}}>
                  {FASI.map(fase=>(
                    <button key={fase.id} onClick={()=>setForm(p=>({...p,fase:fase.id}))}
                      style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${form.fase===fase.id?fase.color:"var(--c-border)"}`,background:form.fase===fase.id?`${fase.color}20`:"transparent",color:form.fase===fase.id?fase.color:"var(--c-text-faint)",cursor:"pointer",fontSize:11}}>
                      {fase.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{gridColumn:"1 / -1"}}>
                <div style={{fontSize:11,color:"var(--c-text-dim)",marginBottom:4}}>Note</div>
                <textarea value={form.note} onChange={e=>setForm(p=>({...p,note:e.target.value}))} rows={3}
                  style={{width:"100%",padding:"7px 10px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-bg)",color:"var(--c-text)",fontSize:13,outline:"none",resize:"vertical",fontFamily:"inherit"}}/>
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button onClick={closeModal} style={{flex:1,padding:10,borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:13}}>Annulla</button>
              <button onClick={submitForm} style={{flex:2,padding:10,borderRadius:8,border:"none",background:"#10B981",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Salva</button>
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
