import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MTG-AI Commander Lab",
  description: "One human and three Ollama agents playing Commander."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
