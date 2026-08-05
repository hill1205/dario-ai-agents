// Festivita' nazionali italiane, per colorare di rosso i giorni non
// lavorativi nella griglia Abitudini (e ovunque servira' in futuro).
//
// Solo le 12 nazionali: i patroni sono locali (Milano 7/12, Roma 29/6...) e
// dipendono da dove sei, quindi non hanno senso in automatico.

// Pasqua gregoriana — algoritmo di Meeus/Jones/Butcher. Serve perche' due
// festivita' su dodici sono mobili: la domenica di Pasqua cade comunque di
// domenica (gia' rossa), ma il Lunedi' dell'Angelo no.
export function pasqua(anno) {
  const a = anno % 19;
  const b = Math.floor(anno / 100);
  const c = anno % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31);   // 3=marzo, 4=aprile
  const giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(anno, mese - 1, giorno);
}

const FISSE = {
  "01-01": "Capodanno",
  "01-06": "Epifania",
  "04-25": "Festa della Liberazione",
  "05-01": "Festa del Lavoro",
  "06-02": "Festa della Repubblica",
  "08-15": "Ferragosto",
  "11-01": "Ognissanti",
  "12-08": "Immacolata Concezione",
  "12-25": "Natale",
  "12-26": "Santo Stefano",
};

const pad = (n) => String(n).padStart(2, "0");

// Mappa "YYYY-MM-DD" -> nome della festa, per l'anno richiesto.
// Cache perche' la griglia la interroga 31 volte per render.
const cache = new Map();
export function festivitaItaliane(anno) {
  if (cache.has(anno)) return cache.get(anno);
  const map = new Map();
  for (const [md, nome] of Object.entries(FISSE)) map.set(`${anno}-${md}`, nome);

  const p = pasqua(anno);
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  map.set(key(p), "Pasqua");
  const pasquetta = new Date(p.getFullYear(), p.getMonth(), p.getDate() + 1);
  map.set(key(pasquetta), "Lunedì dell'Angelo");

  cache.set(anno, map);
  return map;
}

// data in formato "YYYY-MM-DD" -> nome della festa, oppure null.
export function nomeFestivita(data) {
  const anno = Number(data.slice(0, 4));
  if (!anno) return null;
  return festivitaItaliane(anno).get(data) || null;
}
