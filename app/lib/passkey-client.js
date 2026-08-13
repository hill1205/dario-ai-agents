"use client";

// Il lato browser dei passkey: parla con navigator.credentials e traduce
// avanti e indietro il base64url, perche' l'API vuole ArrayBuffer mentre in
// JSON viaggiano stringhe.

const aBytes = (s) => {
  const b64 = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const aB64url = (buf) => {
  const arr = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

// Il browser sa fare i passkey? Su iOS vecchi o in contesti non sicuri, no —
// e in quel caso l'interfaccia deve proporre subito la password invece di
// mostrare un bottone che non funzionera' mai.
export function passkeySupportati() {
  return typeof window !== "undefined"
    && !!window.PublicKeyCredential
    && !!navigator.credentials?.create;
}

// Esiste un autenticatore INTEGRATO nel dispositivo (Face ID, Touch ID,
// impronta)? Diverso da "supporta i passkey": un computer fisso potrebbe
// saperli fare solo con una chiavetta USB, e non e' quello che vogliamo qui.
export async function biometriaDisponibile() {
  if (!passkeySupportati()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

async function chiediChallenge(tipo) {
  const res = await fetch("/api/passkey/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo }),
  });
  if (!res.ok) throw new Error("Non riesco a iniziare la procedura.");
  return res.json();
}

// Registra il Face ID / l'impronta di questo dispositivo.
export async function registraQuestoDispositivo(nome) {
  const { challenge, rpId } = await chiediChallenge("registrazione");

  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: aBytes(challenge),
      rp: { name: "Dario AI Agents", id: rpId },
      // L'id utente e' fisso: c'e' un solo utente in tutta l'app, e tenerlo
      // stabile fa si' che ri-registrare lo stesso telefono sostituisca il
      // passkey invece di accumularne uno nuovo a ogni giro.
      user: { id: aBytes("ZGFyaW8"), name: "dario", displayName: "Dario" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256: quello di Apple e Android
      authenticatorSelection: {
        authenticatorAttachment: "platform", // il chip del telefono, non una chiavetta
        userVerification: "required",        // Face ID/impronta OBBLIGATORI, non facoltativi
        residentKey: "preferred",
      },
      timeout: 60000,
      attestation: "none", // non ci serve sapere che marca di chip e': meno dati, meno da verificare
    },
  });
  if (!cred) throw new Error("Registrazione annullata.");

  const res = await fetch("/api/passkey/registra", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: cred.id,
      clientDataJSON: aB64url(cred.response.clientDataJSON),
      attestationObject: aB64url(cred.response.attestationObject),
      nome: nome || nomeDispositivo(),
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Registrazione rifiutata dal server.");
  return j;
}

// Sblocca: chiede il dito/Face ID e fa validare la firma dal server.
export async function sbloccaConBiometria() {
  const { challenge, credenziali, rpId } = await chiediChallenge("sblocco");

  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: aBytes(challenge),
      rpId,
      allowCredentials: (credenziali || []).map((id) => ({ type: "public-key", id: aBytes(id) })),
      userVerification: "required",
      timeout: 60000,
    },
  });
  if (!cred) throw new Error("Sblocco annullato.");

  const res = await fetch("/api/passkey/verifica", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: cred.id,
      clientDataJSON: aB64url(cred.response.clientDataJSON),
      authenticatorData: aB64url(cred.response.authenticatorData),
      signature: aB64url(cred.response.signature),
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Sblocco rifiutato.");
  return j;
}

// Un nome leggibile per la lista dei dispositivi registrati, indovinato dallo
// user agent. Serve solo a distinguerli a colpo d'occhio nelle Impostazioni.
export function nomeDispositivo() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "PC Windows";
  return "Dispositivo";
}

// I messaggi che il browser restituisce sono criptici ("NotAllowedError").
// Tradotti in italiano dicono cosa fare davvero.
export function spiegaErrore(e) {
  const n = e?.name || "";
  if (n === "NotAllowedError") return "Sblocco annullato o scaduto. Riprova, oppure entra con la password.";
  if (n === "InvalidStateError") return "Questo dispositivo risulta già registrato.";
  if (n === "NotSupportedError") return "Questo dispositivo non supporta lo sblocco biometrico per le app web.";
  if (n === "SecurityError") return "Blocco di sicurezza del browser: l'app deve essere aperta in HTTPS.";
  return e?.message || "Qualcosa è andato storto.";
}
