import type { TerminalRegistry } from '../../services/terminalRegistry'
import { N4TerminalAdapter } from './n4/adapter'
import { GctTerminalAdapter } from './gct/adapter'
import { BctTerminalAdapter } from './bct/adapter'

/**
 * Register all built-in terminal adapters. Adapters are keyed by `adapterType`;
 * a single adapter serves every terminal of that type (N4 → Baltic Hub etc.,
 * GCT → Gdynia Container Terminal, BCT → Bałtycki Terminal Kontenerowy via
 * INCOS), which are configured as `TerminalConfig` rows, not hardcoded here.
 */
export function registerAllAdapters(registry: TerminalRegistry): void {
  registry.register(new N4TerminalAdapter())
  registry.register(new GctTerminalAdapter())
  registry.register(new BctTerminalAdapter())
}
