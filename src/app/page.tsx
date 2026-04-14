import { prisma } from "@/lib/prisma";
import { StatCard } from "@/components/stat-card";
import { getInicioSemana, STATUS_LABELS, STATUS_COLORS } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function getDashboardData() {
  const semanaInicio = getInicioSemana();

  const [totalClientes, clientesAtivos, disparosSemana, ciclosRecentes] =
    await Promise.all([
      prisma.cliente.count(),
      prisma.cliente.count({ where: { ativo: true } }),
      prisma.disparo.findMany({
        where: { semanaInicio },
        include: { cliente: true },
      }),
      prisma.cicloSemanal.findMany({
        orderBy: { semanaInicio: "desc" },
        take: 8,
      }),
    ]);

  const statusCounts = disparosSemana.reduce(
    (acc, d) => {
      acc[d.status] = (acc[d.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const totalDisparados = disparosSemana.filter(
    (d) => d.status !== "AGUARDANDO"
  ).length;
  const responderam = disparosSemana.filter((d) =>
    ["RESPONDEU", "PEDIDO_CONFIRMADO", "PEDIDO_NAO_REALIZADO", "SUPORTE_HUMANO"].includes(d.status)
  ).length;
  const pedidos = disparosSemana.filter((d) => d.status === "PEDIDO_CONFIRMADO").length;
  const naoResponderam = disparosSemana.filter((d) => d.status === "NAO_RESPONDEU").length;
  const totalValor = disparosSemana.reduce((sum, d) => sum + (d.valorPedido || 0), 0);
  const taxaResposta = totalDisparados > 0 ? ((responderam / totalDisparados) * 100).toFixed(1) : "0";
  const taxaConversao = responderam > 0 ? ((pedidos / responderam) * 100).toFixed(1) : "0";

  return {
    totalClientes,
    clientesAtivos,
    totalDisparados,
    responderam,
    pedidos,
    naoResponderam,
    totalValor,
    taxaResposta,
    taxaConversao,
    statusCounts,
    ciclosRecentes,
    disparosSemana,
  };
}

export default async function DashboardPage() {
  const data = await getDashboardData();

  const naoFizeramPedido = data.disparosSemana.filter(
    (d) => d.status === "RESPONDEU" || d.status === "PEDIDO_NAO_REALIZADO"
  );

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-6">
        <div>
          <h2 className="text-4xl font-extrabold text-primary tracking-tight leading-none mb-2">
            Dashboard
          </h2>
          <p className="text-on-surface-variant font-medium text-lg">
            Visao geral do ciclo semanal de disparos e vendas.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
        <StatCard label="Total de Clientes" value={data.totalClientes.toLocaleString("pt-BR")} />
        <StatCard label="Disparados (Semana)" value={data.totalDisparados} />
        <StatCard label="Responderam" value={data.responderam} color="text-on-tertiary-container" />
        <StatCard label="Pedidos Confirmados" value={data.pedidos} color="text-green-700" />
        <StatCard
          label="Valor Total"
          value={`R$ ${data.totalValor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
          color="text-green-700"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-1">Taxa de Resposta</p>
          <p className="text-3xl font-black text-primary">{data.taxaResposta}%</p>
          <div className="mt-2 h-2 bg-surface-container-high rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${data.taxaResposta}%` }} />
          </div>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-1">Taxa de Conversao</p>
          <p className="text-3xl font-black text-on-tertiary-container">{data.taxaConversao}%</p>
          <div className="mt-2 h-2 bg-surface-container-high rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${data.taxaConversao}%` }} />
          </div>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-1">Nao Responderam</p>
          <p className="text-3xl font-black text-error">{data.naoResponderam}</p>
          <p className="text-xs text-on-surface-variant mt-1">potencial churn</p>
        </div>
      </div>

      {/* Funnel */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6 mb-8">
        <h3 className="text-lg font-bold text-primary mb-4">Funil da Semana</h3>
        <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <div key={key} className="text-center">
              <div className={`rounded-xl px-3 py-4 ${STATUS_COLORS[key] || "bg-gray-100 text-gray-700"}`}>
                <p className="text-2xl font-black">{data.statusCounts[key] || 0}</p>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mt-2">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Alert lists */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-error">warning</span>
            <h3 className="text-lg font-bold text-primary">Nao Responderam</h3>
            <span className="ml-auto text-sm font-bold text-error bg-red-50 px-2 py-0.5 rounded-full">{data.naoResponderam}</span>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {data.disparosSemana
              .filter((d) => d.status === "NAO_RESPONDEU")
              .slice(0, 10)
              .map((d) => (
                <div key={d.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-surface-container-low transition-colors">
                  <div>
                    <p className="text-sm font-semibold">{d.cliente.empresa}</p>
                    <p className="text-xs text-on-surface-variant">{d.cliente.contatoWhatsapp}</p>
                  </div>
                  <span className="text-[10px] font-bold uppercase text-on-surface-variant">{d.cliente.segmento}</span>
                </div>
              ))}
            {data.naoResponderam === 0 && (
              <p className="text-sm text-on-surface-variant py-4 text-center">Nenhum cliente sem resposta esta semana.</p>
            )}
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-amber-600">chat_bubble</span>
            <h3 className="text-lg font-bold text-primary">Responderam sem Pedido</h3>
            <span className="ml-auto text-sm font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">{naoFizeramPedido.length}</span>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {naoFizeramPedido.slice(0, 10).map((d) => (
              <div key={d.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-surface-container-low transition-colors">
                <div>
                  <p className="text-sm font-semibold">{d.cliente.empresa}</p>
                  <p className="text-xs text-on-surface-variant">{d.cliente.contatoWhatsapp}</p>
                </div>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${STATUS_COLORS[d.status]}`}>{STATUS_LABELS[d.status]}</span>
              </div>
            ))}
            {naoFizeramPedido.length === 0 && (
              <p className="text-sm text-on-surface-variant py-4 text-center">Todos que responderam fizeram pedido!</p>
            )}
          </div>
        </div>
      </div>

      {/* Historical */}
      {data.ciclosRecentes.length > 0 && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6">
          <h3 className="text-lg font-bold text-primary mb-4">Historico Semanal</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-outline-variant/10">
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Semana</th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Disparados</th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Responderam</th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Pedidos</th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Valor</th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Marco Zero</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {data.ciclosRecentes.map((c) => (
                  <tr key={c.id} className="hover:bg-surface-bright transition-colors">
                    <td className="px-4 py-3 text-sm font-semibold">{new Date(c.semanaInicio).toLocaleDateString("pt-BR")}</td>
                    <td className="px-4 py-3 text-sm">{c.totalDisparados}</td>
                    <td className="px-4 py-3 text-sm">{c.totalResponderam}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-green-700">{c.totalPedidos}</td>
                    <td className="px-4 py-3 text-sm font-semibold">R$ {c.totalValor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3">
                      {c.marcoZeroExecutado ? (
                        <span className="text-green-600 material-symbols-outlined text-lg">check_circle</span>
                      ) : (
                        <span className="text-on-surface-variant material-symbols-outlined text-lg">pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
