import { describe, expect, it } from 'vitest'
import { b64urlDecode, b64urlEncode, encryptPayload, vapidAuthorization } from './webpush.ts'

// Пример из RFC 8291, раздел 5 — если шифрование совпадает байт в байт, браузеры его расшифруют.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

async function serverKeysFromRfc(): Promise<CryptoKeyPair> {
  const raw = b64urlDecode(RFC.asPublic)
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: RFC.asPrivate,
    x: b64urlEncode(raw.slice(1, 33)),
    y: b64urlEncode(raw.slice(33, 65)),
  }
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const publicKey = await crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
  return { privateKey, publicKey }
}

describe('Web Push', () => {
  it('шифрует ровно как в примере RFC 8291', async () => {
    const body = await encryptPayload(
      new TextEncoder().encode(RFC.plaintext) as Uint8Array<ArrayBuffer>,
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      { salt: b64urlDecode(RFC.salt), serverKeys: await serverKeysFromRfc() },
    )
    expect(b64urlEncode(body)).toBe(RFC.body)
  })

  it('подписывает VAPID-токен, который проверяется открытым ключом', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    const vapid = {
      publicKey: b64urlEncode(publicRaw),
      privateKey: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d!,
      subject: 'https://example.com/',
    }
    const header = await vapidAuthorization('https://web.push.apple.com/abc', vapid, Date.UTC(2026, 9, 4))
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)
    expect(match).not.toBeNull()
    const [, head, claims, signature, k] = match!
    expect(k).toBe(vapid.publicKey)
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(claims)))).toEqual({
      aud: 'https://web.push.apple.com',
      exp: Date.UTC(2026, 9, 4) / 1000 + 12 * 3600,
      sub: 'https://example.com/',
    })
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      b64urlDecode(signature),
      new TextEncoder().encode(`${head}.${claims}`),
    )
    expect(valid).toBe(true)
  })
})
