/**
 * Leitura da planilha de carteira de disparo — o modelo padrao de importacao
 * de clientes.
 *
 * O formato de referencia e o que as vendedoras ja usam no dia a dia:
 *
 *     PLANILHA DE DISPAROS
 *
 *     RESPONSAVEL: CRIS
 *     Nº | Dia da semana | Repetir disparo | Contato | Clientes | Cidade
 *     1º | SEGUNDA       |                 | 55 81 9...| MERCADINHO X | RECIFE
 *
 * Nada aqui depende da posicao das colunas: o cabecalho e procurado nas
 * primeiras linhas e cada rotulo e casado por apelido. Por isso a planilha de
 * colunas nomeadas (empresa, contato_whatsapp, dias_disparo, ...) continua
 * sendo lida pelo mesmo caminho — e so outro conjunto de apelidos.
 */

import * as XLSX from "xlsx";
import { Segmento, type DiaSemana } from "@/generated/prisma/enums";
import { cleanCnpjCpf, isValidCnpjCpfFormat, ordenarDias, parseDiasDisparo } from "@/lib/utils";

/** Campos que o importador sabe extrair de uma planilha. */
export type CampoCarteira =
  | "empresa"
  | "contato"
  | "dias"
  | "repetir"
  | "segmento"
  | "cidade"
  | "uf"
  | "cnpjCpf"
  | "responsavel";

/**
 * Rotulo de coluna (ja normalizado) -> campo. Cobre tanto a carteira de
 * disparo quanto o formato antigo de colunas nomeadas.
 */
const APELIDOS_COLUNA: Record<string, CampoCarteira> = {
  // quem e o cliente
  clientes: "empresa",
  cliente: "empresa",
  empresa: "empresa",
  empresas: "empresa",
  estabelecimento: "empresa",
  nome: "empresa",
  "nome do cliente": "empresa",
  "nome fantasia": "empresa",
  "razao social": "empresa",

  // telefone
  contato: "contato",
  contatos: "contato",
  "contato whatsapp": "contato",
  whatsapp: "contato",
  "whats app": "contato",
  telefone: "contato",
  "telefone whatsapp": "contato",
  fone: "contato",
  celular: "contato",
  numero: "contato",

  // dia principal
  "dia da semana": "dias",
  "dias da semana": "dias",
  dia: "dias",
  dias: "dias",
  "dia disparo": "dias",
  "dias disparo": "dias",
  "dia de disparo": "dias",
  "dias de disparo": "dias",
  "dia do disparo": "dias",
  "dias do disparo": "dias",

  // dia extra — soma no mesmo cliente
  "repetir disparo": "repetir",
  repetir: "repetir",
  "repeticao": "repetir",
  "segundo disparo": "repetir",
  "2 disparo": "repetir",
  "2o disparo": "repetir",

  segmento: "segmento",
  ramo: "segmento",
  categoria: "segmento",

  cidade: "cidade",
  municipio: "cidade",
  praca: "cidade",

  uf: "uf",
  estado: "uf",

  "cnpj cpf": "cnpjCpf",
  cnpj: "cnpjCpf",
  cpf: "cnpjCpf",
  documento: "cnpjCpf",

  responsavel: "responsavel",
  vendedor: "responsavel",
  vendedora: "responsavel",
  consultor: "responsavel",
  consultora: "responsavel",
};

const SEGMENTOS_POR_APELIDO: Record<string, Segmento> = {
  restaurante: Segmento.RESTAURANTE,
  hotelaria: Segmento.HOTELARIA,
  hotel: Segmento.HOTELARIA,
  academia: Segmento.ACADEMIA,
  distribuidor: Segmento.DISTRIBUIDOR,
  franquia: Segmento.FRANQUIA,
  eventos: Segmento.EVENTOS,
  evento: Segmento.EVENTOS,
  outro: Segmento.OUTRO,
  outros: Segmento.OUTRO,
};

/** Por que uma linha da planilha ficou de fora. */
export type MotivoDescarte =
  | "sem_empresa"
  | "telefone_invalido"
  | "sem_dia"
  | "cnpj_invalido"
  | "duplicado_na_planilha";

/** O que fez duas linhas serem consideradas o mesmo cliente. */
export type CriterioDuplicata = "telefone" | "documento" | "nome";

export const ROTULO_CRITERIO: Record<CriterioDuplicata, string> = {
  telefone: "mesmo telefone",
  documento: "mesmo CNPJ/CPF",
  nome: "mesmo nome",
};

export interface LinhaDescartada {
  /** Numero da linha como aparece no Excel. */
  linha: number;
  empresa: string;
  motivo: MotivoDescarte;
  /** Frase pronta pra mostrar pro usuario. */
  detalhe: string;
}

export interface RegistroCarteira {
  linha: number;
  empresa: string;
  contatoWhatsapp: string;
  diasDisparo: DiaSemana[];
  segmento: Segmento;
  /** true quando o segmento saiu do palpite pelo nome, nao de uma coluna. */
  segmentoInferido: boolean;
  cidade: string | null;
  uf: string | null;
  cnpjCpf: string | null;
  /** Responsavel vindo da coluna da linha, quando a planilha tem uma. */
  responsavel: string | null;
}

export interface LeituraCarteira {
  aba: string;
  /** Linha do cabecalho no Excel. */
  linhaCabecalho: number;
  /** Campo -> rotulo original encontrado, pra mostrar o que foi reconhecido. */
  colunas: Partial<Record<CampoCarteira, string>>;
  /** Nome achado num "RESPONSAVEL: X" acima do cabecalho. */
  responsavelPlanilha: string | null;
  /** Linhas de dados consideradas (ja sem as vazias do fim da planilha). */
  totalLinhas: number;
  registros: RegistroCarteira[];
  descartadas: LinhaDescartada[];
}

/** Planilha que nao da pra ler — a mensagem vai direto pro usuario. */
export class ErroPlanilha extends Error {}

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  // Telefone digitado sem mascara vira numero no Excel. Convertido pelo texto
  // formatado da celula ele sai como "5.58199E+12" e o cadastro se perde, por
  // isso a leitura e crua e a conversao acontece aqui.
  if (typeof valor === "number") {
    return Number.isInteger(valor) ? valor.toFixed(0) : String(valor);
  }
  return String(valor).replace(/\s+/g, " ").trim();
}

/** Tira acento, pontuacao e caixa pra casar rotulo de coluna por apelido. */
function normalizarRotulo(valor: unknown): string {
  return texto(valor)
    .normalize("NFD") // separa a letra do acento pra remover so o acento
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Telefone no formato que o disparo usa: 55 + DDD + numero.
 * Devolve null quando falta DDD ou sobra/falta digito — quem chama reporta a
 * linha em vez de gravar um numero que nao existe.
 */
export function normalizarTelefone(bruto: string): string | null {
  let digitos = bruto.replace(/\D/g, "").replace(/^0+/, "");
  if (!digitos) return null;
  if (digitos.length > 11 && digitos.startsWith("55")) digitos = digitos.slice(2);
  if (digitos.length === 10 || digitos.length === 11) return "55" + digitos;
  return null;
}

/** Campos que identificam um cliente, seja ele linha de planilha ou cadastro. */
export interface ChavesDuplicata {
  empresa: string;
  contatoWhatsapp: string;
  cnpjCpf?: string | null;
  cidade?: string | null;
}

/**
 * Ultimos 8 digitos do telefone. E por eles que dois numeros sao comparados:
 * a mesma linha aparece nas planilhas ora com o 9 na frente, ora com +55, ora
 * sem — o sufixo e a unica parte que nao muda.
 */
function sufixoTelefone(valor: string): string | null {
  const digitos = valor.replace(/\D/g, "");
  return digitos.length >= 8 ? digitos.slice(-8) : null;
}

/** "Padaria São José " e "PADARIA SAO JOSE" viram a mesma chave. */
function chaveNome(valor: string | null | undefined): string {
  return normalizarRotulo(valor).replace(/ /g, "");
}

/**
 * Guarda clientes ja conhecidos e responde se um novo registro e repetido.
 *
 * Serve pros dois lados da importacao: contra o banco (quem ja esta cadastrado)
 * e contra a propria planilha (a mesma empresa listada duas vezes).
 */
export class IndiceDuplicatas<T extends ChavesDuplicata> {
  private porTelefone = new Map<string, T>();
  private porDocumento = new Map<string, T>();
  private porNome = new Map<string, T[]>();

  constructor(itens: readonly T[] = []) {
    for (const item of itens) this.adicionar(item);
  }

  /** Repetido nao sobrescreve: quem entra primeiro e o dono da chave. */
  adicionar(item: T) {
    const telefone = sufixoTelefone(item.contatoWhatsapp);
    if (telefone && !this.porTelefone.has(telefone)) this.porTelefone.set(telefone, item);

    const documento = cleanCnpjCpf(item.cnpjCpf);
    if (documento && !this.porDocumento.has(documento)) this.porDocumento.set(documento, item);

    const nome = chaveNome(item.empresa);
    if (nome) {
      const lista = this.porNome.get(nome);
      if (lista) lista.push(item);
      else this.porNome.set(nome, [item]);
    }
  }

  /** Devolve o cadastro repetido e o que denunciou a repeticao, ou null. */
  buscar(item: ChavesDuplicata): { existente: T; criterio: CriterioDuplicata } | null {
    const telefone = sufixoTelefone(item.contatoWhatsapp);
    const porTelefone = telefone ? this.porTelefone.get(telefone) : undefined;
    if (porTelefone) return { existente: porTelefone, criterio: "telefone" };

    const documento = cleanCnpjCpf(item.cnpjCpf);
    const porDocumento = documento ? this.porDocumento.get(documento) : undefined;
    if (porDocumento) return { existente: porDocumento, criterio: "documento" };

    // Nome igual so conta quando as cidades batem (ou quando uma das duas nao
    // informa cidade): a "PADARIA CENTRAL" de Recife e a de Caruaru sao dois
    // clientes, e barrar a segunda seria pior do que deixar entrar.
    const cidade = chaveNome(item.cidade);
    for (const candidato of this.porNome.get(chaveNome(item.empresa)) ?? []) {
      const outraCidade = chaveNome(candidato.cidade);
      if (!cidade || !outraCidade || cidade === outraCidade) {
        return { existente: candidato, criterio: "nome" };
      }
    }

    return null;
  }
}

/** Escola, pedreira, orgao: cliente que nao cabe em nenhum outro rotulo. */
const NOME_INSTITUCIONAL =
  /colegio|colégio|escola|livraria|instituto|federa|arquidioces|movimento pro|pedreira|mineraç|mineracao|associacao|associação|posto\b|farmacia|farmácia|clinica|clínica|hospital|laborator/;

const NOME_HOTELARIA = /hotel|pousada|resort|hostel|motel|catamaran|acampamento|flat\b/;
const NOME_ACADEMIA = /academia|fitness|gym|crossfit|pilates|nutrir|nutri\b/;
const NOME_EVENTOS = /evento|buffet|bufe|recep|festa|salao de|salão de|chacara|chácara/;
const NOME_FRANQUIA = /franquia|franchis/;

const NOME_DISTRIBUIDOR =
  /distribuidor|atacad|represent|mercadinho|mercado|supermerc|super mix|deposito|depósito|bebida|conveni|hortifruti|frios|polpas|alimentos|frigorific|acoug|açoug|revended/;

/** Comida em geral. O grosso da base e food service, entao a lista e larga. */
const NOME_RESTAURANTE =
  /restaurante|restaurant|retsurante|lanchonete|lanche|pizza|pizzeri|churrasc|refei|self.?service|espetinho|burguer|burger|burg\b|hamburg|sushi|nikko|fusion|padaria|panificad|panifica|paes|pães|pao\b|pão|salgad|salgat|coxinha|esfih|esfir|tapioca|creperia|crepe|acai|açai|açaí|sorvet|sovete|gelato|chocolat|brigade|cacau|\bbar\b|boteco|botequim|barteco|beer|\bpub\b|chop|cantina|comedoria|forneria|cafe|café|coffee|bistro|bistrô|comida|cozinha|gastronom|grill|gril\b|galet|espeto|caldo|caldinho|pastel|pastei|pastéi|sabor|petisc|gastrobar|doce|delicia|delícia|delicates|\bdeli\b|emporio|empório|gourmet|fondue|camarao|camarão|guaiamum|feijoada|feijao|feijão|tempero|point|quiosque|food|chicken|marisq|peixad|peixaria|sanduich|sanduích|tabern|adega|picanha|brasa|costel|\bribs\b|carne|charque|rabada|panelada|leitao|leitão|calzone|kalzone|empada|massa|trigo|\bbake\b|rancho|gaucho|gaúcho|\bboi\b|bode|matuto|\bmate\b|almoco|almoço|delivery|casa de|casa do|casa da/;

/**
 * Palpite de segmento pelo nome, usado quando a planilha nao traz a coluna.
 * E so um chute: nome proprio sem pista nenhuma cai em OUTRO de proposito,
 * em vez de virar RESTAURANTE por padrao.
 */
export function chutarSegmento(nome: string): Segmento {
  const n = nome.toLowerCase();

  // O rotulo institucional so vale quando nao ha pista de comida no nome:
  // muita cantina e churrascaria cita o colegio ou o hospital vizinho
  // ("PONTO GAUCHO - AO LADO DO HOSPITAL") e nem por isso deixa de ser
  // restaurante.
  if (NOME_INSTITUCIONAL.test(n) && !NOME_RESTAURANTE.test(n)) return Segmento.OUTRO;

  if (NOME_HOTELARIA.test(n)) return Segmento.HOTELARIA;
  if (NOME_ACADEMIA.test(n)) return Segmento.ACADEMIA;
  if (NOME_EVENTOS.test(n)) return Segmento.EVENTOS;
  if (NOME_FRANQUIA.test(n)) return Segmento.FRANQUIA;
  if (NOME_DISTRIBUIDOR.test(n)) return Segmento.DISTRIBUIDOR;
  if (NOME_RESTAURANTE.test(n)) return Segmento.RESTAURANTE;

  return Segmento.OUTRO;
}

/** Acha a linha de cabecalho e mapeia cada campo pra um indice de coluna. */
function acharCabecalho(matriz: unknown[][]) {
  const limite = Math.min(matriz.length, 30);

  let melhor: { linha: number; indices: Partial<Record<CampoCarteira, number>>; rotulos: Partial<Record<CampoCarteira, string>> } | null =
    null;

  for (let i = 0; i < limite; i++) {
    const indices: Partial<Record<CampoCarteira, number>> = {};
    const rotulos: Partial<Record<CampoCarteira, string>> = {};

    matriz[i].forEach((celula, coluna) => {
      const campo = APELIDOS_COLUNA[normalizarRotulo(celula)];
      // Coluna repetida nao sobrescreve: vale a primeira ocorrencia.
      if (campo && indices[campo] === undefined) {
        indices[campo] = coluna;
        rotulos[campo] = texto(celula);
      }
    });

    // Sem empresa e telefone nao da pra cadastrar ninguem — nao e cabecalho.
    if (indices.empresa === undefined || indices.contato === undefined) continue;

    const achados = Object.keys(indices).length;
    if (!melhor || achados > Object.keys(melhor.indices).length) {
      melhor = { linha: i, indices, rotulos };
    }
  }

  if (!melhor) {
    throw new ErroPlanilha(
      "Nao achei o cabecalho da planilha. Ela precisa de uma linha com as colunas de cliente e contato " +
        '(ex.: "Clientes" e "Contato", ou "empresa" e "contato_whatsapp").'
    );
  }

  return melhor;
}

/** Procura "RESPONSAVEL: X" nas linhas acima do cabecalho. */
function acharResponsavel(matriz: unknown[][], ateLinha: number): string | null {
  for (let i = 0; i < ateLinha; i++) {
    for (const celula of matriz[i]) {
      const bruto = texto(celula);
      const achado = bruto.match(/respons[aá]ve(?:l|is)\s*[:\-–]\s*(.+)/i);
      if (achado) {
        const nome = achado[1].trim();
        if (nome) return nome;
      }
    }
  }
  return null;
}

/**
 * Le a primeira aba (ou a informada) e devolve o que da pra importar mais o
 * relatorio do que ficou de fora.
 */
export function lerCarteira(
  entrada: Buffer | ArrayBuffer | Uint8Array,
  opcoes: { aba?: string } = {}
): LeituraCarteira {
  const workbook = XLSX.read(entrada, { type: "buffer" });

  const aba = opcoes.aba ?? workbook.SheetNames[0];
  const planilha = aba ? workbook.Sheets[aba] : undefined;
  if (!planilha) {
    throw new ErroPlanilha(
      aba ? `A aba "${aba}" nao existe no arquivo.` : "O arquivo nao tem nenhuma aba."
    );
  }

  const matriz = XLSX.utils.sheet_to_json<unknown[]>(planilha, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: true,
  });

  const { linha: linhaCabecalho, indices, rotulos } = acharCabecalho(matriz);
  const responsavelPlanilha = acharResponsavel(matriz, linhaCabecalho);

  const celula = (linha: unknown[], campo: CampoCarteira): string => {
    const indice = indices[campo];
    return indice === undefined ? "" : texto(linha[indice]);
  };

  const registros: RegistroCarteira[] = [];
  const descartadas: LinhaDescartada[] = [];
  /** Linhas ja aceitas, pra pegar a mesma empresa listada duas vezes. */
  const jaLidos = new IndiceDuplicatas<RegistroCarteira>();
  let totalLinhas = 0;

  for (let i = linhaCabecalho + 1; i < matriz.length; i++) {
    const bruta = matriz[i];
    const linha = i + 1; // 1-based, como o Excel mostra

    const empresa = celula(bruta, "empresa");
    const contatoBruto = celula(bruta, "contato");

    // Linha totalmente vazia e so o rabo da planilha.
    if (!empresa && !contatoBruto) continue;
    totalLinhas++;

    if (!empresa) {
      descartadas.push({
        linha,
        empresa: "",
        motivo: "sem_empresa",
        detalhe: `Linha ${linha}: contato ${contatoBruto} sem nome de cliente.`,
      });
      continue;
    }

    const contatoWhatsapp = normalizarTelefone(contatoBruto);
    if (!contatoWhatsapp) {
      descartadas.push({
        linha,
        empresa,
        motivo: "telefone_invalido",
        detalhe: `Linha ${linha}: ${empresa} — telefone "${contatoBruto}" nao e valido (confira o DDD e a quantidade de digitos).`,
      });
      continue;
    }

    // O dia principal e o "repetir disparo" viram a lista de dias do cliente.
    const diasDisparo = ordenarDias([
      ...parseDiasDisparo(celula(bruta, "dias")),
      ...parseDiasDisparo(celula(bruta, "repetir")),
    ]);
    if (diasDisparo.length === 0) {
      descartadas.push({
        linha,
        empresa,
        motivo: "sem_dia",
        detalhe: `Linha ${linha}: ${empresa} — dia da semana "${celula(bruta, "dias")}" nao reconhecido.`,
      });
      continue;
    }

    const cnpjCpfBruto = celula(bruta, "cnpjCpf");
    const cnpjCpf = cleanCnpjCpf(cnpjCpfBruto);
    if (cnpjCpf && !isValidCnpjCpfFormat(cnpjCpf)) {
      descartadas.push({
        linha,
        empresa,
        motivo: "cnpj_invalido",
        detalhe: `Linha ${linha}: ${empresa} — CNPJ/CPF "${cnpjCpfBruto}" precisa ter 11 ou 14 digitos.`,
      });
      continue;
    }

    const segmentoDaColuna = SEGMENTOS_POR_APELIDO[normalizarRotulo(celula(bruta, "segmento"))];

    const registro: RegistroCarteira = {
      linha,
      empresa,
      contatoWhatsapp,
      diasDisparo,
      segmento: segmentoDaColuna ?? chutarSegmento(empresa),
      segmentoInferido: !segmentoDaColuna,
      cidade: celula(bruta, "cidade") || null,
      uf: celula(bruta, "uf").toUpperCase() || null,
      cnpjCpf: cnpjCpf || null,
      responsavel: celula(bruta, "responsavel") || null,
    };

    const repetido = jaLidos.buscar(registro);
    if (repetido) {
      descartadas.push({
        linha,
        empresa,
        motivo: "duplicado_na_planilha",
        detalhe:
          `Linha ${linha}: ${empresa} — ${ROTULO_CRITERIO[repetido.criterio]} de ` +
          `${repetido.existente.empresa} (linha ${repetido.existente.linha}).`,
      });
      continue;
    }

    jaLidos.adicionar(registro);
    registros.push(registro);
  }

  return {
    aba,
    linhaCabecalho: linhaCabecalho + 1,
    colunas: rotulos,
    responsavelPlanilha,
    totalLinhas,
    registros,
    descartadas,
  };
}

/** "Cristina" -> "carteira-cristina". Serve pra marcar (e desfazer) um lote. */
export function tagDaCarteira(responsavel: string | null | undefined): string | null {
  const slug = normalizarRotulo(responsavel).replace(/ +/g, "-");
  return slug ? `carteira-${slug}` : null;
}

/** O cadastro do banco, no minimo que o cruzamento e a mesclagem precisam. */
export interface ClienteJaCadastrado extends ChavesDuplicata {
  id: string;
  uf?: string | null;
  responsavel: string | null;
  diasDisparo?: DiaSemana[];
  tags?: string[];
}

export interface ConflitoImportacao<T extends ClienteJaCadastrado = ClienteJaCadastrado> {
  linha: number;
  empresa: string;
  contatoWhatsapp: string;
  /** A linha da planilha que bateu com alguem ja cadastrado. */
  registro: RegistroCarteira;
  /** O cadastro que ja existia. */
  existente: T;
  /** O que denunciou a repeticao. */
  criterio: CriterioDuplicata;
}

/**
 * Separa quem entra de quem ja esta no banco.
 *
 * O cruzamento vai por telefone (8 ultimos digitos), CNPJ/CPF e nome+cidade —
 * nessa ordem. A mesma empresa costuma reaparecer em outra planilha com o
 * telefone do dono no lugar do da loja, entao so o telefone nao segura.
 */
export function separarNovos<T extends ClienteJaCadastrado>(
  registros: readonly RegistroCarteira[],
  existentes: readonly T[]
): { novos: RegistroCarteira[]; conflitos: ConflitoImportacao<T>[] } {
  const indice = new IndiceDuplicatas(existentes);

  const novos: RegistroCarteira[] = [];
  const conflitos: ConflitoImportacao<T>[] = [];

  for (const registro of registros) {
    const repetido = indice.buscar(registro);
    if (repetido) {
      conflitos.push({
        linha: registro.linha,
        empresa: registro.empresa,
        contatoWhatsapp: registro.contatoWhatsapp,
        registro,
        existente: repetido.existente,
        criterio: repetido.criterio,
      });
    } else {
      // Nao precisa entrar no indice: lerCarteira ja cruzou as linhas entre si
      // com essas mesmas regras, entao duas delas nunca se repetem aqui.
      novos.push(registro);
    }
  }

  return { novos, conflitos };
}

/**
 * O que mudar num cadastro que a planilha reencontrou, sem apagar nada do que
 * ja estava la: a planilha completa buraco (cidade vazia, CNPJ faltando) e
 * soma dias de disparo, mas nunca sobrescreve um campo ja preenchido.
 *
 * Devolve null quando nao ha o que mudar — evita um UPDATE a toa por linha.
 */
export function mesclarComExistente(
  existente: ClienteJaCadastrado,
  registro: RegistroCarteira,
  opcoes: { responsavelPadrao?: string | null; tag?: string | null } = {}
): {
  diasDisparo?: DiaSemana[];
  responsavel?: string;
  cidade?: string;
  uf?: string;
  cnpjCpf?: string;
  tags?: string[];
} | null {
  const mudancas: ReturnType<typeof mesclarComExistente> = {};

  const diasAtuais = existente.diasDisparo ?? [];
  const dias = ordenarDias([...diasAtuais, ...registro.diasDisparo]);
  if (dias.length !== diasAtuais.length) mudancas.diasDisparo = dias;

  const responsavel = registro.responsavel ?? opcoes.responsavelPadrao ?? null;
  if (!existente.responsavel && responsavel) mudancas.responsavel = responsavel;

  if (!existente.cidade && registro.cidade) mudancas.cidade = registro.cidade;
  if (!existente.uf && registro.uf) mudancas.uf = registro.uf;
  if (!cleanCnpjCpf(existente.cnpjCpf) && registro.cnpjCpf) mudancas.cnpjCpf = registro.cnpjCpf;

  const tagsAtuais = existente.tags ?? [];
  if (opcoes.tag && !tagsAtuais.includes(opcoes.tag)) {
    mudancas.tags = [...tagsAtuais, opcoes.tag];
  }

  return Object.keys(mudancas).length > 0 ? mudancas : null;
}
