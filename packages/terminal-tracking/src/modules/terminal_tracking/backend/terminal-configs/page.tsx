'use client'

import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { Page, PageBody } from '@freighttech/ui/backend/Page'
import { BooleanIcon } from '@freighttech/ui/backend/ValueIcons'
import { DynamicTable, TableSkeleton, useDynamicTablePage } from '@freighttech/ui/backend/dynamic-table'
import type { ColumnDef } from '@freighttech/ui/backend/dynamic-table'
import { RowActions, type RowActionItem } from '@freighttech/ui/backend/RowActions'
import { apiCallOrThrow } from '@freighttech/ui/backend/utils/apiCall'
import { flash } from '@freighttech/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@freighttech/ui/primitives/dialog'
import { Button } from '@freighttech/ui/primitives/button'
import { Input } from '@freighttech/ui/primitives/input'
import { Label } from '@freighttech/ui/primitives/label'
import { Checkbox } from '@freighttech/ui/primitives/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@freighttech/ui/primitives/card'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'

type AuthType = 'oauth2_password' | 'oauth2_client_credentials' | 'gct_token' | 'basic'

type ConfigRow = {
  id: string
  terminalCode: string
  adapterType: string
  displayName: string
  baseUrl: string
  authType: string
  unlocode: string | null
  isActive: boolean
}

function mapItem(item: Record<string, unknown>): ConfigRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  return {
    id,
    terminalCode: (item.terminalCode as string) ?? '',
    adapterType: (item.adapterType as string) ?? '',
    displayName: (item.displayName as string) ?? '',
    baseUrl: (item.baseUrl as string) ?? '',
    authType: (item.authType as string) ?? '',
    unlocode: (item.unlocode as string) ?? null,
    isActive: item.isActive === true,
  }
}

type FormState = {
  terminalCode: string
  adapterType: string
  displayName: string
  baseUrl: string
  proxyUrl: string
  authType: AuthType
  tokenUrl: string
  scope: string
  clientId: string
  credentials: Record<string, string>
  unlocode: string
  bicCodes: string
  smdgCodes: string
  nameAliases: string
  rateLimitRequests: number
  rateLimitWindowSeconds: number
  isActive: boolean
}

// ── Adapter specs ───────────────────────────────────────────────────────────
// Each adapter maps to one real terminal and one auth type, so selecting the
// adapter drives the auth type, the credential fields, and the identifier
// defaults. Values are sourced from the N4 adapter spec + terminal-tracking
// README (see `.ai/specs/2026-06-08-n4-terminal-tracking-adapter.md` and
// `packages/terminal-tracking/README.md`). GCT's base URL is intentionally left
// blank — no real value is published in the repo. Likewise the OAuth account
// identity (client ID and scope) for each terminal is integrator-specific and
// left blank here: the operator fills it in when configuring the terminal.
type CredField = { key: string; label: string; secret?: boolean; placeholder?: string }

type AdapterSpec = {
  value: string
  label: string
  authType: AuthType
  /** Show the OAuth block (token URL / client ID / scope). */
  showOAuth: boolean
  defaults: Partial<FormState>
}

const ADAPTER_SPECS: Record<string, AdapterSpec> = {
  n4: {
    value: 'n4',
    label: 'DCT (Gdańsk)',
    authType: 'oauth2_password',
    showOAuth: true,
    defaults: {
      terminalCode: 'dct',
      displayName: 'DCT Gdańsk (Baltic Hub)',
      baseUrl: 'https://api2.baltichub.com/V1/',
      tokenUrl:
        'https://bhctapicustomers.b2clogin.com/bhctapicustomers.onmicrosoft.com/oauth2/v2.0/token?p=b2c_1_ropc_login',
      // Integrator-specific — configured per deployment, not published here.
      clientId: '',
      scope: '',
      unlocode: 'PLGDN',
      smdgCodes: 'PLGDNDCT',
      bicCodes: 'PLGDNSKZB',
      nameAliases: 'Baltic Hub, DCT Gdańsk',
      rateLimitRequests: 200,
      rateLimitWindowSeconds: 60,
    },
  },
  bct: {
    value: 'bct',
    label: 'BCT / INCOS (Gdynia)',
    authType: 'basic',
    showOAuth: false,
    defaults: {
      terminalCode: 'bct',
      displayName: 'BCT Gdynia (INCOS)',
      baseUrl: 'https://incos.pl',
      tokenUrl: '',
      clientId: '',
      scope: '',
      unlocode: 'PLGDY',
      smdgCodes: 'PLGDYPLBCT',
      bicCodes: 'PLGDYBCTA',
      nameAliases: 'BCT, Bałtycki Terminal Kontenerowy',
      // INCOS caps at 10 000 requests/day.
      rateLimitRequests: 10000,
      rateLimitWindowSeconds: 86400,
    },
  },
  gct: {
    value: 'gct',
    label: 'GCT (Gdynia)',
    authType: 'gct_token',
    showOAuth: false,
    defaults: {
      terminalCode: 'gct',
      displayName: 'GCT Gdynia',
      baseUrl: '',
      tokenUrl: '',
      clientId: '',
      scope: '',
      unlocode: 'PLGDY',
      smdgCodes: 'PLGDYPLGCT',
      bicCodes: 'PLGDYEOOJ',
      nameAliases: 'GCT',
      rateLimitRequests: 200,
      rateLimitWindowSeconds: 60,
    },
  },
}

const ADAPTER_ORDER = ['n4', 'bct', 'gct']

/** Credential inputs for a given adapter + auth type (structured, no raw JSON). */
function credentialFieldsFor(adapterType: string, authType: AuthType): CredField[] {
  if (adapterType === 'gct') {
    return [
      { key: 'companyCode', label: 'Company code', placeholder: 'ACME' },
      { key: 'loginName', label: 'Login' },
      { key: 'totpSecret', label: 'Twój sekret 2FA', secret: true, placeholder: 'JBSWY3DPEHPK3PXP' },
    ]
  }
  if (adapterType === 'n4' && authType === 'oauth2_client_credentials') {
    return [{ key: 'clientSecret', label: 'Client secret', secret: true }]
  }
  // n4 (ROPC) and bct (basic) both use username/password.
  return [
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', secret: true },
  ]
}

const baseForm: FormState = {
  terminalCode: '',
  adapterType: 'n4',
  displayName: '',
  baseUrl: '',
  proxyUrl: '',
  authType: 'oauth2_password',
  tokenUrl: '',
  scope: '',
  clientId: '',
  credentials: {},
  unlocode: '',
  bicCodes: '',
  smdgCodes: '',
  nameAliases: '',
  rateLimitRequests: 200,
  rateLimitWindowSeconds: 60,
  isActive: true,
}

/** Apply an adapter's defaults onto a form (used on create + adapter switch). */
function applyAdapterDefaults(
  adapterType: string,
  prev: FormState,
  opts: { includeTerminalCode: boolean },
): FormState {
  const spec = ADAPTER_SPECS[adapterType] ?? ADAPTER_SPECS.n4
  const d = spec.defaults
  return {
    ...prev,
    adapterType,
    authType: spec.authType,
    displayName: d.displayName ?? '',
    baseUrl: d.baseUrl ?? '',
    tokenUrl: d.tokenUrl ?? '',
    scope: d.scope ?? '',
    clientId: d.clientId ?? '',
    unlocode: d.unlocode ?? '',
    smdgCodes: d.smdgCodes ?? '',
    bicCodes: d.bicCodes ?? '',
    nameAliases: d.nameAliases ?? '',
    rateLimitRequests: d.rateLimitRequests ?? 200,
    rateLimitWindowSeconds: d.rateLimitWindowSeconds ?? 60,
    credentials: {},
    ...(opts.includeTerminalCode ? { terminalCode: d.terminalCode ?? '' } : {}),
  }
}

const emptyForm: FormState = applyAdapterDefaults('n4', baseForm, { includeTerminalCode: true })

const API = '/api/terminal_tracking/terminal-configs'

function csv(value: string): string[] | undefined {
  const arr = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return arr.length ? arr : undefined
}

export default function TerminalConfigsPage() {
  const t = useT()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const isEdit = editingId !== null

  const spec = ADAPTER_SPECS[form.adapterType] ?? ADAPTER_SPECS.n4
  const credFields = credentialFieldsFor(form.adapterType, form.authType)

  const setField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((p) => ({ ...p, [key]: value })),
    [],
  )
  const setCredential = useCallback(
    (key: string, value: string) => setForm((p) => ({ ...p, credentials: { ...p.credentials, [key]: value } })),
    [],
  )
  const changeAdapter = useCallback(
    (adapterType: string) =>
      setForm((p) => applyAdapterDefaults(adapterType, p, { includeTerminalCode: !isEdit })),
    [isEdit],
  )

  const columns = useMemo<ColumnDef[]>(
    () => [
      {
        data: 'displayName',
        title: t('terminal_tracking.terminal_config.displayName', 'Name'),
        width: 180,
        readOnly: true,
        renderer: (v: unknown) => <span className="font-medium">{String(v ?? '')}</span>,
      },
      {
        data: 'terminalCode',
        title: t('terminal_tracking.terminal_config.terminalCode', 'Terminal code'),
        width: 120,
        readOnly: true,
      },
      {
        data: 'adapterType',
        title: t('terminal_tracking.terminal_config.adapterType', 'Adapter'),
        width: 130,
        readOnly: true,
        renderer: (v: unknown) => <span className="text-sm">{ADAPTER_SPECS[String(v)]?.label ?? String(v ?? '')}</span>,
      },
      {
        data: 'unlocode',
        title: t('terminal_tracking.terminal_config.unlocode', 'UN/LOCODE'),
        width: 110,
        readOnly: true,
        renderer: (v: unknown) => <span className="text-sm">{String(v || '-')}</span>,
      },
      {
        data: 'isActive',
        title: t('terminal_tracking.terminal_config.isActive', 'Active'),
        width: 80,
        readOnly: true,
        renderer: (v: unknown) => <BooleanIcon value={v === true || v === 'true'} />,
      },
    ],
    [t],
  )

  const openCreate = useCallback(() => {
    setEditingId(null)
    setForm(emptyForm)
    setTestResult(null)
    setDialogOpen(true)
  }, [])

  const addButton = useMemo(
    () => (
      <Button size="sm" onClick={openCreate}>
        {t('terminal_tracking.terminal_config.create', 'Add Terminal')}
      </Button>
    ),
    [openCreate, t],
  )

  const table = useDynamicTablePage<ConfigRow>({
    source: API,
    columns,
    tableName: t('terminal_tracking.terminal_config.title', 'Terminals'),
    defaultPageSize: 20,
    mapApiItem: mapItem,
    cellEdit: false,
    tableProps: {
      height: '100%',
      uiConfig: {
        readOnlyStyle: 'normal',
        hideAddRowButton: true,
        topBarEnd: addButton,
      },
    },
  })

  const openEdit = useCallback(
    (id: string) => {
      const items = (table.query.data as { items?: Record<string, unknown>[] })?.items ?? []
      const raw = items.find((r) => r.id === id)
      if (!raw) return
      const adapterType = (raw.adapterType as string) ?? 'n4'
      const rowAuthType = (raw.authType as AuthType) ?? ADAPTER_SPECS[adapterType]?.authType ?? 'oauth2_password'
      setEditingId(id)
      setTestResult(null)
      setForm({
        ...emptyForm,
        terminalCode: (raw.terminalCode as string) ?? '',
        adapterType,
        // Preserve the row's stored auth type (e.g. a legacy n4 client-credentials config).
        authType: rowAuthType,
        displayName: (raw.displayName as string) ?? '',
        baseUrl: (raw.baseUrl as string) ?? '',
        proxyUrl: (raw.proxyUrl as string) ?? '',
        tokenUrl: (raw.tokenUrl as string) ?? '',
        scope: (raw.scope as string) ?? '',
        clientId: (raw.clientId as string) ?? '',
        credentials: {}, // secrets are never returned; blank = keep unchanged
        unlocode: (raw.unlocode as string) ?? '',
        bicCodes: Array.isArray(raw.bicCodes) ? (raw.bicCodes as string[]).join(', ') : '',
        smdgCodes: Array.isArray(raw.smdgCodes) ? (raw.smdgCodes as string[]).join(', ') : '',
        nameAliases: Array.isArray(raw.nameAliases) ? (raw.nameAliases as string[]).join(', ') : '',
        rateLimitRequests: typeof raw.rateLimitRequests === 'number' ? raw.rateLimitRequests : 200,
        rateLimitWindowSeconds: typeof raw.rateLimitWindowSeconds === 'number' ? raw.rateLimitWindowSeconds : 60,
        isActive: raw.isActive === true,
      })
      setDialogOpen(true)
    },
    [table.query.data],
  )

  const buildBody = useCallback((): Record<string, unknown> | null => {
    // Assemble authConfig from the structured credential fields.
    const fields = credentialFieldsFor(form.adapterType, form.authType)
    const filled = fields.filter((f) => (form.credentials[f.key] ?? '').trim() !== '')
    let authConfig: Record<string, string> | undefined
    if (filled.length > 0) {
      if (filled.length !== fields.length) {
        flash(
          t('terminal_tracking.terminal_config.validation.allCredentials', 'Enter all credential fields'),
          'error',
        )
        return null
      }
      authConfig = Object.fromEntries(fields.map((f) => [f.key, form.credentials[f.key].trim()]))
    } else if (!isEdit) {
      flash(
        t('terminal_tracking.terminal_config.validation.credentialsRequired', 'Credentials are required'),
        'error',
      )
      return null
    }
    // On edit with no credentials entered, authConfig stays undefined → unchanged.

    const showOAuth = ADAPTER_SPECS[form.adapterType]?.showOAuth ?? false
    const body: Record<string, unknown> = {
      adapterType: form.adapterType.trim() || 'n4',
      displayName: form.displayName.trim(),
      baseUrl: form.baseUrl.trim(),
      proxyUrl: form.proxyUrl.trim() || null,
      authType: form.authType,
      tokenUrl: showOAuth ? form.tokenUrl.trim() || null : null,
      scope: showOAuth ? form.scope.trim() || null : null,
      clientId: showOAuth ? form.clientId.trim() || null : null,
      unlocode: form.unlocode.trim() || null,
      bicCodes: csv(form.bicCodes) ?? null,
      smdgCodes: csv(form.smdgCodes) ?? null,
      nameAliases: csv(form.nameAliases) ?? null,
      rateLimitRequests: form.rateLimitRequests,
      rateLimitWindowSeconds: form.rateLimitWindowSeconds,
      isActive: form.isActive,
    }
    if (authConfig !== undefined) body.authConfig = authConfig
    if (!isEdit) body.terminalCode = form.terminalCode.trim()
    else body.id = editingId
    return body
  }, [form, isEdit, editingId, t])

  const handleSubmit = useCallback(async () => {
    if (submitting) return
    if (!isEdit && !form.terminalCode.trim()) {
      flash(t('terminal_tracking.terminal_config.validation.codeRequired', 'Terminal code is required'), 'error')
      return
    }
    if (!form.displayName.trim() || !form.baseUrl.trim()) {
      flash(t('terminal_tracking.terminal_config.validation.required', 'Name and base URL are required'), 'error')
      return
    }
    const body = buildBody()
    if (!body) return
    setSubmitting(true)
    try {
      await apiCallOrThrow(API, { method: isEdit ? 'PUT' : 'POST', body: JSON.stringify(body) })
      flash(
        isEdit
          ? t('terminal_tracking.terminal_config.flash.updated', 'Terminal updated')
          : t('terminal_tracking.terminal_config.flash.created', 'Terminal created'),
        'success',
      )
      setDialogOpen(false)
      table.refresh()
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Failed to save terminal', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, isEdit, form, buildBody, table, t])

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm(t('terminal_tracking.terminal_config.confirmDelete', 'Delete this terminal?'))) return
      try {
        await apiCallOrThrow(API, { method: 'DELETE', body: JSON.stringify({ id }) })
        flash(t('terminal_tracking.terminal_config.flash.deleted', 'Terminal deleted'), 'success')
        table.refresh()
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Failed to delete terminal', 'error')
      }
    },
    [table, t],
  )

  const handleTest = useCallback(
    async (id: string) => {
      setTestResult(null)
      try {
        const { result } = await apiCallOrThrow<{ success: boolean; message: string }>(
          `${API}/test`,
          { method: 'POST', body: JSON.stringify({ id }) },
        )
        flash(
          result?.success ? t('terminal_tracking.terminal_config.flash.testOk', 'Connection OK') : (result?.message ?? 'Connection failed'),
          result?.success ? 'success' : 'error',
        )
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Connection test failed', 'error')
      }
    },
    [t],
  )

  const handleDialogKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  const actionsRenderer = useCallback(
    (rowData: { id: string }) => {
      if (!rowData?.id) return null
      const items: RowActionItem[] = [
        { label: t('terminal_tracking.terminal_config.actions.test', 'Test connection'), onSelect: () => handleTest(rowData.id) },
        { label: t('common.edit', 'Edit'), onSelect: () => openEdit(rowData.id) },
        { label: t('common.delete', 'Delete'), onSelect: () => handleDelete(rowData.id), destructive: true },
      ]
      return <RowActions items={items} />
    },
    [t, handleTest, openEdit, handleDelete],
  )

  if (table.isLoading) {
    return (
      <Page>
        <PageBody className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('terminal_tracking.terminal_config.title', 'Terminals')}</CardTitle>
            </CardHeader>
            <CardContent>
              <TableSkeleton rows={5} columns={5} />
            </CardContent>
          </Card>
        </PageBody>
      </Page>
    )
  }

  const credPlaceholder = (f: CredField) =>
    isEdit && f.secret ? '•••• ' + t('terminal_tracking.terminal_config.unchanged', 'unchanged') : f.placeholder

  return (
    <Page>
      <PageBody className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('terminal_tracking.terminal_config.title', 'Terminals')}</CardTitle>
            <CardDescription>
              {t(
                'terminal_tracking.terminal_config.description',
                'Configure container terminal APIs (auth + URLs) and the identifiers used to match them.',
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div style={{ height: 420 }}>
              <DynamicTable {...table.props} actionsRenderer={actionsRenderer} />
            </div>
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto" onKeyDown={handleDialogKeyDown}>
            <DialogHeader>
              <DialogTitle>
                {isEdit
                  ? t('terminal_tracking.terminal_config.edit', 'Edit Terminal')
                  : t('terminal_tracking.terminal_config.create', 'Add Terminal')}
              </DialogTitle>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              {/* ── Terminal ────────────────────────────────── */}
              <SectionLabel>{t('terminal_tracking.terminal_config.section.terminal', 'Terminal')}</SectionLabel>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="adapterType">{t('terminal_tracking.terminal_config.adapterType', 'Adapter')}</Label>
                  <select id="adapterType" className="border rounded h-9 px-2 text-sm" value={form.adapterType}
                    onChange={(e) => changeAdapter(e.target.value)}>
                    {ADAPTER_ORDER.map((k) => (
                      <option key={k} value={k}>{ADAPTER_SPECS[k].label}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="terminalCode">{t('terminal_tracking.terminal_config.terminalCode', 'Terminal code')}</Label>
                  <Input id="terminalCode" value={form.terminalCode} disabled={isEdit}
                    onChange={(e) => setField('terminalCode', e.target.value)} placeholder="dct" />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="displayName">{t('terminal_tracking.terminal_config.displayName', 'Name')}</Label>
                <Input id="displayName" value={form.displayName}
                  onChange={(e) => setField('displayName', e.target.value)} placeholder="DCT Gdańsk (Baltic Hub)" />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="baseUrl">{t('terminal_tracking.terminal_config.baseUrl', 'API base URL')}</Label>
                <Input id="baseUrl" value={form.baseUrl}
                  onChange={(e) => setField('baseUrl', e.target.value)} placeholder="https://…" />
              </div>

              {/* ── Authentication ──────────────────────────── */}
              <SectionLabel>{t('terminal_tracking.terminal_config.section.auth', 'Authentication')}</SectionLabel>

              {spec.showOAuth && (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="tokenUrl">{t('terminal_tracking.terminal_config.tokenUrl', 'Token URL')}</Label>
                    <Input id="tokenUrl" value={form.tokenUrl}
                      onChange={(e) => setField('tokenUrl', e.target.value)} placeholder=".../oauth2/v2.0/token?p=b2c_1_ropc_login" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="clientId">{t('terminal_tracking.terminal_config.clientId', 'Client ID')}</Label>
                      <Input id="clientId" value={form.clientId}
                        onChange={(e) => setField('clientId', e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="scope">{t('terminal_tracking.terminal_config.scope', 'Scope')}</Label>
                      <Input id="scope" value={form.scope}
                        onChange={(e) => setField('scope', e.target.value)} placeholder="https://<tenant>/<app-id>/<scope>" />
                    </div>
                  </div>
                </>
              )}

              {credFields.map((f) => (
                <div className="grid gap-2" key={f.key}>
                  <Label htmlFor={`cred-${f.key}`}>
                    {t(`terminal_tracking.terminal_config.cred.${f.key}`, f.label)}
                  </Label>
                  <Input
                    id={`cred-${f.key}`}
                    type={f.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={form.credentials[f.key] ?? ''}
                    onChange={(e) => setCredential(f.key, e.target.value)}
                    placeholder={credPlaceholder(f)}
                  />
                </div>
              ))}
              {form.adapterType === 'gct' && (
                <p className="text-xs text-muted-foreground">
                  {t(
                    'terminal_tracking.terminal_config.gctHint',
                    'The base32 key shown in the GCT panel next to the QR code. A fresh one-time code is computed from it on each login.',
                  )}
                </p>
              )}
              {isEdit && (
                <p className="text-xs text-muted-foreground">
                  {t('terminal_tracking.terminal_config.credEditHint', 'Leave credentials blank to keep them unchanged.')}
                </p>
              )}

              {/* ── Matching ────────────────────────────────── */}
              <SectionLabel>{t('terminal_tracking.terminal_config.section.matching', 'Matching')}</SectionLabel>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="unlocode">{t('terminal_tracking.terminal_config.unlocode', 'UN/LOCODE')}</Label>
                  <Input id="unlocode" value={form.unlocode} maxLength={5}
                    onChange={(e) => setField('unlocode', e.target.value.toUpperCase())} placeholder="PLGDN" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="smdgCodes">{t('terminal_tracking.terminal_config.smdgCodes', 'SMDG codes (csv)')}</Label>
                  <Input id="smdgCodes" value={form.smdgCodes}
                    onChange={(e) => setField('smdgCodes', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="bicCodes">{t('terminal_tracking.terminal_config.bicCodes', 'BIC codes (csv)')}</Label>
                  <Input id="bicCodes" value={form.bicCodes}
                    onChange={(e) => setField('bicCodes', e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="nameAliases">{t('terminal_tracking.terminal_config.nameAliases', 'Name aliases (csv)')}</Label>
                  <Input id="nameAliases" value={form.nameAliases}
                    onChange={(e) => setField('nameAliases', e.target.value)} placeholder="Baltic Hub, DCT Gdańsk" />
                </div>
              </div>

              {/* ── Advanced ────────────────────────────────── */}
              <SectionLabel>{t('terminal_tracking.terminal_config.section.advanced', 'Advanced')}</SectionLabel>
              <div className="grid gap-2">
                <Label htmlFor="proxyUrl">{t('terminal_tracking.terminal_config.proxyUrl', 'API proxy URL (optional)')}</Label>
                <Input id="proxyUrl" value={form.proxyUrl}
                  onChange={(e) => setField('proxyUrl', e.target.value)} placeholder="http://proxy.example.com:8888" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="rlReq">{t('terminal_tracking.terminal_config.rateLimitRequests', 'Rate limit (requests)')}</Label>
                  <Input id="rlReq" type="number" min={1} value={form.rateLimitRequests}
                    onChange={(e) => setField('rateLimitRequests', Number(e.target.value) || 200)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="rlWin">{t('terminal_tracking.terminal_config.rateLimitWindowSeconds', 'Window (seconds)')}</Label>
                  <Input id="rlWin" type="number" min={1} value={form.rateLimitWindowSeconds}
                    onChange={(e) => setField('rateLimitWindowSeconds', Number(e.target.value) || 60)} />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox id="isActive" checked={form.isActive}
                  onCheckedChange={(c) => setField('isActive', c === true)} />
                <Label htmlFor="isActive" className="cursor-pointer">{t('terminal_tracking.terminal_config.isActive', 'Active')}</Label>
              </div>

              {testResult && (
                <div className={`flex items-center gap-2 rounded-md p-3 text-sm ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {testResult.success ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isEdit ? t('common.save', 'Save') : t('common.create', 'Create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageBody>
    </Page>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-1">
      {children}
    </div>
  )
}
