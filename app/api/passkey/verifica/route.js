export const dynamic = "force-dynamic";

import {
  challengeValido, creaGettoneSblocco, tipoSessione,
  COOKIE_CHALLENGE, COOKIE_SESSIONE, COOKIE_SBLOCCO, DURATA_SBLOCCO_S, leggiCookie,
} from "../../../lib/sessione";
import {
  base64urlABytes, leggiAuthData, verificaFirma, rpIdCorrisponde,
} from "../../../lib/webauthn-formati";
import { trovaPasskey, aggiornaUso } from "../../../lib/passkey-store";

// Lo sblocco vero e proprio: il telefono ha appena verificato la tua faccia o
// la tua impronta e ci manda una firma. Qui si controlla che sia autentica e
// si rilascia il permesso a scadenza breve.
export async function POST(request) {
  const password = process.env.APP_PASSWORD;
  if (!password) return Response.json({ error: "APP_PASSWORD non configurata" }, { status: 500 });

  // Lo sblocco vale solo per chi ha gia' una sessione: il passkey e' il
  // secondo fattore sopra la password, non un modo per saltarla.
  const sessione = await tipoSessione(leggiCookie(request, COOKIE_SESSIONE), password);
  if (sessione === "nessuna") return Response.json({ error: "Non autenticato" }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Richiesta non valida" }, { status: 400 }); }
  const { id, clientDataJSON, authenticatorData, signature } = body || {};
  if (!id || !clientDataJSON || !authenticatorData || !signature) {
    return Response.json({ error: "Dati dello sblocco incompleti" }, { status: 400 });
  }

  try {
    const salvato = await trovaPasskey(id);
    if (!salvato) {
      return Response.json({ error: "Questo dispositivo non è registrato." }, { status: 400 });
    }

    const clientBytes = base64urlABytes(clientDataJSON);
    const client = JSON.parse(new TextDecoder().decode(clientBytes));
    if (client.type !== "webauthn.get") {
      return Response.json({ error: "Tipo di operazione inatteso" }, { status: 400 });
    }

    const gettoneChal = leggiCookie(request, COOKIE_CHALLENGE);
    if (!(await challengeValido(gettoneChal, client.challenge, password))) {
      return Response.json({ error: "Challenge scaduto. Riprova." }, { status: 400 });
    }

    const host = new URL(request.url).hostname;
    if (client.origin !== `https://${host}` && client.origin !== `http://${host}`) {
      return Response.json({ error: `Origine inattesa: ${client.origin}` }, { status: 400 });
    }

    const authData = base64urlABytes(authenticatorData);
    const info = leggiAuthData(authData);

    if (!(await rpIdCorrisponde(info.rpIdHash, host))) {
      return Response.json({ error: "Dominio non corrispondente" }, { status: 400 });
    }
    // IL CONTROLLO CHE CONTA. Senza il flag UV la firma dimostra soltanto che
    // qualcuno ha toccato il telefono, non che sei tu: sarebbe un lucchetto
    // che si apre a chiunque lo tocchi.
    if (!info.uv) {
      return Response.json({ error: "Sblocco biometrico non confermato dal dispositivo." }, { status: 400 });
    }

    const buona = await verificaFirma({
      jwk: salvato.jwk,
      authData,
      clientDataJSON: clientBytes,
      firma: base64urlABytes(signature),
    });
    if (!buona) return Response.json({ error: "Firma non valida." }, { status: 401 });

    // Contatore anti-clonazione: se torna indietro, qualcuno ha copiato la
    // credenziale. Apple e Google lo lasciano a 0 perche' i loro passkey si
    // sincronizzano tra dispositivi, quindi il controllo si applica solo
    // quando l'autenticatore lo usa davvero.
    if (info.contatore > 0 && salvato.contatore > 0 && info.contatore <= salvato.contatore) {
      return Response.json({ error: "Credenziale sospetta (contatore non avanzato)." }, { status: 401 });
    }
    aggiornaUso(id, info.contatore).catch(() => {});

    const sblocco = await creaGettoneSblocco(password);
    return new Response(JSON.stringify({ success: true, durataS: DURATA_SBLOCCO_S }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `${COOKIE_SBLOCCO}=${sblocco}; Path=/; Max-Age=${DURATA_SBLOCCO_S}; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  } catch (e) {
    return Response.json({ error: `Sblocco fallito: ${e.message}` }, { status: 400 });
  }
}
