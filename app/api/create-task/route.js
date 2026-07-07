export const dynamic = "force-dynamic";

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
// Stessi ID delle altre route tasks/task — per ora solo il To Do
// giornaliero è creabile dall'app (routine e sospeso restano gestiti
// solo su ClickUp/Bea).
const LIST_IDS = {
  todo: "901218950374",
};

export async function POST(request) {
  if (!CLICKUP_API_KEY) {
    return Response.json({ error: "Missing API key" }, { status: 500 });
  }
  try {
    const { name, list } = await request.json();
    const trimmed = (name || "").trim();
    if (!trimmed) {
      return Response.json({ error: "Missing task name" }, { status: 400 });
    }
    const listId = LIST_IDS[list] || LIST_IDS.todo;

    const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
      method: "POST",
      headers: {
        Authorization: CLICKUP_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: trimmed }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("ClickUp create-task error:", res.status, data);
      return Response.json({ error: data }, { status: res.status });
    }
    return Response.json(data, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
