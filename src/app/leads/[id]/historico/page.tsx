import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCnpjCpf, formatPhone } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface ItemPedido {
  descricao?: string | null;
  codigo?: string | null;
  quantidade?: number | null;
  unidade?: string | null;
  valor_unitario?: number | null;
  valor_total_item?: number | null;
  produto_id?: number | string | null;
}

function fmtMoeda(v: number | null | undefined): string {
  return `R$ ${Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtData(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

const SITUACAO_COLORS: Record<string, string> = {
  Atendido: "bg-green-100 text-green-700 border-green-200",
  Confirmado: "bg-blue-100 text-blue-700 border-blue-200",
  "Em aberto": "bg-amber-100 text-amber-700 border-amber-200",
  Cancelado: "bg-red-100 text-red-700 border-red-200",
  Entregue: "bg-green-100 text-green-700 border-green-200",
  "Em andamento": "bg-blue-100 text-blue-700 border-blue-200",
};

export default async function HistoricoLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const cliente = await prisma.cliente.findUnique({
    where: { id },
  });

  if (!cliente) {
    notFound();
  }

  const pedidos = await prisma.historicoCompraBling.findMany({
    where: { clienteId: id },
    orderBy: { data: "desc" },
  });

  const totalPedidos = pedidos.length;
  const totalGasto = pedidos.reduce((s, p) => s + (p.valorTotal ?? 0), 0);
  const ultimoSync = pedidos.length > 0
    ? pedidos.map((p) => p.syncedAt).sort((a, b) => b.getTime() - a.getTime())[0]
    : null;

  // Top 5 produtos por quantidade total (todos os pedidos somados)
  const produtoStats = new Map<string, { qtd: number; valor: number; ocorrencias: number }>();
  for (const p of pedidos) {
    const itens = (Array.isArray(p.itens) ? p.itens : []) as ItemPedido[];
    for (const it of itens) {
      const key = (it.descricao ?? "(sem descrição)").trim();
      const cur = produtoStats.get(key) ?? { qtd: 0, valor: 0, ocorrencias: 0 };
      cur.qtd += Number(it.quantidade ?? 0);
      cur.valor += Number(it.valor_total_item ?? 0);
      cur.ocorrencias += 1;
      produtoStats.set(key, cur);
    }
  }
  const topProdutos = Array.from(produtoStats.entries())
    .sort((a, b) => b[1].qtd - a[1].qtd)
    .slice(0, 5);

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-4 mb-10">
        <Link
          href={`/leads`}
          className="p-2 rounded-xl hover:bg-surface-container-low transition-colors text-on-surface-variant"
        >
          <span className="material-symbols-outlined text-2xl">arrow_back</span>
        </Link>
        <div className="flex-1">
          <h2 className="text-4xl font-extrabold text-primary tracking-tight leading-none mb-1">
            Histórico de Compras
          </h2>
          <p className="text-on-surface-variant font-medium">
            {cliente.empresa}
            {cliente.cnpjCpf && (
              <span className="ml-3 text-sm font-mono text-on-surface-variant/70">
                {formatCnpjCpf(cliente.cnpjCpf)}
              </span>
            )}
          </p>
        </div>
        <Link
          href={`/leads/${cliente.id}/editar`}
          className="px-4 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/20 text-on-surface-variant font-semibold text-sm hover:bg-surface-container-low transition-colors"
        >
          <span className="material-symbols-outlined text-base align-middle mr-1">edit</span>
          Editar Lead
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-1">Total de Pedidos</p>
          <p className="text-3xl font-black text-primary">{totalPedidos}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-1">Total Gasto</p>
          <p className="text-3xl font-black text-green-700">{fmtMoeda(totalGasto)}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-1">Telefone</p>
          <p className="text-lg font-bold text-on-surface mt-1">{formatPhone(cliente.contatoWhatsapp)}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-1">Último Sync</p>
          <p className="text-sm font-bold text-on-surface mt-2">
            {ultimoSync ? ultimoSync.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}
          </p>
        </div>
      </div>

      {/* Top produtos */}
      {topProdutos.length > 0 && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6 mb-8">
          <h3 className="text-lg font-bold text-primary mb-4">
            <span className="material-symbols-outlined text-base align-middle mr-1">trending_up</span>
            Produtos mais comprados (top 5)
          </h3>
          <div className="space-y-3">
            {topProdutos.map(([produto, stats]) => (
              <div key={produto} className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-container-low">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{produto}</p>
                  <p className="text-xs text-on-surface-variant">
                    Comprado em {stats.ocorrencias} pedido(s)
                  </p>
                </div>
                <div className="text-right shrink-0 ml-4">
                  <p className="text-sm font-bold text-primary">{stats.qtd} un.</p>
                  <p className="text-xs text-green-700">{fmtMoeda(stats.valor)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lista de pedidos */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6">
        <h3 className="text-lg font-bold text-primary mb-4">
          <span className="material-symbols-outlined text-base align-middle mr-1">receipt_long</span>
          Pedidos ({totalPedidos})
        </h3>

        {pedidos.length === 0 ? (
          <div className="py-12 text-center text-on-surface-variant">
            <span className="material-symbols-outlined text-5xl text-on-surface-variant/40 mb-3 block">
              inbox
            </span>
            <p className="text-sm">
              Nenhum pedido sincronizado do Bling ainda.
            </p>
            <p className="text-xs mt-2 text-on-surface-variant/60">
              {cliente.cnpjCpf
                ? "O sync semanal roda toda segunda às 7h. Você pode disparar manualmente no n8n."
                : "Este lead ainda não tem CPF/CNPJ cadastrado — o sync precisa dele pra encontrar no Bling."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pedidos.map((p) => {
              const itens = (Array.isArray(p.itens) ? p.itens : []) as ItemPedido[];
              const sitColor = p.situacao
                ? SITUACAO_COLORS[p.situacao] ?? "bg-gray-100 text-gray-700 border-gray-200"
                : "bg-gray-100 text-gray-700 border-gray-200";
              return (
                <details
                  key={p.id}
                  className="group rounded-xl border border-outline-variant/10 bg-surface-container-low overflow-hidden"
                >
                  <summary className="px-4 py-3 cursor-pointer hover:bg-surface-bright transition-colors list-none flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="text-on-surface-variant group-open:rotate-90 transition-transform">
                        <span className="material-symbols-outlined text-lg">chevron_right</span>
                      </div>
                      <div className="flex flex-col">
                        <p className="text-sm font-bold">
                          Pedido #{p.numeroPedido ?? p.blingPedidoId ?? "—"}
                        </p>
                        <p className="text-xs text-on-surface-variant">{fmtData(p.data)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {p.situacao && (
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold border ${sitColor}`}>
                          {p.situacao}
                        </span>
                      )}
                      <span className="text-sm font-bold text-green-700">{fmtMoeda(p.valorTotal)}</span>
                    </div>
                  </summary>

                  {itens.length > 0 ? (
                    <div className="px-4 pb-4 pt-1 border-t border-outline-variant/10">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-on-surface-variant/70 uppercase tracking-wider">
                            <th className="text-left py-2 font-semibold">Produto</th>
                            <th className="text-right py-2 font-semibold w-20">Qtd</th>
                            <th className="text-right py-2 font-semibold w-28">Unitário</th>
                            <th className="text-right py-2 font-semibold w-28">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-outline-variant/10">
                          {itens.map((it, idx) => (
                            <tr key={idx}>
                              <td className="py-2">
                                <p className="font-medium">{it.descricao ?? "—"}</p>
                                {it.codigo && (
                                  <p className="text-xs text-on-surface-variant/60 font-mono">{it.codigo}</p>
                                )}
                              </td>
                              <td className="text-right py-2 tabular-nums">
                                {Number(it.quantidade ?? 0)} {it.unidade ?? ""}
                              </td>
                              <td className="text-right py-2 tabular-nums">{fmtMoeda(it.valor_unitario)}</td>
                              <td className="text-right py-2 tabular-nums font-semibold">{fmtMoeda(it.valor_total_item)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="px-4 pb-4 pt-2 border-t border-outline-variant/10 text-xs text-on-surface-variant italic">
                      Itens deste pedido ainda não foram sincronizados.
                    </div>
                  )}
                </details>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
