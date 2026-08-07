// Percorso di apprendimento — lettura/scrittura sul Doc ClickUp.
//
// PERCHE' ESISTE
// Le cose che Dario impara oggi vivono dentro conversazioni con un chatbot:
// utili nel momento, irrecuperabili una settimana dopo. Questa pagina le
// tira fuori da li' e le mette in una struttura che si puo' rileggere.
//
// COSA LA DISTINGUE DA UN BLOCCO NOTE
// Il livello di conoscenza (1-10) non si alza cliccando uno slider. Per
// alzarlo devi scrivere una spiegazione dell'argomento con parole tue —
// vedi salvaProgresso() piu' sotto. E' il test di Feynman: se non sai
// spiegarlo, non lo sai.
//
// La ragione e' concreta. Un'auto-valutazione libera misura l'umore del
// giorno, non la conoscenza, e su un argomento nuovo e' sistematicamente
// gonfiata: all'inizio non sai ancora cosa non sai. Con il vincolo, il
// numero costa qualcosa e il grafico dell'evoluzione smette di essere
// decorativo. Effetto collaterale piu' prezioso del numero stesso: ti
// resta uno storico di spiegazioni scritte da te, che vale molto piu'
// degli appunti copiati da una chat.
//
// NIENTE RIPASSO PROGRAMMATO
// Scelta esplicita di Dario (07/08): questa pagina non richiama. A
// differenza delle Decisioni non ci sono date di scadenza ne' banner —
// e' un archivio che consulti quando ti serve. Se un domani smettesse di
// essere riaperta, la leva da aggiungere e' quella; non farlo prima che il
// problema si presenti davvero.
//
// FORMA DI UN ARGOMENTO
//   {
//     id, titolo, categoria, perche,
//     livelloIniziale (1-10), stato ("da-iniziare"|"in-corso"|"completato"),
//     concetti: [string],        // concetti fondamentali
//     applicazioni: [string],    // applicazioni pratiche
//     risorse: [{titolo, url}],
//     domande: [{q, risposta}],  // risposta "" = ancora aperta
//     sessioni: [{data, appunti, ts}],
//     progressi: [{data, livello, spiegazione, ts}],
//     creata, ts
//   }
//
// livelloAttuale e dataUltimaRevisione NON sono campi salvati: si derivano
// da progressi[] e sessioni[]. Un campo che si puo' calcolare e' un campo
// che prima o poi va fuori sincrono con la sua fonte.

import { leggiJson, scriviJson, PAGINE, invalidaPagina } from "./clickup-doc";
import { bucharestDate } from "./habits-store";

const PAGE_ID = PAGINE.apprendimento;
const MARCATORE = "LEARNING_DATA_JSON";
const INTESTAZIONE = [
  "PERCORSO DI APPRENDIMENTO DARIO",
  "",
  "Non modificare a mano: viene letto/scritto dalla dashboard.",
  "Ogni argomento tiene traccia di cosa hai studiato (sessioni) e di come",
  "cresce quello che sai (progressi). Il livello sale solo scrivendo una",
  "spiegazione con parole tue: se non sai spiegarlo, non lo sai.",
].join("\n");

export { bucharestDate };

const MAX_TITOLO = 140;
const MAX_BREVE = 300;
const MAX_TESTO = 8000;
const MAX_LISTA = 30;

// Lunghezza minima della spiegazione per poter alzare il livello.
//
// 120 caratteri sono circa due righe: abbastanza da non poter cavarsela con
// "l'ho capito", troppo poche per essere un compito. Il numero e' una
// soglia di attrito, non una misura di qualita' — l'unico giudice della
// qualita' sei tu quando la rileggi tra sei mesi.
export const MIN_SPIEGAZIONE = 120;

const STATI = ["da-iniziare", "in-corso", "completato"];

const pulisci = (v, max = MAX_TESTO) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const pulisciData = (v) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : "";

const pulisciLivello = (v, fallback = 1) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(10, Math.max(1, n));
};

// Liste di stringhe (concetti, applicazioni): scarta i vuoti e taglia la
// lunghezza. L'estrazione AI a volte restituisce elementi vuoti o un
// singolo elemento gigante — entrambi vanno normalizzati prima di finire
// nello storico.
const pulisciLista = (v, maxEl = MAX_BREVE) =>
  (Array.isArray(v) ? v : [])
    .map((x) => pulisci(typeof x === "string" ? x : x?.testo, maxEl))
    .filter(Boolean)
    .slice(0, MAX_LISTA);

const pulisciRisorse = (v) =>
  (Array.isArray(v) ? v : [])
    .map((r) => ({ titolo: pulisci(r?.titolo, MAX_BREVE), url: pulisci(r?.url, 500) }))
    .filter((r) => r.titolo || r.url)
    .slice(0, MAX_LISTA);

const pulisciDomande = (v) =>
  (Array.isArray(v) ? v : [])
    .map((d) => (typeof d === "string"
      ? { q: pulisci(d, MAX_BREVE), risposta: "" }
      : { q: pulisci(d?.q, MAX_BREVE), risposta: pulisci(d?.risposta, MAX_TESTO) }))
    .filter((d) => d.q)
    .slice(0, MAX_LISTA);

const readDoc = (opts) => leggiJson(PAGE_ID, MARCATORE, opts);
const writeDoc = (lista) => scriviJson(PAGE_ID, INTESTAZIONE, MARCATORE, lista);

// ── Derivati ────────────────────────────────────────────────────────────

// Il livello di adesso: l'ultimo progresso registrato, o quello iniziale se
// non ne hai ancora fatti. Derivato e non salvato, cosi' non puo' andare
// fuori sincrono con lo storico che lo alimenta.
export function livelloAttuale(a) {
  const p = a?.progressi || [];
  return p.length ? p[p.length - 1].livello : pulisciLivello(a?.livelloIniziale);
}

// Ultima volta che hai toccato l'argomento: vale sia una sessione di studio
// sia un avanzamento di livello. Serve a "ultimi studiati" in home.
export function ultimaRevisione(a) {
  const date = [
    ...(a?.sessioni || []).map((s) => s.data),
    ...(a?.progressi || []).map((p) => p.data),
  ].filter(Boolean);
  return date.length ? date.sort()[date.length - 1] : a?.creata || "";
}

export function domandeAperte(a) {
  return (a?.domande || []).filter((d) => !d.risposta).length;
}

// Serie per il grafico dell'evoluzione: livello medio di TUTTI gli
// argomenti, giorno per giorno, nei giorni in cui qualcosa e' cambiato.
//
// La media e' su tutti gli argomenti esistenti a quella data, non solo su
// quelli aggiornati quel giorno: altrimenti studiare una cosa nuova e
// partire da 2 farebbe crollare la curva, che e' l'opposto di quello che
// sta succedendo. Ogni argomento contribuisce con il livello che aveva in
// quel momento.
export function serieLivelloMedio(lista) {
  const eventi = new Set();
  for (const a of lista) {
    if (a.creata) eventi.add(a.creata);
    for (const p of a.progressi || []) if (p.data) eventi.add(p.data);
  }
  const date = [...eventi].sort();

  return date.map((giorno) => {
    const attivi = lista.filter((a) => (a.creata || "") <= giorno);
    if (!attivi.length) return { data: giorno, media: 0, argomenti: 0 };
    const somma = attivi.reduce((tot, a) => {
      // Il livello che quell'argomento aveva a quella data: l'ultimo
      // progresso non successivo al giorno in esame, altrimenti l'iniziale.
      const fino = (a.progressi || []).filter((p) => p.data <= giorno);
      return tot + (fino.length ? fino[fino.length - 1].livello : pulisciLivello(a.livelloIniziale));
    }, 0);
    return {
      data: giorno,
      media: Math.round((somma / attivi.length) * 10) / 10,
      argomenti: attivi.length,
    };
  });
}

// ── Normalizzazione ─────────────────────────────────────────────────────

function normalizza(body, prev = {}) {
  return {
    titolo:          pulisci(body.titolo !== undefined ? body.titolo : prev.titolo, MAX_TITOLO),
    categoria:       pulisci(body.categoria !== undefined ? body.categoria : prev.categoria, 60),
    perche:          pulisci(body.perche !== undefined ? body.perche : prev.perche, MAX_TESTO),
    livelloIniziale: pulisciLivello(body.livelloIniziale !== undefined ? body.livelloIniziale : prev.livelloIniziale),
    stato:           STATI.includes(body.stato) ? body.stato : (prev.stato || "in-corso"),
    concetti:        body.concetti     !== undefined ? pulisciLista(body.concetti)     : (prev.concetti || []),
    applicazioni:    body.applicazioni !== undefined ? pulisciLista(body.applicazioni) : (prev.applicazioni || []),
    risorse:         body.risorse      !== undefined ? pulisciRisorse(body.risorse)    : (prev.risorse || []),
    domande:         body.domande      !== undefined ? pulisciDomande(body.domande)    : (prev.domande || []),
  };
}

const ordina = (lista) =>
  [...lista].sort((a, b) => (ultimaRevisione(a) < ultimaRevisione(b) ? 1 : -1));

// ── Lettura ─────────────────────────────────────────────────────────────

export async function datiApprendimento() {
  const lista = ordina(await readDoc());
  const arricchiti = lista.map((a) => ({
    ...a,
    livelloAttuale: livelloAttuale(a),
    ultimaRevisione: ultimaRevisione(a),
    domandeAperte: domandeAperte(a),
    crescita: livelloAttuale(a) - pulisciLivello(a.livelloIniziale),
  }));

  const completati = arricchiti.filter((a) => a.stato === "completato").length;
  const inCorso = arricchiti.filter((a) => a.stato === "in-corso").length;
  const daIniziare = arricchiti.filter((a) => a.stato === "da-iniziare").length;
  const mediaOggi = arricchiti.length
    ? Math.round((arricchiti.reduce((t, a) => t + a.livelloAttuale, 0) / arricchiti.length) * 10) / 10
    : 0;

  return {
    oggi: bucharestDate(0),
    argomenti: arricchiti,
    totali: arricchiti.length,
    completati,
    inCorso,
    daIniziare,
    mediaOggi,
    domandeAperte: arricchiti.reduce((t, a) => t + a.domandeAperte, 0),
    // Le categorie esistenti servono al form: suggerirle evita che lo
    // stesso ambito finisca sotto tre nomi diversi ("marketing",
    // "Marketing", "mkt") e che i filtri diventino inutili.
    categorie: [...new Set(arricchiti.map((a) => a.categoria).filter(Boolean))].sort(),
    serie: serieLivelloMedio(lista),
  };
}

// ── Scrittura ───────────────────────────────────────────────────────────

export async function creaArgomento(body) {
  const base = normalizza(body);
  if (!base.titolo) return { ok: false, status: 400, errore: "Il titolo è obbligatorio." };

  const oggi = bucharestDate(0);
  const lista = await readDoc({ forza: true });
  const entry = {
    id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    ...base,
    sessioni: [],
    progressi: [],
    creata: oggi,
    ts: Date.now(),
  };

  // Appunti passati insieme alla creazione (tipico dell'estrazione AI:
  // incolli una conversazione e quella diventa subito la prima sessione).
  const appunti = pulisci(body.appunti);
  if (appunti) entry.sessioni.push({ data: oggi, appunti, ts: Date.now() });

  lista.push(entry);
  await writeDoc(ordina(lista));
  return { ok: true, argomento: entry };
}

// I campi descrittivi si possono correggere sempre, senza finestra
// temporale. E' la differenza con le Decisioni: li' il testo e' una
// fotografia di cosa sapevi allora e va congelata, qui gli appunti sono
// materiale di lavoro e devono restare correggibili — un refuso in un
// concetto chiave va sistemato, non conservato.
export async function aggiornaArgomento(id, body) {
  const lista = await readDoc({ forza: true });
  const idx = lista.findIndex((a) => a.id === id);
  if (idx < 0) return { ok: false, status: 404, errore: "Argomento non trovato." };

  const entry = { ...lista[idx], ...normalizza(body, lista[idx]) };
  if (!entry.titolo) return { ok: false, status: 400, errore: "Il titolo è obbligatorio." };
  lista[idx] = entry;
  await writeDoc(ordina(lista));
  return { ok: true, argomento: entry };
}

// Una sessione di studio: appunti datati invece di un unico blocco che
// riscrivi. Cosi' "data ultima revisione" e "ultimi studiati" si ricavano
// da soli, e rileggendo vedi in che ordine hai capito le cose — che e'
// un'informazione che un blob unico cancella.
export async function aggiungiSessione(id, body) {
  const appunti = pulisci(body.appunti);
  if (!appunti) return { ok: false, status: 400, errore: "Scrivi qualcosa prima di salvare la sessione." };

  const lista = await readDoc({ forza: true });
  const idx = lista.findIndex((a) => a.id === id);
  if (idx < 0) return { ok: false, status: 404, errore: "Argomento non trovato." };

  const sessioni = [...(lista[idx].sessioni || []), { data: bucharestDate(0), appunti, ts: Date.now() }];
  // Studiare qualcosa lo porta automaticamente "in corso": lo stato e' una
  // conseguenza di quello che fai, non un campo da ricordarsi di girare.
  const stato = lista[idx].stato === "da-iniziare" ? "in-corso" : lista[idx].stato;
  lista[idx] = { ...lista[idx], sessioni, stato };
  await writeDoc(ordina(lista));
  return { ok: true, argomento: lista[idx] };
}

// Alza (o abbassa) il livello. IL VINCOLO STA QUI.
//
// Per salire serve una spiegazione con parole tue di almeno MIN_SPIEGAZIONE
// caratteri. Per scendere no: accorgersi di aver capito meno di quanto
// credevi e' gia' un atto di onesta', chiedergli anche un tema sarebbe
// punirlo. Chi corregge al ribasso non sta barando.
export async function salvaProgresso(id, body) {
  const lista = await readDoc({ forza: true });
  const idx = lista.findIndex((a) => a.id === id);
  if (idx < 0) return { ok: false, status: 404, errore: "Argomento non trovato." };

  const attuale = livelloAttuale(lista[idx]);
  const nuovo = pulisciLivello(body.livello, attuale);
  const spiegazione = pulisci(body.spiegazione);

  if (nuovo > attuale && spiegazione.length < MIN_SPIEGAZIONE) {
    return {
      ok: false,
      status: 400,
      errore: `Per alzare il livello scrivi almeno ${MIN_SPIEGAZIONE} caratteri di spiegazione con parole tue (ne hai scritti ${spiegazione.length}). Se non riesci a spiegarlo senza guardare gli appunti, il livello non è ancora salito.`,
    };
  }
  if (nuovo === attuale && !spiegazione) {
    return { ok: false, status: 400, errore: "Il livello non è cambiato e non hai scritto niente: non c'è nulla da salvare." };
  }

  const progressi = [...(lista[idx].progressi || []), {
    data: bucharestDate(0), livello: nuovo, spiegazione, ts: Date.now(),
  }];
  const stato = lista[idx].stato === "da-iniziare" ? "in-corso" : lista[idx].stato;
  lista[idx] = { ...lista[idx], progressi, stato };
  await writeDoc(ordina(lista));
  return { ok: true, argomento: lista[idx] };
}

// Risponde a una domanda aperta (o la riapre svuotando la risposta).
export async function rispondiDomanda(id, indice, risposta) {
  const lista = await readDoc({ forza: true });
  const idx = lista.findIndex((a) => a.id === id);
  if (idx < 0) return { ok: false, status: 404, errore: "Argomento non trovato." };

  const domande = [...(lista[idx].domande || [])];
  const i = Number(indice);
  if (!Number.isInteger(i) || i < 0 || i >= domande.length) {
    return { ok: false, status: 400, errore: "Domanda non trovata." };
  }
  domande[i] = { ...domande[i], risposta: pulisci(risposta) };
  lista[idx] = { ...lista[idx], domande };
  await writeDoc(ordina(lista));
  return { ok: true, argomento: lista[idx] };
}

export async function eliminaArgomento(id) {
  const lista = await readDoc({ forza: true });
  const idx = lista.findIndex((a) => a.id === id);
  if (idx < 0) return { ok: false, status: 404, errore: "Argomento non trovato." };
  lista.splice(idx, 1);
  try {
    await writeDoc(ordina(lista));
  } catch (e) {
    invalidaPagina(PAGE_ID);
    throw e;
  }
  return { ok: true };
}

// ── Normalizzazione dell'output dell'AI ─────────────────────────────────
//
// Sta qui e non nella route perche' e' logica di dominio: quali campi
// esistono e come si puliscono lo sa questo modulo. La route deve solo
// parlare con l'API.
export function normalizzaEstrazione(grezzo) {
  return {
    titolo:       pulisci(grezzo?.titolo, MAX_TITOLO),
    categoria:    pulisci(grezzo?.categoria, 60),
    perche:       pulisci(grezzo?.perche, MAX_TESTO),
    concetti:     pulisciLista(grezzo?.concetti),
    applicazioni: pulisciLista(grezzo?.applicazioni),
    risorse:      pulisciRisorse(grezzo?.risorse),
    domande:      pulisciDomande(grezzo?.domande),
    appunti:      pulisci(grezzo?.appunti),
  };
}
