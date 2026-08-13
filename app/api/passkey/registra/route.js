export const dynamic = "force-dynamic";

import {
  challengeValido, gettoneBio, tipoSessione,
  COOKIE_CHALLENGE, COOKIE_SESSIONE, DURATA_COOKIE_S, leggiCookie,
} from "../../../lib/sessione";
import {
  base64urlABytes, bytesABase64url, decodificaCbor, leggiAuthData, coseAJwk, rpIdCorrisponde,
} from "../../../lib/webauthn-formati";
import { salvaPasskey } from "../../../lib/passkey-store";

// Registra il Face ID / l'impronta di QUESTO dispositivo.
//
// Alla fine succede la cosa importante: il gettone di sessione del
// dispositivo viene sostituito con la variante "bio". Da quel momento il
// middleware, per questo dispositivo e solo per questo, pretendera' anche
// uno sblocco recente. E' cosi' che il telefono resta protetto mentre il
// computer continua ad aprirsi da solo, senza che il server debba
// riconoscere chi sta parlando.
export async function POST(request) {
  const password = process.env.APP_PASSWORD;
  if (!password) return Response.json({ error: "APP_PASSWORD non configurata" }, { status: 500 });

  // Si registra un passkey solo da una sessione gia' autenticata: altrimenti
  // chiunque potrebbe agganciare il proprio telefono ai tuoi dati.
  const sessione = await tipoSessione(leggiCookie(request, COOKIE_SESSIONE), password);
  if (sessione === "nessuna") return Response.json({ error: "Non autenticato" }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Richiesta non valida" }, { status: 400 }); }
  const { id, clientDataJSON, attestationObject, nome } = body || {};
  if (!id || !clientDataJSON || !attestationObject) {
    return Response.json({ error: "Dati della registrazione incompleti" }, { status: 400 });
  }

  try {
    const clientBytes = base64urlABytes(clientDataJSON);
    const client = JSON.parse(new TextDecoder().decode(clientBytes));

    if (client.type !== "webauthn.create") {
      return Response.json({ error: "Tipo di operazione inatteso" }, { status: 400 });
    }

    // Il challenge tornato indietro deve essere quello che abbiamo emesso poco fa.
    const gettoneChal = leggiCookie(request, COOKIE_CHALLENGE);
    if (!(await challengeValido(gettoneChal, client.challenge, password))) {
      return Response.json({ error: "Challenge scaduto o non valido. Riprova." }, { status: 400 });
    }

    // L'origine dichiarata dal browser deve essere questo sito: e' la
    // difesa contro un sito clone che si fa registrare al posto nostro.
    const host = new URL(request.url).hostname;
    if (client.origin !== `https://${host}` && client.origin !== `http://${host}`) {
      return Response.json({ error: `Origine inattesa: ${client.origin}` }, { status: 400 });
    }

    const att = decodificaCbor(base64urlABytes(attestationObject));
    const authData = att instanceof Map ? att.get("authData") : att.authData;
    if (!authData) return Response.json({ error: "attestationObject senza authData" }, { status: 400 });

    const info = leggiAuthData(authData);
    if (!(await rpIdCorrisponde(info.rpIdHash, host))) {
      return Response.json({ error: "Il dominio della credenziale non corrisponde" }, { status: 400 });
    }
    // Senza il flag UV il passkey e' stato creato SENZA verifica biometrica:
    // registrarlo vorrebbe dire montare un lucchetto che si apre da solo.
    if (!info.uv) {
      return Response.json({
        error: "Il dispositivo non ha verificato la tua identità. Controlla che Face ID o l'impronta siano attivi.",
      }, { status: 400 });
    }
    if (!info.chiaveCose) return Response.json({ error: "Chiave pubblica assente" }, { status: 400 });

    const jwk = coseAJwk(info.chiaveCose);
    const idReale = bytesABase64url(info.credentialId);

    await salvaPasskey({ id: idReale, jwk, contatore: info.contatore, nome });

    // Da qui in poi questo dispositivo e' "protetto dal biometrico".
    const bio = await gettoneBio(password);
    return new Response(JSON.stringify({ success: true, id: idReale }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `${COOKIE_SESSIONE}=${bio}; Path=/; Max-Age=${DURATA_COOKIE_S}; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  } catch (e) {
    return Response.json({ error: `Registrazione fallita: ${e.message}` }, { status: 400 });
  }
}
