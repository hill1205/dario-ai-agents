import { NextResponse } from "next/server";
import { fetchTuttiITask } from "../../lib/clickup-liste";
export const dynamic = "force-dynamic";

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const LEAD_BEA_LIST_ID = "901219079269";

export async function GET() {
  if (!CLICKUP_API_KEY) {
    return NextResponse.json({ error: "CLICKUP_API_KEY non configurata" }, { status: 500 });
  }
  try {
    const tutte = await fetchTuttiITask(LEAD_BEA_LIST_ID, { apiKey: CLICKUP_API_KEY });
    const tasks = tutte.map(t => ({
      clickupId: t.id,
      nome:      t.name,
      priority:  t.priority?.priority || "normal",
    }));
    return NextResponse.json({ tasks });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
