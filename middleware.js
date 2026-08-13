import { NextResponse } from "next/server";
import { tipoSessione, sbloccoValido, COOKIE_SESSIONE, COOKIE_SBLOCCO } from "./app/lib/sessione";

// L'app è deployata su un URL Vercel pubblico e mostra patrimonio, saldi,
// clienti e fatturato: senza questo middleware chiunque conoscesse l'URL
// poteva leggere tutto, e soprattutto SCRIVERE — gli endpoint POST
// (/api/bruno-finance, /api/iagrex-finance, /api/create-task...) accettavano
// richieste da chiunque, quindi era possibile sovrascrivere l'intero storico
// finanziario con una singola chiamata.
//
// DA BASIC AUTH A COOKIE DI SESSIONE (13/08/2026)
// Prima si usava HTTP Basic Auth: 401 + header `WWW-Authenticate`, e il
// browser mostrava il prompt nativo. Funzionava benissimo su Safari e su
// Chrome Android, e malissimo sull'app installata sulla home dell'iPhone:
// in modalità standalone quel prompt non esiste, WebKit resta appeso sulla
// negoziazione e va in timeout. Erano i 10-15 secondi a ogni apertura —
// identici in WiFi e in 4G, perché non era un download ma un'attesa.
//
// Ora la password si scambia UNA volta con un cookie (vedi /app/login e
// /api/login). Il cookie viaggia insieme alla richiesta, il middleware lo
// confronta, e non c'è nessuna negoziazione da aspettare.
//
// Regola d'oro di questo file: NON si risponde mai più con
// `WWW-Authenticate`. È quell'header a far partire il prompt nativo, ed è
// quel prompt a impiccare la PWA su iOS.
//
// Se APP_PASSWORD non è configurata su Vercel il middleware NON blocca
// (altrimenti un deploy senza variabile impostata renderebbe l'app
// inaccessibile dal telefono, senza modo di capire perché): in quel caso
// l'app resta aperta ma mostra un banner rosso ben visibile, così la
// mancanza non passa inosservata invece di dare una falsa sensazione di
// sicurezza. Vedi UnprotectedBanner in app/layout.jsx.

export async function middleware(request) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next(); // non configurata: fail-open + banner in app

  const { pathname } = request.nextUrl;

  // Il cron di Vercel non può inviare credenziali: /api/cron/reset ha già la
  // sua protezione con CRON_SECRET (vedi quella route), quindi va escluso qui
  // o il reset notturno delle routine si romperebbe.
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();

  // Stesso problema per il webhook Telegram: i server di Telegram non possono
  // autenticarsi, quindi col middleware attivo riceverebbero 401 e nessun
  // messaggio arriverebbe mai. La route POST /api/telegram ha la sua
  // protezione dedicata (header X-Telegram-Bot-Api-Secret-Token verificato
  // contro TELEGRAM_WEBHOOK_SECRET) e ignora in silenzio qualsiasi chat_id
  // diverso dal tuo. Escludiamo solo il POST: la GET di diagnostica resta
  // protetta, così l'elenco delle variabili configurate non è leggibile da
  // fuori.
  if (pathname === "/api/telegram" && request.method === "POST") {
    return NextResponse.next();
  }

  // La pagina di login e il suo endpoint devono essere raggiungibili senza
  // essere già autenticati, altrimenti non ci si autentica mai. Stessa cosa
  // per la schermata di sblocco e per le API dei passkey: sono proprio gli
  // strumenti con cui ci si sblocca, tenerli dietro al lucchetto vorrebbe
  // dire chiudersi fuori con la chiave dentro.
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  if (pathname === "/sblocca" || pathname.startsWith("/api/passkey/")) return NextResponse.next();

  const sessione = await tipoSessione(request.cookies.get(COOKIE_SESSIONE)?.value, password);

  if (sessione === "nessuna") return alLogin(request, "/login");

  // Sessione normale (il computer): si entra e basta, come chiesto.
  if (sessione === "normale") return NextResponse.next();

  // Sessione "bio" (il telefono, dove è stato registrato il Face ID): oltre
  // alla sessione serve uno sblocco recente.
  //
  // È QUI che il lucchetto diventa vero. La schermata di sblocco da sola
  // sarebbe apparenza: chi prende il telefono e apre l'indirizzo da Safari
  // scavalcherebbe la grafica e vedrebbe i dati lo stesso, perché il cookie
  // di sessione è ancora buono. Facendolo rispettare qui, la risposta non
  // esce proprio dal server — né dall'icona né da Safari.
  if (await sbloccoValido(request.cookies.get(COOKIE_SBLOCCO)?.value, password)) {
    return NextResponse.next();
  }
  return alLogin(request, "/sblocca");
}

// API → 401 in JSON; navigazione → redirect alla pagina giusta.
// Una redirect verso una pagina HTML dentro una fetch() che si aspetta dati
// produrrebbe un errore di parsing incomprensibile invece di un messaggio
// utile; il client, vedendo il 401, si manda da solo dove serve (vedi
// fetchWithRetry in app/page.jsx).
function alLogin(request, dove) {
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sessione scaduta o bloccata", login: dove }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = dove;
  url.search = `?da=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

// Escludiamo dal matcher gli asset statici e le icone: non contengono dati
// e tenerli fuori evita che il manifest/le icone della PWA vengano bloccati
// prima che il browser abbia la sessione.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|icon-.*\\.png).*)"],
};
