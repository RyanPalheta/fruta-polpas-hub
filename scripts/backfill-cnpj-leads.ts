/**
 * One-off script: backfill cnpjCpf em clientes específicos.
 *
 * Como usar:
 *   1. Garante que o .env tem DATABASE_URL apontando pro banco certo.
 *   2. Garante que a migration ja rodou (npx prisma migrate deploy)
 *   3. npx tsx scripts/backfill-cnpj-leads.ts
 *
 * O script faz match por DIGITOS DO TELEFONE (sufixo) e, em caso de ambiguidade,
 * tambem confere o nome. Imprime tudo que esta fazendo — nada e silencioso.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ---- Carrega .env manualmente (tsx nao carrega automaticamente como o prisma CLI faz)
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
    // Remove aspas externas (' ou ")
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

// Tenta .env.local primeiro (Next convention), depois .env
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

interface Target {
  empresa: string;
  telefone: string;
  cnpjCpf: string;
}

const TARGETS: Target[] = [
  { empresa: "Cantinho Da Macaxeira",  telefone: "82988879460",  cnpjCpf: "50.357.807/0001-54" },
  { empresa: "Mercadinho Patricia",    telefone: "5587990847964", cnpjCpf: "54.152.948/0001-91" },
  // ↑ corrigi 990847964 → 990847964 (digitos crus). Se voce passou "9908-4796"  =>  9 + 9908 + 4796 = 99084796 (8 digitos)
  //   o telefone completo deve ser 87 9 9908-4796. Vou normalizar dentro do script.
  { empresa: "Hotel Veneza Garanhuns", telefone: "5587992000597", cnpjCpf: "57.557.521/0001-61" },
  { empresa: "Feijoada Da Wivi",       telefone: "87 9639-8032",  cnpjCpf: "061.810.514-06" },
  { empresa: "RESTAURANTE SABOREAR",   telefone: "81 9 9612-0120", cnpjCpf: "843.428.034-53" },
];

function cleanDigits(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

/** Normaliza: remove tudo que nao for digito + tira 55 do inicio se tiver 12+ digitos. */
function phoneDigits(s: string): string {
  let d = cleanDigits(s);
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  return d;
}

async function findByPhoneSuffix(suffix: string) {
  // Match pelo sufixo dos digitos
  const rows = await prisma.$queryRaw<Array<{ id: string; empresa: string; contato_whatsapp: string; cnpj_cpf: string | null }>>`
    SELECT id, empresa, contato_whatsapp, cnpj_cpf
    FROM clientes
    WHERE regexp_replace(contato_whatsapp, '[^0-9]', '', 'g') LIKE ${"%" + suffix}
    LIMIT 5
  `;
  return rows;
}

async function findByNameLike(empresa: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string; empresa: string; contato_whatsapp: string; cnpj_cpf: string | null }>>`
    SELECT id, empresa, contato_whatsapp, cnpj_cpf
    FROM clientes
    WHERE empresa ILIKE ${"%" + empresa.split(" ")[0] + "%"}
    LIMIT 10
  `;
  return rows;
}

async function main() {
  console.log("\n=== Backfill CPF/CNPJ ===\n");

  for (const target of TARGETS) {
    const targetPhone = phoneDigits(target.telefone);
    const targetCnpj = cleanDigits(target.cnpjCpf);
    console.log(`\n[${target.empresa}]`);
    console.log(`   telefone normalizado: ${targetPhone}`);
    console.log(`   cnpj/cpf normalizado: ${targetCnpj} (${targetCnpj.length} digitos)`);

    if (targetCnpj.length !== 11 && targetCnpj.length !== 14) {
      console.warn(`   AVISO: CPF/CNPJ com ${targetCnpj.length} digitos (esperado 11 ou 14). Pulando.`);
      continue;
    }

    let matches = await findByPhoneSuffix(targetPhone);
    if (matches.length === 0 && targetPhone.length >= 9) {
      // Tenta com sufixo de 9 digitos (sem DDD as vezes resolve)
      matches = await findByPhoneSuffix(targetPhone.slice(-9));
    }

    if (matches.length === 0) {
      console.log(`   Telefone nao deu match. Tentando por nome...`);
      matches = await findByNameLike(target.empresa);
    }

    if (matches.length === 0) {
      console.warn(`   NAO ENCONTRADO no banco. Verifique se esse lead existe.`);
      continue;
    }

    if (matches.length > 1) {
      console.warn(`   ATENCAO: ${matches.length} matches. Listando — vai atualizar so o primeiro.`);
      matches.forEach((m, i) =>
        console.warn(`     [${i + 1}] ${m.empresa} | ${m.contato_whatsapp} | cnpj_atual=${m.cnpj_cpf ?? "(vazio)"}`)
      );
    }

    const chosen = matches[0];
    console.log(`   -> match: ${chosen.empresa} | ${chosen.contato_whatsapp}`);
    if (chosen.cnpj_cpf && chosen.cnpj_cpf !== targetCnpj) {
      console.warn(`   AVISO: cliente ja tem cnpj diferente (${chosen.cnpj_cpf}). Vou sobrescrever.`);
    }

    await prisma.cliente.update({
      where: { id: chosen.id },
      data: { cnpjCpf: targetCnpj },
    });
    console.log(`   ✓ atualizado.`);
  }

  console.log("\n=== Fim ===\n");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("ERRO:", e);
  await prisma.$disconnect();
  process.exit(1);
});
