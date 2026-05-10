import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kushal Automation | Smart Lead Generator",
  description: "Automatically find and message businesses in any location. Lead generation powered by Kushal Automation.",
  keywords: "automation, lead generation, whatsapp, business finder, kushal automation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
