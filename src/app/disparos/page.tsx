import { prisma } from "@/lib/prisma";
import { getInicioSemana, getDiaSemanaHoje, DIA_LABELS, STATUS_LABELS, STATUS_COLORS } from "@/lib/utils";
import { DisparoActions } from "./disparo-actions";
import { DiaSemana } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export default async function DisparosPage() {
  const semanaInicio = getInicioSemana();
  const diaHoje = getDiaSemanaHoje();
  const isFriday = new Date().getDay() === 5;

  // Count clients per weekday
  const clientesPorDia = await prisma.cliente.groupBy({
    by: ["diaDisparo"],
    where: { ativo: true },
    _count: true,
  });

  const contagemPorDia: Record<string, number> = {};
  for (const c of clientesPorDia) {
    contagemPorDia[c.diaDisparo] = c._count;
  }

  // This week's dispatches
  const disparosSemana = await prisma.disparo.findMany({
    where: { semanaInicio },
    include: { cliente: true },
    orderBy: { updatedAt: "desc" },
  });

  // Status breakdown
  const statusCount: Record<string, number> = {};
  for (const d of disparosSemana) {
    statusCount[d.status] = (statusCount[d.status] || 0) + 1;
  }

  // Today's dispatches
  const disparosHoje = diaHoje
    ? disparosSemana.filter((d) => d.cliente.diaDisparo === diaHoje)
    : [];

  const dias: DiaSemana[] = ["SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA"];

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-6">
        <div>
          <h2 className="text-4xl font-extrabold text-primary tracking-tight leading-none mb-2">
            Disparos
          </h2>
          <p className="text-on-surface-variant font-medium text-lg">
            Agenda semanal e status dos disparos.
          </p>
        </div>
        <DisparoActions isFriday={isFriday} />
      </div>

      {/* Weekly Calendar Grid */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6 mb-8">
        <h3 className="mb-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant">
          Semana Atual - Clientes Agendados
        </h3>
        <div className="grid grid-cols-5 gap-3">
          {dias.map((dia) => {
            const isToday = dia === diaHoje;
            return (
              <div
                key={dia}
                className={`rounded-xl border p-4 text-center transition ${
                  isToday
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-outline-variant/20 bg-surface-container-low"
                }`}
              >
                <span className="block text-xs font-medium uppercase tracking-wider text-on-surface-variant">
                  {DIA_LABELS[dia]}
                </span>
                <span className="mt-2 block text-3xl font-black text-on-surface">
                  {contagemPorDia[dia] || 0}
                </span>
                <span className="text-xs text-on-surface-variant">clientes</span>
                {isToday && (
                  <span className="mt-1 block text-[10px] font-bold text-primary uppercase">
                    Hoje
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6 mb-8">
        <h3 className="mb-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant">
          Status da Semana
        </h3>
        {Object.keys(statusCount).length === 0 ? (
          <p className="text-sm text-on-surface-variant">Nenhum disparo nesta semana ainda.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(statusCount).map(([status, count]) => (
              <div
                key={status}
                className={`rounded-xl px-4 py-3 text-center ${STATUS_COLORS[status] || "bg-gray-100 text-gray-700"}`}
              >
                <p className="text-2xl font-black">{count}</p>
                <p className="text-[10px] font-bold uppercase tracking-wider mt-1">
                  {STATUS_LABELS[status] || status}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Today's Dispatches */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6">
        <h3 className="mb-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant">
          Disparos de Hoje {diaHoje ? `(${DIA_LABELS[diaHoje]})` : "(Fim de Semana)"}
        </h3>
        {disparosHoje.length === 0 ? (
          <p className="text-sm text-on-surface-variant">
            {diaHoje
              ? "Nenhum disparo agendado para hoje."
              : "Disparos so ocorrem de segunda a sexta."}
          </p>
        ) : (
          <div className="divide-y divide-outline-variant/10">
            {disparosHoje.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between py-3 hover:bg-surface-container-low px-3 rounded-lg transition-colors"
              >
                <div>
                  <p className="text-sm font-semibold text-on-surface">{d.cliente.empresa}</p>
                  <p className="text-xs text-on-surface-variant">{d.cliente.contatoWhatsapp}</p>
                </div>
                <span
                  className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full ${STATUS_COLORS[d.status] || "bg-gray-100 text-gray-700"}`}
                >
                  {STATUS_LABELS[d.status] || d.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
