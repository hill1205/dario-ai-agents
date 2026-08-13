// L'UNICO punto dell'app che legge e scrive le pagine dei Doc ClickUp usate
// come database (abitudini, mood, diario, decisioni, apprendimento, peso,
// streak, finanze IAGREX e personali).
//
// PERCHE' E' UNO SOLO
// Prima ogni pagina aveva la sua copia di "leggi la pagina, cerca il
// marcatore, fai JSON.parse": sette copie quasi identiche sparse tra
// lib/ e le route. Con sette copie, un fix va fatto sette volte e la
// settima si dimentica — ed e' esattamente quello che e' successo con il
// bug dei backslash del 13/08/2026 (vedi doc-payload.js): un solo carattere
// scritto da Dario rendeva illeggibile lo storico di un'intera pagina, e la
// correzione ha dovuto toccare sette file.
//
// Da qui in poi: una pagina-database nuova si dichiara con creaArchivio(),
// non si riscrive la logica. scripts/build-check.sh fa fallire la build se
// qualcuno ricomincia a parlare con i Doc ClickUp per conto suo.
//
// L'API Doc v3 di ClickUp e' l'endpoint piu' lento di tutta l'app: mezzo
// secondo scarso quando va bene, secondi interi quando la funzione Vercel
// parte fredda. Da qui la cache.

import { codificaPayload, decodificaPayload } from "./doc-payload";

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const WORKSPACE_ID = "90121769473";

// Doc "Storico Abitudini e Mood (dashboard)".
export const DOC_ID = "2kxuu4g1-972";
export const PAGINE = {
  abitudini:   "2kxuu4g1-1372",
  mood:        "2kxuu4g1-1392",
  gratitudine: "2kxuu4g1-1412",
  decisioni:   "2kxuu4g1-1432",
  apprendimento: "2kxuu4g1-1452",
};

// 45 secondi: abbastanza da coprire un ricaricamento della pagina e i
// rimbalzi tra le tab, troppo poco perche' tu veda dati vecchi senza
// accorgertene. Non e' una cache "vera": su Vercel ogni istanza serverless
// ha la sua memoria, quindi a volte il colpo lo paghi lo stesso. Serve a
// togliere le riletture ravvicinate, non a rendere l'app offline.
const TTL_MS = 45 * 1000;
const cache = new Map(); // "docId/pageId" -> { dati, rev, scadenza }

// --- Numero di versione (13/08/2026) ----------------------------------------
// Le pagine Finanze salvano SEMPRE l'oggetto intero (tutti i mesi) a ogni
// modifica. Finche' si lavora da un dispositivo alla volta va bene; se apri
// Finanze sul Mac e sul telefono insieme, il secondo che salva riscrive tutto
// con la propria copia e le modifiche dell'altro spariscono senza un errore,
// senza un avviso, senza modo di accorgersene finche' non si va a cercare un
// movimento che non c'e' piu'.
//
// Ora ogni pagina porta in testa la sua versione:
//
//     REV:7
//     IAGREX_FINANCE_JSON:B64,eyJ...
//
// Chi legge si porta dietro il numero; chi scrive lo dichiara. Se nel
// frattempo la versione sul server e' cambiata, la scrittura viene RIFIUTATA
// (409) invece di sovrascrivere. Meglio un "ricarica, qualcuno ha salvato
// prima di te" che un movimento sparito in silenzio.
//
// La riga REV sta PRIMA del marcatore dei dati apposta: la regex di lettura
// del payload e' golosa fino a fine contenuto, quindi qualsiasi cosa messa
// dopo verrebbe inghiottita dentro il base64.
//
// Le pagine scritte prima di oggi non hanno la riga REV: valgono 0 e si
// allineano da sole alla prima scrittura. Nessuna migrazione da fare.
const REV_MARCATORE = "REV";

export class ConflittoVersione extends Error {
  constructor(revAttesa, revTrovata) {
    super(
      "Questi dati sono stati modificati da un altro dispositivo dopo che li hai aperti. " +
      "Ricarica la pagina prima di salvare, così non sovrascrivi quelle modifiche."
    );
    this.name = "ConflittoVersione";
    this.conflitto = true;
    this.revAttesa = revAttesa;
    this.revTrovata = revTrovata;
  }
}

// La chiave include il docId: gli id di pagina non sono unici tra Doc
// diversi (2kxuu4g1-972 e' insieme un doc e una pagina di un altro doc), e
// una collisione qui vorrebbe dire servire le finanze IAGREX al posto del
// diario.
const chiave = (docId, pageId) => `${docId}/${pageId}`;

export function invalidaPagina(pageId, docId = DOC_ID) {
  cache.delete(chiave(docId, pageId));
}

// ClickUp limita a 100 richieste al minuto per token, e la stessa chiave la
// usano dashboard, cron notturno e bot Telegram. Un 429 va riprovato, non
// trasformato in "storico vuoto": senza questo, un limite superato per
// mezzo secondo si legge in griglia come una giornata in cui non hai fatto
// niente.
async function fetchConRetry(url, opts, tentativi = 2) {
  let ultimo;
  for (let i = 0; i <= tentativi; i++) {
    const res = await fetch(url, opts);
    if (res.status !== 429 && res.status < 500) return res;
    ultimo = res;
    if (i < tentativi) await new Promise(r => setTimeout(r, 400 * (i + 1)));
  }
  return ultimo;
}

const urlPagina = (docId, pageId) =>
  `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${docId}/pages/${pageId}`;

// Legge una pagina e ne estrae il valore che segue il marcatore.
// Restituisce null se il marcatore non c'e' ancora (pagina nuova: caso
// legittimo, non un errore).
//
// forza=true salta la cache: lo usano le scritture, che devono partire dal
// contenuto reale e non da una copia di 40 secondi fa, altrimenti due
// salvataggi ravvicinati si sovrascriverebbero a vicenda.
// Restituisce { dati, rev }. rev = 0 sulle pagine scritte prima
// dell'introduzione del versionamento (nessuna riga REV) e sulle pagine nuove.
async function leggiPagina(docId, pageId, marcatore, { forza = false } = {}) {
  if (!CLICKUP_API_KEY) throw new Error("CLICKUP_API_KEY non configurata");

  if (!forza) {
    const hit = cache.get(chiave(docId, pageId));
    if (hit && hit.scadenza > Date.now()) return { dati: hit.dati, rev: hit.rev };
  }

  const res = await fetchConRetry(
    `${urlPagina(docId, pageId)}?content_format=text/plain`,
    { headers: { Authorization: CLICKUP_API_KEY }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`ClickUp doc error: ${res.status}`);

  const data = await res.json();
  const contenuto = data.content || "";

  // La riga REV sta sopra al marcatore dei dati: si legge separatamente e
  // prima, perche' la regex del payload arriva fino a fine contenuto.
  const mRev = contenuto.match(new RegExp(`(?:^|\\n)${REV_MARCATORE}:(\\d+)\\s*(?:\\n|$)`));
  const rev = mRev ? parseInt(mRev[1], 10) || 0 : 0;

  const match = contenuto.match(new RegExp(`${marcatore}:([\\s\\S]*)`));

  let dati = null;
  if (match) {
    try {
      dati = decodificaPayload(match[1]);
    } catch {
      // Errore esplicito e non "nessun dato": un contenuto rotto letto come
      // vuoto verrebbe cancellato alla prima scrittura.
      throw new Error(`Formato dati non riconosciuto (${marcatore} malformato nel Doc)`);
    }
  }

  cache.set(chiave(docId, pageId), { dati, rev, scadenza: Date.now() + TTL_MS });
  return { dati, rev };
}

// Scrive la pagina e AGGIORNA la cache col contenuto appena scritto invece
// di svuotarla. Sembra un dettaglio, e' la differenza tra cache utile e
// cache inutile: /api/abitudini-tutto risalva lo snapshot di oggi a ogni GET,
// quindi con la semplice invalidazione la cache sarebbe morta a ogni
// caricamento della pagina Abitudini.
// revAttesa: se valorizzata, la scrittura avviene solo se la pagina sul
// server e' ancora a quella versione. Altrimenti ConflittoVersione, e i dati
// dell'altro dispositivo restano dove sono.
async function scriviPagina(docId, pageId, intestazione, marcatore, dati, { revAttesa = null } = {}) {
  if (!CLICKUP_API_KEY) throw new Error("CLICKUP_API_KEY non configurata");

  // Da dove viene la versione corrente, e perche' non si rilegge sempre.
  //
  // Quando c'e' una revAttesa da verificare (le Finanze, che salvano tutto
  // l'oggetto da un client che puo' avere una copia vecchia di ore) si va a
  // leggere il server saltando la cache: e' proprio la copia vecchia il
  // problema da intercettare, e 400ms valgono la certezza.
  //
  // Negli altri casi no. Tutte le scritture degli store in lib/ sono precedute
  // nella stessa richiesta da una readDoc({forza:true}), che lascia in cache
  // la versione appena letta dal server: rileggerla sarebbe una seconda
  // chiamata ClickUp identica alla prima, su ogni singolo salvataggio di
  // abitudini, mood, diario, decisioni e apprendimento. Si legge davvero solo
  // se in cache non c'e' niente.
  let revCorrente;
  const verifica = revAttesa !== null && revAttesa !== undefined;
  const inCache = cache.get(chiave(docId, pageId));
  if (!verifica && inCache) {
    revCorrente = inCache.rev || 0;
  } else {
    revCorrente = (await leggiPagina(docId, pageId, marcatore, { forza: true })).rev;
  }
  if (verifica && Number(revAttesa) !== revCorrente) {
    throw new ConflittoVersione(Number(revAttesa), revCorrente);
  }

  const nuovaRev = revCorrente + 1;
  const corpo = `${REV_MARCATORE}:${nuovaRev}\n${marcatore}:${codificaPayload(dati)}`;
  const content = intestazione ? `${intestazione}\n\n${corpo}` : corpo;
  const res = await fetchConRetry(urlPagina(docId, pageId), {
    method: "PUT",
    headers: { Authorization: CLICKUP_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    cache.delete(chiave(docId, pageId));
    throw new Error(`ClickUp doc write error: ${res.status}`);
  }
  cache.set(chiave(docId, pageId), { dati, rev: nuovaRev, scadenza: Date.now() + TTL_MS });
  return nuovaRev;
}

// Dichiara una pagina-database. E' il modo giusto di aggiungerne una nuova:
// tutto quello che c'e' da sapere sta nei parametri, la logica non si
// riscrive.
//
//   vuoto        forma da restituire quando la pagina non ha ancora dati
//                ([] per gli storici, {} per le finanze). Serve anche come
//                controllo di tipo: se la pagina contiene qualcosa della
//                forma sbagliata si riparte dal vuoto invece di far
//                esplodere il chiamante.
//   intestazione testo leggibile sopra i dati; puo' essere una funzione dei
//                dati (il peso ci scrive dentro l'ultimo valore).
//   senzaCache   true per i dati che il frontend risalva per intero (le
//                finanze salvano TUTTI i mesi a ogni modifica): li' una
//                lettura vecchia di 40 secondi puo' diventare una
//                sovrascrittura sbagliata, e 400ms di ClickUp valgono meno
//                del rischio.
export function creaArchivio({ docId = DOC_ID, pageId, marcatore, intestazione = "", vuoto = [], senzaCache = false }) {
  const attesoArray = Array.isArray(vuoto);
  const formaOk = (v) => (attesoArray ? Array.isArray(v) : v !== null && typeof v === "object" && !Array.isArray(v));
  const nuovoVuoto = () => (attesoArray ? [] : {});

  return {
    // Comportamento invariato per tutti i chiamanti esistenti: restituisce i
    // dati e basta.
    async leggi(opts) {
      const { dati } = await leggiPagina(docId, pageId, marcatore, senzaCache ? { ...opts, forza: true } : opts);
      return formaOk(dati) ? dati : nuovoVuoto();
    },
    // Come leggi(), ma restituisce anche il numero di versione. La usano gli
    // endpoint che consegnano i dati a una pagina che poi li risalvera' per
    // intero, e che quindi deve poter dichiarare da quale versione parte.
    async leggiConRev(opts) {
      const { dati, rev } = await leggiPagina(docId, pageId, marcatore, senzaCache ? { ...opts, forza: true } : opts);
      return { dati: formaOk(dati) ? dati : nuovoVuoto(), rev };
    },
    // opts.revAttesa → scrittura condizionata (lancia ConflittoVersione).
    // Senza, il comportamento e' quello di sempre: ultimo che scrive vince.
    scrivi(dati, opts = {}) {
      const testa = typeof intestazione === "function" ? intestazione(dati) : intestazione;
      return scriviPagina(docId, pageId, testa, marcatore, dati, opts);
    },
    invalida() { cache.delete(chiave(docId, pageId)); },
  };
}

// Scorciatoie per le pagine del Doc principale, usate dagli store in lib/.
export async function leggiJson(pageId, marcatore, opts) {
  const { dati } = await leggiPagina(DOC_ID, pageId, marcatore, opts);
  return Array.isArray(dati) ? dati : [];
}

export function scriviJson(pageId, intestazione, marcatore, dati) {
  return scriviPagina(DOC_ID, pageId, intestazione, marcatore, dati);
}
