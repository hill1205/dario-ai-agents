export const dynamic = "force-dynamic";

import { decodificaPayload } from "../../lib/doc-payload";

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const WORKSPACE_ID = "90121769473";
// Stesso Doc/pagina usato dal tab IAGREX (app/api/iagrex-finance/route.js):
// dati reali inseriti da Dario (entrate/uscite/saldi conto), non testo libero
// interpretato da un'AI. Questo endpoint alimenta solo la card "Finanze"
// della home con lo stesso numero mostrato nel tab IAGREX, per avere
// un'unica fonte di verità invece di due sistemi scollegati.
const DOC_ID = "2kxuu4g1-752";
const PAGE_ID = "2kxuu4g1-972";
const OBIETTIVO_ANNUALE = 1000000;

// Stessi conti/valute di IAGREXPage.jsx: gli importi sono registrati nella
// valuta del conto, quindi vanno convertiti prima di sommarli.
const CONTI_CURRENCY = { unicredit_eur: "€", unicredit_ron: "RON" };
const EUR_RON_FALLBACK = 5;

// Cambio live BCE, come fa IAGREXPage lato client. Se il fetch fallisce si
// usa il cambio fisso di riserva: meglio una conversione approssimata che
// sommare RON ed EUR come se fossero la stessa valuta.
async function getEurRonRate() {
  try {
    const res = await fetch("https://api.frankfurter.dev/v1/latest?from=EUR&to=RON", { cache: "no-store" });
    if (!res.ok) return { rate: EUR_RON_FALLBACK, live: false };
    const j = await res.json();
    return j?.rates?.RON ? { rate: j.rates.RON, live: true } : { rate: EUR_RON_FALLBACK, live: false };
  } catch {
    return { rate: EUR_RON_FALLBACK, live: false };
  }
}

// Le due regole che il tab IAGREX applica da sempre e che qui mancavano
// (vedi isReal/toEur in IAGREXPage.jsx):
// 1. i movimenti di conversione valuta tra conti non sono fatturato vero —
//    sono lo stesso denaro spostato, contarli gonfiava il progresso 1M€;
// 2. gli importi sui conti RON vanno convertiti in EUR, altrimenti 300 RON
//    venivano sommati come 300 €.
// Senza queste due, la card Finanze in home e il tab IAGREX mostravano
// numeri diversi sugli stessi dati.
const isReal = (e) => !e?.isConversione;
function sumEur(items, rate) {
  return (items || []).filter(isReal).reduce((s, e) => {
    const val = parseFloat(e.importo) || 0;
    return s + (CONTI_CURRENCY[e.conto] === "RON" ? val / rate : val);
  }, 0);
}
function round2(n) { return Math.round((parseFloat(n) || 0) * 100) / 100; }

// Mese corrente nel fuso di Dario (Europe/Bucharest), non in UTC: il server
// Vercel gira in UTC, quindi il giorno 1 del mese tra mezzanotte e le 3 la
// card Finanze avrebbe mostrato ancora il mese precedente.
function getCurrentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit" }).format(new Date()); // YYYY-MM
}
function getMonthLabel(ym) {
  const [y, m] = ym.split("-");
  const months = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
  return `${months[parseInt(m) - 1]} ${y}`;
}

// A differenza di prima, qui NON ingoiamo silenziosamente gli errori:
// se ClickUp non risponde bene o la chiave API manca, la funzione lancia
// un'eccezione esplicita invece di restituire {} come se fosse tutto ok.
// Questo evita che un errore di autenticazione si traduca in "0€" muto
// in dashboard: il frontend deve poter distinguere "nessun dato" da
// "i dati non si sono caricati".
async function fetchFinanceData() {
  if (!CLICKUP_API_KEY) throw new Error("CLICKUP_API_KEY non configurata");
  const res = await fetch(
    `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${PAGE_ID}?content_format=text/plain`,
    { headers: { Authorization: CLICKUP_API_KEY }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`ClickUp doc error: ${res.status}`);
  const page = await res.json();
  const content = page.content || "";
  const match = content.match(/IAGREX_FINANCE_JSON:([\s\S]*)/);
  if (!match) return {}; // pagina esistente ma ancora senza dati: caso legittimo, non un errore
  try { return decodificaPayload(match[1]) || {}; }
  catch { throw new Error("Formato dati finanziari non riconosciuto (JSON malformato nel Doc)"); }
}

export async function GET() {
  try {
    const [allData, { rate, live: rateIsLive }] = await Promise.all([fetchFinanceData(), getEurRonRate()]);
    const month = getCurrentMonth();
    const monthData = allData[month] || { entrate: [], uscite: [] };

    const entrate_totali = round2(sumEur(monthData.entrate, rate));
    const uscite_totali  = round2(sumEur(monthData.uscite, rate));

    // Progresso verso l'obiettivo annuale: somma delle entrate di tutti i mesi
    // dell'anno in corso (stesso calcolo YTD già usato nel tab IAGREX).
    const year = month.slice(0, 4);
    const ytdRevenue = round2(
      Object.entries(allData)
        .filter(([k]) => /^\d{4}-\d{2}$/.test(k) && k.startsWith(year))
        .reduce((s, [, v]) => s + sumEur(v.entrate, rate), 0)
    );
    const percentuale = Math.min(Math.round((ytdRevenue / OBIETTIVO_ANNUALE) * 100 * 10) / 10, 100);

    // Ritmo mensile necessario per restare in pista verso l'obiettivo annuale:
    // quanto manca diviso i mesi che restano (incluso quello corrente, perché
    // ci siamo ancora dentro). A dicembre "mesi_rimanenti" è 1, non 0, così il
    // calcolo resta sempre valido invece di dividere per zero.
    const currentMonthNum = parseInt(month.slice(5, 7), 10); // 1-12
    const mesiRimanenti = 13 - currentMonthNum; // dicembre incluso = 1
    const mancante = Math.max(OBIETTIVO_ANNUALE - ytdRevenue, 0);
    const ritmoMensileNecessario = Math.round(mancante / mesiRimanenti);

    // Storico mensile dell'anno in corso, per il mini-grafico in dashboard:
    // un punto per ogni mese da gennaio al mese corrente, anche se un mese
    // non ha ancora dati (in tal caso entrate=0, cosi' il grafico mostra
    // correttamente "ancora nessun incasso" invece di saltare il mese.
    const storico_mensile = [];
    for (let m = 1; m <= currentMonthNum; m++) {
      const ym = `${year}-${String(m).padStart(2, "0")}`;
      const d = allData[ym] || { entrate: [], uscite: [] };
      storico_mensile.push({
        mese: ym,
        label: getMonthLabel(ym).slice(0, 3),
        entrate: round2(sumEur(d.entrate, rate)),
        uscite: round2(sumEur(d.uscite, rate)),
      });
    }

    return Response.json({
      mese: getMonthLabel(month),
      entrate_totali,
      uscite_totali,
      saldo: round2(entrate_totali - uscite_totali),
      // Anche i dettagli escludono le conversioni: comparivano in home come
      // se fossero fatture/costi reali.
      fatture: (monthData.entrate || []).filter(isReal).map(e => ({ descrizione: e.descrizione, importo: e.importo, valuta: CONTI_CURRENCY[e.conto] === "RON" ? "RON" : "€" })),
      uscite_dettaglio: (monthData.uscite || []).filter(isReal).map(e => ({ descrizione: e.descrizione, importo: e.importo, valuta: CONTI_CURRENCY[e.conto] === "RON" ? "RON" : "€" })),
      cambio_eur_ron: rate,
      cambio_live: rateIsLive,
      obiettivo_annuale: OBIETTIVO_ANNUALE,
      percentuale,
      ytd_revenue: ytdRevenue,
      mesi_rimanenti: mesiRimanenti,
      ritmo_mensile_necessario: ritmoMensileNecessario,
      storico_mensile,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
