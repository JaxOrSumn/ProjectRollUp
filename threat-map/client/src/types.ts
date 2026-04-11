export type ThreatCategory =
  | 'mass_violence'
  | 'terrorism'
  | 'insurgency'
  | 'sabotage'
  | 'organized_crime'

export interface ThreatEvent {
  id: string
  headline: string
  category: ThreatCategory
  lat: number
  lon: number
  location_name: string
  source_outlet: string
  source_url: string
  occurred_at: string   // ISO timestamp
  ingested_at: string   // ISO timestamp
}

export interface FilterState {
  categories: Set<ThreatCategory>
  timeRange: '24h' | '7d' | '30d'
}
