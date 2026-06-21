const API_KEY = process.env.OPENWEATHER_API_KEY;
const CITY = "Timisoara";
const COUNTRY = "RO";

export async function GET() {
  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${CITY},${COUNTRY}&appid=${API_KEY}&units=metric&lang=it`,
      { next: { revalidate: 1800 } }
    );

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
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
