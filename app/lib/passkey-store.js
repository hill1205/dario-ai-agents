// I passkey registrati, sul Doc ClickUp come tutto il resto dei dati.
//
// COSA C'E' DENTRO, E PERCHE' NON E' UN PROBLEMA CHE STIA LI'
// Solo CHIAVI PUBBLICHE. Una chiave pubblica serve a verificare una firma,
// non a produrla: chi la leggesse non potrebbe sbloccare niente. La chiave
// privata non esce mai dal chip sicuro del telefono — non passa dal server,
// non passa da ClickUp, non esiste da nessuna parte se non dentro l'iPhone.
//
// Forma di una voce:
//   { id, jwk, contatore, nome, creata, ultimoUso }
//
// `contatore` e' il contatore anti-clonazione dell'autenticatore: se una
// firma arriva con un contatore piu' basso di quello gia' visto, qualcuno ha
// copiato la credenziale. Apple e Google lo tengono a 0 (i loro passkey si
// sincronizzano tra dispositivi, quindi un contatore crescente non avrebbe
// senso), quindi il controllo si applica solo se l'autenticatore lo usa.

import { creaArchivio, PAGINE } from "./clickup-doc";

const archivio = creaArchivio({
  pageId: PAGINE.passkey,
  marcatore: "PASSKEY_DATA_JSON",
  vuoto: [],
  intestazione: [
    "CHIAVI DI SBLOCCO BIOMETRICO DEI DISPOSITIVI",
    "",
    "Non modificare a mano: viene letto/scritto dalla dashboard.",
    "Qui stanno solo le CHIAVI PUBBLICHE dei passkey registrati: servono a",
    "verificare una firma, non a produrla. La chiave privata non esce mai dal",
    "chip sicuro del telefono.",
    "",
    "Cancellare una voce = quel dispositivo torna a chiedere la password.",
  ].join("\n"),
  // Le scritture sono rare (una registrazione ogni tanto) ma vanno sempre
  // fatte sul contenuto reale: due telefoni registrati a distanza di poco
  // non devono cancellarsi a vicenda.
  senzaCache: true,
});

export async function elencoPasskey() {
  return archivio.leggi();
}

// Solo quello che serve al client: mai la chiave, mai roba che non si vede.
export async function passkeyPubblici() {
  return (await elencoPasskey()).map(({ id, nome, creata, ultimoUso }) => ({ id, nome, creata, ultimoUso }));
}

export async function trovaPasskey(id) {
  return (await elencoPasskey()).find((p) => p.id === id) || null;
}

export async function salvaPasskey({ id, jwk, contatore, nome }) {
  const lista = await elencoPasskey();
  // Ri-registrare lo stesso dispositivo aggiorna la voce invece di
  // aggiungerne una seconda identica.
  const i = lista.findIndex((p) => p.id === id);
  const voce = {
    id, jwk,
    contatore: contatore || 0,
    nome: (nome || "Dispositivo").slice(0, 60),
    creata: i >= 0 ? lista[i].creata : new Date().toISOString(),
    ultimoUso: null,
  };
  if (i >= 0) lista[i] = voce; else lista.push(voce);
  await archivio.scrivi(lista);
  return voce;
}

export async function aggiornaUso(id, contatore) {
  const lista = await elencoPasskey();
  const i = lista.findIndex((p) => p.id === id);
  if (i < 0) return;
  lista[i] = { ...lista[i], contatore, ultimoUso: new Date().toISOString() };
  await archivio.scrivi(lista);
}

export async function eliminaPasskey(id) {
  const lista = await elencoPasskey();
  const restanti = lista.filter((p) => p.id !== id);
  if (restanti.length === lista.length) return false;
  await archivio.scrivi(restanti);
  return true;
}
