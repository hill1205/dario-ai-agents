export const dynamic = "force-dynamic";

import {
  tipoSessione, gettoneAtteso, COOKIE_SESSIONE, COOKIE_SBLOCCO, DURATA_COOKIE_S, leggiCookie,
} from "../../lib/sessione";
import { passkeyPubblici, eliminaPasskey, elencoPasskey } from "../../lib/passkey-store";

// Elenco dei dispositivi con lo sblocco biometrico attivo, per il pannello
// nelle Impostazioni. Solo nomi e date: le chiavi non escono di qui.
export async function GET(request) {
  const password = process.env.APP_PASSWORD;
  if (!password) return Response.json({ error: "APP_PASSWORD non configurata" }, { status: 500 });

  const sessione = await tipoSessione(leggiCookie(request, COOKIE_SESSIONE), password);
  if (sessione === "nessuna") return Response.json({ error: "Non autenticato" }, { status: 401 });

  return Response.json({
    dispositivi: await passkeyPubblici(),
    // Serve al pannello per sapere se questo dispositivo è già protetto.
    questoProtetto: sessione === "bio",
  });
}

// Revoca il passkey di un dispositivo.
//
// Il dettaglio importante è in fondo: se si sta togliendo il lucchetto a
// QUESTO dispositivo e non ne resta nessun altro registrato, la sessione
// viene riportata a "normale". Senza, il telefono resterebbe con un gettone
// bio che pretende uno sblocco che ormai nessun passkey può più concedere —
// cioè chiuso fuori dalla propria app.
export async function DELETE(request) {
  const password = process.env.APP_PASSWORD;
  if (!password) return Response.json({ error: "APP_PASSWORD non configurata" }, { status: 500 });

  const sessione = await tipoSessione(leggiCookie(request, COOKIE_SESSIONE), password);
  if (sessione === "nessuna") return Response.json({ error: "Non autenticato" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id mancante" }, { status: 400 });

  const tolto = await eliminaPasskey(id);
  if (!tolto) return Response.json({ error: "Dispositivo non trovato" }, { status: 404 });

  const rimasti = await elencoPasskey();
  const headers = { "Content-Type": "application/json" };
  if (sessione === "bio" && rimasti.length === 0) {
    const normale = await gettoneAtteso(password);
    // Due cookie in una risposta: si passano come array di Set-Cookie.
    const h = new Headers(headers);
    h.append("Set-Cookie", `${COOKIE_SESSIONE}=${normale}; Path=/; Max-Age=${DURATA_COOKIE_S}; HttpOnly; Secure; SameSite=Lax`);
    h.append("Set-Cookie", `${COOKIE_SBLOCCO}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    return new Response(JSON.stringify({ success: true, lucchettoRimosso: true }), { status: 200, headers: h });
  }

  return Response.json({ success: true, dispositivi: await passkeyPubblici() });
}
