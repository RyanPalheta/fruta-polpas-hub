import { prisma } from "@/lib/prisma";
import { cleanCnpjCpf } from "@/lib/utils";
import { Prisma } from "@/generated/prisma/client";

// ----------------------------------------------------------------
// GET /api/leads/historico
//
// Query params (mutuamente exclusivos, prioridade: clienteId > cnpjCpf > telefone):
//   ?clienteId=<cuid>
//   ?cnpjCpf=<11 ou 14 digitos, com ou sem mascara>
//   ?telefone=<numero, com ou sem DDI/mascara>
//
// Retorna o cliente + agregados + lista completa de pedidos do Bling.
// Use no agente de follow-up p/ saber o que o lead ja comprou.
// ----------------------------------------------------------------
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clienteId = searchParams.get("clienteId");
    const cnpjCpfRaw = searchParams.get("cnpjCpf");
    const telefoneRaw = searchParams.get("telefone");
    const limitRaw = searchParams.get("limit");
    const limit = Math.min(100, Math.max(1, parseInt(limitRaw || "50")));

    if (!clienteId && !cnpjCpfRaw && !telefoneRaw) {
      return Response.json(
        { error: "Informe um dos parametros: clienteId, cnpjCpf ou telefone" },
        { status: 400 }
      );
    }

    // 1. Resolver o cliente
    let cliente = null;
    if (clienteId) {
      cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
    } else if (cnpjCpfRaw) {
      const digits = cleanCnpjCpf(cnpjCpfRaw);
      if (digits.length === 0) {
        return Response.json({ error: "cnpjCpf vazio apos limpeza" }, { status: 400 });
      }
      cliente = await prisma.cliente.findFirst({ where: { cnpjCpf: digits } });
    } else if (telefoneRaw) {
      const digits = telefoneRaw.replace(/\D/g, "");
      if (digits.length < 8) {
        return Response.json({ error: "telefone com poucos digitos" }, { status: 400 });
      }
      // Match por sufixo: aceita variantes (com/sem 55, com/sem mascara no banco)
      const suffix = digits.replace(/^55/, "");
      const matches = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM clientes
        WHERE regexp_replace(contato_whatsapp, '[^0-9]', '', 'g') LIKE ${"%" + suffix}
        LIMIT 1
      `;
      if (matches.length > 0) {
        cliente = await prisma.cliente.findUnique({ where: { id: matches[0].id } });
      }
    }

    if (!cliente) {
      return Response.json(
        { encontrado: false, mensagem: "Cliente nao encontrado no dashboard." },
        { status: 404 }
      );
    }

    // 2. Buscar historico de compras
    const pedidos = await prisma.historicoCompraBling.findMany({
      where: { clienteId: cliente.id },
      orderBy: { data: "desc" },
      take: limit,
    });

    // 3. Agregados
    const totalPedidos = pedidos.length;
    const totalGasto = pedidos.reduce((s, p) => s + (p.valorTotal ?? 0), 0);
    const ultimoPedido = pedidos[0] ?? null;
    const ultimoSyncEm = pedidos.length > 0
      ? pedidos.map((p) => p.syncedAt).sort((a, b) => b.getTime() - a.getTime())[0]
      : null;

    return Response.json({
      encontrado: true,
      cliente: {
        id: cliente.id,
        empresa: cliente.empresa,
        contatoWhatsapp: cliente.contatoWhatsapp,
        cnpjCpf: cliente.cnpjCpf,
        segmento: cliente.segmento,
        cidade: cliente.cidade,
        uf: cliente.uf,
        ativo: cliente.ativo,
      },
      total_pedidos: totalPedidos,
      total_gasto: parseFloat(totalGasto.toFixed(2)),
      ultimo_pedido: ultimoPedido && {
        data: ultimoPedido.data.toISOString().slice(0, 10),
        numero_pedido: ultimoPedido.numeroPedido,
        valor_total: ultimoPedido.valorTotal,
        situacao: ultimoPedido.situacao,
      },
      ultimo_sync: ultimoSyncEm?.toISOString() ?? null,
      pedidos: pedidos.map((p) => ({
        id: p.id,
        bling_pedido_id: p.blingPedidoId,
        numero_pedido: p.numeroPedido,
        data: p.data.toISOString().slice(0, 10),
        valor_total: p.valorTotal,
        situacao: p.situacao,
        itens: p.itens,
      })),
    });
  } catch (error) {
    console.error("GET /api/leads/historico error:", error);
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    return Response.json({ error: msg }, { status: 500 });
  }
}

// ----------------------------------------------------------------
// POST /api/leads/historico
//
// Body:
//   {
//     "cnpjCpf" | "clienteId" | "telefone": "...",
//     "pedidos": [
//       {
//         "bling_pedido_id": "12345",        // opcional, mas recomendado p/ deduplicar
//         "numero_pedido": "0001",           // opcional, numero visivel
//         "data": "2026-05-25",              // YYYY-MM-DD obrigatorio
//         "valor_total": 410.70,             // obrigatorio
//         "situacao": "Atendido",            // opcional
//         "itens": [                         // opcional
//           { "descricao": "...", "quantidade": 10, "valor": 41.07 }
//         ]
//       }
//     ]
//   }
//
// Upsert idempotente por (clienteId, bling_pedido_id). Se bling_pedido_id for nulo,
// SEMPRE cria nova linha — entao mande o ID quando tiver, pra evitar duplicacoes.
// ----------------------------------------------------------------
interface PedidoInput {
  bling_pedido_id?: string | number | null;
  numero_pedido?: string | number | null;
  data: string;
  valor_total: number;
  situacao?: string | null;
  itens?: unknown;
}

interface SyncBody {
  clienteId?: string;
  cnpjCpf?: string;
  telefone?: string;
  pedidos: PedidoInput[];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SyncBody;

    if (!Array.isArray(body?.pedidos)) {
      return Response.json({ error: "Campo 'pedidos' deve ser um array" }, { status: 400 });
    }

    // Resolver cliente
    let cliente = null;
    if (body.clienteId) {
      cliente = await prisma.cliente.findUnique({ where: { id: body.clienteId } });
    } else if (body.cnpjCpf) {
      const digits = cleanCnpjCpf(body.cnpjCpf);
      cliente = await prisma.cliente.findFirst({ where: { cnpjCpf: digits } });
    } else if (body.telefone) {
      const digits = body.telefone.replace(/\D/g, "").replace(/^55/, "");
      const matches = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM clientes
        WHERE regexp_replace(contato_whatsapp, '[^0-9]', '', 'g') LIKE ${"%" + digits}
        LIMIT 1
      `;
      if (matches.length > 0) {
        cliente = await prisma.cliente.findUnique({ where: { id: matches[0].id } });
      }
    } else {
      return Response.json(
        { error: "Informe clienteId, cnpjCpf ou telefone" },
        { status: 400 }
      );
    }

    if (!cliente) {
      return Response.json({ error: "Cliente nao encontrado" }, { status: 404 });
    }

    let inserted = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const p of body.pedidos) {
      if (!p?.data || typeof p.valor_total !== "number") {
        errors.push(`Pedido invalido (precisa de 'data' YYYY-MM-DD e 'valor_total' numerico)`);
        continue;
      }
      const dataDate = new Date(`${p.data}T00:00:00.000Z`);
      if (Number.isNaN(dataDate.getTime())) {
        errors.push(`Data invalida: ${p.data}`);
        continue;
      }

      const blingPedidoId = p.bling_pedido_id != null ? String(p.bling_pedido_id) : null;
      const numeroPedido = p.numero_pedido != null ? String(p.numero_pedido) : null;
      const itens = (p.itens ?? null) as Prisma.InputJsonValue | null;

      try {
        if (blingPedidoId) {
          // Upsert idempotente por (clienteId, blingPedidoId)
          const existing = await prisma.historicoCompraBling.findUnique({
            where: {
              clienteId_blingPedidoId: {
                clienteId: cliente.id,
                blingPedidoId,
              },
            },
          });
          if (existing) {
            await prisma.historicoCompraBling.update({
              where: { id: existing.id },
              data: {
                numeroPedido,
                data: dataDate,
                valorTotal: p.valor_total,
                situacao: p.situacao ?? null,
                itens: (itens ?? Prisma.JsonNull) as Prisma.InputJsonValue,
                rawPayload: p as unknown as Prisma.InputJsonValue,
                syncedAt: new Date(),
              },
            });
            updated++;
          } else {
            await prisma.historicoCompraBling.create({
              data: {
                clienteId: cliente.id,
                blingPedidoId,
                numeroPedido,
                data: dataDate,
                valorTotal: p.valor_total,
                situacao: p.situacao ?? null,
                itens: (itens ?? Prisma.JsonNull) as Prisma.InputJsonValue,
                rawPayload: p as unknown as Prisma.InputJsonValue,
              },
            });
            inserted++;
          }
        } else {
          // Sem ID estavel: cria novo (pode duplicar — apenas use isso pra historico legado)
          await prisma.historicoCompraBling.create({
            data: {
              clienteId: cliente.id,
              numeroPedido,
              data: dataDate,
              valorTotal: p.valor_total,
              situacao: p.situacao ?? null,
              itens: (itens ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              rawPayload: p as unknown as Prisma.InputJsonValue,
            },
          });
          inserted++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`Erro pedido ${blingPedidoId ?? "(sem id)"}: ${msg}`);
      }
    }

    return Response.json({
      ok: true,
      clienteId: cliente.id,
      empresa: cliente.empresa,
      inserted,
      updated,
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    console.error("POST /api/leads/historico error:", error);
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    return Response.json({ error: msg }, { status: 500 });
  }
}
