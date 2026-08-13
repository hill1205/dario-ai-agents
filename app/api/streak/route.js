export const dynamic = "force-dynamic";

import { creaArchivio } from "../../lib/clickup-doc";

// Doc dedicato allo storico streak routine, separato dal Doc "peso" perché
// concettualmente e' un dato diverso (non fisico). Creato apposta per
// smettere di tenere lo streak solo in localStorage: prima viveva solo nel
// browser, quindi cambiando dispositivo o svuotando la cache lo streak
// spariva anche se le routine erano state completate regolarmente.
const archivio = creaArchivio({
  docId: "2kxuu4g1-952",
  pageId: "2kxuu4g1-1272",
  marcatore: "STREAK_DATA_JSON",
  vuoto: [],
  intestazione: "STORICO STREAK ROUTINE DARIO\n\nNon modificare a mano: viene letto/scritto dalla dashboard.",
});

const readStreakDoc = (opts) => archivio.leggi(opts);
const writeStreakDoc = (days) => archivio.scrivi(days);

// Calcola lo streak corrente: numero di giorni consecutivi (fino a oggi o
// ieri) in cui "completed" è true. Se manca il giorno di oggi lo streak
// resta valido finché non passa anche ieri senza completamento, cosi' un
// giorno ancora in corso non azzera il conteggio prematuramente.
// Data nel fuso di Dario (Europe/Bucharest), non in UTC: il server Vercel
// gira in UTC, quindi tra mezzanotte e le 3 di notte "oggi" sarebbe stato
// ieri — segnando la routine sul giorno sbagliato e falsando lo streak.
function bucharestDate(offsetDays = 0) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + offsetDays * 86400000)); // YYYY-MM-DD
}

function computeStreak(days) {
  const byDate = new Map(days.map((d) => [d.data, d.completed]));
  let count = 0;
  // Se oggi non e' ancora segnato come completato, si parte da ieri.
  let offset = byDate.get(bucharestDate(0)) ? 0 : -1;
  while (byDate.get(bucharestDate(offset))) {
    count++;
    offset--;
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
    const day = data || bucharestDate(0);
    const days = await readStreakDoc({ forza: true });
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
