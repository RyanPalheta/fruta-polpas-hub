"use client";

import { useState, useRef } from "react";
import Link from "next/link";

export default function ImportarPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
    if (!file) return;
    setLoading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/clientes/importar", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setResult(data);
    } catch {
      setResult({ created: 0, errors: ["Erro ao processar arquivo."] });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-4 mb-10">
        <Link
          href="/leads"
          className="p-2 rounded-lg hover:bg-surface-container-high transition-colors"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <div>
          <h2 className="text-4xl font-extrabold text-primary tracking-tight leading-none mb-2">
            Importar Planilha
          </h2>
          <p className="text-on-surface-variant font-medium text-lg">
            Importe sua base de clientes via arquivo Excel ou CSV.
          </p>
        </div>
      </div>

      <div className="max-w-2xl">
        {/* Instructions */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6 mb-6">
          <h3 className="text-lg font-bold text-primary mb-3">Formato esperado</h3>
          <p className="text-sm text-on-surface-variant mb-4">
            A planilha deve conter as seguintes colunas (a primeira linha e o cabecalho):
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-outline-variant/10">
                  <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                    Coluna
                  </th>
                  <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                    Obrigatoria
                  </th>
                  <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                    Exemplo
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                <tr>
                  <td className="px-3 py-2 font-semibold">empresa</td>
                  <td className="px-3 py-2">Sim</td>
                  <td className="px-3 py-2 text-on-surface-variant">Bistro das Nuvens</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-semibold">contato_whatsapp</td>
                  <td className="px-3 py-2">Sim</td>
                  <td className="px-3 py-2 text-on-surface-variant">11987654321</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-semibold">segmento</td>
                  <td className="px-3 py-2">Sim</td>
                  <td className="px-3 py-2 text-on-surface-variant">RESTAURANTE</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-semibold">dia_disparo</td>
                  <td className="px-3 py-2">Sim</td>
                  <td className="px-3 py-2 text-on-surface-variant">SEGUNDA</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-semibold">cidade</td>
                  <td className="px-3 py-2">Nao</td>
                  <td className="px-3 py-2 text-on-surface-variant">Sao Paulo</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-semibold">uf</td>
                  <td className="px-3 py-2">Nao</td>
                  <td className="px-3 py-2 text-on-surface-variant">SP</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Upload area */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6 mb-6">
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
                <p className="text-xs text-on-surface-variant mt-1">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-semibold text-on-surface">
                  Clique para selecionar ou arraste o arquivo
                </p>
                <p className="text-xs text-on-surface-variant mt-1">
                  Formatos aceitos: .xlsx, .xls, .csv
                </p>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>

          <button
            onClick={handleUpload}
            disabled={!file || loading}
            className="mt-4 w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary text-on-primary font-semibold hover:opacity-90 transition-all text-sm shadow-lg shadow-primary/10 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <span className="material-symbols-outlined animate-spin">progress_activity</span>
                Processando...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined">cloud_upload</span>
                Importar Clientes
              </>
            )}
          </button>
        </div>

        {/* Result */}
        {result && (
          <div
            className={`rounded-2xl p-6 ${
              result.errors.length > 0
                ? "bg-red-50 border border-red-200"
                : "bg-green-50 border border-green-200"
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`material-symbols-outlined ${
                  result.errors.length > 0 ? "text-error" : "text-green-600"
                }`}
              >
                {result.errors.length > 0 ? "warning" : "check_circle"}
              </span>
              <h3 className="font-bold text-on-surface">Resultado da Importacao</h3>
            </div>
            <p className="text-sm text-on-surface-variant mb-2">
              <strong>{result.created}</strong> clientes importados com sucesso.
            </p>
            {result.errors.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-bold text-error mb-1">Erros ({result.errors.length}):</p>
                <ul className="text-xs text-error space-y-1 max-h-40 overflow-y-auto">
                  {result.errors.map((err, i) => (
                    <li key={i}>• {err}</li>
                  ))}
                </ul>
              </div>
            )}
            <Link
              href="/leads"
              className="inline-flex items-center gap-1 mt-4 text-sm font-semibold text-primary hover:underline"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
              Voltar para Base de Clientes
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
