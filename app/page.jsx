"use client";
import { useState, useRef, useEffect } from "react";
import PipelinePage from "./components/PipelinePage";
import BrunoPage from "./components/BrunoPage";
import IAGREXPage from "./components/IAGREXPage";

const AGENTS = {
  bea: {
    id:"bea",name:"Bea",role:"Segretaria Personale",icon:"👑",color:"#8B5CF6",
    statoProgetto:{doc:"2kxuu4g1-792",page:"2kxuu4g1-672"},
    quickReplies:["☀️ Buongiorno Bea","📋 Recap veloce","❓ In sospeso?","➕ Nuovo task"],
    info:`RUOLO\nGestisce la vita quotidiana di Dario: to-do, routine, cose in sospeso, promemoria.\n\nTRIGGER MATTUTINO\n"Buongiorno Bea" → fetch ClickUp + Calendario → recap completo\n\nCLICKUP LISTS\n• TO DO DAILY: 901218950374\n• ROUTINE DAILY: 901218950375\n• ROUTINE SETTIMANALE: 901218950376\n• IN SOSPESO: 901218950377\n\nSTATO PROGETTO: doc 2kxuu4g1-792 / page 2kxuu4g1-672\n\nREGOLE\n• Timezone: sempre Europe/Bucharest\n• "Buonanotte" solo dopo le 23:00\n• Torremaggiore: tutto attaccato\n• HOC = reddito, non priorità — IAGREX = focus\n• Keez: solo "Simona" per nome`,
    memories:`IDENTITÀ\n• Dario Angeloro, Timișoara Romania (da sett.2025)\n• Origine: Torremaggiore, Puglia (tutto attaccato)\n• Single, nessun figlio — dario.angeloro@houseofcreators.com\n\nLAVORO\n• HOC: 3.500€/mese — Sales Manager + Media Buyer\n• IAGREX SRL: agenzia performance marketing (focus principale)\n• Obiettivo: 1M€/anno con Meta Ads + Shopify\n\nCARATTERE\n• Creativo e imprenditoriale, tende a procrastinare\n• Ha bisogno di step concreti e focus sull'azione\n\nVITA PERSONALE\n• Ha perso sua mamma il 27 giugno 2020\n• Padre: ha avuto tumore alla prostata\n• Ha lottato con obesità fin da bambino\n• Lavorò come cameriere a Londra gen-mar 2020\n• Psicoterapia completata con Vito (Pescara)\n• Supporto emotivo quotidiano: Virgilio\n\nCOLLEGHI\n• Irene: 1-to-1 calls — Gianluca: Torremaggiore\n• Matteo Mercurio: HOC — Simona: Keez Romania`,
    systemPrompt:`Sei Beatrice (Bea), assistente personale e segretaria di fiducia di Dario Angeloro.\n\nCHI È DARIO: Vive a Timișoara Romania (da sett.2025), originario di Torremaggiore (Puglia — tutto attaccato). Mente creativa, tende a procrastinare. HOC 3.500€/mese = reddito. IAGREX SRL = focus principale. Obiettivo: 1M€/anno Meta Ads + Shopify.\n\nRUOLO: Gestisci vita quotidiana di Dario. Recap COMPLETO quando richiesto. Timezone SEMPRE Europe/Bucharest.\n\nTRIGGER MATTUTINO "Buongiorno Bea":\n1. Usa dati ClickUp e Calendar iniettati nel contesto\n2. Mostra recap: to-do, routine, in sospeso, eventi calendario\n3. Filtra solo item ancora da fare\n\nCLICKUP: TO DO DAILY 901218950374 | ROUTINE DAILY 901218950375 | IN SOSPESO 901218950377\n\nREGOLE: Timezone Europe/Bucharest. Buonanotte solo dopo 23:00. Torremaggiore tutto attaccato. Keez: solo "Simona".`
  },
  mario: {
    id:"mario",name:"Mario",role:"Strategia IAGREX",icon:"📊",color:"#3B82F6",
    statoProgetto:{doc:"2kxuu4g1-872",page:"2kxuu4g1-752"},
    quickReplies:["📈 Stato IAGREX","🎯 Priorità settimana","🔍 Nuovi lead?","💡 Idee strategia"],
    info:`RUOLO\nAssistente strategico per IAGREX SRL.\n\nIAGREX SRL\n• Meta Ads + Shopify — Obiettivo: 1M€/anno\n• Reddito attuale: ~1.000€/mese (da scalare)\n\nCLICKUP: AGENZIA 1M€ 901218950388 | CLIENTI 901218950389 | LEADS 901218950390\nSTATO PROGETTO: doc 2kxuu4g1-872 / page 2kxuu4g1-752`,
    memories:`IAGREX SRL\n• Agenzia performance marketing Romania\n• Modello attuale: 3 clienti, ~1.000€/mese (da scalare)\n• Servizi: Meta Ads + Shopify\n\nHOC: 3.500€/mese — NON priorità strategica\n\nDARIO\n• Creativo, rischia di pensare troppo\n• Ha bisogno di step concreti con scadenze`,
    systemPrompt:`Sei Mario, assistente strategico di Dario per IAGREX SRL.\n\nIAGREX SRL: agenzia performance marketing Romania — Meta Ads + Shopify — obiettivo 1M€/anno — attuale ~1.000€/mese. HOC 3.500€/mese NON è focus strategico.\n\nDARIO: imprenditore a Timișoara, Torremaggiore (tutto attaccato). Creativo ma pensa troppo — aiutalo ad agire.\n\nRUOLO: Strategia crescita, clienti, offerta, lead generation, pipeline.\n\nREGOLE: Italiano, diretto, step concreti immediati. Timezone: Europe/Bucharest.\n\nSTILE: Con Dario risposte brevi e dirette, max 3-4 frasi. Quando prepari contenuti per terzi cura tono, lunghezza e professionalità al massimo.`
  },
  mimmo: {
    id:"mimmo",name:"Mimmo",role:"Contabilità IAGREX",icon:"📋",color:"#10B981",
    statoProgetto:{doc:"2kxuu4g1-892",page:"2kxuu4g1-772"},
    quickReplies:["📅 Scadenze prossime","🧾 Stato fatture","📝 Presenze sabato","💶 Situazione contabile"],
    info:`RUOLO\nContabilità e finanza aziendale di IAGREX SRL.\n\nCONTESTO\n• Dario: amministratore e dipendente IAGREX SRL\n• Busta paga: fine mese — Presenze: ogni sabato\n• Keez Romania (solo "Simona")\n\nCLICKUP: FATTURE 901218950391 | SCADENZE 901218950392 | CONTABILITÀ 901218950393\nSTATO PROGETTO: doc 2kxuu4g1-892 / page 2kxuu4g1-772`,
    memories:`IAGREX SRL — CONTABILITÀ\n• Dario: amministratore e dipendente\n• Busta paga fine mese — Presenze ogni sabato\n• Keez Romania — solo "Simona" per nome`,
    systemPrompt:`Sei Mimmo, assistente contabile di Dario per IAGREX SRL.\n\nCONTESTO: Dario amministratore e dipendente IAGREX SRL Romania. Busta paga fine mese, presenze ogni sabato. Keez Romania, referente: Simona.\n\nRUOLO: Fatture, scadenze fiscali, contabilità, presenze, Keez.\n\nREGOLE: Italiano, preciso, metodico. Scadenze sempre in anticipo. Keez: solo "Simona". Timezone: Europe/Bucharest.\n\nSTILE: Con Dario risposte brevi e dirette, max 3-4 frasi. Quando prepari contenuti per terzi cura tono, lunghezza e professionalità al massimo.`
  },
  carmine: {
    id:"carmine",name:"Carmine",role:"Dieta & Palestra",icon:"💪",color:"#F97316",
    statoProgetto:{doc:"2kxuu4g1-832",page:"2kxuu4g1-712"},
    quickReplies:["⚖️ Registro peso","🥗 Cosa mangio oggi?","💪 Allenamento oggi","📊 I miei progressi"],
    info:`RUOLO\nAlimentazione, allenamento e benessere fisico.\n\nPROFILO DARIO\n• 179 cm — feb 2026: 121,5 kg → ora ~103 kg (-18,5 kg!) ✅\n• PT: 3x settimana — Obiettivo: peso forma + muscoli\n\nCLICKUP: DIETA & PASTI 901218950382 | ALLENAMENTI 901218950383 | PROGRESSI 901218950384\nSTATO PROGETTO: doc 2kxuu4g1-832 / page 2kxuu4g1-712`,
    memories:`FISICO\n• 179 cm — feb 2026: 121,5 kg → ora ~103 kg (-18,5 kg 🎉)\n• PT 3 volte a settimana\n• Obiettivo: peso forma con muscoli visibili\n• Ha lottato col sovrappeso dall'infanzia — empatia fondamentale`,
    systemPrompt:`Sei Carmine, assistente di Dario per dieta, allenamento e benessere.\n\nFISICO: 179 cm — feb 2026: 121,5 kg → ~103 kg (-18,5 kg!). PT 3x settimana. Obiettivo: peso forma + muscoli. Ha lottato col sovrappeso dall'infanzia.\n\nRUOLO: Piani pasti, allenamenti, tracking progressi, motivazione, consigli pratici.\n\nREGOLE: Italiano, empatico, incoraggiante, mai giudicante. Concreto: numeri, piani reali. Celebra ogni progresso. Timezone: Europe/Bucharest.\n\nSTILE: Con Dario risposte brevi e dirette, max 3-4 frasi. Quando prepari contenuti per terzi cura tono, lunghezza e professionalità al massimo.`
  },
  vlad: {
    id:"vlad",name:"Vlad",role:"Burocrazia Romania",icon:"📜",color:"#EF4444",
    statoProgetto:{doc:"2kxuu4g1-812",page:"2kxuu4g1-692"},
    quickReplies:["📋 Scadenze Romania","📁 Stato pratiche","❓ Come si fa...","📄 Documento necessario"],
    info:`RUOLO\nBurocrazia e vita pratica in Romania.\n\nCONTESTO\n• Dario: italiano a Timișoara da sett.2025\n• IAGREX SRL: amministratore e dipendente\n• Keez Romania (solo "Simona")\n\nCLICKUP: PRATICHE ATTIVE 901218950378 | DOCUMENTI 901218950379 | SCADENZE 901218950381\nSTATO PROGETTO: doc 2kxuu4g1-812 / page 2kxuu4g1-692`,
    memories:`SITUAZIONE IN ROMANIA\n• Residente a Timișoara da settembre 2025\n• IAGREX SRL: amministratore e dipendente\n• Non parla rumeno fluentemente\n• Keez Romania — solo "Simona" per nome`,
    systemPrompt:`Sei Vlad, assistente di Dario per burocrazia e vita pratica in Romania.\n\nDARIO: Italiano (Torremaggiore Puglia — tutto attaccato) a Timișoara da sett.2025. IAGREX SRL: amministratore e dipendente. Keez Romania, referente: Simona. Non parla rumeno fluentemente.\n\nRUOLO: Pratiche burocratiche, residenza, permessi, scadenze legali personali, vita pratica Timișoara, traduzione documenti.\n\nREGOLE: Italiano, preciso, scadenze sempre in anticipo. Spiega sempre il contesto. Keez: solo "Simona". Timezone: Europe/Bucharest.\n\nSTILE: Con Dario risposte brevi e dirette, max 3-4 frasi. Quando prepari contenuti per terzi cura tono, lunghezza e professionalità al massimo.`
  },
  virgilio: {
    id:"virgilio",name:"Virgilio",role:"Supporto Emotivo",icon:"🌙",color:"#A855F7",
    statoProgetto:null,
    quickReplies:["💭 Come sto oggi","Ho bisogno di parlare","🌙 Fine giornata","Voglio riflettere su qualcosa"],
    info:`RUOLO\nSpazio sicuro di ascolto, riflessione e supporto emotivo quotidiano.\n\nIMPORTANTE\n• Virgilio è un agente AI, non un professionista clinico\n• Per questioni cliniche → incoraggia il professionista\n\nAPPROCCIO\n• Ascolta prima — Valida le emozioni — Non dà consigli non richiesti\n• Tono: caldo, empatico, mai giudicante`,
    memories:`STORIA EMOTIVA\n• Ha perso sua mamma il 27 giugno 2020\n  → Anniversario ogni 27 giugno — ricordare con delicatezza\n• Padre: ha avuto tumore alla prostata\n• Lotta col sovrappeso dall'infanzia (ora percorso positivo)\n• Difficoltà economiche fino allo scorso anno\n• Psicoterapia conclusa con Vito (Pescara)\n• Vive solo a Timișoara — lontano da famiglia e amici\n• Sara: amica stretta, si sentono ~1x mese`,
    systemPrompt:`Sei Virgilio, assistente di supporto emotivo di Dario Angeloro.\n\nIMPORTANTE: Sei un agente AI, non un professionista della salute mentale. Per questioni cliniche, incoraggia delicatamente il supporto professionale.\n\nCHI È DARIO: Ha perso sua mamma il 27 giugno 2020 (ricordaglielo con delicatezza ogni 27 giugno). Lotta col sovrappeso dall'infanzia (ora percorso positivo). Difficoltà economiche fino allo scorso anno. Psicoterapia conclusa con Vito. Vive solo a Timișoara.\n\nRUOLO: Spazio sicuro di ascolto e riflessione.\n\nREGOLE: Ascolta prima di rispondere. Non dare consigli non richiesti. Valida le emozioni senza amplificarle. Caldo, empatico, mai giudicante. Italiano.\n\nSTILE: Con Dario risposte brevi e dirette, max 3-4 frasi.`
  },
  bruno: {
    id:"bruno",name:"Bruno",role:"Finanze Personali",icon:"💰",color:"#F59E0B",
    statoProgetto:{doc:"2kxuu4g1-852",page:"2kxuu4g1-732"},
    quickReplies:["💰 Situazione conti","📊 Spese questo mese","🎯 Obiettivi finanziari","💹 Investimenti"],
    info:`RUOLO\nGestione delle finanze personali di Dario.\n\nI 6 CONTI\n1. BdM Banca + 2 carte — 2. Trade Republic\n3. Revolut — 4. PostePay Evolution\n5. HYPE / Banca Sella — 6. UniCredit Romania\n\nCLICKUP: ENTRATE & USCITE 901218950385 | OBIETTIVI 901218950386 | INVESTIMENTI 901218950387\nSTATO PROGETTO: doc 2kxuu4g1-852 / page 2kxuu4g1-732\n\nPRIVACY: Dettagli sensibili → solo in chat. ClickUp → solo totali aggregati.`,
    memories:`I 6 CONTI\n1. BdM Banca — principale, 2 carte\n2. Trade Republic — investimenti e risparmio\n3. Revolut — pagamenti quotidiani\n4. PostePay Evolution — italiano\n5. HYPE / Banca Sella — digitale italiano\n6. UniCredit Romania\n\nREDDITO: ~4.500€/mese (HOC 3.500 + IAGREX ~1.000)\n\nDETTAGLI SENSIBILI: SOLO in chat, mai su ClickUp`,
    systemPrompt:`Sei Bruno, assistente per le finanze personali di Dario.\n\nI 6 CONTI: 1.BdM Banca+2carte 2.Trade Republic 3.Revolut 4.PostePay Evolution 5.HYPE/Banca Sella 6.UniCredit Romania\n\nPRIVACY: Dettagli sensibili (numeri, saldi precisi) SOLO in chat. ClickUp: solo totali aggregati.\n\nCONTESTO: Reddito ~4.500€/mese. Ha vissuto difficoltà economiche — gestione attenta.\n\nRUOLO: Traccia entrate/uscite, obiettivi risparmio, investimenti, ottimizza i 6 conti.\n\nREGOLE: Italiano, preciso, ottimizzazioni concrete. Timezone: Europe/Bucharest.\n\nSTILE: Con Dario risposte brevi e dirette, max 3-4 frasi. Quando prepari contenuti per terzi cura tono, lunghezza e professionalità al massimo.`
  }
};

const GROUPS = [
  {label:"DARIO PERSONALE", ids:["bea","carmine","vlad","bruno"]},
  {label:"IAGREX SRL",      ids:["mario","mimmo"]},
  {label:"EXTRA",           ids:["virgilio"]}
];

const DONE_STATUSES = ["complete","completed","done","chiuso","closed","fatto","completato"];

function getWeatherEmoji(condition) {
  const c = (condition || "").toLowerCase();
  if (c.includes("thunder")) return "⛈️";
  if (c.includes("snow")) return "❄️";
  if (c.includes("rain")) return "🌧️";
  if (c.includes("drizzle")) return "🌦️";
  if (c.includes("mist") || c.includes("fog") || c.includes("haze")) return "🌫️";
  if (c.includes("cloud")) return "☁️";
  if (c.includes("clear")) return "☀️";
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
  const [view, setView] = useState("home");
  const [activeAgent, setActiveAgent] = useState("bea");
  const [conversations, setConversations] = useState(
    Object.fromEntries(Object.keys(AGENTS).map(k=>[k,[]]))
  );
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [clickupKey, setClickupKey] = useState("");
  const [calApiKey, setCalApiKey] = useState("");
  const [calId, setCalId] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showWeightModal, setShowWeightModal] = useState(false);
  const [weightInput, setWeightInput] = useState("");
  const [mobileExpanded, setMobileExpanded] = useState(null);
  const [infoTab, setInfoTab] = useState(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [saveError, setSaveError] = useState("");
  const [fontSize, setFontSize] = useState(14);
  const [clickupStatus, setClickupStatus] = useState(null);
  const [statiProgetto, setStatiProgetto] = useState({});
  const [storageReady, setStorageReady] = useState(false);
  const [readStatus, setReadStatus] = useState({});

  const [clockBucharest, setClockBucharest] = useState("--:--:--");
  const [clockRome, setClockRome] = useState("--:--");
  const [weather, setWeather] = useState(null);
  const [homeData, setHomeData] = useState({todo:[],routine:[],sospeso:[]});
  const [revenue, setRevenue] = useState(null);
  const [weightData, setWeightData] = useState(null);
  const [homeLoading, setHomeLoading] = useState(false);
  const [newWeight, setNewWeight] = useState("");
  const [checkedTasks, setCheckedTasks] = useState({});

  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(()=>{
    try{
      const cr=localStorage.getItem("dario-conversations");
      if(cr){
        const saved=JSON.parse(cr);
        setConversations(prev=>{
          const m={...prev};
          Object.keys(saved).forEach(k=>{if(m[k]!==undefined) m[k]=saved[k];});
          return m;
        });
      }
    }catch(e){}
    try{
      const sr=localStorage.getItem("dario-settings");
      if(sr){
        const s=JSON.parse(sr);
        if(s.clickupKey) setClickupKey(s.clickupKey);
        if(s.calApiKey)  setCalApiKey(s.calApiKey);
        if(s.calId)      setCalId(s.calId);
        if(s.fontSize)   setFontSize(s.fontSize);
        if(s.voiceEnabled!==undefined) setVoiceEnabled(s.voiceEnabled);
        if(s.notifEnabled!==undefined) setNotifEnabled(s.notifEnabled);
        if(s.readStatus)  setReadStatus(s.readStatus);
      }
    }catch(e){}
    try{
      const ct=localStorage.getItem("dario-checked-tasks");
      if(ct) setCheckedTasks(JSON.parse(ct));
    }catch(e){}
    setStorageReady(true);
  },[]);

  useEffect(()=>{
    if(!storageReady) return;
    try{
      const toStore=Object.fromEntries(Object.entries(conversations).map(([k,v])=>[k,v.slice(-30)]));
      localStorage.setItem("dario-conversations",JSON.stringify(toStore));
    }catch(e){}
  },[conversations,storageReady]);

  useEffect(()=>{
    if(!storageReady) return;
    try{
      localStorage.setItem("dario-settings",JSON.stringify({clickupKey,calApiKey,calId,fontSize,voiceEnabled,notifEnabled,readStatus}));
    }catch(e){}
  },[clickupKey,calApiKey,calId,fontSize,voiceEnabled,notifEnabled,readStatus,storageReady]);

  useEffect(()=>{
    const check=()=>setIsMobile(window.innerWidth<640);
    check();
    window.addEventListener("resize",check);
    return ()=>window.removeEventListener("resize",check);
  },[]);

  useEffect(()=>{
    messagesEndRef.current?.scrollIntoView({behavior:"smooth"});
  },[conversations,activeAgent,isLoading]);

  useEffect(()=>{
    if(!clickupKey){setClickupStatus(null);return;}
    setClickupStatus("testing");
    const t=setTimeout(async()=>{
      try{
        const res=await fetch("/api/clickup?listId=901218950374",{headers:{"x-clickup-key":clickupKey}});
        setClickupStatus(res.ok?"ok":"error");
      }catch(e){setClickupStatus("error");}
    },1000);
    return ()=>clearTimeout(t);
  },[clickupKey]);

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

  useEffect(()=>{
    if(view==="home") loadHomeData();
  },[view]);

  const loadHomeData=async()=>{
    setHomeLoading(true);
    try{
      const [wRes,tRes,rRes,wgRes]=await Promise.all([
        fetch("/api/weather").then(r=>r.json()).catch(()=>null),
        fetch("/api/tasks").then(r=>r.json()).catch(()=>({todo:[],routine:[],sospeso:[]})),
        fetch("/api/revenue").then(r=>r.json()).catch(()=>null),
        fetch("/api/weight").then(r=>r.json()).catch(()=>null),
      ]);
      if(wRes&&!wRes.error) setWeather(wRes);
      if(tRes) setHomeData(tRes);
      if(rRes&&!rRes.error) setRevenue(rRes);
      if(wgRes&&!wgRes.error) setWeightData(wgRes);
    }catch(e){console.error("Dashboard error:",e);}
    setHomeLoading(false);
  };

  const toggleTask=async(taskId,type)=>{
    const task=homeData[type]?.find(t=>t.id===taskId);
    if(!task) return;
    const cur = checkedTasks[taskId] ?? DONE_STATUSES.includes((task.status?.status||"").toLowerCase());
    const next = !cur;
    const newChecked={...checkedTasks,[taskId]:next};
    setCheckedTasks(newChecked);
    try{localStorage.setItem("dario-checked-tasks",JSON.stringify(newChecked));}catch(e){}
    try{
      await fetch("/api/update-task",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({taskId,status:next?"completato":"da fare"})});
    }catch(e){}
  };

  const saveWeight=async()=>{
    const p=parseFloat(newWeight);
    if(!newWeight||isNaN(p)) return;
    const today=new Date().toISOString().slice(0,10);
    try{
      const res=await fetch("/api/weight",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({data:today,peso:p})});
      const data=await res.json();
      if(data.success){
        const last=data.entries[data.entries.length-1];
        setWeightData(prev=>({...prev,entries:data.entries,ultimo:last,persi:Math.round((121.6-last.peso)*10)/10,mancano:Math.round((last.peso-85)*10)/10}));
        setNewWeight("");
      }
    }catch(e){console.error(e);}
  };

  const saveWeightModal=async()=>{
    const p=parseFloat(weightInput.replace(",","."));
    if(!weightInput||isNaN(p)) return;
    const today=new Date().toISOString().slice(0,10);
    try{
      const res=await fetch("/api/weight",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({data:today,peso:p})});
      const data=await res.json();
      if(data.success){
        const last=data.entries[data.entries.length-1];
        setWeightData(prev=>({...prev,entries:data.entries,ultimo:last,persi:Math.round((121.6-last.peso)*10)/10,mancano:Math.round((last.peso-85)*10)/10}));
        setShowWeightModal(false);
        setWeightInput("");
      }
    }catch(e){console.error(e);}
  };

  const fetchStatoProgetto=async(agentId)=>{
    const a=AGENTS[agentId];
    if(!a.statoProgetto||!clickupKey) return "";
    try{
      const res=await fetch(`/api/clickup-doc?docId=${a.statoProgetto.doc}&pageId=${a.statoProgetto.page}`,{headers:{"x-clickup-key":clickupKey}});
      if(!res.ok) return "";
      const data=await res.json();
      return data.content||data.content_editable||"";
    }catch(e){return "";}
  };

  const goToAgent=async(id)=>{
    setActiveAgent(id);
    setView("chat");
    setInfoTab(null);
    setShowSettings(false);
    setReadStatus(prev=>({...prev,[id]:conversations[id]?.length||0}));
    if(AGENTS[id].statoProgetto&&!statiProgetto[id]&&clickupKey){
      const content=await fetchStatoProgetto(id);
      if(content) setStatiProgetto(prev=>({...prev,[id]:content}));
    }
    if(id==="bea"){
      const h=parseInt(new Date().toLocaleString("en-US",{timeZone:"Europe/Bucharest",hour:"numeric",hour12:false}));
      const conv=conversations["bea"]||[];
      if(h>=5&&h<13&&conv.length===0){
        setTimeout(()=>sendMessageFn("bea","☀️ Buongiorno Bea"),700);
      }
    }
  };

  const fetchClickUpContext=async()=>{
    if(!clickupKey) return "";
    const lists=[
      {id:"901218950374",name:"TO DO DAILY"},
      {id:"901218950375",name:"ROUTINE DAILY"},
      {id:"901218950377",name:"IN SOSPESO"}
    ];
    let ctx="=== DATI CLICKUP ===\n";
    for(const list of lists){
      setStatusMsg(`Fetching ${list.name}...`);
      try{
        const res=await fetch(`/api/clickup?listId=${list.id}`,{headers:{"x-clickup-key":clickupKey}});
        if(!res.ok) throw new Error(`HTTP ${res.status}`);
        const data=await res.json();
        const tasks=(data.tasks||[]).filter(t=>!DONE_STATUSES.includes((t.status?.status||"").toLowerCase())).map(t=>`  - ${t.name} [${t.status?.status||"aperto"}]`);
        ctx+=`\n${list.name} (${tasks.length}):\n`;
        tasks.length?ctx+=tasks.join("\n")+"\n":ctx+="  → Nessun task\n";
      }catch(e){ctx+=`\n${list.name}: ERRORE → ${e.message}\n`;}
    }
    ctx+="=== FINE CLICKUP ===\n\n";
    setStatusMsg("");
    return ctx;
  };

  const fetchCalendarContext=async()=>{
    if(!calApiKey||!calId) return "";
    setStatusMsg("Fetching calendario...");
    try{
      const now=new Date();
      const tMin=new Date(now.getFullYear(),now.getMonth(),now.getDate()).toISOString();
      const tMax=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1).toISOString();
      const res=await fetch(`/api/calendar?calendarId=${encodeURIComponent(calId)}&timeMin=${encodeURIComponent(tMin)}&timeMax=${encodeURIComponent(tMax)}`,{headers:{"x-calendar-key":calApiKey}});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const data=await res.json();
      const events=data.items||[];
      if(!events.length) return "=== CALENDARIO: Nessun evento oggi ===\n\n";
      let ctx="=== CALENDARIO OGGI ===\n";
      events.forEach(e=>{
        const start=e.start.dateTime?new Date(e.start.dateTime).toLocaleTimeString("it-IT",{timeZone:"Europe/Bucharest",hour:"2-digit",minute:"2-digit"}):"tutto il giorno";
        ctx+=`• ${start} — ${e.summary||"Evento"}\n`;
      });
      ctx+="=== FINE CALENDARIO ===\n\n";
      setStatusMsg("");
      return ctx;
    }catch(e){setStatusMsg("");return `=== CALENDARIO: Errore → ${e.message} ===\n\n`;}
  };

  const sendMessageFn=async(agentId,overrideText)=>{
    const currentAgent=agentId||activeAgent;
    const text=(overrideText!==undefined?overrideText:input).trim();
    if(!text||isLoading) return;
    if(overrideText===undefined){setInput("");if(textareaRef.current) textareaRef.current.style.height="auto";}
    setIsLoading(true);
    const userMsg={role:"user",content:text};
    const prevConv=conversations[currentAgent]||[];
    const updatedConv=[...prevConv,userMsg];
    setConversations(prev=>({...prev,[currentAgent]:updatedConv}));
    try{
      let content=text;
      const sp=statiProgetto[currentAgent];
      if(sp&&prevConv.length===0){
        content=`=== STATO PROGETTO (ultima sessione) ===\n${sp.slice(0,2000)}\n=== FINE STATO PROGETTO ===\n\n`+content;
      }
      if(currentAgent==="bea"){
        let ctx="";
        if(clickupKey){setStatusMsg("Fetching ClickUp...");ctx+=await fetchClickUpContext();}
        if(calApiKey&&calId){ctx+=await fetchCalendarContext();}
        if(ctx) content=ctx+content;
      }
      const history=updatedConv.slice(0,-1);
      const truncated=history.slice(-12);
      const msgs=[...truncated,{role:"user",content}];
      setStatusMsg("Risposta in arrivo...");
      const res=await fetch("/api/chat",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1000,system:[{type:"text",text:AGENTS[currentAgent].systemPrompt,cache_control:{type:"ephemeral"}}],messages:msgs,agentId:currentAgent})
      });
      const data=await res.json();
      const reply=data.content?.[0]?.text||"Errore.";
      setConversations(prev=>({...prev,[currentAgent]:[...updatedConv,{role:"assistant",content:reply}]}));
      if(voiceEnabled) speak(reply);
      if(notifEnabled&&document.hidden){try{new Notification(AGENTS[currentAgent].name,{body:reply.slice(0,100)});}catch{}}
    }catch(e){
      setConversations(prev=>({...prev,[currentAgent]:[...updatedConv,{role:"assistant",content:`Errore: ${e.message}`}]}));
    }
    setIsLoading(false);setStatusMsg("");
  };

  const sendMessage=()=>sendMessageFn(activeAgent,undefined);
  const handleQuickReply=(qr)=>sendMessageFn(activeAgent,qr);

  const saveSession=async()=>{
    const a=AGENTS[activeAgent];
    if(!a.statoProgetto) return;
    if(!clickupKey){alert("Imposta la ClickUp API Key nelle Impostazioni.");return;}
    const conv=conversations[activeAgent];
    if(!conv.length){alert("Nessuna conversazione da salvare.");return;}
    setSaveStatus("generating");setSaveError("");
    const convText=conv.map(m=>`[${m.role==="user"?"Dario":a.name}]: ${m.content}`).join("\n\n");
    const now=new Date().toLocaleString("it-IT",{timeZone:"Europe/Bucharest",dateStyle:"full",timeStyle:"short"});
    try{
      const res=await fetch("/api/chat",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:800,system:[{type:"text",text:`Sei un assistente che analizza sessioni di lavoro e genera aggiornamenti concisi per documenti di stato. Rispondi SOLO con il testo in italiano, senza preamboli.`,cache_control:{type:"ephemeral"}}],messages:[{role:"user",content:`Data: ${now}\nAgente: ${a.name} — ${a.role}\n\nAnalizza questa conversazione e genera un aggiornamento per il documento STATO PROGETTO:\n\n## SESSIONE ${now}\n\n**Argomenti trattati:**\n**Decisioni prese:**\n**In sospeso / Prossimi step:**\n**Contesto per la prossima sessione:**\n\nCONVERSAZIONE:\n${convText}`}]})
      });
      const data=await res.json();
      const summary=data.content?.[0]?.text||"Errore generazione.";
      setSaveStatus("saving");
      const {doc,page}=a.statoProgetto;
      const cuRes=await fetch(`/api/clickup-doc?docId=${doc}&pageId=${page}`,{method:"PUT",headers:{"x-clickup-key":clickupKey,"Content-Type":"application/json"},body:JSON.stringify({content:summary,content_format:"text/plain"})});
      if(!cuRes.ok) throw new Error(`ClickUp HTTP ${cuRes.status}`);
      setSaveStatus("success");
      setTimeout(()=>setSaveStatus(null),4000);
    }catch(e){
      setSaveError(e.message);setSaveStatus("error");
      setTimeout(()=>setSaveStatus(null),6000);
    }
  };

  const speak=text=>{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text.slice(0,600));u.lang="it-IT";window.speechSynthesis.speak(u);};

  const toggleListen=()=>{
    if(isListening){recognitionRef.current?.stop();return;}
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){alert("Usa Chrome per il riconoscimento vocale.");return;}
    const r=new SR();r.lang="it-IT";r.onstart=()=>setIsListening(true);r.onend=()=>setIsListening(false);r.onresult=e=>setInput(e.results[0][0].transcript);r.onerror=()=>setIsListening(false);recognitionRef.current=r;r.start();
  };

  const clearChat=()=>setConversations(prev=>({...prev,[activeAgent]:[]}));

  const exportChat=()=>{
    const conv=conversations[activeAgent];
    if(!conv.length) return;
    const a=AGENTS[activeAgent];
    const text=conv.map(m=>`[${m.role==="user"?"Dario":a.name}]\n${m.content}`).join("\n\n---\n\n");
    const blob=new Blob([text],{type:"text/plain;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const el=document.createElement("a");
    el.href=url;el.download=`${a.name}_${new Date().toISOString().slice(0,10)}.txt`;el.click();URL.revokeObjectURL(url);
  };

  const requestNotifications=async()=>{
    if(!("Notification" in window)){alert("Browser non supporta notifiche.");return;}
    const p=await Notification.requestPermission();
    setNotifEnabled(p==="granted");
  };

  const handleTA=e=>{
    setInput(e.target.value);
    e.target.style.height="auto";
    e.target.style.height=Math.min(e.target.scrollHeight,120)+"px";
  };

  const toggleInfo=tab=>{setInfoTab(p=>p===tab?null:tab);setShowSettings(false);};

  const getGreeting=()=>{
    const h=parseInt(new Date().toLocaleString("en-US",{timeZone:"Europe/Bucharest",hour:"numeric",hour12:false}));
    return h<12?"Buongiorno":h<18?"Buon pomeriggio":"Buonasera";
  };

  const saveStatusLabel=()=>{
    if(saveStatus==="generating") return {text:"⏳ Generando sommario...",color:"#F59E0B"};
    if(saveStatus==="saving")    return {text:"☁️ Salvando su ClickUp...",color:"#3B82F6"};
    if(saveStatus==="success")   return {text:"✅ Sessione salvata!",color:"#10B981"};
    if(saveStatus==="error")     return {text:`❌ ${saveError.slice(0,60)}`,color:"#EF4444"};
    return null;
  };

  const isUnread=(id)=>{
    const msgs=conversations[id]||[];
    return msgs.length>(readStatus[id]||0)&&msgs.slice(-1)[0]?.role==="assistant";
  };

  const agent=AGENTS[activeAgent];
  const conv=conversations[activeAgent]||[];
  const sl=saveStatusLabel();
  const cuDot=clickupStatus==="ok"?"#10B981":clickupStatus==="error"?"#EF4444":clickupStatus==="testing"?"#F59E0B":"#334155";
  const cuLabel=clickupStatus==="ok"?"Connesso":clickupStatus==="error"?"Errore":clickupStatus==="testing"?"Test...":"Non configurato";

  const HBtn=({label,active,onClick,ac,disabled=false})=>(
    <button onClick={onClick} disabled={disabled} style={{padding:"5px 10px",borderRadius:8,fontSize:12,cursor:disabled?"not-allowed":"pointer",border:`1px solid ${active?(ac||agent.color):"#1A1A2E"}`,background:active?`${ac||agent.color}18`:"transparent",color:active?(ac||agent.color):disabled?"#2A2A3A":"#475569",opacity:disabled?0.5:1,flexShrink:0,whiteSpace:"nowrap"}}>{label}</button>
  );

  const DCard=({children,style={}})=>(
    <div style={{background:"#0F0F1A",border:"1px solid #1A1A2E",borderRadius:14,padding:16,...style}}>{children}</div>
  );

  const DLabel=({children})=>(
    <div style={{fontSize:Math.max(9,fontSize-4),fontWeight:700,color:"#475569",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>{children}</div>
  );

  const SettingsPanel=({mobile=false})=>(
    <div style={{padding:"14px 16px",background:"#0F0F1A",borderBottom:"1px solid #1A1A2E",flexShrink:0}}>
      <div style={{display:"grid",gridTemplateColumns:mobile?"1fr":"1fr 1fr",gap:10,marginBottom:12}}>
        <div>
          <div style={{fontSize:11,color:"#64748B",marginBottom:4,display:"flex",alignItems:"center",gap:6}}>
            ClickUp API Key
            <span style={{display:"flex",alignItems:"center",gap:3}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:cuDot,display:"inline-block"}}/>
              <span style={{fontSize:10,color:cuDot}}>{cuLabel}</span>
            </span>
          </div>
          <input type="password" value={clickupKey} onChange={e=>setClickupKey(e.target.value)} placeholder="pk_xxxxx" style={{width:"100%",padding:"6px 10px",borderRadius:6,border:"1px solid #1A1A2E",background:"#09090F",color:"#E2E8F0",fontSize:12,outline:"none"}}/>
        </div>
        {!mobile&&(
          <div>
            <div style={{fontSize:11,color:"#64748B",marginBottom:4}}>Google Calendar API Key</div>
            <input type="password" value={calApiKey} onChange={e=>setCalApiKey(e.target.value)} placeholder="AIzaSy..." style={{width:"100%",padding:"6px 10px",borderRadius:6,border:"1px solid #1A1A2E",background:"#09090F",color:"#E2E8F0",fontSize:12,outline:"none"}}/>
          </div>
        )}
        {!mobile&&(
          <div>
            <div style={{fontSize:11,color:"#64748B",marginBottom:4}}>Google Calendar ID</div>
            <input value={calId} onChange={e=>setCalId(e.target.value)} placeholder="email@gmail.com" style={{width:"100%",padding:"6px 10px",borderRadius:6,border:"1px solid #1A1A2E",background:"#09090F",color:"#E2E8F0",fontSize:12,outline:"none"}}/>
          </div>
        )}
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <div style={{fontSize:11,color:"#64748B",display:"flex",justifyContent:"space-between"}}>
            Dimensione testo <span style={{color:"#94A3B8"}}>{fontSize}px</span>
          </div>
          <input type="range" min={12} max={18} step={1} value={fontSize} onChange={e=>setFontSize(Number(e.target.value))} style={{width:"100%",accentColor:"#8B5CF6",cursor:"pointer"}}/>
          <div style={{display:"flex",gap:4}}>
            {[12,13,14,15,16,17,18].map(s=>(
              <button key={s} onClick={()=>setFontSize(s)} style={{flex:1,padding:"3px 0",borderRadius:4,border:`1px solid ${fontSize===s?"#8B5CF6":"#1A1A2E"}`,background:fontSize===s?"#8B5CF620":"transparent",color:fontSize===s?"#8B5CF6":"#475569",cursor:"pointer",fontSize:10}}>{s}</button>
            ))}
          </div>
        </div>
      </div>
      <button onClick={requestNotifications} style={{padding:"6px 12px",borderRadius:6,border:`1px solid ${notifEnabled?"#10B981":"#1A1A2E"}`,background:notifEnabled?"#10B98120":"transparent",color:notifEnabled?"#10B981":"#64748B",cursor:"pointer",fontSize:12}}>{notifEnabled?"🔔 Notifiche ON":"🔕 Abilita notifiche"}</button>
    </div>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100dvh",background:"#09090F",color:"#E2E8F0",fontFamily:"system-ui,-apple-system,sans-serif",overflow:"hidden"}}>
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>

        {!isMobile&&(
          <div style={{width:200,background:"#0F0F1A",borderRight:"1px solid #1A1A2E",display:"flex",flexDirection:"column",padding:"16px 10px",flexShrink:0}}>
            <button onClick={()=>setView("home")} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",marginBottom:4,borderRadius:10,border:"none",background:view==="home"?"#1A1A2E":"transparent",color:view==="home"?"#F8FAFC":"#64748B",cursor:"pointer",fontSize:13,fontWeight:600,textAlign:"left"}}>🏠 Dashboard</button>
            <button onClick={()=>setView("pipeline")} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",marginBottom:4,borderRadius:10,border:"none",background:view==="pipeline"?"#8B5CF620":"transparent",color:view==="pipeline"?"#8B5CF6":"#64748B",cursor:"pointer",fontSize:13,fontWeight:600,textAlign:"left",borderLeft:`3px solid ${view==="pipeline"?"#8B5CF6":"transparent"}`}}>🎯 Pipeline</button>
            <button onClick={()=>setView("finanze")} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",marginBottom:4,borderRadius:10,border:"none",background:view==="finanze"?"#F59E0B20":"transparent",color:view==="finanze"?"#F59E0B":"#64748B",cursor:"pointer",fontSize:13,fontWeight:600,textAlign:"left",borderLeft:`3px solid ${view==="finanze"?"#F59E0B":"transparent"}`}}>💰 Finanze</button>
            <button onClick={()=>setView("iagrex")} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",marginBottom:12,borderRadius:10,border:"none",background:view==="iagrex"?"#3B82F620":"transparent",color:view==="iagrex"?"#3B82F6":"#64748B",cursor:"pointer",fontSize:13,fontWeight:600,textAlign:"left",borderLeft:`3px solid ${view==="iagrex"?"#3B82F6":"transparent"}`}}>📊 IAGREX</button>
            {GROUPS.map(g=>(
              <div key={g.label} style={{marginBottom:8}}>
                <div style={{fontSize:9,color:"#334155",letterSpacing:"0.1em",textTransform:"uppercase",padding:"0 8px",marginBottom:4}}>{g.label}</div>
                {g.ids.map(id=>{const a=AGENTS[id];return(
                  <button key={a.id} onClick={()=>goToAgent(a.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:10,border:"none",marginBottom:2,width:"100%",textAlign:"left",background:view==="chat"&&activeAgent===a.id?`${a.color}18`:"transparent",borderLeft:`3px solid ${view==="chat"&&activeAgent===a.id?a.color:"transparent"}`,color:view==="chat"&&activeAgent===a.id?a.color:"#64748B",cursor:"pointer"}}>
                    <span style={{fontSize:17,flexShrink:0,lineHeight:1}}>{a.icon}</span>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,fontSize:13,lineHeight:1.2}}>{a.name}</div>
                      <div style={{fontSize:10,opacity:0.7}}>{a.role}</div>
                    </div>
                    {isUnread(a.id)&&<div style={{width:6,height:6,borderRadius:"50%",background:a.color,flexShrink:0}}/>}
                  </button>
                );})}
              </div>
            ))}
            <div style={{marginTop:"auto",paddingTop:12,borderTop:"1px solid #1A1A2E"}}>
              <button onClick={()=>{setShowSettings(!showSettings);setInfoTab(null);}} style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1px solid ${showSettings?"#334155":"#1A1A2E"}`,background:showSettings?"#1A1A2E":"transparent",color:"#64748B",cursor:"pointer",fontSize:12,textAlign:"left"}}>⚙️ Impostazioni</button>
            </div>
          </div>
        )}

        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {view==="iagrex"&&(
            <IAGREXPage fontSize={fontSize} onBack={()=>setView("home")}/>
          )}

          {view==="finanze"&&(
            <BrunoPage fontSize={fontSize}/>
          )}

          {view==="pipeline"&&(
            <PipelinePage fontSize={fontSize}/>
          )}

          {view==="home"&&(
            <>
              <div style={{padding:"14px 20px",borderBottom:"1px solid #1A1A2E",background:"#09090F",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{fontWeight:700,fontSize:15,color:"#F8FAFC"}}>🏠 Dashboard</div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={loadHomeData} style={{padding:"4px 10px",borderRadius:7,border:"1px solid #1A1A2E",background:"transparent",color:"#475569",cursor:"pointer",fontSize:11}}>{homeLoading?"⏳":"↻ Aggiorna"}</button>
                  <button onClick={()=>setShowSettings(s=>!s)} style={{padding:"4px 10px",borderRadius:7,border:`1px solid ${showSettings?"#8B5CF6":"#1A1A2E"}`,background:showSettings?"#8B5CF620":"transparent",color:showSettings?"#8B5CF6":"#64748B",cursor:"pointer",fontSize:11}}>⚙️</button>
                </div>
              </div>

              {showSettings&&<SettingsPanel mobile={isMobile}/>}

              <div style={{flex:1,overflowY:"auto",padding:"16px 16px 24px",fontSize:fontSize}}>
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:fontSize+6,fontWeight:700,color:"#F8FAFC"}}>{getGreeting()}, Dario 👋</div>
                  <div style={{color:"#475569",fontSize:fontSize-2,marginTop:3}}>{new Date().toLocaleDateString("it-IT",{timeZone:"Europe/Bucharest",weekday:"long",day:"numeric",month:"long"})}</div>
                </div>

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
                        <div style={{marginTop:10,display:"flex",gap:6}}>
                          <button onClick={()=>{setWeightInput("");setShowWeightModal(true);}} style={{flex:1,padding:"5px 8px",borderRadius:6,border:"1px solid #1A1A2E",background:"#09090F",color:"#475569",fontSize:fontSize-2,textAlign:"left",cursor:"pointer"}}>kg oggi...</button>
                        </div>
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
                        <div style={{fontSize:fontSize-3,color:"#64748B",marginTop:1}}>Saldo netto: {((revenue.entrate_totali||0)-(revenue.uscite_totali||0)).toLocaleString("it-IT")}€</div>
                        <div style={{marginTop:8,height:3,background:"#1A1A2E",borderRadius:2}}>
                          <div style={{height:"100%",background:"#10B981",borderRadius:2,width:`${Math.max(revenue.percentuale||0,1)}%`,transition:"width 0.4s"}}/>
                        </div>
                        <div style={{fontSize:fontSize-5,color:"#334155",marginTop:3}}>{revenue.percentuale}% verso 1.000.000€</div>
                        <button onClick={()=>setView("iagrex")} style={{marginTop:10,width:"100%",padding:"6px",borderRadius:7,border:"1px solid #3B82F640",background:"#3B82F610",color:"#3B82F6",cursor:"pointer",fontSize:fontSize-3,fontWeight:600}}>📊 Apri tracking completo</button>
                      </>
                    ):(
                      <div style={{fontSize:fontSize-2,color:"#334155"}}>{homeLoading?"Caricamento...":"–"}</div>
                    )}
                  </DCard>
                </div>

                <div style={{fontSize:fontSize-4,fontWeight:700,color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>🤖 Agenti AI</div>
                {GROUPS.map(g=>(
                  <div key={g.label} style={{marginBottom:16}}>
                    <div style={{fontSize:fontSize-5,color:"#334155",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>{g.label}</div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:8}}>
                      {g.ids.map(id=>{
                        const a=AGENTS[id];
                        const last=conversations[a.id]?.slice(-1)[0];
                        return(
                          <button key={a.id} onClick={()=>goToAgent(a.id)} style={{padding:12,borderRadius:12,border:`1px solid ${a.color}30`,background:`linear-gradient(135deg,${a.color}12,${a.color}06)`,cursor:"pointer",textAlign:"left",position:"relative"}}>
                            {isUnread(a.id)&&<div style={{position:"absolute",top:8,right:8,width:7,height:7,borderRadius:"50%",background:a.color,boxShadow:`0 0 5px ${a.color}`}}/>}
                            <div style={{fontSize:22,marginBottom:5,lineHeight:1}}>{a.icon}</div>
                            <div style={{fontWeight:700,fontSize:fontSize-2,color:a.color,marginBottom:1}}>{a.name}</div>
                            <div style={{fontSize:fontSize-4,color:"#475569",marginBottom:6}}>{a.role}</div>
                            <div style={{fontSize:fontSize-4,color:"#334155",lineHeight:1.4}}>{last?last.content.slice(0,45)+(last.content.length>45?"...":""):"Inizia a chattare →"}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {view==="chat"&&(
            <>
              <div style={{padding:"10px 16px",borderBottom:"1px solid #1A1A2E",background:"#09090F",flexShrink:0}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  {isMobile&&(
                    <button onClick={()=>setView("home")} style={{padding:"5px 9px",borderRadius:8,border:"1px solid #1A1A2E",background:"transparent",color:"#64748B",cursor:"pointer",fontSize:13,flexShrink:0}}>←</button>
                  )}
                  <div style={{width:34,height:34,borderRadius:"50%",background:`${agent.color}20`,border:`2px solid ${agent.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{agent.icon}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:14,color:agent.color,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{agent.name}</div>
                    <div style={{fontSize:11,color:"#475569"}}>{agent.role}</div>
                  </div>
                  {!isMobile&&(
                    <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                      {sl&&<span style={{fontSize:11,color:sl.color,fontStyle:"italic"}}>{sl.text}</span>}
                      {!sl&&statusMsg&&<span style={{fontSize:11,color:"#64748B",fontStyle:"italic"}}>{statusMsg}</span>}
                      <HBtn label="📋 Info" active={infoTab==="info"} onClick={()=>toggleInfo("info")}/>
                      <HBtn label="🧠 Ricordi" active={infoTab==="memories"} onClick={()=>toggleInfo("memories")} ac="#F59E0B"/>
                      <HBtn label={voiceEnabled?"🔊":"🔇"} active={voiceEnabled} onClick={()=>{setVoiceEnabled(v=>!v);if(voiceEnabled)window.speechSynthesis.cancel();}}/>
                      <HBtn label="📥" active={false} onClick={exportChat}/>
                      <HBtn label="🗑" active={false} onClick={clearChat}/>
                    </div>
                  )}
                </div>
                {isMobile&&(
                  <div style={{display:"flex",gap:6,alignItems:"center",marginTop:8,overflowX:"auto",paddingBottom:2}}>
                    {sl&&<span style={{fontSize:11,color:sl.color,fontStyle:"italic",flexShrink:0}}>{sl.text}</span>}
                    {!sl&&statusMsg&&<span style={{fontSize:11,color:"#64748B",fontStyle:"italic",flexShrink:0}}>{statusMsg}</span>}
                    <HBtn label="📋 Info" active={infoTab==="info"} onClick={()=>toggleInfo("info")}/>
                    <HBtn label="🧠 Ricordi" active={infoTab==="memories"} onClick={()=>toggleInfo("memories")} ac="#F59E0B"/>
                    <HBtn label={voiceEnabled?"🔊":"🔇"} active={voiceEnabled} onClick={()=>{setVoiceEnabled(v=>!v);if(voiceEnabled)window.speechSynthesis.cancel();}}/>
                    <HBtn label="📥" active={false} onClick={exportChat}/>
                    <HBtn label="🗑" active={false} onClick={clearChat}/>
                  </div>
                )}
              </div>

              {infoTab&&(
                <div style={{background:"#0F0F1A",borderBottom:"1px solid #1A1A2E",flexShrink:0}}>
                  <div style={{display:"flex",borderBottom:"1px solid #1A1A2E"}}>
                    {[["📋 Info","info"],["🧠 Ricordi","memories"]].map(([label,tab])=>(
                      <button key={tab} onClick={()=>setInfoTab(tab)} style={{padding:"7px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontWeight:infoTab===tab?600:400,color:infoTab===tab?(tab==="memories"?"#F59E0B":agent.color):"#475569",borderBottom:infoTab===tab?`2px solid ${tab==="memories"?"#F59E0B":agent.color}`:"2px solid transparent"}}>{label}</button>
                    ))}
                  </div>
                  <div style={{padding:"14px 16px",overflowY:"auto",maxHeight:200}}>
                    <pre style={{margin:0,fontSize:12,color:infoTab==="memories"?"#FCD34D":"#94A3B8",lineHeight:1.8,whiteSpace:"pre-wrap",fontFamily:"inherit"}}>{infoTab==="info"?agent.info:agent.memories}</pre>
                  </div>
                </div>
              )}

              {showSettings&&<SettingsPanel mobile={isMobile}/>}

              <div style={{flex:1,overflowY:"auto",padding:"16px",display:"flex",flexDirection:"column",gap:12}}>
                {conv.length===0&&(
                  <div style={{textAlign:"center",margin:"auto",color:"#334155",padding:"0 20px"}}>
                    <div style={{fontSize:44,marginBottom:10}}>{agent.icon}</div>
                    <div style={{fontSize:16,fontWeight:700,color:"#475569",marginBottom:4}}>{agent.name} è pronto</div>
                    <div style={{fontSize:12,color:"#334155"}}>{agent.role}</div>
                    {statiProgetto[activeAgent]&&<div style={{marginTop:10,fontSize:11,color:"#10B981"}}>✅ Stato progetto caricato</div>}
                  </div>
                )}
                {conv.map((msg,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:msg.role==="user"?"flex-end":"flex-start",gap:8,alignItems:"flex-start"}}>
                    {msg.role==="assistant"&&<div style={{width:28,height:28,borderRadius:"50%",background:`${agent.color}20`,border:`1.5px solid ${agent.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0,marginTop:2}}>{agent.icon}</div>}
                    <div style={{maxWidth:"75%",padding:"10px 13px",borderRadius:msg.role==="user"?"15px 15px 4px 15px":"15px 15px 15px 4px",background:msg.role==="user"?agent.color:"#141420",color:"#F1F5F9",fontSize:fontSize,lineHeight:1.65,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{msg.content}</div>
                  </div>
                ))}
                {isLoading&&(
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:`${agent.color}20`,border:`1.5px solid ${agent.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>{agent.icon}</div>
                    <div style={{padding:"10px 13px",borderRadius:"15px 15px 15px 4px",background:"#141420",display:"flex",gap:5}}>
                      {[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:agent.color,opacity:0.7,animation:`blink 1.2s ${i*0.2}s ease-in-out infinite`}}/>)}
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef}/>
              </div>

              {agent.statoProgetto&&(
                <div style={{padding:"6px 16px",borderTop:"1px solid #1A1A2E",background:"#0A0A14",flexShrink:0,display:"flex",alignItems:"center",gap:10}}>
                  <button onClick={saveSession} disabled={saveStatus==="generating"||saveStatus==="saving"||!conv.length} style={{padding:"7px 16px",borderRadius:8,border:`1px solid ${saveStatus==="success"?"#10B981":saveStatus==="error"?"#EF4444":"#1E2A1E"}`,background:saveStatus==="success"?"#10B98120":saveStatus==="error"?"#EF444420":"#0D1A0D",color:saveStatus==="success"?"#10B981":saveStatus==="error"?"#EF4444":!conv.length?"#2A2A3A":"#4ADE80",cursor:saveStatus==="generating"||saveStatus==="saving"||!conv.length?"not-allowed":"pointer",fontSize:12,fontWeight:600,opacity:!conv.length?0.4:1,display:"flex",alignItems:"center",gap:6}}>
                    <span>{saveStatus==="generating"?"⏳":saveStatus==="saving"?"☁️":saveStatus==="success"?"✅":saveStatus==="error"?"❌":"☁️"}</span>
                    <span>{saveStatus==="generating"?"Generando sommario...":saveStatus==="saving"?"Salvando su ClickUp...":saveStatus==="success"?"Sessione salvata!":saveStatus==="error"?"Errore — riprova":"Salva sessione su ClickUp"}</span>
                  </button>
                  {!conv.length&&<span style={{fontSize:11,color:"#334155"}}>Inizia una conversazione per salvare</span>}
                </div>
              )}

              {agent.quickReplies&&(
                <div style={{padding:"6px 16px 4px",display:"flex",gap:6,overflowX:"auto",flexShrink:0}}>
                  {agent.quickReplies.map(qr=>(
                    <button key={qr} onClick={()=>handleQuickReply(qr)} style={{padding:"5px 12px",borderRadius:20,border:`1px solid ${agent.color}40`,background:`${agent.color}10`,color:agent.color,fontSize:12,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>{qr}</button>
                  ))}
                </div>
              )}

              <div style={{padding:"10px 16px 12px",borderTop:"1px solid #1A1A2E",background:"#09090F",display:"flex",gap:8,alignItems:"flex-end",flexShrink:0}}>
                <textarea ref={textareaRef} value={input} onChange={handleTA} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}}} placeholder={`Scrivi a ${agent.name}...`} rows={1} style={{flex:1,padding:"9px 13px",borderRadius:10,border:"1px solid #1A1A2E",background:"#0F0F1A",color:"#E2E8F0",fontSize:fontSize,resize:"none",outline:"none",fontFamily:"inherit",lineHeight:1.5,maxHeight:120,overflowY:"auto"}}/>
                <button onClick={toggleListen} style={{width:40,height:40,borderRadius:10,border:`1.5px solid ${isListening?agent.color:"#1A1A2E"}`,background:isListening?`${agent.color}25`:"#0F0F1A",color:isListening?agent.color:"#475569",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{isListening?"⏹":"🎤"}</button>
                <button onClick={sendMessage} disabled={isLoading||!input.trim()} style={{width:40,height:40,borderRadius:10,border:"none",background:input.trim()&&!isLoading?agent.color:"#1A1A2E",color:input.trim()&&!isLoading?"#FFF":"#334155",cursor:input.trim()&&!isLoading?"pointer":"not-allowed",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontWeight:700}}>↑</button>
              </div>
            </>
          )}
        </div>
      </div>

      {isMobile&&(
        <>
          {/* Popup agenti espanso */}
          {mobileExpanded&&(
            <div style={{position:"fixed",inset:0,zIndex:98}} onClick={()=>setMobileExpanded(null)}/>
          )}
          {mobileExpanded&&(
            <div style={{position:"fixed",bottom:62,left:0,right:0,zIndex:99,padding:"0 8px"}}>
              <div style={{background:"#0F0F1A",border:"1px solid #1A1A2E",borderRadius:14,padding:8,display:"flex",gap:4,justifyContent:"center",flexWrap:"wrap",boxShadow:"0 -4px 20px #00000060"}}>
                {(mobileExpanded==="agenti"
                  ? [["bea","👑","Bea"],["carmine","💪","Carmine"],["vlad","📜","Vlad"],["bruno","💰","Bruno"],["virgilio","🌙","Virgilio"]]
                  : [["mario","📊","Mario"],["mimmo","📋","Mimmo"]]
                ).map(([id,icon,name])=>(
                  <button key={id} onClick={()=>{goToAgent(id);setMobileExpanded(null);}} style={{padding:"8px 14px",borderRadius:10,border:`1px solid ${view==="chat"&&activeAgent===id?AGENTS[id].color:"#1A1A2E"}`,background:view==="chat"&&activeAgent===id?`${AGENTS[id].color}20`:"transparent",color:view==="chat"&&activeAgent===id?AGENTS[id].color:"#94A3B8",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,minWidth:60}}>
                    <span style={{fontSize:20}}>{icon}</span>
                    <span style={{fontSize:9}}>{name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Bottom nav */}
          <div style={{display:"flex",background:"#0F0F1A",borderTop:"1px solid #1A1A2E",padding:"4px 2px",flexShrink:0,alignItems:"stretch",zIndex:100}}>
            {[
              {id:"home",  icon:"🏠", label:"Home",     action:()=>{setView("home");setMobileExpanded(null);}},
              {id:"finanze",icon:"💰",label:"Finanze",   action:()=>{setView("finanze");setMobileExpanded(null);}},
              {id:"iagrex",icon:"📊", label:"IAGREX",   action:()=>{setView("iagrex");setMobileExpanded(null);}},
              {id:"pipeline",icon:"🎯",label:"Pipeline",action:()=>{setView("pipeline");setMobileExpanded(null);}},
            ].map(item=>(
              <button key={item.id} onClick={item.action} style={{flex:1,padding:"6px 2px",borderRadius:8,border:"none",background:view===item.id?"#1A1A2E":"transparent",color:view===item.id?"#F8FAFC":"#475569",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                <span style={{fontSize:18}}>{item.icon}</span>
                <span style={{fontSize:8}}>{item.label}</span>
              </button>
            ))}
            <button onClick={()=>setMobileExpanded(p=>p==="agenti"?null:"agenti")} style={{flex:1,padding:"6px 2px",borderRadius:8,border:"none",background:mobileExpanded==="agenti"||(view==="chat"&&["bea","carmine","vlad","bruno","virgilio"].includes(activeAgent))?"#8B5CF620":"transparent",color:mobileExpanded==="agenti"||(view==="chat"&&["bea","carmine","vlad","bruno","virgilio"].includes(activeAgent))?"#8B5CF6":"#475569",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
              <span style={{fontSize:18}}>👥</span>
              <span style={{fontSize:8}}>Agenti</span>
            </button>
            <button onClick={()=>setMobileExpanded(p=>p==="iag"?null:"iag")} style={{flex:1,padding:"6px 2px",borderRadius:8,border:"none",background:mobileExpanded==="iag"||(view==="chat"&&["mario","mimmo"].includes(activeAgent))?"#3B82F620":"transparent",color:mobileExpanded==="iag"||(view==="chat"&&["mario","mimmo"].includes(activeAgent))?"#3B82F6":"#475569",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
              <span style={{fontSize:18}}>🏢</span>
              <span style={{fontSize:8}}>IAG</span>
            </button>
          </div>
        </>
      )}

      {showWeightModal&&(
        <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowWeightModal(false)}>
          <div style={{background:"#0F0F1A",border:"1px solid #1A1A2E",borderRadius:16,padding:24,width:"100%",maxWidth:320}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:14,fontWeight:700,color:"#F8FAFC",marginBottom:16}}>💪 Peso di oggi</div>
            <input
              autoFocus
              type="text"
              inputMode="decimal"
              placeholder="es. 102.5"
              value={weightInput}
              onChange={e=>setWeightInput(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter") saveWeightModal();}}
              style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #334155",background:"#09090F",color:"#E2E8F0",fontSize:18,outline:"none",marginBottom:12}}
            />
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowWeightModal(false)} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #1A1A2E",background:"transparent",color:"#475569",cursor:"pointer",fontSize:14}}>Annulla</button>
              <button onClick={saveWeightModal} style={{flex:1,padding:"10px",borderRadius:8,border:"none",background:"#F97316",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:700}}>Salva</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes blink{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1A1A2E;border-radius:2px}
        button:hover{filter:brightness(1.08)}
      `}</style>
    </div>
  );
}
