import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Catálogo de reglas — Lainco Quality",
  description: "Inventario y ciclo de vida de las reglas de calidad de código de Lainco.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
