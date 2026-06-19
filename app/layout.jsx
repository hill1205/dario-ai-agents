export const metadata = {
  title: "AI Agents — Dario",
  description: "Assistenti AI personali di Dario Angeloro",
};

export default function RootLayout({ children }) {
  return (
    <html lang="it">
      <body style={{ margin: 0, padding: 0, overflow: "hidden" }}>
        {children}
      </body>
    </html>
  );
}
