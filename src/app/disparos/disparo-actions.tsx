"use client";

import { useState } from "react";

export function DisparoActions({ isFriday }: { isFriday: boolean }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  async function handleDisparar() {
    setLoading("disparar");
    setMessage(null);
    try {
      const res = await fetch("/api/disparos", { method: "POST" });
      if (!res.ok) throw new Error("Erro ao disparar");
      setMessage({ text: "Disparos executados com sucesso!", type: "success" });
    } catch {
      setMessage({ text: "Erro ao executar disparos.", type: "error" });
    } finally {
      setLoading(null);
    }
  }

  async function handleMarcoZero() {
    setLoading("marco-zero");
    setMessage(null);
    try {
      const res = await fetch("/api/disparos/marco-zero", { method: "POST" });
      if (!res.ok) throw new Error("Erro ao executar marco zero");
      setMessage({ text: "Marco Zero executado com sucesso!", type: "success" });
    } catch {
      setMessage({ text: "Erro ao executar Marco Zero.", type: "error" });
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={handleDisparar}
        disabled={loading !== null}
        className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-on-primary transition hover:opacity-90 disabled:opacity-50"
      >
        {loading === "disparar" ? "Disparando..." : "Disparar Agora"}
      </button>

      {isFriday && (
        <button
          onClick={handleMarcoZero}
          disabled={loading !== null}
          className="rounded-xl border border-outline-variant bg-surface-container-lowest px-5 py-2.5 text-sm font-medium text-primary transition hover:bg-surface-container-low disabled:opacity-50"
        >
          {loading === "marco-zero" ? "Executando..." : "Executar Marco Zero"}
        </button>
      )}

      {message && (
        <span
          className={`text-sm font-medium ${
            message.type === "success" ? "text-green-600" : "text-red-500"
          }`}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}
