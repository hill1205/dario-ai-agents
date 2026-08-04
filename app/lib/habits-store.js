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

export const isTaskDone = (t) => DONE_STATUSES.includes((t?.status?.status || "").toLowerCase());

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
