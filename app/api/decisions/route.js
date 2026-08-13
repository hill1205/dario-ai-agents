export const dynamic = "force-dynamic";
export const revalidate = 0;

// Trasporto HTTP per il registro decisioni. Tutte le regole (cosa è
// obbligatorio, la finestra di 24 ore sulle modifiche, quando una decisione
// è "da rivedere") stanno in lib/decisions-store.js, così restano usabili
// anche dal cron o dal bot Telegram, che non possono passare da fetch a
// causa del Basic Auth nel middleware.

import {
  datiDecisioni,
  conteggioDaRivedere,
  creaDecisione,
  aggiornaDecisione,
  salvaRevisione,
  rimandaRevisione,
  eliminaDecisione,
} from "../../lib/decisions-store";

const errore = (esito) =>
  Response.json(
    { error: esito.errore, congelata: esito.congelata || false },
    { status: esito.status || 400 }
  );

// ?soloConteggio=1 → risposta minima per il banner in home (un intero),
// invece di far viaggiare tutto lo storico ad ogni apertura dell'app.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("soloConteggio") === "1") {
      return Response.json(await conteggioDaRivedere());
    }
    return Response.json(await datiDecisioni());
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const esito = await creaDecisione(await request.json());
    if (!esito.ok) return errore(esito);
    return Response.json({ success: true, decisione: esito.decisione });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// Un solo PATCH con tre azioni invece di tre endpoint: agiscono tutte
// sullo stesso array nella stessa pagina del Doc, e tenerle separate
// significherebbe tre file che rileggono e riscrivono la stessa risorsa.
//   azione "modifica"  → correggi la decisione (solo entro 24 ore)
//   azione "revisione" → compila le sei domande del follow-up
//   azione "rimanda"   → sposta di N giorni una delle date di revisione
//
// "revisione" e "rimanda" vogliono anche "indice": una decisione può avere
// fino a tre revisioni, e l'id da solo non basta più a dire quale.
export async function PATCH(request) {
  try {
    const body = await request.json();
    const { id, azione, indice } = body;
    if (!id) return Response.json({ error: "id mancante" }, { status: 400 });

    let esito;
    // body.dataRevisione, quando c'è, identifica la revisione in modo stabile:
    // l'indice si sposta se l'array viene riordinato (vedi rimandaRevisione).
    if (azione === "revisione")      esito = await salvaRevisione(id, indice, body);
    else if (azione === "rimanda")   esito = await rimandaRevisione(id, indice, body.giorni, body.dataRevisione);
    else                             esito = await aggiornaDecisione(id, body);

    if (!esito.ok) return errore(esito);
    return Response.json({ success: true, decisione: esito.decisione });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return Response.json({ error: "id mancante" }, { status: 400 });
    const esito = await eliminaDecisione(id);
    if (!esito.ok) return errore(esito);
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
