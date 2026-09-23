/**
 * Material 3 chrome shared by every surface the split view draws — menus, the
 * workspace bar, the customise drawer, pane and widget cards.
 *
 * One file of class strings instead of the same 200-character literal copied
 * into five components, which is how three of them drifted onto raw pixel type
 * before this existed. Anything that looks like "a split-view menu row" takes
 * its classes from here.
 *
 * Sizes are the grid's, not M3's touch geometry: rows are 28px (M3 says 48dp)
 * and controls 32px, because this is a dense operations tool and the table
 * toolbar these sit beside uses exactly those heights (measured: 32px icon
 * buttons, 28px search pill, 28px view tabs). Shape, colour roles, state layers
 * and motion are M3's.
 */

/** One row of a menu. */
export const M3_MENU_ROW =
  'flex h-7 w-full items-center gap-2 rounded-m3-xs px-1.5 text-left text-body-regular-xs text-[var(--m3-on-surface)] transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-state-layer-hover)] active:bg-[var(--m3-state-layer-pressed)] disabled:cursor-not-allowed disabled:opacity-[var(--m3-disabled-content-opacity)] disabled:hover:bg-transparent'

/**
 * The SELECTED form of a menu row. M3 marks selection by swapping the
 * container, never by an icon alone — the same `secondary-container` role the
 * grid uses for a selected row, so selection reads identically everywhere.
 */
export const M3_MENU_ROW_ON =
  `${M3_MENU_ROW} bg-[var(--m3-secondary-container)] text-[var(--m3-on-secondary-container)] hover:bg-[var(--m3-secondary-container)]`

/** A destructive row — "Usuń panel". Error ink, error state layer. */
export const M3_MENU_ROW_DANGER =
  'flex h-7 w-full items-center gap-2 rounded-m3-xs px-1.5 text-left text-body-regular-xs text-[var(--m3-error)] transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-state-layer-error-hover)]'

/**
 * A section caption inside a menu ("Całe działy", "Wykresy"). 10px chrome uses
 * the 10px token: routing it through a 12/16 token would grow every menu by 20%.
 */
export const M3_MENU_CAPTION =
  'text-label-semibold-2xs uppercase tracking-wider text-[var(--m3-on-surface-variant)]'

/** The hairline between menu groups. */
export const M3_MENU_DIVIDER = 'my-1 h-px bg-[var(--m3-outline-variant)]'

/**
 * A portalled menu panel — an M3 elevated surface: a `md` (12px) corner, the
 * softer `outline-variant` hairline, a container step for the fill, and the
 * two-shadow elevation rather than Tailwind's `shadow-*`.
 */
export const M3_MENU_PANEL =
  'pointer-events-auto fixed z-[1000] overflow-y-auto rounded-m3-md border border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container)] p-1 shadow-m3-2'

/**
 * A control in the workspace bar — an M3 outlined assist chip at the bar's
 * 32px. Every pill in the bar shares it so they line up to the pixel.
 */
export const BAR_PILL =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-m3-full border border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container-lowest)] px-3 text-label-medium-md text-[var(--m3-on-surface)] transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-container-hover)] active:bg-[var(--m3-state-layer-pressed)] disabled:cursor-not-allowed disabled:opacity-[var(--m3-disabled-content-opacity)] disabled:hover:bg-[var(--m3-surface-container-lowest)] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-[var(--m3-on-surface-variant)]'

/** A bar pill that is currently "on" — a saved layout applied, full screen active. */
export const BAR_PILL_ON =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-m3-full border border-transparent bg-[var(--m3-secondary-container)] px-3 text-label-medium-md text-[var(--m3-on-secondary-container)] transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-row-selected-hover)] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0'

/** A 28px round icon button inside cards and menus. */
export const ICON_BUTTON =
  'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-m3-full text-[var(--m3-on-surface-variant)] transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-state-layer-hover)] hover:text-[var(--m3-on-surface)] active:bg-[var(--m3-state-layer-pressed)] disabled:cursor-not-allowed disabled:opacity-[var(--m3-disabled-content-opacity)] [&_svg]:h-4 [&_svg]:w-4'

/**
 * A pane when the page is a workspace: the Figma widget card (549:542) — white
 * container, a 16px corner (the grid's own `.hot-card` radius, so a table pane
 * and a widget pane agree on shape) and the soft two-layer elevation from the
 * widget gallery rather than a hairline.
 */
export const PANE_CARD =
  'rounded-m3-lg bg-[var(--m3-surface-container-lowest)] shadow-m3-1'

/** A text field in the drawer and in menus. Focus is the teal ring, not blue. */
export const TEXT_FIELD =
  'h-8 min-w-0 rounded-m3-sm border border-[var(--m3-outline)] bg-[var(--m3-surface-container-lowest)] px-2.5 text-body-regular-sm text-[var(--m3-on-surface)] transition-[border-color,box-shadow] duration-[var(--m3-duration-short2)] ease-m3-standard placeholder:text-[var(--m3-on-surface-variant)] focus-visible:border-[var(--m3-focus-ring-color)] focus-visible:shadow-[var(--m3-focus-halo)] focus-visible:outline-none'
