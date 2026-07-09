export const dynamic = "force-dynamic";

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const LIST_IDS = {
    todo: "901218950374",
    routine: "901218950375",
    sospeso: "901218950377",
};
const PRIORITY_MAP = { urgent: 1, high: 2, normal: 3, low: 4 };

export async function POST(request) {
    if (!CLICKUP_API_KEY) {
          return Response.json({ error: "Missing API key" }, { status: 500 });
    }
    try {
          const { name, list, priority } = await request.json();
          const trimmed = (name || "").trim();
          if (!trimmed) {
                  return Response.json({ error: "Missing task name" }, { status: 400 });
          }
          const listId = LIST_IDS[list] || LIST_IDS.todo;
          const body = { name: trimmed };
          if (priority && PRIORITY_MAP[priority]) body.priority = PRIORITY_MAP[priority];

      const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
              method: "POST",
              headers: {
                        Authorization: CLICKUP_API_KEY,
                        "Content-Type": "application/json",
              },
              body: JSON.stringify(body),
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
