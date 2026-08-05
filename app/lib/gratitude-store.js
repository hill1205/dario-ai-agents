// Lettura/scrittura del diario serale sul Doc ClickUp.
//
// Stesso schema di habits-store e mood: pagina dedicata dentro il Doc
// "Storico Abitudini e Mood (dashboard)", contenuto in chiaro con un
// marcatore JSON in coda. Vive in lib e non dentro la route per la stessa
// ragione delle abitudini: se un domani il cron o il bot Telegram devono
// leggerlo, non possono passare da fetch (Basic Auth nel middleware).
//
// Forma di una voce:
//   { data:"YYYY-MM-DD", voci:["","",""], vittoria:"", perche:"", ts }
//
// voci     = le tre cose per cui sei grato. La prima e' quella che conta:
//            le altre due possono restare vuote senza che il giorno sia
//            considerato saltato.
// vittoria = la cosa concreta fatta oggi. Tenuta separata dalla gratitudine
//            di proposito: sono due dataset diversi. La gratitudine dice
//            come stavi, la vittoria dice cosa hai prodotto. Nei giorni in
//            cui la dashboard segna 0€ ma hai lavorato davvero, questa
//            riga e' l'unica traccia che resta.
// perche   = campo libero, facoltativo. Il "come mai ho scelto queste cose".
//            E' l'unico posto dove finisce il contesto, ed e' anche la
//            parte che tra sei mesi vale piu' delle tre righe sopra.

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const WORKSPACE_ID = "90121769473";
// Doc "Storico Abitudini e Mood (dashboard)" — pagina Gratitudine.
const DOC_ID = "2kxuu4g1-972";
const PAGE_ID = "2kxuu4g1-1412";

export const N_VOCI = 3;
const MAX_LEN = 500;
const MAX_LEN_PERCHE = 2000;

// Data nel fuso di Dario. Duplicata da habits-store? No: la importiamo.
// Qui la ri-esportiamo solo per comodita' di chi importa questo modulo.
export { bucharestDate } from "./habits-store";
import { bucharestDate } from "./habits-store";

async function readDoc() {
  if (!CLICKUP_API_KEY) throw new Error("CLICKUP_API_KEY non configurata");
  const res = await fetch(
    `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${PAGE_ID}?content_format=text/plain`,
    { headers: { Authorization: CLICKUP_API_KEY }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`ClickUp doc error: ${res.status}`);
  const data = await res.json();
  const match = (data.content || "").match(/GRATITUDE_DATA_JSON:([\s\S]*)/);
  if (!match) return [];
  const grezzo = match[1].trim();
  if (!grezzo) return [];
  try {
    const parsed = JSON.parse(grezzo);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Errore esplicito e non lista vuota: un JSON rotto che si legge come
    // "nessuna voce" cancellerebbe lo storico alla prima scrittura.
    throw new Error("Formato dati gratitudine non riconosciuto (JSON malformato nel Doc)");
  }
}

async function writeDoc(days) {
  const content = `DIARIO SERALE DARIO\n\nNon modificare a mano: viene letto/scritto dalla dashboard.\nOgni voce: { data, voci:[3 gratitudini], vittoria, perche, ts }\nSi compila la sera, si congela a mezzanotte di Bucarest.\n\nGRATITUDE_DATA_JSON:${JSON.stringify(days)}`;
  const res = await fetch(
    `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${PAGE_ID}`,
    {
      method: "PUT",
      headers: { Authorization: CLICKUP_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }
  );
  if (!res.ok) throw new Error(`ClickUp doc write error: ${res.status}`);
}

const pulisci = (v, max = MAX_LEN) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

// Un giorno "conta" se c'e' almeno la prima gratitudine o la vittoria.
// Il campo libero da solo non basta: e' un commento, non il diario.
export function compilato(voce) {
  if (!voce) return false;
  const prima = (voce.voci || [])[0];
  return Boolean(pulisci(prima) || pulisci(voce.vittoria));
}

// Normalizza una voce in arrivo dal client.
export function normalizza(body, prev = {}) {
  const vociIn = Array.isArray(body.voci) ? body.voci : prev.voci || [];
  const voci = [];
  for (let i = 0; i < N_VOCI; i++) voci.push(pulisci(vociIn[i]));
  return {
    voci,
    vittoria: pulisci(body.vittoria !== undefined ? body.vittoria : prev.vittoria),
    perche: pulisci(body.perche !== undefined ? body.perche : prev.perche, MAX_LEN_PERCHE),
  };
}

export async function readGratitude() {
  return (await readDoc()).sort((a, b) => (a.data < b.data ? -1 : 1));
}

// Scrive (o aggiorna) la voce di un giorno.
//
// Regola di congelamento: si puo' scrivere SOLO il giorno in corso, ora di
// Bucarest. Le sere passate sono chiuse. Il mood e' bloccato dopo un
// minuto e la nota abitudini non e' bloccata affatto; la gratitudine sta
// nel mezzo, e la ragione e' che deve restare rileggibile: se a marzo puoi
// riscrivere una sera di gennaio, tra sei mesi non stai rileggendo cosa
// provavi ma cosa ti fa comodo aver provato.
export async function salvaGiorno(body) {
  const oggi = bucharestDate(0);
  const day = body.data || oggi;
  if (day !== oggi) {
    return {
      ok: false,
      status: 409,
      errore: "Il diario di una sera passata non si può più modificare.",
      congelato: true,
    };
  }

  const days = await readDoc();
  const idx = days.findIndex((d) => d.data === day);
  const prev = idx >= 0 ? days[idx] : {};
  const entry = { data: day, ...normalizza(body, prev), ts: Date.now() };

  if (idx >= 0) days[idx] = entry;
  else days.push(entry);

  const sorted = days.sort((a, b) => (a.data < b.data ? -1 : 1));
  await writeDoc(sorted);
  return { ok: true, entry };
}
