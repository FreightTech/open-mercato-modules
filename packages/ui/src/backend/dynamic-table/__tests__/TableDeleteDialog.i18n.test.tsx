/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import TableDeleteDialog from '../components/TableDeleteDialog'

const pl = {
  'dynamicTable.delete.cancel': 'Anuluj',
  'dynamicTable.delete.confirm': 'Usuń',
  'dynamicTable.delete.bulkTitle': 'Usuń {count} {noun}',
  'dynamicTable.delete.bulkDescription': 'Usunąć {count} zaznaczone pozycje? Tej operacji nie można cofnąć.',
}

describe('TableDeleteDialog speaks the app language', () => {
  it('translates the buttons (they were hardcoded "Cancel" / "Delete")', () => {
    render(
      <I18nProvider locale="pl" dict={pl}>
        <TableDeleteDialog row={{ name: 'FV/1' }} isDeleting={false} onConfirm={() => {}} onCancel={() => {}} title="Usuń fakturę" />
      </I18nProvider>,
    )
    expect(screen.getByRole('button', { name: 'Anuluj' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Usuń' })).toBeTruthy()
  })

  it('words a bulk delete from the count and the table noun', () => {
    render(
      <I18nProvider locale="pl" dict={pl}>
        <TableDeleteDialog row={{ count: 3 }} isDeleting={false} onConfirm={() => {}} onCancel={() => {}} bulkNoun="faktury" />
      </I18nProvider>,
    )
    expect(screen.getByText('Usuń 3 faktury')).toBeTruthy()
    expect(screen.getByText('Usunąć 3 zaznaczone pozycje? Tej operacji nie można cofnąć.')).toBeTruthy()
  })
})
