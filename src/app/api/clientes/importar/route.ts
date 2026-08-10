import { prisma } from "@/lib/prisma";
import {
  ErroPlanilha,
  lerCarteira,
  mesclarComExistente,
  separarNovos,
  tagDaCarteira,
  type RegistroCarteira,
} from "@/lib/importar-carteira";

/** Quantas linhas de exemplo/erro vao na resposta — o resto vira contagem. */
const LIMITE_AMOSTRA = 10;
const LIMITE_LISTAS = 200;

/** O que fazer com quem a planilha reencontrou. */
type ModoDuplicata = "ignorar" | "atualizar";

function contar(valores: readonly string[]): Record<string, number> {
  const mapa: Record<string, number> = {};
  for (const valor of valores) mapa[valor] = (mapa[valor] ?? 0) + 1;
  return mapa;
}

function paraAmostra(registro: RegistroCarteira, responsavelPadrao: string | null) {
  return {
    linha: registro.linha,
    empresa: registro.empresa,
    contatoWhatsapp: registro.contatoWhatsapp,
    diasDisparo: registro.diasDisparo,
    segmento: registro.segmento,
    segmentoInferido: registro.segmentoInferido,
    cidade: registro.cidade,
    uf: registro.uf,
    responsavel: registro.responsavel ?? responsavelPadrao,
  };
}

/**
 * Importa uma carteira de disparo.
 *
 * multipart/form-data:
 *   file         planilha .xlsx/.xls/.csv (obrigatorio)
 *   modo         "preview" (padrao, so analisa) ou "aplicar" (grava)
 *   responsavel  quem fica com a carteira; vazio usa o "RESPONSAVEL: X" da planilha
 *   aba          nome da aba; vazio usa a primeira
 *   tag          tag do lote; mande "" pra nao marcar nenhuma
 *   duplicatas   "ignorar" (padrao) ou "atualizar" o cadastro que ja existe
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return Response.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
    }

    const aplicar = formData.get("modo") === "aplicar";
    const abaInformada = (formData.get("aba") ?? "").toString().trim();
    const responsavelInformado = (formData.get("responsavel") ?? "").toString().trim();
    const duplicatas: ModoDuplicata =
      formData.get("duplicatas") === "atualizar" ? "atualizar" : "ignorar";

    const leitura = lerCarteira(Buffer.from(await file.arrayBuffer()), {
      aba: abaInformada || undefined,
    });

    const responsavel = responsavelInformado || leitura.responsavelPlanilha?.trim() || null;

    // Campo ausente = tag padrao; campo presente e vazio = sem tag nenhuma.
    const tagInformada = formData.get("tag");
    const tag =
      tagInformada === null ? tagDaCarteira(responsavel) : tagInformada.toString().trim() || null;

    const existentes = await prisma.cliente.findMany({
      select: {
        id: true,
        empresa: true,
        contatoWhatsapp: true,
        cnpjCpf: true,
        cidade: true,
        uf: true,
        responsavel: true,
        diasDisparo: true,
        tags: true,
      },
    });
    const { novos, conflitos } = separarNovos(leitura.registros, existentes);

    // Duas linhas diferentes podem cair no mesmo cadastro (uma pelo telefone,
    // outra pelo nome). Na hora de atualizar, vale a primeira.
    const porCadastro = new Map<string, (typeof conflitos)[number]>();
    for (const conflito of conflitos) {
      if (!porCadastro.has(conflito.existente.id)) porCadastro.set(conflito.existente.id, conflito);
    }

    const mesclagens = [...porCadastro.values()]
      .map((conflito) => ({
        conflito,
        mudancas: mesclarComExistente(conflito.existente, conflito.registro, {
          responsavelPadrao: responsavel,
          tag,
        }),
      }))
      .filter((m) => m.mudancas !== null);

    const analise = {
      aba: leitura.aba,
      linhaCabecalho: leitura.linhaCabecalho,
      colunas: leitura.colunas,
      responsavelPlanilha: leitura.responsavelPlanilha,
      responsavel,
      tag,
      duplicatas,
      totalLinhas: leitura.totalLinhas,
      novos: novos.length,
      jaCadastrados: conflitos.length,
      /** Quantos desses cadastros o modo "atualizar" completaria. */
      atualizaveis: mesclagens.length,
      descartados: leitura.descartadas.length,
      resumo: {
        porDia: contar(novos.map((r) => r.diasDisparo.join("+"))),
        porSegmento: contar(novos.map((r) => r.segmento)),
        porCidade: contar(novos.map((r) => r.cidade ?? "—")),
        porCriterioDuplicata: contar(conflitos.map((c) => c.criterio)),
      },
      amostra: novos.slice(0, LIMITE_AMOSTRA).map((r) => paraAmostra(r, responsavel)),
      descartadas: leitura.descartadas.slice(0, LIMITE_LISTAS),
      conflitos: conflitos.slice(0, LIMITE_LISTAS).map((c) => ({
        linha: c.linha,
        empresa: c.empresa,
        contatoWhatsapp: c.contatoWhatsapp,
        criterio: c.criterio,
        jaCadastradoComo: c.existente.empresa,
        responsavelAtual: c.existente.responsavel,
      })),
    };

    if (!aplicar) {
      return Response.json({ modo: "preview", created: 0, atualizados: 0, ...analise });
    }

    let created = 0;
    if (novos.length > 0) {
      const resultado = await prisma.cliente.createMany({
        data: novos.map((r) => ({
          empresa: r.empresa,
          contatoWhatsapp: r.contatoWhatsapp,
          segmento: r.segmento,
          diasDisparo: r.diasDisparo,
          // A coluna da linha, quando existe, ganha do responsavel do lote.
          responsavel: r.responsavel ?? responsavel,
          cidade: r.cidade,
          uf: r.uf,
          cnpjCpf: r.cnpjCpf,
          tags: tag ? [tag] : [],
        })),
      });
      created = resultado.count;
    }

    let atualizados = 0;
    if (duplicatas === "atualizar" && mesclagens.length > 0) {
      await prisma.$transaction(
        mesclagens.map(({ conflito, mudancas }) =>
          prisma.cliente.update({
            where: { id: conflito.existente.id },
            data: mudancas!,
          })
        )
      );
      atualizados = mesclagens.length;
    }

    return Response.json({ modo: "aplicar", created, atualizados, ...analise });
  } catch (error) {
    if (error instanceof ErroPlanilha) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("POST /api/clientes/importar error:", error);
    return Response.json({ error: "Erro ao importar clientes" }, { status: 500 });
  }
}
