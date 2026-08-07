export const dynamic = "force-dynamic";
export const revalidate = 0;

// Trasporto HTTP per il percorso di apprendimento. Le regole (cosa serve
// per alzare il livello, come si deriva il livello attuale, la serie del
// grafico) stanno in lib/learning-store.js.

import {
  datiApprendimento,
  creaArgomento,
  aggiornaArgomento,
  aggiungiSessione,
  salvaProgresso,
  rispondiDomanda,
  eliminaArgomento,
  normalizzaEstrazione,
} from "../../lib/learning-store";

const errore = (esito) =>
  Response.json({ error: esito.errore }, { status: esito.status || 400 });

export async function GET() {
  try {
    return Response.json(await datiApprendimento());
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// ── Estrazione dal testo incollato ──────────────────────────────────────
//
// COSA FA E COSA NON FA. Non va a prendere niente da nessuna parte: le API
// dei chatbot non espongono la cronologia delle conversazioni, quindi
// l'app non puo' "importare l'ultima chat" da sola. Quello che fa e'
// leggere il testo che Dario ha copiato e incollato a mano, e smistarlo
// nei campi giusti. Il lavoro tolto e' la ricopiatura, non il copia-incolla.
//
// Haiku e non un modello piu' grande: e' un compito di estrazione
// strutturata su testo gia' scritto, non di ragionamento. Stesso modello
// che usa gia' il bot Telegram, costo trascurabile.
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

const PROMPT = `Ricevi il testo di una conversazione o di un articolo che l'utente ha letto e vuole archiviare nel suo percorso di apprendimento personale.

Estrai le informazioni e rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo, senza blocchi di codice markdown.

Struttura richiesta:
{
  "titolo": "titolo breve e specifico dell'argomento (max 100 caratteri)",
  "categoria": "una sola parola o due: es. Marketing, Finanza, Psicologia, Tecnologia, Vendita, Filosofia",
  "perche": "perché può interessare a chi costruisce un'agenzia di marketing e vuole crescere, 1-2 frasi",
  "concetti": ["concetto fondamentale 1", "concetto 2", "..."],
  "applicazioni": ["come si applica in pratica 1", "..."],
  "risorse": [{"titolo": "nome della risorsa citata", "url": "link se presente nel testo, altrimenti stringa vuota"}],
  "domande": ["domanda rimasta aperta o da approfondire", "..."],
  "appunti": "riassunto dei punti principali in forma discorsiva, 5-15 righe"
}

REGOLE IMPORTANTI:
- Rispondi in italiano.
- NON inventare risorse, link o dati che non sono nel testo. Se non ci sono risorse, restituisci un array vuoto.
- I "concetti" sono le idee che bisogna aver capito, non un riassunto spezzettato. Da 3 a 8 elementi, ognuno una frase autonoma.
- Le "applicazioni" sono azioni concrete, non principi generali.
- Le "domande" sono cose che il testo lascia irrisolte o che meritano approfondimento. Se il testo è esaustivo, restituisci un array vuoto invece di inventarne.
- Se il testo è troppo corto o confuso per estrarre qualcosa di sensato, restituisci comunque il JSON con i campi che riesci a riempire e gli altri vuoti.`;

// Il testo incollato puo' essere una conversazione lunga. 60k caratteri
// sono circa 15k token: abbondanti per una chat, e sotto qualsiasi limite
// di contesto. Tagliare qui evita di spedire per sbaglio mezzo libro.
const MAX_INPUT = 60000;

async function estrai(testo) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, status: 500, errore: "ANTHROPIC_API_KEY non configurata su Vercel." };
  }
  const pulito = String(testo || "").trim().slice(0, MAX_INPUT);
  if (pulito.length < 40) {
    return { ok: false, status: 400, errore: "Incolla un testo un po' più lungo: così com'è non c'è niente da estrarre." };
  }

  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2500,
        system: PROMPT,
        messages: [{ role: "user", content: pulito }],
      }),
    });
  } catch (e) {
    return { ok: false, status: 502, errore: `Non sono riuscito a contattare Claude: ${e.message}` };
  }

  if (!res.ok) {
    const dettaglio = await res.text().catch(() => "");
    return { ok: false, status: 502, errore: `Claude ha risposto ${res.status}. ${dettaglio.slice(0, 200)}` };
  }

  const data = await res.json();
  const testoRisposta = (data.content || []).map((b) => b.text || "").join("").trim();

  // Il modello a volte incarta il JSON in ```json ... ``` nonostante le
  // istruzioni. Invece di fallire, si estrae il primo oggetto graffato:
  // costa tre righe e trasforma un errore visibile in un non-problema.
  let grezzo;
  try {
    const senzaFence = testoRisposta.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const inizio = senzaFence.indexOf("{");
    const fine = senzaFence.lastIndexOf("}");
    grezzo = JSON.parse(inizio >= 0 && fine > inizio ? senzaFence.slice(inizio, fine + 1) : senzaFence);
  } catch {
    return { ok: false, status: 502, errore: "Claude non ha risposto con un JSON leggibile. Riprova, o compila il form a mano." };
  }

  return { ok: true, estratto: normalizzaEstrazione(grezzo) };
}

// L'estrazione NON salva niente: restituisce i campi compilati e basta.
// Il salvataggio resta un secondo gesto esplicito, dopo che Dario ha letto
// e corretto — un'estrazione automatica che scrive da sola nell'archivio
// riempirebbe il percorso di roba che nessuno ha mai riletto.
export async function POST(request) {
  try {
    const body = await request.json();

    if (body.azione === "estrai") {
      const esito = await estrai(body.testo);
      if (!esito.ok) return errore(esito);
      return Response.json({ success: true, estratto: esito.estratto });
    }

    const esito = await creaArgomento(body);
    if (!esito.ok) return errore(esito);
    return Response.json({ success: true, argomento: esito.argomento });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

//   azione "sessione"  → aggiunge appunti datati
//   azione "progresso" → cambia il livello (con spiegazione se sale)
//   azione "domanda"   → risponde a una domanda aperta
//   (nessuna azione)   → aggiorna i campi descrittivi
export async function PATCH(request) {
  try {
    const body = await request.json();
    const { id, azione } = body;
    if (!id) return Response.json({ error: "id mancante" }, { status: 400 });

    let esito;
    if (azione === "sessione")       esito = await aggiungiSessione(id, body);
    else if (azione === "progresso") esito = await salvaProgresso(id, body);
    else if (azione === "domanda")   esito = await rispondiDomanda(id, body.indice, body.risposta);
    else                             esito = await aggiornaArgomento(id, body);

    if (!esito.ok) return errore(esito);
    return Response.json({ success: true, argomento: esito.argomento });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return Response.json({ error: "id mancante" }, { status: 400 });
    const esito = await eliminaArgomento(id);
    if (!esito.ok) return errore(esito);
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
