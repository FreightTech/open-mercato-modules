/**
 * BIC Facility Code API v2 Client
 * 
 * Provides facility enrichment data (coordinates, addresses, operator names)
 * from the BIC Facility Code Database.
 * 
 * API Documentation: https://app.swaggerhub.com/apis/BIC-ORG/Facility-Codes/2.0.1
 */

// ─── Types ───────────────────────────────────────────────────

export interface BicTokenResponse {
  accessToken: string
  access_token: string  // Also provided for compatibility
  accessTokenExpiresAt: string  // ISO datetime
}

export interface BicAddress {
  street?: string
  city?: string
  postcode?: string
  state?: string
  country?: string
}

export interface BicCoordinates {
  latitude: string   // Note: strings in BIC API, need to parse
  longitude: string
}

export interface BicFacilityDetails {
  name: string
  address?: BicAddress
  formattedAddress?: string
  geographicalCoordinate?: BicCoordinates
}

export interface BicOperator {
  name: string
}

export interface BicFacility {
  code: string
  codeProvider: 'BIC' | 'SMDG'
  countryCode: string
  unLocode: string
  aliasCode?: string  // If this code is deprecated
  codeListProviderCode?: string  // Short code for SMDG
  operator?: BicOperator
  facility?: BicFacilityDetails
}

export interface BicClientConfig {
  baseUrl: string
  username: string
  password: string
}

// ─── Client ──────────────────────────────────────────────────

export class BicApiClient {
  private baseUrl: string
  private username: string
  private password: string
  private accessToken: string | null = null
  private tokenExpiresAt: Date | null = null

  constructor(config: BicClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')  // Remove trailing slash
    this.username = config.username
    this.password = config.password
  }

  /**
   * Get OAuth2 token via Basic Auth
   */
  private async getToken(): Promise<string> {
    const now = new Date()
    // Refresh if token expires in less than 60 seconds
    if (this.accessToken && this.tokenExpiresAt && this.tokenExpiresAt > new Date(now.getTime() + 60_000)) {
      return this.accessToken
    }

    const credentials = Buffer.from(`${this.username}:${this.password}`).toString('base64')

    const response = await fetch(`${this.baseUrl}/v2/oauth/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`BIC OAuth failed: ${response.status} - ${text}`)
    }

    const data: BicTokenResponse = await response.json()
    this.accessToken = data.accessToken || data.access_token
    this.tokenExpiresAt = new Date(data.accessTokenExpiresAt)
    return this.accessToken
  }

  /**
   * Look up facility by code
   * 
   * @param facilityCode - The facility code (BIC: 9 chars, SMDG: varies)
   * @param codeProvider - 'BIC' or 'SMDG'
   * @param unlocode - Required for SMDG codes to build the full lookup code
   * @returns Facility data or null if not found
   */
  async getFacility(
    facilityCode: string,
    codeProvider: 'BIC' | 'SMDG',
    unlocode?: string
  ): Promise<BicFacility | null> {
    const token = await this.getToken()

    // Build lookup code:
    // - BIC codes are already complete (9 chars)
    // - SMDG codes need unlocode prefix (e.g., "PLGDY" + "DCT" = "PLGDYDCT")
    const lookupCode = codeProvider === 'SMDG' && unlocode
      ? `${unlocode}${facilityCode}`
      : facilityCode

    const url = `${this.baseUrl}/v2/facilities/${lookupCode}?codeProvider=${codeProvider}`

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`BIC API error: ${response.status} - ${text}`)
    }

    return response.json()
  }

  /**
   * Test connection by fetching a token
   * @returns true if authentication succeeds
   */
  async testConnection(): Promise<boolean> {
    await this.getToken()
    return true
  }

  // ─── Static Helpers ──────────────────────────────────────────

  /**
   * Parse coordinates from BIC response (strings to numbers)
   */
  static parseCoordinates(facility: BicFacility): { latitude: number; longitude: number } | null {
    const coords = facility.facility?.geographicalCoordinate
    if (!coords?.latitude || !coords?.longitude) return null

    const lat = parseFloat(coords.latitude)
    const lng = parseFloat(coords.longitude)

    if (isNaN(lat) || isNaN(lng)) return null
    return { latitude: lat, longitude: lng }
  }

  /**
   * Format address from BIC response
   */
  static formatAddress(facility: BicFacility): string | null {
    // Prefer formatted address if available
    if (facility.facility?.formattedAddress) {
      return facility.facility.formattedAddress
    }

    const addr = facility.facility?.address
    if (!addr) return null

    const parts = [addr.street, addr.city, addr.state, addr.postcode, addr.country]
    return parts.filter(Boolean).join(', ') || null
  }

  /**
   * Get facility name from BIC response
   */
  static getFacilityName(facility: BicFacility): string | null {
    return facility.facility?.name || null
  }

  /**
   * Get operator name from BIC response
   */
  static getOperatorName(facility: BicFacility): string | null {
    return facility.operator?.name || null
  }
}
