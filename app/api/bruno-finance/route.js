export const dynamic = "force-dynamic";

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const WORKSPACE_ID = "90121769473";
const DOC_ID  = "2kxuu4g1-712";
const PAGE_ID = "2kxuu4g1-952";
const BASE = `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${PAGE_ID}`;

export async function GET() {
  try {
    const res = await fetch(`${BASE}?content_format=text/plain`, {
      headers: { Authorization: CLICKUP_API_KEY },
      cache: "no-store",
    });
    if (!res.ok) return Response.json({ data: {} });
    const page = await res.json();
    const content = page.content || "";
    const match = content.match(/BRUNO_FINANCE_JSON:([\s\S]*)/);
    if (!match) return Response.json({ data: {} });
    const data = JSON.parse(match[1].trim());
    return Response.json({ data });
  } catch (e) {
    return Response.json({ data: {} });
  }
}

export async function POST(request) {
  try {
    const { data } = await request.json();
    const content = `BRUNO_FINANCE_JSON:${JSON.stringify(data)}`;
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
