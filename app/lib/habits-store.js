// Lettura/scrittura dello storico abitudini sul Doc ClickUp.
//
// Vive in lib e non dentro la route perche' lo usano in due: /api/habits
// (dashboard) e /api/cron/reset (snapshot notturno). Il cron NON puo'
// chiamare /api/habits via fetch: l'app e' protetta da Basic Auth nel
// middleware, una chiamata interna verrebbe respinta con 401.
//
// Forma di una voce:
//   { data:"YYYY-MM-DD", done:[nomi], all:[nomi], strategiche:[nomi], nota:"" }

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const WORKSPACE_ID = "90121769473";
// Doc "Storico Abitudini e Mood (dashboard)" — pagina Abitudini.
const DOC_ID = "2kxuu4g1-972";
const PAGE_ID = "2kxuu4g1-1372";
const ROUTINE_DAILY_LIST_ID = "901218950375";

// Stessi status considerati "fatta" in home (app/page.jsx): se le due liste
// divergono, la griglia mostrerebbe come saltate abitudini che in
// dashboard risultano completate.
export const DONE_STATUSES = ["complete", "completed", "done", "chiuso", "closed", "fatto", "completato", "completata"];

// Doppio controllo: nome dello status E tipo ClickUp ("closed"/"done").
// Il nome da solo e' fragile — oggi la lista ROUTINE DAILY usa "completata",
// ma basta rinominarlo dall'interfaccia perche' ogni routine risulti
// saltata senza nessun errore visibile. Il tipo invece non cambia.
export const isTaskDone = (t) =>
  DONE_STATUSES.includes((t?.status?.status || "").toLowerCase()) ||
  ["closed", "done"].includes((t?.status?.type || "").toLowerCase());

// Priorita' ClickUp: e' il segnale che distingue le routine che muovono il
// fatturato (outreach, mass, ad spend) da quelle di servizio (post
// Telegram, medicine). Non e' una lista scritta nell'app di proposito: cosi'
// Dario la cambia dal telefono senza toccare il codice.
// L'API v2 restituisce un oggetto {priority:"high",...}, alcuni wrapper
// restituiscono direttamente la stringa: gestiamo entrambi.
export function priorityOf(t) {
  const p = t?.priority;
  return (typeof p === "string" ? p : p?.priority || "").toLowerCase();
}
export const isStrategica = (t) => ["urgent", "high"].includes(priorityOf(t));

// Data nel fuso di Dario, non in UTC: il server Vercel gira in UTC e il
// cron parte a mezzanotte di Bucarest, non a mezzanotte UTC.
export function bucharestDate(offsetDays = 0) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + offsetDays * 86400000));
}

export async function readHabits() {
  if (!CLICKUP_API_KEY) throw new Error("CLICKUP_API_KEY non configurata");
  const res = await fetch(
    `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${PAGE_ID}?content_format=text/plain`,
    { headers: { Authorization: CLICKUP_API_KEY }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`ClickUp doc error: ${res.status}`);
  const data = await res.json();
  const match = (data.content || "").match(/HABITS_DATA_JSON:([\s\S]*)/);
  if (!match) return [];
  try { return JSON.parse(match[1].trim()); }
  catch { throw new Error("Formato dati abitudini non riconosciuto (JSON malformato nel Doc)"); }
}

export async function writeHabits(days) {
  const content = `STORICO ABITUDINI DARIO\n\nNon modificare a mano: viene letto/scritto dalla dashboard.\nOgni voce: { data, done:[completate], all:[attive quel giorno], strategiche:[priorita' alta], nota }\n\nHABITS_DATA_JSON:${JSON.stringify(days)}`;
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

// include_closed=true e' obbligatorio qui.
// Bug del 04/08: la pagina Abitudini calcolava il giorno in corso da
// /api/tasks, che chiama ClickUp con include_closed=false. Le routine
// completate spariscono da quella risposta, quindi finivano fuori sia da
// "done" che da "all": in griglia risultavano × (saltate) le uniche
// rimaste aperte e le fatte non comparivano proprio.
export async function fetchRoutineTasks() {
  if (!CLICKUP_API_KEY) throw new Error("CLICKUP_API_KEY non configurata");
  const res = await fetch(
    `https://api.clickup.com/api/v2/list/${ROUTINE_DAILY_LIST_ID}/task?include_closed=true`,
    { headers: { Authorization: CLICKUP_API_KEY }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`ClickUp list routine: ${res.status}`);
  return (await res.json()).tasks || [];
}

export function snapshotDaTasks(tasks, day) {
  return {
    data: day,
    done: tasks.filter(isTaskDone).map((t) => t.name),
    all: tasks.map((t) => t.name),
    // Fotografiamo anche quali erano strategiche QUEL giorno: se domani
    // cambi priorita' a una routine, lo storico passato non si riscrive.
    strategiche: tasks.filter(isStrategica).map((t) => t.name),
  };
}

// Snapshot del giorno in corso, calcolato al volo: il cron lo salvera' solo
// stanotte, ma la griglia deve mostrare oggi in tempo reale.
export async function snapshotOggi() {
  const tasks = await fetchRoutineTasks();
  if (tasks.length === 0) return null;
  return snapshotDaTasks(tasks, bucharestDate(0));
}

// Salva (o aggiorna) lo snapshot di un giorno.
// Merge e non sostituzione: la nota del giorno e le correzioni manuali non
// devono sparire quando il giorno viene riscritto dal cron o ricalcolato
// da ClickUp.
export async function saveSnapshot(day, campi) {
  const { done, all, strategiche } = campi || {};
  if (!Array.isArray(all) || all.length === 0) return { success: false, motivo: "nessuna abitudine attiva" };
  const days = await readHabits();
  const idx = days.findIndex((d) => d.data === day);
  const prev = idx >= 0 ? days[idx] : {};
  const entry = {
    ...prev,
    data: day,
    done: done || [],
    all,
    strategiche: strategiche || prev.strategiche || [],
  };
  if (idx >= 0) days[idx] = entry;
  else days.push(entry);
  const sorted = days.sort((a, b) => (a.data < b.data ? -1 : 1));
  await writeHabits(sorted);
  return { success: true, giorni: sorted.length, entry };
}

// Inverte lo stato di una singola abitudine in un giorno PASSATO, agendo
// solo sullo storico. Per il giorno in corso non si passa di qui: si
// aggiorna la task su ClickUp (vedi toggleOggiSuClickUp), altrimenti al
// primo ricalcolo la correzione verrebbe sovrascritta.
export async function toggleGiornoPassato(day, abitudine) {
  const days = await readHabits();
  const idx = days.findIndex((d) => d.data === day);
  if (idx < 0) return { success: false, motivo: "nessuno snapshot per quel giorno" };
  const entry = days[idx];
  if (!(entry.all || []).includes(abitudine)) return { success: false, motivo: "abitudine non attiva quel giorno" };
  const done = new Set(entry.done || []);
  if (done.has(abitudine)) done.delete(abitudine);
  else done.add(abitudine);
  // Teniamo traccia che il giorno e' stato corretto a mano: serve a non
  // scambiare un dato aggiustato per un dato osservato.
  days[idx] = { ...entry, done: [...done], corretto: true };
  await writeHabits(days);
  return { success: true, entry: days[idx] };
}

export async function toggleOggiSuClickUp(abitudine) {
  const tasks = await fetchRoutineTasks();
  const task = tasks.find((t) => t.name === abitudine);
  if (!task) return { success: false, motivo: "routine non trovata su ClickUp" };
  const nuovo = isTaskDone(task) ? "da fare" : "completata";
  const res = await fetch(`https://api.clickup.com/api/v2/task/${task.id}`, {
    method: "PUT",
    headers: { Authorization: CLICKUP_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ status: nuovo }),
  });
  if (!res.ok) return { success: false, motivo: `ClickUp update: ${res.status}` };
  return { success: true, nuovoStato: nuovo };
}

export async function setNota(day, testo) {
  const days = await readHabits();
  const idx = days.findIndex((d) => d.data === day);
  if (idx >= 0) days[idx] = { ...days[idx], nota: testo };
  else days.push({ data: day, done: [], all: [], strategiche: [], nota: testo });
  await writeHabits(days.sort((a, b) => (a.data < b.data ? -1 : 1)));
  return { success: true };
}
