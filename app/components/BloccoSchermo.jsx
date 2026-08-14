"use client";

import { useEffect, useRef, useState } from "react";

// La guardia che richiude l'app quando esci.
//
// COSA DEVE FARE, DETTO COME L'HA CHIESTO DARIO
// «Ogni volta che blocco il telefono, quando lo sblocco devo poter sbloccare
// anche l'applicazione. L'applicazione si deve bloccare ogni volta che chiudo,
// lasciando un minuto di latenza, perché se devo copiare e incollare qualcosa
// mi serve quel minuto.»
//
// Quindi il lucchetto NON è un timer che parte dallo sblocco: è legato
// all'uscita dall'app. Due meccanismi che lavorano insieme:
//
//   1. IL BATTITO. Finché l'app è visibile davanti a te, ogni 30 secondi
//      manda un colpo a /api/ping. Il middleware, a ogni richiesta valida,
//      sposta in avanti la scadenza dello sblocco. Risultato: mentre lavori
//      non si blocca mai, nemmeno se resti fermo a leggere una pagina.
//
//   2. LA GUARDIA SULL'USCITA. Quando la pagina va in secondo piano (blocchi
//      il telefono, cambi app, chiudi) il battito si ferma e si segna l'ora.
//      Al ritorno, se sei stato via più di un minuto, si va dritti alla
//      schermata di sblocco senza aspettare che scada niente.
//
// Il secondo meccanismo è quello che si vede; il primo è quello che rende il
// secondo sopportabile. E se il telefono uccide del tutto la pagina mentre è
// in background — cosa che iOS fa spesso — al ritorno non gira nessun
// JavaScript nostro: lì è la scadenza lato server a fare il lavoro, e la
// prima chiamata dati riceve 401 e porta comunque allo sblocco.
//
// Sul computer questo componente non fa NULLA: /api/ping risponde che il
// dispositivo non è protetto e la guardia non parte nemmeno.

export default function BloccoSchermo() {
  const [attivo, setAttivo] = useState(false);
  const graziaMs = useRef(60000);
  const battitoMs = useRef(30000);
  const uscitoAlle = useRef(null);

  // Si chiede una volta sola se questo dispositivo ha il lucchetto.
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch("/api/ping", { cache: "no-store" });
        if (!r.ok || !vivo) return;
        const j = await r.json();
        if (j.graziaS) graziaMs.current = j.graziaS * 1000;
        if (j.battitoS) battitoMs.current = j.battitoS * 1000;
        setAttivo(!!j.protetto);
      } catch {}
    })();
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!attivo) return;

    const alloSblocco = () => {
      const da = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/sblocca?da=${da}`);
    };

    const battito = () => {
      // Solo se l'app è davvero davanti agli occhi: un battito mandato da una
      // scheda in secondo piano terrebbe l'app sbloccata mentre il telefono è
      // in tasca, cioè esattamente il contrario di quello che serve.
      if (document.visibilityState !== "visible") return;
      fetch("/api/ping", { cache: "no-store" }).catch(() => {});
    };

    const id = setInterval(battito, battitoMs.current);

    const suVisibilita = () => {
      if (document.visibilityState === "hidden") {
        uscitoAlle.current = Date.now();
        return;
      }
      // Rientro: se sono stato via più della grazia, si blocca.
      const via = uscitoAlle.current ? Date.now() - uscitoAlle.current : 0;
      uscitoAlle.current = null;
      if (via > graziaMs.current) { alloSblocco(); return; }
      battito(); // rientro entro il minuto: si riparte subito, senza chiedere niente
    };

    document.addEventListener("visibilitychange", suVisibilita);
    // pagehide copre la chiusura vera e propria su iOS, dove
    // visibilitychange da solo non sempre arriva.
    window.addEventListener("pagehide", () => { uscitoAlle.current = Date.now(); });

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", suVisibilita);
    };
  }, [attivo]);

  return null; // non disegna niente: è solo una guardia
}
