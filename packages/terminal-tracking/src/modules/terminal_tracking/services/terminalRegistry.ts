import type { TerminalAdapter } from '../lib/terminal-adapter'

/**
 * Singleton registry for terminal adapters, keyed by `adapterType` (e.g. 'n4').
 * One adapter serves all terminals of that type; per-terminal config lives in
 * TerminalConfig rows.
 */
export class TerminalRegistry {
  private adapters = new Map<string, TerminalAdapter>()

  register(adapter: TerminalAdapter): void {
    this.adapters.set(adapter.adapterType.toLowerCase(), adapter)
  }

  get(adapterType: string): TerminalAdapter | undefined {
    return this.adapters.get(adapterType.toLowerCase())
  }

  has(adapterType: string): boolean {
    return this.adapters.has(adapterType.toLowerCase())
  }

  list(): TerminalAdapter[] {
    return Array.from(this.adapters.values())
  }

  types(): string[] {
    return Array.from(this.adapters.keys())
  }
}
