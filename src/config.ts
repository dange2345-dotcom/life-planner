// Адрес проекта Supabase и его публичный ключ (Settings → API Keys → Publishable key).
// Ключ публичный по задумке Supabase: доступ к данным закрыт входом по паролю и правилами RLS
// (см. supabase/schema.sql), поэтому хранить его в открытом репозитории безопасно.
// Секретный ключ (secret / service_role) сюда класть НЕЛЬЗЯ.
export const SUPABASE_URL = 'https://cswqkcgmjlulvjojkjqz.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_hYW2_g6JOtHPam97IEgs1g_cxYpDp5f'

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY)
