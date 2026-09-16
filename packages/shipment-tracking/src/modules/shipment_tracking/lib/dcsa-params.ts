import type { TrackingReferenceType } from '../data/entities'

export function buildDcsaQueryParams(referenceValue: string, referenceType: TrackingReferenceType): string {
  switch (referenceType) {
    case 'container':
      return `equipmentReference=${encodeURIComponent(referenceValue)}`
    case 'booking':
      return `carrierBookingReference=${encodeURIComponent(referenceValue)}`
    case 'bol':
      return `transportDocumentReference=${encodeURIComponent(referenceValue)}`
    default:
      return `transportDocumentReference=${encodeURIComponent(referenceValue)}`
  }
}
