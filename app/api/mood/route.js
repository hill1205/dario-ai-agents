export const dynamic = "force-dynamic";
export const revalidate = 0;

// Le regole del mood (fasce, immutabilita', media, formato vecchio) stanno
// in lib/mood-store.js: qui resta solo il trasporto HTTP. Erano in questo
// file fino al 05/08/2026, sono state spostate quando e' nato
// /api/abitudini-tutto, che ha bisogno degli stessi dati.
import { datiMood, salvaMood } from "../../lib/mood-store";

// Ri-esportate per non rompere chi le importava da qui.
export { FASCE, mediaMood } from "../../lib/mood-store";

export async function GET() {
  try {
    return Response.json(await datiMood());
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const esito = await salvaMood(await request.json());
    if (!esito.ok) {
      return Response.json(
        { error: esito.errore, bloccato: esito.bloccato, fascia: esito.fascia },
        { status: esito.status || 400 }
      );
    }
    return Response.json({ success: true, giorno: esito.giorno, fascia: esito.fascia });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
