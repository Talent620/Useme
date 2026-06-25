export const metadata = { title: "RadarPL", description: "Demand-signal engine" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
