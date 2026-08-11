"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { genId, fmt, getMonthLabel, getCurrentMonth, localISODate, MESI_BREVI } from "../lib/finance-ui";

// ---------------------------------------------------------------------------
// PIANO TASSE — proiezione di cassa su un debito rateizzato.
//
// Nasce dal caso reale delle tasse italiane 2025 (12.000€, 5 rate ago→dic
// 2026), ma è volutamente generico: serve anche per le tasse rumene di
// IAGREX o per qualsiasi altro debito a rate.
//
// La domanda a cui risponde è UNA: "se pago queste rate, con quanti soldi
// resto sul conto mese per mese, e in quale mese vado in difficoltà?"
//
// Tre ingredienti:
//   1. il piano rateale (importo, n° rate, prima scadenza, cadenza, interessi)
//   2. il saldo di partenza + il burn mensile (quanto bruci al netto di tutto)
//   3. le entrate straordinarie previste (dividendi, incassi, rimborsi)
//
// Il saldo di partenza può essere letto automaticamente dai saldi reali
// dell'app (patrimonio personale da /api/bruno-finance, oppure IAGREX dai
// dati già caricati in pagina) così non lo si riscrive a mano ogni volta.
// ---------------------------------------------------------------------------

const CONTI_PERSONALI = [
  { id: "bdm",            label: "BdM Banca",          currency: "€" },
  { id: "trade_republic", label: "Trade Republic",     currency: "€" },
  { id: "revolut_eur",    label: "Revolut — EUR",      currency: "€" },
  { id: "revolut_ron",    label: "Revolut — RON",      currency: "RON" },
  { id: "postepay",       label: "PostePay Evolution", currency: "€" },
  { id: "hype",           label: "HYPE / Banca Sella", currency: "€" },
  { id: "unicredit_ron",  label: "UniCredit Romania",  currency: "RON" },
];
const CONTI_IAGREX = [
  { id: "unicredit_eur", label: "UniCredit Romania — EUR", currency: "€" },
  { id: "unicredit_ron", label: "UniCredit Romania — RON", currency: "RON" },
];

const PIANO_VUOTO = () => ({
  id: genId(),
  nome: "",
  importoTotale: "",
  numeroRate: 5,
  primaRata: localISODate(),
  cadenza: "mensile",
  tassoAnnuo: 4,
  fonte: "personale",
  contoAddebito: "",
  saldoInizialeManuale: "",
  usaSaldoAuto: true,
  burnMensile: "",
  extra: [],
  note: "",
  creato: new Date().toISOString(),
  archiviato: false,
});

// --- motore di calcolo ------------------------------------------------------

// Interessi col metodo commerciale usato dall'Agenzia delle Entrate: la prima
// rata non porta interessi, ogni rata successiva ne accumula tassoAnnuo/12 per
// ogni mese di distanza dalla prima (0,33%/mese con il 4% annuo).
export function generaRate(piano) {
  const totale = parseFloat(piano.importoTotale) || 0;
  const n = Math.max(1, parseInt(piano.numeroRate) || 1);
  const passo = piano.cadenza === "trimestrale" ? 3 : 1;
  const tassoMese = ((parseFloat(piano.tassoAnnuo) || 0) / 12) / 100;
  const quota = totale / n;
  const [y, m, d] = (piano.primaRata || localISODate()).split("-").map(Number);
  const rate = [];
  for (let i = 0; i < n; i++) {
    const dt = new Date(y, (m - 1) + i * passo, d);
    const ym = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    const mesiDistanza = i * passo;
    const importo = quota * (1 + tassoMese * mesiDistanza);
    rate.push({
      n: i + 1,
      ym,
      data: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`,
      importo,
      interessi: importo - quota,
    });
  }
  return rate;
}

function addMonths(ym, k) {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(y, (m - 1) + k, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}
function cmpYm(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

// Frazione di mese ancora da vivere: nel mese corrente il burn residuo è
// proporzionale ai giorni che mancano, non l'intero importo mensile (altrimenti
// la proiezione conta due volte le spese già sostenute).
function frazioneResiduaMeseCorrente() {
  const now = new Date();
  const giorniMese = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return (giorniMese - now.getDate() + 1) / giorniMese;
}

export function calcolaProiezione(piano, saldoIniziale) {
  const rate = generaRate(piano);
  if (rate.length === 0) return { righe: [], rate: [], totale: 0, totInteressi: 0 };

  const meseCorrente = getCurrentMonth();
  const primoMese = cmpYm(rate[0].ym, meseCorrente) < 0 ? rate[0].ym : meseCorrente;
  const ultimoMese = rate[rate.length - 1].ym;

  const burn = Math.abs(parseFloat(piano.burnMensile) || 0);
  const extra = (piano.extra || []).filter(e => e.ym);

  const righe = [];
  let saldo = parseFloat(saldoIniziale) || 0;
  let ym = primoMese;
  let guard = 0;

  while (cmpYm(ym, ultimoMese) <= 0 && guard++ < 120) {
    const rateMese = rate.filter(r => r.ym === ym);
    const totRate = rateMese.reduce((s, r) => s + r.importo, 0);
    const extraMese = extra.filter(e => e.ym === ym);
    const totExtra = extraMese.reduce((s, e) => s + (parseFloat(e.importo) || 0), 0);
    const burnMese = ym === meseCorrente ? burn * frazioneResiduaMeseCorrente() : burn;

    const saldoIni = saldo;
    saldo = saldoIni - totRate - burnMese + totExtra;

    righe.push({
      ym, saldoIniziale: saldoIni, rateMese, totRate,
      burn: burnMese, extraMese, totExtra, saldoFinale: saldo,
    });
    ym = addMonths(ym, 1);
  }

  // Un mese è "a rischio" se chiude sotto zero, oppure se chiude con meno
  // della rata che dovrà pagare il mese dopo: tecnicamente sei ancora in
  // positivo, ma la rata successiva ti manda sotto.
  righe.forEach((r, i) => {
    const prossimaRata = righe[i + 1]?.totRate || 0;
    r.critico = r.saldoFinale < 0;
    r.attenzione = !r.critico && prossimaRata > 0 && r.saldoFinale < prossimaRata;
  });

  const totale = rate.reduce((s, r) => s + r.importo, 0);
  return { righe, rate, totale, totInteressi: totale - (parseFloat(piano.importoTotale) || 0) };
}

// --- grafico ----------------------------------------------------------------

// Curva del saldo proiettato. Ogni punto porta il valore e il mese scritti:
// un grafico di sola forma non dice quando scatta il problema.
function CurvaSaldo({ righe, fs, isMobile }) {
  if (righe.length < 2) return null;
  const W = 100, H = 46, padT = 12, padB = 14;
  const vals = righe.map(r => r.saldoFinale);
  const max = Math.max(...vals, 0);
  const min = Math.min(...vals, 0);
  const span = (max - min) || 1;
  const x = i => (i / (righe.length - 1)) * (W - 10) + 5;
  const y = v => padT + (1 - (v - min) / span) * (H - padT - padB);
  const zeroY = y(0);

  const pts = righe.map((r, i) => [x(i), y(r.saldoFinale)]);
  const linea = pts.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`).join(" ");
  const area = `${linea} L${pts[pts.length - 1][0].toFixed(2)},${zeroY.toFixed(2)} L${pts[0][0].toFixed(2)},${zeroY.toFixed(2)} Z`;

  return (
    <div style={{ background: "var(--c-panel)", border: "1px solid var(--c-border)", borderRadius: 10, padding: "14px 10px 8px", marginBottom: 16 }}>
      <div style={{ fontSize: fs - 3, fontWeight: 700, color: "var(--c-text-dim)", marginBottom: 6, paddingLeft: 4 }}>
        📉 Curva del saldo proiettato
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: isMobile ? 150 : 190, display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id="pt-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {min < 0 && <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="#EF4444" strokeWidth="0.3" strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke" />}
        <path d={area} fill="url(#pt-grad)" />
        <path d={linea} fill="none" stroke="#3B82F6" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {righe.map((r, i) => {
          const [px, py] = pts[i];
          const colore = r.critico ? "#EF4444" : r.attenzione ? "#F59E0B" : "#3B82F6";
          const sopra = py > H / 2;
          return (
            <g key={r.ym}>
              <circle cx={px} cy={py} r="2.4" fill={colore} stroke="var(--c-panel)" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
              <text x={px} y={sopra ? py - 4 : py + 7} textAnchor="middle"
                style={{ fontSize: isMobile ? 4.2 : 3.4, fontWeight: 700, fill: colore }}>
                {Math.round(r.saldoFinale).toLocaleString("it-IT")}
              </text>
              <text x={px} y={H - 2} textAnchor="middle"
                style={{ fontSize: isMobile ? 4 : 3.2, fill: "var(--c-text-faint)" }}>
                {MESI_BREVI[parseInt(r.ym.split("-")[1], 10) - 1]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// --- pezzi di UI ------------------------------------------------------------
// Definiti a livello di modulo, MAI dentro PianoTasse: un componente ricreato
// a ogni render viene smontato e rimontato, e negli input questo fa perdere il
// focus a ogni carattere digitato (stesso bug già visto altrove nell'app).

const INPUT_STYLE = { width: "100%", padding: "8px 10px", borderRadius: 7, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", fontSize: 13, outline: "none" };

function Campo({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--c-text-dim)", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function ModalePiano({ form, setForm, esiste, conti, patrimonioFonte, onSalva, onElimina, onChiudi }) {
  const anteprima = calcolaProiezione(form, form.usaSaldoAuto ? (patrimonioFonte ?? 0) : (parseFloat(form.saldoInizialeManuale) || 0));
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000090", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onChiudi}>
      <div style={{ background: "var(--c-panel)", border: "1px solid var(--c-border)", borderRadius: 16, padding: 24, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--c-text-strong)", marginBottom: 18 }}>
          {esiste ? "✏️ Modifica piano" : "➕ Nuovo piano rateale"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Campo label="Nome del piano *">
            <input type="text" value={form.nome || ""} onChange={e => set("nome", e.target.value)} placeholder="es. Tasse Italia 2025" style={INPUT_STYLE} />
          </Campo>

          <Campo label="Da quale patrimonio si paga">
            <div style={{ display: "flex", gap: 6 }}>
              {[["personale", "👤 Personale"], ["iagrex", "🏢 IAGREX"]].map(([v, l]) => (
                <button key={v} onClick={() => setForm(p => ({ ...p, fonte: v, contoAddebito: "" }))}
                  style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: `1px solid ${form.fonte === v ? "#3B82F6" : "var(--c-border)"}`, background: form.fonte === v ? "#3B82F620" : "transparent", color: form.fonte === v ? "#3B82F6" : "var(--c-text-faint)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  {l}
                </button>
              ))}
            </div>
          </Campo>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Campo label="Importo totale € *">
              <input type="number" value={form.importoTotale || ""} onChange={e => set("importoTotale", e.target.value)} style={INPUT_STYLE} />
            </Campo>
            <Campo label="Numero rate">
              <input type="number" min="1" value={form.numeroRate || ""} onChange={e => set("numeroRate", e.target.value)} style={INPUT_STYLE} />
            </Campo>
            <Campo label="Data prima rata">
              <input type="date" value={form.primaRata || ""} onChange={e => set("primaRata", e.target.value)} style={INPUT_STYLE} />
            </Campo>
            <Campo label="Interessi % annuo">
              <input type="number" step="0.1" value={form.tassoAnnuo ?? ""} onChange={e => set("tassoAnnuo", e.target.value)} style={INPUT_STYLE} />
            </Campo>
          </div>

          <Campo label="Cadenza">
            <div style={{ display: "flex", gap: 6 }}>
              {[["mensile", "Mensile"], ["trimestrale", "Trimestrale"]].map(([v, l]) => (
                <button key={v} onClick={() => set("cadenza", v)}
                  style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: `1px solid ${form.cadenza === v ? "#8B5CF6" : "var(--c-border)"}`, background: form.cadenza === v ? "#8B5CF620" : "transparent", color: form.cadenza === v ? "#8B5CF6" : "var(--c-text-faint)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  {l}
                </button>
              ))}
            </div>
          </Campo>

          <Campo label="Conto di addebito (per l'allarme scoperto)">
            <select value={form.contoAddebito || ""} onChange={e => set("contoAddebito", e.target.value)} style={INPUT_STYLE}>
              <option value="">-- nessun controllo --</option>
              {conti.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Campo>

          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 6 }}>
              <input type="checkbox" checked={!!form.usaSaldoAuto} onChange={e => set("usaSaldoAuto", e.target.checked)} />
              <span style={{ fontSize: 12, color: "var(--c-text)" }}>Saldo di partenza dai saldi reali dell'app</span>
            </label>
            {form.usaSaldoAuto ? (
              <div style={{ fontSize: 11, color: "var(--c-text-faint)", paddingLeft: 24 }}>
                {patrimonioFonte == null ? "⏳ lettura saldi in corso..." : <>Patrimonio {form.fonte === "iagrex" ? "IAGREX" : "personale"} attuale: <b style={{ color: "#3B82F6" }}>{fmt(patrimonioFonte)}€</b></>}
              </div>
            ) : (
              <input type="number" value={form.saldoInizialeManuale || ""} onChange={e => set("saldoInizialeManuale", e.target.value)} placeholder="Saldo di partenza €" style={INPUT_STYLE} />
            )}
          </div>

          <Campo label="Burn mensile € (quanto bruci al mese, al netto delle entrate ordinarie)">
            <input type="number" value={form.burnMensile || ""} onChange={e => set("burnMensile", e.target.value)} placeholder="es. 1150" style={INPUT_STYLE} />
          </Campo>

          <Campo label="Note">
            <textarea value={form.note || ""} onChange={e => set("note", e.target.value)} rows={2} style={{ ...INPUT_STYLE, resize: "vertical" }} />
          </Campo>

          {anteprima.rate.length > 0 && parseFloat(form.importoTotale) > 0 && (
            <div style={{ background: "var(--c-bg)", border: "1px solid var(--c-border)", borderRadius: 8, padding: "9px 11px", fontSize: 11, color: "var(--c-text-dim)", lineHeight: 1.6 }}>
              Rata media <b style={{ color: "var(--c-text)" }}>{fmt(anteprima.totale / anteprima.rate.length)}€</b> · interessi totali <b style={{ color: "#F59E0B" }}>{fmt(anteprima.totInteressi)}€</b><br />
              Ultima rata: <b style={{ color: "var(--c-text)" }}>{anteprima.rate[anteprima.rate.length - 1].data}</b>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          {esiste && (
            <button onClick={onElimina} style={{ padding: "9px 14px", borderRadius: 8, border: "1px solid #EF444450", background: "transparent", color: "#EF4444", cursor: "pointer", fontSize: 13 }}>🗑</button>
          )}
          <button onClick={onChiudi} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "1px solid var(--c-border)", background: "transparent", color: "var(--c-text-dim)", cursor: "pointer", fontSize: 13 }}>Annulla</button>
          <button onClick={onSalva} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "none", background: "#3B82F6", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Salva</button>
        </div>
      </div>
    </div>
  );
}

function ModaleExtra({ form, setForm, onSalva, onChiudi }) {
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000090", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onChiudi}>
      <div style={{ background: "var(--c-panel)", border: "1px solid var(--c-border)", borderRadius: 16, padding: 24, width: "100%", maxWidth: 360 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--c-text-strong)", marginBottom: 6 }}>💰 Entrata straordinaria</div>
        <div style={{ fontSize: 11, color: "var(--c-text-faint)", marginBottom: 18, lineHeight: 1.5 }}>
          Dividendi, incassi una tantum, rimborsi spese soci: tutto ciò che non fa parte del flusso ordinario già dentro il burn.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Campo label="Descrizione">
            <input type="text" value={form.label || ""} onChange={e => set("label", e.target.value)} placeholder="es. Dividendo Q3 (netto)" style={INPUT_STYLE} />
          </Campo>
          <Campo label="Mese">
            <input type="month" value={form.ym || ""} onChange={e => set("ym", e.target.value)} style={INPUT_STYLE} />
          </Campo>
          <Campo label="Importo netto € *">
            <input type="number" value={form.importo || ""} onChange={e => set("importo", e.target.value)} style={INPUT_STYLE} />
          </Campo>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <button onClick={onChiudi} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "1px solid var(--c-border)", background: "transparent", color: "var(--c-text-dim)", cursor: "pointer", fontSize: 13 }}>Annulla</button>
          <button onClick={onSalva} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "none", background: "#10B981", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Salva</button>
        </div>
      </div>
    </div>
  );
}

// --- componente principale --------------------------------------------------

export default function PianoTasse({ allData, saveData, fs = 14, isMobile = false, eurRonRate = 5, saldiIagrexCorrenti = {} }) {
  const piani = allData.pianiTasse || [];
  const [selId, setSelId] = useState(null);
  const [modal, setModal] = useState(null);   // "piano" | "extra"
  const [form, setForm] = useState({});
  const [saldiBruno, setSaldiBruno] = useState(null);
  const [brunoErr, setBrunoErr] = useState(null);

  const attivi = piani.filter(p => !p.archiviato);
  const selezionato = piani.find(p => p.id === selId) || attivi[0] || null;

  // I saldi personali vivono in un altro documento ClickUp (BrunoPage): li
  // leggiamo solo se serve davvero, cioè se almeno un piano si appoggia al
  // patrimonio personale.
  useEffect(() => {
    if (!piani.some(p => p.fonte === "personale" && p.usaSaldoAuto)) return;
    if (saldiBruno !== null || brunoErr) return;
    (async () => {
      try {
        const res = await fetch("/api/bruno-finance");
        const j = await res.json();
        if (!res.ok) { setBrunoErr(j.error || `Errore ${res.status}`); return; }
        const dati = j.data || {};
        const mesi = Object.keys(dati).filter(k => /^\d{4}-\d{2}$/.test(k)).sort();
        const ultimo = mesi[mesi.length - 1];
        setSaldiBruno(ultimo ? (dati[ultimo].saldi || {}) : {});
      } catch (e) { setBrunoErr(e.message); }
    })();
  }, [piani, saldiBruno, brunoErr]);

  const contiFonte = p => (p?.fonte === "iagrex" ? CONTI_IAGREX : CONTI_PERSONALI);

  const saldiFonte = useCallback((p) => {
    if (!p) return null;
    return p.fonte === "iagrex" ? (saldiIagrexCorrenti || {}) : saldiBruno;
  }, [saldiBruno, saldiIagrexCorrenti]);

  // Totale del patrimonio della fonte, convertito in € (i conti in RON
  // pesano al cambio corrente, come nel resto dell'app).
  const totalePatrimonio = useCallback((p) => {
    const saldi = saldiFonte(p);
    if (!saldi) return null;
    const conti = contiFonte(p);
    return conti.reduce((s, c) => {
      const v = parseFloat(saldi[c.id]) || 0;
      return s + (c.currency === "RON" ? v / (eurRonRate || 5) : v);
    }, 0);
  }, [saldiFonte, eurRonRate]);

  const saldoIniziale = useMemo(() => {
    if (!selezionato) return 0;
    if (!selezionato.usaSaldoAuto) return parseFloat(selezionato.saldoInizialeManuale) || 0;
    const t = totalePatrimonio(selezionato);
    return t == null ? 0 : t;
  }, [selezionato, totalePatrimonio]);

  const proiezione = useMemo(
    () => (selezionato ? calcolaProiezione(selezionato, saldoIniziale) : null),
    [selezionato, saldoIniziale]
  );

  // Controllo sul conto di addebito: la rata parte da UN conto preciso, e
  // avere il patrimonio complessivo capiente non basta se i soldi sono su
  // un altro conto. È il caso che salva dallo scoperto il giorno della rata.
  const allarmeConto = useMemo(() => {
    if (!selezionato?.contoAddebito || !proiezione) return null;
    const saldi = saldiFonte(selezionato);
    if (!saldi) return null;
    const conto = contiFonte(selezionato).find(c => c.id === selezionato.contoAddebito);
    if (!conto) return null;
    const oggi = localISODate();
    const prossima = proiezione.rate.find(r => r.data >= oggi);
    if (!prossima) return null;
    const saldoConto = parseFloat(saldi[conto.id]) || 0;
    const saldoEur = conto.currency === "RON" ? saldoConto / (eurRonRate || 5) : saldoConto;
    return {
      conto, prossima, saldoConto, saldoEur,
      scoperto: saldoEur < prossima.importo,
      mancante: prossima.importo - saldoEur,
    };
  }, [selezionato, proiezione, saldiFonte, eurRonRate]);

  const mesePeggiore = useMemo(() => {
    if (!proiezione?.righe.length) return null;
    return proiezione.righe.reduce((min, r) => (r.saldoFinale < min.saldoFinale ? r : min), proiezione.righe[0]);
  }, [proiezione]);

  // --- salvataggi ---
  const salvaPiani = (nuovi) => saveData({ ...allData, pianiTasse: nuovi }, { etichetta: "Piano tasse" });

  const apriNuovo = () => { setForm(PIANO_VUOTO()); setModal("piano"); };
  const apriModifica = () => { if (selezionato) { setForm({ ...selezionato }); setModal("piano"); } };

  const salvaPiano = () => {
    if (!form.nome?.trim() || !(parseFloat(form.importoTotale) > 0)) return;
    const esiste = piani.some(p => p.id === form.id);
    const nuovi = esiste ? piani.map(p => (p.id === form.id ? { ...form } : p)) : [...piani, { ...form }];
    salvaPiani(nuovi);
    setSelId(form.id);
    setModal(null);
  };

  const eliminaPiano = () => {
    if (!selezionato) return;
    if (!confirm(`Eliminare il piano "${selezionato.nome}"?`)) return;
    salvaPiani(piani.filter(p => p.id !== selezionato.id));
    setSelId(null);
    setModal(null);
  };

  const apriExtra = (voce) => {
    setForm(voce ? { ...voce } : { id: genId(), ym: getCurrentMonth(), importo: "", label: "" });
    setModal("extra");
  };

  const salvaExtra = () => {
    if (!selezionato || !(parseFloat(form.importo) > 0)) return;
    const lista = selezionato.extra || [];
    const nuovaLista = lista.some(e => e.id === form.id)
      ? lista.map(e => (e.id === form.id ? { ...form } : e))
      : [...lista, { ...form }];
    salvaPiani(piani.map(p => (p.id === selezionato.id ? { ...p, extra: nuovaLista } : p)));
    setModal(null);
  };

  const eliminaExtra = (id) => {
    if (!selezionato) return;
    salvaPiani(piani.map(p => (p.id === selezionato.id ? { ...p, extra: (p.extra || []).filter(e => e.id !== id) } : p)));
  };

  // Le modali sono componenti di modulo: qui prepariamo solo i props.
  const modalePiano = modal === "piano" ? (
    <ModalePiano
      form={form} setForm={setForm}
      esiste={piani.some(pl => pl.id === form.id)}
      conti={contiFonte(form)}
      patrimonioFonte={form.usaSaldoAuto ? totalePatrimonio(form) : null}
      onSalva={salvaPiano} onElimina={eliminaPiano} onChiudi={() => setModal(null)}
    />
  ) : null;
  const modaleExtra = modal === "extra" ? (
    <ModaleExtra form={form} setForm={setForm} onSalva={salvaExtra} onChiudi={() => setModal(null)} />
  ) : null;

  // --- render ---
  if (attivi.length === 0) {
    return (
      <div>
        <div style={{ background: "var(--c-panel)", border: "1px solid var(--c-border)", borderRadius: 12, padding: 28, textAlign: "center" }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>🧾</div>
          <div style={{ fontSize: fs, fontWeight: 700, color: "var(--c-text-strong)", marginBottom: 6 }}>Nessun piano rateale</div>
          <div style={{ fontSize: fs - 3, color: "var(--c-text-faint)", marginBottom: 18, lineHeight: 1.55, maxWidth: 460, marginLeft: "auto", marginRight: "auto" }}>
            Inserisci un debito a rate (tasse italiane, tasse rumene, qualsiasi rateizzazione) e vedi mese per mese con quanti soldi resti,
            in quale mese vai in difficoltà e quanto ti serve dai dividendi per starci dentro.
          </div>
          <button onClick={apriNuovo} style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: "#3B82F6", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
            + Crea il primo piano
          </button>
        </div>
        {modalePiano}
      </div>
    );
  }

  const p = selezionato;
  const righe = proiezione?.righe || [];
  const saldoFinale = righe.length ? righe[righe.length - 1].saldoFinale : saldoIniziale;
  const totExtra = (p?.extra || []).reduce((s, e) => s + (parseFloat(e.importo) || 0), 0);

  return (
    <div>
      {/* selettore piano */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
          {attivi.map(pl => (
            <button key={pl.id} onClick={() => setSelId(pl.id)}
              style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${pl.id === p?.id ? "#3B82F6" : "var(--c-border)"}`, background: pl.id === p?.id ? "#3B82F620" : "transparent", color: pl.id === p?.id ? "#3B82F6" : "var(--c-text-faint)", cursor: "pointer", fontSize: 12, fontWeight: pl.id === p?.id ? 700 : 400 }}>
              {pl.fonte === "iagrex" ? "🏢" : "👤"} {pl.nome}
            </button>
          ))}
        </div>
        <button onClick={apriNuovo} style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid var(--c-border)", background: "transparent", color: "var(--c-text-dim)", cursor: "pointer", fontSize: 12 }}>+ Piano</button>
        <button onClick={apriModifica} style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid var(--c-border)", background: "transparent", color: "var(--c-text-dim)", cursor: "pointer", fontSize: 12 }}>✏️</button>
      </div>

      {brunoErr && p?.fonte === "personale" && p?.usaSaldoAuto && (
        <div style={{ background: "#EF444415", border: "1px solid #EF444440", borderRadius: 8, padding: "9px 12px", marginBottom: 12, fontSize: fs - 3, color: "#EF4444" }}>
          ⚠️ Non riesco a leggere i saldi personali ({brunoErr}). La proiezione parte da 0 — imposta un saldo manuale nel piano.
        </div>
      )}

      {/* ALLARME CONTO DI ADDEBITO */}
      {allarmeConto?.scoperto && (
        <div style={{ background: "#EF444418", border: "2px solid #EF4444", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: fs - 1, fontWeight: 800, color: "#EF4444", marginBottom: 5 }}>
            🚨 Conto scoperto sulla prossima rata
          </div>
          <div style={{ fontSize: fs - 3, color: "var(--c-text)", lineHeight: 1.6 }}>
            La rata n°{allarmeConto.prossima.n} da <b>{fmt(allarmeConto.prossima.importo)}€</b> è in scadenza il <b>{allarmeConto.prossima.data}</b>,
            ma su <b>{allarmeConto.conto.label}</b> ci sono solo <b>{fmt(allarmeConto.saldoEur)}€</b>.
            <br />👉 Devi trasferire almeno <b style={{ color: "#EF4444" }}>{fmt(allarmeConto.mancante)}€</b> su quel conto prima della scadenza.
          </div>
        </div>
      )}
      {allarmeConto && !allarmeConto.scoperto && (
        <div style={{ background: "#10B98112", border: "1px solid #10B98140", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: fs - 3, color: "var(--c-text-dim)" }}>
          ✅ <b style={{ color: "#10B981" }}>{allarmeConto.conto.label}</b> copre la prossima rata del {allarmeConto.prossima.data} ({fmt(allarmeConto.saldoEur)}€ contro {fmt(allarmeConto.prossima.importo)}€)
        </div>
      )}

      {/* CARD RIEPILOGO */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(5, 1fr)", gap: 8, marginBottom: 16 }}>
        {[
          { label: "Debito totale", val: proiezione?.totale || 0, color: "#EF4444" },
          { label: "di cui interessi", val: proiezione?.totInteressi || 0, color: "#F59E0B" },
          { label: "Saldo di partenza", val: saldoIniziale, color: "#3B82F6" },
          { label: "Entrate previste", val: totExtra, color: "#10B981" },
          { label: "Saldo a fine piano", val: saldoFinale, color: saldoFinale < 0 ? "#EF4444" : saldoFinale < 2000 ? "#F59E0B" : "#10B981" },
        ].map(c => (
          <div key={c.label} style={{ background: "var(--c-panel)", border: "1px solid var(--c-border)", borderRadius: 8, padding: "8px 12px" }}>
            <div style={{ fontSize: fs - 4, color: "var(--c-text-faint)", marginBottom: 3 }}>{c.label}</div>
            <div style={{ fontSize: fs + 1, fontWeight: 800, color: c.color }}>{fmt(c.val)}€</div>
          </div>
        ))}
      </div>

      {/* VERDETTO */}
      {mesePeggiore && (
        <div style={{
          background: saldoFinale < 0 ? "#EF444415" : mesePeggiore.saldoFinale < 2000 ? "#F59E0B15" : "#10B98112",
          border: `1px solid ${saldoFinale < 0 ? "#EF4444" : mesePeggiore.saldoFinale < 2000 ? "#F59E0B" : "#10B981"}40`,
          borderRadius: 10, padding: "11px 14px", marginBottom: 16, fontSize: fs - 2, lineHeight: 1.6, color: "var(--c-text)",
        }}>
          {saldoFinale < 0 ? (
            <>❌ <b>Il piano non chiude.</b> A {getMonthLabel(righe[righe.length - 1].ym)} saresti a <b style={{ color: "#EF4444" }}>{fmt(saldoFinale)}€</b>.
              Ti servono almeno <b style={{ color: "#EF4444" }}>{fmt(Math.abs(saldoFinale) + 2000)}€</b> di entrate straordinarie in più (o meno rate).</>
          ) : (
            <>✅ <b>Il piano chiude.</b> Mese più critico: <b>{getMonthLabel(mesePeggiore.ym)}</b> con <b style={{ color: mesePeggiore.saldoFinale < 2000 ? "#F59E0B" : "#10B981" }}>{fmt(mesePeggiore.saldoFinale)}€</b> in cassa
              {mesePeggiore.saldoFinale < 2000 && <> — è un cuscinetto sottile, tieni lì il margine di sicurezza.</>}</>
          )}
        </div>
      )}

      <CurvaSaldo righe={righe} fs={fs} isMobile={isMobile} />

      {/* TABELLA PROIEZIONE */}
      <div style={{ fontSize: fs - 3, fontWeight: 700, color: "var(--c-text-dim)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
        📅 Proiezione mese per mese
      </div>
      <div style={{ overflowX: "auto", border: "1px solid var(--c-border)", borderRadius: 10, marginBottom: 20 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: fs - 3, minWidth: 560 }}>
          <thead>
            <tr style={{ background: "var(--c-panel2)" }}>
              {["Mese", "Inizio", "Rate", "Vita", "Entrate", "Fine"].map((h, i) => (
                <th key={h} style={{ padding: "8px 10px", textAlign: i === 0 ? "left" : "right", color: "var(--c-text-faint)", fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid var(--c-border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {righe.map((r, i) => {
              const colore = r.critico ? "#EF4444" : r.attenzione ? "#F59E0B" : "#10B981";
              return (
                <tr key={r.ym} style={{
                  background: r.critico ? "#EF44441A" : r.attenzione ? "#F59E0B14" : (i % 2 === 0 ? "var(--c-panel)" : "var(--c-panel2)"),
                  boxShadow: r.critico ? "inset 3px 0 0 #EF4444" : r.attenzione ? "inset 3px 0 0 #F59E0B" : "none",
                }}>
                  <td style={{ padding: "8px 10px", color: "var(--c-text)", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {r.critico ? "🚨 " : r.attenzione ? "⚠️ " : ""}{getMonthLabel(r.ym)}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: "var(--c-text-faint)" }}>{fmt(r.saldoIniziale)}€</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: r.totRate ? "#EF4444" : "var(--c-text-faintest)", fontWeight: r.totRate ? 700 : 400 }}>
                    {r.totRate ? `−${fmt(r.totRate)}€` : "—"}
                    {r.rateMese.length > 0 && <div style={{ fontSize: fs - 5, color: "var(--c-text-faintest)", fontWeight: 400 }}>rata {r.rateMese.map(x => x.n).join(", ")}</div>}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: r.burn ? "var(--c-text-dim)" : "var(--c-text-faintest)" }}>{r.burn ? `−${fmt(r.burn)}€` : "—"}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: r.totExtra ? "#10B981" : "var(--c-text-faintest)", fontWeight: r.totExtra ? 700 : 400 }}>
                    {r.totExtra ? `+${fmt(r.totExtra)}€` : "—"}
                    {r.extraMese.length > 0 && <div style={{ fontSize: fs - 5, color: "var(--c-text-faintest)", fontWeight: 400 }}>{r.extraMese.map(x => x.label).filter(Boolean).join(" · ")}</div>}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: colore, fontWeight: 800 }}>{fmt(r.saldoFinale)}€</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ENTRATE STRAORDINARIE */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: fs - 3, fontWeight: 700, color: "var(--c-text-dim)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          💰 Entrate straordinarie previste
        </div>
        <button onClick={() => apriExtra(null)} style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: "#10B981", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>+ Aggiungi</button>
      </div>
      <div style={{ border: "1px solid var(--c-border)", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
        {(p?.extra || []).length === 0 ? (
          <div style={{ padding: 16, textAlign: "center", color: "var(--c-text-faintest)", fontSize: fs - 3, background: "var(--c-panel)" }}>
            Nessuna entrata prevista — aggiungi i dividendi che pensi di prendere
          </div>
        ) : (
          [...(p.extra || [])].sort((a, b) => (a.ym > b.ym ? 1 : -1)).map((e, i) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: i % 2 === 0 ? "var(--c-panel)" : "var(--c-panel2)", borderTop: i === 0 ? "none" : "1px solid var(--c-border)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: fs - 2, color: "var(--c-text)", fontWeight: 600 }}>{e.label || "Entrata"}</div>
                <div style={{ fontSize: fs - 4, color: "var(--c-text-faint)" }}>{getMonthLabel(e.ym)}</div>
              </div>
              <div style={{ fontSize: fs - 1, fontWeight: 700, color: "#10B981" }}>+{fmt(e.importo)}€</div>
              <button onClick={() => apriExtra(e)} style={{ background: "transparent", border: "none", color: "var(--c-text-faint)", cursor: "pointer", fontSize: 13 }}>✏️</button>
              <button onClick={() => eliminaExtra(e.id)} style={{ background: "transparent", border: "none", color: "#EF4444", cursor: "pointer", fontSize: 13 }}>🗑</button>
            </div>
          ))
        )}
      </div>

      {/* PIANO RATE */}
      <div style={{ fontSize: fs - 3, fontWeight: 700, color: "var(--c-text-dim)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
        🧾 Scadenzario rate
      </div>
      <div style={{ border: "1px solid var(--c-border)", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
        {(proiezione?.rate || []).map((r, i) => {
          const passata = r.data < localISODate();
          return (
            <div key={r.n} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: i % 2 === 0 ? "var(--c-panel)" : "var(--c-panel2)", borderTop: i === 0 ? "none" : "1px solid var(--c-border)", opacity: passata ? 0.55 : 1 }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: passata ? "#10B98120" : "#EF444418", color: passata ? "#10B981" : "#EF4444", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{r.n}</div>
              <div style={{ flex: 1, fontSize: fs - 2, color: "var(--c-text)" }}>{r.data}</div>
              {r.interessi > 0.005 && <div style={{ fontSize: fs - 4, color: "#F59E0B" }}>+{fmt(r.interessi)}€ int.</div>}
              <div style={{ fontSize: fs - 1, fontWeight: 700, color: "var(--c-text-strong)" }}>{fmt(r.importo)}€</div>
            </div>
          );
        })}
      </div>

      {p?.note && (
        <div style={{ background: "var(--c-panel)", border: "1px solid var(--c-border)", borderRadius: 8, padding: "10px 12px", fontSize: fs - 3, color: "var(--c-text-dim)", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
          📝 {p.note}
        </div>
      )}

      {modalePiano}
      {modaleExtra}
    </div>
  );
}
