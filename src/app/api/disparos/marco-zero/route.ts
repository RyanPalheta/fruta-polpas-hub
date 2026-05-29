import { prisma } from "@/lib/prisma";
import { StatusDisparo } from "@/generated/prisma/client";

// ----------------------------------------------------------------
// Shape do relatório que o n8n envia (POST body)
// ----------------------------------------------------------------
interface LeadConfirmado {
  id: number;
  empresa?: string;
  valor?: number;
  descricao?: string;
  recuperado?: boolean;
  etapa?: string;
}
interface LeadNaoRealizado {
  id: number;
  empresa?: string;
  followUp?: boolean;
}
interface LeadEmRetirada {
  id: number;
  empresa?: string;
  followUp?: boolean;
}
interface LeadRetiradaFup {
  id: number;
  empresa?: string;
}
interface LeadNaoRespondeu {
  id: number;
  empresa?: string;
  segmento?: string;
}

interface Relatorio {
  semanaInicio: string; // "YYYY-MM-DD"
  semanaFim: string;
  totalDisparados: number;
  totalResponderam: number;
  totalNaoResponderam: number;
  taxaResposta: number;
  totalPedidos: number;
  taxaConversao: number;
  totalRecuperados: number;
  totalPedidosNaoRealizados?: number;
  totalEmRetirada?: number;
  totalRetiradaComFollowUp?: number;
  totalFollowUp: number;
  totalValor: number;
  pedidosConfirmados?: LeadConfirmado[];
  pedidosNaoRealizados?: LeadNaoRealizado[];
  emRetirada?: LeadEmRetirada[];
  retiradaComFollowUp?: LeadRetiradaFup[];
  naoResponderam?: LeadNaoRespondeu[];
}

// ----------------------------------------------------------------
// POST /api/disparos/marco-zero
//
// Recebe o relatório pré-calculado pelo n8n e persiste:
//   1. Atualiza Disparo rows (matching via kommoLeadId) → cards do dashboard
//   2. Upsert CicloSemanal com agregados → tabela "Histórico Semanal"
//
// Não chama a KOMMO API — todo o estado vem do body.
// ----------------------------------------------------------------
export async function POST(request: Request) {
  try {
    let body: { relatorio?: Relatorio } | null = null;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "Body inválido: JSON esperado com { relatorio: {...} }" },
        { status: 400 }
      );
    }

    const relatorio = body?.relatorio;
    if (!relatorio || typeof relatorio !== "object") {
      return Response.json(
        { error: "Campo 'relatorio' é obrigatório no body" },
        { status: 400 }
      );
    }
    if (!relatorio.semanaInicio || !relatorio.semanaFim) {
      return Response.json(
        { error: "relatorio.semanaInicio e relatorio.semanaFim são obrigatórios" },
        { status: 400 }
      );
    }

    // Datas como UTC midnight (compatível com @db.Date)
    const semanaInicio = new Date(`${relatorio.semanaInicio}T00:00:00.000Z`);
    const semanaFim = new Date(`${relatorio.semanaFim}T00:00:00.000Z`);
    if (Number.isNaN(semanaInicio.getTime()) || Number.isNaN(semanaFim.getTime())) {
      return Response.json(
        { error: "Datas inválidas em semanaInicio/semanaFim (use YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const now = new Date();

    // 1. Aplica o estado do relatório nos Disparo rows desta semana.
    //    Matching por kommoLeadId. Disparos sem match são ignorados (não
    //    perdemos dados — só não conseguimos sincronizar status pra eles).
    const tasks: Promise<unknown>[] = [];

    for (const p of relatorio.pedidosConfirmados ?? []) {
      if (!p?.id) continue;
      tasks.push(
        prisma.disparo.updateMany({
          where: { kommoLeadId: p.id, semanaInicio },
          data: {
            status: StatusDisparo.PEDIDO_CONFIRMADO,
            ...(typeof p.valor === "number" ? { valorPedido: p.valor } : {}),
            ...(p.descricao !== undefined ? { descricaoPedido: p.descricao } : {}),
            followUp: !!p.recuperado,
            pedidoEm: now,
            respondeuEm: now,
          },
        })
      );
    }

    for (const p of relatorio.pedidosNaoRealizados ?? []) {
      if (!p?.id) continue;
      tasks.push(
        prisma.disparo.updateMany({
          where: { kommoLeadId: p.id, semanaInicio },
          data: {
            status: StatusDisparo.PEDIDO_NAO_REALIZADO,
            followUp: !!p.followUp,
            respondeuEm: now,
          },
        })
      );
    }

    // KOMMO "Em Retirada" = lead ainda em atendimento no Marco Zero.
    // Mantemos o mapeamento original: PEDIDO_NAO_REALIZADO.
    for (const p of relatorio.emRetirada ?? []) {
      if (!p?.id) continue;
      tasks.push(
        prisma.disparo.updateMany({
          where: { kommoLeadId: p.id, semanaInicio },
          data: {
            status: StatusDisparo.PEDIDO_NAO_REALIZADO,
            followUp: !!p.followUp,
            respondeuEm: now,
          },
        })
      );
    }

    for (const p of relatorio.retiradaComFollowUp ?? []) {
      if (!p?.id) continue;
      tasks.push(
        prisma.disparo.updateMany({
          where: { kommoLeadId: p.id, semanaInicio },
          data: {
            status: StatusDisparo.PEDIDO_NAO_REALIZADO,
            followUp: true,
            respondeuEm: now,
          },
        })
      );
    }

    for (const p of relatorio.naoResponderam ?? []) {
      if (!p?.id) continue;
      tasks.push(
        prisma.disparo.updateMany({
          where: { kommoLeadId: p.id, semanaInicio },
          data: { status: StatusDisparo.NAO_RESPONDEU },
        })
      );
    }

    await Promise.all(tasks);

    // 2. Persiste agregados em CicloSemanal (tabela "Histórico Semanal").
    const ciclo = await prisma.cicloSemanal.upsert({
      where: { semanaInicio },
      create: {
        semanaInicio,
        semanaFim,
        totalDisparados: relatorio.totalDisparados ?? 0,
        totalResponderam: relatorio.totalResponderam ?? 0,
        totalPedidos: relatorio.totalPedidos ?? 0,
        totalNaoResponderam: relatorio.totalNaoResponderam ?? 0,
        totalValor: relatorio.totalValor ?? 0,
        totalFollowUp: relatorio.totalFollowUp ?? 0,
        totalRecuperados: relatorio.totalRecuperados ?? 0,
        marcoZeroExecutado: true,
      },
      update: {
        semanaFim,
        totalDisparados: relatorio.totalDisparados ?? 0,
        totalResponderam: relatorio.totalResponderam ?? 0,
        totalPedidos: relatorio.totalPedidos ?? 0,
        totalNaoResponderam: relatorio.totalNaoResponderam ?? 0,
        totalValor: relatorio.totalValor ?? 0,
        totalFollowUp: relatorio.totalFollowUp ?? 0,
        totalRecuperados: relatorio.totalRecuperados ?? 0,
        marcoZeroExecutado: true,
      },
    });

    return Response.json({ ok: true, relatorio, ciclo });
  } catch (error) {
    console.error("POST /api/disparos/marco-zero error:", error);
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    return Response.json({ error: msg }, { status: 500 });
  }
}
