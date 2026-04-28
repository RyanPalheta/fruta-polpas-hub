"use client";

import { useState } from "react";

interface DisparoResultado {
  empresa: string;
  lead_id: number | null;
  ok: boolean;
  resposta?: unknown;
  erro?: string;
}

interface DisparoResponse {
  message?: string;
  created?: number;
  webhook?: {
    enviados: number;
    falhas: number;
    resultados: DisparoResultado[];
  };
  error?: string;
}

export function DisparoActions({ isFriday }: { isFriday: boolean }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<DisparoResponse | null>(null);
  const [marcoMsg, setMarcoMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  async function handleDisparar() {
    setLoading("disparar");
    setResult(null);
    try {
      const res = await fetch("/api/disparos", { method: "POST" });
      const data: DisparoResponse = await res.json();
      setResult(data);
    } catch {
      setResult({ error: "Erro de conexão ao disparar." });
    } finally {
      setLoading(null);
    }
  }

  async function handleMarcoZero() {
    setLoading("marco-zero");
    setMarcoMsg(null);
    try {
      const res = await fetch("/api/disparos/marco-zero", { method: "POST" });
      if (!res.ok) throw new Error("Erro ao executar marco zero");
      setMarcoMsg({ text: "Marco Zero executado com sucesso!", type: "success" });
    } catch {
      setMarcoMsg({ text: "Erro ao executar Marco Zero.", type: "error" });
    } finally {
      setLoading(null);
    }
  }

  const webhook = result?.webhook;
  const temResultados = webhook && webhook.resultados.length > 0;

  return (
    <div className="flex flex-col gap-4 w-full md:items-end">
      {/* Botões */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleDisparar}
          disabled={loading !== null}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {loading === "disparar" ? (
            <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
          ) : (
            <span className="material-symbols-outlined text-lg">send</span>
          )}
          {loading === "disparar" ? "Disparando..." : "Disparar Agora"}
        </button>

        {isFriday && (
          <button
            onClick={handleMarcoZero}
            disabled={loading !== null}
            className="rounded-xl border border-outline-variant bg-surface-container-lowest px-5 py-2.5 text-sm font-semibold text-primary transition hover:bg-surface-container-low disabled:opacity-50"
          >
            {loading === "marco-zero" ? "Executando..." : "Executar Marco Zero"}
          </button>
        )}

        {marcoMsg && (
          <span className={`text-sm font-medium ${marcoMsg.type === "success" ? "text-green-600" : "text-red-500"}`}>
            {marcoMsg.text}
          </span>
        )}
      </div>

      {/* Resultado do disparo */}
      {result && (
        <div className="w-full max-w-2xl">
          {result.error ? (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm font-medium">
              <span className="material-symbols-outlined text-base">error</span>
              {result.error}
            </div>
          ) : (
            <div className="rounded-xl border border-outline-variant/10 bg-surface-container-lowest shadow-sm overflow-hidden">
              {/* Cabeçalho resumo */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/10">
                <div className="flex items-center gap-4 text-sm">
                  <span className="font-semibold text-on-surface">{result.message}</span>
                  {webhook && (
                    <>
                      <span className="flex items-center gap-1 text-green-700 font-semibold">
                        <span className="material-symbols-outlined text-sm">check_circle</span>
                        {webhook.enviados} ok
                      </span>
                      {webhook.falhas > 0 && (
                        <span className="flex items-center gap-1 text-red-600 font-semibold">
                          <span className="material-symbols-outlined text-sm">error</span>
                          {webhook.falhas} falha{webhook.falhas > 1 ? "s" : ""}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <button
                  onClick={() => setResult(null)}
                  className="text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>

              {/* Lista de resultados por lead */}
              {temResultados && (
                <div className="divide-y divide-outline-variant/10 max-h-64 overflow-y-auto">
                  {webhook.resultados.map((r, i) => (
                    <div key={i} className="flex items-start justify-between px-4 py-2.5 text-sm">
                      <div>
                        <p className="font-semibold text-on-surface">{r.empresa}</p>
                        <p className="text-xs text-on-surface-variant">
                          lead_id: {r.lead_id ?? "—"}
                        </p>
                        {r.erro && (
                          <p className="text-xs text-red-600 mt-0.5">{r.erro}</p>
                        )}
                      </div>
                      <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-full ml-4 ${
                        r.ok
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}>
                        {r.ok ? "Enviado" : "Falhou"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Se não houve clientes */}
              {!temResultados && (
                <p className="px-4 py-3 text-sm text-on-surface-variant">
                  {result.message}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
