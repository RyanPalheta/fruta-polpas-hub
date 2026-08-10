import { prisma } from "@/lib/prisma";
import { getInicioSemana } from "@/lib/utils";
import { executarDisparos, type FiltroDisparo } from "@/lib/executar-disparos";
import { DiaSemana, Segmento } from "@/generated/prisma/client";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const semanaParam = searchParams.get("semana");
    const semanaInicio = semanaParam ? new Date(semanaParam) : getInicioSemana();

    const disparos = await prisma.disparo.findMany({
      where: { semanaInicio },
      include: {
        cliente: {
          select: {
            id: true,
            empresa: true,
            contatoWhatsapp: true,
            segmento: true,
            diasDisparo: true,
            responsavel: true,
            cidade: true,
            uf: true,
          },
        },
      },
      orderBy: [{ status: "asc" }, { cliente: { empresa: "asc" } }],
    });

    const ciclo = await prisma.cicloSemanal.findUnique({ where: { semanaInicio } });

    return Response.json({ disparos, ciclo });
  } catch (error) {
    console.error("GET /api/disparos error:", error);
    return Response.json({ error: "Erro ao buscar disparos" }, { status: 500 });
  }
}

/**
 * O disparo pode levar minutos: cada cliente custa de 1 a 3 idas a KOMMO,
 * espacadas pelo limitador de taxa. Sem folga de tempo a funcao e cortada no
 * meio de um lote.
 */
export const maxDuration = 300;

/** Teto por chamada, mesmo que quem chamou peca mais. */
const LIMITE_MAXIMO_LOTE = 60;

/**
 * POST /api/disparos
 *
 * Body opcional: { dias?, segmentos?, responsaveis?, clienteIds?, busca?,
 * incluirInativos?, limite?, pularJaDisparados?, ignorarBloqueioKommo? }
 *
 * Sem body, dispara para todos os clientes ativos do dia de hoje.
 * Com `limite`, processa so um lote e devolve `restantes` — chame de novo ate
 * `concluido` virar true.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    // `dia` (singular) continua aceito para nao quebrar chamadas antigas.
    const dias: string[] = Array.isArray(body.dias)
      ? body.dias
      : body.dia
        ? [body.dia]
        : [];

    const diaInvalido = dias.find((d) => !Object.values(DiaSemana).includes(d as DiaSemana));
    if (diaInvalido) {
      return Response.json({ error: `Dia invalido: ${diaInvalido}` }, { status: 400 });
    }

    const segmentos: string[] = Array.isArray(body.segmentos) ? body.segmentos : [];
    const segmentoInvalido = segmentos.find(
      (s) => !Object.values(Segmento).includes(s as Segmento)
    );
    if (segmentoInvalido) {
      return Response.json({ error: `Segmento invalido: ${segmentoInvalido}` }, { status: 400 });
    }

    const clienteIds: string[] = Array.isArray(body.clienteIds) ? body.clienteIds : [];
    // Uma lista explicita porem vazia significa "o usuario nao marcou ninguem".
    // Sem essa guarda, o filtro seria ignorado e todo mundo do dia receberia.
    if (Array.isArray(body.clienteIds) && clienteIds.length === 0) {
      return Response.json({ error: "Nenhum cliente selecionado" }, { status: 400 });
    }

    const filtro: FiltroDisparo = {
      dias: dias.length ? (dias as DiaSemana[]) : undefined,
      segmentos: segmentos.length ? (segmentos as Segmento[]) : undefined,
      responsaveis: Array.isArray(body.responsaveis) && body.responsaveis.length
        ? body.responsaveis
        : undefined,
      clienteIds: clienteIds.length ? clienteIds : undefined,
      busca: typeof body.busca === "string" ? body.busca : undefined,
      incluirInativos: body.incluirInativos === true,
      // So passa por cima da checagem da KOMMO se quem chamou pediu na unha.
      ignorarBloqueioKommo: body.ignorarBloqueioKommo === true,
      limite: Number.isFinite(Number(body.limite)) && Number(body.limite) > 0
        ? Math.min(Number(body.limite), LIMITE_MAXIMO_LOTE)
        : undefined,
      pularJaDisparados: body.pularJaDisparados === true,
    };

    const result = await executarDisparos(filtro);
    return Response.json(result);
  } catch (error) {
    console.error("POST /api/disparos error:", error);
    return Response.json({ error: "Erro ao criar disparos" }, { status: 500 });
  }
}
