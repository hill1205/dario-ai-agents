const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;

export async function POST(request) {
  try {
    const { taskId, status, dueDate, name } = await request.json();

    if (!taskId || (!status && dueDate === undefined && name === undefined)) {
      return Response.json({ error: "Missing taskId or status/dueDate/name" }, { status: 400 });
    }

    // dueDate: stringa "YYYY-MM-DD" per impostarla/spostarla, oppure null
    // esplicito per rimuoverla (task senza scadenza). Mezzogiorno fisso
    // per lo stesso motivo di create-task: evitare lo scivolamento di un
    // giorno per differenza di fuso orario col server.
    const body = {};
    if (status) body.status = status;
    // Rinomina il testo del task (10/07): richiesta da Dario per poter
    // correggere/modificare una task già creata invece di doverla cancellare
    // e ricrearla da capo.
    if (name !== undefined) {
      const trimmed = (name || "").trim();
      if (trimmed) body.name = trimmed;
    }
    if (dueDate !== undefined) {
      if (dueDate === null) {
        body.due_date = null;
      } else {
        const ms = new Date(`${dueDate}T12:00:00`).getTime();
        if (!isNaN(ms)) { body.due_date = ms; body.due_date_time = false; }
      }
    }

    const res = await fetch(
      `https://api.clickup.com/api/v2/task/${taskId}`,
      {
        method: "PUT",
        headers: {
          Authorization: CLICKUP_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
