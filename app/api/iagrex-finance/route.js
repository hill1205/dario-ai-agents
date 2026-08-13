export const dynamic = "force-dynamic";

import { creaArchivio } from "../../lib/clickup-doc";

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
    return Response.json({ data: await archivio.leggi() });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { data } = await request.json();
    await archivio.scrivi(data);
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
