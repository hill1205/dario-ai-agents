// app/api/telegram/route.js — bot Telegram privato: inoltri un messaggio o
// uno screenshot WhatsApp e la task compare nel TO DO DAILY della dashboard.
//
// Prima versione (05/08) chiedeva conferma con sei bottoni, uno per lista.
// Rifatta lo stesso giorno: le altre cinque liste (LEADS, CLIENTI, FATTURE,
// AGENZIA, HOC) non sono visibili nella dashboard — che legge solo le liste
// della cartella BEA — quindi una task creata li' spariva dalla vista e il
// link "apri" portava su ClickUp, fuori dal posto dove Dario lavora davvero.
// Tutto in TO DO DAILY, contesto nel titolo, zero tap.
export const dynamic = "force-dynamic";
// Il default di Vercel taglierebbe a 10s: con download immagine + Claude si
// sta larghi, ma se Telegram non riceve 200 in tempo RITENTA lo stesso update
// e ti ritrovi la task doppia. 60s rende il retry un caso teorico.
export const maxDuration = 60;

// .trim() su tutte: incollando i valori nel pannello Vercel e' facilissimo
// portarsi dietro uno spazio o un a-capo invisibile, e un secret con "\n" in
// fondo non combacia mai — con un controllo che fallisce in silenzio il
// sintomo e' un bot muto e nessun errore da nessuna parte.
const TG_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TG_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || "").trim();
const TG_SECRET = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Haiku basta e avanza per "estrai azione + persona + priorita'": e' un
// compito di classificazione, non di ragionamento. Costa ~1/3 di Sonnet.
const MODEL = "claude-haiku-4-5-20251001";

const APP_URL = "https://dario-ai-agents.vercel.app/";

// Unica destinazione: il TO DO DAILY che la home della dashboard mostra.
const TODO_LIST_ID = "901218950374";

const PRIORITY_MAP = { urgent: 1, high: 2, normal: 3, low: 4 };
const PRIORITY_ICON = { urgent: "🔴", high: "🟠", normal: "🔵", low: "⚪️" };

// Il contesto non e' piu' una lista separata ma un prefisso nel titolo: si
// legge in dashboard, su ClickUp e nelle notifiche senza aprire niente, e non
// dipende dall'esistenza di tag configurati nello Space.
// NB: "Imperivm" non compare perche' e' il nome commerciale di IAGREX, non
// un'entita' separata.
const CONTEXT_PREFIX = { hoc: "[HOC] ", iagrex: "[IAGREX] ", personale: "" };

// La deduplica degli update_id vive in una task ClickUp dedicata, stesso
// principio dei Doc usati per peso/streak: Vercel e' stateless e Telegram
// ritenta gli update che non ricevono 200 in fretta.
const STATE_LIST_ID = "901218950377"; // IN SOSPESO
const STATE_TASK_NAME = "⚙️ STATO BOT TELEGRAM — non modificare";
const STATE_MARKER = "TELEGRAM_STATE_JSON:";

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

// Telegram consegna le foto in piu' risoluzioni: l'ultimo elemento e' il piu'
// grande, ma e' comunque gia' compresso a ~1280px lato lungo lato server.
// Ottimo per noi: ~1.300 token immagine invece dei ~4.000 dell'originale del
// telefono, senza dover ridimensionare niente.
async function downloadPhoto(photoSizes) {
  const best = photoSizes[photoSizes.length - 1];
  const info = await tg("getFile", { file_id: best.file_id });
  if (!info.ok) throw new Error("getFile fallita");
  const res = await fetch(`https://api.telegram.org/file/bot${TG_TOKEN}/${info.result.file_path}`);
  if (!res.ok) throw new Error(`Download foto fallito: ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

/* ------------------------------------------------------------------ */
/* ClickUp                                                             */
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
// una configurazione manuale in piu' e' una cosa in piu' che puo' mancare al
// primo deploy e far fallire tutto con un errore poco leggibile.
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
    body: JSON.stringify({ name: STATE_TASK_NAME, description: `${STATE_MARKER}{"processed":[]}` }),
  });
  if (!created.ok) throw new Error(`Creazione task di stato fallita: ${created.status}`);
  return (cachedStateTaskId = (await created.json()).id);
}

async function readProcessed() {
  const id = await getStateTaskId();
  const res = await cu(`/task/${id}`);
  if (!res.ok) throw new Error(`Lettura stato fallita: ${res.status}`);
  const raw = (await res.json()).description || "";
  const idx = raw.indexOf(STATE_MARKER);
  if (idx === -1) return [];
  try {
    return JSON.parse(raw.slice(idx + STATE_MARKER.length).trim()).processed || [];
  } catch {
    // Meglio ripartire da zero che bloccare il bot: si perde al massimo la
    // deduplica di qualche update, non un messaggio.
    console.error("Stato Telegram malformato, riparto da zero");
    return [];
  }
}

async function writeProcessed(processed) {
  const id = await getStateTaskId();
  // Solo gli ultimi 200: senza potatura la descrizione cresce per sempre
  // fino a sbattere contro i limiti di ClickUp.
  const res = await cu(`/task/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      description: `Stato interno del bot Telegram. Non modificare a mano.\n\n${STATE_MARKER}${JSON.stringify({ processed: processed.slice(-200) })}`,
    }),
  });
  if (!res.ok) throw new Error(`Scrittura stato fallita: ${res.status}`);
}

/* ------------------------------------------------------------------ */
/* Claude                                                              */
/* ------------------------------------------------------------------ */

function bucharestToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

// Il giorno della settimana va passato esplicito, non lasciato dedurre dalla
// data: al primo test reale "entro venerdi'" con oggi = mercoledi' 5 agosto
// e' diventato 2026-08-08, che e' sabato. Un giorno di scarto sulle scadenze
// e' un errore silenzioso, non te ne accorgi finche' non sfori.
function bucharestWeekday() {
  return new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Bucharest", weekday: "long" }).format(new Date());
}

// I prossimi 7 giorni scritti per esteso: cosi' "venerdi'" o "dopodomani" si
// risolvono leggendo una riga invece che contando.
function prossimiGiorni() {
  const fmt = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Bucharest", weekday: "long" });
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const righe = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.now() + i * 86400000);
    righe.push(`${fmt.format(d)} = ${iso.format(d)}`);
  }
  return righe.join(", ");
}

function buildSystemPrompt() {
  return `Sei l'assistente di Dario, imprenditore che gestisce l'agenzia di marketing IAGREX (nome commerciale: Imperivm) e il progetto HOC.

Dario ti inoltra messaggi di testo o screenshot di conversazioni WhatsApp che contengono richieste o cose da fare, tipicamente assegnate da colleghi, collaboratori o creator. Il tuo compito è estrarre UNA task azionabile.

Se è uno screenshot di chat: identifica chi sta chiedendo la cosa a Dario. Di solito NON è Dario stesso — Dario è chi riceve la richiesta. Ignora i convenevoli e concentrati sulle richieste operative.

Oggi è ${bucharestWeekday()} ${bucharestToday()} (fuso Europe/Bucharest).
Per risolvere scadenze relative usa questa corrispondenza, NON calcolare da solo: ${prossimiGiorni()}.
Se qualcuno dice "entro venerdì" intende il primo venerdì che trovi in quell'elenco.

Rispondi SOLO con un oggetto JSON, senza testo attorno e senza blocchi di codice:
{
  "tasks": [
    {
      "azione": "titolo della task, imperativo, concreto, max 80 caratteri",
      "richiedente": "nome di chi ha chiesto, o null se non deducibile",
      "priorita": "urgent" | "high" | "normal" | "low",
      "scadenza": "YYYY-MM-DD" oppure null,
      "contesto": "hoc" | "iagrex" | "personale",
      "note": "contesto utile che non sta nel titolo, max 300 caratteri, o stringa vuota"
    }
  ]
}

QUANTE TASK — la regola più importante:
- Metti nell'elenco una task per ogni azione DISTINTA che spetta a Dario. Massimo 5.
- "Mandami la fattura di luglio e aggiorna i prezzi sul sito" = 2 task: sono due cose scollegate, in momenti diversi.
- NON spezzare una singola azione nei suoi passaggi: "prepara e mandami il preventivo" è UNA task sola.
- Le azioni che spettano ad ALTRI non sono task di Dario. In "mandami la fattura perché devo pagare entro il 6" l'unica task di Dario è mandare la fattura; il pagamento lo fa l'altro e va al massimo nelle note.
- Un motivo, una conseguenza o un evento non sono task. In "posta il video giovedì perché sabato abbiamo la cena aziendale" c'è UNA task (postare il video); la cena è solo il motivo.
- Se non c'è nessuna richiesta azionabile, restituisci "tasks": [].

SCADENZE:
- La scadenza è la data dell'AZIONE, mai quella del motivo o della conseguenza. In "posta il video giovedì perché sabato c'è la cena" la scadenza è giovedì, non sabato.
- Non inventare scadenze: se nessuno ne ha indicata una, metti null.

ALTRO:
- "contesto": "hoc" se riguarda il progetto HOC, "iagrex" se riguarda l'agenzia (clienti, lead, fatture, contabilità, offerte), "personale" per tutto il resto o se non è deducibile.
- "priorita" è "urgent" solo se c'è un'urgenza esplicita o una scadenza entro 24h. In assenza di segnali usa "normal".
- Se una data citata serve solo a dare contesto (un evento, una riunione), scrivila nelle note invece che nella scadenza.`;
}

// Restituisce sempre un array (eventualmente vuoto): un messaggio può
// contenere più richieste distinte, e prima ne perdevamo tutte tranne una.
async function extractTasks({ text, imageBase64 }) {
  const content = [];
  if (imageBase64) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } });
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
      // cache_control sul system: cambia solo una volta al giorno (la data), e
      // a 30 messaggi al giorno vuol dire pagarlo il 10% invece che pieno.
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
  const parsed = JSON.parse(match[0]);
  // Tolleranza sul formato: se torna un oggetto singolo invece dell'elenco lo
  // avvolgiamo, invece di far fallire tutto il messaggio.
  const list = Array.isArray(parsed.tasks) ? parsed.tasks : parsed.azione ? [parsed] : [];
  // Il tetto di 5 e' anche una difesa: se Claude fraintende una chat lunga e
  // spezzetta tutto, meglio 5 task da sistemare che 40.
  return list.filter((t) => t && t.azione).slice(0, 5);
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function handleMessage(message, updateId) {
  const chatId = message.chat?.id;
  if (String(chatId) !== TG_CHAT_ID) {
    // Ignorare in silenzio e' giusto (non rispondiamo a estranei), ma senza
    // traccia nei log un chat_id sbagliato in configurazione sembra identico
    // a un bot rotto. Il chat_id non e' un segreto: loggarlo va bene.
    console.error(`Chat non autorizzata: ricevuto "${chatId}", atteso "${TG_CHAT_ID}"`);
    return;
  }

  const processed = await readProcessed();
  if (processed.includes(updateId)) return; // retry di Telegram: gia' fatto

  const text = message.text || message.caption || "";
  const hasPhoto = Array.isArray(message.photo) && message.photo.length > 0;

  if (!text && !hasPhoto) {
    await tg("sendMessage", { chat_id: chatId, text: "Mandami del testo o uno screenshot." });
    return;
  }
  if (text.startsWith("/start") || text.startsWith("/help")) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Inoltrami un messaggio o uno screenshot con una richiesta.\nLa trasformo in task e te la metto nel TO DO DAILY della dashboard.",
    });
    await writeProcessed([...processed, updateId]);
    return;
  }

  // Feedback immediato: Claude + download foto possono prendere qualche
  // secondo e un bot muto sembra un bot rotto.
  const pending = await tg("sendMessage", { chat_id: chatId, text: "🧠 Leggo…" });
  const pendingId = pending.result?.message_id;
  const edit = (payload) => tg("editMessageText", { chat_id: chatId, message_id: pendingId, ...payload });

  let drafts;
  try {
    const imageBase64 = hasPhoto ? await downloadPhoto(message.photo) : null;
    drafts = await extractTasks({ text, imageBase64 });
  } catch (e) {
    console.error("Estrazione fallita:", e);
    await edit({ text: `⚠️ Non sono riuscito a leggerlo.\n${escapeHtml(e.message).slice(0, 200)}`, parse_mode: "HTML" });
    return;
  }

  if (drafts.length === 0) {
    await edit({ text: "🤷 Non ci ho trovato dentro una richiesta azionabile." });
    await writeProcessed([...processed, updateId]);
    return;
  }

  const create = async (draft) => {
    const prefix = CONTEXT_PREFIX[draft.contesto] ?? "";
    const body = { name: `${prefix}${draft.azione}`.slice(0, 255) };
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

    const res = await cu(`/list/${TODO_LIST_ID}/task`, { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) throw new Error(JSON.stringify(await res.json()).slice(0, 200));
    return body.name;
  };

  // In sequenza e non in parallelo: sono al massimo 5 chiamate e cosi' non
  // rischiamo il rate limit di ClickUp, che su piano gratuito e' stretto.
  const create_ok = [];
  const falliti = [];
  for (const draft of drafts) {
    try {
      create_ok.push({ nome: await create(draft), draft });
    } catch (e) {
      console.error("Creazione task fallita:", e);
      falliti.push({ azione: draft.azione, errore: e.message });
    }
  }

  // Segniamo l'update come processato solo se e' andato tutto bene: se
  // qualcosa e' fallito, rimandando lo stesso messaggio si riprova invece di
  // scartarlo come duplicato. Il prezzo e' che le task riuscite verrebbero
  // ricreate, ma un doppione visibile e' meglio di una richiesta persa.
  if (falliti.length === 0) await writeProcessed([...processed, updateId]);

  const righe = create_ok.map(({ nome, draft }) => {
    const meta = [];
    if (draft.richiedente) meta.push(`👤 ${escapeHtml(draft.richiedente)}`);
    meta.push(`${PRIORITY_ICON[draft.priorita] || "🔵"} ${draft.priorita}`);
    if (draft.scadenza) meta.push(`📅 ${draft.scadenza}`);
    return `✅ <b>${escapeHtml(nome)}</b>\n${meta.join("   ")}`;
  });

  if (falliti.length) {
    righe.push(
      `\n⚠️ Non create (${falliti.length}):\n` +
        falliti.map((f) => `• ${escapeHtml(f.azione)} — ${escapeHtml(f.errore).slice(0, 120)}`).join("\n") +
        `\n\nRimandami il messaggio per riprovare.`
    );
  }

  const intestazione = create_ok.length > 1 ? `<b>${create_ok.length} task create</b>\n\n` : "";
  await edit({
    text: `${intestazione}${righe.join("\n\n")}\n\n<i>nel TO DO DAILY</i>`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "📋 Apri la dashboard", url: APP_URL }]] },
  });
}

/* ------------------------------------------------------------------ */
/* Webhook                                                             */
/* ------------------------------------------------------------------ */

export async function POST(request) {
  // Questa route e' l'unica dell'app raggiungibile senza Basic Auth (vedi
  // middleware.js): il secret token e' quindi l'unica cosa che la separa da
  // internet. Senza, chiunque potrebbe scriverti task su ClickUp.
  const received = request.headers.get("x-telegram-bot-api-secret-token");
  if (!TG_SECRET || received !== TG_SECRET) {
    // Non logghiamo i valori (sono segreti), solo lunghezza e primi caratteri:
    // basta a distinguere "variabile assente" da "secret diverso" da "stesso
    // secret con caratteri invisibili in coda", che sono i tre casi reali.
    console.error(
      `Secret token rifiutato — atteso: len=${TG_SECRET.length} inizio="${TG_SECRET.slice(0, 6)}" | ricevuto: ${
        received === null ? "header assente" : `len=${received.length} inizio="${received.slice(0, 6)}"`
      }`
    );
    return new Response("ok", { status: 200 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response("ok", { status: 200 });
  }

  try {
    // I callback_query della vecchia versione a bottoni non esistono piu':
    // se ne arriva uno da un messaggio vecchio viene semplicemente ignorato.
    if (update.message) await handleMessage(update.message, update.update_id);
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
// Serve gia' una volta: il bot restava muto perche' TELEGRAM_WEBHOOK_SECRET
// era stata salvata nel campo Note di Vercel invece che in Value.
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
