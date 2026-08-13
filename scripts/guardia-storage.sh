#!/usr/bin/env bash
# Guardia anti-regressione sullo storage ClickUp.
#
# PERCHE' ESISTE
# Il 13/08/2026 una virgoletta doppia scritta in un concetto ha reso
# illeggibile l'intera pagina Apprendimento: ClickUp tratta il contenuto
# come markdown e si mangia i backslash, quindi il \" prodotto da
# JSON.stringify torna indietro come " nudo e il JSON si rompe. La
# correzione ha dovuto toccare sette file, perche' sette punti dell'app
# parlavano con i Doc ClickUp per conto proprio.
#
# Ora esiste un solo strato (app/lib/clickup-doc.js, che codifica in base64
# tramite app/lib/doc-payload.js). Questo script serve a impedire che la
# prossima pagina-database ricominci da capo: se qualcuno riscrive la
# logica a mano, la build fallisce qui invece di rompersi in silenzio tra
# sei mesi, con dentro dei dati che nessuno puo' piu' leggere.
#
# Uso:  bash scripts/guardia-storage.sh   (gira anche dentro build-check.sh)
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
errori=0

segnala() {
  errori=$((errori + 1))
  echo "❌ $1"
  echo "$2" | sed 's/^/     /'
  echo
}

# 1. Chi puo' chiamare l'API Doc di ClickUp: solo lo strato di storage.
trovati=$(grep -rn "api.clickup.com/api/v3/workspaces" --include=*.js --include=*.jsx app \
  | grep -v "^app/lib/clickup-doc.js:" || true)
if [ -n "$trovati" ]; then
  segnala "Chiamata diretta all'API Doc di ClickUp fuori da app/lib/clickup-doc.js.
   Usa creaArchivio({ docId, pageId, marcatore, vuoto }) invece di rifare fetch a mano." "$trovati"
fi

# 2. Nessuno scrive JSON grezzo dentro un marcatore: il payload va codificato.
trovati=$(grep -rn "_JSON:.*JSON.stringify" --include=*.js --include=*.jsx app || true)
if [ -n "$trovati" ]; then
  segnala "JSON grezzo scritto dentro un marcatore.
   ClickUp si mangia i backslash: usa codificaPayload() (app/lib/doc-payload.js)." "$trovati"
fi

# 3. Nessuno legge un contenuto ClickUp con JSON.parse: la lettura passa da
#    decodificaPayload, che sa gestire sia il base64 sia il formato vecchio.
#    Si guardano solo le righe che parsano davvero un contenuto ClickUp
#    (marcatore, content, description): un JSON.parse sulla risposta di
#    Claude o sul body di una request e' un'altra cosa e va lasciato stare.
trovati=$(grep -rn "JSON.parse(" --include=*.js --include=*.jsx app \
  | grep -iE "MARKER|marcatore|content|description" \
  | grep -v "^app/lib/doc-payload.js:" || true)
if [ -n "$trovati" ]; then
  segnala "JSON.parse su un contenuto ClickUp.
   Usa decodificaPayload() (app/lib/doc-payload.js): legge il base64 e anche il formato vecchio." "$trovati"
fi

if [ "$errori" -gt 0 ]; then
  echo "Guardia storage: $errori problema/i. Vedi app/lib/clickup-doc.js per il modo giusto."
  exit 1
fi

echo "✅ Guardia storage: tutto passa dallo strato unico."
