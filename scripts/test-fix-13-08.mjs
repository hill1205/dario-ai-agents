// Verifica delle correzioni del 13/08/2026 sulle parti che si possono
// testare senza rete: parsing REV, guardia sulle date corrotte, keyword CSV,
// dedup peso, logica streak.
//
// Uso:  node scripts/test-fix-13-08.mjs

let falliti = 0;
const ok = (nome, cond, extra = "") => {
  if (cond) console.log(`  ✅ ${nome}`);
  else { falliti++; console.log(`  ❌ ${nome} ${extra}`); }
};

// ---------------------------------------------------------------- REV -----
console.log("\nREV — lettura della versione dalla pagina ClickUp");
const REV_MARCATORE = "REV";
const leggiRev = (contenuto) => {
  const m = contenuto.match(new RegExp(`(?:^|\\n)${REV_MARCATORE}:(\\d+)\\s*(?:\\n|$)`));
  return m ? parseInt(m[1], 10) || 0 : 0;
};
const leggiPayload = (contenuto, marcatore) => {
  const m = contenuto.match(new RegExp(`${marcatore}:([\\s\\S]*)`));
  return m ? m[1].trim() : null;
};

const nuovo = "STORICO PESO DARIO\n\nObiettivo: 85 kg\n\nREV:7\nWEIGHT_DATA_JSON:B64,eyJhIjoxfQ==";
ok("legge REV:7", leggiRev(nuovo) === 7, `(letto ${leggiRev(nuovo)})`);
ok("il payload non ingoia la riga REV", leggiPayload(nuovo, "WEIGHT_DATA_JSON") === "B64,eyJhIjoxfQ==");

const vecchio = "STORICO PESO DARIO\n\nWEIGHT_DATA_JSON:B64,eyJhIjoxfQ==";
ok("pagina pre-versionamento = rev 0", leggiRev(vecchio) === 0);
ok("payload invariato sul formato vecchio", leggiPayload(vecchio, "WEIGHT_DATA_JSON") === "B64,eyJhIjoxfQ==");
ok("nessun falso positivo dentro l'intestazione",
   leggiRev("PREVISIONI REVENUE\n\nWEIGHT_DATA_JSON:B64,eee") === 0);

// -------------------------------------------------------- date corrotte ---
console.log("\ndueDateInfo — guardia sulle date fuori scala");
function dueDateInfo(dueDateMs) {
  if (!dueDateMs) return null;
  const d = new Date(Number(dueDateMs));
  if (isNaN(d.getTime())) return null;
  const anno = d.getUTCFullYear();
  if (anno < 2000 || anno > 2100) return null;
  return { iso: d.toLocaleDateString("en-CA", { timeZone: "Europe/Bucharest" }) };
}
// Il valore reale del task "Attendere Simona per fatture Opencode".
ok("la data corrotta non produce piu' un badge", dueDateInfo(-62085822264000) === null);
// 1784163600000 = scadenza reale del task "Follow-up 14 lead outreach".
ok("una scadenza vera passa ancora", dueDateInfo(1784163600000)?.iso === "2026-07-16",
   `(iso ${dueDateInfo(1784163600000)?.iso})`);
ok("null resta null", dueDateInfo(null) === null);

// ----------------------------------------------------------- CSV header ---
console.log("\nmatchHeader — keyword ambigue delle colonne estratto conto");
const HEADER_KEYWORDS = {
  data: { esatte: ["data","date"], parziali: ["transaction date","booking date","value date","completed date","data operazione","data valuta"] },
  descrizione: { esatte: ["type","memo","note"], parziali: ["descrizione","description","dettagli","details","narrative","causale","merchant","payee","reference"] },
  importo: { esatte: ["importo","amount","valore","value"], parziali: ["importo operazione","transaction amount"] },
  entrata: { esatte: ["in","entrata","credit","entrate","avere"], parziali: ["money in","paid in","accredito"] },
  uscita: { esatte: ["out","uscita","debit","uscite","dare"], parziali: ["money out","paid out","addebito"] },
  saldo: { esatte: ["saldo","balance"], parziali: ["running balance","saldo contabile"] },
};
function matchHeader(headerCell) {
  const h = headerCell.toLowerCase().trim();
  for (const [key, { esatte }] of Object.entries(HEADER_KEYWORDS)) if (esatte.some(w => h === w)) return key;
  for (const [key, { parziali }] of Object.entries(HEADER_KEYWORDS)) if (parziali.some(w => h.includes(w))) return key;
  return null;
}
// Il caso che rompeva: "in" come sottostringa.
ok('"Origin" non e\' piu\' una colonna entrata', matchHeader("Origin") !== "entrata", `(era ${matchHeader("Origin")})`);
ok('"Card Ending" non e\' piu\' una colonna entrata', matchHeader("Card Ending") !== "entrata");
ok('"Paid In" resta entrata', matchHeader("Paid In") === "entrata");
ok('"Money Out" resta uscita', matchHeader("Money Out") === "uscita");
ok('"Completed Date" resta data', matchHeader("Completed Date") === "data");
ok('"Date" resta data', matchHeader("Date") === "data");
ok('"Amount" resta importo', matchHeader("Amount") === "importo");
ok('"Description" resta descrizione', matchHeader("Description") === "descrizione");
ok('"Balance" resta saldo', matchHeader("Balance") === "saldo");

// ---------------------------------------------------------- dedup peso ----
console.log("\n/api/weight — una pesata al giorno");
function aggiungiPeso(entries, data, peso) {
  const i = entries.findIndex((e) => e.data === data);
  if (i >= 0) entries[i] = { ...entries[i], data, peso };
  else entries.push({ data, peso });
  return entries.sort((a, b) => new Date(a.data) - new Date(b.data));
}
let pesi = [{ data: "2026-08-12", peso: 100 }];
aggiungiPeso(pesi, "2026-08-13", 99.4);
aggiungiPeso(pesi, "2026-08-13", 99.1); // seconda pesata lo stesso giorno
ok("nessun doppione sulla stessa data", pesi.length === 2, `(${pesi.length} voci)`);
ok("vince l'ultimo valore inserito", pesi[1].peso === 99.1);

// -------------------------------------------------------------- streak ----
console.log("\nStreak — deve poter anche scendere");
const decide = (allDone, segnatoOggi) => (allDone === segnatoOggi ? null : allDone);
ok("tutte fatte e non ancora segnato → POST true", decide(true, false) === true);
ok("ne tolgo una dopo aver segnato → POST false", decide(false, true) === false);
ok("gia' allineato → nessuna chiamata", decide(true, true) === null && decide(false, false) === null);

console.log(falliti === 0 ? "\n✅ Tutti i controlli passano.\n" : `\n❌ ${falliti} controllo/i fallito/i.\n`);
process.exit(falliti === 0 ? 0 : 1);
