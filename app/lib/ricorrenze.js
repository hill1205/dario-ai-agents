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

export const TIPI_RICORRENZA = ["finanziamento", "abbonamento"];

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

// Tutte le occorrenze di una ricorrenza fino a `finoA` incluso (di norma oggi).
// Ritorna [{ ym, data, indice }] con indice 1-based (= numero della rata).
export function occorrenze(ric, finoA, { limite = 600 } = {}) {
  const out = [];
  if (!ric?.dataInizio || !ric?.giorno || !finoA) return out;
  const rateTotali = parseInt(ric.rateTotali, 10) || 0;
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
      out.push({ ym, data, indice });
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

export function descrizioneMovimento(ric, occ) {
  const rateTotali = parseInt(ric.rateTotali, 10) || 0;
  if (ric.tipo === "finanziamento") {
    return rateTotali
      ? `${ric.nome} — rata ${occ.indice}/${rateTotali}`
      : `${ric.nome} — rata ${occ.indice}`;
  }
  return `${ric.nome} — abbonamento`;
}

// Rate già scadute (quindi pagate) a una certa data.
export function ratePagate(ric, oggi) {
  return occorrenze(ric, oggi).length;
}

// Debito residuo di un finanziamento: rate ancora da pagare × importo rata.
// Gli abbonamenti non producono debito (sono un impegno mensile, non un
// capitale dovuto): sommarli al debito gonfierebbe il dato con un numero
// che non esiste.
export function debitoResiduo(ric, oggi) {
  if (ric.tipo !== "finanziamento") return 0;
  if (ric.chiusa) return 0;
  const rateTotali = parseInt(ric.rateTotali, 10) || 0;
  if (!rateTotali) return 0; // senza numero rate non si può calcolare un residuo
  const pagate = Math.min(ratePagate(ric, oggi), rateTotali);
  return Math.max(rateTotali - pagate, 0) * (parseFloat(ric.importo) || 0);
}

// Prossimo addebito futuro (o odierno) di una ricorrenza ancora attiva.
export function prossimaScadenza(ric, oggi) {
  if (!ric || ric.attiva === false || ric.chiusa) return null;
  if (!ric.dataInizio || !ric.giorno) return null;
  const rateTotali = parseInt(ric.rateTotali, 10) || 0;
  const passate = occorrenze(ric, oggi);
  const prossimoIndice = passate.length + 1;
  if (rateTotali && prossimoIndice > rateTotali) return null;
  // Si riparte dal mese dell'ultima occorrenza (o dall'inizio) e si avanza.
  let ym = passate.length ? meseSuccessivo(passate[passate.length - 1].ym) : ric.dataInizio.slice(0, 7);
  for (let i = 0; i < 24; i++) {
    const data = dataOccorrenza(ym, ric.giorno);
    if (data >= ric.dataInizio && data > oggi) return { ym, data, indice: prossimoIndice };
    ym = meseSuccessivo(ym);
  }
  return null;
}

// Quota mensile totale già impegnata dalle ricorrenze attive, per valuta del
// conto: è il "quanto del mio mese è già bloccato prima ancora di iniziare".
export function impegnoMensile(ricorrenze, oggi) {
  return (ricorrenze || [])
    .filter(r => r.attiva !== false && !r.chiusa && prossimaScadenza(r, oggi))
    .reduce((s, r) => s + (parseFloat(r.importo) || 0), 0);
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
    if (!ric.conto || !(parseFloat(ric.importo) > 0)) continue;
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
        importo: parseFloat(ric.importo),
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
