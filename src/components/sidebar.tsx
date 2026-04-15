"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", icon: "dashboard", label: "Dashboard" },
  { href: "/disparos", icon: "send", label: "Disparos" },
  { href: "/leads", icon: "group", label: "Leads" },
  { href: "/configuracoes", icon: "settings", label: "Configuracoes" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="h-screen w-64 fixed left-0 top-0 bg-slate-100 flex flex-col py-6 px-4 border-r-0 z-50">
      <div className="flex items-center gap-3 px-2 mb-10">
        <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0">
          <Image src="/logo.svg" alt="Logo" width={40} height={40} className="w-full h-full object-cover" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-neutral-900 leading-tight">
            Fruta Polpas
          </h1>
          <p className="text-[10px] uppercase tracking-widest text-on-secondary-container font-medium">
            Automation Hub
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                isActive
                  ? "flex items-center gap-3 px-4 py-3 bg-white text-neutral-900 rounded-lg font-semibold shadow-sm"
                  : "flex items-center gap-3 px-4 py-3 text-neutral-500 hover:text-neutral-900 hover:bg-white/50 transition-all hover:translate-x-1"
              }
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-1 pt-6 border-t border-outline-variant/10">
        <a
          href="#"
          className="flex items-center gap-3 px-4 py-3 text-neutral-500 hover:text-neutral-900 hover:bg-white/50 transition-all"
        >
          <span className="material-symbols-outlined">help</span>
          <span className="font-medium">Suporte</span>
        </a>
      </div>
    </aside>
  );
}
