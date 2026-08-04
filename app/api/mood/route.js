export const dynamic = "force-dynamic";
export const revalidate = 0;

import { bucharestDate } from "../../lib/habits-store";

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const WORKSPACE_ID = "90121769473";
// Doc "Storico Abitudini e Mood (dashboard)" — pagina Mood.
const DOC_ID = "2kxuu4g1-972";
const PAGE_ID = "2kxuu4g1-1392";

// Ogni voce e' { data:"YYYY-MM-DD", umore:1-5, energia:1-5, motivazione:1-5 }.
// Scala 1-5 e non 1-10: con dieci livelli la differenza tra 6 e 7 e' rumore,
// il dato smette di essere confrontabile nel tempo.

async function readDoc() {
  if (!CLICKUP_API_KEY) throw new Error("CLICKUP_API_KEY non configurata");
  const res = await fetch(
    `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${PAGE_ID}?content_format=text/plain`,
    { headers: { Authorization: CLICKUP_API_KEY }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`ClickUp doc error: ${res.status}`);
  const data = await res.json();
  const match = (data.content || "").match(/MOOD_DATA_JSON:([\s\S]*)/);
  if (!match) return [];
  try { return JSON.parse(match[1].trim()); }
  catch { throw new Error("Formato dati mood non riconosciuto (JSON malformato nel Doc)"); }
}

async function writeDoc(days) {
  const content = `STORICO MOOD DARIO\n\nNon modificare a mano: viene letto/scritto dalla dashboard.\nOgni voce: { data, umore, energia, motivazione } su scala 1-5.\n\nMOOD_DATA_JSON:${JSON.stringify(days)}`;
  const res = await fetch(
    `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${PAGE_ID}`,
    {
      method: "PUT",
      headers: { Authorization: CLICKUP_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }
  );
  if (!res.ok) throw new Error(`ClickUp doc write error: ${res.status}`);
}

const clamp = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(5, Math.max(1, Math.round(n)));
};

export async function GET() {
  try {
    const days = (await readDoc()).sort((a, b) => (a.data < b.data ? -1 : 1));
    return Response.json({ days, oggi: bucharestDate(0) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const day = body.data || bucharestDate(0);
    const days = await readDoc();
    const idx = days.findIndex((d) => d.data === day);
    // Merge invece di sovrascrittura: Dario puo' segnare l'energia la
    // mattina e la motivazione la sera senza azzerare quello che aveva
    // gia' messo.
    const prev = idx >= 0 ? days[idx] : { data: day };
    const next = { ...prev, data: day };
    for (const k of ["umore", "energia", "motivazione"]) {
      if (body[k] !== undefined && body[k] !== null) {
        const v = clamp(body[k]);
        if (v !== null) next[k] = v;
      }
    }
    if (idx >= 0) days[idx] = next;
    else days.push(next);

    const sorted = days.sort((a, b) => (a.data < b.data ? -1 : 1));
    await writeDoc(sorted);
    return Response.json({ success: true, giorno: next });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
