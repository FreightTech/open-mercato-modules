/**
 * Carrier logo assets for shipment tracking.
 *
 * These images are bundled with the package and imported as static assets.
 * When used with Next.js (via transpilePackages), they work with next/image
 * for automatic optimization.
 */

import maerskLogo from './carriers/maersk.png'
import mscLogo from './carriers/msc.png'
import oneLogo from './carriers/one.png'
import cmaCgmLogo from './carriers/cma_cgm.png'
import hapagLloydLogo from './carriers/hapag_lloyd.png'
import coscoLogo from './carriers/cosco.png'
import evergreenLogo from './carriers/evergreen.png'
import ooclLogo from './carriers/oocl.png'
import zimLogo from './carriers/zim.png'
import yangMingLogo from './carriers/yang_ming.png'

export const carrierLogos = {
  maersk: maerskLogo,
  maeu: maerskLogo,
  msc: mscLogo,
  mscu: mscLogo,
  one: oneLogo,
  oney: oneLogo,
  'cma-cgm': cmaCgmLogo,
  cmdu: cmaCgmLogo,
  'hapag-lloyd': hapagLloydLogo,
  hlcu: hapagLloydLogo,
  cosco: coscoLogo,
  cosu: coscoLogo,
  evergreen: evergreenLogo,
  eglv: evergreenLogo,
  oocl: ooclLogo,
  oolu: ooclLogo,
  zim: zimLogo,
  zimu: zimLogo,
  'yang-ming': yangMingLogo,
  ymlu: yangMingLogo,
} as const

export type CarrierCode = keyof typeof carrierLogos

/**
 * Get the carrier logo StaticImageData for a given carrier code.
 * Returns undefined if the carrier code is not recognized.
 */
export function getCarrierLogo(carrierCode: string | null | undefined) {
  if (!carrierCode) return undefined
  const code = carrierCode.toLowerCase() as CarrierCode
  return carrierLogos[code]
}

export {
  maerskLogo,
  mscLogo,
  oneLogo,
  cmaCgmLogo,
  hapagLloydLogo,
  coscoLogo,
  evergreenLogo,
  ooclLogo,
  zimLogo,
  yangMingLogo,
}
