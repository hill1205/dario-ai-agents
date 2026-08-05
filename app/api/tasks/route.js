import { stripSystemTasks } from "../../lib/system-tasks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const LIST_IDS = {
  todo: "901218950374",
  routine: "901218950375",
  sospeso: "901218950377",
  claudia: "901219456425",
  annarita: "901219456427",
};

// Prima questa funzione restituiva [] quando ClickUp rispondeva male, e la
// route tornava comunque 200: in home il risultato era "Nessuna task 🎉"
// invece di un errore. Rischio concreto di credere di aver finito la
// giornata perché la lista sembrava vuota. Ora l'errore viene propagato
// (stessa scelta già fatta in /api/revenue e /api/bruno-finance).
async function fetchTasks(listId) {
  const res = await fetch(
    `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=false`,
    { headers: { Authorization: CLICKUP_API_KEY }, cache: "no-store" }
  );
  if (!res.ok) {
    const errorText = await res.text();
    console.error(`ClickUp API error for list ${listId}:`, res.status, errorText);
    throw new Error(`ClickUp list ${listId}: ${res.status}`);
  }
  const data = await res.json();
  // Via i contenitori di sistema (⚙️): restano aperti su ClickUp perche' il
  // bot Telegram ci legge dentro, ma in dashboard non sono task da fare.
  return stripSystemTasks(data.tasks || []);
}

export async function GET() {
  if (!CLICKUP_API_KEY) {
    console.error("CLICKUP_API_KEY is not set!");
    return Response.json({ error: "Missing API key" }, { status: 500 });
  }
  // allSettled invece di all: se UNA sola lista fallisce mostriamo comunque
  // le altre (meglio una dashboard parziale che una schermata vuota), ma
  // segnaliamo quali liste non si sono caricate così il frontend può
  // avvisare invece di far passare il vuoto per "tutto fatto".
  const keys = ["todo", "routine", "sospeso", "claudia", "annarita"];
  const results = await Promise.allSettled(keys.map(k => fetchTasks(LIST_IDS[k])));

  const payload = {};
  const listeNonCaricate = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") payload[keys[i]] = r.value;
    else { payload[keys[i]] = []; listeNonCaricate.push(keys[i]); }
  });

  // Se non è arrivata NESSUNA lista è un errore pieno: meglio 500 così il
  // banner di errore in home scatta invece di mostrare cinque card vuote.
  if (listeNonCaricate.length === keys.length) {
    return Response.json({ error: "ClickUp non raggiungibile: nessuna lista caricata" }, { status: 500 });
  }

  if (listeNonCaricate.length > 0) payload.listeNonCaricate = listeNonCaricate;
  return Response.json(payload);
}
