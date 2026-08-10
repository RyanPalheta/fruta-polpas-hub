/**
 * Importa a planilha de disparos da Thamyres para a tabela de clientes.
 *
 * Colunas esperadas (2 linhas de cabecalho antes dos dados):
 *   Nº | Dia da semana | Repetir disparo | Contato | Clientes | Cidade
 *
 * O "Repetir disparo" vira o segundo dia do cliente (diasDisparo).
 *
 * Uso:
 *   npx tsx scripts/importar-planilha-thamyres.ts "caminho.xlsx"           # dry-run
 *   npx tsx scripts/importar-planilha-thamyres.ts "caminho.xlsx" --aplicar # grava
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { DiaSemana, Segmento } from "../src/generated/prisma/enums";
import { parseDiasDisparo, ordenarDias } from "../src/lib/utils";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

const RESPONSAVEL = "Thamyres";
const APLICAR = process.argv.includes("--aplicar");
const CAMINHO = process.argv[2];

const COL = {
  dia: "__EMPTY",
  repetir: "__EMPTY_1",
  contato: "__EMPTY_2",
  empresa: "__EMPTY_3",
  cidade: "__EMPTY_4",
};

function texto(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

/** 55 + DDD + numero. Retorna null quando falta DDD ou o numero nao fecha. */
function normalizarTelefone(bruto: string): string | null {
  let d = bruto.replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return null;
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) return "55" + d;
  return null;
}

/**
 * Palpite de segmento pelo nome — a planilha nao traz essa coluna.
 * E so um chute: nome proprio sem pista nenhuma cai em OUTRO de proposito,
 * em vez de virar RESTAURANTE por padrao.
 */
function chutarSegmento(nome: string): Segmento {
  const n = nome.toLowerCase();

  // Escola, igreja, orgao: sao clientes, mas nao encaixam nos outros rotulos.
  if (/colegio|colégio|escola|livraria|instituto|federa|arquidioces|movimento pro/.test(n))
    return Segmento.OUTRO;

  if (/hotel|pousada|resort|hostel|motel|catamaran|acampamento/.test(n)) return Segmento.HOTELARIA;
  if (/academia|fitness|gym|crossfit|pilates|nutrir|nutri\b/.test(n)) return Segmento.ACADEMIA;
  if (/evento|buffet|bufe|recep|festa|salao de|salão de/.test(n)) return Segmento.EVENTOS;
  if (/franquia|franchis/.test(n)) return Segmento.FRANQUIA;

  if (
    /distribuidor|atacad|represent|mercadinho|mercado|supermerc|super mix|deposito|depósito|bebida|conveni|hortifruti|frios|polpas/.test(
      n
    )
  )
    return Segmento.DISTRIBUIDOR;

  if (
    /restaurante|lanchonete|lanche|pizza|churrasc|refei|self.?service|espetinho|burguer|burger|burg\b|hamburg|sushi|nikko|fusion|padaria|panificad|panifica|paes|pães|salgad|salgat|coxinha|esfih|tapioca|creperia|crepe|acai|açai|açaí|sorvet|gelato|\bbar\b|boteco|botequim|barteco|beer|\bpub\b|cantina|comedoria|forneria|cafe|café|coffee|bistro|comida|cozinha|grill|espeto|caldo|caldinho|galet|pastel|pastei|pastéi|sabor|petisc|gastrobar|doce|delicia|delícia|delicatessen|\bdeli\b|emporio|empório|gourmet|fondue|camarao|camarão|guaiamum|feijoada|tempero|point|quiosque|food|casa de|casa do|casa da/.test(
      n
    )
  )
    return Segmento.RESTAURANTE;

  return Segmento.OUTRO;
}

interface Registro {
  linha: number;
  empresa: string;
  contatoWhatsapp: string;
  diasDisparo: DiaSemana[];
  cidade: string | null;
  segmento: Segmento;
}

async function main() {
  if (!CAMINHO) {
    console.error("Informe o caminho da planilha.");
    process.exit(1);
  }

  const wb = XLSX.readFile(CAMINHO);
  const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
    defval: null,
  });
  const dados = linhas.slice(2); // pula titulo e cabecalho

  const registros: Registro[] = [];
  const semTelefone: string[] = [];
  const semDia: string[] = [];
  const duplicadoNaPlanilha: string[] = [];
  const telefonesVistos = new Map<string, string>();

  dados.forEach((l, i) => {
    const linha = i + 3;
    const empresa = texto(l[COL.empresa]);
    const contatoBruto = texto(l[COL.contato]);
    if (!empresa && !contatoBruto) return;

    if (!empresa) {
      semTelefone.push(`linha ${linha}: sem nome de empresa`);
      return;
    }

    const contatoWhatsapp = normalizarTelefone(contatoBruto);
    if (!contatoWhatsapp) {
      semTelefone.push(`linha ${linha}: ${empresa} -> telefone ${JSON.stringify(contatoBruto)} (falta DDD?)`);
      return;
    }

    // Dia principal + o "repetir disparo" formam a lista de dias do cliente.
    const dias = ordenarDias([
      ...parseDiasDisparo(texto(l[COL.dia])),
      ...parseDiasDisparo(texto(l[COL.repetir])),
    ]);
    if (dias.length === 0) {
      semDia.push(`linha ${linha}: ${empresa} -> dia ${JSON.stringify(texto(l[COL.dia]))}`);
      return;
    }

    const jaVisto = telefonesVistos.get(contatoWhatsapp);
    if (jaVisto) {
      duplicadoNaPlanilha.push(`linha ${linha}: ${empresa} tem o mesmo telefone de ${jaVisto}`);
      return;
    }
    telefonesVistos.set(contatoWhatsapp, `${empresa} (linha ${linha})`);

    registros.push({
      linha,
      empresa,
      contatoWhatsapp,
      diasDisparo: dias,
      cidade: texto(l[COL.cidade]) || null,
      segmento: chutarSegmento(empresa),
    });
  });

  const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  // Cruza com quem ja existe pelo sufixo do telefone (tolera 9o digito e +55).
  const existentes = await prisma.cliente.findMany({
    select: { id: true, empresa: true, contatoWhatsapp: true, responsavel: true },
  });
  const porSufixo = new Map<string, (typeof existentes)[number]>();
  for (const c of existentes) {
    const d = c.contatoWhatsapp.replace(/\D/g, "");
    if (d.length >= 8) porSufixo.set(d.slice(-8), c);
  }

  const novos: Registro[] = [];
  const jaNoBanco: string[] = [];
  for (const r of registros) {
    const match = porSufixo.get(r.contatoWhatsapp.slice(-8));
    if (match) {
      jaNoBanco.push(`${r.empresa} (linha ${r.linha}) == "${match.empresa}" ja cadastrado`);
    } else {
      novos.push(r);
    }
  }

  // Relatorio
  const porDias = new Map<string, number>();
  const porSegmento = new Map<string, number>();
  for (const r of novos) {
    const chave = r.diasDisparo.join("+");
    porDias.set(chave, (porDias.get(chave) ?? 0) + 1);
    porSegmento.set(r.segmento, (porSegmento.get(r.segmento) ?? 0) + 1);
  }

  console.log(`=== Planilha da ${RESPONSAVEL} ===`);
  console.log(`  linhas de dados      : ${dados.length}`);
  console.log(`  prontos para importar: ${novos.length}`);
  console.log(`  ja existem no banco  : ${jaNoBanco.length}`);
  console.log(`  duplicados na planilha: ${duplicadoNaPlanilha.length}`);
  console.log(`  telefone invalido    : ${semTelefone.length}`);
  console.log(`  sem dia da semana    : ${semDia.length}`);

  console.log(`\n--- combinacoes de dias`);
  [...porDias.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`   ${n.toString().padStart(4)}x  ${k}`));

  console.log(`\n--- segmento (palpite pelo nome)`);
  [...porSegmento.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`   ${n.toString().padStart(4)}x  ${k}`));

  if (semTelefone.length) {
    console.log(`\n--- NAO importados por telefone invalido:`);
    semTelefone.forEach((t) => console.log("   " + t));
  }
  if (duplicadoNaPlanilha.length) {
    console.log(`\n--- NAO importados por duplicidade na planilha:`);
    duplicadoNaPlanilha.forEach((t) => console.log("   " + t));
  }
  if (jaNoBanco.length) {
    console.log(`\n--- NAO importados porque ja estao no banco:`);
    jaNoBanco.forEach((t) => console.log("   " + t));
  }

  console.log(`\n--- amostra do que sera criado:`);
  novos.slice(0, 5).forEach((r) =>
    console.log(
      `   ${r.empresa} | ${r.contatoWhatsapp} | ${r.diasDisparo.join("+")} | ${r.segmento} | ${r.cidade ?? "-"} | resp=${RESPONSAVEL}`
    )
  );

  if (!APLICAR) {
    console.log(`\n>>> DRY-RUN. Nada foi gravado. Rode com --aplicar para criar os ${novos.length} clientes.`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  const resultado = await prisma.cliente.createMany({
    data: novos.map((r) => ({
      empresa: r.empresa,
      contatoWhatsapp: r.contatoWhatsapp,
      segmento: r.segmento,
      diasDisparo: r.diasDisparo,
      responsavel: RESPONSAVEL,
      cidade: r.cidade,
      tags: ["planilha-thamyres"],
    })),
  });

  console.log(`\n>>> ${resultado.count} cliente(s) criados com responsavel "${RESPONSAVEL}".`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error("ERRO:", e);
  process.exit(1);
});
