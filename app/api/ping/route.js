export const dynamic = "force-dynamic";

import { tipoSessione, leggiCookie, COOKIE_SESSIONE, GRAZIA_BACKGROUND_S, BATTITO_S } from "../../lib/sessione";

// Il battito del lucchetto: "l'app è ancora aperta davanti a me".
//
// Non fa niente di suo. Il lavoro lo fa il middleware, che a ogni richiesta
// valida sposta in avanti la scadenza dello sblocco: questa route esiste solo
// per dargli qualcosa da spostare mentre stai guardando l'app senza toccarla.
//
// È deliberatamente la risposta più piccola dell'app — nessuna chiamata a
// ClickUp, nessun calcolo — perché parte ogni 30 secondi e non deve pesare
// né sulla batteria né sulle invocazioni Vercel.
//
// Restituisce anche se QUESTO dispositivo ha il lucchetto attivo, così il
// client sa se deve fare la guardia o starsene fermo (sul computer, dove il
// lucchetto non c'è, BloccoSchermo non fa assolutamente nulla).
export async function GET(request) {
  const password = process.env.APP_PASSWORD;
  if (!password) return Response.json({ protetto: false });

  const sessione = await tipoSessione(leggiCookie(request, COOKIE_SESSIONE), password);
  return Response.json({
    protetto: sessione === "bio",
    graziaS: GRAZIA_BACKGROUND_S,
    battitoS: BATTITO_S,
  });
}
