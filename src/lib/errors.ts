const NETWORK_ERROR = /failed to fetch|networkerror|load failed|network request failed/i

// Ошибки Supabase — обычные объекты с полем message, не экземпляры Error.
function messageOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : String(error ?? '')
}

export function isNetworkError(error: unknown): boolean {
  return NETWORK_ERROR.test(messageOf(error))
}

// Переводит ошибки Supabase/сети в понятный русский текст.
export function humanizeError(error: unknown): string {
  const message = messageOf(error)

  if (/invalid login credentials/i.test(message)) return 'Неверная почта или пароль'
  if (/email not confirmed/i.test(message)) return 'Почта не подтверждена — подтвердите пользователя в панели Supabase'
  if (NETWORK_ERROR.test(message)) return 'Нет связи с сервером. Проверьте интернет'
  if (/jwt expired/i.test(message)) return 'Сессия истекла — войдите заново'
  if (/row-level security/i.test(message)) return 'Нет доступа к данным (правила RLS)'

  return message || 'Неизвестная ошибка'
}
