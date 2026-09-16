// ComboChart.stories.tsx

import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { ComboChart } from './ComboChart'

const meta: Meta<typeof ComboChart> = {
  title: 'Charts/ComboChart',
  component: ComboChart,
  parameters: {
    layout: 'padded',
  },
}

export default meta

type Story = StoryObj<typeof ComboChart>

// Verbatim PoC palette (do not eyeball — see IMPLEMENTATION-BRIEF.md).
const NAVY = '#1C3F6E'
const BLUE = '#2B5896'
const PLAN_GRAY = '#4A4A4A'
const CORE_NAVY = '#16335C'
const NONCORE_BLUE = '#6E8CB5'

const PL_MONTHS = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru']

const fmtPln = (v: number): string => {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} mln zł`
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)} tys. zł`
  return `${v} zł`
}
const fmtPct = (v: number): string => `${v}%`

// Chart 1/6 — EBITDA: wykonanie vs plan vs prognoza.
// Sty–Kwi actuals; Maj–Gru plan + forecast spline with an uncertainty band.
// Band keys are null for past months so no band is drawn there.
const ebitdaData = [
  { month: 'Sty', actual: -32110, plan: -20000, forecast: null, fcMin: null, fcMax: null },
  { month: 'Lut', actual: -4160, plan: 5000, forecast: null, fcMin: null, fcMax: null },
  { month: 'Mar', actual: 65696, plan: 40000, forecast: null, fcMin: null, fcMax: null },
  { month: 'Kwi', actual: 146837, plan: 90000, forecast: 146837, fcMin: 146837, fcMax: 146837 },
  { month: 'Maj', actual: null, plan: 110000, forecast: 150000, fcMin: 120000, fcMax: 180000 },
  { month: 'Cze', actual: null, plan: 130000, forecast: 165000, fcMin: 125000, fcMax: 205000 },
  { month: 'Lip', actual: null, plan: 150000, forecast: 178000, fcMin: 130000, fcMax: 226000 },
  { month: 'Sie', actual: null, plan: 165000, forecast: 188000, fcMin: 135000, fcMax: 241000 },
  { month: 'Wrz', actual: null, plan: 180000, forecast: 196000, fcMin: 138000, fcMax: 254000 },
  { month: 'Paź', actual: null, plan: 195000, forecast: 205000, fcMin: 142000, fcMax: 268000 },
  { month: 'Lis', actual: null, plan: 208000, forecast: 213000, fcMin: 146000, fcMax: 280000 },
  { month: 'Gru', actual: null, plan: 220000, forecast: 222000, fcMin: 150000, fcMax: 294000 },
]

export const EbitdaPlanActualForecast: Story = {
  args: {
    title: 'EBITDA: wykonanie vs plan vs prognoza',
    data: ebitdaData,
    index: 'month',
    referenceY: 0,
    leftFormatter: fmtPln,
    band: { minKey: 'fcMin', maxKey: 'fcMax', color: BLUE, name: 'Przedział prognozy' },
    series: [
      { key: 'actual', name: 'Wykonanie', type: 'bar', color: NAVY },
      { key: 'plan', name: 'Plan', type: 'line', color: PLAN_GRAY, dashStyle: 'ShortDash' },
      { key: 'forecast', name: 'Prognoza', type: 'line', color: BLUE, dashStyle: 'Dash' },
    ],
    markers: [{ xValue: 'Kwi', yValue: 146837, label: 'Teraz', color: NAVY }],
  },
}

// Chart 4 — Struktura sprzedaży: CORE vs NON-CORE.
// Stacked monthly columns + a NON-CORE share % line on the right axis.
const coreSplitData = [
  { month: 'Sty', core: 620000, nonCore: 360000, nonCorePct: 37 },
  { month: 'Lut', core: 540000, nonCore: 520000, nonCorePct: 49 },
  { month: 'Mar', core: 700000, nonCore: 980000, nonCorePct: 58 },
  { month: 'Kwi', core: 480000, nonCore: 830000, nonCorePct: 63 },
]

export const CoreNonCoreStacked: Story = {
  args: {
    title: 'Struktura sprzedaży: CORE vs NON-CORE',
    data: coreSplitData,
    index: 'month',
    leftFormatter: fmtPln,
    rightFormatter: fmtPct,
    rightDomain: [0, 100],
    series: [
      { key: 'core', name: 'CORE (TWARGUM)', type: 'bar', color: CORE_NAVY, stackId: 'sprzedaz' },
      { key: 'nonCore', name: 'NON-CORE', type: 'bar', color: NONCORE_BLUE, stackId: 'sprzedaz' },
      { key: 'nonCorePct', name: 'Udział NON-CORE %', type: 'line', color: BLUE, yAxis: 'right' },
    ],
  },
}

export const Loading: Story = {
  args: {
    title: 'EBITDA: wykonanie vs plan vs prognoza',
    data: [],
    index: 'month',
    series: [],
    loading: true,
  },
}
