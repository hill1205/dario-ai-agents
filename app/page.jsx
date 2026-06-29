"use client";
import { useState, useEffect } from "react";
import PipelinePage from "./components/PipelinePage";
import BrunoPage from "./components/BrunoPage";
import IAGREXPage from "./components/IAGREXPage";

const DONE_STATUSES = ["complete","completed","done","chiuso","closed","fatto","completato","completata"];

const NAV_ITEMS = [
  { id:"home",     icon:"🏠", label:"Dashboard",  color:"#F8FAFC" },
  { id:"pipeline", icon:"🎯", label:"Pipeline",   color:"#8B5CF6" },
  { id:"finanze",  icon:"💰", label:"Finanze",    color:"#F59E0B" },
  { id:"iagrex",   icon:"📊", label:"IAGREX",     color:"#3B82F6" },
];

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

function TaskItem({ task, color, onToggle, fontSize=14, isChecked }) {
  const done = isChecked ?? DONE_STATUSES.includes((task.status?.status||"").toLowerCase());
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,cursor:"pointer"}} onClick={()=>onToggle(task.id)}>
      <div style={{width:18,height:18,borderRadius:4,border:`1.5px solid ${color}60`,background:done?color:"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>
        {done && <span style={{fontSize:11,color:"#fff",lineHeight:1}}>✓</span>}
      </div>
      <span style={{fontSize,color:done?"#334155":"#94A3B8",textDecoration:done?"line-through":"none",lineHeight:1.4}}>{task.name}</span>
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

  // Load settings
  useEffect(()=>{
    try {
      const sr = localStorage.getItem("dario-settings");
      if (sr) { const s=JSON.parse(sr); if(s.fontSize) setFontSize(s.fontSize); }
      const ct = localStorage.getItem("dario-checked-tasks");
      if (ct) setCheckedTasks(JSON.parse(ct));
    } catch {}
  },[]);

  useEffect(()=>{
    try { localStorage.setItem("dario-settings", JSON.stringify({fontSize})); } catch {}
  },[fontSize]);

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
      const [wRes,tRes,rRes,wgRes] = await Promise.all([
        fetch("/api/weather").then(r=>r.json()).catch(()=>null),
        fetch("/api/tasks").then(r=>r.json()).catch(()=>({todo:[],routine:[],sospeso:[]})),
        fetch("/api/revenue").then(r=>r.json()).catch(()=>null),
        fetch("/api/weight").then(r=>r.json()).catch(()=>null),
      ]);
      if (wRes&&!wRes.error)  setWeather(wRes);
      if (tRes)               setHomeData(tRes);
      if (rRes&&!rRes.error)  setRevenue(rRes);
      if (wgRes&&!wgRes.error) setWeightData(wgRes);
    } catch(e){ console.error("Dashboard error:",e); }
    setHomeLoading(false);
  };

  const toggleTask = async (taskId,type)=>{
    const task = homeData[type]?.find(t=>t.id===taskId);
    if (!task) return;
    const cur  = checkedTasks[taskId] ?? DONE_STATUSES.includes((task.status?.status||"").toLowerCase());
    const next = !cur;
    const newChecked = {...checkedTasks,[taskId]:next};
    setCheckedTasks(newChecked);
    try { localStorage.setItem("dario-checked-tasks",JSON.stringify(newChecked)); } catch {}
    try {
      await fetch("/api/update-task",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({taskId,status:next?"completata":"da fare"})});
    } catch {}
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

  const DCard  = ({children,style={}})=>(
    <div style={{background:"#0F0F1A",border:"1px solid #1A1A2E",borderRadius:14,padding:16,...style}}>{children}</div>
  );
  const DLabel = ({children})=>(
    <div style={{fontSize:Math.max(9,fontSize-4),fontWeight:700,color:"#475569",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>{children}</div>
  );

  const SettingsContent = ()=>(
    <div style={{padding:12}}>
      <div style={{fontSize:11,color:"#64748B",marginBottom:6}}>Dimensione testo: {fontSize}px</div>
      <input type="range" min={12} max={18} step={1} value={fontSize} onChange={e=>setFontSize(Number(e.target.value))}
        style={{width:"100%",accentColor:"#8B5CF6",cursor:"pointer",marginBottom:8}}/>
      <div style={{display:"flex",gap:3}}>
        {[12,13,14,15,16,17,18].map(s=>(
          <button key={s} onClick={()=>setFontSize(s)}
            style={{flex:1,padding:"3px 0",borderRadius:4,border:`1px solid ${fontSize===s?"#8B5CF6":"#1A1A2E"}`,background:fontSize===s?"#8B5CF620":"transparent",color:fontSize===s?"#8B5CF6":"#475569",cursor:"pointer",fontSize:9}}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100dvh",background:"#09090F",color:"#E2E8F0",fontFamily:"system-ui,-apple-system,sans-serif",overflow:"hidden"}}>
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>

        {/* SIDEBAR DESKTOP */}
        {!isMobile && (
          <div style={{width:180,background:"#0F0F1A",borderRight:"1px solid #1A1A2E",display:"flex",flexDirection:"column",padding:"16px 10px",flexShrink:0}}>
            {NAV_ITEMS.map(item=>(
              <button key={item.id} onClick={()=>setView(item.id)}
                style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",marginBottom:4,borderRadius:10,border:"none",
                  background:view===item.id?`${item.color}15`:"transparent",
                  borderLeft:`3px solid ${view===item.id?item.color:"transparent"}`,
                  color:view===item.id?item.color:"#64748B",cursor:"pointer",fontSize:13,fontWeight:600,textAlign:"left"}}>
                <span>{item.icon}</span>{item.label}
              </button>
            ))}
            <div style={{marginTop:"auto",paddingTop:12,borderTop:"1px solid #1A1A2E"}}>
              <button onClick={()=>setShowSettings(s=>!s)}
                style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1px solid ${showSettings?"#334155":"#1A1A2E"}`,background:showSettings?"#1A1A2E":"transparent",color:"#64748B",cursor:"pointer",fontSize:12,textAlign:"left"}}>
                ⚙️ Impostazioni
              </button>
              {showSettings && (
                <div style={{marginTop:8,background:"#09090F",borderRadius:8,border:"1px solid #1A1A2E"}}>
                  <SettingsContent/>
                </div>
              )}
            </div>
          </div>
        )}

        {/* MAIN AREA */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {view==="iagrex"   && <IAGREXPage fontSize={fontSize} onBack={()=>setView("home")}/>}
          {view==="finanze"  && <BrunoPage  fontSize={fontSize}/>}
          {view==="pipeline" && <PipelinePage fontSize={fontSize}/>}

          {view==="home" && (
            <>
              {/* Header */}
              <div style={{padding:"14px 20px",borderBottom:"1px solid #1A1A2E",background:"#09090F",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{fontWeight:700,fontSize:15,color:"#F8FAFC"}}>🏠 Dashboard</div>
                <div style={{display:"flex",gap:8}}>
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
                <div style={{background:"#0F0F1A",borderBottom:"1px solid #1A1A2E",flexShrink:0}}>
                  <SettingsContent/>
                </div>
              )}

              {/* Dashboard content */}
              <div style={{flex:1,overflowY:"auto",padding:"16px 16px 24px",fontSize}}>
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:fontSize+6,fontWeight:700,color:"#F8FAFC"}}>{getGreeting()}, Dario 👋</div>
                  <div style={{color:"#475569",fontSize:fontSize-2,marginTop:3}}>
                    {new Date().toLocaleDateString("it-IT",{timeZone:"Europe/Bucharest",weekday:"long",day:"numeric",month:"long"})}
                  </div>
                </div>

                {/* Orologi + Meteo */}
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:10,marginBottom:10}}>
                  <DCard>
                    <DLabel>🕐 Ora</DLabel>
                    <div style={{fontSize:fontSize+12,fontWeight:800,color:"#F8FAFC",letterSpacing:"0.04em",lineHeight:1}}>{clockBucharest}</div>
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
                        <div style={{fontSize:fontSize+12,fontWeight:800,color:"#F8FAFC"}}>{weather.temp}°C</div>
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
                    ):homeData.todo.map(t=>(
                      <TaskItem key={t.id} task={t} color="#8B5CF6" onToggle={id=>toggleTask(id,"todo")} fontSize={fontSize} isChecked={checkedTasks[t.id]}/>
                    ))}
                  </DCard>
                  <DCard>
                    <DLabel>🔄 Routine</DLabel>
                    {homeData.routine.length===0?(
                      <div style={{fontSize:fontSize-2,color:"#334155"}}>{homeLoading?"Caricamento...":"Nessuna routine"}</div>
                    ):homeData.routine.map(t=>(
                      <TaskItem key={t.id} task={t} color="#10B981" onToggle={id=>toggleTask(id,"routine")} fontSize={fontSize} isChecked={checkedTasks[t.id]}/>
                    ))}
                  </DCard>
                </div>

                {/* Peso + Revenue */}
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:10,marginBottom:16}}>
                  <DCard>
                    <DLabel>💪 Progressi Fisici</DLabel>
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
                          style={{marginTop:10,width:"100%",padding:"5px 8px",borderRadius:6,border:"1px solid #1A1A2E",background:"#09090F",color:"#475569",fontSize:fontSize-2,textAlign:"left",cursor:"pointer"}}>
                          Registra peso oggi...
                        </button>
                      </>
                    ):(
                      <div style={{fontSize:fontSize-2,color:"#334155"}}>{homeLoading?"Caricamento...":"–"}</div>
                    )}
                  </DCard>
                  <DCard>
                    <DLabel>💶 Revenue IAGREX</DLabel>
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
        <div style={{display:"flex",background:"#0F0F1A",borderTop:"1px solid #1A1A2E",padding:"4px 2px",flexShrink:0,zIndex:100}}>
          {NAV_ITEMS.map(item=>(
            <button key={item.id} onClick={()=>setView(item.id)}
              style={{flex:1,padding:"6px 2px",borderRadius:8,border:"none",background:view===item.id?"#1A1A2E":"transparent",color:view===item.id?item.color:"#475569",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
              <span style={{fontSize:18}}>{item.icon}</span>
              <span style={{fontSize:8}}>{item.label}</span>
            </button>
          ))}
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
      `}</style>
    </div>
  );
}
