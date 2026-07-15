// supabase/functions/checkin-write/index.ts
// Grava scheduled_tasks pro dia, só depois de aprovação explícita ("/lançar") do lado do Check-in.
// Nunca grava appointments, nunca grava financeiro. Dedup por título normalizado + dia.
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

const VALID_PRIORITIES = ["alta", "media", "baixa"];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

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

    const tasksInput = Array.isArray(body?.tasks) ? body.tasks : null;
    if (!tasksInput || tasksInput.length === 0) {
      return new Response(JSON.stringify({ error: "Envie { tasks: [{title, time?, priority?}] }" }), { status: 400 });
    }
    if (tasksInput.length > 50) {
      return new Response(JSON.stringify({ error: "Máximo 50 tarefas por chamada" }), { status: 400 });
    }

    const today = spTodayYMD();

    // Valida tudo antes de gravar qualquer coisa — falha tudo se algum item vier torto
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const cleaned: { title: string; scheduled_time: string | null; priority: string; date: string }[] = [];
    for (const t of tasksInput) {
      const title = (t?.title || "").trim();
      if (!title) {
        return new Response(JSON.stringify({ error: "Toda tarefa precisa de title" }), { status: 400 });
      }
      let scheduled_time: string | null = null;
      if (t?.time) {
        if (!TIME_RE.test(t.time)) {
          return new Response(JSON.stringify({ error: `Horário inválido: "${t.time}" (use HH:MM)` }), { status: 400 });
        }
        scheduled_time = t.time;
      }
      let date = today;
      if (t?.scheduled_date) {
        if (!DATE_RE.test(t.scheduled_date)) {
          return new Response(JSON.stringify({ error: `Data inválida: "${t.scheduled_date}" (use YYYY-MM-DD)` }), { status: 400 });
        }
        date = t.scheduled_date;
      }
      const priority = VALID_PRIORITIES.includes(t?.priority) ? t.priority : "media";
      cleaned.push({ title, scheduled_time, priority, date });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Agrupa datas únicas pra buscar existentes de uma vez
    const uniqueDates = [...new Set(cleaned.map(t => t.date))];
    const { data: existing, error: exErr } = await sb
      .from("scheduled_tasks")
      .select("title,scheduled_date")
      .in("scheduled_date", uniqueDates);
    if (exErr) throw exErr;

    // Mapa: "YYYY-MM-DD|titulo_normalizado" → existe
    const existingSet = new Set(
      (existing || []).map((e) => `${e.scheduled_date}|${normalize(e.title)}`)
    );

    const toInsert: any[] = [];
    const skipped: string[] = [];
    const seenInThisBatch = new Set<string>();

    for (const t of cleaned) {
      const key = `${t.date}|${normalize(t.title)}`;
      if (existingSet.has(key) || seenInThisBatch.has(key)) {
        skipped.push(t.title);
        continue;
      }
      seenInThisBatch.add(key);
      toInsert.push({
        scheduled_date: t.date,
        scheduled_time: t.scheduled_time,
        title: t.title,
        priority: t.priority,
        is_done: false,
        user_id: 1,
      });
    }

    let inserted: any[] = [];
    if (toInsert.length > 0) {
      const { data, error } = await sb
        .from("scheduled_tasks")
        .insert(toInsert)
        .select("id,title,scheduled_time,priority");
      if (error) throw error;
      inserted = data || [];
    }

    return new Response(JSON.stringify({
      data_referencia: today,
      datas_usadas: uniqueDates,
      inseridas: inserted,
      puladas_ja_existiam: skipped,
      total_inseridas: inserted.length,
      total_puladas: skipped.length,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Erro interno" }), { status: 500 });
  }
});
