/**
 * Diagnostico: mostra estado do HistoricoCompraBling pra cada cliente com cnpjCpf.
 *
 * Uso: npx tsx scripts/diagnose-historico.ts
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
  console.error("ERRO: DATABASE_URL nao encontrado");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log("\n=== Diagnostico HistoricoCompraBling ===\n");

  // Todos os clientes com cnpjCpf
  const clientes = await prisma.cliente.findMany({
    where: { cnpjCpf: { not: null } },
    orderBy: { empresa: "asc" },
  });

  console.log(`Total de clientes com CNPJ/CPF: ${clientes.length}\n`);

  for (const c of clientes) {
    const count = await prisma.historicoCompraBling.count({
      where: { clienteId: c.id },
    });
    const ultimoPedido = await prisma.historicoCompraBling.findFirst({
      where: { clienteId: c.id },
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true, data: true, valorTotal: true, numeroPedido: true, itens: true },
    });

    const itensCount = ultimoPedido?.itens && Array.isArray(ultimoPedido.itens)
      ? ultimoPedido.itens.length
      : 0;

    console.log(`[${c.empresa}]`);
    console.log(`   id: ${c.id}`);
    console.log(`   telefone: ${c.contatoWhatsapp}`);
    console.log(`   cnpjCpf: ${c.cnpjCpf}`);
    console.log(`   ativo: ${c.ativo}`);
    console.log(`   pedidos no banco: ${count}`);
    if (ultimoPedido) {
      console.log(`   ultimo sync: ${ultimoPedido.syncedAt.toISOString()}`);
      console.log(`   ultimo pedido: #${ultimoPedido.numeroPedido} (${ultimoPedido.data.toISOString().slice(0, 10)}) R$ ${ultimoPedido.valorTotal} | ${itensCount} item(ns)`);
    } else {
      console.log(`   ❌ SEM PEDIDOS REGISTRADOS — o sync nao gravou nada pra esse cliente`);
    }
    console.log();
  }

  // Total geral
  const totalPedidos = await prisma.historicoCompraBling.count();
  const totalItens = await prisma.historicoCompraBling.findMany({
    select: { itens: true },
  });
  let itensCount = 0;
  for (const p of totalItens) {
    if (Array.isArray(p.itens)) itensCount += p.itens.length;
  }
  console.log(`\n=== Totais ===`);
  console.log(`HistoricoCompraBling: ${totalPedidos} pedido(s)`);
  console.log(`Total de itens: ${itensCount}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("ERRO:", e);
  await prisma.$disconnect();
  process.exit(1);
});
