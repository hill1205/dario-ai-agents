"use client";
import { useState, useEffect, useMemo, useCallback } from "react";

// Pagina Abitudini — tracking per SINGOLA routine, non piu' solo il
// booleano "tutte fatte" dello streak in home.
//
// Da dove arrivano i dati: il cron notturno (/api/cron/reset), prima di
// azzerare le routine su ClickUp, salva lo snapshot del giorno appena
// finito su /api/habits. Quindi lo storico si riempie da solo, senza che
// Dario debba spuntare niente in un secondo posto. Il giorno IN CORSO
// invece non e' ancora stato snapshottato: lo calcoliamo qui in diretta da
// /api/tasks e lo salviamo, cosi' la griglia mostra oggi subito.
//
// Nota importante: lo storico parte dal giorno del deploy. I mesi
// precedenti sono vuoti per forza — il dato non esisteva.

const THEME_VARS = {
  dark:  { "--c-bg":"#09090F", "--c-panel":"#0F0F1A", "--c-panel2":"#0B0B16", "--c-border":"#1A1A2E", "--c-text-strong":"#F8FAFC", "--c-text":"#E2E8F0", "--c-text-dim":"#64748B", "--c-text-faint":"#475569", "--c-text-faintest":"#334155", "--c-text-muted":"#94A3B8" },
  light: { "--c-bg":"#F4F5F7", "--c-panel":"#FFFFFF", "--c-panel2":"#F1F2F5", "--c-border":"#E2E4E9", "--c-text-strong":"#0F172A", "--c-text":"#1A1A2E", "--c-text-dim":"#475569", "--c-text-faint":"#94A3B8", "--c-text-faintest":"#CBD5E1", "--c-text-muted":"#64748B" },
};

const ACCENT = "#F97316";
// Un colore per settimana come nel riferimento: serve a leggere la griglia
// "a blocchi" invece che come un muro unico di 31 colonne.
const WEEK_COLORS = ["#6366F1", "#06B6D4", "#EC4899", "#10B981", "#F59E0B", "#8B5CF6"];
const MESI = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const GG = ["Do","Lu","Ma","Me","Gi","Ve","Sa"];

const MOOD_FIELDS = [
  { key:"umore",       label:"Umore",       icon:"🙂", color:"#EC4899" },
  { key:"energia",     label:"Energia",     icon:"⚡", color:"#F59E0B" },
  { key:"motivazione", label:"Motivazione", icon:"🔥", color:"#10B981" },
];

const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
function todayBucharest() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Bucharest" });
}
// Colore semaforo sulla percentuale: sotto il 50% e' un problema, non una
// sfumatura. Deve saltare all'occhio senza doverlo leggere.
function pctColor(p) {
  if (p >= 80) return "#10B981";
  if (p >= 50) return "#F59E0B";
  return "#EF4444";
}

// Anello di completamento (le "ciambelle" per giorno della settimana).
function Ring({ pct, size = 46, label, sublabel, dim = false }) {
  const r = (size - 7) / 2;
  const c = 2 * Math.PI * r;
  const col = dim ? "var(--c-text-faintest)" : pctColor(pct);
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,minWidth:size}}>
      <div style={{position:"relative",width:size,height:size}}>
        <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--c-border)" strokeWidth={5}/>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={5}
            strokeDasharray={`${(c*pct)/100} ${c}`} strokeLinecap="round"/>
        </svg>
        <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size>40?11:9,fontWeight:700,color:col}}>
          {dim ? "–" : `${pct}%`}
        </div>
      </div>
      <div style={{fontSize:10,color:"var(--c-text-muted)",fontWeight:600}}>{label}</div>
      {sublabel && <div style={{fontSize:9,color:"var(--c-text-faintest)"}}>{sublabel}</div>}
    </div>
  );
}

export default function HabitsPage({ fontSize = 14, theme = "dark", isMobile = false }) {
  const fs = fontSize;
  const themeVars = THEME_VARS[theme] || THEME_VARS.dark;

  const [days, setDays]       = useState([]);   // storico abitudini
  const [mood, setMood]       = useState([]);   // storico mood
  const [loading, setLoading] = useState(true);
  const [errore, setErrore]   = useState(null);
  const [monthOffset, setMonthOffset] = useState(0); // 0 = mese corrente
  const [salvandoMood, setSalvandoMood] = useState(null);
  const [cellaInCorso, setCellaInCorso] = useState(null); // "data|abitudine"
  const [notaDraft, setNotaDraft] = useState(null);       // { data, testo }
  const [notaStato, setNotaStato] = useState(null);

  const oggi = todayBucharest();

  const load = useCallback(async () => {
    setLoading(true);
    setErrore(null);
    try {
      const [hRes, mRes] = await Promise.all([
        fetch("/api/habits", { cache:"no-store" }),
        fetch("/api/mood",   { cache:"no-store" }),
      ]);

      // Errore esplicito e non lista vuota: una griglia vuota per un
      // problema di rete si legge come "non hai fatto niente", ed e' il
      // tipo di bugia che rende inutile tutto il tracking.
      if (!hRes.ok) throw new Error("storico abitudini non raggiungibile");
      const h = await hRes.json();

      if (mRes.ok) setMood((await mRes.json()).days || []);

      // Il giorno in corso arriva gia' calcolato dal server: serve la lista
      // routine con include_closed=true, che /api/tasks non restituisce.
      setDays(h.days || []);
    } catch (e) {
      setErrore(e.message);
    }
    setLoading(false);
  }, [oggi]);

  useEffect(() => { load(); }, [load]);

  // ---- Mese selezionato -----------------------------------------------
  const { anno, mese, giorniMese, label } = useMemo(() => {
    const base = new Date();
    const d = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
    const y = d.getFullYear(), m = d.getMonth();
    return { anno:y, mese:m, giorniMese: new Date(y, m + 1, 0).getDate(), label: `${MESI[m]} ${y}` };
  }, [monthOffset]);

  const byDate = useMemo(() => new Map(days.map(d => [d.data, d])), [days]);

  // Abitudini del mese: unione delle routine attive nei giorni del mese.
  // Se il mese non ha ancora dati usiamo l'ultimo giorno disponibile in
  // assoluto, cosi' la griglia mostra comunque le righe giuste invece di
  // presentarsi vuota e sembrare rotta.
  const abitudini = useMemo(() => {
    const set = [];
    const push = (n) => { if (!set.includes(n)) set.push(n); };
    for (let g = giorniMese; g >= 1; g--) {
      const e = byDate.get(ymd(anno, mese, g));
      if (e) (e.all || []).forEach(push);
    }
    if (set.length === 0 && days.length > 0) (days[days.length-1].all || []).forEach(push);
    return set;
  }, [byDate, anno, mese, giorniMese, days]);

  // Un giorno "conta" solo se abbiamo davvero lo snapshot ed e' passato o
  // in corso: i giorni futuri non sono fallimenti.
  const giorniConDati = useMemo(() => {
    const out = [];
    for (let g = 1; g <= giorniMese; g++) {
      const data = ymd(anno, mese, g);
      if (data > oggi) break;
      if (byDate.has(data)) out.push(data);
    }
    return out;
  }, [byDate, anno, mese, giorniMese, oggi]);

  // Insieme delle abitudini strategiche (priorita' alta/urgente su ClickUp)
  // viste nel mese. Una routine puo' cambiare priorita': se e' stata
  // strategica anche un solo giorno la teniamo nel blocco alto, cosi' non
  // sparisce dalla vista importante da un giorno all'altro.
  const strategicheSet = useMemo(() => {
    const s = new Set();
    for (const d of days) (d.strategiche || []).forEach(n => s.add(n));
    return s;
  }, [days]);

  // Prima data con uno snapshot: oltre non si scende. Serve allo streak per
  // non contare come "buchi" i mesi in cui il tracking non esisteva.
  const primaData = useMemo(() => (days.length ? days[0].data : null), [days]);

  const gruppi = useMemo(() => ({
    strategiche: abitudini.filter(n => strategicheSet.has(n)),
    leggere:     abitudini.filter(n => !strategicheSet.has(n)),
  }), [abitudini, strategicheSet]);

  // Percentuale del giorno, calcolabile su tutte le abitudini o solo sulle
  // strategiche. Il totale unico mentiva: con 6 routine, saltare l'unica
  // che porta fatturato dava comunque un onesto "83%".
  const pctGiorno = useCallback((data, soloStrategiche = false) => {
    const e = byDate.get(data);
    if (!e || !e.all || e.all.length === 0) return null;
    const universo = soloStrategiche
      ? (e.all || []).filter(n => (e.strategiche || []).includes(n))
      : (e.all || []);
    if (universo.length === 0) return null;
    const fatti = universo.filter(n => (e.done || []).includes(n)).length;
    return Math.round((fatti / universo.length) * 100);
  }, [byDate]);

  // Streak per singola abitudine: giorni consecutivi fatti, contando
  // all'indietro da oggi (o da ieri, se oggi non e' ancora stata fatta —
  // una giornata in corso non deve azzerare la striscia).
  //
  // I giorni senza snapshot (deploy, cron fallito) NON spezzano la
  // striscia ma vengono contati a parte e mostrati: un buco di
  // infrastruttura non e' colpa tua, ma nemmeno un giorno che hai fatto.
  const streakDi = useCallback((nome) => {
    let count = 0, buchi = 0;
    const inizio = new Date(`${oggi}T12:00:00`);
    const e0 = byDate.get(oggi);
    // Se oggi l'abitudine e' attiva ma non ancora fatta, si parte da ieri.
    let i = (e0 && (e0.all || []).includes(nome) && !(e0.done || []).includes(nome)) ? 1 : 0;
    for (; i < 400; i++) {
      const d = new Date(inizio); d.setDate(inizio.getDate() - i);
      const data = ymd(d.getFullYear(), d.getMonth(), d.getDate());
      // Prima che il tracking esistesse non c'e' niente da giudicare.
      if (primaData && data < primaData) break;
      const e = byDate.get(data);
      if (!e) { buchi++; continue; }                // nessun dato: si salta
      if (!(e.all || []).includes(nome)) continue;  // non attiva quel giorno
      if ((e.done || []).includes(nome)) count++;
      else break;
    }
    return { count, buchi };
  }, [byDate, oggi, primaData]);

  // % per singola abitudine sul mese — la vista che dice quale abitudine
  // stai davvero tradendo, invece del solo totale aggregato.
  const perAbitudine = useMemo(() => {
    return abitudini.map(nome => {
      let attivi = 0, fatti = 0;
      for (const data of giorniConDati) {
        const e = byDate.get(data);
        if (!(e.all || []).includes(nome)) continue;
        attivi++;
        if ((e.done || []).includes(nome)) fatti++;
      }
      return {
        nome, attivi, fatti,
        pct: attivi ? Math.round((fatti/attivi)*100) : null,
        strategica: strategicheSet.has(nome),
        ...streakDi(nome),
      };
    }).sort((a,b) => {
      // Strategiche sempre in cima, poi le peggiori: e' li' che si interviene.
      if (a.strategica !== b.strategica) return a.strategica ? -1 : 1;
      return (a.pct ?? 999) - (b.pct ?? 999);
    });
  }, [abitudini, giorniConDati, byDate, strategicheSet, streakDi]);

  const kpi = useMemo(() => {
    let fatti = 0, totali = 0, sFatti = 0, sTotali = 0;
    for (const data of giorniConDati) {
      const e = byDate.get(data);
      for (const n of (e.all || [])) {
        const done = (e.done || []).includes(n);
        totali++; if (done) fatti++;
        if ((e.strategiche || []).includes(n)) { sTotali++; if (done) sFatti++; }
      }
    }
    return {
      pct: totali ? Math.round((fatti/totali)*100) : 0,
      pctStrategiche: sTotali ? Math.round((sFatti/sTotali)*100) : null,
      fatti, totali, sFatti, sTotali,
      giorniPieni: giorniConDati.filter(d => pctGiorno(d) === 100).length,
      giorniTracciati: giorniConDati.length,
    };
  }, [giorniConDati, byDate, pctGiorno]);

  // ---- Azioni ---------------------------------------------------------
  // Correzione di una cella. Per OGGI il server tocca ClickUp (altrimenti
  // il ricalcolo del giorno in corso cancellerebbe la modifica); per i
  // giorni passati scrive solo nello storico, perche' su ClickUp quelle
  // task sono gia' state azzerate dal cron e non esistono piu'.
  const toggleCella = async (data, abitudine) => {
    if (data > oggi) return;
    const chiave = `${data}|${abitudine}`;
    if (cellaInCorso) return;
    setCellaInCorso(chiave);

    // Aggiornamento ottimistico: la griglia deve rispondere al tocco
    // subito, non dopo il giro su ClickUp.
    setDays(prev => prev.map(d => {
      if (d.data !== data || !(d.all || []).includes(abitudine)) return d;
      const done = new Set(d.done || []);
      done.has(abitudine) ? done.delete(abitudine) : done.add(abitudine);
      return { ...d, done: [...done] };
    }));

    try {
      const res = await fetch("/api/habits", {
        method:"PATCH", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ azione:"toggle", data, abitudine }),
      });
      const out = await res.json();
      if (!res.ok || out.success === false) { setErrore(out.motivo || out.error || "correzione non salvata"); await load(); }
    } catch { setErrore("correzione non salvata"); await load(); }
    setCellaInCorso(null);
  };

  const salvaNota = async (data, testo) => {
    setNotaStato("salvo");
    setDays(prev => {
      const esiste = prev.some(d => d.data === data);
      return esiste ? prev.map(d => d.data===data ? {...d, nota:testo} : d)
                    : [...prev, { data, done:[], all:[], strategiche:[], nota:testo }].sort((a,b)=>(a.data<b.data?-1:1));
    });
    try {
      await fetch("/api/habits", { method:"PATCH", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ azione:"nota", data, nota:testo }) });
      setNotaStato("ok");
    } catch { setNotaStato("errore"); }
    setTimeout(()=>setNotaStato(null), 1500);
  };

  // ---- Settimana corrente (anelli) ------------------------------------
  const settimana = useMemo(() => {
    const out = [];
    const t = new Date(`${oggi}T12:00:00`);
    const dow = t.getDay(); // 0 = domenica
    const inizio = new Date(t); inizio.setDate(t.getDate() - dow);
    for (let i = 0; i < 7; i++) {
      const d = new Date(inizio); d.setDate(inizio.getDate() + i);
      const data = ymd(d.getFullYear(), d.getMonth(), d.getDate());
      out.push({ data, giorno: GG[d.getDay()], num: d.getDate(), pct: pctGiorno(data), futuro: data > oggi });
    }
    return out;
  }, [oggi, pctGiorno]);

  // ---- Mood -----------------------------------------------------------
  const moodByDate = useMemo(() => new Map(mood.map(m => [m.data, m])), [mood]);
  const moodOggi = moodByDate.get(oggi) || {};

  const setMoodValue = async (key, value) => {
    setSalvandoMood(key);
    setMood(prev => {
      const altri = prev.filter(m => m.data !== oggi);
      return [...altri, { ...(prev.find(m=>m.data===oggi) || { data: oggi }), [key]: value }]
        .sort((a,b) => (a.data < b.data ? -1 : 1));
    });
    try {
      await fetch("/api/mood", { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ data: oggi, [key]: value }) });
    } catch {}
    setSalvandoMood(null);
  };

  const ultimi14 = useMemo(() => {
    const out = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(`${oggi}T12:00:00`); d.setDate(d.getDate() - i);
      const data = ymd(d.getFullYear(), d.getMonth(), d.getDate());
      out.push({ data, num: d.getDate(), giorno: GG[d.getDay()], m: moodByDate.get(data) || null, pct: pctGiorno(data) });
    }
    return out;
  }, [oggi, moodByDate, pctGiorno]);

  // L'unico motivo serio per tracciare l'energia: capire se i giorni in cui
  // esegui sono quelli in cui stai bene. Senza questo incrocio il mood e'
  // un diario che si smette di compilare dopo cinque giorni.
  const correlazione = useMemo(() => {
    const alta = [], bassa = [];
    for (const m of mood) {
      const p = pctGiorno(m.data);
      if (p === null || m.energia === undefined) continue;
      if (m.energia >= 4) alta.push(p);
      else if (m.energia <= 2) bassa.push(p);
    }
    const media = (a) => a.length ? Math.round(a.reduce((s,v)=>s+v,0)/a.length) : null;
    return { alta: media(alta), nAlta: alta.length, bassa: media(bassa), nBassa: bassa.length };
  }, [mood, pctGiorno]);

  // ---- Render ---------------------------------------------------------
  const Card = ({ title, subtitle, children }) => (
    <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:11,padding:14,marginBottom:12}}>
      <div style={{fontSize:fs-2,fontWeight:700,color:"var(--c-text-strong)",marginBottom:subtitle?2:10}}>{title}</div>
      {subtitle && <div style={{fontSize:fs-5,color:"var(--c-text-faint)",marginBottom:10}}>{subtitle}</div>}
      {children}
    </div>
  );

  const cellW = 22, cellH = 20, nomeW = isMobile ? 108 : 150;

  return (
    <div style={{...themeVars,display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",background:"var(--c-bg)"}}>

      {/* HEADER */}
      <div style={{padding:"12px 16px",borderBottom:"1px solid var(--c-border)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
          <div style={{fontWeight:700,fontSize:15,color:"var(--c-text-strong)"}}>✅ Abitudini</div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <button onClick={()=>setMonthOffset(o=>o-1)} style={{padding:"3px 9px",borderRadius:6,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-muted)",cursor:"pointer",fontSize:12}}>‹</button>
            <div style={{fontSize:fs-3,fontWeight:600,color:"var(--c-text)",minWidth:96,textAlign:"center"}}>{label}</div>
            <button onClick={()=>setMonthOffset(o=>Math.min(0,o+1))} disabled={monthOffset>=0}
              style={{padding:"3px 9px",borderRadius:6,border:"1px solid var(--c-border)",background:"transparent",color:monthOffset>=0?"var(--c-text-faintest)":"var(--c-text-muted)",cursor:monthOffset>=0?"not-allowed":"pointer",fontSize:12}}>›</button>
            <button onClick={load} style={{padding:"3px 9px",borderRadius:6,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:11}}>{loading?"⏳":"↻"}</button>
          </div>
        </div>
        <div style={{display:"flex",gap:14,marginTop:8,flexWrap:"wrap",fontSize:fs-4,color:"var(--c-text-dim)"}}>
          {/* Le strategiche per prime e in evidenza: è il numero che conta
              davvero, il totale può nasconderlo dietro le routine leggere. */}
          {kpi.pctStrategiche !== null && (
            <span style={{color:ACCENT,fontWeight:600}}>
              ⚡ <b style={{color:pctColor(kpi.pctStrategiche),fontSize:fs}}>{kpi.pctStrategiche}%</b> strategiche
              <span style={{color:"var(--c-text-faintest)",fontWeight:400}}> {kpi.sFatti}/{kpi.sTotali}</span>
            </span>
          )}
          <span><b style={{color:pctColor(kpi.pct),fontSize:fs-1}}>{kpi.pct}%</b> totale</span>
          <span><b style={{color:"#10B981"}}>{kpi.giorniPieni}</b> giorni pieni</span>
          <span><b style={{color:"var(--c-text)"}}>{abitudini.length}</b> abitudini</span>
        </div>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:14}}>

        {errore && (
          <div style={{background:"#EF444415",border:"1px solid #EF444440",borderRadius:9,padding:12,marginBottom:12,fontSize:fs-3,color:"#EF4444"}}>
            ⚠️ {errore}. I dati mostrati potrebbero essere incompleti — non fidarti delle percentuali finché non si ricarica.
          </div>
        )}

        {/* CHECK-IN MOOD */}
        <Card title="Come stai oggi?" subtitle="Tre tap. Serve a capire se i giorni in cui esegui sono quelli in cui stai bene.">
          {MOOD_FIELDS.map(f => (
            <div key={f.key} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <div style={{fontSize:fs-3,color:"var(--c-text-muted)",width:isMobile?96:112,flexShrink:0}}>
                {f.icon} {f.label}
              </div>
              <div style={{display:"flex",gap:5,flex:1}}>
                {[1,2,3,4,5].map(v => {
                  const on = moodOggi[f.key] === v;
                  return (
                    <button key={v} onClick={()=>setMoodValue(f.key, v)} disabled={salvandoMood===f.key}
                      style={{flex:1,padding:"6px 0",borderRadius:7,cursor:"pointer",fontSize:fs-3,fontWeight:700,
                        border:`1px solid ${on?f.color:"var(--c-border)"}`,
                        background:on?`${f.color}25`:"transparent",
                        color:on?f.color:"var(--c-text-faint)"}}>
                      {v}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {correlazione.alta !== null && correlazione.bassa !== null && (
            <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid var(--c-border)",fontSize:fs-4,color:"var(--c-text-dim)",lineHeight:1.5}}>
              Nei giorni di <b style={{color:"#10B981"}}>energia alta</b> completi il <b style={{color:"#10B981"}}>{correlazione.alta}%</b> delle routine ({correlazione.nAlta} gg) ·
              con <b style={{color:"#EF4444"}}>energia bassa</b> il <b style={{color:"#EF4444"}}>{correlazione.bassa}%</b> ({correlazione.nBassa} gg).
            </div>
          )}
        </Card>

        {/* ANELLI SETTIMANA */}
        <Card title="Questa settimana">
          <div style={{display:"flex",justifyContent:"space-between",gap:4,overflowX:"auto",paddingBottom:2}}>
            {settimana.map(d => (
              <Ring key={d.data} pct={d.pct ?? 0} dim={d.pct===null} size={isMobile?42:50}
                label={d.giorno} sublabel={`${d.num}/${pad(new Date(`${d.data}T12:00:00`).getMonth()+1)}`}/>
            ))}
          </div>
        </Card>

        {/* GRIGLIA MENSILE */}
        <Card title={`Griglia ${label}`} subtitle={giorniConDati.length===0 ? "Nessuno snapshot per questo mese — lo storico parte dal giorno di attivazione." : `${giorniConDati.length} giorni tracciati`}>
          <div style={{overflowX:"auto"}}>
            <div style={{display:"inline-block",minWidth:"100%"}}>
              {/* riga numeri giorno, colorata per settimana */}
              <div style={{display:"flex",marginBottom:3}}>
                <div style={{width:nomeW,flexShrink:0}}/>
                {Array.from({length:giorniMese},(_,i)=>i+1).map(g => {
                  const wk = Math.floor((g-1)/7);
                  const data = ymd(anno,mese,g);
                  return (
                    <div key={g} style={{width:cellW,flexShrink:0,textAlign:"center",fontSize:8,fontWeight:700,
                      color:data===oggi?ACCENT:WEEK_COLORS[wk%WEEK_COLORS.length]}}>{g}</div>
                  );
                })}
              </div>
              {abitudini.length===0 && (
                <div style={{fontSize:fs-3,color:"var(--c-text-faintest)",padding:"16px 0"}}>Nessuna abitudine trovata.</div>
              )}

              {/* Due blocchi separati: le strategiche non devono essere
                  diluite dalle routine di servizio. Con un totale unico,
                  saltare l'unica cosa che porta fatturato dava comunque un
                  onesto "83%". */}
              {[
                { titolo:"⚡ Strategiche", nomi:gruppi.strategiche, colore:ACCENT, soloStrat:true },
                { titolo:"· Routine leggera", nomi:gruppi.leggere,  colore:"var(--c-text-faint)", soloStrat:false },
              ].map(sezione => sezione.nomi.length === 0 ? null : (
                <div key={sezione.titolo} style={{marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,margin:"8px 0 4px"}}>
                    <div style={{width:nomeW,flexShrink:0,fontSize:fs-5,fontWeight:700,color:sezione.colore,
                      whiteSpace:"nowrap",overflow:"hidden"}}>{sezione.titolo}</div>
                  </div>
                  {sezione.nomi.map(nome => {
                    const st = streakDi(nome);
                    return (
                    <div key={nome} style={{display:"flex",alignItems:"center",marginBottom:2}}>
                      <div title={nome} style={{width:nomeW,flexShrink:0,fontSize:fs-5,color:"var(--c-text)",paddingRight:6,
                        display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap",overflow:"hidden"}}>
                        <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{nome}</span>
                        {st.count > 0 && (
                          <span title={st.buchi ? `${st.buchi} giorni senza dati nel periodo` : "giorni consecutivi"}
                            style={{flexShrink:0,fontSize:8,fontWeight:700,color:"#F97316",background:"#F9731618",
                              padding:"1px 4px",borderRadius:5}}>
                            🔥{st.count}{st.buchi ? "*" : ""}
                          </span>
                        )}
                      </div>
                      {Array.from({length:giorniMese},(_,i)=>i+1).map(g => {
                        const data = ymd(anno,mese,g);
                        const e = byDate.get(data);
                        const futuro = data > oggi;
                        const attiva = e && (e.all||[]).includes(nome);
                        const fatta  = attiva && (e.done||[]).includes(nome);
                        const inCorso = cellaInCorso === `${data}|${nome}`;
                        let bg = "transparent", bd = "var(--c-border)", txt = "";
                        if (futuro)        { bd = "var(--c-border)"; }
                        else if (!e)       { bd = "var(--c-border)"; }
                        else if (!attiva)  { bd = "var(--c-border)"; txt = "–"; }
                        // Spunta sempre verde, non del colore della settimana:
                        // "fatta" deve leggersi a colpo d'occhio come stato,
                        // non cambiare significato a seconda della colonna.
                        else if (fatta)    { bg = "#10B98125"; bd = "#10B981"; txt = "✓"; }
                        else               { bg = "#EF444415"; bd = "#EF444450"; txt = "×"; }
                        const cliccabile = attiva && !futuro;
                        return (
                          <div key={g} title={cliccabile ? `${nome} — ${data} (clicca per correggere)` : `${nome} — ${data}`}
                            onClick={cliccabile ? ()=>toggleCella(data, nome) : undefined}
                            style={{width:cellW,height:cellH,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                              padding:1,cursor:cliccabile?"pointer":"default",opacity:inCorso?0.45:1}}>
                            <div style={{width:"100%",height:"100%",borderRadius:4,border:`1px solid ${bd}`,background:bg,
                              display:"flex",alignItems:"center",justifyContent:"center",
                              fontSize:10,fontWeight:700,color:txt==="✓"?"#10B981":txt==="×"?"#EF4444":"var(--c-text-faintest)",
                              outline:data===oggi?`1px solid ${ACCENT}`:"none"}}>{txt}</div>
                          </div>
                        );
                      })}
                    </div>
                    );
                  })}
                  {/* percentuale della sezione, giorno per giorno */}
                  <div style={{display:"flex",alignItems:"center",marginTop:3}}>
                    <div style={{width:nomeW,flexShrink:0,fontSize:8,fontWeight:700,color:sezione.colore}}>
                      {sezione.soloStrat ? "% strategiche" : "% leggera"}
                    </div>
                    {Array.from({length:giorniMese},(_,i)=>i+1).map(g => {
                      const data = ymd(anno,mese,g);
                      const e = byDate.get(data);
                      let p = null;
                      if (e) {
                        const universo = (e.all||[]).filter(n => sezione.nomi.includes(n));
                        if (universo.length) p = Math.round(universo.filter(n=>(e.done||[]).includes(n)).length / universo.length * 100);
                      }
                      return (
                        <div key={g} style={{width:cellW,flexShrink:0,textAlign:"center",fontSize:8,fontWeight:700,
                          color:p===null?"var(--c-text-faintest)":pctColor(p)}}>{p===null?"·":p}</div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* riga percentuale complessiva */}
              <div style={{display:"flex",alignItems:"center",marginTop:6,paddingTop:6,borderTop:"1px solid var(--c-border)"}}>
                <div style={{width:nomeW,flexShrink:0,fontSize:fs-5,fontWeight:700,color:"var(--c-text-muted)"}}>% totale</div>
                {Array.from({length:giorniMese},(_,i)=>i+1).map(g => {
                  const p = pctGiorno(ymd(anno,mese,g));
                  return (
                    <div key={g} style={{width:cellW,flexShrink:0,textAlign:"center",fontSize:8,fontWeight:700,
                      color:p===null?"var(--c-text-faintest)":pctColor(p)}}>{p===null?"·":p}</div>
                  );
                })}
              </div>
            </div>
          </div>
          <div style={{display:"flex",gap:12,marginTop:10,fontSize:9,color:"var(--c-text-faint)",flexWrap:"wrap"}}>
            <span style={{color:"#10B981"}}>✓ fatta</span><span style={{color:"#EF4444"}}>× saltata</span><span>– non attiva quel giorno</span><span>(vuoto) nessun dato</span>
            <span style={{color:"#F97316"}}>🔥 giorni consecutivi</span><span>* la striscia attraversa giorni senza dati</span>
          </div>
          <div style={{marginTop:6,fontSize:9,color:"var(--c-text-faintest)"}}>
            Clicca una cella per correggerla. Su oggi la correzione va anche su ClickUp; sui giorni passati resta solo nello storico (su ClickUp quelle task sono già state azzerate).
          </div>
        </Card>

        {/* NOTA DEL GIORNO */}
        <Card title="Nota del giorno" subtitle="Perché hai saltato, cosa è andato storto. Dopo una settimana i pattern si vedono da soli.">
          <textarea rows={2} placeholder="Es. saltato outreach: riunione lunga con cliente"
            value={notaDraft?.data === oggi ? notaDraft.testo : (byDate.get(oggi)?.nota || "")}
            onChange={e=>setNotaDraft({ data: oggi, testo: e.target.value })}
            onBlur={()=>{ if (notaDraft?.data === oggi) salvaNota(oggi, notaDraft.testo); }}
            style={{width:"100%",padding:"9px 11px",borderRadius:8,border:"1px solid var(--c-border)",background:"var(--c-panel2)",
              color:"var(--c-text)",fontSize:fs-3,outline:"none",resize:"vertical",fontFamily:"inherit"}}/>
          <div style={{fontSize:9,color:"var(--c-text-faintest)",marginTop:4,height:12}}>
            {notaStato==="salvo" ? "salvo..." : notaStato==="ok" ? "✓ salvata" : notaStato==="errore" ? "⚠️ non salvata" : "Si salva da sola quando esci dal campo."}
          </div>

          {/* Note passate: la lettura in fila è il punto di tutta la feature */}
          {days.filter(d=>d.nota && d.data!==oggi).slice(-10).reverse().map(d => (
            <div key={d.data} style={{display:"flex",gap:8,marginTop:8,paddingTop:8,borderTop:"1px solid var(--c-border)"}}>
              <div style={{flexShrink:0,fontSize:9,color:"var(--c-text-faint)",width:64,paddingTop:1}}>
                {GG[new Date(`${d.data}T12:00:00`).getDay()]} {d.data.slice(8)}/{d.data.slice(5,7)}
              </div>
              <div style={{fontSize:fs-4,color:"var(--c-text)",lineHeight:1.4,flex:1}}>{d.nota}</div>
              <div style={{flexShrink:0,fontSize:9,fontWeight:700,color:pctGiorno(d.data)===null?"var(--c-text-faintest)":pctColor(pctGiorno(d.data))}}>
                {pctGiorno(d.data)===null?"·":`${pctGiorno(d.data)}%`}
              </div>
            </div>
          ))}
        </Card>

        {/* % PER ABITUDINE */}
        <Card title="Quali stai tradendo" subtitle="Strategiche in cima (⚡ = priorità alta su ClickUp), poi le peggiori. 🔥 = giorni consecutivi.">
          {perAbitudine.length===0 && <div style={{fontSize:fs-3,color:"var(--c-text-faintest)"}}>Ancora nessun dato per questo mese.</div>}
          {perAbitudine.map(h => (
            <div key={h.nome} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
              <div title={h.nome} style={{width:isMobile?106:168,flexShrink:0,fontSize:fs-4,color:"var(--c-text)",
                display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap",overflow:"hidden"}}>
                {h.strategica && <span title="Priorità alta su ClickUp" style={{flexShrink:0,color:ACCENT}}>⚡</span>}
                <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{h.nome}</span>
              </div>
              {/* Lo streak accanto alla barra: la % dice come sei andato, la
                  striscia dice cosa hai da perdere. La seconda motiva di più. */}
              <div style={{width:44,flexShrink:0,textAlign:"center",fontSize:fs-4,fontWeight:700,
                color:h.count>0?"#F97316":"var(--c-text-faintest)"}}
                title={h.count>0 ? `${h.count} giorni consecutivi${h.buchi?` (${h.buchi} senza dati nel mezzo)`:""}` : "striscia interrotta"}>
                {h.count>0 ? `🔥${h.count}${h.buchi?"*":""}` : "–"}
              </div>
              <div style={{flex:1,height:16,background:"var(--c-panel2)",borderRadius:4,overflow:"hidden",border:"1px solid var(--c-border)"}}>
                <div style={{width:`${h.pct ?? 0}%`,height:"100%",background:pctColor(h.pct ?? 0),borderRadius:3,transition:"width .3s"}}/>
              </div>
              <div style={{width:70,flexShrink:0,textAlign:"right",fontSize:fs-4,fontWeight:700,color:pctColor(h.pct ?? 0)}}>
                {h.pct===null ? "–" : `${h.pct}%`}
                <span style={{color:"var(--c-text-faintest)",fontWeight:400,fontSize:fs-6}}> {h.fatti}/{h.attivi}</span>
              </div>
            </div>
          ))}
        </Card>

        {/* TREND GIORNALIERO */}
        <Card title="Andamento del mese" subtitle="Percentuale di routine completate, giorno per giorno.">
          <div style={{overflowX:"auto"}}>
            <div style={{display:"flex",alignItems:"flex-end",gap:2,height:120,minWidth:giorniMese*18}}>
              {Array.from({length:giorniMese},(_,i)=>i+1).map(g => {
                const data = ymd(anno,mese,g);
                const p = pctGiorno(data);
                const wk = WEEK_COLORS[Math.floor((g-1)/7)%WEEK_COLORS.length];
                return (
                  <div key={g} style={{flex:1,minWidth:16,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                    <div style={{fontSize:8,fontWeight:700,color:p===null?"var(--c-text-faintest)":pctColor(p),height:10}}>
                      {p===null?"":p}
                    </div>
                    <div style={{width:"100%",height:80,display:"flex",alignItems:"flex-end"}}>
                      <div style={{width:"100%",height:`${p ?? 0}%`,minHeight:p===null?0:2,
                        background:p===null?"transparent":wk,borderRadius:"3px 3px 0 0",
                        border:p===null?"1px dashed var(--c-border)":"none",
                        boxSizing:"border-box",transition:"height .3s"}}/>
                    </div>
                    <div style={{fontSize:8,color:data===oggi?ACCENT:"var(--c-text-faintest)",fontWeight:data===oggi?700:400}}>{g}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        {/* MOOD ULTIMI 14 GIORNI */}
        <Card title="Umore · Energia · Motivazione" subtitle="Ultimi 14 giorni, con sotto la percentuale di routine di quel giorno.">
          <div style={{overflowX:"auto"}}>
            <div style={{display:"flex",gap:6,minWidth:14*34}}>
              {ultimi14.map(d => (
                <div key={d.data} style={{flex:1,minWidth:30,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                  <div style={{display:"flex",alignItems:"flex-end",gap:2,height:56}}>
                    {MOOD_FIELDS.map(f => {
                      const v = d.m?.[f.key];
                      return (
                        <div key={f.key} title={`${f.label}: ${v ?? "–"}`}
                          style={{width:7,height:v?`${(v/5)*100}%`:2,background:v?f.color:"var(--c-border)",borderRadius:2}}/>
                      );
                    })}
                  </div>
                  <div style={{fontSize:8,color:"var(--c-text-muted)",fontWeight:600}}>
                    {d.m ? MOOD_FIELDS.map(f=>d.m[f.key] ?? "–").join("·") : "–"}
                  </div>
                  <div style={{fontSize:8,fontWeight:700,color:d.pct===null?"var(--c-text-faintest)":pctColor(d.pct)}}>
                    {d.pct===null?"·":`${d.pct}%`}
                  </div>
                  <div style={{fontSize:8,color:d.data===oggi?ACCENT:"var(--c-text-faintest)",fontWeight:d.data===oggi?700:400}}>
                    {d.giorno} {d.num}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{display:"flex",gap:12,marginTop:8,fontSize:9,color:"var(--c-text-faint)"}}>
            {MOOD_FIELDS.map(f => (
              <span key={f.key} style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{width:7,height:7,borderRadius:2,background:f.color,display:"inline-block"}}/>{f.label}
              </span>
            ))}
          </div>
        </Card>

        <div style={{height:20}}/>
      </div>

      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width:3px; height:3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--c-border); border-radius: 2px; }
        button:hover:not(:disabled) { filter: brightness(1.12); }
      `}</style>
    </div>
  );
}
