"use client";

import { useEffect, useState } from "react";

interface Config {
  horarioDisparo: string;
  horarioFollowup: string;
  kommoToken: string;
  kommoSubdomain: string;
  kommoPipelineId: string;
  // Stored inside kommoStatusIds JSON
  statusDisparo: string;
  statusEmAtendimento: string;
}

const EMPTY: Config = {
  horarioDisparo: "08:00",
  horarioFollowup: "14:00",
  kommoToken: "",
  kommoSubdomain: "frutapolpas",
  kommoPipelineId: "",
  statusDisparo: "",
  statusEmAtendimento: "",
};

export default function ConfiguracoesPage() {
  const [config, setConfig] = useState<Config>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    fetch("/api/configuracoes")
      .then((r) => r.json())
      .then((data) => {
        const ids = (data.kommoStatusIds ?? {}) as Record<string, string>;
        setConfig({
          horarioDisparo: data.horarioDisparo ?? "08:00",
          horarioFollowup: data.horarioFollowup ?? "14:00",
          kommoToken: data.kommoToken ?? "",
          kommoSubdomain: data.kommoSubdomain ?? "frutapolpas",
          kommoPipelineId: data.kommoPipelineId ?? "",
          statusDisparo: ids.disparo ?? "",
          statusEmAtendimento: ids.emAtendimento ?? "",
        });
      })
      .catch(() => setToast({ text: "Erro ao carregar configurações.", type: "error" }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  function set(field: keyof Config, value: string) {
    setConfig((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch("/api/configuracoes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          horarioDisparo: config.horarioDisparo,
          horarioFollowup: config.horarioFollowup,
          kommoToken: config.kommoToken,
          kommoSubdomain: config.kommoSubdomain,
          kommoPipelineId: config.kommoPipelineId,
          kommoStatusIds: {
            disparo: config.statusDisparo,
            emAtendimento: config.statusEmAtendimento,
          },
        }),
      });
      if (!res.ok) throw new Error();
      setToast({ text: "Configurações salvas!", type: "success" });
    } catch {
      setToast({ text: "Erro ao salvar.", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-primary text-3xl">progress_activity</span>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="mb-10">
        <h2 className="text-4xl font-extrabold text-primary tracking-tight leading-none mb-2">
          Configurações
        </h2>
        <p className="text-on-surface-variant font-medium text-lg">
          Parâmetros do sistema de disparos
        </p>
      </div>

      {toast && (
        <div className={`mb-6 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium border max-w-2xl ${
          toast.type === "success"
            ? "bg-green-50 border-green-100 text-green-700"
            : "bg-red-50 border-red-100 text-red-700"
        }`}>
          <span className="material-symbols-outlined text-base">
            {toast.type === "success" ? "check_circle" : "error"}
          </span>
          {toast.text}
        </div>
      )}

      <form onSubmit={handleSave} className="max-w-2xl space-y-6">

        {/* Horários */}
        <section className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6 space-y-5">
          <h3 className="text-sm font-bold text-on-surface uppercase tracking-widest">
            Horários de Disparo
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                Horário do Disparo
              </label>
              <input
                type="time"
                value={config.horarioDisparo}
                onChange={(e) => set("horarioDisparo", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <p className="text-xs text-on-surface-variant mt-1">Disparo principal da manhã</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                Horário do Follow-up
              </label>
              <input
                type="time"
                value={config.horarioFollowup}
                onChange={(e) => set("horarioFollowup", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <p className="text-xs text-on-surface-variant mt-1">Re-envio para não respondidos</p>
            </div>
          </div>
        </section>

        {/* KOMMO */}
        <section className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6 space-y-5">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-bold text-on-surface uppercase tracking-widest">
              Integração KOMMO
            </h3>
          </div>

          {/* Token */}
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
              Token de Acesso
            </label>
            <input
              type="password"
              value={config.kommoToken}
              onChange={(e) => set("kommoToken", e.target.value)}
              placeholder="eyJ0eXAiOiJKV1Qi..."
              className="w-full px-4 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Subdomain */}
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
              Subdomínio
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={config.kommoSubdomain}
                onChange={(e) => set("kommoSubdomain", e.target.value)}
                placeholder="frutapolpas"
                className="flex-1 px-4 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <span className="text-sm text-on-surface-variant">.kommo.com</span>
            </div>
          </div>

          {/* Pipeline + Status IDs */}
          <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/10 space-y-4">
            <div className="flex items-start gap-2">
              <span className="material-symbols-outlined text-primary text-lg mt-0.5">account_tree</span>
              <div>
                <p className="text-sm font-semibold text-on-surface">Pipeline de Disparos</p>
                <p className="text-xs text-on-surface-variant">Pipeline: <strong>Funil de vendas</strong> — Stage trigger: <strong>Disparo</strong></p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                  Pipeline ID
                </label>
                <input
                  type="text"
                  value={config.kommoPipelineId}
                  onChange={(e) => set("kommoPipelineId", e.target.value)}
                  placeholder="ex: 8654321"
                  className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/20 text-sm text-on-surface font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                  Status ID — Disparo
                </label>
                <input
                  type="text"
                  value={config.statusDisparo}
                  onChange={(e) => set("statusDisparo", e.target.value)}
                  placeholder="ex: 68231456"
                  className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/20 text-sm text-on-surface font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                  Status ID — Em Atendimento
                </label>
                <input
                  type="text"
                  value={config.statusEmAtendimento}
                  onChange={(e) => set("statusEmAtendimento", e.target.value)}
                  placeholder="ex: 68231457"
                  className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/20 text-sm text-on-surface font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            {/* How to find IDs */}
            <details className="mt-2">
              <summary className="text-xs text-primary font-medium cursor-pointer select-none">
                Como encontrar os IDs?
              </summary>
              <div className="mt-2 text-xs text-on-surface-variant space-y-1 pl-2 border-l-2 border-outline-variant/20">
                <p><strong>Pipeline ID:</strong> No KOMMO, abre o pipeline → a URL mostra <code className="bg-surface-container px-1 rounded">/leads/pipeline/XXXXXX/</code></p>
                <p><strong>Status ID (stage):</strong> Vai em <strong>Configurações → Pipelines</strong> → clica no stage → o ID aparece na URL ou no código-fonte.</p>
                <p className="text-amber-600">⚠️ Os IDs só ficam disponíveis quando a assinatura KOMMO estiver ativa.</p>
              </div>
            </details>
          </div>
        </section>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-white font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity shadow-sm"
          >
            {saving ? (
              <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-lg">save</span>
            )}
            {saving ? "Salvando..." : "Salvar Configurações"}
          </button>
        </div>
      </form>
    </>
  );
}
