import { executarDisparos } from "@/lib/executar-disparos";

/**
 * Cron endpoint — called automatically by Vercel Cron Jobs (vercel.json)
 * or by an external scheduler like n8n.
 *
 * Vercel automatically passes:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * n8n / external callers must also pass this header.
 * Set CRON_SECRET in Vercel environment variables.
 */
export async function GET(request: Request) {
  // Verify secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "").trim();
    if (token !== cronSecret) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    console.log("[cron/disparar] Executando disparos automáticos...");
    const result = await executarDisparos();
    console.log("[cron/disparar] Resultado:", result);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/disparar] Erro:", error);
    return Response.json({ error: "Erro ao executar disparos automáticos" }, { status: 500 });
  }
}
