import * as XLSX from 'xlsx';
import { parseImportFile, ImportParseError } from '../utils/importParse';
import { toCsv } from '../utils/exportTable';

function xlsxBytes(aoa: unknown[][]): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Export');
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }));
}

describe('parseImportFile — CSV', () => {
  it('reads headers and rows from a CSV string', () => {
    const csv = 'Invoice number,Net amount\nFV/1,100.00\nFV/2,250.50\n';
    const parsed = parseImportFile(csv);

    expect(parsed.headers).toEqual(['Invoice number', 'Net amount']);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual({
      sourceRowNumber: 1,
      values: { 'Invoice number': 'FV/1', 'Net amount': '100.00' },
    });
    expect(parsed.rows[1].sourceRowNumber).toBe(2);
  });

  it('strips the UTF-8 BOM our own CSV export writes', () => {
    // Round-trip the exporter's own output — this is the export→edit→re-import path.
    const csv = toCsv({
      headers: ['Numer faktury', 'Kwota netto'],
      rows: [['FV/1', '100.00']],
    });
    expect(csv.charCodeAt(0)).toBe(0xfeff);

    const parsed = parseImportFile(csv);
    expect(parsed.headers).toEqual(['Numer faktury', 'Kwota netto']);
    expect(parsed.rows[0].values['Numer faktury']).toBe('FV/1');
  });

  it('survives quoted fields containing commas and quotes', () => {
    const csv = toCsv({
      headers: ['Seller', 'Notes'],
      rows: [['Maersk A/S, Kopenhaga', 'said "ok"']],
    });
    const parsed = parseImportFile(csv);
    expect(parsed.rows[0].values.Seller).toBe('Maersk A/S, Kopenhaga');
    expect(parsed.rows[0].values.Notes).toBe('said "ok"');
  });

  it('skips wholly blank padding rows without consuming a row number', () => {
    const csv = 'A,B\n1,2\n,\n3,4\n';
    const parsed = parseImportFile(csv);
    expect(parsed.rows.map((r) => r.sourceRowNumber)).toEqual([1, 2]);
    expect(parsed.rows[1].values).toEqual({ A: '3', B: '4' });
  });
});

describe('parseImportFile — XLSX', () => {
  it('reads an .xlsx workbook into the same shape as the CSV path', () => {
    const bytes = xlsxBytes([
      ['Invoice number', 'Net amount'],
      ['FV/1', '100.00'],
      ['FV/2', '250.50'],
    ]);
    const parsed = parseImportFile(bytes);

    expect(parsed.headers).toEqual(['Invoice number', 'Net amount']);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].values).toEqual({
      'Invoice number': 'FV/1',
      'Net amount': '100.00',
    });
  });

  it('normalizes a real date cell to an ISO date rather than a locale blob', () => {
    const bytes = xlsxBytes([
      ['Invoice date'],
      [new Date(Date.UTC(2026, 7, 3))],
    ]);
    const parsed = parseImportFile(bytes);
    expect(parsed.rows[0].values['Invoice date']).toBe('2026-08-03');
  });

  it('suffixes duplicate headers so the mapping stays a total function', () => {
    const bytes = xlsxBytes([
      ['Amount', 'Amount'],
      ['1', '2'],
    ]);
    const parsed = parseImportFile(bytes);
    expect(parsed.headers).toEqual(['Amount', 'Amount (2)']);
    expect(parsed.rows[0].values).toEqual({ Amount: '1', 'Amount (2)': '2' });
  });
});

describe('parseImportFile — caps and refusals', () => {
  it('rejects a file over the row cap and reports the real row count', () => {
    const lines = ['A'];
    for (let i = 0; i < 12; i++) lines.push(String(i));
    expect.assertions(3);
    try {
      parseImportFile(lines.join('\n'), { maxRows: 10 });
    } catch (err) {
      expect(err).toBeInstanceOf(ImportParseError);
      expect((err as ImportParseError).code).toBe('too_many_rows');
      expect((err as ImportParseError).details).toEqual({ count: 12, limit: 10 });
    }
  });

  it('rejects an oversized file BEFORE parsing it', () => {
    const big = 'A\n' + 'x\n'.repeat(50);
    expect(() => parseImportFile(big, { maxBytes: 8 })).toThrow(ImportParseError);
    try {
      parseImportFile(big, { maxBytes: 8 });
    } catch (err) {
      expect((err as ImportParseError).code).toBe('file_too_large');
    }
  });

  it('rejects an empty file', () => {
    expect(() => parseImportFile('')).toThrow(/empty/i);
  });

  it('rejects a file with headers but no data rows', () => {
    try {
      parseImportFile('A,B\n');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ImportParseError).code).toBe('empty_file');
    }
  });
});
