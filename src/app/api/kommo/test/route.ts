import { dispararLeadViaWebhook, WebhookDisparoPayload } from "@/lib/executar-disparos";

/**
 * Endpoint de teste — dispara um lead específico via webhook n8n.
 *
 * GET /api/kommo/test
 *   → usa o lead de teste padrão (Ryan ATLAS, lead_id=77258490)
 *
 * GET /api/kommo/test?lead_id=XXXXX&empresa=Nome&telefone=55...
 *   → usa os parâmetros informados
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const payload: WebhookDisparoPayload = {
    lead_id: parseInt(searchParams.get("lead_id") || "77258490"),
    empresa: searchParams.get("empresa") || "Ryan ATLAS - TESTE",
    telefone: searchParams.get("telefone") || "559285460332",
    cliente_id: searchParams.get("cliente_id") || "teste",
  };

  console.log("[kommo/test] Enviando payload de teste:", payload);

  try {
    const resposta = await dispararLeadViaWebhook(payload);
    return Response.json({
      ok: true,
      payload_enviado: payload,
      resposta_n8n: resposta,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[kommo/test] Erro:", msg);
    return Response.json({
      ok: false,
      payload_enviado: payload,
      erro: msg,
    }, { status: 500 });
  }
}
