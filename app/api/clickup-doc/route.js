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
      `https://api.clickup.com/api/v2/workspacedoc/${docId}/page/${pageId}`,
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
    const response = await fetch(
      `https://api.clickup.com/api/v2/workspacedoc/${docId}/page/${pageId}`,
      {
        method: "PUT",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
