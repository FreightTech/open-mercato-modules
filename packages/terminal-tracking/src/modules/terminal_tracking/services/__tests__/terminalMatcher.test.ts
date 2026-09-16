import { TerminalMatcherService } from '../terminalMatcherService'

const SCOPE = { organizationId: 'org-1', tenantId: 'ten-1' }

const CONFIGS = [
  {
    terminalCode: 'bct',
    displayName: 'Baltic Hub',
    unlocode: 'PLGDN',
    bicCodes: ['BCTGDN'],
    smdgCodes: ['GDNBCT'],
    nameAliases: ['BCT', 'DCT Gdansk'],
    isActive: true,
  },
  {
    terminalCode: 'gct',
    displayName: 'Gdynia Container Terminal',
    unlocode: 'PLGDY',
    bicCodes: [],
    smdgCodes: ['GDYGCT'],
    nameAliases: ['GCT'],
    isActive: true,
  },
]

function makeService(configs: unknown[] = CONFIGS) {
  const em = () => ({ fork: () => ({ find: async () => configs }) })
  return new TerminalMatcherService({ em: em as never })
}

describe('TerminalMatcherService.resolveFacility', () => {
  it('matches by exact BIC (case-insensitive)', async () => {
    const m = await makeService().resolveFacility({ bic: 'bctgdn' }, SCOPE)
    expect(m).toMatchObject({ terminalCode: 'bct', matchedBy: 'bic' })
  })

  it('matches by exact SMDG', async () => {
    const m = await makeService().resolveFacility({ smdg: 'GDYGCT' }, SCOPE)
    expect(m).toMatchObject({ terminalCode: 'gct', matchedBy: 'smdg' })
  })

  it('matches by exact UNLOCODE (case-insensitive)', async () => {
    const m = await makeService().resolveFacility({ unlocode: 'plgdn' }, SCOPE)
    expect(m).toMatchObject({ terminalCode: 'bct', matchedBy: 'unlocode' })
  })

  it('matches by fuzzy display name', async () => {
    const m = await makeService().resolveFacility({ name: 'baltic hub' }, SCOPE)
    expect(m).toMatchObject({ terminalCode: 'bct', matchedBy: 'name' })
  })

  it('matches by fuzzy alias', async () => {
    const m = await makeService().resolveFacility({ name: 'DCT Gdańsk'.replace('ń', 'n') }, SCOPE)
    expect(m?.terminalCode).toBe('bct')
  })

  it('prefers exact BIC over a fuzzy name on a different terminal', async () => {
    const m = await makeService().resolveFacility({ bic: 'BCTGDN', name: 'Gdynia' }, SCOPE)
    expect(m).toMatchObject({ terminalCode: 'bct', matchedBy: 'bic' })
  })

  it('returns null when nothing matches', async () => {
    expect(await makeService().resolveFacility({ name: 'Rotterdam APM Maasvlakte' }, SCOPE)).toBeNull()
    expect(await makeService().resolveFacility({ bic: 'NOPE' }, SCOPE)).toBeNull()
  })

  it('returns null when there are no configured terminals', async () => {
    expect(await makeService([]).resolveFacility({ unlocode: 'PLGDN' }, SCOPE)).toBeNull()
  })
})
