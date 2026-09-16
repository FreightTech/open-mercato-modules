import React, { useCallback, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { ColumnDef } from '../types/index';
import { Checkbox } from '../../../primitives-v2';

interface ConfigureViewFieldsProps {
  columns: ColumnDef[];
  visibleColumns: string[];
  hiddenColumns: string[];
  onColumnVisibilityChange: (visible: string[], hidden: string[]) => void;
}

const ConfigureViewFields: React.FC<ConfigureViewFieldsProps> = ({
  columns,
  visibleColumns,
  hiddenColumns,
  onColumnVisibilityChange,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  // Drag-to-reorder state. Reordering is constrained to within the same
  // visibility group (visible↔visible or hidden↔hidden) so dropping a field
  // never silently changes its shown/hidden state.
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);

  const allColumnKeys = [...visibleColumns, ...hiddenColumns];

  const filteredKeys = allColumnKeys.filter(key => {
    const col = columns.find(c => c.data === key);
    const title = (col?.title || key).toLowerCase();
    return title.includes(searchQuery.toLowerCase());
  });

  const toggleColumn = useCallback((key: string) => {
    const isVisible = visibleColumns.includes(key);
    if (isVisible) {
      const newVisible = visibleColumns.filter(k => k !== key);
      const newHidden = [...hiddenColumns, key];
      onColumnVisibilityChange(newVisible, newHidden);
    } else {
      const newHidden = hiddenColumns.filter(k => k !== key);
      const newVisible = [...visibleColumns, key];
      onColumnVisibilityChange(newVisible, newHidden);
    }
  }, [visibleColumns, hiddenColumns, onColumnVisibilityChange]);

  const showAll = useCallback(() => {
    onColumnVisibilityChange([...visibleColumns, ...hiddenColumns], []);
  }, [visibleColumns, hiddenColumns, onColumnVisibilityChange]);

  const hideAll = useCallback(() => {
    onColumnVisibilityChange([], [...visibleColumns, ...hiddenColumns]);
  }, [visibleColumns, hiddenColumns, onColumnVisibilityChange]);

  const getColumnTitle = (key: string) => {
    const col = columns.find(c => c.data === key);
    return col?.title || key;
  };

  // --- Drag-to-reorder handlers ---------------------------------------------

  const handleDragStart = (e: React.DragEvent, key: string) => {
    setDraggedItem(key);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
  };

  const handleDragOver = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    const draggedIsVisible = draggedItem ? visibleColumns.includes(draggedItem) : false;
    const targetIsVisible = visibleColumns.includes(key);
    // Cross-group drops are not allowed — signal "no drop" and clear the marker.
    if (!draggedItem || draggedIsVisible !== targetIsVisible) {
      e.dataTransfer.dropEffect = 'none';
      setDragOverItem(null);
      return;
    }
    e.dataTransfer.dropEffect = 'move';
    if (key !== draggedItem) setDragOverItem(key);
  };

  const handleDragLeave = () => {
    setDragOverItem(null);
  };

  const reorderWithinGroup = (group: string[], dragged: string, target: string) => {
    const next = [...group];
    const from = next.indexOf(dragged);
    const to = next.indexOf(target);
    if (from === -1 || to === -1) return group;
    next.splice(from, 1);
    next.splice(to, 0, dragged);
    return next;
  };

  const handleDrop = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === targetKey) {
      setDraggedItem(null);
      setDragOverItem(null);
      return;
    }
    const draggedIsVisible = visibleColumns.includes(draggedItem);
    const targetIsVisible = visibleColumns.includes(targetKey);
    // Only reorder within the same visibility group.
    if (draggedIsVisible === targetIsVisible) {
      if (draggedIsVisible) {
        onColumnVisibilityChange(
          reorderWithinGroup(visibleColumns, draggedItem, targetKey),
          hiddenColumns,
        );
      } else {
        onColumnVisibilityChange(
          visibleColumns,
          reorderWithinGroup(hiddenColumns, draggedItem, targetKey),
        );
      }
    }
    setDraggedItem(null);
    setDragOverItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverItem(null);
  };

  const getItemClassName = (key: string) => {
    const classes = ['hot-config-fields-item'];
    if (draggedItem === key) classes.push('is-dragging');
    if (dragOverItem === key) classes.push('is-drag-over');
    return classes.join(' ');
  };

  return (
    <div className="hot-config-fields">
      <div className="hot-config-fields-toolbar">
        <span className="hot-config-fields-toolbar-spacer" />
        <button onClick={showAll} className="hot-config-fields-bulk-btn">
          Pokaż wszystkie
        </button>
        <button onClick={hideAll} className="hot-config-fields-bulk-btn">
          Ukryj wszystkie
        </button>
      </div>
      <div className="hot-config-fields-list">
        {filteredKeys.map(key => {
          const isVisible = visibleColumns.includes(key);
          return (
            <label
              key={key}
              className={getItemClassName(key)}
              draggable
              onDragStart={(e) => handleDragStart(e, key)}
              onDragOver={(e) => handleDragOver(e, key)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, key)}
              onDragEnd={handleDragEnd}
            >
              <GripVertical className="w-3.5 h-3.5 hot-config-fields-grip" />
              <Checkbox checked={isVisible} onChange={() => toggleColumn(key)} />
              <span className={`hot-config-fields-label ${!isVisible ? 'is-hidden' : ''}`}>
                {getColumnTitle(key)}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default ConfigureViewFields;
