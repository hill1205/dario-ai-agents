// Come i dati JSON vengono scritti dentro le pagine dei Doc ClickUp.
//
// PERCHE' NON SI SCRIVE PIU' JSON IN CHIARO
// ClickUp tratta il contenuto delle pagine come markdown e, nel farlo, si
// mangia i backslash: un `\"` scritto dall'app torna indietro come `"`
// nudo. Risultato: bastava scrivere una virgoletta doppia in un titolo, in
// un appunto o nella descrizione di un movimento perche' il JSON dell'INTERA
// pagina diventasse illeggibile — e la dashboard rispondesse "Formato dati
// non riconosciuto" su tutto lo storico, non solo sulla voce nuova.
// Successo il 10/08/2026 sulla pagina Apprendimento (un concetto conteneva
// «successione di Fibonacci» tra virgolette).
//
// La soluzione e' scrivere il JSON in base64: l'alfabeto base64 (A-Z a-z
// 0-9 + / =) non contiene un solo carattere che il markdown di ClickUp
// possa toccare, quindi qualsiasi cosa Dario scriva torna indietro identica.
// Il prezzo e' che la pagina non e' piu' leggibile a occhio nudo nel Doc —
// accettabile: erano tutte pagine marcate "non modificare a mano", e il
// backup (/api/backup) restituisce comunque i dati decodificati.
//
// La lettura resta compatibile col formato vecchio: finche' una pagina non
// viene riscritta contiene ancora JSON in chiaro e va letta cosi'.

const PREFISSO = "B64,";

export function codificaPayload(dati) {
  return PREFISSO + Buffer.from(JSON.stringify(dati), "utf8").toString("base64");
}

// Restituisce il valore parsato, o null se dopo il marcatore non c'e'
// niente. Lancia se il contenuto c'e' ma e' illeggibile: un JSON rotto
// letto come "nessun dato" verrebbe cancellato alla prima scrittura.
export function decodificaPayload(grezzo) {
  const testo = String(grezzo || "").trim();
  if (!testo) return null;
  const json = testo.startsWith(PREFISSO)
    ? Buffer.from(testo.slice(PREFISSO.length).replace(/\s+/g, ""), "base64").toString("utf8")
    : testo; // formato vecchio, JSON in chiaro
  return JSON.parse(json);
}
