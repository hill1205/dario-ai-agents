import { NextResponse } from "next/server";
import { cookieValido, COOKIE_SESSIONE } from "./app/lib/sessione";

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
  // essere già autenticati, altrimenti non ci si autentica mai.
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();

  const cookie = request.cookies.get(COOKIE_SESSIONE)?.value;
  if (await cookieValido(cookie, password)) return NextResponse.next();

  // Le chiamate API rispondono 401 in JSON: una redirect verso una pagina HTML
  // arriverebbe a una fetch() che si aspetta dati e produrrebbe un errore di
  // parsing invece di un messaggio comprensibile. Il client, vedendo 401,
  // manda l'utente al login da solo (vedi fetchWithRetry in app/page.jsx).
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sessione scaduta", login: "/login" }, { status: 401 });
  }

  // Navigazione normale: si va al login, ricordando dove si stava andando.
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?da=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

// Escludiamo dal matcher gli asset statici e le icone: non contengono dati
// e tenerli fuori evita che il manifest/le icone della PWA vengano bloccati
// prima che il browser abbia la sessione.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|icon-.*\\.png).*)"],
};
