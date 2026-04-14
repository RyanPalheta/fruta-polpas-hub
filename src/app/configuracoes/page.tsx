"use client";

import { useEffect, useState } from "react";

interface Config {
  horarioDisparo: string;
  horarioFollowup: string;
  kommoPipelineId: string;
  kommoToken: string;
  kommoSubdomain: string;
  kommoStatusIds: string;
}

const EMPTY_CONFIG: Config = {
  horarioDisparo: "",
  horarioFollowup: "",
  kommoPipelineId: "",
  kommoToken: "",
  kommoSubdomain: "",
  kommoStatusIds: "{}",
};

const FIELD_LABELS: Record<keyof Omit<Config, "kommoStatusIds">, string> = {
  horarioDisparo: "Horario Disparo",
  horarioFollowup: "Horario Followup",
  kommoPipelineId: "Kommo Pipeline ID",
  kommoToken: "Kommo Token",
  kommoSubdomain: "Kommo Subdomain",
};

export default function ConfiguracoesPage() {
  const [config, setConfig] = useState<Config>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/configuracoes");
        if (!res.ok) throw new Error();
        const data = await res.json();
        setConfig({
          horarioDisparo: data.horarioDisparo ?? "",
          horarioFollowup: data.horarioFollowup ?? "",
          kommoPipelineId: data.kommoPipelineId ?? "",
          kommoToken: data.kommoToken ?? "",
          kommoSubdomain: data.kommoSubdomain ?? "",
          kommoStatusIds:
            typeof data.kommoStatusIds === "string"
              ? data.kommoStatusIds
              : JSON.stringify(data.kommoStatusIds ?? {}, null, 2),
        });
      } catch {
        setToast({ text: "Erro ao carregar configuracoes.", type: "error" });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  function handleChange(field: keyof Config, value: string) {
    setConfig((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setToast(null);

    // Validate JSON for kommoStatusIds
    let parsedStatusIds: unknown;
    try {
      parsedStatusIds = JSON.parse(config.kommoStatusIds);
    } catch {
      setToast({ text: "kommoStatusIds contem JSON invalido.", type: "error" });
      setSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/configuracoes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          horarioDisparo: config.horarioDisparo,
          horarioFollowup: config.horarioFollowup,
          kommoPipelineId: config.kommoPipelineId,
          kommoToken: config.kommoToken,
          kommoSubdomain: config.kommoSubdomain,
          kommoStatusIds: parsedStatusIds,
        }),
      });
      if (!res.ok) throw new Error();
      setToast({ text: "Configuracoes salvas com sucesso!", type: "success" });
    } catch {
      setToast({ text: "Erro ao salvar configuracoes.", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-on-surface-variant">Carregando configuracoes...</p>
      </div>
    );
  }

  const textFields = Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[];

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-on-surface">Configuracoes</h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Parametros gerais do sistema de disparos
        </p>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`rounded-xl px-4 py-3 text-sm font-medium ${
            toast.type === "success"
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-600 border border-red-200"
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSave} className="space-y-6">
        <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-6 space-y-5">
          {textFields.map((field) => (
            <div key={field}>
              <label
                htmlFor={field}
                className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-on-surface-variant"
              >
                {FIELD_LABELS[field]}
              </label>
              <input
                id={field}
                type={field === "kommoToken" ? "password" : "text"}
                value={config[field]}
                onChange={(e) => handleChange(field, e.target.value)}
                className="w-full rounded-xl border border-outline-variant bg-surface-container-low px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          ))}

          {/* kommoStatusIds JSON textarea */}
          <div>
            <label
              htmlFor="kommoStatusIds"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-on-surface-variant"
            >
              Kommo Status IDs (JSON)
            </label>
            <textarea
              id="kommoStatusIds"
              rows={8}
              value={config.kommoStatusIds}
              onChange={(e) => handleChange("kommoStatusIds", e.target.value)}
              className="w-full rounded-xl border border-outline-variant bg-surface-container-low px-4 py-2.5 font-mono text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-on-primary transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar Configuracoes"}
          </button>
        </div>
      </form>
    </div>
  );
}
