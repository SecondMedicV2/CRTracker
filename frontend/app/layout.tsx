import "./globals.css";

export const metadata = {
  title: "CRTracker - SecondMedic",
  description: "SecondMedic CRTracker report follow-up CRM",
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png"
  }
};

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/logo.png" />
      </head>
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
