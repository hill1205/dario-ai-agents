// Il gettone di sessione che sostituisce la Basic Auth.
//
// PERCHE' NON SI USA PIU' LA BASIC AUTH
// Con Basic Auth il middleware risponde 401 + header `WWW-Authenticate`, che
// e' il modo standard di dire al browser "chiedi la password all'utente".
// Safari lo gestisce benissimo: apre il pannello di sistema, si inserisce la
// password, fine — istantaneo.
//
// Ma una PWA installata sulla home di iOS gira in modalita' standalone, e li'
// quel pannello NON ESISTE: niente barra degli indirizzi, niente UI di
// sistema per il prompt. WebKit resta appeso sulla negoziazione, va in
// timeout e solo dopo ripiega sulle credenziali salvate. Sono i 10-15 secondi
// che Dario vedeva a OGNI apertura dall'icona — sempre gli stessi in WiFi e
// in 4G, perche' non e' roba che si scarica: e' un'attesa.
//
// Col cookie non c'e' nessuna negoziazione: il browser lo manda insieme alla
// richiesta e il middleware lo confronta. Zero round trip in piu', zero
// prompt, zero timeout. E la password smette di viaggiare a ogni singola
// richiesta come faceva la Basic Auth: viaggia una volta sola, al login.
//
// COS'E' IL GETTONE
// L'HMAC-SHA256 di una stringa fissa con APP_PASSWORD come chiave. Ha tre
// proprieta' che servono tutte:
//   - e' deterministico, quindi il middleware puo' ricalcolarlo e confrontarlo
//     senza tenere da nessuna parte un elenco di sessioni attive;
//   - e' a senso unico, quindi chi leggesse il cookie non risale alla
//     password;
//   - cambia se cambia APP_PASSWORD, quindi cambiare la password su Vercel
//     invalida tutte le sessioni su tutti i dispositivi. E' la via d'uscita
//     se un telefono viene perso.
//
// Si usa Web Crypto e non node:crypto perche' questo modulo gira anche dentro
// il middleware, che sta su Edge Runtime, dove i moduli di Node non esistono.

const ETICHETTA = "dario-ai-agents-sessione-v1";
export const COOKIE_SESSIONE = "dario_sess";

// Un anno: la password si inserisce una volta per dispositivo e non se ne
// parla piu'. Una scadenza corta qui vorrebbe dire ritrovarsi la richiesta di
// password sul telefono senza capire perche', che e' esattamente il tipo di
// attrito che fa smettere di aprire l'app.
export const DURATA_COOKIE_S = 365 * 24 * 60 * 60;

let cache = null; // { password, gettone } — evita di rifare l'HMAC a ogni richiesta

export async function gettoneAtteso(password) {
  if (!password) return null;
  if (cache && cache.password === password) return cache.gettone;

  const enc = new TextEncoder();
  const chiave = await crypto.subtle.importKey(
    "raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const firma = await crypto.subtle.sign("HMAC", chiave, enc.encode(ETICHETTA));
  const gettone = [...new Uint8Array(firma)].map(b => b.toString(16).padStart(2, "0")).join("");

  cache = { password, gettone };
  return gettone;
}

// Confronto a tempo costante: stesso ragionamento che c'era sulla password in
// middleware.js, e qui vale ancora di piu' perche' il gettone e' l'unica cosa
// che separa un dispositivo dai dati.
export function confrontoCostante(a, b) {
  const sa = String(a ?? "");
  const sb = String(b ?? "");
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

export async function cookieValido(valoreCookie, password) {
  const atteso = await gettoneAtteso(password);
  if (!atteso) return false;
  return confrontoCostante(valoreCookie, atteso);
}
