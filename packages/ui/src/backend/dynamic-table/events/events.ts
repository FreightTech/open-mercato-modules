// events/events.ts

import { useEffect, useRef } from 'react';
// TYPE-ONLY on purpose. `types/index.ts` now imports the batch-save event
// VALUES from `handlers/cellWrites`, which imports `dispatch` from here — a
// value import back into `types/index` would close that into a runtime cycle.
import type { EventHandlers, TableEventPayloads } from '../types/index';

export function dispatch<T>(element: HTMLElement, eventName: string, payload: T) {
  const event = new CustomEvent(eventName, {
    detail: payload,
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);
}

export function useMediator<T>(
  eventName: string,
  handler: (payload: T) => void,
  elementRef: React.RefObject<HTMLElement | null>
) {
  useEffect(() => {
    const element = elementRef?.current;
    if (!element) return;

    const listener = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
      handler((event as CustomEvent<T>).detail);
    };

    element.addEventListener(eventName, listener);
    return () => element.removeEventListener(eventName, listener);
  }, [eventName, handler, elementRef]);
}

export function useListener<T>(
  eventName: string,
  handler: (payload: T) => void,
  elementRef: React.RefObject<HTMLElement | null>
) {
  useEffect(() => {
    const element = elementRef?.current;
    if (!element) return;

    const listener = (event: Event) => {
      handler((event as CustomEvent<T>).detail);
    };

    element.addEventListener(eventName, listener);
    return () => element.removeEventListener(eventName, listener);
  }, [eventName, handler, elementRef]);
}

export interface UseEventHandlersOptions {
  stopPropagation?: boolean;
}

export function useEventHandlers(
  handlers: EventHandlers,
  elementRef: React.RefObject<HTMLElement | null>,
  options: UseEventHandlersOptions = { stopPropagation: true }
) {
  // Use ref to avoid re-registering listeners on every handler change
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const stopRef = useRef(options.stopPropagation);
  stopRef.current = options.stopPropagation;

  /**
   * The element the listeners are on, and the listeners. The listeners stay ON THE GRID ELEMENT, in the target /
   * bubble phase — exactly where they always were: `stopPropagation` still keeps an inner grid's events from an outer
   * grid's host, and the grid's own listeners (this same hook, on the same element) run in the same order as before.
   */
  const boundRef = useRef<{ element: HTMLElement; names: string; listeners: Array<[string, EventListener]> } | null>(null);

  // Stable for the hook's life: reads everything from refs.
  const syncRef = useRef<() => void>(() => {});
  syncRef.current = () => {
    const element = elementRef?.current ?? null;
    const names = Object.keys(handlersRef.current);
    const signature = names.join('|');
    const bound = boundRef.current;
    if (bound && bound.element === element && bound.names === signature) return;
    if (bound) {
      for (const [eventName, listener] of bound.listeners) bound.element.removeEventListener(eventName, listener);
      boundRef.current = null;
    }
    if (!element) return;
    const listeners: Array<[string, EventListener]> = [];
    for (const eventName of names as Array<keyof TableEventPayloads>) {
      const listener = (event: Event) => {
        const handler = handlersRef.current[eventName];
        if (!handler) return;

        if (stopRef.current) {
          event.stopPropagation();
          event.preventDefault();
        }
        handler((event as CustomEvent).detail, event);
      };
      element.addEventListener(eventName, listener);
      listeners.push([eventName, listener]);
    }
    boundRef.current = { element, names: signature, listeners };
  };

  // Follow the element on every render of the hook's owner (the common case: the ref is filled after the first render).
  useEffect(() => {
    syncRef.current();
  });

  /**
   * …and at the moment an event is dispatched (0.14.34). The grid can be REPLACED without the owner rendering again —
   * a host that keys the table on its rows (`key={rows.length}`) remounts it, `elementRef.current` points at the new
   * element, and the listeners stayed on the old one: a typed cell's CELL_EDIT_SAVE reached nobody and the host saved
   * the old value (gt-fms offer pricing grid, pc2 w1:p3). A capture-phase listener on the document runs before the
   * event reaches its target, so it moves the listeners onto the current element in time — per the DOM spec a node's
   * listeners are read when the event gets there. It only re-binds; it never handles or stops the event itself.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const names = Object.keys(handlersRef.current);
    const onCapture = () => syncRef.current();
    for (const eventName of names) document.addEventListener(eventName, onCapture, true);
    return () => {
      for (const eventName of names) document.removeEventListener(eventName, onCapture, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(handlers).join('|')]);

  // Unmount: take the listeners off whatever element they are on.
  useEffect(() => () => {
    const bound = boundRef.current;
    if (!bound) return;
    for (const [eventName, listener] of bound.listeners) bound.element.removeEventListener(eventName, listener);
    boundRef.current = null;
  }, []);
}
