"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { SEGMENTO_COLORS, formatDiasDisparo, formatPhone } from "@/lib/utils";

interface LinhaAmostra {
  linha: number;
  empresa: string;
  contatoWhatsapp: string;
  diasDisparo: string[];
  segmento: string;
  segmentoInferido: boolean;
  cidade: string | null;
  uf: string | null;
  responsavel: string | null;
}

interface LinhaDescartada {
  linha: number;
  empresa: string;
  motivo: string;
  detalhe: string;
}

type Criterio = "telefone" | "documento" | "nome";

const ROTULO_CRITERIO: Record<Criterio, string> = {
  telefone: "mesmo telefone",
  documento: "mesmo CNPJ/CPF",
  nome: "mesmo nome",
};

interface Conflito {
  linha: number;
  empresa: string;
  contatoWhatsapp: string;
  criterio: Criterio;
  jaCadastradoComo: string;
  responsavelAtual: string | null;
}

type ModoDuplicata = "ignorar" | "atualizar";

interface Analise {
  modo: "preview" | "aplicar";
  created: number;
  atualizados: number;
  aba: string;
  linhaCabecalho: number;
  colunas: Record<string, string>;
  responsavelPlanilha: string | null;
  responsavel: string | null;
  tag: string | null;
  duplicatas: ModoDuplicata;
  totalLinhas: number;
  novos: number;
  jaCadastrados: number;
  atualizaveis: number;
  descartados: number;
  resumo: {
    porDia: Record<string, number>;
    porSegmento: Record<string, number>;
    porCidade: Record<string, number>;
    porCriterioDuplicata: Record<string, number>;
  };
  amostra: LinhaAmostra[];
  descartadas: LinhaDescartada[];
  conflitos: Conflito[];
}

const NOMES_CAMPO: Record<string, string> = {
  empresa: "Cliente",
  contato: "WhatsApp",
  dias: "Dia da semana",
  repetir: "Repetir disparo",
  segmento: "Segmento",
  cidade: "Cidade",
  uf: "UF",
  cnpjCpf: "CNPJ/CPF",
  responsavel: "Responsável",
};

const COLUNAS_ACEITAS: { campo: string; aceita: string; obrigatoria: boolean; virou: string }[] = [
  { campo: "Cliente", aceita: "Clientes, Cliente, Empresa, Nome fantasia, Razão social", obrigatoria: true, virou: "nome do cliente" },
  { campo: "WhatsApp", aceita: "Contato, Telefone, WhatsApp, Celular", obrigatoria: true, virou: "número do disparo (55 + DDD + número)" },
  { campo: "Dia da semana", aceita: "Dia da semana, dias_disparo, Dia", obrigatoria: true, virou: "dia em que o cliente recebe" },
  { campo: "Repetir disparo", aceita: "Repetir disparo, Segundo disparo", obrigatoria: false, virou: "um segundo dia para o mesmo cliente" },
  { campo: "Cidade", aceita: "Cidade, Município, Praça", obrigatoria: false, virou: "cidade" },
  { campo: "Segmento", aceita: "Segmento, Ramo, Categoria", obrigatoria: false, virou: "segmento — sem a coluna, é deduzido do nome" },
  { campo: "UF", aceita: "UF, Estado", obrigatoria: false, virou: "estado" },
  { campo: "CNPJ/CPF", aceita: "CNPJ, CPF, cnpj_cpf, Documento", obrigatoria: false, virou: "documento (só os dígitos)" },
  { campo: "Responsável", aceita: "Responsável, Vendedor(a), Consultor(a)", obrigatoria: false, virou: "responsável daquela linha" },
];

export default function ImportarPage() {
  const [file, setFile] = useState<File | null>(null);
  const [responsavel, setResponsavel] = useState("");
  const [duplicatas, setDuplicatas] = useState<ModoDuplicata>("ignorar");
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState<"preview" | "aplicar" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const concluido = analise?.modo === "aplicar";
  // Antes de gravar vale o que esta marcado na tela (a analise traz os dois
  // numeros); depois vale o que o servidor realmente aplicou.
  const modoDuplicata: ModoDuplicata =
    analise?.modo === "aplicar" ? analise.duplicatas : duplicatas;
  const vaiAtualizar = duplicatas === "atualizar" ? (analise?.atualizaveis ?? 0) : 0;
  const nadaAGravar = (analise?.novos ?? 0) === 0 && vaiAtualizar === 0;

  async function enviar(modo: "preview" | "aplicar") {
    if (!file) return;
    setCarregando(modo);
    setErro("");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("modo", modo);
    formData.append("duplicatas", duplicatas);
    if (responsavel.trim()) formData.append("responsavel", responsavel.trim());

    try {
      const res = await fetch("/api/clientes/importar", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error || "Erro ao processar a planilha.");
        return;
      }
      setAnalise(data);
      // A planilha manda o responsavel quando o campo esta vazio: mostra qual foi.
      if (modo === "preview" && !responsavel.trim() && data.responsavel) {
        setResponsavel(data.responsavel);
      }
    } catch {
      setErro("Erro de conexão ao enviar o arquivo.");
    } finally {
      setCarregando(null);
    }
  }

  function recomecar() {
    setFile(null);
    setAnalise(null);
    setErro("");
    setResponsavel("");
    setDuplicatas("ignorar");
    if (fileRef.current) fileRef.current.value = "";
  }

  function escolherArquivo(novo: File | null) {
    setFile(novo);
    setAnalise(null);
    setErro("");
  }

  return (
    <>
      <div className="flex items-center gap-4 mb-10">
        <Link href="/leads" className="p-2 rounded-lg hover:bg-surface-container-high transition-colors">
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <div>
          <h2 className="text-4xl font-extrabold text-primary tracking-tight leading-none mb-2">
            Importar Carteira de Disparo
          </h2>
          <p className="text-on-surface-variant font-medium text-lg">
            Suba a planilha da vendedora do jeito que ela já usa — o sistema lê e mostra o que vai
            entrar antes de gravar.
          </p>
        </div>
      </div>

      <div className="max-w-4xl space-y-6">
        {/* Modelo esperado */}
        <details className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6" open={!analise}>
          <summary className="text-lg font-bold text-primary cursor-pointer">
            Formato da planilha
          </summary>

          <p className="text-sm text-on-surface-variant mt-3 mb-4">
            O modelo é a <strong>carteira de disparo</strong>: título em cima, um{" "}
            <code className="px-1 rounded bg-surface-container-high">RESPONSÁVEL: NOME</code> e a
            linha de cabeçalho com as colunas. Linhas de título acima do cabeçalho são ignoradas, e a
            ordem das colunas não importa — o que vale é o nome delas.
          </p>

          <pre className="text-xs bg-surface-container-high rounded-xl p-4 overflow-x-auto mb-4 text-on-surface">
{`PLANILHA DE DISPAROS

RESPONSÁVEL: CRIS
Nº   Dia da semana   Repetir disparo   Contato          Clientes             Cidade
1º   SEGUNDA                           55 81 99623-0378 MERCADINHO NOVA VIT. RECIFE
2º   TERÇA           QUINTA            55 81 98790-4529 TEMPERO DA ROÇA      OLINDA`}
          </pre>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-outline-variant/10">
                  <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Coluna</th>
                  <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Nomes aceitos</th>
                  <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Vira</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {COLUNAS_ACEITAS.map((c) => (
                  <tr key={c.campo}>
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">
                      {c.campo}
                      {c.obrigatoria && <span className="text-error ml-1">*</span>}
                    </td>
                    <td className="px-3 py-2 text-on-surface-variant">{c.aceita}</td>
                    <td className="px-3 py-2 text-on-surface-variant">{c.virou}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="text-xs text-on-surface-variant mt-4 space-y-1 list-disc list-inside">
            <li>
              <strong>Repetir disparo</strong> não cria um segundo cliente: soma um dia ao mesmo
              cadastro (ex.: <code>SEGUNDA</code> + <code>QUINTA</code>).
            </li>
            <li>
              O telefone é normalizado para <code>55 + DDD + número</code>. Linha sem DDD ou com
              dígito faltando fica de fora e aparece no relatório.
            </li>
            <li>
              <strong>Duplicata nunca entra.</strong> Quem já está na base é reconhecido pelo
              telefone, pelo CNPJ/CPF ou pelo nome na mesma cidade — e a mesma checagem vale entre as
              linhas da própria planilha.
            </li>
            <li>* colunas obrigatórias.</li>
          </ul>
        </details>

        {/* Upload */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6">
          <div
            className="border-2 border-dashed border-outline-variant/30 rounded-xl p-10 text-center cursor-pointer hover:border-primary/30 transition-all"
            onClick={() => fileRef.current?.click()}
          >
            <span className="material-symbols-outlined text-5xl text-on-surface-variant mb-3 block">
              upload_file
            </span>
            {file ? (
              <div>
                <p className="text-sm font-semibold text-primary">{file.name}</p>
                <p className="text-xs text-on-surface-variant mt-1">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-semibold text-on-surface">
                  Clique para selecionar ou arraste o arquivo
                </p>
                <p className="text-xs text-on-surface-variant mt-1">Formatos aceitos: .xlsx, .xls, .csv</p>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => escolherArquivo(e.target.files?.[0] || null)}
            />
          </div>

          <div className="mt-4">
            <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
              Responsável pela carteira
            </label>
            <input
              type="text"
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
              placeholder="Deixe vazio para usar o RESPONSÁVEL: da planilha"
              className="w-full px-4 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
            />
          </div>

          {/* O que fazer com quem ja esta na base */}
          <fieldset className="mt-4">
            <legend className="text-xs font-semibold text-on-surface-variant mb-1.5">
              Quando o cliente já estiver cadastrado
            </legend>
            <div className="grid sm:grid-cols-2 gap-2">
              {(
                [
                  {
                    valor: "ignorar",
                    titulo: "Pular",
                    detalhe: "Deixa o cadastro atual como está.",
                  },
                  {
                    valor: "atualizar",
                    titulo: "Completar o cadastro",
                    detalhe: "Soma os dias de disparo e preenche o que está vazio.",
                  },
                ] as const
              ).map((opcao) => (
                <label
                  key={opcao.valor}
                  className={`flex gap-2.5 items-start p-3 rounded-xl border transition-colors ${
                    concluido ? "cursor-default opacity-60" : "cursor-pointer"
                  } ${
                    duplicatas === opcao.valor
                      ? "border-primary/40 bg-primary/5"
                      : "border-outline-variant/20 bg-surface-container-low hover:bg-surface-container"
                  }`}
                >
                  <input
                    type="radio"
                    name="duplicatas"
                    value={opcao.valor}
                    checked={duplicatas === opcao.valor}
                    onChange={() => setDuplicatas(opcao.valor)}
                    disabled={concluido || carregando !== null}
                    className="mt-0.5 accent-primary"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-on-surface">{opcao.titulo}</span>
                    <span className="block text-xs text-on-surface-variant">{opcao.detalhe}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-on-surface-variant mt-2">
              Nos dois casos <strong>nenhum cliente é duplicado</strong> — a checagem é por telefone,
              CNPJ/CPF e nome+cidade.
            </p>
          </fieldset>

          {!concluido && (
            <button
              onClick={() => enviar("preview")}
              disabled={!file || carregando !== null}
              className="mt-4 w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary text-on-primary font-semibold hover:opacity-90 transition-all text-sm shadow-lg shadow-primary/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {carregando === "preview" ? (
                <>
                  <span className="material-symbols-outlined animate-spin">progress_activity</span>
                  Lendo planilha...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined">search</span>
                  {analise ? "Analisar de novo" : "Analisar planilha"}
                </>
              )}
            </button>
          )}
        </div>

        {erro && (
          <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
            <span className="material-symbols-outlined text-base">error</span>
            {erro}
          </div>
        )}

        {analise && (
          <>
            {/* Resultado da leitura */}
            <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className={`material-symbols-outlined ${concluido ? "text-green-600" : "text-primary"}`}>
                  {concluido ? "check_circle" : "fact_check"}
                </span>
                <h3 className="font-bold text-on-surface">
                  {concluido ? "Importação concluída" : "Confira antes de importar"}
                </h3>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                {[
                  {
                    rotulo: concluido ? "Importados" : "Vão entrar",
                    valor: concluido ? analise.created : analise.novos,
                    destaque: true,
                  },
                  { rotulo: "Linhas na planilha", valor: analise.totalLinhas, destaque: false },
                  {
                    rotulo:
                      modoDuplicata === "atualizar"
                        ? concluido
                          ? "Cadastros atualizados"
                          : "Já cadastrados (serão completados)"
                        : "Já cadastrados (pulados)",
                    valor:
                      modoDuplicata === "atualizar"
                        ? concluido
                          ? analise.atualizados
                          : analise.atualizaveis
                        : analise.jaCadastrados,
                    destaque: false,
                  },
                  { rotulo: "Com problema", valor: analise.descartados, destaque: false },
                ].map((cartao) => (
                  <div
                    key={cartao.rotulo}
                    className={`rounded-xl p-4 border ${
                      cartao.destaque
                        ? "bg-primary/5 border-primary/20"
                        : "bg-surface-container-low border-outline-variant/10"
                    }`}
                  >
                    <p className={`text-3xl font-black ${cartao.destaque ? "text-primary" : "text-on-surface"}`}>
                      {cartao.valor}
                    </p>
                    <p className="text-xs text-on-surface-variant mt-0.5">{cartao.rotulo}</p>
                  </div>
                ))}
              </div>

              <dl className="text-xs text-on-surface-variant space-y-1 mb-5">
                <div>
                  <dt className="inline font-semibold">Aba:</dt>{" "}
                  <dd className="inline">
                    {analise.aba} (cabeçalho na linha {analise.linhaCabecalho})
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Colunas reconhecidas:</dt>{" "}
                  <dd className="inline">
                    {Object.entries(analise.colunas)
                      .map(([campo, rotulo]) => `${NOMES_CAMPO[campo] ?? campo} ← "${rotulo}"`)
                      .join(" · ")}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Responsável:</dt>{" "}
                  <dd className="inline">
                    {analise.responsavel ?? "— nenhum"}
                    {analise.responsavelPlanilha && (
                      <span className="opacity-70"> (planilha diz &quot;{analise.responsavelPlanilha}&quot;)</span>
                    )}
                  </dd>
                </div>
                {analise.tag && (
                  <div>
                    <dt className="inline font-semibold">Tag do lote:</dt>{" "}
                    <dd className="inline">{analise.tag}</dd>
                  </div>
                )}
              </dl>

              <div className="grid sm:grid-cols-2 gap-4">
                <ResumoContagem
                  titulo="Dias de disparo"
                  dados={analise.resumo.porDia}
                  rotular={(chave) => formatDiasDisparo(chave.split("+"))}
                />
                <ResumoContagem titulo="Segmento" dados={analise.resumo.porSegmento} />
              </div>
            </div>

            {/* Amostra */}
            {analise.amostra.length > 0 && (
              <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden">
                <h3 className="font-bold text-on-surface px-6 pt-5 pb-3">
                  {concluido ? "Primeiros importados" : "Amostra do que vai entrar"}
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-surface-container-low">
                      <tr>
                        {["Linha", "Cliente", "WhatsApp", "Dias", "Segmento", "Cidade"].map((h) => (
                          <th
                            key={h}
                            className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-on-surface-variant whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/10">
                      {analise.amostra.map((linha) => {
                        const cor = SEGMENTO_COLORS[linha.segmento] ?? SEGMENTO_COLORS.OUTRO;
                        return (
                          <tr key={linha.linha}>
                            <td className="px-4 py-2 text-on-surface-variant">{linha.linha}</td>
                            <td className="px-4 py-2 font-semibold text-on-surface">{linha.empresa}</td>
                            <td className="px-4 py-2 text-on-surface-variant whitespace-nowrap">
                              {formatPhone(linha.contatoWhatsapp)}
                            </td>
                            <td className="px-4 py-2 text-on-surface-variant whitespace-nowrap">
                              {formatDiasDisparo(linha.diasDisparo)}
                            </td>
                            <td className="px-4 py-2">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-lg text-[10px] font-bold border ${cor.bg} ${cor.text} ${cor.border}`}
                                title={linha.segmentoInferido ? "Deduzido do nome do cliente" : "Veio da planilha"}
                              >
                                {linha.segmento}
                                {linha.segmentoInferido && "?"}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-on-surface-variant">
                              {linha.cidade ?? "—"}
                              {linha.uf ? `/${linha.uf}` : ""}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-on-surface-variant px-6 py-3 border-t border-outline-variant/10">
                  Segmento com <strong>?</strong> foi deduzido do nome do cliente — dá para corrigir
                  depois em lote na Base de Clientes.
                </p>
              </div>
            )}

            {/* O que ficou de fora */}
            {(analise.descartadas.length > 0 || analise.conflitos.length > 0) && (
              <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6 space-y-4">
                <h3 className="font-bold text-on-surface">O que ficou de fora</h3>

                {analise.descartadas.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-error mb-1.5">
                      Linhas com problema ({analise.descartados})
                    </p>
                    <ul className="text-xs text-on-surface-variant space-y-1 max-h-52 overflow-y-auto">
                      {analise.descartadas.map((d) => (
                        <li key={d.linha}>• {d.detalhe}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {analise.conflitos.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-amber-700 mb-1.5">
                      Já cadastrados ({analise.jaCadastrados}) —{" "}
                      {modoDuplicata === "atualizar"
                        ? "cadastro existente completado, sem duplicar"
                        : "não entram de novo"}
                    </p>
                    <ul className="text-xs text-on-surface-variant space-y-1 max-h-52 overflow-y-auto">
                      {analise.conflitos.map((c) => (
                        <li key={c.linha}>
                          • Linha {c.linha}: {c.empresa} já está como{" "}
                          <strong>{c.jaCadastradoComo}</strong>
                          {c.responsavelAtual ? ` (${c.responsavelAtual})` : ""} —{" "}
                          {ROTULO_CRITERIO[c.criterio] ?? c.criterio}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Acao */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6">
              {concluido ? (
                <>
                  <p className="text-sm text-on-surface-variant">
                    <strong className="text-on-surface">{analise.created}</strong> cliente(s)
                    cadastrado(s)
                    {analise.responsavel ? ` para ${analise.responsavel}` : ""}
                    {analise.atualizados > 0 && (
                      <>
                        {" "}
                        e <strong className="text-on-surface">{analise.atualizados}</strong> cadastro(s)
                        existente(s) completado(s)
                      </>
                    )}
                    .
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={recomecar}
                      className="px-5 py-2.5 rounded-xl border border-outline-variant/20 text-sm font-semibold text-on-surface-variant hover:bg-surface-container transition-colors"
                    >
                      Importar outra
                    </button>
                    <Link
                      href="/leads"
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition"
                    >
                      <span className="material-symbols-outlined text-lg">group</span>
                      Ver Base de Clientes
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-on-surface-variant">
                    {analise.novos === 0
                      ? "Nenhum cliente novo para importar nesta planilha."
                      : `Vão ser criados ${analise.novos} cliente(s)${
                          analise.responsavel ? ` para ${analise.responsavel}` : " sem responsável"
                        }.`}
                    {vaiAtualizar > 0 &&
                      ` ${vaiAtualizar} cadastro(s) que já existiam serão completados, sem duplicar.`}
                  </p>
                  <button
                    onClick={() => enviar("aplicar")}
                    disabled={nadaAGravar || carregando !== null}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition disabled:opacity-40"
                  >
                    {carregando === "aplicar" ? (
                      <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
                    ) : (
                      <span className="material-symbols-outlined text-lg">cloud_upload</span>
                    )}
                    {carregando === "aplicar"
                      ? "Importando..."
                      : analise.novos > 0
                        ? `Importar ${analise.novos} clientes`
                        : `Completar ${vaiAtualizar} cadastros`}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function ResumoContagem({
  titulo,
  dados,
  rotular,
}: {
  titulo: string;
  dados: Record<string, number>;
  rotular?: (chave: string) => string;
}) {
  const linhas = Object.entries(dados).sort((a, b) => b[1] - a[1]);
  if (linhas.length === 0) return null;

  return (
    <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">{titulo}</p>
      <ul className="space-y-1 max-h-40 overflow-y-auto">
        {linhas.map(([chave, n]) => (
          <li key={chave} className="flex items-center justify-between text-sm">
            <span className="text-on-surface truncate">{rotular ? rotular(chave) : chave}</span>
            <span className="font-bold text-on-surface-variant ml-3 shrink-0">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
