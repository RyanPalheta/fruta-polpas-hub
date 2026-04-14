import { DiaSemana } from "@/generated/prisma/client";

export function getDiaSemanaHoje(): DiaSemana | null {
  const day = new Date().getDay();
  const map: Record<number, DiaSemana> = {
    1: "SEGUNDA",
    2: "TERCA",
    3: "QUARTA",
    4: "QUINTA",
    5: "SEXTA",
  };
  return map[day] || null;
}

export function getInicioSemana(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getFimSemana(date: Date = new Date()): Date {
  const inicio = getInicioSemana(date);
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + 4);
  fim.setHours(23, 59, 59, 999);
  return fim;
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 13) {
    return `(${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  return phone;
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export const SEGMENTO_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  RESTAURANTE: { bg: "bg-green-100", text: "text-green-800", border: "border-green-200" },
  HOTELARIA: { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-200" },
  ACADEMIA: { bg: "bg-amber-100", text: "text-amber-800", border: "border-amber-200" },
  DISTRIBUIDOR: { bg: "bg-purple-100", text: "text-purple-800", border: "border-purple-200" },
  FRANQUIA: { bg: "bg-indigo-100", text: "text-indigo-800", border: "border-indigo-200" },
  EVENTOS: { bg: "bg-pink-100", text: "text-pink-800", border: "border-pink-200" },
  OUTRO: { bg: "bg-gray-100", text: "text-gray-800", border: "border-gray-200" },
};

export const DIA_LABELS: Record<string, string> = {
  SEGUNDA: "Segunda",
  TERCA: "Terça",
  QUARTA: "Quarta",
  QUINTA: "Quinta",
  SEXTA: "Sexta",
};

export const STATUS_LABELS: Record<string, string> = {
  AGUARDANDO: "Aguardando",
  DISPARADO: "Disparado",
  RESPONDEU: "Respondeu",
  PEDIDO_CONFIRMADO: "Pedido Confirmado",
  PEDIDO_NAO_REALIZADO: "Pedido Não Realizado",
  NAO_RESPONDEU: "Não Respondeu",
  SUPORTE_HUMANO: "Suporte Humano",
};

export const STATUS_COLORS: Record<string, string> = {
  AGUARDANDO: "bg-gray-100 text-gray-700",
  DISPARADO: "bg-blue-100 text-blue-700",
  RESPONDEU: "bg-yellow-100 text-yellow-700",
  PEDIDO_CONFIRMADO: "bg-green-100 text-green-700",
  PEDIDO_NAO_REALIZADO: "bg-red-100 text-red-700",
  NAO_RESPONDEU: "bg-slate-200 text-slate-600",
  SUPORTE_HUMANO: "bg-orange-100 text-orange-700",
};
