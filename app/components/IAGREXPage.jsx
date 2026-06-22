"use client";
import { useState, useEffect, useCallback } from "react";

const CAT_ENTRATE = ["Retainer","One-time","Consulenza","Bonus","Altro"];
const CAT_USCITE  = ["Keez / Commercialista","Software & Tools","Marketing","Hosting","Personale IAGREX","Tasse & Contributi","Altro"];
const OBIETTIVO_ANNUO = 1000000;

const CONTI_IAGREX = [
  { id: "unicredit_eur", label: "UniCredit Romania — EUR", currency: "€" },
  { id: "unicredit_ron", label: "UniCredit Romania — RON", currency: "RON" },
];

const EMPTY_MONTH = { entrate: [], uscite: [], saldi: { unicredit_eur: 0, unicredit_ron: 0 } };

function genId() { return Math.random().toString(36).slice(2,10); }
function fmt(n) { return (parseFloat(n)||0).toLocaleString("it-IT",{minimumFractionDigits:0,maximumFractionDigits:2}); }
function getMonthLabel(ym) {
  const [y,m] = ym.split("-");
  const months=["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
  return `${months[parseInt(m)-1]} ${y}`;
}
function getCurrentMonth() { return new Date().toISOString().slice(0,7); }
function getCurrentYear() { return new Date().getFullYear().toString(); }

export default function IAGREXPage({ fontSize=14, onBack }) {
  const fs = fontSize;
  const [allData, setAllData]     = useState({});
  const [month, setMonth]         = useState(getCurrentMonth());
  const [tab, setTab]             = useState("entrate");
  const [loading, setLoading]     = useState(true);
  const [saveStatus, setSaveStatus] = useState(null);
  const [modal, setModal]         = useState(null);
  const [form, setForm]           = useState({});

  useEffect(()=>{ loadData(); },[]);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/iagrex-finance");
      if (res.ok) { const j = await res.json(); setAllData(j.data||{}); }
    } catch {}
    setLoading(false);
  };

  const monthData = allData[month] || EMPTY_MONTH;

  const saveData = useCallback(async (newAllData) => {
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
  },[]);

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

  // YTD progress
  const year = getCurrentYear();
  const ytdRevenue = Object.entries(allData)
    .filter(([k])=>k.startsWith(year))
    .reduce((s,[,v])=>s+(v.entrate||[]).reduce((ss,e)=>ss+(parseFloat(e.importo)||0),0),0);
  const ytdPct = Math.min(Math.round((ytdRevenue/OBIETTIVO_ANNUO)*100*10)/10, 100);

  // Month totals
  const totEntrate = monthData.entrate.reduce((s,e)=>s+(parseFloat(e.importo)||0),0);
  const totUscite  = monthData.uscite.reduce((s,e)=>s+(parseFloat(e.importo)||0),0);
  const saldoNetto = totEntrate - totUscite;

  const openAdd = (tipo) => { setForm({descrizione:"",importo:"",categoria:tipo==="entrata"?CAT_ENTRATE[0]:CAT_USCITE[0],cliente:""}); setModal({tipo,mode:"add"}); };
  const openEdit = (tipo,item) => { setForm({...item}); setModal({tipo,mode:"edit",item}); };
  const closeModal = () => { setModal(null); setForm({}); };

  const saveItem = () => {
    if (!form.descrizione?.trim()||!form.importo) return;
    const item = {...form,importo:parseFloat(form.importo),id:modal.mode==="add"?genId():form.id};
    let updated = {...monthData};
    if (modal.tipo==="entrata") {
      updated.entrate = modal.mode==="add"?[...updated.entrate,item]:updated.entrate.map(e=>e.id===item.id?item:e);
    } else {
      updated.uscite = modal.mode==="add"?[...updated.uscite,item]:updated.uscite.map(e=>e.id===item.id?item:e);
    }
    updateMonth(updated);
    closeModal();
  };

  const deleteItem = (tipo,id) => {
    if (!confirm("Eliminare?")) return;
    let updated = {...monthData};
    if (tipo==="entrata") updated.entrate=updated.entrate.filter(e=>e.id!==id);
    else updated.uscite=updated.uscite.filter(e=>e.id!==id);
    updateMonth(updated);
  };

  const updateSaldo = (contoId,val) => {
    updateMonth({...monthData,saldi:{...monthData.saldi,[contoId]:parseFloat(val)||0}});
  };

  const Cell = ({style={},children}) => (
    <div style={{padding:"10px 12px",fontSize:fs-2,color:"#94A3B8",display:"flex",alignItems:"center",...style}}>{children}</div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",background:"#09090F"}}>

      {/* Header */}
      <div style={{padding:"14px 20px",borderBottom:"1px solid #1A1A2E",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {onBack && <button onClick={onBack} style={{padding:"5px 10px",borderRadius:7,border:"1px solid #1A1A2E",background:"transparent",color:"#64748B",cursor:"pointer",fontSize:12}}>← Home</button>}
            <div style={{fontWeight:700,fontSize:15,color:"#F8FAFC"}}>📊 Finanze IAGREX</div>
            {saveStatus==="saving" && <span style={{fontSize:11,color:"#F59E0B"}}>☁️ Salvataggio...</span>}
            {saveStatus==="saved"  && <span style={{fontSize:11,color:"#10B981"}}>✅ Salvato</span>}
            {saveStatus==="error"  && <span style={{fontSize:11,color:"#EF4444"}}>❌ Errore</span>}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button onClick={prevMonth} style={{width:28,height:28,borderRadius:6,border:"1px solid #1A1A2E",background:"transparent",color:"#64748B",cursor:"pointer",fontSize:14}}>‹</button>
            <span style={{fontSize:fs-1,fontWeight:700,color:"#F8FAFC",minWidth:140,textAlign:"center"}}>{getMonthLabel(month)}</span>
            <button onClick={nextMonth} style={{width:28,height:28,borderRadius:6,border:"1px solid #1A1A2E",background:"transparent",color:"#64748B",cursor:"pointer",fontSize:14}}>›</button>
            <button onClick={loadData} style={{padding:"4px 8px",borderRadius:6,border:"1px solid #1A1A2E",background:"transparent",color:"#475569",cursor:"pointer",fontSize:11}}>{loading?"⏳":"↻"}</button>
          </div>
        </div>

        {/* YTD Progress */}
        <div style={{marginTop:12,background:"#0F0F1A",border:"1px solid #10B98130",borderRadius:10,padding:"12px 14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <div style={{fontSize:fs-3,color:"#64748B"}}>Progress {year} verso 1.000.000€</div>
            <div style={{fontSize:fs-2,fontWeight:700,color:"#10B981"}}>{fmt(ytdRevenue)}€ · {ytdPct}%</div>
          </div>
          <div style={{height:6,background:"#1A1A2E",borderRadius:3}}>
            <div style={{height:"100%",background:"linear-gradient(90deg,#10B981,#3B82F6)",borderRadius:3,width:`${Math.max(ytdPct,0.5)}%`,transition:"width 0.4s"}}/>
          </div>
          <div style={{fontSize:fs-4,color:"#334155",marginTop:4}}>Mancano {fmt(OBIETTIVO_ANNUO-ytdRevenue)}€ all'obiettivo annuo</div>
        </div>

        {/* Month summary */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8,marginTop:10}}>
          {[
            {label:"Entrate mese",val:totEntrate,color:"#10B981",prefix:"+"},
            {label:"Uscite mese", val:totUscite, color:"#EF4444",prefix:"-"},
            {label:"Saldo netto",  val:saldoNetto,color:saldoNetto>=0?"#10B981":"#EF4444",prefix:saldoNetto>=0?"+":""},
            {label:"MRR stimato",  val:totEntrate,color:"#3B82F6",prefix:""},
          ].map(c=>(
            <div key={c.label} style={{background:"#0F0F1A",border:"1px solid #1A1A2E",borderRadius:8,padding:"8px 12px"}}>
              <div style={{fontSize:fs-4,color:"#475569",marginBottom:3}}>{c.label}</div>
              <div style={{fontSize:fs+1,fontWeight:800,color:c.color}}>{c.prefix}{fmt(c.val)}€</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",borderBottom:"1px solid #1A1A2E",flexShrink:0,background:"#09090F"}}>
        {[["entrate","💚 Entrate"],["uscite","🔴 Uscite"],["saldi","🏦 Saldi"]].map(([t,label])=>(
          <button key={t} onClick={()=>setTab(t)} style={{padding:"10px 16px",border:"none",background:"transparent",cursor:"pointer",fontSize:fs-2,fontWeight:tab===t?700:400,color:tab===t?"#F8FAFC":"#475569",borderBottom:tab===t?"2px solid #3B82F6":"2px solid transparent"}}>{label}</button>
        ))}
      </div>

      {loading && <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"#334155"}}>⏳ Caricamento...</div>}

      {!loading && (
        <div style={{flex:1,overflowY:"auto",padding:16}}>

          {tab==="entrate" && (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div style={{fontSize:fs-2,color:"#64748B"}}>Totale: <span style={{color:"#10B981",fontWeight:700}}>+{fmt(totEntrate)}€</span></div>
                <button onClick={()=>openAdd("entrata")} style={{padding:"6px 14px",borderRadius:7,border:"none",background:"#10B981",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600}}>+ Aggiungi</button>
              </div>
              <div style={{background:"#0F0F1A",border:"1px solid #1A1A2E",borderRadius:10,overflow:"hidden"}}>
                {monthData.entrate.length===0
                  ? <div style={{padding:20,textAlign:"center",color:"#334155",fontSize:fs-2}}>Nessuna entrata — aggiungi la prima</div>
                  : monthData.entrate.map((e,i)=>(
                    <div key={e.id} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:0,borderTop:i===0?"none":"1px solid #1A1A2E",background:i%2===0?"#0F0F1A":"#0B0B16"}}>
                      <Cell style={{flexDirection:"column",alignItems:"flex-start",gap:2}}>
                        <span style={{color:"#E2E8F0",fontWeight:600}}>{e.descrizione}</span>
                        <span style={{fontSize:fs-4,color:"#475569"}}>{e.categoria}{e.cliente?` · ${e.cliente}`:""}</span>
                      </Cell>
                      <Cell style={{color:"#10B981",fontWeight:700}}>+{fmt(e.importo)}€</Cell>
                      <Cell><button onClick={()=>openEdit("entrata",e)} style={{width:24,height:24,borderRadius:5,border:"1px solid #1A1A2E",background:"transparent",color:"#64748B",cursor:"pointer",fontSize:10}}>✏️</button></Cell>
                      <Cell><button onClick={()=>deleteItem("entrata",e.id)} style={{width:24,height:24,borderRadius:5,border:"1px solid #2A1A1A",background:"transparent",color:"#EF4444",cursor:"pointer",fontSize:12,fontWeight:700}}>×</button></Cell>
                    </div>
                  ))
                }
              </div>
            </div>
          )}

          {tab==="uscite" && (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div style={{fontSize:fs-2,color:"#64748B"}}>Totale: <span style={{color:"#EF4444",fontWeight:700}}>-{fmt(totUscite)}€</span></div>
                <button onClick={()=>openAdd("uscita")} style={{padding:"6px 14px",borderRadius:7,border:"none",background:"#EF4444",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600}}>+ Aggiungi</button>
              </div>
              <div style={{background:"#0F0F1A",border:"1px solid #1A1A2E",borderRadius:10,overflow:"hidden"}}>
                {monthData.uscite.length===0
                  ? <div style={{padding:20,textAlign:"center",color:"#334155",fontSize:fs-2}}>Nessuna uscita</div>
                  : monthData.uscite.map((e,i)=>(
                    <div key={e.id} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:0,borderTop:i===0?"none":"1px solid #1A1A2E",background:i%2===0?"#0F0F1A":"#0B0B16"}}>
                      <Cell style={{flexDirection:"column",alignItems:"flex-start",gap:2}}>
                        <span style={{color:"#E2E8F0",fontWeight:600}}>{e.descrizione}</span>
                        <span style={{fontSize:fs-4,color:"#475569"}}>{e.categoria}</span>
                      </Cell>
                      <Cell style={{color:"#EF4444",fontWeight:700}}>-{fmt(e.importo)}€</Cell>
                      <Cell><button onClick={()=>openEdit("uscita",e)} style={{width:24,height:24,borderRadius:5,border:"1px solid #1A1A2E",background:"transparent",color:"#64748B",cursor:"pointer",fontSize:10}}>✏️</button></Cell>
                      <Cell><button onClick={()=>deleteItem("uscita",e.id)} style={{width:24,height:24,borderRadius:5,border:"1px solid #2A1A1A",background:"transparent",color:"#EF4444",cursor:"pointer",fontSize:12,fontWeight:700}}>×</button></Cell>
                    </div>
                  ))
                }
              </div>
            </div>
          )}

          {tab==="saldi" && (
            <div>
              <div style={{fontSize:fs-3,fontWeight:700,color:"#3B82F6",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>🏦 Saldi Conti IAGREX</div>
              <div style={{background:"#0F0F1A",border:"1px solid #1A1A2E",borderRadius:10,overflow:"hidden"}}>
                {CONTI_IAGREX.map((c,i)=>(
                  <div key={c.id} style={{display:"grid",gridTemplateColumns:"1fr auto",borderTop:i===0?"none":"1px solid #1A1A2E",background:i%2===0?"#0F0F1A":"#0B0B16"}}>
                    <div style={{padding:"10px 12px",fontSize:fs-2,color:"#E2E8F0",display:"flex",alignItems:"center"}}>{c.label}</div>
                    <div style={{padding:"6px 12px",display:"flex",alignItems:"center",gap:4}}>
                      <input type="number" value={monthData.saldi?.[c.id]||""} onChange={e=>updateSaldo(c.id,e.target.value)} placeholder="0"
                        style={{width:100,padding:"5px 8px",borderRadius:6,border:"1px solid #1A1A2E",background:"#09090F",color:"#3B82F6",fontSize:fs-2,outline:"none",textAlign:"right",fontWeight:700}}/>
                      <span style={{fontSize:fs-3,color:"#475569"}}>{c.currency}</span>
                    </div>
                  </div>
                ))}
                <div style={{padding:"10px 12px",borderTop:"1px solid #1A1A2E",background:"#09090F",display:"flex",justifyContent:"space-between",gap:8}}>
                  <span style={{fontSize:fs-2,fontWeight:700,color:"#3B82F6"}}>Totale</span>
                  <div style={{display:"flex",gap:16}}>
                    <span style={{fontSize:fs-1,fontWeight:800,color:"#3B82F6"}}>{fmt(monthData.saldi?.unicredit_eur||0)} €</span>
                    <span style={{fontSize:fs-1,fontWeight:800,color:"#8B5CF6"}}>{fmt(monthData.saldi?.unicredit_ron||0)} RON</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={closeModal}>
          <div style={{background:"#0F0F1A",border:"1px solid #1A1A2E",borderRadius:16,padding:24,width:"100%",maxWidth:400,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:15,fontWeight:700,color:"#F8FAFC",marginBottom:20}}>
              {modal.mode==="add"?"➕ Nuova":"✏️ Modifica"} {modal.tipo==="entrata"?"Entrata":"Uscita"}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div>
                <div style={{fontSize:11,color:"#64748B",marginBottom:4}}>Descrizione *</div>
                <input type="text" value={form.descrizione||""} onChange={e=>setForm(p=>({...p,descrizione:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid #1A1A2E",background:"#09090F",color:"#E2E8F0",fontSize:13,outline:"none"}}/>
              </div>
              {modal.tipo==="entrata" && (
                <div>
                  <div style={{fontSize:11,color:"#64748B",marginBottom:4}}>Cliente</div>
                  <input type="text" value={form.cliente||""} onChange={e=>setForm(p=>({...p,cliente:e.target.value}))} placeholder="Nome cliente..."
                    style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid #1A1A2E",background:"#09090F",color:"#E2E8F0",fontSize:13,outline:"none"}}/>
                </div>
              )}
              <div>
                <div style={{fontSize:11,color:"#64748B",marginBottom:4}}>Importo € *</div>
                <input type="number" value={form.importo||""} onChange={e=>setForm(p=>({...p,importo:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid #1A1A2E",background:"#09090F",color:"#E2E8F0",fontSize:13,outline:"none"}}/>
              </div>
              <div>
                <div style={{fontSize:11,color:"#64748B",marginBottom:6}}>Categoria</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {(modal.tipo==="entrata"?CAT_ENTRATE:CAT_USCITE).map(c=>(
                    <button key={c} onClick={()=>setForm(p=>({...p,categoria:c}))}
                      style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${form.categoria===c?(modal.tipo==="entrata"?"#10B981":"#EF4444"):"#1A1A2E"}`,background:form.categoria===c?(modal.tipo==="entrata"?"#10B98120":"#EF444420"):"transparent",color:form.categoria===c?(modal.tipo==="entrata"?"#10B981":"#EF4444"):"#475569",cursor:"pointer",fontSize:11}}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button onClick={closeModal} style={{flex:1,padding:10,borderRadius:8,border:"1px solid #1A1A2E",background:"transparent",color:"#475569",cursor:"pointer",fontSize:13}}>Annulla</button>
              <button onClick={saveItem} style={{flex:2,padding:10,borderRadius:8,border:"none",background:modal.tipo==="entrata"?"#10B981":"#EF4444",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Salva</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
