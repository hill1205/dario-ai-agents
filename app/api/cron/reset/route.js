export const dynamic = 'force-dynamic';

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const ROUTINE_DAILY_LIST_ID = "901218950375";

async function fetchRoutineTasks() {
  const res = await fetch(
    `https://api.clickup.com/api/v2/list/${ROUTINE_DAILY_LIST_ID}/task?include_closed=true`,
    { headers: { Authorization: CLICKUP_API_KEY }, cache: 'no-store' }
  );
  if (!res.ok) throw new Error(`ClickUp GET error ${res.status}`);
  const data = await res.json();
  return data.tasks || [];
}

async function resetTask(taskId) {
  const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    method: 'PUT',
    headers: {
      Authorization: CLICKUP_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'da fare' }),
  });
  return res.ok;
}

export async function GET(req) {
  // Verifica di sicurezza: solo Vercel Cron (o chi conosce il secret) può chiamare questa route
  const authHeader = req.headers.get('authorization');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: 'Non autorizzato' }, { status: 401 });
  }

  if (!CLICKUP_API_KEY) {
    return Response.json({ error: 'CLICKUP_API_KEY non configurata' }, { status: 500 });
  }

  try {
    const tasks = await fetchRoutineTasks();
    const results = await Promise.all(
      tasks.map(async (t) => ({ id: t.id, name: t.name, reset: await resetTask(t.id) }))
    );
    const resetCount = results.filter(r => r.reset).length;
    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      totalTasks: tasks.length,
      resetCount,
      details: results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
