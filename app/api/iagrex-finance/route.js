export const dynamic = "force-dynamic";

import { creaArchivio, ConflittoVersione } from "../../lib/clickup-doc";

const archivio = creaArchivio({
  docId: "2kxuu4g1-752",
  pageId: "2kxuu4g1-972",
  marcatore: "IAGREX_FINANCE_JSON",
  vuoto: {}, // oggetto { "2026-08": { entrate, uscite }, ... }, non lista
  senzaCache: true,
});

export async function GET() {
  // Importante: NON restituire { data: {} } con status 200 quando ClickUp
  // fallisce. IAGREXPage.jsx salva sempre l'intero oggetto "allData" (tutti
  // i mesi) ogni volta che modifichi una voce — se un errore transitorio
  // facesse credere al frontend che i dati sono "vuoti ma ok", la prossima
  // modifica sovrascriverebbe silenziosamente su ClickUp lo storico di TUTTI
  // i mesi con un oggetto vuoto. Meglio un errore esplicito (status 500)
  // che il frontend puo' controllare prima di lasciarti salvare.
  try {
    // `rev` viaggia insieme ai dati: la pagina se lo tiene e lo rimanda al
    // salvataggio, così il server può accorgersi se nel frattempo ha scritto
    // qualcun altro (l'altro dispositivo) invece di lasciarlo sovrascrivere.
    const { dati, rev } = await archivio.leggiConRev();
    return Response.json({ data: dati, rev });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { data, rev } = await request.json();
    const nuovaRev = await archivio.scrivi(data, { revAttesa: rev });
    return Response.json({ success: true, rev: nuovaRev });
  } catch (e) {
    if (e instanceof ConflittoVersione || e.conflitto) {
      // 409 e non 500: non è un guasto, è "qualcuno ha salvato prima di te".
      // Il frontend lo distingue e propone di ricaricare invece di far
      // sparire in silenzio le modifiche dell'altro dispositivo.
      return Response.json(
        { error: e.message, conflitto: true, revTrovata: e.revTrovata },
        { status: 409 }
      );
    }
    return Response.json({ error: e.message }, { status: 500 });
  }
}
