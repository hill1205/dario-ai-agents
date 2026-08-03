// Test della logica auto (km, consumo, costo al km).
// Uso: node scripts/test-auto.mjs
// Non serve build né browser: sono funzioni pure.
//
// I casi qui dentro sono quelli che in strada capitano davvero a Dario:
// rifornimenti parziali da 100-200 lei, pieni in Ungheria pagati in euro,
// mesi in cui l'odometro se lo dimentica, e la lettura sbagliata di battitura.

import {
  isRifornimento, rifornimenti, prezzoAlLitro, letture, anomalie,
  segmentiConsumo, consumoMedio, kmDelMese, statsMese, statsPerMese,
  speseManutenzione,
} from "../app/lib/auto.js";

let ok = 0, ko = 0;
const eq = (nome, a, b) => {
  const pass = JSON.stringify(a) === JSON.stringify(b);
  if (pass) { ok++; console.log(`  ✅ ${nome}`); }
  else { ko++; console.log(`  ❌ ${nome}\n     atteso: ${JSON.stringify(b)}\n     ottenuto: ${JSON.stringify(a)}`); }
};

const u = (o) => ({ categoria: "Trasporti", sottocategoria: "Carburante", conto: "unicredit_ron", ...o });

console.log("\n— Riconoscere un rifornimento —");
eq("sottocategoria Carburante", isRifornimento(u({ data: "2026-08-01" })), true);
eq("Manutenzione auto non è un rifornimento", isRifornimento(u({ sottocategoria: "Manutenzione auto", litri: 30 })), false);
// I movimenti inseriti prima dello split del 03/08 hanno la sottocategoria
// vecchia: se hanno i litri vanno contati lo stesso, altrimenti lo storico
// sparirebbe il giorno del rilascio.
eq("vecchia sottocategoria CON litri", isRifornimento(u({ sottocategoria: "Rifornimento + manutenzione", litri: 42 })), true);
eq("vecchia sottocategoria SENZA litri (può essere un tagliando)", isRifornimento(u({ sottocategoria: "Rifornimento + manutenzione", importo: 400 })), false);
eq("Bolt/Uber mai", isRifornimento(u({ sottocategoria: "Bolt/Uber", litri: 10 })), false);

console.log("\n— Prezzo al litro nella valuta pagata —");
// In euro non sarebbe confrontabile: il gasolio rumeno e quello ungherese
// costano diverso, e il cambio aggiungerebbe rumore che non c'entra col prezzo.
eq("199,99 lei / 28 litri", prezzoAlLitro({ litri: 28, importo: 199.99 })?.toFixed(3), "7.143");
eq("senza litri non si calcola", prezzoAlLitro({ litri: 0, importo: 200 }), null);

console.log("\n— Consumo fra due pieni, con parziali in mezzo —");
// Pieno a 10.000 km, poi due parziali, poi pieno a 10.800: 800 km con
// 20+15+25 = 60 litri messi dopo il primo pieno -> 13,33 km/l.
const conParziali = rifornimenti([
  u({ id: "a", data: "2026-08-01", odometro: 10000, litri: 50, pieno: true, importo: 350 }),
  u({ id: "b", data: "2026-08-08", odometro: 10250, litri: 20, pieno: false, importo: 140 }),
  u({ id: "c", data: "2026-08-15", odometro: 10500, litri: 15, pieno: false, importo: 105 }),
  u({ id: "d", data: "2026-08-22", odometro: 10800, litri: 25, pieno: true, importo: 175 }),
]);
const segs = segmentiConsumo(conParziali);
eq("un solo segmento (fra i due pieni)", segs.length, 1);
eq("km del tratto", segs[0].km, 800);
// I litri del PRIMO pieno non contano: erano già nel serbatoio a inizio tratto.
eq("litri = parziali + pieno finale, non il pieno iniziale", segs[0].litri, 60);
eq("km/litro", segs[0].kmPerLitro, 13.33);
eq("litri/100km", segs[0].litriPer100km, 7.5);
eq("due parziali segnalati", segs[0].parzialiInMezzo, 2);

console.log("\n— Solo rifornimenti parziali: nessun consumo —");
// Senza un pieno non si sa quanto carburante c'era nel serbatoio, quindi il
// rapporto km/litri sarebbe inventato. Meglio nessun numero che uno falso.
const soloParziali = rifornimenti([
  u({ data: "2026-08-01", odometro: 10000, litri: 15, importo: 105 }),
  u({ data: "2026-08-10", odometro: 10300, litri: 15, importo: 105 }),
  u({ data: "2026-08-20", odometro: 10600, litri: 15, importo: 105 }),
]);
eq("nessun segmento", segmentiConsumo(soloParziali).length, 0);
eq("nessun consumo medio", consumoMedio(segmentiConsumo(soloParziali)), null);
// ...ma i chilometri sì: quelli dipendono solo dall'odometro.
eq("i km però si vedono", kmDelMese(soloParziali, "2026-08")?.km, 600);

console.log("\n— Un rifornimento senza litri rompe solo il suo tratto —");
const litriMancanti = rifornimenti([
  u({ data: "2026-08-01", odometro: 10000, litri: 50, pieno: true, importo: 350 }),
  u({ data: "2026-08-10", odometro: 10400, litri: 0, importo: 100 }),   // scordato di segnare i litri
  u({ data: "2026-08-20", odometro: 10800, litri: 45, pieno: true, importo: 315 }),
  u({ data: "2026-08-30", odometro: 11400, litri: 48, pieno: true, importo: 336 }),
]);
const s2 = segmentiConsumo(litriMancanti);
eq("il tratto incompleto viene saltato", s2.length, 1);
eq("ma il tratto successivo si calcola", s2[0].km, 600);

console.log("\n— Odometro sbagliato (errore di battitura) —");
// 1080 invece di 10800: se lo accettassimo, il tratto prima uscirebbe negativo
// e quello dopo enorme. Due tratti falsati da una svista sola.
const battitura = rifornimenti([
  u({ data: "2026-08-01", odometro: 10000, litri: 50, pieno: true, importo: 350 }),
  u({ data: "2026-08-10", odometro: 1080, litri: 40, pieno: true, importo: 280 }),
  u({ data: "2026-08-20", odometro: 10800, litri: 45, pieno: true, importo: 315 }),
]);
eq("una anomalia segnalata", anomalie(battitura).length, 1);
eq("la lettura sbagliata è esclusa", letture(battitura).filter(r => r.odometroValido).length, 2);
eq("il consumo si calcola sulle due letture buone", segmentiConsumo(battitura)[0].km, 800);

console.log("\n— Km del mese: serve l'ancora del mese prima —");
// I km fatti dal 1° del mese fino al primo rifornimento sono comunque tuoi.
// Prendendo solo le letture interne al mese sparirebbero.
const dueMesi = rifornimenti([
  u({ data: "2026-07-28", odometro: 9000, litri: 40, pieno: true, importo: 280 }),
  u({ data: "2026-08-05", odometro: 9600, litri: 42, pieno: true, importo: 294 }),
  u({ data: "2026-08-25", odometro: 10200, litri: 44, pieno: true, importo: 308 }),
]);
eq("km di agosto contano dal pieno di luglio", kmDelMese(dueMesi, "2026-08")?.km, 1200);
eq("non è un dato parziale", kmDelMese(dueMesi, "2026-08")?.parziale, false);
// Luglio invece è il primo mese di dati: non c'è niente prima, quindi il
// numero è per forza incompleto e va dichiarato tale.
eq("luglio senza ancora precedente -> nessun km", kmDelMese(dueMesi, "2026-07"), null);
eq("mese senza rifornimenti", kmDelMese(dueMesi, "2026-06"), null);

console.log("\n— Valute miste: i litri si sommano, gli euro pure —");
// Pieno in Romania in lei, pieno in Ungheria in euro. La spesa del mese ha
// senso solo in euro; il prezzo al litro resta nella valuta di ciascun pieno.
const misto = rifornimenti([
  u({ data: "2026-08-01", odometro: 10000, litri: 50, pieno: true, importo: 350 }),
  u({ data: "2026-08-12", odometro: 10700, litri: 45, pieno: true, importo: 78.30, conto: "revolut_eur" }),
], (e) => (e.conto === "revolut_eur" ? +e.importo : +e.importo / 5));
const stMisto = statsMese(misto, "2026-08");
eq("spesa in euro convertita", stMisto.spesaEur, 148.3);
eq("litri sommati a prescindere dalla valuta", stMisto.litri, 95);
eq("km/litro del tratto", stMisto.kmPerLitro, 15.56);

console.log("\n— Consumo medio pesato sui km —");
// Media delle medie sbagliata: (20 + 10)/2 = 15. Pesata: 900 km / 60 l = 15…
// qui coincide, quindi serve un caso asimmetrico per vedere la differenza.
const pesato = consumoMedio([
  { km: 800, litri: 40, kmPerLitro: 20 },   // viaggio lungo, 20 km/l
  { km: 40,  litri: 8,  kmPerLitro: 5 },    // giro in città, 5 km/l
]);
eq("km totali", pesato.km, 840);
// Media aritmetica delle due sarebbe 12,5: il giro da 40 km peserebbe quanto
// il viaggio da 800. Pesata sui km viene 17,5, che è il consumo vero.
eq("km/litro pesato, non media delle medie", pesato.kmPerLitro, 17.5);

console.log("\n— Stats mensili e manutenzione —");
const st = statsMese(dueMesi, "2026-08");
eq("due rifornimenti ad agosto", st.rifornimenti, 2);
eq("costo per km", st.costoEurPerKm, +(602 / 1200).toFixed(3));
eq("storico ordinato dal più recente", statsPerMese(dueMesi).map(x => x.ym), ["2026-08", "2026-07"]);
// Il tagliando non entra nel carburante: è il motivo per cui abbiamo separato
// le due sottocategorie.
const conTagliando = [
  u({ data: "2026-08-03", odometro: 10100, litri: 40, pieno: true, importo: 280 }),
  u({ data: "2026-08-14", sottocategoria: "Manutenzione auto", importo: 400 }),
];
eq("la manutenzione sta fuori dai rifornimenti", rifornimenti(conTagliando).length, 1);
eq("e si somma a parte", speseManutenzione(conTagliando, "2026-08"), 400);

console.log(`\n${ko === 0 ? "✅ TUTTO OK" : "❌ FALLITI"} — ${ok} passati, ${ko} falliti\n`);
process.exit(ko === 0 ? 0 : 1);
