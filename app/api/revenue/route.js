export const dynamic = "force-dynamic";

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

function getCurrentMonth() { return new Date().toISOString().slice(0, 7); } // YYYY-MM
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
  try { return JSON.parse(match[1].trim()); }
  catch { throw new Error("Formato dati finanziari non riconosciuto (JSON malformato nel Doc)"); }
}

export async function GET() {
  try {
    const allData = await fetchFinanceData();
    const month = getCurrentMonth();
    const monthData = allData[month] || { entrate: [], uscite: [] };

    const entrate_totali = monthData.entrate.reduce((s, e) => s + (parseFloat(e.importo) || 0), 0);
    const uscite_totali  = monthData.uscite.reduce((s, e) => s + (parseFloat(e.importo) || 0), 0);

    // Progresso verso l'obiettivo annuale: somma delle entrate di tutti i mesi
    // dell'anno in corso (stesso calcolo YTD già usato nel tab IAGREX).
    const year = month.slice(0, 4);
    const ytdRevenue = Object.entries(allData)
      .filter(([k]) => k.startsWith(year))
      .reduce((s, [, v]) => s + (v.entrate || []).reduce((ss, e) => ss + (parseFloat(e.importo) || 0), 0), 0);
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
      const entrate = d.entrate.reduce((s, e) => s + (parseFloat(e.importo) || 0), 0);
      const uscite = d.uscite.reduce((s, e) => s + (parseFloat(e.importo) || 0), 0);
      storico_mensile.push({
        mese: ym,
        label: getMonthLabel(ym).slice(0, 3),
        entrate,
        uscite,
      });
    }

    return Response.json({
      mese: getMonthLabel(month),
      entrate_totali,
      uscite_totali,
      saldo: entrate_totali - uscite_totali,
      fatture: monthData.entrate.map(e => ({ descrizione: e.descrizione, importo: e.importo })),
      uscite_dettaglio: monthData.uscite.map(e => ({ descrizione: e.descrizione, importo: e.importo })),
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
