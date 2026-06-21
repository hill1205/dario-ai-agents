const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const WORKSPACE_ID = "90121769473";
const DOC_ID = "2kxuu4g1-752";
const PAGE_ID = "2kxuu4g1-552";
const OBIETTIVO_ANNUALE = 1000000;

async function fetchDocContent() {
  const res = await fetch(
    `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${PAGE_ID}?content_format=text/plain`,
    { headers: { Authorization: CLICKUP_API_KEY } }
  );
  const data = await res.json();
  return data.content || "";
}

async function parseRevenueWithAI(text) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `Analizza questo testo contabile e restituisci SOLO un JSON valido, senza markdown, senza backtick, senza spiegazioni.

Il JSON deve avere esattamente questa struttura:
{
  "entrate_totali": <numero>,
  "uscite_totali": <numero>,
  "saldo": <numero>,
  "mese": "<stringa>",
  "fatture": [{"descrizione": "<string>", "importo": <numero>}],
  "uscite_dettaglio": [{"descrizione": "<string>", "importo": <numero>}]
}

Se un valore non è presente nel testo, usa 0 per i numeri e array vuoto per le liste.

Testo:
${text}`,
        },
      ],
    }),
  });

  const data = await res.json();
  const raw = data.content?.[0]?.text || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    return {
      entrate_totali: 0,
      uscite_totali: 0,
      saldo: 0,
      mese: "N/D",
      fatture: [],
      uscite_dettaglio: [],
    };
  }
}

export async function GET() {
  try {
    const docText = await fetchDocContent();
    const parsed = await parseRevenueWithAI(docText);

    return Response.json({
      ...parsed,
      obiettivo_annuale: OBIETTIVO_ANNUALE,
      percentuale: parsed.entrate_totali
        ? Math.round((parsed.entrate_totali / OBIETTIVO_ANNUALE) * 100 * 10) / 10
        : 0,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
