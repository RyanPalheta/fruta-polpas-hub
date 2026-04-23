import { prisma } from "@/lib/prisma";
import { getInicioSemana } from "@/lib/utils";
import { executarDisparos } from "@/lib/executar-disparos";

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
    const result = await executarDisparos();
    return Response.json(result);
  } catch (error) {
    console.error("POST /api/disparos error:", error);
    return Response.json({ error: "Erro ao criar disparos" }, { status: 500 });
  }
}
