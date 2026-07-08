export const dynamic = "force-dynamic";

const API_KEY = process.env.OPENWEATHER_API_KEY;
const DEFAULT_CITY = "Timisoara";
const DEFAULT_COUNTRY = "RO";

// OpenWeather (piano gratuito) risponde spesso in 8-10 secondi da questa
// regione Vercel — misurato: le altre 5 chiamate della home insieme ci
// mettono meno di 1.5s, questa da sola 10+. Con "force-dynamic" la cache
// fetch di Next (next.revalidate) non si applicava mai, quindi ogni
// apertura della dashboard rifaceva la chiamata lenta da capo. Qui usiamo
// una cache in-memory a livello di modulo: sopravvive tra invocazioni
// quando la funzione serverless resta "calda" (il caso comune con più
// utenti/richieste ravvicinate), tagliando la stragrande maggioranza delle
// chiamate reali a OpenWeather. Una cache per chiave lat/lon (o "default").
const CACHE_MS = 20 * 60 * 1000; // 20 minuti: il meteo non cambia più veloce di così
const cache = new Map(); // key -> { data, ts }

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get("lat");
    const lon = searchParams.get("lon");
    const cacheKey = (lat && lon) ? `${lat},${lon}` : "default";

    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < CACHE_MS) {
      return Response.json(cached.data);
    }

    const url = (lat && lon)
      ? `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=it`
      : `https://api.openweathermap.org/data/2.5/weather?q=${DEFAULT_CITY},${DEFAULT_COUNTRY}&appid=${API_KEY}&units=metric&lang=it`;

    // Timeout esplicito: se OpenWeather è lento oltre soglia, meglio
    // restituire l'errore (il frontend tiene il meteo precedente) che
    // lasciare la richiesta appesa e bloccare chi aspetta questa risposta.
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(), 8000);
    let res, data;
    try {
      res = await fetch(url, { signal: controller.signal });
      data = await res.json();
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      return Response.json({ error: data.message }, { status: res.status });
    }

    const result = {
      temp: Math.round(data.main.temp),
      feels_like: Math.round(data.main.feels_like),
      condition: data.weather[0].main,
      description: data.weather[0].description,
      icon: data.weather[0].icon,
      humidity: data.main.humidity,
      wind: Math.round(data.wind.speed * 3.6),
      city: data.name || DEFAULT_CITY,
    };
    cache.set(cacheKey, { data: result, ts: Date.now() });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.name==="AbortError" ? "Timeout meteo" : error.message }, { status: 500 });
  }
}
