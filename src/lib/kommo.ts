import { prisma } from "./prisma";

async function getConfig() {
  const config = await prisma.configuracao.findUnique({ where: { id: "default" } });
  if (!config?.kommoToken || !config?.kommoSubdomain) {
    throw new Error("KOMMO not configured. Go to Configurações to set up.");
  }
  return config;
}

/**
 * Uma consulta de bloqueio sao ~6 idas a KOMMO em sequencia. Sem repetir, um
 * unico soluco de rede em qualquer uma delas cancela o disparo do dia inteiro,
 * entao vale insistir antes de desistir.
 */
const TENTATIVAS = 3;
const ESPERA_BASE_MS = 600;
const TIMEOUT_MS = 20_000;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * O `fetch` do Node entrega so "fetch failed" e esconde o motivo em `cause`.
 * Sem desempilhar, o log nao diz se caiu DNS, conexao ou timeout.
 */
function descreverFalha(err: unknown): string {
  const partes: string[] = [];
  let atual: unknown = err;
  while (atual instanceof Error) {
    const codigo = (atual as { code?: string }).code;
    partes.push(codigo ? `${codigo}: ${atual.message}` : atual.message);
    atual = atual.cause;
  }
  return partes.join(" <- ") || String(err);
}

/** 429 e 5xx sao passageiros; 4xx e configuracao errada e nao melhora repetindo. */
function valeRepetir(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * A KOMMO corta em ~7 requisicoes por segundo e devolve 429 quando passa.
 * 4/s deixa folga pra quem mais fala com a conta ao mesmo tempo (n8n,
 * integracao do Bling) sem que a soma estoure o teto.
 */
const INTERVALO_ENTRE_CHAMADAS_MS = 250;

/**
 * Fila unica de saida: toda chamada passa por aqui, entao o espacamento vale
 * pro conjunto e nao por funcao. Sem isso, paginar contatos e rodar salesbot ao
 * mesmo tempo somaria as duas taxas e bateria no limite.
 */
let ultimaChamadaEm = 0;
let filaKommo: Promise<void> = Promise.resolve();

function aguardarVez(): Promise<void> {
  filaKommo = filaKommo.then(async () => {
    const espera = ultimaChamadaEm + INTERVALO_ENTRE_CHAMADAS_MS - Date.now();
    if (espera > 0) await dormir(espera);
    ultimaChamadaEm = Date.now();
  });
  return filaKommo;
}

async function kommoFetch(path: string, options: RequestInit = {}) {
  const config = await getConfig();
  const baseUrl = `https://${config.kommoSubdomain}.kommo.com`;

  // Strip any non-ASCII characters that may have been introduced by copy-paste
  // (e.g. bullet points, smart quotes, zero-width spaces) before setting headers.
  const cleanToken = (config.kommoToken ?? "").replace(/[^\x20-\x7E]/g, "").trim();

  let ultimoErro: Error = new Error("KOMMO: falha desconhecida");

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    // Segura o ritmo antes de cada ida, inclusive nas repeticoes.
    await aguardarVez();

    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        ...options,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
    } catch (err) {
      ultimoErro = new Error(`KOMMO inacessivel (${descreverFalha(err)})`, { cause: err });
      if (tentativa < TENTATIVAS) {
        console.warn(`[kommo] ${path} falhou (${tentativa}/${TENTATIVAS}): ${descreverFalha(err)}`);
        await dormir(ESPERA_BASE_MS * 2 ** (tentativa - 1));
        continue;
      }
      throw ultimoErro;
    }

    if (!res.ok) {
      const text = await res.text();
      ultimoErro = new Error(`KOMMO API ${res.status}: ${text}`);
      if (valeRepetir(res.status) && tentativa < TENTATIVAS) {
        console.warn(`[kommo] ${path} devolveu ${res.status} (${tentativa}/${TENTATIVAS})`);
        await dormir(ESPERA_BASE_MS * 2 ** (tentativa - 1));
        continue;
      }
      throw ultimoErro;
    }

    // Corpo vazio nao e erro: alem do 204 ("nenhum resultado"), a KOMMO aceita
    // acao sem ter o que devolver e responde 200 sem nada — /bots/{id}/run e
    // um desses. Parsear isso jogava "Unexpected end of JSON input" com a
    // mensagem ja enviada, marcando como falha um disparo que deu certo.
    if (res.status === 204) return null;
    const corpo = (await res.text()).trim();
    if (!corpo) return null;
    try {
      return JSON.parse(corpo);
    } catch {
      throw new Error(
        `KOMMO devolveu ${res.status} com corpo que nao e JSON: ${corpo.slice(0, 200)}`
      );
    }
  }

  throw ultimoErro;
}

export async function getKommoLeads(pipelineId?: string) {
  const params = new URLSearchParams({ limit: "250" });
  if (pipelineId) params.set("filter[pipeline_id]", pipelineId);
  return kommoFetch(`/api/v4/leads?${params}`);
}

export async function moveLeadToStatus(leadId: number, statusId: number, pipelineId: number) {
  return kommoFetch(`/api/v4/leads`, {
    method: "PATCH",
    body: JSON.stringify([{ id: leadId, pipeline_id: pipelineId, status_id: statusId }]),
  });
}

export async function createLeadComplex(data: {
  name: string;
  phone: string;
  pipelineId: number;
  statusId: number;
  tags?: string[];
}) {
  return kommoFetch(`/api/v4/leads/complex`, {
    method: "POST",
    body: JSON.stringify([
      {
        name: data.name,
        pipeline_id: data.pipelineId,
        status_id: data.statusId,
        _embedded: {
          tags: data.tags?.map((t) => ({ name: t })) || [],
          contacts: [
            {
              name: data.name,
              custom_fields_values: [
                {
                  field_code: "PHONE",
                  values: [{ value: data.phone, enum_code: "WORK" }],
                },
              ],
            },
          ],
        },
      },
    ]),
  });
}

export async function getKommoPipelines() {
  return kommoFetch(`/api/v4/leads/pipelines`);
}

/**
 * Normalize phone to digits only (strip +, spaces, dashes, parens).
 */
function normalizePhone(phone: string): string {
  return (phone || "").replace(/\D/g, "");
}

/**
 * Check if two phone numbers match. Handles Brazilian variations where
 * the 9th digit on mobile may or may not be present, and leading country
 * code may or may not be included. We compare by matching suffixes.
 */
function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Use the last 10 digits (DDD + number without 9th) as a stable suffix
  const suffix = (s: string) => s.slice(-10);
  return suffix(na) === suffix(nb);
}

interface KommoContactSearchResponse {
  _embedded?: {
    contacts?: Array<{
      id: number;
      name?: string;
      custom_fields_values?: Array<{
        field_code?: string;
        field_name?: string;
        values?: Array<{ value?: string }>;
      }> | null;
      _embedded?: {
        leads?: Array<{ id: number }>;
      };
    }>;
  };
}

/**
 * Chave estavel de telefone: DDD + os 8 ultimos digitos.
 *
 * O mesmo numero aparece ora com +55, ora sem, ora com o 9 na frente do
 * celular. Cortar nos 8 finais e manter o DDD tolera essas variacoes sem
 * juntar assinantes de estados diferentes que terminam igual.
 */
export function chaveTelefone(bruto: string | null | undefined): string | null {
  let digitos = (bruto ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (digitos.length > 11 && digitos.startsWith("55")) digitos = digitos.slice(2);
  if (digitos.length < 10) return null;
  return digitos.slice(0, 2) + digitos.slice(-8);
}

/**
 * Search KOMMO contacts by phone. Returns the first contact whose PHONE
 * custom field matches the given phone (by digit suffix). If the contact
 * has any linked leads, returns the first leadId as well.
 */
export async function findKommoLeadByPhone(phone: string): Promise<{
  contactId: number;
  leadId: number | null;
} | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  // KOMMO query searches across phone/email/name — pass the raw digits.
  const params = new URLSearchParams({
    query: normalized,
    with: "leads",
    limit: "50",
  });

  let data: KommoContactSearchResponse;
  try {
    data = await kommoFetch(`/api/v4/contacts?${params}`);
  } catch (err) {
    // KOMMO returns 204 (empty) when no contacts match — kommoFetch throws on non-ok
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("204")) return null;
    throw err;
  }

  const contacts = data?._embedded?.contacts ?? [];
  if (contacts.length === 0) return null;

  for (const contact of contacts) {
    const fields = contact.custom_fields_values ?? [];
    const phoneField = fields.find((f) => f?.field_code === "PHONE");
    if (!phoneField?.values) continue;

    const hasMatch = phoneField.values.some((v) =>
      v?.value ? phonesMatch(v.value, phone) : false
    );
    if (!hasMatch) continue;

    const leadId = contact._embedded?.leads?.[0]?.id ?? null;
    return { contactId: contact.id, leadId };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Bloqueio de disparo por etapa do funil
//
// Cliente que esta em conversa (ou que ja resolveu o pedido da semana) nao pode
// receber a mensagem automatica por cima. Antes de disparar, o sistema carrega
// da KOMMO quem esta nessas etapas e tira essa gente da lista.
// ---------------------------------------------------------------------------

/** Etapas do funil que impedem um novo disparo, por nome normalizado. */
const ETAPAS_BLOQUEANTES = new Set([
  "em atendimento",
  "pedido realizado",
  "pedido nao realizado",
]);

function normalizarNome(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface EtapaBloqueante {
  id: number;
  nome: string;
}

export interface BloqueiosKommo {
  /** chaveTelefone -> nome da etapa que bloqueia. */
  porTelefone: Map<string, string>;
  /** id do lead na KOMMO -> nome da etapa que bloqueia. */
  porLeadId: Map<number, string>;
  /** Etapas efetivamente encontradas no funil. */
  etapas: EtapaBloqueante[];
  /** Quantos leads a KOMMO devolveu nessas etapas. */
  leads: number;
  consultadoEm: Date;
}

interface LeadDaKommo {
  id: number;
  status_id: number;
  _embedded?: { contacts?: { id: number }[] };
}

interface ContatoDaKommo {
  id: number;
  custom_fields_values?: Array<{
    field_code?: string;
    values?: Array<{ value?: string }>;
  }> | null;
}

/**
 * Descobre no funil quais etapas bloqueiam o disparo.
 *
 * A busca e pelo nome da etapa, nao por id fixo: assim o dia em que alguem
 * recriar a coluna na KOMMO o sistema continua achando. Da pra fixar ids na
 * mao em Configuracoes > kommoStatusIds.bloqueados quando o nome mudar.
 */
export async function resolverEtapasBloqueantes(): Promise<EtapaBloqueante[]> {
  const config = await getConfig();
  const data = await getKommoPipelines();
  const funis: Array<{
    id: number;
    is_main?: boolean;
    _embedded?: { statuses?: Array<{ id: number; name: string }> };
  }> = data?._embedded?.pipelines ?? [];

  const idConfigurado = config.kommoPipelineId ? Number(config.kommoPipelineId) : null;
  const funil =
    funis.find((f) => idConfigurado != null && f.id === idConfigurado) ??
    funis.find((f) => f.is_main) ??
    funis[0];

  if (!funil) throw new Error("KOMMO nao devolveu nenhum funil.");

  const etapas = funil._embedded?.statuses ?? [];

  // Override manual: kommoStatusIds.bloqueados = [id, id, ...]
  const ids = (config.kommoStatusIds as { bloqueados?: unknown } | null)?.bloqueados;
  if (Array.isArray(ids) && ids.length > 0) {
    const querIds = new Set(ids.map((v) => Number(v)).filter((n) => Number.isFinite(n)));
    return etapas
      .filter((e) => querIds.has(e.id))
      .map((e) => ({ id: e.id, nome: e.name }));
  }

  return etapas
    .filter((e) => ETAPAS_BLOQUEANTES.has(normalizarNome(e.name)))
    .map((e) => ({ id: e.id, nome: e.name }));
}

/** Busca todas as paginas de um recurso da KOMMO. */
async function buscarTodasPaginas<T>(
  montarUrl: (pagina: number) => string,
  extrair: (data: Record<string, unknown>) => T[],
  maxPaginas = 40
): Promise<T[]> {
  const itens: T[] = [];
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const data = await kommoFetch(montarUrl(pagina));
    if (!data) break;
    itens.push(...extrair(data));
    const links = data._links as { next?: unknown } | undefined;
    if (!links?.next) break;
  }
  return itens;
}

let cacheBloqueios: { valor: BloqueiosKommo; expiraEm: number } | null = null;

/** Meio minuto: segura a rajada da tela sem deixar a lista velha na hora de disparar. */
const TTL_CACHE_MS = 30_000;

/**
 * Carrega da KOMMO quem nao pode receber disparo agora.
 *
 * Sao 2 idas a API por lote: primeiro os leads nas etapas bloqueantes, depois
 * os contatos deles em blocos, pra pegar o telefone. Cruzar por telefone e o
 * que importa — hoje quase nenhum cliente tem o kommoLeadId em cache no banco.
 */
export async function carregarBloqueiosKommo(
  opcoes: { forcar?: boolean } = {}
): Promise<BloqueiosKommo> {
  if (!opcoes.forcar && cacheBloqueios && cacheBloqueios.expiraEm > Date.now()) {
    return cacheBloqueios.valor;
  }

  const etapas = await resolverEtapasBloqueantes();
  const porTelefone = new Map<string, string>();
  const porLeadId = new Map<number, string>();

  if (etapas.length === 0) {
    throw new Error(
      "Nenhuma etapa de bloqueio encontrada no funil da KOMMO " +
        "(esperado: EM ATENDIMENTO, Pedido REALIZADO, Pedido nao realizado)."
    );
  }

  const config = await getConfig();
  const pipelineId = config.kommoPipelineId ?? "";

  const leads = await buscarTodasPaginas<LeadDaKommo>(
    (pagina) => {
      const params = new URLSearchParams({
        limit: "250",
        page: String(pagina),
        with: "contacts",
      });
      etapas.forEach((etapa, i) => {
        if (pipelineId) params.set(`filter[statuses][${i}][pipeline_id]`, pipelineId);
        params.set(`filter[statuses][${i}][status_id]`, String(etapa.id));
      });
      return `/api/v4/leads?${params}`;
    },
    (data) => ((data._embedded as { leads?: LeadDaKommo[] })?.leads ?? [])
  );

  const nomeDaEtapa = new Map(etapas.map((e) => [e.id, e.nome]));
  const etapaDoContato = new Map<number, string>();

  for (const lead of leads) {
    const etapa = nomeDaEtapa.get(lead.status_id);
    if (!etapa) continue;
    porLeadId.set(lead.id, etapa);
    for (const contato of lead._embedded?.contacts ?? []) {
      etapaDoContato.set(contato.id, etapa);
    }
  }

  // Telefone so vem no contato, entao busca em bloco pelos ids ja conhecidos.
  const idsContatos = [...etapaDoContato.keys()];
  const TAMANHO_BLOCO = 250;
  for (let i = 0; i < idsContatos.length; i += TAMANHO_BLOCO) {
    const bloco = idsContatos.slice(i, i + TAMANHO_BLOCO);
    const params = new URLSearchParams({ limit: String(TAMANHO_BLOCO) });
    bloco.forEach((id) => params.append("filter[id][]", String(id)));

    const data = await kommoFetch(`/api/v4/contacts?${params}`);
    const contatos: ContatoDaKommo[] = data?._embedded?.contacts ?? [];

    for (const contato of contatos) {
      const etapa = etapaDoContato.get(contato.id);
      if (!etapa) continue;
      const campo = (contato.custom_fields_values ?? []).find((f) => f?.field_code === "PHONE");
      for (const valor of campo?.values ?? []) {
        const chave = chaveTelefone(valor?.value);
        if (chave) porTelefone.set(chave, etapa);
      }
    }
  }

  const valor: BloqueiosKommo = {
    porTelefone,
    porLeadId,
    etapas,
    leads: leads.length,
    consultadoEm: new Date(),
  };
  cacheBloqueios = { valor, expiraEm: Date.now() + TTL_CACHE_MS };
  return valor;
}

/** Zera o cache — util em teste e depois de mexer na configuracao. */
export function limparCacheBloqueiosKommo() {
  cacheBloqueios = null;
}

// ---------------------------------------------------------------------------
// Disparo pelo SALESBOT
//
// O app acha (ou cria) o lead do cliente na KOMMO e manda o salesbot rodar
// nele. O bot e quem fala com o cliente — nada aqui manda mensagem direto.
// ---------------------------------------------------------------------------

/** "[NUNCA MEXER] Disparo de mensagem". Da pra trocar em kommoStatusIds.botDisparo. */
export const BOT_DISPARO_PADRAO = 65200;

/** Etapa onde nasce o lead criado pelo disparo. */
export const ETAPA_NOVO_LEAD_PADRAO = 109428119; // DISPARO REALIZADO

/** Todo lead criado pelo disparo entra na KOMMO com esta tag. */
export const TAG_CARTEIRA_OFICIAL = "Carteira oficial";

export interface AchadoKommo {
  contatoId: number;
  /** null quando o contato existe mas nao tem lead nenhum vinculado. */
  leadId: number | null;
  nome: string;
}

export interface MapaKommo {
  /** chaveTelefone -> o que a KOMMO ja tem para aquele numero. */
  porTelefone: Map<string, AchadoKommo>;
  contatos: number;
  consultadoEm: Date;
}

let cacheMapa: { valor: MapaKommo; expiraEm: number } | null = null;

/**
 * Quinze minutos: sao ~32 paginas de contato, uns 36s so de limitador, e um
 * disparo grande vai em varios lotes e varias invocacoes. Com cinco minutos o
 * mapa vencia no meio de uma corrida de segunda-feira e era remontado do zero;
 * quinze cobre a corrida inteira numa instancia quente.
 *
 * Ficar velho nao cria duplicata — quem nao esta no mapa ainda passa pela busca
 * ao vivo antes de qualquer cadastro ser criado.
 */
const TTL_MAPA_MS = 15 * 60_000;

/**
 * Varre TODOS os contatos da conta e monta o mapa telefone -> contato/lead.
 *
 * Varre contato, e nao lead, de proposito: a conta tem milhares de contatos
 * sem lead nenhum. Quem olha so a lista de leads acha que o cliente nao existe,
 * cria um lead novo com contato novo e deixa dois cadastros do mesmo numero.
 */
export async function carregarMapaKommo(opcoes: { forcar?: boolean } = {}): Promise<MapaKommo> {
  if (!opcoes.forcar && cacheMapa && cacheMapa.expiraEm > Date.now()) {
    return cacheMapa.valor;
  }

  const porTelefone = new Map<string, AchadoKommo>();
  let total = 0;

  for (let pagina = 1; pagina <= 60; pagina++) {
    const data = await kommoFetch(`/api/v4/contacts?limit=250&page=${pagina}&with=leads`);
    if (!data) break;

    const contatos: Array<{
      id: number;
      name?: string;
      custom_fields_values?: Array<{
        field_code?: string;
        values?: Array<{ value?: string }>;
      }> | null;
      _embedded?: { leads?: Array<{ id: number }> };
    }> = data._embedded?.contacts ?? [];

    for (const contato of contatos) {
      total++;
      const campo = (contato.custom_fields_values ?? []).find((f) => f?.field_code === "PHONE");
      const leadId = contato._embedded?.leads?.[0]?.id ?? null;

      for (const valor of campo?.values ?? []) {
        const chave = chaveTelefone(valor?.value);
        if (!chave) continue;
        const jaTem = porTelefone.get(chave);
        // Contato com lead ganha de contato solto: e o cadastro mais completo.
        if (!jaTem || (jaTem.leadId == null && leadId != null)) {
          porTelefone.set(chave, { contatoId: contato.id, leadId, nome: contato.name ?? "" });
        }
      }
    }

    if (!data._links?.next) break;
  }

  const valor: MapaKommo = { porTelefone, contatos: total, consultadoEm: new Date() };
  cacheMapa = { valor, expiraEm: Date.now() + TTL_MAPA_MS };
  return valor;
}

/**
 * Registra no mapa um lead recem-criado, pra um lote seguinte nao precisar
 * descobrir de novo pela busca ao vivo.
 */
export function anotarNoMapa(mapa: MapaKommo, telefone: string, achado: AchadoKommo) {
  const chave = chaveTelefone(telefone);
  if (chave) mapa.porTelefone.set(chave, achado);
}

/** Cria um lead amarrado a um contato que ja existe — nao duplica o contato. */
async function criarLeadParaContato(dados: {
  nome: string;
  contatoId: number;
  pipelineId: number;
  statusId: number;
  tags: string[];
}): Promise<number> {
  const data = await kommoFetch(`/api/v4/leads`, {
    method: "POST",
    body: JSON.stringify([
      {
        name: dados.nome,
        pipeline_id: dados.pipelineId,
        status_id: dados.statusId,
        _embedded: {
          tags: dados.tags.map((name) => ({ name })),
          contacts: [{ id: dados.contatoId }],
        },
      },
    ]),
  });

  const id = data?._embedded?.leads?.[0]?.id;
  if (typeof id !== "number") {
    throw new Error(`KOMMO nao devolveu id do lead criado: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return id;
}

/** Cria lead + contato de uma vez, para quem nao existe de jeito nenhum. */
async function criarLeadComContato(dados: {
  nome: string;
  telefone: string;
  pipelineId: number;
  statusId: number;
  tags: string[];
}): Promise<number> {
  const data = await kommoFetch(`/api/v4/leads/complex`, {
    method: "POST",
    body: JSON.stringify([
      {
        name: dados.nome,
        pipeline_id: dados.pipelineId,
        status_id: dados.statusId,
        _embedded: {
          tags: dados.tags.map((name) => ({ name })),
          contacts: [
            {
              name: dados.nome,
              custom_fields_values: [
                { field_code: "PHONE", values: [{ value: dados.telefone, enum_code: "WORK" }] },
              ],
            },
          ],
        },
      },
    ]),
  });

  const id = Array.isArray(data) ? data[0]?.id : data?._embedded?.leads?.[0]?.id;
  if (typeof id !== "number") {
    throw new Error(`KOMMO nao devolveu id do lead criado: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return id;
}

export type OrigemLead = "cache" | "mapa" | "busca" | "lead-novo" | "lead-e-contato-novos";

export interface LeadResolvido {
  leadId: number;
  /** De onde veio, pra dar pra auditar depois o que foi criado. */
  origem: OrigemLead;
  contatoId: number | null;
}

/**
 * Devolve o lead do cliente na KOMMO, criando so quando ele realmente nao
 * existe.
 *
 * Antes de criar qualquer coisa a checagem passa por camadas, da mais barata
 * pra mais cara: o cache do banco, o mapa de contatos da conta inteira e uma
 * busca ao vivo pelo numero. A busca ao vivo existe porque o mapa e tirado uma
 * vez no comeco do lote e pode envelhecer no meio dele — sem ela, dois
 * disparos seguidos criariam o mesmo cadastro duas vezes.
 */
export async function garantirLeadDoCliente(
  cliente: { empresa: string; contatoWhatsapp: string; kommoLeadId: number | null },
  mapa: MapaKommo,
  opcoes: { pipelineId: number; statusId: number; tags?: string[] }
): Promise<LeadResolvido> {
  const tags = opcoes.tags ?? [TAG_CARTEIRA_OFICIAL];

  // 1. Ja sabemos o lead desse cliente.
  if (cliente.kommoLeadId != null) {
    return { leadId: cliente.kommoLeadId, origem: "cache", contatoId: null };
  }

  const chave = chaveTelefone(cliente.contatoWhatsapp);

  // 2. O mapa da conta inteira.
  const doMapa = chave ? mapa.porTelefone.get(chave) : undefined;
  if (doMapa?.leadId != null) {
    return { leadId: doMapa.leadId, origem: "mapa", contatoId: doMapa.contatoId };
  }

  // 3. Busca ao vivo pelo numero, pra nao criar em cima de algo recem-criado.
  const aoVivo = await findKommoLeadByPhone(cliente.contatoWhatsapp);
  if (aoVivo?.leadId != null) {
    return { leadId: aoVivo.leadId, origem: "busca", contatoId: aoVivo.contactId };
  }

  // 4. Existe contato mas nenhum lead: pendura o lead novo no contato de sempre.
  const contatoId = aoVivo?.contactId ?? doMapa?.contatoId ?? null;

  if (contatoId != null) {
    const leadId = await criarLeadParaContato({
      nome: cliente.empresa,
      contatoId,
      pipelineId: opcoes.pipelineId,
      statusId: opcoes.statusId,
      tags,
    });
    // Volta pro mapa: o proximo lote acha aqui em vez de bater na KOMMO.
    anotarNoMapa(mapa, cliente.contatoWhatsapp, { contatoId, leadId, nome: cliente.empresa });
    return { leadId, origem: "lead-novo", contatoId };
  }

  // 5. Nao existe nada: cria lead e contato.
  const leadId = await criarLeadComContato({
    nome: cliente.empresa,
    telefone: cliente.contatoWhatsapp,
    pipelineId: opcoes.pipelineId,
    statusId: opcoes.statusId,
    tags,
  });
  anotarNoMapa(mapa, cliente.contatoWhatsapp, { contatoId: 0, leadId, nome: cliente.empresa });
  return { leadId, origem: "lead-e-contato-novos", contatoId: null };
}

/**
 * Manda o salesbot rodar num lead. E ele quem fala com o cliente.
 *
 * POST /api/v4/bots/{bot}/run  { entity_id, entity_type: "leads" }
 */
export async function rodarSalesbot(leadId: number, botId: number = BOT_DISPARO_PADRAO) {
  return kommoFetch(`/api/v4/bots/${botId}/run`, {
    method: "POST",
    body: JSON.stringify({ entity_id: leadId, entity_type: "leads" }),
  });
}

/** Ids do funil usados pelo disparo: os padroes, com override pela config. */
export async function configDoDisparo(): Promise<{
  pipelineId: number;
  statusNovoLead: number;
  botId: number;
}> {
  const config = await getConfig();
  const ids = (config.kommoStatusIds ?? {}) as { novoLead?: unknown; botDisparo?: unknown };

  const numero = (valor: unknown, padrao: number) => {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? n : padrao;
  };

  const pipelineId = numero(config.kommoPipelineId, 0);
  if (!pipelineId) throw new Error("kommoPipelineId nao configurado.");

  return {
    pipelineId,
    statusNovoLead: numero(ids.novoLead, ETAPA_NOVO_LEAD_PADRAO),
    botId: numero(ids.botDisparo, BOT_DISPARO_PADRAO),
  };
}
