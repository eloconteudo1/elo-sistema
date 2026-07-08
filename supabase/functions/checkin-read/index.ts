// supabase/functions/checkin-read/index.ts
// Leitura protegida do Supabase pro Check-in ELO. Só GET. Sem escrita, nunca.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

const SP_OFFSET_MS = 3 * 60 * 60 * 1000; // America/Sao_Paulo = UTC-3, sem horário de verão hoje em dia

function spNow(): Date {
  // "Agora" na hora de São Paulo, representado como Date (não muda o instante real, só a leitura de dia/mês/ano)
  return new Date(Date.now() - SP_OFFSET_MS);
}

function dateToYMD(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function ymdToSpEpochStart(ymd: string): number {
  // 00:00:00 daquele dia em SP, convertido pro instante UTC real (ms epoch)
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0) + SP_OFFSET_MS;
}

function ymdToSpEpochEnd(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 23, 59, 59, 999) + SP_OFFSET_MS;
}

function mondayOfWeek(spToday: Date): Date {
  const dow = spToday.getUTCDay(); // 0=domingo..6=sábado (spToday já é "hora SP" representada em campos UTC)
  const diff = dow === 0 ? -6 : 1 - dow; // volta até segunda
  const monday = new Date(spToday);
  monday.setUTCDate(spToday.getUTCDate() + diff);
  return monday;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "GET") {
      return new Response(JSON.stringify({ error: "Método não permitido" }), { status: 405 });
    }

    const secret = req.headers.get("x-checkin-secret");
    const expected = Deno.env.get("CHECKIN_READ_TOKEN");
    if (!expected || secret !== expected) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), { status: 401 });
    }

    const url = new URL(req.url);
    const view = url.searchParams.get("view");

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (view === "semana") {
      const today = spNow();
      const monday = mondayOfWeek(today);
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      const mondayYMD = dateToYMD(monday);
      const sundayYMD = dateToYMD(sunday);
      const epochStart = ymdToSpEpochStart(mondayYMD);
      const epochEnd = ymdToSpEpochEnd(sundayYMD);

      const [apptRes, taskRes] = await Promise.all([
        sb.from("appointments")
          .select("title,scheduled_at,duration_minutes,is_done")
          .gte("scheduled_at", epochStart)
          .lte("scheduled_at", epochEnd)
          .order("scheduled_at"),
        sb.from("scheduled_tasks")
          .select("title,scheduled_date,scheduled_time,priority,is_done")
          .gte("scheduled_date", mondayYMD)
          .lte("scheduled_date", sundayYMD)
          .order("scheduled_date", { ascending: true }),
      ]);

      const dias: Record<string, { data: string; compromissos: any[]; tarefas: any[] }> = {};
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setUTCDate(monday.getUTCDate() + i);
        const ymd = dateToYMD(d);
        dias[ymd] = { data: ymd, compromissos: [], tarefas: [] };
      }
      for (const a of apptRes.data || []) {
        const ymd = dateToYMD(new Date(a.scheduled_at - SP_OFFSET_MS));
        if (dias[ymd]) {
          const hd = new Date(a.scheduled_at);
          const hora = `${String(hd.getUTCHours()).padStart(2, "0")}:${String(hd.getUTCMinutes()).padStart(2, "0")}`;
          dias[ymd].compromissos.push({ hora, titulo: a.title, feito: !!a.is_done });
        }
      }
      for (const t of taskRes.data || []) {
        if (dias[t.scheduled_date]) {
          dias[t.scheduled_date].tarefas.push({
            hora: t.scheduled_time || null,
            titulo: t.title,
            prioridade: t.priority || "media",
            feita: !!t.is_done,
          });
        }
      }

      return new Response(JSON.stringify({
        periodo: `${mondayYMD} a ${sundayYMD}`,
        dias: Object.values(dias),
      }), { headers: { "Content-Type": "application/json" } });
    }

    if (view === "produtividade") {
      const diasParam = url.searchParams.get("dias");
      const today = spNow();
      let periodoInicio: number;
      let label: string;

      if (diasParam) {
        const n = Math.max(1, parseInt(diasParam, 10) || 30);
        const start = new Date(today);
        start.setUTCDate(today.getUTCDate() - (n - 1));
        periodoInicio = ymdToSpEpochStart(dateToYMD(start));
        label = `últimos ${n} dias`;
      } else {
        const firstOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
        periodoInicio = ymdToSpEpochStart(dateToYMD(firstOfMonth));
        label = "mês atual";
      }
      const periodoFim = ymdToSpEpochEnd(dateToYMD(today));

      const { data: entries, error: teErr } = await sb
        .from("time_entries")
        .select("client_id,task_id,duration_minutes,start_time")
        .gte("start_time", periodoInicio)
        .lte("start_time", periodoFim);
      if (teErr) throw teErr;

      const clientIds = [...new Set((entries || []).map((e) => e.client_id).filter(Boolean))];
      const taskIds = [...new Set((entries || []).map((e) => e.task_id).filter(Boolean))];

      const [clientsRes, tasksRes] = await Promise.all([
        clientIds.length ? sb.from("clients").select("id,name").in("id", clientIds) : { data: [] },
        taskIds.length ? sb.from("tasks").select("id,category").in("id", taskIds) : { data: [] },
      ]);
      const clientMap = new Map((clientsRes.data || []).map((c: any) => [c.id, c.name]));
      const taskCatMap = new Map((tasksRes.data || []).map((t: any) => [t.id, t.category]));

      const porCliente = new Map<string, number>();
      const porCategoria = new Map<string, number>();
      let totalMinutos = 0;

      for (const e of entries || []) {
        const min = e.duration_minutes || 0;
        totalMinutos += min;
        const clienteNome = clientMap.get(e.client_id) || "Sem cliente";
        porCliente.set(clienteNome, (porCliente.get(clienteNome) || 0) + min);
        const cat = taskCatMap.get(e.task_id) || "Sem categoria";
        porCategoria.set(cat, (porCategoria.get(cat) || 0) + min);
      }

      return new Response(JSON.stringify({
        periodo: label,
        total_minutos: totalMinutos,
        por_cliente: [...porCliente.entries()].map(([cliente, minutos]) => ({ cliente, minutos }))
          .sort((a, b) => b.minutos - a.minutos),
        por_categoria: [...porCategoria.entries()].map(([categoria, minutos]) => ({ categoria, minutos }))
          .sort((a, b) => b.minutos - a.minutos),
      }), { headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "view inválida. Use ?view=semana ou ?view=produtividade" }), { status: 400 });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Erro interno" }), { status: 500 });
  }
});
