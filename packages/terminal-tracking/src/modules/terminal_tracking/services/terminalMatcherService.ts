import Fuse from 'fuse.js'
import type { EntityManager } from '@mikro-orm/postgresql'
import { TerminalConfig } from '../data/entities'

export type FacilityMatchInput = {
  name?: string | null
  bic?: string | null
  smdg?: string | null
  unlocode?: string | null
}

export type MatchScope = {
  organizationId: string
  tenantId: string
}

export type TerminalMatch = {
  terminalCode: string
  displayName: string
  matchedBy: 'bic' | 'smdg' | 'unlocode' | 'name'
  score?: number
}

type Deps = {
  em: () => EntityManager
}

/**
 * Resolves a facility (by exact BIC / SMDG / UNLOCODE or fuzzy name) to one of
 * the tenant's configured terminals. Matching fields are not encrypted, so a
 * plain `em.find` is sufficient.
 */
export class TerminalMatcherService {
  constructor(private readonly deps: Deps) {}

  private async candidates(scope: MatchScope): Promise<TerminalConfig[]> {
    const em = this.deps.em().fork()
    return em.find(TerminalConfig, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      isActive: true,
      deletedAt: null,
    })
  }

  async resolveFacility(input: FacilityMatchInput, scope: MatchScope): Promise<TerminalMatch | null> {
    const configs = await this.candidates(scope)
    if (configs.length === 0) return null

    const norm = (s: string) => s.trim().toUpperCase()

    // 1) Exact BIC
    if (input.bic) {
      const bic = norm(input.bic)
      const hit = configs.find((c) => (c.bicCodes ?? []).some((x) => norm(x) === bic))
      if (hit) return { terminalCode: hit.terminalCode, displayName: hit.displayName, matchedBy: 'bic' }
    }

    // 2) Exact SMDG
    if (input.smdg) {
      const smdg = norm(input.smdg)
      const hit = configs.find((c) => (c.smdgCodes ?? []).some((x) => norm(x) === smdg))
      if (hit) return { terminalCode: hit.terminalCode, displayName: hit.displayName, matchedBy: 'smdg' }
    }

    // 3) Exact UNLOCODE
    if (input.unlocode) {
      const unlocode = norm(input.unlocode)
      const hit = configs.find((c) => c.unlocode && norm(c.unlocode) === unlocode)
      if (hit) return { terminalCode: hit.terminalCode, displayName: hit.displayName, matchedBy: 'unlocode' }
    }

    // 4) Fuzzy name (fuse.js)
    if (input.name && input.name.trim()) {
      const docs = configs.flatMap((c) =>
        [c.displayName, ...(c.nameAliases ?? [])].map((alias) => ({ config: c, alias })),
      )
      const fuse = new Fuse(docs, {
        keys: ['alias'],
        includeScore: true,
        threshold: 0.3,
        ignoreLocation: true,
      })
      const [best] = fuse.search(input.name.trim())
      if (best) {
        return {
          terminalCode: best.item.config.terminalCode,
          displayName: best.item.config.displayName,
          matchedBy: 'name',
          score: best.score,
        }
      }
    }

    return null
  }
}
