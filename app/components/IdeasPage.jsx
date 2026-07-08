"use client";
import { useState, useEffect } from "react";

// Pagina dedicata alle idee vocali/al volo — prima vivevano in un modal
// sulla home, caricate ad ogni apertura app (loadIdeas() partiva sempre al
// mount, anche se non ti interessava vedere le idee quella volta). Ora la
// chiamata a /api/ideas-data parte SOLO quando arrivi su questa pagina: la
// home fa un check separato, leggero e limitato al venerdì, per il rito
// settimanale (vedi checkFridayRitual in page.jsx).

const THEME_VARS = {
  dark:  { "--c-bg":"#09090F", "--c-panel":"#0F0F1A", "--c-panel2":"#0B0B16", "--c-border":"#1A1A2E", "--c-text-strong":"#F8FAFC", "--c-text":"#E2E8F0", "--c-text-dim":"#64748B", "--c-text-faint":"#475569", "--c-text-faintest":"#334155", "--c-text-muted":"#94A3B8" },
  light: { "--c-bg":"#F4F5F7", "--c-panel":"#FFFFFF", "--c-panel2":"#F1F2F5", "--c-border":"#E2E4E9", "--c-text-strong":"#0F172A", "--c-text":"#1A1A2E", "--c-text-dim":"#475569", "--c-text-faint":"#94A3B8", "--c-text-faintest":"#CBD5E1", "--c-text-muted":"#64748B" },
};

const STATO_INFO = {
  "Da valutare":     { color:"#8B5CF6", label:"Da valutare" },
  "Diventata task":  { color:"#10B981", label:"Diventata task" },
  "Ignorata":        { color:"var(--c-text-faint)", label:"Ignorata" },
  "Scartata":        { color:"#EF4444", label:"Scartata" },
};
function statoInfo(s) { return STATO_INFO[s] || STATO_INFO["Da valutare"]; }

export default function IdeasPage({ fontSize=14, theme="dark" }) {
  const fs = fontSize;
  const themeVars = THEME_VARS[theme] || THEME_VARS.dark;
  const [ideas, setIdeas]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [ideaText, setIdeaText]   = useState("");
  const [listening, setListening] = useState(false);
  const [filter, setFilter]       = useState("da_valutare"); // da_valutare | tutte

  const speechSupported = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

  const loadIdeas = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ideas-data");
      if (!res.ok) { setLoading(false); return; }
      const dataRes = await res.json();
      let loaded = dataRes.ideas || [];
      // Migrazione una tantum: se Notion è vuoto ma il browser ha ancora
      // idee salvate nel vecchio localStorage (da prima della migrazione a
      // Notion), le trasferiamo una volta sola invece di perderle.
      if (loaded.length === 0) {
        const oldRaw = localStorage.getItem("dario-ideas");
        if (oldRaw) {
          try {
            const old = JSON.parse(oldRaw) || [];
            for (const i of old) {
              if (i.text) await fetch("/api/ideas-data",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:i.text})});
            }
            localStorage.removeItem("dario-ideas");
            if (old.length) {
              const res2 = await fetch("/api/ideas-data");
              if (res2.ok) loaded = (await res2.json()).ideas || [];
            }
          } catch {}
        }
      }
      setIdeas(loaded);
    } catch {}
    setLoading(false);
  };
  useEffect(()=>{ loadIdeas(); },[]);

  const addIdea = async () => {
    const text = ideaText.trim();
    if (!text) return;
    setIdeaText("");
    try {
      const res = await fetch("/api/ideas-data",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text})});
      if (res.ok) { const d = await res.json(); setIdeas(prev=>[d.idea, ...prev]); }
    } catch {}
  };
  const removeIdea = async (notionId) => {
    setIdeas(prev=>prev.filter(i=>i.notionId!==notionId));
    try { await fetch(`/api/ideas-data?id=${notionId}`,{method:"DELETE"}); } catch {}
  };
  const setStato = async (notionId, stato) => {
    setIdeas(prev=>prev.map(i=>i.notionId===notionId?{...i,stato}:i));
    try { await fetch("/api/ideas-data",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({notionId,stato})}); } catch {}
  };
  const ideaToTask = async (idea) => {
    try {
      await fetch("/api/create-task",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:idea.text,list:"todo"})});
      await setStato(idea.notionId, "Diventata task");
    } catch {}
  };

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

  const filtered = filter==="da_valutare"
    ? ideas.filter(i=>(i.stato||"Da valutare")==="Da valutare")
    : ideas;
  const daValutareCount = ideas.filter(i=>(i.stato||"Da valutare")==="Da valutare").length;

  return (
    <div style={{...themeVars,display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",background:"var(--c-bg)"}}>
      <div style={{padding:"12px 20px",borderBottom:"1px solid var(--c-border)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div style={{fontWeight:700,fontSize:15,color:"var(--c-text-strong)"}}>🎙️ Idee</div>
          <div style={{display:"flex",gap:5}}>
            {[["da_valutare","Da valutare"],["tutte","Tutte"]].map(([v,label])=>(
              <button key={v} onClick={()=>setFilter(v)}
                style={{padding:"4px 9px",borderRadius:7,border:`1px solid ${filter===v?"#8B5CF6":"var(--c-border)"}`,background:filter===v?"#8B5CF620":"transparent",color:filter===v?"#8B5CF6":"var(--c-text-faint)",cursor:"pointer",fontSize:11}}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{fontSize:fs-3,color:"var(--c-text-dim)",marginTop:6}}>
          <span style={{color:"#8B5CF6",fontWeight:700}}>{daValutareCount}</span> da valutare · {ideas.length} totali
        </div>
      </div>

      {/* Cattura idea */}
      <div style={{padding:16,borderBottom:"1px solid var(--c-border)",flexShrink:0}}>
        <textarea autoFocus rows={3} placeholder="Scrivi o detta la tua idea..." value={ideaText}
          onChange={e=>setIdeaText(e.target.value)}
          style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid var(--c-border)",background:"var(--c-panel)",color:"var(--c-text)",fontSize:14,outline:"none",marginBottom:10,resize:"vertical",fontFamily:"inherit"}}/>
        <div style={{display:"flex",gap:8}}>
          {speechSupported && (
            <button onClick={toggleListening}
              style={{padding:"9px 14px",borderRadius:8,border:`1px solid ${listening?"#EF4444":"var(--c-border)"}`,background:listening?"#EF444420":"transparent",color:listening?"#EF4444":"var(--c-text-muted)",cursor:"pointer",fontSize:13}}>
              {listening?"⏹️ Ascolto...":"🎙️ Detta"}
            </button>
          )}
          <button onClick={addIdea} style={{flex:1,padding:10,borderRadius:8,border:"none",background:"#8B5CF6",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Salva idea</button>
        </div>
      </div>

      {loading && <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--c-text-faintest)",fontSize:fs-2}}>⏳ Caricamento...</div>}

      {!loading && (
        <div style={{flex:1,overflowY:"auto",padding:16}}>
          {filtered.length===0 && (
            <div style={{textAlign:"center",color:"var(--c-text-faintest)",fontSize:fs-2,padding:"30px 0"}}>
              {filter==="da_valutare" ? "Nessuna idea da valutare 🎉" : "Nessuna idea salvata ancora."}
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {filtered.map(i=>{
              const info = statoInfo(i.stato);
              const daValutare = (i.stato||"Da valutare")==="Da valutare";
              return (
                <div key={i.notionId} style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderLeft:`3px solid ${info.color}`,borderRadius:9,padding:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:8}}>
                    <div style={{fontSize:fs-1,color:"var(--c-text)",lineHeight:1.4,flex:1}}>{i.text}</div>
                    <button onClick={()=>removeIdea(i.notionId)} style={{width:22,height:22,borderRadius:4,border:"none",background:"var(--c-border)",color:"#EF4444",cursor:"pointer",fontSize:12,fontWeight:700,flexShrink:0}}>×</button>
                  </div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                    <span style={{fontSize:fs-5,color:info.color,fontWeight:600,background:`${info.color}18`,padding:"2px 8px",borderRadius:10}}>{info.label}</span>
                    {daValutare && (
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={()=>ideaToTask(i)} style={{padding:"5px 10px",borderRadius:6,border:"1px solid #10B98140",background:"#10B98115",color:"#10B981",cursor:"pointer",fontSize:11,fontWeight:600}}>✅ Diventa task</button>
                        <button onClick={()=>setStato(i.notionId,"Scartata")} style={{padding:"5px 10px",borderRadius:6,border:"1px solid #EF444440",background:"#EF444415",color:"#EF4444",cursor:"pointer",fontSize:11,fontWeight:600}}>🗑️ Scarta</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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
