import type { Metadata } from "next";
import "./globals.css";
import { RANDOM_UUID_POLYFILL } from "@/lib/multiplayer/randomUuidPolyfill";

export const metadata: Metadata = {
  title: "MTG-AI Commander Lab",
  description: "One human and three Ollama agents playing Commander."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* crypto.randomUUID is missing on plain-http origins (e.g. a Hamachi address); see the polyfill file. */}
        <script dangerouslySetInnerHTML={{ __html: RANDOM_UUID_POLYFILL }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
