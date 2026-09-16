import * as fs from 'fs'
import * as path from 'path'

// A user-authored expression evaluated through `eval` or `new Function` is
// arbitrary JavaScript running against tenant data in every viewer's browser.
// The spec rates that Critical, and the mitigation is that the evaluator walks
// the AST and nothing else.
//
// The spec asked for an eslint rule. `packages/ui` has no eslint config and the
// root `yarn lint` never reaches these files, so the ban is enforced here
// instead: a source scan that fails the unit suite the moment anyone adds a
// dynamic-code escape hatch to the formula surface.

const ROOT = path.resolve(__dirname, '..')

/** Every source file that participates in parsing or evaluating a formula. */
function formulaSourceFiles(): string[] {
  const formulaDir = path.join(ROOT, 'formula')
  const files = fs
    .readdirSync(formulaDir)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .map((f) => path.join(formulaDir, f))
  return [
    ...files,
    path.join(ROOT, 'utils', 'formulaColumns.tsx'),
    path.join(ROOT, 'components', 'ConfigureViewFormulas.tsx'),
  ]
}

/**
 * Every way to reach the JavaScript compiler at runtime. `setTimeout`/
 * `setInterval` are included because both accept a code string.
 */
const FORBIDDEN: { label: string; pattern: RegExp }[] = [
  { label: 'eval(', pattern: /\beval\s*\(/ },
  { label: 'new Function', pattern: /\bnew\s+Function\s*\(/ },
  { label: 'Function constructor', pattern: /\bFunction\s*\(\s*['"`]/ },
  { label: 'GeneratorFunction / AsyncFunction', pattern: /(Generator|Async)Function/ },
  { label: 'setTimeout with a code string', pattern: /setTimeout\s*\(\s*['"`]/ },
  { label: 'setInterval with a code string', pattern: /setInterval\s*\(\s*['"`]/ },
  { label: 'import()', pattern: /[^.\w]import\s*\(/ },
  { label: 'require()', pattern: /\brequire\s*\(/ },
]

describe('the formula surface never reaches the JavaScript compiler', () => {
  const files = formulaSourceFiles()

  it('scans a non-empty set of files (so a rename cannot silently disable this test)', () => {
    expect(files.length).toBeGreaterThanOrEqual(7)
    for (const file of files) expect(fs.existsSync(file)).toBe(true)
  })

  it.each(files.map((f) => [path.relative(ROOT, f), f]))(
    '%s contains no dynamic-code escape hatch',
    (_name, file) => {
      const source = fs.readFileSync(file, 'utf8')
      for (const { label, pattern } of FORBIDDEN) {
        expect({ file: path.relative(ROOT, file), found: pattern.test(source), label }).toEqual({
          file: path.relative(ROOT, file),
          found: false,
          label,
        })
      }
    },
  )

  it('adds no formula-parsing dependency — HyperFormula is GPLv3 and excluded', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(ROOT, '../../..', 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    for (const banned of [
      'hyperformula',
      'fast-formula-parser',
      '@sheetxl/formulas',
      'formula.js',
      'hot-formula-parser',
      '@univerjs/engine-formula',
    ]) {
      expect(declared).not.toContain(banned)
    }
  })

  it('keeps the formula engine free of React and of the host framework', () => {
    const formulaDir = path.join(ROOT, 'formula')
    for (const file of fs.readdirSync(formulaDir)) {
      const source = fs.readFileSync(path.join(formulaDir, file), 'utf8')
      expect(source).not.toContain("from 'react'")
      expect(source).not.toContain("from '@open-mercato/")
    }
  })
})
