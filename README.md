# 🤖 AI Agents — Dario Angeloro

App web con 7 assistenti AI personali: Bea, Carmine, Vlad, Bruno, Mario, Mimmo, Virgilio.

---

## 🚀 DEPLOY SU VERCEL — Guida passo passo

### STEP 1 — Crea account GitHub
1. Vai su **github.com**
2. Clicca "Sign up" e crea l'account
3. Verifica l'email

### STEP 2 — Carica il progetto su GitHub
1. Clicca il tasto **"+"** in alto a destra → "New repository"
2. Nome: `dario-ai-agents`
3. Lascia tutto il resto di default → clicca **"Create repository"**
4. Nella pagina del repo, clicca **"uploading an existing file"**
5. Trascina TUTTI i file e le cartelle di questo progetto
6. Clicca **"Commit changes"**

### STEP 3 — Crea account Vercel
1. Vai su **vercel.com**
2. Clicca "Sign Up" → scegli "Continue with GitHub"
3. Autorizza Vercel ad accedere a GitHub

### STEP 4 — Importa il progetto su Vercel
1. Dal dashboard Vercel, clicca **"Add New Project"**
2. Trova `dario-ai-agents` nella lista e clicca **"Import"**
3. Framework: lascia **Next.js** (viene rilevato automaticamente)
4. Clicca **"Environment Variables"** e aggiungi:
   - Nome: `ANTHROPIC_API_KEY`
   - Valore: la tua API key di Anthropic (da console.anthropic.com)
5. Clicca **"Deploy"**

### STEP 5 — Aspetta il deploy (2-3 minuti)
Vercel costruisce l'app automaticamente. Quando finisce hai un link tipo:
`https://dario-ai-agents.vercel.app`

---

## ⚙️ CONFIGURAZIONE NELL'APP

Una volta aperta l'app, vai su **Impostazioni** e inserisci:
- **ClickUp API Key**: da app.clickup.com → Impostazioni → Apps → API Token
- **Google Calendar API Key**: da console.cloud.google.com (opzionale)
- **Google Calendar ID**: la tua email Gmail (opzionale)

Le impostazioni vengono salvate automaticamente nel browser.

---

## 🔑 DOVE TROVARE L'ANTHROPIC API KEY

1. Vai su **console.anthropic.com**
2. Accedi o crea un account
3. Vai su "API Keys" → "Create Key"
4. Copia la chiave e incollala in Vercel (Step 4)

---

## 📱 ACCESSO DA MOBILE

Apri il link Vercel dal browser del telefono (Chrome o Safari).
L'app è ottimizzata per mobile con bottom navigation.

Per aggiungere l'icona alla schermata home:
- **iPhone**: Safari → tasto Condividi → "Aggiungi a schermata Home"
- **Android**: Chrome → menu tre puntini → "Aggiungi a schermata Home"

---

## 🔄 AGGIORNAMENTI FUTURI

Quando vuoi modificare l'app:
1. Modifica i file localmente
2. Carica su GitHub (sovrascrivendo i file vecchi)
3. Vercel si aggiorna automaticamente in 1-2 minuti

---

## 📁 STRUTTURA FILE

```
app/
├── page.jsx              → App principale (componente React)
├── layout.jsx            → Layout HTML base
└── api/
    ├── chat/route.js     → API Anthropic (server-side)
    ├── clickup/route.js  → API ClickUp tasks (server-side)
    ├── clickup-doc/route.js → API ClickUp documenti (server-side)
    └── calendar/route.js → API Google Calendar (server-side)
```
