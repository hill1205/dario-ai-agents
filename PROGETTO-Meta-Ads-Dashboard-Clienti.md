# Meta Ads Dashboard per Clienti — Documento di Progetto

**Data:** 7 agosto 2026
**Autore:** Dario Angeloro (Imperivm / IAGREX SRL)
**Stato:** Progettazione — pre-sviluppo

> ⚠️ Questo file è temporaneamente dentro il repo `dario-ai-agents`. Va spostato nel nuovo repo appena creato. Non fa parte della dashboard personale.

---

## 1. Sintesi esecutiva

Prodotto: una dashboard web che ogni cliente dell'agenzia apre col proprio login e vede l'andamento delle sue campagne Meta — spesa, risultati, campagne attive, creative migliori e peggiori — più un commento in linguaggio naturale generato da AI che spiega cosa sta funzionando e cosa va cambiato.

Non è un'estensione di *Dario AI Agents*. È un prodotto separato: repo separato, dominio separato, database separato, progetto Claude separato. L'unica cosa in comune è l'account Vercel.

**La differenza sostanziale rispetto alla dashboard personale:** lì c'è un utente (tu) e lo storage può essere improvvisato. Qui ci sono N clienti che devono vedere **solo** i propri dati. Serve autenticazione vera e database vero fin dal primo giorno.

---

## 2. Inventario degli accessi Meta (verificato il 07/08/2026)

### Situazione reale

Gli account pubblicitari sono distribuiti su **due profili Facebook personali diversi**.

**Profilo A**
| Account | ID | Dove si trova |
|---|---|---|
| tenace.ricambi.accessori | 102806816516207 | Altre risorse (accesso personale) |
| (senza nome) | 286831064 | Altre risorse (accesso personale) |
| Centro Scarpe Sport | 38541410 | Altre risorse (accesso personale) |

Portfolio business visibili: Europa Hotel Vasto, campoutel, casainweb.it, dario.marketing, tubedigitalmoney, WHIGRE — **tutti con 0 account pubblicitari collegati**.

**Profilo B (Dario Angeloro)**
| Account | ID | Dove si trova |
|---|---|---|
| Anna Author #1 | 284335652991842 | Portfolio **"Imperivm Agency"** — *Owned by Anna A.* (condiviso come partner) |
| Imperivm#1 | 267307911284284 | Portfolio **"Imperivm Agency"** — di proprietà |
| Studio Cordone | 1172312687441044 | Portfolio "Dario Angeloro" |
| funnel imperivm | 3620945488218818 | Portfolio "Dario Angeloro" |
| (personale) | 1119057168481160 | Il tuo account |

Portfolio con 0 account: Da Angeloro, Dr. Vincenzo Cordone|DDS, Sima Ecologia SRL.

**Nota importante:** "Anna Author #1" è marcato *Owned by Anna A.* — cioè è di proprietà del cliente e **condiviso come partner** con Imperivm Agency. È esattamente l'assetto target descritto al §9. Significa che la procedura di onboarding l'hai già eseguita almeno una volta e funziona: non è teoria.

### Cosa implica, tecnicamente

Un **System User token** (quello che non scade mai e non richiede manutenzione) può leggere **solo** gli ad account posseduti o condivisi con il Business Portfolio a cui il system user appartiene. Non vede nulla di ciò che sta sotto "Altre risorse" o sotto accessi personali.

Quindi, allo stato attuale:

| Categoria | Quanti | Strategia token |
|---|---|---|
| Dentro "Imperivm Agency" | 2 (Anna Author #1, Imperivm#1) | ✅ System User — permanente, pronto oggi |
| Dentro "Dario Angeloro" | 2 (Studio Cordone, funnel imperivm) | ✅ System User su quel portfolio, oppure migrare in Imperivm Agency |
| "Il tuo account" (Profilo B) | 1 | ⚠️ User token, o migrare |
| Sotto "Altre risorse" (Profilo A) | 3 | ⚠️ User token, scade ogni 60gg — **da migrare** |

**Totale: 8 ad account, di cui 4 già pronti per il System User.**

Il pilota si fa su **Imperivm Agency**: crei lì il system user, generi il token permanente, e da subito hai 2 account leggibili senza alcuna scadenza. Gli altri 4 si migrano quando vuoi, senza fretta e senza bloccare lo sviluppo.

**Conclusione operativa:** si parte con user token (funziona oggi, zero burocrazia) e in parallelo si consolidano gli account dentro Imperivm Agency, che è l'assetto definitivo.

### Assetto target (deciso l'08/08/2026)

Riorganizzazione su **due Business Manager separati**, sul profilo Dario Angeloro:

| BM | Contenuto | Meta App dedicata |
|---|---|---|
| **Imperivm Agency** (`112986636922418`) | Estetica: account botulino/filler `1119057168481160`, Studio Cordone `1172312687441044`, Imperivm#1 | `Imperivm Dashboard – Estetica` |
| **BM Tenace** (da definire) | tenace.ricambi.accessori `102806816516207` | `Imperivm Dashboard – Tenace` |

**Perché separati:** l'estetica è una nicchia ad alto rischio di sanzione (claim sui risultati, foto prima/dopo, categoria salute). Un ban su quel BM non deve trascinare il cliente e-commerce.

**Limite da conoscere:** la compartimentazione protegge da ban a livello di ad account o BM (il caso frequente), **non** da un ban sul profilo personale, che li abbatte entrambi. La contromisura è avere **due amministratori** su ogni BM (i due profili Facebook di Dario), così se un profilo cade l'altro mantiene il controllo.

### ✅ Stato configurazione Meta al 08/08/2026 — COMPLETATA

| Elemento | Valore |
|---|---|
| **Business Manager** | Imperivm Agency — ID `112986636922418` |
| **Meta App** | `Imperivm Dashboard` — ID `1002165866138434` — stato: **Non pubblicata** (Development) |
| **Caso d'uso app** | "Crea e gestisci le inserzioni con l'API Marketing" |
| **System User** | `dashboard-reader`, ruolo Amministratore, ID `61592628635648` |
| **Token** | Generato, scadenza **Mai**. Permessi: `ads_read`, `ads_management`, `business_management` |
| **Ad account collegato** | `Dr.ssa Eleonora` — ID `267307911284284` — di proprietà di Imperivm Agency, EUR |
| **Secondo ad account** | `1119057168481160` — *risorsa controllata da singole persone*, contiene lo storico (52 campagne). Non più usato per campagne nuove. |
| **Chiave segreta app** | Da recuperare in Impostazioni app → Di base |

**Decisione operativa:** le campagne nuove dell'estetica girano su `Dr.ssa Eleonora` (267307911284284), che è posseduto dal BM → token permanente, nessun piano B necessario. Il vecchio account resta come archivio storico e si potrà collegare alla dashboard più avanti (stesso `client_id`, così i dati si sommano).

**Da completare su Meta:**
- [ ] Metodo di pagamento su `Dr.ssa Eleonora`
- [ ] Verifica fuso orario = `Europe/Rome` (irreversibile dopo la prima spesa)
- [ ] Pagina Facebook / account Instagram accessibili dal BM
- [ ] Upgrade del secondo profilo Facebook ad **Accesso completo** su Imperivm Agency (ora è "Base")
- [ ] BM separato per Tenace + seconda Meta App
- [ ] Uscita dai BM di clienti non più attivi (igiene, non urgente)

**Aperto:** struttura definitiva dei BM — per cliente (non scala, Meta limita la creazione di BM) vs per rischio/settore (consigliato: Medical / Commerce). Da decidere prima di creare il BM di Tenace.

**Anagrafica chiarita:** la cliente dell'estetica è **Dr.ssa Eleonora** (filler, labbra). "Dr. Vincenzo Cordone | DDS" è un BM separato con 0 account. Anna Author #1 è stata rimossa dalla condivisione.

### Il punto sulla App Review

Contrariamente a quanto si legge in giro, per la v1 **non serve l'App Review di Meta**:

- Crei una Meta App in modalità Development su `developers.facebook.com`
- Tu sei admin dell'app
- Con `ads_read` in Standard Access, l'app può leggere tutti gli ad account su cui **l'utente che ha generato il token** ha un ruolo

App Review + Business Verification servono solo quando vuoi che utenti terzi (che non hanno un ruolo nella tua app) facciano "Connetti Facebook" da soli. Cioè quando vendi il prodotto a chi non gestisci tu. **Fase 3, non fase 1.**

---

## 3. Decisioni di infrastruttura

| Elemento | Decisione | Motivo |
|---|---|---|
| **Repo GitHub** | Nuovo: `imperivm-client-dashboard` | Isolamento totale dalla dashboard personale. Un domani è cedibile/mostrabile a un dev senza esporre le tue finanze. |
| **Hosting** | Stesso account Vercel, progetto nuovo | Progetti Vercel sono indipendenti: dominio, env var e deploy separati. Nessun rischio di contaminazione. |
| **Progetto Claude/Cowork** | Nuovo, cartella nuova | Il contesto attuale (ClickUp, Notion, IAGREX, obiettivo 1M€) è rumore che porta a scelte sbagliate su un prodotto multi-cliente. |
| **Dominio** | Nuovo, es. `dashboard.imperivm.it` o `report.imperivm.it` | Percezione di prodotto professionale, non di "tool interno di Dario". |
| **Database** | Postgres su Neon (o Supabase) | Serve isolamento dei dati per cliente. Lo storage-in-ClickUp qui non è accettabile: se un cliente vede i dati di un altro è un problema legale, non un bug. |
| **Auth** | Clerk | Multi-tenant funzionante in mezza giornata invece che in una settimana. |
| **Framework** | Next.js (App Router) | Già lo conosci. Nessuna curva di apprendimento. |

---

## 4. Architettura

```
        NOTTE (Vercel Cron, 1 volta al giorno)
        ┌─────────────────────────────────────┐
        │  /api/cron/sync                     │
        │  per ogni ad_account attivo:        │
        │   1. GET insights (campagna)        │
        │   2. GET insights (ad/creative)     │
        │   3. scrive su Postgres             │
        │   4. genera commento AI e lo salva  │
        └─────────────────────────────────────┘
                        │
                        ▼
                 ┌────────────┐
   Meta Graph API │  POSTGRES  │  Claude API
        ▲         └────────────┘      ▲
        │                │            │
        └────────────────┼────────────┘
                         ▼
        GIORNO (il cliente apre la dashboard)
        ┌─────────────────────────────────────┐
        │  Clerk verifica chi è               │
        │  → legge SOLO dal database          │
        │  → nessuna chiamata a Meta          │
        │  → caricamento istantaneo           │
        └─────────────────────────────────────┘
```

**Principio non negoziabile: la dashboard non chiama mai Meta in tempo reale.** Motivi:
1. La Marketing API è lenta (2–10 secondi per query pesante)
2. Ha rate limit severi per ad account
3. Se un cliente ricarica la pagina 20 volte, bruci il budget di chiamate
4. Il commento AI costerebbe soldi a ogni refresh

Il cliente vede dati "di ieri sera". Per un report cliente è più che sufficiente — anzi, è il comportamento corretto: i dati Meta della giornata in corso sono comunque parziali e attribuiti male.

Opzionale in fase 2: bottone "Aggiorna ora" con limite di 1 volta all'ora per cliente.

---

## 5. Modello dati (schema iniziale)

```sql
-- Chi paga e chi vede cosa
clients (
  id, name, slug, logo_url, created_at, active
)

-- Utenti che possono loggarsi (mappati a Clerk)
users (
  id, clerk_id, client_id, email, role  -- role: 'client' | 'admin'
)

-- Le connessioni Meta: UNA PER BUSINESS MANAGER, non per cliente
meta_connections (
  id, label,                       -- es. 'BM Estetica', 'BM Tenace'
  business_id,                     -- ID del Business Manager
  app_id, app_secret_encrypted,    -- credenziali della Meta App DI QUEL BM
  token_type,                      -- 'user' | 'system_user'
  access_token_encrypted, expires_at, last_ok_at
)

-- Gli ad account, legati sia al cliente sia alla connessione
ad_accounts (
  id, client_id, connection_id,
  meta_account_id, name, currency, timezone, active
)

-- Snapshot giornaliero per campagna
campaign_daily (
  ad_account_id, campaign_id, campaign_name, objective,
  date, spend, impressions, reach, clicks, ctr, cpc, cpm,
  results, result_type, cost_per_result,
  purchases, purchase_value, roas,       -- NULL se non tracciato
  leads, cost_per_lead,                  -- NULL se non applicabile
  PRIMARY KEY (campaign_id, date)
)

-- Snapshot giornaliero per creativa
creative_daily (
  ad_account_id, campaign_id, ad_id, ad_name,
  thumbnail_url, creative_type,          -- 'image' | 'video' | 'carousel'
  date, spend, impressions, clicks, ctr,
  results, cost_per_result, roas,
  PRIMARY KEY (ad_id, date)
)

-- Il commento AI, uno per cliente per giorno
ai_insights (
  client_id, date, period,               -- '7d' | '30d'
  verdict,                               -- 'buono' | 'attenzione' | 'critico'
  summary_text, actions_json, generated_at
)

-- Diagnostica: se una sync fallisce devi saperlo tu, non il cliente
sync_logs (
  id, ad_account_id, started_at, finished_at, status, error_message
)
```

**Nota su `meta_connections` separata da `clients`:** è la conseguenza diretta della strategia di compartimentazione. Ogni Business Manager è una connessione a sé, con la **propria Meta App e il proprio token**. Una connessione serve più clienti; un cliente può teoricamente avere account su connessioni diverse.

**Perché una Meta App per BM e non una sola condivisa:** un'app appartiene a un solo Business Manager. Condividerla tra i due BM li ricollega agli occhi di Meta, annullando l'isolamento anti-ban che è il motivo stesso della separazione. Due app, due token, zero fili tra i due mondi. Per il codice è identico: cicla sulla tabella `meta_connections`.

**Sicurezza:** il token va cifrato a riposo (AES tramite una chiave in env var). Ogni query deve filtrare per `client_id` derivato dalla sessione Clerk, **mai** da un parametro nell'URL.

---

## 6. Il problema del ROAS — e la soluzione

### Cosa ho osservato nei dati reali

| Cliente | Metrica "Risultati" | ROAS disponibile? |
|---|---|---|
| tenace.ricambi.accessori | Clic sul link (€0,01–0,08) | ❌ No |
| Account 1119057168481160 | Visite al profilo Instagram (€0,05) | ❌ No |

Le campagne sono ottimizzate per traffico e visite al profilo, non per acquisti. Senza pixel che trasmette il valore della conversione, **Meta restituisce `purchase_roas` vuoto**. Non è un bug: quel dato non esiste.

### Conseguenza di prodotto

Se la dashboard è costruita attorno al ROAS come metrica principale, per la maggior parte dei tuoi clienti attuali la schermata principale sarà vuota e sembrerà rotta. È il modo più veloce per bruciare la credibilità del prodotto al primo utilizzo.

### Soluzione: metriche adattive per obiettivo

La dashboard legge l'`objective` della campagna e mostra il set di metriche corrispondente:

| Obiettivo campagna | KPI principale | KPI secondari |
|---|---|---|
| `OUTCOME_SALES` | **ROAS** | Acquisti, Costo per acquisto, Valore totale |
| `OUTCOME_LEADS` | **Costo per lead** | Lead totali, Tasso di conversione |
| `OUTCOME_TRAFFIC` | **CPC** | Clic, CTR, Costo per landing page view |
| `OUTCOME_ENGAGEMENT` | **Costo per interazione** | Visite al profilo, Interazioni |
| `OUTCOME_AWARENESS` | **CPM** | Copertura, Impression, Frequenza |

Regola sempre valida: **spesa, impression, CTR e frequenza** si mostrano per tutti.

Come bonus commerciale: quando un cliente ha campagne vendita senza tracciamento valore, la dashboard mostra un banner *"Attiva il tracciamento delle conversioni per vedere il ROAS"* — che è un'opportunità di upsell per te.

---

## 7. Il commento AI

Generato dal cron notturno, salvato, mai calcolato live.

**Input al modello:** dati aggregati degli ultimi 7 e 30 giorni, confronto col periodo precedente, top 3 e bottom 3 creative, obiettivo delle campagne, budget giornaliero.

**Output richiesto (JSON strutturato):**
```json
{
  "verdict": "attenzione",
  "summary": "Nelle ultime 2 settimane la spesa è salita del 18% ma i clic sono scesi del 6%. Il CPC è passato da €0,04 a €0,05...",
  "actions": [
    "Metti in pausa la creativa 'Video Ottobre': ha speso €47 con CTR dello 0,4%, sotto la media del tuo account",
    "La creativa 'Carosello Ricambi' ha il CPC più basso — vale la pena aumentarne il budget"
  ]
}
```

**Regole per il prompt:**
- Non inventare ROAS o conversioni se il dato è `null` — dichiarare esplicitamente al modello quali campi sono assenti
- Linguaggio da imprenditore, non da media buyer: niente "CPM", "frequency capping", "attribution window" senza spiegazione
- Massimo 3 azioni concrete, ognuna con un numero a supporto
- Tono onesto: se va male, dirlo. Un cliente che scopre da solo che i dati erano abbelliti non torna.

**Costo:** con Haiku, frazioni di centesimo per cliente al giorno. Con Sonnet, qualche centesimo. Anche con 50 clienti resta sotto i 10€/mese.

---

## 8. Schermate

**Home cliente**
- Header con logo del cliente e selettore periodo (7 / 30 / 90 giorni, personalizzato)
- 4 card grandi: Spesa, Risultati, Costo per risultato, KPI principale (adattivo)
- Ogni card con variazione % rispetto al periodo precedente e freccia colorata
- Grafico andamento spesa vs risultati nel tempo
- **Box commento AI** — verdetto colorato + testo + azioni consigliate
- Tabella campagne, ordinabile

**Dettaglio campagna**
- Metriche della campagna
- Griglia creative con anteprima immagine/video
- Ordinamento per performance, badge "migliore" e "da rivedere"

**Area admin (solo tu)**
- Elenco clienti, stato delle sync, ultimo aggiornamento
- Gestione connessioni Meta e scadenza token
- Assegnazione ad account → cliente
- Possibilità di rileggere e correggere il commento AI prima che il cliente lo veda (fase 2)

Nota sui grafici: coerente con la tua preferenza già espressa — **valori e date sempre leggibili sui punti**, non solo la forma della curva.

---

## 9. Procedura di onboarding di un cliente nuovo

Da eseguire una volta per cliente, ~5 minuti:

1. Il cliente va su `business.facebook.com` → Impostazioni azienda → Partner → **Aggiungi partner**
2. Inserisce l'ID del tuo Business Portfolio "Imperivm Agency"
3. Assegna l'ad account con permesso **"Visualizza le performance"** (basta la lettura — non chiedere permessi di gestione se non ti servono, aumenta la diffidenza)
4. Tu, nell'area admin: crei il cliente, colleghi l'ad account, inviti l'email
5. Il cliente riceve l'invito Clerk e imposta la password

Dal punto 3 in poi il System User legge automaticamente. Nessun token da rinnovare.

**Per i 3 account sotto "Altre risorse" del Profilo A:** vanno migrati con questa stessa procedura, altrimenti restano dipendenti da un token che scade ogni 60 giorni.

---

## 10. Roadmap

### Fase 0 — Validazione tecnica (mezza giornata) ← **si parte da qui**
Un singolo script, nessun framework, nessun database.
- Creare la Meta App su developers.facebook.com
- Generare un token con `ads_read` dal Graph API Explorer
- Script che chiama `/act_{id}/insights` su un account reale e stampa spesa, impression, clic, CTR
- Estendere a livello `ad` con thumbnail delle creative

**Criterio di successo:** vedere a schermo i dati veri di tenace.ricambi. Se questo non funziona, tutto il resto è inutile — ed è meglio scoprirlo oggi che tra tre settimane.

### Fase 1 — MVP mono-cliente (2–3 giorni)
- Scaffold Next.js + Neon + Clerk
- Schema database
- Cron di sync su 1 ad account
- Home dashboard con metriche adattive
- Commento AI

**Criterio di successo:** apri l'URL, fai login, vedi i dati di un cliente reale aggiornati stanotte.

### Fase 2 — Multi-cliente (2–3 giorni)
- Tabelle clients/users, isolamento dati
- Area admin
- Gestione connessioni multiple (i due profili Facebook)
- Dettaglio campagna + griglia creative
- Dominio + branding

**Criterio di successo:** un cliente reale ci entra e lo trova utile.

### Fase 3 — Prodotto vendibile (da valutare dopo)
- Business Verification + App Review per `ads_read`
- Login "Connetti Facebook" self-service
- White label per cliente (logo, colori)
- Report PDF automatico mensile via email
- Eventuale abbonamento

Solo se le fasi 1 e 2 dimostrano che i clienti lo usano davvero.

---

## 11. Costi

| Voce | Fase 1–2 | A 20 clienti |
|---|---|---|
| Vercel | 0€ (Hobby) | ~20€/mese (Pro, necessario per cron frequenti) |
| Neon Postgres | 0€ (free tier) | ~19€/mese |
| Clerk | 0€ (fino a 10k utenti) | 0€ |
| Claude API | ~1€/mese | ~5€/mese |
| Dominio | ~12€/anno | ~12€/anno |
| **Totale** | **~1€/mese** | **~45€/mese** |

Se un giorno lo vendi a 30€/cliente/mese, va in pari al secondo cliente.

---

## 12. Rischi e come si mitigano

| Rischio | Impatto | Mitigazione |
|---|---|---|
| Token utente scade ogni 60gg | Dashboard vuota all'improvviso | Alert automatico via Telegram (bot già esistente) 7 giorni prima. Migrazione a System User. |
| Un cliente vede i dati di un altro | **Grave** — legale, non tecnico | `client_id` sempre dalla sessione, mai dall'URL. Test dedicato prima di dare accesso a chiunque. |
| Rate limit Meta | Sync incomplete | 1 sync al giorno, chiamate sequenziali con pausa, retry con backoff |
| Commento AI dice cose sbagliate | Perdita di fiducia del cliente | Fase 2: revisione manuale prima della pubblicazione. Prompt che vieta di inferire su dati `null`. |
| Meta cambia la API | Rottura improvvisa | Versione della Graph API fissata nel codice, non "latest". Log di ogni sync fallita. |
| Il cliente non capisce le metriche | Prodotto inutile | Tooltip su ogni metrica, linguaggio non tecnico nel commento AI |

---

## 13. Decisioni ancora aperte

1. ~~Contenuto del portfolio "Imperivm Agency"~~ ✅ risolto: Anna Author #1 + Imperivm#1
2. **Nome e dominio del prodotto** — `dashboard.imperivm.it`? Nome proprio?
3. **Quale cliente per il pilota** — serve un cliente con campagne attive e che ti dia feedback onesto
4. **Neon o Supabase** — Neon è più semplice, Supabase include auth e storage se dovessero servire
5. **Il cliente può vedere le creative?** — mostrare le immagini degli annunci è potente ma richiede di scaricare/proxare le thumbnail Meta, che scadono

---

## 14. Il prossimo passo, uno solo

La configurazione Meta è **fatta** (vedi §2). Resta la parte tecnica.

**Fase 0 — da eseguire nel nuovo progetto Cowork:**

Uno script che chiama la Graph API con il token del system user e stampa i dati veri di `Dr.ssa Eleonora` (267307911284284): spesa, impression, clic, CTR per campagna. Poi lo stesso a livello di inserzione, con le thumbnail delle creative.

Endpoint di partenza:
```
GET https://graph.facebook.com/v21.0/act_267307911284284/insights
    ?level=campaign
    &fields=campaign_name,objective,spend,impressions,clicks,ctr,cpc,actions
    &date_preset=last_30d
    &access_token=<TOKEN>
```

⚠️ Il token va in una variabile d'ambiente o in un file `.env.local` **gitignorato**. Mai nel codice, mai in chat, mai in un commit.

**Criterio di successo:** vedere a schermo i numeri reali delle campagne. Da lì in poi il resto del documento smette di essere ipotesi.

---

## 15. Setup del nuovo progetto (da fare prima di tutto)

Questo documento è nato dentro il repo `dario-ai-agents`. **Va spostato.**

1. Crea una cartella nuova sul Mac, fuori da `dario-ai-agents` — es. `~/imperivm-dashboard`
2. Sposta lì questo file
3. Crea un **progetto Cowork nuovo** collegato a quella cartella, con istruzioni proprie (niente contesto ClickUp/Notion/finanze personali: su un prodotto multi-cliente porta a scelte sbagliate)
4. Da lì: repo GitHub nuovo, progetto Vercel nuovo, e Fase 0
