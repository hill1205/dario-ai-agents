// Storico mood sul Doc ClickUp + regole di scrittura.
//
// Spostato qui dalla route il 2026-08-05: serviva anche a
// /api/abitudini-tutto, e importare da un file di route per riusarne una
// funzione e' il tipo di scorciatoia che poi si paga. Le regole (fasce,
// immutabilita', media) non cambiano di una virgola rispetto a prima.
//
// Dal 05/08/2026 il mood si rileva DUE volte al giorno, non una.
// Ogni voce e':
//   { data:"YYYY-MM-DD",
//     mattina:    { umore, energia, motivazione, ts },
//     pomeriggio: { umore, energia, motivazione, ts },
//     nota:"..." }
//
// Perche' due rilevazioni: un solo numero al giorno costringe a fare una
// media a mente ("stamattina benissimo, poi la call andata male") e finisce
// per registrare l'ultimo stato d'animo invece della giornata. Due check
// separati raccontano anche la DIREZIONE, che e' il dato interessante.
//
// Scala 1-5 e non 1-10: con dieci livelli la differenza tra 6 e 7 e' rumore.
//
// Retrocompatibilita': le voci vecchie hanno umore/energia/motivazione
// direttamente nella radice, senza fascia. Non le tocchiamo e non le
// spacciamo per mattutine (non sappiamo a che ora furono inserite): contano
// come rilevazione singola nel calcolo della media.

import { leggiJson, scriviJson, PAGINE } from "./clickup-doc";
import { bucharestDate } from "./habits-store";

const PAGE_ID = PAGINE.mood;
const MARCATORE = "MOOD_DATA_JSON";
const INTESTAZIONE = "STORICO MOOD DARIO\n\nNon modificare a mano: viene letto/scritto dalla dashboard.\nDue rilevazioni al giorno: { data, mattina:{umore,energia,motivazione,ts}, pomeriggio:{...}, nota }.\nLe voci senza fascia sono precedenti al 05/08/2026 e contano come rilevazione singola.\nScala 1-5.";

export const CAMPI = ["umore", "energia", "motivazione"];
export const FASCE = ["mattina", "pomeriggio"];

// Confine tra le due fasce, ora di Bucarest. Prima delle 16 si scrive nel
// check mattutino, dalle 16 in poi in quello pomeridiano.
export const ORA_POMERIGGIO = 16;

// Finestra di ripensamento dopo il primo click. Il valore e' pensato per
// restare immutabile — e' il punto del tracking, altrimenti a fine giornata
// si riscrive la storia — ma senza una via d'uscita un tap sbagliato
// resterebbe inchiodato per sempre. Un minuto copre il dito storto e non
// copre il senno di poi.
export const FINESTRA_CORREZIONE_MS = 60 * 1000;

function oraBucharest() {
  // hourCycle h23 e non hour12:false: con quest'ultimo alcuni runtime
  // restituiscono "24" a mezzanotte invece di "00".
  const s = new Date().toLocaleString("en-GB", {
    timeZone: "Europe/Bucharest",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const n = Number(s.slice(0, 2));
  return Number.isFinite(n) ? n % 24 : 0;
}

export function fasciaCorrente(ora = oraBucharest()) {
  return ora < ORA_POMERIGGIO ? "mattina" : "pomeriggio";
}

export const readMood = (opts) => leggiJson(PAGE_ID, MARCATORE, opts);
export const writeMood = (days) => scriviJson(PAGE_ID, INTESTAZIONE, MARCATORE, days);

const clamp = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(5, Math.max(1, Math.round(n)));
};

// Le rilevazioni presenti in una voce, incluse quelle in formato vecchio.
function rilevazioni(voce) {
  if (!voce) return [];
  const out = [];
  for (const f of FASCE) if (voce[f]) out.push(voce[f]);
  // Formato pre-05/08/2026: valori nella radice.
  if (CAMPI.some(c => voce[c] !== undefined && voce[c] !== null)) out.push(voce);
  return out;
}

// Media per campo sulle rilevazioni disponibili. Con un solo check compilato
// la "media" e' quel check: meglio un dato parziale dichiarato che un buco.
export function mediaMood(voce) {
  const rs = rilevazioni(voce);
  if (rs.length === 0) return null;
  const out = {};
  for (const c of CAMPI) {
    const vals = rs.map(r => r[c]).filter(v => typeof v === "number");
    out[c] = vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null;
  }
  out.nRilevazioni = rs.length;
  return out;
}

// Payload completo per il client. Sta qui e non nella route perche' lo
// usano in due: /api/mood e /api/abitudini-tutto.
export async function datiMood() {
  const days = (await readMood()).sort((a, b) => (a.data < b.data ? -1 : 1));
  // La media la calcola il server: e' l'unico posto dove sappiamo come
  // trattare le voci in formato vecchio, e non va duplicata nel client.
  return {
    days: days.map(d => ({ ...d, media: mediaMood(d) })),
    oggi: bucharestDate(0),
    fascia: fasciaCorrente(),
    oraPomeriggio: ORA_POMERIGGIO,
    finestraCorrezioneMs: FINESTRA_CORREZIONE_MS,
  };
}

// Scrive nota e/o valori del giorno. Restituisce { ok, ... } invece di una
// Response: la route decide lo status, il modulo decide le regole.
export async function salvaMood(body) {
  const day = body.data || bucharestDate(0);
  const days = await readMood({ forza: true });
  const idx = days.findIndex((d) => d.data === day);
  const prev = idx >= 0 ? days[idx] : { data: day };
  const next = { ...prev, data: day };

  // --- Nota: sempre modificabile ---------------------------------------
  // Non e' una misura, e' un promemoria: bloccarla servirebbe solo a
  // impedirti di aggiungere un dettaglio che ti torna in mente dopo.
  if (body.nota !== undefined) {
    next.nota = String(body.nota).slice(0, 2000);
  }

  // --- Valori: si scrivono solo nella fascia corrente -------------------
  const daScrivere = CAMPI.filter(c => body[c] !== undefined && body[c] !== null);
  if (daScrivere.length > 0) {
    const fascia = fasciaCorrente();
    const ora = Date.now();
    const attuale = next[fascia] ? { ...next[fascia] } : {};

    for (const c of daScrivere) {
      const v = clamp(body[c]);
      if (v === null) continue;
      const giaScritto = typeof attuale[c] === "number";
      const dentroFinestra = attuale.ts && (ora - attuale.ts) < FINESTRA_CORREZIONE_MS;
      // Rifiuto esplicito invece di ignorare in silenzio: se il client
      // crede di aver salvato e il server ha scartato, la dashboard
      // mostrerebbe un valore che non esiste nello storico.
      if (giaScritto && !dentroFinestra) {
        return {
          ok: false,
          status: 409,
          errore: `${c} del check di ${fascia} è già registrato e non si può più cambiare.`,
          bloccato: true,
          fascia,
        };
      }
      attuale[c] = v;
    }
    attuale.ts = ora;
    next[fascia] = attuale;
  }

  if (idx >= 0) days[idx] = next;
  else days.push(next);

  await writeMood(days.sort((a, b) => (a.data < b.data ? -1 : 1)));
  return { ok: true, giorno: { ...next, media: mediaMood(next) }, fascia: fasciaCorrente() };
}
