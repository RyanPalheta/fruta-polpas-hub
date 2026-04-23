import { prisma } from "./prisma";
import { StatusDisparo } from "@/generated/prisma/client";
import { getDiaSemanaHoje, getInicioSemana } from "./utils";
import { moveLeadToStatus, createLeadComplex, findKommoLeadByPhone } from "./kommo";

export interface DisparoResult {
  message: string;
  created: number;
  kommo:
    | { triggered: number; matched: number; created: number; failed: number }
    | { skipped: true; reason: string };
  errors?: string[];
}

export async function executarDisparos(): Promise<DisparoResult> {
  const diaSemana = getDiaSemanaHoje();
  const semanaInicio = getInicioSemana();

  if (!diaSemana) {
    return { message: "Hoje é fim de semana", created: 0, kommo: { skipped: true, reason: "Fim de semana" } };
  }

  // Load KOMMO config
  const config = await prisma.configuracao.findUnique({ where: { id: "default" } });
  const statusIds = (config?.kommoStatusIds ?? {}) as Record<string, string>;
  const pipelineId = config?.kommoPipelineId ? parseInt(config.kommoPipelineId) : null;
  const disparoStatusId = statusIds.disparo ? parseInt(statusIds.disparo) : null;
  const kommoReady = !!(pipelineId && disparoStatusId && config?.kommoToken && config?.kommoSubdomain);

  const clientes = await prisma.cliente.findMany({
    where: { ativo: true, diaDisparo: diaSemana },
  });

  if (clientes.length === 0) {
    return {
      message: "Nenhum cliente programado para hoje",
      created: 0,
      kommo: { skipped: true, reason: "Sem clientes" },
    };
  }

  const now = new Date();
  let created = 0;
  const errors: string[] = [];
  const kommoResults = { triggered: 0, matched: 0, created: 0, failed: 0 };

  for (const cliente of clientes) {
    // 1. Upsert disparo record
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
      console.error(`Erro ao criar disparo para cliente ${cliente.id}:`, err);
      errors.push(`DB error: ${cliente.empresa}`);
      continue;
    }

    // 2. Trigger KOMMO salesbot
    if (kommoReady) {
      try {
        // Priority: cached lead id → lookup by phone → create new
        let leadId: number | null = cliente.kommoLeadId ?? null;

        if (!leadId) {
          const found = await findKommoLeadByPhone(cliente.contatoWhatsapp);

          if (found) {
            await prisma.cliente.update({
              where: { id: cliente.id },
              data: {
                kommoLeadId: found.leadId ?? null,
                kommoContactId: found.contactId,
              },
            });

            if (found.leadId) {
              leadId = found.leadId;
              kommoResults.matched++;
            }
          }
        }

        if (leadId) {
          await moveLeadToStatus(leadId, disparoStatusId!, pipelineId!);
          kommoResults.triggered++;
        } else {
          const result = await createLeadComplex({
            name: cliente.empresa,
            phone: cliente.contatoWhatsapp,
            pipelineId: pipelineId!,
            statusId: disparoStatusId!,
            tags: ["Disparo Automático"],
          });

          const newLeadId = result?._embedded?.leads?.[0]?.id;
          const newContactId = result?._embedded?.contacts?.[0]?.id;
          if (newLeadId || newContactId) {
            await prisma.cliente.update({
              where: { id: cliente.id },
              data: {
                ...(newLeadId ? { kommoLeadId: newLeadId } : {}),
                ...(newContactId ? { kommoContactId: newContactId } : {}),
              },
            });
          }
          kommoResults.created++;
        }
      } catch (err) {
        console.error(`Erro KOMMO para cliente ${cliente.empresa}:`, err);
        kommoResults.failed++;
      }
    }
  }

  return {
    message: `Disparos criados para ${diaSemana}`,
    created,
    kommo: kommoReady ? kommoResults : { skipped: true, reason: "KOMMO não configurado" },
    errors: errors.length ? errors : undefined,
  };
}
