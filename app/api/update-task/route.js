const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;

export async function POST(request) {
  try {
    const { taskId, status } = await request.json();

    if (!taskId || !status) {
      return Response.json({ error: "Missing taskId or status" }, { status: 400 });
    }

    const res = await fetch(
      `https://api.clickup.com/api/v2/task/${taskId}`,
      {
        method: "PUT",
        headers: {
          Authorization: CLICKUP_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      }
    );

    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
