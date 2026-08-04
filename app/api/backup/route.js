export const dynamic = "force-dynamic";

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
  streak:         { docId: "2kxuu4g1-952", pageId: "2kxuu4g1-1272", marker: "STREAK_DATA_JSON:" },
  bruno_finance:  { docId: "2kxuu4g1-712", pageId: "2kxuu4g1-952",  marker: "BRUNO_FINANCE_JSON:" },
  iagrex_finance: { docId: "2kxuu4g1-752", pageId: "2kxuu4g1-972",  marker: "IAGREX_FINANCE_JSON:" },
  weight:         { docId: "2kxuu4g1-612", pageId: "2kxuu4g1-312",  marker: "WEIGHT_DATA_JSON:" },
  habits:         { docId: "2kxuu4g1-972", pageId: "2kxuu4g1-1372", marker: "HABITS_DATA_JSON:" },
  mood:           { docId: "2kxuu4g1-972", pageId: "2kxuu4g1-1392", marker: "MOOD_DATA_JSON:" },
};

async function safe(label, fn) {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, error: `${label}: ${e.message}` }; }
}

async function fetchTaskList(listId) {
  if (!CLICKUP_API_KEY) throw new Error("CLICKUP_API_KEY non configurata");
  // include_closed=true qui (a differenza di /api/tasks che alimenta la
  // dashboard live): per un backup vogliamo anche i task già completati,
  // non solo quelli ancora aperti.
  const res = await fetch(
    `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=true`,
    { headers: { Authorization: CLICKUP_API_KEY }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`ClickUp list ${listId} error: ${res.status}`);
  const data = await res.json();
  return data.tasks || [];
}

async function fetchDoc({ docId, pageId, marker }) {
  if (!CLICKUP_API_KEY) throw new Error("CLICKUP_API_KEY non configurata");
  const res = await fetch(
    `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${docId}/pages/${pageId}?content_format=text/plain`,
    { headers: { Authorization: CLICKUP_API_KEY }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`ClickUp doc ${docId} error: ${res.status}`);
  const page = await res.json();
  const content = page.content || "";
  const idx = content.indexOf(marker);
  if (idx === -1) return null; // pagina esistente ma senza dati ancora: caso legittimo
  const raw = content.slice(idx + marker.length).trim();
  return JSON.parse(raw);
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
  const [todo, routine, sospeso, streak, brunoFinance, iagrexFinance, weight, pipeline, habits, moodData] = await Promise.all([
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
  ]);

  const sections = { todo, routine, sospeso, streak, bruno_finance: brunoFinance, iagrex_finance: iagrexFinance, weight, pipeline, habits, mood: moodData };
  const errors = Object.entries(sections).filter(([,v]) => !v.ok).map(([k,v]) => ({ section: k, error: v.error }));

  return Response.json({
    generated_at: new Date().toISOString(),
    note: "Le idee vocali (archivio 🎙️) non sono incluse qui: vengono aggiunte lato client prima del download, perché vivono in localStorage/Notion a seconda della sezione.",
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
    },
  });
}
