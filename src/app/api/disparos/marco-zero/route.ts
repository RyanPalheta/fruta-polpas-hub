import { prisma } from "@/lib/prisma";
import { StatusDisparo } from "@/generated/prisma/client";
import { getInicioSemana } from "@/lib/utils";

// KOMMO pipeline / status IDs
const PIPELINE_ID = 13451647;
const KOMMO_STATUS = {
  DISPARO:      104234595,
  RETIRADA:     103767127,
  CONFIRMADO:   103767131,
  NAO_REALIZADO: 103767139,
} as const;

// KOMMO custom field IDs
const KOMMO_FIELD = {
  PEDIDO_DESC: 3140594, // Pedido Confirmado (IA) — texto do pedido
  RESPONDEU:   3172950, // Respondeu? — boolean
  FOLLOW_UP:   3172954, // Follow Up — boolean
} as const;

// ----------------------------------------------------------------
// Fetch all leads from the current pipeline (max 250)
// ----------------------------------------------------------------
async function fetchKommoLeads() {
  const config = await prisma.configuracao.findUnique({ where: { id: "default" } });
  if (!config?.kommoToken || !config?.kommoSubdomain) {
    throw new Error("KOMMO não configurado. Acesse Configurações.");
  }

  const cleanToken = (config.kommoToken ?? "").replace(/[^\x20-\x7E]/g, "").trim();
  const url = `https://${config.kommoSubdomain}.kommo.com/api/v4/leads`
    + `?filter[pipeline_id]=${PIPELINE_ID}&with=custom_fields_values&limit=250`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cleanToken}` },
    signal: AbortSignal.timeout(20_000),
  });

  if (res.status === 204) return [];
  if (!res.ok) throw new Error(`KOMMO API ${res.status}: ${await res.text()}`);

  const data = await res.json();
  return (data?._embedded?.leads ?? []) as KommoLead[];
}

interface KommoLead {
  id: number;
  status_id: number;
  price: number | null;
  custom_fields_values: Array<{
    field_id: number;
    values: Array<{ value: unknown }>;
  }> | null;
}

function fieldValue(lead: KommoLead, fieldId: number): unknown {
  return lead.custom_fields_values
    ?.find((f) => f.field_id === fieldId)
    ?.values?.[0]?.value ?? null;
}

// ----------------------------------------------------------------
// Map KOMMO state → our StatusDisparo + extra fields
// ----------------------------------------------------------------
function classify(lead: KommoLead): {
  status: StatusDisparo;
  followUp: boolean;
  descricaoPedido: string | null;
  valorPedido: number | null;
} {
  const respondeu  = !!fieldValue(lead, KOMMO_FIELD.RESPONDEU);
  const followUp   = !!fieldValue(lead, KOMMO_FIELD.FOLLOW_UP);
  const pedidoDesc = fieldValue(lead, KOMMO_FIELD.PEDIDO_DESC) as string | null;
  const valor      = lead.price ?? null;

  let status: StatusDisparo;

  switch (lead.status_id) {
    case KOMMO_STATUS.CONFIRMADO:
      status = StatusDisparo.PEDIDO_CONFIRMADO;
      break;
    case KOMMO_STATUS.NAO_REALIZADO:
      status = respondeu
        ? StatusDisparo.PEDIDO_NAO_REALIZADO
        : StatusDisparo.NAO_RESPONDEU;
      break;
    case KOMMO_STATUS.RETIRADA:
      // Ainda em atendimento no momento do Marco Zero → pedido não realizado
      status = StatusDisparo.PEDIDO_NAO_REALIZADO;
      break;
    case KOMMO_STATUS.DISPARO:
    default:
      status = StatusDisparo.NAO_RESPONDEU;
      break;
  }

  return {
    status,
    followUp,
    descricaoPedido: pedidoDesc,
    valorPedido: status === StatusDisparo.PEDIDO_CONFIRMADO ? valor : null,
  };
}

// ----------------------------------------------------------------
// POST /api/disparos/marco-zero
// ----------------------------------------------------------------
export async function POST(_request: Request) {
  try {
    const semanaInicio = getInicioSemana();
    const semanaFim = new Date(semanaInicio);
    semanaFim.setDate(semanaFim.getDate() + 6);

    // 1. Disparos da semana
    const disparos = await prisma.disparo.findMany({
      where: { semanaInicio },
      include: { cliente: true },
    });

    if (disparos.length === 0) {
      return Response.json(
        { error: "Nenhum disparo encontrado para esta semana" },
        { status: 400 }
      );
    }

    // 2. Leads da KOMMO — aceita array pré-buscado pelo n8n via body
    let kommoLeads: KommoLead[];
    let calledFromN8n = false;
    try {
      const body = await _request.json();
      if (Array.isArray(body?.leads)) {
        kommoLeads = body.leads as KommoLead[];
        calledFromN8n = true;
      } else {
        kommoLeads = await fetchKommoLeads();
      }
    } catch {
      kommoLeads = await fetchKommoLeads();
    }
    const leadMap = new Map(kommoLeads.map((l) => [l.id, l]));

    // 3. Sync cada disparo com dados da KOMMO
    let sincronizados = 0;
    const errors: string[] = [];

    await Promise.all(
      disparos.map(async (disparo) => {
        const leadId = disparo.kommoLeadId ?? disparo.cliente.kommoLeadId;

        if (!leadId) {
          // Sem lead na KOMMO → não respondeu
          await prisma.disparo.update({
            where: { id: disparo.id },
            data: { status: StatusDisparo.NAO_RESPONDEU },
          });
          sincronizados++;
          return;
        }

        const lead = leadMap.get(leadId);
        if (!lead) {
          errors.push(`Lead ${leadId} (${disparo.cliente.empresa}) não encontrado na KOMMO`);
          await prisma.disparo.update({
            where: { id: disparo.id },
            data: { status: StatusDisparo.NAO_RESPONDEU },
          });
          return;
        }

        const { status, followUp, descricaoPedido, valorPedido } = classify(lead);

        await prisma.disparo.update({
          where: { id: disparo.id },
          data: {
            status,
            followUp,
            descricaoPedido,
            ...(valorPedido !== null && { valorPedido }),
            ...(status !== StatusDisparo.NAO_RESPONDEU && !disparo.respondeuEm
              ? { respondeuEm: new Date() }
              : {}),
            ...(status === StatusDisparo.PEDIDO_CONFIRMADO && !disparo.pedidoEm
              ? { pedidoEm: new Date() }
              : {}),
          },
        });
        sincronizados++;
      })
    );

    // 4. Calcular métricas finais
    const finais = await prisma.disparo.findMany({
      where: { semanaInicio },
      include: { cliente: true },
    });

    const totalDisparados     = finais.length;
    const totalResponderam    = finais.filter((d) =>
      d.status === StatusDisparo.PEDIDO_CONFIRMADO || d.status === StatusDisparo.PEDIDO_NAO_REALIZADO
    ).length;
    const totalPedidos        = finais.filter((d) => d.status === StatusDisparo.PEDIDO_CONFIRMADO).length;
    const totalNaoResponderam = finais.filter((d) => d.status === StatusDisparo.NAO_RESPONDEU).length;
    const totalValor          = finais.reduce((s, d) => s + (d.valorPedido ?? 0), 0);
    const totalFollowUp       = finais.filter((d) => d.followUp).length;
    const totalRecuperados    = finais.filter(
      (d) => d.status === StatusDisparo.PEDIDO_CONFIRMADO && d.followUp
    ).length;

    // 5. Salvar CicloSemanal
    const ciclo = await prisma.cicloSemanal.upsert({
      where: { semanaInicio },
      create: {
        semanaInicio,
        semanaFim,
        totalDisparados,
        totalResponderam,
        totalPedidos,
        totalNaoResponderam,
        totalValor,
        totalFollowUp,
        totalRecuperados,
        marcoZeroExecutado: true,
      },
      update: {
        totalDisparados,
        totalResponderam,
        totalPedidos,
        totalNaoResponderam,
        totalValor,
        totalFollowUp,
        totalRecuperados,
        marcoZeroExecutado: true,
      },
    });

    // 6. Enviar relatório para o webhook n8n
    const relatorio = {
      semanaInicio: semanaInicio.toISOString().split("T")[0],
      semanaFim: semanaFim.toISOString().split("T")[0],
      totalDisparados,
      totalResponderam,
      totalPedidos,
      totalNaoResponderam,
      totalFollowUp,
      totalRecuperados,
      totalValor: parseFloat(totalValor.toFixed(2)),
      taxaResposta: totalDisparados > 0
        ? parseFloat(((totalResponderam / totalDisparados) * 100).toFixed(1))
        : 0,
      taxaConversao: totalResponderam > 0
        ? parseFloat(((totalPedidos / totalResponderam) * 100).toFixed(1))
        : 0,
      pedidosConfirmados: finais
        .filter((d) => d.status === StatusDisparo.PEDIDO_CONFIRMADO)
        .map((d) => ({
          empresa: d.cliente.empresa,
          telefone: d.cliente.contatoWhatsapp,
          valor: d.valorPedido ?? 0,
          descricao: d.descricaoPedido ?? null,
          recuperado: d.followUp,
        })),
      naoResponderam: finais
        .filter((d) => d.status === StatusDisparo.NAO_RESPONDEU)
        .map((d) => ({
          empresa: d.cliente.empresa,
          telefone: d.cliente.contatoWhatsapp,
          segmento: d.cliente.segmento,
        })),
      pedidosNaoRealizados: finais
        .filter((d) => d.status === StatusDisparo.PEDIDO_NAO_REALIZADO)
        .map((d) => ({
          empresa: d.cliente.empresa,
          telefone: d.cliente.contatoWhatsapp,
        })),
    };

    // 6a. Se chamado diretamente (não pelo n8n), dispara o webhook manualmente
    if (!calledFromN8n) {
      try {
        await fetch("https://webhook.venancioautomacoes.com.br/webhook/marco_zero_fruta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(relatorio),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (webhookErr) {
        console.error("Erro ao enviar relatório para webhook:", webhookErr);
      }
    }

    // 6b. Retorna relatorio completo para o n8n (ou resposta padrão)
    return Response.json({
      message: "Marco Zero executado com sucesso",
      relatorio,
      ciclo,
      detalhes: {
        sincronizados,
        totalDisparados,
        totalResponderam,
        totalPedidos,
        totalNaoResponderam,
        totalFollowUp,
        totalRecuperados,
        totalValor: totalValor.toFixed(2),
        errors: errors.length ? errors : undefined,
      },
    });
  } catch (error) {
    console.error("POST /api/disparos/marco-zero error:", error);
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    return Response.json({ error: msg }, { status: 500 });
  }
}
