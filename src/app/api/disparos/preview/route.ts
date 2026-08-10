import { DiaSemana, Segmento } from "@/generated/prisma/client";
import { listarClientesParaDisparo, type FiltroDisparo } from "@/lib/executar-disparos";

/**
 * GET /api/disparos/preview?dias=SEGUNDA,QUARTA&segmentos=RESTAURANTE&responsaveis=Ana&busca=hotel
 *
 * Mostra exatamente quem receberia o disparo com esses filtros, sem disparar nada.
 * Quem cai em mais de um dos dias pedidos aparece uma vez so.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // `dia` (singular) continua aceito para nao quebrar chamadas antigas.
    const dias = (searchParams.get("dias") ?? searchParams.get("dia") ?? "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

    const diaInvalido = dias.find((d) => !Object.values(DiaSemana).includes(d as DiaSemana));
    if (diaInvalido) {
      return Response.json({ error: `Dia invalido: ${diaInvalido}` }, { status: 400 });
    }

    const segmentos = (searchParams.get("segmentos") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const segmentoInvalido = segmentos.find(
      (s) => !Object.values(Segmento).includes(s as Segmento)
    );
    if (segmentoInvalido) {
      return Response.json({ error: `Segmento invalido: ${segmentoInvalido}` }, { status: 400 });
    }

    const responsaveis = (searchParams.get("responsaveis") || "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);

    const filtro: FiltroDisparo = {
      dias: dias.length ? (dias as DiaSemana[]) : undefined,
      segmentos: segmentos.length ? (segmentos as Segmento[]) : undefined,
      responsaveis: responsaveis.length ? responsaveis : undefined,
      busca: searchParams.get("busca") || undefined,
      incluirInativos: searchParams.get("incluirInativos") === "true",
    };

    const {
      dias: diasResolvidos,
      semanaInicio,
      clientes,
      kommo,
    } = await listarClientesParaDisparo(filtro);

    return Response.json({
      dias: diasResolvidos,
      semanaInicio,
      total: clientes.length,
      jaDisparados: clientes.filter((c) => c.jaDisparado).length,
      /** Ja receberam, nao deram retorno e a KOMMO libera — publico do reenvio. */
      reenviaveis: clientes.filter((c) => c.reenvio && c.bloqueioKommo == null).length,
      bloqueadosKommo: clientes.filter((c) => c.bloqueioKommo != null).length,
      kommo,
      clientes,
    });
  } catch (error) {
    console.error("GET /api/disparos/preview error:", error);
    return Response.json({ error: "Erro ao montar previa do disparo" }, { status: 500 });
  }
}
