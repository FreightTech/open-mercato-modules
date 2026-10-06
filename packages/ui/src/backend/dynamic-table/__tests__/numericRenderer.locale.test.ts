import { numericRenderer } from '../components/renderers'

const norm = (s: unknown) => String(s).replace(/ | /g, ' ')

describe('numericRenderer locale', () => {
  it('prints a Polish amount the Polish way when the column carries the app locale', () => {
    expect(norm(numericRenderer(500000, {}, { data: 'x', type: 'numeric', numericFormat: { locale: 'pl' } } as never))).toBe('500 000,00')
  })

  it('reads the Handsontable-style culture as the locale and ignores the pattern', () => {
    expect(norm(numericRenderer(8000, {}, { data: 'x', type: 'numeric', numericFormat: { pattern: '0,0.00', culture: 'pl-PL' } } as never))).toBe('8000,00')
  })

  it('keeps en-US with two decimals when nothing is set', () => {
    expect(numericRenderer(8000, {}, { data: 'x', type: 'numeric' } as never)).toBe('8,000.00')
  })
})
