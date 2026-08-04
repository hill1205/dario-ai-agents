export const dynamic = "force-dynamic";
export const revalidate = 0;

import { readHabits, saveSnapshot, bucharestDate } from "../../lib/habits-store";

// Storico per singola abitudine. Ogni voce e'
// { data:"YYYY-MM-DD", done:[nomi], all:[nomi] }.
// "all" serve perche' le routine cambiano nel tempo: senza la lista delle
// abitudini attive QUEL giorno, una routine aggiunta oggi risulterebbe
// "saltata" per tutti i giorni precedenti, sporcando le percentuali.

export async function GET() {
  try {
    const days = (await readHabits()).sort((a, b) => (a.data < b.data ? -1 : 1));
    return Response.json({ days, oggi: bucharestDate(0) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// Chiamato dalla dashboard per il giorno in corso, cosi' la griglia mostra
// oggi in tempo reale invece di restare vuota fino allo snapshot notturno.
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
