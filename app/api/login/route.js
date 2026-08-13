export const dynamic = "force-dynamic";

// NIENTE runtime = "edge" qui.
//
// C'era, per "stare vicino al middleware". Non serviva a niente: questa route
// usa solo Web Crypto e TextEncoder, che su Node 18+ sono globali esattamente
// come su Edge. In cambio faceva comparire a ogni build l'avviso "Using edge
// runtime on a page currently disables static generation for that page" —
// innocuo (una route di login non e' statica per definizione, e c'e' gia'
// force-dynamic), ma un avviso che si impara a ignorare e' un avviso che
// nascondera' quello vero il giorno che arriva.
//
// Cosi' resta anche coerente con le route in /api/passkey, che girano su Node
// perche' devono parlare con ClickUp. L'unica cosa che sta davvero su Edge e'
// il middleware, che non si puo' scegliere.

import {
  gettoneAtteso, confrontoCostante, tipoSessione, creaGettoneSblocco,
  COOKIE_SESSIONE, COOKIE_SBLOCCO, DURATA_COOKIE_S, DURATA_SBLOCCO_S, leggiCookie,
} from "../../lib/sessione";

// Scambia la password con un cookie di sessione. E' l'unico punto dell'app in
// cui la password viaggia — una volta per dispositivo, invece che a ogni
// singola richiesta come faceva la Basic Auth.
//
// Edge runtime per stare vicino al middleware e usare lo stesso Web Crypto.
export async function POST(request) {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    // Senza APP_PASSWORD il middleware lascia passare tutti e l'app mostra il
    // banner rosso: un login qui non avrebbe niente da verificare.
    return Response.json({ error: "APP_PASSWORD non configurata sul server" }, { status: 500 });
  }

  let inviata = "";
  try {
    inviata = (await request.json())?.password || "";
  } catch {
    return Response.json({ error: "Richiesta non valida" }, { status: 400 });
  }

  if (!confrontoCostante(inviata, password)) {
    // Ritardo fisso su ogni tentativo sbagliato: rende scomodo provare
    // password a raffica, e mezzo secondo non si nota quando la si azzecca.
    await new Promise(r => setTimeout(r, 500));
    return Response.json({ error: "Password errata" }, { status: 401 });
  }

  // LA PASSWORD NON DECLASSA UN DISPOSITIVO PROTETTO.
  //
  // Sulla schermata di sblocco c'è sempre "usa la password", perché nessuno
  // deve poter restare chiuso fuori se il Face ID fa i capricci. Ma se questo
  // dispositivo ha il lucchetto biometrico, entrare con la password deve
  // rilasciare uno sblocco temporaneo e LASCIARE il gettone in variante bio:
  // se lo riportassimo a "normale", il primo che conosce la password
  // spegnerebbe il lucchetto per sempre con un login.
  const gia = await tipoSessione(leggiCookie(request, COOKIE_SESSIONE), password);
  const protetto = gia === "bio";

  const gettone = protetto ? undefined : await gettoneAtteso(password);
  if (protetto) {
    const h = new Headers({ "Content-Type": "application/json" });
    h.append("Set-Cookie", `${COOKIE_SBLOCCO}=${await creaGettoneSblocco(password)}; Path=/; Max-Age=${DURATA_SBLOCCO_S}; HttpOnly; Secure; SameSite=Lax`);
    return new Response(JSON.stringify({ success: true, sbloccato: true }), { status: 200, headers: h });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // HttpOnly: il cookie non e' leggibile da JavaScript, quindi uno script
      // iniettato nella pagina non se lo puo' portare via.
      // Secure: viaggia solo su HTTPS.
      // SameSite=Lax: non viene mandato dalle richieste che partono da altri
      // siti, che e' la difesa contro le richieste falsificate — e ce n'era
      // bisogno, perche' gli endpoint POST di questa app riscrivono finanze.
      "Set-Cookie": `${COOKIE_SESSIONE}=${gettone}; Path=/; Max-Age=${DURATA_COOKIE_S}; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

// Esci da questo dispositivo. Per sganciarli TUTTI in una volta (telefono
// perso) si cambia APP_PASSWORD su Vercel: il gettone deriva dalla password,
// quindi cambiandola ogni cookie in giro smette di valere.
export async function DELETE() {
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${COOKIE_SESSIONE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}
