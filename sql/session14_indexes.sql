-- Sessão 14 — Índices de performance (corrigido)
-- Aplicar no Supabase SQL Editor: https://supabase.com/dashboard/project/vatkfkdnflbdfomglvme/sql/new

-- 1. time_entries: buscas por usuário + data (Resultado, relatório mensal)
CREATE INDEX IF NOT EXISTS idx_time_entries_user_created
ON public.time_entries(user_id, created_at DESC);

-- 2. time_entries: buscas por cliente (Relatório → aba Clientes)
CREATE INDEX IF NOT EXISTS idx_time_entries_client_created
ON public.time_entries(client_id, created_at DESC);

-- 3. scheduled_tasks: Calendário e sidebar de próximas tarefas
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user_date
ON public.scheduled_tasks(user_id, scheduled_date);

-- 4. appointments: Calendário + mobile Agenda (sem user_id — tabela single-tenant)
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled
ON public.appointments(scheduled_at DESC);

-- 5. clients: seletor de clientes ativos (sem user_id — tabela single-tenant)
CREATE INDEX IF NOT EXISTS idx_clients_active_name
ON public.clients(is_active, is_internal, is_favorite, name);

-- 6. monthly_payments: Financeiro por período
CREATE INDEX IF NOT EXISTS idx_monthly_payments_client_period
ON public.monthly_payments(client_id, month, year);
