// Lettura/scrittura delle pagine del Doc ClickUp usate come database.
//
// Perche' esiste: abitudini, mood e diario della sera vivono in tre pagine
// dello stesso Doc e ognuno si era portato dietro la sua copia di readDoc /
// writeDoc, identiche a meno del marcatore. Con tre copie, un fix (il
// retry sui 429, per dire) andava fatto tre volte e la terza si dimenticava.
//
// L'API Doc v3 di ClickUp e' l'endpoint piu' lento di tutta l'app: mezzo
// secondo scarso quando va bene, secondi interi quando la funzione Vercel
// parte fredda. Da qui la cache.

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const WORKSPACE_ID = "90121769473";

// Doc "Storico Abitudini e Mood (dashboard)".
export const DOC_ID = "2kxuu4g1-972";
export const PAGINE = {
  abitudini:   "2kxuu4g1-1372",
  mood:        "2kxuu4g1-1392",
  gratitudine: "2kxuu4g1-1412",
  decisioni:   "2kxuu4g1-1432",
};

// 45 secondi: abbastanza da coprire un ricaricamento della pagina e i
// rimbalzi tra le tab, troppo poco perche' tu veda dati vecchi senza
// accorgertene. Non e' una cache "vera": su Vercel ogni istanza serverless
// ha la sua memoria, quindi a volte il colpo lo paghi lo stesso. Serve a
// togliere le riletture ravvicinate, non a rendere l'app offline.
const TTL_MS = 45 * 1000;
const cache = new Map(); // pageId -> { dati, scadenza }

export function invalidaPagina(pageId) {
  cache.delete(pageId);
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

// Legge una pagina e ne estrae l'array JSON che segue il marcatore.
//
// forza=true salta la cache: lo usano le scritture, che devono partire dal
// contenuto reale e non da una copia di 40 secondi fa, altrimenti due
// salvataggi ravvicinati si sovrascriverebbero a vicenda.
export async function leggiJson(pageId, marcatore, { forza = false } = {}) {
  if (!CLICKUP_API_KEY) throw new Error("CLICKUP_API_KEY non configurata");

  if (!forza) {
    const hit = cache.get(pageId);
    if (hit && hit.scadenza > Date.now()) return hit.dati;
  }

  const res = await fetchConRetry(
    `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${pageId}?content_format=text/plain`,
    { headers: { Authorization: CLICKUP_API_KEY }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`ClickUp doc error: ${res.status}`);

  const data = await res.json();
  const match = (data.content || "").match(new RegExp(`${marcatore}:([\\s\\S]*)`));

  let dati = [];
  if (match) {
    const grezzo = match[1].trim();
    if (grezzo) {
      try {
        const parsed = JSON.parse(grezzo);
        dati = Array.isArray(parsed) ? parsed : [];
      } catch {
        // Errore esplicito e non lista vuota: un JSON rotto che si legge
        // come "nessun dato" verrebbe cancellato alla prima scrittura.
        throw new Error(`Formato dati non riconosciuto (${marcatore} malformato nel Doc)`);
      }
    }
  }

  cache.set(pageId, { dati, scadenza: Date.now() + TTL_MS });
  return dati;
}

// Scrive la pagina e AGGIORNA la cache col contenuto appena scritto invece
// di svuotarla. Sembra un dettaglio, e' la differenza tra cache utile e
// cache inutile: /api/habits risalva lo snapshot di oggi a ogni GET, quindi
// con la semplice invalidazione la cache sarebbe morta a ogni caricamento.
export async function scriviJson(pageId, intestazione, marcatore, dati) {
  if (!CLICKUP_API_KEY) throw new Error("CLICKUP_API_KEY non configurata");
  const content = `${intestazione}\n\n${marcatore}:${JSON.stringify(dati)}`;
  const res = await fetchConRetry(
    `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${pageId}`,
    {
      method: "PUT",
      headers: { Authorization: CLICKUP_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }
  );
  if (!res.ok) {
    invalidaPagina(pageId);
    throw new Error(`ClickUp doc write error: ${res.status}`);
  }
  cache.set(pageId, { dati, scadenza: Date.now() + TTL_MS });
}
