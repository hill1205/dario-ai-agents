const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const DOC_ID = "2kxuu4g1-932";
const PAGE_ID = "2kxuu4g1-892";
const WORKSPACE_ID = "90121769473";

const BASE = `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${PAGE_ID}`;
const HEADERS = { Authorization: CLICKUP_API_KEY, "Content-Type": "application/json" };

export async function GET() {
  try {
    const res = await fetch(`${BASE}?content_format=text/plain`, { headers: HEADERS });
    if (!res.ok) return Response.json({ entries: [] });
    const data = await res.json();
    const content = data.content || "";
    const match = content.match(/PIPELINE_DATA_JSON:([\s\S]*)/);
    if (!match) return Response.json({ entries: [] });
    const entries = JSON.parse(match[1].trim());
    return Response.json({ entries });
  } catch (e) {
    return Response.json({ entries: [] });
  }
}

export async function PUT(request) {
  try {
    const { entries } = await request.json();
    const content = `PIPELINE_DATA_JSON:${JSON.stringify(entries)}`;
    const res = await fetch(BASE, {
      method: "PUT",
      headers: HEADERS,
      body: JSON.stringify({ content }),
    });
    if (!res.ok) return Response.json({ error: "ClickUp error" }, { status: 500 });
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
