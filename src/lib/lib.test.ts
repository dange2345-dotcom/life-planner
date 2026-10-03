import { describe, expect, it } from 'vitest'
import { deviceLabel } from './device'
import { humanizeError } from './errors'

describe('deviceLabel', () => {
  it('распознаёт iPhone и Windows', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('iPhone')
    expect(
      deviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
      ),
    ).toBe('Windows')
  })

  it('возвращает запасную подпись для неизвестного устройства', () => {
    expect(deviceLabel('curl/8.0')).toBe('Устройство')
  })
})

describe('humanizeError', () => {
  it('переводит типовые ошибки', () => {
    expect(humanizeError(new Error('Invalid login credentials'))).toBe('Неверная почта или пароль')
    expect(humanizeError(new TypeError('Failed to fetch'))).toBe('Нет связи с сервером. Проверьте интернет')
    expect(humanizeError(new TypeError('Load failed'))).toBe('Нет связи с сервером. Проверьте интернет')
  })

  it('понимает ошибки Supabase — обычные объекты с message', () => {
    expect(humanizeError({ message: 'Invalid login credentials', status: 400 })).toBe('Неверная почта или пароль')
    expect(humanizeError({ message: 'new row violates row-level security policy', code: '42501' })).toBe(
      'Нет доступа к данным (правила RLS)',
    )
  })

  it('возвращает исходный текст для неизвестных ошибок', () => {
    expect(humanizeError(new Error('Something odd'))).toBe('Something odd')
    expect(humanizeError(undefined)).toBe('Неизвестная ошибка')
  })
})
