import { prisma } from "@/lib/prisma";
import { Segmento } from "@/generated/prisma/client";
import { ordenarDias, parseDiasDisparo } from "@/lib/utils";

// PATCH /api/clientes/bulk
// Body: { ids: string[], action: string, value?: string }
// Acoes: diasDisparo | adicionarDia | removerDia | responsavel | segmento
//        | ativar | desativar | deletar
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
      // Substitui os dias: aceita "SEGUNDA" ou "SEGUNDA,QUARTA".
      case "diasDisparo": {
        const dias = parseDiasDisparo(value);
        if (dias.length === 0) {
          return Response.json({ error: "Dia inválido" }, { status: 400 });
        }
        const result = await prisma.cliente.updateMany({
          where: { id: { in: ids } },
          data: { diasDisparo: dias },
        });
        count = result.count;
        break;
      }

      // Acrescenta/remove um dia preservando os demais. Como cada cliente tem
      // uma lista propria, precisa ser um update por cliente.
      case "adicionarDia":
      case "removerDia": {
        const [dia] = parseDiasDisparo(value);
        if (!dia) {
          return Response.json({ error: "Dia inválido" }, { status: 400 });
        }

        const clientes = await prisma.cliente.findMany({
          where: { id: { in: ids } },
          select: { id: true, diasDisparo: true },
        });

        const alteracoes = clientes
          .map((cliente) => {
            const atuais = cliente.diasDisparo;
            const novos =
              action === "adicionarDia"
                ? ordenarDias([...atuais, dia])
                : atuais.filter((d) => d !== dia);
            return { cliente, novos };
          })
          .filter(({ cliente, novos }) => novos.length !== cliente.diasDisparo.length);

        await prisma.$transaction(
          alteracoes.map(({ cliente, novos }) =>
            prisma.cliente.update({
              where: { id: cliente.id },
              data: { diasDisparo: novos },
            })
          )
        );
        count = alteracoes.length;
        break;
      }

      // Valor vazio limpa o responsavel.
      case "responsavel": {
        const result = await prisma.cliente.updateMany({
          where: { id: { in: ids } },
          data: { responsavel: value?.trim() || null },
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
