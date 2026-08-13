export const runtime = "edge";
export const dynamic = "force-dynamic";

import { gettoneAtteso, confrontoCostante, COOKIE_SESSIONE, DURATA_COOKIE_S } from "../../lib/sessione";

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

  const gettone = await gettoneAtteso(password);
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
