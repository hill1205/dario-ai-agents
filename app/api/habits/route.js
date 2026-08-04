export const dynamic = "force-dynamic";
export const revalidate = 0;

import { readHabits, saveSnapshot, snapshotOggi, bucharestDate } from "../../lib/habits-store";

// Storico per singola abitudine. Ogni voce e'
// { data:"YYYY-MM-DD", done:[nomi], all:[nomi] }.
// "all" serve perche' le routine cambiano nel tempo: senza la lista delle
// abitudini attive QUEL giorno, una routine aggiunta oggi risulterebbe
// "saltata" per tutti i giorni precedenti, sporcando le percentuali.

export async function GET() {
  try {
    const storico = await readHabits();
    const oggi = bucharestDate(0);

    // Il giorno in corso lo calcoliamo qui e non lato client: serve la
    // lista routine con include_closed=true, che /api/tasks non
    // restituisce (le completate sparirebbero, contate come saltate).
    let live = null;
    try { live = await snapshotOggi(); } catch {}

    let days = storico;
    if (live) {
      days = [...storico.filter((d) => d.data !== oggi), live];
      // Persistiamo subito: se il cron notturno fallisce, almeno l'ultimo
      // stato visto resta salvato.
      saveSnapshot(live.data, live.done, live.all).catch(() => {});
    }

    days.sort((a, b) => (a.data < b.data ? -1 : 1));
    return Response.json({ days, oggi });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const day = body.data || bucharestDate(0);
    const result = await saveSnapshot(day, body.done, body.all);
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
