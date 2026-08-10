"use client";

import { DIAS_SEMANA, DIA_LABELS, ordenarDias } from "@/lib/utils";

interface Props {
  value: string[];
  onChange: (dias: string[]) => void;
  /** Desabilita a interacao (ex: enquanto salva). */
  disabled?: boolean;
}

/**
 * Selecao multipla dos dias em que o cliente recebe disparo.
 * A ordem da lista e sempre a da semana, independente da ordem dos cliques.
 */
export function DiasDisparoPicker({ value, onChange, disabled }: Props) {
  function toggle(dia: string) {
    const proximos = value.includes(dia)
      ? value.filter((d) => d !== dia)
      : ordenarDias([...value, dia]);
    onChange(proximos);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {DIAS_SEMANA.map((dia) => {
        const ativo = value.includes(dia);
        return (
          <button
            key={dia}
            type="button"
            onClick={() => toggle(dia)}
            disabled={disabled}
            aria-pressed={ativo}
            className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-50 ${
              ativo
                ? "bg-primary text-white border-primary shadow-sm"
                : "bg-surface-container-low text-on-surface-variant border-outline-variant/20 hover:bg-surface-bright"
            }`}
          >
            {DIA_LABELS[dia]}
          </button>
        );
      })}
    </div>
  );
}
