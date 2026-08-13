"use client";

import { useState, useEffect } from "react";

// La pagina che sostituisce il pannello password di sistema.
//
// Deve esistere come pagina vera dell'app, e non come prompt del browser,
// proprio perche' il prompt del browser e' il problema: in una PWA iOS
// installata sulla home non c'e' nessuna UI di sistema che possa mostrarlo
// (vedi app/lib/sessione.js). Un form dentro la pagina invece si disegna
// ovunque, standalone compreso.

export default function Login() {
  const [password, setPassword] = useState("");
  const [stato, setStato] = useState(null); // null | "invio" | "errore"
  const [messaggio, setMessaggio] = useState("");
  const [dove, setDove] = useState("/");

  // Dove tornare dopo il login: il middleware lo passa in ?da=. Si accettano
  // solo percorsi interni che iniziano con una sola "/" — un "//altrosito"
  // sarebbe un URL assoluto travestito, e ci si ritroverebbe rimbalzati fuori
  // dall'app subito dopo aver messo la password.
  useEffect(() => {
    const da = new URLSearchParams(window.location.search).get("da");
    if (da && da.startsWith("/") && !da.startsWith("//")) setDove(da);
  }, []);

  const entra = async (e) => {
    e.preventDefault();
    if (!password || stato === "invio") return;
    setStato("invio"); setMessaggio("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // replace e non push: il tasto indietro non deve riportare al login.
        window.location.replace(dove);
        return;
      }
      const j = await res.json().catch(() => ({}));
      setStato("errore");
      setMessaggio(j.error || `Errore ${res.status}`);
    } catch (err) {
      setStato("errore");
      setMessaggio("Non riesco a contattare il server. Controlla la connessione.");
    }
  };

  return (
    <div style={{
      minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#09090F", color: "#E2E8F0",
      fontFamily: "system-ui, -apple-system, sans-serif", padding: 24, boxSizing: "border-box",
    }}>
      <form onSubmit={entra} style={{ width: "100%", maxWidth: 340 }}>
        <div style={{ fontSize: 40, textAlign: "center", marginBottom: 4 }}>🏠</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, textAlign: "center", margin: "0 0 24px" }}>
          Dario AI Agents
        </h1>

        <label htmlFor="pw" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#94A3B8", marginBottom: 6 }}>
          Password
        </label>
        <input
          id="pw"
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); if (stato === "errore") setStato(null); }}
          autoFocus
          autoComplete="current-password"
          // Il portachiavi di iOS propone la password salvata solo se il campo
          // e' dentro un <form> con un input password e autoComplete corretto:
          // cosi' si inserisce col Face ID invece che a mano.
          style={{
            width: "100%", boxSizing: "border-box", padding: "12px 14px",
            borderRadius: 10, border: `1px solid ${stato === "errore" ? "#EF4444" : "#334155"}`,
            background: "#0F0F1A", color: "#E2E8F0", fontSize: 16, // 16px: sotto, iOS zooma da solo sul campo
            outline: "none",
          }}
        />

        <button
          type="submit"
          disabled={!password || stato === "invio"}
          style={{
            width: "100%", marginTop: 12, padding: "12px 14px", borderRadius: 10, border: "none",
            background: !password || stato === "invio" ? "#1E293B" : "#6366F1",
            color: !password || stato === "invio" ? "#64748B" : "#fff",
            fontSize: 15, fontWeight: 700,
            cursor: !password || stato === "invio" ? "default" : "pointer",
          }}
        >
          {stato === "invio" ? "Entro…" : "Entra"}
        </button>

        {stato === "errore" && (
          <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 8, background: "#EF444415", border: "1px solid #EF444450", color: "#FCA5A5", fontSize: 13 }}>
            {messaggio}
          </div>
        )}

        <p style={{ marginTop: 20, fontSize: 11, color: "#475569", textAlign: "center", lineHeight: 1.5 }}>
          La password si inserisce una volta sola per dispositivo.
        </p>
      </form>
    </div>
  );
}
