'use client'

import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { Page, PageBody } from '@freighttech/ui/backend/Page'
import { BooleanIcon } from '@freighttech/ui/backend/ValueIcons'
import {
  DynamicTable,
  TableSkeleton,
  useDynamicTablePage,
} from '@freighttech/ui/backend/dynamic-table'
import type { ColumnDef, ContextMenuAction } from '@freighttech/ui/backend/dynamic-table'
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
import { Button as ButtonV2 } from '@freighttech/ui/primitives-v2'
import { Input } from '@freighttech/ui/primitives/input'
import { Label } from '@freighttech/ui/primitives/label'
import { Checkbox } from '@freighttech/ui/primitives/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@freighttech/ui/primitives/card'
import { Badge } from '@freighttech/ui/primitives/badge'
import { Loader2, CheckCircle2, XCircle, Shield, Plus } from 'lucide-react'
import { ShipsGoConfigSection } from '../../components/ShipsGoConfigSection'

// ─── Carrier specs ───────────────────────────────────────────
// One entry per registered carrier adapter (see
// lib/adapters/index.ts / services/carrierRegistry.ts). Each carrier maps to a
// fixed set of auth_config keys and a default events endpoint (the value the
// adapter falls back to when apiEndpoint is null). ShipsGo is intentionally
// absent — it has its own dedicated config section, not a carrier-configs row.
type CredField = { key: string; label: string; secret?: boolean; placeholder?: string; optional?: boolean }

type CarrierSpec = {
  value: string
  label: string
  /** Adapter's default events endpoint; '' when the adapter has none. */
  defaultEndpoint: string
  /** Evergreen has no default endpoint — apiEndpoint must be supplied. */
  endpointRequired?: boolean
  credentials: CredField[]
}

const CLIENT_ID: CredField = { key: 'client_id', label: 'Client ID' }
const CLIENT_SECRET: CredField = { key: 'client_secret', label: 'Client secret', secret: true }

const CARRIER_SPECS: CarrierSpec[] = [
  {
    value: 'maersk',
    label: 'Maersk',
    defaultEndpoint: 'https://api.maersk.com/track-and-trace-private/events',
    credentials: [CLIENT_ID, CLIENT_SECRET],
  },
  {
    value: 'msc',
    label: 'MSC',
    defaultEndpoint: 'https://api.tech.msc.com/msc/trackandtrace/v2.2/events',
    // The MSC OAuth account identity (client_id/scope/token_url/aud) is supplied
    // per config, not baked into the adapter — so the form collects it here
    // alongside the certificate. `aud` defaults to `token_url` when left blank.
    credentials: [
      CLIENT_ID,
      { key: 'scope', label: 'Scope' },
      { key: 'token_url', label: 'Token URL' },
      { key: 'aud', label: 'Audience', optional: true, placeholder: 'defaults to Token URL' },
      { key: 'certificate_base64', label: 'Certificate (base64 PFX)', secret: true },
    ],
  },
  {
    value: 'cma-cgm',
    label: 'CMA CGM',
    defaultEndpoint: 'https://apis.cma-cgm.net/operation/trackandtrace/v1/events',
    credentials: [{ key: 'api_key', label: 'API key', secret: true }],
  },
  {
    value: 'hapag-lloyd',
    label: 'Hapag-Lloyd',
    defaultEndpoint: 'https://api.hlag.com/hlag/external/v2/events',
    credentials: [CLIENT_ID, CLIENT_SECRET],
  },
  {
    value: 'zim',
    label: 'ZIM',
    defaultEndpoint: 'https://apigw.zim.com/trackAndTrace/v1',
    credentials: [CLIENT_ID, CLIENT_SECRET, { key: 'subscription_key', label: 'Subscription key', secret: true }],
  },
  {
    value: 'cosco',
    label: 'COSCO',
    defaultEndpoint: 'https://apis.cargosmart.com/openapi/cs2/ctvc/COSU',
    credentials: [
      { key: 'app_key', label: 'App key', secret: true },
      { key: 'customer_id', label: 'Customer ID' },
      { key: 'scac_code', label: 'SCAC code', optional: true, placeholder: 'COSU' },
    ],
  },
  {
    value: 'evergreen',
    label: 'Evergreen',
    defaultEndpoint: '',
    endpointRequired: true,
    credentials: [CLIENT_ID, CLIENT_SECRET, { key: 'token_url', label: 'Token URL' }],
  },
]

function specFor(carrierCode: string): CarrierSpec | undefined {
  return CARRIER_SPECS.find((c) => c.value === carrierCode)
}

/**
 * Credential fields for a carrier. For a known carrier this is its fixed set;
 * for an unrecognised legacy row (edit) we derive the fields from the stored
 * auth_config keys so the form never falls back to raw JSON.
 */
function credentialFieldsFor(carrierCode: string, authConfig?: Record<string, unknown> | null): CredField[] {
  const spec = specFor(carrierCode)
  if (spec) return spec.credentials
  const keys = authConfig ? Object.keys(authConfig) : []
  return keys.map((k) => ({ key: k, label: k, secret: /secret|password|key|token|cert/i.test(k) }))
}

// ─── Carrier Config Types ────────────────────────────────────

type CarrierConfigRow = {
  id: string
  carrierCode: string
  apiEndpoint: string | null
  authConfig: Record<string, unknown> | null
  rateLimitRequests: number
  rateLimitWindowSeconds: number
  isActive: boolean
  createdAt: string | null
}

function mapItem(item: Record<string, unknown>): CarrierConfigRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null

  return {
    id,
    carrierCode: (item.carrierCode as string) ?? '',
    apiEndpoint: (item.apiEndpoint as string) ?? null,
    authConfig: (item.authConfig as Record<string, unknown>) ?? null,
    rateLimitRequests: typeof item.rateLimitRequests === 'number' ? item.rateLimitRequests : 60,
    rateLimitWindowSeconds: typeof item.rateLimitWindowSeconds === 'number' ? item.rateLimitWindowSeconds : 60,
    isActive: item.isActive === true,
    createdAt: (item.createdAt as string) ?? null,
  }
}

type FormState = {
  carrierCode: string
  apiEndpoint: string
  credentials: Record<string, string>
  rateLimitRequests: number
  rateLimitWindowSeconds: number
  isActive: boolean
}

function formForCarrier(carrierCode: string): FormState {
  const spec = specFor(carrierCode)
  return {
    carrierCode,
    apiEndpoint: spec?.defaultEndpoint ?? '',
    credentials: {},
    rateLimitRequests: 60,
    rateLimitWindowSeconds: 60,
    isActive: true,
  }
}

const emptyForm: FormState = formForCarrier(CARRIER_SPECS[0].value)

function rowToForm(row: CarrierConfigRow): FormState {
  // auth_config is returned by the API (plaintext jsonb); prefill the fields.
  const credentials: Record<string, string> = {}
  const auth = row.authConfig ?? {}
  for (const [k, v] of Object.entries(auth)) credentials[k] = v == null ? '' : String(v)
  return {
    carrierCode: row.carrierCode,
    apiEndpoint: row.apiEndpoint ?? specFor(row.carrierCode)?.defaultEndpoint ?? '',
    credentials,
    rateLimitRequests: row.rateLimitRequests,
    rateLimitWindowSeconds: row.rateLimitWindowSeconds,
    isActive: row.isActive,
  }
}

// ─── BIC Config Types ────────────────────────────────────────

type BicConfigData = {
  id: string
  organizationId: string
  tenantId: string
  isEnabled: boolean
  username: string
  baseUrl: string
  createdAt: string
  updatedAt: string
} | null

type BicFormState = {
  isEnabled: boolean
  username: string
  password: string
  baseUrl: string
}

const emptyBicForm: BicFormState = {
  isEnabled: false,
  username: '',
  password: '',
  baseUrl: 'https://api.bic-code.org',
}

// ─── BIC Config Section ──────────────────────────────────────

function BicConfigSection() {
  const t = useT()
  const [config, setConfig] = React.useState<BicConfigData>(null)
  const [form, setForm] = React.useState<BicFormState>(emptyBicForm)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null)

  const fetchConfig = React.useCallback(async () => {
    setLoading(true)
    try {
      const { result } = await apiCallOrThrow<{ config: BicConfigData }>('/api/shipment_tracking/bic-configs')
      setConfig(result?.config ?? null)
      if (result?.config) {
        setForm({
          isEnabled: result.config.isEnabled,
          username: result.config.username,
          password: '', // Password is never returned from API
          baseUrl: result.config.baseUrl,
        })
      } else {
        setForm(emptyBicForm)
      }
    } catch {
      // Config doesn't exist yet, that's fine
      setConfig(null)
      setForm(emptyBicForm)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const handleTest = React.useCallback(async () => {
    if (!form.username || !form.password) {
      flash(t('shipment_tracking.bic_config.validation.usernameRequired', 'Username is required'), 'error')
      return
    }

    setTesting(true)
    setTestResult(null)

    try {
      const { result } = await apiCallOrThrow<{ success: boolean; message: string }>(
        '/api/shipment_tracking/bic-configs/test',
        {
          method: 'POST',
          body: JSON.stringify({
            username: form.username,
            password: form.password,
            baseUrl: form.baseUrl,
          }),
        }
      )

      setTestResult(result ?? { success: false, message: 'Unknown error' })

      if (result?.success) {
        flash(t('shipment_tracking.bic_config.flash.testSuccess', 'BIC API connection successful'), 'success')
      } else {
        flash(result?.message ?? t('shipment_tracking.bic_config.flash.testFailed', 'BIC API connection failed'), 'error')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection test failed'
      setTestResult({ success: false, message })
      flash(message, 'error')
    } finally {
      setTesting(false)
    }
  }, [form, t])

  const handleSave = React.useCallback(async () => {
    if (!form.username) {
      flash(t('shipment_tracking.bic_config.validation.usernameRequired', 'Username is required'), 'error')
      return
    }

    // Password is required for new config or when enabling
    if (!config && !form.password) {
      flash(t('shipment_tracking.bic_config.validation.passwordRequired', 'Password is required'), 'error')
      return
    }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        isEnabled: form.isEnabled,
        username: form.username,
        baseUrl: form.baseUrl || 'https://api.bic-code.org',
      }

      // Only include password if it was changed
      if (form.password) {
        body.password = form.password
      } else if (config) {
        // If editing and no new password, we still need to send something
        // The API should handle this gracefully
        body.password = '__UNCHANGED__'
      }

      await apiCallOrThrow('/api/shipment_tracking/bic-configs', {
        method: 'PUT',
        body: JSON.stringify(body),
      })

      flash(t('shipment_tracking.bic_config.flash.saved', 'BIC configuration saved'), 'success')
      fetchConfig()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save'
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [form, config, t, fetchConfig])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSave()
      }
    },
    [handleSave]
  )

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {t('shipment_tracking.bic_config.title', 'BIC Facility API')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            <CardTitle>{t('shipment_tracking.bic_config.title', 'BIC Facility API')}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {config ? (
              <>
                <Badge variant="outline">
                  {t('shipment_tracking.bic_config.status.configured', 'Configured')}
                </Badge>
                <Badge variant={config.isEnabled ? 'default' : 'secondary'}>
                  {config.isEnabled
                    ? t('shipment_tracking.bic_config.status.enabled', 'Enabled')
                    : t('shipment_tracking.bic_config.status.disabled', 'Disabled')}
                </Badge>
              </>
            ) : (
              <Badge variant="secondary">
                {t('shipment_tracking.bic_config.status.notConfigured', 'Not Configured')}
              </Badge>
            )}
          </div>
        </div>
        <CardDescription>
          {t(
            'shipment_tracking.bic_config.description',
            'Configure BIC Facility Code API credentials to enrich shipment tracking locations with coordinates, addresses, and terminal operator information.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent onKeyDown={handleKeyDown}>
        <div className="grid gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="bicEnabled"
              checked={form.isEnabled}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, isEnabled: checked === true }))
              }
            />
            <Label htmlFor="bicEnabled" className="cursor-pointer font-medium">
              {t('shipment_tracking.bic_config.fields.isEnabled', 'Enable BIC Enrichment')}
            </Label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="bicUsername">
                {t('shipment_tracking.bic_config.fields.username', 'Username')}
              </Label>
              <Input
                id="bicUsername"
                value={form.username}
                onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
                placeholder="your-bic-username"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="bicPassword">
                {t('shipment_tracking.bic_config.fields.password', 'Password')}
              </Label>
              <Input
                id="bicPassword"
                type="password"
                value={form.password}
                onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                placeholder={config ? '••••••••' : 'your-bic-password'}
              />
              <p className="text-xs text-muted-foreground">
                {t(
                  'shipment_tracking.bic_config.hints.password',
                  'Your password will be encrypted and stored securely.'
                )}
              </p>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="bicBaseUrl">
              {t('shipment_tracking.bic_config.fields.baseUrl', 'API Base URL')}
            </Label>
            <Input
              id="bicBaseUrl"
              value={form.baseUrl}
              onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="https://api.bic-code.org"
            />
            <p className="text-xs text-muted-foreground">
              {t('shipment_tracking.bic_config.hints.baseUrl', 'Default: https://api.bic-code.org')}
            </p>
          </div>

          {testResult && (
            <div
              className={`flex items-center gap-2 rounded-md p-3 text-sm ${
                testResult.success
                  ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                  : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing || !form.username || !form.password}
            >
              {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('shipment_tracking.bic_config.actions.testConnection', 'Test Connection')}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('shipment_tracking.bic_config.actions.save', 'Save Configuration')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Main Page ───────────────────────────────────────────────

export default function TrackingAuthConfigPage() {
  const t = useT()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [submitting, setSubmitting] = useState(false)

  const isEdit = editingId !== null
  const credFields = credentialFieldsFor(form.carrierCode, form.credentials)
  const spec = specFor(form.carrierCode)

  const setField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((p) => ({ ...p, [key]: value })),
    [],
  )
  const setCredential = useCallback(
    (key: string, value: string) => setForm((p) => ({ ...p, credentials: { ...p.credentials, [key]: value } })),
    [],
  )
  const changeCarrier = useCallback((carrierCode: string) => setForm(formForCarrier(carrierCode)), [])

  const columns = useMemo<ColumnDef[]>(
    () => [
      {
        data: 'carrierCode',
        title: t('shipment_tracking.carrier_configs.fields.carrierCode', 'Carrier'),
        width: 150,
        readOnly: true,
        renderer: (value: unknown) => (
          <span className="font-medium">{specFor(String(value))?.label ?? String(value ?? '')}</span>
        ),
      },
      {
        data: 'apiEndpoint',
        title: t('shipment_tracking.carrier_configs.fields.apiEndpoint', 'API Endpoint'),
        width: 280,
        readOnly: true,
        renderer: (value: unknown) => (
          <span className="text-sm truncate max-w-[260px] block">{String(value || '-')}</span>
        ),
      },
      {
        data: 'rateLimit',
        title: t('shipment_tracking.carrier_configs.fields.rateLimit', 'Rate Limit'),
        width: 120,
        readOnly: true,
        renderer: (_value: unknown, rowData: Record<string, unknown>) => (
          <span className="text-sm">
            {String(rowData.rateLimitRequests ?? 60)} / {String(rowData.rateLimitWindowSeconds ?? 60)}s
          </span>
        ),
      },
      {
        data: 'isActive',
        title: t('shipment_tracking.carrier_configs.fields.isActive', 'Active'),
        width: 80,
        readOnly: true,
        renderer: (value: unknown) => <BooleanIcon value={value === true || value === 'true'} />,
      },
    ],
    [t],
  )

  const openCreateDialog = useCallback(() => {
    setEditingId(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }, [])

  const addButton = useMemo(
    () => (
      <ButtonV2 variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreateDialog}>
        {t('shipment_tracking.carrier_configs.create', 'Add Carrier Config')}
      </ButtonV2>
    ),
    [openCreateDialog, t],
  )

  const table = useDynamicTablePage<CarrierConfigRow>({
    source: '/api/shipment_tracking/carrier-configs',
    // Saved views. Without this the perspective tab strip auto-hides
    // (hidePerspectiveTabs ?? !hasPerspectives), so users cannot save or
    // switch a view on this list at all.
    perspectives: 'shipment_tracking_carrier_configs',
    columns,
    tableName: t('shipment_tracking.carrier_configs.title', 'Carrier Configs'),
    defaultPageSize: 20,
    mapApiItem: mapItem,
    cellEdit: false,
    tableProps: {
      height: '100%',
      uiConfig: {
        readOnlyStyle: 'normal',
        hideAddRowButton: true,
        searchBarEnd: addButton,
      },
    },
  })

  const openEditDialog = useCallback(
    (id: string) => {
      const items = (table.query.data as { items?: Record<string, unknown>[] })?.items ?? []
      const mapped = items.map(mapItem).filter((x): x is CarrierConfigRow => x !== null)
      const row = mapped.find((r) => r.id === id)
      if (!row) return
      setEditingId(id)
      setForm(rowToForm(row))
      setDialogOpen(true)
    },
    [table.query.data],
  )

  const handleSubmit = useCallback(async () => {
    if (submitting) return

    if (!isEdit && !form.carrierCode.trim()) {
      flash(t('shipment_tracking.carrier_configs.validation.carrierCodeRequired', 'Carrier is required'), 'error')
      return
    }

    const currentSpec = specFor(form.carrierCode)
    const endpoint = form.apiEndpoint.trim()
    if (currentSpec?.endpointRequired && !endpoint) {
      flash(t('shipment_tracking.carrier_configs.validation.endpointRequired', 'API endpoint is required for this carrier'), 'error')
      return
    }
    if (endpoint) {
      try {
        new URL(endpoint)
      } catch {
        flash(t('shipment_tracking.carrier_configs.validation.apiEndpointInvalidUrl', 'API endpoint must be a valid URL'), 'error')
        return
      }
    }

    // Assemble auth_config from the structured fields; require all non-optional.
    const fields = credentialFieldsFor(form.carrierCode, form.credentials)
    const authConfig: Record<string, string> = {}
    for (const f of fields) {
      const val = (form.credentials[f.key] ?? '').trim()
      if (!val) {
        if (f.optional) continue
        flash(
          t('shipment_tracking.carrier_configs.validation.credentialsRequired', 'Fill in all credential fields'),
          'error',
        )
        return
      }
      authConfig[f.key] = val
    }

    setSubmitting(true)
    try {
      const hasAuth = Object.keys(authConfig).length > 0
      if (isEdit) {
        const body: Record<string, unknown> = { id: editingId }
        body.apiEndpoint = endpoint || null
        body.authConfig = hasAuth ? authConfig : null
        body.rateLimitRequests = form.rateLimitRequests
        body.rateLimitWindowSeconds = form.rateLimitWindowSeconds
        body.isActive = form.isActive

        await apiCallOrThrow('/api/shipment_tracking/carrier-configs', {
          method: 'PUT',
          body: JSON.stringify(body),
        })
        flash(t('shipment_tracking.carrier_configs.flash.updated', 'Carrier config updated'), 'success')
      } else {
        const body: Record<string, unknown> = {
          carrierCode: form.carrierCode.trim(),
          rateLimitRequests: form.rateLimitRequests,
          rateLimitWindowSeconds: form.rateLimitWindowSeconds,
          isActive: form.isActive,
        }
        if (endpoint) body.apiEndpoint = endpoint
        if (hasAuth) body.authConfig = authConfig

        await apiCallOrThrow('/api/shipment_tracking/carrier-configs', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        flash(t('shipment_tracking.carrier_configs.flash.created', 'Carrier config created'), 'success')
      }

      setDialogOpen(false)
      table.refresh()
    } catch {
      flash(isEdit ? t('shipment_tracking.carrier_configs.flash.updateFailed', 'Failed to update carrier config') : t('shipment_tracking.carrier_configs.flash.createFailed', 'Failed to create carrier config'), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [form, isEdit, editingId, submitting, table.refresh, t])

  const handleDialogKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm(t('shipment_tracking.carrier_configs.confirmDelete', 'Delete this carrier config?'))) return

      try {
        await apiCallOrThrow('/api/shipment_tracking/carrier-configs', {
          method: 'DELETE',
          body: JSON.stringify({ id }),
        })
        flash(t('shipment_tracking.carrier_configs.flash.deleted', 'Carrier config deleted'), 'success')
        table.refresh()
      } catch {
        flash(t('shipment_tracking.carrier_configs.flash.deleteFailed', 'Failed to delete carrier config'), 'error')
      }
    },
    [table.refresh, t],
  )

  const rowActions = useCallback(
    (rowData: any): ContextMenuAction[] => {
      if (!rowData?.id) return []
      return [
        { id: 'edit', label: t('common.edit', 'Edit') },
        { id: 'delete', label: t('common.delete', 'Delete') },
      ]
    },
    [t],
  )

  const handleRowAction = useCallback(
    (actionId: string, rowData: any) => {
      const id = rowData?.id as string | undefined
      if (!id) return
      if (actionId === 'edit') openEditDialog(id)
      else if (actionId === 'delete') handleDelete(id)
    },
    [openEditDialog, handleDelete],
  )

  const tableHeight = useMemo(() => {
    const rowH = 40
    const headerH = 40
    const toolbarH = 50
    const minHeight = 200
    const maxHeight = 400
    const rowCount = (table.query.data as { total?: number })?.total ?? 0
    const contentHeight = toolbarH + headerH + rowCount * rowH + 20
    return Math.min(Math.max(contentHeight, minHeight), maxHeight)
  }, [table.query.data])

  if (table.isLoading) {
    return (
      <Page>
        <PageBody className="space-y-6">
          <BicConfigSection />
          <ShipsGoConfigSection />
          <Card>
            <CardHeader>
              <CardTitle>{t('shipment_tracking.carrier_configs.title', 'Carrier Configs')}</CardTitle>
            </CardHeader>
            <CardContent>
              <TableSkeleton rows={5} columns={4} />
            </CardContent>
          </Card>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody className="space-y-6">
        {/* BIC Config Section */}
        <BicConfigSection />

        {/* ShipsGo Aggregator Config Section */}
        <ShipsGoConfigSection />

        {/* Carrier Configs Section */}
        <Card>
          <CardHeader>
            <CardTitle>{t('shipment_tracking.carrier_configs.title', 'Carrier Configs')}</CardTitle>
            <CardDescription>
              {t(
                'shipment_tracking.auth_config.description',
                'Configure authentication for carrier tracking APIs and facility enrichment services.'
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div style={{ height: tableHeight }}>
              <DynamicTable
                {...table.props}
                striped
                density="md"
                rowActions={rowActions}
                onRowAction={handleRowAction}
              />
            </div>
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-lg" onKeyDown={handleDialogKeyDown}>
            <DialogHeader>
              <DialogTitle>{isEdit ? t('shipment_tracking.carrier_configs.edit', 'Edit Carrier Config') : t('shipment_tracking.carrier_configs.create', 'Add Carrier Config')}</DialogTitle>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="carrierCode">{t('shipment_tracking.carrier_configs.fields.carrierCode', 'Carrier')}</Label>
                {isEdit ? (
                  <Input id="carrierCode" value={spec?.label ?? form.carrierCode} disabled />
                ) : (
                  <select
                    id="carrierCode"
                    className="border rounded h-9 px-2 text-sm"
                    value={form.carrierCode}
                    onChange={(event) => changeCarrier(event.target.value)}
                  >
                    {CARRIER_SPECS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="apiEndpoint">{t('shipment_tracking.carrier_configs.fields.apiEndpoint', 'API Endpoint')}</Label>
                <Input
                  id="apiEndpoint"
                  value={form.apiEndpoint}
                  onChange={(event) => setField('apiEndpoint', event.target.value)}
                  placeholder="https://api.example.com/tracking"
                />
                {spec?.endpointRequired && (
                  <p className="text-xs text-muted-foreground">
                    {t('shipment_tracking.carrier_configs.hints.endpointRequired', 'This carrier requires an explicit API endpoint.')}
                  </p>
                )}
              </div>

              {/* Structured credentials (per carrier) */}
              {credFields.map((f) => (
                <div className="grid gap-2" key={f.key}>
                  <Label htmlFor={`cred-${f.key}`}>
                    {t(`shipment_tracking.carrier_configs.cred.${f.key}`, f.label)}
                    {f.optional ? ` (${t('common.optional', 'optional')})` : ''}
                  </Label>
                  <Input
                    id={`cred-${f.key}`}
                    type={f.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={form.credentials[f.key] ?? ''}
                    onChange={(event) => setCredential(f.key, event.target.value)}
                    placeholder={f.placeholder}
                  />
                </div>
              ))}

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="rateLimitRequests">{t('shipment_tracking.carrier_configs.fields.rateLimitRequests', 'Rate Limit (requests)')}</Label>
                  <Input
                    id="rateLimitRequests"
                    type="number"
                    min={1}
                    max={10000}
                    value={form.rateLimitRequests}
                    onChange={(event) =>
                      setField('rateLimitRequests', Number(event.target.value) || 60)
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="rateLimitWindowSeconds">{t('shipment_tracking.carrier_configs.fields.rateLimitWindowSeconds', 'Window (seconds)')}</Label>
                  <Input
                    id="rateLimitWindowSeconds"
                    type="number"
                    min={1}
                    max={86400}
                    value={form.rateLimitWindowSeconds}
                    onChange={(event) =>
                      setField('rateLimitWindowSeconds', Number(event.target.value) || 60)
                    }
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="isActive"
                  checked={form.isActive}
                  onCheckedChange={(checked) => setField('isActive', checked === true)}
                />
                <Label htmlFor="isActive" className="cursor-pointer">
                  {t('shipment_tracking.carrier_configs.fields.isActive', 'Active')}
                </Label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? t('common.saving', 'Saving...') : isEdit ? t('common.save', 'Save') : t('common.create', 'Create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageBody>
    </Page>
  )
}
