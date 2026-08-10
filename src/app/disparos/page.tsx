import { prisma } from "@/lib/prisma";
import {
  getInicioSemana,
  getDiaSemanaHoje,
  DIAS_SEMANA,
  DIA_LABELS,
  STATUS_LABELS,
  STATUS_COLORS,
} from "@/lib/utils";
import { DisparoActions } from "./disparo-actions";
import { PainelDisparo } from "./painel-disparo";

export const dynamic = "force-dynamic";

export default async function DisparosPage() {
  const semanaInicio = getInicioSemana();
  const diaHoje = getDiaSemanaHoje();
  const isFriday = new Date().getDay() === 5;

  const [clientesAtivos, disparosSemana] = await Promise.all([
    prisma.cliente.findMany({
      where: { ativo: true },
      select: { diasDisparo: true, responsavel: true },
    }),
    prisma.disparo.findMany({
      where: { semanaInicio },
      include: { cliente: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  // diasDisparo e uma lista, entao o groupBy do Prisma nao resolve — conta aqui.
  const contagemPorDia: Record<string, number> = {};
  for (const dia of DIAS_SEMANA) contagemPorDia[dia] = 0;
  for (const cliente of clientesAtivos) {
    for (const dia of cliente.diasDisparo) {
      contagemPorDia[dia] = (contagemPorDia[dia] ?? 0) + 1;
    }
  }

  const responsaveis = [
    ...new Set(
      clientesAtivos
        .map((c) => c.responsavel?.trim())
        .filter((r): r is string => Boolean(r))
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const statusCount: Record<string, number> = {};
  for (const d of disparosSemana) {
    statusCount[d.status] = (statusCount[d.status] || 0) + 1;
  }

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-6">
        <div>
          <h2 className="text-4xl font-extrabold text-primary tracking-tight leading-none mb-2">
            Disparos
          </h2>
          <p className="text-on-surface-variant font-medium text-lg">
            Escolha o dia, confira quem vai receber e dispare.
          </p>
        </div>
        <DisparoActions isFriday={isFriday} />
      </div>

      <PainelDisparo
        diaHoje={diaHoje}
        responsaveis={responsaveis}
        contagemPorDia={contagemPorDia}
      />

      {/* Status da semana */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6 mt-6">
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

      {/* Historico da semana */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6 mt-6">
        <h3 className="mb-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant">
          Disparos desta semana
          {diaHoje ? ` — hoje é ${DIA_LABELS[diaHoje]}` : " — fim de semana"}
        </h3>
        {disparosSemana.length === 0 ? (
          <p className="text-sm text-on-surface-variant">
            Nenhum disparo registrado nesta semana.
          </p>
        ) : (
          <div className="divide-y divide-outline-variant/10 max-h-96 overflow-y-auto">
            {disparosSemana.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between py-3 hover:bg-surface-container-low px-3 rounded-lg transition-colors"
              >
                <div>
                  <p className="text-sm font-semibold text-on-surface">{d.cliente.empresa}</p>
                  <p className="text-xs text-on-surface-variant">
                    {d.cliente.contatoWhatsapp}
                    {d.cliente.responsavel ? ` · ${d.cliente.responsavel}` : ""}
                    {d.disparadoEm
                      ? ` · ${new Date(d.disparadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                      : ""}
                  </p>
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
