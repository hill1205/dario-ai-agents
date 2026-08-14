// viewport-fit=cover (14/08): senza questa riga env(safe-area-inset-bottom)
// vale SEMPRE 0 su iPhone, quindi il padding di sicurezza gia' presente nella
// barra mobile non produceva nessun margine e i tasti finivano sotto la
// barretta home. Con "cover" il browser espone davvero l'altezza della zona
// non cliccabile e il menu si alza da solo. maximumScale/userScalable non li
// tocchiamo: lo zoom resta libero.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#09090F",
};

export const metadata = {
  title: "Dario AI Agents",
  description: "Assistenti AI personali di Dario Angeloro",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Dario AI",
  },
  icons: {
    icon: [
      { url: "/icon-256.png", sizes: "256x256", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icon-256.png", sizes: "256x256", type: "image/png" },
    ],
  },
};

// Banner mostrato solo se APP_PASSWORD non è configurata su Vercel: il
// middleware in quel caso lascia passare tutti (fail-open, per non
// rendere l'app inaccessibile dal telefono), quindi la mancanza di
// protezione deve essere visibile invece di restare silenziosa.
// Questo è un Server Component, quindi process.env è leggibile qui e il
// valore della password non arriva mai al browser: mandiamo solo il
// booleano "configurata / non configurata".
function UnprotectedBanner() {
  if (process.env.APP_PASSWORD) return null;
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 99999,
      background: "#DC2626", color: "#fff", padding: "6px 12px",
      fontSize: 12, fontWeight: 600, fontFamily: "system-ui, sans-serif",
      textAlign: "center", lineHeight: 1.35,
    }}>
      ⚠️ App non protetta — imposta la variabile <code style={{ background:"rgba(0,0,0,0.25)", padding:"1px 4px", borderRadius:3 }}>APP_PASSWORD</code> su Vercel: finché manca, chiunque abbia il link può leggere e modificare i tuoi dati.
    </div>
  );
}

export default function RootLayout({ children }) {
  return (
    <html lang="it">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Dario AI" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-256.png" />
      </head>
      <body style={{ margin: 0, padding: 0, overflow: "hidden" }}>
        <UnprotectedBanner />
        {children}
      </body>
    </html>
  );
}
