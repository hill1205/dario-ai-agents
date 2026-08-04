// app/api/telegram/route.js — bot Telegram privato: inoltri un messaggio o
// uno screenshot WhatsApp, Claude estrae la task, tu confermi la lista con un
// bottone e la task nasce su ClickUp.
//
// Perché tutto in una route sola: il flusso è breve e sequenziale, e tenerlo
// self-contained (come app/api/chat/route.js) evita di dover ragionare su cosa
// gira dove quando qualcosa si rompe alle 23 di sera dal telefono.
export const dynamic = "force-dynamic";
// Il default di Vercel taglierebbe a 10s: con download immagine + Claude si
// sta larghi, ma se Telegram non riceve 200 in tempo RITENTA lo stesso update
// e ti ritrovi la task doppia. 60s è il margine che rende il retry un caso
// teorico invece che quotidiano.
export const maxDuration = 60;

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TG_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Haiku basta e avanza per "estrai azione + persona + priorità": il compito è
// di classificazione, non di ragionamento. Costa ~1/3 di Sonnet. Se un giorno
// sbaglia troppo il routing, si cambia solo questa stringa.
const MODEL = "claude-haiku-4-5-20251001";

// Le destinazioni reali del workspace. NB: "Imperivm" non è una lista — è il
// nome commerciale di IAGREX, stessa entità: tenerle separate spezzerebbe in
// due il conteggio verso 1M€ senza motivo.
const LISTS = {
  leads:   { id: "901218950390", label: "LEADS",       desc: "nuovo contatto, lead da ricontattare, outreach, prospect" },
  clienti: { id: "901218950389", label: "CLIENTI",     desc: "richiesta di un cliente già attivo dell'agenzia, delivery, revisioni" },
  agenzia: { id: "901218950388", label: "AGENZIA 1M€", desc: "attività strategiche dell'agenzia: offerta, pricing, posizionamento, partnership" },
  fatture: { id: "901218950391", label: "FATTURE",     desc: "fatture da emettere o ricevute, pagamenti, incassi, adempimenti contabili IAGREX" },
  hoc:     { id: "901218950330", label: "HOC",         desc: "qualsiasi cosa riguardi HOC (progetto/brand separato da IAGREX)" },
  todo:    { id: "901218950374", label: "TO DO DAILY", desc: "personale, generico, o quando nessuna delle altre calza chiaramente" },
};

const PRIORITY_MAP = { urgent: 1, high: 2, normal: 3, low: 4 };
const PRIORITY_ICON = { urgent: "🔴", high: "🟠", normal: "🔵", low: "⚪️" };

// Lo stato (bozze in attesa di conferma + update_id già processati) vive in
// una task ClickUp dedicata, stesso principio dei Doc usati per peso/streak:
// Vercel è stateless e tra il messaggio e la pressione del bottone passano due
// invocazioni separate che non condividono memoria.
const STATE_LIST_ID = "901218950377"; // IN SOSPESO
const STATE_TASK_NAME = "⚙️ STATO BOT TELEGRAM — non modificare";
const STATE_MARKER = "TELEGRAM_STATE_JSON:";

// Cache dell'ID della task di stato per la durata del lambda caldo: evita di
// riscansionare la lista a ogni messaggio.
let cachedStateTaskId = null;

/* ------------------------------------------------------------------ */
/* Telegram                                                            */
/* ------------------------------------------------------------------ */

async function tg(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) console.error(`Telegram ${method} error:`, data);
  return data;
}

// Telegram consegna le foto in più risoluzioni: l'ultimo elemento è la più
// grande, ma è comunque già compressa a ~1280px lato lungo lato server. Ottimo
// per noi: sono ~1.300 token immagine invece dei ~4.000 dell'originale del
// telefono, senza dover ridimensionare niente.
async function downloadPhoto(photoSizes) {
  const best = photoSizes[photoSizes.length - 1];
  const info = await tg("getFile", { file_id: best.file_id });
  if (!info.ok) throw new Error("getFile fallita");
  const res = await fetch(`https://api.telegram.org/file/bot${TG_TOKEN}/${info.result.file_path}`);
  if (!res.ok) throw new Error(`Download foto fallito: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString("base64");
}

/* ------------------------------------------------------------------ */
/* Stato su ClickUp                                                    */
/* ------------------------------------------------------------------ */

async function cu(path, options = {}) {
  return fetch(`https://api.clickup.com/api/v2${path}`, {
    ...options,
    headers: {
      Authorization: CLICKUP_API_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
}

// Trova la task di stato o la crea al volo. Self-provisioning di proposito:
// una configurazione manuale in più è una cosa in più che può mancare al primo
// deploy e far fallire tutto con un errore poco leggibile.
async function getStateTaskId() {
  if (cachedStateTaskId) return cachedStateTaskId;
  // include_closed=true: se la task di stato finisse per sbaglio in stato
  // chiuso, con false sparirebbe dalla risposta e ne creeremmo una seconda.
  const res = await cu(`/list/${STATE_LIST_ID}/task?include_closed=true&subtasks=false`);
  if (res.ok) {
    const data = await res.json();
    const found = (data.tasks || []).find((t) => t.name === STATE_TASK_NAME);
    if (found) return (cachedStateTaskId = found.id);
  }
  const created = await cu(`/list/${STATE_LIST_ID}/task`, {
    method: "POST",
    body: JSON.stringify({
      name: STATE_TASK_NAME,
      description: `${STATE_MARKER}{"drafts":{},"processed":[]}`,
    }),
  });
  if (!created.ok) throw new Error(`Creazione task di stato fallita: ${created.status}`);
  const data = await created.json();
  return (cachedStateTaskId = data.id);
}

async function readState() {
  const id = await getStateTaskId();
  const res = await cu(`/task/${id}`);
  if (!res.ok) throw new Error(`Lettura stato fallita: ${res.status}`);
  const data = await res.json();
  const raw = data.description || data.text_content || "";
  const idx = raw.indexOf(STATE_MARKER);
  if (idx === -1) return { drafts: {}, processed: [] };
  try {
    const parsed = JSON.parse(raw.slice(idx + STATE_MARKER.length).trim());
    return { drafts: parsed.drafts || {}, processed: parsed.processed || [] };
  } catch {
    // Meglio ripartire da stato vuoto che bloccare il bot: si perde al massimo
    // la deduplica di qualche update, non un messaggio.
    console.error("Stato Telegram malformato, riparto da zero");
    return { drafts: {}, processed: [] };
  }
}

async function writeState(state) {
  const id = await getStateTaskId();
  // Potatura: bozze più vecchie di 7 giorni (non confermate, ormai morte) e
  // solo gli ultimi 200 update_id. Senza questo la descrizione cresce per
  // sempre fino a sbattere contro i limiti di ClickUp.
  const cutoff = Date.now() - 7 * 86400000;
  const drafts = Object.fromEntries(
    Object.entries(state.drafts).filter(([, d]) => (d.ts || 0) > cutoff)
  );
  const processed = state.processed.slice(-200);
  const res = await cu(`/task/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      description: `Stato interno del bot Telegram. Non modificare a mano.\n\n${STATE_MARKER}${JSON.stringify({ drafts, processed })}`,
    }),
  });
  if (!res.ok) throw new Error(`Scrittura stato fallita: ${res.status}`);
}

/* ------------------------------------------------------------------ */
/* Claude                                                              */
/* ------------------------------------------------------------------ */

function bucharestToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function buildSystemPrompt() {
  const listLines = Object.entries(LISTS)
    .map(([key, l]) => `- "${key}" (${l.label}): ${l.desc}`)
    .join("\n");
  return `Sei l'assistente di Dario, imprenditore che gestisce l'agenzia di marketing IAGREX (nome commerciale: Imperivm) e il progetto HOC.

Dario ti inoltra messaggi di testo o screenshot di conversazioni WhatsApp che contengono richieste o cose da fare, tipicamente assegnate da colleghi, collaboratori o creator. Il tuo compito è estrarre UNA task azionabile.

Se è uno screenshot di chat: identifica chi sta chiedendo la cosa a Dario (di solito NON è Dario stesso — Dario è chi risponde/riceve). Ignora i convenevoli e concentrati sulla richiesta operativa.

Liste ClickUp disponibili:
${listLines}

Oggi è ${bucharestToday()} (fuso Europe/Bucharest). Usa questa data per risolvere scadenze relative come "entro domani" o "venerdì".

Rispondi SOLO con un oggetto JSON, senza testo attorno e senza blocchi di codice:
{
  "azione": "titolo della task, imperativo, concreto, max 80 caratteri",
  "richiedente": "nome di chi ha chiesto, o null se non deducibile",
  "priorita": "urgent" | "high" | "normal" | "low",
  "scadenza": "YYYY-MM-DD" oppure null,
  "lista": una delle chiavi elencate sopra,
  "confidenza": numero 0-100 su quanto sei sicuro della lista scelta,
  "note": "contesto utile che non sta nel titolo, max 300 caratteri, o stringa vuota"
}

Regole:
- "priorita" è "urgent" solo se c'è un'urgenza esplicita o una scadenza entro 24h. In assenza di segnali usa "normal".
- Non inventare scadenze: se nessuno ne ha indicata una, metti null.
- Se il contenuto non contiene nessuna richiesta azionabile, metti "azione": null.`;
}

async function extractTask({ text, imageBase64 }) {
  const content = [];
  if (imageBase64) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: imageBase64 },
    });
  }
  content.push({ type: "text", text: text || "(nessun testo, analizza l'immagine)" });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      // cache_control sul system: è identico a ogni chiamata, e a 30 messaggi
      // al giorno vuol dire pagarlo il 10% invece che pieno.
      system: [{ type: "text", text: buildSystemPrompt(), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude error ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);

  const raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  // Cintura e bretelle: se Claude incapsula il JSON in ```json ... ``` o ci
  // mette una frase davanti, prendiamo comunque il primo oggetto bilanciato.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Claude non ha restituito JSON");
  return JSON.parse(match[0]);
}

/* ------------------------------------------------------------------ */
/* Formattazione messaggi                                              */
/* ------------------------------------------------------------------ */

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function draftSummary(d) {
  const righe = [`📥 <b>${escapeHtml(d.azione)}</b>`];
  const meta = [];
  if (d.richiedente) meta.push(`👤 ${escapeHtml(d.richiedente)}`);
  meta.push(`${PRIORITY_ICON[d.priorita] || "🔵"} ${d.priorita}`);
  if (d.scadenza) meta.push(`📅 ${d.scadenza}`);
  righe.push(meta.join("   "));
  if (d.note) righe.push(`\n<i>${escapeHtml(d.note)}</i>`);
  return righe.join("\n");
}

// I bottoni: la lista suggerita da Claude va per prima e marcata, così nel caso
// normale è sempre un tap solo e nella posizione prevedibile.
function buildKeyboard(draftId, suggested) {
  const keys = Object.keys(LISTS);
  const ordered = [suggested, ...keys.filter((k) => k !== suggested)].filter((k) => LISTS[k]);
  const buttons = ordered.map((k, i) => ({
    text: i === 0 ? `✅ ${LISTS[k].label}` : LISTS[k].label,
    // callback_data ha un tetto duro di 64 byte: ci sta solo un ID corto più
    // la chiave della lista, mai la bozza intera.
    callback_data: `c:${draftId}:${k}`,
  }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push([{ text: "✖️ Annulla", callback_data: `x:${draftId}:-` }]);
  return { inline_keyboard: rows };
}

/* ------------------------------------------------------------------ */
/* Handler: messaggio in arrivo                                        */
/* ------------------------------------------------------------------ */

async function handleMessage(message, updateId) {
  const chatId = message.chat?.id;
  if (String(chatId) !== String(TG_CHAT_ID)) return; // non sei tu: ignora in silenzio

  const state = await readState();
  if (state.processed.includes(updateId)) return; // retry di Telegram: già fatto

  const text = message.text || message.caption || "";
  const hasPhoto = Array.isArray(message.photo) && message.photo.length > 0;

  if (!text && !hasPhoto) {
    await tg("sendMessage", { chat_id: chatId, text: "Mandami del testo o uno screenshot." });
    return;
  }
  if (text.startsWith("/start") || text.startsWith("/help")) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Inoltrami un messaggio o uno screenshot con una richiesta.\nTi propongo la task, tu scegli la lista con un tap.",
    });
    state.processed.push(updateId);
    await writeState(state);
    return;
  }

  // Feedback immediato: Claude + download foto possono prendere qualche
  // secondo e un bot muto sembra un bot rotto.
  const pending = await tg("sendMessage", { chat_id: chatId, text: "🧠 Leggo…" });
  const pendingId = pending.result?.message_id;

  let draft;
  try {
    const imageBase64 = hasPhoto ? await downloadPhoto(message.photo) : null;
    draft = await extractTask({ text, imageBase64 });
  } catch (e) {
    console.error("Estrazione fallita:", e);
    await tg("editMessageText", {
      chat_id: chatId, message_id: pendingId,
      text: `⚠️ Non sono riuscito a leggerlo.\n${escapeHtml(e.message).slice(0, 200)}`,
      parse_mode: "HTML",
    });
    return;
  }

  if (!draft.azione) {
    await tg("editMessageText", {
      chat_id: chatId, message_id: pendingId,
      text: "🤷 Non ci ho trovato dentro una richiesta azionabile.",
    });
    state.processed.push(updateId);
    await writeState(state);
    return;
  }

  const draftId = Math.random().toString(36).slice(2, 8);
  state.drafts[draftId] = { ...draft, ts: Date.now() };
  state.processed.push(updateId);
  await writeState(state);

  const suggested = LISTS[draft.lista] ? draft.lista : "todo";
  const confidenza = typeof draft.confidenza === "number" ? draft.confidenza : null;
  const hint = confidenza !== null && confidenza < 60 ? "\n\n🤔 Non sono sicuro della lista." : "";

  await tg("editMessageText", {
    chat_id: chatId,
    message_id: pendingId,
    text: `${draftSummary(draft)}${hint}\n\nDove la metto?`,
    parse_mode: "HTML",
    reply_markup: buildKeyboard(draftId, suggested),
  });
}

/* ------------------------------------------------------------------ */
/* Handler: bottone premuto                                            */
/* ------------------------------------------------------------------ */

async function handleCallback(cq) {
  const chatId = cq.message?.chat?.id;
  if (String(chatId) !== String(TG_CHAT_ID)) return;

  const [action, draftId, listKey] = (cq.data || "").split(":");
  const messageId = cq.message?.message_id;

  if (action === "x") {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Annullata" });
    await tg("editMessageText", { chat_id: chatId, message_id: messageId, text: "✖️ Annullata." });
    const state = await readState();
    delete state.drafts[draftId];
    await writeState(state);
    return;
  }

  const state = await readState();
  const draft = state.drafts[draftId];
  if (!draft) {
    // Succede solo con bozze scadute (>7gg) o se lo stato è stato azzerato.
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Bozza scaduta, rimandami il messaggio", show_alert: true });
    return;
  }
  const list = LISTS[listKey];
  if (!list) {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Lista sconosciuta" });
    return;
  }

  // Chiudere subito il callback: Telegram mostra lo spinner sul bottone finché
  // non rispondi, e dopo pochi secondi lo segna come fallito.
  await tg("answerCallbackQuery", { callback_query_id: cq.id, text: `Creo in ${list.label}…` });

  const body = { name: draft.azione };
  if (PRIORITY_MAP[draft.priorita]) body.priority = PRIORITY_MAP[draft.priorita];
  // Mezzogiorno e non mezzanotte: il server Vercel gira in UTC e una data a
  // mezzanotte scivolerebbe al giorno prima una volta resa nel fuso di
  // Bucarest. Stessa scelta di app/api/create-task/route.js.
  if (draft.scadenza) {
    const ms = new Date(`${draft.scadenza}T12:00:00`).getTime();
    if (!isNaN(ms)) { body.due_date = ms; body.due_date_time = false; }
  }
  const descr = [];
  if (draft.richiedente) descr.push(`Richiesto da: ${draft.richiedente}`);
  if (draft.note) descr.push(draft.note);
  descr.push("— creata dal bot Telegram");
  body.description = descr.join("\n\n");

  let created;
  try {
    const res = await cu(`/list/${list.id}/task`, { method: "POST", body: JSON.stringify(body) });
    created = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(created).slice(0, 200));
  } catch (e) {
    console.error("Creazione task fallita:", e);
    await tg("editMessageText", {
      chat_id: chatId, message_id: messageId,
      text: `${draftSummary(draft)}\n\n⚠️ ClickUp ha rifiutato: ${escapeHtml(e.message)}`,
      parse_mode: "HTML",
      reply_markup: buildKeyboard(draftId, listKey), // bottoni ancora lì per riprovare
    });
    return;
  }

  delete state.drafts[draftId];
  await writeState(state);

  await tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: `✅ <b>${escapeHtml(draft.azione)}</b>\ncreata in <b>${list.label}</b>`,
    parse_mode: "HTML",
    reply_markup: created.url
      ? { inline_keyboard: [[{ text: "Apri su ClickUp", url: created.url }]] }
      : undefined,
  });
}

/* ------------------------------------------------------------------ */
/* Webhook                                                             */
/* ------------------------------------------------------------------ */

export async function POST(request) {
  // Questa route è l'unica dell'app raggiungibile senza Basic Auth (vedi
  // middleware.js): il secret token è quindi l'unica cosa che la separa da
  // internet. Senza, chiunque potrebbe scriverti task su ClickUp.
  if (!TG_SECRET || request.headers.get("x-telegram-bot-api-secret-token") !== TG_SECRET) {
    return new Response("ok", { status: 200 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response("ok", { status: 200 });
  }

  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message) {
      await handleMessage(update.message, update.update_id);
    }
  } catch (e) {
    // Rispondiamo 200 anche in errore: qualsiasi altro codice fa ritentare
    // Telegram in loop, e un errore permanente diventerebbe uno sciame di
    // richieste identiche destinate a fallire tutte allo stesso modo.
    console.error("Errore webhook Telegram:", e);
    if (TG_CHAT_ID) {
      await tg("sendMessage", { chat_id: TG_CHAT_ID, text: `⚠️ Errore bot: ${String(e.message).slice(0, 300)}` }).catch(() => {});
    }
  }
  return new Response("ok", { status: 200 });
}

// Sonda di salute: apri /api/telegram dal browser (con Basic Auth) per vedere
// se le variabili d'ambiente sono a posto, senza dover leggere i log Vercel.
export async function GET() {
  return Response.json({
    ok: true,
    env: {
      TELEGRAM_BOT_TOKEN: !!TG_TOKEN,
      TELEGRAM_CHAT_ID: !!TG_CHAT_ID,
      TELEGRAM_WEBHOOK_SECRET: !!TG_SECRET,
      CLICKUP_API_KEY: !!CLICKUP_API_KEY,
      ANTHROPIC_API_KEY: !!ANTHROPIC_API_KEY,
    },
  });
}
