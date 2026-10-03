// Подпись устройства для отладочных записей синхронизации (не для логики интерфейса —
// там решают media-запросы, а не user agent).
export function deviceLabel(userAgent: string): string {
  if (/iPhone/.test(userAgent)) return 'iPhone'
  if (/iPad/.test(userAgent)) return 'iPad'
  if (/Windows/.test(userAgent)) return 'Windows'
  if (/Android/.test(userAgent)) return 'Android'
  if (/Mac OS X/.test(userAgent)) return 'Mac'
  return 'Устройство'
}
