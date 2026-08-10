"use client";

import { useEffect, useState } from "react";

type Escopo = "clientes" | "disparos" | "historico" | "tudo";

interface Contagem {
  clientes: number;
  disparos: number;
  ciclos: number;
  historico: number;
}

const CONFIRMACAO = "APAGAR";

const OPCOES: { valor: Escopo; titulo: string; detalhe: string; alvos: (keyof Contagem)[] }[] = [
  {
    valor: "tudo",
    titulo: "Apagar TODA a base",
    detalhe: "Clientes, disparos, ciclos semanais e histórico de compras. Só as configurações ficam.",
    alvos: ["clientes", "disparos", "ciclos", "historico"],
  },
  {
    valor: "clientes",
    titulo: "Apagar só os clientes",
    detalhe: "Some com a carteira inteira — e com os disparos e o histórico dela.",
    alvos: ["clientes", "disparos", "historico"],
  },
  {
    valor: "disparos",
    titulo: "Apagar só os disparos",
    detalhe: "Zera o histórico de disparos e os ciclos semanais. Os clientes ficam.",
    alvos: ["disparos", "ciclos"],
  },
  {
    valor: "historico",
    titulo: "Apagar só o histórico do Bling",
    detalhe: "Limpa as compras sincronizadas. Dá para sincronizar de novo depois.",
    alvos: ["historico"],
  },
];

const ROTULO_TABELA: Record<keyof Contagem, string> = {
  clientes: "clientes",
  disparos: "disparos",
  ciclos: "ciclos semanais",
  historico: "compras no histórico",
};

export function ZonaPerigo() {
  const [total, setTotal] = useState<Contagem | null>(null);
  const [aberta, setAberta] = useState(false);
  const [escopo, setEscopo] = useState<Escopo>("tudo");
  const [texto, setTexto] = useState("");
  const [apagando, setApagando] = useState(false);
  const [resultado, setResultado] = useState<{ tipo: "ok" | "erro"; msg: string } | null>(null);

  useEffect(() => {
    if (!aberta) return;
    fetch("/api/admin/limpar-base")
      .then((r) => r.json())
      .then((data) => setTotal(data.total ?? null))
      .catch(() => setTotal(null));
  }, [aberta]);

  const opcao = OPCOES.find((o) => o.valor === escopo)!;

  /** "1.240 clientes e 87 disparos" — o que essa escolha leva embora. */
  const resumoAlvo = total
    ? opcao.alvos
        .map((alvo) => `${total[alvo].toLocaleString("pt-BR")} ${ROTULO_TABELA[alvo]}`)
        .join(", ")
    : null;

  const registrosAtingidos = total ? opcao.alvos.reduce((soma, a) => soma + total[a], 0) : 0;
  const podeApagar = texto.trim().toUpperCase() === CONFIRMACAO && !apagando;

  async function apagar() {
    if (!podeApagar) return;

    const ok = window.confirm(
      `${opcao.titulo}\n\nIsso apaga ${resumoAlvo ?? "os registros selecionados"} e NÃO pode ser desfeito.\n\nConfirma?`
    );
    if (!ok) return;

    setApagando(true);
    setResultado(null);
    try {
      const res = await fetch("/api/admin/limpar-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escopo, confirmacao: CONFIRMACAO }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao apagar.");

      const apagado = data.apagado as Contagem;
      const detalhe = (Object.keys(ROTULO_TABELA) as (keyof Contagem)[])
        .filter((k) => apagado[k] > 0)
        .map((k) => `${apagado[k].toLocaleString("pt-BR")} ${ROTULO_TABELA[k]}`)
        .join(", ");

      setTotal(data.total ?? null);
      setTexto("");
      setResultado({
        tipo: "ok",
        msg: detalhe ? `Apagado: ${detalhe}.` : "Não havia nada para apagar.",
      });
    } catch (err) {
      setResultado({
        tipo: "erro",
        msg: err instanceof Error ? err.message : "Erro desconhecido.",
      });
    } finally {
      setApagando(false);
    }
  }

  return (
    <section className="max-w-2xl mt-10 rounded-2xl border border-red-200 bg-red-50/40 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-red-700 uppercase tracking-widest flex items-center gap-2">
            <span className="material-symbols-outlined text-lg">warning</span>
            Zona de perigo
          </h3>
          <p className="text-xs text-on-surface-variant mt-1">
            Apagar a base de dados. Não tem desfazer nem lixeira — só volte com um backup.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setAberta((v) => !v);
            setResultado(null);
            setTexto("");
          }}
          className="shrink-0 px-4 py-2 rounded-xl border border-red-300 text-red-700 text-sm font-semibold hover:bg-red-100 transition-colors"
        >
          {aberta ? "Fechar" : "Abrir"}
        </button>
      </div>

      {aberta && (
        <div className="mt-5 space-y-4">
          {/* O que existe hoje */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(Object.keys(ROTULO_TABELA) as (keyof Contagem)[]).map((chave) => (
              <div key={chave} className="rounded-xl bg-surface-container-lowest border border-red-100 p-3">
                <p className="text-xl font-black text-on-surface">
                  {total ? total[chave].toLocaleString("pt-BR") : "—"}
                </p>
                <p className="text-xs text-on-surface-variant capitalize">{ROTULO_TABELA[chave]}</p>
              </div>
            ))}
          </div>

          {/* Escolha do escopo */}
          <div className="space-y-2">
            {OPCOES.map((o) => (
              <label
                key={o.valor}
                className={`flex gap-2.5 items-start p-3 rounded-xl border cursor-pointer transition-colors ${
                  escopo === o.valor
                    ? "border-red-300 bg-red-100/60"
                    : "border-outline-variant/20 bg-surface-container-lowest hover:bg-surface-container-low"
                }`}
              >
                <input
                  type="radio"
                  name="escopo-limpeza"
                  value={o.valor}
                  checked={escopo === o.valor}
                  onChange={() => {
                    setEscopo(o.valor);
                    setResultado(null);
                  }}
                  disabled={apagando}
                  className="mt-0.5 accent-red-600"
                />
                <span>
                  <span className="block text-sm font-semibold text-on-surface">{o.titulo}</span>
                  <span className="block text-xs text-on-surface-variant">{o.detalhe}</span>
                </span>
              </label>
            ))}
          </div>

          {resumoAlvo && (
            <p className="text-sm text-red-700 font-semibold">
              Vai apagar: {resumoAlvo}.
            </p>
          )}

          {/* Confirmacao digitada */}
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
              Digite <strong className="text-red-700">{CONFIRMACAO}</strong> para liberar o botão
            </label>
            <input
              type="text"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={CONFIRMACAO}
              autoComplete="off"
              disabled={apagando}
              className="w-full px-4 py-2.5 rounded-xl bg-surface-container-lowest border border-red-200 text-sm text-on-surface font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-red-300"
            />
          </div>

          <button
            type="button"
            onClick={apagar}
            disabled={!podeApagar || registrosAtingidos === 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {apagando ? (
              <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-lg">delete_forever</span>
            )}
            {apagando ? "Apagando..." : registrosAtingidos === 0 ? "Nada para apagar" : opcao.titulo}
          </button>

          {resultado && (
            <div
              className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium border ${
                resultado.tipo === "ok"
                  ? "bg-green-50 border-green-100 text-green-700"
                  : "bg-red-50 border-red-200 text-red-700"
              }`}
            >
              <span className="material-symbols-outlined text-base">
                {resultado.tipo === "ok" ? "check_circle" : "error"}
              </span>
              {resultado.msg}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
