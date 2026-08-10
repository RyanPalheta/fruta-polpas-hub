import { prisma } from "./prisma";
import { DiaSemana, Segmento, StatusDisparo } from "@/generated/prisma/client";
import { getDiaSemanaHoje, getInicioSemana, ordenarDias, DIA_LABELS } from "./utils";
import {
  TAG_CARTEIRA_OFICIAL,
  carregarBloqueiosKommo,
  carregarMapaKommo,
  chaveTelefone,
  configDoDisparo,
  garantirLeadDoCliente,
  rodarSalesbot,
  type EtapaBloqueante,
  type LeadResolvido,
  type OrigemLead,
} from "./kommo";

/**
 * Webhook antigo do n8n. O disparo hoje sai pelo salesbot da KOMMO, chamado
 * direto daqui — isto aqui ficou so pro endpoint de teste manual.
 */
const WEBHOOK_URL = "https://webhook.venancioautomacoes.com.br/webhook/disparo_fruta";

export interface WebhookDisparoPayload {
  lead_id: number | null;
  empresa: string;
  telefone: string;
  cliente_id: string;
}

export interface WebhookDisparoResponse {
  success?: boolean;
  [key: string]: unknown;
}

export interface DisparoResult {
  message: string;
  created: number;
  /**
   * Resultado por cliente. O nome "webhook" ficou de quando o envio passava
   * pelo n8n; hoje quem manda a mensagem e o salesbot da KOMMO.
   */
  webhook: {
    enviados: number;
    falhas: number;
    resultados: Array<{
      empresa: string;
      lead_id: number | null;
      ok: boolean;
      /** Como o lead foi obtido — mostra quem precisou ser criado. */
      origem?: OrigemLead;
      resposta?: unknown;
      erro?: string;
    }>;
  };
  /** Quantos leads o disparo precisou criar na KOMMO. */
  leadsCriados: number;
  /** Quantos ficaram para o proximo lote. */
  restantes: number;
  /** false quando parou no limite do lote e ainda tem gente na fila. */
  concluido: boolean;
  /** Como foi a conferencia na KOMMO que antecede o disparo. */
  kommo: ChecagemKommo;
  /** Quem ficou de fora por estar numa etapa bloqueante da KOMMO. */
  ignorados: Array<{ empresa: string; telefone: string; motivo: string }>;
  errors?: string[];
}

/**
 * Filtros da selecao de clientes de um disparo. O preview da tela e a execucao
 * real usam exatamente este mesmo objeto, entao o que aparece na lista e o que
 * e disparado nao podem divergir.
 */
export interface FiltroDisparo {
  /**
   * Dias alvo. Um cliente que esteja em mais de um dia selecionado entra na
   * lista uma vez so. Omitido = dia de hoje (comportamento do cron).
   */
  dias?: DiaSemana[];
  segmentos?: Segmento[];
  /** Nome do responsavel; "SEM_RESPONSAVEL" filtra quem esta sem dono. */
  responsaveis?: string[];
  /** Restringe a estes clientes (o que o usuario marcou na tela). */
  clienteIds?: string[];
  /** Busca por empresa, telefone ou cidade. */
  busca?: string;
  /** Inclui clientes desativados. Padrao: so ativos. */
  incluirInativos?: boolean;
  /**
   * Dispara mesmo com a checagem da KOMMO indisponivel ou com o cliente numa
   * etapa bloqueante. Escape hatch consciente — o padrao e nao disparar.
   */
  ignorarBloqueioKommo?: boolean;
  /**
   * Maximo de clientes neste lote. O resto volta em `restantes`, pra quem
   * chamou pedir o proximo. Sem limite, um disparo da base inteira leva
   * minutos e estoura o tempo maximo da funcao na Vercel.
   */
  limite?: number;
  /**
   * Pula quem ja recebeu disparo nesta semana. E o que faz um lote continuar
   * de onde o anterior parou sem mandar mensagem repetida.
   */
  pularJaDisparados?: boolean;
}

/** Como foi a consulta a KOMMO que antecede o disparo. */
export interface ChecagemKommo {
  ok: boolean;
  /** Mensagem do que deu errado, quando a consulta falhou. */
  erro: string | null;
  /** Etapas do funil que barram o disparo. */
  etapas: EtapaBloqueante[];
  /** Quantos clientes da lista foram barrados. */
  bloqueados: number;
  consultadoEm: Date | null;
}

export interface ClienteDoDisparo {
  id: string;
  empresa: string;
  contatoWhatsapp: string;
  segmento: Segmento;
  diasDisparo: DiaSemana[];
  responsavel: string | null;
  cidade: string | null;
  uf: string | null;
  ativo: boolean;
  kommoLeadId: number | null;
  ultimoPedidoEm: Date | null;
  ultimoPedidoValor: number | null;
  /** Status do disparo desta semana, se ja existir registro. */
  statusSemana: StatusDisparo | null;
  disparadoEm: Date | null;
  /** true quando o cliente ja recebeu disparo nesta semana. */
  jaDisparado: boolean;
  /**
   * true quando o cliente e publico de reenvio: recebeu o disparo desta semana
   * e nao deu retorno nem fechou pedido. Ver STATUS_SEM_RETORNO.
   */
  reenvio: boolean;
  /**
   * Nome da etapa da KOMMO que impede o disparo agora ("EM ATENDIMENTO",
   * "Pedido REALIZADO", "Pedido nao realizado"), ou null quando esta liberado.
   */
  bloqueioKommo: string | null;
}

/**
 * Status de quem recebeu a mensagem e ficou por isso mesmo. Sao os unicos que
 * podem levar um segundo disparo na mesma semana.
 *
 * Quem respondeu, fechou pedido, recusou ou foi pro suporte humano fica de
 * fora: mandar mensagem automatica por cima disso e o mesmo problema que as
 * etapas bloqueantes da KOMMO ja evitam, so que visto pelo banco.
 */
export const STATUS_SEM_RETORNO: StatusDisparo[] = [
  StatusDisparo.AGUARDANDO,
  StatusDisparo.DISPARADO,
  StatusDisparo.NAO_RESPONDEU,
];

export const SEM_RESPONSAVEL = "SEM_RESPONSAVEL";

/**
 * Resolve os dias alvo. Lista vazia so acontece quando nenhum dia foi pedido
 * e hoje e fim de semana.
 */
export function resolverDiasDisparo(filtro: FiltroDisparo = {}): DiaSemana[] {
  if (filtro.dias?.length) return ordenarDias(filtro.dias);
  const hoje = getDiaSemanaHoje();
  return hoje ? [hoje] : [];
}

const SEM_CHECAGEM: ChecagemKommo = {
  ok: true,
  erro: null,
  etapas: [],
  bloqueados: 0,
  consultadoEm: null,
};

/**
 * Lista os clientes que se encaixam no filtro, ja com o status desta semana e
 * com quem a KOMMO manda deixar de fora. Nao dispara nada — e a fonte do
 * preview e da execucao, entao o que aparece na tela e exatamente o que sai.
 */
export async function listarClientesParaDisparo(
  filtro: FiltroDisparo = {},
  opcoes: { forcarKommo?: boolean } = {}
): Promise<{
  dias: DiaSemana[];
  semanaInicio: Date;
  clientes: ClienteDoDisparo[];
  kommo: ChecagemKommo;
}> {
  const dias = resolverDiasDisparo(filtro);
  const semanaInicio = getInicioSemana();

  if (dias.length === 0) {
    return { dias, semanaInicio, clientes: [], kommo: SEM_CHECAGEM };
  }

  // hasSome: basta o cliente ter um dos dias pedidos. Quem tem varios entra
  // uma vez so — o disparo por cliente e semanal, nao por dia.
  const where: Record<string, unknown> = {
    diasDisparo: { hasSome: dias },
  };

  if (!filtro.incluirInativos) {
    where.ativo = true;
  }

  if (filtro.clienteIds?.length) {
    where.id = { in: filtro.clienteIds };
  }

  if (filtro.segmentos?.length) {
    where.segmento = { in: filtro.segmentos };
  }

  if (filtro.responsaveis?.length) {
    const semDono = filtro.responsaveis.includes(SEM_RESPONSAVEL);
    const nomes = filtro.responsaveis.filter((r) => r !== SEM_RESPONSAVEL);
    const alternativas: Record<string, unknown>[] = [];
    if (nomes.length) alternativas.push({ responsavel: { in: nomes } });
    if (semDono) alternativas.push({ responsavel: null }, { responsavel: "" });
    where.OR = alternativas;
  }

  if (filtro.busca?.trim()) {
    const busca = filtro.busca.trim();
    where.AND = [
      {
        OR: [
          { empresa: { contains: busca, mode: "insensitive" } },
          { contatoWhatsapp: { contains: busca, mode: "insensitive" } },
          { cidade: { contains: busca, mode: "insensitive" } },
        ],
      },
    ];
  }

  const clientes = await prisma.cliente.findMany({
    where,
    orderBy: { empresa: "asc" },
    select: {
      id: true,
      empresa: true,
      contatoWhatsapp: true,
      segmento: true,
      diasDisparo: true,
      responsavel: true,
      cidade: true,
      uf: true,
      ativo: true,
      kommoLeadId: true,
      ultimoPedidoEm: true,
      ultimoPedidoValor: true,
      disparos: {
        where: { semanaInicio },
        select: { status: true, disparadoEm: true },
        take: 1,
      },
    },
  });

  // Quem esta em conversa na KOMMO nao pode receber a mensagem automatica por
  // cima. A consulta e uma so pra lista inteira, nao uma por cliente.
  let bloqueios: Awaited<ReturnType<typeof carregarBloqueiosKommo>> | null = null;
  let kommo: ChecagemKommo = SEM_CHECAGEM;

  try {
    bloqueios = await carregarBloqueiosKommo({ forcar: opcoes.forcarKommo });
    kommo = {
      ok: true,
      erro: null,
      etapas: bloqueios.etapas,
      bloqueados: 0,
      consultadoEm: bloqueios.consultadoEm,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[disparo] Falha ao consultar a KOMMO:", msg);
    kommo = { ok: false, erro: msg, etapas: [], bloqueados: 0, consultadoEm: null };
  }

  const listados = clientes.map(({ disparos, ...cliente }) => {
    const disparoSemana = disparos[0] ?? null;

    // Cruza pelo lead ja conhecido e, principalmente, pelo telefone: quase
    // nenhum cliente tem kommoLeadId em cache.
    const chave = chaveTelefone(cliente.contatoWhatsapp);
    const bloqueioKommo =
      (cliente.kommoLeadId != null ? bloqueios?.porLeadId.get(cliente.kommoLeadId) : null) ??
      (chave ? bloqueios?.porTelefone.get(chave) : null) ??
      null;

    const jaDisparado = disparoSemana?.disparadoEm != null;

    return {
      ...cliente,
      statusSemana: disparoSemana?.status ?? null,
      disparadoEm: disparoSemana?.disparadoEm ?? null,
      jaDisparado,
      reenvio:
        jaDisparado && STATUS_SEM_RETORNO.includes(disparoSemana?.status ?? StatusDisparo.DISPARADO),
      bloqueioKommo,
    };
  });

  const bloqueados = listados.filter((c) => c.bloqueioKommo != null).length;

  return { dias, semanaInicio, clientes: listados, kommo: { ...kommo, bloqueados } };
}

/**
 * Dispara um único lead via n8n webhook (GET com query params).
 * Aguarda resposta síncrona do n8n (timeout: 25s).
 */
export async function dispararLeadViaWebhook(
  payload: WebhookDisparoPayload
): Promise<WebhookDisparoResponse> {
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25_000),
  });

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!res.ok) {
    throw new Error(`Webhook respondeu ${res.status}: ${text.slice(0, 200)}`);
  }

  return body as WebhookDisparoResponse;
}

/**
 * Executa os disparos: registra no banco e chama o n8n para cada cliente.
 * Sem filtro, dispara para todos os clientes ativos do dia de hoje — que e
 * como o cron chama.
 */
export async function executarDisparos(filtro: FiltroDisparo = {}): Promise<DisparoResult> {
  // forcarKommo: na hora de disparar a lista tem que ser a de agora, nao a que
  // o preview deixou no cache ha meio minuto.
  const { dias, semanaInicio, clientes, kommo } = await listarClientesParaDisparo(filtro, {
    forcarKommo: true,
  });

  if (dias.length === 0) {
    return {
      message: "Hoje é fim de semana",
      created: 0,
      webhook: { enviados: 0, falhas: 0, resultados: [] },
      leadsCriados: 0,
      restantes: 0,
      concluido: true,
      kommo,
      ignorados: [],
    };
  }

  const rotulo = dias.map((d) => DIA_LABELS[d] ?? d).join(", ");

  // Sem saber quem esta em atendimento, disparar e pior do que nao disparar:
  // a mensagem automatica atropelaria conversa aberta. Para tudo e avisa.
  if (!kommo.ok && !filtro.ignorarBloqueioKommo) {
    return {
      message:
        "Disparo cancelado: nao deu para conferir na KOMMO quem esta em atendimento. " +
        "Confira a integracao em Configuracoes e tente de novo.",
      created: 0,
      webhook: { enviados: 0, falhas: 0, resultados: [] },
      leadsCriados: 0,
      restantes: 0,
      concluido: true,
      kommo,
      ignorados: [],
      errors: [kommo.erro ?? "KOMMO indisponivel"],
    };
  }

  if (clientes.length === 0) {
    return {
      message: `Nenhum cliente programado para ${rotulo}`,
      created: 0,
      webhook: { enviados: 0, falhas: 0, resultados: [] },
      leadsCriados: 0,
      restantes: 0,
      concluido: true,
      kommo,
      ignorados: [],
    };
  }

  // Bloqueado pela KOMMO nao recebe e nao vira registro de Disparo: ele nao
  // foi disparado, entao nao pode entrar na conta da semana como se fosse.
  const ignorados = filtro.ignorarBloqueioKommo
    ? []
    : clientes
        .filter((c) => c.bloqueioKommo != null)
        .map((c) => ({
          empresa: c.empresa,
          telefone: c.contatoWhatsapp,
          motivo: c.bloqueioKommo as string,
        }));

  const elegiveis = (
    filtro.ignorarBloqueioKommo ? clientes : clientes.filter((c) => c.bloqueioKommo == null)
  ).filter((c) => !(filtro.pularJaDisparados && c.jaDisparado));

  // O lote e a fatia da vez; o resto volta como `restantes` pra quem chamou
  // pedir de novo.
  const limite = filtro.limite && filtro.limite > 0 ? filtro.limite : elegiveis.length;
  const liberados = elegiveis.slice(0, limite);
  const restantes = elegiveis.length - liberados.length;

  if (liberados.length === 0) {
    return {
      message: `Ninguem para disparar em ${rotulo}: todos os ${ignorados.length} estao em atendimento ou com pedido resolvido na KOMMO`,
      created: 0,
      webhook: { enviados: 0, falhas: 0, resultados: [] },
      leadsCriados: 0,
      restantes: 0,
      concluido: true,
      kommo,
      ignorados,
    };
  }

  // Mapa de telefone -> contato/lead da conta inteira, tirado uma vez so. E a
  // primeira camada da defesa contra criar cadastro repetido na KOMMO.
  //
  // So vale a pena montar se alguem do lote ainda nao tem lead conhecido: sao
  // ~32 paginas de contatos, uns 36s so de limitador. Quem ja tem kommoLeadId
  // nem chega a consultar o mapa, entao num lote inteiro em cache isso seria
  // meio minuto jogado fora por invocacao. O mapa vazio e seguro: quem nao esta
  // nele cai na busca ao vivo, que e justamente o passo que impede duplicata.
  const precisaDoMapa = liberados.some((c) => c.kommoLeadId == null);

  let mapa: Awaited<ReturnType<typeof carregarMapaKommo>>;
  let alvo: Awaited<ReturnType<typeof configDoDisparo>>;
  try {
    [mapa, alvo] = await Promise.all([
      precisaDoMapa
        ? carregarMapaKommo()
        : Promise.resolve({ porTelefone: new Map(), contatos: 0, consultadoEm: new Date() }),
      configDoDisparo(),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[disparo] Falha ao preparar a KOMMO:", msg);
    return {
      message: `Disparo cancelado: nao deu para preparar a KOMMO (${msg})`,
      created: 0,
      webhook: { enviados: 0, falhas: 0, resultados: [] },
      leadsCriados: 0,
      restantes: 0,
      concluido: true,
      kommo,
      ignorados,
      errors: [msg],
    };
  }

  const now = new Date();
  let created = 0;
  let leadsCriados = 0;
  const errors: string[] = [];
  const resultados: DisparoResult["webhook"]["resultados"] = [];

  for (const cliente of liberados) {
    // 1. Achar o lead do cliente na KOMMO, criando so em ultimo caso.
    //    Vem antes do registro no banco de proposito: sem lead nao ha o que o
    //    salesbot rode, entao nao houve disparo pra registrar.
    let lead: LeadResolvido;
    try {
      lead = await garantirLeadDoCliente(cliente, mapa, {
        pipelineId: alvo.pipelineId,
        statusId: alvo.statusNovoLead,
        tags: [TAG_CARTEIRA_OFICIAL],
      });
      if (lead.origem === "lead-novo" || lead.origem === "lead-e-contato-novos") {
        leadsCriados++;
        console.log(`[disparo] lead criado (${lead.origem}) para ${cliente.empresa}: ${lead.leadId}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[disparo] Sem lead para ${cliente.empresa}:`, msg);
      resultados.push({ empresa: cliente.empresa, lead_id: null, ok: false, erro: `lead: ${msg}` });
      continue;
    }

    // 1b. Guardar o lead ja, antes de tentar qualquer outra coisa.
    //     O id e fato desde que a KOMMO respondeu — nao depende do salesbot ter
    //     rodado. Guardando so depois, uma falha no bot perdia o id de um lead
    //     que existe, e o proximo lote iria procurar de novo: se nao achasse
    //     pelo telefone, criaria um lead duplicado na KOMMO.
    if (cliente.kommoLeadId !== lead.leadId) {
      try {
        await prisma.cliente.update({
          where: { id: cliente.id },
          data: { kommoLeadId: lead.leadId },
        });
      } catch (err) {
        // Cache perdido nao cancela disparo: o lead existe e o bot pode rodar.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[disparo] Nao guardei o lead de ${cliente.empresa}: ${msg}`);
      }
    }

    // 2. Upsert disparo no banco.
    //    So existe uma linha de Disparo por cliente por semana. Como um cliente
    //    pode ter varios dias, o segundo disparo da semana cairia por cima do
    //    primeiro — e apagaria um RESPONDEU/PEDIDO_CONFIRMADO ja registrado.
    //    Entao so mexemos no status enquanto ele ainda nao avancou no funil.
    const statusAvancou =
      cliente.statusSemana != null &&
      cliente.statusSemana !== StatusDisparo.AGUARDANDO &&
      cliente.statusSemana !== StatusDisparo.DISPARADO;

    try {
      await prisma.disparo.upsert({
        where: { clienteId_semanaInicio: { clienteId: cliente.id, semanaInicio } },
        create: {
          clienteId: cliente.id,
          semanaInicio,
          status: StatusDisparo.DISPARADO,
          disparadoEm: now,
        },
        update: {
          ...(statusAvancou ? {} : { status: StatusDisparo.DISPARADO }),
          disparadoEm: now,
        },
      });
      created++;
    } catch (err) {
      console.error(`Erro ao registrar disparo para ${cliente.empresa}:`, err);
      errors.push(`DB error: ${cliente.empresa}`);
      continue;
    }

    // 3. Rodar o SALESBOT no lead. E ele quem manda a mensagem.
    try {
      console.log(`[disparo] Salesbot ${alvo.botId} no lead ${lead.leadId} (${cliente.empresa})`);
      const resposta = await rodarSalesbot(lead.leadId, alvo.botId);

      resultados.push({
        empresa: cliente.empresa,
        lead_id: lead.leadId,
        ok: true,
        origem: lead.origem,
        resposta,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[disparo] Erro no salesbot para ${cliente.empresa}:`, msg);
      resultados.push({
        empresa: cliente.empresa,
        lead_id: lead.leadId,
        ok: false,
        origem: lead.origem,
        erro: msg,
      });
    }
  }

  const enviados = resultados.filter((r) => r.ok).length;
  const falhas = resultados.filter((r) => !r.ok).length;

  const sufixoIgnorados = ignorados.length
    ? ` — ${ignorados.length} fora por estar em atendimento ou com pedido resolvido`
    : "";

  const sufixoCriados = leadsCriados ? ` — ${leadsCriados} lead(s) criado(s) na KOMMO` : "";
  const sufixoRestantes = restantes ? ` — faltam ${restantes} no proximo lote` : "";

  return {
    message: `Disparos executados para ${rotulo}${sufixoIgnorados}${sufixoCriados}${sufixoRestantes}`,
    created,
    webhook: { enviados, falhas, resultados },
    leadsCriados,
    restantes,
    concluido: restantes === 0,
    kommo,
    ignorados,
    errors: errors.length ? errors : undefined,
  };
}
