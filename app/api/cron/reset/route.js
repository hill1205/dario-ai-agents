const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const ROUTINE_LIST_ID = "901218950375";
const CRON_SECRET = process.env.CRON_SECRET;

async function fetchRoutineTasks() {
  const res = await fetch(
    `https://api.clickup.com/api/v2/list/${ROUTINE_LIST_ID}/task?include_closed=true`,
    { headers: { Authorization: CLICKUP_API_KEY } }
  );
  const data = await res.json();
  return data.tasks || [];
}

async function resetTask(taskId) {
  await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    method: "PUT",
    headers: {
      Authorization: CLICKUP_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "da fare" }),
  });
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tasks = await fetchRoutineTasks();
    await Promise.all(tasks.map((t) => resetTask(t.id)));
    return Response.json({ success: true, reset: tasks.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
