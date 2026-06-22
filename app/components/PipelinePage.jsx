"use client";
import { useState, useEffect } from "react";

const LEAD_STAGES = [
  { id: "da_contattare",   label: "Da Contattare",    color: "#475569" },
  { id: "contattato",      label: "Contattato",        color: "#3B82F6" },
  { id: "proposta_inviata",label: "Proposta Inviata",  color: "#F59E0B" },
  { id: "in_trattativa",   label: "In Trattativa",     color: "#F97316" },
  { id: "vinto",           label: "Vinto 🎉",          color: "#10B981" },
  { id: "perso",           label: "Perso",             color: "#EF4444" },
];

const CLIENT_STAGES = [
  { id: "attivo",    label: "Attivo ✅",  color: "#10B981" },
  { id: "in_pausa",  label: "In Pausa",   color: "#F59E0B" },
  { id: "concluso",  label: "Concluso",   color: "#475569" },
];

const EMPTY_FORM = {
  id: null, tipo: "lead", nome: "", contatto: "", email: "",
  telefono: "", budget: "", stage: "da_contattare",
  data: new Date().toISOString().slice(0, 10), note: "", clickupId: null,
};

function genId() { return Math.random().toString(36).slice(2, 10); }

function stageColor(stageId, tipo) {
  const list = tipo === "cliente" ? CLIENT_STAGES : LEAD_STAGES;
  return list.find(s => s.id === stageId)?.color || "#475569";
}

function stageLabel(stageId, tipo) {
  const list = tipo === "cliente" ? CLIENT_STAGES : LEAD_STAGES;
  return list.find(s => s.id === stageId)?.label || stageId;
}

function InputField({ label, value, onChange, type = "text", full = false }) {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : undefined }}>
      <div style={{ fontSize: 11, color: "#64748B", marginBottom: 4 }}>{label}</div>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid #1A1A2E", background: "#09090F", color: "#E2E8F0", fontSize: 13, outline: "none" }}
      />
    </div>
  );
}

function EntryCard({ entry, onEdit, onDelete, onSync, syncing, fs }) {
  const color = stageColor(entry.stage, entry.tipo);
  return (
    <div style={{ background: "#0F0F1A", border: "1px solid #1A1A2E", borderLeft: `3px solid ${color}`, borderRadius: 8, padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <div style={{ fontSize: fs - 1, fontWeight: 700, color: "#E2E8F0", lineHeight: 1.3, flex: 1, paddingRight: 6 }}>{entry.nome}</div>
        <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
          <button onClick={() => onEdit(entry)} style={{ width: 22, height: 22, borderRadius: 4, border: "none", background: "#1A1A2E", color: "#94A3B8", cursor: "pointer", fontSize: 10 }}>✏️</button>
          <button onClick={() => onDelete(entry.id)} style={{ width: 22, height: 22, borderRadius: 4, border: "none", background: "#1A1A2E", color: "#EF4444", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>×</button>
        </div>
      </div>
      {entry.contatto && <div style={{ fontSize: fs - 4, color: "#64748B", marginBottom: 2 }}>👤 {entry.contatto}</div>}
      {entry.email && <div style={{ fontSize: fs - 4, color: "#64748B", marginBottom: 2 }}>📧 {entry.email}</div>}
      {entry.budget && <div style={{ fontSize: fs - 3, color: "#10B981", fontWeight: 700, marginBottom: 4 }}>💶 {parseFloat(entry.budget).toLocaleString("it-IT")}€/mese</div>}
      {entry.note && <div style={{ fontSize: fs - 4, color: "#475569", lineHeight: 1.4, marginBottom: 4 }}>{entry.note.slice(0, 70)}{entry.note.length > 70 ? "…" : ""}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, borderTop: "1px solid #1A1A2E", paddingTop: 6 }}>
        <div style={{ fontSize: fs - 5, color: "#334155" }}>{entry.data}</div>
        {entry.clickupId
          ? <div style={{ fontSize: 9, color: "#334155" }}>✅ ClickUp</div>
          : <button onClick={() => onSync(entry)} style={{ padding: "2px 8px", borderRadius: 5, border: "1px solid #1E3A5F", background: "transparent", color: "#3B82F6", cursor: "pointer", fontSize: 9 }}>{syncing === entry.id ? "⏳" : "☁️ Sync"}</button>
        }
      </div>
    </div>
  );
}

function KanbanView({ entries, filter, fs, onEdit, onDelete, onSync, syncing, openAdd }) {
  const cols = filter === "cliente"
    ? CLIENT_STAGES.map(s => ({ ...s, tipo: "cliente" }))
    : filter === "lead"
      ? LEAD_STAGES.map(s => ({ ...s, tipo: "lead" }))
      : [
          ...LEAD_STAGES.map(s => ({ ...s, tipo: "lead" })),
          ...CLIENT_STAGES.map(s => ({ ...s, tipo: "cliente" })),
        ];

  return (
    <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden", display: "flex", gap: 10, padding: 16, alignItems: "flex-start" }}>
      {cols.map(col => {
        const colEntries = entries.filter(e => e.stage === col.id && e.tipo === col.tipo);
        return (
          <div key={`${col.tipo}-${col.id}`} style={{ minWidth: 210, maxWidth: 210, display: "flex", flexDirection: "column", gap: 7, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderRadius: 8, background: `${col.color}12`, border: `1px solid ${col.color}30` }}>
              <div>
                <div style={{ fontSize: 9, color: col.color, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.08em" }}>{col.tipo === "lead" ? "Lead" : "Cliente"}</div>
                <div style={{ fontSize: fs - 2, fontWeight: 700, color: col.color }}>{col.label}</div>
              </div>
              <div style={{ fontSize: fs - 3, color: col.color, background: `${col.color}20`, borderRadius: 10, padding: "1px 7px", fontWeight: 700 }}>{colEntries.length}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {colEntries.map(e => (
                <EntryCard key={e.id} entry={e} onEdit={onEdit} onDelete={onDelete} onSync={onSync} syncing={syncing} fs={fs} />
              ))}
            </div>
            <button onClick={() => openAdd(col.tipo, col.id)} style={{ padding: "6px", borderRadius: 7, border: `1px dashed ${col.color}40`, background: "transparent", color: col.color, cursor: "pointer", fontSize: 11, opacity: 0.5 }}>
              + aggiungi
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ListView({ entries, fs, onEdit, onDelete, onSync, syncing }) {
  if (entries.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: fs - 2 }}>
        Nessun record — aggiungi il primo lead o cliente!
      </div>
    );
  }
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
      <div style={{ background: "#0F0F1A", border: "1px solid #1A1A2E", borderRadius: 10, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 80px 130px 80px 130px 80px", background: "#09090F", borderBottom: "1px solid #1A1A2E" }}>
          {["Nome", "Tipo", "Stage", "Budget", "Contatto", ""].map(h => (
            <div key={h} style={{ padding: "9px 12px", fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</div>
          ))}
        </div>
        {/* Rows */}
        {entries.map((entry, i) => {
          const color = stageColor(entry.stage, entry.tipo);
          const bg = i % 2 === 0 ? "#0F0F1A" : "#0B0B16";
          const cell = { padding: "10px 12px", fontSize: fs - 2, color: "#94A3B8", borderTop: i === 0 ? "none" : "1px solid #1A1A2E", background: bg, display: "flex", alignItems: "center" };
          return (
            <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "2fr 80px 130px 80px 130px 80px" }}>
              <div style={{ ...cell, color: "#E2E8F0", fontWeight: 600, flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                <span>{entry.nome}</span>
                {entry.note && <span style={{ fontSize: fs - 5, color: "#334155", fontWeight: 400 }}>{entry.note.slice(0, 40)}…</span>}
              </div>
              <div style={cell}>
                <span style={{ padding: "2px 7px", borderRadius: 10, background: entry.tipo === "lead" ? "#3B82F620" : "#10B98120", color: entry.tipo === "lead" ? "#3B82F6" : "#10B981", fontSize: 10, fontWeight: 600 }}>
                  {entry.tipo === "lead" ? "Lead" : "Cliente"}
                </span>
              </div>
              <div style={cell}>
                <span style={{ padding: "2px 8px", borderRadius: 10, background: `${color}20`, color, fontSize: 10, fontWeight: 600 }}>{stageLabel(entry.stage, entry.tipo)}</span>
              </div>
              <div style={{ ...cell, color: "#10B981", fontWeight: 700 }}>{entry.budget ? `${parseFloat(entry.budget).toLocaleString("it-IT")}€` : "–"}</div>
              <div style={cell}>{entry.contatto || "–"}</div>
              <div style={{ ...cell, gap: 4 }}>
                <button onClick={() => onEdit(entry)} style={{ width: 24, height: 24, borderRadius: 5, border: "1px solid #1A1A2E", background: "transparent", color: "#64748B", cursor: "pointer", fontSize: 10 }}>✏️</button>
                {!entry.clickupId && (
                  <button onClick={() => onSync(entry)} style={{ width: 24, height: 24, borderRadius: 5, border: "1px solid #1E3A5F", background: "transparent", color: "#3B82F6", cursor: "pointer", fontSize: 10 }}>{syncing === entry.id ? "⏳" : "☁️"}</button>
                )}
                <button onClick={() => onDelete(entry.id)} style={{ width: 24, height: 24, borderRadius: 5, border: "1px solid #2A1A1A", background: "transparent", color: "#EF4444", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>×</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function PipelinePage({ fontSize = 14 }) {
  const fs = fontSize;
  const [entries, setEntries] = useState([]);
  const [view, setView] = useState("kanban");
  const [filter, setFilter] = useState("tutti");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("dario-pipeline");
      if (saved) setEntries(JSON.parse(saved));
    } catch (e) {}
    syncClickup();
  }, []);

  const persist = (updated) => {
    setEntries(updated);
    try { localStorage.setItem("dario-pipeline", JSON.stringify(updated)); } catch (e) {}
  };

  const syncClickup = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pipeline");
      if (!res.ok) return;
      const data = await res.json();
      setEntries(prev => {
        const merged = [...prev];
        const process = (tasks, tipo) => {
          tasks.forEach(task => {
            if (!merged.find(e => e.clickupId === task.id)) {
              let extra = {};
              try { extra = JSON.parse(task.description || "{}"); } catch {}
              merged.push({
                id: genId(), tipo, nome: task.name,
                contatto: extra.contatto || "", email: extra.email || "",
                telefono: extra.telefono || "", budget: extra.budget || "",
                stage: task.status?.status || (tipo === "lead" ? "da_contattare" : "attivo"),
                data: task.date_created ? new Date(parseInt(task.date_created)).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
                note: extra.note || "", clickupId: task.id,
              });
            }
          });
        };
        process(data.leads || [], "lead");
        process(data.clienti || [], "cliente");
        try { localStorage.setItem("dario-pipeline", JSON.stringify(merged)); } catch {}
        return [...merged];
      });
    } catch (e) {} finally { setLoading(false); }
  };

  const openAdd = (tipo = "lead", stage = null) => {
    setForm({ ...EMPTY_FORM, tipo, stage: stage || (tipo === "lead" ? "da_contattare" : "attivo"), data: new Date().toISOString().slice(0, 10) });
    setModal("add");
  };

  const openEdit = (entry) => { setForm({ ...entry }); setModal("edit"); };
  const closeModal = () => { setModal(null); setForm(EMPTY_FORM); };

  const saveEntry = () => {
    if (!form.nome.trim()) return;
    if (modal === "add") {
      persist([...entries, { ...form, id: genId() }]);
    } else {
      persist(entries.map(e => e.id === form.id ? form : e));
    }
    closeModal();
  };

  const deleteEntry = (id) => {
    if (!confirm("Eliminare questo record?")) return;
    persist(entries.filter(e => e.id !== id));
  };

  const syncEntry = async (entry) => {
    setSyncing(entry.id);
    try {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      const data = await res.json();
      if (data.id) persist(entries.map(e => e.id === entry.id ? { ...e, clickupId: data.id } : e));
    } catch (e) {} finally { setSyncing(null); }
  };

  const filtered = entries.filter(e => filter === "tutti" || e.tipo === filter);
  const activeClients = entries.filter(e => e.tipo === "cliente" && e.stage === "attivo");
  const mrr = activeClients.reduce((s, e) => s + (parseFloat(e.budget) || 0), 0);
  const pipelineValue = entries.filter(e => e.tipo === "lead").reduce((s, e) => s + (parseFloat(e.budget) || 0), 0);

  const f = (key) => (val) => setForm(p => ({ ...p, [key]: val }));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "#09090F" }}>

      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: "1px solid #1A1A2E", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#F8FAFC" }}>🎯 Pipeline IAGREX</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {["tutti", "lead", "cliente"].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{ padding: "4px 10px", borderRadius: 7, border: `1px solid ${filter === f ? "#8B5CF6" : "#1A1A2E"}`, background: filter === f ? "#8B5CF620" : "transparent", color: filter === f ? "#8B5CF6" : "#475569", cursor: "pointer", fontSize: 11, textTransform: "capitalize" }}>
                {f === "tutti" ? "Tutti" : f === "lead" ? "Lead" : "Clienti"}
              </button>
            ))}
            <div style={{ width: 1, height: 18, background: "#1A1A2E" }} />
            {[["kanban", "📊 Kanban"], ["lista", "📋 Lista"]].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} style={{ padding: "4px 10px", borderRadius: 7, border: `1px solid ${view === v ? "#F97316" : "#1A1A2E"}`, background: view === v ? "#F9731620" : "transparent", color: view === v ? "#F97316" : "#475569", cursor: "pointer", fontSize: 11 }}>{label}</button>
            ))}
            <div style={{ width: 1, height: 18, background: "#1A1A2E" }} />
            <button onClick={() => openAdd("lead")} style={{ padding: "4px 10px", borderRadius: 7, border: "none", background: "#3B82F6", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>+ Lead</button>
            <button onClick={() => openAdd("cliente")} style={{ padding: "4px 10px", borderRadius: 7, border: "none", background: "#10B981", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>+ Cliente</button>
            <button onClick={syncClickup} style={{ padding: "4px 10px", borderRadius: 7, border: "1px solid #1A1A2E", background: "transparent", color: "#475569", cursor: "pointer", fontSize: 11 }}>{loading ? "⏳" : "↻ Sync"}</button>
          </div>
        </div>
        {/* Stats */}
        <div style={{ display: "flex", gap: 20, marginTop: 8 }}>
          <div style={{ fontSize: fs - 3, color: "#64748B" }}>
            <span style={{ color: "#3B82F6", fontWeight: 700 }}>{entries.filter(e => e.tipo === "lead").length}</span> lead · valore pipeline <span style={{ color: "#F59E0B", fontWeight: 700 }}>{pipelineValue.toLocaleString("it-IT")}€/mese</span>
          </div>
          <div style={{ fontSize: fs - 3, color: "#64748B" }}>
            <span style={{ color: "#10B981", fontWeight: 700 }}>{activeClients.length}</span> clienti attivi · MRR <span style={{ color: "#10B981", fontWeight: 700 }}>{mrr.toLocaleString("it-IT")}€</span>
          </div>
        </div>
      </div>

      {/* View */}
      {view === "kanban"
        ? <KanbanView entries={filtered} filter={filter} fs={fs} onEdit={openEdit} onDelete={deleteEntry} onSync={syncEntry} syncing={syncing} openAdd={openAdd} />
        : <ListView entries={filtered} fs={fs} onEdit={openEdit} onDelete={deleteEntry} onSync={syncEntry} syncing={syncing} />
      }

      {/* Modal */}
      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "#00000090", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={closeModal}>
          <div style={{ background: "#0F0F1A", border: "1px solid #1A1A2E", borderRadius: 16, padding: 24, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#F8FAFC", marginBottom: 20 }}>
              {modal === "add" ? "➕ Nuovo" : "✏️ Modifica"} {form.tipo === "lead" ? "Lead" : "Cliente"}
            </div>

            {/* Tipo */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {[["lead", "🎯 Lead", "#3B82F6"], ["cliente", "✅ Cliente", "#10B981"]].map(([t, label, color]) => (
                <button key={t} onClick={() => setForm(p => ({ ...p, tipo: t, stage: t === "lead" ? "da_contattare" : "attivo" }))}
                  style={{ flex: 1, padding: 9, borderRadius: 8, border: `1px solid ${form.tipo === t ? color : "#1A1A2E"}`, background: form.tipo === t ? `${color}20` : "transparent", color: form.tipo === t ? color : "#475569", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  {label}
                </button>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <InputField label="Nome azienda *" value={form.nome} onChange={f("nome")} full />
              <InputField label="Referente" value={form.contatto} onChange={f("contatto")} />
              <InputField label="Email" value={form.email} onChange={f("email")} type="email" />
              <InputField label="Telefono" value={form.telefono} onChange={f("telefono")} />
              <InputField label="Budget €/mese" value={form.budget} onChange={f("budget")} type="number" />
              <InputField label="Data" value={form.data} onChange={f("data")} type="date" />

              {/* Stage */}
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 11, color: "#64748B", marginBottom: 6 }}>Stage</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(form.tipo === "lead" ? LEAD_STAGES : CLIENT_STAGES).map(s => (
                    <button key={s.id} onClick={() => setForm(p => ({ ...p, stage: s.id }))}
                      style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${form.stage === s.id ? s.color : "#1A1A2E"}`, background: form.stage === s.id ? `${s.color}20` : "transparent", color: form.stage === s.id ? s.color : "#475569", cursor: "pointer", fontSize: 11 }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Note */}
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 11, color: "#64748B", marginBottom: 4 }}>Note</div>
                <textarea value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} rows={3}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid #1A1A2E", background: "#09090F", color: "#E2E8F0", fontSize: 13, outline: "none", resize: "vertical", fontFamily: "inherit" }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button onClick={closeModal} style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #1A1A2E", background: "transparent", color: "#475569", cursor: "pointer", fontSize: 13 }}>Annulla</button>
              <button onClick={saveEntry} style={{ flex: 2, padding: 10, borderRadius: 8, border: "none", background: "#8B5CF6", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Salva</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
