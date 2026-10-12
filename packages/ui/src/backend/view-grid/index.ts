/**
 * The view grid — ONE configurator for every composable screen: the contractor
 * page (kartoteka), the Pulpit, and the DynamicTable split view. Sections of
 * 1–6 slots, widgets as tiles, "Dodaj sekcję", Anuluj · Przywróć · Zastosuj.
 *
 * Moved here from `@freighttech/split-view` (which re-exports it) so the split
 * view in this package can use the same editor instead of its own drawer.
 */
export * from './model'
export { gridFromSplit, splitFromGrid, ROOT_SECTION_ID } from './split-layout'
export type { PaneWidget } from './split-layout'
export { GridEditor, GridCustomizeSheet, gridBtnIcon, gridBtnPrimary, gridBtnSecondary, gridBtnText } from './GridEditor'
export type { GridEditorProps } from './GridEditor'
export { WidgetPicker } from './WidgetPicker'
export type { WidgetOption } from './WidgetPicker'
export { AddSection, ColumnChoice } from './sections'
export { ResizeHandles, SizeBadge, beginResize } from './resize'
export type { ResizeHandlesProps } from './resize'
export { cn as gridCn } from './cn'
