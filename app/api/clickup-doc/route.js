const WORKSPACE_ID = "90121769473";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const docId = searchParams.get("docId");
    const pageId = searchParams.get("pageId");
    const apiKey = request.headers.get("x-clickup-key");
    if (!docId || !pageId || !apiKey) {
      return Response.json({ error: "Missing params or API key" }, { status: 400 });
    }
    const response = await fetch(
      `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${docId}/pages/${pageId}?content_format=text/plain`,
      { headers: { Authorization: apiKey } }
    );
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const { searchParams } = new URL(request.url);
    const docId = searchParams.get("docId");
    const pageId = searchParams.get("pageId");
    const apiKey = request.headers.get("x-clickup-key");
    const body = await request.json();

    if (!docId || !pageId || !apiKey) {
      return Response.json({ error: "Missing params or API key" }, { status: 400 });
    }

    // Invia solo il content — content_format non va nel body del PUT
    const payload = { content: body.content };

    const response = await fetch(
      `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${docId}/pages/${pageId}`,
      {
        method: "PUT",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    // Log della risposta per debug futuro
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
