"use client";

import { useState } from "react";

/**
 * Acoes do ciclo semanal. O disparo em si mora no PainelDisparo, que exige
 * escolher o dia e conferir a lista antes de enviar.
 */
export function DisparoActions({ isFriday }: { isFriday: boolean }) {
  const [loading, setLoading] = useState(false);
  const [marcoMsg, setMarcoMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  async function handleMarcoZero() {
    setLoading(true);
    setMarcoMsg(null);
    try {
      const res = await fetch("/api/disparos/marco-zero", { method: "POST" });
      if (!res.ok) throw new Error("Erro ao executar marco zero");
      setMarcoMsg({ text: "Marco Zero executado com sucesso!", type: "success" });
    } catch {
      setMarcoMsg({ text: "Erro ao executar Marco Zero.", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  if (!isFriday) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={handleMarcoZero}
        disabled={loading}
        className="rounded-xl border border-outline-variant bg-surface-container-lowest px-5 py-2.5 text-sm font-semibold text-primary transition hover:bg-surface-container-low disabled:opacity-50"
      >
        {loading ? "Executando..." : "Executar Marco Zero"}
      </button>

      {marcoMsg && (
        <span
          className={`text-sm font-medium ${marcoMsg.type === "success" ? "text-green-600" : "text-red-500"}`}
        >
          {marcoMsg.text}
        </span>
      )}
    </div>
  );
}
