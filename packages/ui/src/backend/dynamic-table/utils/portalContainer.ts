/**
 * Where a dropdown anchored to `anchor` should be portaled.
 *
 * Inside a Radix dialog (the Configure View drawer is a `Sheet`), the menu must
 * be portaled INTO the dialog's content, not onto `document.body`. Radix wraps
 * the dialog's OVERLAY in `react-remove-scroll` with the content as its only
 * shard, so a wheel or touch-move over anything outside the content's DOM is
 * cancelled — a body-portaled list could not be scrolled with the mouse wheel,
 * and a long column list (Group by, Highlighting, Filter) was cut off with no
 * way to reach the rest (GT, 2026-10-08). Inside the content the lock lets the
 * list scroll like any other scroll area of the drawer.
 *
 * Only Radix dialogs are matched (`data-state`): the grid's own hand-made
 * popovers also carry `role="dialog"`, are portaled to the body themselves and
 * hold no scroll lock, so their menus keep going to the body.
 *
 * `position: fixed` keeps working inside the content: the Sheet sets no
 * transform at rest, so the viewport stays the containing block.
 */
export function portalContainerFor(anchor: Element | null | undefined): HTMLElement {
  const dialog = anchor?.closest<HTMLElement>('[role="dialog"][data-state]');
  return dialog ?? document.body;
}
