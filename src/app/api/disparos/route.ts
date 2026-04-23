import { prisma } from "@/lib/prisma";
import { StatusDisparo } from "@/generated/prisma/client";
import { getDiaSemanaHoje, getInicioSemana } from "@/lib/utils";
import { moveLeadToStatus, createLeadComplex } from "@/lib/kommo";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const semanaParam = searchParams.get("semana");
    const semanaInicio = semanaParam ? new Date(semanaParam) : getInicioSemana();

    const disparos = await prisma.disparo.findMany({
      where: { semanaInicio },
      include: {
        cliente: {
          select: {
            id: true,
            empresa: true,
            contatoWhatsapp: true,
            segmento: true,
            diaDisparo: true,
            cidade: true,
            uf: true,
          },
        },
      },
      orderBy: [{ status: "asc" }, { cliente: { empresa: "asc" } }],
    });

    const ciclo = await prisma.cicloSemanal.findUnique({ where: { semanaInicio } });

    return Response.json({ disparos, ciclo });
  } catch (error) {
    console.error("GET /api/disparos error:", error);
    return Response.json({ error: "Erro ao buscar disparos" }, { status: 500 });
  }
}

export async function POST(_request: Request) {
  try {
    const diaSemana = getDiaSemanaHoje();
    const semanaInicio = getInicioSemana();

    if (!diaSemana) {
      return Response.json({ message: "Hoje é fim de semana", created: 0 });
    }

    // Load config for KOMMO integration
    const config = await prisma.configuracao.findUnique({ where: { id: "default" } });
    const statusIds = (config?.kommoStatusIds ?? {}) as Record<string, string>;
    const pipelineId = config?.kommoPipelineId ? parseInt(config.kommoPipelineId) : null;
    const disparoStatusId = statusIds.disparo ? parseInt(statusIds.disparo) : null;
    const kommoReady = !!(pipelineId && disparoStatusId && config?.kommoToken && config?.kommoSubdomain);

    const clientes = await prisma.cliente.findMany({
      where: { ativo: true, diaDisparo: diaSemana },
    });

    if (clientes.length === 0) {
      return Response.json({ message: "Nenhum cliente programado para hoje", created: 0 });
    }

    const now = new Date();
    let created = 0;
    const errors: string[] = [];
    const kommoResults = { triggered: 0, created: 0, failed: 0 };

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

      // 2. Trigger KOMMO salesbot (move lead to "Disparo" status)
      if (kommoReady) {
        try {
          if (cliente.kommoLeadId) {
            // Lead already exists in KOMMO — move to Disparo status
            await moveLeadToStatus(cliente.kommoLeadId, disparoStatusId!, pipelineId!);
            kommoResults.triggered++;
          } else {
            // Create lead in KOMMO directly in the Disparo status (triggers salesbot)
            const result = await createLeadComplex({
              name: cliente.empresa,
              phone: cliente.contatoWhatsapp,
              pipelineId: pipelineId!,
              statusId: disparoStatusId!,
              tags: ["Disparo Automático"],
            });

            const newLeadId = result?._embedded?.leads?.[0]?.id;
            if (newLeadId) {
              // Save KOMMO lead ID back to client
              await prisma.cliente.update({
                where: { id: cliente.id },
                data: { kommoLeadId: newLeadId },
              });
            }
            kommoResults.created++;
          }
        } catch (err) {
          console.error(`Erro KOMMO para cliente ${cliente.empresa}:`, err);
          kommoResults.failed++;
          // Don't abort — disparo already registered
        }
      }
    }

    return Response.json({
      message: `Disparos criados para ${diaSemana}`,
      created,
      kommo: kommoReady ? kommoResults : { skipped: true, reason: "KOMMO não configurado" },
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    console.error("POST /api/disparos error:", error);
    return Response.json({ error: "Erro ao criar disparos" }, { status: 500 });
  }
}
