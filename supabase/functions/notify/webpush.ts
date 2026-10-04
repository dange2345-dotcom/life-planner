// Отправка Web Push на чистом WebCrypto — без библиотек, поэтому одинаково работает в Supabase Edge Functions (Deno)
// и в тестах (Node). Шифрование — RFC 8291 (aes128gcm), подпись сервера — VAPID (RFC 8292).

type Bytes = Uint8Array<ArrayBuffer>

const encoder = new TextEncoder()
const text = (value: string): Bytes => encoder.encode(value) as Bytes

export function b64urlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlDecode(value: string): Bytes {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data))
}

const ONE = new Uint8Array([1])

export interface PushKeys {
  /** Открытый ключ браузера (P-256, 65 байт, base64url). */
  p256dh: string
  /** Секрет аутентификации (16 байт, base64url). */
  auth: string
}

export interface PushTarget {
  endpoint: string
  keys: PushKeys
}

/** Зашифровать сообщение для браузера (RFC 8291). salt и ключи сервера подставляются только в тестах. */
export async function encryptPayload(
  payload: Bytes,
  keys: PushKeys,
  fixed: { salt?: Bytes; serverKeys?: CryptoKeyPair } = {},
): Promise<Bytes> {
  const uaPublic = b64urlDecode(keys.p256dh)
  const authSecret = b64urlDecode(keys.auth)
  const salt = fixed.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const serverKeys =
    fixed.serverKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair)
  const asPublic: Bytes = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey))

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared: Bytes = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, serverKeys.privateKey, 256))

  const prkKey = await hmac(authSecret, shared)
  const ikm = await hmac(prkKey, concat(text('WebPush: info\0'), uaPublic, asPublic, ONE))
  const prk = await hmac(salt, ikm)
  const cek = (await hmac(prk, concat(text('Content-Encoding: aes128gcm\0'), ONE))).slice(0, 16)
  const nonce = (await hmac(prk, concat(text('Content-Encoding: nonce\0'), ONE))).slice(0, 12)

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // 0x02 — разделитель последней (единственной) записи.
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concat(payload, new Uint8Array([2]))))

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.length
  header.set(asPublic, 21)
  return concat(header, ciphertext)
}

export interface Vapid {
  /** Открытый ключ сервера (P-256, 65 байт, base64url) — тот же, что в приложении (src/config.ts). */
  publicKey: string
  /** Закрытый ключ: число d (32 байта, base64url). */
  privateKey: string
  /** Контакт для служб пушей: https-адрес или mailto. */
  subject: string
}

/** Заголовок Authorization: подписанный токен VAPID для службы пушей (Apple, Microsoft, Google). */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, now = Date.now()): Promise<string> {
  const header = b64urlEncode(text(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64urlEncode(
    text(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject })),
  )
  const raw = b64urlDecode(vapid.publicKey)
  const jwk = { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: b64urlEncode(raw.slice(1, 33)), y: b64urlEncode(raw.slice(33, 65)) }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, text(`${header}.${claims}`)))
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${vapid.publicKey}`
}

export interface PushMessage {
  title: string
  body: string
  /** Уведомление с тем же tag заменяет предыдущее, а не копится рядом. */
  tag?: string
  /** Что открыть по нажатию, относительно приложения, например «#/tasks». */
  url?: string
}

export interface SendResult {
  ok: boolean
  status: number
  /** Подписка больше не действует (приложение удалено, разрешение отозвано) — её надо забыть. */
  gone: boolean
  error?: string
}

export async function sendPush(
  target: PushTarget,
  message: PushMessage,
  vapid: Vapid,
  options: { ttl?: number; urgency?: 'normal' | 'high' } = {},
): Promise<SendResult> {
  const body = await encryptPayload(text(JSON.stringify(message)), target.keys)
  const response = await fetch(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(options.ttl ?? 3600),
      Urgency: options.urgency ?? 'high',
    },
    body,
  })
  const gone = response.status === 404 || response.status === 410
  const error = response.ok ? undefined : (await response.text().catch(() => '')).slice(0, 300) || response.statusText
  return { ok: response.ok, status: response.status, gone, error }
}
