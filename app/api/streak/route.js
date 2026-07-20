export const dynamic = "force-dynamic";

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const WORKSPACE_ID = "90121769473";
// Doc dedicato allo storico streak routine, separato dal Doc "peso" perché
// concettualmente e' un dato diverso (non fisico). Creato apposta per
// smettere di tenere lo streak solo in localStorage: prima viveva solo nel
// browser, quindi cambiando dispositivo o svuotando la cache lo streak
// spariva anche se le routine erano state completate regolarmente.
const DOC_ID = "2kxuu4g1-952";
const PAGE_ID = "2kxuu4g1-1272";

async function readStreakDoc() {
  if (!CLICKUP_API_KEY) throw new Error("CLICKUP_API_KEY non configurata");
  const res = await fetch(
    `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${PAGE_ID}?content_format=text/plain`,
    { headers: { Authorization: CLICKUP_API_KEY }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`ClickUp doc error: ${res.status}`);
  const data = await res.json();
  const content = data.content || "";
  const match = content.match(/STREAK_DATA_JSON:([\s\S]*)/);
  if (!match) return []; // pagina esistente ma senza storico ancora: caso legittimo
  try { return JSON.parse(match[1].trim()); }
  catch { throw new Error("Formato dati streak non riconosciuto (JSON malformato nel Doc)"); }
}

async function writeStreakDoc(days) {
  const json = JSON.stringify(days);
  const content = `STORICO STREAK ROUTINE DARIO\n\nNon modificare a mano: viene letto/scritto dalla dashboard.\n\nSTREAK_DATA_JSON:${json}`;
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

// Calcola lo streak corrente: numero di giorni consecutivi (fino a oggi o
// ieri) in cui "completed" è true. Se manca il giorno di oggi lo streak
// resta valido finché non passa anche ieri senza completamento, cosi' un
// giorno ancora in corso non azzera il conteggio prematuramente.
function computeStreak(days) {
  const byDate = new Map(days.map((d) => [d.data, d.completed]));
  const todayStr = new Date().toISOString().slice(0, 10);
  let count = 0;
  let cursor = new Date();
  // Se oggi non e' ancora segnato come completato, si parte da ieri.
  if (!byDate.get(todayStr)) cursor.setDate(cursor.getDate() - 1);
  while (true) {
    const ds = cursor.toISOString().slice(0, 10);
    if (byDate.get(ds)) {
      count++;
      cursor.setDate(cursor.getDate() - 1);
    } else break;
  }
  return count;
}

export async function GET() {
  try {
    const days = await readStreakDoc();
    const sorted = [...days].sort((a, b) => new Date(a.data) - new Date(b.data));
    const ultimi_30 = sorted.slice(-30);
    return Response.json({ days: sorted, streak: computeStreak(sorted), ultimi_30 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// Segna il giorno indicato (default: oggi) come completato/non completato.
export async function POST(request) {
  try {
    const { data, completed } = await request.json();
    const day = data || new Date().toISOString().slice(0, 10);
    const days = await readStreakDoc();
    const idx = days.findIndex((d) => d.data === day);
    if (idx >= 0) days[idx].completed = !!completed;
    else days.push({ data: day, completed: !!completed });
    const sorted = days.sort((a, b) => new Date(a.data) - new Date(b.data));
    await writeStreakDoc(sorted);
    return Response.json({ success: true, streak: computeStreak(sorted) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
