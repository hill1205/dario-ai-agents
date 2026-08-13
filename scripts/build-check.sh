#!/usr/bin/env bash
# Verifica completa (next build) eseguita su filesystem locale.
#
# Perché esiste: quando il repo è aperto da Cowork, la cartella del progetto è
# un mount di rete verso il Mac. `next build` dentro il mount è talmente lento
# da andare in timeout (>3 minuti, spesso mai completato), quindi per mesi la
# verifica si è limitata al controllo di sintassi con esbuild — che NON cattura
# errori React/Next (import mancanti, hook fuori posto, "use client" assenti).
#
# Copiando i sorgenti su /tmp (disco locale) lo stesso build passa in ~9
# secondi. Questo script automatizza la procedura.
#
# Uso:  bash scripts/build-check.sh
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Prima del build, la guardia sullo storage: e' istantanea e fallisce con un
# messaggio chiaro, mentre un dato corrotto su ClickUp lo scopri settimane
# dopo. Vedi scripts/guardia-storage.sh.
bash "$SRC/scripts/guardia-storage.sh"

# La destinazione è sovrascrivibile: capita che una sessione precedente lasci
# /tmp/dario-build-check di proprietà di un altro utente del sandbox, e da lì in
# poi rsync fallisce con "Permission denied". In quel caso:
#   BUILD_CHECK_DIR=/tmp/dario-build-check2 bash scripts/build-check.sh
DEST="${BUILD_CHECK_DIR:-/tmp/dario-build-check}"

echo "→ Copio i sorgenti da $SRC (escludo node_modules/.next/.git)"
mkdir -p "$DEST"
rsync -a --delete \
  --exclude node_modules --exclude .next --exclude .git \
  "$SRC"/ "$DEST"/

cd "$DEST"

# node_modules viene installato una volta e riusato tra un run e l'altro
# (rsync --delete non lo tocca perché è escluso dalla copia).
if [ ! -d node_modules ]; then
  echo "→ Installo le dipendenze (solo la prima volta, ~25s)"
  npm install --no-audit --no-fund
fi

echo "→ next build"
rm -rf .next
npx next build
echo
echo "✅ Build completato senza errori."
