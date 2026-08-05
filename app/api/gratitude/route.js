export const dynamic = "force-dynamic";
export const revalidate = 0;

// Le regole del diario (congelamento a mezzanotte, cosa conta come giorno
// scritto, voci del passato) stanno in lib/gratitude-store.js: qui resta
// solo il trasporto HTTP. Gli stessi dati li serve anche
// /api/abitudini-tutto, che e' la strada che usa la dashboard.
import { datiGratitudine, salvaGiorno, compilato } from "../../lib/gratitude-store";

export async function GET() {
  try {
    return Response.json(await datiGratitudine());
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const esito = await salvaGiorno(await request.json());
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
