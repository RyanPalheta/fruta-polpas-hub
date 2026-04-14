import { prisma } from "@/lib/prisma";
import { DiaSemana, Segmento } from "@/generated/prisma/client";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
    const search = searchParams.get("search") || "";
    const segmento = searchParams.get("segmento") as Segmento | null;
    const ativoParam = searchParams.get("ativo");

    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { empresa: { contains: search, mode: "insensitive" } },
        { contatoWhatsapp: { contains: search, mode: "insensitive" } },
        { cidade: { contains: search, mode: "insensitive" } },
      ];
    }

    if (segmento && Object.values(Segmento).includes(segmento)) {
      where.segmento = segmento;
    }

    if (ativoParam !== null) {
      where.ativo = ativoParam === "true";
    }

    const [clientes, total] = await Promise.all([
      prisma.cliente.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { empresa: "asc" },
      }),
      prisma.cliente.count({ where }),
    ]);

    return Response.json({
      data: clientes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("GET /api/clientes error:", error);
    return Response.json({ error: "Erro ao buscar clientes" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { empresa, contatoWhatsapp, segmento, diaDisparo, cidade, uf, tags } = body;

    if (!empresa || !contatoWhatsapp || !diaDisparo) {
      return Response.json(
        { error: "Campos obrigatorios: empresa, contatoWhatsapp, diaDisparo" },
        { status: 400 }
      );
    }

    if (!Object.values(DiaSemana).includes(diaDisparo)) {
      return Response.json({ error: "diaDisparo invalido" }, { status: 400 });
    }

    if (segmento && !Object.values(Segmento).includes(segmento)) {
      return Response.json({ error: "segmento invalido" }, { status: 400 });
    }

    const cliente = await prisma.cliente.create({
      data: {
        empresa,
        contatoWhatsapp,
        segmento: segmento || Segmento.RESTAURANTE,
        diaDisparo,
        cidade: cidade || null,
        uf: uf || null,
        tags: tags || [],
      },
    });

    return Response.json(cliente, { status: 201 });
  } catch (error) {
    console.error("POST /api/clientes error:", error);
    return Response.json({ error: "Erro ao criar cliente" }, { status: 500 });
  }
}
