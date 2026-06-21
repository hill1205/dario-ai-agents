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

// Daily Update documents (letti da Bea nel briefing mattutino)
const DAILY_DOCS = {
  MARIO:   { docId: "2kxuu4g1-632", pageId: "2kxuu4g1-392" },
  MIMMO:   { docId: "2kxuu4g1-652", pageId: "2kxuu4g1-412" },
  CARMINE: { docId: "2kxuu4g1-672", pageId: "2kxuu4g1-432" },
  VLAD:    { docId: "2kxuu4g1-692", pageId: "2kxuu4g1-452" },
  BRUNO:   { docId: "2kxuu4g1-732", pageId: "2kxuu4g1-512" },
};

// STATO PROGETTO documents (memoria persistente di ogni agente)
const STATO_DOCS = {
  bea:     { docId: "2kxuu4g1-792", pageId: "2kxuu4g1-672" },
  mario:   { docId: "2kxuu4g1-872", pageId: "2kxuu4g1-752" },
  mimmo:   { docId: "2kxuu4g1-892", pageId: "2kxuu4g1-772" },
  carmine: { docId: "2kxuu4g1-832", pageId: "2kxuu4g1-712" },
  vlad:    { docId: "2kxuu4g1-812", pageId: "2kxuu4g1-692" },
  bruno:   { docId: "2kxuu4g1-852", pageId: "2kxuu4g1-732" },
};

// Liste ClickUp per ogni agente non-Bea
const AGENT_LISTS = {
  mario: [
    { id: "901218950388", name: "AGENZIA 1M€" },
    { id: "901218950389", name: "CLIENTI" },
    { id: "901218950390", name: "LEADS" },
  ],
  mimmo: [
    { id: "901218950391", name: "FATTURE" },
    { id: "901218950392", name: "SCADENZE" },
    { id: "901218950393", name: "CONTABILITÀ" },
  ],
  carmine: [
    { id: "901218950382", name: "DIETA & PASTI" },
    { id: "901218950383", name: "ALLENAMENTI" },
    { id: "901218950384", name: "PROGRESSI" },
  ],
  vlad: [
    { id: "901218950378", name: "PRATICHE ATTIVE" },
    { id: "901218950379", name: "DOCUMENTI" },
    { id: "901218950381", name: "SCADENZE" },
  ],
  bruno: [
    { id: "901218950385", name: "ENTRATE & USCITE" },
    { id: "901218950386", name: "OBIETTIVI FINANZIARI" },
    { id: "901218950387", name: "INVESTIMENTI" },
  ],
};

function cuHeaders(apiKey) {
  return { Authorization: apiKey, "Content-Type": "application/json" };
}

async function getTasksFromList(listId, apiKey) {
  try {
    const q = ["da fare", "in corso", "aperto"]
      .map((s) => `statuses[]=${encodeURIComponent(s)}`)
      .join("&");
    const res = await fetch(`${CU_V2}/list/${listId}/task?${q}&include_closed=false`, {
      headers: cuHeaders(apiKey),
    });
    const data = await res.json();
    return data.tasks ?? [];
  } catch (err) {
    return [];
  }
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
  try {
    const url = `${CU_V3}/workspaces/${WORKSPACE_ID}/docs/${docId}/pages/${pageId}?content_format=text/plain`;
    const res = await fetch(url, { headers: cuHeaders(apiKey) });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[ClickUp Docs] ${docId}/${pageId} → HTTP ${res.status}: ${errText}`);
      return `(errore HTTP ${res.status})`;
    }
    const data = await res.json();
    return data.content ?? "(vuoto)";
  } catch (err) {
    console.error(`[ClickUp Docs] ${docId}/${pageId} → exception: ${err.message}`);
    return `(eccezione: ${err.message})`;
  }
}

function formatTasks(tasks) {
  if (!tasks.length) return "(nessuna)";
  return tasks
    .map((t) => `- [${t.status?.status ?? t.status ?? "?"}] ${t.name}${t.priority === "high" ? " 🔴" : ""}`)
    .join("\n");
}

// Contesto mattutino completo per Bea
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
      getDocPage(DAILY_DOCS.MARIO.docId,   DAILY_DOCS.MARIO.pageId,   apiKey),
      getDocPage(DAILY_DOCS.MIMMO.docId,   DAILY_DOCS.MIMMO.pageId,   apiKey),
      getDocPage(DAILY_DOCS.CARMINE.docId, DAILY_DOCS.CARMINE.pageId, apiKey),
      getDocPage(DAILY_DOCS.VLAD.docId,    DAILY_DOCS.VLAD.pageId,    apiKey),
      getDocPage(DAILY_DOCS.BRUNO.docId,   DAILY_DOCS.BRUNO.pageId,   apiKey),
      getDocPage(STATO_DOCS.bea.docId,     STATO_DOCS.bea.pageId,     apiKey),
    ]);

  const now = new Date().toLocaleString("it-IT", { timeZone: "Europe/Bucharest" });

  return `
=== CONTESTO AGGIORNATO — ${now} (Bucarest) ===
ISTRUZIONE OBBLIGATORIA: Il briefing mattutino DEVE includere una sezione "📬 Aggiornamenti Assistenti" con il contenuto esatto dei Daily Update qui sotto. Se un Daily Update contiene "(errore...)" o "(vuoto)", scrivilo esplicitamente.

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

// Doc aggiuntivi per agenti specifici
const AGENT_EXTRA_DOCS = {
  mario: [
    { docId: "2kxuu4g1-912", pageId: "2kxuu4g1-792", name: "LISTA 50 TARGET E-COMMERCE" },
  ],
};

// Contesto ClickUp per agenti non-Bea (iniettato al primo messaggio)
async function buildAgentContext(agentId, apiKey) {
  const lists = AGENT_LISTS[agentId];
  const statoDoc = STATO_DOCS[agentId];
  if (!lists || !statoDoc) return "";

  const now = new Date().toLocaleString("it-IT", { timeZone: "Europe/Bucharest" });

  const extraDocs = AGENT_EXTRA_DOCS[agentId] ?? [];

  // Fetch stato progetto + tutte le liste + doc extra in parallelo
  const [stato, ...rest] = await Promise.all([
    getDocPage(statoDoc.docId, statoDoc.pageId, apiKey),
    ...lists.map((l) => getTasksFromList(l.id, apiKey)),
    ...extraDocs.map((d) => getDocPage(d.docId, d.pageId, apiKey)),
  ]);

  const taskResults = rest.slice(0, lists.length);
  const extraDocResults = rest.slice(lists.length);

  let ctx = `=== CONTESTO CLICKUP — ${now} (Bucarest) ===\n\n`;
  ctx += `[STATO PROGETTO — ultima sessione]\n${stato}\n\n`;
  lists.forEach((list, i) => {
    ctx += `[${list.name}]\n${formatTasks(taskResults[i])}\n\n`;
  });
  extraDocs.forEach((doc, i) => {
    ctx += `[${doc.name}]\n${extraDocResults[i]}\n\n`;
  });
  ctx += "=== FINE CONTESTO ===";
  return ctx;
}

function isMorningGreeting(messages) {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return false;
  const text = (
    typeof last.content === "string" ? last.content : last.content?.[0]?.text ?? ""
  ).toLowerCase().trim();
  return ["buongiorno", "buon giorno", "ciao bea", "morning"].some((g) => text.includes(g));
}

function isBea(body) {
  if (body.agentId) return body.agentId === "bea";
  const system = body.system;
  if (!system) return false;
  const allText = Array.isArray(system)
    ? system.map((b) => b.text ?? "").join(" ")
    : String(system);
  return allText.toLowerCase().includes("beatrice");
}

function isFirstMessage(messages) {
  // È il primo messaggio se non ci sono ancora risposte dell'assistente
  return !messages.some((m) => m.role === "assistant");
}

function injectContext(body, ctx) {
  if (typeof body.system === "string") {
    body.system = body.system + "\n\n" + ctx;
  } else if (Array.isArray(body.system)) {
    body.system = [...body.system, { type: "text", text: ctx }];
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const clickupKey = process.env.CLICKUP_API_KEY;
    const agentId = body.agentId;

    if (clickupKey) {
      if (isBea(body) && isMorningGreeting(body.messages)) {
        // Bea: contesto mattutino completo
        const ctx = await buildMorningContext(clickupKey);
        injectContext(body, ctx);
      } else if (agentId } else if (agentId && agentId !== "bea" && AGENT_LISTS[agentId] && isFirstMessage(body.messages)) {} else if (agentId && agentId !== "bea" && AGENT_LISTS[agentId] && isFirstMessage(body.messages)) { agentId !== "bea" } else if (agentId && agentId !== "bea" && AGENT_LISTS[agentId] && isFirstMessage(body.messages)) {} else if (agentId && agentId !== "bea" && AGENT_LISTS[agentId] && isFirstMessage(body.messages)) { AGENT_LISTS[agentId]) {
        // Altri agenti: contesto ClickUp al primo messaggio
        const ctx = await buildAgentContext(agentId, clickupKey);
        if (ctx) injectContext(body, ctx);
      }
    }

    // Rimuovi agentId prima di mandare ad Anthropic
    delete body.agentId;

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
