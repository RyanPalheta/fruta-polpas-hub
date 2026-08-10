/**
 * Importa uma planilha de carteira de disparo para a tabela de clientes.
 *
 * Le o mesmo formato do importador da tela (/leads/importar) — a leitura toda
 * vive em src/lib/importar-carteira.ts, aqui so tem a conversa com o banco.
 *
 * Uso:
 *   npx tsx scripts/importar-carteira.ts "carteira.xlsx"
 *   npx tsx scripts/importar-carteira.ts "carteira.xlsx" --responsavel "Cristina"
 *   npx tsx scripts/importar-carteira.ts "carteira.xlsx" --responsavel "Cristina" --aplicar
 *
 * Sem --aplicar e dry-run: mostra o relatorio e nao grava nada.
 *
 * Opcoes:
 *   --responsavel "Nome"  quem fica com a carteira (padrao: o "RESPONSAVEL: X" da planilha)
 *   --aba "Planilha1"     aba a ler (padrao: a primeira)
 *   --tag "minha-tag"     tag do lote (padrao: carteira-<responsavel>)
 *   --sem-tag             nao marca tag nenhuma
 *   --aplicar             grava de verdade
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ErroPlanilha,
  lerCarteira,
  ROTULO_CRITERIO,
  separarNovos,
  tagDaCarteira,
  type RegistroCarteira,
} from "../src/lib/importar-carteira";

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

/** Le "--chave valor" do argv. */
function opcao(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APLICAR = process.argv.includes("--aplicar");
const SEM_TAG = process.argv.includes("--sem-tag");
const CAMINHO = process.argv[2];

function contar<T>(itens: readonly T[], chave: (item: T) => string): [string, number][] {
  const mapa = new Map<string, number>();
  for (const item of itens) {
    const k = chave(item);
    mapa.set(k, (mapa.get(k) ?? 0) + 1);
  }
  return [...mapa.entries()].sort((a, b) => b[1] - a[1]);
}

function bloco(titulo: string, linhas: readonly string[], limite = Infinity) {
  if (linhas.length === 0) return;
  console.log(`\n--- ${titulo} (${linhas.length})`);
  linhas.slice(0, limite).forEach((l) => console.log("   " + l));
  if (linhas.length > limite) console.log(`   ... e mais ${linhas.length - limite}`);
}

async function main() {
  if (!CAMINHO || CAMINHO.startsWith("--")) {
    console.error('Informe o caminho da planilha: npx tsx scripts/importar-carteira.ts "carteira.xlsx"');
    process.exit(1);
  }
  if (!existsSync(CAMINHO)) {
    console.error(`Arquivo nao encontrado: ${CAMINHO}`);
    process.exit(1);
  }

  const leitura = lerCarteira(readFileSync(CAMINHO), { aba: opcao("aba") });

  const responsavel = (opcao("responsavel") ?? leitura.responsavelPlanilha ?? "").trim() || null;
  const tagInformada = opcao("tag");
  const tag = SEM_TAG ? null : (tagInformada ?? tagDaCarteira(responsavel));

  console.log(`=== ${CAMINHO}`);
  console.log(`  aba                 : ${leitura.aba}`);
  console.log(`  cabecalho na linha  : ${leitura.linhaCabecalho}`);
  console.log(
    `  colunas reconhecidas: ${Object.entries(leitura.colunas)
      .map(([campo, rotulo]) => `${campo}="${rotulo}"`)
      .join(", ")}`
  );
  console.log(`  responsavel na planilha: ${leitura.responsavelPlanilha ?? "(nenhum)"}`);
  console.log(`  responsavel a gravar   : ${responsavel ?? "(nenhum)"}`);
  console.log(`  tag                    : ${tag ?? "(nenhuma)"}`);

  const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const encerrar = async () => {
    await prisma.$disconnect();
    await pool.end();
  };

  const existentes = await prisma.cliente.findMany({
    select: {
      id: true,
      empresa: true,
      contatoWhatsapp: true,
      cnpjCpf: true,
      cidade: true,
      responsavel: true,
    },
  });
  const { novos, conflitos } = separarNovos(leitura.registros, existentes);

  console.log(`\n  linhas de dados      : ${leitura.totalLinhas}`);
  console.log(`  prontos para importar: ${novos.length}`);
  console.log(`  ja existem no banco  : ${conflitos.length}`);
  console.log(`  descartados          : ${leitura.descartadas.length}`);

  const porMotivo = contar(leitura.descartadas, (d) => d.motivo);
  porMotivo.forEach(([motivo, n]) => console.log(`     ${String(n).padStart(4)}x  ${motivo}`));

  bloco(
    "combinacoes de dias",
    contar(novos, (r) => r.diasDisparo.join("+")).map(([k, n]) => `${String(n).padStart(4)}x  ${k}`)
  );
  bloco(
    "segmento (palpite pelo nome quando a planilha nao traz a coluna)",
    contar(novos, (r) => r.segmento).map(([k, n]) => `${String(n).padStart(4)}x  ${k}`)
  );
  bloco(
    "cidade",
    contar(novos, (r) => r.cidade ?? "(vazio)").map(([k, n]) => `${String(n).padStart(4)}x  ${k}`)
  );

  bloco(
    "NAO importados — linha com problema",
    leitura.descartadas.map((d) => d.detalhe)
  );
  bloco(
    "NAO importados — ja cadastrado",
    conflitos.map(
      (c) =>
        `linha ${c.linha}: ${c.empresa} (${c.contatoWhatsapp}) == "${c.existente.empresa}"` +
        ` [${ROTULO_CRITERIO[c.criterio]}, resp=${c.existente.responsavel ?? "—"}]`
    ),
    30
  );

  bloco(
    "amostra do que sera criado",
    novos
      .slice(0, 5)
      .map(
        (r: RegistroCarteira) =>
          `${r.empresa} | ${r.contatoWhatsapp} | ${r.diasDisparo.join("+")} | ${r.segmento} | ${r.cidade ?? "-"} | resp=${responsavel ?? "—"}`
      )
  );

  if (!APLICAR) {
    console.log(`\n>>> DRY-RUN. Nada foi gravado. Rode com --aplicar para criar os ${novos.length} clientes.`);
    await encerrar();
    return;
  }

  if (novos.length === 0) {
    console.log("\n>>> Nada novo para importar.");
    await encerrar();
    return;
  }

  const resultado = await prisma.cliente.createMany({
    data: novos.map((r) => ({
      empresa: r.empresa,
      contatoWhatsapp: r.contatoWhatsapp,
      segmento: r.segmento,
      diasDisparo: r.diasDisparo,
      responsavel: r.responsavel ?? responsavel,
      cidade: r.cidade,
      uf: r.uf,
      cnpjCpf: r.cnpjCpf,
      tags: tag ? [tag] : [],
    })),
  });

  console.log(`\n>>> ${resultado.count} cliente(s) criados${responsavel ? ` com responsavel "${responsavel}"` : ""}.`);
  await encerrar();
}

main().catch(async (e) => {
  if (e instanceof ErroPlanilha) {
    console.error("PLANILHA:", e.message);
  } else {
    console.error("ERRO:", e);
  }
  process.exit(1);
});
