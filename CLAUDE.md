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

**Sessão 9A — Favoritos + Anotações colapsáveis**
- Favoritos corrigidos com `=== true` (e `!== true`) em `openMobileClientPicker` e `filterMobileClients` (renderClientList já estava correto)
- Anotações com preview colapsável: primeira linha em negrito (título) + até 3 linhas + botão "ver +" / "ver menos"
- CSS: `.note-item-preview`, `.note-item-full`, `.note-item-body`, `.note-item-footer`, `.note-expand-btn`
- Handler `data-expand-note` adicionado ao event delegation do `#notes-list`
- Versão 3.3, data 29/06/2026

**Sessão 9B — Calendário: bug alerta + edição de eventos**
- Bug do alerta corrigido: payload condicional (`if (alertMin) payload.alert_minutes_before = ...`) em appointments e scheduled_tasks. SQL: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS alert_minutes_before integer DEFAULT NULL`
- Edição de eventos: `getEventsByDay()` inclui `id` nos objetos; botão ✏ na sidebar de cada evento
- `openCalEditModal(id, type)` preenche modal com dados do item existente, seleciona tab correta, seta `modal.dataset.editId/editType`
- `saveCalEvent()` detecta `isEdit` via `modal.dataset.editId` e faz UPDATE; INSERT quando novo
- `openCalModal()` e `closeCalModal()` limpam o dataset, restauram título "Novo evento" e botão "Salvar"
- Versão 3.4, data 30/06/2026

**Sessão 9C — Financeiro + conteudo.html + Rodapé**
- Financeiro: pagamentos sem cliente válido filtrados (`p.is_manual || T.clients.find(c => c.id === p.client_id)`)
- Financeiro: botão ✏ em cada linha + `openEditPaymentModal` + `savePaymentAmount` para editar valor
- conteudo.html: topbar já estava padrão (logo ELO, abas, relógio) — sem alteração
- Versão 3.5, data 30/06/2026

**Sessão 9D — Correções Anotações + conteudo.html**
- Fix "ver +" nas anotações: `dataset.expanded` em vez de `full.style.display === 'block'` (que nunca batia pois display vinha do CSS)
- Edição inline restaurada: `onclick="editNoteInline"` adicionado ao `note-item-preview` e `note-item-full`
- Espelho do Calendário: `\n` convertido para `<br>` em `renderCalNotes()` — texto agora quebra em múltiplas linhas
- conteudo.html: CSS antigo da topbar (`.topbar`, `.topbar-nav`, etc.) removido do `<style>`
- conteudo.html: `buildCard()` simplificado — card inteiro clicável (`div.addEventListener('click', openModal)`), botões de ação removidos
- conteudo.html: modal sem botão "Usar como base", apenas "Fechar"
- Versão 3.6, data 29/06/2026

**Sessão 9F — Favoritos: clientes internos no grupo geral**
- Clientes internos marcados como favorito agora aparecem no grupo "Favoritos" junto com os externos favoritos
- Removida condição `&& !c.is_internal` do filtro de favoritos em `renderClientList()`, `openMobileClientPicker()` e `filterMobileClients()`
- Clientes internos NÃO favoritos continuam no grupo "Interno"
- Versão 3.8, data 30/06/2026

**Sessão 9E — Anotações modal + Financeiro editar/excluir**
- Anotações redesenhadas: clicar na nota abre modal com textarea editável (`openNoteModal`, `saveNoteModal`)
- Removidos: `note-item-full`, `note-expand-btn`, handler de expand, `editNoteInline` substituído pelo modal
- Espelho do Calendário: `onclick="openNoteModal"` em vez de `editNoteInline`
- Financeiro: botão × em todos os recebimentos (não só manuais); `finDeletePayment` aceita `clientName`
- Custos: botão ✏ adicionado (`openEditCostModal`, `saveEditCost`) — edita descrição e valor
- `finDeleteCost` mantido com `openConfirmModal`
- Versão 3.7, data 29/06/2026

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
- **Rodapé:** `#version-number` (versão), `#build-date` (data DD/MM/AAAA), `#sobre-version` (aba Sobre) — atualizar a cada commit

### Sessão 8 — Relatório por cliente (Resultado)

- Nova sub-aba **"Clientes"** no toggle do Resultado (ao lado de Hoje e Mês)
- Filtros: seletor de cliente (externos, ordem alfabética) + período De/Até + atalhos Semana/Mês atual/Mês anterior
- Botão "Gerar" busca `time_entries` no período, agrupa por cliente e tarefa
- Cards por cliente: horas, % do tempo, barra de progresso, valor mín/ótimo (se configurados), lista de tarefas ordenadas
- Cabeçalho do relatório: total de horas + valores globais + botão "Copiar resumo"
- "Copiar resumo" gera texto formatado para o Assistente; fallback com modal/textarea se clipboard bloqueado
- Funções: `repInit()`, `repSetPeriod(type)`, `repGenerate()`, `repCopyText()`
- Sem alteração de schema — usa `time_entries` e `settings` já existentes

### Sessão 7 — Correções desktop + Calendário + Conteúdo

- **Favoritos corrigidos:** filtro usa `=== true` em vez de truthy — `null`/`undefined` não aparecem em Favoritos
- **Anotações texto longo:** Home mostra 2 linhas + ellipsis (`-webkit-line-clamp:2`); Calendário usa `.cal-note-text` sem limite de linhas
- **Calendário:** chips verdes de horas (`hoursChip`) removidos da grade mensal — dados `CAL.hoursByDay` mantidos
- **Emojis removidos:** labels "⭐ Favoritos", "⭐ Interno", botões importar/exportar, card financeiro
- **Badge financeiro:** `#alert-badge` esvaziado no HTML — `updateAlertBadge()` sempre `display:none`
- **Footer:** `#version-number` com id, `#build-date` com data `28/06/2026`, `#sobre-version` com versão e data
- **`conteudo.html`:** topbar substituída pela padrão do sistema (`.elo-topbar`, logo, mesmos tabs, relógio)

---

## 8. O que ainda falta implementar

| # | Tarefa | Prioridade |
|---|--------|-----------|
| C | Barra meta Financeiro com cores vermelho/amarelo/verde | Alta |
| S1 | ~~Ordenação tarefas favoritas + clientes — Sprint 1~~ | **Concluído** |
| S2 | ~~Melhorias UX: busca cliente, alertas visuais, mobile nav — Sprint 2~~ | **Concluído** |
| S3 | ~~Sessão 6C: anotações, badge, card financeiro, mobile client/agenda~~ | **Concluído** |
| S8 | ~~Sessão 8: Relatório por cliente na aba Clientes do Resultado~~ | **Concluído** |
| S9A | ~~Sessão 9A: Favoritos === true + anotações colapsáveis~~ | **Concluído** |
| S9B | ~~Sessão 9B: Bug alerta calendário + edição de eventos~~ | **Concluído** |
| S9C | ~~Sessão 9C: Financeiro edição de valor + rodapé 3.5~~ | **Concluído** |
| S9D | ~~Sessão 9D: Fix "ver +" anotações, edição inline, calendário texto completo, conteudo.html~~ | **Concluído** |
| S9E | ~~Sessão 9E: Anotações modal + Financeiro editar/excluir custos e recebimentos~~ | **Concluído** |
| S9F | ~~Sessão 9F: Clientes internos favoritos no grupo Favoritos geral~~ | **Concluído** |
| E | Comparativo mês anterior vs atual no Resultado | Alta |
| 3 | Backup — exportar dados JSON/CSV | Média |
| 5 | Analytics — gráfico linha 6 meses horas por cliente | Média |
| 4 | Mobile iOS — bottom nav, timer responsivo 375px | Alta |

---

## 9. UX obrigatória

- **Toasts visíveis** para todo erro/sucesso (Helô não acessa o console).
- **Confirmação via modal** antes de excluir (nunca `confirm()` nativo).
- **Atualização otimista** no financeiro.
- **Rodapé:** `Sistema ELO | Versão 3.0 | ELO Comunicação · Umuarama-PR | Atualizado em 28/06/2026`
- Interface toda em **português do Brasil**.
- Status financeiro: `PAGO` / `ABERTO` / `VENCIDO` (maiúsculas).

---

## 10. Regra de versionamento — atualizar a cada commit

A cada commit que altera funcionalidades visíveis, atualizar:

1. **`#version-number`** no footer — texto `"Versão X.Y"`
2. **`#build-date`** no footer — data `"DD/MM/AAAA"` (ex: `"28/06/2026"`)
3. **`#sobre-version`** na aba Sobre — `"Versão X.Y · ELO Comunicação · Atualizado em DD/MM/AAAA"`
4. **Este CLAUDE.md** — seção 7 e/ou 8 conforme o que foi implementado

**Incremento de versão:**
- Correções/ajustes: 3.0 → 3.1 → 3.2 (segundo número)
- Funcionalidades novas: 3.0 → 4.0 (primeiro número)

---

## 11. Pasta `referencia-manus/`

Código do protótipo Manus. **Somente consulta** — nunca importar para o build.
Usar para copiar estilos inline, lógica de cálculos e estrutura de dados.
