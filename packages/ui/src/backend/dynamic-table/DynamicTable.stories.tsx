// DynamicTable.stories.tsx

import React, { useState, useCallback, useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import DynamicTable from './DynamicTable';
import { TableEvents } from './types/index';
import { dispatch, useEventHandlers } from './events/events';
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context';
import type {
    ContextMenuAction,
    ColumnDef,
    SavedFilter,
    PerspectiveConfig,
} from './types/index';

const meta: Meta<typeof DynamicTable> = {
    title: 'Components/DynamicTable',
    component: DynamicTable,
    parameters: {
        layout: 'padded',
    },
    // Some sub-components (e.g. the Configure-View sheet) call `useT()`, which
    // requires an I18nProvider. Storybook has no app shell, so supply one here.
    decorators: [
        (Story) => (
            <I18nProvider locale="en" dict={{}}>
                <Story />
            </I18nProvider>
        ),
    ],
};

export default meta;

// ============================================================================
// DATA GENERATOR
// ============================================================================

const generateData = (count: number) => {
    const departments = ['Engineering', 'Marketing', 'Sales', 'HR', 'Finance', 'Operations', 'Legal'];
    const statuses = ['Active', 'Inactive', 'Pending', 'On Leave'];
    const countries = ['USA', 'UK', 'Canada', 'Germany', 'France', 'Japan', 'Australia'];
    const roles = ['Junior', 'Mid', 'Senior', 'Lead', 'Manager', 'Director'];

    return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        name: `Person ${i + 1}`,
        email: `person${i + 1}@company.com`,
        age: 22 + Math.floor(Math.random() * 40),
        department: departments[Math.floor(Math.random() * departments.length)],
        country: countries[Math.floor(Math.random() * countries.length)],
        role: roles[Math.floor(Math.random() * roles.length)],
        startDate: `202${Math.floor(Math.random() * 5)}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`,
        salary: 45000 + Math.floor(Math.random() * 80000),
        active: Math.random() > 0.25,
        status: statuses[Math.floor(Math.random() * statuses.length)],
    }));
};

// ============================================================================
// CONTEXT MENU ACTIONS
// ============================================================================

const getColumnActions = (column: ColumnDef, colIndex: number): ContextMenuAction[] => [
    { id: 'sort-asc', label: 'Sort Ascending', icon: '↑' },
    { id: 'sort-desc', label: 'Sort Descending', icon: '↓' },
    { id: 'separator-1', label: '', separator: true },
    { id: 'hide', label: 'Hide Column', icon: '👁️' },
    { id: 'freeze', label: 'Freeze Column', icon: '📌' },
];

const getRowActions = (rowData: any, rowIndex: number): ContextMenuAction[] => [
    { id: 'edit', label: 'Edit Row', icon: '✏️' },
    { id: 'duplicate', label: 'Duplicate', icon: '📋' },
    { id: 'separator-1', label: '', separator: true },
    { id: 'delete', label: 'Delete Row', icon: '🗑️' },
];

// ============================================================================
// STORY 2: V2 APPEARANCE (Figma parity — phase 1 re-skin)
// ============================================================================
// Exercises appearance="v2": maps --hot-* onto the -v2 design tokens (navy/teal,
// Geist). Phase 1 is re-skin only — status badges / mono cells / left accent
// rail / density land in later phases, so badge columns here still render as
// plain text. Compare against .ai/figma-snapshots/data-table/ANALYSIS.md.

// v2 column set — exercises the phase-2 cell types: mono (id/email/date),
// right-aligned numbers, status badges (department/status), and em-dash for
// the blanked-out cells below.
const getV2Columns = (): ColumnDef[] => [
    { data: 'name', width: 180, title: 'Name' },
    { data: 'email', width: 220, title: 'Email', mono: true },
    {
        data: 'department', width: 130, title: 'Department', badge: true,
        badgeMap: { Engineering: 'info', Marketing: 'purple', Sales: 'teal', HR: 'orange', Finance: 'primary', Operations: 'sky', Legal: 'rose' },
    },
    // Dropdown cell — the value is picked from a fixed list of options.
    {
        data: 'country', width: 150, title: 'Country', type: 'dropdown',
        source: ['USA', 'UK', 'Canada', 'Germany', 'France', 'Japan', 'Australia'],
    },
    { data: 'startDate', width: 120, title: 'Start Date', type: 'date', mono: true },
    { data: 'salary', width: 130, title: 'Salary', type: 'numeric', mono: true, align: 'right' },
    {
        data: 'status', width: 120, title: 'Status', badge: true,
        badgeMap: { Active: 'success', Inactive: 'neutral', Pending: 'warning', 'On Leave': 'info' },
    },
];

// Saved views (perspectives) — exercises the top-tabs perspective bar.
// Polish copy mirrors the Figma frame ("Widok domyślny", "Dodaj widok +").
const v2Columns = getV2Columns().map((c) => c.data);
const getV2Perspectives = (): PerspectiveConfig[] => [
    {
        id: 'default',
        name: 'Widok domyślny',
        columns: { visible: v2Columns, hidden: [] },
        filters: [],
        sorting: [],
    },
    {
        id: 'active-only',
        name: 'Tylko aktywni',
        color: 'green',
        columns: {
            visible: ['name', 'department', 'salary', 'status'],
            hidden: ['email', 'country', 'startDate'],
        },
        filters: [{ id: 'f-status', field: 'status', operator: 'equals', values: ['Active'] }],
        sorting: [],
    },
    {
        id: 'by-department',
        name: 'Wg działu',
        color: 'blue',
        columns: {
            visible: ['name', 'department', 'country', 'salary', 'status'],
            hidden: ['email', 'startDate'],
        },
        filters: [],
        sorting: [{ id: 's-dept', field: 'department', direction: 'asc' }],
    },
];

const V2Demo = () => {
    const tableRef = useRef<HTMLDivElement>(null);
    // Blank a few cells to show the em-dash empty treatment.
    const [allData, setAllData] = useState(() => generateData(50).map((r) => ({
        ...r,
        country: r.id % 4 === 0 ? '' : r.country,
        email: r.id % 5 === 0 ? '' : r.email,
    })));
    const [currentPage, setCurrentPage] = useState(1);
    const [limit, setLimit] = useState(25);

    // Perspectives (saved views) — controlled via the PERSPECTIVE_* events.
    const [perspectives, setPerspectives] = useState<PerspectiveConfig[]>(() => getV2Perspectives());
    const [activePerspectiveId, setActivePerspectiveId] = useState<string | null>('default');

    useEventHandlers({
        // Inline cell edit (e.g. the Country dropdown) — persist the picked
        // value back into the data set and acknowledge the save.
        [TableEvents.CELL_EDIT_SAVE]: (payload) => {
            const absolute = (currentPage - 1) * limit + payload.rowIndex;
            setAllData((prev) =>
                prev.map((r, i) => (i === absolute ? { ...r, [payload.prop]: payload.newValue } : r))
            );
            if (tableRef.current) {
                dispatch(tableRef.current, TableEvents.CELL_SAVE_SUCCESS, {
                    rowIndex: payload.rowIndex,
                    colIndex: payload.colIndex,
                });
            }
        },
        [TableEvents.PERSPECTIVE_SELECT]: (payload) => {
            setActivePerspectiveId(payload.id);
        },
        [TableEvents.PERSPECTIVE_RENAME]: (payload) => {
            setPerspectives((prev) =>
                prev.map((p) => (p.id === payload.id ? { ...p, name: payload.newName } : p))
            );
        },
        [TableEvents.PERSPECTIVE_DELETE]: (payload) => {
            setPerspectives((prev) => prev.filter((p) => p.id !== payload.id));
            setActivePerspectiveId((cur) => (cur === payload.id ? null : cur));
        },
    }, tableRef);

    const totalPages = Math.ceil(allData.length / limit);
    const startIndex = (currentPage - 1) * limit;
    const data = allData.slice(startIndex, startIndex + limit);

    return (
        <DynamicTable
            tableRef={tableRef}
            striped
            data={data}
            columns={getV2Columns()}
            colHeaders
            rowHeaders
            height={500}
            tableName="Folders"
            idColumnName="id"
            columnActions={getColumnActions}
            rowActions={getRowActions}
            savedPerspectives={perspectives}
            activePerspectiveId={activePerspectiveId}
            pagination={{
                currentPage,
                totalPages,
                limit,
                total: allData.length,
                limitOptions: [10, 25, 50, 100],
                onPageChange: (p) => setCurrentPage(Math.max(1, Math.min(p, totalPages))),
                onLimitChange: (l) => { setLimit(l); setCurrentPage(1); },
            }}
        />
    );
};

export const DynamicTableStory: StoryObj = {
    name: 'DynamicTable',
    parameters: { backgrounds: { default: 'figma-surface' } },
    render: () => <V2Demo />,
};

// ============================================================================
// HEDGE-119 — failed load vs empty table
// ============================================================================
//
// The two stories below carry IDENTICAL empty data. Only `loadError` differs.
// Before this fix both rendered the same thing — an Inbox icon and "Nothing
// here yet" — which is how a 500 on the invoice queue reached an accountant as
// "there are no invoices to work on".

const hedge119Columns: ColumnDef[] = [
    { data: 'invoiceNumber', title: 'Invoice no.' },
    { data: 'counterparty', title: 'Counterparty' },
    { data: 'grossAmount', title: 'Gross', type: 'numeric' },
];

/** The server truthfully returned zero rows. */
export const EmptyBecauseThereIsNothing: StoryObj = {
    render: () => {
        const tableRef = useRef<HTMLDivElement | null>(null);
        return (
            <DynamicTable
                data={[]}
                columns={hedge119Columns}
                tableRef={tableRef}
                tableName="Invoices"
                height={420}
            />
        );
    },
};

/** The list request FAILED. Same empty data, different truth. */
export const EmptyBecauseTheRequestFailed: StoryObj = {
    render: () => {
        const tableRef = useRef<HTMLDivElement | null>(null);
        return (
            <DynamicTable
                data={[]}
                columns={hedge119Columns}
                tableRef={tableRef}
                tableName="Invoices"
                height={420}
                loadError
                onRetryLoad={() => window.alert('retry fired')}
            />
        );
    },
};
