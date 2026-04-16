"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";

type Status = "loading" | "connected" | "connecting" | "disconnected" | "error";

interface InstanceData {
  connected: boolean;
  loggedIn: boolean;
  status: string;
  name: string;
  profileName: string;
  profilePicUrl: string;
  owner: string;
  lastDisconnect: string | null;
  lastDisconnectReason: string | null;
  qrcode: string;
}

function formatPhone(raw: string) {
  if (!raw) return "—";
  const d = raw.replace(/\D/g, "");
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  return `+${d}`;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function ConexaoPage() {
  const [pageStatus, setPageStatus] = useState<Status>("loading");
  const [data, setData] = useState<InstanceData | null>(null);
  const [qrcode, setQrcode] = useState<string>("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [pollCount, setPollCount] = useState(0);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/conexao", { cache: "no-store" });
      if (!res.ok) throw new Error("Erro ao buscar status");
      const d: InstanceData = await res.json();
      setData(d);

      if (d.connected && d.loggedIn) {
        setPageStatus("connected");
        setConnecting(false);
        setQrcode("");
      } else if (d.status === "connecting") {
        setPageStatus("connecting");
        if (d.qrcode) setQrcode(d.qrcode);
      } else {
        setPageStatus("disconnected");
      }
    } catch {
      setPageStatus("error");
      setError("Não foi possível conectar ao servidor UAZAPI.");
    }
  }, []);

  // Carrega status inicial
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Polling quando conectando
  useEffect(() => {
    if (pageStatus !== "connecting") return;
    const interval = setInterval(() => {
      setPollCount((c) => c + 1);
      fetchStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, [pageStatus, fetchStatus]);

  async function handleConnect() {
    setConnecting(true);
    setError("");
    setQrcode("");
    setPageStatus("connecting");

    try {
      const res = await fetch("/api/conexao", { method: "POST", cache: "no-store" });
      const d = await res.json();

      if (d.error) throw new Error(d.error);
      if (d.qrcode) setQrcode(d.qrcode);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao conectar.");
      setPageStatus("disconnected");
      setConnecting(false);
    }
  }

  return (
    <>
      {/* Header */}
      <div className="mb-10">
        <h2 className="text-4xl font-extrabold text-primary tracking-tight leading-none mb-2">
          Conexão WhatsApp
        </h2>
        <p className="text-on-surface-variant font-medium text-lg">
          Status da instância UAZAPI — Fruta Polpas
        </p>
      </div>

      <div className="max-w-2xl space-y-5">

        {/* Status Card */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-bold text-on-surface">Status da Instância</h3>
            <button
              onClick={fetchStatus}
              className="p-1.5 rounded-lg hover:bg-surface-container-low transition-colors text-on-surface-variant"
              title="Atualizar"
            >
              <span className={`material-symbols-outlined text-lg ${pageStatus === "loading" ? "animate-spin" : ""}`}>
                refresh
              </span>
            </button>
          </div>

          {/* Loading */}
          {pageStatus === "loading" && (
            <div className="flex items-center gap-3 py-4">
              <span className="material-symbols-outlined text-primary animate-spin text-2xl">progress_activity</span>
              <span className="text-on-surface-variant">Verificando conexão...</span>
            </div>
          )}

          {/* Connected */}
          {pageStatus === "connected" && data && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-green-500 shadow shadow-green-200 animate-pulse" />
                <span className="text-green-700 font-bold text-sm">Conectado</span>
              </div>
              <div className="flex items-center gap-4 p-4 rounded-xl bg-green-50 border border-green-100">
                {data.profilePicUrl && (
                  <div className="w-14 h-14 rounded-full overflow-hidden shrink-0 border-2 border-green-200">
                    <Image
                      src={data.profilePicUrl}
                      alt="Foto de perfil"
                      width={56}
                      height={56}
                      className="w-full h-full object-cover"
                      unoptimized
                    />
                  </div>
                )}
                <div>
                  <p className="font-bold text-on-surface">{data.profileName || data.name}</p>
                  <p className="text-sm text-on-surface-variant">{formatPhone(data.owner)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-3 rounded-xl bg-surface-container-low">
                  <p className="text-xs text-on-surface-variant font-medium mb-1">Instância</p>
                  <p className="font-semibold text-on-surface truncate">{data.name}</p>
                </div>
                <div className="p-3 rounded-xl bg-surface-container-low">
                  <p className="text-xs text-on-surface-variant font-medium mb-1">Número</p>
                  <p className="font-semibold text-on-surface">{formatPhone(data.owner)}</p>
                </div>
              </div>
            </div>
          )}

          {/* Connecting + QR code */}
          {pageStatus === "connecting" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-amber-500 animate-spin text-xl">progress_activity</span>
                <span className="text-amber-700 font-bold text-sm">Aguardando leitura do QR Code...</span>
              </div>

              {qrcode ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <div className="p-3 bg-white rounded-2xl border-2 border-outline-variant/20 shadow-sm inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrcode} alt="QR Code WhatsApp" className="w-52 h-52" />
                  </div>
                  <p className="text-sm text-on-surface-variant text-center">
                    Abra o WhatsApp → <strong>Dispositivos Conectados</strong> → <strong>Conectar dispositivo</strong>
                  </p>
                  <p className="text-xs text-on-surface-variant/60">
                    Verificando automaticamente... ({pollCount}s)
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-3 py-4">
                  <span className="material-symbols-outlined text-primary animate-spin text-2xl">progress_activity</span>
                  <span className="text-on-surface-variant text-sm">Gerando QR Code...</span>
                </div>
              )}
            </div>
          )}

          {/* Disconnected */}
          {pageStatus === "disconnected" && data && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-red-700 font-bold text-sm">Desconectado</span>
              </div>
              {data.lastDisconnectReason && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">
                  <span className="font-medium">Motivo: </span>
                  {data.lastDisconnectReason}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-3 rounded-xl bg-surface-container-low">
                  <p className="text-xs text-on-surface-variant font-medium mb-1">Instância</p>
                  <p className="font-semibold text-on-surface truncate">{data.name}</p>
                </div>
                <div className="p-3 rounded-xl bg-surface-container-low">
                  <p className="text-xs text-on-surface-variant font-medium mb-1">Última desconexão</p>
                  <p className="font-semibold text-on-surface">{formatDate(data.lastDisconnect)}</p>
                </div>
              </div>
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-white font-bold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity shadow-sm"
              >
                <span className="material-symbols-outlined text-lg">qr_code_scanner</span>
                Conectar via QR Code
              </button>
            </div>
          )}

          {/* Error */}
          {pageStatus === "error" && (
            <div className="flex items-center gap-3 py-4">
              <span className="material-symbols-outlined text-red-500 text-2xl">error</span>
              <div>
                <p className="font-semibold text-red-700 text-sm">Erro de conexão</p>
                <p className="text-xs text-on-surface-variant">{error}</p>
              </div>
            </div>
          )}

          {error && pageStatus !== "error" && (
            <p className="mt-2 text-xs text-red-600">{error}</p>
          )}
        </div>

        {/* Info box */}
        <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/10 flex gap-3">
          <span className="material-symbols-outlined text-primary text-xl shrink-0 mt-0.5">info</span>
          <div className="text-sm text-on-surface-variant">
            <p className="font-semibold text-on-surface mb-1">Como reconectar</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Clique em <strong>Conectar via QR Code</strong></li>
              <li>Abra o WhatsApp no celular da Fernanda</li>
              <li>Vá em <strong>Configurações → Dispositivos Conectados</strong></li>
              <li>Toque em <strong>Conectar dispositivo</strong> e escaneie o QR</li>
            </ol>
          </div>
        </div>

      </div>
    </>
  );
}
