export const dynamic = "force-dynamic";

import { creaArchivio, ConflittoVersione } from "../../lib/clickup-doc";

// Finanze personali (Bruno). Stessa forma delle finanze IAGREX: un oggetto
// per mese, non una lista.
const archivio = creaArchivio({
  docId: "2kxuu4g1-712",
  pageId: "2kxuu4g1-952",
  marcatore: "BRUNO_FINANCE_JSON",
  vuoto: {},
  senzaCache: true,
});

// Stesso versionamento di /api/iagrex-finance: la pagina salva tutti i mesi
// in blocco, quindi due dispositivi aperti insieme si cancellerebbero a
// vicenda. Vedi il commento su REV in lib/clickup-doc.js.
export async function GET() {
  try {
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
      return Response.json(
        { error: e.message, conflitto: true, revTrovata: e.revTrovata },
        { status: 409 }
      );
    }
    return Response.json({ error: e.message }, { status: 500 });
  }
}
