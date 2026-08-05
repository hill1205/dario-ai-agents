// Alcune task su ClickUp non sono task vere: sono contenitori usati come
// database (il bot Telegram ci salva gli ID dei messaggi gia' processati,
// vedi app/api/telegram/route.js). Devono restare APERTE, perche' ClickUp
// con include_closed=false non le restituirebbe piu' e il bot perderebbe
// la memoria ricreando task duplicate dai vecchi messaggi.
//
// Restando aperte pero' finivano in mezzo alle task in sospeso della
// dashboard, con il rischio concreto di chiuderle per sbaglio. Qui le
// riconosciamo dal prefisso e le togliamo da tutto cio' che viene
// mostrato: la lettura ClickUp resta intatta, cambia solo cosa si vede.
//
// Convenzione: ogni task-contenitore ha il titolo che inizia con ⚙️.
export const SYSTEM_TASK_PREFIX = "⚙️";

export function isSystemTask(task) {
  return typeof task?.name === "string" && task.name.trim().startsWith(SYSTEM_TASK_PREFIX);
}

export function stripSystemTasks(tasks) {
  return Array.isArray(tasks) ? tasks.filter(t => !isSystemTask(t)) : tasks;
}
