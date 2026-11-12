import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vehicle3D AI",
  description: "Da una foto a un modello 3D del veicolo, pronto per Minecraft Bedrock, GLB e OBJ.",
  applicationName: "Vehicle3D AI",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b1020",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it">
      <body className="antialiased">{children}</body>
    </html>
  );
}
