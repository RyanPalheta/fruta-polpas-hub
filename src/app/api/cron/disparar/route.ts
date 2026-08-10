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
 * Quanto tempo o cron pode gastar antes de devolver. Fica abaixo do
 * maxDuration de proposito: o teste e feito ENTRE lotes, entao ainda cabe um
 * lote inteiro depois da ultima checagem sem estourar.
 */
const ORCAMENTO_MS = 220_000;

/**
 * Quantas vezes o cron pode se rechamar pra terminar a fila.
 *
 * Uma segunda-feira cheia sao ~550 clientes. Como quase nenhum tem lead em
 * cache, cada um custa busca + criacao + salesbot: da perto de 1000 idas a
 * KOMMO, e o limitador de 4/s sozinho ja impoe ~245s. Nao cabe numa funcao so,
 * por mais que se otimize — entao, em vez de truncar em silencio deixando
 * gente sem receber, cada invocacao gasta seu orcamento e passa o bastao.
 *
 * 6 saltos x 220s cobre com folga o pior dia. O contador existe pra que um
 * defeito qualquer nao vire uma corrente infinita.
 */
const MAX_SALTOS = 6;

/**
 * Chama o proximo salto e devolve sem esperar ele terminar.
 *
 * Esperar a resposta nao e opcao: o proximo salto leva minutos e este aqui
 * seria cortado antes. Basta a requisicao sair — dai a invocacao seguinte roda
 * por conta propria. Os 3s sao so pra garantir que ela saiu antes da gente
 * devolver e a plataforma congelar esta instancia.
 */
async function chamarProximoSalto(request: Request, salto: number): Promise<boolean> {
  const url = new URL(request.url);
  url.searchParams.set("salto", String(salto));

  const headers: Record<string, string> = {};
  const segredo = process.env.CRON_SECRET;
  if (segredo) headers.Authorization = `Bearer ${segredo}`;

  try {
    await Promise.race([
      fetch(url.toString(), { headers }),
      new Promise((r) => setTimeout(r, 3_000)),
    ]);
    console.log(`[cron/disparar] salto ${salto} disparado`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cron/disparar] nao consegui chamar o salto ${salto}: ${msg}`);
    return false;
  }
}

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
  const salto = Number(new URL(request.url).searchParams.get("salto") ?? 0);

  try {
    console.log(`[cron/disparar] Executando disparos automáticos (salto ${salto})...`);

    let lotes = 0;
    let enviados = 0;
    let falhas = 0;
    let leadsCriados = 0;
    let ultimo: DisparoResult | null = null;

    // Vai em lotes ate acabar a fila ou o tempo. `pularJaDisparados` faz cada
    // lote continuar de onde o anterior parou, sem repetir mensagem — e e o
    // mesmo mecanismo que deixa o proximo salto retomar daqui.
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

    // Sobrou fila e este salto realmente andou: passa o bastao. Exigir o
    // progresso evita que uma parada seca (KOMMO fora, fila travada) vire uma
    // corrente de saltos que nao fazem nada.
    const progrediu = enviados + falhas > 0;
    const restantes = ultimo?.restantes ?? 0;
    const precisaContinuar = !ultimo?.concluido && restantes > 0;

    let proximoSalto: number | null = null;
    if (precisaContinuar && progrediu && salto + 1 < MAX_SALTOS) {
      if (await chamarProximoSalto(request, salto + 1)) {
        proximoSalto = salto + 1;
      }
    } else if (precisaContinuar) {
      console.warn(
        `[cron/disparar] parando com ${restantes} cliente(s) na fila ` +
          `(salto ${salto}/${MAX_SALTOS}, progrediu=${progrediu})`
      );
    }

    const resposta = {
      ok: true,
      salto,
      lotes,
      enviados,
      falhas,
      leadsCriados,
      restantes,
      concluido: ultimo?.concluido ?? true,
      /** Numero do salto que vai continuar a fila, ou null quando acabou aqui. */
      proximoSalto,
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
