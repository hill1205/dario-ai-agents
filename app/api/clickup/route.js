export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const listId = searchParams.get("listId");
    const apiKey = request.headers.get("x-clickup-key");
    if (!listId || !apiKey) {
      return Response.json({ error: "Missing listId or API key" }, { status: 400 });
    }
    const response = await fetch(
      `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=false`,
      { headers: { Authorization: apiKey } }
    );
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
