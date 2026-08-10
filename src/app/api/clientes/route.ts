import { prisma } from "@/lib/prisma";
import { Segmento } from "@/generated/prisma/client";
import { cleanCnpjCpf, isValidCnpjCpfFormat, parseDiasDisparo } from "@/lib/utils";

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
        { cnpjCpf: { contains: cleanCnpjCpf(search), mode: "insensitive" } },
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
    const { empresa, contatoWhatsapp, segmento, cidade, uf, tags, cnpjCpf, responsavel } = body;

    // `diaDisparo` (singular) e o formato antigo, ainda usado pelo workflow do n8n.
    const diasDisparo = parseDiasDisparo(body.diasDisparo ?? body.diaDisparo);

    if (!empresa || !contatoWhatsapp) {
      return Response.json(
        { error: "Campos obrigatorios: empresa, contatoWhatsapp" },
        { status: 400 }
      );
    }

    if (diasDisparo.length === 0) {
      return Response.json(
        { error: "Informe ao menos um dia em diasDisparo" },
        { status: 400 }
      );
    }

    if (segmento && !Object.values(Segmento).includes(segmento)) {
      return Response.json({ error: "segmento invalido" }, { status: 400 });
    }

    if (cnpjCpf && !isValidCnpjCpfFormat(cnpjCpf)) {
      return Response.json(
        { error: "cnpjCpf invalido: deve ter 11 (CPF) ou 14 (CNPJ) digitos" },
        { status: 400 }
      );
    }

    const cliente = await prisma.cliente.create({
      data: {
        empresa,
        contatoWhatsapp,
        segmento: segmento || Segmento.RESTAURANTE,
        diasDisparo,
        responsavel: responsavel?.trim() || null,
        cidade: cidade || null,
        uf: uf || null,
        cnpjCpf: cnpjCpf ? cleanCnpjCpf(cnpjCpf) : null,
        tags: tags || [],
      },
    });

    return Response.json(cliente, { status: 201 });
  } catch (error) {
    console.error("POST /api/clientes error:", error);
    return Response.json({ error: "Erro ao criar cliente" }, { status: 500 });
  }
}
