import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { Alert } from './Alert'

const meta: Meta<typeof Alert> = {
  title: 'Components/Alert',
  component: Alert,
  parameters: {
    backgrounds: {
      default: 'figma-surface',
      values: [{ name: 'figma-surface', value: '#F8F8FA' }],
    },
    docs: {
      description: {
        component:
          'Figma: FMS-Componenets → Alert (46:22). Four variants in Figma (info / success / warning / error); a `neutral` is exposed in code for non-urgent helper messages. Colors come from the `-v2` status tokens extracted directly from the Figma variants.',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof Alert>

export const Showcase: Story = {
  name: 'Alert',
  render: () => {
    const [open, setOpen] = React.useState(true)
    return (
      <div className="flex max-w-[560px] flex-col gap-3">
        <Alert variant="info" title="Synchronizacja w toku">
          Powiązane faktury zostaną zaktualizowane w ciągu kilku minut.
        </Alert>
        <Alert variant="success" title="Faktura zatwierdzona">
          FV/2025/0041 została przekazana do księgowości.
        </Alert>
        <Alert variant="warning" title="Wymaga uwagi">
          Actual Cost = $0 dla 3 pozycji — uzupełnij alokację przed zamknięciem.
        </Alert>
        <Alert variant="error" title="Nie udało się wysłać do KSeF">
          Sprawdź dane kontrahenta i spróbuj ponownie.
        </Alert>
        <Alert variant="neutral" title="Wstrzymane">
          Powiązany transport oczekuje na potwierdzenie spedytora.
        </Alert>
        <Alert variant="info">Bez tytułu — sama treść opisowa.</Alert>
        {open && (
          <Alert variant="success" title="Faktura wysłana do KSeF" onDismiss={() => setOpen(false)}>
            Można zamknąć — numer ref. <code className="text-code-regular-sm">KS-2025-0041</code>
          </Alert>
        )}
      </div>
    )
  },
}
