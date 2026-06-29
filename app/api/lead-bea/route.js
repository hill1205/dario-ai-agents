import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const LEAD_BEA_LIST_ID = "901219079269";

export async function GET() {
  if (!CLICKUP_API_KEY) {
    return NextResponse.json({ error: "CLICKUP_API_KEY non configurata" }, { status: 500 });
  }
  try {
    const res = await fetch(
      `https://api.clickup.com/api/v2/list/${LEAD_BEA_LIST_ID}/task?include_closed=false`,
      { headers: { Authorization: CLICKUP_API_KEY }, cache: "no-store" }
    );
    if (!res.ok) {
      return NextResponse.json({ error: `ClickUp error ${res.status}` }, { status: 500 });
    }
    const data = await res.json();
    const tasks = (data.tasks || []).map(t => ({
      clickupId: t.id,
      nome:      t.name,
      priority:  t.priority?.priority || "normal",
    }));
    return NextResponse.json({ tasks });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
