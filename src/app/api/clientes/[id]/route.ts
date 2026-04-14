import { prisma } from "@/lib/prisma";
import { DiaSemana, Segmento } from "@/generated/prisma/client";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const cliente = await prisma.cliente.findUnique({
      where: { id },
      include: { disparos: { orderBy: { semanaInicio: "desc" }, take: 10 } },
    });

    if (!cliente) {
      return Response.json({ error: "Cliente nao encontrado" }, { status: 404 });
    }

    return Response.json(cliente);
  } catch (error) {
    console.error("GET /api/clientes/[id] error:", error);
    return Response.json({ error: "Erro ao buscar cliente" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.cliente.findUnique({ where: { id } });
    if (!existing) {
      return Response.json({ error: "Cliente nao encontrado" }, { status: 404 });
    }

    if (body.diaDisparo && !Object.values(DiaSemana).includes(body.diaDisparo)) {
      return Response.json({ error: "diaDisparo invalido" }, { status: 400 });
    }

    if (body.segmento && !Object.values(Segmento).includes(body.segmento)) {
      return Response.json({ error: "segmento invalido" }, { status: 400 });
    }

    const cliente = await prisma.cliente.update({
      where: { id },
      data: {
        empresa: body.empresa ?? existing.empresa,
        contatoWhatsapp: body.contatoWhatsapp ?? existing.contatoWhatsapp,
        segmento: body.segmento ?? existing.segmento,
        diaDisparo: body.diaDisparo ?? existing.diaDisparo,
        cidade: body.cidade !== undefined ? body.cidade : existing.cidade,
        uf: body.uf !== undefined ? body.uf : existing.uf,
        ativo: body.ativo !== undefined ? body.ativo : existing.ativo,
        tags: body.tags !== undefined ? body.tags : existing.tags,
        kommoLeadId: body.kommoLeadId !== undefined ? body.kommoLeadId : existing.kommoLeadId,
        kommoContactId: body.kommoContactId !== undefined ? body.kommoContactId : existing.kommoContactId,
      },
    });

    return Response.json(cliente);
  } catch (error) {
    console.error("PUT /api/clientes/[id] error:", error);
    return Response.json({ error: "Erro ao atualizar cliente" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const existing = await prisma.cliente.findUnique({ where: { id } });
    if (!existing) {
      return Response.json({ error: "Cliente nao encontrado" }, { status: 404 });
    }

    await prisma.cliente.delete({ where: { id } });

    return Response.json({ message: "Cliente removido com sucesso" });
  } catch (error) {
    console.error("DELETE /api/clientes/[id] error:", error);
    return Response.json({ error: "Erro ao remover cliente" }, { status: 500 });
  }
}
