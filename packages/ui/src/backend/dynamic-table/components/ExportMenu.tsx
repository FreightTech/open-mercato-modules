'use client';

import React from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { Popover, PopoverContent, PopoverTrigger } from '../../../primitives/popover';
import type { ExportFormat } from '../utils/exportTable';

export interface ExportMenuProps {
  /** Invoked with the chosen format when a menu item is clicked. */
  onExport: (format: ExportFormat) => void;
  /**
   * Visual style of the trigger:
   * - 'toolbar': icon-only button matching the toolbar action buttons.
   * - 'bulk': labelled button matching the grouped-actions bar.
   */
  variant?: 'toolbar' | 'bulk';
  disabled?: boolean;
}

/**
 * Export control: a trigger button that opens a small CSV / Excel menu. Shared
 * between the main toolbar (persistent — exports the current page) and the
 * grouped-actions bar (exports the selected rows). Both call `onExport`.
 */
const ExportMenu: React.FC<ExportMenuProps> = ({ onExport, variant = 'toolbar', disabled }) => {
  const t = useT();
  const [open, setOpen] = React.useState(false);

  const handlePick = (format: ExportFormat) => {
    setOpen(false);
    onExport(format);
  };

  const trigger =
    variant === 'bulk' ? (
      <button type="button" className="hot-bulk-bar-action" disabled={disabled}>
        <Download size={12} aria-hidden="true" />
        <span>{t('dynamicTable.export.button', 'Export')}</span>
      </button>
    ) : (
      <button
        type="button"
        className="fullscreen-toggle-btn"
        title={t('dynamicTable.export.button', 'Export')}
        aria-label={t('dynamicTable.export.button', 'Export')}
        disabled={disabled}
      >
        <Download className="w-4 h-4" />
      </button>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/*
        `hot-export-menu` is the hook ContextMenu.css uses to give this
        surface the same 12px corner, `surface-container` fill,
        `outline-variant` edge and level-2 elevation every other menu in the
        grid has. It is needed because this popover is portalled OUTSIDE
        `.hot-appearance-v2`: the Popover primitive's own `bg-popover` /
        `rounded-md` / `shadow-md` come from the base shadcn token set, so
        without it the export menu was the one dropdown that missed every
        grid retint.
      */}
      <PopoverContent align="end" className="hot-export-menu min-w-[180px] p-1">
        <button
          type="button"
          className="hot-export-menu-item"
          onClick={() => handlePick('csv')}
        >
          <FileText size={14} aria-hidden="true" />
          <span>{t('dynamicTable.export.csv', 'Export to CSV')}</span>
        </button>
        <button
          type="button"
          className="hot-export-menu-item"
          onClick={() => handlePick('xlsx')}
        >
          <FileSpreadsheet size={14} aria-hidden="true" />
          <span>{t('dynamicTable.export.excel', 'Export to Excel')}</span>
        </button>
      </PopoverContent>
    </Popover>
  );
};

ExportMenu.displayName = 'ExportMenu';

export default ExportMenu;
