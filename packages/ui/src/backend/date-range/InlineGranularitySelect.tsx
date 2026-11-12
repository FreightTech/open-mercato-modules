"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ChipTabs } from '../../primitives-v2/ChipTabs'
import type { DateGranularity } from '@open-mercato/shared/modules/analytics'

export type InlineGranularitySelectProps = {
  value: DateGranularity
  onChange: (value: DateGranularity) => void
  className?: string
}

type GranularityOption = {
  value: DateGranularity
  shortLabelKey: string
  shortFallback: string
  titleKey: string
  titleFallback: string
}

const GRANULARITY_OPTIONS: GranularityOption[] = [
  { value: 'day', shortLabelKey: 'dashboards.analytics.granularity.short.day', shortFallback: 'D', titleKey: 'dashboards.analytics.granularity.day', titleFallback: 'Day' },
  { value: 'week', shortLabelKey: 'dashboards.analytics.granularity.short.week', shortFallback: 'W', titleKey: 'dashboards.analytics.granularity.week', titleFallback: 'Week' },
  { value: 'month', shortLabelKey: 'dashboards.analytics.granularity.short.month', shortFallback: 'M', titleKey: 'dashboards.analytics.granularity.month', titleFallback: 'Month' },
  { value: 'quarter', shortLabelKey: 'dashboards.analytics.granularity.short.quarter', shortFallback: 'Q', titleKey: 'dashboards.analytics.granularity.quarter', titleFallback: 'Quarter' },
  { value: 'year', shortLabelKey: 'dashboards.analytics.granularity.short.year', shortFallback: 'Y', titleKey: 'dashboards.analytics.granularity.year', titleFallback: 'Year' },
]

export function InlineGranularitySelect({
  value,
  onChange,
  className = '',
}: InlineGranularitySelectProps) {
  const t = useT()

  // FMS UX 03.11: chip tabs, no segmented/underline.
  return (
    <ChipTabs
      role="radiogroup"
      size="sm"
      className={className}
      value={value}
      onChange={onChange}
      options={GRANULARITY_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.shortLabelKey, option.shortFallback),
        title: t(option.titleKey, option.titleFallback),
      }))}
    />
  )
}

export default InlineGranularitySelect
