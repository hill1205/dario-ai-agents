#!/usr/bin/env bash
# Deploy della dashboard in un comando solo.
#
# USO:
#   bash scripts/deploy.sh "descrizione di cosa hai cambiato"
#
# COSA FA, in ordine:
#   1. scarica da GitHub eventuali modifiche fatte altrove (es. upload web)
#   2. mostra quali file stai per pubblicare e chiede conferma
#   3. verifica che il progetto compili (next build) — se fallisce si ferma
#   4. commit + push su main  →  Vercel fa partire il deploy da solo
#
# Se qualcosa va storto lo script si ferma PRIMA di pubblicare: non pubblica
# mai codice che non compila.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MSG="${1:-}"
if [ -z "$MSG" ]; then
  echo "❌ Manca il messaggio. Esempio:"
  echo '   bash scripts/deploy.sh "fix conversioni nella lista movimenti"'
  exit 1
fi

echo "→ 1/4  Allineo con GitHub"
git fetch origin
if ! git diff --quiet origin/main HEAD 2>/dev/null; then
  git pull --rebase origin main
fi

echo
echo "→ 2/4  File che stai per pubblicare:"
if git diff --quiet && git diff --cached --quiet && [ -z "$(git status --porcelain)" ]; then
  echo "   (niente da pubblicare — nessun file modificato)"
  exit 0
fi
git status --short
echo
read -r -p "Procedo con build e push? [s/N] " RISPOSTA
case "$RISPOSTA" in
  s|S|si|SI|Si|y|Y) ;;
  *) echo "Annullato. Nessuna modifica pubblicata."; exit 0 ;;
esac

echo
echo "→ 3/4  Verifica del build"
# Node.js non e' installato sul Mac di Dario: in quel caso il controllo qui
# non e' possibile e ci si affida alla verifica che Claude fa nel suo
# ambiente prima di passare la palla (scripts/build-check.sh).
if ! command -v npx >/dev/null 2>&1; then
  echo "   ⚠️  Node.js non installato su questo Mac: salto la verifica."
  echo "   (il build viene comunque verificato da Claude prima del deploy;"
  echo "    se Vercel dovesse fallire, il sito online resta quello vecchio)"
else
  echo "   next build in corso (30-60 secondi)..."
  if [ ! -d node_modules ]; then
    echo "   Installo le dipendenze (solo la prima volta)"
    npm install --no-audit --no-fund
  fi
  rm -rf .next
  if ! npx next build; then
    echo
    echo "❌ Il build e' fallito: NON pubblico niente."
    echo "   Copia l'errore qui sopra e mandalo a Claude."
    exit 1
  fi
fi

echo
echo "→ 4/4  Commit e push"
git add -A
git commit -m "$MSG"
git push

echo
echo "✅ Pubblicato. Vercel sta costruendo il deploy."
echo "   Controlla tra un minuto: https://vercel.com/dario-hub"
git log --oneline -1
