// Registro delle decisioni importanti — lettura/scrittura sul Doc ClickUp.
//
// PERCHE' ESISTE
// La dashboard sa dire cosa hai FATTO: task chiuse, fatturato entrato, kg
// persi, abitudini tenute. Non sa dire perche' l'hai fatto. E' la parte che
// evapora: dopo sei mesi ti resta il risultato (l'agenzia ha preso quel
// cliente, hai firmato quel finanziamento) e hai perso completamente il
// ragionamento che ti ci ha portato — cosa sapevi allora, cosa temevi, cosa
// avevi scartato e con quale motivo.
//
// Senza quel pezzo non puoi migliorare come decidi, solo come esegui. E per
// arrivare a 1M€ il collo di bottiglia non e' quasi mai l'esecuzione.
//
// LA MECCANICA E' IN DUE TEMPI, ED E' TUTTO IL PUNTO
//   1. Scrivi la decisione PRIMA di conoscerne l'esito, obbligandoti a
//      dichiarare fiducia e rischi previsti.
//   2. Alla data di revisione rispondi a sei domande fisse, CONFRONTANDOTI
//      con quello che avevi scritto allora.
//
// Il valore sta nel fatto che il passo 1 e' congelato. Se potessi
// modificare contesto/fiducia/rischi dopo aver visto com'e' andata, il
// registro diventerebbe un raccoglitore di razionalizzazioni ("lo sapevo").
// Da qui la regola sulle modifiche piu' sotto.
//
// FORMA DI UNA DECISIONE
//   {
//     id, data, titolo, contesto, obiettivo, alternative,
//     decisione, motivazione, fiducia (1-10), rischi,
//     dataRevisione, ambito ("business"|"personale"), ts,
//     revisione: null | {
//       data, rifaresti ("si"|"no"|"in-parte"),
//       previsto, sottovalutato, risultato, imparato, diverso, ts
//     }
//   }

import { leggiJson, scriviJson, PAGINE, invalidaPagina } from "./clickup-doc";
import { bucharestDate } from "./habits-store";

const PAGE_ID = PAGINE.decisioni;
const MARCATORE = "DECISIONS_DATA_JSON";
const INTESTAZIONE = [
  "REGISTRO DECISIONI DARIO",
  "",
  "Non modificare a mano: viene letto/scritto dalla dashboard.",
  "Ogni voce ha due tempi: la decisione (scritta prima di sapere com'è andata)",
  "e la revisione (compilata alla data prevista). La prima parte si congela",
  "dopo 24 ore di proposito — un registro riscrivibile a posteriori non",
  "misura come decidi, misura come ti racconti le cose.",
].join("\n");

export { bucharestDate };

// Limiti: generosi sui campi di ragionamento (e' li' che sta il valore) e
// stretti sul titolo, che deve restare leggibile in lista.
const MAX_TITOLO = 140;
const MAX_TESTO = 4000;

const pulisci = (v, max = MAX_TESTO) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

// Data valida = "YYYY-MM-DD". Tutto il resto (stringhe vuote, formati
// locali, undefined) diventa stringa vuota invece di finire nello storico
// come data fantasma che poi rompe i confronti.
const pulisciData = (v) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : "";

const pulisciFiducia = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, n));
};

const AMBITI = ["business", "personale"];
const RIFARESTI = ["si", "no", "in-parte"];

const readDoc = (opts) => leggiJson(PAGE_ID, MARCATORE, opts);
const writeDoc = (lista) => scriviJson(PAGE_ID, INTESTAZIONE, MARCATORE, lista);

// Ordinamento: le piu' recenti prima. A parita' di data (piu' decisioni
// prese lo stesso giorno) decide il timestamp di creazione.
const ordina = (lista) =>
  [...lista].sort((a, b) => (a.data === b.data ? (b.ts || 0) - (a.ts || 0) : (a.data < b.data ? 1 : -1)));

// Una decisione e' "da rivedere" se la data di revisione e' arrivata (o
// passata) e la revisione non e' ancora stata scritta. Le decisioni senza
// data di revisione non entrano mai qui: sono legittime (non tutto merita
// un follow-up), semplicemente non generano promemoria.
export function daRivedere(d, oggi = bucharestDate(0)) {
  return Boolean(d && d.dataRevisione && !d.revisione && d.dataRevisione <= oggi);
}

// Una decisione e' modificabile solo entro 24 ore dalla creazione.
//
// La finestra esiste per i refusi e i ripensamenti di scrittura, non per
// riscrivere la storia: dopo un giorno quello che hai scritto e' la
// fotografia di cosa sapevi in quel momento, ed e' l'unica cosa che rende
// il confronto con la revisione onesto. Se questa regola ti da' fastidio in
// futuro, e' il segno che sta funzionando.
const FINESTRA_MODIFICA_MS = 24 * 60 * 60 * 1000;
export function modificabile(d) {
  return Boolean(d && d.ts && Date.now() - d.ts < FINESTRA_MODIFICA_MS);
}

// Normalizza una decisione in arrivo dal client.
function normalizzaDecisione(body, prev = {}) {
  return {
    titolo:       pulisci(body.titolo !== undefined ? body.titolo : prev.titolo, MAX_TITOLO),
    contesto:     pulisci(body.contesto !== undefined ? body.contesto : prev.contesto),
    obiettivo:    pulisci(body.obiettivo !== undefined ? body.obiettivo : prev.obiettivo),
    alternative:  pulisci(body.alternative !== undefined ? body.alternative : prev.alternative),
    decisione:    pulisci(body.decisione !== undefined ? body.decisione : prev.decisione),
    motivazione:  pulisci(body.motivazione !== undefined ? body.motivazione : prev.motivazione),
    fiducia:      pulisciFiducia(body.fiducia !== undefined ? body.fiducia : prev.fiducia),
    rischi:       pulisci(body.rischi !== undefined ? body.rischi : prev.rischi),
    ambito:       AMBITI.includes(body.ambito) ? body.ambito : (prev.ambito || "business"),
    data:         pulisciData(body.data) || prev.data || bucharestDate(0),
    dataRevisione: body.dataRevisione !== undefined
      ? pulisciData(body.dataRevisione)
      : (prev.dataRevisione || ""),
  };
}

function normalizzaRevisione(body) {
  return {
    data:          bucharestDate(0),
    rifaresti:     RIFARESTI.includes(body.rifaresti) ? body.rifaresti : "in-parte",
    previsto:      pulisci(body.previsto),
    sottovalutato: pulisci(body.sottovalutato),
    risultato:     pulisci(body.risultato),
    imparato:      pulisci(body.imparato),
    diverso:       pulisci(body.diverso),
    ts:            Date.now(),
  };
}

// Payload per il client. I conteggi li fa il server: se li facesse il
// client dovrebbe ricalcolare "oggi" nel fuso di Bucarest, e quel calcolo
// duplicato lato browser ha gia' prodotto bug sulle date a fine luglio.
export async function datiDecisioni() {
  const lista = ordina(await readDoc());
  const oggi = bucharestDate(0);
  return {
    oggi,
    decisioni: lista.map((d) => ({
      ...d,
      daRivedere: daRivedere(d, oggi),
      modificabile: modificabile(d),
    })),
    daRivedere: lista.filter((d) => daRivedere(d, oggi)).length,
    inAttesa: lista.filter((d) => d.dataRevisione && !d.revisione && d.dataRevisione > oggi).length,
    riviste: lista.filter((d) => d.revisione).length,
    totali: lista.length,
  };
}

// Versione minima per il banner in home: evita di far viaggiare tutto lo
// storico ad ogni apertura dell'app solo per accendere un pallino.
export async function conteggioDaRivedere() {
  const lista = await readDoc();
  const oggi = bucharestDate(0);
  return { daRivedere: lista.filter((d) => daRivedere(d, oggi)).length, oggi };
}

export async function creaDecisione(body) {
  const base = normalizzaDecisione(body);
  // Titolo e decisione sono gli unici due campi obbligatori. Il resto puo'
  // restare vuoto: meglio una decisione registrata a meta' che una non
  // registrata perche' non avevi voglia di riempire dieci caselle.
  if (!base.titolo) return { ok: false, status: 400, errore: "Il titolo è obbligatorio." };
  if (!base.decisione) return { ok: false, status: 400, errore: "Devi scrivere la decisione presa." };

  const lista = await readDoc({ forza: true });
  const entry = {
    id: `d_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    ...base,
    revisione: null,
    ts: Date.now(),
  };
  lista.push(entry);
  await writeDoc(ordina(lista));
  return { ok: true, decisione: entry };
}

export async function aggiornaDecisione(id, body) {
  const lista = await readDoc({ forza: true });
  const idx = lista.findIndex((d) => d.id === id);
  if (idx < 0) return { ok: false, status: 404, errore: "Decisione non trovata." };
  if (!modificabile(lista[idx])) {
    return {
      ok: false,
      status: 409,
      congelata: true,
      errore: "Questa decisione è stata scritta più di 24 ore fa e non si modifica più. È il punto del registro: quello che avevi scritto allora deve restare com'era.",
    };
  }
  const entry = { ...lista[idx], ...normalizzaDecisione(body, lista[idx]) };
  if (!entry.titolo) return { ok: false, status: 400, errore: "Il titolo è obbligatorio." };
  lista[idx] = entry;
  await writeDoc(ordina(lista));
  return { ok: true, decisione: entry };
}

// La revisione si puo' scrivere in qualsiasi momento, anche prima della
// data prevista (una decisione puo' rivelarsi sbagliata molto prima del
// previsto, e in quel caso vuoi annotarlo a caldo). Si puo' anche
// riscrivere: a differenza della decisione, la revisione guarda a un
// passato gia' noto, quindi correggerla non falsifica nulla.
export async function salvaRevisione(id, body) {
  const lista = await readDoc({ forza: true });
  const idx = lista.findIndex((d) => d.id === id);
  if (idx < 0) return { ok: false, status: 404, errore: "Decisione non trovata." };

  const revisione = normalizzaRevisione(body);
  if (!revisione.risultato && !revisione.imparato) {
    return { ok: false, status: 400, errore: "Scrivi almeno il risultato o cosa hai imparato." };
  }
  lista[idx] = { ...lista[idx], revisione };
  await writeDoc(ordina(lista));
  return { ok: true, decisione: lista[idx] };
}

// Rimanda la revisione di N giorni. Serve per il caso concreto: arriva la
// data, ma l'esito non e' ancora leggibile (il cliente non ha ancora
// risposto, il trimestre non e' chiuso). L'alternativa sarebbe compilare
// una revisione vuota per far sparire il banner, che e' il modo piu' rapido
// per rendere inutile tutto il registro.
export async function rimandaRevisione(id, giorni = 30) {
  const n = Math.min(365, Math.max(1, Math.round(Number(giorni)) || 30));
  const lista = await readDoc({ forza: true });
  const idx = lista.findIndex((d) => d.id === id);
  if (idx < 0) return { ok: false, status: 404, errore: "Decisione non trovata." };
  const partenza = lista[idx].dataRevisione && lista[idx].dataRevisione > bucharestDate(0)
    ? lista[idx].dataRevisione
    : bucharestDate(0);
  const nuova = new Date(`${partenza}T12:00:00Z`);
  nuova.setUTCDate(nuova.getUTCDate() + n);
  lista[idx] = { ...lista[idx], dataRevisione: nuova.toISOString().slice(0, 10) };
  await writeDoc(ordina(lista));
  return { ok: true, decisione: lista[idx] };
}

export async function eliminaDecisione(id) {
  const lista = await readDoc({ forza: true });
  const idx = lista.findIndex((d) => d.id === id);
  if (idx < 0) return { ok: false, status: 404, errore: "Decisione non trovata." };
  lista.splice(idx, 1);
  try {
    await writeDoc(ordina(lista));
  } catch (e) {
    invalidaPagina(PAGE_ID);
    throw e;
  }
  return { ok: true };
}
