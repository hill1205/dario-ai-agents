import { creaArchivio } from "../../lib/clickup-doc";

const OBIETTIVO_PESO = 85;
const PESO_INIZIALE = 121.6;

// Storico peso. Non ingoiare gli errori di ClickUp restituendo un array
// vuoto come se il peso non fosse mai stato registrato: quello farebbe
// sparire lo storico dalla dashboard invece di segnalare che il dato non
// si e' caricato — per questo archivio.leggi() lancia e la route risponde
// 500.
const archivio = creaArchivio({
  docId: "2kxuu4g1-612",
  pageId: "2kxuu4g1-312",
  marcatore: "WEIGHT_DATA_JSON",
  vuoto: [],
  intestazione: (entries) => {
    const ultimo = entries[entries.length - 1];
    return `STORICO PESO DARIO\n\nObiettivo: ${OBIETTIVO_PESO} kg\nPeso iniziale: ${PESO_INIZIALE} kg\nUltimo peso: ${ultimo?.peso || "N/D"} kg (${ultimo?.data || ""})`;
  },
});

const readWeightDoc = (opts) => archivio.leggi(opts);
const writeWeightDoc = (entries) => archivio.scrivi(entries);

export async function GET() {
  try {
    const entries = await readWeightDoc();
    const ultimo = entries[entries.length - 1];
    const persi = ultimo ? Math.round((PESO_INIZIALE - ultimo.peso) * 10) / 10 : 0;
    const mancano = ultimo ? Math.round((ultimo.peso - OBIETTIVO_PESO) * 10) / 10 : 0;
    return Response.json({ entries, ultimo, persi, mancano, obiettivo: OBIETTIVO_PESO, inizio: PESO_INIZIALE });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { data, peso } = await request.json();
    const pesoNum = parseFloat(peso);
    if (!data || peso === undefined || peso === null || peso === "" || isNaN(pesoNum)) {
      return Response.json({ error: "Missing data or peso" }, { status: 400 });
    }
    const entries = await readWeightDoc({ forza: true });
    entries.push({ data, peso: pesoNum });
    entries.sort((a, b) => new Date(a.data) - new Date(b.data));
    await writeWeightDoc(entries);
    return Response.json({ success: true, entries });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
