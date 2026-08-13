"use client";

import { useState, useEffect, useCallback } from "react";
import { sbloccaConBiometria, passkeySupportati, spiegaErrore } from "../lib/passkey-client";

// La schermata di sblocco del telefono.
//
// PRINCIPIO NON NEGOZIABILE: da qui non si resta MAI chiusi fuori.
// Il Face ID può fallire per mille motivi che non dipendono da te — un
// aggiornamento di iOS, il sensore bagnato, una PWA che si comporta in modo
// strano in standalone. Per questo la password è sempre a un tocco di
// distanza. Non indebolisce niente: la password è comunque il segreto da cui
// deriva tutto il resto, e chi ti ruba il telefono non ce l'ha.

export default function Sblocca() {
  const [stato, setStato] = useState("pronto"); // pronto | sblocco | errore
  const [messaggio, setMessaggio] = useState("");
  const [conPassword, setConPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [dove, setDove] = useState("/");

  useEffect(() => {
    const da = new URLSearchParams(window.location.search).get("da");
    if (da && da.startsWith("/") && !da.startsWith("//")) setDove(da);
  }, []);

  const sblocca = useCallback(async () => {
    if (stato === "sblocco") return;
    setStato("sblocco"); setMessaggio("");
    try {
      await sbloccaConBiometria();
      window.location.replace(dove);
    } catch (e) {
      setStato("errore");
      setMessaggio(spiegaErrore(e));
    }
  }, [stato, dove]);

  // Si parte subito con la richiesta biometrica: nel caso normale l'app si
  // apre, guardi lo schermo ed è già dentro, senza toccare niente.
  //
  // Ma NON in automatico se il browser non li supporta, e non in un ciclo:
  // dopo un errore si aspetta un tocco, altrimenti su un dispositivo che
  // rifiuta sempre si finirebbe in un carosello di richieste impossibile da
  // interrompere.
  useEffect(() => {
    if (!passkeySupportati()) { setConPassword(true); return; }
    sblocca();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entraConPassword = async (e) => {
    e.preventDefault();
    if (!password) return;
    setStato("sblocco"); setMessaggio("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) { window.location.replace(dove); return; }
      const j = await res.json().catch(() => ({}));
      setStato("errore");
      setMessaggio(j.error || `Errore ${res.status}`);
    } catch {
      setStato("errore");
      setMessaggio("Non riesco a contattare il server.");
    }
  };

  return (
    <div style={{
      minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#09090F", color: "#E2E8F0",
      fontFamily: "system-ui, -apple-system, sans-serif", padding: 24, boxSizing: "border-box",
    }}>
      <div style={{ width: "100%", maxWidth: 340, textAlign: "center" }}>
        <div style={{ fontSize: 44, marginBottom: 6 }}>{stato === "errore" ? "🔒" : "👤"}</div>
        <h1 style={{ fontSize: 19, fontWeight: 700, margin: "0 0 6px" }}>App bloccata</h1>
        <p style={{ fontSize: 13, color: "#94A3B8", margin: "0 0 22px", lineHeight: 1.5 }}>
          {stato === "sblocco" ? "Sto verificando…" : "Sbloccala con Face ID o l'impronta."}
        </p>

        {!conPassword && (
          <>
            <button
              onClick={sblocca}
              disabled={stato === "sblocco"}
              style={{
                width: "100%", padding: "13px 14px", borderRadius: 10, border: "none",
                background: stato === "sblocco" ? "#1E293B" : "#6366F1",
                color: stato === "sblocco" ? "#64748B" : "#fff",
                fontSize: 15, fontWeight: 700, cursor: stato === "sblocco" ? "default" : "pointer",
              }}
            >
              {stato === "sblocco" ? "Verifico…" : "Sblocca"}
            </button>

            <button
              onClick={() => { setConPassword(true); setStato("pronto"); setMessaggio(""); }}
              style={{
                width: "100%", marginTop: 10, padding: "10px 14px", borderRadius: 10,
                border: "1px solid #334155", background: "transparent", color: "#94A3B8",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              Usa la password
            </button>
          </>
        )}

        {conPassword && (
          <form onSubmit={entraConPassword}>
            <input
              type="text" name="username" value="dario" readOnly autoComplete="username"
              style={{ display: "none" }}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); if (stato === "errore") setStato("pronto"); }}
              autoFocus
              autoComplete="current-password"
              placeholder="Password"
              style={{
                width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 10,
                border: `1px solid ${stato === "errore" ? "#EF4444" : "#334155"}`,
                background: "#0F0F1A", color: "#E2E8F0", fontSize: 16, outline: "none", textAlign: "center",
              }}
            />
            <button
              type="submit"
              disabled={!password || stato === "sblocco"}
              style={{
                width: "100%", marginTop: 10, padding: "12px 14px", borderRadius: 10, border: "none",
                background: !password || stato === "sblocco" ? "#1E293B" : "#6366F1",
                color: !password || stato === "sblocco" ? "#64748B" : "#fff",
                fontSize: 15, fontWeight: 700,
                cursor: !password || stato === "sblocco" ? "default" : "pointer",
              }}
            >
              Entra
            </button>
            {passkeySupportati() && (
              <button
                type="button"
                onClick={() => { setConPassword(false); setStato("pronto"); setMessaggio(""); }}
                style={{
                  width: "100%", marginTop: 10, padding: "10px 14px", borderRadius: 10,
                  border: "1px solid #334155", background: "transparent", color: "#94A3B8",
                  fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                Torna a Face ID / impronta
              </button>
            )}
          </form>
        )}

        {stato === "errore" && messaggio && (
          <div style={{ marginTop: 14, padding: "9px 12px", borderRadius: 8, background: "#EF444415", border: "1px solid #EF444450", color: "#FCA5A5", fontSize: 12.5, lineHeight: 1.45 }}>
            {messaggio}
          </div>
        )}
      </div>
    </div>
  );
}
