import { NextResponse } from "next/server";

// L'app è deployata su un URL Vercel pubblico e mostra patrimonio, saldi,
// clienti e fatturato: senza questo middleware chiunque conoscesse l'URL
// poteva leggere tutto, e soprattutto SCRIVERE — gli endpoint POST
// (/api/bruno-finance, /api/iagrex-finance, /api/create-task...) accettavano
// richieste da chiunque, quindi era possibile sovrascrivere l'intero storico
// finanziario con una singola chiamata.
//
// Autenticazione HTTP Basic: il browser mostra il prompt nativo e poi
// ricorda le credenziali per la sessione, quindi non serve una UI di login
// e continua a funzionare anche come PWA installata sul telefono.
//
// Se APP_PASSWORD non è configurata su Vercel il middleware NON blocca
// (altrimenti un deploy senza variabile impostata renderebbe l'app
// inaccessibile dal telefono, senza modo di capire perché): in quel caso
// l'app resta aperta ma mostra un banner rosso ben visibile, così la
// mancanza non passa inosservata invece di dare una falsa sensazione di
// sicurezza. Vedi UnprotectedBanner in app/layout.jsx.
const USERNAME = process.env.APP_USERNAME || "dario";

export function middleware(request) {
  const password = process.env.APP_PASSWORD;

  // Endpoint di diagnostica: dice SOLO se la variabile è visibile al
  // middleware (runtime Edge), mai il suo valore. Serve a distinguere
  // "middleware non eseguito" da "variabile non arrivata all'Edge", che dal
  // fuori sono indistinguibili perché entrambi lasciano passare la richiesta.
  if (request.nextUrl.pathname === "/__authcheck") {
    return new NextResponse(password ? "var-visibile" : "var-mancante", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  if (!password) return NextResponse.next(); // non configurata: fail-open + banner in app

  // Il cron di Vercel non può inviare credenziali Basic: /api/cron/reset ha
  // già la sua protezione con CRON_SECRET (vedi quella route), quindi va
  // escluso qui o il reset notturno delle routine si romperebbe.
  if (request.nextUrl.pathname.startsWith("/api/cron/")) return NextResponse.next();

  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(":");
      const user = decoded.slice(0, idx);
      const pass = decoded.slice(idx + 1);
      if (user === USERNAME && pass === password) return NextResponse.next();
    } catch {
      // header malformato: cade nella richiesta di credenziali qui sotto
    }
  }

  return new NextResponse("Accesso riservato", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Dario AI Agents", charset="UTF-8"' },
  });
}

// Escludiamo dal matcher gli asset statici e le icone: non contengono dati
// e tenerli fuori evita che il manifest/le icone della PWA vengano bloccati
// prima che il browser abbia le credenziali.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|icon-.*\\.png).*)"],
};
