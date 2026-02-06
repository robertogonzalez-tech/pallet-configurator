import { createClient } from '@supabase/supabase-js'

// Supabase client - will be configured with env vars
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabase = supabaseUrl && supabaseAnonKey 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

// Check if Supabase is configured
export const isSupabaseConfigured = () => {
  return Boolean(supabaseUrl && supabaseAnonKey)
}

// Export config status for UI feedback
export const getSupabaseStatus = () => {
  if (!supabaseUrl) return { configured: false, reason: 'VITE_SUPABASE_URL not set' }
  if (!supabaseAnonKey) return { configured: false, reason: 'VITE_SUPABASE_ANON_KEY not set' }
  return { configured: true, reason: 'Connected' }
}
