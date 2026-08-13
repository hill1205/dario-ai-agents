export const dynamic = "force-dynamic";
export const revalidate = 0;

import { readHabits, snapshotOggi, saveSnapshot, bucharestDate } from "../../lib/habits-store";
import { datiMood } from "../../lib/mood-store";
import { datiGratitudine } from "../../lib/gratitude-store";

// Un solo giro per la pagina Abitudini.
//
// Perche' esiste: la pagina apriva tre connessioni separate verso Vercel
// (/api/habits, /api/mood, /api/gratitude) e il client aspettava tutte e tre
// prima di disegnare qualsiasi cosa. Da telefono ogni chiamata costa
// handshake TLS piu' eventuale avvio a freddo della funzione: tre volte quel
// costo, in serie con la rete mobile, sono i secondi che Dario vedeva come
// "il mood non si carica".
//
// Qui le tre letture partono in parallelo DENTRO il datacenter, dove la
// latenza verso ClickUp e' bassa, e il browser fa un viaggio solo.
//
// allSettled e non all: se il diario della sera va in errore, abitudini e
// mood devono arrivare lo stesso. Ogni sezione porta il suo errore, cosi'
// la UI puo' dire quale pezzo manca invece di svuotare la pagina.

async function datiHabits() {
  const storico = await readHabits();
  const oggi = bucharestDate(0);

  // Il giorno in corso si calcola qui e non lato client: serve la lista
  // routine con include_closed=true, che /api/tasks non restituisce.
  let live = null;
  try { live = await snapshotOggi(); } catch {}

  let days = storico;
  if (live) {
    const prev = storico.find((d) => d.data === oggi) || {};
    // La nota del giorno la scrive Dario, non ClickUp: va conservata.
    days = [...storico.filter((d) => d.data !== oggi), { ...live, nota: prev.nota }];
    // AWAIT, non fire-and-forget. Su Vercel la funzione serverless viene
    // congelata appena si restituisce la Response: una scrittura ancora in
    // volo poteva essere troncata a metà, e lo snapshot del giorno spariva
    // ogni tanto senza che niente lo segnalasse. Costa ~400ms di ClickUp ed è
    // la differenza tra "salvato" e "forse salvato".
    //
    // L'errore resta non fatale: se il Doc non risponde, la pagina Abitudini
    // deve caricarsi lo stesso — lo snapshot vero lo rifà il cron a mezzanotte.
    // Questo è ora l'UNICO punto dell'app che scrive lo snapshot del giorno in
    // corso (prima lo faceva anche /api/habits, in concorrenza con questo).
    try { await saveSnapshot(live.data, live); } catch {}
  }

  days.sort((a, b) => (a.data < b.data ? -1 : 1));
  return { days, oggi };
}

const esito = (r) => (r.status === "fulfilled"
  ? r.value
  : { error: r.reason?.message || "errore sconosciuto" });

export async function GET() {
  const [h, m, g] = await Promise.allSettled([
    datiHabits(),
    datiMood(),
    datiGratitudine(),
  ]);

  return Response.json({
    habits: esito(h),
    mood: esito(m),
    gratitude: esito(g),
    oggi: bucharestDate(0),
  });
}
