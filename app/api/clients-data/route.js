import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

// Pagina Clienti separata dalla Pipeline (database Notion dedicato, non lo
// stesso della pipeline lead) — nata perché mescolare lead in trattativa
// con clienti già attivi in un'unica vista rendeva difficile ragionare
// sulla fatturazione mese per mese. La fatturazione stessa non è un campo
// Notion singolo (Notion non modella bene "un valore diverso per ogni
// mese" su una proprietà nativa): è un JSON dentro "Fatturazione JSON",
// stesso pattern già usato per finanze/peso/streak in questa app.
const NOTION_TOKEN = process.env.NOTION_API_KEY;
const DATA_SOURCE_ID = "ec2d4f93-a120-43ab-964e-b0aecffea2b7"; // 👥 Clienti
const NOTION_VERSION = "2025-09-03"; // vedi pipeline-data.js: 2022-06-28 non supporta /data_sources/{id}/query

const FASE_TO_APP = { "Attivo":"attivo", "In Pausa":"in_pausa", "Concluso":"concluso" };
const FASE_TO_NOTION = Object.fromEntries(Object.entries(FASE_TO_APP).map(([k,v])=>[v,k]));

function notionPageToClient(page) {
  const p = page.properties;
  const getText  = (prop) => prop?.rich_text?.[0]?.plain_text || "";
  const getTitle = (prop) => prop?.title?.[0]?.plain_text || "";
  const getSel   = (prop) => prop?.select?.name || "";
  let fatturazione = [];
  const raw = getText(p["Fatturazione JSON"]);
  if (raw) { try { fatturazione = JSON.parse(raw); } catch {} }
  return {
    id:              page.id,
    notionId:        page.id,
    nome:            getTitle(p["Nome"]),
    fase:            FASE_TO_APP[getSel(p["Fase"])] || "attivo",
    categoria:       getSel(p["Categoria"]) || "",
    contatto:        getText(p["Contatto"]),
    email:           p["Email"]?.email || "",
    telefono:        p["Telefono"]?.phone_number || "",
    sito:            p["Sito Web"]?.url || "",
    budget:          p["Budget Mensile"]?.number != null ? String(p["Budget Mensile"].number) : "",
    data_inizio:     p["Data Inizio"]?.date?.start || "",
    note:            getText(p["Note"]),
    fatturazione,
  };
}

async function notionFetch(path, options = {}) {
  return fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

export async function GET() {
  if (!NOTION_TOKEN) {
    return NextResponse.json({ error: "NOTION_API_KEY non configurata" }, { status: 500 });
  }
  try {
    let clients = [];
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
      clients.push(...data.results.map(notionPageToClient));
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
    return NextResponse.json({ clients });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Crea/aggiorna un singolo cliente (a differenza di pipeline-data.js, qui
// operiamo su un record alla volta invece che su tutto l'array: la pagina
// Clienti aggiorna spesso solo la fatturazione di un mese, non ha senso
// rimandare l'intera lista ad ogni tick come fa il kanban lead/drag.
export async function POST(req) {
  if (!NOTION_TOKEN) {
    return NextResponse.json({ error: "NOTION_API_KEY non configurata" }, { status: 500 });
  }
  try {
    const client = await req.json();
    const properties = {
      "Nome":           { title: [{ text: { content: client.nome || "" } }] },
      "Fase":           { select: { name: FASE_TO_NOTION[client.fase] || "Attivo" } },
      "Categoria":      client.categoria ? { select: { name: client.categoria } } : { select: null },
      "Contatto":       { rich_text: client.contatto ? [{ text: { content: client.contatto } }] : [] },
      "Email":          client.email ? { email: client.email } : { email: null },
      "Telefono":       client.telefono ? { phone_number: client.telefono } : { phone_number: null },
      "Sito Web":       client.sito ? { url: client.sito } : { url: null },
      "Budget Mensile": client.budget ? { number: parseFloat(client.budget) } : { number: null },
      "Data Inizio":    client.data_inizio ? { date: { start: client.data_inizio } } : { date: null },
      "Note":           { rich_text: client.note ? [{ text: { content: client.note } }] : [] },
      "Fatturazione JSON": { rich_text: [{ text: { content: JSON.stringify(client.fatturazione || []) } }] },
    };

    if (client.notionId) {
      const res = await notionFetch(`/pages/${client.notionId}`, { method: "PATCH", body: JSON.stringify({ properties }) });
      if (!res.ok) { const t = await res.text(); return NextResponse.json({ error: t }, { status: res.status }); }
      const page = await res.json();
      return NextResponse.json({ success: true, client: notionPageToClient(page) });
    } else {
      const res = await notionFetch(`/pages`, { method: "POST", body: JSON.stringify({ parent: { data_source_id: DATA_SOURCE_ID }, properties }) });
      if (!res.ok) { const t = await res.text(); return NextResponse.json({ error: t }, { status: res.status }); }
      const page = await res.json();
      return NextResponse.json({ success: true, client: notionPageToClient(page) });
    }
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  if (!NOTION_TOKEN) {
    return NextResponse.json({ error: "NOTION_API_KEY non configurata" }, { status: 500 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const notionId = searchParams.get("id");
    if (!notionId) return NextResponse.json({ error: "id mancante" }, { status: 400 });
    const res = await notionFetch(`/pages/${notionId}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
    if (!res.ok) { const t = await res.text(); return NextResponse.json({ error: t }, { status: res.status }); }
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
