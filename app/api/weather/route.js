export const dynamic = "force-dynamic";

const API_KEY = process.env.OPENWEATHER_API_KEY;
const DEFAULT_CITY = "Timisoara";
const DEFAULT_COUNTRY = "RO";

// Con lat/lon (passati dal toggle "meteo posizione attuale" in page.jsx)
// interroghiamo OpenWeather sulle coordinate reali invece che sulla città
// fissa. In entrambi i casi restituiamo "city" preso dalla risposta di
// OpenWeather stessa (data.name), non da un valore hardcoded: così il
// frontend mostra sempre il nome corretto, anche quando cambia in base
// alla posizione.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get("lat");
    const lon = searchParams.get("lon");
    const url = (lat && lon)
      ? `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=it`
      : `https://api.openweathermap.org/data/2.5/weather?q=${DEFAULT_CITY},${DEFAULT_COUNTRY}&appid=${API_KEY}&units=metric&lang=it`;

    const res = await fetch(url, { next: { revalidate: 1800 } });
    const data = await res.json();

    if (!res.ok) {
      return Response.json({ error: data.message }, { status: res.status });
    }

    return Response.json({
      temp: Math.round(data.main.temp),
      feels_like: Math.round(data.main.feels_like),
      condition: data.weather[0].main,
      description: data.weather[0].description,
      icon: data.weather[0].icon,
      humidity: data.main.humidity,
      wind: Math.round(data.wind.speed * 3.6),
      city: data.name || DEFAULT_CITY,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
