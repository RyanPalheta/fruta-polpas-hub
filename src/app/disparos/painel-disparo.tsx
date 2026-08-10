"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DIAS_SEMANA,
  DIA_LABELS,
  DIA_LABELS_CURTO,
  SEGMENTO_COLORS,
  STATUS_COLORS,
  STATUS_LABELS,
  formatPhone,
  getInitials,
} from "@/lib/utils";

const SEM_RESPONSAVEL = "SEM_RESPONSAVEL";

/**
 * Clientes por request. Cada um leva de 1 a 3 idas a KOMMO, espacadas pelo
 * limitador de taxa; 25 fecha em ~20s e cabe folgado no tempo de funcao, ainda
 * contando a primeira request, que paga a leitura do mapa de contatos.
 */
const TAMANHO_LOTE = 25;

const SEGMENTOS = [
  "RESTAURANTE",
  "HOTELARIA",
  "ACADEMIA",
  "DISTRIBUIDOR",
  "FRANQUIA",
  "EVENTOS",
  "OUTRO",
];

interface ClientePreview {
  id: string;
  empresa: string;
  contatoWhatsapp: string;
  segmento: string;
  diasDisparo: string[];
  responsavel: string | null;
  cidade: string | null;
  uf: string | null;
  ativo: boolean;
  kommoLeadId: number | null;
  statusSemana: string | null;
  disparadoEm: string | null;
  jaDisparado: boolean;
  /** Recebeu esta semana e nao deu retorno — alvo do reenvio. */
  reenvio: boolean;
  /** Etapa da KOMMO que impede o disparo agora, ou null se esta liberado. */
  bloqueioKommo: string | null;
}

/** Resultado da conferencia na KOMMO feita antes de montar a lista. */
interface ChecagemKommo {
  ok: boolean;
  erro: string | null;
  etapas: { id: number; nome: string }[];
  bloqueados: number;
  consultadoEm: string | null;
}

interface DisparoResultado {
  empresa: string;
  lead_id: number | null;
  ok: boolean;
  /** De onde veio o lead na KOMMO — "lead-novo"/"lead-e-contato-novos" = criado agora. */
  origem?: string;
  erro?: string;
}

const ROTULO_ORIGEM: Record<string, string> = {
  cache: "lead já conhecido",
  mapa: "lead achado na KOMMO",
  busca: "lead achado na busca",
  "lead-novo": "lead criado (contato já existia)",
  "lead-e-contato-novos": "lead e contato criados",
};

interface DisparoResponse {
  message?: string;
  created?: number;
  webhook?: { enviados: number; falhas: number; resultados: DisparoResultado[] };
  leadsCriados?: number;
  kommo?: ChecagemKommo;
  ignorados?: Array<{ empresa: string; telefone: string; motivo: string }>;
  error?: string;
}

interface Props {
  /** Dia util de hoje, ou null no fim de semana. */
  diaHoje: string | null;
  /** Responsaveis ja cadastrados, para o filtro. */
  responsaveis: string[];
  /** Quantos clientes ativos cada dia tem, para os contadores das abas. */
  contagemPorDia: Record<string, number>;
}

export function PainelDisparo({ diaHoje, responsaveis, contagemPorDia }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Fora do horario util nao ha "hoje" — cai na segunda pra tela nunca abrir vazia.
  const [dias, setDias] = useState<string[]>([diaHoje ?? "SEGUNDA"]);
  const [segmentos, setSegmentos] = useState<string[]>([]);
  const [filtroResponsaveis, setFiltroResponsaveis] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [ocultarJaDisparados, setOcultarJaDisparados] = useState(false);
  /**
   * O interruptor do reenvio. Desligado por padrao: mandar a segunda mensagem
   * da semana e decisao consciente, nunca o comportamento default.
   */
  const [incluirReenvios, setIncluirReenvios] = useState(false);

  const [clientes, setClientes] = useState<ClientePreview[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroPreview, setErroPreview] = useState("");
  const [checagemKommo, setChecagemKommo] = useState<ChecagemKommo | null>(null);

  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [disparando, setDisparando] = useState(false);
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null);
  const [resultado, setResultado] = useState<DisparoResponse | null>(null);

  const carregarPreview = useCallback(async () => {
    if (dias.length === 0) {
      setClientes([]);
      setSelecionados(new Set());
      setCarregando(false);
      return;
    }

    setCarregando(true);
    setErroPreview("");
    try {
      const params = new URLSearchParams({ dias: dias.join(",") });
      if (segmentos.length) params.set("segmentos", segmentos.join(","));
      if (filtroResponsaveis.length) params.set("responsaveis", filtroResponsaveis.join(","));
      if (busca.trim()) params.set("busca", busca.trim());

      const res = await fetch(`/api/disparos/preview?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao carregar a previa.");

      const lista: ClientePreview[] = data.clientes ?? [];
      setClientes(lista);
      setChecagemKommo(data.kommo ?? null);
      // Ja vem marcado quem ainda nao recebeu esta semana e nao esta preso
      // numa etapa da KOMMO.
      setSelecionados(
        new Set(lista.filter((c) => !c.jaDisparado && !c.bloqueioKommo).map((c) => c.id))
      );
    } catch (err) {
      setErroPreview(err instanceof Error ? err.message : "Erro ao carregar a previa.");
      setClientes([]);
      setChecagemKommo(null);
      setSelecionados(new Set());
    } finally {
      setCarregando(false);
    }
  }, [dias, segmentos, filtroResponsaveis, busca]);

  useEffect(() => {
    const timer = setTimeout(carregarPreview, busca ? 350 : 0);
    return () => clearTimeout(timer);
  }, [carregarPreview, busca]);

  // O interruptor marca (ou desmarca) o pessoal do reenvio de uma vez. Roda de
  // novo quando a lista e recarregada, pra que uma previa nova ja venha com o
  // interruptor aplicado.
  useEffect(() => {
    setSelecionados((prev) => {
      const proximo = new Set(prev);
      for (const c of clientes) {
        if (!c.reenvio || c.bloqueioKommo) continue;
        if (incluirReenvios) proximo.add(c.id);
        else proximo.delete(c.id);
      }
      return proximo;
    });
  }, [incluirReenvios, clientes]);

  const visiveis = useMemo(
    () => (ocultarJaDisparados ? clientes.filter((c) => !c.jaDisparado) : clientes),
    [clientes, ocultarJaDisparados]
  );

  // Bloqueado pela KOMMO nem entra na conta: a tela nao deixa marcar, e o
  // servidor recusa de novo na hora de disparar.
  const selecionaveis = useMemo(() => visiveis.filter((c) => !c.bloqueioKommo), [visiveis]);

  // Quem o "Marcar todos" alcanca. Pendente sempre; reenvio so com o
  // interruptor ligado. Quem respondeu ou fechou pedido nunca entra em massa —
  // continua dando pra marcar na mao, uma linha por vez.
  const marcaveisEmMassa = useMemo(
    () => selecionaveis.filter((c) => !c.jaDisparado || (incluirReenvios && c.reenvio)),
    [selecionaveis, incluirReenvios]
  );

  /** Reenvios disponiveis na lista atual, com ou sem o interruptor ligado. */
  const reenviaveis = useMemo(() => selecionaveis.filter((c) => c.reenvio), [selecionaveis]);

  // So conta quem esta visivel: nao da pra disparar pra alguem que a lista escondeu.
  const idsSelecionados = useMemo(
    () => selecionaveis.filter((c) => selecionados.has(c.id)).map((c) => c.id),
    [selecionaveis, selecionados]
  );

  const todosVisiveisSelecionados =
    marcaveisEmMassa.length > 0 &&
    marcaveisEmMassa.every((c) => selecionados.has(c.id));

  function alternarUm(id: string) {
    setSelecionados((prev) => {
      const proximo = new Set(prev);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  function alternarTodos() {
    setSelecionados((prev) => {
      const proximo = new Set(prev);
      if (todosVisiveisSelecionados) {
        for (const c of marcaveisEmMassa) proximo.delete(c.id);
      } else {
        for (const c of marcaveisEmMassa) proximo.add(c.id);
      }
      return proximo;
    });
  }

  /**
   * "Ocultar quem ja recebeu" e o oposto exato deste interruptor — ligar os
   * dois esconderia justamente quem acabou de entrar na lista. Um desliga o
   * outro em vez de deixar a tela num estado que nao quer dizer nada.
   */
  function alternarReenvios() {
    const proximo = !incluirReenvios;
    setIncluirReenvios(proximo);
    if (proximo) setOcultarJaDisparados(false);
  }

  function alternarOcultarJaDisparados(ocultar: boolean) {
    setOcultarJaDisparados(ocultar);
    if (ocultar) setIncluirReenvios(false);
  }

  function alternarDia(dia: string) {
    setDias((prev) =>
      prev.includes(dia)
        ? prev.filter((d) => d !== dia)
        : DIAS_SEMANA.filter((d) => d === dia || prev.includes(d))
    );
  }

  function alternarSegmento(seg: string) {
    setSegmentos((prev) =>
      prev.includes(seg) ? prev.filter((s) => s !== seg) : [...prev, seg]
    );
  }

  function alternarResponsavel(resp: string) {
    setFiltroResponsaveis((prev) =>
      prev.includes(resp) ? prev.filter((r) => r !== resp) : [...prev, resp]
    );
  }

  function limparFiltros() {
    setSegmentos([]);
    setFiltroResponsaveis([]);
    setBusca("");
    setOcultarJaDisparados(false);
  }

  /**
   * Dispara em lotes.
   *
   * Cada cliente custa de 1 a 3 idas a KOMMO, e elas sao espacadas pra nao
   * bater no limite de requisicoes. Mandar a base inteira numa request so
   * levaria minutos e a funcao seria cortada no meio; em lotes, cada request
   * termina rapido e da pra mostrar o andamento.
   */
  async function dispararSelecionados() {
    setDisparando(true);
    setResultado(null);
    setConfirmando(false);

    const ids = [...idsSelecionados];
    const total = ids.length;

    let created = 0;
    let leadsCriados = 0;
    let enviados = 0;
    let falhas = 0;
    const resultadosAcumulados: DisparoResultado[] = [];
    const ignoradosAcumulados: NonNullable<DisparoResponse["ignorados"]> = [];
    let checagem: ChecagemKommo | undefined;

    const parcial = (erro?: string): DisparoResponse => ({
      message: `${enviados} de ${total} disparado(s)`,
      created,
      leadsCriados,
      webhook: { enviados, falhas, resultados: resultadosAcumulados },
      ignorados: ignoradosAcumulados,
      kommo: checagem,
      error: erro,
    });

    try {
      for (let i = 0; i < ids.length; i += TAMANHO_LOTE) {
        const lote = ids.slice(i, i + TAMANHO_LOTE);
        setProgresso({ feitos: i, total });

        const res = await fetch("/api/disparos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dias, clienteIds: lote }),
        });
        const data: DisparoResponse = await res.json();

        if (!res.ok || data.error) {
          setResultado(parcial(data.error ?? "Erro ao disparar."));
          return;
        }

        created += data.created ?? 0;
        leadsCriados += data.leadsCriados ?? 0;
        enviados += data.webhook?.enviados ?? 0;
        falhas += data.webhook?.falhas ?? 0;
        resultadosAcumulados.push(...(data.webhook?.resultados ?? []));
        ignoradosAcumulados.push(...(data.ignorados ?? []));
        checagem = data.kommo ?? checagem;

        // KOMMO caiu no meio do caminho: para aqui em vez de seguir as cegas.
        if (data.kommo && !data.kommo.ok) {
          setResultado(
            parcial("A KOMMO parou de responder no meio do disparo. O resto não foi enviado.")
          );
          return;
        }
      }

      setProgresso({ feitos: total, total });
      setResultado(parcial());
      await carregarPreview();
      startTransition(() => router.refresh());
    } catch {
      setResultado(parcial("Erro de conexão ao disparar."));
    } finally {
      setDisparando(false);
      setProgresso(null);
    }
  }

  const rotuloDias = DIAS_SEMANA.filter((d) => dias.includes(d))
    .map((d) => DIA_LABELS[d])
    .join(", ");

  const jaDisparadosNaLista = clientes.filter((c) => c.jaDisparado).length;
  const bloqueadosNaLista = clientes.filter((c) => c.bloqueioKommo).length;
  const temFiltro =
    segmentos.length > 0 || filtroResponsaveis.length > 0 || busca.trim() !== "" || ocultarJaDisparados;
  const selecionadosJaDisparados = selecionaveis.filter(
    (c) => selecionados.has(c.id) && c.jaDisparado
  ).length;
  const selecionadosReenvio = selecionaveis.filter(
    (c) => selecionados.has(c.id) && c.reenvio
  ).length;

  return (
    <div className="space-y-6">
      {/* Passo 1 — dias da semana */}
      <section className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold">
              1
            </span>
            <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
              Dias do disparo
            </h3>
            <span className="text-xs text-on-surface-variant">
              (pode marcar mais de um)
            </span>
          </div>
          <div className="flex items-center gap-3">
            {diaHoje && (
              <button
                onClick={() => setDias([diaHoje])}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Só hoje
              </button>
            )}
            <button
              onClick={() => setDias([...DIAS_SEMANA])}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Semana toda
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {DIAS_SEMANA.map((d) => {
            const ativo = dias.includes(d);
            const isHoje = d === diaHoje;
            return (
              <button
                key={d}
                type="button"
                onClick={() => alternarDia(d)}
                aria-pressed={ativo}
                className={`relative rounded-xl border p-4 text-center transition ${
                  ativo
                    ? "border-primary bg-primary text-white shadow-sm"
                    : "border-outline-variant/20 bg-surface-container-low hover:bg-surface-bright"
                }`}
              >
                {ativo && (
                  <span className="material-symbols-outlined absolute top-2 right-2 text-base text-white">
                    check_circle
                  </span>
                )}
                <span
                  className={`block text-xs font-semibold uppercase tracking-wider ${
                    ativo ? "text-white/70" : "text-on-surface-variant"
                  }`}
                >
                  {DIA_LABELS[d]}
                </span>
                <span
                  className={`mt-1 block text-3xl font-black ${
                    ativo ? "text-white" : "text-on-surface"
                  }`}
                >
                  {contagemPorDia[d] ?? 0}
                </span>
                <span className={`text-xs ${ativo ? "text-white/70" : "text-on-surface-variant"}`}>
                  clientes
                </span>
                {isHoje && (
                  <span
                    className={`mt-1 block text-[10px] font-bold uppercase ${
                      ativo ? "text-white" : "text-primary"
                    }`}
                  >
                    Hoje
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Passo 2 — filtros */}
      <section className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold">
              2
            </span>
            <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
              Filtros
            </h3>
          </div>
          {temFiltro && (
            <button
              onClick={limparFiltros}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Limpar filtros
            </button>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-on-surface-variant mb-2">Segmento</p>
            <div className="flex flex-wrap gap-2">
              {SEGMENTOS.map((seg) => {
                const ativo = segmentos.includes(seg);
                const cor = SEGMENTO_COLORS[seg] ?? SEGMENTO_COLORS.OUTRO;
                return (
                  <button
                    key={seg}
                    type="button"
                    onClick={() => alternarSegmento(seg)}
                    aria-pressed={ativo}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                      ativo
                        ? `${cor.bg} ${cor.text} ${cor.border}`
                        : "bg-surface-container-low text-on-surface-variant border-outline-variant/20 hover:bg-surface-bright"
                    }`}
                  >
                    {seg}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-on-surface-variant mb-2">Responsável</p>
            <div className="flex flex-wrap gap-2">
              {responsaveis.map((resp) => {
                const ativo = filtroResponsaveis.includes(resp);
                return (
                  <button
                    key={resp}
                    type="button"
                    onClick={() => alternarResponsavel(resp)}
                    aria-pressed={ativo}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                      ativo
                        ? "bg-primary text-white border-primary"
                        : "bg-surface-container-low text-on-surface-variant border-outline-variant/20 hover:bg-surface-bright"
                    }`}
                  >
                    {resp}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => alternarResponsavel(SEM_RESPONSAVEL)}
                aria-pressed={filtroResponsaveis.includes(SEM_RESPONSAVEL)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                  filtroResponsaveis.includes(SEM_RESPONSAVEL)
                    ? "bg-primary text-white border-primary"
                    : "bg-surface-container-low text-on-surface-variant border-outline-variant/20 hover:bg-surface-bright"
                }`}
              >
                Sem responsável
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
                search
              </span>
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar empresa, telefone ou cidade..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-on-surface cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={ocultarJaDisparados}
                onChange={(e) => alternarOcultarJaDisparados(e.target.checked)}
                className="w-4 h-4 rounded accent-primary cursor-pointer"
              />
              Ocultar quem já recebeu esta semana
              {jaDisparadosNaLista > 0 && (
                <span className="text-xs text-on-surface-variant">({jaDisparadosNaLista})</span>
              )}
            </label>
          </div>
        </div>
      </section>

      {/* Passo 3 — quem vai receber */}
      <section className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-4">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold">
              3
            </span>
            <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
              Quem vai receber — {rotuloDias || "nenhum dia marcado"}
            </h3>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-on-surface-variant">
              <span className="font-bold text-on-surface">{idsSelecionados.length}</span> de{" "}
              {selecionaveis.length} selecionado(s)
            </span>
            {selecionaveis.length > 0 && (
              <button
                onClick={alternarTodos}
                className="text-xs font-semibold text-primary hover:underline"
              >
                {todosVisiveisSelecionados ? "Desmarcar todos" : "Marcar todos"}
              </button>
            )}
          </div>
        </div>

        {/* Interruptor do reenvio */}
        <div
          className={`mx-6 mb-4 rounded-xl border p-4 transition-colors ${
            incluirReenvios
              ? "border-primary/40 bg-primary/5"
              : "border-outline-variant/20 bg-surface-container-low"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface">
                Disparar para quem já recebeu e não fez pedido
              </p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Segunda mensagem da semana para quem recebeu o disparo e não deu retorno. Quem
                respondeu, fechou pedido, recusou ou está em atendimento continua de fora.
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={incluirReenvios}
              aria-label="Disparar para quem já recebeu e não fez pedido"
              onClick={alternarReenvios}
              disabled={disparando || carregando}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                incluirReenvios ? "bg-primary" : "bg-outline-variant/50"
              }`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  incluirReenvios ? "left-6" : "left-1"
                }`}
              />
            </button>
          </div>

          <p className="text-xs mt-2 font-medium">
            {reenviaveis.length === 0 ? (
              <span className="text-on-surface-variant">
                Ninguém nessa situação em {rotuloDias || "nenhum dia marcado"} agora.
              </span>
            ) : incluirReenvios ? (
              <span className="text-primary">
                {reenviaveis.length} cliente(s) vão receber a mensagem pela segunda vez nesta semana.
              </span>
            ) : (
              <span className="text-on-surface-variant">
                {reenviaveis.length} cliente(s) nessa situação estão de fora. Ligue o interruptor
                para incluí-los.
              </span>
            )}
          </p>
        </div>

        {/* Conferencia na KOMMO */}
        {checagemKommo && !checagemKommo.ok && (
          <div className="mx-6 mb-4 flex items-start gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            <span className="material-symbols-outlined text-base shrink-0">error</span>
            <span>
              <strong>Não deu para conferir a KOMMO.</strong> Sem saber quem está em atendimento, o
              disparo fica bloqueado — ninguém recebe mensagem por cima de uma conversa aberta.
              Confira a integração em Configurações.
              {checagemKommo.erro && (
                <span className="block text-xs opacity-80 mt-0.5">{checagemKommo.erro}</span>
              )}
            </span>
          </div>
        )}

        {checagemKommo?.ok && bloqueadosNaLista > 0 && (
          <div className="mx-6 mb-4 flex items-start gap-2 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            <span className="material-symbols-outlined text-base shrink-0">block</span>
            <span>
              <strong>{bloqueadosNaLista}</strong> cliente(s) não vão receber: na KOMMO estão em{" "}
              {checagemKommo.etapas.map((e) => e.nome).join(", ")}. Aparecem esmaecidos na lista e
              não dá para marcar.
            </span>
          </div>
        )}

        {carregando ? (
          <div className="flex items-center justify-center gap-2 py-16 text-on-surface-variant">
            <span className="material-symbols-outlined animate-spin">progress_activity</span>
            Carregando lista...
          </div>
        ) : erroPreview ? (
          <div className="mx-6 mb-6 flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm font-medium">
            <span className="material-symbols-outlined text-base">error</span>
            {erroPreview}
          </div>
        ) : visiveis.length === 0 ? (
          <div className="py-16 text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/40">
              group_off
            </span>
            <p className="mt-2 text-sm text-on-surface-variant">
              {dias.length === 0
                ? "Marque ao menos um dia da semana acima."
                : `Nenhum cliente ${temFiltro ? "com esses filtros" : `programado para ${rotuloDias}`}.`}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-outline-variant/10 max-h-[28rem] overflow-y-auto border-t border-outline-variant/10">
            {visiveis.map((cliente) => {
              const bloqueado = cliente.bloqueioKommo != null;
              const marcado = !bloqueado && selecionados.has(cliente.id);
              const cor = SEGMENTO_COLORS[cliente.segmento] ?? SEGMENTO_COLORS.OUTRO;
              return (
                <label
                  key={cliente.id}
                  title={bloqueado ? `Na KOMMO: ${cliente.bloqueioKommo}` : undefined}
                  className={`flex items-center gap-4 px-6 py-3 transition-colors ${
                    bloqueado
                      ? "bg-surface-container-low/60 opacity-60 cursor-not-allowed"
                      : marcado
                        ? "bg-primary/5 cursor-pointer"
                        : "hover:bg-surface-bright cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={marcado}
                    disabled={bloqueado}
                    onChange={() => alternarUm(cliente.id)}
                    className="w-4 h-4 rounded accent-primary cursor-pointer shrink-0 disabled:cursor-not-allowed"
                  />

                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                    {getInitials(cliente.empresa)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-on-surface truncate">
                      {cliente.empresa}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {formatPhone(cliente.contatoWhatsapp)}
                      {cliente.cidade ? ` · ${cliente.cidade}${cliente.uf ? `/${cliente.uf}` : ""}` : ""}
                    </p>
                  </div>

                  <div className="hidden md:flex items-center gap-1 shrink-0">
                    {DIAS_SEMANA.filter((d) => cliente.diasDisparo.includes(d)).map((d) => (
                      <span
                        key={d}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          dias.includes(d)
                            ? "bg-primary text-white"
                            : "bg-surface-container-high text-on-surface-variant"
                        }`}
                      >
                        {DIA_LABELS_CURTO[d]}
                      </span>
                    ))}
                  </div>

                  <span
                    className={`hidden lg:inline-flex px-2 py-1 rounded-lg text-[10px] font-bold border shrink-0 ${cor.bg} ${cor.text} ${cor.border}`}
                  >
                    {cliente.segmento}
                  </span>

                  <span className="hidden lg:block text-xs text-on-surface-variant w-24 truncate shrink-0">
                    {cliente.responsavel ?? "—"}
                  </span>

                  {bloqueado ? (
                    <span
                      className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2.5 py-1 rounded-full bg-amber-100 text-amber-800"
                      title={`Não recebe: na KOMMO está em "${cliente.bloqueioKommo}"`}
                    >
                      <span className="material-symbols-outlined text-sm">block</span>
                      {cliente.bloqueioKommo}
                    </span>
                  ) : incluirReenvios && cliente.reenvio ? (
                    <span
                      className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2.5 py-1 rounded-full bg-primary/10 text-primary"
                      title={`Reenvio — já recebeu esta semana (${
                        STATUS_LABELS[cliente.statusSemana ?? ""] ?? "Disparado"
                      }) e não fez pedido`}
                    >
                      <span className="material-symbols-outlined text-sm">replay</span>
                      Reenvio
                    </span>
                  ) : cliente.jaDisparado ? (
                    <span
                      className={`shrink-0 text-[10px] font-bold uppercase px-2.5 py-1 rounded-full ${
                        STATUS_COLORS[cliente.statusSemana ?? ""] ?? "bg-gray-100 text-gray-700"
                      }`}
                      title="Já recebeu disparo nesta semana"
                    >
                      {STATUS_LABELS[cliente.statusSemana ?? ""] ?? "Disparado"}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] font-bold uppercase px-2.5 py-1 rounded-full bg-surface-container-high text-on-surface-variant">
                      Pendente
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}

        {/* Andamento do disparo em lotes */}
        {progresso && (
          <div className="px-6 pt-4 border-t border-outline-variant/10">
            <div className="flex items-center justify-between text-xs text-on-surface-variant mb-1.5">
              <span>
                Disparando em lotes de {TAMANHO_LOTE} — {progresso.feitos} de {progresso.total}
              </span>
              <span className="font-semibold">
                {Math.round((progresso.feitos / Math.max(1, progresso.total)) * 100)}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${(progresso.feitos / Math.max(1, progresso.total)) * 100}%` }}
              />
            </div>
            <p className="text-xs text-on-surface-variant mt-1.5">
              Não feche a página até terminar.
            </p>
          </div>
        )}

        {/* Acao */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-6 border-t border-outline-variant/10 bg-surface-container-low/50">
          <p className="text-sm text-on-surface-variant">
            {idsSelecionados.length === 0
              ? "Marque ao menos um cliente para disparar."
              : `Vão receber a mensagem agora: ${idsSelecionados.length} cliente(s).`}
            {selecionadosJaDisparados > 0 && (
              <span className="block text-xs text-amber-700 font-medium mt-0.5">
                {selecionadosJaDisparados} já recebeu(ram) esta semana e vai(vão) receber de novo
                {selecionadosReenvio > 0 && selecionadosReenvio < selecionadosJaDisparados
                  ? ` (${selecionadosReenvio} pelo interruptor de reenvio)`
                  : ""}
                .
              </span>
            )}
          </p>
          <button
            onClick={() => setConfirmando(true)}
            disabled={
              idsSelecionados.length === 0 ||
              disparando ||
              carregando ||
              checagemKommo?.ok === false
            }
            title={
              checagemKommo?.ok === false
                ? "Disparo bloqueado enquanto a KOMMO não responde"
                : undefined
            }
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-lg">send</span>
            Disparar para {idsSelecionados.length}
          </button>
        </div>
      </section>

      {/* Confirmacao */}
      {confirmando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-surface-container-lowest shadow-2xl border border-outline-variant/10 overflow-hidden">
            <div className="p-6">
              <h3 className="text-xl font-extrabold text-on-surface mb-1">Confirmar disparo</h3>
              <p className="text-sm text-on-surface-variant">
                Vai enviar a mensagem de <strong>{rotuloDias}</strong> para{" "}
                <strong>{idsSelecionados.length} cliente(s)</strong> no WhatsApp. Essa ação não pode
                ser desfeita.
              </p>
              {selecionadosReenvio > 0 && (
                <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-medium text-amber-800">
                  <span className="material-symbols-outlined text-base shrink-0">replay</span>
                  <span>
                    <strong>{selecionadosReenvio}</strong> deles já receberam esta semana e vão
                    receber a segunda mensagem.
                  </span>
                </p>
              )}

              <div className="mt-4 max-h-52 overflow-y-auto rounded-xl border border-outline-variant/10 divide-y divide-outline-variant/10">
                {selecionaveis
                  .filter((c) => selecionados.has(c.id))
                  .map((c) => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="font-medium text-on-surface truncate">{c.empresa}</span>
                      <span className="text-xs text-on-surface-variant shrink-0 ml-3">
                        {formatPhone(c.contatoWhatsapp)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 bg-surface-container-low border-t border-outline-variant/10">
              <button
                onClick={() => setConfirmando(false)}
                disabled={disparando}
                className="px-5 py-2.5 rounded-xl border border-outline-variant/20 text-sm font-semibold text-on-surface-variant hover:bg-surface-container transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={dispararSelecionados}
                disabled={disparando}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
              >
                {disparando ? (
                  <span className="material-symbols-outlined text-lg animate-spin">
                    progress_activity
                  </span>
                ) : (
                  <span className="material-symbols-outlined text-lg">send</span>
                )}
                {disparando ? "Disparando..." : "Confirmar e disparar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resultado */}
      {resultado && (
        <section>
          {resultado.error ? (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm font-medium">
              <span className="material-symbols-outlined text-base">error</span>
              {resultado.error}
              <button onClick={() => setResultado(null)} className="ml-auto">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="font-semibold text-on-surface">{resultado.message}</span>
                  {resultado.webhook && (
                    <>
                      <span className="flex items-center gap-1 text-green-700 font-semibold">
                        <span className="material-symbols-outlined text-sm">check_circle</span>
                        {resultado.webhook.enviados} enviado(s)
                      </span>
                      {resultado.webhook.falhas > 0 && (
                        <span className="flex items-center gap-1 text-red-600 font-semibold">
                          <span className="material-symbols-outlined text-sm">error</span>
                          {resultado.webhook.falhas} falha(s)
                        </span>
                      )}
                    </>
                  )}
                  {resultado.leadsCriados ? (
                    <span className="flex items-center gap-1 text-on-surface-variant">
                      <span className="material-symbols-outlined text-sm">person_add</span>
                      {resultado.leadsCriados} lead(s) criado(s) na KOMMO
                    </span>
                  ) : null}
                </div>
                <button
                  onClick={() => setResultado(null)}
                  className="text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>

              {resultado.ignorados && resultado.ignorados.length > 0 && (
                <div className="px-6 py-3 bg-amber-50 border-b border-amber-100">
                  <p className="text-xs font-bold text-amber-800 mb-1">
                    Não receberam por estarem em atendimento ou com pedido resolvido na KOMMO (
                    {resultado.ignorados.length}):
                  </p>
                  <ul className="text-xs text-amber-800/90 space-y-0.5 max-h-40 overflow-y-auto">
                    {resultado.ignorados.map((i, idx) => (
                      <li key={idx}>
                        • {i.empresa} — {i.motivo}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {resultado.webhook && resultado.webhook.resultados.length > 0 && (
                <div className="divide-y divide-outline-variant/10 max-h-72 overflow-y-auto">
                  {resultado.webhook.resultados.map((r, i) => (
                    <div key={i} className="flex items-start justify-between px-6 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="font-semibold text-on-surface truncate">{r.empresa}</p>
                        <p className="text-xs text-on-surface-variant">
                          lead_id: {r.lead_id ?? "—"}
                          {r.origem ? ` · ${ROTULO_ORIGEM[r.origem] ?? r.origem}` : ""}
                        </p>
                        {r.erro && <p className="text-xs text-red-600 mt-0.5">{r.erro}</p>}
                      </div>
                      <span
                        className={`shrink-0 text-xs font-bold px-2 py-1 rounded-full ml-4 ${
                          r.ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        }`}
                      >
                        {r.ok ? "Enviado" : "Falhou"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
