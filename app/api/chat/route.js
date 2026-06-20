// app/api/chat/route.js — self-contained, no external imports

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const CU_V2 = "https://api.clickup.com/api/v2";
const CU_V3 = "https://api.clickup.com/api/v3";
const WORKSPACE_ID = "90121769473";

const LISTS = {
  TO_DO_DAILY:         "901218950374",
  ROUTINE_DAILY:       "901218950375",
  ROUTINE_SETTIMANALE: "901218950376",
  IN_SOSPESO:          "901218950377",
};

const DOCS = {
  MARIO:     { docId: "2kxuu4g1-632", pageId: "2kxuu4g1-392" },
  MIMMO:     { docId: "2kxuu4g1-652", pageId: "2kxuu4g1-412" },
  CARMINE:   { docId: "2kxuu4g1-672", pageId: "2kxuu4g1-432" },
  VLAD:      { docId: "2kxuu4g1-692", pageId: "2kxuu4g1-452" },
  BRUNO:     { docId: "2kxuu4g1-732", pageId: "2kxuu4g1-512" },
  STATO_BEA: { docId: "2kxuu4g1-792", pageId: "2kxuu4g1-672" },
};

function cuHeaders(apiKey) {
  return { Authorization: apiKey, "Content-Type": "application/json" };
}

async function getTasksFromList(listId, apiKey) {
  const q = ["da fare", "in corso", "aperto"]
    .map((s) => `statuses[]=${encodeURIComponent(s)}`)
    .join("&");
  const res = await fetch(`${CU_V2}/list/${listId}/task?${q}&include_closed=false`, {
    headers: cuHeaders(apiKey),
  });
  const data = await res.json();
  return data.tasks ?? [];
}

async function resetRoutineDaily(apiKey) {
  const tasks = await getTasksFromList(LISTS.ROUTINE_DAILY, apiKey);
  await Promise.all(
    tasks.map((t) =>
      fetch(`${CU_V2}/task/${t.id}`, {
        method: "PUT",
        headers: cuHeaders(apiKey),
        body: JSON.stringify({ status: "da fare" }),
      })
    )
  );
  return tasks;
}

async function getDocPage(docId, pageId, apiKey) {
  const res = await fetch(
    `${CU_V3}/workspaces/${WORKSPACE_ID}/docs/${docId}/pages/${pageId}?content_format=text/plain`,
    { headers: cuHeaders(apiKey) }
  );
  const data = await res.json();
  return data.content ?? "(vuoto)";
}

function formatTasks(tasks) {
  if (!tasks.length) return "(nessuna)";
  return tasks
    .map((t) => `- [${t.status}] ${t.name}${t.priority === "high" ? " 🔴" : ""}`)
    .join("\n");
}

async function buildMorningContext(apiKey) {
  const isSaturday =
    new Date().toLocaleDateString("en-US", {
      timeZone: "Europe/Bucharest",
      weekday: "long",
    }) === "Saturday";

  const [todo, routineDaily, inSospeso, settimanale, mario, mimmo, carmine, vlad, bruno, stato] =
    await Promise.all([
      getTasksFromList(LISTS.TO_DO_DAILY, apiKey),
      resetRoutineDaily(apiKey),
      getTasksFromList(LISTS.IN_SOSPESO, apiKey),
      isSaturday ? getTasksFromList(LISTS.ROUTINE_SETTIMANALE, apiKey) : Promise.resolve([]),
      getDocPage(DOCS.MARIO.docId,     DOCS.MARIO.pageId,     apiKey),
      getDocPage(DOCS.MIMMO.docId,     DOCS.MIMMO.pageId,     apiKey),
      getDocPage(DOCS.CARMINE.docId,   DOCS.CARMINE.pageId,   apiKey),
      getDocPage(DOCS.VLAD.docId,      DOCS.VLAD.pageId,      apiKey),
      getDocPage(DOCS.BRUNO.docId,     DOCS.BRUNO.pageId,     apiKey),
      getDocPage(DOCS.STATO_BEA.docId, DOCS.STATO_BEA.pageId, apiKey),
    ]);

  const now = new Date().toLocaleString("it-IT", { timeZone: "Europe/Bucharest" });

  return `
=== CONTESTO AGGIORNATO — ${now} (Bucarest) ===

[STATO PROGETTO BEA]
${stato}

[ROUTINE DAILY — resettate a "da fare" ✅]
${formatTasks(routineDaily)}

[TO DO DAILY]
${formatTasks(todo)}

[IN SOSPESO]
${formatTasks(inSospeso)}

${isSaturday ? `[ROUTINE SETTIMANALE — oggi è sabato]\n${formatTasks(settimanale)}\n` : ""}
[MARIO — Daily Update]
${mario}

[MIMMO — Daily Update]
${mimmo}

[CARMINE — Daily Update]
${carmine}

[VLAD — Daily Update]
${vlad}

[BRUNO — Daily Update]
${bruno}

=== FINE CONTESTO ===`.trim();
}

function isMorningGreeting(messages) {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return false;
  const text = (
    typeof last.content === "string" ? last.content : last.content?.[0]?.text ?? ""
  ).toLowerCase().trim();
  return ["buongiorno", "buon giorno", "ciao bea", "morning"].some((g) => text.startsWith(g));
}

function isBea(system) {
  if (!system) return false;
  const text = typeof system === "string" ? system : system?.[0]?.text ?? "";
  return text.toLowerCase().includes("beatrice") || text.toLowerCase().includes("sei la sua assistente");
}

export async function POST(request) {
  try {
    const body = await request.json();
    const clickupKey = process.env.CLICKUP_API_KEY;

    if (clickupKey && isBea(body.system) && isMorningGreeting(body.messages)) {
      const ctx = await buildMorningContext(clickupKey);
      if (typeof body.system === "string") {
        body.system = body.system + "\n\n" + ctx;
      } else if (Array.isArray(body.system)) {
        body.system = [...body.system, { type: "text", text: ctx }];
      }
    }

    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
