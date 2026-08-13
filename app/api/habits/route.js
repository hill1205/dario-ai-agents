export const dynamic = "force-dynamic";
export const revalidate = 0;

import {
  readHabits, saveSnapshot, snapshotOggi, bucharestDate,
  toggleGiornoPassato, toggleOggiSuClickUp, setNota,
} from "../../lib/habits-store";

// Storico per singola abitudine.
// { data:"YYYY-MM-DD", done:[nomi], all:[nomi], strategiche:[nomi], nota }
//
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
      const prev = storico.find((d) => d.data === oggi) || {};
      // La nota del giorno la scrive Dario, non ClickUp: va conservata.
      days = [...storico.filter((d) => d.data !== oggi), { ...live, nota: prev.nota }];
      // NIENTE scrittura qui: lo snapshot del giorno in corso lo salva
      // /api/abitudini-tutto, che è l'endpoint che la dashboard usa davvero.
      // Prima lo facevano entrambi, in fire-and-forget: due read-modify-write
      // concorrenti sulla stessa pagina ClickUp, senza lock né versione,
      // quindi l'ultimo che finiva cancellava il lavoro dell'altro. Un solo
      // scrittore è la parte di correzione che conta di più.
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
    return Response.json(await saveSnapshot(day, body));
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// PATCH = correzioni manuali dalla griglia.
//   { azione:"toggle", data, abitudine }  → inverte fatta/saltata
//   { azione:"nota",   data, nota }       → salva la nota del giorno
//
// Per OGGI il toggle deve passare da ClickUp, non dallo storico: il giorno
// in corso viene ricalcolato dalle task ad ogni caricamento, quindi una
// correzione scritta solo nel Doc verrebbe cancellata subito dopo.
export async function PATCH(request) {
  try {
    const { azione, data, abitudine, nota } = await request.json();
    const oggi = bucharestDate(0);

    if (azione === "nota") {
      if (!data) return Response.json({ error: "data mancante" }, { status: 400 });
      return Response.json(await setNota(data, nota || ""));
    }

    if (azione === "toggle") {
      if (!data || !abitudine) return Response.json({ error: "data o abitudine mancanti" }, { status: 400 });
      if (data > oggi) return Response.json({ success: false, motivo: "non si corregge il futuro" });
      const res = data === oggi
        ? await toggleOggiSuClickUp(abitudine)
        : await toggleGiornoPassato(data, abitudine);
      return Response.json(res);
    }

    return Response.json({ error: "azione non riconosciuta" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
