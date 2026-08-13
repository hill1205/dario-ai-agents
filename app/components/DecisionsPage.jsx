"use client";
import { useState, useEffect, useCallback, useMemo } from "react";

// REGISTRO DECISIONI
//
// Sostituisce la pagina "Idee" (rimossa il 07/08, mai usata). L'inversione
// è voluta: le Idee catturavano pensieri senza costo e senza seguito, e per
// questo si accumulavano senza essere mai riguardate. Qui il costo di
// scrittura è alto di proposito — dieci campi — e in cambio ogni voce ha
// almeno una data in cui torna a chiedere conto di sé.
//
// Due tempi:
//   1. la decisione, scritta PRIMA di sapere com'è andata (si congela dopo
//      24 ore: vedi lib/decisions-store.js);
//   2. fino a tre revisioni, ognuna con la sua data e il suo focus.
//
// Tre revisioni e non una perché non tutte le decisioni maturano allo
// stesso ritmo: "comprare la macchina" si giudica una volta, "iscrivermi in
// palestra" a un mese dice solo se hai continuato, a sei mesi si vede il
// corpo, a un anno sai se è servito.
//
// I componenti di supporto stanno a livello di modulo e non dentro
// DecisionsPage: definire un componente dentro un altro lo fa rimontare a
// ogni render, azzerando scroll e focus — già successo su questa app, e in
// una pagina fatta di textarea lunghe sarebbe insopportabile.

const THEME_VARS = {
  dark:  { "--c-bg":"#09090F", "--c-panel":"#0F0F1A", "--c-panel2":"#0B0B16", "--c-border":"#1A1A2E", "--c-text-strong":"#F8FAFC", "--c-text":"#E2E8F0", "--c-text-dim":"#64748B", "--c-text-faint":"#475569", "--c-text-faintest":"#334155", "--c-text-muted":"#94A3B8" },
  light: { "--c-bg":"#F4F5F7", "--c-panel":"#FFFFFF", "--c-panel2":"#F1F2F5", "--c-border":"#E2E4E9", "--c-text-strong":"#0F172A", "--c-text":"#1A1A2E", "--c-text-dim":"#475569", "--c-text-faint":"#94A3B8", "--c-text-faintest":"#CBD5E1", "--c-text-muted":"#64748B" },
};

const VIOLA = "#8B5CF6";
const VERDE = "#10B981";
const ROSSO = "#EF4444";
const AMBRA = "#F59E0B";
const BLU   = "#3B82F6";

const ORDINALI = ["Prima", "Seconda", "Terza"];

const AMBITI = [
  { id:"business",  label:"💼 Business",  color:BLU },
  { id:"personale", label:"🏠 Personale", color:AMBRA },
];
const ambitoInfo = (a) => AMBITI.find(x=>x.id===a) || AMBITI[0];

const RIFARESTI = [
  { id:"si",      label:"✅ Sì, la rifarei",  color:VERDE },
  { id:"in-parte",label:"🤔 In parte",        color:AMBRA },
  { id:"no",      label:"❌ No",              color:ROSSO },
];
const rifarestiInfo = (r) => RIFARESTI.find(x=>x.id===r) || RIFARESTI[1];

// La fiducia è un numero da 1 a 10, ma quello che conta al momento della
// revisione non è il numero: è l'etichetta. "Ero sicuro" e poi è andata
// male è un dato diverso da "tiravo a indovinare" e poi è andata male.
function fiduciaLabel(n) {
  if (n >= 9) return { txt:"Praticamente certo", color:VERDE };
  if (n >= 7) return { txt:"Abbastanza convinto", color:"#84CC16" };
  if (n >= 5) return { txt:"Più sì che no", color:AMBRA };
  if (n >= 3) return { txt:"Molto incerto", color:"#F97316" };
  return { txt:"Sto tirando a indovinare", color:ROSSO };
}

const oggiISO = () =>
  new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Bucharest",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());

function dataFraGiorni(giorni) {
  const d = new Date(`${oggiISO()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + giorni);
  return d.toISOString().slice(0,10);
}
function formattaData(iso) {
  if (!iso) return "—";
  const [a,m,g] = iso.split("-");
  return `${g}/${m}/${a}`;
}
function giorniDa(iso) {
  if (!iso) return null;
  return Math.round((new Date(`${iso}T12:00:00Z`) - new Date(`${oggiISO()}T12:00:00Z`)) / 86400000);
}

// Scorciatoie per le date. Esistono perché il campo data è l'attrito
// principale del form: se devi aprire un calendario e contare i mesi,
// finisci per lasciarlo vuoto. I default per riga (1 mese / 6 mesi / 1
// anno) sono presi dal caso d'uso tipico — "ho continuato?", "si vedono
// cambiamenti?", "è servito?".
const PRESET = [
  { label:"1 sett", giorni:7   },
  { label:"1 mese", giorni:30  },
  { label:"3 mesi", giorni:90  },
  { label:"6 mesi", giorni:182 },
  { label:"1 anno", giorni:365 },
];
const PRESET_DEFAULT = [30, 182, 365];

// Suggerimenti di focus, uno per riga, ispirati alla progressione naturale:
// prima verifichi che sia stato fatto, poi che stia cambiando qualcosa,
// poi che sia servito.
const FOCUS_PLACEHOLDER = [
  "Es. ho continuato o ho mollato dopo due settimane?",
  "Es. si vedono cambiamenti concreti?",
  "Es. col senno di poi mi ha portato benefici veri?",
];

const BOZZA_VUOTA = {
  titolo:"", contesto:"", obiettivo:"", alternative:"", decisione:"",
  motivazione:"", fiducia:7, rischi:"", ambito:"business",
  data:"", revisioni:[{data:"",focus:""},{data:"",focus:""},{data:"",focus:""}],
};
const ESITO_VUOTO = {
  rifaresti:"in-parte", previsto:"", sottovalutato:"",
  risultato:"", imparato:"", diverso:"",
};

// ── Campi riutilizzabili ────────────────────────────────────────────────

function Campo({ label, aiuto, children }) {
  return (
    <div style={{marginBottom:14}}>
      <div style={{fontSize:11,fontWeight:700,color:"var(--c-text-muted)",marginBottom:4,textTransform:"uppercase",letterSpacing:.4}}>{label}</div>
      {aiuto && <div style={{fontSize:11,color:"var(--c-text-faint)",marginBottom:6,lineHeight:1.4}}>{aiuto}</div>}
      {children}
    </div>
  );
}

const inputStyle = {
  width:"100%", padding:"9px 11px", borderRadius:8,
  border:"1px solid var(--c-border)", background:"var(--c-panel2)",
  color:"var(--c-text)", fontSize:13, outline:"none",
  fontFamily:"inherit", resize:"vertical",
};

function AreaTesto({ value, onChange, placeholder, rows=3 }) {
  return (
    <textarea rows={rows} value={value} placeholder={placeholder}
      onChange={e=>onChange(e.target.value)} style={inputStyle}/>
  );
}

function Riga({ etichetta, testo }) {
  if (!testo) return null;
  return (
    <div style={{marginBottom:10}}>
      <div style={{fontSize:10,fontWeight:700,color:"var(--c-text-faint)",textTransform:"uppercase",letterSpacing:.4,marginBottom:2}}>{etichetta}</div>
      <div style={{fontSize:13,color:"var(--c-text)",lineHeight:1.5,whiteSpace:"pre-wrap"}}>{testo}</div>
    </div>
  );
}

// ── Una riga "data + focus" nel form della decisione ────────────────────

function RigaRevisione({ indice, valore, onChange, obbligatoria }) {
  const set = (k) => (v) => onChange({...valore, [k]:v});
  const attiva = Boolean(valore.data);

  return (
    <div style={{
      background:"var(--c-panel2)", borderRadius:9, padding:11, marginBottom:8,
      border:`1px solid ${attiva ? (obbligatoria?`${VIOLA}40`:"var(--c-border)") : "var(--c-border)"}`,
      opacity: attiva || obbligatoria ? 1 : .75,
    }}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:8,flexWrap:"wrap"}}>
        <span style={{fontSize:11,fontWeight:700,color:attiva?"var(--c-text-muted)":"var(--c-text-faint)"}}>
          {ORDINALI[indice]} revisione {obbligatoria
            ? <span style={{color:VIOLA}}>· obbligatoria</span>
            : <span style={{color:"var(--c-text-faintest)"}}>· facoltativa</span>}
        </span>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {PRESET.map(p=>{
            const val = dataFraGiorni(p.giorni);
            const sel = valore.data===val;
            return (
              <button key={p.label} onClick={()=>set("data")(sel?"":val)}
                style={{padding:"3px 8px",borderRadius:6,cursor:"pointer",fontSize:10,fontWeight:600,
                  border:`1px solid ${sel?VIOLA:"var(--c-border)"}`,
                  background:sel?`${VIOLA}18`:"transparent",
                  color:sel?VIOLA:"var(--c-text-faint)"}}>
                {p.label}
              </button>
            );
          })}
          {valore.data && !obbligatoria && (
            <button onClick={()=>onChange({data:"",focus:""})}
              style={{padding:"3px 8px",borderRadius:6,cursor:"pointer",fontSize:10,border:"1px solid var(--c-border)",background:"transparent",color:ROSSO}}>
              rimuovi
            </button>
          )}
        </div>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <input type="date" value={valore.data} min={oggiISO()}
          onChange={e=>set("data")(e.target.value)}
          style={{...inputStyle,flex:"0 1 150px"}}/>
        <input value={valore.focus} onChange={e=>set("focus")(e.target.value)}
          disabled={!attiva}
          placeholder={FOCUS_PLACEHOLDER[indice]}
          style={{...inputStyle,flex:"1 1 220px",opacity:attiva?1:.5}}/>
      </div>
    </div>
  );
}

// ── Form nuova decisione ────────────────────────────────────────────────

function FormDecisione({ bozza, setBozza, onSalva, onAnnulla, salvando, errore, modifica }) {
  const set = (k) => (v) => setBozza(prev=>({...prev,[k]:v}));
  const fid = fiduciaLabel(bozza.fiducia);

  const setRevisione = (i) => (val) =>
    setBozza(prev=>{
      const revisioni = [...prev.revisioni];
      revisioni[i] = val;
      return {...prev, revisioni};
    });

  return (
    <div style={{background:"var(--c-panel)",border:`1px solid ${VIOLA}40`,borderRadius:12,padding:16,marginBottom:16}}>
      <div style={{fontSize:14,fontWeight:700,color:"var(--c-text-strong)",marginBottom:4}}>
        {modifica ? "✏️ Correggi la decisione" : "⚖️ Nuova decisione"}
      </div>
      <div style={{fontSize:11,color:"var(--c-text-faint)",marginBottom:16,lineHeight:1.5}}>
        {modifica
          ? "Hai 24 ore dalla creazione per correggere. Dopo si congela."
          : "Scrivila adesso, prima di sapere com'è andata. È il confronto tra questo testo e le revisioni a valere qualcosa — non il testo da solo."}
      </div>

      {errore && (
        <div style={{background:`${ROSSO}15`,border:`1px solid ${ROSSO}40`,borderRadius:8,padding:"8px 11px",fontSize:12,color:ROSSO,marginBottom:14,lineHeight:1.4}}>
          {errore}
        </div>
      )}

      <Campo label="Titolo *">
        <input value={bozza.titolo} onChange={e=>set("titolo")(e.target.value)}
          placeholder="Es. Iscrivermi in palestra tre volte a settimana"
          style={inputStyle}/>
      </Campo>

      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
        <div style={{flex:"1 1 160px"}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--c-text-muted)",marginBottom:6,textTransform:"uppercase",letterSpacing:.4}}>Ambito</div>
          <div style={{display:"flex",gap:6}}>
            {AMBITI.map(a=>(
              <button key={a.id} onClick={()=>set("ambito")(a.id)}
                style={{flex:1,padding:"7px 4px",borderRadius:7,cursor:"pointer",fontSize:11,fontWeight:600,
                  border:`1px solid ${bozza.ambito===a.id?a.color:"var(--c-border)"}`,
                  background:bozza.ambito===a.id?`${a.color}18`:"transparent",
                  color:bozza.ambito===a.id?a.color:"var(--c-text-faint)"}}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{flex:"1 1 140px"}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--c-text-muted)",marginBottom:6,textTransform:"uppercase",letterSpacing:.4}}>Data decisione</div>
          <input type="date" value={bozza.data || oggiISO()} onChange={e=>set("data")(e.target.value)} style={inputStyle}/>
        </div>
      </div>

      <Campo label="Contesto" aiuto="Cosa stava succedendo? Cosa sapevi e cosa non sapevi in quel momento.">
        <AreaTesto value={bozza.contesto} onChange={set("contesto")} rows={3}
          placeholder="La situazione com'era davvero quando hai deciso..."/>
      </Campo>

      <Campo label="Obiettivo" aiuto="Cosa deve succedere perché questa decisione si possa dire riuscita.">
        <AreaTesto value={bozza.obiettivo} onChange={set("obiettivo")} rows={2}
          placeholder="Il risultato concreto che stai cercando..."/>
      </Campo>

      <Campo label="Alternative valutate" aiuto="Le strade che hai scartato, una per riga, con il motivo. È il campo che tra un anno rileggerai per primo.">
        <AreaTesto value={bozza.alternative} onChange={set("alternative")} rows={3}
          placeholder={"A) ... — scartata perché ...\nB) ... — scartata perché ..."}/>
      </Campo>

      <Campo label="Decisione presa *" aiuto="Cosa fai, in concreto.">
        <AreaTesto value={bozza.decisione} onChange={set("decisione")} rows={2}
          placeholder="Da lunedì faccio..."/>
      </Campo>

      <Campo label="Motivazione" aiuto="Perché questa e non le altre.">
        <AreaTesto value={bozza.motivazione} onChange={set("motivazione")} rows={3}
          placeholder="Il ragionamento vero, non quello che diresti a un cliente..."/>
      </Campo>

      <Campo label="Livello di fiducia" aiuto="Quanto sei convinto adesso, prima di sapere l'esito. Non barare verso l'alto: il valore di questo numero sta tutto nel confronto con com'è andata.">
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <input type="range" min={1} max={10} step={1} value={bozza.fiducia}
            onChange={e=>set("fiducia")(Number(e.target.value))}
            style={{flex:1,accentColor:fid.color}}/>
          <div style={{minWidth:150,textAlign:"right"}}>
            <span style={{fontSize:18,fontWeight:800,color:fid.color}}>{bozza.fiducia}</span>
            <span style={{fontSize:11,color:"var(--c-text-faint)"}}>/10</span>
            <div style={{fontSize:10,color:fid.color}}>{fid.txt}</div>
          </div>
        </div>
      </Campo>

      <Campo label="Rischi previsti" aiuto="Cosa può andare storto, secondo te, oggi. Alle revisioni confronterai questa lista con quello che è andato storto davvero.">
        <AreaTesto value={bozza.rischi} onChange={set("rischi")} rows={3}
          placeholder={"- Se succede X, allora...\n- Il rischio grosso è..."}/>
      </Campo>

      <Campo
        label="Date di revisione"
        aiuto="La prima è obbligatoria. Le altre due servono quando una decisione matura per gradi: a un mese sai solo se hai continuato, a sei mesi vedi i primi effetti, a un anno sai se è servita. Accanto a ogni data scrivi cosa vuoi verificare — te la ritroverai davanti quando arriva il momento.">
        {bozza.revisioni.map((r,i)=>(
          <RigaRevisione key={i} indice={i} valore={r} onChange={setRevisione(i)} obbligatoria={i===0}/>
        ))}
        <button
          onClick={()=>setBozza(prev=>({...prev,revisioni:PRESET_DEFAULT.map((g,i)=>({data:dataFraGiorni(g),focus:prev.revisioni[i]?.focus||""}))}))}
          style={{padding:"5px 11px",borderRadius:7,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:11}}>
          ⚡ Riempi tutte e tre (1 mese / 6 mesi / 1 anno)
        </button>
      </Campo>

      <div style={{display:"flex",gap:8,marginTop:18}}>
        <button onClick={onAnnulla} disabled={salvando}
          style={{flex:"0 0 auto",padding:"10px 18px",borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:13}}>
          Annulla
        </button>
        <button onClick={onSalva} disabled={salvando}
          style={{flex:1,padding:10,borderRadius:8,border:"none",background:VIOLA,color:"#fff",cursor:salvando?"wait":"pointer",fontSize:13,fontWeight:700,opacity:salvando?.6:1}}>
          {salvando ? "Salvataggio..." : (modifica ? "Salva correzioni" : "Registra la decisione")}
        </button>
      </div>
    </div>
  );
}

// ── Esito di una revisione già compilata (sola lettura) ─────────────────

function EsitoRevisione({ rev, indice }) {
  const rif = rifarestiInfo(rev.esito.rifaresti);
  return (
    <div style={{background:"var(--c-panel2)",border:`1px solid ${VERDE}30`,borderRadius:10,padding:13,marginTop:10}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
        <span style={{fontSize:12,fontWeight:700,color:"var(--c-text-strong)"}}>
          🔍 {ORDINALI[indice]} revisione — {formattaData(rev.esito.data)}
        </span>
        <span style={{fontSize:11,fontWeight:700,color:rif.color,background:`${rif.color}18`,padding:"2px 8px",borderRadius:9}}>
          {rif.label}
        </span>
      </div>
      {rev.focus && (
        <div style={{fontSize:11,color:"var(--c-text-faint)",fontStyle:"italic",marginBottom:10,lineHeight:1.4}}>
          Volevi verificare: {rev.focus}
        </div>
      )}
      <Riga etichetta="Risultato"              testo={rev.esito.risultato}/>
      <Riga etichetta="Previsto correttamente" testo={rev.esito.previsto}/>
      <Riga etichetta="Sottovalutato"          testo={rev.esito.sottovalutato}/>
      <Riga etichetta="Imparato"               testo={rev.esito.imparato}/>
      <Riga etichetta="Cosa farei di diverso"  testo={rev.esito.diverso}/>
    </div>
  );
}

// ── Form di compilazione di una revisione ───────────────────────────────

function FormRevisione({ decisione, indice, bozza, setBozza, onSalva, onAnnulla, salvando, errore }) {
  const set = (k) => (v) => setBozza(prev=>({...prev,[k]:v}));
  const fid = fiduciaLabel(decisione.fiducia);
  const rev = decisione.revisioni[indice];
  // Le revisioni già compilate PRIMA di questa. Rimetterle davanti è il
  // motivo per cui esistono tre date invece di una: a sei mesi non stai
  // giudicando solo la decisione di febbraio, stai anche verificando se
  // quello che avevi scritto al primo mese ha tenuto.
  const precedenti = decisione.revisioni.slice(0, indice).filter(r=>r.esito);

  return (
    <div style={{background:"var(--c-panel2)",border:`1px solid ${AMBRA}40`,borderRadius:10,padding:14,marginTop:12}}>
      <div style={{fontSize:13,fontWeight:700,color:"var(--c-text-strong)",marginBottom:4}}>
        🔍 {ORDINALI[indice]} revisione
      </div>
      <div style={{fontSize:11,color:"var(--c-text-faint)",marginBottom:12,lineHeight:1.5}}>
        Decisione presa il {formattaData(decisione.data)}, con fiducia{" "}
        <strong style={{color:fid.color}}>{decisione.fiducia}/10</strong>. Rileggi sopra cosa avevi scritto prima di rispondere.
      </div>

      {rev?.focus && (
        <div style={{background:`${AMBRA}12`,border:`1px solid ${AMBRA}30`,borderRadius:8,padding:"9px 11px",marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:700,color:AMBRA,textTransform:"uppercase",letterSpacing:.4,marginBottom:3}}>
            Quello che volevi verificare qui
          </div>
          <div style={{fontSize:13,color:"var(--c-text)",lineHeight:1.4}}>{rev.focus}</div>
        </div>
      )}

      {precedenti.length > 0 && (
        <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:8,padding:"10px 11px",marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:700,color:"var(--c-text-faint)",textTransform:"uppercase",letterSpacing:.4,marginBottom:6}}>
            Cosa avevi scritto alle revisioni precedenti
          </div>
          {precedenti.map((p,i)=>(
            <div key={i} style={{marginBottom:i<precedenti.length-1?9:0,paddingBottom:i<precedenti.length-1?9:0,borderBottom:i<precedenti.length-1?"1px dashed var(--c-border)":"none"}}>
              <div style={{fontSize:11,color:"var(--c-text-muted)",fontWeight:600,marginBottom:3}}>
                {ORDINALI[i]} — {formattaData(p.esito.data)} · {rifarestiInfo(p.esito.rifaresti).label}
              </div>
              {p.esito.risultato && <div style={{fontSize:12,color:"var(--c-text)",lineHeight:1.45,whiteSpace:"pre-wrap"}}>{p.esito.risultato}</div>}
            </div>
          ))}
        </div>
      )}

      {errore && (
        <div style={{background:`${ROSSO}15`,border:`1px solid ${ROSSO}40`,borderRadius:8,padding:"8px 11px",fontSize:12,color:ROSSO,marginBottom:14}}>
          {errore}
        </div>
      )}

      <Campo label="La rifaresti?">
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {RIFARESTI.map(r=>(
            <button key={r.id} onClick={()=>set("rifaresti")(r.id)}
              style={{flex:"1 1 100px",padding:"8px 6px",borderRadius:7,cursor:"pointer",fontSize:11,fontWeight:600,
                border:`1px solid ${bozza.rifaresti===r.id?r.color:"var(--c-border)"}`,
                background:bozza.rifaresti===r.id?`${r.color}18`:"transparent",
                color:bozza.rifaresti===r.id?r.color:"var(--c-text-faint)"}}>
              {r.label}
            </button>
          ))}
        </div>
      </Campo>

      <Campo label="Qual è stato il risultato?" aiuto="I fatti, con numeri se ci sono.">
        <AreaTesto value={bozza.risultato} onChange={set("risultato")} rows={3} placeholder="Com'è andata davvero..."/>
      </Campo>

      <Campo label="Cosa avevi previsto correttamente?">
        <AreaTesto value={bozza.previsto} onChange={set("previsto")} rows={2} placeholder="Le cose che avevi visto giuste..."/>
      </Campo>

      <Campo label="Cosa hai sottovalutato?" aiuto="Confrontalo con la lista dei rischi che avevi scritto: quello che è andato storto era già lì o no?">
        <AreaTesto value={bozza.sottovalutato} onChange={set("sottovalutato")} rows={2} placeholder="Quello che non avevi messo in conto..."/>
      </Campo>

      <Campo label="Cosa hai imparato?" aiuto="Non sulla singola situazione: su come decidi.">
        <AreaTesto value={bozza.imparato} onChange={set("imparato")} rows={2} placeholder="La lezione che vale anche per la prossima volta..."/>
      </Campo>

      <Campo label="Cosa faresti di diverso oggi?">
        <AreaTesto value={bozza.diverso} onChange={set("diverso")} rows={2} placeholder="Con quello che sai adesso..."/>
      </Campo>

      <div style={{display:"flex",gap:8,marginTop:6}}>
        <button onClick={onAnnulla} disabled={salvando}
          style={{flex:"0 0 auto",padding:"9px 16px",borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:12}}>
          Annulla
        </button>
        <button onClick={onSalva} disabled={salvando}
          style={{flex:1,padding:9,borderRadius:8,border:"none",background:AMBRA,color:"#0F172A",cursor:salvando?"wait":"pointer",fontSize:12,fontWeight:700,opacity:salvando?.6:1}}>
          {salvando ? "Salvataggio..." : "Salva la revisione"}
        </button>
      </div>
    </div>
  );
}

// ── Timeline compatta delle revisioni (dentro la card aperta) ───────────

function TimelineRevisioni({ revisioni, onRivedi, onRimanda }) {
  const oggi = oggiISO();
  return (
    <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:12}}>
      {revisioni.map((r,i)=>{
        const fatta = Boolean(r.esito);
        const scaduta = !fatta && r.data <= oggi;
        const g = giorniDa(r.data);
        const colore = fatta ? VERDE : scaduta ? AMBRA : "var(--c-text-faint)";
        const stato = fatta
          ? `compilata il ${formattaData(r.esito.data)}`
          : scaduta
            ? (g===0 ? "scade oggi" : `in ritardo di ${Math.abs(g)} giorni`)
            : `fra ${g} giorni`;
        return (
          <div key={i} style={{display:"flex",alignItems:"center",gap:9,flexWrap:"wrap",
            background:"var(--c-panel2)",border:`1px solid ${scaduta?`${AMBRA}40`:"var(--c-border)"}`,
            borderRadius:8,padding:"7px 10px"}}>
            <span style={{fontSize:13,flexShrink:0}}>{fatta?"✅":scaduta?"🔔":"⏳"}</span>
            <div style={{flex:1,minWidth:120}}>
              <div style={{fontSize:11,fontWeight:700,color:"var(--c-text-muted)"}}>
                {ORDINALI[i]} · {formattaData(r.data)}{" "}
                <span style={{fontWeight:500,color:colore}}>— {stato}</span>
              </div>
              {r.focus && <div style={{fontSize:11,color:"var(--c-text-faint)",lineHeight:1.35,marginTop:2}}>{r.focus}</div>}
            </div>
            <div style={{display:"flex",gap:5,flexShrink:0}}>
              <button onClick={()=>onRivedi(i)}
                style={{padding:"5px 10px",borderRadius:6,cursor:"pointer",fontSize:10,fontWeight:600,
                  border:`1px solid ${fatta?"var(--c-border)":`${AMBRA}40`}`,
                  background:fatta?"transparent":`${AMBRA}15`,
                  color:fatta?"var(--c-text-faint)":AMBRA}}>
                {fatta?"riscrivi":"compila"}
              </button>
              {!fatta && (
                <button onClick={()=>onRimanda(i,30)}
                  style={{padding:"5px 9px",borderRadius:6,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:10}}
                  title="Sposta questa revisione di 30 giorni">
                  +30g
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Card decisione ──────────────────────────────────────────────────────

function CardDecisione({
  d, aperta, onToggle, onRivedi, onRimanda, onModifica, onElimina,
  revisioneAttiva, bozzaEsito, setBozzaEsito, salvaEsito,
  chiudiRevisione, salvando, erroreRevisione,
}) {
  const amb = ambitoInfo(d.ambito);
  const fid = fiduciaLabel(d.fiducia);
  const revisioni = d.revisioni || [];
  const compilate = revisioni.filter(r=>r.esito).length;
  const prossima = revisioni.find(r=>!r.esito);
  const tutteFatte = revisioni.length > 0 && compilate === revisioni.length;

  // Il bordo sinistro è l'unico segnale che leggi senza aprire nulla:
  // ambra = ti sta aspettando, verde = tutte le revisioni chiuse, colore
  // dell'ambito = in corso, nulla da fare per ora.
  const bordo = d.daRivedere ? AMBRA : tutteFatte ? VERDE : amb.color;

  let stato;
  if (d.daRivedere) {
    const g = giorniDa(prossima?.data);
    stato = { txt: g === 0 ? "Da rivedere oggi" : `Da rivedere da ${Math.abs(g)} giorni`, color:AMBRA };
  } else if (tutteFatte) {
    stato = { txt:"Tutte le revisioni fatte", color:VERDE };
  } else if (prossima) {
    stato = { txt:`Prossima revisione fra ${giorniDa(prossima.data)} giorni`, color:"var(--c-text-faint)" };
  } else {
    stato = { txt:"Nessuna revisione prevista", color:"var(--c-text-faintest)" };
  }

  return (
    <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderLeft:`3px solid ${bordo}`,borderRadius:10,padding:14}}>
      <div onClick={onToggle} style={{cursor:"pointer"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:14,fontWeight:700,color:"var(--c-text-strong)",lineHeight:1.35}}>{d.titolo}</div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginTop:6}}>
              <span style={{fontSize:10,color:amb.color,fontWeight:600,background:`${amb.color}18`,padding:"2px 7px",borderRadius:9}}>{amb.label}</span>
              <span style={{fontSize:11,color:"var(--c-text-faint)"}}>{formattaData(d.data)}</span>
              <span style={{fontSize:11,color:fid.color}}>fiducia {d.fiducia}/10</span>
              {revisioni.length>0 && (
                <span style={{fontSize:11,color:"var(--c-text-faint)"}}>revisioni {compilate}/{revisioni.length}</span>
              )}
              <span style={{fontSize:11,color:stato.color,fontWeight:600}}>· {stato.txt}</span>
            </div>
          </div>
          <span style={{fontSize:12,color:"var(--c-text-faint)",flexShrink:0}}>{aperta?"▲":"▼"}</span>
        </div>
      </div>

      {aperta && (
        <div style={{marginTop:14,paddingTop:12,borderTop:"1px solid var(--c-border)"}}>
          <Riga etichetta="Contesto"    testo={d.contesto}/>
          <Riga etichetta="Obiettivo"   testo={d.obiettivo}/>
          <Riga etichetta="Alternative valutate" testo={d.alternative}/>
          <Riga etichetta="Decisione"   testo={d.decisione}/>
          <Riga etichetta="Motivazione" testo={d.motivazione}/>
          <Riga etichetta="Rischi previsti" testo={d.rischi}/>

          <div style={{fontSize:11,color:"var(--c-text-faint)",marginTop:8,paddingTop:8,borderTop:"1px dashed var(--c-border)"}}>
            Fiducia dichiarata: <strong style={{color:fid.color}}>{d.fiducia}/10 — {fid.txt}</strong>
          </div>

          <TimelineRevisioni revisioni={revisioni} onRivedi={onRivedi} onRimanda={onRimanda}/>

          {revisioni.map((r,i)=> r.esito && revisioneAttiva!==i
            ? <EsitoRevisione key={i} rev={r} indice={i}/>
            : null)}

          {revisioneAttiva !== null && revisioni[revisioneAttiva] && (
            <FormRevisione
              decisione={d}
              indice={revisioneAttiva}
              bozza={bozzaEsito}
              setBozza={setBozzaEsito}
              onSalva={salvaEsito}
              onAnnulla={chiudiRevisione}
              salvando={salvando}
              errore={erroreRevisione}
            />
          )}

          <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:14}}>
            {d.modificabile && (
              <button onClick={onModifica}
                style={{padding:"7px 13px",borderRadius:7,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-muted)",cursor:"pointer",fontSize:11}}>
                ✏️ Correggi
              </button>
            )}
            <button onClick={onElimina}
              style={{padding:"7px 11px",borderRadius:7,border:"1px solid var(--c-border)",background:"transparent",color:ROSSO,cursor:"pointer",fontSize:11,marginLeft:"auto"}}>
              🗑️
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pagina ──────────────────────────────────────────────────────────────

const FILTRI = [
  { id:"da_rivedere", label:"Da rivedere" },
  { id:"aperte",      label:"In corso" },
  { id:"riviste",     label:"Con revisioni" },
  { id:"tutte",       label:"Tutte" },
];

export default function DecisionsPage({ fontSize=14, theme="dark", isMobile=false, onCountChange }) {
  const themeVars = THEME_VARS[theme] || THEME_VARS.dark;

  const [dati, setDati]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore]   = useState(null);
  const [filtro, setFiltro]   = useState("da_rivedere");
  const [aperta, setAperta]   = useState(null); // id decisione espansa

  const [mostraForm, setMostraForm]   = useState(false);
  const [modificaId, setModificaId]   = useState(null);
  const [bozza, setBozza]             = useState(BOZZA_VUOTA);
  const [erroreForm, setErroreForm]   = useState(null);

  // Quale revisione si sta compilando: {id, indice}. Null = nessuna.
  const [revisioneAttiva, setRevisioneAttiva] = useState(null);
  const [bozzaEsito, setBozzaEsito]           = useState(ESITO_VUOTO);
  const [erroreRevisione, setErroreRevisione] = useState(null);

  const [salvando, setSalvando] = useState(false);

  const carica = useCallback(async () => {
    setLoading(true); setErrore(null);
    try {
      const res = await fetch("/api/decisions");
      if (!res.ok) { setErrore((await res.json()).error || "Errore di caricamento"); setLoading(false); return; }
      const d = await res.json();
      setDati(d);
      // Il conteggio torna su in page.jsx: il banner in home resta allineato
      // senza dover ricaricare tutta la dashboard dopo una revisione.
      onCountChange?.(d.daRivedere || 0);
    } catch (e) { setErrore(e.message); }
    setLoading(false);
  }, [onCountChange]);

  useEffect(()=>{ carica(); },[carica]);

  // Il filtro parte da "Da rivedere" perché è l'unica cosa che richiede
  // un'azione. Ma quel giorno è raro: il resto del tempo la schermata
  // sarebbe vuota, quindi se non c'è niente in scadenza si ripiega su
  // "Tutte" — che è lo storico, cioè il motivo per cui questa pagina serve
  // negli altri 360 giorni dell'anno.
  useEffect(()=>{
    if (dati && filtro==="da_rivedere" && dati.daRivedere===0) setFiltro("tutte");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[dati?.daRivedere]);

  const decisioni = dati?.decisioni || [];
  const filtrate = useMemo(()=>{
    if (filtro==="da_rivedere") return decisioni.filter(d=>d.daRivedere);
    if (filtro==="aperte")      return decisioni.filter(d=>(d.revisioni||[]).some(r=>!r.esito));
    if (filtro==="riviste")     return decisioni.filter(d=>(d.revisioni||[]).some(r=>r.esito));
    return decisioni;
  },[decisioni,filtro]);

  // Statistica sul modo di decidere, non sulle singole decisioni: quanto
  // spesso, a mente fredda, rifaresti quello che hai fatto. È l'unico
  // numero della pagina che parla di te e non delle circostanze.
  //
  // Conta l'ULTIMA revisione compilata di ogni decisione, non tutte: la
  // palestra a un mese può essere "sì" e a un anno "no", e quello che vale
  // è il giudizio più informato, non la media dei tuoi entusiasmi. Servono
  // tre decisioni giudicate prima che il numero significhi qualcosa.
  const tassoRifarei = useMemo(()=>{
    const giudizi = decisioni
      .map(d=>[...(d.revisioni||[])].reverse().find(r=>r.esito))
      .filter(Boolean);
    if (giudizi.length < 3) return null;
    const si = giudizi.filter(r=>r.esito.rifaresti==="si").length;
    return { perc: Math.round(si/giudizi.length*100), su: giudizi.length };
  },[decisioni]);

  const apriNuova = () => {
    setBozza({...BOZZA_VUOTA, data:oggiISO(), revisioni:[{data:"",focus:""},{data:"",focus:""},{data:"",focus:""}]});
    setModificaId(null); setErroreForm(null); setMostraForm(true);
  };
  const apriModifica = (d) => {
    // Il form ha sempre tre righe: quelle non usate restano vuote.
    const revisioni = [0,1,2].map(i=>({
      data: d.revisioni?.[i]?.data || "",
      focus: d.revisioni?.[i]?.focus || "",
    }));
    setBozza({
      titolo:d.titolo, contesto:d.contesto, obiettivo:d.obiettivo,
      alternative:d.alternative, decisione:d.decisione, motivazione:d.motivazione,
      fiducia:d.fiducia, rischi:d.rischi, ambito:d.ambito, data:d.data, revisioni,
    });
    setModificaId(d.id); setErroreForm(null); setMostraForm(true);
  };

  const salvaDecisione = async () => {
    setSalvando(true); setErroreForm(null);
    // Le righe vuote non partono: il server tiene solo quelle con una data,
    // ma filtrarle qui rende l'errore "serve la prima data" prevedibile.
    const payload = {...bozza, revisioni: bozza.revisioni.filter(r=>r.data)};
    try {
      const res = modificaId
        ? await fetch("/api/decisions",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,id:modificaId,azione:"modifica"})})
        : await fetch("/api/decisions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const d = await res.json();
      if (!res.ok) { setErroreForm(d.error || "Errore di salvataggio"); setSalvando(false); return; }
      setMostraForm(false); setModificaId(null); setBozza(BOZZA_VUOTA);
      await carica();
    } catch (e) { setErroreForm(e.message); }
    setSalvando(false);
  };

  const apriRevisione = (d, indice) => {
    const esito = d.revisioni?.[indice]?.esito;
    setBozzaEsito(esito ? {
      rifaresti:esito.rifaresti, previsto:esito.previsto,
      sottovalutato:esito.sottovalutato, risultato:esito.risultato,
      imparato:esito.imparato, diverso:esito.diverso,
    } : ESITO_VUOTO);
    setErroreRevisione(null);
    // Insieme all'indice teniamo la DATA della revisione: è l'identificatore
    // che sopravvive a un riordino dell'array (rimandare la prima di sei mesi
    // la sposta dopo la seconda, e l'indice punta di colpo a quella sbagliata).
    setRevisioneAttiva({id:d.id, indice, dataRevisione: d.revisioni?.[indice]?.data || null});
    setAperta(d.id);
  };

  const salvaEsito = async () => {
    if (!revisioneAttiva) return;
    setSalvando(true); setErroreRevisione(null);
    try {
      const res = await fetch("/api/decisions",{method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...bozzaEsito,id:revisioneAttiva.id,indice:revisioneAttiva.indice,dataRevisione:revisioneAttiva.dataRevisione,azione:"revisione"})});
      const d = await res.json();
      if (!res.ok) { setErroreRevisione(d.error || "Errore di salvataggio"); setSalvando(false); return; }
      setRevisioneAttiva(null); setBozzaEsito(ESITO_VUOTO);
      await carica();
    } catch (e) { setErroreRevisione(e.message); }
    setSalvando(false);
  };

  const rimanda = async (id, indice, giorni, dataRevisione) => {
    try {
      await fetch("/api/decisions",{method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id,indice,dataRevisione,azione:"rimanda",giorni})});
      await carica();
    } catch {}
  };

  const elimina = async (d) => {
    if (!confirm(`Eliminare "${d.titolo}"? Non si recupera.`)) return;
    try {
      await fetch(`/api/decisions?id=${encodeURIComponent(d.id)}`,{method:"DELETE"});
      await carica();
    } catch {}
  };

  return (
    <div style={{...themeVars,display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",background:"var(--c-bg)"}}>
      {/* Intestazione */}
      <div style={{padding:"12px 20px",borderBottom:"1px solid var(--c-border)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div style={{fontWeight:700,fontSize:15,color:"var(--c-text-strong)"}}>⚖️ Decisioni</div>
          <button onClick={apriNuova}
            style={{padding:"6px 13px",borderRadius:7,border:"none",background:VIOLA,color:"#fff",cursor:"pointer",fontSize:12,fontWeight:700}}>
            + Nuova
          </button>
        </div>
        <div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:11,color:"var(--c-text-dim)",marginTop:7}}>
          <span><strong style={{color:AMBRA}}>{dati?.daRivedere ?? 0}</strong> revisioni da fare</span>
          <span><strong style={{color:"var(--c-text-muted)"}}>{dati?.inAttesa ?? 0}</strong> in attesa</span>
          <span><strong style={{color:VERDE}}>{dati?.chiuse ?? 0}</strong> chiuse</span>
          <span><strong style={{color:"var(--c-text-muted)"}}>{dati?.totali ?? 0}</strong> decisioni</span>
          {tassoRifarei && (
            <span style={{color:"var(--c-text-faint)"}}>
              · rifaresti il <strong style={{color:VERDE}}>{tassoRifarei.perc}%</strong> su {tassoRifarei.su} giudicate
            </span>
          )}
        </div>
        <div style={{display:"flex",gap:5,marginTop:9,flexWrap:"wrap"}}>
          {FILTRI.map(f=>(
            <button key={f.id} onClick={()=>setFiltro(f.id)}
              style={{padding:"4px 10px",borderRadius:7,cursor:"pointer",fontSize:11,
                border:`1px solid ${filtro===f.id?VIOLA:"var(--c-border)"}`,
                background:filtro===f.id?`${VIOLA}20`:"transparent",
                color:filtro===f.id?VIOLA:"var(--c-text-faint)"}}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:isMobile?12:16}}>
        {mostraForm && (
          <FormDecisione
            bozza={bozza} setBozza={setBozza}
            onSalva={salvaDecisione}
            onAnnulla={()=>{setMostraForm(false);setModificaId(null);setErroreForm(null);}}
            salvando={salvando} errore={erroreForm} modifica={Boolean(modificaId)}
          />
        )}

        {loading && <div style={{textAlign:"center",color:"var(--c-text-faintest)",fontSize:fontSize-2,padding:"40px 0"}}>⏳ Caricamento...</div>}

        {errore && !loading && (
          <div style={{background:`${ROSSO}15`,border:`1px solid ${ROSSO}40`,borderRadius:10,padding:14,fontSize:12,color:ROSSO}}>
            {errore}
            <button onClick={carica} style={{marginLeft:10,padding:"3px 10px",borderRadius:6,border:`1px solid ${ROSSO}40`,background:"transparent",color:ROSSO,cursor:"pointer",fontSize:11}}>Riprova</button>
          </div>
        )}

        {!loading && !errore && filtrate.length===0 && (
          <div style={{textAlign:"center",padding:"40px 20px",color:"var(--c-text-faint)"}}>
            {decisioni.length===0 ? (
              <>
                <div style={{fontSize:32,marginBottom:10}}>⚖️</div>
                <div style={{fontSize:14,color:"var(--c-text-muted)",fontWeight:600,marginBottom:6}}>Nessuna decisione registrata</div>
                <div style={{fontSize:12,lineHeight:1.6,maxWidth:440,margin:"0 auto"}}>
                  Registra qui le scelte che, se sbagliate, ti costano tempo o soldi veri.
                  Non le micro-decisioni: quelle che fra sei mesi vorrai capire perché hai preso.
                </div>
              </>
            ) : (
              <div style={{fontSize:12}}>
                {filtro==="da_rivedere" ? "Nessuna revisione in scadenza 🎉" : "Niente in questo filtro."}
              </div>
            )}
          </div>
        )}

        <div style={{display:"flex",flexDirection:"column",gap:9}}>
          {!loading && filtrate.map(d=>(
            <CardDecisione
              key={d.id}
              d={d}
              aperta={aperta===d.id}
              onToggle={()=>setAperta(aperta===d.id?null:d.id)}
              onRivedi={(i)=>apriRevisione(d,i)}
              onRimanda={(i,g)=>rimanda(d.id,i,g,d.revisioni?.[i]?.data || null)}
              onModifica={()=>apriModifica(d)}
              onElimina={()=>elimina(d)}
              revisioneAttiva={revisioneAttiva?.id===d.id ? revisioneAttiva.indice : null}
              bozzaEsito={bozzaEsito}
              setBozzaEsito={setBozzaEsito}
              salvaEsito={salvaEsito}
              chiudiRevisione={()=>setRevisioneAttiva(null)}
              salvando={salvando}
              erroreRevisione={erroreRevisione}
            />
          ))}
        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width:3px; height:3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--c-border); border-radius: 2px; }
        button:hover { filter: brightness(1.08); }
        input[type="date"] { color-scheme: ${theme==="dark"?"dark":"light"}; }
      `}</style>
    </div>
  );
}
