// Minimal dashboard shell. Real UI iterates from here.
export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "64px auto", padding: 24 }}>
      <h1>RadarPL</h1>
      <p style={{ color: "#555" }}>
        Silnik sygnałów popytu z publicznych danych. Codziennie dostajesz
        gotowe, ocenione leady dopasowane do Twojego profilu — z draftem
        wiadomości do wysłania.
      </p>
      <ul>
        <li><code>GET /api/health</code> — status systemu</li>
        <li><code>GET /api/leads?tenantId=…</code> — leady wg intencji</li>
        <li><code>POST /api/ingest</code> — wejście dla crawlerów / n8n</li>
      </ul>
      <p style={{ marginTop: 32, fontSize: 14, color: "#888" }}>
        Status: scaffold produkcyjny. Rdzeń scoringu przetestowany (node --test).
      </p>
    </main>
  );
}
