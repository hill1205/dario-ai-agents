// I formati binari di WebAuthn, decodificati a mano.
//
// PERCHE' SCRITTI A MANO E NON CON UNA LIBRERIA
// Le librerie WebAuthn (@simplewebauthn/server e simili) tirano dentro
// dipendenze pensate per Node, mentre questa verifica deve poter girare
// anche su Edge Runtime, dove i moduli di Node non esistono. Quello che
// serve davvero e' poco: leggere una manciata di strutture CBOR, tradurre
// una chiave COSE in JWK e sciogliere una firma DER. Sono ~150 righe di
// codice che non cambieranno mai, contro un albero di dipendenze da
// aggiornare per sempre.
//
// Tutto quello che sta qui e' PURO: nessuna rete, nessuno stato. Per questo
// e' testabile da riga di comando — vedi scripts/test-webauthn.mjs, che lo
// prova con vettori veri prodotti da Web Crypto.

/* ---------------------------------------------------------------- base64url */
// WebAuthn parla base64url (alfabeto sicuro per gli URL: - e _ al posto di
// + e /, niente padding). Va convertito in entrambi i sensi di continuo.

export function base64urlABytes(s) {
  const b64 = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesABase64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* -------------------------------------------------------------------- CBOR */
// Decoder CBOR ridotto all'osso: bastano i tipi che WebAuthn usa davvero
// (interi, byte, stringhe, array, mappe, negativi). Niente tag, niente
// float, niente streaming — se arrivasse roba del genere e' meglio un
// errore esplicito che un valore inventato.
//
// Restituisce { valore, fine } perche' l'authData dentro l'attestationObject
// va letto sapendo ESATTAMENTE dove finisce la chiave pubblica: e' l'unico
// modo di sapere quanti byte occupa (il formato non lo dichiara altrove).

function leggiTesta(vista, i) {
  const primo = vista.getUint8(i);
  const tipo = primo >> 5;
  const info = primo & 31;
  if (info < 24) return { tipo, valore: info, i: i + 1 };
  if (info === 24) return { tipo, valore: vista.getUint8(i + 1), i: i + 2 };
  if (info === 25) return { tipo, valore: vista.getUint16(i + 1), i: i + 3 };
  if (info === 26) return { tipo, valore: vista.getUint32(i + 1), i: i + 5 };
  if (info === 27) {
    const alto = vista.getUint32(i + 1), basso = vista.getUint32(i + 5);
    return { tipo, valore: alto * 4294967296 + basso, i: i + 9 };
  }
  throw new Error(`CBOR: lunghezza non supportata (${info})`);
}

function decodifica(vista, i) {
  const t = leggiTesta(vista, i);
  const { tipo, valore } = t;
  i = t.i;

  switch (tipo) {
    case 0: return { valore, fine: i };                 // intero positivo
    case 1: return { valore: -1 - valore, fine: i };    // intero negativo
    case 2: {                                            // byte
      const b = new Uint8Array(vista.buffer, vista.byteOffset + i, valore);
      return { valore: new Uint8Array(b), fine: i + valore };
    }
    case 3: {                                            // testo
      const b = new Uint8Array(vista.buffer, vista.byteOffset + i, valore);
      return { valore: new TextDecoder().decode(b), fine: i + valore };
    }
    case 4: {                                            // array
      const out = [];
      for (let n = 0; n < valore; n++) { const r = decodifica(vista, i); out.push(r.valore); i = r.fine; }
      return { valore: out, fine: i };
    }
    case 5: {                                            // mappa
      const out = new Map();
      for (let n = 0; n < valore; n++) {
        const k = decodifica(vista, i); i = k.fine;
        const v = decodifica(vista, i); i = v.fine;
        out.set(k.valore, v.valore);
      }
      return { valore: out, fine: i };
    }
    case 7:                                              // true/false/null
      if (valore === 20) return { valore: false, fine: i };
      if (valore === 21) return { valore: true, fine: i };
      if (valore === 22) return { valore: null, fine: i };
      throw new Error(`CBOR: valore semplice non supportato (${valore})`);
    default:
      throw new Error(`CBOR: tipo non supportato (${tipo})`);
  }
}

export function decodificaCbor(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const vista = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  return decodifica(vista, 0).valore;
}

export function decodificaCborConFine(bytes, inizio = 0) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const vista = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  return decodifica(vista, inizio);
}

/* ---------------------------------------------------------------- authData */
// Struttura fissa: 32 byte di hash del dominio, 1 byte di flag, 4 di
// contatore, e — solo in registrazione — i dati della credenziale appena
// creata.
//
// I flag che contano:
//   bit 0 (UP) l'utente era presente
//   bit 2 (UV) l'utente e' stato VERIFICATO — cioe' Face ID/impronta sono
//              andati a buon fine. E' questo il bit che distingue "ho toccato
//              la chiavetta" da "sono io": senza controllarlo, il lucchetto
//              biometrico non varrebbe niente.
//   bit 6 (AT) ci sono i dati della credenziale in coda

export function leggiAuthData(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (arr.length < 37) throw new Error("authData troppo corto");
  const vista = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);

  const flag = arr[32];
  const info = {
    rpIdHash: arr.slice(0, 32),
    up: (flag & 0x01) !== 0,
    uv: (flag & 0x04) !== 0,
    at: (flag & 0x40) !== 0,
    contatore: vista.getUint32(33),
  };
  if (!info.at) return info;

  // aaguid (16) + lunghezza id (2) + id + chiave pubblica COSE
  let i = 37 + 16;
  const lunId = vista.getUint16(i); i += 2;
  info.credentialId = arr.slice(i, i + lunId); i += lunId;
  // La chiave e' l'ultima cosa, ma NON si puo' prendere "tutto il resto":
  // alcuni autenticatori accodano estensioni. Si decodifica il CBOR e si
  // usa dove finisce.
  info.chiaveCose = decodificaCborConFine(arr, i).valore;
  return info;
}

/* ----------------------------------------------------------- COSE  ->  JWK */
// La chiave pubblica arriva come mappa COSE con chiavi numeriche. Web Crypto
// vuole un JWK. Si supporta ES256 (curva P-256), che e' quello che usano sia
// il Secure Enclave di Apple sia i portachiavi Android: e' il caso reale, e
// accettare algoritmi che non useremo mai vorrebbe dire solo piu' superficie
// da sbagliare.
//
// Etichette COSE: 1=tipo chiave, 3=algoritmo, -1=curva, -2=x, -3=y

export function coseAJwk(cose) {
  const g = (k) => (cose instanceof Map ? cose.get(k) : cose[k]);
  const tipo = g(1), alg = g(3);
  if (tipo !== 2) throw new Error(`Chiave non EC2 (tipo ${tipo}): non supportata`);
  if (alg !== -7) throw new Error(`Algoritmo non ES256 (${alg}): non supportato`);
  const x = g(-2), y = g(-3);
  if (!x || !y) throw new Error("Chiave COSE senza coordinate");
  return {
    kty: "EC",
    crv: "P-256",
    x: bytesABase64url(x),
    y: bytesABase64url(y),
    ext: true,
  };
}

/* ------------------------------------------------------------- firma DER   */
// Gli autenticatori firmano in DER (una struttura ASN.1 con due interi di
// lunghezza variabile), mentre Web Crypto vuole r e s "nudi", 32 byte
// ciascuno. Senza questa conversione ogni verifica fallirebbe, e fallirebbe
// in modo muto: firma valida, risposta "non combacia".

export function derAGrezza(der) {
  const arr = der instanceof Uint8Array ? der : new Uint8Array(der);
  if (arr[0] !== 0x30) throw new Error("Firma DER malformata: manca la sequenza");

  let i = 2;
  if (arr[1] & 0x80) i = 2 + (arr[1] & 0x7f); // lunghezza su piu' byte

  const leggiIntero = () => {
    if (arr[i] !== 0x02) throw new Error("Firma DER malformata: atteso un intero");
    const lun = arr[i + 1];
    let v = arr.slice(i + 2, i + 2 + lun);
    i += 2 + lun;
    // DER mette uno 0x00 davanti quando il primo bit e' 1, per non far
    // sembrare negativo il numero: va tolto.
    while (v.length > 32 && v[0] === 0x00) v = v.slice(1);
    // ...e va ri-imbottito a sinistra se e' piu' corto di 32.
    if (v.length < 32) {
      const p = new Uint8Array(32);
      p.set(v, 32 - v.length);
      v = p;
    }
    return v;
  };

  const r = leggiIntero();
  const s = leggiIntero();
  const out = new Uint8Array(64);
  out.set(r, 0);
  out.set(s, 32);
  return out;
}

/* ------------------------------------------------------------- verifica    */
// La firma copre authData concatenato all'hash del clientDataJSON. E' cosi'
// che si lega la firma alla richiesta specifica: cambiando anche un byte del
// challenge, l'hash cambia e la verifica salta.

export async function verificaFirma({ jwk, authData, clientDataJSON, firma }) {
  const chiave = await crypto.subtle.importKey(
    "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
  );
  const hashClient = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataJSON));
  const firmato = new Uint8Array(authData.length + hashClient.length);
  firmato.set(authData, 0);
  firmato.set(hashClient, authData.length);

  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    chiave,
    derAGrezza(firma),
    firmato
  );
}

// L'hash del dominio dentro authData deve corrispondere al dominio che sta
// verificando. E' la difesa contro il phishing: una firma ottenuta su un
// sito clone non vale qui, perche' l'autenticatore ci ha scritto dentro
// l'altro dominio.
export async function rpIdCorrisponde(rpIdHash, rpId) {
  const atteso = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId)));
  if (rpIdHash.length !== atteso.length) return false;
  let diff = 0;
  for (let i = 0; i < atteso.length; i++) diff |= rpIdHash[i] ^ atteso[i];
  return diff === 0;
}
