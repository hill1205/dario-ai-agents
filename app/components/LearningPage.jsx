"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// PERCORSO DI APPRENDIMENTO
//
// Archivio di quello che Dario impara, alimentato soprattutto incollando
// conversazioni con i chatbot — che altrimenti restano utili nel momento e
// irrecuperabili una settimana dopo.
//
// Due cose la distinguono da un blocco note:
//   1. il livello di conoscenza sale solo scrivendo una spiegazione con
//      parole tue (test di Feynman, vincolo applicato lato server);
//   2. gli appunti sono sessioni datate, non un blob unico che riscrivi:
//      rileggendo vedi in che ordine hai capito le cose.
//
// Niente ripasso programmato, scelta esplicita di Dario: questa pagina non
// richiama, si consulta.
//
// I componenti di supporto stanno a livello di modulo: definirli dentro
// LearningPage li farebbe rimontare a ogni render, azzerando scroll e
// focus — già successo su questa app.

const THEME_VARS = {
  dark:  { "--c-bg":"#09090F", "--c-panel":"#0F0F1A", "--c-panel2":"#0B0B16", "--c-border":"#1A1A2E", "--c-text-strong":"#F8FAFC", "--c-text":"#E2E8F0", "--c-text-dim":"#64748B", "--c-text-faint":"#475569", "--c-text-faintest":"#334155", "--c-text-muted":"#94A3B8" },
  light: { "--c-bg":"#F4F5F7", "--c-panel":"#FFFFFF", "--c-panel2":"#F1F2F5", "--c-border":"#E2E4E9", "--c-text-strong":"#0F172A", "--c-text":"#1A1A2E", "--c-text-dim":"#475569", "--c-text-faint":"#94A3B8", "--c-text-faintest":"#CBD5E1", "--c-text-muted":"#64748B" },
};

const CIANO = "#06B6D4";
const VERDE = "#10B981";
const ROSSO = "#EF4444";
const AMBRA = "#F59E0B";
const VIOLA = "#8B5CF6";

const MIN_SPIEGAZIONE = 120;

const STATI = [
  { id:"da-iniziare", label:"Da iniziare", color:"var(--c-text-faint)" },
  { id:"in-corso",    label:"In corso",    color:CIANO },
  { id:"completato",  label:"Completato",  color:VERDE },
];
const statoInfo = (s) => STATI.find(x=>x.id===s) || STATI[1];

function livelloLabel(n) {
  if (n >= 9) return { txt:"Lo padroneggio", color:VERDE };
  if (n >= 7) return { txt:"Lo so usare", color:"#84CC16" };
  if (n >= 5) return { txt:"Ho le basi", color:AMBRA };
  if (n >= 3) return { txt:"Ci ho messo il naso", color:"#F97316" };
  return { txt:"Praticamente zero", color:ROSSO };
}

const oggiISO = () =>
  new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Bucharest",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());

function formattaData(iso) {
  if (!iso) return "—";
  const [a,m,g] = iso.split("-");
  return `${g}/${m}/${a}`;
}
function formattaBreve(iso) {
  if (!iso) return "";
  const [,m,g] = iso.split("-");
  return `${g}/${m}`;
}
function giorniFa(iso) {
  if (!iso) return null;
  const d = Math.round((new Date(`${oggiISO()}T12:00:00Z`) - new Date(`${iso}T12:00:00Z`)) / 86400000);
  if (d <= 0) return "oggi";
  if (d === 1) return "ieri";
  if (d < 30) return `${d} giorni fa`;
  if (d < 365) return `${Math.round(d/30)} mesi fa`;
  return `${Math.round(d/365)} anni fa`;
}

const BOZZA_VUOTA = {
  titolo:"", categoria:"", perche:"", livelloIniziale:1, stato:"in-corso",
  concetti:[], applicazioni:[], risorse:[], domande:[], appunti:"",
};

// ── Dettatura vocale ────────────────────────────────────────────────────
//
// Recuperata dalla vecchia pagina Idee. interimResults=false e continuous
// per poter dettare più frasi di fila senza che si fermi alla prima pausa:
// gli appunti di studio sono lunghi, non una riga.
function useDettatura(onTesto) {
  const [attiva, setAttiva] = useState(false);
  const rec = useRef(null);
  const supportata = typeof window !== "undefined" &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  const toggle = () => {
    if (!supportata) return;
    if (attiva) { rec.current?.stop(); setAttiva(false); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.lang = "it-IT";
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) onTesto(e.results[i][0].transcript);
      }
    };
    r.onend = () => setAttiva(false);
    r.onerror = () => setAttiva(false);
    r.start();
    rec.current = r;
    setAttiva(true);
  };

  return { supportata, attiva, toggle };
}

function BottoneDettatura({ onTesto, compatto=false }) {
  const { supportata, attiva, toggle } = useDettatura(onTesto);
  if (!supportata) return null;
  return (
    <button onClick={toggle} type="button"
      title="Detta invece di scrivere"
      style={{padding:compatto?"5px 9px":"8px 13px",borderRadius:7,cursor:"pointer",
        fontSize:compatto?11:12,fontWeight:600,flexShrink:0,
        border:`1px solid ${attiva?ROSSO:"var(--c-border)"}`,
        background:attiva?`${ROSSO}20`:"transparent",
        color:attiva?ROSSO:"var(--c-text-muted)"}}>
      {attiva ? "⏹️ Ascolto..." : "🎙️ Detta"}
    </button>
  );
}

// ── Campi ───────────────────────────────────────────────────────────────

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

// Lista di stringhe modificabile (concetti, applicazioni, domande).
// Una riga per elemento invece di un textarea con gli a-capo: l'AI
// restituisce già una lista, e tenerla strutturata permette di spuntare le
// domande una per una invece di riscrivere tutto il blocco.
function ListaModificabile({ valori, onChange, placeholder, colore }) {
  const set = (i,v) => onChange(valori.map((x,j)=>j===i?v:x));
  const aggiungi = () => onChange([...valori, ""]);
  const rimuovi = (i) => onChange(valori.filter((_,j)=>j!==i));
  return (
    <div>
      {valori.map((v,i)=>(
        <div key={i} style={{display:"flex",gap:6,marginBottom:6,alignItems:"flex-start"}}>
          <span style={{color:colore,fontSize:14,lineHeight:"32px",flexShrink:0}}>•</span>
          <textarea rows={1} value={v} onChange={e=>set(i,e.target.value)} placeholder={placeholder}
            style={{...inputStyle,padding:"7px 10px",minHeight:34}}/>
          <button onClick={()=>rimuovi(i)} type="button"
            style={{width:28,height:32,borderRadius:6,border:"none",background:"var(--c-border)",color:ROSSO,cursor:"pointer",fontSize:13,flexShrink:0}}>×</button>
        </div>
      ))}
      <button onClick={aggiungi} type="button"
        style={{padding:"4px 11px",borderRadius:6,border:"1px dashed var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:11}}>
        + aggiungi
      </button>
    </div>
  );
}

function ListaRisorse({ valori, onChange }) {
  const set = (i,k,v) => onChange(valori.map((x,j)=>j===i?{...x,[k]:v}:x));
  return (
    <div>
      {valori.map((r,i)=>(
        <div key={i} style={{display:"flex",gap:6,marginBottom:6,flexWrap:"wrap"}}>
          <input value={r.titolo} onChange={e=>set(i,"titolo",e.target.value)} placeholder="Titolo"
            style={{...inputStyle,flex:"1 1 140px",padding:"7px 10px"}}/>
          <input value={r.url} onChange={e=>set(i,"url",e.target.value)} placeholder="Link (facoltativo)"
            style={{...inputStyle,flex:"1 1 160px",padding:"7px 10px"}}/>
          <button onClick={()=>onChange(valori.filter((_,j)=>j!==i))} type="button"
            style={{width:28,height:32,borderRadius:6,border:"none",background:"var(--c-border)",color:ROSSO,cursor:"pointer",fontSize:13}}>×</button>
        </div>
      ))}
      <button onClick={()=>onChange([...valori,{titolo:"",url:""}])} type="button"
        style={{padding:"4px 11px",borderRadius:6,border:"1px dashed var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:11}}>
        + aggiungi risorsa
      </button>
    </div>
  );
}

// ── Grafico evoluzione livello medio ────────────────────────────────────
//
// SVG a mano invece di una libreria: è una polilinea con dei pallini, e
// l'app non ha già un motore di grafici da riusare.
//
// Ogni punto porta il suo valore scritto sopra e la sua data sotto. Non è
// decorazione: un pallino senza numero dice solo "sale", e quello che serve
// sapere è di quanto e da quando.
function GraficoLivello({ serie, isMobile }) {
  if (!serie || serie.length < 2) return null;

  // Con tanti punti le etichette si accavallano: si tengono i più recenti,
  // che sono anche quelli che guardi davvero.
  const punti = serie.slice(-(isMobile ? 6 : 12));
  const W = 100, H = 46, padX = 6, padY = 9;
  const max = 10, min = 0;
  const x = (i) => padX + (i * (W - padX*2)) / Math.max(1, punti.length - 1);
  const y = (v) => H - padY - ((v - min) / (max - min)) * (H - padY*2);

  const linea = punti.map((p,i)=>`${x(i)},${y(p.media)}`).join(" ");
  const ultimo = punti[punti.length-1];
  const primo = punti[0];
  const delta = Math.round((ultimo.media - primo.media) * 10) / 10;

  return (
    <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderRadius:10,padding:"12px 14px",marginBottom:14}}>
      <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8,flexWrap:"wrap",marginBottom:8}}>
        <span style={{fontSize:12,fontWeight:700,color:"var(--c-text-strong)"}}>📈 Livello medio di conoscenza</span>
        <span style={{fontSize:11,color:"var(--c-text-faint)"}}>
          oggi <strong style={{color:CIANO,fontSize:14}}>{ultimo.media}</strong>/10
          {delta !== 0 && (
            <span style={{color:delta>0?VERDE:AMBRA,marginLeft:6}}>
              {delta>0?"+":""}{delta} da {formattaBreve(primo.data)}
            </span>
          )}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{width:"100%",height:110,overflow:"visible"}}>
        {[2.5,5,7.5].map(v=>(
          <line key={v} x1={padX} x2={W-padX} y1={y(v)} y2={y(v)}
            stroke="var(--c-border)" strokeWidth={.3} strokeDasharray="1.5 1.5"/>
        ))}
        <polyline points={linea} fill="none" stroke={CIANO} strokeWidth={.9}
          vectorEffect="non-scaling-stroke" strokeLinejoin="round"/>
        {punti.map((p,i)=>(
          <g key={p.data}>
            <circle cx={x(i)} cy={y(p.media)} r={1.4} fill={CIANO}/>
            <text x={x(i)} y={y(p.media)-3.5} textAnchor="middle"
              style={{fontSize:4.2,fill:"var(--c-text-muted)",fontWeight:700}}>{p.media}</text>
            <text x={x(i)} y={H-1.5} textAnchor="middle"
              style={{fontSize:3.6,fill:"var(--c-text-faint)"}}>{formattaBreve(p.data)}</text>
          </g>
        ))}
      </svg>
      <div style={{fontSize:10,color:"var(--c-text-faintest)",marginTop:4,lineHeight:1.4}}>
        Media su tutti gli argomenti attivi a quella data ({ultimo.argomenti} adesso).
        Sale solo quando alzi un livello scrivendo una spiegazione.
      </div>
    </div>
  );
}

// ── Pannello "incolla dalla chat" ───────────────────────────────────────

function PannelloIncolla({ testo, setTesto, onEstrai, estraendo, errore, onAnnulla }) {
  return (
    <div style={{background:"var(--c-panel)",border:`1px solid ${VIOLA}40`,borderRadius:12,padding:16,marginBottom:16}}>
      <div style={{fontSize:14,fontWeight:700,color:"var(--c-text-strong)",marginBottom:4}}>📋 Incolla da una conversazione</div>
      <div style={{fontSize:11,color:"var(--c-text-faint)",marginBottom:12,lineHeight:1.5}}>
        Copia la risposta del chatbot (o un articolo) e incollala qui. Claude la legge e riempie i campi:
        titolo, categoria, concetti chiave, applicazioni pratiche e domande aperte. Poi correggi quello
        che ha sbagliato e salvi — non viene salvato niente finché non lo dici tu.
      </div>

      {errore && (
        <div style={{background:`${ROSSO}15`,border:`1px solid ${ROSSO}40`,borderRadius:8,padding:"8px 11px",fontSize:12,color:ROSSO,marginBottom:12,lineHeight:1.4}}>
          {errore}
        </div>
      )}

      <textarea rows={8} value={testo} onChange={e=>setTesto(e.target.value)}
        placeholder="Incolla qui il testo..."
        style={{...inputStyle,marginBottom:8}}/>

      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:11,color:"var(--c-text-faintest)",flex:1}}>
          {testo.length > 0 && `${testo.length.toLocaleString("it-IT")} caratteri`}
        </span>
        <BottoneDettatura onTesto={t=>setTesto(prev=>(prev?prev+" ":"")+t)} compatto/>
        <button onClick={onAnnulla} disabled={estraendo}
          style={{padding:"8px 14px",borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:12}}>
          Annulla
        </button>
        <button onClick={onEstrai} disabled={estraendo || testo.trim().length<40}
          style={{padding:"8px 16px",borderRadius:8,border:"none",background:VIOLA,color:"#fff",
            cursor:estraendo?"wait":"pointer",fontSize:12,fontWeight:700,
            opacity:(estraendo||testo.trim().length<40)?.5:1}}>
          {estraendo ? "Sto leggendo..." : "✨ Estrai i campi"}
        </button>
      </div>
    </div>
  );
}

// ── Form argomento ──────────────────────────────────────────────────────

function FormArgomento({ bozza, setBozza, categorie, onSalva, onAnnulla, salvando, errore, modifica, daEstrazione }) {
  const set = (k) => (v) => setBozza(prev=>({...prev,[k]:v}));
  const liv = livelloLabel(bozza.livelloIniziale);

  return (
    <div style={{background:"var(--c-panel)",border:`1px solid ${CIANO}40`,borderRadius:12,padding:16,marginBottom:16}}>
      <div style={{fontSize:14,fontWeight:700,color:"var(--c-text-strong)",marginBottom:4}}>
        {modifica ? "✏️ Modifica argomento" : "📚 Nuovo argomento"}
      </div>
      {daEstrazione && (
        <div style={{background:`${VIOLA}12`,border:`1px solid ${VIOLA}30`,borderRadius:8,padding:"8px 11px",fontSize:11,color:"var(--c-text-muted)",marginBottom:12,lineHeight:1.45}}>
          ✨ Campi riempiti da Claude a partire dal testo che hai incollato. Rileggili: l'estrazione
          automatica sbaglia soprattutto sulle sfumature, ed è lì che di solito sta la parte utile.
        </div>
      )}

      {errore && (
        <div style={{background:`${ROSSO}15`,border:`1px solid ${ROSSO}40`,borderRadius:8,padding:"8px 11px",fontSize:12,color:ROSSO,marginBottom:14,lineHeight:1.4}}>
          {errore}
        </div>
      )}

      <Campo label="Titolo *">
        <input value={bozza.titolo} onChange={e=>set("titolo")(e.target.value)}
          placeholder="Es. Come funziona il lifetime value di un cliente"
          style={inputStyle}/>
      </Campo>

      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
        <div style={{flex:"1 1 180px"}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--c-text-muted)",marginBottom:4,textTransform:"uppercase",letterSpacing:.4}}>Categoria</div>
          <input value={bozza.categoria} onChange={e=>set("categoria")(e.target.value)}
            list="categorie-apprendimento" placeholder="Es. Marketing" style={inputStyle}/>
          <datalist id="categorie-apprendimento">
            {categorie.map(c=><option key={c} value={c}/>)}
          </datalist>
        </div>
        <div style={{flex:"1 1 180px"}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--c-text-muted)",marginBottom:4,textTransform:"uppercase",letterSpacing:.4}}>Stato</div>
          <div style={{display:"flex",gap:5}}>
            {STATI.map(s=>(
              <button key={s.id} onClick={()=>set("stato")(s.id)} type="button"
                style={{flex:1,padding:"8px 3px",borderRadius:7,cursor:"pointer",fontSize:10,fontWeight:600,
                  border:`1px solid ${bozza.stato===s.id?s.color:"var(--c-border)"}`,
                  background:bozza.stato===s.id?`${s.color}18`:"transparent",
                  color:bozza.stato===s.id?s.color:"var(--c-text-faint)"}}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Campo label="Perché vuoi studiarlo" aiuto="A cosa ti serve. Tra sei mesi è il campo che ti dice se valeva la pena.">
        <textarea rows={2} value={bozza.perche} onChange={e=>set("perche")(e.target.value)}
          placeholder="Mi serve per..." style={inputStyle}/>
      </Campo>

      {!modifica && (
        <Campo label="Livello di partenza" aiuto="Quanto ne sai adesso, prima di studiarlo. Metti il numero basso senza vergogna: è il punto di partenza da cui misurerai la crescita, e gonfiarlo qui significa solo rendere invisibile il progresso.">
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <input type="range" min={1} max={10} step={1} value={bozza.livelloIniziale}
              onChange={e=>set("livelloIniziale")(Number(e.target.value))}
              style={{flex:1,accentColor:liv.color}}/>
            <div style={{minWidth:140,textAlign:"right"}}>
              <span style={{fontSize:18,fontWeight:800,color:liv.color}}>{bozza.livelloIniziale}</span>
              <span style={{fontSize:11,color:"var(--c-text-faint)"}}>/10</span>
              <div style={{fontSize:10,color:liv.color}}>{liv.txt}</div>
            </div>
          </div>
        </Campo>
      )}

      <Campo label="Concetti fondamentali" aiuto="Le idee che bisogna aver capito. Una per riga.">
        <ListaModificabile valori={bozza.concetti} onChange={set("concetti")} placeholder="Il concetto è che..." colore={CIANO}/>
      </Campo>

      <Campo label="Applicazioni pratiche" aiuto="Cosa ci fai, in concreto, nel tuo lavoro.">
        <ListaModificabile valori={bozza.applicazioni} onChange={set("applicazioni")} placeholder="Posso usarlo per..." colore={VERDE}/>
      </Campo>

      <Campo label="Risorse utili">
        <ListaRisorse valori={bozza.risorse} onChange={set("risorse")}/>
      </Campo>

      <Campo label="Domande aperte" aiuto="Quello che non hai ancora capito. Potrai spuntarle una a una quando trovi la risposta.">
        <ListaModificabile valori={bozza.domande.map(d=>typeof d==="string"?d:d.q)}
          onChange={(v)=>set("domande")(v.map((q,i)=>({q,risposta:bozza.domande[i]?.risposta||""})))}
          placeholder="Non ho capito come..." colore={AMBRA}/>
      </Campo>

      {!modifica && (
        <Campo label="Appunti" aiuto="Diventano la prima sessione di studio, con la data di oggi.">
          <textarea rows={5} value={bozza.appunti} onChange={e=>set("appunti")(e.target.value)}
            placeholder="Quello che hai capito, con parole tue..." style={{...inputStyle,marginBottom:8}}/>
          <BottoneDettatura onTesto={t=>set("appunti")((bozza.appunti?bozza.appunti+" ":"")+t)} compatto/>
        </Campo>
      )}

      <div style={{display:"flex",gap:8,marginTop:18}}>
        <button onClick={onAnnulla} disabled={salvando}
          style={{flex:"0 0 auto",padding:"10px 18px",borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:13}}>
          Annulla
        </button>
        <button onClick={onSalva} disabled={salvando}
          style={{flex:1,padding:10,borderRadius:8,border:"none",background:CIANO,color:"#04222A",cursor:salvando?"wait":"pointer",fontSize:13,fontWeight:700,opacity:salvando?.6:1}}>
          {salvando ? "Salvataggio..." : (modifica ? "Salva modifiche" : "Aggiungi al percorso")}
        </button>
      </div>
    </div>
  );
}

// ── Pannello "alza il livello" ──────────────────────────────────────────

function PannelloLivello({ argomento, livello, setLivello, spiegazione, setSpiegazione, onSalva, onAnnulla, salvando, errore }) {
  const attuale = argomento.livelloAttuale;
  const sale = livello > attuale;
  const mancano = MIN_SPIEGAZIONE - spiegazione.trim().length;
  const liv = livelloLabel(livello);

  return (
    <div style={{background:"var(--c-panel2)",border:`1px solid ${VERDE}40`,borderRadius:10,padding:14,marginTop:12}}>
      <div style={{fontSize:13,fontWeight:700,color:"var(--c-text-strong)",marginBottom:10}}>📈 Aggiorna il livello</div>

      {errore && (
        <div style={{background:`${ROSSO}15`,border:`1px solid ${ROSSO}40`,borderRadius:8,padding:"8px 11px",fontSize:12,color:ROSSO,marginBottom:12,lineHeight:1.45}}>
          {errore}
        </div>
      )}

      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
        <input type="range" min={1} max={10} step={1} value={livello}
          onChange={e=>setLivello(Number(e.target.value))} style={{flex:1,accentColor:liv.color}}/>
        <div style={{minWidth:130,textAlign:"right"}}>
          <span style={{fontSize:11,color:"var(--c-text-faint)"}}>{attuale} → </span>
          <span style={{fontSize:18,fontWeight:800,color:liv.color}}>{livello}</span>
          <div style={{fontSize:10,color:liv.color}}>{liv.txt}</div>
        </div>
      </div>

      {sale ? (
        <>
          <div style={{fontSize:11,fontWeight:700,color:"var(--c-text-muted)",marginBottom:4,textTransform:"uppercase",letterSpacing:.4}}>
            Spiegalo con parole tue
          </div>
          <div style={{fontSize:11,color:"var(--c-text-faint)",marginBottom:7,lineHeight:1.45}}>
            Senza guardare gli appunti. Se non riesci a spiegarlo, il livello non è ancora salito —
            è tutto il senso di questo campo, quindi non copiaincollare.
          </div>
          <textarea rows={5} value={spiegazione} onChange={e=>setSpiegazione(e.target.value)}
            placeholder="In pratica funziona così..." style={{...inputStyle,marginBottom:6}}/>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
            <span style={{fontSize:11,color:mancano>0?AMBRA:VERDE,flex:1}}>
              {mancano>0 ? `Mancano ${mancano} caratteri` : "✓ Lunghezza sufficiente"}
            </span>
            <BottoneDettatura onTesto={t=>setSpiegazione(prev=>(prev?prev+" ":"")+t)} compatto/>
          </div>
        </>
      ) : (
        <div style={{fontSize:11,color:"var(--c-text-faint)",marginBottom:12,lineHeight:1.45}}>
          {livello < attuale
            ? "Stai abbassando il livello: nessuna spiegazione richiesta. Accorgersi di aver capito meno di quanto credevi è già onestà, non serve anche un tema."
            : "Sposta lo slider verso l'alto per registrare un progresso. Puoi anche solo scrivere una nota qui sotto."}
          {livello === attuale && (
            <textarea rows={3} value={spiegazione} onChange={e=>setSpiegazione(e.target.value)}
              placeholder="Nota facoltativa..." style={{...inputStyle,marginTop:8}}/>
          )}
        </div>
      )}

      <div style={{display:"flex",gap:8}}>
        <button onClick={onAnnulla} disabled={salvando}
          style={{flex:"0 0 auto",padding:"9px 16px",borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:12}}>
          Annulla
        </button>
        <button onClick={onSalva} disabled={salvando || (sale && mancano>0)}
          style={{flex:1,padding:9,borderRadius:8,border:"none",background:VERDE,color:"#052E20",
            cursor:salvando?"wait":"pointer",fontSize:12,fontWeight:700,
            opacity:(salvando||(sale&&mancano>0))?.5:1}}>
          {salvando ? "Salvataggio..." : "Salva il progresso"}
        </button>
      </div>
    </div>
  );
}

// ── Pannello nuova sessione di studio ───────────────────────────────────

function PannelloSessione({ appunti, setAppunti, onSalva, onAnnulla, salvando, errore }) {
  return (
    <div style={{background:"var(--c-panel2)",border:`1px solid ${CIANO}40`,borderRadius:10,padding:14,marginTop:12}}>
      <div style={{fontSize:13,fontWeight:700,color:"var(--c-text-strong)",marginBottom:4}}>📝 Nuova sessione di studio</div>
      <div style={{fontSize:11,color:"var(--c-text-faint)",marginBottom:10,lineHeight:1.45}}>
        Gli appunti si aggiungono, non sostituiscono i precedenti: rileggendo vedrai in che ordine
        hai capito le cose.
      </div>
      {errore && (
        <div style={{background:`${ROSSO}15`,border:`1px solid ${ROSSO}40`,borderRadius:8,padding:"8px 11px",fontSize:12,color:ROSSO,marginBottom:10}}>{errore}</div>
      )}
      <textarea rows={6} value={appunti} onChange={e=>setAppunti(e.target.value)}
        placeholder="Oggi ho capito che..." style={{...inputStyle,marginBottom:8}}/>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <BottoneDettatura onTesto={t=>setAppunti(prev=>(prev?prev+" ":"")+t)} compatto/>
        <div style={{flex:1}}/>
        <button onClick={onAnnulla} disabled={salvando}
          style={{padding:"9px 16px",borderRadius:8,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:12}}>
          Annulla
        </button>
        <button onClick={onSalva} disabled={salvando || !appunti.trim()}
          style={{padding:"9px 18px",borderRadius:8,border:"none",background:CIANO,color:"#04222A",
            cursor:salvando?"wait":"pointer",fontSize:12,fontWeight:700,opacity:(salvando||!appunti.trim())?.5:1}}>
          {salvando ? "Salvataggio..." : "Salva sessione"}
        </button>
      </div>
    </div>
  );
}

// ── Card argomento ──────────────────────────────────────────────────────

function Elenco({ titolo, voci, colore }) {
  if (!voci || voci.length === 0) return null;
  return (
    <div style={{marginBottom:12}}>
      <div style={{fontSize:10,fontWeight:700,color:"var(--c-text-faint)",textTransform:"uppercase",letterSpacing:.4,marginBottom:5}}>{titolo}</div>
      {voci.map((v,i)=>(
        <div key={i} style={{display:"flex",gap:7,marginBottom:4,alignItems:"flex-start"}}>
          <span style={{color:colore,fontSize:13,lineHeight:1.4,flexShrink:0}}>•</span>
          <span style={{fontSize:13,color:"var(--c-text)",lineHeight:1.45}}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function CardArgomento({
  a, aperta, onToggle, pannello, onPannello, onElimina, onModifica,
  livello, setLivello, spiegazione, setSpiegazione, salvaProgresso,
  appunti, setAppunti, salvaSessione,
  onRispondi, salvando, erroreAzione,
}) {
  const st = statoInfo(a.stato);
  const liv = livelloLabel(a.livelloAttuale);
  const aperte = (a.domande||[]).filter(d=>!d.risposta);

  return (
    <div style={{background:"var(--c-panel)",border:"1px solid var(--c-border)",borderLeft:`3px solid ${st.color}`,borderRadius:10,padding:14}}>
      <div onClick={onToggle} style={{cursor:"pointer"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:14,fontWeight:700,color:"var(--c-text-strong)",lineHeight:1.35}}>{a.titolo}</div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginTop:6}}>
              {a.categoria && <span style={{fontSize:10,color:CIANO,fontWeight:600,background:`${CIANO}18`,padding:"2px 7px",borderRadius:9}}>{a.categoria}</span>}
              <span style={{fontSize:10,color:st.color,fontWeight:600}}>{st.label}</span>
              <span style={{fontSize:11,color:liv.color,fontWeight:700}}>
                {a.livelloAttuale}/10
                {a.crescita>0 && <span style={{color:VERDE,fontWeight:600}}> (+{a.crescita})</span>}
              </span>
              {aperte.length>0 && <span style={{fontSize:11,color:AMBRA}}>{aperte.length} domand{aperte.length===1?"a":"e"} aperte</span>}
              <span style={{fontSize:11,color:"var(--c-text-faint)"}}>· {giorniFa(a.ultimaRevisione)}</span>
            </div>
          </div>
          <span style={{fontSize:12,color:"var(--c-text-faint)",flexShrink:0}}>{aperta?"▲":"▼"}</span>
        </div>
      </div>

      {aperta && (
        <div style={{marginTop:14,paddingTop:12,borderTop:"1px solid var(--c-border)"}}>
          {a.perche && (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,color:"var(--c-text-faint)",textTransform:"uppercase",letterSpacing:.4,marginBottom:3}}>Perché lo studio</div>
              <div style={{fontSize:13,color:"var(--c-text)",lineHeight:1.5,whiteSpace:"pre-wrap"}}>{a.perche}</div>
            </div>
          )}

          <Elenco titolo="Concetti fondamentali" voci={a.concetti} colore={CIANO}/>
          <Elenco titolo="Applicazioni pratiche" voci={a.applicazioni} colore={VERDE}/>

          {a.risorse?.length>0 && (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,color:"var(--c-text-faint)",textTransform:"uppercase",letterSpacing:.4,marginBottom:5}}>Risorse</div>
              {a.risorse.map((r,i)=>(
                <div key={i} style={{fontSize:13,marginBottom:3}}>
                  {r.url
                    ? <a href={r.url} target="_blank" rel="noreferrer" style={{color:VIOLA,textDecoration:"none"}}>🔗 {r.titolo || r.url}</a>
                    : <span style={{color:"var(--c-text)"}}>• {r.titolo}</span>}
                </div>
              ))}
            </div>
          )}

          {a.domande?.length>0 && (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,color:"var(--c-text-faint)",textTransform:"uppercase",letterSpacing:.4,marginBottom:5}}>Domande</div>
              {a.domande.map((d,i)=>(
                <div key={i} style={{background:"var(--c-panel2)",border:`1px solid ${d.risposta?"var(--c-border)":`${AMBRA}30`}`,borderRadius:8,padding:"8px 10px",marginBottom:5}}>
                  <div style={{display:"flex",gap:7,alignItems:"flex-start"}}>
                    <span style={{fontSize:12,flexShrink:0}}>{d.risposta?"✅":"❓"}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,color:"var(--c-text)",lineHeight:1.4,textDecoration:d.risposta?"none":"none"}}>{d.q}</div>
                      {d.risposta && <div style={{fontSize:12,color:"var(--c-text-muted)",lineHeight:1.45,marginTop:4,whiteSpace:"pre-wrap"}}>{d.risposta}</div>}
                    </div>
                    <button onClick={()=>onRispondi(i,d)}
                      style={{padding:"3px 9px",borderRadius:6,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-faint)",cursor:"pointer",fontSize:10,flexShrink:0}}>
                      {d.risposta?"modifica":"rispondi"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {a.progressi?.length>0 && (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,color:"var(--c-text-faint)",textTransform:"uppercase",letterSpacing:.4,marginBottom:5}}>
                Come sei arrivato a {a.livelloAttuale}/10
              </div>
              {[...a.progressi].reverse().map((p,i)=>(
                <div key={i} style={{background:"var(--c-panel2)",border:"1px solid var(--c-border)",borderRadius:8,padding:"9px 11px",marginBottom:5}}>
                  <div style={{fontSize:11,fontWeight:700,color:VERDE,marginBottom:p.spiegazione?4:0}}>
                    {formattaData(p.data)} · livello {p.livello}/10
                  </div>
                  {p.spiegazione && <div style={{fontSize:12,color:"var(--c-text)",lineHeight:1.5,whiteSpace:"pre-wrap"}}>{p.spiegazione}</div>}
                </div>
              ))}
            </div>
          )}

          {a.sessioni?.length>0 && (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,color:"var(--c-text-faint)",textTransform:"uppercase",letterSpacing:.4,marginBottom:5}}>
                Appunti ({a.sessioni.length} session{a.sessioni.length===1?"e":"i"})
              </div>
              {[...a.sessioni].reverse().map((s,i)=>(
                <div key={i} style={{background:"var(--c-panel2)",border:"1px solid var(--c-border)",borderRadius:8,padding:"9px 11px",marginBottom:5}}>
                  <div style={{fontSize:10,color:"var(--c-text-faint)",marginBottom:4}}>{formattaData(s.data)}</div>
                  <div style={{fontSize:13,color:"var(--c-text)",lineHeight:1.55,whiteSpace:"pre-wrap"}}>{s.appunti}</div>
                </div>
              ))}
            </div>
          )}

          {pannello === "livello" && (
            <PannelloLivello argomento={a} livello={livello} setLivello={setLivello}
              spiegazione={spiegazione} setSpiegazione={setSpiegazione}
              onSalva={salvaProgresso} onAnnulla={()=>onPannello(null)}
              salvando={salvando} errore={erroreAzione}/>
          )}
          {pannello === "sessione" && (
            <PannelloSessione appunti={appunti} setAppunti={setAppunti}
              onSalva={salvaSessione} onAnnulla={()=>onPannello(null)}
              salvando={salvando} errore={erroreAzione}/>
          )}

          {!pannello && (
            <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:14}}>
              <button onClick={()=>onPannello("sessione")}
                style={{padding:"7px 13px",borderRadius:7,border:`1px solid ${CIANO}40`,background:`${CIANO}15`,color:CIANO,cursor:"pointer",fontSize:11,fontWeight:600}}>
                📝 Studia
              </button>
              <button onClick={()=>onPannello("livello")}
                style={{padding:"7px 13px",borderRadius:7,border:`1px solid ${VERDE}40`,background:`${VERDE}15`,color:VERDE,cursor:"pointer",fontSize:11,fontWeight:600}}>
                📈 Aggiorna livello
              </button>
              <button onClick={onModifica}
                style={{padding:"7px 13px",borderRadius:7,border:"1px solid var(--c-border)",background:"transparent",color:"var(--c-text-muted)",cursor:"pointer",fontSize:11}}>
                ✏️ Modifica
              </button>
              <button onClick={onElimina}
                style={{padding:"7px 11px",borderRadius:7,border:"1px solid var(--c-border)",background:"transparent",color:ROSSO,cursor:"pointer",fontSize:11,marginLeft:"auto"}}>
                🗑️
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Pagina ──────────────────────────────────────────────────────────────

const FILTRI = [
  { id:"in-corso",   label:"In corso" },
  { id:"completato", label:"Completati" },
  { id:"tutti",      label:"Tutti" },
];

export default function LearningPage({ fontSize=14, theme="dark", isMobile=false }) {
  const themeVars = THEME_VARS[theme] || THEME_VARS.dark;

  const [dati, setDati]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore]   = useState(null);
  const [filtro, setFiltro]   = useState("in-corso");
  const [categoria, setCategoria] = useState("");
  const [aperta, setAperta]   = useState(null);

  const [modo, setModo]             = useState(null); // null | "incolla" | "form"
  const [testoIncollato, setTesto]  = useState("");
  const [estraendo, setEstraendo]   = useState(false);
  const [erroreIncolla, setErroreIncolla] = useState(null);
  const [daEstrazione, setDaEstrazione]   = useState(false);

  const [bozza, setBozza]           = useState(BOZZA_VUOTA);
  const [modificaId, setModificaId] = useState(null);
  const [erroreForm, setErroreForm] = useState(null);

  // Pannello aperto dentro una card: {id, tipo}. Uno solo per volta in
  // tutta la pagina — due form aperti insieme su argomenti diversi sono
  // solo un modo per salvare la cosa sbagliata.
  const [pannello, setPannello]         = useState(null);
  const [livello, setLivello]           = useState(1);
  const [spiegazione, setSpiegazione]   = useState("");
  const [appunti, setAppunti]           = useState("");
  const [erroreAzione, setErroreAzione] = useState(null);

  const [salvando, setSalvando] = useState(false);

  const carica = useCallback(async () => {
    setLoading(true); setErrore(null);
    try {
      const res = await fetch("/api/learning");
      if (!res.ok) { setErrore((await res.json()).error || "Errore di caricamento"); setLoading(false); return; }
      setDati(await res.json());
    } catch (e) { setErrore(e.message); }
    setLoading(false);
  }, []);

  useEffect(()=>{ carica(); },[carica]);

  const argomenti = dati?.argomenti || [];
  const filtrati = useMemo(()=>{
    let out = argomenti;
    if (filtro !== "tutti") out = out.filter(a=>a.stato===filtro);
    if (categoria) out = out.filter(a=>a.categoria===categoria);
    return out;
  },[argomenti,filtro,categoria]);

  // Se "In corso" è vuoto la schermata iniziale sarebbe vuota pur avendo
  // argomenti: si ripiega su "Tutti".
  useEffect(()=>{
    if (dati && filtro==="in-corso" && dati.inCorso===0 && dati.totali>0) setFiltro("tutti");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[dati?.inCorso, dati?.totali]);

  const estrai = async () => {
    setEstraendo(true); setErroreIncolla(null);
    try {
      const res = await fetch("/api/learning",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({azione:"estrai",testo:testoIncollato})});
      const d = await res.json();
      if (!res.ok) { setErroreIncolla(d.error || "Errore nell'estrazione"); setEstraendo(false); return; }
      const e = d.estratto;
      setBozza({
        ...BOZZA_VUOTA,
        titolo:e.titolo, categoria:e.categoria, perche:e.perche,
        concetti:e.concetti, applicazioni:e.applicazioni,
        risorse:e.risorse, domande:e.domande, appunti:e.appunti,
      });
      setDaEstrazione(true); setModo("form"); setTesto("");
    } catch (e) { setErroreIncolla(e.message); }
    setEstraendo(false);
  };

  const apriNuovo = () => { setBozza(BOZZA_VUOTA); setModificaId(null); setDaEstrazione(false); setErroreForm(null); setModo("form"); };
  const apriIncolla = () => { setTesto(""); setErroreIncolla(null); setModo("incolla"); };
  const apriModifica = (a) => {
    setBozza({
      titolo:a.titolo, categoria:a.categoria, perche:a.perche,
      livelloIniziale:a.livelloIniziale, stato:a.stato,
      concetti:a.concetti||[], applicazioni:a.applicazioni||[],
      risorse:a.risorse||[], domande:a.domande||[], appunti:"",
    });
    setModificaId(a.id); setDaEstrazione(false); setErroreForm(null); setModo("form");
  };
  const chiudiForm = () => { setModo(null); setModificaId(null); setDaEstrazione(false); setErroreForm(null); };

  const salva = async () => {
    setSalvando(true); setErroreForm(null);
    try {
      const res = modificaId
        ? await fetch("/api/learning",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({...bozza,id:modificaId})})
        : await fetch("/api/learning",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(bozza)});
      const d = await res.json();
      if (!res.ok) { setErroreForm(d.error || "Errore di salvataggio"); setSalvando(false); return; }
      chiudiForm(); await carica();
    } catch (e) { setErroreForm(e.message); }
    setSalvando(false);
  };

  const apriPannello = (a, tipo) => {
    setErroreAzione(null);
    if (!tipo) { setPannello(null); return; }
    if (tipo==="livello") { setLivello(a.livelloAttuale); setSpiegazione(""); }
    if (tipo==="sessione") setAppunti("");
    setPannello({id:a.id, tipo});
    setAperta(a.id);
  };

  const salvaProgresso = async () => {
    setSalvando(true); setErroreAzione(null);
    try {
      const res = await fetch("/api/learning",{method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id:pannello.id,azione:"progresso",livello,spiegazione})});
      const d = await res.json();
      if (!res.ok) { setErroreAzione(d.error); setSalvando(false); return; }
      setPannello(null); await carica();
    } catch (e) { setErroreAzione(e.message); }
    setSalvando(false);
  };

  const salvaSessione = async () => {
    setSalvando(true); setErroreAzione(null);
    try {
      const res = await fetch("/api/learning",{method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id:pannello.id,azione:"sessione",appunti})});
      const d = await res.json();
      if (!res.ok) { setErroreAzione(d.error); setSalvando(false); return; }
      setPannello(null); await carica();
    } catch (e) { setErroreAzione(e.message); }
    setSalvando(false);
  };

  const rispondi = async (a, indice, domanda) => {
    const risposta = prompt(`${domanda.q}\n\nLa tua risposta (vuoto = riapri la domanda):`, domanda.risposta || "");
    if (risposta === null) return;
    try {
      await fetch("/api/learning",{method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id:a.id,azione:"domanda",indice,risposta})});
      await carica();
    } catch {}
  };

  const elimina = async (a) => {
    if (!confirm(`Eliminare "${a.titolo}"? Non si recupera.`)) return;
    try {
      await fetch(`/api/learning?id=${encodeURIComponent(a.id)}`,{method:"DELETE"});
      await carica();
    } catch {}
  };

  return (
    <div style={{...themeVars,display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",background:"var(--c-bg)"}}>
      <div style={{padding:"12px 20px",borderBottom:"1px solid var(--c-border)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div style={{fontWeight:700,fontSize:15,color:"var(--c-text-strong)"}}>📚 Apprendimento</div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={apriIncolla}
              style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${VIOLA}`,background:`${VIOLA}18`,color:VIOLA,cursor:"pointer",fontSize:12,fontWeight:700}}>
              📋 Incolla
            </button>
            <button onClick={apriNuovo}
              style={{padding:"6px 12px",borderRadius:7,border:"none",background:CIANO,color:"#04222A",cursor:"pointer",fontSize:12,fontWeight:700}}>
              + Nuovo
            </button>
          </div>
        </div>
        <div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:11,color:"var(--c-text-dim)",marginTop:7}}>
          <span><strong style={{color:"var(--c-text-muted)"}}>{dati?.totali ?? 0}</strong> argomenti</span>
          <span><strong style={{color:CIANO}}>{dati?.inCorso ?? 0}</strong> in corso</span>
          <span><strong style={{color:VERDE}}>{dati?.completati ?? 0}</strong> completati</span>
          <span>livello medio <strong style={{color:CIANO}}>{dati?.mediaOggi ?? 0}</strong>/10</span>
          {dati?.domandeAperte>0 && <span><strong style={{color:AMBRA}}>{dati.domandeAperte}</strong> domande aperte</span>}
        </div>
        <div style={{display:"flex",gap:5,marginTop:9,flexWrap:"wrap",alignItems:"center"}}>
          {FILTRI.map(f=>(
            <button key={f.id} onClick={()=>setFiltro(f.id)}
              style={{padding:"4px 10px",borderRadius:7,cursor:"pointer",fontSize:11,
                border:`1px solid ${filtro===f.id?CIANO:"var(--c-border)"}`,
                background:filtro===f.id?`${CIANO}20`:"transparent",
                color:filtro===f.id?CIANO:"var(--c-text-faint)"}}>
              {f.label}
            </button>
          ))}
          {dati?.categorie?.length>0 && (
            <select value={categoria} onChange={e=>setCategoria(e.target.value)}
              style={{padding:"4px 8px",borderRadius:7,border:"1px solid var(--c-border)",background:"var(--c-panel2)",color:"var(--c-text-faint)",fontSize:11,outline:"none",cursor:"pointer"}}>
              <option value="">Tutte le categorie</option>
              {dati.categorie.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:isMobile?12:16}}>
        {modo==="incolla" && (
          <PannelloIncolla testo={testoIncollato} setTesto={setTesto} onEstrai={estrai}
            estraendo={estraendo} errore={erroreIncolla} onAnnulla={()=>setModo(null)}/>
        )}
        {modo==="form" && (
          <FormArgomento bozza={bozza} setBozza={setBozza} categorie={dati?.categorie||[]}
            onSalva={salva} onAnnulla={chiudiForm} salvando={salvando}
            errore={erroreForm} modifica={Boolean(modificaId)} daEstrazione={daEstrazione}/>
        )}

        {!loading && !errore && argomenti.length>1 && <GraficoLivello serie={dati?.serie} isMobile={isMobile}/>}

        {loading && <div style={{textAlign:"center",color:"var(--c-text-faintest)",fontSize:fontSize-2,padding:"40px 0"}}>⏳ Caricamento...</div>}

        {errore && !loading && (
          <div style={{background:`${ROSSO}15`,border:`1px solid ${ROSSO}40`,borderRadius:10,padding:14,fontSize:12,color:ROSSO}}>
            {errore}
            <button onClick={carica} style={{marginLeft:10,padding:"3px 10px",borderRadius:6,border:`1px solid ${ROSSO}40`,background:"transparent",color:ROSSO,cursor:"pointer",fontSize:11}}>Riprova</button>
          </div>
        )}

        {!loading && !errore && filtrati.length===0 && (
          <div style={{textAlign:"center",padding:"40px 20px",color:"var(--c-text-faint)"}}>
            {argomenti.length===0 ? (
              <>
                <div style={{fontSize:32,marginBottom:10}}>📚</div>
                <div style={{fontSize:14,color:"var(--c-text-muted)",fontWeight:600,marginBottom:6}}>Il percorso è vuoto</div>
                <div style={{fontSize:12,lineHeight:1.6,maxWidth:440,margin:"0 auto"}}>
                  La prossima volta che una conversazione con un chatbot ti insegna qualcosa,
                  copiala e premi <strong style={{color:VIOLA}}>📋 Incolla</strong>: i campi li riempie Claude,
                  a te resta da correggerli.
                </div>
              </>
            ) : (
              <div style={{fontSize:12}}>Niente in questo filtro.</div>
            )}
          </div>
        )}

        <div style={{display:"flex",flexDirection:"column",gap:9}}>
          {!loading && filtrati.map(a=>(
            <CardArgomento
              key={a.id}
              a={a}
              aperta={aperta===a.id}
              onToggle={()=>setAperta(aperta===a.id?null:a.id)}
              pannello={pannello?.id===a.id ? pannello.tipo : null}
              onPannello={(tipo)=>apriPannello(a,tipo)}
              onModifica={()=>apriModifica(a)}
              onElimina={()=>elimina(a)}
              livello={livello} setLivello={setLivello}
              spiegazione={spiegazione} setSpiegazione={setSpiegazione}
              salvaProgresso={salvaProgresso}
              appunti={appunti} setAppunti={setAppunti}
              salvaSessione={salvaSessione}
              onRispondi={(i,d)=>rispondi(a,i,d)}
              salvando={salvando}
              erroreAzione={erroreAzione}
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
      `}</style>
    </div>
  );
}
