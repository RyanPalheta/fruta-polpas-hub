import { prisma } from "./prisma";
import { StatusDisparo } from "@/generated/prisma/client";
import { getDiaSemanaHoje, getInicioSemana } from "./utils";

const WEBHOOK_URL = "https://webhook.venancioautomacoes.com.br/webhook/disparo_fruta";

export interface WebhookDisparoPayload {
  lead_id: number | null;
  empresa: string;
  telefone: string;
  cliente_id: string;
}

export interface WebhookDisparoResponse {
  success?: boolean;
  [key: string]: unknown;
}

export interface DisparoResult {
  message: string;
  created: number;
  webhook: {
    enviados: number;
    falhas: number;
    resultados: Array<{
      empresa: string;
      lead_id: number | null;
      ok: boolean;
      resposta?: unknown;
      erro?: string;
    }>;
  };
  errors?: string[];
}

/**
 * Dispara um único lead via n8n webhook (GET com query params).
 * Aguarda resposta síncrona do n8n (timeout: 25s).
 */
export async function dispararLeadViaWebhook(
  payload: WebhookDisparoPayload
): Promise<WebhookDisparoResponse> {
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25_000),
  });

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!res.ok) {
    throw new Error(`Webhook respondeu ${res.status}: ${text.slice(0, 200)}`);
  }

  return body as WebhookDisparoResponse;
}

/**
 * Executa os disparos do dia: registra no banco e chama o n8n para cada cliente.
 */
export async function executarDisparos(): Promise<DisparoResult> {
  const diaSemana = getDiaSemanaHoje();
  const semanaInicio = getInicioSemana();

  if (!diaSemana) {
    return {
      message: "Hoje é fim de semana",
      created: 0,
      webhook: { enviados: 0, falhas: 0, resultados: [] },
    };
  }

  const clientes = await prisma.cliente.findMany({
    where: { ativo: true, diaDisparo: diaSemana },
  });

  if (clientes.length === 0) {
    return {
      message: "Nenhum cliente programado para hoje",
      created: 0,
      webhook: { enviados: 0, falhas: 0, resultados: [] },
    };
  }

  const now = new Date();
  let created = 0;
  const errors: string[] = [];
  const resultados: DisparoResult["webhook"]["resultados"] = [];

  for (const cliente of clientes) {
    // 1. Upsert disparo no banco
    try {
      await prisma.disparo.upsert({
        where: { clienteId_semanaInicio: { clienteId: cliente.id, semanaInicio } },
        create: {
          clienteId: cliente.id,
          semanaInicio,
          status: StatusDisparo.DISPARADO,
          disparadoEm: now,
        },
        update: {
          status: StatusDisparo.DISPARADO,
          disparadoEm: now,
        },
      });
      created++;
    } catch (err) {
      console.error(`Erro ao registrar disparo para ${cliente.empresa}:`, err);
      errors.push(`DB error: ${cliente.empresa}`);
      continue;
    }

    // 2. Chamar n8n webhook
    const payload: WebhookDisparoPayload = {
      lead_id: cliente.kommoLeadId ?? null,
      empresa: cliente.empresa,
      telefone: cliente.contatoWhatsapp,
      cliente_id: cliente.id,
    };

    try {
      console.log(`[disparo] Enviando webhook para ${cliente.empresa} (lead_id=${payload.lead_id})`);
      const resposta = await dispararLeadViaWebhook(payload);
      console.log(`[disparo] Resposta para ${cliente.empresa}:`, resposta);

      // Se o n8n retornou um lead_id (novo contato criado na KOMMO),
      // salva de volta no banco para cache nos próximos ciclos.
      const leadIdRetornado =
        typeof resposta.lead_id === "number" ? resposta.lead_id : null;
      if (leadIdRetornado && !cliente.kommoLeadId) {
        await prisma.cliente.update({
          where: { id: cliente.id },
          data: { kommoLeadId: leadIdRetornado },
        });
      }

      resultados.push({
        empresa: cliente.empresa,
        lead_id: leadIdRetornado ?? payload.lead_id,
        ok: true,
        resposta,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[disparo] Erro webhook para ${cliente.empresa}:`, msg);
      resultados.push({
        empresa: cliente.empresa,
        lead_id: payload.lead_id,
        ok: false,
        erro: msg,
      });
    }
  }

  const enviados = resultados.filter((r) => r.ok).length;
  const falhas = resultados.filter((r) => !r.ok).length;

  return {
    message: `Disparos executados para ${diaSemana}`,
    created,
    webhook: { enviados, falhas, resultados },
    errors: errors.length ? errors : undefined,
  };
}
