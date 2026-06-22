const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;

const LIST_IDS = {
  todo: "901218950374",
  routine: "901218950375",
  sospeso: "901218950377",
};

async function fetchTasks(listId) {
  const res = await fetch(
    `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=false`,
    { headers: { Authorization: CLICKUP_API_KEY } }
  );

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`ClickUp API error for list ${listId}:`, res.status, errorText);
    return [];
  }

  const data = await res.json();
  return data.tasks || [];
}

export async function GET() {
  if (!CLICKUP_API_KEY) {
    console.error("CLICKUP_API_KEY is not set!");
    return Response.json({ error: "Missing API key" }, { status: 500 });
  }

  try {
    const [todo, routine, sospeso] = await Promise.all([
      fetchTasks(LIST_IDS.todo),
      fetchTasks(LIST_IDS.routine),
      fetchTasks(LIST_IDS.sospeso),
    ]);
    return Response.json({ todo, routine, sospeso });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
