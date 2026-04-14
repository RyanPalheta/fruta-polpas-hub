import { prisma } from "@/lib/prisma";
import { StatusDisparo } from "@/generated/prisma/client";
import { getInicioSemana } from "@/lib/utils";

export async function POST(_request: Request) {
  try {
    const semanaInicio = getInicioSemana();
    const semanaFim = new Date(semanaInicio);
    semanaFim.setDate(semanaFim.getDate() + 6);

    // Find all disparos for the current week
    const disparos = await prisma.disparo.findMany({
      where: { semanaInicio },
    });

    if (disparos.length === 0) {
      return Response.json(
        { error: "Nenhum disparo encontrado para esta semana" },
        { status: 400 }
      );
    }

    // DISPARADO with no response -> NAO_RESPONDEU
    const disparadosSemResposta = disparos.filter(
      (d) => d.status === StatusDisparo.DISPARADO
    );
    if (disparadosSemResposta.length > 0) {
      await prisma.disparo.updateMany({
        where: {
          semanaInicio,
          status: StatusDisparo.DISPARADO,
        },
        data: {
          status: StatusDisparo.NAO_RESPONDEU,
        },
      });
    }

    // RESPONDEU -> PEDIDO_NAO_REALIZADO
    const responderam = disparos.filter(
      (d) => d.status === StatusDisparo.RESPONDEU
    );
    if (responderam.length > 0) {
      await prisma.disparo.updateMany({
        where: {
          semanaInicio,
          status: StatusDisparo.RESPONDEU,
        },
        data: {
          status: StatusDisparo.PEDIDO_NAO_REALIZADO,
        },
      });
    }

    // Reload disparos after updates to compute stats
    const disparosAtualizados = await prisma.disparo.findMany({
      where: { semanaInicio },
    });

    const totalDisparados = disparosAtualizados.length;
    const totalResponderam = disparosAtualizados.filter(
      (d) =>
        d.status === StatusDisparo.PEDIDO_CONFIRMADO ||
        d.status === StatusDisparo.PEDIDO_NAO_REALIZADO
    ).length;
    const totalPedidos = disparosAtualizados.filter(
      (d) => d.status === StatusDisparo.PEDIDO_CONFIRMADO
    ).length;
    const totalNaoResponderam = disparosAtualizados.filter(
      (d) => d.status === StatusDisparo.NAO_RESPONDEU
    ).length;
    const totalValor = disparosAtualizados.reduce(
      (sum, d) => sum + (d.valorPedido || 0),
      0
    );

    // Create or update CicloSemanal
    const ciclo = await prisma.cicloSemanal.upsert({
      where: { semanaInicio },
      create: {
        semanaInicio,
        semanaFim,
        totalDisparados,
        totalResponderam,
        totalPedidos,
        totalNaoResponderam,
        totalValor,
        marcoZeroExecutado: true,
      },
      update: {
        totalDisparados,
        totalResponderam,
        totalPedidos,
        totalNaoResponderam,
        totalValor,
        marcoZeroExecutado: true,
      },
    });

    return Response.json({
      message: "Marco Zero executado com sucesso",
      ciclo,
      resumo: {
        naoRespondeuAtualizado: disparadosSemResposta.length,
        pedidoNaoRealizadoAtualizado: responderam.length,
      },
    });
  } catch (error) {
    console.error("POST /api/disparos/marco-zero error:", error);
    return Response.json({ error: "Erro ao executar Marco Zero" }, { status: 500 });
  }
}
