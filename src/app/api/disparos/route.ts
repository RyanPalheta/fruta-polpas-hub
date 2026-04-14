import { prisma } from "@/lib/prisma";
import { StatusDisparo } from "@/generated/prisma/client";
import { getDiaSemanaHoje, getInicioSemana } from "@/lib/utils";

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

    const ciclo = await prisma.cicloSemanal.findUnique({
      where: { semanaInicio },
    });

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
      return Response.json({ message: "Hoje e fim de semana", created: 0 });
    }

    const clientes = await prisma.cliente.findMany({
      where: {
        ativo: true,
        diaDisparo: diaSemana,
      },
    });

    if (clientes.length === 0) {
      return Response.json({
        message: "Nenhum cliente programado para hoje",
        created: 0,
      });
    }

    const now = new Date();
    let created = 0;

    for (const cliente of clientes) {
      try {
        await prisma.disparo.upsert({
          where: {
            clienteId_semanaInicio: {
              clienteId: cliente.id,
              semanaInicio,
            },
          },
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
      }
    }

    return Response.json({
      message: `Disparos criados para ${diaSemana}`,
      created,
    });
  } catch (error) {
    console.error("POST /api/disparos error:", error);
    return Response.json({ error: "Erro ao criar disparos" }, { status: 500 });
  }
}
