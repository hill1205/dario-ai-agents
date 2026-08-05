export const dynamic = "force-dynamic";
export const revalidate = 0;

import { readGratitude, salvaGiorno, compilato, bucharestDate } from "../../lib/gratitude-store";

// Un diario che non si rilegge e' data entry. Il server tira fuori da solo
// la voce di un mese fa e quella di un anno fa, cosi' la dashboard non deve
// rifare i conti sulle date (e sbagliarli, come e' gia' successo con le
// date locali a fine luglio).
function vociDelPassato(days) {
  const byDate = new Map(days.map((d) => [d.data, d]));
  const out = {};
  const cerca = (offsetGiorni) => {
    const target = bucharestDate(-offsetGiorni);
    const v = byDate.get(target);
    return v && compilato(v) ? v : null;
  };
  out.unMeseFa = cerca(30);
  out.unAnnoFa = cerca(365);
  return out;
}

export async function GET() {
  try {
    const days = await readGratitude();
    const oggi = bucharestDate(0);
    return Response.json({
      days,
      oggi,
      // Elenco delle date compilate: alla griglia serve solo questo per
      // decidere dove mettere il cuore, non tutto il testo.
      compilati: days.filter(compilato).map((d) => d.data),
      ...vociDelPassato(days),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const esito = await salvaGiorno(body);
    if (!esito.ok) {
      return Response.json(
        { error: esito.errore, congelato: esito.congelato },
        { status: esito.status || 400 }
      );
    }
    return Response.json({
      success: true,
      giorno: esito.entry,
      compilato: compilato(esito.entry),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
