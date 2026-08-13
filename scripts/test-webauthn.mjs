// Prova le fondamenta binarie di WebAuthn con vettori VERI, generati da Web
// Crypto: chiave ECDSA P-256 reale, firma reale, authData costruito byte per
// byte come lo manda un autenticatore.
//
// Perche' e' importante: questo codice fallisce in silenzio. Una firma
// valida che non viene riconosciuta non da' nessun errore leggibile — dice
// solo "non combacia", e ci si mette un pomeriggio a capire se il problema
// e' la conversione DER, la chiave o l'ordine dei byte.
//
// Uso:  node scripts/test-webauthn.mjs

import {
  base64urlABytes, bytesABase64url, decodificaCbor, leggiAuthData,
  coseAJwk, derAGrezza, verificaFirma, rpIdCorrisponde,
} from "../app/lib/webauthn-formati.js";

let falliti = 0;
const ok = (nome, cond, extra = "") => {
  if (cond) console.log(`  ✅ ${nome}`);
  else { falliti++; console.log(`  ❌ ${nome} ${extra}`); }
};

/* --- encoder CBOR minimale, serve solo a costruire i vettori di prova --- */
const cborBytes = (b) => {
  const testa = b.length < 24 ? [0x40 + b.length]
    : b.length < 256 ? [0x58, b.length]
    : [0x59, b.length >> 8, b.length & 0xff];
  return new Uint8Array([...testa, ...b]);
};
const cborInt = (n) => {
  if (n >= 0) return n < 24 ? new Uint8Array([n]) : new Uint8Array([0x18, n]);
  const m = -1 - n;
  return m < 24 ? new Uint8Array([0x20 + m]) : new Uint8Array([0x38, m]);
};
const cborMappa = (coppie) => {
  const parti = [new Uint8Array([0xa0 + coppie.length])];
  for (const [k, v] of coppie) parti.push(k, v);
  return new Uint8Array(parti.flatMap(p => [...p]));
};

/* ------------------------------------------------------------ base64url -- */
console.log("\nbase64url — andata e ritorno");
{
  const orig = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255, 62, 63]);
  const giro = base64urlABytes(bytesABase64url(orig));
  ok("i byte tornano identici", JSON.stringify([...giro]) === JSON.stringify([...orig]));
  ok("nessun carattere ostile agli URL", !/[+/=]/.test(bytesABase64url(orig)));
}

/* ------------------------------------------------------------------ CBOR -- */
console.log("\nCBOR — i tipi che WebAuthn usa davvero");
{
  ok("intero piccolo", decodificaCbor(new Uint8Array([0x0a])) === 10);
  ok("intero su un byte", decodificaCbor(new Uint8Array([0x18, 0x64])) === 100);
  ok("intero negativo (le etichette COSE lo sono)", decodificaCbor(new Uint8Array([0x26])) === -7);
  ok("stringa di testo", decodificaCbor(new Uint8Array([0x63, 0x61, 0x62, 0x63])) === "abc");
  const m = decodificaCbor(cborMappa([[cborInt(1), cborInt(2)], [cborInt(3), cborInt(-7)]]));
  ok("mappa con chiavi numeriche", m.get(1) === 2 && m.get(3) === -7);
}

/* ---------------------------------------------------- chiave vera + firma -- */
console.log("\nChiave ECDSA P-256 vera: COSE → JWK → verifica della firma");
{
  const coppia = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]
  );
  const jwkVero = await crypto.subtle.exportKey("jwk", coppia.publicKey);

  // La chiave rimessa in forma COSE, com'e' dentro l'attestationObject.
  const cose = cborMappa([
    [cborInt(1), cborInt(2)],    // kty: EC2
    [cborInt(3), cborInt(-7)],   // alg: ES256
    [cborInt(-1), cborInt(1)],   // crv: P-256
    [cborInt(-2), cborBytes(base64urlABytes(jwkVero.x))],
    [cborInt(-3), cborBytes(base64urlABytes(jwkVero.y))],
  ]);
  const jwkRicavato = coseAJwk(decodificaCbor(cose));
  ok("le coordinate sopravvivono al giro COSE→JWK",
     jwkRicavato.x === jwkVero.x && jwkRicavato.y === jwkVero.y);

  // authData realistico: 32 hash + flag (UP+UV+AT) + contatore + credenziale.
  const rpId = "dario-ai-agents.vercel.app";
  const rpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId)));
  const credId = crypto.getRandomValues(new Uint8Array(32));
  const authData = new Uint8Array([
    ...rpIdHash,
    0x45,                    // UP(1) + UV(4) + AT(64) = 0x45
    0, 0, 0, 7,              // contatore
    ...new Uint8Array(16),   // aaguid
    0, credId.length,
    ...credId,
    ...cose,
  ]);

  const letto = leggiAuthData(authData);
  ok("flag UV riconosciuto (è il bit del Face ID)", letto.uv === true);
  ok("flag UP riconosciuto", letto.up === true);
  ok("contatore letto", letto.contatore === 7);
  ok("credentialId estratto intero",
     bytesABase64url(letto.credentialId) === bytesABase64url(credId));
  ok("chiave pubblica trovata in coda", coseAJwk(letto.chiaveCose).x === jwkVero.x);
  ok("il dominio corrisponde", await rpIdCorrisponde(letto.rpIdHash, rpId));
  ok("un dominio diverso NON corrisponde (difesa anti-phishing)",
     !(await rpIdCorrisponde(letto.rpIdHash, "sito-clone.example")));

  // Firma vera sugli stessi byte che verifica il server.
  const clientDataJSON = new TextEncoder().encode(JSON.stringify({
    type: "webauthn.get", challenge: bytesABase64url(new Uint8Array([1,2,3,4])), origin: `https://${rpId}`,
  }));
  const hashClient = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataJSON));
  const daFirmare = new Uint8Array([...authData, ...hashClient]);
  const firmaGrezza = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, coppia.privateKey, daFirmare
  ));

  // Gli autenticatori firmano in DER: reimpacchettiamo per riprodurre il caso reale.
  const inDer = (grezza) => {
    const intero = (v) => {
      let i = 0; while (i < v.length - 1 && v[i] === 0) i++;
      let b = v.slice(i);
      if (b[0] & 0x80) b = new Uint8Array([0, ...b]);
      return [0x02, b.length, ...b];
    };
    const corpo = [...intero(grezza.slice(0, 32)), ...intero(grezza.slice(32))];
    return new Uint8Array([0x30, corpo.length, ...corpo]);
  };
  const der = inDer(firmaGrezza);

  ok("DER → grezza ricostruisce esattamente i 64 byte",
     bytesABase64url(derAGrezza(der)) === bytesABase64url(firmaGrezza));

  ok("la firma vera viene ACCETTATA", await verificaFirma({
    jwk: jwkRicavato, authData, clientDataJSON, firma: der,
  }));

  // Contro-prova: se non si rifiuta una firma sbagliata, il lucchetto non serve.
  const clientDataAltro = new TextEncoder().encode(JSON.stringify({
    type: "webauthn.get", challenge: bytesABase64url(new Uint8Array([9,9,9,9])), origin: `https://${rpId}`,
  }));
  ok("una firma su un challenge DIVERSO viene RIFIUTATA", !(await verificaFirma({
    jwk: jwkRicavato, authData, clientDataJSON: clientDataAltro, firma: der,
  })));

  const altraCoppia = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign","verify"]);
  const jwkEstraneo = await crypto.subtle.exportKey("jwk", altraCoppia.publicKey);
  ok("una firma di un'ALTRA chiave viene RIFIUTATA", !(await verificaFirma({
    jwk: { ...jwkEstraneo, ext: true }, authData, clientDataJSON, firma: der,
  })));
}

/* --------------------------------- casi limite che fanno perdere pomeriggi -- */
console.log("\nCasi limite della firma DER");
{
  // r o s con lo zero iniziale di DER, e valori corti: sono i due casi in cui
  // una conversione ingenua produce 63 o 65 byte invece di 64, e la verifica
  // fallisce solo ogni tanto — il tipo di bug che sembra "a caso".
  const conZero = new Uint8Array([0x30, 0x46, 0x02, 0x21, 0x00, ...new Uint8Array(32).fill(0xaa),
                                   0x02, 0x21, 0x00, ...new Uint8Array(32).fill(0xbb)]);
  ok("r/s con lo zero iniziale → 64 byte netti", derAGrezza(conZero).length === 64);
  const corta = new Uint8Array([0x30, 0x2c, 0x02, 0x14, ...new Uint8Array(20).fill(0x11),
                                 0x02, 0x14, ...new Uint8Array(20).fill(0x22)]);
  const g = derAGrezza(corta);
  ok("r/s corti → imbottiti a sinistra, non a destra",
     g.length === 64 && g[0] === 0 && g[11] === 0 && g[12] === 0x11 && g[32] === 0);
}

console.log(falliti === 0 ? "\n✅ Tutte le fondamenta reggono.\n" : `\n❌ ${falliti} controllo/i fallito/i.\n`);
process.exit(falliti === 0 ? 0 : 1);
