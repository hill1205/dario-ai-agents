export const dynamic = 'force-dynamic';

import { saveSnapshot, snapshotDaTasks, bucharestDate } from '../../../lib/habits-store';
import { fetchTuttiITask } from '../../../lib/clickup-liste';

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const ROUTINE_DAILY_LIST_ID = "901218950375";

async function fetchRoutineTasks() {
  return fetchTuttiITask(ROUTINE_DAILY_LIST_ID, {
    apiKey: CLICKUP_API_KEY,
    includeClosed: true,
  });
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
  // Verifica di sicurezza: solo Vercel Cron (o chi conosce il secret) può
  // chiamare questa route.
  //
  // FAIL-CLOSED, non fail-open. Il controllo era `if (CRON_SECRET && ...)`:
  // la route si proteggeva solo SE la variabile esisteva. Ma il middleware
  // esclude apposta /api/cron/* dal Basic Auth (il cron di Vercel non può
  // mandare credenziali), quindi con CRON_SECRET mancante o cancellata per
  // sbaglio su Vercel questo endpoint restava aperto a internet: chiunque
  // conoscesse l'URL poteva chiamare /api/cron/reset?force=1 e azzerare le
  // routine a piacere. Su APP_PASSWORD il fail-open è una scelta ragionata
  // (c'è il banner rosso a segnalarlo); qui no, e non c'è nessun motivo per
  // cui il reset debba funzionare senza secret.
  const authHeader = req.headers.get('authorization');
  if (!CRON_SECRET) {
    console.error('CRON_SECRET non configurata: reset rifiutato.');
    return Response.json({ error: 'CRON_SECRET non configurata sul server' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: 'Non autorizzato' }, { status: 401 });
  }

  if (!CLICKUP_API_KEY) {
    return Response.json({ error: 'CLICKUP_API_KEY non configurata' }, { status: 500 });
  }

  // GUARDIA ORA LEGALE.
  // Vercel esegue i cron solo in UTC, e mezzanotte a Bucarest cade alle
  // 21:00 UTC d'estate e alle 22:00 UTC d'inverno. In vercel.json sono
  // registrate entrambe le schedulazioni ("0 21 * * *" e "0 22 * * *"):
  // qui lasciamo passare solo quella che casca davvero alle 00 locali,
  // l'altra esce senza toccare niente. Da fine ottobre si inverte da solo.
  //
  // NB: la spiegazione sta qui e non in vercel.json perche' quello schema
  // e' validato in modo rigido — una chiave extra tipo "_commento" fa
  // fallire il build ("should NOT have additional property").
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
      snapshot = await saveSnapshot(giorno, snapshotDaTasks(tasks, giorno));
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
