const SERVER = process.env.UAZAPI_SERVER!;
const TOKEN = process.env.UAZAPI_TOKEN!;

function uazapiHeaders() {
  return { token: TOKEN, "Content-Type": "application/json" };
}

// GET /api/conexao → status da instância
export async function GET() {
  try {
    const res = await fetch(`${SERVER}/instance/status`, {
      headers: uazapiHeaders(),
      cache: "no-store",
    });

    if (!res.ok) {
      return Response.json({ error: "Erro ao buscar status" }, { status: 502 });
    }

    const data = await res.json();

    return Response.json({
      connected: data.status?.connected ?? false,
      loggedIn: data.status?.loggedIn ?? false,
      status: data.instance?.status ?? "unknown",
      name: data.instance?.name ?? "",
      profileName: data.instance?.profileName ?? "",
      profilePicUrl: data.instance?.profilePicUrl ?? "",
      owner: data.instance?.owner ?? "",
      lastDisconnect: data.instance?.lastDisconnect ?? null,
      lastDisconnectReason: data.instance?.lastDisconnectReason ?? null,
      qrcode: data.instance?.qrcode ?? "",
    });
  } catch (err) {
    console.error("GET /api/conexao error:", err);
    return Response.json({ error: "Erro interno" }, { status: 500 });
  }
}

// POST /api/conexao → inicia conexão e retorna QR code
export async function POST() {
  try {
    const res = await fetch(`${SERVER}/instance/connect`, {
      method: "POST",
      headers: uazapiHeaders(),
      cache: "no-store",
    });

    if (!res.ok) {
      return Response.json({ error: "Erro ao conectar" }, { status: 502 });
    }

    const data = await res.json();

    return Response.json({
      connected: data.connected ?? false,
      status: data.instance?.status ?? "connecting",
      qrcode: data.instance?.qrcode ?? "",
      response: data.response ?? "",
    });
  } catch (err) {
    console.error("POST /api/conexao error:", err);
    return Response.json({ error: "Erro interno" }, { status: 500 });
  }
}
