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
import { Textarea } from '@freighttech/ui/primitives/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@freighttech/ui/primitives/card'
import { Badge } from '@freighttech/ui/primitives/badge'
import { Loader2, CheckCircle2, XCircle, Shield, Plus } from 'lucide-react'
import { ShipsGoConfigSection } from '../../components/ShipsGoConfigSection'

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
  authConfig: string
  rateLimitRequests: number
  rateLimitWindowSeconds: number
  isActive: boolean
}

const emptyForm: FormState = {
  carrierCode: '',
  apiEndpoint: '',
  authConfig: '',
  rateLimitRequests: 60,
  rateLimitWindowSeconds: 60,
  isActive: true,
}

function rowToForm(row: CarrierConfigRow): FormState {
  return {
    carrierCode: row.carrierCode,
    apiEndpoint: row.apiEndpoint ?? '',
    authConfig: row.authConfig ? JSON.stringify(row.authConfig, null, 2) : '',
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

  const columns = useMemo<ColumnDef[]>(
    () => [
      {
        data: 'carrierCode',
        title: t('shipment_tracking.carrier_configs.fields.carrierCode', 'Carrier Code'),
        width: 150,
        readOnly: true,
        renderer: (value: unknown) => (
          <span className="font-medium">{String(value ?? '')}</span>
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
      flash(t('shipment_tracking.carrier_configs.validation.carrierCodeRequired', 'Carrier code is required'), 'error')
      return
    }

    if (form.authConfig.trim()) {
      try {
        JSON.parse(form.authConfig)
      } catch {
        flash(t('shipment_tracking.carrier_configs.validation.authConfigInvalidJson', 'Auth config must be valid JSON'), 'error')
        return
      }
    }

    if (form.apiEndpoint.trim()) {
      try {
        new URL(form.apiEndpoint.trim())
      } catch {
        flash(t('shipment_tracking.carrier_configs.validation.apiEndpointInvalidUrl', 'API endpoint must be a valid URL'), 'error')
        return
      }
    }

    setSubmitting(true)
    try {
      const authConfig = form.authConfig.trim() ? JSON.parse(form.authConfig) : undefined

      if (isEdit) {
        const body: Record<string, unknown> = { id: editingId }
        if (form.apiEndpoint.trim()) body.apiEndpoint = form.apiEndpoint.trim()
        else body.apiEndpoint = null
        body.authConfig = authConfig ?? null
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
        if (form.apiEndpoint.trim()) body.apiEndpoint = form.apiEndpoint.trim()
        if (authConfig) body.authConfig = authConfig

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
                <Label htmlFor="carrierCode">{t('shipment_tracking.carrier_configs.fields.carrierCode', 'Carrier Code')}</Label>
                <Input
                  id="carrierCode"
                  value={form.carrierCode}
                  onChange={(event) => setForm((prev) => ({ ...prev, carrierCode: event.target.value }))}
                  placeholder="e.g. maersk, msc, cma-cgm"
                  disabled={isEdit}
                  autoFocus={!isEdit}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="apiEndpoint">{t('shipment_tracking.carrier_configs.fields.apiEndpoint', 'API Endpoint')}</Label>
                <Input
                  id="apiEndpoint"
                  value={form.apiEndpoint}
                  onChange={(event) => setForm((prev) => ({ ...prev, apiEndpoint: event.target.value }))}
                  placeholder="https://api.example.com/tracking"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="authConfig">{t('shipment_tracking.carrier_configs.fields.authConfig', 'Auth Config (JSON)')}</Label>
                <Textarea
                  id="authConfig"
                  value={form.authConfig}
                  onChange={(event) => setForm((prev) => ({ ...prev, authConfig: event.target.value }))}
                  placeholder='{"apiKey": "..."}'
                  rows={3}
                  className="font-mono text-xs"
                />
              </div>

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
                      setForm((prev) => ({ ...prev, rateLimitRequests: Number(event.target.value) || 60 }))
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
                      setForm((prev) => ({ ...prev, rateLimitWindowSeconds: Number(event.target.value) || 60 }))
                    }
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="isActive"
                  checked={form.isActive}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, isActive: checked === true }))
                  }
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
