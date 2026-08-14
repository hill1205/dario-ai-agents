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

// --- Il lucchetto biometrico -----------------------------------------------
//
// IL PROBLEMA CHE RISOLVE
// Un cookie che dura un anno rende comoda l'apertura ma lascia l'app
// PERMANENTEMENTE sbloccata su quel dispositivo: chi prende il telefono
// sbloccato e tocca l'icona vede saldi, clienti e fatturato. La password una
// volta l'anno non e' una protezione, e' un fastidio rimandato.
//
// COME FUNZIONA, E PERCHE' NON SERVE UN ELENCO DI DISPOSITIVI
// Registrare un passkey su un dispositivo ne cambia il gettone di sessione:
// da quello normale a una VARIANTE "bio". Il middleware, vedendo la variante
// bio, pretende anche uno sblocco recente. Quindi:
//   - il telefono (che ha registrato il Face ID) e' protetto;
//   - il computer (che non l'ha fatto) resta automatico, come voluto.
// Senza che il server debba sapere che dispositivo sta parlando.
//
// E soprattutto: la variante non si puo' DECLASSARE. Chi ha in mano il
// telefono possiede il gettone bio, ma per ottenere quello normale — e
// scavalcare il lucchetto — dovrebbe calcolare un HMAC di cui non ha la
// chiave, cioe' conoscere la password. Cancellare i cookie non aiuta: lo
// slogga e basta.
const ETICHETTA_BIO = "dario-ai-agents-sessione-bio-v1";
export const COOKIE_SBLOCCO = "dario_unlock";
export const COOKIE_CHALLENGE = "dario_chal";

// QUANTO DURA UNO SBLOCCO, E PERCHE' NON E' UN TIMER FISSO
//
// Prima erano 30 secondi secchi dal momento dello sblocco. Era sbagliato, e
// di quelli che si scoprono solo usando l'app: non voleva dire "si blocca 30
// secondi dopo che esci", voleva dire "si blocca 30 secondi dopo, e basta".
// Mentre stavi lavorando dentro l'app ti avrebbe richiesto il Face ID ogni
// mezzo minuto.
//
// Ora la finestra e' SCORREVOLE: ogni richiesta che passa dal middleware la
// sposta in avanti (vedi middleware.js). Finche' l'app e' aperta e viva
// davanti a te, resta sbloccata; quando la chiudi o la mandi in secondo
// piano, il battito si ferma e la finestra si esaurisce da sola.
//
// 90 secondi e non 60: la grazia che conta e' quella del client
// (GRAZIA_BACKGROUND_S), questa e' solo la rete di sicurezza del server e
// deve essere un po' piu' larga, altrimenti il lucchetto scatterebbe per
// colpa di un battito arrivato in ritardo sulla rete mobile.
export const DURATA_SBLOCCO_S = 90;

// Quanto puoi stare fuori dall'app prima che si richiuda.
//
// E' il minuto chiesto da Dario: il tempo di uscire, copiare un numero da
// WhatsApp o leggere un messaggio, e rientrare senza che ti richieda niente.
// Oltre, alla riapertura serve di nuovo il volto o il dito.
export const GRAZIA_BACKGROUND_S = 60;

// Ogni quanto l'app aperta e in primo piano dice "ci sono ancora".
// Abbondantemente sotto DURATA_SBLOCCO_S, cosi' anche saltando un battito
// per una connessione ballerina non si viene buttati fuori mentre si lavora.
export const BATTITO_S = 30;

// Le challenge vivono due minuti: il tempo di guardare il telefono e
// appoggiare il dito, non abbastanza da essere riusate se intercettate.
export const DURATA_CHALLENGE_S = 120;

// Un anno: la password si inserisce una volta per dispositivo e non se ne
// parla piu'. Una scadenza corta qui vorrebbe dire ritrovarsi la richiesta di
// password sul telefono senza capire perche', che e' esattamente il tipo di
// attrito che fa smettere di aprire l'app.
export const DURATA_COOKIE_S = 365 * 24 * 60 * 60;

// Legge un cookie dall'header, invece di affidarsi a request.cookies.
//
// Nelle route handler dell'App Router `request.cookies` c'e' solo se il
// runtime consegna una NextRequest, e non e' garantito: con l'optional
// chaining sarebbe tornato `undefined` senza un errore, cioe' "non
// autenticato" su una richiesta perfettamente valida — un guasto muto, il
// peggior tipo. L'header Cookie invece c'e' sempre, in ogni runtime.
export function leggiCookie(request, nome) {
  const grezzo = request.headers?.get?.("cookie") || "";
  for (const pezzo of grezzo.split(";")) {
    const i = pezzo.indexOf("=");
    if (i < 0) continue;
    if (pezzo.slice(0, i).trim() === nome) return pezzo.slice(i + 1).trim();
  }
  return null;
}

const cache = new Map(); // "password|messaggio" -> hmac, per non rifarlo a ogni richiesta

async function hmac(password, messaggio) {
  if (!password) return null;
  const k = `${password}|${messaggio}`;
  const gia = cache.get(k);
  if (gia) return gia;

  const enc = new TextEncoder();
  const chiave = await crypto.subtle.importKey(
    "raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const firma = await crypto.subtle.sign("HMAC", chiave, enc.encode(messaggio));
  const esa = [...new Uint8Array(firma)].map(b => b.toString(16).padStart(2, "0")).join("");

  // La cache tiene solo gettoni a messaggio fisso (sessione/bio). Le firme di
  // sblocco e challenge hanno un messaggio diverso ogni volta, quindi non
  // vanno accumulate: gonfierebbero la memoria dell'istanza per niente.
  if (messaggio === ETICHETTA || messaggio === ETICHETTA_BIO) cache.set(k, esa);
  return esa;
}

export const gettoneAtteso = (password) => hmac(password, ETICHETTA);
export const gettoneBio = (password) => hmac(password, ETICHETTA_BIO);

// Quale sessione e' questa: nessuna, normale, o "protetta dal biometrico".
export async function tipoSessione(valoreCookie, password) {
  if (!valoreCookie || !password) return "nessuna";
  if (confrontoCostante(valoreCookie, await gettoneAtteso(password))) return "normale";
  if (confrontoCostante(valoreCookie, await gettoneBio(password))) return "bio";
  return "nessuna";
}

/* ------------------------------------------------- gettone di sblocco ----- */
// Formato "<scadenzaMs>.<firma>": la scadenza viaggia in chiaro ma e' firmata
// insieme al resto, quindi spostarla in avanti invalida la firma. Cosi' il
// middleware verifica uno sblocco recente senza tenere da nessuna parte un
// elenco di sessioni aperte — che su Vercel, dove ogni istanza ha la sua
// memoria, non funzionerebbe comunque.

export async function creaGettoneSblocco(password, durataS = DURATA_SBLOCCO_S) {
  const scadenza = Date.now() + durataS * 1000;
  const firma = await hmac(password, `sblocco|${scadenza}`);
  return `${scadenza}.${firma}`;
}

export async function sbloccoValido(valore, password) {
  if (!valore || !password) return false;
  const i = String(valore).indexOf(".");
  if (i < 0) return false;
  const scadenza = Number(String(valore).slice(0, i));
  const firma = String(valore).slice(i + 1);
  if (!Number.isFinite(scadenza) || Date.now() > scadenza) return false;
  return confrontoCostante(firma, await hmac(password, `sblocco|${scadenza}`));
}

/* ------------------------------------------------------- challenge -------- */
// Il challenge e' il numero casuale che l'autenticatore firma: serve a
// impedire che una firma catturata una volta venga rigiocata per sempre.
// Va ricordato tra la richiesta e la risposta, e anche qui si evita uno stato
// sul server firmandolo e rimandandolo al browser in un cookie.

export async function creaGettoneChallenge(password, challengeB64url) {
  const scadenza = Date.now() + DURATA_CHALLENGE_S * 1000;
  const firma = await hmac(password, `chal|${challengeB64url}|${scadenza}`);
  return `${scadenza}.${challengeB64url}.${firma}`;
}

export async function challengeValido(valore, challengeRicevuto, password) {
  if (!valore || !password) return false;
  const parti = String(valore).split(".");
  if (parti.length !== 3) return false;
  const [scadenzaS, atteso, firma] = parti;
  const scadenza = Number(scadenzaS);
  if (!Number.isFinite(scadenza) || Date.now() > scadenza) return false;
  // Il challenge tornato indietro dentro clientDataJSON deve essere QUELLO
  // che abbiamo emesso, non uno qualsiasi con una firma valida.
  if (!confrontoCostante(atteso, challengeRicevuto)) return false;
  return confrontoCostante(firma, await hmac(password, `chal|${atteso}|${scadenza}`));
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
