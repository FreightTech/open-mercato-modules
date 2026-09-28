import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Box, CalendarDays, FileText, Folder, Truck } from 'lucide-react'
import {
  ActivityComposer,
  ActivityFeed,
  ActivityFilterChips,
  ContactList,
  CounterStrip,
  InfoGrid,
  InsightBanner,
  KpiWidget,
  ProcessSteps,
  TodoList,
  WidgetBanner,
  WidgetCard,
  WidgetList,
  WidgetListRow,
  formatWidgetNumber,
  type ActivityEntry,
  type TodoItem,
} from './index'

/*
  Figma parity: FMS-Widget-architecture → "Typologia widżetów" (549:542).
  Compare each story with the PNG of the same family in
  ~/Documents/FMS-Widget-architecture/02_Typologia_widżetów/. Content is
  realistic CRM copy instead of the Figma lorem.
*/

const meta: Meta = {
  title: 'Widgets/M3 FreightTech',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Widget family on one WidgetCard shell (radius 12, elevation-1, 24/24/16/24 padding, 48px "see all" footer). Tokens: `--m3ft-v2-*` in theme/m3-freighttech.css.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="theme-m3-freighttech min-h-screen bg-m3ft-background p-8">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj

const noop = () => {}

export const KPI: Story = {
  render: () => (
    <div className="grid max-w-[1320px] grid-cols-4 gap-10">
      <KpiWidget
        title="Nowe zapytania"
        subtitle="Ostatnie 30 dni"
        onMenu={noop}
        value={formatWidgetNumber(1284)}
        delta={{ value: '+12%', direction: 'up' }}
        meta="RFQ · 30 dni · wszystkie produkty"
        footer={{ label: 'Zobacz wszystkie', href: '#' }}
      />
      <KpiWidget
        title="Wysłane oferty"
        subtitle="Trend 12 miesięcy"
        onMenu={noop}
        value="84 oferty"
        delta={{ value: '+6%', direction: 'up' }}
        trend={[12, 14, 13, 18, 16, 20, 19, 24]}
        meta="12 mc · wartość 1,2 mln"
        footer={{ label: 'Zobacz wszystkie', href: '#' }}
      />
      <KpiWidget
        title="Cel TEU"
        subtitle="Kwartał III"
        onMenu={noop}
        value="64%"
        progress={{ ratio: 0.64, caption: `cel: ${formatWidgetNumber(2000)}`, label: 'Realizacja celu' }}
        meta={`${formatWidgetNumber(1280)} z ${formatWidgetNumber(2000)} · 30 dni do końca`}
        footer={{ label: 'Zobacz wszystkie', href: '#' }}
      />
      <KpiWidget
        title="Konwersja RFQ → oferta"
        subtitle="Miesiąc do miesiąca"
        onMenu={noop}
        value={formatWidgetNumber(1284)}
        comparison={{ currentLabel: 'ten miesiąc', previous: formatWidgetNumber(1391), previousLabel: 'poprzedni' }}
        delta={{ value: '−8%', direction: 'down' }}
        meta="m/m · wszystkie oddziały"
        footer={{ label: 'Zobacz wszystkie', href: '#' }}
      />
    </div>
  ),
}

export const Lists: Story = {
  render: () => {
    const [todos, setTodos] = React.useState<TodoItem[]>([
      { id: '1', title: 'Wyślij ofertę FCL Gdańsk → Szanghaj', done: true, due: 'wczoraj' },
      { id: '2', title: 'Potwierdź stawki z armatorem', done: true, due: 'wczoraj' },
      { id: '3', title: 'Telefon do Anny Nowak (Polmar)', due: 'dziś' },
      { id: '4', title: 'Feedback po ofercie OF-2026-114', due: 'za 2 dni', dueTone: 'soon' },
      { id: '5', title: 'Zweryfikuj NIP nowego klienta', due: '−3 dni', dueTone: 'overdue' },
    ])
    return (
      <div className="grid max-w-[1560px] grid-cols-3 gap-10">
        <WidgetCard title="Moje teczki" subtitle="Aktywne w tym tygodniu" onMenu={noop} bleed footer={{ label: 'Zobacz wszystkie', href: '#' }}>
          <WidgetList>
            <WidgetListRow icon={<Box />} title="Polmar Sp. z o.o." supporting="FCL · 3 kontenery" trailing="12 TEU" href="#" />
            <WidgetListRow icon={<Truck />} title="Baltic Agro" supporting="Drobnica · Gdynia" trailing="4 TEU" href="#" />
            <WidgetListRow icon={<Folder />} title="Nordwood S.A." supporting="Import · Szanghaj" trailing="8 TEU" href="#" />
            <WidgetListRow icon={<CalendarDays />} title="Hydro-Tech" supporting="Termin ETD 02.10" trailing="21 TEU" href="#" />
          </WidgetList>
        </WidgetCard>
        <WidgetCard
          title="Czerwone flagi"
          subtitle="Wymagają reakcji"
          onMenu={noop}
          bleed
          banner={
            <InsightBanner tone="warning" action={{ label: 'Przejrzyj', onClick: noop }}>
              Brak kontaktu — <b>2 klientów</b> powyżej 30 dni.
            </InsightBanner>
          }
          footer={{ label: 'Zobacz wszystkie', href: '#' }}
        >
          <WidgetList>
            <WidgetListRow icon={<Folder />} title="Polmar Sp. z o.o." supporting="3 oferty bez odpowiedzi · Anna N." action={{ label: 'Zadzwoń', onClick: noop }} />
            <WidgetListRow tone="warning" title="Baltic Agro" supporting="brak kontaktu 34 dni" action={{ label: 'Zaplanuj', onClick: noop }} />
            <WidgetListRow tone="error" title="Nordwood S.A." supporting="spadek wolumenu −40%" action={{ label: 'Otwórz', onClick: noop }} />
          </WidgetList>
        </WidgetCard>
        <WidgetCard
          title="Do zrobienia"
          subtitle="Dziś i zaległe"
          onMenu={noop}
          bleed
          banner={
            <InsightBanner tone="warning" action={{ label: 'Pokaż', onClick: noop }}>
              Zaległe — <b>1 zadanie</b> po terminie.
            </InsightBanner>
          }
          footer={{ label: 'Zobacz wszystkie', href: '#' }}
        >
          <TodoList
            items={todos}
            onToggle={(id, done) => setTodos((t) => t.map((x) => (x.id === id ? { ...x, done } : x)))}
            onAdd={(title) => setTodos((t) => [...t, { id: String(t.length + 1), title }])}
            addLabel="+ Dodaj zadanie"
            addPlaceholder="Nowe zadanie…"
          />
        </WidgetCard>
      </div>
    )
  },
}

const ACTIVITY: ActivityEntry[] = [
  { id: 'm1', kind: 'message', day: 'Poniedziałek, 22 września', author: 'Anna N.', authorInitials: 'AN', time: '09:12', body: 'Dzień dobry, czy możemy dostać stawkę na 3×40HC do Szanghaju na październik?' },
  { id: 'm2', kind: 'message', day: 'Poniedziałek, 22 września', direction: 'out', time: '10:26', body: 'Oczywiście, oferta będzie do jutra.' },
  { id: 'n1', kind: 'note', day: 'Poniedziałek, 22 września', label: 'Notatka', author: 'Piotr K.', time: '11:40', body: 'Klient rozważa zmianę spedytora — obecny ma problemy z terminowością.', links: [{ label: 'RFQ-2026-311', href: '#' }] },
  { id: 'c1', kind: 'call', day: 'Wtorek, 23 września', label: 'Telefon', author: 'Piotr K.', time: '12:05', body: 'Omówione wolumeny na Q4: ok. 40 TEU miesięcznie.' },
  { id: 'x1', kind: 'notification', day: 'Wtorek, 23 września', label: 'Powiadomienie', time: '13:20', tone: 'warning', body: 'Oferta wygasa za 2 dni.', links: [{ label: 'OF-2026-114', href: '#' }] },
]

export const Activity: Story = {
  render: () => {
    const [filter, setFilter] = React.useState('all')
    const entries = filter === 'all' ? ACTIVITY : ACTIVITY.filter((e) => (filter === 'messages' ? e.kind === 'message' : filter === 'notes' ? e.kind === 'note' || e.kind === 'call' : e.kind === 'notification'))
    return (
      <div className="grid max-w-[1100px] grid-cols-2 gap-10">
        <WidgetCard
          title="Aktywność"
          subtitle="Polmar Sp. z o.o."
          onMenu={noop}
          headerExtra={
            <ActivityFilterChips
              active={filter}
              onChange={setFilter}
              filters={[
                { id: 'all', label: 'Wszystko', count: 5 },
                { id: 'notes', label: 'Notatki', count: 2 },
                { id: 'notifications', label: 'Powiadomienia', count: 1 },
                { id: 'messages', label: 'Wiadomości', count: 2 },
              ]}
            />
          }
          bodyClassName="border-t border-m3ft-outline-variant pt-4"
          bottom={<ActivityComposer placeholder="Napisz notatkę…" sendLabel="Wyślij" attachLabel="Załącz plik" onSubmit={noop} onAttach={noop} />}
          footer={{ label: 'Zobacz wszystkie', href: '#' }}
        >
          <ActivityFeed entries={entries} />
        </WidgetCard>
        <WidgetCard
          title="Aktywność"
          subtitle="Nowy klient"
          onMenu={noop}
          bottom={<ActivityComposer placeholder="Napisz notatkę…" sendLabel="Wyślij" onSubmit={noop} />}
          footer={{ label: 'Zobacz wszystkie', href: '#' }}
        >
          <ActivityFeed entries={[]} empty={{ title: 'Brak aktywności', text: 'Dodaj pierwszą notatkę lub zaloguj rozmowę.' }} />
        </WidgetCard>
      </div>
    )
  },
}

export const InfoContactsProcess: Story = {
  render: () => (
    <div className="grid max-w-[1560px] grid-cols-3 gap-10">
      <WidgetCard title="Dane firmy" subtitle="Z rejestru i CRM" onMenu={noop} footer={{ label: 'Zobacz wszystkie', href: '#' }}>
        <InfoGrid
          sections={[
            {
              fields: [
                { label: 'Opiekun handlowy', value: 'Piotr Kowalski' },
                { label: 'Pierwszy kontakt', value: '13.08.2026' },
                { label: 'NIP', value: 'PL 5213017228', copy: '5213017228' },
                { label: 'Teczka', value: 'GDY/09447', copy: 'GDY/09447' },
                { label: 'Obroty 12 mc', value: `${formatWidgetNumber(12400, { minimumFractionDigits: 2 })} zł` },
                { label: 'Następny kontakt', value: 'za 2 dni', tone: 'warning' },
              ],
            },
            { title: 'Wykluczenia', fields: [{ label: 'Obecny spedytor', value: 'DSV' }, { label: 'Nie obsługujemy', value: 'ADR klasa 1' }] },
          ]}
          copyLabel="Kopiuj"
          copiedLabel="Skopiowano"
        />
      </WidgetCard>
      <WidgetCard title="Osoby" subtitle="Mapa decyzyjna" onMenu={noop} bleed footer={{ label: 'Zobacz wszystkie', href: '#' }}>
        <ContactList
          actionLabel="Napisz"
          onAction={noop}
          people={[
            { id: 'a', name: 'Anna Nowak', initials: 'AN', role: 'Kierownik logistyki · decyduje', phone: '+48 601 220 348', email: 'anna.nowak@polmar.pl' },
            { id: 'b', name: 'Marek Lis', initials: 'ML', role: 'Zakupy · popycha', phone: '+48 512 887 034', email: 'm.lis@polmar.pl' },
          ]}
        />
      </WidgetCard>
      <div className="flex flex-col gap-10">
        <WidgetCard title="Proces sprzedaży" subtitle="Polmar · FCL Azja" onMenu={noop} footer={{ label: 'Zobacz wszystkie', href: '#' }}>
          <ProcessSteps
            steps={[
              { id: '1', label: 'Rozpoznanie', state: 'done' },
              { id: '2', label: 'RFQ', state: 'done' },
              { id: '3', label: 'Oferta', state: 'current' },
              { id: '4', label: 'Zlecenie', state: 'future' },
            ]}
            currentDetail={{ title: 'Oferta', facts: 'Piotr K. · od 12.09 · czeka: 3 dni' }}
          />
        </WidgetCard>
        <WidgetCard title="Etapy" subtitle="Widok osi" onMenu={noop} footer={{ label: 'Zobacz wszystkie', href: '#' }}>
          <ProcessSteps
            orientation="vertical"
            steps={[
              { id: '1', label: 'Rozpoznanie', state: 'done', meta: 'ukończono 11.09 · P. K.' },
              { id: '2', label: 'Oferta', state: 'current', meta: 'od 12.09 · P. Kowalski' },
              { id: '3', label: 'Zlecenie', state: 'future' },
            ]}
          />
        </WidgetCard>
      </div>
    </div>
  ),
}

export const Banners: Story = {
  render: () => (
    <div className="flex max-w-[700px] flex-col gap-4 rounded-[12px] bg-m3ft-surface p-4 shadow-m3ft-card">
      <CounterStrip
        counters={[
          { id: 'a', count: 5, label: 'weryfikacji', onClick: noop },
          { id: 'b', count: 3, label: 'limity', tone: 'warning', onClick: noop },
          { id: 'c', count: 2, label: 'teczki sporne', tone: 'error', onClick: noop },
        ]}
      />
      <WidgetBanner title="Nowa funkcja" text="Transkrypcje rozmów przypisują się do klienta automatycznie." action={{ label: 'Zobacz', onClick: noop }} />
      <WidgetBanner variant="promo" icon={<FileText className="size-4" aria-hidden />} title="Szablony ofert" text="Użyj szablonu, aby wysłać ofertę w 2 minuty." action={{ label: 'Otwórz', onClick: noop }} />
      <WidgetBanner variant="alert" title="Oferta wygasa za 2 dni" text="OF-2026-114 · Polmar Sp. z o.o." action={{ label: 'Przedłuż', onClick: noop }} />
    </div>
  ),
}
