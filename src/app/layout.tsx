import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";

export const metadata: Metadata = {
  title: "Fruta Polpas - Automation Hub",
  description: "Gestao de leads, disparos e funil de vendas",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-br" className="h-full antialiased">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full bg-surface text-on-surface">
        <Sidebar />
        <main className="ml-64 min-h-screen flex flex-col">
          <Header />
          <section className="p-8 max-w-7xl mx-auto w-full flex-1">
            {children}
          </section>
        </main>
      </body>
    </html>
  );
}
