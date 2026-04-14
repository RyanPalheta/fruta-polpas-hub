import { prisma } from "@/lib/prisma";
import { getInicioSemana, STATUS_LABELS, STATUS_COLORS } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function FunilPage() {
  const semanaInicio = getInicioSemana();

  const disparos = await prisma.disparo.findMany({
    where: { semanaInicio },
    include: { cliente: true },
    orderBy: { updatedAt: "desc" },
  });

  const grouped = disparos.reduce(
    (acc, d) => {
      if (!acc[d.status]) acc[d.status] = [];
      acc[d.status].push(d);
      return acc;
    },
    {} as Record<string, typeof disparos>
  );

  const statusOrder = [
    "AGUARDANDO",
    "DISPARADO",
    "RESPONDEU",
    "PEDIDO_CONFIRMADO",
    "PEDIDO_NAO_REALIZADO",
    "NAO_RESPONDEU",
    "SUPORTE_HUMANO",
  ];

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-6">
        <div>
          <h2 className="text-4xl font-extrabold text-primary tracking-tight leading-none mb-2">
            Funil de Vendas
          </h2>
          <p className="text-on-surface-variant font-medium text-lg">
            Visualizacao Kanban do ciclo semanal.
          </p>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {statusOrder.map((status) => {
          const items = grouped[status] || [];
          return (
            <div
              key={status}
              className="min-w-[240px] max-w-[280px] flex-shrink-0"
            >
              {/* Column header */}
              <div
                className={`rounded-t-xl px-4 py-3 ${STATUS_COLORS[status] || "bg-gray-100 text-gray-700"}`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider">
                    {STATUS_LABELS[status]}
                  </h3>
                  <span className="text-sm font-black">{items.length}</span>
                </div>
              </div>

              {/* Cards */}
              <div className="bg-surface-container-low rounded-b-xl p-2 space-y-2 min-h-[200px]">
                {items.map((d) => (
                  <div
                    key={d.id}
                    className="bg-surface-container-lowest rounded-lg p-3 shadow-sm border border-outline-variant/5 hover:shadow-md transition-shadow"
                  >
                    <p className="text-sm font-semibold text-on-surface leading-tight">
                      {d.cliente.empresa}
                    </p>
                    <p className="text-xs text-on-surface-variant mt-1">
                      {d.cliente.contatoWhatsapp}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                        {d.cliente.segmento}
                      </span>
                      {d.valorPedido && (
                        <span className="text-xs font-bold text-green-700">
                          R$ {d.valorPedido.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="text-center py-8">
                    <span className="material-symbols-outlined text-3xl text-outline-variant">
                      inbox
                    </span>
                    <p className="text-xs text-on-surface-variant mt-1">Vazio</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
