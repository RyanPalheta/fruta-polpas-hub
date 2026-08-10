import { executarDisparos, type DisparoResult } from "@/lib/executar-disparos";

/**
 * Cron endpoint — chamado pelo Vercel Cron (vercel.json) ou por um agendador
 * externo, tipo o n8n.
 *
 * A Vercel passa automaticamente:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Quem chamar de fora precisa mandar o mesmo header.
 */

/**
 * Segunda-feira tem centenas de clientes na fila e cada um custa de 1 a 3 idas
 * a KOMMO, espacadas pelo limitador. No tempo padrao de funcao nao dava nem um
 * lote decente — por isso o teto vai pro maximo. A plataforma corta pro que o
 * plano permitir, e o orcamento abaixo garante que a gente devolve antes.
 */
export const maxDuration = 300;

/** Clientes por lote. Cada um custa de 1 a 3 idas a KOMMO, ja espacadas. */
const TAMANHO_LOTE = 25;

/**
 * Quanto tempo o cron pode gastar antes de devolver. Fica bem abaixo do
 * maxDuration de proposito: o teste e feito ENTRE lotes, entao ainda cabe um
 * lote inteiro depois da ultima checagem sem estourar.
 */
const ORCAMENTO_MS = 200_000;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "").trim();
    if (token !== cronSecret) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const comeco = Date.now();

  try {
    console.log("[cron/disparar] Executando disparos automáticos...");

    let lotes = 0;
    let enviados = 0;
    let falhas = 0;
    let leadsCriados = 0;
    let ultimo: DisparoResult | null = null;

    // Vai em lotes ate acabar a fila ou o tempo. `pularJaDisparados` faz cada
    // lote continuar de onde o anterior parou, sem repetir mensagem.
    do {
      ultimo = await executarDisparos({
        limite: TAMANHO_LOTE,
        pularJaDisparados: true,
      });

      lotes++;
      enviados += ultimo.webhook.enviados;
      falhas += ultimo.webhook.falhas;
      leadsCriados += ultimo.leadsCriados;

      console.log(
        `[cron/disparar] lote ${lotes}: ${ultimo.webhook.enviados} enviado(s), ` +
          `${ultimo.webhook.falhas} falha(s), faltam ${ultimo.restantes}`
      );

      // Nao avancou nada: insistir so queima tempo e cota da KOMMO.
      if (ultimo.webhook.enviados === 0 && ultimo.webhook.falhas === 0) break;
    } while (!ultimo.concluido && Date.now() - comeco < ORCAMENTO_MS);

    const resposta = {
      ok: true,
      lotes,
      enviados,
      falhas,
      leadsCriados,
      restantes: ultimo?.restantes ?? 0,
      concluido: ultimo?.concluido ?? true,
      duracaoMs: Date.now() - comeco,
      message: ultimo?.message,
      kommo: ultimo?.kommo,
      ignorados: ultimo?.ignorados?.length ?? 0,
    };

    console.log("[cron/disparar] Resultado:", resposta);
    return Response.json(resposta);
  } catch (error) {
    console.error("[cron/disparar] Erro:", error);
    return Response.json({ error: "Erro ao executar disparos automáticos" }, { status: 500 });
  }
}
