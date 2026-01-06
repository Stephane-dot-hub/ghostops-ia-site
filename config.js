import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://isrxjzaphaciwdaxbylt.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzcnhqemFwaGFjaXdkYXhieWx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2ODI5NDAsImV4cCI6MjA4MzI1ODk0MH0.mPkEHEETgb4DMi4_LGQRkzIVlz6QoaLNvt6BXXSGoZQ'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
