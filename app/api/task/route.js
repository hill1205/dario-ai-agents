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
  const data = await res.json();
  return data.tasks || [];
}

export async function GET() {
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
