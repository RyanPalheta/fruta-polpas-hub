import { prisma } from "@/lib/prisma";
import { StatCard } from "@/components/stat-card";
import Link from "next/link";
import { LeadsTable } from "./leads-table";

export const dynamic = "force-dynamic";

const PER_PAGE = 10;

const SEGMENTO_FILTERS = [
  { label: "Todos", value: "" },
  { label: "Restaurantes", value: "RESTAURANTE" },
  { label: "Hoteis", value: "HOTELARIA" },
  { label: "Academias", value: "ACADEMIA" },
];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; segmento?: string }>;
}) {
  const params = await searchParams;

  const page = Math.max(1, parseInt(params.page || "1", 10));
  const search = params.search || "";
  const segmento = params.segmento || "";

  const where: Record<string, unknown> = {};

  if (search) {
    where.OR = [
      { empresa: { contains: search, mode: "insensitive" } },
      { contatoWhatsapp: { contains: search, mode: "insensitive" } },
      { cidade: { contains: search, mode: "insensitive" } },
    ];
  }

  if (segmento) {
    where.segmento = segmento;
  }

  const [clientes, totalCount, totalClientes, clientesAtivos] =
    await Promise.all([
      prisma.cliente.findMany({
        where,
        orderBy: { empresa: "asc" },
        skip: (page - 1) * PER_PAGE,
        take: PER_PAGE,
      }),
      prisma.cliente.count({ where }),
      prisma.cliente.count(),
      prisma.cliente.count({ where: { ativo: true } }),
    ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));

  function buildUrl(overrides: Record<string, string>) {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (segmento) p.set("segmento", segmento);
    if (page > 1) p.set("page", String(page));
    for (const [k, v] of Object.entries(overrides)) {
      if (v) {
        p.set(k, v);
      } else {
        p.delete(k);
      }
    }
    const qs = p.toString();
    return `/leads${qs ? `?${qs}` : ""}`;
  }

  return (
    <>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-6">
        <div>
          <h2 className="text-4xl font-extrabold text-primary tracking-tight leading-none mb-2">
            Base de Clientes
          </h2>
          <p className="text-on-surface-variant font-medium text-lg">
            Gerencie sua carteira de leads e clientes.
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/leads/importar"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-surface-container-lowest border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container-low transition-colors shadow-sm"
          >
            <span className="material-symbols-outlined text-lg">upload_file</span>
            Importar Planilha
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatCard label="Total de Clientes" value={totalClientes.toLocaleString("pt-BR")} />
        <StatCard label="Clientes Ativos" value={clientesAtivos.toLocaleString("pt-BR")} color="text-green-700" />
        <StatCard
          label="Resultados"
          value={totalCount.toLocaleString("pt-BR")}
          color="text-on-tertiary-container"
        />
      </div>

      {/* Filters + Search */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Segment filter buttons */}
          <div className="flex flex-wrap gap-2">
            {SEGMENTO_FILTERS.map((f) => {
              const isActive = segmento === f.value;
              return (
                <Link
                  key={f.value}
                  href={buildUrl({ segmento: f.value, page: "" })}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                    isActive
                      ? "bg-primary text-white shadow-sm"
                      : "bg-surface-container-low text-on-surface-variant hover:bg-surface-bright"
                  }`}
                >
                  {f.label}
                </Link>
              );
            })}
            <Link
              href={buildUrl({ segmento: "", page: "" })}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-surface-container-low text-on-surface-variant hover:bg-surface-bright transition-colors flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-base">tune</span>
              Filtros Avancados
            </Link>
          </div>

          {/* Search */}
          <form className="flex gap-2" action="/leads" method="GET">
            {segmento && <input type="hidden" name="segmento" value={segmento} />}
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
                search
              </span>
              <input
                type="text"
                name="search"
                defaultValue={search}
                placeholder="Buscar empresa, telefone, cidade..."
                className="pl-10 pr-4 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface placeholder:text-on-surface-variant/60 w-72 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Buscar
            </button>
          </form>
        </div>
      </div>

      {/* Data Table with bulk select */}
      <LeadsTable clientes={clientes} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-on-surface-variant">
            Mostrando{" "}
            <span className="font-semibold text-on-surface">
              {(page - 1) * PER_PAGE + 1}
            </span>{" "}
            a{" "}
            <span className="font-semibold text-on-surface">
              {Math.min(page * PER_PAGE, totalCount)}
            </span>{" "}
            de{" "}
            <span className="font-semibold text-on-surface">
              {totalCount}
            </span>{" "}
            clientes
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={buildUrl({ page: String(page - 1) })}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-surface-container-low text-on-surface-variant text-sm font-semibold hover:bg-surface-bright transition-colors"
              >
                <span className="material-symbols-outlined text-base">chevron_left</span>
                Anterior
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-surface-container-low text-on-surface-variant/40 text-sm font-semibold cursor-not-allowed">
                <span className="material-symbols-outlined text-base">chevron_left</span>
                Anterior
              </span>
            )}

            {/* Page numbers */}
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(
                (p) =>
                  p === 1 ||
                  p === totalPages ||
                  (p >= page - 1 && p <= page + 1)
              )
              .reduce<(number | string)[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) {
                  acc.push("...");
                }
                acc.push(p);
                return acc;
              }, [])
              .map((item, idx) =>
                typeof item === "string" ? (
                  <span
                    key={`ellipsis-${idx}`}
                    className="px-3 py-2 text-sm text-on-surface-variant"
                  >
                    ...
                  </span>
                ) : (
                  <Link
                    key={item}
                    href={buildUrl({ page: item === 1 ? "" : String(item) })}
                    className={`px-3.5 py-2 rounded-xl text-sm font-semibold transition-colors ${
                      item === page
                        ? "bg-primary text-white shadow-sm"
                        : "bg-surface-container-low text-on-surface-variant hover:bg-surface-bright"
                    }`}
                  >
                    {item}
                  </Link>
                )
              )}

            {page < totalPages ? (
              <Link
                href={buildUrl({ page: String(page + 1) })}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-surface-container-low text-on-surface-variant text-sm font-semibold hover:bg-surface-bright transition-colors"
              >
                Proximo
                <span className="material-symbols-outlined text-base">chevron_right</span>
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-surface-container-low text-on-surface-variant/40 text-sm font-semibold cursor-not-allowed">
                Proximo
                <span className="material-symbols-outlined text-base">chevron_right</span>
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
