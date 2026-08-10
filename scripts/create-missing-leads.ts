/**
 * One-off: cria 3 leads que nao existiam no banco, ja com CNPJ/CPF preenchido.
 *
 * Defaults sensatos (ajuste via UI /leads/[id]/editar se necessario):
 *   - diaDisparo: SEGUNDA
 *   - ativo: true
 *   - tags: []
 *
 * Uso: npx tsx scripts/create-missing-leads.ts
 */

import { PrismaClient, Segmento, DiaSemana } from "../src/generated/prisma/client";
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
  console.error("ERRO: DATABASE_URL nao encontrado");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

interface NewLead {
  empresa: string;
  contatoWhatsapp: string;  // ja normalizado (so digitos, com 55)
  cnpjCpf: string;           // ja so digitos
  segmento: Segmento;
  cidade: string | null;
  uf: string | null;
}

const NEW_LEADS: NewLead[] = [
  {
    empresa: "Mercadinho Patricia",
    contatoWhatsapp: "558799084796",     // 55 87 9908-4796
    cnpjCpf: "54152948000191",
    segmento: Segmento.OUTRO,             // mercadinho — ajuste se preferir DISTRIBUIDOR
    cidade: null,
    uf: null,
  },
  {
    empresa: "Hotel Veneza Garanhuns",
    contatoWhatsapp: "558792000597",     // 55 87 9200-0597
    cnpjCpf: "57557521000161",
    segmento: Segmento.HOTELARIA,
    cidade: "Garanhuns",
    uf: "PE",
  },
  {
    empresa: "Feijoada Da Wivi",
    contatoWhatsapp: "558796398032",     // 87 9639-8032
    cnpjCpf: "06181051406",
    segmento: Segmento.RESTAURANTE,
    cidade: null,
    uf: null,
  },
];

async function main() {
  console.log("\n=== Criando leads pendentes ===\n");

  for (const lead of NEW_LEADS) {
    console.log(`\n[${lead.empresa}]`);

    // Verifica se ja foi criado (re-run safe)
    const existing = await prisma.cliente.findFirst({
      where: {
        OR: [
          { cnpjCpf: lead.cnpjCpf },
          { contatoWhatsapp: lead.contatoWhatsapp },
        ],
      },
    });

    if (existing) {
      console.log(`   Ja existe (id=${existing.id}, empresa=${existing.empresa}). Pulando.`);
      continue;
    }

    const created = await prisma.cliente.create({
      data: {
        empresa: lead.empresa,
        contatoWhatsapp: lead.contatoWhatsapp,
        cnpjCpf: lead.cnpjCpf,
        segmento: lead.segmento,
        diasDisparo: [DiaSemana.SEGUNDA],
        cidade: lead.cidade,
        uf: lead.uf,
        ativo: true,
        tags: [],
      },
    });

    console.log(`   ✓ criado | id=${created.id}`);
    console.log(`     empresa: ${created.empresa}`);
    console.log(`     telefone: ${created.contatoWhatsapp}`);
    console.log(`     cnpj/cpf: ${created.cnpjCpf}`);
    console.log(`     segmento: ${created.segmento}`);
    console.log(`     dias disparo: ${created.diasDisparo.join(", ")} (padrao — ajuste via UI se necessario)`);
  }

  console.log("\n=== Fim ===\n");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("ERRO:", e);
  await prisma.$disconnect();
  process.exit(1);
});
