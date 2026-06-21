const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const WORKSPACE_ID = "90121769473";
const DOC_ID = "2kxuu4g1-612";
const PAGE_ID = "2kxuu4g1-312";
const OBIETTIVO_PESO = 85;
const PESO_INIZIALE = 121.6;

async function readWeightDoc() {
  const res = await fetch(
    `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${PAGE_ID}?content_format=text/plain`,
    { headers: { Authorization: CLICKUP_API_KEY } }
  );
  const data = await res.json();
  const content = data.content || "";
  const match = content.match(/WEIGHT_DATA_JSON:(.*?)(:?$|\n)/s);
  if (match) {
    try { return JSON.parse(match[1].trim()); } catch { return []; }
  }
  return [];
}

async function writeWeightDoc(entries) {
  const json = JSON.stringify(entries);
  const ultimo = entries[entries.length - 1];
  const content = `STORICO PESO DARIO\n\nObiettivo: ${OBIETTIVO_PESO} kg\nPeso iniziale: ${PESO_INIZIALE} kg\nUltimo peso: ${ultimo?.peso || "N/D"} kg (${ultimo?.data || ""})\n\nWEIGHT_DATA_JSON:${json}`;
  await fetch(
    `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${PAGE_ID}`,
    {
      method: "PUT",
      headers: { Authorization: CLICKUP_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }
  );
}

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
    if (!data || !peso) return Response.json({ error: "Missing data or peso" }, { status: 400 });
    const entries = await readWeightDoc();
    entries.push({ data, peso: parseFloat(peso) });
    entries.sort((a, b) => new Date(a.data) - new Date(b.data));
    await writeWeightDoc(entries);
    return Response.json({ success: true, entries });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
