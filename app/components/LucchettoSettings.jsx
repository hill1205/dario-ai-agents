"use client";

import { useState, useEffect, useCallback } from "react";
import {
  registraQuestoDispositivo, biometriaDisponibile, nomeDispositivo, spiegaErrore,
} from "../lib/passkey-client";

// Pannello "Sblocco biometrico" dentro le Impostazioni.
//
// Componente in un file suo e non definito dentro page.jsx: vedi la trappola
// dei componenti inline già pagata su questo progetto — ridefinirlo a ogni
// render lo rimonta da capo, azzerando stato e focus.

export default function LucchettoSettings({ theme }) {
  const [dispositivi, setDispositivi] = useState(null);
  const [questoProtetto, setQuestoProtetto] = useState(false);
  const [disponibile, setDisponibile] = useState(false);
  const [stato, setStato] = useState(null); // null | "lavoro" | "errore" | "fatto"
  const [messaggio, setMessaggio] = useState("");

  const carica = useCallback(async () => {
    try {
      const res = await fetch("/api/passkey", { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json();
      setDispositivi(j.dispositivi || []);
      setQuestoProtetto(!!j.questoProtetto);
    } catch {}
  }, []);

  useEffect(() => { biometriaDisponibile().then(setDisponibile); carica(); }, [carica]);

  const attiva = async () => {
    setStato("lavoro"); setMessaggio("");
    try {
      await registraQuestoDispositivo(nomeDispositivo());
      setStato("fatto");
      setMessaggio("Attivato. Alla prossima apertura ti chiederà Face ID o l'impronta.");
      carica();
    } catch (e) {
      setStato("errore");
      setMessaggio(spiegaErrore(e));
    }
  };

  const revoca = async (id, nome) => {
    if (!confirm(`Togliere lo sblocco biometrico da "${nome}"?\n\nQuel dispositivo tornerà a chiedere solo la password.`)) return;
    setStato("lavoro"); setMessaggio("");
    try {
      const res = await fetch(`/api/passkey?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Non sono riuscito a revocarlo.");
      setStato(null);
      carica();
    } catch (e) {
      setStato("errore");
      setMessaggio(e.message);
    }
  };

  const bordo = theme === "light" ? "#E2E8F0" : "#1A1A2E";

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${bordo}` }}>
      <div style={{ fontSize: 11, color: "#64748B", marginBottom: 8 }}>🔐 Sblocco biometrico</div>

      {questoProtetto ? (
        <div style={{ fontSize: 11, color: "#10B981", background: "#10B98115", border: "1px solid #10B98140", borderRadius: 8, padding: "8px 10px", marginBottom: 10, lineHeight: 1.45 }}>
          Questo dispositivo è protetto: all'apertura chiede Face ID o l'impronta.
        </div>
      ) : disponibile ? (
        <>
          <p style={{ fontSize: 11, color: "#64748B", margin: "0 0 8px", lineHeight: 1.5 }}>
            Attivalo su questo dispositivo per farti chiedere il volto o il dito
            a ogni apertura. Gli altri dispositivi non cambiano.
          </p>
          <button
            onClick={attiva}
            disabled={stato === "lavoro"}
            style={{
              width: "100%", padding: "9px 12px", borderRadius: 8, border: "none",
              background: stato === "lavoro" ? "#1E293B" : "#6366F1",
              color: stato === "lavoro" ? "#64748B" : "#fff",
              fontSize: 12, fontWeight: 700, cursor: stato === "lavoro" ? "default" : "pointer",
            }}
          >
            {stato === "lavoro" ? "Attendo il dispositivo…" : "Attiva su questo dispositivo"}
          </button>
        </>
      ) : (
        <p style={{ fontSize: 11, color: "#475569", margin: "0 0 8px", lineHeight: 1.5 }}>
          Questo dispositivo non ha uno sblocco biometrico utilizzabile dal browser
          (serve Face ID, Touch ID o l'impronta). Resta protetto dalla password.
        </p>
      )}

      {messaggio && (
        <div style={{
          marginTop: 8, padding: "8px 10px", borderRadius: 8, fontSize: 11, lineHeight: 1.45,
          background: stato === "errore" ? "#EF444415" : "#10B98115",
          border: `1px solid ${stato === "errore" ? "#EF444440" : "#10B98140"}`,
          color: stato === "errore" ? "#FCA5A5" : "#6EE7B7",
        }}>
          {messaggio}
        </div>
      )}

      {dispositivi && dispositivi.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, color: "#475569", marginBottom: 5 }}>Dispositivi registrati</div>
          {dispositivi.map((d) => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 8px", borderRadius: 7, border: `1px solid ${bordo}`, marginBottom: 5 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600 }}>{d.nome}</div>
                <div style={{ fontSize: 9.5, color: "#475569" }}>
                  dal {d.creata ? new Date(d.creata).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                  {d.ultimoUso ? ` · ultimo uso ${new Date(d.ultimoUso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}` : ""}
                </div>
              </div>
              <button
                onClick={() => revoca(d.id, d.nome)}
                style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #EF444450", background: "#EF444415", color: "#EF4444", cursor: "pointer", fontSize: 10, flexShrink: 0 }}
              >
                Revoca
              </button>
            </div>
          ))}
          <p style={{ fontSize: 9.5, color: "#475569", marginTop: 6, lineHeight: 1.5 }}>
            Se perdi un dispositivo, revocalo da qui. Per sganciarli tutti in una
            volta cambia APP_PASSWORD su Vercel.
          </p>
        </div>
      )}
    </div>
  );
}
