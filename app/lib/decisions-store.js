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
//   2. Alle date di revisione rispondi a sei domande fisse, CONFRONTANDOTI
//      con quello che avevi scritto allora.
//
// Il valore sta nel fatto che il passo 1 e' congelato. Se potessi
// modificare contesto/fiducia/rischi dopo aver visto com'e' andata, il
// registro diventerebbe un raccoglitore di razionalizzazioni ("lo sapevo").
// Da qui la regola sulle modifiche piu' sotto.
//
// FINO A TRE REVISIONI, CON FOCUS DICHIARATO (07/08)
// Le revisioni sono tre, la prima obbligatoria e le altre due facoltative,
// perche' non tutte le decisioni maturano allo stesso ritmo. "Comprare la
// macchina" si giudica una volta e basta. "Iscrivermi in palestra" no: a un
// mese sai solo se hai continuato, a sei mesi vedi il corpo, a un anno sai
// se e' servito davvero — e sono tre domande diverse, non la stessa fatta
// tre volte.
//
// Da qui il campo "focus" su ogni data: cosa vuoi verificare a quella
// scadenza, scritto quando fissi la data e non quando arriva. Serve a due
// cose: ti obbliga a pensare adesso a che segnale stai aspettando, e al
// momento della revisione ti rimette davanti la domanda giusta invece di
// lasciarti improvvisare.
//
// FORMA DI UNA DECISIONE
//   {
//     id, data, titolo, contesto, obiettivo, alternative,
//     decisione, motivazione, fiducia (1-10), rischi,
//     ambito ("business"|"personale"), ts,
//     revisioni: [                       // 1..3, ordinate per data
//       {
//         data: "YYYY-MM-DD",
//         focus: "cosa voglio verificare qui",
//         esito: null | {
//           data, rifaresti ("si"|"no"|"in-parte"),
//           previsto, sottovalutato, risultato, imparato, diverso, ts
//         }
//       }
//     ]
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
  "e fino a tre revisioni, ognuna con la sua data e con il focus che le avevi",
  "dato. La prima parte si congela dopo 24 ore di proposito — un registro",
  "riscrivibile a posteriori non misura come decidi, misura come ti racconti",
  "le cose.",
].join("\n");

export { bucharestDate };

export const MAX_REVISIONI = 3;

// Limiti: generosi sui campi di ragionamento (e' li' che sta il valore) e
// stretti su titolo e focus, che devono restare leggibili in lista.
const MAX_TITOLO = 140;
const MAX_FOCUS = 200;
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

// ── Migrazione dal formato a revisione singola ──────────────────────────
//
// La prima versione (mattina del 07/08) aveva dataRevisione + revisione al
// singolare. La conversione avviene in lettura e non con uno script una
// tantum: cosi' una decisione scritta con la versione vecchia continua a
// funzionare anche se il Doc non e' mai stato riscritto, e non esiste un
// momento in cui il deploy nuovo legge dati che non capisce.
function migra(d) {
  if (Array.isArray(d.revisioni)) return d;
  const revisioni = [];
  if (d.dataRevisione || d.revisione) {
    revisioni.push({
      data: pulisciData(d.dataRevisione) || (d.revisione?.data ?? ""),
      focus: "",
      esito: d.revisione || null,
    });
  }
  const { dataRevisione, revisione, ...resto } = d;
  return { ...resto, revisioni };
}

// ── Revisioni ───────────────────────────────────────────────────────────

function normalizzaRevisioni(inRevisioni, prev = []) {
  const grezze = Array.isArray(inRevisioni) ? inRevisioni : prev;
  const out = [];
  for (let i = 0; i < MAX_REVISIONI && i < grezze.length; i++) {
    const r = grezze[i] || {};
    const data = pulisciData(r.data);
    // Una revisione senza data non esiste: e' il campo che la fa scattare.
    // Il focus da solo non basta a tenerla in vita.
    if (!data) continue;
    out.push({
      data,
      focus: pulisci(r.focus, MAX_FOCUS),
      // L'esito non arriva mai dal form della decisione: si scrive solo
      // dall'azione "revisione". Lo si recupera da prev accoppiando per
      // data, cosi' correggere una data entro le 24 ore non cancella una
      // revisione gia' compilata.
      esito: (prev.find((p) => p.data === data) || {}).esito || null,
    });
  }
  // Ordinate per data: "prima/seconda/terza revisione" deve corrispondere
  // all'ordine cronologico anche se le hai inserite in disordine nel form.
  return out.sort((a, b) => (a.data < b.data ? -1 : 1));
}

// Una revisione e' "da fare" se la sua data e' arrivata (o passata) e non
// e' ancora stata compilata.
export function revisioneDaFare(r, oggi = bucharestDate(0)) {
  return Boolean(r && r.data && !r.esito && r.data <= oggi);
}

// Quante revisioni di questa decisione stanno aspettando. Il conteggio e'
// sulle REVISIONI e non sulle decisioni: se hai saltato quella di un mese
// e nel frattempo e' arrivata quella di sei mesi, sono due cose da fare,
// e un banner che ne segnala una sola ti farebbe perdere la prima.
export function revisioniDaFare(d, oggi = bucharestDate(0)) {
  return (d.revisioni || []).filter((r) => revisioneDaFare(r, oggi)).length;
}

export function daRivedere(d, oggi = bucharestDate(0)) {
  return revisioniDaFare(d, oggi) > 0;
}

// La prossima revisione non ancora compilata, scaduta o futura che sia.
// Serve alla card per dire "revisione fra 12 giorni" senza che il client
// debba scorrere l'array e rifare i confronti sulle date.
export function prossimaRevisione(d) {
  return (d.revisioni || []).find((r) => !r.esito) || null;
}

// Una decisione e' modificabile solo entro 24 ore dalla creazione.
//
// La finestra esiste per i refusi e i ripensamenti di scrittura, non per
// riscrivere la storia: dopo un giorno quello che hai scritto e' la
// fotografia di cosa sapevi in quel momento, ed e' l'unica cosa che rende
// il confronto con le revisioni onesto. Se questa regola ti da' fastidio
// in futuro, e' il segno che sta funzionando.
const FINESTRA_MODIFICA_MS = 24 * 60 * 60 * 1000;
export function modificabile(d) {
  return Boolean(d && d.ts && Date.now() - d.ts < FINESTRA_MODIFICA_MS);
}

// Ordinamento: le piu' recenti prima. A parita' di data (piu' decisioni
// prese lo stesso giorno) decide il timestamp di creazione.
const ordina = (lista) =>
  [...lista].sort((a, b) => (a.data === b.data ? (b.ts || 0) - (a.ts || 0) : (a.data < b.data ? 1 : -1)));

// ── Normalizzazione ─────────────────────────────────────────────────────

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
    revisioni:    normalizzaRevisioni(body.revisioni, prev.revisioni || []),
  };
}

function normalizzaEsito(body) {
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

// ── Lettura ─────────────────────────────────────────────────────────────

// Payload per il client. I conteggi li fa il server: se li facesse il
// client dovrebbe ricalcolare "oggi" nel fuso di Bucarest, e quel calcolo
// duplicato lato browser ha gia' prodotto bug sulle date a fine luglio.
export async function datiDecisioni() {
  const lista = ordina((await readDoc()).map(migra));
  const oggi = bucharestDate(0);
  return {
    oggi,
    decisioni: lista.map((d) => ({
      ...d,
      daRivedere: daRivedere(d, oggi),
      revisioniDaFare: revisioniDaFare(d, oggi),
      modificabile: modificabile(d),
    })),
    // Numero di REVISIONI in scadenza, non di decisioni: e' quello che dice
    // davvero quante cose hai da scrivere.
    daRivedere: lista.reduce((n, d) => n + revisioniDaFare(d, oggi), 0),
    inAttesa: lista.reduce(
      (n, d) => n + (d.revisioni || []).filter((r) => !r.esito && r.data > oggi).length, 0),
    riviste: lista.filter((d) => (d.revisioni || []).some((r) => r.esito)).length,
    chiuse: lista.filter(
      (d) => (d.revisioni || []).length > 0 && (d.revisioni || []).every((r) => r.esito)).length,
    totali: lista.length,
  };
}

// Versione minima per il banner in home: evita di far viaggiare tutto lo
// storico ad ogni apertura dell'app solo per accendere un pallino.
export async function conteggioDaRivedere() {
  const lista = (await readDoc()).map(migra);
  const oggi = bucharestDate(0);
  return {
    daRivedere: lista.reduce((n, d) => n + revisioniDaFare(d, oggi), 0),
    decisioniDaRivedere: lista.filter((d) => daRivedere(d, oggi)).length,
    oggi,
  };
}

// ── Scrittura ───────────────────────────────────────────────────────────

export async function creaDecisione(body) {
  const base = normalizzaDecisione(body);
  // Titolo, decisione e prima data di revisione sono gli unici campi
  // obbligatori. Il resto puo' restare vuoto: meglio una decisione
  // registrata a meta' che una non registrata perche' non avevi voglia di
  // riempire dieci caselle.
  //
  // La data di revisione e' obbligatoria e gli altri campi di ragionamento
  // no perche' e' l'unica che rende la voce viva: senza, questa pagina
  // torna a essere l'archivio Idee — pieno di roba che nessuno riapre.
  if (!base.titolo) return { ok: false, status: 400, errore: "Il titolo è obbligatorio." };
  if (!base.decisione) return { ok: false, status: 400, errore: "Devi scrivere la decisione presa." };
  if (base.revisioni.length === 0) {
    return { ok: false, status: 400, errore: "Serve almeno la prima data di revisione: senza, questa decisione non tornerà mai a chiederti conto di sé." };
  }

  const lista = (await readDoc({ forza: true })).map(migra);
  const entry = {
    id: `d_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    ...base,
    ts: Date.now(),
  };
  lista.push(entry);
  await writeDoc(ordina(lista));
  return { ok: true, decisione: entry };
}

export async function aggiornaDecisione(id, body) {
  const lista = (await readDoc({ forza: true })).map(migra);
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
  if (entry.revisioni.length === 0) {
    return { ok: false, status: 400, errore: "Serve almeno la prima data di revisione." };
  }
  lista[idx] = entry;
  await writeDoc(ordina(lista));
  return { ok: true, decisione: entry };
}

// Compila (o riscrive) l'esito di UNA revisione, identificata dal suo
// indice nell'array.
//
// Si puo' scrivere in qualsiasi momento, anche prima della data prevista:
// una decisione puo' rivelarsi sbagliata molto prima del previsto, e in
// quel caso vuoi annotarlo a caldo. Si puo' anche riscrivere — a differenza
// della decisione, la revisione guarda a un passato gia' noto, quindi
// correggerla non falsifica nulla.
export async function salvaRevisione(id, indice, body) {
  const lista = (await readDoc({ forza: true })).map(migra);
  const idx = lista.findIndex((d) => d.id === id);
  if (idx < 0) return { ok: false, status: 404, errore: "Decisione non trovata." };

  const revisioni = [...(lista[idx].revisioni || [])];
  // Come in rimandaRevisione: se il client manda la data, quella vince
  // sull'indice, che dopo un riordino puo' puntare alla revisione sbagliata.
  const perData = body?.dataRevisione
    ? revisioni.findIndex((r) => r.data === body.dataRevisione)
    : -1;
  const i = perData >= 0 ? perData : Number(indice);
  if (!Number.isInteger(i) || i < 0 || i >= revisioni.length) {
    return { ok: false, status: 400, errore: "Revisione non trovata." };
  }

  const esito = normalizzaEsito(body);
  if (!esito.risultato && !esito.imparato) {
    return { ok: false, status: 400, errore: "Scrivi almeno il risultato o cosa hai imparato." };
  }
  revisioni[i] = { ...revisioni[i], esito };
  lista[idx] = { ...lista[idx], revisioni };
  await writeDoc(ordina(lista));
  return { ok: true, decisione: lista[idx] };
}

// Rimanda UNA revisione di N giorni. Serve per il caso concreto: arriva la
// data, ma l'esito non e' ancora leggibile (il cliente non ha ancora
// risposto, il trimestre non e' chiuso). L'alternativa sarebbe compilare
// una revisione vuota per far sparire il banner, che e' il modo piu' rapido
// per rendere inutile tutto il registro.
// `dataRevisione` (opzionale) identifica la revisione per data invece che per
// posizione. Serve perche' questa funzione RIORDINA l'array subito dopo aver
// cambiato la data: rimandando la prima di sei mesi puo' finire dopo la
// seconda, e l'indice che il client ha in mano diventa sbagliato all'istante.
// Due "rimanda" di fila senza ricaricare colpivano la revisione sbagliata.
// La data e' l'identificatore stabile; l'indice resta accettato come ripiego
// per non rompere una scheda aperta da prima del deploy.
export async function rimandaRevisione(id, indice, giorni = 30, dataRevisione = null) {
  const n = Math.min(365, Math.max(1, Math.round(Number(giorni)) || 30));
  const lista = (await readDoc({ forza: true })).map(migra);
  const idx = lista.findIndex((d) => d.id === id);
  if (idx < 0) return { ok: false, status: 404, errore: "Decisione non trovata." };

  const revisioni = [...(lista[idx].revisioni || [])];
  const perData = dataRevisione ? revisioni.findIndex((r) => r.data === dataRevisione) : -1;
  const i = perData >= 0 ? perData : Number(indice);
  if (!Number.isInteger(i) || i < 0 || i >= revisioni.length) {
    return { ok: false, status: 400, errore: "Revisione non trovata." };
  }

  const oggi = bucharestDate(0);
  const partenza = revisioni[i].data > oggi ? revisioni[i].data : oggi;
  const nuova = new Date(`${partenza}T12:00:00Z`);
  nuova.setUTCDate(nuova.getUTCDate() + n);
  revisioni[i] = { ...revisioni[i], data: nuova.toISOString().slice(0, 10) };

  // Riordina: rimandando la prima di sei mesi potrebbe finire dopo la
  // seconda, e "prima/seconda/terza" deve continuare a voler dire
  // qualcosa in ordine di tempo.
  revisioni.sort((a, b) => (a.data < b.data ? -1 : 1));
  lista[idx] = { ...lista[idx], revisioni };
  await writeDoc(ordina(lista));
  return { ok: true, decisione: lista[idx] };
}

export async function eliminaDecisione(id) {
  const lista = (await readDoc({ forza: true })).map(migra);
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
