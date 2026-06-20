// app/api/chat/route.js

import { fetchMorningContext, buildContextString } from "@/lib/clickup";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function isMorningGreeting(messages) {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return false;
  const text = (typeof last.content === "string" ? last.content : last.content?.[0]?.text ?? "").toLowerCase().trim();
  return ["buongiorno", "buon giorno", "ciao bea", "morning"].some((g) => text.startsWith(g));
}

function isBea(system) {
  if (!system) return false;
  const text = typeof system === "string" ? system : system?.[0]?.text ?? "";
  return text.toLowerCase().includes("beatrice") || text.toLowerCase().includes("bea");
}

export async function POST(request) {
  try {
    const body = await request.json();

    // Inject ClickUp context solo per Bea al saluto mattutino
    if (isBea(body.system) && isMorningGreeting(body.messages)) {
      const apiKey = process.env.CLICKUP_API_KEY;
      if (apiKey) {
        const ctx = await fetchMorningContext(apiKey);
        const contextString = buildContextString(ctx);

        // Appendi il contesto al system prompt esistente
        if (typeof body.system === "string") {
          body.system = body.system + "\n\n" + contextString;
        } else if (Array.isArray(body.system)) {
          body.system = [
            ...body.system,
            { type: "text", text: contextString },
          ];
        }
      }
    }

    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
