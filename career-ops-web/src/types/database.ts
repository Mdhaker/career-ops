export type ApplicationStatus =
  | 'Evaluated'
  | 'Applied'
  | 'Responded'
  | 'Interview'
  | 'Offer'
  | 'Rejected'
  | 'Discarded'
  | 'SKIP'

export type LegitimacyTier = 'High Confidence' | 'Proceed with Caution' | 'Suspicious'

export type Archetype =
  | 'AI Platform / LLMOps'
  | 'Agentic / Automation'
  | 'Technical AI PM'
  | 'AI Solutions Architect'
  | 'AI Forward Deployed'
  | 'AI Transformation'

export interface Profile {
  id: string
  user_id: string
  full_name: string
  email: string
  phone: string | null
  location: string | null
  linkedin: string | null
  portfolio_url: string | null
  github: string | null
  target_roles: string[]
  archetypes: ProfileArchetype[]
  headline: string | null
  exit_story: string | null
  superpowers: string[]
  proof_points: ProofPoint[]
  comp_target: string | null
  comp_minimum: string | null
  comp_currency: string
  remote_preference: string | null
  visa_status: string | null
  cv_markdown: string | null
  created_at: string
  updated_at: string
}

export interface ProfileArchetype {
  name: string
  level: string
  fit: 'primary' | 'secondary' | 'adjacent'
}

export interface ProofPoint {
  name: string
  url: string
  hero_metric: string
}

export interface Application {
  id: string
  user_id: string
  seq_num: number
  date: string
  company: string
  role: string
  score: number | null
  status: ApplicationStatus
  pdf_url: string | null
  report_url: string | null
  report_content: string | null
  url: string | null
  archetype: Archetype | null
  legitimacy: LegitimacyTier | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface FollowUp {
  id: string
  user_id: string
  application_id: string
  date: string
  channel: 'Email' | 'LinkedIn' | 'Other'
  contact: string | null
  notes: string | null
  created_at: string
}

export interface TrackedCompany {
  id: string
  user_id: string
  name: string
  careers_url: string
  api_url: string | null
  api_provider: 'greenhouse' | 'ashby' | 'lever' | 'bamboohr' | 'teamtailor' | 'workday' | null
  scan_method: 'playwright' | 'api' | 'websearch'
  notes: string | null
  enabled: boolean
  last_scanned_at: string | null
  created_at: string
}

export interface SearchQuery {
  id: string
  user_id: string
  name: string
  query: string
  enabled: boolean
  created_at: string
}

export interface TitleFilter {
  id: string
  user_id: string
  positive: string[]
  negative: string[]
  seniority_boost: string[]
  updated_at: string
}

export interface ScanRun {
  id: string
  user_id: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'completed' | 'failed'
  new_count: number
  filtered_count: number
  skipped_dup_count: number
  skipped_expired_count: number
  log: string | null
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Omit<Profile, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Profile, 'id' | 'user_id' | 'created_at'>>
      }
      applications: {
        Row: Application
        Insert: Omit<Application, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Application, 'id' | 'user_id' | 'created_at'>>
      }
      follow_ups: {
        Row: FollowUp
        Insert: Omit<FollowUp, 'id' | 'created_at'>
        Update: Partial<Omit<FollowUp, 'id' | 'user_id' | 'created_at'>>
      }
      tracked_companies: {
        Row: TrackedCompany
        Insert: Omit<TrackedCompany, 'id' | 'created_at'>
        Update: Partial<Omit<TrackedCompany, 'id' | 'user_id' | 'created_at'>>
      }
      search_queries: {
        Row: SearchQuery
        Insert: Omit<SearchQuery, 'id' | 'created_at'>
        Update: Partial<Omit<SearchQuery, 'id' | 'user_id' | 'created_at'>>
      }
      title_filters: {
        Row: TitleFilter
        Insert: Omit<TitleFilter, 'id' | 'updated_at'>
        Update: Partial<Omit<TitleFilter, 'id' | 'user_id'>>
      }
      scan_runs: {
        Row: ScanRun
        Insert: Omit<ScanRun, 'id'>
        Update: Partial<Omit<ScanRun, 'id' | 'user_id'>>
      }
    }
  }
}
