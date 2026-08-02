// Test della logica ricorrenze (finanziamenti + abbonamenti).
// Uso: node scripts/test-ricorrenze.mjs
// Non serve build né browser: sono funzioni pure.

import {
  occorrenze, dataOccorrenza, ratePagate, debitoResiduo,
  prossimaScadenza, impegnoMensile, applicaRicorrenze, idMovimento,
} from "../app/lib/ricorrenze.js";

let ok = 0, ko = 0;
const eq = (nome, a, b) => {
  const pass = JSON.stringify(a) === JSON.stringify(b);
  if (pass) { ok++; console.log(`  ✅ ${nome}`); }
  else { ko++; console.log(`  ❌ ${nome}\n     atteso: ${JSON.stringify(b)}\n     ottenuto: ${JSON.stringify(a)}`); }
};

const OGGI = "2026-08-02";

const auto = {
  id: "auto1", tipo: "finanziamento", nome: "Auto", ente: "BdM Banca",
  conto: "bdm", importo: 317.52, giorno: 15, dataInizio: "2026-03-15",
  rateTotali: 60, categoria: "Finanziamenti", attiva: true,
};

console.log("\n— Occorrenze e clamp del giorno —");
eq("giorno 31 a febbraio 2026 -> 28", dataOccorrenza("2026-02", 31), "2026-02-28");
eq("giorno 31 a gennaio -> 31", dataOccorrenza("2026-01", 31), "2026-01-31");
eq("giorno 15 normale", dataOccorrenza("2026-08", 15), "2026-08-15");
// Il 15 agosto non è ancora passato al 2 agosto: 5 rate (mar-lug).
eq("rate maturate al 02/08", ratePagate(auto, OGGI), 5);
eq("ultima occorrenza", occorrenze(auto, OGGI).at(-1), { ym: "2026-07", data: "2026-07-15", indice: 5 });

console.log("\n— Prima rata dopo il giorno-tipo —");
const tardi = { ...auto, id: "tardi", dataInizio: "2026-03-20" };
eq("inizio 20/03 con giorno 15 -> prima rata 15/04", occorrenze(tardi, OGGI)[0], { ym: "2026-04", data: "2026-04-15", indice: 1 });

console.log("\n— Debito residuo —");
eq("55 rate residue", Math.round(debitoResiduo(auto, OGGI) * 100) / 100, Math.round(55 * 317.52 * 100) / 100);
eq("finanziamento estinto -> 0", debitoResiduo({ ...auto, chiusa: { data: "2026-06-30" } }, OGGI), 0);
eq("abbonamento non fa debito", debitoResiduo({ ...auto, tipo: "abbonamento", rateTotali: 0 }, OGGI), 0);

console.log("\n— Estinzione anticipata —");
const estinto = { ...auto, id: "est", chiusa: { data: "2026-05-31", motivo: "estinzione anticipata" } };
eq("nessuna rata dopo la chiusura", ratePagate(estinto, OGGI), 3); // mar, apr, mag

console.log("\n— Prossima scadenza —");
eq("prossima rata", prossimaScadenza(auto, OGGI), { ym: "2026-08", data: "2026-08-15", indice: 6 });
eq("nessuna scadenza se finito", prossimaScadenza({ ...auto, rateTotali: 5 }, OGGI), null);

const claude = {
  id: "claude", tipo: "abbonamento", nome: "Claude", ente: "Anthropic",
  conto: "revolut_eur", importo: 20, giorno: 8, dataInizio: "2026-06-08",
  rateTotali: 0, categoria: "Abbonamenti", attiva: true,
};
console.log("\n— Abbonamenti (senza fine) —");
eq("addebiti giu+lug", ratePagate(claude, OGGI), 2);
eq("impegno mensile totale", impegnoMensile([auto, claude], OGGI), 337.52);

console.log("\n— Generazione addebiti —");
const EMPTY = { entrate: [], uscite: [], saldi: { bdm: 0, revolut_eur: 0 }, investimenti: 0, risparmi: 0 };
const carried = () => ({});
let allData = {
  "2026-03": { ...EMPTY, saldi: { bdm: 5000, revolut_eur: 1000 } },
  "2026-04": { ...EMPTY, saldi: { bdm: 5000, revolut_eur: 1000 } },
  "2026-05": { ...EMPTY, saldi: { bdm: 5000, revolut_eur: 1000 } },
  "2026-06": { ...EMPTY, saldi: { bdm: 5000, revolut_eur: 1000 } },
  "2026-07": { ...EMPTY, saldi: { bdm: 5000, revolut_eur: 1000 } },
  "2026-08": { ...EMPTY, saldi: { bdm: 5000, revolut_eur: 1000 } },
  viaggi: [], checkSaldi: [],
};
const r1 = applicaRicorrenze(allData, [auto, claude], OGGI, { emptyMonth: EMPTY, carried });
eq("movimenti creati (5 rate + 2 abbonamenti)", r1.creati.length, 7);
eq("marzo ha 1 uscita", r1.next["2026-03"].uscite.length, 1);
eq("id deterministico", r1.next["2026-03"].uscite[0].id, idMovimento(auto, "2026-03"));
eq("descrizione rata", r1.next["2026-03"].uscite[0].descrizione, "Auto — rata 1/60");

// REGOLA CHIAVE: gli arretrati sono solo storico. I saldi dei mesi passati
// sono già quelli veri letti dalla banca, quindi non vanno toccati; da agosto
// (mese corrente) in poi invece l'addebito scala il conto.
eq("arretrato marcato noSaldo", r1.next["2026-03"].uscite[0].noSaldo, true);
eq("saldo bdm marzo INVARIATO", r1.next["2026-03"].saldi.bdm, 5000);
eq("saldo bdm luglio INVARIATO", r1.next["2026-07"].saldi.bdm, 5000);
eq("saldo bdm agosto INVARIATO (rata del 15 non ancora scaduta)", r1.next["2026-08"].saldi.bdm, 5000);
eq("saldo revolut agosto INVARIATO (canoni giu/lug sono storico)", r1.next["2026-08"].saldi.revolut_eur, 1000);
eq("chiavi non-mese intatte", Array.isArray(r1.next.viaggi), true);

console.log("\n— Addebito del mese corrente: quello sì scala —");
const abbAgosto = { ...claude, id: "abb-ago", giorno: 1, dataInizio: "2026-06-01" };
const rAgo = applicaRicorrenze(allData, [abbAgosto], OGGI, { emptyMonth: EMPTY, carried });
eq("giugno e luglio non toccati", rAgo.next["2026-07"].saldi.revolut_eur, 1000);
eq("agosto scalato di 1 canone (1/08 già passato)", rAgo.next["2026-08"].saldi.revolut_eur, 980);
eq("il movimento di agosto NON è noSaldo", rAgo.next["2026-08"].uscite.at(-1).noSaldo, undefined);

console.log("\n— Idempotenza (il punto critico) —");
const r2 = applicaRicorrenze(r1.next, [auto, claude], OGGI, { emptyMonth: EMPTY, carried });
eq("secondo giro non crea nulla", r2.creati.length, 0);
eq("saldi invariati", r2.next["2026-08"].saldi.bdm, r1.next["2026-08"].saldi.bdm);
const r3 = applicaRicorrenze(r2.next, [auto, claude], OGGI, { emptyMonth: EMPTY, carried });
eq("terzo giro non crea nulla", r3.creati.length, 0);

console.log("\n— Addebito cancellato a mano non torna —");
const cancellato = idMovimento(auto, "2026-05");
const senza = { ...r1.next, "2026-05": { ...r1.next["2026-05"], uscite: r1.next["2026-05"].uscite.filter(e => e.id !== cancellato) } };
const r5 = applicaRicorrenze(senza, [auto, claude], OGGI, { emptyMonth: EMPTY, carried, saltati: [cancellato] });
eq("non lo rigenera se è nei saltati", r5.creati.length, 0);
const r6 = applicaRicorrenze(senza, [auto, claude], OGGI, { emptyMonth: EMPTY, carried });
eq("senza lista saltati invece torna", r6.creati.length, 1);

console.log("\n— Mese mancante creato al volo —");
const parziale = { "2026-08": { ...EMPTY, saldi: { bdm: 5000, revolut_eur: 1000 } } };
const r4 = applicaRicorrenze(parziale, [auto], OGGI, { emptyMonth: EMPTY, carried: () => ({ saldi: { bdm: 0, revolut_eur: 0 } }) });
eq("crea i mesi mancanti", Object.keys(r4.next).sort(), ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
eq("agosto resta intatto (tutte arretrate)", r4.next["2026-08"].saldi.bdm, 5000);

console.log("\n— saldiDaMese esplicito (retrodatare la partenza) —");
const rDa = applicaRicorrenze(allData, [auto], OGGI, { emptyMonth: EMPTY, carried, saldiDaMese: "2026-06" });
eq("maggio non toccato", rDa.next["2026-05"].saldi.bdm, 5000);
eq("giugno scalato di 1 rata", rDa.next["2026-06"].saldi.bdm, Math.round((5000 - 317.52) * 100) / 100);
eq("agosto scalato di 2 rate (giu+lug)", rDa.next["2026-08"].saldi.bdm, Math.round((5000 - 2 * 317.52) * 100) / 100);

console.log(`\n${ko === 0 ? "✅ TUTTO OK" : "❌ FALLITI"} — ${ok} passati, ${ko} falliti\n`);
process.exit(ko === 0 ? 0 : 1);
