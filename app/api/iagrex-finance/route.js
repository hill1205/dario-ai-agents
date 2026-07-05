export const dynamic = "force-dynamic";

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const WORKSPACE_ID = "90121769473";
const DOC_ID  = "2kxuu4g1-752";
const PAGE_ID = "2kxuu4g1-972";
const BASE = `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${PAGE_ID}`;

export async function GET() {
      // Importante: NON restituire { data: {} } con status 200 quando ClickUp
  // fallisce. IAGREXPage.jsx salva sempre l'intero oggetto "allData" (tutti
  // i mesi) ogni volta che modifichi una voce — se un errore transitorio
  // facesse credere al frontend che i dati sono "vuoti ma ok", la prossima
  // modifica sovrascriverebbe silenziosamente su ClickUp lo storico di TUTTI
  // i mesi con un oggetto vuoto. Meglio un errore esplicito (status 500)
  // che il frontend può controllare prima di lasciarti salvare.
  try {
          if (!CLICKUP_API_KEY) throw new Error("CLICKUP_API_KEY non configurata");
          const res = await fetch(`${BASE}?content_format=text/plain`, {
                    headers: { Authorization: CLICKUP_API_KEY },
                    cache: "no-store",
          });
          if (!res.ok) throw new Error(`ClickUp doc error: ${res.status}`);
          const page = await res.json();
          const content = page.content || "";
          const match = content.match(/IAGREX_FINANCE_JSON:([\s\S]*)/);
          if (!match) return Response.json({ data: {} }); // pagina vuota ma raggiunta: caso legittimo
        const data = JSON.parse(match[1].trim());
          return Response.json({ data });
  } catch (e) {
          return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
      try {
              const { data } = await request.json();
              const content = `IAGREX_FINANCE_JSON:${JSON.stringify(data)}`;
              const res = await fetch(BASE, {
                        method: "PUT",
                        headers: { Authorization: CLICKUP_API_KEY, "Content-Type": "application/json" },
                        body: JSON.stringify({ content }),
              });
              if (!res.ok) {
                        const text = await res.text();
                        return Response.json({ error: text }, { status: res.status });
              }
              return Response.json({ success: true });
      } catch (e) {
              return Response.json({ error: e.message }, { status: 500 });
      }
}
