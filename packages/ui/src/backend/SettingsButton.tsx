'use client'
import Link from 'next/link'
import { Settings } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '../primitives-v2/IconButton'

export type SettingsButtonProps = {
  href?: string
}

export function SettingsButton({ href = '/backend/settings' }: SettingsButtonProps) {
  const t = useT()
  const label = t('backend.nav.settings', 'Settings')

  return (
    <IconButton
      asChild
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
    >
      <Link href={href}>
        <Settings className="h-4 w-4 text-topbar-v2-icon" />
      </Link>
    </IconButton>
  )
}
