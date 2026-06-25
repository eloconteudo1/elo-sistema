# CLAUDE.md — Regras do repositório `elo-sistema`

Leia este arquivo **inteiro** antes de qualquer alteração.

---

## 1. Arquitetura (definitiva)

| Camada | Tecnologia |
|---|---|
| Interface | `index.html` único + **JavaScript puro** (sem React, sem build, sem Tailwind) |
| Banco | **Supabase** (PostgreSQL, São Paulo) |
| Acesso a dados | `@supabase/supabase-js` via CDN |
| Auth | Supabase Auth |
| Hospedagem | GitHub Pages → `sistema.eloconteudo.com.br` |
| Repositório | `eloconteudo1/elo-sistema` (público) |
| Conta | `eloconteudo1@gmail.com` |

**Não reintroduzir:** React, TypeScript, Tailwind, Vite, Express, tRPC, MySQL, Apps Script, Google Sheets como banco, sidebar de navegação.

**Segurança:** NUNCA usar `service_role key` no frontend. Apenas `anon key`.

---

## 2. Conexão Supabase

```js
const sb = supabase.createClient(
  'https://vatkfkdnflbdfomglvme.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZhdGtma2RuZmxiZGZvbWdsdm1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNDIzMDUsImV4cCI6MjA5NzcxODMwNX0.DhcxD1Z9HERL4128bKrIIZ8KajcYK5hny8zLxBwHmGM'
);
```

---

## 3. Tokens CSS

```css
:root {
  --coral: #C4725A;    --coral-light: #D4866E;
  --purple: #4A2976;   --lavender: #BFA8D9;
  --deep: #2E1B4E;     --deep2: #1D0D31;
  --off: #F3F0F4;      --bg: #F4F1F8;    --bg2: #EDE8F5;
  --surface: #FFFFFF;   --surface2: #F0EBF8;
  --text: #2E1B4E;     --text-dim: rgba(46, 27, 78, 0.65);
  --green: #2FB989;    --orange: #E07A3A;
  --blue: #3B82F6;     --pink: #C4487A;
  --shadow: 0 18px 45px rgba(46, 24, 71, 0.10);
  --shadow-sm: 0 4px 16px rgba(46, 24, 71, 0.08);
  --border: 1px solid rgba(74, 41, 118, 0.10);
  --radius: 22px;
}
```

---

## 4. Estado global JS

```js
// Home / Timer
const T = {
  clients: [], tasks: [], todayEntries: [], notes: [],
  activeEntry: null, scheduledTasks: [], appointments: [], paymentAlerts: [],
  selectedClientId: null, clientDropOpen: false,
  settings: { daily_goal_minutes: 480, revenue_goal: 0, hourly_rate_min: 0, hourly_rate_optimal: 0 },
};

// Calendário
const CAL = {
  month, year, selectedDay, appointments: [], tasks: [], reminders: [],
  hoursByDay: {}, modalTab, editingRemId, remType,
  settings: { pauseMinutes, lunchTime, endTime, dailyGoalHours },
};

// Financeiro
const FIN = { month, year, payments: [], costs: [], clients: [] };

// Clientes
let clExpandedCards = new Set(); // IDs dos cards expandidos
```

---

## 5. Padrões de código

- **Navegação:** `navigateTo(page)` → chama `initHome()`, `initResultado()`, etc.
- **Toasts:** `showToast(msg, type)` — type: `'ok'`, `'err'`, `'warn'`
- **Confirmação:** `openConfirmModal(title, body, callbackAsync)` — nunca `confirm()` nativo
- **Soft-delete clientes:** `is_active: false` (nunca deletar do banco)
- **Modais dinâmicos:** inserir via `#modal-container` → `mc.className='open'; mc.innerHTML=...`
- **Inputs/Selects:** classes `.elo-input` e `.elo-select` (nunca `fin-input` / `fin-select`)
- **Event delegation:** usar `{ once: true }` em listas re-renderizadas para evitar handlers duplicados
- **Formatação de tempo:** `fMin(minutes)` → `"1h 30m"` ou `"45min"`
- **Highlight de busca:** `highlight(text, term)` → envolve o trecho encontrado em `<strong>` coral

---

## 6. Banco de dados — tabelas existentes

| Tabela | Descrição |
|---|---|
| `users` | Usuários autenticados (auth_id, name, email, role) |
| `clients` | Clientes (is_active, is_internal, **is_favorite**, color, contract_value, due_day) |
| `tasks` | Tarefas do timer (name, category, is_favorite, sort_order) |
| `categories` | Categorias de tarefas — CRUD completo na Config |
| `time_entries` | Registros de horas (client_id, task_id, task_name, start_time ms, duration_minutes, notes) |
| `scheduled_tasks` | Tarefas agendadas (title, priority, scheduled_date YYYY-MM-DD, scheduled_time, is_done, client_id) |
| `appointments` | Compromissos do Calendário (title, scheduled_at ms, is_done, client_id, alert_minutes_before) |
| `reminders` | Alarmes pessoais (type: interval/daily, interval_minutes, daily_time HH:MM) |
| `monthly_payments` | Recebimentos mensais (client_id, month, year, amount, is_paid, due_day, is_manual) |
| `cost_items` | Custos/despesas (month, year, amount, description, is_paid) |
| `settings` | Configurações únicas (id=1): daily_goal_minutes, payment_alert_days, revenue_goal, despesas_mensais, pro_labore, lucro_desejado, dias_uteis, hourly_rate_min, hourly_rate_optimal, scratchpad (não usado) |
| `notes` | Anotações livres (id, content text, created_at timestamptz). **Sem user_id. RLS desativado.** |

**SQL aplicado no banco:**
```sql
-- Campo de favorito nos clientes (Sessão 4)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_favorite boolean DEFAULT false;

-- Tabela de anotações (Sessão 3)
CREATE TABLE notes (
  id bigint generated always as identity primary key,
  content text not null,
  created_at timestamptz default now()
);
ALTER TABLE notes DISABLE ROW LEVEL SECURITY;
```

**Constraints importantes:**
- `monthly_payments` tem UNIQUE(client_id, month, year) para não-manuais
- `settings.user_id` é nullable (DROP NOT NULL já aplicado)
- Usar `upsert` com `onConflict:'id'` para settings

---

## 7. Funcionalidades implementadas (V3.0)

### Home (Timer)

- Cronômetro circular SVG com gradiente
- Seletor de cliente + árvore de tarefas por categoria
- Registro de horas (start/stop com `start_time` em ms)
- Seção "Recentes" — agrupa por cliente+tarefa, soma minutos, badge `2x`
- Sidebar direita: KPIs do dia, Próximas Tarefas (scheduled_tasks + appointments mesclados), alertas de pagamento, resumo financeiro

**Lançamento manual de horas (Sessão 1)**
- Botão "✏️ Lançar horas manualmente" abaixo do cronômetro — visível apenas quando parado (`T.isRunning === false`)
- Modal com campos: cliente, tarefa (árvore por categoria), horas, minutos, data, notas
- Grava em `time_entries` no mesmo formato que o cronômetro
- Contabiliza em Resultado e Financeiro
- Funções: `openManualEntryModal(editId)`, `saveManualEntry(editId)`

**Edição de tempo (Sessão 1)**
- Botão ✏️ em cada linha de atividade do dia
- Abre o mesmo modal preenchido com os dados existentes
- Permite alterar cliente, tarefa, tempo e notas
- Event delegation em `#activities-list` com atributo `data-action` — sem `onclick` inline nos botões

**Anotações (Sessão 3)**
- Card `#notes-card` na sidebar direita da Home, **acima de Próximas tarefas**
- Input de texto + botão Salvar (Enter também salva)
- Cada nota = 1 linha na tabela `notes` (id, content, created_at)
- Botão × para deletar via `openConfirmModal`
- **Edição inline:** clicar no texto da nota transforma em `<input>` in-place; Enter ou blur salva; Escape cancela (flag `_cancel` no elemento)
- Espelho em `#cal-notes-panel` na sidebar do Calendário, abaixo do Resumo do Mês — deletável também pelo Calendário
- `renderCalNotes()` busca direto do Supabase (não de `T.notes`), pois o Calendário pode abrir sem passar pela Home
- Funções: `saveNote()`, `renderNotesList()`, `renderCalNotes()`, `editNoteInline(el, id)`
- Legenda removida do Calendário; `settings.scratchpad` não é mais usado

**Dropdown de clientes (Sessão 4)**
- Campo de busca `#client-search` fixo no topo do dropdown; foca automaticamente ao abrir; limpa ao fechar
- Filtragem em tempo real: cada tecla re-renderiza a lista
- Termo encontrado destacado em coral via `highlight(text, term)`
- Grupo "⭐ Favoritos" no topo para clientes com `is_favorite = true`, com dot colorido
- Todos os grupos ordenados alfabeticamente (locale `pt-BR`)
- Grupos: Favoritos → Clientes → Interno
- Checkbox "⭐ Cliente favorito" no modal de cliente (aba Geral), salvo em `clients.is_favorite`
- Event delegation com `{ once: true }` nas opções — sem `onclick` inline
- Função `highlight(text, term)` adicionada aos utilitários

### Resultado

- **Aba Hoje:** KPIs, donut SVG por cliente, log de tarefas com colunas Tempo + Custo (mín/ótimo calculados)
- **Aba Mês:** KPIs, donut por cliente, calendário meta, donut por tarefa + card "Valor real da hora" (recebido/h vs previsto/h vs mín/ótimo, status PREJUÍZO/COBRINDO/ÓTIMO)

### Calendário

- Grade mensal 7 colunas com chips de eventos
- Cada célula mostra horas trabalhadas no dia (chip verde ⏱)
- Sidebar: lista do dia selecionado, resumo do mês, painel de anotações `#cal-notes-panel`
- Modal de evento: abas Compromisso / Tarefa, cliente, horário, alerta
- Aba Alertas: CRUD de alarmes pessoais (intervalo ou horário diário)
- Legenda removida (Sessão 3)
- **Bug conhecido:** clientes no modal usam `T.clients` (não `C.clients`)

### Clientes

- Grid de cards com expand/collapse (Set `clExpandedCards`)
- Dois grupos: clientes externos + internos ELO
- Border esquerda colorida por cliente
- Modal com 4 abas (underline): Dados, Contrato, Pagamento, Histórico
- Aba Dados: checkbox "Cliente interno ELO" + checkbox "⭐ Cliente favorito" (Sessão 4)
- Soft-delete com `is_active: false`

### Financeiro

- 5 KPIs: Receita, Custos, Resultado, Recebido, Em aberto
- Barra de progresso da meta de receita (roxa/verde)
- Gráfico de barras Chart.js (Receita × Custos, 6 meses)
- Tabela de recebimentos com status PAGO/ABERTO/VENCIDO
- Tabela de custos
- Auto-gera recebimentos mensais para clientes ativos (upsert com onConflict)
- Sidebar: resumo financeiro + custos em aberto

### Config

- **Aba Tarefas:** CRUD de categorias (tabela `categories`) + CRUD de tarefas. Modal usa categorias dinâmicas do banco.
- **Aba Metas:** Layout 2 colunas
  - Esquerda: Meta de trabalho (horas/dia, dias úteis, alerta vencimento) + Metas financeiras (pró-labore, lucro desejado)
  - Direita: Cards calculados automaticamente — "Para cobrir contas" e "Para lucrar" — buscando despesas do `cost_items` do mês atual
  - Fórmula: Hora mín = (Despesas empresa + Pró-labore) ÷ Horas/mês | Hora ótima = (Mín + Lucro) ÷ Horas/mês
- **Aba Sobre:** info do sistema

### Topbar e Rodapé (Sessão 5A)

- **Logo:** `logo-elo.png` na raiz do repositório, exibido no `.topbar-brand` com `height:34px`
  - Substitui o texto "ELO / Sistema de gestão" que existia antes
  - CSS `.name` e `.tagline` removidos
- **Rodapé:** elemento `#build-date` dentro do `<footer class="elo-footer">` — atualizar a cada commit

---

## 8. O que ainda falta implementar

| # | Tarefa | Prioridade |
|---|--------|-----------|
| C | Barra meta Financeiro com cores vermelho/amarelo/verde | Alta |
| S1 | ~~Ordenação tarefas favoritas + clientes — Sprint 1~~ | **Concluído** |
| S2 | ~~Melhorias UX: busca cliente, alertas visuais, mobile nav — Sprint 2~~ | **Concluído** |
| E | Comparativo mês anterior vs atual no Resultado | Alta |
| 3 | Backup — exportar dados JSON/CSV | Média |
| 5 | Analytics — gráfico linha 6 meses horas por cliente | Média |
| 4 | Mobile iOS — bottom nav, timer responsivo 375px | Alta |

---

## 9. UX obrigatória

- **Toasts visíveis** para todo erro/sucesso (Helô não acessa o console).
- **Confirmação via modal** antes de excluir (nunca `confirm()` nativo).
- **Atualização otimista** no financeiro.
- **Rodapé:** `Sistema ELO | Versão 3.0 | ELO Comunicação · Umuarama-PR | Atualizado em Jun/2026`
- Interface toda em **português do Brasil**.
- Status financeiro: `PAGO` / `ABERTO` / `VENCIDO` (maiúsculas).

---

## 10. Regra de versionamento — atualizar a cada commit

A cada commit que altera funcionalidades visíveis, atualizar:

1. **`#build-date`** no footer do `index.html` — texto `"Mês/AAAA"` em português (ex: `"Jun/2026"`, `"Jul/2026"`)
2. **Aba Sobre** na tela Config — mesmo formato
3. **Este CLAUDE.md** — seção 7 e/ou 8 conforme o que foi implementado

---

## 11. Pasta `referencia-manus/`

Código do protótipo Manus. **Somente consulta** — nunca importar para o build.
Usar para copiar estilos inline, lógica de cálculos e estrutura de dados.
