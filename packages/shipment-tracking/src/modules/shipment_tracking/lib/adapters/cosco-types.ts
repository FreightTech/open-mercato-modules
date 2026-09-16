export type CoscoShipmentData = {
  shipmentContent?: string
  containerDetail?: CoscoContainer[] | CoscoContainer
  queryCriteria?: {
    bookingNumber?: string
  }
  billOfLadingNumber?: string[]
}

export type CoscoContainer = {
  containerNumber?: {
    containerNumber: string
  }
  event?: CoscoEvent[]
  externalReference?: CoscoExternalReference[]
  route?: {
    shipmentLeg?: CoscoShipmentLeg[]
  }
}

export type CoscoEvent = {
  CSEvent?: {
    CSEventCode: string
  }
  eventDescription?: string
  carrEventCode?: string
  eventDT?: CoscoDateTime
  eventReceivedDT?: CoscoDateTime
  location?: CoscoLocation
  mode?: string
  containerNumber?: string
}

export type CoscoExternalReference = {
  CSReferenceType?: {
    value: string
  }
  referenceNumber: string
}

export type CoscoDateTime = {
  GMT?: {
    text: string
  }
  locDT?: {
    text?: string
    _value?: {
      time: string
    }
  }
}

export type CoscoDateTimeIndicator = {
  indicator?: {
    value: 'E' | 'A'
  }
  GMT?: {
    text: string
  }
  locDT?: {
    text: string
  }
}

export type CoscoLocation = {
  locationName?: string
  cityDetails?: CoscoCityDetails
  facility?: CoscoFacility
  CSStandardCity?: {
    CSCountryCode?: string
  }
}

export type CoscoCityDetails = {
  city?: string
  country?: string
  state?: string
  portName?: string
  locationCode?: {
    UNLocationCode: string
  }
}

export type CoscoFacility = {
  facilityCode?: string
  facilityName?: string
}

export type CoscoShipmentLeg = {
  legSeq?: number
  POL?: CoscoPort
  POD?: CoscoPort
  SVVD?: CoscoSVVD
  arrivalDT?: CoscoDateTimeIndicator[]
  departureDT?: CoscoDateTimeIndicator[]
}

export type CoscoPort = {
  port?: {
    portName?: string
    city?: string
    country?: string
    state?: string
    locationCode?: {
      UNLocationCode: string
    }
  }
  facility?: CoscoFacility
}

export type CoscoSVVD = {
  loading?: CoscoVesselInfo
  discharge?: CoscoVesselInfo
}

export type CoscoVesselInfo = {
  vesselName: string
  lloydsNumber?: string
  callSign?: string
  vessel?: string
  voyage?: string
  service?: string
  direction?: string
  callNumber?: string
}

export type ExtractedVesselData = {
  vesselName: string
  vesselIMONumber?: string
  vesselCallSign?: string
  vesselCode?: string
  voyage?: string
  service?: string
  direction?: string
  legType?: 'loading' | 'discharge'
  legSequence?: number
  pol?: string
  pod?: string
}

export type DcsaEventMapping = {
  eventType: string
  eventCode: string
  eventClassification: string
}
