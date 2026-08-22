/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // 1) pdfjs-dist NON va impacchettata da webpack nella funzione serverless.
    //    In Node pdf.js avvia un "fake worker" importando pdf.worker.mjs: se la
    //    libreria e' bundlata, quel percorso finisce in
    //    /var/task/.next/server/chunks/pdf.worker.mjs — che non esiste — e
    //    l'upload dell'estratto conto muore con
    //    "Setting up fake worker failed: Cannot find module ...".
    serverComponentsExternalPackages: ["pdfjs-dist"],

    // 2) Il file del worker non viene "tracciato" da Next (nessun import
    //    statico lo nomina), quindi Vercel non lo caricherebbe nella funzione.
    //    Qui lo si include a mano nel bundle della sola route che ne ha
    //    bisogno.
    outputFileTracingIncludes: {
      "/api/parse-statement": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
    },
  },
};
export default nextConfig;
