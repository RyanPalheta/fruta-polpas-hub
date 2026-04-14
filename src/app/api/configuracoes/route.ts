import { prisma } from "@/lib/prisma";

const DEFAULT_ID = "default";

export async function GET() {
  try {
    const config = await prisma.configuracao.upsert({
      where: { id: DEFAULT_ID },
      create: { id: DEFAULT_ID },
      update: {},
    });

    return Response.json(config);
  } catch (error) {
    console.error("GET /api/configuracoes error:", error);
    return Response.json({ error: "Erro ao buscar configuracoes" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();

    const config = await prisma.configuracao.update({
      where: { id: DEFAULT_ID },
      data: {
        horarioDisparo: body.horarioDisparo,
        horarioFollowup: body.horarioFollowup,
        kommoPipelineId: body.kommoPipelineId,
        kommoStatusIds: body.kommoStatusIds,
        kommoToken: body.kommoToken,
        kommoSubdomain: body.kommoSubdomain,
      },
    });

    return Response.json(config);
  } catch (error) {
    console.error("PUT /api/configuracoes error:", error);
    return Response.json({ error: "Erro ao atualizar configuracoes" }, { status: 500 });
  }
}
