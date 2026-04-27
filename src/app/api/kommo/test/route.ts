import { prisma } from "@/lib/prisma";

/**
 * Diagnostic endpoint — tests KOMMO connectivity step by step.
 * GET /api/kommo/test
 * GET /api/kommo/test?leadId=77258490&pipelineId=13451647&statusId=104234595
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const leadId = searchParams.get("leadId");
  const pipelineId = searchParams.get("pipelineId");
  const statusId = searchParams.get("statusId");

  const config = await prisma.configuracao.findUnique({ where: { id: "default" } });

  if (!config?.kommoToken || !config?.kommoSubdomain) {
    return Response.json({ error: "KOMMO não configurado" }, { status: 400 });
  }

  const cleanToken = config.kommoToken.replace(/[^\x20-\x7E]/g, "").trim();
  const baseUrl = `https://${config.kommoSubdomain}.kommo.com`;

  const headers = {
    Authorization: `Bearer ${cleanToken}`,
    "Content-Type": "application/json",
  };

  const results: Record<string, unknown> = {
    subdomain: config.kommoSubdomain,
    tokenLength: cleanToken.length,
    tokenPrefix: cleanToken.slice(0, 20) + "...",
  };

  // Step 1: GET /api/v4/account — basic auth check
  try {
    const r = await fetch(`${baseUrl}/api/v4/account`, { headers });
    const body = await r.text();
    results.account = { status: r.status, ok: r.ok, body: body.slice(0, 300) };
  } catch (e) {
    results.account = { error: String(e) };
  }

  // Step 2: GET /api/v4/leads?limit=1 — can we read leads?
  try {
    const r = await fetch(`${baseUrl}/api/v4/leads?limit=1`, { headers });
    const body = await r.text();
    results.leadsRead = { status: r.status, ok: r.ok, body: body.slice(0, 300) };
  } catch (e) {
    results.leadsRead = { error: String(e) };
  }

  // Step 3: If leadId provided — try PATCH to move to status
  if (leadId && pipelineId && statusId) {
    try {
      const r = await fetch(`${baseUrl}/api/v4/leads`, {
        method: "PATCH",
        headers,
        body: JSON.stringify([
          {
            id: parseInt(leadId),
            pipeline_id: parseInt(pipelineId),
            status_id: parseInt(statusId),
          },
        ]),
      });
      const body = await r.text();
      results.moveLeadStatus = { status: r.status, ok: r.ok, body: body.slice(0, 500) };
    } catch (e) {
      results.moveLeadStatus = { error: String(e) };
    }
  }

  // Step 4: GET pipelines — check if pipeline IDs are visible
  try {
    const r = await fetch(`${baseUrl}/api/v4/leads/pipelines`, { headers });
    const body = await r.text();
    let parsed: unknown = body.slice(0, 500);
    try { parsed = JSON.parse(body); } catch { /* keep raw */ }
    results.pipelines = { status: r.status, ok: r.ok, body: parsed };
  } catch (e) {
    results.pipelines = { error: String(e) };
  }

  return Response.json(results, { status: 200 });
}
