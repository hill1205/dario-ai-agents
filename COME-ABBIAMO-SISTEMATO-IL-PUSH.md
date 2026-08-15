# Come abbiamo sistemato il push su GitHub — 11 agosto 2026

> Nota per l'altro progetto: copia e incolla tutto questo testo nella chat.
> La chiave SSH esiste già ed è già registrata su GitHub, quindi lì serve
> **solo** cambiare il remote. Non va rigenerata nessuna chiave.

---

## Il problema

`git push origin main` falliva con:

```
remote: Permission to hill1205/<repo>.git denied to hill1205.
fatal: unable to access 'https://github.com/hill1205/<repo>.git/':
The requested URL returned error: 403
```

Errore fuorviante: GitHub riconosceva l'account (`denied to **hill1205**`, non "invalid token"), ma negava la scrittura.

## La causa vera

Il remote era in **HTTPS**, e su macOS le credenziali HTTPS stanno nel Portachiavi. Il Portachiavi conserva **una sola credenziale per `github.com`**, non una per repository.

Avendo più progetti, era stato creato un Personal Access Token *fine-grained* limitato a un solo repo. Quel token ha sovrascritto nel Portachiavi quello precedente. Risultato: GitHub autenticava correttamente l'account, ma il token era autorizzato solo sull'altro repository → 403 su questo.

**È un problema strutturale, non un caso isolato:** con token per-repo e più progetti attivi, ogni nuovo token rompe il progetto precedente. Si continua a rincorrere il problema avanti e indietro.

## La soluzione: SSH

Le chiavi SSH sono legate all'**account**, non al singolo repository. Una sola chiave copre tutti i repo presenti e futuri, e non scade.

### Passo 1 — creare la chiave e copiarla (già fatto, non ripetere)

```
[ -f ~/.ssh/id_ed25519 ] || ssh-keygen -t ed25519 -C "dario" -f ~/.ssh/id_ed25519 -N ""; pbcopy < ~/.ssh/id_ed25519.pub && echo "✅ Chiave copiata"
```

Il comando è idempotente: se la chiave esiste già non la ricrea, la copia soltanto.

### Passo 2 — registrarla su GitHub (già fatto, non ripetere)

Su `github.com/settings/ssh/new`:
- Title: `MacBook Air Dario`
- Key type: `Authentication Key`
- Key: incollare con Cmd+V

Fingerprint della chiave registrata:
`SHA256:hMTPZw0S6s+X7oAGv4hcKUv5EnWoklnEsJQLOz/qGpE`

### Passo 3 — passare il repo da HTTPS a SSH ⬅️ **questo va rifatto per ogni repo**

```
cd ~/<cartella-del-progetto> && git remote set-url origin git@github.com:hill1205/<nome-repo>.git && GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new" git push origin main
```

`StrictHostKeyChecking=accept-new` serve solo la prima volta: accetta l'impronta del server GitHub senza chiedere conferma interattiva.

Esito atteso:

```
To github.com:hill1205/<nome-repo>.git
   abc1234..def5678  main -> main
```

## Da adesso in poi

Il push è semplicemente:

```
cd ~/<cartella-del-progetto> && git push origin main
```

Nessun username, nessuna password, nessun token. E non si rompe più quando si aggiunge un altro progetto.

## Cosa NON fare più

- Non creare Personal Access Token per singolo repository: si sovrascrivono a vicenda nel Portachiavi
- Non usare `git credential-osxkeychain erase` per "sistemare": cancella la credenziale e basta, non risolve
- Non lasciare remote in HTTPS su nessun progetto: prima o poi darà lo stesso 403

## Se il repo ha `.git` con problemi di lock

Sintomo: `git status` mostra come cancellati file che invece esistono, e compaiono warning `unable to unlink '.git/index.lock': Operation not permitted`.

Dal Mac (non dal sandbox) si risolve con:

```
cd ~/<cartella-del-progetto> && rm -f .git/HEAD.lock .git/index.lock .git/refs/heads/main.lock && git reset
```

`git reset` senza argomenti riallinea solo l'indice a HEAD: **non tocca i file** su cui stai lavorando.
