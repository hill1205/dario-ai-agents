const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;

const LIST_IDS = {
  leads: "901218950390",
  clienti: "901218950389",
};

async function fetchList(listId) {
  const res = await fetch(
    `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=false`,
    { headers: { Authorization: CLICKUP_API_KEY } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.tasks || [];
}

export async function GET() {
  try {
    const [leads, clienti] = await Promise.all([
      fetchList(LIST_IDS.leads),
      fetchList(LIST_IDS.clienti),
    ]);
    return Response.json({ leads, clienti });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { tipo, nome, contatto, email, telefono, budget, stage, note } = await request.json();
    const listId = tipo === "cliente" ? LIST_IDS.clienti : LIST_IDS.leads;
    const description = JSON.stringify({ contatto, email, telefono, budget, note });
    const res = await fetch(
      `https://api.clickup.com/api/v2/list/${listId}/task`,
      {
        method: "POST",
        headers: { Authorization: CLICKUP_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ name: nome, description, status: stage }),
      }
    );
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
