// Test della logica ricorrenze (finanziamenti + abbonamenti).
// Uso: node scripts/test-ricorrenze.mjs
// Non serve build né browser: sono funzioni pure.

import {
  occorrenze, dataOccorrenza, ratePagate, debitoResiduo,
  prossimaScadenza, impegnoMensile, applicaRicorrenze, idMovimento,
  pianoRate, rateTotaliDi, importoRata, totaleRate, maxirataInfo,
  importoCerto, storicoRicorrenza, daConfermare, mediaStorico, importoAtteso,
  riepilogoAnnuale, costoUnitario, annoCompetenza, letturaDaFare,
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
eq("ultima occorrenza", occorrenze(auto, OGGI).at(-1), { ym: "2026-07", data: "2026-07-15", indice: 5, importo: 317.52 });

console.log("\n— Prima rata dopo il giorno-tipo —");
const tardi = { ...auto, id: "tardi", dataInizio: "2026-03-20" };
eq("inizio 20/03 con giorno 15 -> prima rata 15/04", occorrenze(tardi, OGGI)[0], { ym: "2026-04", data: "2026-04-15", indice: 1, importo: 317.52 });

console.log("\n— Debito residuo —");
eq("55 rate residue", Math.round(debitoResiduo(auto, OGGI) * 100) / 100, Math.round(55 * 317.52 * 100) / 100);
eq("finanziamento estinto -> 0", debitoResiduo({ ...auto, chiusa: { data: "2026-06-30" } }, OGGI), 0);
eq("abbonamento non fa debito", debitoResiduo({ ...auto, tipo: "abbonamento", rateTotali: 0 }, OGGI), 0);

console.log("\n— Estinzione anticipata —");
const estinto = { ...auto, id: "est", chiusa: { data: "2026-05-31", motivo: "estinzione anticipata" } };
eq("nessuna rata dopo la chiusura", ratePagate(estinto, OGGI), 3); // mar, apr, mag

console.log("\n— Prossima scadenza —");
eq("prossima rata", prossimaScadenza(auto, OGGI), { ym: "2026-08", data: "2026-08-15", indice: 6, importo: 317.52 });
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

// ---------------------------------------------------------------------------
// Caso reale: finanziamento Compass dell'auto (contratto 11/03/2024).
// Piano a due scaglioni: 48 rate da 312,52 + 5,00 di commissioni = 317,52,
// poi 36 rate da 233,74 + 5,00 = 238,74. Prima rata 15/04/2024.
// Questi numeri vengono dal contratto: se un giorno la logica li sbaglia,
// il test lo dice subito.
// ---------------------------------------------------------------------------
console.log("\n— Contratto Compass reale (piano a scaglioni) —");
const clio = {
  id: "clio", tipo: "finanziamento", nome: "Renault Clio", ente: "Compass",
  conto: "bdm", importo: 317.52, giorno: 15, dataInizio: "2024-04-15",
  periodi: [{ rate: 48, importo: 317.52 }, { rate: 36, importo: 238.74 }],
  importoFinanziato: 17845.76, taeg: 9.77, categoria: "Finanziamenti", attiva: true,
  maxirata: { importo: 7238.37, entro: "2028-03-23", allaRata: 48 },
};
eq("84 rate totali", rateTotaliDi(clio), 84);
eq("rata 48 = primo scaglione", importoRata(clio, 48), 317.52);
eq("rata 49 = secondo scaglione", importoRata(clio, 49), 238.74);
eq("rate maturate al 02/08/2026", ratePagate(clio, OGGI), 28);
eq("prossima rata: 15/08/2026 da 317,52", prossimaScadenza(clio, OGGI), { ym: "2026-08", data: "2026-08-15", indice: 29, importo: 317.52 });
// 20 rate residue del 1° periodo (29→48) + 36 del 2° (49→84)
eq("debito residuo reale", debitoResiduo(clio, OGGI), round(20 * 317.52 + 36 * 238.74));
eq("NON è il calcolo a rata unica", debitoResiduo(clio, OGGI) === round(56 * 317.52), false);
eq("somma di tutte le rate", totaleRate(clio), round(48 * 317.52 + 36 * 238.74));
// Somma rate 23.415,60 + commissioni già incluse: il totale dovuto da contratto
// (23.866,96) include anche bolli e spese di comunicazione, non rateizzati.
eq("ultima rata: marzo 2031", occorrenze(clio, "2099-12-31").at(-1).data, "2031-03-15");
eq("maxirata: giorni alla scadenza finestra", maxirataInfo(clio, OGGI).giorni, Math.round((new Date("2028-03-23") - new Date("2026-08-02")) / 86400000));
eq("maxirata non scaduta", maxirataInfo(clio, OGGI).scaduta, false);
eq("maxirata scaduta nel 2029", maxirataInfo(clio, "2029-01-01").scaduta, true);

console.log("\n— Scaglioni: gli addebiti generati usano la rata giusta —");
const baseClio = { "2028-03": { ...EMPTY, saldi: { bdm: 5000, revolut_eur: 0 } } };
// Ci mettiamo a fine 2028: le rate 49+ devono essere da 238,74.
const rClio = applicaRicorrenze(baseClio, [clio], "2028-12-31", { emptyMonth: EMPTY, carried: () => ({ saldi: { bdm: 0, revolut_eur: 0 } }) });
const mov48 = rClio.next["2028-03"].uscite.find(e => e.rataNumero === 48);
const mov49 = rClio.next["2028-04"].uscite.find(e => e.rataNumero === 49);
eq("rata 48 addebitata a 317,52", mov48.importo, 317.52);
eq("rata 49 addebitata a 238,74", mov49.importo, 238.74);
eq("descrizione con totale corretto", mov49.descrizione, "Renault Clio — rata 49/84");

console.log("\n— Compatibilità: piano a rata unica invariato —");
eq("senza periodi si usa importo+rateTotali", pianoRate(auto), [{ rate: 60, importo: 317.52 }]);
eq("rateTotaliDi su rata unica", rateTotaliDi(auto), 60);
eq("abbonamento resta senza fine", rateTotaliDi(claude), 0);
eq("importoRata abbonamento", importoRata(claude, 999), 20);

// ---------------------------------------------------------------------------
// Spese fisse a importo variabile (affitto in RON, bollette).
// Il punto: l'app NON deve mai registrarle da sola, perché non conosce
// l'importo. Se un giorno un refactor le facesse rientrare nella generazione
// automatica, i saldi si riempirebbero di cifre inventate — questi test sono
// la rete di sicurezza contro quello.
// ---------------------------------------------------------------------------
console.log("\n— Spese fisse: mai generate in automatico —");
const affitto = {
  id: "affitto", tipo: "spesa", nome: "Affitto", ente: "Proprietario",
  conto: "revolut_ron", importo: 450, giorno: 5, dataInizio: "2026-01-05",
  categoria: "Affitto", attiva: true,
};
eq("finanziamento ha importo certo", importoCerto(auto), true);
eq("abbonamento ha importo certo", importoCerto(claude), true);
eq("spesa NON ha importo certo", importoCerto(affitto), false);
const rSpesa = applicaRicorrenze(allData, [affitto], OGGI, { emptyMonth: EMPTY, carried });
eq("nessun movimento generato", rSpesa.creati.length, 0);
eq("saldi intatti", rSpesa.next["2026-08"].saldi.revolut_eur, 1000);

console.log("\n— Promemoria da confermare —");
// Nessun pagamento registrato: si chiedono solo le ultime 2 scadenze, non
// tutte quelle da gennaio (un promemoria di 7 mesi fa non è azionabile).
// Nota: al 02/08 l'affitto del 5 agosto NON è ancora dovuto, quindi le ultime
// due scadenze passate sono giugno e luglio.
eq("solo le ultime 2 scadenze passate", daConfermare(affitto, OGGI, new Set()).map(o => o.ym), ["2026-06", "2026-07"]);
eq("scadenza futura non chiesta", daConfermare(affitto, OGGI, new Set()).some(o => o.ym === "2026-08"), false);
eq("quella di luglio già registrata sparisce", daConfermare(affitto, OGGI, new Set(["2026-07"])).map(o => o.ym), ["2026-06"]);
eq("saltata a mano non ricompare", daConfermare(affitto, OGGI, new Set(), { saltati: ["ric-affitto-2026-06"] }).map(o => o.ym), ["2026-07"]);
// Dopo il giorno 5 la scadenza del mese corrente entra fra quelle da confermare.
eq("il 10/08 chiede anche agosto", daConfermare(affitto, "2026-08-10", new Set()).map(o => o.ym), ["2026-07", "2026-08"]);
eq("in pausa nessun promemoria", daConfermare({ ...affitto, attiva: false }, OGGI, new Set()).length, 0);

console.log("\n— Storico e media (la domanda \"sto pagando di più?\") —");
const conStorico = {
  "2026-05": { ...EMPTY, uscite: [{ id: "a1", ricorrenzaId: "affitto", importo: 2210, data: "2026-05-05" }] },
  "2026-06": { ...EMPTY, uscite: [{ id: "a2", ricorrenzaId: "affitto", importo: 2265, data: "2026-06-05" }] },
  "2026-07": { ...EMPTY, uscite: [{ id: "a3", ricorrenzaId: "affitto", importo: 2350, data: "2026-07-05" }, { id: "x", importo: 99, data: "2026-07-06" }] },
  viaggi: [],
};
const st = storicoRicorrenza(conStorico, "affitto");
eq("prende solo i movimenti della ricorrenza", st.length, 3);
eq("ordinati per data", st.map(x => x.ym), ["2026-05", "2026-06", "2026-07"]);
eq("media dei pagamenti", mediaStorico(st), round((2210 + 2265 + 2350) / 3));
eq("importo atteso: vince quello dichiarato", importoAtteso(affitto, st), 450);
eq("senza dichiarato usa la media", importoAtteso({ ...affitto, importo: 0 }, st), round((2210 + 2265 + 2350) / 3));
eq("senza storico né dichiarato è 0", importoAtteso({ ...affitto, importo: 0 }, []), 0);
eq("i mesi già pagati non sono più da confermare", daConfermare(affitto, OGGI, new Set(st.map(x => x.ym))).length, 0);

console.log("\n— Le spese entrano comunque nell'impegno mensile —");
// Servono nella proiezione di fine mese: sapere che il 5 arriva l'affitto è
// utile anche se l'importo esatto lo saprai solo dopo.
eq("affitto contato con l'importo atteso", impegnoMensile([affitto], OGGI), 450);

// ---------------------------------------------------------------------------
// Consumi delle bollette. Numeri veri dalla bolletta E.ON 10734627272:
// gas, periodo 16/06-11/07/2026, 53,055 kWh (= 5 m³ × Pcs 10,611), 38,15 lei.
// ---------------------------------------------------------------------------
console.log("\n— Consumi bollette (dati reali E.ON) —");
const bollette = {
  "2026-06": { ...EMPTY, uscite: [{ id: "g1", ricorrenzaId: "gas", importo: 41.2, data: "2026-06-15", consumo: 60, unita: "kWh", periodoDa: "2026-05-16", periodoA: "2026-06-15" }] },
  "2026-07": { ...EMPTY, uscite: [{ id: "g2", ricorrenzaId: "gas", importo: 38.15, data: "2026-07-17", consumo: 53.055, unita: "kWh", periodoDa: "2026-06-16", periodoA: "2026-07-11" }] },
};
const stGas = storicoRicorrenza(bollette, "gas");
eq("consumo letto dallo storico", stGas.at(-1).consumo, 53.055);
eq("unità letta dallo storico", stGas.at(-1).unita, "kWh");
eq("periodo fatturato letto", [stGas.at(-1).periodoDa, stGas.at(-1).periodoA], ["2026-06-16", "2026-07-11"]);

const annuale = riepilogoAnnuale(stGas);
eq("un solo anno", annuale.length, 1);
eq("spesa annua", annuale[0].spesa, round(41.2 + 38.15));
eq("consumo annuo", annuale[0].consumo, round(60 + 53.055));
// 31 giorni (16/05-15/06) + 26 giorni (16/06-11/07) = 57
eq("giorni sommati dai periodi", annuale[0].giorni, 57);
eq("costo unitario medio", annuale[0].costoUnitario, Math.round(((41.2 + 38.15) / (60 + 53.055)) * 10000) / 10000);
eq("consumo giornaliero", annuale[0].consumoGiornaliero, round((60 + 53.055) / 57));

// Il punto di tutto l'esercizio: distinguere consumo e tariffa. Fra le due
// bollette la spesa scende del 7%, ma non perché costi meno il gas.
const cu = (x) => x.importo / x.consumo;
eq("tariffa quasi identica fra le due bollette", Math.abs(cu(stGas[1]) - cu(stGas[0])) < 0.035, true);
eq("il consumo invece è sceso", stGas[1].consumo < stGas[0].consumo, true);

console.log("\n— Bollette senza consumo registrato —");
const senzaConsumo = { "2026-07": { ...EMPTY, uscite: [{ id: "l1", ricorrenzaId: "luce", importo: 151.89, data: "2026-07-17" }] } };
const stLuce = storicoRicorrenza(senzaConsumo, "luce");
eq("consumo assente vale 0", stLuce[0].consumo, 0);
eq("riepilogo comunque valido", riepilogoAnnuale(stLuce)[0].spesa, 151.89);
eq("niente costo unitario senza consumo", riepilogoAnnuale(stLuce)[0].costoUnitario, null);
eq("niente consumo giornaliero senza periodo", riepilogoAnnuale(stLuce)[0].consumoGiornaliero, null);

// ---------------------------------------------------------------------------
// Bollette luce reali (PPC/Enel, cod client C000719950):
//   26EI09438288 — maggio 2026: 114 kWh, 166,92 lei, 31 giorni
//   26EI11974830 — giugno 2026: 103 kWh, 151,89 lei, 30 giorni
// Entrambe includono "Protect 360 Light" a 13,20 lei con IVA, che NON dipende
// dal consumo. La fattura dichiara "Preț final facturat 1,35 lei/kWh": è quel
// numero che il costo unitario deve riprodurre, e ci riesce solo togliendo la
// quota fissa. Senza toglierla si otterrebbe 1,46 e 1,47, cioè una tariffa
// che sembra salire mentre in realtà è ferma.
// ---------------------------------------------------------------------------
console.log("\n— Bollette luce reali: la quota fissa falsa la tariffa —");
const luceMag = { ym: "2026-06", data: "2026-06-20", importo: 166.92, consumo: 114, unita: "kWh", quotaFissa: 13.20, periodoDa: "2026-05-01", periodoA: "2026-05-31" };
const luceGiu = { ym: "2026-07", data: "2026-07-17", importo: 151.89, consumo: 103, unita: "kWh", quotaFissa: 13.20, periodoDa: "2026-06-01", periodoA: "2026-06-30" };
eq("tariffa maggio = 1,35 come in fattura", Math.round(costoUnitario(luceMag) * 100) / 100, 1.35);
eq("tariffa giugno = 1,35 come in fattura", Math.round(costoUnitario(luceGiu) * 100) / 100, 1.35);
// Il calcolo ingenuo (totale/kWh) direbbe che la tariffa è cambiata: non è vero.
const ingenuo = (x) => Math.round((x.importo / x.consumo) * 100) / 100;
eq("senza quota fissa sembrerebbe 1,46", ingenuo(luceMag), 1.46);
eq("senza quota fissa sembrerebbe 1,47", ingenuo(luceGiu), 1.47);
eq("con la quota fissa la tariffa risulta stabile", Math.abs(costoUnitario(luceGiu) - costoUnitario(luceMag)) < 0.01, true);
eq("niente tariffa senza consumo", costoUnitario({ importo: 100, consumo: 0 }), null);

console.log("\n— Anno di competenza: il consumo non segue il pagamento —");
// Bolletta di dicembre pagata a gennaio: il consumo è del 2026, non del 2027.
const dic = { ym: "2027-01", data: "2027-01-15", importo: 200, consumo: 150, unita: "kWh", periodoDa: "2026-12-01", periodoA: "2026-12-31" };
eq("competenza dal periodo, non dal pagamento", annoCompetenza(dic), "2026");
eq("senza periodo si ripiega sul mese del movimento", annoCompetenza({ ym: "2027-01" }), "2027");
const perAnno = riepilogoAnnuale([luceMag, luceGiu, dic]);
eq("un solo anno di competenza", perAnno.map(a => a.anno), ["2026"]);
eq("consumo annuo completo", perAnno[0].consumo, 114 + 103 + 150);
eq("quote fisse sommate", perAnno[0].quotaFissa, round(13.2 * 2));
eq("tariffa media annua al netto delle quote fisse",
  perAnno[0].costoUnitario,
  Math.round(((166.92 + 151.89 + 200 - 26.4) / (114 + 103 + 150)) * 10000) / 10000);

// ---------------------------------------------------------------------------
// Autolettura: seconda scadenza della bolletta, separata dal pagamento.
// E.ON chiede l'indice fra il giorno 8 e il 14; la fattura arriva dopo.
// ---------------------------------------------------------------------------
console.log("\n— Promemoria autolettura —");
const gasRic = {
  id: "gas", tipo: "spesa", nome: "Bolletta gas", conto: "unicredit_ron",
  giorno: 20, letturaGiorno: 10, dataInizio: "2026-01-20", attiva: true,
};
eq("prima del giorno 10 non chiede nulla", letturaDaFare(gasRic, "2026-08-05", []), null);
eq("dal 10 in poi la chiede", letturaDaFare(gasRic, "2026-08-10", [])?.chiave, "gas-2026-08");
eq("data dell'autolettura", letturaDaFare(gasRic, "2026-08-12", [])?.data, "2026-08-10");
eq("una volta spuntata sparisce", letturaDaFare(gasRic, "2026-08-12", ["gas-2026-08"]), null);
eq("il mese dopo la richiede di nuovo", letturaDaFare(gasRic, "2026-09-11", ["gas-2026-08"])?.chiave, "gas-2026-09");
eq("senza giorno lettura non chiede mai", letturaDaFare({ ...gasRic, letturaGiorno: 0 }, "2026-08-12", []), null);
eq("in pausa non chiede", letturaDaFare({ ...gasRic, attiva: false }, "2026-08-12", []), null);

console.log("\n— Spesa fissa senza importo atteso —");
// È il caso di luce, gas e wifi: nessuna cifra dichiarata e nessuno storico.
// L'app non deve inventare un importo (né 0 né una media inesistente).
const senzaAtteso = { ...affitto, id: "senza", importo: 0 };
eq("importo atteso resta 0, non una cifra inventata", importoAtteso(senzaAtteso, []), 0);
eq("non entra nell'impegno mensile con un numero finto", impegnoMensile([senzaAtteso], OGGI), 0);
eq("ma il promemoria arriva lo stesso", daConfermare(senzaAtteso, OGGI, new Set()).length > 0, true);

function round(n) { return Math.round(n * 100) / 100; }

console.log(`\n${ko === 0 ? "✅ TUTTO OK" : "❌ FALLITI"} — ${ok} passati, ${ko} falliti\n`);
process.exit(ko === 0 ? 0 : 1);
