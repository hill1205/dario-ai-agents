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
const cache = new Map(); // "docId/pageId" -> { dati, scadenza }

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
async function leggiPagina(docId, pageId, marcatore, { forza = false } = {}) {
  if (!CLICKUP_API_KEY) throw new Error("CLICKUP_API_KEY non configurata");

  if (!forza) {
    const hit = cache.get(chiave(docId, pageId));
    if (hit && hit.scadenza > Date.now()) return hit.dati;
  }

  const res = await fetchConRetry(
    `${urlPagina(docId, pageId)}?content_format=text/plain`,
    { headers: { Authorization: CLICKUP_API_KEY }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`ClickUp doc error: ${res.status}`);

  const data = await res.json();
  const match = (data.content || "").match(new RegExp(`${marcatore}:([\\s\\S]*)`));

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

  cache.set(chiave(docId, pageId), { dati, scadenza: Date.now() + TTL_MS });
  return dati;
}

// Scrive la pagina e AGGIORNA la cache col contenuto appena scritto invece
// di svuotarla. Sembra un dettaglio, e' la differenza tra cache utile e
// cache inutile: /api/habits risalva lo snapshot di oggi a ogni GET, quindi
// con la semplice invalidazione la cache sarebbe morta a ogni caricamento.
async function scriviPagina(docId, pageId, intestazione, marcatore, dati) {
  if (!CLICKUP_API_KEY) throw new Error("CLICKUP_API_KEY non configurata");
  const corpo = `${marcatore}:${codificaPayload(dati)}`;
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
  cache.set(chiave(docId, pageId), { dati, scadenza: Date.now() + TTL_MS });
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
    async leggi(opts) {
      const v = await leggiPagina(docId, pageId, marcatore, senzaCache ? { ...opts, forza: true } : opts);
      return formaOk(v) ? v : nuovoVuoto();
    },
    scrivi(dati) {
      const testa = typeof intestazione === "function" ? intestazione(dati) : intestazione;
      return scriviPagina(docId, pageId, testa, marcatore, dati);
    },
    invalida() { cache.delete(chiave(docId, pageId)); },
  };
}

// Scorciatoie per le pagine del Doc principale, usate dagli store in lib/.
export async function leggiJson(pageId, marcatore, opts) {
  const v = await leggiPagina(DOC_ID, pageId, marcatore, opts);
  return Array.isArray(v) ? v : [];
}

export function scriviJson(pageId, intestazione, marcatore, dati) {
  return scriviPagina(DOC_ID, pageId, intestazione, marcatore, dati);
}
