'use client'

import * as React from 'react'
import { apiCallOrThrow } from '@freighttech/ui/backend/utils/apiCall'
import { flash } from '@freighttech/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@freighttech/ui/primitives/button'
import { Input } from '@freighttech/ui/primitives/input'
import { Label } from '@freighttech/ui/primitives/label'
import { Checkbox } from '@freighttech/ui/primitives/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@freighttech/ui/primitives/card'
import { Badge } from '@freighttech/ui/primitives/badge'
import { Loader2, Ship } from 'lucide-react'

const DEFAULT_BASE_URL = 'https://api.shipsgo.com/v2'

type ShipsGoConfigData = {
  id: string
  organizationId: string
  tenantId: string
  isEnabled: boolean
  baseUrl: string
  oceanEnabled: boolean
  airEnabled: boolean
  rateLimitRequests: number
  rateLimitWindowSeconds: number
  createdAt: string
  updatedAt: string
} | null

type ShipsGoFormState = {
  isEnabled: boolean
  apiToken: string
  baseUrl: string
  oceanEnabled: boolean
  airEnabled: boolean
}

const emptyForm: ShipsGoFormState = {
  isEnabled: false,
  apiToken: '',
  baseUrl: DEFAULT_BASE_URL,
  oceanEnabled: true,
  airEnabled: true,
}

/**
 * ShipsGo aggregator credentials — the fallback tracking provider for
 * unsupported ocean carriers and air. One config per organization/tenant; the
 * API token is write-only (never returned) and encrypted at rest.
 */
export function ShipsGoConfigSection() {
  const t = useT()
  const [config, setConfig] = React.useState<ShipsGoConfigData>(null)
  const [form, setForm] = React.useState<ShipsGoFormState>(emptyForm)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const fetchConfig = React.useCallback(async () => {
    setLoading(true)
    try {
      const { result } = await apiCallOrThrow<{ config: ShipsGoConfigData }>(
        '/api/shipment_tracking/shipsgo-configs',
      )
      setConfig(result?.config ?? null)
      if (result?.config) {
        setForm({
          isEnabled: result.config.isEnabled,
          apiToken: '', // token is never returned from the API
          baseUrl: result.config.baseUrl,
          oceanEnabled: result.config.oceanEnabled,
          airEnabled: result.config.airEnabled,
        })
      } else {
        setForm(emptyForm)
      }
    } catch {
      setConfig(null)
      setForm(emptyForm)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const handleSave = React.useCallback(async () => {
    // Token required to create; on edit an empty field keeps the stored token.
    if (!config && !form.apiToken) {
      flash(
        t('shipment_tracking.shipsgo_config.validation.tokenRequired', 'API token is required'),
        'error',
      )
      return
    }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        isEnabled: form.isEnabled,
        baseUrl: form.baseUrl || DEFAULT_BASE_URL,
        oceanEnabled: form.oceanEnabled,
        airEnabled: form.airEnabled,
        apiToken: form.apiToken ? form.apiToken : '__UNCHANGED__',
      }

      await apiCallOrThrow('/api/shipment_tracking/shipsgo-configs', {
        method: 'PUT',
        body: JSON.stringify(body),
      })

      flash(t('shipment_tracking.shipsgo_config.flash.saved', 'ShipsGo configuration saved'), 'success')
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
    [handleSave],
  )

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ship className="h-5 w-5" />
            {t('shipment_tracking.shipsgo_config.title', 'ShipsGo Aggregator')}
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
            <Ship className="h-5 w-5" />
            <CardTitle>{t('shipment_tracking.shipsgo_config.title', 'ShipsGo Aggregator')}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {config ? (
              <>
                <Badge variant="outline">
                  {t('shipment_tracking.shipsgo_config.status.configured', 'Configured')}
                </Badge>
                <Badge variant={config.isEnabled ? 'default' : 'secondary'}>
                  {config.isEnabled
                    ? t('shipment_tracking.shipsgo_config.status.enabled', 'Enabled')
                    : t('shipment_tracking.shipsgo_config.status.disabled', 'Disabled')}
                </Badge>
              </>
            ) : (
              <Badge variant="secondary">
                {t('shipment_tracking.shipsgo_config.status.notConfigured', 'Not Configured')}
              </Badge>
            )}
          </div>
        </div>
        <CardDescription>
          {t(
            'shipment_tracking.shipsgo_config.description',
            'Configure the ShipsGo API token to enable fallback tracking for ocean carriers without a direct adapter and for air shipments. Registrations are billed per shipment by ShipsGo.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent onKeyDown={handleKeyDown}>
        <div className="grid gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="shipsgoEnabled"
              checked={form.isEnabled}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, isEnabled: checked === true }))}
            />
            <Label htmlFor="shipsgoEnabled" className="cursor-pointer font-medium">
              {t('shipment_tracking.shipsgo_config.fields.isEnabled', 'Enable ShipsGo Fallback')}
            </Label>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="shipsgoToken">
              {t('shipment_tracking.shipsgo_config.fields.apiToken', 'API Token')}
            </Label>
            <Input
              id="shipsgoToken"
              type="password"
              value={form.apiToken}
              onChange={(e) => setForm((prev) => ({ ...prev, apiToken: e.target.value }))}
              placeholder={config ? '••••••••' : 'X-Shipsgo-User-Token'}
            />
            <p className="text-xs text-muted-foreground">
              {t(
                'shipment_tracking.shipsgo_config.hints.apiToken',
                'Your token is encrypted and stored securely. Leave blank to keep the current token.',
              )}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="shipsgoOcean"
                checked={form.oceanEnabled}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, oceanEnabled: checked === true }))}
              />
              <Label htmlFor="shipsgoOcean" className="cursor-pointer font-medium">
                {t('shipment_tracking.shipsgo_config.fields.oceanEnabled', 'Ocean Fallback')}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="shipsgoAir"
                checked={form.airEnabled}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, airEnabled: checked === true }))}
              />
              <Label htmlFor="shipsgoAir" className="cursor-pointer font-medium">
                {t('shipment_tracking.shipsgo_config.fields.airEnabled', 'Air Tracking')}
              </Label>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="shipsgoBaseUrl">
              {t('shipment_tracking.shipsgo_config.fields.baseUrl', 'API Base URL')}
            </Label>
            <Input
              id="shipsgoBaseUrl"
              value={form.baseUrl}
              onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
              placeholder={DEFAULT_BASE_URL}
            />
            <p className="text-xs text-muted-foreground">
              {t('shipment_tracking.shipsgo_config.hints.baseUrl', `Default: ${DEFAULT_BASE_URL}`)}
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('shipment_tracking.shipsgo_config.actions.save', 'Save Configuration')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default ShipsGoConfigSection
