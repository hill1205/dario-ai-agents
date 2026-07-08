import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

// Archivio idee vocali (bottone 🎙️ Idea nella dashboard), spostato da
// localStorage a Notion per due motivi: 1) sopravvive a cambio browser/
// dispositivo, cosa che il vecchio storage locale non garantiva; 2) apre
// la strada al rito settimanale del venerdì, che deve poter distinguere
// idee "Da valutare" da quelle già smaltite (Diventata task/Ignorata/
// Scartata) — distinzione che localStorage da solo non modellava.
const NOTION_TOKEN = process.env.NOTION_API_KEY;
const DATA_SOURCE_ID = "a9d105b6-64c8-444f-97e2-cde55b3018e9"; // 🎙️ Idee Vocali
// Stessa versione API usata (dopo il fix) da pipeline-data.js: l'endpoint
// /data_sources/{id}/query richiede 2025-09-03+, non la vecchia 2022-06-28.
const NOTION_VERSION = "2025-09-03";

async function notionFetch(path, options = {}) {
  return fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

function pageToIdea(page) {
  const p = page.properties;
  return {
    id: page.id,
    notionId: page.id,
    text: p["Idea"]?.title?.[0]?.plain_text || "",
    stato: p["Stato"]?.select?.name || "Da valutare",
    note: p["Note"]?.rich_text?.[0]?.plain_text || "",
    data: page.created_time || new Date().toISOString(),
  };
}

export async function GET() {
  if (!NOTION_TOKEN) {
    return NextResponse.json({ error: "NOTION_API_KEY non configurata" }, { status: 500 });
  }
  try {
    let ideas = [];
    let cursor;
    do {
      const res = await notionFetch(`/data_sources/${DATA_SOURCE_ID}/query`, {
        method: "POST",
        body: JSON.stringify({ start_cursor: cursor, page_size: 100 }),
      });
      if (!res.ok) {
        const errText = await res.text();
        return NextResponse.json({ error: `Notion error ${res.status}: ${errText}` }, { status: 500 });
      }
      const data = await res.json();
      ideas.push(...data.results.map(pageToIdea));
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
    // Più recenti prima, come nel vecchio comportamento localStorage.
    ideas.sort((a, b) => new Date(b.data) - new Date(a.data));
    return NextResponse.json({ ideas });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Crea una nuova idea. Usato solo per l'aggiunta (il bottone 🎙️ Idea);
// per aggiornare stato/note di un'idea esistente si usa PATCH.
export async function POST(req) {
  if (!NOTION_TOKEN) {
    return NextResponse.json({ error: "NOTION_API_KEY non configurata" }, { status: 500 });
  }
  try {
    const { text } = await req.json();
    if (!text || !text.trim()) {
      return NextResponse.json({ error: "text mancante" }, { status: 400 });
    }
    const res = await notionFetch(`/pages`, {
      method: "POST",
      body: JSON.stringify({
        parent: { data_source_id: DATA_SOURCE_ID },
        properties: {
          "Idea": { title: [{ text: { content: text.trim() } }] },
          "Stato": { select: { name: "Da valutare" } },
        },
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `Notion error ${res.status}: ${errText}` }, { status: 500 });
    }
    const page = await res.json();
    return NextResponse.json({ success: true, idea: pageToIdea(page) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Aggiorna stato/note di un'idea esistente (usato dal rito del venerdì:
// segnare come "Diventata task" / "Ignorata" / "Scartata").
export async function PATCH(req) {
  if (!NOTION_TOKEN) {
    return NextResponse.json({ error: "NOTION_API_KEY non configurata" }, { status: 500 });
  }
  try {
    const { notionId, stato, note } = await req.json();
    if (!notionId) return NextResponse.json({ error: "notionId mancante" }, { status: 400 });
    const properties = {};
    if (stato) properties["Stato"] = { select: { name: stato } };
    if (note !== undefined) properties["Note"] = { rich_text: note ? [{ text: { content: note } }] : [] };
    const res = await notionFetch(`/pages/${notionId}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `Notion error ${res.status}: ${errText}` }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Elimina (archivia) un'idea — usato per il pulsante "×" esistente.
export async function DELETE(req) {
  if (!NOTION_TOKEN) {
    return NextResponse.json({ error: "NOTION_API_KEY non configurata" }, { status: 500 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const notionId = searchParams.get("id");
    if (!notionId) return NextResponse.json({ error: "id mancante" }, { status: 400 });
    const res = await notionFetch(`/pages/${notionId}`, {
      method: "PATCH",
      body: JSON.stringify({ archived: true }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `Notion error ${res.status}: ${errText}` }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
