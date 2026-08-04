// Lettura/scrittura dello storico abitudini sul Doc ClickUp.
//
// Vive in lib e non dentro la route perche' lo usano in due: /api/habits
// (dashboard) e /api/cron/reset (snapshot notturno). Il cron NON puo'
// chiamare /api/habits via fetch: l'app e' protetta da Basic Auth nel
// middleware, una chiamata interna verrebbe respinta con 401.

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const WORKSPACE_ID = "90121769473";
// Doc "Storico Abitudini e Mood (dashboard)" — pagina Abitudini.
const DOC_ID = "2kxuu4g1-972";
const PAGE_ID = "2kxuu4g1-1372";

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

// Data nel fuso di Dario, non in UTC: il server Vercel gira in UTC e il
// cron parte all'01:00 UTC, quando a Bucarest e' gia' il giorno dopo.
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
  const content = `STORICO ABITUDINI DARIO\n\nNon modificare a mano: viene letto/scritto dalla dashboard.\nOgni voce: { data, done:[abitudini completate], all:[abitudini attive quel giorno] }\n\nHABITS_DATA_JSON:${JSON.stringify(days)}`;
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

const ROUTINE_DAILY_LIST_ID = "901218950375";

// include_closed=true e' obbligatorio qui.
// Bug del 04/08: la pagina Abitudini calcolava il giorno in corso da
// /api/tasks, che chiama ClickUp con include_closed=false. Le routine
// completate spariscono da quella risposta, quindi finivano fuori sia da
// "done" che da "all": in griglia risultavano × (saltate) le uniche
// rimaste aperte e le fatte non comparivano proprio. Lo stesso motivo per
// cui il cron notturno usa include_closed=true.
export async function fetchRoutineTasks() {
  if (!CLICKUP_API_KEY) throw new Error("CLICKUP_API_KEY non configurata");
  const res = await fetch(
    `https://api.clickup.com/api/v2/list/${ROUTINE_DAILY_LIST_ID}/task?include_closed=true`,
    { headers: { Authorization: CLICKUP_API_KEY }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`ClickUp list routine: ${res.status}`);
  return (await res.json()).tasks || [];
}

// Snapshot del giorno in corso, calcolato al volo: il cron lo salvera' solo
// stanotte, ma la griglia deve mostrare oggi in tempo reale.
export async function snapshotOggi() {
  const tasks = await fetchRoutineTasks();
  if (tasks.length === 0) return null;
  return {
    data: bucharestDate(0),
    done: tasks.filter(isTaskDone).map((t) => t.name),
    all:  tasks.map((t) => t.name),
  };
}

// Salva (o sovrascrive) lo snapshot di un giorno.
// "all" vuoto = non scriviamo: una giornata "0 su 0" falserebbe le medie.
export async function saveSnapshot(day, done, all) {
  if (!Array.isArray(all) || all.length === 0) return { success: false, motivo: "nessuna abitudine attiva" };
  const days = await readHabits();
  const entry = { data: day, done: done || [], all };
  const idx = days.findIndex((d) => d.data === day);
  if (idx >= 0) days[idx] = entry;
  else days.push(entry);
  const sorted = days.sort((a, b) => (a.data < b.data ? -1 : 1));
  await writeHabits(sorted);
  return { success: true, giorni: sorted.length, entry };
}
