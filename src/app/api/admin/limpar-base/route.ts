import { prisma } from "@/lib/prisma";

/**
 * Limpeza da base. Nao tem volta, entao a rota exige que o escopo e a palavra
 * de confirmacao venham no corpo — clique errado nao apaga nada.
 *
 * As configuracoes (token da Kommo, horarios) ficam sempre de fora: elas nao
 * sao "base de dados" no sentido que o usuario quer zerar, e perde-las
 * quebraria a integracao.
 */

/** O que cada escopo apaga. */
const ESCOPOS = {
  clientes: "Clientes (leva junto disparos e histórico de compras)",
  disparos: "Disparos e ciclos semanais",
  historico: "Histórico de compras do Bling",
  tudo: "Tudo: clientes, disparos, ciclos e histórico",
} as const;

type Escopo = keyof typeof ESCOPOS;

/** Frase que precisa ser digitada pra confirmar. */
const CONFIRMACAO = "APAGAR";

async function contagens() {
  const [clientes, disparos, ciclos, historico] = await Promise.all([
    prisma.cliente.count(),
    prisma.disparo.count(),
    prisma.cicloSemanal.count(),
    prisma.historicoCompraBling.count(),
  ]);
  return { clientes, disparos, ciclos, historico };
}

/** GET — quanto tem em cada tabela, pra tela mostrar o que sera perdido. */
export async function GET() {
  try {
    return Response.json({ confirmacao: CONFIRMACAO, escopos: ESCOPOS, total: await contagens() });
  } catch (error) {
    console.error("GET /api/admin/limpar-base error:", error);
    return Response.json({ error: "Erro ao contar registros" }, { status: 500 });
  }
}

/** POST — body: { escopo: "clientes" | "disparos" | "historico" | "tudo", confirmacao: "APAGAR" } */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const escopo = body?.escopo as Escopo | undefined;
    const confirmacao = String(body?.confirmacao ?? "").trim().toUpperCase();

    if (!escopo || !(escopo in ESCOPOS)) {
      return Response.json(
        { error: `Escopo inválido. Use um destes: ${Object.keys(ESCOPOS).join(", ")}.` },
        { status: 400 }
      );
    }

    if (confirmacao !== CONFIRMACAO) {
      return Response.json(
        { error: `Digite ${CONFIRMACAO} para confirmar a exclusão.` },
        { status: 400 }
      );
    }

    const antes = await contagens();

    // A ordem importa: filho antes de pai, mesmo com o cascade do Prisma, pra
    // que a contagem apagada saia certa e nao dependa do banco.
    const apagado = { clientes: 0, disparos: 0, ciclos: 0, historico: 0 };

    await prisma.$transaction(async (tx) => {
      if (escopo === "historico" || escopo === "clientes" || escopo === "tudo") {
        apagado.historico = (await tx.historicoCompraBling.deleteMany({})).count;
      }
      if (escopo === "disparos" || escopo === "clientes" || escopo === "tudo") {
        apagado.disparos = (await tx.disparo.deleteMany({})).count;
      }
      if (escopo === "disparos" || escopo === "tudo") {
        apagado.ciclos = (await tx.cicloSemanal.deleteMany({})).count;
      }
      if (escopo === "clientes" || escopo === "tudo") {
        apagado.clientes = (await tx.cliente.deleteMany({})).count;
      }
    });

    console.warn(`[limpar-base] escopo="${escopo}" apagado=${JSON.stringify(apagado)}`);

    return Response.json({ success: true, escopo, antes, apagado, total: await contagens() });
  } catch (error) {
    console.error("POST /api/admin/limpar-base error:", error);
    return Response.json({ error: "Erro ao limpar a base" }, { status: 500 });
  }
}
