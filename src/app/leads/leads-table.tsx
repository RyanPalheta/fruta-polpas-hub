"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getInitials, SEGMENTO_COLORS, DIA_LABELS, formatPhone } from "@/lib/utils";

const SEGMENTOS = ["RESTAURANTE", "HOTELARIA", "ACADEMIA", "DISTRIBUIDOR", "FRANQUIA", "EVENTOS", "OUTRO"];
const DIAS = [
  { value: "SEGUNDA", label: "Segunda" },
  { value: "TERCA", label: "Terça" },
  { value: "QUARTA", label: "Quarta" },
  { value: "QUINTA", label: "Quinta" },
  { value: "SEXTA", label: "Sexta" },
];

interface Cliente {
  id: string;
  empresa: string;
  contatoWhatsapp: string;
  segmento: string;
  diaDisparo: string;
  cidade: string | null;
  uf: string | null;
  ativo: boolean;
  ultimoPedidoEm: Date | string | null;
  ultimoPedidoValor: number | null;
}

interface Props {
  clientes: Cliente[];
}

type BulkAction = "diaDisparo" | "segmento" | "ativar" | "desativar" | "deletar";

export function LeadsTable({ clientes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction | "">("");
  const [bulkValue, setBulkValue] = useState("");
  const [applying, setApplying] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const allIds = clientes.map((c) => c.id);
  const allSelected = selected.size === allIds.length && allIds.length > 0;
  const someSelected = selected.size > 0;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setBulkAction("");
    setBulkValue("");
    setFeedback(null);
  }

  async function applyBulk() {
    if (!bulkAction) return;
    if ((bulkAction === "diaDisparo" || bulkAction === "segmento") && !bulkValue) return;

    if (bulkAction === "deletar") {
      const ok = window.confirm(
        `Tem certeza que deseja EXCLUIR ${selected.size} cliente(s)? Essa ação não pode ser desfeita.`
      );
      if (!ok) return;
    }

    setApplying(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/clientes/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selected),
          action: bulkAction,
          value: bulkValue || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Erro ao aplicar ação");

      setFeedback({ type: "success", msg: `${data.count} cliente(s) atualizados com sucesso.` });
      setSelected(new Set());
      setBulkAction("");
      setBulkValue("");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        msg: err instanceof Error ? err.message : "Erro desconhecido.",
      });
    } finally {
      setApplying(false);
    }
  }

  const needsValue = bulkAction === "diaDisparo" || bulkAction === "segmento";
  const canApply = bulkAction && (!needsValue || bulkValue);

  return (
    <div className="relative">
      {/* Feedback toast */}
      {feedback && (
        <div
          className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium border ${
            feedback.type === "success"
              ? "bg-green-50 border-green-100 text-green-700"
              : "bg-red-50 border-red-100 text-red-700"
          }`}
        >
          <span className="material-symbols-outlined text-base">
            {feedback.type === "success" ? "check_circle" : "error"}
          </span>
          {feedback.msg}
          <button onClick={() => setFeedback(null)} className="ml-auto">
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-outline-variant/10">
                {/* Checkbox select all */}
                <th className="px-4 py-4 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded accent-primary cursor-pointer"
                  />
                </th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Empresa</th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Contato WhatsApp</th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Segmento</th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Dia do Disparo</th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Ultimo Pedido</th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {clientes.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-on-surface-variant">
                    Nenhum cliente encontrado.
                  </td>
                </tr>
              )}
              {clientes.map((cliente) => {
                const segColor = SEGMENTO_COLORS[cliente.segmento as keyof typeof SEGMENTO_COLORS] || SEGMENTO_COLORS.OUTRO;
                const isChecked = selected.has(cliente.id);
                return (
                  <tr
                    key={cliente.id}
                    className={`transition-colors ${
                      isChecked
                        ? "bg-primary/5"
                        : "hover:bg-surface-bright"
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOne(cliente.id)}
                        className="w-4 h-4 rounded accent-primary cursor-pointer"
                      />
                    </td>

                    {/* Empresa */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${cliente.ativo ? "bg-primary/10 text-primary" : "bg-outline-variant/20 text-on-surface-variant"}`}>
                          {getInitials(cliente.empresa)}
                        </div>
                        <div>
                          <p className={`text-sm font-semibold ${cliente.ativo ? "text-on-surface" : "text-on-surface-variant line-through"}`}>
                            {cliente.empresa}
                          </p>
                          {cliente.cidade && (
                            <p className="text-xs text-on-surface-variant">
                              {cliente.cidade}{cliente.uf ? `, ${cliente.uf}` : ""}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* WhatsApp */}
                    <td className="px-4 py-4">
                      <span className="text-sm text-on-surface">{formatPhone(cliente.contatoWhatsapp)}</span>
                    </td>

                    {/* Segmento */}
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold ${segColor.bg} ${segColor.text} border ${segColor.border}`}>
                        {cliente.segmento}
                      </span>
                    </td>

                    {/* Dia disparo */}
                    <td className="px-4 py-4">
                      <span className="text-sm text-on-surface">
                        {DIA_LABELS[cliente.diaDisparo as keyof typeof DIA_LABELS] || cliente.diaDisparo}
                      </span>
                    </td>

                    {/* Ultimo pedido */}
                    <td className="px-4 py-4">
                      {cliente.ultimoPedidoEm ? (
                        <div>
                          <p className="text-sm font-semibold text-on-surface">
                            {new Date(cliente.ultimoPedidoEm).toLocaleDateString("pt-BR")}
                          </p>
                          {cliente.ultimoPedidoValor != null && (
                            <p className="text-xs text-on-surface-variant">
                              R$ {cliente.ultimoPedidoValor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-on-surface-variant">—</span>
                      )}
                    </td>

                    {/* Ações */}
                    <td className="px-4 py-4">
                      <Link
                        href={`/leads/${cliente.id}/editar`}
                        className="p-2 rounded-lg hover:bg-surface-container-low transition-colors text-on-surface-variant hover:text-primary"
                        title="Editar"
                      >
                        <span className="material-symbols-outlined text-lg">edit</span>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Floating bulk action bar */}
      {someSelected && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4">
          <div className="bg-neutral-900 text-white rounded-2xl shadow-2xl px-5 py-4 flex flex-wrap items-center gap-3">
            {/* Count */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold">
                {selected.size}
              </span>
              <span className="text-sm font-semibold text-white/90">selecionado(s)</span>
            </div>

            <div className="h-5 w-px bg-white/20 shrink-0" />

            {/* Action select */}
            <select
              value={bulkAction}
              onChange={(e) => { setBulkAction(e.target.value as BulkAction | ""); setBulkValue(""); }}
              className="flex-1 min-w-[160px] px-3 py-2 rounded-xl bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="" className="text-neutral-900">Selecionar ação...</option>
              <option value="diaDisparo" className="text-neutral-900">Mudar dia de disparo</option>
              <option value="segmento" className="text-neutral-900">Mudar segmento</option>
              <option value="ativar" className="text-neutral-900">Ativar clientes</option>
              <option value="desativar" className="text-neutral-900">Desativar clientes</option>
              <option value="deletar" className="text-neutral-900">Excluir clientes</option>
            </select>

            {/* Value select — dia */}
            {bulkAction === "diaDisparo" && (
              <select
                value={bulkValue}
                onChange={(e) => setBulkValue(e.target.value)}
                className="flex-1 min-w-[130px] px-3 py-2 rounded-xl bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="" className="text-neutral-900">Dia...</option>
                {DIAS.map((d) => (
                  <option key={d.value} value={d.value} className="text-neutral-900">{d.label}</option>
                ))}
              </select>
            )}

            {/* Value select — segmento */}
            {bulkAction === "segmento" && (
              <select
                value={bulkValue}
                onChange={(e) => setBulkValue(e.target.value)}
                className="flex-1 min-w-[150px] px-3 py-2 rounded-xl bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="" className="text-neutral-900">Segmento...</option>
                {SEGMENTOS.map((s) => (
                  <option key={s} value={s} className="text-neutral-900">{s}</option>
                ))}
              </select>
            )}

            {/* Apply button */}
            <button
              onClick={applyBulk}
              disabled={!canApply || applying || isPending}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all shrink-0 ${
                bulkAction === "deletar"
                  ? "bg-red-500 hover:bg-red-400 text-white disabled:opacity-40"
                  : "bg-primary hover:bg-primary/80 text-white disabled:opacity-40"
              }`}
            >
              {applying || isPending ? (
                <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
              ) : (
                bulkAction === "deletar" ? "Excluir" : "Aplicar"
              )}
            </button>

            {/* Cancel */}
            <button
              onClick={clearSelection}
              className="p-2 rounded-xl hover:bg-white/10 transition-colors text-white/60 hover:text-white shrink-0"
              title="Cancelar seleção"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
