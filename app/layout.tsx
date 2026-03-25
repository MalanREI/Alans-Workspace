import "./globals.css";
import type { Metadata } from "next";
import { APP_NAME } from "@/src/config/app.config";
import { RecordingProvider } from "@/src/context/RecordingContext";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Internal admin panel",
  icons: {
    icon: "/favicon.png?v=20260325",
    shortcut: "/favicon.png?v=20260325",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RecordingProvider>{children}</RecordingProvider>
      </body>
    </html>
  );
}
