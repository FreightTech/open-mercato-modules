import { useEffect, useRef } from 'react';

/**
 * Escape must close the INNERMOST open layer, and only that one.
 *
 * Why this cannot be done with a plain `document` listener plus
 * `stopPropagation` (which is what every popup in this folder used to do, and
 * why Escape inside a Configure View dropdown tore the whole drawer down):
 *
 * Radix's `DismissableLayer` — the Sheet the Configure View panel renders in,
 * and every Dialog in the app — closes on Escape via
 * `ownerDocument.addEventListener('keydown', handler, { capture: true })`.
 * That listener is registered when the SHEET mounts, i.e. strictly before any
 * dropdown inside it opens. Capture listeners on the same node fire in
 * registration order, so Radix always ran first and the drawer was already
 * closing by the time the dropdown's own handler saw the key. `stopPropagation`
 * from a later listener on the same node cannot undo that.
 *
 * Two things fix it:
 *
 * 1. Listen on `window`, in the capture phase. `window` is the outermost node
 *    of the propagation path, so a capture listener there runs BEFORE any
 *    capture listener on `document` — including Radix's. `stopPropagation()`
 *    then keeps the event from ever reaching `document`.
 *
 * 2. A module-level layer stack, because (1) alone inverts the nesting: window
 *    capture listeners also fire in registration order, so the OUTERMOST layer
 *    would win. Each active layer pushes an id; a handler that is not on top of
 *    the stack returns without consuming the key, letting the innermost layer
 *    handle it.
 *
 * A layer registered through this hook therefore swallows Escape only while it
 * is the top layer, and leaves it alone otherwise — so Escape with no dropdown
 * open still closes the drawer, as it should.
 */
const layerStack: symbol[] = [];

export function useEscapeLayer(active: boolean, onDismiss: () => void): void {
  // Held in a ref so a fresh `onDismiss` identity each render does not
  // re-register the listener (which would reorder the stack).
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!active) return;
    if (typeof window === 'undefined') return;

    const id = Symbol('escape-layer');
    layerStack.push(id);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Not the innermost layer — let the one above us take it.
      if (layerStack[layerStack.length - 1] !== id) return;
      e.preventDefault();
      e.stopPropagation();
      // `stopPropagation` alone still lets other listeners on `window` itself
      // run; the immediate variant is what guarantees exclusivity.
      e.stopImmediatePropagation();
      dismissRef.current();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      const index = layerStack.indexOf(id);
      if (index >= 0) layerStack.splice(index, 1);
    };
  }, [active]);
}

export default useEscapeLayer;
