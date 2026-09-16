import {
  padGrid,
  parseClipboardGrid,
  parseClipboardHtml,
  parseTsv,
  selectionToTsv,
  serialiseTsv,
} from '../utils/clipboard';

describe('parseTsv', () => {
  it('parses a rectangular block', () => {
    expect(parseTsv('a\tb\tc\nd\te\tf')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
  });

  it('ignores the single trailing newline Excel appends', () => {
    expect(parseTsv('a\tb\n')).toEqual([['a', 'b']]);
    expect(parseTsv('a\tb\r\n')).toEqual([['a', 'b']]);
  });

  it('keeps a genuinely empty middle row', () => {
    expect(parseTsv('a\n\nb')).toEqual([['a'], [''], ['b']]);
  });

  it('handles all three line endings', () => {
    expect(parseTsv('a\r\nb\rc\nd')).toEqual([['a'], ['b'], ['c'], ['d']]);
  });

  it('keeps empty cells rather than collapsing them', () => {
    expect(parseTsv('a\t\tc')).toEqual([['a', '', 'c']]);
  });

  it('unquotes a cell containing a tab', () => {
    expect(parseTsv('"a\tb"\tc')).toEqual([['a\tb', 'c']]);
  });

  it('unquotes a cell containing a newline', () => {
    expect(parseTsv('"line1\nline2"\tafter')).toEqual([['line1\nline2', 'after']]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseTsv('"say ""hi"""\tb')).toEqual([['say "hi"', 'b']]);
  });

  it('keeps a quote that is not at the start of a cell literal', () => {
    expect(parseTsv('12" pipe\tb')).toEqual([['12" pipe', 'b']]);
  });

  it('keeps an explicitly empty quoted last cell', () => {
    expect(parseTsv('a\t""')).toEqual([['a', '']]);
  });

  it('pads ragged rows so callers can index without holes', () => {
    expect(parseTsv('a\tb\tc\nd')).toEqual([
      ['a', 'b', 'c'],
      ['d', '', ''],
    ]);
  });

  it('returns nothing for an empty payload', () => {
    expect(parseTsv('')).toEqual([]);
  });
});

describe('serialiseTsv', () => {
  it('joins with tabs and newlines', () => {
    expect(serialiseTsv([['a', 'b'], ['c', 'd']])).toBe('a\tb\nc\td');
  });

  it('renders null and undefined as empty cells', () => {
    expect(serialiseTsv([[null, undefined, 0]])).toBe('\t\t0');
  });

  it('quotes only the cells that need it, and round-trips', () => {
    const grid = [['plain', 'has\ttab'], ['has\nnewline', 'say "hi"']];
    const tsv = serialiseTsv(grid);
    expect(tsv).toContain('"has\ttab"');
    expect(tsv).toContain('"say ""hi"""');
    expect(parseTsv(tsv)).toEqual(grid);
  });
});

describe('parseClipboardHtml', () => {
  it('parses the table Excel puts on the clipboard', () => {
    const html = `
      <html><body><!--StartFragment-->
      <table><tr><td>REF-001</td><td>1200</td></tr><tr><td>REF-002</td><td>1300</td></tr></table>
      <!--EndFragment--></body></html>`;
    expect(parseClipboardHtml(html)).toEqual([
      ['REF-001', '1200'],
      ['REF-002', '1300'],
    ]);
  });

  it('reads rows out of thead and tbody', () => {
    const html = '<table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>';
    expect(parseClipboardHtml(html)).toEqual([
      ['H1', 'H2'],
      ['a', 'b'],
    ]);
  });

  it('keeps a cell that contains a tab as ONE cell — the reason HTML is preferred', () => {
    const html = '<table><tr><td>a\tb</td><td>c</td></tr></table>';
    expect(parseClipboardHtml(html)).toEqual([['a\tb', 'c']]);
  });

  it('turns <br> into a newline and decodes entities', () => {
    const html = '<table><tr><td>line1<br>line2</td><td>&amp;&nbsp;co</td></tr></table>';
    expect(parseClipboardHtml(html)).toEqual([['line1\nline2', '& co']]);
  });

  it('trims the source formatting whitespace around a cell', () => {
    const html = '<table>\n  <tr>\n    <td>\n      spaced\n    </td>\n  </tr>\n</table>';
    expect(parseClipboardHtml(html)).toEqual([['spaced']]);
  });

  it('expands a colspan into empty trailing cells', () => {
    const html = '<table><tr><td colspan="2">merged</td><td>tail</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>';
    expect(parseClipboardHtml(html)).toEqual([
      ['merged', '', 'tail'],
      ['a', 'b', 'c'],
    ]);
  });

  it('expands a rowspan into the rows below', () => {
    const html = '<table><tr><td rowspan="2">tall</td><td>b</td></tr><tr><td>c</td></tr></table>';
    expect(parseClipboardHtml(html)).toEqual([
      ['tall', 'b'],
      ['', 'c'],
    ]);
  });

  it('pads ragged html rows', () => {
    const html = '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>';
    expect(parseClipboardHtml(html)).toEqual([
      ['a', 'b'],
      ['c', ''],
    ]);
  });

  it('returns null (not an empty grid) when there is no table', () => {
    expect(parseClipboardHtml('<div>just text</div>')).toBeNull();
    expect(parseClipboardHtml('')).toBeNull();
    expect(parseClipboardHtml(null)).toBeNull();
  });
});

describe('parseClipboardGrid', () => {
  it('prefers the html table over the plain-text fallback', () => {
    const grid = parseClipboardGrid({
      html: '<table><tr><td>a\tb</td><td>c</td></tr></table>',
      text: 'a\tb\tc',
    });
    expect(grid.source).toBe('html');
    expect(grid.rows).toEqual([['a\tb', 'c']]);
    expect(grid.rowCount).toBe(1);
    expect(grid.colCount).toBe(2);
  });

  it('falls back to TSV when the html carries no table', () => {
    const grid = parseClipboardGrid({ html: '<div>a b c</div>', text: 'a\tb\nc\td' });
    expect(grid.source).toBe('text');
    expect(grid.rows).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('falls back to TSV when there is no html flavour at all', () => {
    const grid = parseClipboardGrid({ text: '1\t2' });
    expect(grid.source).toBe('text');
  });

  it('reports an empty clipboard rather than pasting nothing silently', () => {
    expect(parseClipboardGrid({}).source).toBe('empty');
    expect(parseClipboardGrid({ text: '' }).source).toBe('empty');
    expect(parseClipboardGrid({ html: '<table><tr><td></td></tr></table>', text: '' }).source).toBe('empty');
  });

  it('treats an all-blank html table as empty and still tries the TSV', () => {
    const grid = parseClipboardGrid({ html: '<table><tr><td>&nbsp;</td></tr></table>', text: 'a\tb' });
    expect(grid.source).toBe('text');
    expect(grid.rows).toEqual([['a', 'b']]);
  });
});

describe('padGrid', () => {
  it('pads every row to the widest', () => {
    expect(padGrid([['a'], ['b', 'c', 'd']])).toEqual([
      ['a', '', ''],
      ['b', 'c', 'd'],
    ]);
  });
});

describe('selectionToTsv', () => {
  const bounds = { startRow: 2, endRow: 3, startCol: 5, endCol: 6 };
  const cells = [
    { row: 2, col: 5, value: 'Acme' },
    { row: 2, col: 6, value: 100 },
    { row: 3, col: 5, value: 'Beta' },
    { row: 3, col: 6, value: 250 },
  ];

  it('lays an offset rectangle back out relative to its own top-left', () => {
    expect(selectionToTsv(cells, bounds)).toBe('Acme\t100\nBeta\t250');
  });

  it('round-trips through parseTsv, so copy → paste inside the grid is lossless', () => {
    const awkward = [
      { row: 0, col: 0, value: 'line1\nline2' },
      { row: 0, col: 1, value: 'has\ttab' },
    ];
    const tsv = selectionToTsv(awkward, { startRow: 0, endRow: 0, startCol: 0, endCol: 1 });
    expect(parseTsv(tsv)).toEqual([['line1\nline2', 'has\ttab']]);
  });

  it('leaves a missing cell empty instead of shifting its neighbours left', () => {
    expect(selectionToTsv([cells[0], cells[3]], bounds)).toBe('Acme\t\n\t250');
  });

  it('writes null and undefined as empty, never as the words', () => {
    expect(
      selectionToTsv(
        [{ row: 0, col: 0, value: null }, { row: 0, col: 1, value: undefined }],
        { startRow: 0, endRow: 0, startCol: 0, endCol: 1 },
      ),
    ).toBe('\t');
  });
});
