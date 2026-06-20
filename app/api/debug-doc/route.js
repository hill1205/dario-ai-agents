export async function GET(request) {
  const apiKey = process.env.CLICKUP_API_KEY;
  const WORKSPACE_ID = "90121769473";
  const docId = "2kxuu4g1-732";
  const pageId = "2kxuu4g1-512";

  const url = `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${docId}/pages/${pageId}?content_format=text/plain`;

  const res = await fetch(url, {
    headers: { Authorization: apiKey },
  });

  const status = res.status;
  const body = await res.text();

  return Response.json({ status, url, body });
}
