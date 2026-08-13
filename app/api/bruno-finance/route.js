export const dynamic = "force-dynamic";

import { creaArchivio } from "../../lib/clickup-doc";

// Finanze personali (Bruno). Stessa forma delle finanze IAGREX: un oggetto
// per mese, non una lista.
const archivio = creaArchivio({
  docId: "2kxuu4g1-712",
  pageId: "2kxuu4g1-952",
  marcatore: "BRUNO_FINANCE_JSON",
  vuoto: {},
  senzaCache: true,
});

export async function GET() {
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
