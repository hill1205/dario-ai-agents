export const dynamic = 'force-dynamic';

import { saveSnapshot, isTaskDone, bucharestDate } from '../../../lib/habits-store';

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

  // GUARDIA ORA LEGALE.
  // Vercel esegue i cron solo in UTC, e mezzanotte a Bucarest cade alle
  // 21:00 UTC d'estate e alle 22:00 UTC d'inverno. In vercel.json sono
  // registrate entrambe: qui lasciamo passare solo quella che casca
  // davvero alle 00 locali, l'altra esce senza toccare niente. Da fine
  // ottobre si inverte da solo.
  //
  // Serve anche come rete di sicurezza: se una chiamata partisse alle
  // 23:xx, bucharestDate(-1) punterebbe al giorno sbagliato e il reset
  // cancellerebbe le routine di una giornata ancora in corso.
  const oraBucarest = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', hour: '2-digit', hourCycle: 'h23' })
      .format(new Date())
  );
  const forzato = new URL(req.url).searchParams.get('force') === '1';
  if (oraBucarest !== 0 && !forzato) {
    return Response.json({
      skipped: true,
      motivo: `A Bucarest sono le ${oraBucarest}:00, non mezzanotte — questa e' l'altra schedulazione UTC (ora legale/solare).`,
      oraBucarest,
    });
  }

  try {
    const tasks = await fetchRoutineTasks();

    // SNAPSHOT PRIMA DEL RESET.
    // Fino al 04/08/26 questo cron azzerava le routine buttando via l'unica
    // informazione utile: QUALI erano state fatte. Restava solo il booleano
    // "tutte completate" dello streak. Qui congeliamo lo stato per singola
    // abitudine, cosi' il tracking granulare arriva senza che Dario debba
    // compilare niente in piu'.
    //
    // Il giorno e' -1: giriamo a mezzanotte di Bucarest, quindi la giornata
    // appena finita e' ieri, non quella che sta iniziando in questo istante.
    const giorno = bucharestDate(-1);
    let snapshot = { success: false, motivo: 'non tentato' };
    try {
      snapshot = await saveSnapshot(
        giorno,
        tasks.filter(isTaskDone).map(t => t.name),
        tasks.map(t => t.name)
      );
    } catch (e) {
      // Lo snapshot non deve MAI impedire il reset: se il Doc ClickUp non
      // risponde, perdere lo storico di un giorno e' accettabile, ritrovarsi
      // le routine di ieri ancora spuntate la mattina dopo no.
      snapshot = { success: false, motivo: e.message };
    }

    const results = await Promise.all(
      tasks.map(async (t) => ({ id: t.id, name: t.name, reset: await resetTask(t.id) }))
    );
    const resetCount = results.filter(r => r.reset).length;
    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      totalTasks: tasks.length,
      resetCount,
      snapshot: { giorno, ...snapshot },
      details: results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
