export const dynamic = "force-dynamic";

import { creaGettoneChallenge, COOKIE_CHALLENGE, DURATA_CHALLENGE_S } from "../../../lib/sessione";
import { bytesABase64url } from "../../../lib/webauthn-formati";
import { passkeyPubblici } from "../../../lib/passkey-store";

// Il numero casuale che l'autenticatore dovra' firmare.
//
// Serve a impedire il "replay": senza, una firma catturata una volta
// varrebbe per sempre e chiunque riuscisse a intercettarla potrebbe
// sbloccare l'app quando vuole. Con il challenge, ogni firma vale per una
// richiesta sola.
//
// Non lo teniamo su un archivio lato server: lo firmiamo e lo rimandiamo al
// browser in un cookie. Su Vercel ogni istanza ha la sua memoria, quindi un
// challenge messo da parte da un'istanza non lo ritroverebbe quella che
// riceve la risposta.
export async function POST(request) {
  const password = process.env.APP_PASSWORD;
  if (!password) return Response.json({ error: "APP_PASSWORD non configurata" }, { status: 500 });

  const challenge = bytesABase64url(crypto.getRandomValues(new Uint8Array(32)));
  const gettone = await creaGettoneChallenge(password, challenge);

  let tipo = "sblocco";
  try { tipo = (await request.json())?.tipo === "registrazione" ? "registrazione" : "sblocco"; } catch {}

  // Allo sblocco diciamo al browser QUALI credenziali accettiamo. Su iOS
  // e' quello che fa comparire direttamente il Face ID invece di un elenco
  // di scelte.
  const credenziali = tipo === "sblocco"
    ? (await passkeyPubblici()).map((p) => p.id)
    : [];

  return new Response(JSON.stringify({ challenge, credenziali, rpId: new URL(request.url).hostname }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${COOKIE_CHALLENGE}=${gettone}; Path=/; Max-Age=${DURATA_CHALLENGE_S}; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}
