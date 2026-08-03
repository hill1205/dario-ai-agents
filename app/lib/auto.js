// Motore dei calcoli sull'auto: chilometri percorsi, consumo reale (km/litro)
// e costo al chilometro.
//
// Perché un file a parte, come ricorrenze.js: sono funzioni pure, senza React
// e senza fetch, quindi la parte delicata — quali rifornimenti si possono
// confrontare fra loro — si prova da riga di comando con dati finti, invece
// che riempiendo il serbatoio per vedere se il numero torna.
// Vedi scripts/test-auto.mjs.
//
// L'idea di fondo, che è anche il motivo per cui questo file non è banale:
// l'app NON sa quanti chilometri fai. Sa solo cosa scrivi tu quando fai
// benzina. Da due letture dell'odometro ricava i km percorsi in mezzo; dai
// litri messi in quel tratto ricava il consumo. Tutto il resto è la gestione
// dei casi in cui quei due numeri non sono confrontabili.

// Le due etichette vivono qui e non in finance-ui.jsx perché quel file è un
// modulo client con dentro React e JSX: importarlo renderebbe questo motore
// impossibile da eseguire con `node`, e i test da riga di comando sono metà
// del motivo per cui il file esiste. finance-ui le ri-esporta per la UI.
export const SOTTOCAT_CARBURANTE = "Carburante";
// Nome della sottocategoria prima dello split del 2026-08-03: i movimenti già
// salvati lo portano ancora, quindi va riconosciuto ovunque si LEGGANO dati
// storici, anche se non compare più fra i pulsanti del form.
export const SOTTOCAT_AUTO_LEGACY = "Rifornimento + manutenzione";
export const SOTTOCAT_MANUTENZIONE = "Manutenzione auto";

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// Un movimento è un rifornimento se sta in "Carburante", oppure se porta la
// vecchia sottocategoria unica ma ha i litri compilati: così i movimenti
// inseriti prima dello split del 2026-08-03 continuano a contare, senza
// obbligare a riclassificarli tutti a mano.
export function isRifornimento(e) {
  if (!e) return false;
  if (e.sottocategoria === SOTTOCAT_CARBURANTE) return true;
  return e.sottocategoria === SOTTOCAT_AUTO_LEGACY && num(e.litri) > 0;
}

// Normalizza le uscite in una lista di rifornimenti ordinati per data.
// `toEur` converte l'importo nella valuta del conto in euro: sta fuori da qui
// perché il tasso di cambio vive nella pagina, e questo file deve restare
// testabile senza rete.
export function rifornimenti(uscite, toEur = (e) => num(e.importo)) {
  return (uscite || [])
    .filter(isRifornimento)
    .map((e) => ({
      id: e.id,
      data: e.data || "",
      litri: num(e.litri),
      odometro: num(e.odometro),
      pieno: !!e.pieno,
      importo: num(e.importo),      // valuta del conto (RON in Romania, € in Ungheria)
      importoEur: num(toEur(e)),
      conto: e.conto || "",
      nome: e.nome || e.descrizione || "",
    }))
    .sort((a, b) => (a.data || "").localeCompare(b.data || "") || a.odometro - b.odometro);
}

// Prezzo al litro nella valuta in cui hai pagato. In euro non avrebbe senso
// confrontarlo fra Romania e Ungheria: il prezzo del gasolio è diverso, e il
// cambio ci metterebbe sopra un rumore che non c'entra col distributore.
export function prezzoAlLitro(r) {
  return r && r.litri > 0 && r.importo > 0 ? r.importo / r.litri : null;
}

// --- Letture dell'odometro --------------------------------------------------
// Un odometro che torna indietro è quasi sempre un errore di battitura (un
// numero mancante, o i km scritti al posto dei litri). Non lo correggiamo:
// lo segnaliamo e lo escludiamo dai calcoli, perché una lettura sbagliata non
// falsa solo sé stessa — falsa anche i due tratti che le stanno intorno.
export function letture(rifs) {
  const out = [];
  let ultimo = null;
  for (const r of rifs) {
    if (!(r.odometro > 0)) { out.push({ ...r, odometroValido: false, motivo: "senza lettura" }); continue; }
    if (ultimo !== null && r.odometro < ultimo) { out.push({ ...r, odometroValido: false, motivo: "lettura minore della precedente" }); continue; }
    ultimo = r.odometro;
    out.push({ ...r, odometroValido: true });
  }
  return out;
}

export function anomalie(rifs) {
  return letture(rifs).filter((r) => !r.odometroValido && r.motivo === "lettura minore della precedente");
}

// --- Consumo ---------------------------------------------------------------
// La regola che rende corretto il calcolo con i rifornimenti parziali: il
// consumo si misura SOLO fra due pieni. Un pieno riporta il serbatoio a un
// livello noto, quindi fra un pieno e il successivo i litri messi (compresi i
// parziali in mezzo) sono esattamente i litri bruciati in quei chilometri.
//
// Con i parziali soli non funziona: se metti 100 lei oggi e 150 domani non sai
// quanto carburante era rimasto nel serbatoio, e il rapporto km/litri può
// uscire doppio o dimezzato a seconda di quanto era pieno all'inizio. Per
// questo i parziali non generano un segmento loro: si sommano al tratto fra i
// due pieni che li contengono.
export function segmentiConsumo(rifs) {
  const ls = letture(rifs).filter((r) => r.odometroValido);
  const segmenti = [];
  let ancora = null;          // ultimo pieno visto
  let litriDaAncora = 0;      // litri messi dopo l'ancora (parziali inclusi)
  let costoDaAncora = 0;
  let costoEurDaAncora = 0;
  let parzialiInMezzo = 0;
  let litriMancanti = false;  // un rifornimento senza litri rende il tratto non calcolabile

  for (const r of ls) {
    if (ancora !== null) {
      if (!(r.litri > 0)) litriMancanti = true;
      litriDaAncora += r.litri;
      costoDaAncora += r.importo;
      costoEurDaAncora += r.importoEur;
      if (!r.pieno) parzialiInMezzo += 1;
    }
    if (r.pieno) {
      if (ancora !== null) {
        const km = r.odometro - ancora.odometro;
        // Due pieni con lo stesso odometro (doppia registrazione, o pieno
        // fatto senza aver guidato) darebbero una divisione per zero.
        if (km > 0 && litriDaAncora > 0 && !litriMancanti) {
          segmenti.push({
            daData: ancora.data,
            aData: r.data,
            daOdometro: ancora.odometro,
            aOdometro: r.odometro,
            km: round(km, 1),
            litri: round(litriDaAncora, 2),
            kmPerLitro: round(km / litriDaAncora, 2),
            litriPer100km: round((litriDaAncora / km) * 100, 2),
            costo: round(costoDaAncora, 2),
            costoEur: round(costoEurDaAncora, 2),
            costoEurPerKm: round(costoEurDaAncora / km, 3),
            parzialiInMezzo,
          });
        }
      }
      ancora = r;
      litriDaAncora = 0; costoDaAncora = 0; costoEurDaAncora = 0;
      parzialiInMezzo = 0; litriMancanti = false;
    }
  }
  return segmenti;
}

// Consumo medio complessivo: si pesa sui chilometri, non sulla media delle
// medie. Un tratto di 800 km e uno di 40 km non valgono uguale, e fare la
// media aritmetica dei km/litro darebbe più peso al viaggetto in città.
export function consumoMedio(segmenti) {
  const km = segmenti.reduce((s, x) => s + x.km, 0);
  const litri = segmenti.reduce((s, x) => s + x.litri, 0);
  if (!(km > 0 && litri > 0)) return null;
  return { km: round(km, 1), litri: round(litri, 2), kmPerLitro: round(km / litri, 2), litriPer100km: round((litri / km) * 100, 2) };
}

// --- Chilometri di un mese --------------------------------------------------
// I km del mese sono la differenza fra l'ultima lettura del mese e l'ultima
// lettura PRECEDENTE al mese. Non fra la prima e l'ultima dentro il mese: i
// chilometri fatti dal 1° del mese fino al primo rifornimento sono comunque
// tuoi, e prendendo solo le letture interne sparirebbero.
//
// Se una lettura precedente non esiste (primo mese di dati) si ripiega sulle
// letture interne e si marca `parziale`, così la UI può dirlo invece di far
// credere che quel mese tu abbia guidato meno.
export function kmDelMese(rifs, ym) {
  const ls = letture(rifs).filter((r) => r.odometroValido && r.data);
  const dentro = ls.filter((r) => r.data.slice(0, 7) === ym);
  if (!dentro.length) return null;
  const ultima = dentro[dentro.length - 1];
  const prima = [...ls].reverse().find((r) => r.data < dentro[0].data);
  const base = prima || dentro[0];
  const km = ultima.odometro - base.odometro;
  if (!(km > 0)) return null;
  return { km: round(km, 1), parziale: !prima, daOdometro: base.odometro, aOdometro: ultima.odometro };
}

// Statistiche di un mese: km, litri, spesa, consumo. Il consumo di un mese usa
// i segmenti che FINISCONO in quel mese: un tratto è confrontabile solo per
// intero, e spezzarlo sul confine del mese richiederebbe di sapere quanti km
// hai fatto prima e dopo mezzanotte del 31.
export function statsMese(rifs, ym) {
  const delMese = rifs.filter((r) => (r.data || "").slice(0, 7) === ym);
  const km = kmDelMese(rifs, ym);
  const segs = segmentiConsumo(rifs).filter((s) => (s.aData || "").slice(0, 7) === ym);
  const cons = consumoMedio(segs);
  const litri = delMese.reduce((s, r) => s + r.litri, 0);
  const spesaEur = delMese.reduce((s, r) => s + r.importoEur, 0);
  return {
    ym,
    rifornimenti: delMese.length,
    litri: round(litri, 2),
    spesaEur: round(spesaEur, 2),
    km: km ? km.km : null,
    kmParziali: km ? km.parziale : false,
    kmPerLitro: cons ? cons.kmPerLitro : null,
    litriPer100km: cons ? cons.litriPer100km : null,
    // Il costo al km usa i km del mese e la spesa del mese: è una stima di
    // cassa ("quanto mi è costato guidare a agosto"), diversa dal costo per km
    // dei segmenti, che è più preciso ma copre solo i tratti fra due pieni.
    costoEurPerKm: km && km.km > 0 && spesaEur > 0 ? round(spesaEur / km.km, 3) : null,
    segmenti: segs.length,
  };
}

// Ultimi N mesi con almeno un rifornimento, dal più recente al più vecchio.
export function statsPerMese(rifs, limite = 12) {
  const mesi = [...new Set(rifs.map((r) => (r.data || "").slice(0, 7)).filter(Boolean))].sort().reverse();
  return mesi.slice(0, limite).map((ym) => statsMese(rifs, ym));
}

// Spesa di manutenzione (tagliandi, gomme, riparazioni): tenuta separata dal
// carburante perché non scala con i chilometri. Serve al totale "quanto mi
// costa l'auto", non al consumo.
export function speseManutenzione(uscite, ym, toEur = (e) => num(e.importo)) {
  return round((uscite || [])
    .filter((e) => e.sottocategoria === SOTTOCAT_MANUTENZIONE && (e.data || "").slice(0, 7) === ym)
    .reduce((s, e) => s + num(toEur(e)), 0), 2);
}
