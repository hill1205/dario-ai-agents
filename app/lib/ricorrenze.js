// Motore delle spese ricorrenti (finanziamenti + abbonamenti).
//
// Perché un file a parte: sono funzioni pure, senza React e senza fetch, così
// la logica delicata (quante rate sono dovute, quanto debito resta, quale mese
// deve ospitare l'addebito) si può testare da riga di comando senza montare la
// pagina — vedi scripts/test-ricorrenze.mjs.
//
// Idea di fondo: NON esiste un collegamento vero al conto bancario. "Scalare in
// automatico" qui significa che, ogni volta che si apre Finanze, l'app guarda
// quali addebiti sarebbero già dovuti e li scrive fra le uscite (che a loro
// volta scalano il saldo del conto, come qualsiasi altra uscita inserita a
// mano). L'operazione è IDEMPOTENTE: l'id del movimento generato è
// deterministico (ric-<idRicorrenza>-<YYYY-MM>), quindi rilanciare la stessa
// generazione dieci volte, o aprire l'app da telefono e computer insieme, non
// può creare doppioni.

export const TIPI_RICORRENZA = ["finanziamento", "abbonamento", "spesa"];

// I tre tipi non sono un'etichetta estetica: cambiano cosa l'app può fare da
// sola.
//   finanziamento / abbonamento -> importo certo, quindi si addebita da solo
//   spesa (affitto in RON, bollette) -> importo che cambia ogni mese, quindi
//     l'app NON può registrarlo: inventerebbe un numero e falserebbe i saldi.
//     Di queste si tiene un "importo atteso" per proiezioni e alert, e alla
//     scadenza si mostra un promemoria con il form già pronto da confermare.
export function importoCerto(ric) {
  return ric?.tipo !== "spesa";
}

// Una ricorrenza:
// {
//   id, tipo: "finanziamento"|"abbonamento",
//   nome, ente,                // "Auto BMW", "BdM Banca" / "Anthropic"
//   conto,                     // id conto da cui scala
//   importo,                   // rata / canone, nella valuta del conto
//   giorno,                    // giorno del mese dell'addebito (1-31)
//   dataInizio,                // YYYY-MM-DD, prima rata
//   rateTotali,                // solo finanziamenti; null/0 = a tempo indeterminato
//   importoFinanziato, taeg,   // opzionali, informativi
//   categoria,                 // categoria dell'uscita generata
//   chiusa: { data, motivo, importoEstinzione } | null,
//   attiva: bool
// }

const pad2 = (n) => String(n).padStart(2, "0");

export function ultimoGiornoDelMese(anno, mese1based) {
  return new Date(anno, mese1based, 0).getDate();
}

// Data dell'addebito in un dato mese. Se il giorno impostato non esiste in quel
// mese (il 31 a febbraio) si usa l'ultimo giorno disponibile: è quello che fanno
// anche le banche, e senza questo clamp una rata "il 31" salterebbe 5 mesi l'anno.
export function dataOccorrenza(ym, giorno) {
  const [y, m] = ym.split("-").map(Number);
  const g = Math.min(Math.max(parseInt(giorno, 10) || 1, 1), ultimoGiornoDelMese(y, m));
  return `${ym}-${pad2(g)}`;
}

export function meseSuccessivo(ym) {
  let [y, m] = ym.split("-").map(Number);
  m += 1;
  if (m === 13) { m = 1; y += 1; }
  return `${y}-${pad2(m)}`;
}

// --- Piano rate a scaglioni -------------------------------------------------
// Un finanziamento può avere periodi con rata diversa: quello dell'auto di
// Dario (Compass) è 48 rate da 317,52€ e poi 36 da 238,74€. Trattarlo come
// rata unica sovrastimava il debito residuo di quasi 2.900€.
//
// `ric.periodi` = [{ rate: 48, importo: 317.52 }, { rate: 36, importo: 238.74 }]
// Se manca, si ricade sul piano a rata unica (importo + rateTotali), quindi i
// finanziamenti e gli abbonamenti già salvati continuano a funzionare identici.
export function pianoRate(ric) {
  const periodi = (ric?.periodi || [])
    .map(p => ({ rate: parseInt(p.rate, 10) || 0, importo: parseFloat(p.importo) || 0 }))
    .filter(p => p.rate > 0 && p.importo > 0);
  if (periodi.length) return periodi;
  return [{ rate: parseInt(ric?.rateTotali, 10) || 0, importo: parseFloat(ric?.importo) || 0 }];
}

// Numero complessivo di rate (0 = a tempo indeterminato, es. abbonamenti).
export function rateTotaliDi(ric) {
  const piano = pianoRate(ric);
  if (piano.some(p => !p.rate)) return 0;
  return piano.reduce((s, p) => s + p.rate, 0);
}

// Importo della rata numero `indice` (1-based).
export function importoRata(ric, indice) {
  let resto = indice;
  for (const p of pianoRate(ric)) {
    if (!p.rate) return p.importo;      // periodo senza fine: vale sempre
    if (resto <= p.rate) return p.importo;
    resto -= p.rate;
  }
  return parseFloat(ric?.importo) || 0;
}

// Tutte le occorrenze di una ricorrenza fino a `finoA` incluso (di norma oggi).
// Ritorna [{ ym, data, indice, importo }] con indice 1-based (= numero rata).
export function occorrenze(ric, finoA, { limite = 600 } = {}) {
  const out = [];
  if (!ric?.dataInizio || !ric?.giorno || !finoA) return out;
  const rateTotali = rateTotaliDi(ric);
  const chiusuraData = ric.chiusa?.data || null;
  let ym = ric.dataInizio.slice(0, 7);
  let indice = 0;
  for (let i = 0; i < limite; i++) {
    const data = dataOccorrenza(ym, ric.giorno);
    // Un addebito precedente alla data di inizio non è mai avvenuto: capita
    // quando la prima rata cade prima del giorno-tipo (inizio 20/03, giorno 15).
    if (data >= ric.dataInizio) {
      if (data > finoA) break;                       // non ancora scaduta
      if (chiusuraData && data > chiusuraData) break; // finanziamento estinto
      indice += 1;
      if (rateTotali && indice > rateTotali) break;   // finito di pagare
      out.push({ ym, data, indice, importo: importoRata(ric, indice) });
    }
    ym = meseSuccessivo(ym);
  }
  return out;
}

// Id deterministico del movimento generato: è questo che rende impossibile il
// doppio addebito, anche se la generazione parte due volte in parallelo.
export function idMovimento(ric, ym) {
  return `ric-${ric.id}-${ym}`;
}

// --- Spese a importo variabile ----------------------------------------------
// Tutti i movimenti già registrati per una ricorrenza, presi da tutti i mesi.
// È questo che permette l'andamento storico ("la luce di ottobre vs quella di
// settembre"): il legame è il campo `ricorrenzaId` sul movimento.
export function storicoRicorrenza(allData, ricId) {
  const out = [];
  for (const [ym, md] of Object.entries(allData || {})) {
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    for (const e of (md?.uscite || [])) {
      if (e.ricorrenzaId === ricId) out.push({
        ym, data: e.data || `${ym}-01`, importo: parseFloat(e.importo) || 0, id: e.id,
        // Consumo della bolletta, se registrato: permette il costo unitario
        // (importo/consumo) e il consumo giornaliero, gli unici due numeri
        // confrontabili fra bollette di periodi diversi.
        consumo: parseFloat(e.consumo) || 0, unita: e.unita || "",
        periodoDa: e.periodoDa || "", periodoA: e.periodoA || "",
        // Quota fissa della bolletta (canoni e servizi che non dipendono dal
        // consumo): va tolta prima di dividere per i kWh, altrimenti il costo
        // unitario sale nei mesi in cui consumi meno anche a tariffa ferma.
        quotaFissa: parseFloat(e.quotaFissa) || 0,
      });
    }
  }
  return out.sort((a, b) => a.data.localeCompare(b.data));
}

// Scadenze già passate per cui non risulta ancora registrato nulla: è la lista
// dei promemoria "hai pagato l'affitto? scrivi quanto". Si guarda solo agli
// ultimi `mesiIndietro` mesi — un promemoria di otto mesi fa non è più
// azionabile, è solo rumore.
export function daConfermare(ric, oggi, registrateYm, { mesiIndietro = 2, saltati = [] } = {}) {
  if (!ric || importoCerto(ric) || ric.attiva === false || ric.chiusa) return [];
  const skip = new Set(saltati);
  const registrate = registrateYm instanceof Set ? registrateYm : new Set(registrateYm || []);
  const tutte = occorrenze(ric, oggi);
  return tutte
    .slice(-mesiIndietro)
    .filter(o => !registrate.has(o.ym) && !skip.has(idMovimento(ric, o.ym)));
}

// Riepilogo per anno: quanto hai speso e quanto hai consumato, con il costo
// unitario medio. È la vista che risponde a "come è andata la luce negli
// anni": il costo unitario separa l'aumento di tariffa dall'aumento di
// consumo, che sul totale annuo si confondono.
// Costo unitario reale: (importo - quota fissa) / consumo. È il numero che
// combacia con il "prezzo finale fatturato" stampato in bolletta.
export function costoUnitario(mov) {
  const consumo = parseFloat(mov?.consumo) || 0;
  if (consumo <= 0) return null;
  const importo = parseFloat(mov.importo) || 0;
  const fissa = parseFloat(mov.quotaFissa) || 0;
  return round4((importo - fissa) / consumo);
}

// Anno di competenza: quello del PERIODO fatturato, non del pagamento. La
// bolletta di giugno si paga a luglio, e quella di dicembre a gennaio: senza
// questa correzione il consumo di dicembre finirebbe nel totale dell'anno
// dopo. Se il periodo non è stato indicato si ripiega sul mese del movimento.
export function annoCompetenza(mov) {
  return (mov?.periodoDa || mov?.ym || "").slice(0, 4);
}

export function riepilogoAnnuale(storico) {
  const anni = {};
  for (const x of (storico || [])) {
    const anno = annoCompetenza(x);
    anni[anno] = anni[anno] || { anno, spesa: 0, consumo: 0, quotaFissa: 0, unita: x.unita || "", n: 0, giorni: 0 };
    anni[anno].spesa += x.importo;
    anni[anno].consumo += x.consumo || 0;
    anni[anno].quotaFissa += x.quotaFissa || 0;
    anni[anno].n += 1;
    if (x.periodoDa && x.periodoA) {
      anni[anno].giorni += Math.round((new Date(x.periodoA + "T00:00:00") - new Date(x.periodoDa + "T00:00:00")) / 86400000) + 1;
    }
    if (!anni[anno].unita && x.unita) anni[anno].unita = x.unita;
  }
  return Object.values(anni)
    .map(a => ({
      ...a,
      spesa: round2(a.spesa),
      consumo: round2(a.consumo),
      quotaFissa: round2(a.quotaFissa),
      // Tariffa vera dell'anno: al netto delle quote fisse.
      costoUnitario: a.consumo > 0 ? round4((a.spesa - a.quotaFissa) / a.consumo) : null,
      consumoGiornaliero: a.giorni > 0 ? round2(a.consumo / a.giorni) : null,
    }))
    .sort((a, b) => a.anno.localeCompare(b.anno));
}

function round4(n) { return Math.round((parseFloat(n) || 0) * 10000) / 10000; }

// --- Autolettura del contatore ----------------------------------------------
// Una bolletta ha due scadenze diverse: mandare l'autolettura (per E.ON dal
// giorno 8 al 14) e pagare la fattura che arriva dopo. Non sono la stessa
// cosa e non si possono mettere sullo stesso giorno: la prima non è un
// pagamento, quindi non genera nessun movimento — solo un promemoria da
// spuntare, tracciato in `letturaFatte` come lista di mesi già inviati.
export function letturaDaFare(ric, oggi, letturaFatte = []) {
  const giorno = parseInt(ric?.letturaGiorno, 10) || 0;
  if (!giorno || ric.attiva === false || ric.chiusa) return null;
  const fatte = new Set(letturaFatte);
  const ym = (oggi || "").slice(0, 7);
  if (!ym) return null;
  const data = dataOccorrenza(ym, giorno);
  // Solo il mese corrente: un'autolettura di due mesi fa non si può più fare.
  if (data > oggi) return null;
  if (fatte.has(`${ric.id}-${ym}`)) return null;
  return { ym, data, chiave: `${ric.id}-${ym}` };
}

// Media degli ultimi N importi registrati: è l'"importo atteso" migliore per
// una bolletta, meglio di un valore fisso scritto una volta e mai aggiornato.
export function mediaStorico(storico, n = 6) {
  const ultimi = (storico || []).slice(-n);
  if (!ultimi.length) return 0;
  return round2(ultimi.reduce((s, x) => s + x.importo, 0) / ultimi.length);
}

// Importo che ci si aspetta per la prossima scadenza: quello dichiarato, o in
// mancanza la media dello storico.
export function importoAtteso(ric, storico) {
  const dichiarato = parseFloat(ric?.importo) || 0;
  return dichiarato > 0 ? dichiarato : mediaStorico(storico);
}

export function descrizioneMovimento(ric, occ) {
  const rateTotali = rateTotaliDi(ric);
  if (ric.tipo === "finanziamento") {
    return rateTotali
      ? `${ric.nome} — rata ${occ.indice}/${rateTotali}`
      : `${ric.nome} — rata ${occ.indice}`;
  }
  if (ric.tipo === "spesa") return ric.nome;
  return `${ric.nome} — abbonamento`;
}

// Rate già scadute (quindi pagate) a una certa data.
export function ratePagate(ric, oggi) {
  return occorrenze(ric, oggi).length;
}

// Debito residuo di un finanziamento: somma delle rate ancora da pagare. Con
// un piano a scaglioni NON si può moltiplicare rate × importo, perché le rate
// future costano meno (o più) di quella corrente: vanno sommate una per una.
// Gli abbonamenti non producono debito (sono un impegno mensile, non un
// capitale dovuto): sommarli gonfierebbe il dato con un numero che non esiste.
export function debitoResiduo(ric, oggi) {
  if (ric.tipo !== "finanziamento") return 0;
  if (ric.chiusa) return 0;
  const rateTotali = rateTotaliDi(ric);
  if (!rateTotali) return 0; // senza numero rate non si può calcolare un residuo
  const pagate = Math.min(ratePagate(ric, oggi), rateTotali);
  let tot = 0;
  for (let i = pagate + 1; i <= rateTotali; i++) tot += importoRata(ric, i);
  return round2(tot);
}

// Quanto costa il finanziamento in tutto: somma di tutte le rate del piano.
// Non è il capitale finanziato — la differenza sono interessi e spese.
export function totaleRate(ric) {
  const n = rateTotaliDi(ric);
  if (!n) return 0;
  let tot = 0;
  for (let i = 1; i <= n; i++) tot += importoRata(ric, i);
  return round2(tot);
}

// Prossimo addebito futuro (o odierno) di una ricorrenza ancora attiva.
export function prossimaScadenza(ric, oggi) {
  if (!ric || ric.attiva === false || ric.chiusa) return null;
  if (!ric.dataInizio || !ric.giorno) return null;
  const rateTotali = rateTotaliDi(ric);
  const passate = occorrenze(ric, oggi);
  const prossimoIndice = passate.length + 1;
  if (rateTotali && prossimoIndice > rateTotali) return null;
  // Si riparte dal mese dell'ultima occorrenza (o dall'inizio) e si avanza.
  let ym = passate.length ? meseSuccessivo(passate[passate.length - 1].ym) : ric.dataInizio.slice(0, 7);
  for (let i = 0; i < 24; i++) {
    const data = dataOccorrenza(ym, ric.giorno);
    if (data >= ric.dataInizio && data > oggi) return { ym, data, indice: prossimoIndice, importo: importoRata(ric, prossimoIndice) };
    ym = meseSuccessivo(ym);
  }
  return null;
}

// Quota mensile totale già impegnata dalle ricorrenze attive, per valuta del
// conto: è il "quanto del mio mese è già bloccato prima ancora di iniziare".
export function impegnoMensile(ricorrenze, oggi) {
  return (ricorrenze || []).reduce((s, r) => {
    if (r.attiva === false || r.chiusa) return s;
    const p = prossimaScadenza(r, oggi);
    // L'importo lo dà la prossima scadenza: con un piano a scaglioni la rata
    // corrente può essere diversa da quella "base" salvata sulla ricorrenza.
    return p ? s + (p.importo || parseFloat(r.importo) || 0) : s;
  }, 0);
}

// Finestra della maxirata (opzione di chiusura anticipata a metà piano):
// { importo, entro, allaRata } sulla ricorrenza. Ritorna anche i giorni che
// mancano, per decidere se avvisare.
export function maxirataInfo(ric, oggi) {
  const m = ric?.maxirata;
  if (!m || !(parseFloat(m.importo) > 0) || !m.entro) return null;
  if (ric.chiusa) return null;
  const giorni = Math.round((new Date(m.entro + "T00:00:00") - new Date(oggi + "T00:00:00")) / 86400000);
  return { importo: parseFloat(m.importo), entro: m.entro, allaRata: parseInt(m.allaRata, 10) || 0, giorni, scaduta: giorni < 0 };
}

// --- Generazione degli addebiti ---------------------------------------------
// Ritorna { next, creati } dove `next` è il nuovo allData e `creati` l'elenco
// dei movimenti aggiunti (per mostrare un avviso "ho registrato N addebiti").
//
// I saldi vengono scalati nel mese dell'addebito E in tutti i mesi successivi
// già esistenti: la propagazione la facciamo qui, in un colpo solo, perché
// propagaSaldiAiMesiSuccessivi salta i mesi già toccati e con un backfill di
// più mesi insieme lascerebbe i saldi sfasati. Il chiamante deve quindi
// salvare con skipPropagazione:true.
// `saltati` sono gli id di addebiti generati che l'utente ha cancellato a
// mano: senza questa lista tornerebbero al reload successivo (l'id è
// deterministico, quindi la generazione li vedrebbe di nuovo come mancanti).
//
// `saldiDaMese` (default: il mese di oggi) è la regola più importante di
// tutte. Gli addebiti arretrati vengono registrati come STORICO ma NON toccano
// i saldi: i saldi dei mesi passati Dario li ha già scritti a mano leggendoli
// dalla banca, quindi contengono già quelle rate. Riapplicarle le conterebbe
// due volte e sballerebbe tutta la catena dei riporti. Dal mese corrente in
// poi, invece, l'addebito scala il conto normalmente.
// I movimenti storici così creati portano il flag `noSaldo:true`, che serve
// anche a modifica/eliminazione per non annullare un effetto mai applicato.
export function applicaRicorrenze(allData, ricorrenze, oggi, { emptyMonth, carried, saltati = [], saldiDaMese } = {}) {
  const isMese = (k) => /^\d{4}-\d{2}$/.test(k);
  const daMese = saldiDaMese || (oggi || "").slice(0, 7);
  const skip = new Set(saltati);
  const next = { ...allData };
  const creati = [];
  const attive = (ricorrenze || []).filter(r => r.attiva !== false);

  for (const ric of attive) {
    if (!ric.conto) continue;
    // Le spese a importo variabile non si generano mai da sole: vedi
    // importoCerto(). Restano come promemoria da confermare a mano.
    if (!importoCerto(ric)) continue;
    if (!(parseFloat(ric.importo) > 0) && !pianoRate(ric).some(p => p.importo > 0)) continue;
    for (const occ of occorrenze(ric, oggi)) {
      const movId = idMovimento(ric, occ.ym);
      if (skip.has(movId)) continue;
      const base = next[occ.ym] || { ...emptyMonth, ...carried(next, occ.ym) };
      const gia = (base.uscite || []).some(e => e.id === movId);
      if (gia) continue;

      // Storico (mese precedente a quello di partenza) = solo registrazione.
      const toccaSaldi = occ.ym >= daMese;
      const item = {
        id: movId,
        descrizione: descrizioneMovimento(ric, occ),
        categoria: ric.categoria || (ric.tipo === "finanziamento" ? "Finanziamenti" : "Abbonamenti"),
        conto: ric.conto,
        // L'importo lo dà l'occorrenza: nei piani a scaglioni la rata cambia.
        importo: round2(occ.importo || parseFloat(ric.importo) || 0),
        data: occ.data,
        ricorrenzaId: ric.id,
        ricorrenzaTipo: ric.tipo,
        rataNumero: occ.indice,
        auto: true,
      };
      if (!toccaSaldi) item.noSaldo = true;
      const mese = { ...base, uscite: [...(base.uscite || []), item], saldi: { ...(base.saldi || {}) } };
      if (toccaSaldi && mese.saldi[ric.conto] !== undefined) {
        // L'uscita scala il conto nel suo mese...
        mese.saldi[ric.conto] = round2((parseFloat(mese.saldi[ric.conto]) || 0) - item.importo);
      }
      next[occ.ym] = mese;
      if (toccaSaldi) {
        // ...e in tutti i mesi successivi già esistenti, perché quei saldi sono
        // la fotografia di una chiusura che ora include un movimento in più.
        for (const k of Object.keys(next)) {
          if (!isMese(k) || k <= occ.ym) continue;
          const md = next[k];
          if (!md?.saldi || md.saldi[ric.conto] === undefined) continue;
          next[k] = { ...md, saldi: { ...md.saldi, [ric.conto]: round2((parseFloat(md.saldi[ric.conto]) || 0) - item.importo) } };
        }
      }
      creati.push({ item, ric, occ, toccaSaldi });
    }
  }
  return { next, creati };
}

function round2(n) { return Math.round((parseFloat(n) || 0) * 100) / 100; }
