// supabase/functions/checkin-write/index.ts
// Grava scheduled_tasks e/ou appointments, só depois de aprovação explícita ("/lançar") do Check-in.
// Nunca grava financeiro. Dedup por título normalizado + dia.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

const SP_OFFSET_MS = 3 * 60 * 60 * 1000;

function spTodayYMD(): string {
  const d = new Date(Date.now() - SP_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function normalize(s: string): string {
  return (s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim();
}

function ymdToEpoch(ymd: string, hh = 0, mm = 0): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d, hh, mm, 0, 0) + SP_OFFSET_MS;
}

const VALID_PRIORITIES = ["alta", "media", "baixa"];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Método não permitido" }), { status: 405 });
    }

    const secret = req.headers.get("x-checkin-secret");
    const expected = Deno.env.get("CHECKIN_WRITE_TOKEN");
    if (!expected || secret !== expected) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), { status: 401 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "JSON inválido" }), { status: 400 });
    }

    const tasksInput = Array.isArray(body?.tasks) ? body.tasks : [];
    const apptsInput = Array.isArray(body?.appointments) ? body.appointments : [];

    if (tasksInput.length === 0 && apptsInput.length === 0) {
      return new Response(JSON.stringify({ error: "Envie tasks e/ou appointments" }), { status: 400 });
    }
    if (tasksInput.length > 50 || apptsInput.length > 50) {
      return new Response(JSON.stringify({ error: "Máximo 50 itens por array por chamada" }), { status: 400 });
    }

    const today = spTodayYMD();

    // ── Validar tasks ─────────────────────────────────────────────
    const cleanedTasks: { title: string; scheduled_time: string | null; priority: string; date: string }[] = [];
    for (const t of tasksInput) {
      const title = (t?.title || "").trim();
      if (!title) return new Response(JSON.stringify({ error: "Toda tarefa precisa de title" }), { status: 400 });
      let scheduled_time: string | null = null;
      if (t?.time) {
        if (!TIME_RE.test(t.time)) return new Response(JSON.stringify({ error: `Horário inválido: "${t.time}"` }), { status: 400 });
        scheduled_time = t.time;
      }
      let date = today;
      if (t?.scheduled_date) {
        if (!DATE_RE.test(t.scheduled_date)) return new Response(JSON.stringify({ error: `Data inválida: "${t.scheduled_date}"` }), { status: 400 });
        date = t.scheduled_date;
      }
      const priority = VALID_PRIORITIES.includes(t?.priority) ? t.priority : "media";
      cleanedTasks.push({ title, scheduled_time, priority, date });
    }

    // ── Validar appointments ──────────────────────────────────────
    const cleanedAppts: { title: string; scheduled_at: number; date: string; client_id: number | null }[] = [];
    for (const a of apptsInput) {
      const title = (a?.title || "").trim();
      if (!title) return new Response(JSON.stringify({ error: "Todo compromisso precisa de title" }), { status: 400 });
      if (!a?.date || !DATE_RE.test(a.date)) return new Response(JSON.stringify({ error: `Compromisso "${title}" precisa de date (YYYY-MM-DD)` }), { status: 400 });
      let hh = 0, mm = 0;
      if (a?.time) {
        if (!TIME_RE.test(a.time)) return new Response(JSON.stringify({ error: `Horário inválido: "${a.time}"` }), { status: 400 });
        [hh, mm] = a.time.split(":").map(Number);
      }
      const scheduled_at = ymdToEpoch(a.date, hh, mm);
      const client_id = a?.client_id ? Number(a.client_id) : null;
      cleanedAppts.push({ title, scheduled_at, date: a.date, client_id });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Dedup tasks ───────────────────────────────────────────────
    const uniqueTaskDates = [...new Set(cleanedTasks.map(t => t.date))];
    let existingTasksSet = new Set<string>();
    if (uniqueTaskDates.length > 0) {
      const { data: existingTasks, error: etErr } = await sb
        .from("scheduled_tasks")
        .select("title,scheduled_date")
        .in("scheduled_date", uniqueTaskDates);
      if (etErr) throw etErr;
      existingTasksSet = new Set((existingTasks || []).map((e) => `${e.scheduled_date}|${normalize(e.title)}`));
    }

    const toInsertTasks: any[] = [];
    const skippedTasks: string[] = [];
    const seenTasks = new Set<string>();
    for (const t of cleanedTasks) {
      const key = `${t.date}|${normalize(t.title)}`;
      if (existingTasksSet.has(key) || seenTasks.has(key)) { skippedTasks.push(t.title); continue; }
      seenTasks.add(key);
      toInsertTasks.push({ scheduled_date: t.date, scheduled_time: t.scheduled_time, title: t.title, priority: t.priority, is_done: false, user_id: 1 });
    }

    // ── Dedup appointments ────────────────────────────────────────
    const uniqueApptDates = [...new Set(cleanedAppts.map(a => a.date))];
    let existingApptsSet = new Set<string>();
    if (uniqueApptDates.length > 0) {
      const epochRanges = uniqueApptDates.map(d => ({
        gte: ymdToEpoch(d, 0, 0),
        lte: ymdToEpoch(d, 23, 59),
      }));
      const apptQueries = await Promise.all(
        epochRanges.map(r =>
          sb.from("appointments").select("title,scheduled_at").gte("scheduled_at", r.gte).lte("scheduled_at", r.lte)
        )
      );
      for (let i = 0; i < uniqueApptDates.length; i++) {
        const date = uniqueApptDates[i];
        for (const row of apptQueries[i].data || []) {
          existingApptsSet.add(`${date}|${normalize(row.title)}`);
        }
      }
    }

    const toInsertAppts: any[] = [];
    const skippedAppts: string[] = [];
    const seenAppts = new Set<string>();
    for (const a of cleanedAppts) {
      const key = `${a.date}|${normalize(a.title)}`;
      if (existingApptsSet.has(key) || seenAppts.has(key)) { skippedAppts.push(a.title); continue; }
      seenAppts.add(key);
      toInsertAppts.push({ title: a.title, scheduled_at: a.scheduled_at, client_id: a.client_id, is_done: false, alert_fired: false });
    }

    // ── Inserir tudo ──────────────────────────────────────────────
    let insertedTasks: any[] = [];
    let insertedAppts: any[] = [];

    if (toInsertTasks.length > 0) {
      const { data, error } = await sb.from("scheduled_tasks").insert(toInsertTasks).select("id,title,scheduled_time,priority");
      if (error) throw error;
      insertedTasks = data || [];
    }
    if (toInsertAppts.length > 0) {
      const { data, error } = await sb.from("appointments").insert(toInsertAppts).select("id,title,scheduled_at");
      if (error) throw error;
      insertedAppts = data || [];
    }

    return new Response(JSON.stringify({
      data_referencia: today,
      tarefas: { inseridas: insertedTasks, puladas: skippedTasks, total_inseridas: insertedTasks.length, total_puladas: skippedTasks.length },
      compromissos: { inseridos: insertedAppts, pulados: skippedAppts, total_inseridos: insertedAppts.length, total_pulados: skippedAppts.length },
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Erro interno" }), { status: 500 });
  }
});
