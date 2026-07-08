import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

// Notion Internal Integration Token — da impostare su Vercel come env var
const NOTION_TOKEN = process.env.NOTION_API_KEY;
const DATA_SOURCE_ID = "40f1c1e8-3e35-4fe9-a5b9-87f653a5f2d3"; // Pipeline Lead & Clienti
// L'endpoint /data_sources/{id}/query usato qui sotto esiste solo dalla
// versione 2025-09-03 dell'API Notion in poi (introdotta coi database
// multi-sorgente). Con la vecchia versione 2022-06-28 questa chiamata
// falliva con "invalid_request_url" — non è un problema di permessi.
const NOTION_VERSION = "2025-09-03";

const STAGE_TO_TIPO = {
  "Da Contattare":"lead","Contattato":"lead","Proposta Inviata":"lead",
  "In Trattativa":"lead","Chiuso":"lead","Rifiutato":"lead",
  "Attivo":"cliente","In Pausa":"cliente","Concluso":"cliente",
};
const STAGE_MAP_TO_APP = {
  "Da Contattare":"da_contattare","Contattato":"contattato","Proposta Inviata":"proposta_inviata",
  "In Trattativa":"in_trattativa","Chiuso":"chiuso","Rifiutato":"rifiutato",
  "Attivo":"attivo","In Pausa":"in_pausa","Concluso":"concluso",
};
const STAGE_MAP_TO_NOTION = Object.fromEntries(Object.entries(STAGE_MAP_TO_APP).map(([k,v])=>[v,k]));

function notionPageToEntry(page) {
  const p = page.properties;
  const getText  = (prop) => prop?.rich_text?.[0]?.plain_text || "";
  const getTitle = (prop) => prop?.title?.[0]?.plain_text || "";
  const getSel   = (prop) => prop?.select?.name || "";
  const stageNotion = getSel(p["Stage"]) || "Da Contattare";
  return {
    id:              page.id,
    notionId:        page.id,
    nome:            getTitle(p["Nome"]),
    tipo:            getSel(p["Tipo"])?.toLowerCase() === "cliente" ? "cliente" : "lead",
    stage:           STAGE_MAP_TO_APP[stageNotion] || "da_contattare",
    settore:         getSel(p["Settore"]) || "",
    contatto:        getText(p["Contatto"]),
    email:           p["Email"]?.email || "",
    telefono:        p["Telefono"]?.phone_number || "",
    sito:            p["Sito Web"]?.url || "",
    facebook:        p["Facebook"]?.url || "",
    instagram:       p["Instagram"]?.url || "",
    budget:          p["Budget"]?.number != null ? String(p["Budget"].number) : "",
    ultimo_contatto: p["Ultimo Contatto"]?.date?.start || "",
    tentativi:       p["Tentativi"]?.number || 0,
    note:            getText(p["Note"]),
    data:            page.created_time ? page.created_time.slice(0,10) : new Date().toISOString().slice(0,10),
  };
}

async function notionFetch(path, options = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  return res;
}

export async function GET() {
  if (!NOTION_TOKEN) {
    return NextResponse.json({ error: "NOTION_API_KEY non configurata" }, { status: 500 });
  }
  try {
    let entries = [];
    let cursor = undefined;
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
      entries.push(...data.results.map(notionPageToEntry));
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    return NextResponse.json({ entries });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  if (!NOTION_TOKEN) {
    return NextResponse.json({ error: "NOTION_API_KEY non configurata" }, { status: 500 });
  }
  try {
    const { entries } = await req.json();
    if (!Array.isArray(entries)) {
      return NextResponse.json({ error: "entries mancante" }, { status: 400 });
    }

    // Protezione anti-doppioni: se un'entry non ha un notionId valido,
    // controlla prima se esiste già una pagina con lo stesso nome+tipo
    // su Notion, ed effettua un update invece di una create.
    const needsNameCheck = entries.some(e => !(e.notionId || (e.id && e.id.includes("-"))));
    let existingByName = new Map();
    if (needsNameCheck) {
      let cursor = undefined;
      do {
        const qres = await notionFetch(`/data_sources/${DATA_SOURCE_ID}/query`, {
          method: "POST",
          body: JSON.stringify({ start_cursor: cursor, page_size: 100 }),
        });
        if (qres.ok) {
          const qdata = await qres.json();
          qdata.results.forEach(page => {
            const nome = (page.properties["Nome"]?.title?.[0]?.plain_text || "").toLowerCase().trim();
            if (nome) existingByName.set(nome, page.id);
          });
          cursor = qdata.has_more ? qdata.next_cursor : undefined;
        } else { cursor = undefined; }
      } while (cursor);
    }

    for (const entry of entries) {
      const properties = {
        "Nome":     { title: [{ text: { content: entry.nome || "" } }] },
        "Tipo":     { select: { name: entry.tipo === "cliente" ? "Cliente" : "Lead" } },
        "Stage":    { select: { name: STAGE_MAP_TO_NOTION[entry.stage] || "Da Contattare" } },
        "Settore":  entry.settore ? { select: { name: entry.settore } } : { select: null },
        "Contatto": { rich_text: entry.contatto ? [{ text: { content: entry.contatto } }] : [] },
        "Email":    entry.email ? { email: entry.email } : { email: null },
        "Telefono": entry.telefono ? { phone_number: entry.telefono } : { phone_number: null },
        "Sito Web": entry.sito ? { url: entry.sito } : { url: null },
        "Facebook":  entry.facebook  ? { url: entry.facebook }  : { url: null },
        "Instagram": entry.instagram ? { url: entry.instagram } : { url: null },
        "Budget":   entry.budget ? { number: parseFloat(entry.budget) } : { number: null },
        "Ultimo Contatto": entry.ultimo_contatto ? { date: { start: entry.ultimo_contatto } } : { date: null },
        "Tentativi": { number: entry.tentativi || 0 },
        "Note":     { rich_text: entry.note ? [{ text: { content: entry.note } }] : [] },
      };

      const nameKey = (entry.nome || "").toLowerCase().trim();
      const matchedByName = existingByName.get(nameKey);

      if (entry.notionId || (entry.id && entry.id.includes("-"))) {
        // Pagina esistente su Notion -> update
        const pageId = entry.notionId || entry.id;
        await notionFetch(`/pages/${pageId}`, {
          method: "PATCH",
          body: JSON.stringify({ properties }),
        });
      } else if (matchedByName) {
        // Trovata pagina con lo stesso nome -> update invece di creare doppione
        await notionFetch(`/pages/${matchedByName}`, {
          method: "PATCH",
          body: JSON.stringify({ properties }),
        });
      } else {
        // Nuova entry, nessun match -> crea pagina su Notion
        await notionFetch(`/pages`, {
          method: "POST",
          body: JSON.stringify({
            parent: { data_source_id: DATA_SOURCE_ID },
            properties,
          }),
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Elimina (archivia) un record. Prima mancava del tutto: il bottone "×"
// in PipelinePage.jsx si limitava a togliere l'entry dall'array locale e
// a rimandare l'intera lista via POST — ma POST fa solo create/update
// delle entry ricevute, non tocca le pagine Notion assenti dalla lista.
// Risultato: la card spariva un istante e poi tornava al giro dopo (il
// prossimo GET la rileggeva da Notion, dove non era mai stata toccata).
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
