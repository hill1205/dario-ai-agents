"use client";
import { useState, useEffect, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Cronologia "Annulla" — ultime N modifiche, per pagina.
//
// PERCHE' ESISTE
// Prima, se Dario correggeva un importo e sbagliava a digitare, non c'era modo
// di tornare indietro: il salvataggio sovrascrive i dati su ClickUp/Notion e
// il valore precedente era perso. Questo hook tiene da parte gli ultimi stati
// prima di ogni salvataggio, così si può fare marcia indietro.
//
// COME FUNZIONA
// Ogni pagina che salva l'intero stato in blocco (Finanze, IAGREX, Pipeline)
// chiama `snapshot(statoPrima)` subito prima di salvare. `undo()` restituisce
// lo stato più recente della pila e lo rimuove; sta alla pagina applicarlo e
// risalvarlo sul backend.
//
// La pila vive in localStorage, quindi sopravvive a un ricaricamento o alla
// chiusura dell'app, ma è per dispositivo: una modifica fatta dal telefono non
// si annulla dal computer (i dati stanno su ClickUp/Notion, la cronologia no).
// ---------------------------------------------------------------------------

export const MAX_UNDO = 5;

// Se lo stato è grande, tenere 5 copie può superare la quota di localStorage
// (~5 MB): in quel caso si scarta silenziosamente la voce più vecchia e, se
// ancora non basta, si rinuncia a salvare su disco tenendo la pila solo in
// memoria. Meglio un undo parziale che un'eccezione che blocca il salvataggio.
function scriviLS(chiave, pila) {
  if (typeof window === "undefined") return pila;
  let corrente = [...pila];
  while (corrente.length > 0) {
    try {
      window.localStorage.setItem(chiave, JSON.stringify(corrente));
      return corrente;
    } catch {
      corrente = corrente.slice(1); // via la più vecchia e riprova
    }
  }
  try { window.localStorage.removeItem(chiave); } catch {}
  return [];
}

function leggiLS(chiave) {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(chiave);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(-MAX_UNDO) : [];
  } catch { return []; }
}

/**
 * @param {string} chiave  identificatore della pagina (es. "finanze")
 * @returns {{ snapshot: (stato:any, etichetta?:string)=>void,
 *             undo: ()=>({stato:any, etichetta:string}|null),
 *             voci: Array<{etichetta:string, quando:string}>,
 *             pulisci: ()=>void }}
 */
export function useUndoStack(chiave) {
  const lsKey = `undo:${chiave}`;
  const [pila, setPila] = useState([]);
  // La pila serve anche dentro callback memoizzate senza ricrearle a ogni
  // cambiamento: il ref segue sempre il valore aggiornato.
  const pilaRef = useRef([]);

  // Caricamento iniziale lato client (evita il mismatch di idratazione di Next:
  // il server non ha localStorage, quindi il primo render parte sempre vuoto).
  useEffect(() => {
    const iniziale = leggiLS(lsKey);
    pilaRef.current = iniziale;
    setPila(iniziale);
  }, [lsKey]);

  const aggiorna = useCallback((nuova) => {
    const salvata = scriviLS(lsKey, nuova);
    pilaRef.current = salvata;
    setPila(salvata);
  }, [lsKey]);

  const snapshot = useCallback((stato, etichetta = "Modifica") => {
    if (stato === undefined || stato === null) return;
    const voce = { stato, etichetta, quando: new Date().toISOString() };
    aggiorna([...pilaRef.current, voce].slice(-MAX_UNDO));
  }, [aggiorna]);

  const undo = useCallback(() => {
    const pilaAttuale = pilaRef.current;
    if (pilaAttuale.length === 0) return null;
    const ultima = pilaAttuale[pilaAttuale.length - 1];
    aggiorna(pilaAttuale.slice(0, -1));
    return { stato: ultima.stato, etichetta: ultima.etichetta };
  }, [aggiorna]);

  const pulisci = useCallback(() => aggiorna([]), [aggiorna]);

  return {
    snapshot,
    undo,
    pulisci,
    voci: pila.map(v => ({ etichetta: v.etichetta, quando: v.quando })),
  };
}

/**
 * Bottone "Annulla" con il conteggio delle modifiche annullabili.
 * Mostrato spento (ma presente) quando non c'è nulla da annullare, così la
 * barra non cambia larghezza a ogni salvataggio.
 */
export function UndoButton({ voci, onUndo, accent = "#8B5CF6", compact = false }) {
  const n = voci.length;
  const ultima = n > 0 ? voci[n - 1] : null;
  const titolo = ultima
    ? `Annulla: ${ultima.etichetta} (${new Date(ultima.quando).toLocaleString("it-IT", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}) · ${n} disponibili`
    : "Nessuna modifica da annullare";
  return (
    <button
      onClick={onUndo}
      disabled={n === 0}
      title={titolo}
      style={{
        padding: compact ? "5px 9px" : "6px 12px",
        borderRadius: 7,
        border: `1px solid ${n ? accent : "var(--c-border)"}`,
        background: "transparent",
        color: n ? accent : "var(--c-text-faintest)",
        cursor: n ? "pointer" : "default",
        fontSize: compact ? 11 : 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
        opacity: n ? 1 : 0.5,
      }}
    >
      ↩︎ Annulla{n ? ` (${n})` : ""}
    </button>
  );
}
