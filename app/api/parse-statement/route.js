export const dynamic = "force-dynamic";

// Estrae i movimenti da un estratto conto (PDF o CSV) in modo euristico: i
// layout variano da banca a banca (Revolut, UniCredit, BdM, Trade Republic,
// PostePay, HYPE...), quindi non c'è un parser "esatto" per il PDF — per il
// CSV invece, quando c'è un'intestazione riconoscibile, il parsing è preciso
// (colonne già strutturate). Il risultato va sempre rivisto: in app i
// movimenti incongruenti vengono solo evidenziati in arancione, mai
// corretti in automatico (vedi BrunoPage/IAGREXPage).

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
    .map(s => parseAmount(s))
    .filter(n => !isNaN(n));
}

function parseAmount(s) {
  let clean = String(s).replace(/\s/g,"");
  const lastDot = clean.lastIndexOf("."), lastComma = clean.lastIndexOf(",");
  if (lastDot > -1 && lastComma > -1) {
    // L'ultimo separatore incontrato è quello decimale.
    clean = lastComma > lastDot ? clean.replace(/\./g,"").replace(",",".") : clean.replace(/,/g,"");
  } else if (lastComma > -1) {
    clean = clean.replace(",",".");
  }
  return parseFloat(clean);
}

// Estrazione riga per riga stile PDF: usata per il testo del PDF e come
// fallback per CSV senza un'intestazione riconoscibile.
function parseHeuristic(text) {
  const movimenti = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const dateInfo = findDate(line);
    if (!dateInfo) continue;
    const rest = line.replace(dateInfo.match, "");
    const amounts = extractAmounts(rest);
    if (amounts.length === 0) continue;
    const importo = amounts[0];
    const descrizione = rest
      .replace(/[+-]?\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    movimenti.push({ data: dateInfo.data, importo, descrizione: descrizione.slice(0,120) });
  }
  return movimenti;
}

// Split di una riga CSV rispettando i campi tra virgolette (che possono
// contenere il separatore). Supporta virgola, punto e virgola o tab come
// separatore: rilevato guardando quale compare più spesso nella prima riga.
function splitCsvLine(line, delim) {
  const out = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i+1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === delim && !inQuotes) {
      out.push(cur); cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function detectDelimiter(firstLine) {
  const counts = { ",": (firstLine.match(/,/g)||[]).length, ";": (firstLine.match(/;/g)||[]).length, "\t": (firstLine.match(/\t/g)||[]).length };
  return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
}

// Due liste per campo: `esatte` vuole l'uguaglianza, `parziali` accetta il
// contenimento.
//
// Prima erano una lista sola confrontata sempre con includes(), e ci finivano
// dentro parole cortissime come "in" e "out": una colonna chiamata "Origin",
// "Card Ending" o "Point in time" veniva letta come colonna ENTRATA, e da lì
// gli importi venivano presi dalla casella sbagliata. Le parole ambigue ora
// stanno tra le esatte, dove non possono fare danni.
const HEADER_KEYWORDS = {
  data: {
    esatte: ["data","date"],
    parziali: ["transaction date","booking date","value date","completed date","data operazione","data valuta"],
  },
  descrizione: {
    esatte: ["type","memo","note"],
    parziali: ["descrizione","description","dettagli","details","narrative","causale","merchant","payee","reference"],
  },
  importo: {
    esatte: ["importo","amount","valore","value"],
    parziali: ["importo operazione","transaction amount"],
  },
  entrata: {
    esatte: ["in","entrata","credit","entrate","avere"],
    parziali: ["money in","paid in","accredito"],
  },
  uscita: {
    esatte: ["out","uscita","debit","uscite","dare"],
    parziali: ["money out","paid out","addebito"],
  },
  saldo: {
    esatte: ["saldo","balance"],
    parziali: ["running balance","saldo contabile"],
  },
};

function matchHeader(headerCell) {
  const h = headerCell.toLowerCase().trim();
  // Prima passata su tutte le corrispondenze esatte: "date" deve vincere su
  // chiunque contenga "date" nel mezzo.
  for (const [key, { esatte }] of Object.entries(HEADER_KEYWORDS)) {
    if (esatte.some(w => h === w)) return key;
  }
  for (const [key, { parziali }] of Object.entries(HEADER_KEYWORDS)) {
    if (parziali.some(w => h.includes(w))) return key;
  }
  return null;
}

function parseCsv(text) {
  const rawLines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (rawLines.length === 0) return null;
  const delim = detectDelimiter(rawLines[0]);
  const header = splitCsvLine(rawLines[0], delim);
  const colMap = {};
  header.forEach((h, i) => { const key = matchHeader(h); if (key && colMap[key] === undefined) colMap[key] = i; });

  const hasDate = colMap.data !== undefined;
  const hasAmount = colMap.importo !== undefined || (colMap.entrata !== undefined && colMap.uscita !== undefined);
  if (!hasDate || !hasAmount) return null; // niente intestazione riconoscibile, si passa al fallback euristico

  const movimenti = [];
  for (let i = 1; i < rawLines.length; i++) {
    const cells = splitCsvLine(rawLines[i], delim);
    if (cells.length < 2) continue;
    const rawData = colMap.data !== undefined ? cells[colMap.data] : "";
    const dateInfo = findDate(rawData) || (rawData ? { data: rawData } : null);
    if (!dateInfo?.data) continue;

    let importo;
    if (colMap.importo !== undefined) {
      importo = parseAmount(cells[colMap.importo]);
    } else {
      const entrata = parseAmount(cells[colMap.entrata]) || 0;
      const uscita = parseAmount(cells[colMap.uscita]) || 0;
      importo = entrata - Math.abs(uscita);
    }
    if (isNaN(importo)) continue;

    const descrizione = colMap.descrizione !== undefined ? cells[colMap.descrizione] : "";
    movimenti.push({ data: dateInfo.data, importo, descrizione: (descrizione||"").slice(0,120) });
  }
  return movimenti;
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file) return Response.json({ error: "Nessun file ricevuto" }, { status: 400 });

    const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";

    if (isCsv) {
      const text = await file.text();
      const strutturato = parseCsv(text);
      const movimenti = strutturato ?? parseHeuristic(text);
      const righeTotali = text.split(/\r?\n/).filter(l=>l.trim()).length;
      return Response.json({
        movimenti,
        righeTotali,
        righeRiconosciute: movimenti.length,
        modalita: strutturato ? "csv-strutturato" : "csv-euristico",
      });
    }

    const data = new Uint8Array(await file.arrayBuffer());
    // pdfjs-dist (build "legacy", compatibile Node) invece di pdf-parse:
    // pdf-parse porta con sé una pdf.js del 2019 che fallisce con "bad
    // XRef entry" anche su PDF validi (verificato con qpdf --check) generati
    // da librerie moderne come reportlab — probabile bug della versione
    // pdf.js ormai abbandonata che pdf-parse si porta dietro.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

    // In Node pdf.js avvia un "fake worker" importando pdf.worker.mjs. Se non
    // gli si dice dove sta, usa il percorso relativo "./pdf.worker.mjs", che
    // su Vercel viene risolto rispetto al chunk della funzione serverless
    // (/var/task/.next/server/chunks/) dove il worker non c'e' mai:
    //   Setting up fake worker failed: "Cannot find module .../pdf.worker.mjs"
    // Qui lo risolviamo dentro node_modules e lo passiamo come percorso
    // assoluto. Vedi anche experimental.serverComponentsExternalPackages in
    // next.config.mjs: senza quello la libreria verrebbe impacchettata e il
    // worker resterebbe comunque irraggiungibile.
    try {
      const { createRequire } = await import("node:module");
      const { pathToFileURL } = await import("node:url");
      const req = createRequire(import.meta.url);
      const workerPath = req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    } catch {
      // se la risoluzione fallisce si prova comunque col default di pdf.js
    }

    const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
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
    const movimenti = parseHeuristic(text);

    return Response.json({ movimenti, righeTotali: text.split("\n").length, righeRiconosciute: movimenti.length, modalita: "pdf-euristico" });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
