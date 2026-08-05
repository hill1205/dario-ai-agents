export const dynamic = "force-dynamic";
export const revalidate = 0;

import { bucharestDate } from "../../lib/habits-store";

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const WORKSPACE_ID = "90121769473";
// Doc "Storico Abitudini e Mood (dashboard)" — pagina Mood.
const DOC_ID = "2kxuu4g1-972";
const PAGE_ID = "2kxuu4g1-1392";

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

const CAMPI = ["umore", "energia", "motivazione"];
export const FASCE = ["mattina", "pomeriggio"];

// Confine tra le due fasce, ora di Bucarest. Prima delle 16 si scrive nel
// check mattutino, dalle 16 in poi in quello pomeridiano.
const ORA_POMERIGGIO = 16;

// Finestra di ripensamento dopo il primo click. Il valore e' pensato per
// restare immutabile — e' il punto del tracking, altrimenti a fine giornata
// si riscrive la storia — ma senza una via d'uscita un tap sbagliato
// resterebbe inchiodato per sempre. Un minuto copre il dito storto e non
// copre il senno di poi.
const FINESTRA_CORREZIONE_MS = 60 * 1000;

export function fasciaCorrente(ora = oraBucharest()) {
  return ora < ORA_POMERIGGIO ? "mattina" : "pomeriggio";
}

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

async function readDoc() {
  if (!CLICKUP_API_KEY) throw new Error("CLICKUP_API_KEY non configurata");
  const res = await fetch(
    `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${PAGE_ID}?content_format=text/plain`,
    { headers: { Authorization: CLICKUP_API_KEY }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`ClickUp doc error: ${res.status}`);
  const data = await res.json();
  const match = (data.content || "").match(/MOOD_DATA_JSON:([\s\S]*)/);
  if (!match) return [];
  try { return JSON.parse(match[1].trim()); }
  catch { throw new Error("Formato dati mood non riconosciuto (JSON malformato nel Doc)"); }
}

async function writeDoc(days) {
  const content = `STORICO MOOD DARIO\n\nNon modificare a mano: viene letto/scritto dalla dashboard.\nDue rilevazioni al giorno: { data, mattina:{umore,energia,motivazione,ts}, pomeriggio:{...}, nota }.\nLe voci senza fascia sono precedenti al 05/08/2026 e contano come rilevazione singola.\nScala 1-5.\n\nMOOD_DATA_JSON:${JSON.stringify(days)}`;
  const res = await fetch(
    `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/docs/${DOC_ID}/pages/${PAGE_ID}`,
    {
      method: "PUT",
      headers: { Authorization: CLICKUP_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }
  );
  if (!res.ok) throw new Error(`ClickUp doc write error: ${res.status}`);
}

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

export async function GET() {
  try {
    const days = (await readDoc()).sort((a, b) => (a.data < b.data ? -1 : 1));
    // La media la calcola il server: e' l'unico posto dove sappiamo come
    // trattare le voci in formato vecchio, e non va duplicata nel client.
    const conMedia = days.map(d => ({ ...d, media: mediaMood(d) }));
    return Response.json({
      days: conMedia,
      oggi: bucharestDate(0),
      fascia: fasciaCorrente(),
      oraPomeriggio: ORA_POMERIGGIO,
      finestraCorrezioneMs: FINESTRA_CORREZIONE_MS,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const day = body.data || bucharestDate(0);
    const days = await readDoc();
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
          return Response.json({
            error: `${c} del check di ${fascia} è già registrato e non si può più cambiare.`,
            bloccato: true,
            fascia,
          }, { status: 409 });
        }
        attuale[c] = v;
      }
      attuale.ts = ora;
      next[fascia] = attuale;
    }

    if (idx >= 0) days[idx] = next;
    else days.push(next);

    const sorted = days.sort((a, b) => (a.data < b.data ? -1 : 1));
    await writeDoc(sorted);
    return Response.json({
      success: true,
      giorno: { ...next, media: mediaMood(next) },
      fascia: fasciaCorrente(),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
