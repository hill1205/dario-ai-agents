// app/api/chat/route.js — self-contained, no external imports
//
// COSA FA OGGI
// Proxy verso l'API Anthropic per la generazione dei messaggi ai lead
// (PipelinePage.jsx, agentId "mario"): la chiave sta su Vercel e non nel
// browser, e la route ci attacca il contesto ClickUp dell'agente.
//
// COSA NON FA PIU' (13/08/2026)
// Fino a oggi qui dentro c'era anche il "briefing del mattino": se scrivevi
// "buongiorno" a Bea, buildMorningContext() chiamava resetRoutineDaily(), che
// scriveva su ClickUp. Tre cose sbagliate in una:
//   1. un messaggio di saluto che scrive su ClickUp, nascosto dentro una
//      funzione che si chiama "build..." — nessuno se lo aspetta;
//   2. non resettava niente. getTasksFromList filtra statuses[]=da fare|in
//      corso|aperto con include_closed=false, quindi le routine COMPLETATE
//      non tornavano indietro: la PUT "da fare" cadeva solo su task gia' "da
//      fare". Chiamate ClickUp buttate;
//   3. l'intestazione diceva [ROUTINE DAILY — resettate a "da fare"] mentre
//      la lista conteneva solo le routine ancora aperte.
// Il reset vero ce l'abbiamo dove deve stare: /api/cron/reset a mezzanotte di
// Bucarest, che prima di azzerare salva anche lo snapshot delle abitudini —
// cosa che questo non faceva. Dario ha confermato che il "buongiorno Bea" non
// lo usa piu': tolto tutto il ramo, con le mappe che serviva solo a lui.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const CU_V2 = "https://api.clickup.com/api/v2";
const CU_V3 = "https://api.clickup.com/api/v3";
const WORKSPACE_ID = "90121769473";

// Doc "stato progetto" per agente: l'ultima sessione di lavoro, così l'agente
// non riparte da zero ogni volta.
const STATO_DOCS = {
  mario:   { docId: "2kxuu4g1-872", pageId: "2kxuu4g1-752" },
  mimmo:   { docId: "2kxuu4g1-892", pageId: "2kxuu4g1-772" },
  carmine: { docId: "2kxuu4g1-832", pageId: "2kxuu4g1-712" },
  vlad:    { docId: "2kxuu4g1-812", pageId: "2kxuu4g1-692" },
  bruno:   { docId: "2kxuu4g1-852", pageId: "2kxuu4g1-732" },
};

const AGENT_LISTS = {
  mario: [
    { id: "901218950388", name: "AGENZIA 1M€" },
    { id: "901218950389", name: "CLIENTI" },
    { id: "901218950390", name: "LEADS" },
  ],
  mimmo: [
    { id: "901218950391", name: "FATTURE" },
    { id: "901218950392", name: "SCADENZE" },
    { id: "901218950393", name: "CONTABILITA" },
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

// Doc aggiuntivi — format: text/md per tabelle rich
const AGENT_EXTRA_DOCS = {
  mario: [
    { docId: "2kxuu4g1-912", pageId: "2kxuu4g1-792", name: "LISTA 50 TARGET E-COMMERCE", format: "text/md" },
  ],
};

// --- Tetto di spesa ---------------------------------------------------------
// Questa route inoltrava il body VERBATIM all'API Anthropic: model, max_tokens
// e messages arrivavano dal browser senza nessun controllo. E' dietro Basic
// Auth, quindi non e' un buco di sicurezza — ma e' un buco nel portafoglio:
// un bug nel client (un ciclo, un max_tokens con uno zero di troppo) si
// traduce direttamente in fattura. Qui mettiamo i due paletti che costano
// niente e chiudono il caso.
// Volutamente un CONTROLLO DI FORMA e non una lista chiusa di id: la lista
// esatta invecchia (PipelinePage manda "claude-sonnet-4-6", che tra sei mesi
// sara' un altro nome) e un elenco tassativo qui vorrebbe dire rompere la
// generazione messaggi al primo cambio di modello, in silenzio e in
// produzione. Il rischio da coprire e' la spesa, e la spesa la governa
// max_tokens: qui basta impedire che finisca in body un valore arbitrario.
const MODELLO_VALIDO = /^claude-[a-z0-9.\-]{3,60}$/;
const MODELLO_DEFAULT = "claude-haiku-4-5-20251001";
const MAX_TOKENS_CAP = 4000;

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
    // I contenitori ⚙️ sono storage, non task: fuori anche dal contesto
    // passato agli agenti, altrimenti leggono JSON al posto del lavoro.
    // Duplicato di app/lib/system-tasks.js: questo file e' volutamente
    // senza import esterni (vedi intestazione).
    return (data.tasks ?? []).filter(
      (t) => !(typeof t?.name === "string" && t.name.trim().startsWith("⚙️"))
    );
  } catch (err) {
    return [];
  }
}

async function getDocPage(docId, pageId, apiKey, format = "text/plain") {
  try {
    const url = `${CU_V3}/workspaces/${WORKSPACE_ID}/docs/${docId}/pages/${pageId}?content_format=${encodeURIComponent(format)}`;
    const res = await fetch(url, { headers: cuHeaders(apiKey) });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[ClickUp Docs] ${docId}/${pageId} -> HTTP ${res.status}: ${errText}`);
      return `(errore HTTP ${res.status})`;
    }
    const data = await res.json();
    return data.content ?? "(vuoto)";
  } catch (err) {
    console.error(`[ClickUp Docs] ${docId}/${pageId} -> exception: ${err.message}`);
    return `(eccezione: ${err.message})`;
  }
}

// L'API v2 restituisce la priorita' come OGGETTO ({priority:"high",...}), non
// come stringa: il vecchio `t.priority === "high"` era sempre falso e il 🔴
// non compariva mai. Stessa logica di priorityOf() in app/lib/habits-store.js,
// riscritta qui perche' questo file non importa nulla.
function priorityOf(t) {
  const p = t?.priority;
  return (typeof p === "string" ? p : p?.priority || "").toLowerCase();
}

function formatTasks(tasks) {
  if (!tasks.length) return "(nessuna)";
  return tasks
    .map((t) => {
      const prio = priorityOf(t);
      const bollino = prio === "urgent" ? " 🔴" : prio === "high" ? " 🟠" : "";
      return `- [${t.status?.status ?? t.status ?? "?"}] ${t.name}${bollino}`;
    })
    .join("\n");
}

async function buildAgentContext(agentId, apiKey) {
  const lists = AGENT_LISTS[agentId];
  const statoDoc = STATO_DOCS[agentId];
  if (!lists || !statoDoc) return "";

  const extraDocs = AGENT_EXTRA_DOCS[agentId] ?? [];
  const now = new Date().toLocaleString("it-IT", { timeZone: "Europe/Bucharest" });

  const [stato, ...rest] = await Promise.all([
    getDocPage(statoDoc.docId, statoDoc.pageId, apiKey),
    ...lists.map((l) => getTasksFromList(l.id, apiKey)),
    ...extraDocs.map((d) => getDocPage(d.docId, d.pageId, apiKey, d.format ?? "text/plain")),
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

    if (clickupKey && agentId && AGENT_LISTS[agentId]) {
      const ctx = await buildAgentContext(agentId, clickupKey);
      if (ctx) injectContext(body, ctx);
    }

    delete body.agentId;

    // Paletti di spesa: modello dalla whitelist, max_tokens con un tetto.
    if (typeof body.model !== "string" || !MODELLO_VALIDO.test(body.model)) {
      body.model = MODELLO_DEFAULT;
    }
    const richiesti = parseInt(body.max_tokens, 10);
    body.max_tokens = Number.isFinite(richiesti)
      ? Math.min(Math.max(richiesti, 1), MAX_TOKENS_CAP)
      : 1000;

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
