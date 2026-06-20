// lib/clickup.js
// Helper per le chiamate ClickUp API — Dario Hub

const CU_BASE = "https://api.clickup.com/api/v2";
const CU_BASE_V3 = "https://api.clickup.com/api/v3";
const WORKSPACE_ID = "90121769473";

const LISTS = {
  TO_DO_DAILY: "901218950374",
  ROUTINE_DAILY: "901218950375",
  ROUTINE_SETTIMANALE: "901218950376",
  IN_SOSPESO: "901218950377",
};

const DOCS = {
  MARIO:   { docId: "2kxuu4g1-632", pageId: "2kxuu4g1-392" },
  MIMMO:   { docId: "2kxuu4g1-652", pageId: "2kxuu4g1-412" },
  CARMINE: { docId: "2kxuu4g1-672", pageId: "2kxuu4g1-432" },
  VLAD:    { docId: "2kxuu4g1-692", pageId: "2kxuu4g1-452" },
  BRUNO:   { docId: "2kxuu4g1-732", pageId: "2kxuu4g1-512" },
  STATO_BEA: { docId: "2kxuu4g1-792", pageId: "2kxuu4g1-672" },
};

function headers(apiKey) {
  return {
    Authorization: apiKey,
    "Content-Type": "application/json",
  };
}

// ── TASKS ──────────────────────────────────────────────────

/** Prende i task attivi da una lista */
async function getTasksFromList(listId, apiKey) {
  const statuses = ["da fare", "in corso", "aperto"]
    .map((s) => `statuses[]=${encodeURIComponent(s)}`)
    .join("&");

  const res = await fetch(
    `${CU_BASE}/list/${listId}/task?${statuses}&include_closed=false&subtasks=true`,
    { headers: headers(apiKey) }
  );
  if (!res.ok) throw new Error(`ClickUp tasks error (list ${listId}): ${res.status}`);
  const data = await res.json();
  return data.tasks ?? [];
}

/** Resetta tutte le task di una lista a "da fare" */
async function resetListToDaFare(listId, apiKey) {
  const tasks = await getTasksFromList(listId, apiKey);
  await Promise.all(
    tasks.map((t) =>
      fetch(`${CU_BASE}/task/${t.id}`, {
        method: "PUT",
        headers: headers(apiKey),
        body: JSON.stringify({ status: "da fare" }),
      })
    )
  );
  return tasks;
}

// ── DOCS ───────────────────────────────────────────────────

/** Legge il contenuto di una pagina di un documento ClickUp */
async function getDocPage(docId, pageId, apiKey) {
  const res = await fetch(
    `${CU_BASE_V3}/workspaces/${WORKSPACE_ID}/docs/${docId}/pages/${pageId}?content_format=text/plain`,
    { headers: headers(apiKey) }
  );
  if (!res.ok) throw new Error(`ClickUp doc error (${docId}/${pageId}): ${res.status}`);
  const data = await res.json();
  return data.content ?? "(vuoto)";
}

// ── MORNING BRIEFING ───────────────────────────────────────

/**
 * Raccoglie tutti i dati necessari per il briefing mattutino di Bea.
 * Ritorna un oggetto con tasks e contenuti dei daily update.
 */
export async function fetchMorningContext(apiKey) {
  const isSaturday = new Date().toLocaleDateString("en-US", {
    timeZone: "Europe/Bucharest",
    weekday: "long",
  }) === "Saturday";

  // Fetch parallelo di tutto
  const [
    todoTasks,
    routineDailyTasks,
    inSospestoTasks,
    routineSettimanale,
    marioUpdate,
    mimmoUpdate,
    carmineUpdate,
    vladUpdate,
    brunoUpdate,
    statoBea,
  ] = await Promise.all([
    getTasksFromList(LISTS.TO_DO_DAILY, apiKey),
    resetListToDaFare(LISTS.ROUTINE_DAILY, apiKey), // reset + fetch
    getTasksFromList(LISTS.IN_SOSPESO, apiKey),
    isSaturday ? getTasksFromList(LISTS.ROUTINE_SETTIMANALE, apiKey) : Promise.resolve([]),
    getDocPage(DOCS.MARIO.docId,   DOCS.MARIO.pageId,   apiKey),
    getDocPage(DOCS.MIMMO.docId,   DOCS.MIMMO.pageId,   apiKey),
    getDocPage(DOCS.CARMINE.docId, DOCS.CARMINE.pageId, apiKey),
    getDocPage(DOCS.VLAD.docId,    DOCS.VLAD.pageId,    apiKey),
    getDocPage(DOCS.BRUNO.docId,   DOCS.BRUNO.pageId,   apiKey),
    getDocPage(DOCS.STATO_BEA.docId, DOCS.STATO_BEA.pageId, apiKey),
  ]);

  return {
    isSaturday,
    tasks: {
      todo: todoTasks,
      routineDaily: routineDailyTasks,
      inSospeso: inSospestoTasks,
      routineSettimanale: isSaturday ? routineSettimanale : [],
    },
    dailyUpdates: {
      mario: marioUpdate,
      mimmo: mimmoUpdate,
      carmine: carmineUpdate,
      vlad: vladUpdate,
      bruno: brunoUpdate,
    },
    statoBea,
  };
}

/** Formatta il contesto in testo da iniettare nel system prompt */
export function buildContextString(ctx) {
  const now = new Date().toLocaleString("it-IT", { timeZone: "Europe/Bucharest" });

  const formatTasks = (tasks) =>
    tasks.length === 0
      ? "(nessuna)"
      : tasks.map((t) => `- [${t.status}] ${t.name}${t.priority === "high" ? " 🔴" : ""}`).join("\n");

  return `
=== CONTESTO AGGIORNATO — ${now} (ora di Bucarest) ===

[STATO PROGETTO BEA]
${ctx.statoBea}

[ROUTINE DAILY — resettate a "da fare" ✅]
${formatTasks(ctx.tasks.routineDaily)}

[TO DO DAILY]
${formatTasks(ctx.tasks.todo)}

[IN SOSPESO]
${formatTasks(ctx.tasks.inSospeso)}

${ctx.isSaturday ? `[ROUTINE SETTIMANALE — oggi è sabato]\n${formatTasks(ctx.tasks.routineSettimanale)}\n` : ""}

[MARIO — Daily Update]
${ctx.dailyUpdates.mario}

[MIMMO — Daily Update]
${ctx.dailyUpdates.mimmo}

[CARMINE — Daily Update]
${ctx.dailyUpdates.carmine}

[VLAD — Daily Update]
${ctx.dailyUpdates.vlad}

[BRUNO — Daily Update]
${ctx.dailyUpdates.bruno}

=== FINE CONTESTO ===
`.trim();
}
