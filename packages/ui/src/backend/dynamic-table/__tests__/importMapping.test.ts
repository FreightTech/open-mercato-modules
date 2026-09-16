import type { ImportFieldDef } from '../types/import';
import type { ColumnDef } from '../types/index';
import {
  applyMapping,
  buildDefaultMapping,
  fieldsFromColumns,
  normalizeHeader,
  pruneMapping,
  validateMapping,
} from '../utils/importMapping';

const FIELDS: ImportFieldDef[] = [
  { field: 'id', label: 'Id', type: 'text', matchKey: true },
  {
    field: 'invoiceNumber',
    label: 'Invoice number',
    labels: ['Numer faktury'],
    type: 'text',
    required: true,
  },
  { field: 'netAmount', label: 'Net amount', labels: ['Kwota netto'], type: 'numeric' },
  { field: 'contractorId', label: 'Contractor', type: 'text', relation: true },
];

describe('normalizeHeader', () => {
  it('folds case, punctuation and whitespace', () => {
    expect(normalizeHeader('Invoice number')).toBe('invoicenumber');
    expect(normalizeHeader(' invoice_number ')).toBe('invoicenumber');
    expect(normalizeHeader('Invoice-Number')).toBe('invoicenumber');
  });

  it('folds Polish diacritics, including ł which has no decomposition', () => {
    expect(normalizeHeader('Kwota nettoś')).toBe(normalizeHeader('Kwota nettos'));
    expect(normalizeHeader('Załącznik')).toBe('zalacznik');
  });
});

describe('buildDefaultMapping', () => {
  it('maps the export’s own headers with zero configuration', () => {
    const mapping = buildDefaultMapping(['Invoice number', 'Net amount'], FIELDS);
    expect(mapping).toEqual({
      'Invoice number': 'invoiceNumber',
      'Net amount': 'netAmount',
    });
  });

  it('maps a Polish export just as well (locale-dependent headers)', () => {
    const mapping = buildDefaultMapping(['Numer faktury', 'Kwota netto'], FIELDS);
    expect(mapping).toEqual({
      'Numer faktury': 'invoiceNumber',
      'Kwota netto': 'netAmount',
    });
  });

  it('maps a raw field key too, so a hand-written file works', () => {
    expect(buildDefaultMapping(['invoiceNumber'], FIELDS)).toEqual({
      invoiceNumber: 'invoiceNumber',
    });
  });

  it('claims each target field once — the later duplicate is left unmapped', () => {
    const mapping = buildDefaultMapping(['Net amount', 'netAmount'], FIELDS);
    expect(mapping).toEqual({ 'Net amount': 'netAmount' });
  });

  it('ignores headers it does not recognise rather than guessing', () => {
    expect(buildDefaultMapping(['Something else'], FIELDS)).toEqual({});
  });
});

describe('validateMapping', () => {
  it('refuses a relation column instead of silently mis-resolving it', () => {
    const issues = validateMapping(
      { Contractor: 'contractorId', 'Invoice number': 'invoiceNumber' },
      ['Contractor', 'Invoice number'],
      FIELDS,
    );
    expect(issues).toEqual([
      {
        code: 'relation_unsupported',
        header: 'Contractor',
        field: 'contractorId',
        label: 'Contractor',
      },
    ]);
  });

  it('reports a missing required field', () => {
    const issues = validateMapping({ 'Net amount': 'netAmount' }, ['Net amount'], FIELDS);
    expect(issues).toContainEqual({
      code: 'missing_required',
      field: 'invoiceNumber',
      label: 'Invoice number',
    });
  });

  it('skips the required check when the caller is updating, not creating', () => {
    const issues = validateMapping({ 'Net amount': 'netAmount' }, ['Net amount'], FIELDS, {
      requireRequired: false,
    });
    expect(issues).toEqual([]);
  });

  it('reports two headers pointed at one field', () => {
    const issues = validateMapping(
      { A: 'netAmount', B: 'netAmount' },
      ['A', 'B'],
      FIELDS,
      { requireRequired: false },
    );
    expect(issues).toEqual([{ code: 'duplicate_field', field: 'netAmount', label: 'Net amount' }]);
  });

  it('reports a mapping onto a field the module does not accept', () => {
    const issues = validateMapping({ A: 'nope' }, ['A'], FIELDS, { requireRequired: false });
    expect(issues).toEqual([{ code: 'unknown_field', header: 'A', field: 'nope', label: 'A' }]);
  });
});

describe('pruneMapping', () => {
  it('drops only the offending header, so a refused relation does not block the rest', () => {
    const mapping = { Contractor: 'contractorId', 'Invoice number': 'invoiceNumber' };
    const issues = validateMapping(mapping, Object.keys(mapping), FIELDS);
    expect(pruneMapping(mapping, issues)).toEqual({ 'Invoice number': 'invoiceNumber' });
  });

  it('keeps everything when the only issue is a missing required field', () => {
    const mapping = { 'Net amount': 'netAmount' };
    const issues = validateMapping(mapping, ['Net amount'], FIELDS);
    expect(pruneMapping(mapping, issues)).toEqual(mapping);
  });
});

describe('applyMapping', () => {
  it('re-keys a parsed row onto target fields', () => {
    const out = applyMapping(
      { 'Invoice number': 'FV/1', 'Net amount': '100.00', Ignored: 'x' },
      { 'Invoice number': 'invoiceNumber', 'Net amount': 'netAmount' },
    );
    expect(out).toEqual({ invoiceNumber: 'FV/1', netAmount: '100.00' });
  });

  it('turns an empty cell into null — "cleared" is not the same as "absent"', () => {
    const out = applyMapping({ Notes: '' }, { Notes: 'notes' });
    expect(out).toEqual({ notes: null });
    expect('notes' in out).toBe(true);
  });
});

describe('fieldsFromColumns', () => {
  const columns: ColumnDef[] = [
    { data: 'id', title: 'Id' },
    { data: 'invoiceNumber', title: 'Invoice number', type: 'text' },
    { data: 'netAmount', title: 'Net amount', type: 'numeric' },
    { data: 'contractor', title: 'Contractor', exportValue: (v: any) => String(v?.name ?? '') },
  ];

  it('carries the column key as an alias so both spellings map', () => {
    const fields = fieldsFromColumns(columns);
    const invoiceNumber = fields.find((f) => f.field === 'invoiceNumber');
    expect(invoiceNumber?.labels).toEqual(['invoiceNumber']);
  });

  it('marks a column with an exportValue projection as a relation', () => {
    const fields = fieldsFromColumns(columns);
    expect(fields.find((f) => f.field === 'contractor')?.relation).toBe(true);
    expect(fields.find((f) => f.field === 'netAmount')?.relation).toBe(false);
  });

  it('marks the id column as the match key', () => {
    const fields = fieldsFromColumns(columns);
    expect(fields.find((f) => f.field === 'id')?.matchKey).toBe(true);
  });
});
