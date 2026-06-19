export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const calendarId = searchParams.get("calendarId");
    const timeMin = searchParams.get("timeMin");
    const timeMax = searchParams.get("timeMax");
    const apiKey = request.headers.get("x-calendar-key");
    if (!calendarId || !apiKey) {
      return Response.json({ error: "Missing calendarId or API key" }, { status: 400 });
    }
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?key=${apiKey}&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&timeZone=Europe/Bucharest`;
    const response = await fetch(url);
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
