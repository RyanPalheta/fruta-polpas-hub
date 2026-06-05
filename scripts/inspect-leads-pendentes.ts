/**
 * One-off helper:
 *   1. Reverte o CNPJ errado que o backfill anterior aplicou em
 *      "Mercadinho da Familia Garanhuns" (match incorreto por primeira palavra).
 *   2. Lista candidatos pros 3 leads que nao tiveram match: Mercadinho Patricia,
 *      Hotel Veneza Garanhuns, Feijoada Da Wivi.
 *
 * Uso: npx tsx scripts/inspect-leads-pendentes.ts
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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

// CNPJ atribuido erroneamente — vamos reverter
const MERCADINHO_FAMILIA_TEL = "558781180072";   // do output do backfill
const CNPJ_ERRADO            = "54152948000191"; // o de "Mercadinho Patricia"

const KEYWORDS = [
  { lead: "Mercadinho Patricia", terms: ["Mercadinho", "Patricia"] },
  { lead: "Hotel Veneza Garanhuns", terms: ["Veneza", "Hotel"] },
  { lead: "Feijoada Da Wivi", terms: ["Feijoada", "Wivi"] },
];

async function listByTerm(term: string) {
  return prisma.$queryRaw<Array<{ id: string; empresa: string; contato_whatsapp: string; cnpj_cpf: string | null; cidade: string | null }>>`
    SELECT id, empresa, contato_whatsapp, cnpj_cpf, cidade
    FROM clientes
    WHERE empresa ILIKE ${"%" + term + "%"}
    ORDER BY empresa ASC
    LIMIT 20
  `;
}

async function main() {
  console.log("\n=== 1) Revertendo CNPJ errado do Mercadinho da Familia ===\n");

  const wrong = await prisma.cliente.findFirst({
    where: { contatoWhatsapp: MERCADINHO_FAMILIA_TEL },
  });
  if (!wrong) {
    console.warn("Nao achei o cliente com telefone " + MERCADINHO_FAMILIA_TEL + ". Talvez ja foi mexido.");
  } else if (wrong.cnpjCpf !== CNPJ_ERRADO) {
    console.log(`Cliente ${wrong.empresa} ja tem cnpj diferente (${wrong.cnpjCpf}). Sem mudanca.`);
  } else {
    await prisma.cliente.update({
      where: { id: wrong.id },
      data: { cnpjCpf: null },
    });
    console.log(`✓ ${wrong.empresa} — CNPJ revertido pra null.`);
  }

  console.log("\n=== 2) Buscando candidatos pros leads pendentes ===\n");

  for (const { lead, terms } of KEYWORDS) {
    console.log(`\n--- ${lead} ---`);
    for (const term of terms) {
      const rows = await listByTerm(term);
      console.log(`  Buscando por "${term}": ${rows.length} resultado(s)`);
      for (const r of rows) {
        const flag = r.cnpj_cpf ? ` [CNPJ ja: ${r.cnpj_cpf}]` : "";
        console.log(`    - id=${r.id} | ${r.empresa} | ${r.contato_whatsapp} | ${r.cidade ?? "—"}${flag}`);
      }
    }
  }

  console.log("\n=== Fim ===\n");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("ERRO:", e);
  await prisma.$disconnect();
  process.exit(1);
});
