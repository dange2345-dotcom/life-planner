// Переводит ошибки Supabase/сети в понятный русский текст.
// Ошибки Supabase — обычные объекты с полем message, не экземпляры Error.
export function humanizeError(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error ?? '')

  if (/invalid login credentials/i.test(message)) return 'Неверная почта или пароль'
  if (/email not confirmed/i.test(message)) return 'Почта не подтверждена — подтвердите пользователя в панели Supabase'
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return 'Нет связи с сервером. Проверьте интернет'
  }
  if (/jwt expired/i.test(message)) return 'Сессия истекла — войдите заново'
  if (/row-level security/i.test(message)) return 'Нет доступа к данным (правила RLS)'

  return message || 'Неизвестная ошибка'
}
