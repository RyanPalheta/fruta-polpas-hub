"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

const SEGMENTOS = [
  "RESTAURANTE",
  "HOTELARIA",
  "ACADEMIA",
  "DISTRIBUIDOR",
  "FRANQUIA",
  "EVENTOS",
  "OUTRO",
] as const;

const DIAS = [
  { value: "SEGUNDA", label: "Segunda-feira" },
  { value: "TERCA", label: "Terça-feira" },
  { value: "QUARTA", label: "Quarta-feira" },
  { value: "QUINTA", label: "Quinta-feira" },
  { value: "SEXTA", label: "Sexta-feira" },
];

const UFS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

interface ClienteForm {
  empresa: string;
  contatoWhatsapp: string;
  segmento: string;
  diaDisparo: string;
  cidade: string;
  uf: string;
  ativo: boolean;
  tags: string;
}

export default function EditarLeadPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [form, setForm] = useState<ClienteForm>({
    empresa: "",
    contatoWhatsapp: "",
    segmento: "RESTAURANTE",
    diaDisparo: "SEGUNDA",
    cidade: "",
    uf: "",
    ativo: true,
    tags: "",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch(`/api/clientes/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setForm({
          empresa: data.empresa ?? "",
          contatoWhatsapp: data.contatoWhatsapp ?? "",
          segmento: data.segmento ?? "RESTAURANTE",
          diaDisparo: data.diaDisparo ?? "SEGUNDA",
          cidade: data.cidade ?? "",
          uf: data.uf ?? "",
          ativo: data.ativo ?? true,
          tags: (data.tags ?? []).join(", "),
        });
      })
      .catch(() => setError("Erro ao carregar cliente."))
      .finally(() => setLoading(false));
  }, [id]);

  function set(field: keyof ClienteForm, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      const res = await fetch(`/api/clientes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          tags: form.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao salvar.");
      }

      setSuccess(true);
      setTimeout(() => router.push("/leads"), 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="material-symbols-outlined animate-spin text-primary text-4xl">
          progress_activity
        </span>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-4 mb-10">
        <Link
          href="/leads"
          className="p-2 rounded-xl hover:bg-surface-container-low transition-colors text-on-surface-variant"
        >
          <span className="material-symbols-outlined text-2xl">arrow_back</span>
        </Link>
        <div>
          <h2 className="text-4xl font-extrabold text-primary tracking-tight leading-none mb-1">
            Editar Cliente
          </h2>
          <p className="text-on-surface-variant font-medium">
            {form.empresa || "Carregando..."}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl">
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-8 space-y-6">

          {/* Empresa */}
          <div>
            <label className="block text-sm font-semibold text-on-surface mb-1.5">
              Nome da Empresa <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.empresa}
              onChange={(e) => set("empresa", e.target.value)}
              required
              className="w-full px-4 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              placeholder="Ex: Restaurante Sabor & Arte"
            />
          </div>

          {/* Contato WhatsApp */}
          <div>
            <label className="block text-sm font-semibold text-on-surface mb-1.5">
              Contato WhatsApp <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.contatoWhatsapp}
              onChange={(e) => set("contatoWhatsapp", e.target.value)}
              required
              className="w-full px-4 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              placeholder="5521999990000"
            />
            <p className="text-xs text-on-surface-variant mt-1">
              Formato: código do país + DDD + número (sem espaços ou símbolos)
            </p>
          </div>

          {/* Segmento + Dia disparo */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-on-surface mb-1.5">
                Segmento <span className="text-red-500">*</span>
              </label>
              <select
                value={form.segmento}
                onChange={(e) => set("segmento", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              >
                {SEGMENTOS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-on-surface mb-1.5">
                Dia do Disparo <span className="text-red-500">*</span>
              </label>
              <select
                value={form.diaDisparo}
                onChange={(e) => set("diaDisparo", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              >
                {DIAS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Cidade + UF */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-semibold text-on-surface mb-1.5">
                Cidade
              </label>
              <input
                type="text"
                value={form.cidade}
                onChange={(e) => set("cidade", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                placeholder="Ex: Rio de Janeiro"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-on-surface mb-1.5">
                UF
              </label>
              <select
                value={form.uf}
                onChange={(e) => set("uf", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              >
                <option value="">—</option>
                {UFS.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-semibold text-on-surface mb-1.5">
              Tags
            </label>
            <input
              type="text"
              value={form.tags}
              onChange={(e) => set("tags", e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              placeholder="vip, cliente-antigo, sem-gluten"
            />
            <p className="text-xs text-on-surface-variant mt-1">
              Separe as tags por vírgula
            </p>
          </div>

          {/* Ativo */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-surface-container-low border border-outline-variant/10">
            <div>
              <p className="text-sm font-semibold text-on-surface">Cliente Ativo</p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Clientes inativos não recebem disparos
              </p>
            </div>
            <button
              type="button"
              onClick={() => set("ativo", !form.ativo)}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                form.ativo ? "bg-primary" : "bg-outline-variant"
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
                  form.ativo ? "left-6" : "left-0.5"
                }`}
              />
            </button>
          </div>

          {/* Erro */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm">
              <span className="material-symbols-outlined text-base">error</span>
              {error}
            </div>
          )}

          {/* Sucesso */}
          {success && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 border border-green-100 text-green-700 text-sm">
              <span className="material-symbols-outlined text-base">check_circle</span>
              Salvo com sucesso! Redirecionando...
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 mt-6">
          <button
            type="submit"
            disabled={saving || success}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-white font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity shadow-sm"
          >
            {saving ? (
              <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-lg">save</span>
            )}
            {saving ? "Salvando..." : "Salvar Alterações"}
          </button>
          <Link
            href="/leads"
            className="px-6 py-3 rounded-xl border border-outline-variant/20 text-on-surface-variant font-semibold text-sm hover:bg-surface-container-low transition-colors"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </>
  );
}
