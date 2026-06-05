import { prisma } from "@/lib/prisma";
import { cleanCnpjCpf } from "@/lib/utils";
import { Prisma } from "@/generated/prisma/client";

// ----------------------------------------------------------------
// GET /api/leads/historico
//
// Resolucao do cliente (prioridade): clienteId > cnpjCpf > telefone
//   ?clienteId=<cuid>
//   ?cnpjCpf=<11 ou 14 digitos, com ou sem mascara>
//   ?telefone=<numero, com ou sem DDI/mascara>
//
// Por DEFAULT retorna:
//   - cliente (basico)
//   - resumo (status, total, ticket medio, frequencia, tendencia, top produtos)
//   - texto_para_agente (frase pronta pra IA usar como contexto)
//
// Adicione ?detalhado=true pra incluir tambem a lista completa de pedidos
// com itens. Use so quando precisar do raw.
// ----------------------------------------------------------------

interface ItemPedido {
  descricao?: string | null;
  codigo?: string | null;
  quantidade?: number | null;
  unidade?: string | null;
  valor_unitario?: number | null;
  valor_total_item?: number | null;
}

const SITUACOES_VALIDAS = new Set(["Atendido", "Confirmado", "Entregue", "Em andamento", "Em aberto", "Em digitacao", "Verificado"]);
// Cancelados ficam de fora dos agregados (mas continuam visiveis em ?detalhado=true)

function diasAtras(date: Date): number {
  const ms = Date.now() - date.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function formatBR(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clienteId = searchParams.get("clienteId");
    const cnpjCpfRaw = searchParams.get("cnpjCpf");
    const telefoneRaw = searchParams.get("telefone");
    const detalhado = searchParams.get("detalhado") === "true";
    const limitRaw = searchParams.get("limit");
    const limit = Math.min(200, Math.max(1, parseInt(limitRaw || "100")));

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
        {
          encontrado: false,
          mensagem: "Cliente nao encontrado no dashboard.",
          texto_para_agente: "Cliente nao localizado na base. Trate como prospect — sem historico de compras conhecido.",
        },
        { status: 404 }
      );
    }

    // 2. Buscar historico de compras (todos)
    const pedidos = await prisma.historicoCompraBling.findMany({
      where: { clienteId: cliente.id },
      orderBy: { data: "desc" },
      take: limit,
    });

    const pedidosValidos = pedidos.filter((p) => !p.situacao || SITUACOES_VALIDAS.has(p.situacao));

    // ===== Sem pedidos
    if (pedidosValidos.length === 0) {
      const texto = `Cliente "${cliente.empresa}" (${cliente.segmento.toLowerCase()}), ainda sem historico de compras registrado no Bling. Trate como lead novo — pode abordar oferecendo os carros-chefe (polpas mais vendidas).`;
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
        resumo: {
          status: "novo",
          total_pedidos: 0,
          total_gasto: 0,
          ticket_medio: 0,
          ultima_compra: null,
          frequencia: null,
          tendencia_gasto: null,
          tendencia_produtos: { crescendo: [], caindo: [], novos: [], abandonados: [] },
          top_produtos: [],
          ultimo_sync: null,
        },
        texto_para_agente: texto,
        ...(detalhado ? { pedidos: [] } : {}),
      });
    }

    // ===== Calculos com pedidos validos =====
    const totalPedidos = pedidosValidos.length;
    const totalGasto = pedidosValidos.reduce((s, p) => s + (p.valorTotal ?? 0), 0);
    const ticketMedio = totalGasto / totalPedidos;

    // Ultimo pedido (mais recente)
    const ultimo = pedidosValidos[0]; // ja vem ordenado desc
    const diasUltimaCompra = diasAtras(ultimo.data);

    // Status baseado em dias desde ultima compra
    let status: "ativo" | "atencao" | "inativo";
    if (diasUltimaCompra <= 30) status = "ativo";
    else if (diasUltimaCompra <= 60) status = "atencao";
    else status = "inativo";

    // Frequencia: media de dias entre pedidos
    let mediaIntervalo: number | null = null;
    if (pedidosValidos.length >= 2) {
      const intervalos: number[] = [];
      for (let i = 1; i < pedidosValidos.length; i++) {
        const diff = Math.floor(
          (pedidosValidos[i - 1].data.getTime() - pedidosValidos[i].data.getTime()) /
            (1000 * 60 * 60 * 24)
        );
        if (diff > 0) intervalos.push(diff);
      }
      if (intervalos.length > 0) {
        mediaIntervalo = Math.round(intervalos.reduce((a, b) => a + b, 0) / intervalos.length);
      }
    }

    // Tendencia: comparar valor dos ultimos 90 dias vs 90 dias anteriores
    const agora = Date.now();
    const limite90 = new Date(agora - 90 * 24 * 60 * 60 * 1000);
    const limite180 = new Date(agora - 180 * 24 * 60 * 60 * 1000);

    const ultimo90 = pedidosValidos.filter((p) => p.data >= limite90);
    const anterior90 = pedidosValidos.filter((p) => p.data >= limite180 && p.data < limite90);

    const valorUltimo90 = ultimo90.reduce((s, p) => s + (p.valorTotal ?? 0), 0);
    const valorAnterior90 = anterior90.reduce((s, p) => s + (p.valorTotal ?? 0), 0);

    let tendencia: {
      ultimo_periodo: number;
      periodo_anterior: number;
      variacao_percentual: number | null;
      descricao: "crescente" | "estavel" | "decrescente" | "inicio";
    } | null = null;

    if (valorAnterior90 === 0 && valorUltimo90 === 0) {
      tendencia = null;
    } else if (valorAnterior90 === 0) {
      tendencia = {
        ultimo_periodo: valorUltimo90,
        periodo_anterior: 0,
        variacao_percentual: null,
        descricao: "inicio",
      };
    } else {
      const variacao = ((valorUltimo90 - valorAnterior90) / valorAnterior90) * 100;
      let descricao: "crescente" | "estavel" | "decrescente";
      if (variacao > 20) descricao = "crescente";
      else if (variacao < -20) descricao = "decrescente";
      else descricao = "estavel";
      tendencia = {
        ultimo_periodo: parseFloat(valorUltimo90.toFixed(2)),
        periodo_anterior: parseFloat(valorAnterior90.toFixed(2)),
        variacao_percentual: parseFloat(variacao.toFixed(1)),
        descricao,
      };
    }

    // Top produtos (agrega itens de todos pedidos validos)
    const produtoStats = new Map<
      string,
      { descricao: string; quantidade: number; valor_total: number; ocorrencias: number }
    >();
    for (const p of pedidosValidos) {
      const itens = (Array.isArray(p.itens) ? p.itens : []) as ItemPedido[];
      for (const it of itens) {
        const key = (it.descricao ?? "(sem descricao)").trim();
        const cur = produtoStats.get(key) ?? {
          descricao: key,
          quantidade: 0,
          valor_total: 0,
          ocorrencias: 0,
        };
        cur.quantidade += Number(it.quantidade ?? 0);
        cur.valor_total += Number(it.valor_total_item ?? 0);
        cur.ocorrencias += 1;
        produtoStats.set(key, cur);
      }
    }
    const topProdutos = Array.from(produtoStats.values())
      .sort((a, b) => b.quantidade - a.quantidade)
      .slice(0, 5)
      .map((p) => ({
        ...p,
        quantidade: parseFloat(p.quantidade.toFixed(2)),
        valor_total: parseFloat(p.valor_total.toFixed(2)),
      }));

    // ===== Tendencia de produtos: comparar ultimos 90 dias vs 90 anteriores =====
    function agregaItens(periodoPedidos: typeof pedidosValidos) {
      const mapa = new Map<string, { qtd: number; valor: number; pedidos: number }>();
      for (const p of periodoPedidos) {
        const itens = (Array.isArray(p.itens) ? p.itens : []) as ItemPedido[];
        for (const it of itens) {
          const key = (it.descricao ?? "(sem descricao)").trim();
          const cur = mapa.get(key) ?? { qtd: 0, valor: 0, pedidos: 0 };
          cur.qtd += Number(it.quantidade ?? 0);
          cur.valor += Number(it.valor_total_item ?? 0);
          cur.pedidos += 1;
          mapa.set(key, cur);
        }
      }
      return mapa;
    }

    const produtosRecente = agregaItens(ultimo90);
    const produtosAnterior = agregaItens(anterior90);

    type TendItem = { descricao: string; qtd: number; qtd_anterior: number; variacao_percentual: number | null };

    const crescendo: TendItem[] = [];
    const caindo: TendItem[] = [];
    const novos: TendItem[] = [];
    const abandonados: TendItem[] = [];

    // Crescendo / caindo / novos
    for (const [desc, recente] of produtosRecente) {
      const anterior = produtosAnterior.get(desc);
      if (!anterior || anterior.qtd === 0) {
        if (recente.qtd > 0) {
          novos.push({ descricao: desc, qtd: recente.qtd, qtd_anterior: 0, variacao_percentual: null });
        }
        continue;
      }
      const variacao = ((recente.qtd - anterior.qtd) / anterior.qtd) * 100;
      const item: TendItem = {
        descricao: desc,
        qtd: parseFloat(recente.qtd.toFixed(2)),
        qtd_anterior: parseFloat(anterior.qtd.toFixed(2)),
        variacao_percentual: parseFloat(variacao.toFixed(1)),
      };
      if (variacao > 30) crescendo.push(item);
      else if (variacao < -30) caindo.push(item);
    }

    // Abandonados (existiu antes, sumiu agora)
    for (const [desc, anterior] of produtosAnterior) {
      if (!produtosRecente.has(desc) && anterior.qtd > 0) {
        abandonados.push({
          descricao: desc,
          qtd: 0,
          qtd_anterior: parseFloat(anterior.qtd.toFixed(2)),
          variacao_percentual: -100,
        });
      }
    }

    // Sort por relevancia
    crescendo.sort((a, b) => (b.variacao_percentual ?? 0) - (a.variacao_percentual ?? 0));
    caindo.sort((a, b) => (a.variacao_percentual ?? 0) - (b.variacao_percentual ?? 0));
    novos.sort((a, b) => b.qtd - a.qtd);
    abandonados.sort((a, b) => b.qtd_anterior - a.qtd_anterior);

    const tendenciaProdutos = {
      crescendo: crescendo.slice(0, 3),
      caindo: caindo.slice(0, 3),
      novos: novos.slice(0, 3),
      abandonados: abandonados.slice(0, 3),
    };

    const ultimoSync = pedidos
      .map((p) => p.syncedAt)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    // ===== Texto natural pra IA =====
    const partes: string[] = [];
    partes.push(
      `Cliente "${cliente.empresa}" (${cliente.segmento.toLowerCase()}), status ${status}.`
    );

    partes.push(
      `${totalPedidos} pedido(s) totalizando ${formatBR(totalGasto)}, ticket medio ${formatBR(ticketMedio)}.`
    );

    if (mediaIntervalo) {
      partes.push(`Compra aproximadamente a cada ${mediaIntervalo} dias.`);
    }

    partes.push(
      `Ultima compra ha ${diasUltimaCompra} dia(s) (${formatBR(ultimo.valorTotal ?? 0)}).`
    );

    if (topProdutos.length > 0) {
      const topTxt = topProdutos
        .slice(0, 3)
        .map((p) => `${p.descricao} (${p.quantidade} un)`)
        .join(", ");
      partes.push(`Produtos favoritos: ${topTxt}.`);
    }

    // === Tendencia de compra (produtos): comparar ultimos 90 vs anteriores ===
    const temBaseDeComparacao = anterior90.length > 0;

    if (!temBaseDeComparacao && ultimo90.length > 0) {
      partes.push(`Cliente novo no Bling — sem base de comparacao de 90 dias ainda.`);
    } else if (tendenciaProdutos.crescendo.length > 0) {
      const lista = tendenciaProdutos.crescendo
        .slice(0, 2)
        .map((p) => `${p.descricao} (+${p.variacao_percentual}%, ${p.qtd} un vs ${p.qtd_anterior})`)
        .join("; ");
      partes.push(`Comprando MAIS: ${lista}.`);
    }

    if (tendenciaProdutos.novos.length > 0) {
      const lista = tendenciaProdutos.novos
        .slice(0, 2)
        .map((p) => `${p.descricao} (${p.qtd} un)`)
        .join("; ");
      partes.push(`Comecou a comprar recentemente: ${lista}.`);
    }

    if (tendenciaProdutos.caindo.length > 0) {
      const lista = tendenciaProdutos.caindo
        .slice(0, 2)
        .map((p) => `${p.descricao} (${p.variacao_percentual}%, ${p.qtd} un vs ${p.qtd_anterior})`)
        .join("; ");
      partes.push(`Comprando MENOS: ${lista}.`);
    }

    if (tendenciaProdutos.abandonados.length > 0 && tendenciaProdutos.abandonados[0].qtd_anterior >= 3) {
      const lista = tendenciaProdutos.abandonados
        .slice(0, 2)
        .filter((p) => p.qtd_anterior >= 3)
        .map((p) => `${p.descricao} (era ${p.qtd_anterior} un)`)
        .join("; ");
      if (lista) partes.push(`Parou de comprar: ${lista}.`);
    }

    // Resumo geral de gasto (tendencia financeira) — sinaliza saude da conta
    if (tendencia) {
      if (tendencia.descricao === "crescente") {
        partes.push(
          `No total, gastou ${tendencia.variacao_percentual}% mais nos ultimos 90 dias (R$ ${tendencia.ultimo_periodo.toFixed(2)} vs R$ ${tendencia.periodo_anterior.toFixed(2)}).`
        );
      } else if (tendencia.descricao === "decrescente") {
        partes.push(
          `ATENCAO: gasto total caiu ${Math.abs(tendencia.variacao_percentual ?? 0)}% nos ultimos 90 dias (R$ ${tendencia.ultimo_periodo.toFixed(2)} vs R$ ${tendencia.periodo_anterior.toFixed(2)}).`
        );
      } else if (tendencia.descricao === "estavel") {
        partes.push(`Gasto total estavel (~R$ ${tendencia.ultimo_periodo.toFixed(2)} nos ultimos 90 dias).`);
      }
    }

    if (status === "inativo") {
      partes.push(`Lead frio — bom alvo de reativacao com oferta especial.`);
    } else if (status === "atencao") {
      partes.push(`Risco de perda — convem follow-up logo.`);
    }

    const textoParaAgente = partes.join(" ");

    // ===== Response =====
    const payload: Record<string, unknown> = {
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
      resumo: {
        status,
        total_pedidos: totalPedidos,
        total_gasto: parseFloat(totalGasto.toFixed(2)),
        ticket_medio: parseFloat(ticketMedio.toFixed(2)),
        ultima_compra: {
          data: ultimo.data.toISOString().slice(0, 10),
          dias_atras: diasUltimaCompra,
          valor: parseFloat((ultimo.valorTotal ?? 0).toFixed(2)),
          numero_pedido: ultimo.numeroPedido,
          situacao: ultimo.situacao,
        },
        frequencia: mediaIntervalo
          ? {
              dias_entre_compras: mediaIntervalo,
              descricao: `compra aproximadamente a cada ${mediaIntervalo} dias`,
            }
          : null,
        tendencia_gasto: tendencia,
        tendencia_produtos: tendenciaProdutos,
        top_produtos: topProdutos,
        ultimo_sync: ultimoSync.toISOString(),
      },
      texto_para_agente: textoParaAgente,
    };

    if (detalhado) {
      payload.pedidos = pedidos.map((p) => ({
        id: p.id,
        bling_pedido_id: p.blingPedidoId,
        numero_pedido: p.numeroPedido,
        data: p.data.toISOString().slice(0, 10),
        valor_total: p.valorTotal,
        situacao: p.situacao,
        itens: p.itens,
      }));
    }

    return Response.json(payload);
  } catch (error) {
    console.error("GET /api/leads/historico error:", error);
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    return Response.json({ error: msg }, { status: 500 });
  }
}

// ----------------------------------------------------------------
// POST /api/leads/historico (sem alteracoes — sync vindo do n8n)
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
