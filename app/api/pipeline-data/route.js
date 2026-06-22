const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const WORKSPACE_ID = "90121769473";
const DOC_ID  = "2kxuu4g1-932";
const PAGE_ID = "2kxuu4g1-912";

const BASE = `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${PAGE_ID}`;
const HEADERS = { Authorization: CLICKUP_API_KEY };

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
