import { configDoDisparo, rodarSalesbot } from "@/lib/kommo";

/**
 * Endpoint de teste — roda o SALESBOT num lead especifico da KOMMO.
 *
 * GET /api/kommo/test?lead_id=77258490
 *
 * ATENCAO: isto manda mensagem de verdade pro contato do lead. Por isso o
 * lead_id e obrigatorio — nao tem alvo padrao, pra ninguem disparar sem querer.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const leadId = Number(searchParams.get("lead_id"));

  if (!Number.isFinite(leadId) || leadId <= 0) {
    return Response.json(
      {
        error:
          "Informe lead_id: /api/kommo/test?lead_id=77258490. " +
          "O salesbot manda mensagem de verdade, entao nao existe alvo padrao.",
      },
      { status: 400 }
    );
  }

  try {
    const { botId } = await configDoDisparo();
    const botInformado = Number(searchParams.get("bot_id"));
    const bot = Number.isFinite(botInformado) && botInformado > 0 ? botInformado : botId;

    console.log(`[kommo/test] Rodando salesbot ${bot} no lead ${leadId}`);
    const resposta = await rodarSalesbot(leadId, bot);

    return Response.json({ ok: true, bot, lead_id: leadId, resposta });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[kommo/test] Erro:", msg);
    return Response.json({ ok: false, lead_id: leadId, erro: msg }, { status: 500 });
  }
}
