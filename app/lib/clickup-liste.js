// L'UNICO punto che legge le task di una lista ClickUp.
//
// PERCHE' ESISTE
// L'endpoint v2 /list/{id}/task restituisce al MASSIMO 100 task per pagina e
// vuole ?page=N per le successive. Fino al 13/08/2026 nessuna delle sei
// chiamate dell'app lo faceva: /api/tasks, /api/backup, /api/cron/reset,
// habits-store, il bot Telegram e /api/lead-bea leggevano solo la prima
// pagina e trattavano il risultato come completo.
//
// Oggi le liste sono piccole (IN SOSPESO: 10 task) quindi non si vede niente.
// Il punto è che quando si vedrà, non si vedrà: niente errore, niente riga
// nei log, solo dati che mancano. I due casi che sfonderanno per primi:
//
//   /api/backup usa include_closed=true, e le task chiuse si accumulano per
//   sempre. Alla numero 101 il backup diventa silenziosamente parziale — e un
//   backup che tace mentre perde dati è peggio di nessun backup.
//
//   getStateTaskId() nel bot Telegram cerca la task "⚙️ STATO BOT TELEGRAM"
//   dentro IN SOSPESO con include_closed=true. Se finisce oltre la centesima
//   non la trova più, ne crea una SECONDA, e la deduplica degli update_id
//   riparte da zero: ogni retry di Telegram diventa una task doppia.
//
// Il limite di 20 pagine (2000 task) è una cintura contro il ciclo infinito
// se un giorno l'API smettesse di segnalare l'ultima pagina.

const CU_V2 = "https://api.clickup.com/api/v2";
const MAX_PAGINE = 20;

// ClickUp limita a 100 richieste al minuto per token, e la stessa chiave la
// usano dashboard, cron notturno e bot Telegram: un 429 va riprovato, non
// trasformato in "lista vuota". Stesso ragionamento di lib/clickup-doc.js.
async function fetchConRetry(url, opts, tentativi = 2) {
  let ultimo;
  for (let i = 0; i <= tentativi; i++) {
    const res = await fetch(url, opts);
    if (res.status !== 429 && res.status < 500) return res;
    ultimo = res;
    if (i < tentativi) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return ultimo;
}

/**
 * Tutte le task di una lista, scorrendo le pagine.
 *
 * @param {string} listId
 * @param {object} opts
 * @param {string} opts.apiKey        chiave ClickUp
 * @param {boolean} opts.includeClosed
 * @param {string[]} opts.statuses    filtro statuses[] opzionale
 * @param {boolean} opts.subtasks
 * @returns {Promise<Array>} elenco completo
 */
export async function fetchTuttiITask(listId, { apiKey, includeClosed = false, statuses = [], subtasks } = {}) {
  if (!apiKey) throw new Error("CLICKUP_API_KEY non configurata");

  const tutte = [];
  for (let page = 0; page < MAX_PAGINE; page++) {
    const params = [
      `include_closed=${includeClosed ? "true" : "false"}`,
      `page=${page}`,
      ...statuses.map((s) => `statuses[]=${encodeURIComponent(s)}`),
    ];
    if (subtasks !== undefined) params.push(`subtasks=${subtasks ? "true" : "false"}`);

    const res = await fetchConRetry(`${CU_V2}/list/${listId}/task?${params.join("&")}`, {
      headers: { Authorization: apiKey },
      cache: "no-store",
    });
    if (!res.ok) {
      const testo = await res.text().catch(() => "");
      console.error(`ClickUp list ${listId} pagina ${page}: ${res.status} ${testo.slice(0, 200)}`);
      throw new Error(`ClickUp list ${listId}: ${res.status}`);
    }

    const data = await res.json();
    const blocco = data.tasks || [];
    tutte.push(...blocco);

    // last_page è il segnale ufficiale; il controllo su blocco.length copre
    // il caso in cui non arrivi (una pagina piena sta esattamente a 100).
    if (data.last_page === true || blocco.length < 100) return tutte;
  }

  console.error(`ClickUp list ${listId}: superate ${MAX_PAGINE} pagine, elenco troncato.`);
  return tutte;
}
