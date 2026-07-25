export const dynamic = "force-dynamic";

// Estrae i movimenti da un estratto conto PDF in modo euristico: i layout
// variano da banca a banca (Revolut, UniCredit, BdM, Trade Republic,
// PostePay, HYPE...), quindi non c'è un parser "esatto" — cerchiamo riga
// per riga una data e un importo plausibili. Il risultato va sempre
// rivisto: in app i movimenti incongruenti vengono solo evidenziati in
// arancione, mai corretti in automatico (vedi BrunoPage/IAGREXPage).

const MESI_IT = { gen:1, feb:2, mar:3, apr:4, mag:5, giu:6, lug:7, ago:8, set:9, ott:10, nov:11, dic:12 };

function findDate(line) {
  // ISO yyyy-mm-dd va provato PRIMA del formato europeo gg/mm/aaaa:
  // altrimenti "2026-07-22" verrebbe letto come "26-07-22" (gg-mm-aa
  // europeo) => 2022-07-26, sbagliato.
  let m = line.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return { data: `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`, match: m[0] };
  m = line.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (m) { let [full, d, mo, y] = m; if (y.length === 2) y = "20" + y; return { data: `${y}-${mo.padStart(2,"0")}-${d.padStart(2,"0")}`, match: full }; }
  m = line.match(/\b(\d{1,2})\s+([a-zA-Z]{3,})\s+(\d{4})\b/);
  if (m) {
    const [full, d, mon, y] = m;
    const mo = MESI_IT[mon.slice(0,3).toLowerCase()];
    if (mo) return { data: `${y}-${String(mo).padStart(2,"0")}-${d.padStart(2,"0")}`, match: full };
  }
  return null;
}

function extractAmounts(line) {
  // \d+ (non \d{1,3}) per la parte intera: deve reggere sia "2500.00"
  // (senza separatore delle migliaia) sia "1.250,00" (con separatore).
  const matches = [...line.matchAll(/[+-]?\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/g)];
  return matches
    .map(m => m[0])
    .filter(s => /[.,]\d{1,2}$/.test(s) || s.replace(/[^0-9]/g,"").length >= 3)
    .map(s => {
      let clean = s.replace(/\s/g,"");
      const lastDot = clean.lastIndexOf("."), lastComma = clean.lastIndexOf(",");
      if (lastDot > -1 && lastComma > -1) {
        // L'ultimo separatore incontrato è quello decimale.
        clean = lastComma > lastDot ? clean.replace(/\./g,"").replace(",",".") : clean.replace(/,/g,"");
      } else if (lastComma > -1) {
        clean = clean.replace(",",".");
      }
      return parseFloat(clean);
    })
    .filter(n => !isNaN(n));
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file) return Response.json({ error: "Nessun file ricevuto" }, { status: 400 });

    const data = new Uint8Array(await file.arrayBuffer());
    // pdfjs-dist (build "legacy", compatibile Node) invece di pdf-parse:
    // pdf-parse porta con sé una pdf.js del 2019 che fallisce con "bad
    // XRef entry" anche su PDF validi (verificato con qpdf --check) generati
    // da librerie moderne come reportlab — probabile bug della versione
    // pdf.js ormai abbandonata che pdf-parse si porta dietro.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    const lines = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // pdf.js non inserisce newline tra le righe di testo: ricostruiamo le
      // righe raggruppando gli item per coordinata Y (arrotondata) e
      // ordinandoli per X, altrimenti l'intera pagina diventa una riga sola.
      const byY = {};
      for (const it of content.items) {
        const y = Math.round(it.transform[5]);
        (byY[y] = byY[y] || []).push({ x: it.transform[4], str: it.str });
      }
      const ys = Object.keys(byY).map(Number).sort((a,b) => b - a);
      for (const y of ys) lines.push(byY[y].sort((a,b) => a.x - b.x).map(o => o.str).join(" "));
    }
    const text = lines.join("\n");

    const movimenti = [];
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const dateInfo = findDate(line);
      if (!dateInfo) continue;
      const rest = line.replace(dateInfo.match, "");
      const amounts = extractAmounts(rest);
      if (amounts.length === 0) continue;
      // Il primo importo dopo la data è di solito il movimento; un
      // eventuale secondo numero è quasi sempre il saldo progressivo, va
      // scartato.
      const importo = amounts[0];
      const descrizione = rest
        .replace(/[+-]?\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      movimenti.push({ data: dateInfo.data, importo, descrizione: descrizione.slice(0,120) });
    }

    return Response.json({ movimenti, righeTotali: text.split("\n").length, righeRiconosciute: movimenti.length });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
