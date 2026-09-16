import fs from 'node:fs';
import path from 'node:path';

const componentsDir = path.join(__dirname, '..', 'components');

/**
 * The import parser is server-only by construction, not by convention.
 *
 * If a client component ever imports it, two things break at once: the browser
 * bundle grows a spreadsheet reader, and — far worse — the file gets parsed
 * twice, once for the preview and once for the commit, which is exactly how a
 * preview stops describing what the commit will do. This test is the tripwire.
 */
describe('importParse stays server-side', () => {
  const clientFiles = ['ImportPanel.tsx', 'ImportPreviewGrid.tsx'];

  it.each(clientFiles)('%s does not import the parser', (file) => {
    const source = fs.readFileSync(path.join(componentsDir, file), 'utf8');
    // Match a real import statement, not the word in a comment.
    expect(source).not.toMatch(/^\s*import[^;]*from\s+['"][^'"]*importParse['"]/m);
  });

  it.each(clientFiles)('%s does not import xlsx', (file) => {
    const source = fs.readFileSync(path.join(componentsDir, file), 'utf8');
    expect(source).not.toMatch(/^\s*import[^;]*from\s+['"]xlsx['"]/m);
  });

  it('the panel is a client component and the parser is not', () => {
    const panel = fs.readFileSync(path.join(componentsDir, 'ImportPanel.tsx'), 'utf8');
    const parser = fs.readFileSync(
      path.join(__dirname, '..', 'utils', 'importParse.ts'),
      'utf8',
    );
    expect(panel.startsWith("'use client'")).toBe(true);
    expect(parser).not.toMatch(/^['"]use client['"]/m);
  });
});
