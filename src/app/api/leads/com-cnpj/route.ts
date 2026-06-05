import { prisma } from "@/lib/prisma";

// ----------------------------------------------------------------
// GET /api/leads/com-cnpj
//
// Lista paginada de clientes que tem cnpjCpf preenchido.
// Usado pelo cron de sync de historico Bling (n8n).
//
// Query params:
//   ?page=1            (default 1)
//   ?limit=50          (default 50, max 200)
//   ?ativo=true        (filtra so ativos; default true)
//   ?segmento=XXX      (opcional)
//
// Response:
//   { data: [{ id, empresa, cnpjCpf, contatoWhatsapp, segmento, ativo }],
//     pagination: { page, limit, total, totalPages, hasMore } }
// ----------------------------------------------------------------
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50")));
    const ativoParam = searchParams.get("ativo");
    const ativo = ativoParam === null ? true : ativoParam === "true";
    const segmento = searchParams.get("segmento");

    const where: Record<string, unknown> = {
      cnpjCpf: { not: null },
      ativo,
    };
    if (segmento) where.segmento = segmento;

    const [data, total] = await Promise.all([
      prisma.cliente.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { empresa: "asc" },
        select: {
          id: true,
          empresa: true,
          cnpjCpf: true,
          contatoWhatsapp: true,
          segmento: true,
          cidade: true,
          uf: true,
          ativo: true,
          ultimoPedidoEm: true,
        },
      }),
      prisma.cliente.count({ where }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return Response.json({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages,
      },
    });
  } catch (error) {
    console.error("GET /api/leads/com-cnpj error:", error);
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    return Response.json({ error: msg }, { status: 500 });
  }
}
