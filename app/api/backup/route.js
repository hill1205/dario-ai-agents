export const dynamic = "force-dynamic";

import { creaArchivio } from "../../lib/clickup-doc";
import { fetchTuttiITask } from "../../lib/clickup-liste";

// Backup unico di tutti i dati sparsi tra ClickUp e Notion. Nato dal
// problema reale: pipeline lead/clienti vive su Notion, to-do/routine/
// streak/finanze/peso vivono in liste e Doc separati su ClickUp, e non
// esisteva nessun punto di raccolta unico. Se una delle due integrazioni
// si rompe (chiave scaduta, Doc cancellato per errore) oggi non c'è modo
// di recuperare lo storico. Questo endpoint prova a leggere ogni fonte
// indipendentemente dalle altre: se una fallisce, le altre restano nel
// backup e l'errore viene segnalato per quella sezione soltanto, invece
// di far fallire tutto il download per un problema isolato.

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const NOTION_TOKEN    = process.env.NOTION_API_KEY;
const WORKSPACE_ID    = "90121769473";
// Vedi commento in pipeline-data.js: /data_sources/{id}/query richiede 2025-09-03+.
const NOTION_VERSION  = "2025-09-03";
const PIPELINE_DATA_SOURCE_ID = "40f1c1e8-3e35-4fe9-a5b9-87f653a5f2d3";

const TASK_LIST_IDS = {
  todo: "901218950374",
  routine: "901218950375",
  sospeso: "901218950377",
};
const DOCS = {
  streak:         { docId: "2kxuu4g1-952", pageId: "2kxuu4g1-1272", marcatore: "STREAK_DATA_JSON" },
  bruno_finance:  { docId: "2kxuu4g1-712", pageId: "2kxuu4g1-952",  marcatore: "BRUNO_FINANCE_JSON", vuoto: {} },
  iagrex_finance: { docId: "2kxuu4g1-752", pageId: "2kxuu4g1-972",  marcatore: "IAGREX_FINANCE_JSON", vuoto: {} },
  weight:         { docId: "2kxuu4g1-612", pageId: "2kxuu4g1-312",  marcatore: "WEIGHT_DATA_JSON" },
  habits:         { docId: "2kxuu4g1-972", pageId: "2kxuu4g1-1372", marcatore: "HABITS_DATA_JSON" },
  mood:           { docId: "2kxuu4g1-972", pageId: "2kxuu4g1-1392", marcatore: "MOOD_DATA_JSON" },
  // Il diario della sera e' l'unico dato dell'app che non si puo'
  // ricostruire da nessun'altra parte: le finanze stanno anche in banca, le
  // routine anche su ClickUp, ma una sera scritta e persa e' persa.
  gratitudine:    { docId: "2kxuu4g1-972", pageId: "2kxuu4g1-1412", marcatore: "GRATITUDE_DATA_JSON" },
  // Registro decisioni (07/08). Vale lo stesso ragionamento del diario:
  // il "perché" di una scelta non è ricostruibile da nessun'altra fonte.
  // Il fatturato di una decisione lo ritrovi in banca, il ragionamento che
  // ti ci ha portato no.
  decisioni:      { docId: "2kxuu4g1-972", pageId: "2kxuu4g1-1432", marcatore: "DECISIONS_DATA_JSON" },
  // Percorso di apprendimento (07/08). Le spiegazioni scritte con parole
  // proprie per alzare il livello sono l'unico contenuto di questa pagina
  // che non esiste da nessun'altra parte: gli appunti li puoi rifare,
  // quelle no.
  apprendimento:  { docId: "2kxuu4g1-972", pageId: "2kxuu4g1-1452", marcatore: "LEARNING_DATA_JSON" },
};

async function safe(label, fn) {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, error: `${label}: ${e.message}` }; }
}

async function fetchTaskList(listId) {
  // include_closed=true qui (a differenza di /api/tasks che alimenta la
  // dashboard live): per un backup vogliamo anche i task già completati,
  // non solo quelli ancora aperti.
  //
  // Ed è proprio per questo che la paginazione qui è più urgente che altrove:
  // le task chiuse si accumulano per sempre, quindi questa è la chiamata che
  // supererà le 100 per prima — e un backup troncato in silenzio è il tipo di
  // guasto che scopri solo quando ti serve il backup.
  return fetchTuttiITask(listId, { apiKey: CLICKUP_API_KEY, includeClosed: true });
}

// Un backup deve leggere il Doc adesso, non una copia in cache di 40
// secondi fa: forza=true.
function fetchDoc(sorgente) {
  return creaArchivio(sorgente).leggi({ forza: true });
}

async function fetchNotionPipeline() {
  if (!NOTION_TOKEN) throw new Error("NOTION_API_KEY non configurata");
  let entries = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${PIPELINE_DATA_SOURCE_ID}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ start_cursor: cursor, page_size: 100 }),
    });
    if (!res.ok) throw new Error(`Notion error ${res.status}`);
    const data = await res.json();
    entries.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return entries;
}

export async function GET() {
  const [todo, routine, sospeso, streak, brunoFinance, iagrexFinance, weight, pipeline, habits, moodData, gratitudine, decisioni, apprendimento] = await Promise.all([
    safe("ClickUp · to-do",           () => fetchTaskList(TASK_LIST_IDS.todo)),
    safe("ClickUp · routine",         () => fetchTaskList(TASK_LIST_IDS.routine)),
    safe("ClickUp · sospeso",         () => fetchTaskList(TASK_LIST_IDS.sospeso)),
    safe("ClickUp · streak routine",  () => fetchDoc(DOCS.streak)),
    safe("ClickUp · finanze personali", () => fetchDoc(DOCS.bruno_finance)),
    safe("ClickUp · finanze IAGREX",  () => fetchDoc(DOCS.iagrex_finance)),
    safe("ClickUp · peso",            () => fetchDoc(DOCS.weight)),
    safe("Notion · pipeline lead/clienti", () => fetchNotionPipeline()),
    safe("ClickUp · storico abitudini", () => fetchDoc(DOCS.habits)),
    safe("ClickUp · mood",              () => fetchDoc(DOCS.mood)),
    safe("ClickUp · diario della sera", () => fetchDoc(DOCS.gratitudine)),
    safe("ClickUp · registro decisioni", () => fetchDoc(DOCS.decisioni)),
    safe("ClickUp · percorso apprendimento", () => fetchDoc(DOCS.apprendimento)),
  ]);

  const sections = { todo, routine, sospeso, streak, bruno_finance: brunoFinance, iagrex_finance: iagrexFinance, weight, pipeline, habits, mood: moodData, gratitudine, decisioni, apprendimento };
  const errors = Object.entries(sections).filter(([,v]) => !v.ok).map(([k,v]) => ({ section: k, error: v.error }));

  return Response.json({
    generated_at: new Date().toISOString(),
    note: "Backup completo: da 07/08 ogni fonte viene letta lato server, niente più sezioni aggiunte dal client.",
    errors,
    data: {
      todo: todo.ok ? todo.data : null,
      routine: routine.ok ? routine.data : null,
      sospeso: sospeso.ok ? sospeso.data : null,
      streak: streak.ok ? streak.data : null,
      bruno_finance: brunoFinance.ok ? brunoFinance.data : null,
      iagrex_finance: iagrexFinance.ok ? iagrexFinance.data : null,
      weight: weight.ok ? weight.data : null,
      pipeline: pipeline.ok ? pipeline.data : null,
      habits: habits.ok ? habits.data : null,
      mood: moodData.ok ? moodData.data : null,
      gratitudine: gratitudine.ok ? gratitudine.data : null,
      decisioni: decisioni.ok ? decisioni.data : null,
      apprendimento: apprendimento.ok ? apprendimento.data : null,
    },
  });
}
