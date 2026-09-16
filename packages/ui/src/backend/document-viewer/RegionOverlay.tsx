'use client'

/**
 * Rectangles drawn ON a rendered page — "this value was read HERE".
 *
 * PURE GEOMETRY. It takes normalised boxes, the size the page is currently
 * rendered at, and which one is active. It knows nothing about PDFs, documents
 * or provenance, so it works over an `<img>` the day somebody wires it up.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE RULES ENCODED HERE WERE EACH PAID FOR WITH A SHIPPED DEFECT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **Frame the text, do not clip it.** 3px horizontal and 2px vertical padding.
 * A box drawn at exactly the measured extent sits on the glyphs and reads as a
 * strikethrough.
 *
 * **The fill is real alpha, never `mix-blend-mode`.** `multiply` is the nicer
 * mechanism and cannot be used: the box carries an entrance animation, a
 * transform creates a stacking context, and the blend then isolates from the
 * page behind it and degrades to a flat opaque fill that hides the very line it
 * points at.
 *
 * **A double stroke.** One coloured border vanishes when it lands on dark ink or
 * a table rule. The outer white ring separates the box from whatever it crosses.
 *
 * **`measured` is solid, `region` is dashed.** A word-level rectangle from the
 * text layer and an OCR block covering a paragraph are different claims, and
 * drawing them identically tells the reader the coarse one is exact.
 *
 * **Dark mode changes nothing.** The page is white paper either way.
 */

import * as React from 'react'

export type OverlayRegion = {
  /** Normalised to the page, top-left origin: `[x0, y0, x1, y1]`, each 0..1. */
  box: [number, number, number, number]
  /** `measured` — from the text layer. `region` — an OCR block, visibly coarser. */
  precision?: 'measured' | 'region'
  /** Free-form grouping key; the overlay only compares it with `activeKey`. */
  key?: string
  /** Drawn beside the frame when `showLabels` is on. */
  label?: string
}

export type RegionOverlayProps = {
  regions: OverlayRegion[]
  /** The size the page is CURRENTLY rendered at, in CSS pixels. */
  width: number
  height: number
  /** Which region group is selected. Others dim rather than disappear. */
  activeKey?: string | null
  /** Draw each frame's label. The "sweep the document" view. */
  showLabels?: boolean
  onRegionClick?: (key: string | undefined, index: number) => void
  className?: string
}

/** Frame the text, do not clip it. */
const PAD_X = 3
const PAD_Y = 2

export const RegionOverlay: React.FC<RegionOverlayProps> = ({
  regions,
  width,
  height,
  activeKey,
  showLabels = false,
  onRegionClick,
  className,
}) => {
  // Nothing to anchor to yet — a page that has not been measured would put every
  // box at 0×0 in the corner, which reads as a rendering bug.
  if (!width || !height || regions.length === 0) return null

  return (
    <div
      className={className}
      data-testid="region-overlay"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {regions.map((region, index) => {
        const [x0, y0, x1, y1] = region.box
        const left = x0 * width - PAD_X
        const top = y0 * height - PAD_Y
        const w = (x1 - x0) * width + PAD_X * 2
        const h = (y1 - y0) * height + PAD_Y * 2
        const isActive = activeKey != null && region.key === activeKey
        // Something is selected and it is not this one. Dimmed, not hidden: the
        // point of drawing them all is to see the shape of what was read.
        const isDimmed = activeKey != null && !isActive
        const dashed = region.precision === 'region'

        return (
          <div
            key={`${region.key ?? 'r'}-${index}`}
            data-testid="region-overlay-box"
            data-active={isActive ? 'true' : undefined}
            data-precision={region.precision ?? 'measured'}
            onClick={onRegionClick ? () => onRegionClick(region.key, index) : undefined}
            style={{
              position: 'absolute',
              left, top, width: w, height: h,
              borderRadius: 3,
              border: `2px ${dashed ? 'dashed' : 'solid'} ${isActive ? 'rgb(214 122 0)' : 'rgb(255 193 7)'}`,
              backgroundColor: isActive ? 'rgb(255 193 7 / 0.42)' : 'rgb(255 193 7 / 0.22)',
              // The white ring must hug the box, so it comes first.
              boxShadow: '0 0 0 1.5px rgb(255 255 255 / 0.95), 0 1px 4px rgb(0 0 0 / 0.28)',
              opacity: isDimmed ? 0.45 : 1,
              transition: 'opacity 150ms ease, background-color 150ms ease',
              pointerEvents: onRegionClick ? 'auto' : 'none',
              cursor: onRegionClick ? 'pointer' : undefined,
            }}
          >
            {showLabels && region.label ? (
              <span
                data-testid="region-overlay-label"
                style={{
                  position: 'absolute',
                  // ABOVE the box, not inside it: a label inside covers the
                  // words the frame exists to point at.
                  bottom: '100%',
                  left: -1,
                  marginBottom: 2,
                  maxWidth: 220,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  padding: '1px 4px',
                  borderRadius: 3,
                  backgroundColor: isActive ? 'rgb(120 66 0)' : 'rgb(64 51 20 / 0.92)',
                  color: '#fff',
                  fontSize: 10,
                  lineHeight: '14px',
                  fontWeight: 600,
                  pointerEvents: 'none',
                }}
              >
                {region.label}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export default RegionOverlay
