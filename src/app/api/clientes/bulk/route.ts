import { prisma } from "@/lib/prisma";
import { DiaSemana, Segmento } from "@/generated/prisma/client";

// PATCH /api/clientes/bulk
// Body: { ids: string[], action: "diaDisparo" | "segmento" | "ativar" | "desativar" | "deletar", value?: string }
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { ids, action, value } = body as {
      ids: string[];
      action: string;
      value?: string;
    };

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return Response.json({ error: "Nenhum cliente selecionado" }, { status: 400 });
    }

    if (!action) {
      return Response.json({ error: "Ação não informada" }, { status: 400 });
    }

    let count = 0;

    switch (action) {
      case "diaDisparo": {
        if (!value || !Object.values(DiaSemana).includes(value as DiaSemana)) {
          return Response.json({ error: "Dia inválido" }, { status: 400 });
        }
        const result = await prisma.cliente.updateMany({
          where: { id: { in: ids } },
          data: { diaDisparo: value as DiaSemana },
        });
        count = result.count;
        break;
      }

      case "segmento": {
        if (!value || !Object.values(Segmento).includes(value as Segmento)) {
          return Response.json({ error: "Segmento inválido" }, { status: 400 });
        }
        const result = await prisma.cliente.updateMany({
          where: { id: { in: ids } },
          data: { segmento: value as Segmento },
        });
        count = result.count;
        break;
      }

      case "ativar": {
        const result = await prisma.cliente.updateMany({
          where: { id: { in: ids } },
          data: { ativo: true },
        });
        count = result.count;
        break;
      }

      case "desativar": {
        const result = await prisma.cliente.updateMany({
          where: { id: { in: ids } },
          data: { ativo: false },
        });
        count = result.count;
        break;
      }

      case "deletar": {
        const result = await prisma.cliente.deleteMany({
          where: { id: { in: ids } },
        });
        count = result.count;
        break;
      }

      default:
        return Response.json({ error: "Ação desconhecida" }, { status: 400 });
    }

    return Response.json({ success: true, count });
  } catch (error) {
    console.error("PATCH /api/clientes/bulk error:", error);
    return Response.json({ error: "Erro ao processar ação em massa" }, { status: 500 });
  }
}
