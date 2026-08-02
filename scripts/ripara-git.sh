#!/usr/bin/env bash
# Ripara il repo git locale di dario-ai-agents.
#
# PERCHE' ESISTE
# Dal 24-25 luglio 2026 nella cartella .git sono rimasti due file di lock
# (.git/HEAD.lock e .git/index.lock) creati da un comando git interrotto a
# meta'. Finche' esistono, git rifiuta qualsiasi commit, add o reset: e' il
# motivo per cui "git locale e' bloccato" e ogni deploy e' passato dall'upload
# web di GitHub. Il sandbox di Cowork non puo' cancellarli (permessi del mount
# di rete), ma dal Mac si rimuovono senza problemi.
#
# COSA FA
#   1. cancella i file di lock rimasti
#   2. scarica lo stato aggiornato da GitHub
#   3. riallinea il repo locale a origin/main
#
# SICUREZZA: il working tree e' gia' stato verificato file per file ed e'
# IDENTICO a origin/main (zero differenze, zero file extra), quindi il reset
# non puo' far perdere lavoro. Lo script rifa' comunque il controllo e si
# ferma se trova qualcosa di diverso.
#
# USO:  bash scripts/ripara-git.sh
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "Repo: $(pwd)"

echo
echo "→ 1/4  Rimuovo i file di lock rimasti"
rm -f .git/HEAD.lock .git/index.lock .git/refs/heads/main.lock
echo "   ok"

echo
echo "→ 2/4  Scarico lo stato da GitHub"
git fetch origin

echo
echo "→ 3/4  Controllo che non ci sia lavoro locale non salvato"
DIVERSI=0
while read -r f; do
  if [ ! -f "$f" ]; then echo "   ⚠️  manca in locale: $f"; DIVERSI=1; continue; fi
  if ! git show "origin/main:$f" 2>/dev/null | cmp -s - "$f"; then
    echo "   ⚠️  diverso da GitHub: $f"; DIVERSI=1
  fi
done < <(git ls-tree -r --name-only origin/main)

if [ "$DIVERSI" = "1" ]; then
  echo
  echo "❌ Ci sono file diversi da GitHub (elencati sopra)."
  echo "   Mi fermo qui per non sovrascriverli: fammi sapere e li guardiamo insieme."
  exit 1
fi
echo "   ok — nessuna differenza, si puo' procedere"

echo
echo "→ 4/4  Riallineo il repo a origin/main"
git reset --hard origin/main

echo
echo "✅ Fatto. Stato attuale:"
git log --oneline -1
git status --short --branch

cat <<'FINE'

PROSSIMO PASSO — le credenziali di push
Il repo ora e' allineato, ma per fare `git push` serve autenticarsi con GitHub.
Il modo piu' semplice, dal Terminale:

    brew install gh      # solo se non hai gia' GitHub CLI
    gh auth login        # scegli: GitHub.com → HTTPS → Login with a web browser

Segui il browser, incolla il codice che ti mostra, e da quel momento
`git push` funziona da qui senza altre configurazioni.

Nota: le credenziali le inserisci tu, io non le vedo e non le tocco.
FINE
