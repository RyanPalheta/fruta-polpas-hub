/**
 * Importa contatos do Bling (saida do workflow n8n) para a tabela clientes.
 *
 * Como usar:
 *   1. Salve o JSON do node "Monta JSON pro Dashboard" em um arquivo.
 *   2. Simulacao (nao grava nada):
 *        npx tsx scripts/importar-contatos-bling.ts contatos.json
 *   3. Gravar de verdade:
 *        npx tsx scripts/importar-contatos-bling.ts contatos.json --apply
 *
 * Aceita tanto o objeto completo { resumo, leads, ... } quanto um array puro.
 *
 * Regra de deduplicacao, nessa ordem:
 *   1. cnpjCpf igual        -> ATUALIZA o lead existente (preenche campos vazios)
 *   2. telefone igual       -> ATUALIZA e grava o cnpjCpf que faltava
 *   3. nenhum match         -> CRIA lead novo
 *
 * Nada e silencioso: cada decisao e impressa.
 */

import { PrismaClient, DiaSemana, Segmento } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ---- Carrega .env manualmente (tsx nao carrega automaticamente)
function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
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

if (!process.env.DATABASE_URL) {
  console.error("ERRO: DATABASE_URL nao encontrado em .env nem .env.local");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ---- Argumentos
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const arquivo = args.find((a) => !a.startsWith("--"));

if (!arquivo) {
  console.error("ERRO: informe o arquivo JSON. Ex: npx tsx scripts/importar-contatos-bling.ts contatos.json");
  process.exit(1);
}
if (!existsSync(arquivo)) {
  console.error(`ERRO: arquivo nao encontrado: ${arquivo}`);
  process.exit(1);
}

// Dia padrao para novos leads (o schema exige, o Bling nao fornece).
const DIA_PADRAO: DiaSemana = DiaSemana.SEGUNDA;

interface LeadEntrada {
  empresa: string;
  cnpjCpf: string;
  contatoWhatsapp: string | null;
  cidade: string | null;
  uf: string | null;
  segmentoSugerido?: string | null;
  blingContatoId?: string | null;
  email?: string | null;
}

function soDigitos(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

function parseSegmento(v: string | null | undefined): Segmento {
  const chave = (v ?? "").toUpperCase().trim();
  if (chave in Segmento) return Segmento[chave as keyof typeof Segmento];
  return Segmento.OUTRO;
}

async function main() {
  const bruto = JSON.parse(readFileSync(arquivo!, "utf8"));

  // Aceita: array puro | { leads: [] } | [{ json: { leads: [] } }] (formato cru do n8n)
  let entrada: LeadEntrada[];
  if (Array.isArray(bruto)) {
    entrada = bruto.length > 0 && bruto[0]?.json?.leads ? bruto[0].json.leads : bruto;
  } else if (Array.isArray(bruto?.leads)) {
    entrada = bruto.leads;
  } else if (Array.isArray(bruto?.json?.leads)) {
    entrada = bruto.json.leads;
  } else {
    console.error("ERRO: nao encontrei um array de leads no JSON.");
    console.error("Esperado: array puro, ou objeto com a chave 'leads'.");
    process.exit(1);
  }

  console.log(`\n=== Importacao de contatos Bling ===`);
  console.log(`Arquivo : ${arquivo}`);
  console.log(`Modo    : ${APPLY ? "APLICAR (grava no banco)" : "SIMULACAO (nada sera gravado)"}`);
  console.log(`Entrada : ${entrada.length} lead(s)\n`);

  const existentes = await prisma.cliente.findMany({
    select: { id: true, empresa: true, cnpjCpf: true, contatoWhatsapp: true, cidade: true, uf: true },
  });
  console.log(`Banco   : ${existentes.length} cliente(s) ja cadastrado(s)\n`);

  const porCnpj = new Map<string, (typeof existentes)[number]>();
  const porTelefone = new Map<string, (typeof existentes)[number]>();
  for (const c of existentes) {
    const doc = soDigitos(c.cnpjCpf);
    if (doc) porCnpj.set(doc, c);
    const tel = soDigitos(c.contatoWhatsapp);
    if (tel) porTelefone.set(tel, c);
  }

  let criados = 0, atualizados = 0, semAlteracao = 0, ignorados = 0;
  const vistos = new Set<string>();

  for (const lead of entrada) {
    const empresa = (lead.empresa ?? "").trim();
    const doc = soDigitos(lead.cnpjCpf);
    const tel = soDigitos(lead.contatoWhatsapp);

    if (!empresa) { console.log(`  IGNORADO  (sem nome) doc=${doc}`); ignorados++; continue; }
    if (!tel) { console.log(`  IGNORADO  ${empresa} -> sem telefone (contatoWhatsapp e obrigatorio)`); ignorados++; continue; }
    if (doc && vistos.has(doc)) { console.log(`  IGNORADO  ${empresa} -> CNPJ duplicado no proprio arquivo (${doc})`); ignorados++; continue; }
    if (doc) vistos.add(doc);

    const match = (doc && porCnpj.get(doc)) || porTelefone.get(tel) || null;

    if (match) {
      // Preenche apenas o que esta faltando; nao sobrescreve dado existente.
      const patch: Record<string, unknown> = {};
      if (!soDigitos(match.cnpjCpf) && doc) patch.cnpjCpf = doc;
      if (!match.cidade && lead.cidade) patch.cidade = lead.cidade;
      if (!match.uf && lead.uf) patch.uf = lead.uf;

      if (Object.keys(patch).length === 0) {
        console.log(`  OK        ${empresa} -> ja cadastrado como "${match.empresa}", nada a preencher`);
        semAlteracao++;
        continue;
      }

      console.log(`  ATUALIZA  ${empresa} -> "${match.empresa}" (${match.id}) :: ${JSON.stringify(patch)}`);
      if (APPLY) await prisma.cliente.update({ where: { id: match.id }, data: patch });
      atualizados++;
      continue;
    }

    const novo = {
      empresa,
      contatoWhatsapp: tel,
      segmento: parseSegmento(lead.segmentoSugerido),
      diasDisparo: [DIA_PADRAO],
      cidade: lead.cidade || null,
      uf: lead.uf || null,
      cnpjCpf: doc || null,
    };
    console.log(`  CRIA      ${empresa} | tel=${tel} | doc=${doc || "-"} | seg=${novo.segmento} | ${novo.cidade ?? "-"}/${novo.uf ?? "-"}`);
    if (APPLY) await prisma.cliente.create({ data: novo });
    criados++;
  }

  console.log(`\n=== Resumo ===`);
  console.log(`  Criados      : ${criados}`);
  console.log(`  Atualizados  : ${atualizados}`);
  console.log(`  Sem alteracao: ${semAlteracao}`);
  console.log(`  Ignorados    : ${ignorados}`);
  console.log(`  Total banco  : ${existentes.length} -> ${existentes.length + (APPLY ? criados : 0)}`);

  if (!APPLY) {
    console.log(`\n  NADA FOI GRAVADO. Rode de novo com --apply para aplicar.`);
  }
  console.log();
}

main()
  .catch((e) => {
    console.error("ERRO:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
