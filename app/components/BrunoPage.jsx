"use client";
import { useState, useEffect, useCallback } from "react";

const CONTI = [
  { id: "bdm",           label: "BdM Banca" },
  { id: "trade_republic",label: "Trade Republic" },
  { id: "revolut",       label: "Revolut" },
  { id: "postepay",      label: "PostePay Evolution" },
  { id: "hype",          label: "HYPE / Banca Sella" },
  { id: "unicredit",     label: "UniCredit Romania" },
];

const CAT_USCITE_FISSE = ["Affitto","Cibo","Palestra","Trasporti","Abbonamenti","Utenze","Salute","Personale","Extra"];

const EMPTY_MONTH = {
  entrate: [],
  uscite: [],
  saldi: { bdm:0, trade_republic:0, revolut:0, postepay:0, hype:0, unicredit:0 },
  investimenti: 0,
  risparmi: 0,
};

function genId() { return Math.random().toString(36).slice(2,10); }

function fmt(n) {
  const num = parseFloat(n) || 0;
  return num.toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function getMonthLabel(ym) {
  const [y, m] = ym.split("-");
  const months = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
  return `${months[parseInt(m)-1]} ${y}`;
}

function getCurrentMonth() {
  return new Date().toISOString().slice(0,7);
}

export default function BrunoPage({ fontSize=14 }) {
  const fs = fontSize;
  const [allData, setAllData]   = useState({});
  const [month, setMonth]       = useState(getCurrentMonth());
  const [tab, setTab]           = useState("entrate");
  const [loading, setLoading]   = useState(true);
  const [saveStatus, setSaveStatus] = useState(null);
  const [modal, setModal]       = useState(null); // {tipo:"entrata"|"uscita", mode:"add"|"edit", item?}
  const [form, setForm]         = useState({});
  const [customCat, setCustomCat] = useState("");

  useEffect(()=>{ loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/bruno-finance");
      if (res.ok) {
        const json = await res.json();
        setAllData(json.data || {});
      }
    } catch {}
    setLoading(false);
  };

  const monthData = allData[month] || EMPTY_MONTH;

  const saveData = useCallback(async (newAllData) => {
    setAllData(newAllData);
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/bruno-finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: newAllData }),
      });
      setSaveStatus(res.ok ? "saved" : "error");
    } catch { setSaveStatus("error"); }
    setTimeout(()=>setSaveStatus(null), 2500);
  }, []);

  const updateMonth = (updated) => {
    saveData({ ...allData, [month]: updated });
  };

  const prevMonth = () => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m-2);
    setMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
  };
  const nextMonth = () => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m);
    setMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
  };

  // SUMMARY
  const totEntrate  = monthData.entrate.reduce((s,e)=>s+(parseFloat(e.importo)||0),0);
  const totUscite   = monthData.uscite.reduce((s,e)=>s+(parseFloat(e.importo)||0),0);
  const saldoNetto  = totEntrate - totUscite;
  const totPatrimonio = Object.values(monthData.saldi||{}).reduce((s,v)=>s+(parseFloat(v)||0),0)
    + (parseFloat(monthData.investimenti)||0)
    + (parseFloat(monthData.risparmi)||0);

  // MODAL HANDLERS
  const openAdd = (tipo) => {
    setForm({ descrizione:"", importo:"", categoria: tipo==="uscita"?CAT_USCITE_FISSE[0]:"Stipendio" });
    setCustomCat("");
    setModal({ tipo, mode:"add" });
  };
  const openEdit = (tipo, item) => {
    setForm({ ...item });
    setCustomCat(CAT_USCITE_FISSE.includes(item.categoria) ? "" : item.categoria);
    setModal({ tipo, mode:"edit", item });
  };
  const closeModal = () => { setModal(null); setForm({}); };

  const saveItem = () => {
    if (!form.descrizione?.trim() || !form.importo) return;
    const cat = customCat.trim() || form.categoria;
    const item = { ...form, categoria: cat, importo: parseFloat(form.importo), id: modal.mode==="add"?genId():form.id };
    const tipo = modal.tipo;
    let updated = { ...monthData };
    if (tipo==="entrata") {
      updated.entrate = modal.mode==="add" ? [...updated.entrate, item] : updated.entrate.map(e=>e.id===item.id?item:e);
    } else {
      updated.uscite = modal.mode==="add" ? [...updated.uscite, item] : updated.uscite.map(e=>e.id===item.id?item:e);
    }
    updateMonth(updated);
    closeModal();
  };

  const deleteItem = (tipo, id) => {
    if (!confirm("Eliminare?")) return;
    let updated = { ...monthData };
    if (tipo==="entrata") updated.entrate = updated.entrate.filter(e=>e.id!==id);
    else updated.uscite = updated.uscite.filter(e=>e.id!==id);
    updateMonth(updated);
  };

  const updateSaldo = (contoId, val) => {
    updateMonth({ ...monthData, saldi: { ...monthData.saldi, [contoId]: parseFloat(val)||0 } });
  };

  const updateField = (field, val) => {
    updateMonth({ ...monthData, [field]: parseFloat(val)||0 });
  };

  const f = (key) => (val) => setForm(p=>({...p,[key]:val}));

  const Cell = ({ style={}, children }) => (
    <div style={{ padding:"10px 12px", fontSize:fs-2, color:"#94A3B8", display:"flex", alignItems:"center", ...style }}>{children}</div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden", background:"#09090F" }}>

      {/* Header */}
      <div style={{ padding:"14px 20px", borderBottom:"1px solid #1A1A2E", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ fontWeight:700, fontSize:15, color:"#F8FAFC" }}>💰 Finanze Personali</div>
            {saveStatus==="saving" && <span style={{ fontSize:11, color:"#F59E0B" }}>☁️ Salvataggio...</span>}
            {saveStatus==="saved"  && <span style={{ fontSize:11, color:"#10B981" }}>✅ Salvato</span>}
            {saveStatus==="error"  && <span style={{ fontSize:11, color:"#EF4444" }}>❌ Errore</span>}
          </div>
          {/* Month selector */}
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <button onClick={prevMonth} style={{ width:28, height:28, borderRadius:6, border:"1px solid #1A1A2E", background:"transparent", color:"#64748B", cursor:"pointer", fontSize:14 }}>‹</button>
            <span style={{ fontSize:fs-1, fontWeight:700, color:"#F8FAFC", minWidth:140, textAlign:"center" }}>{getMonthLabel(month)}</span>
            <button onClick={nextMonth} style={{ width:28, height:28, borderRadius:6, border:"1px solid #1A1A2E", background:"transparent", color:"#64748B", cursor:"pointer", fontSize:14 }}>›</button>
            <button onClick={loadData} style={{ padding:"4px 8px", borderRadius:6, border:"1px solid #1A1A2E", background:"transparent", color:"#475569", cursor:"pointer", fontSize:11 }}>{loading?"⏳":"↻"}</button>
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, marginTop:12 }}>
          {[
            { label:"Entrate", val:totEntrate, color:"#10B981", prefix:"+" },
            { label:"Uscite",  val:totUscite,  color:"#EF4444", prefix:"-" },
            { label:"Saldo netto", val:saldoNetto, color:saldoNetto>=0?"#10B981":"#EF4444", prefix:saldoNetto>=0?"+":"" },
            { label:"Patrimonio", val:totPatrimonio, color:"#8B5CF6", prefix:"" },
          ].map(c=>(
            <div key={c.label} style={{ background:"#0F0F1A", border:"1px solid #1A1A2E", borderRadius:10, padding:"10px 12px" }}>
              <div style={{ fontSize:fs-4, color:"#475569", marginBottom:4 }}>{c.label}</div>
              <div style={{ fontSize:fs+2, fontWeight:800, color:c.color }}>{c.prefix}{fmt(c.val)}€</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", borderBottom:"1px solid #1A1A2E", flexShrink:0, background:"#09090F" }}>
        {[["entrate","💚 Entrate"],["uscite","🔴 Uscite"],["saldi","🏦 Saldi & Obiettivi"]].map(([t,label])=>(
          <button key={t} onClick={()=>setTab(t)} style={{ padding:"10px 16px", border:"none", background:"transparent", cursor:"pointer", fontSize:fs-2, fontWeight:tab===t?700:400, color:tab===t?"#F8FAFC":"#475569", borderBottom:tab===t?"2px solid #F59E0B":"2px solid transparent" }}>{label}</button>
        ))}
      </div>

      {loading && <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#334155" }}>⏳ Caricamento...</div>}

      {!loading && (
        <div style={{ flex:1, overflowY:"auto", padding:16 }}>

          {/* ENTRATE */}
          {tab==="entrate" && (
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <div style={{ fontSize:fs-2, color:"#64748B" }}>Totale: <span style={{ color:"#10B981", fontWeight:700 }}>+{fmt(totEntrate)}€</span></div>
                <button onClick={()=>openAdd("entrata")} style={{ padding:"6px 14px", borderRadius:7, border:"none", background:"#10B981", color:"#fff", cursor:"pointer", fontSize:12, fontWeight:600 }}>+ Aggiungi</button>
              </div>
              <div style={{ background:"#0F0F1A", border:"1px solid #1A1A2E", borderRadius:10, overflow:"hidden" }}>
                {monthData.entrate.length===0
                  ? <div style={{ padding:20, textAlign:"center", color:"#334155", fontSize:fs-2 }}>Nessuna entrata — aggiungi la prima</div>
                  : monthData.entrate.map((e,i)=>(
                    <div key={e.id} style={{ display:"grid", gridTemplateColumns:"1fr auto auto auto", gap:0, borderTop:i===0?"none":"1px solid #1A1A2E", background:i%2===0?"#0F0F1A":"#0B0B16" }}>
                      <Cell style={{ flexDirection:"column", alignItems:"flex-start", gap:2 }}>
                        <span style={{ color:"#E2E8F0", fontWeight:600 }}>{e.descrizione}</span>
                        <span style={{ fontSize:fs-4, color:"#475569" }}>{e.categoria}</span>
                      </Cell>
                      <Cell style={{ color:"#10B981", fontWeight:700 }}>+{fmt(e.importo)}€</Cell>
                      <Cell><button onClick={()=>openEdit("entrata",e)} style={{ width:24, height:24, borderRadius:5, border:"1px solid #1A1A2E", background:"transparent", color:"#64748B", cursor:"pointer", fontSize:10 }}>✏️</button></Cell>
                      <Cell><button onClick={()=>deleteItem("entrata",e.id)} style={{ width:24, height:24, borderRadius:5, border:"1px solid #2A1A1A", background:"transparent", color:"#EF4444", cursor:"pointer", fontSize:12, fontWeight:700 }}>×</button></Cell>
                    </div>
                  ))
                }
              </div>
            </div>
          )}

          {/* USCITE */}
          {tab==="uscite" && (
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <div style={{ fontSize:fs-2, color:"#64748B" }}>Totale: <span style={{ color:"#EF4444", fontWeight:700 }}>-{fmt(totUscite)}€</span></div>
                <button onClick={()=>openAdd("uscita")} style={{ padding:"6px 14px", borderRadius:7, border:"none", background:"#EF4444", color:"#fff", cursor:"pointer", fontSize:12, fontWeight:600 }}>+ Aggiungi</button>
              </div>
              {/* Raggruppate per categoria */}
              {Object.entries(
                monthData.uscite.reduce((acc,e)=>{ (acc[e.categoria]=acc[e.categoria]||[]).push(e); return acc; },{})
              ).map(([cat,items])=>(
                <div key={cat} style={{ marginBottom:12 }}>
                  <div style={{ fontSize:fs-3, fontWeight:700, color:"#64748B", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6, display:"flex", justifyContent:"space-between" }}>
                    <span>{cat}</span>
                    <span style={{ color:"#EF4444" }}>-{fmt(items.reduce((s,e)=>s+(parseFloat(e.importo)||0),0))}€</span>
                  </div>
                  <div style={{ background:"#0F0F1A", border:"1px solid #1A1A2E", borderRadius:10, overflow:"hidden" }}>
                    {items.map((e,i)=>(
                      <div key={e.id} style={{ display:"grid", gridTemplateColumns:"1fr auto auto auto", gap:0, borderTop:i===0?"none":"1px solid #1A1A2E", background:i%2===0?"#0F0F1A":"#0B0B16" }}>
                        <Cell style={{ color:"#E2E8F0" }}>{e.descrizione}</Cell>
                        <Cell style={{ color:"#EF4444", fontWeight:700 }}>-{fmt(e.importo)}€</Cell>
                        <Cell><button onClick={()=>openEdit("uscita",e)} style={{ width:24, height:24, borderRadius:5, border:"1px solid #1A1A2E", background:"transparent", color:"#64748B", cursor:"pointer", fontSize:10 }}>✏️</button></Cell>
                        <Cell><button onClick={()=>deleteItem("uscita",e.id)} style={{ width:24, height:24, borderRadius:5, border:"1px solid #2A1A1A", background:"transparent", color:"#EF4444", cursor:"pointer", fontSize:12, fontWeight:700 }}>×</button></Cell>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {monthData.uscite.length===0 && <div style={{ padding:20, textAlign:"center", color:"#334155", fontSize:fs-2, background:"#0F0F1A", border:"1px solid #1A1A2E", borderRadius:10 }}>Nessuna uscita — aggiungi la prima</div>}
            </div>
          )}

          {/* SALDI & OBIETTIVI */}
          {tab==="saldi" && (
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              {/* Saldi conti */}
              <div>
                <div style={{ fontSize:fs-3, fontWeight:700, color:"#8B5CF6", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>🏦 Saldi Conti</div>
                <div style={{ background:"#0F0F1A", border:"1px solid #1A1A2E", borderRadius:10, overflow:"hidden" }}>
                  {CONTI.map((c,i)=>(
                    <div key={c.id} style={{ display:"grid", gridTemplateColumns:"1fr auto", borderTop:i===0?"none":"1px solid #1A1A2E", background:i%2===0?"#0F0F1A":"#0B0B16" }}>
                      <div style={{ padding:"10px 12px", fontSize:fs-2, color:"#E2E8F0", display:"flex", alignItems:"center" }}>{c.label}</div>
                      <div style={{ padding:"6px 12px", display:"flex", alignItems:"center", gap:4 }}>
                        <input
                          type="number"
                          value={monthData.saldi?.[c.id]||""}
                          onChange={e=>updateSaldo(c.id, e.target.value)}
                          placeholder="0"
                          style={{ width:100, padding:"5px 8px", borderRadius:6, border:"1px solid #1A1A2E", background:"#09090F", color:"#8B5CF6", fontSize:fs-2, outline:"none", textAlign:"right", fontWeight:700 }}
                        />
                        <span style={{ fontSize:fs-3, color:"#475569" }}>€</span>
                      </div>
                    </div>
                  ))}
                  <div style={{ padding:"10px 12px", borderTop:"1px solid #1A1A2E", display:"flex", justifyContent:"space-between", background:"#09090F" }}>
                    <span style={{ fontSize:fs-2, fontWeight:700, color:"#8B5CF6" }}>Totale liquidità</span>
                    <span style={{ fontSize:fs-1, fontWeight:800, color:"#8B5CF6" }}>{fmt(totPatrimonio - (parseFloat(monthData.investimenti)||0) - (parseFloat(monthData.risparmi)||0))}€</span>
                  </div>
                </div>
              </div>

              {/* Investimenti & Risparmi */}
              <div>
                <div style={{ fontSize:fs-3, fontWeight:700, color:"#F59E0B", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>🎯 Obiettivi</div>
                <div style={{ background:"#0F0F1A", border:"1px solid #1A1A2E", borderRadius:10, overflow:"hidden" }}>
                  {[
                    { key:"investimenti", label:"📈 Investimenti", color:"#3B82F6" },
                    { key:"risparmi",     label:"🐷 Risparmi",     color:"#10B981" },
                  ].map((item,i)=>(
                    <div key={item.key} style={{ display:"grid", gridTemplateColumns:"1fr auto", borderTop:i===0?"none":"1px solid #1A1A2E", background:i%2===0?"#0F0F1A":"#0B0B16" }}>
                      <div style={{ padding:"10px 12px", fontSize:fs-2, color:"#E2E8F0", display:"flex", alignItems:"center" }}>{item.label}</div>
                      <div style={{ padding:"6px 12px", display:"flex", alignItems:"center", gap:4 }}>
                        <input
                          type="number"
                          value={monthData[item.key]||""}
                          onChange={e=>updateField(item.key, e.target.value)}
                          placeholder="0"
                          style={{ width:100, padding:"5px 8px", borderRadius:6, border:"1px solid #1A1A2E", background:"#09090F", color:item.color, fontSize:fs-2, outline:"none", textAlign:"right", fontWeight:700 }}
                        />
                        <span style={{ fontSize:fs-3, color:"#475569" }}>€</span>
                      </div>
                    </div>
                  ))}
                  <div style={{ padding:"10px 12px", borderTop:"1px solid #1A1A2E", display:"flex", justifyContent:"space-between", background:"#09090F" }}>
                    <span style={{ fontSize:fs-2, fontWeight:700, color:"#F59E0B" }}>Patrimonio totale</span>
                    <span style={{ fontSize:fs-1, fontWeight:800, color:"#F59E0B" }}>{fmt(totPatrimonio)}€</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal entrata/uscita */}
      {modal && (
        <div style={{ position:"fixed", inset:0, background:"#00000090", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={closeModal}>
          <div style={{ background:"#0F0F1A", border:"1px solid #1A1A2E", borderRadius:16, padding:24, width:"100%", maxWidth:400, maxHeight:"90vh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:700, color:"#F8FAFC", marginBottom:20 }}>
              {modal.mode==="add"?"➕ Nuova":"✏️ Modifica"} {modal.tipo==="entrata"?"Entrata":"Uscita"}
            </div>

            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                <div style={{ fontSize:11, color:"#64748B", marginBottom:4 }}>Descrizione *</div>
                <input type="text" value={form.descrizione||""} onChange={e=>setForm(p=>({...p,descrizione:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid #1A1A2E", background:"#09090F", color:"#E2E8F0", fontSize:13, outline:"none" }}/>
              </div>
              <div>
                <div style={{ fontSize:11, color:"#64748B", marginBottom:4 }}>Importo € *</div>
                <input type="number" value={form.importo||""} onChange={e=>setForm(p=>({...p,importo:e.target.value}))}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid #1A1A2E", background:"#09090F", color:"#E2E8F0", fontSize:13, outline:"none" }}/>
              </div>
              <div>
                <div style={{ fontSize:11, color:"#64748B", marginBottom:6 }}>Categoria</div>
                {modal.tipo==="uscita" ? (
                  <>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
                      {CAT_USCITE_FISSE.map(c=>(
                        <button key={c} onClick={()=>{setForm(p=>({...p,categoria:c}));setCustomCat("");}}
                          style={{ padding:"4px 10px", borderRadius:6, border:`1px solid ${form.categoria===c&&!customCat?"#EF4444":"#1A1A2E"}`, background:form.categoria===c&&!customCat?"#EF444420":"transparent", color:form.categoria===c&&!customCat?"#EF4444":"#475569", cursor:"pointer", fontSize:11 }}>
                          {c}
                        </button>
                      ))}
                    </div>
                    <input type="text" value={customCat} onChange={e=>setCustomCat(e.target.value)} placeholder="Oppure categoria personalizzata..."
                      style={{ width:"100%", padding:"7px 10px", borderRadius:7, border:`1px solid ${customCat?"#EF4444":"#1A1A2E"}`, background:"#09090F", color:"#E2E8F0", fontSize:12, outline:"none" }}/>
                  </>
                ) : (
                  <input type="text" value={form.categoria||""} onChange={e=>setForm(p=>({...p,categoria:e.target.value}))} placeholder="es. Stipendio, Freelance..."
                    style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1px solid #1A1A2E", background:"#09090F", color:"#E2E8F0", fontSize:13, outline:"none" }}/>
                )}
              </div>
            </div>

            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={closeModal} style={{ flex:1, padding:10, borderRadius:8, border:"1px solid #1A1A2E", background:"transparent", color:"#475569", cursor:"pointer", fontSize:13 }}>Annulla</button>
              <button onClick={saveItem} style={{ flex:2, padding:10, borderRadius:8, border:"none", background:modal.tipo==="entrata"?"#10B981":"#EF4444", color:"#fff", cursor:"pointer", fontSize:13, fontWeight:700 }}>Salva</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
