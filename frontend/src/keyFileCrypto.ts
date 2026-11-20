/**
 * Криптографічний модуль для безпарольного входу за файловим ключем (.key)
 * на базі Web Crypto API (AKP-KEY-V1):
 * - Алгоритм підпису: ECDSA P-256 (SHA-256)
 * - Захист приватного ключа: PBKDF2 (SHA-256, 100 000 ітерацій) + AES-256-GCM
 * - Приватні ключі розшифровуються виключно в пам'яті браузера і ніколи не передаються на сервер
 */

export interface KeyFileCryptoInfo {
  kdf: string
  hash: string
  iterations: number
  salt: string // base64
  cipher: string
  iv: string // base64
  ciphertext: string // base64
  public_key: string // PEM
}

export interface KeyFileContainer {
  format: 'AKP-KEY-V1'
  user_login: string
  role?: string
  fingerprint: string
  created_at: string
  crypto: KeyFileCryptoInfo
}

export function b64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64.trim())
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

export function uint8ToB64(arr: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i])
  return btoa(bin)
}

/**
 * Валідує та парсить вміст файлу .key
 */
export function parseKeyFile(rawText: string): KeyFileContainer {
  let data: unknown
  try {
    data = JSON.parse(rawText)
  } catch {
    throw new Error('Файл не є дійсним JSON-документом.')
  }

  const container = data as KeyFileContainer
  if (!container || container.format !== 'AKP-KEY-V1') {
    throw new Error('Невірний формат ключа (очікується контейнер AKP-KEY-V1).')
  }

  if (!container.user_login || !container.fingerprint || !container.crypto) {
    throw new Error('Файл ключа пошкоджений або містить неповні метадані.')
  }

  const { salt, iv, ciphertext, public_key } = container.crypto
  if (!salt || !iv || !ciphertext || !public_key) {
    throw new Error('Криптографічний контейнер ключа пошкоджений.')
  }

  return container
}

/**
 * Локальне розшифрування приватного ключа паролем та підпис виклику (challenge)
 */
export async function decryptAndSignChallenge(
  keyContainer: KeyFileContainer,
  password: string,
  challengeB64: string
): Promise<string> {
  if (!password) {
    throw new Error('Будь ласка, введіть пароль захисту ключа.')
  }

  const cryptoSubtle = window.crypto?.subtle
  if (!cryptoSubtle) {
    throw new Error('Web Crypto API недоступний у цьому браузері (потрібне безпечне зʼєднання HTTPS).')
  }

  const { salt, iv, ciphertext, iterations } = keyContainer.crypto

  // 1. Імпорт введеного пароля як базового ключа для PBKDF2
  const pwKey = await cryptoSubtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  // 2. Деривація симетричного ключа AES-256-GCM
  const aesKey = await cryptoSubtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: b64ToUint8(salt) as unknown as BufferSource,
      iterations: iterations || 100000,
      hash: 'SHA-256',
    },
    pwKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )

  // 3. Розшифрування PKCS#8 DER приватного ключа
  let decryptedPkcs8: ArrayBuffer
  try {
    decryptedPkcs8 = await cryptoSubtle.decrypt(
      {
        name: 'AES-GCM',
        iv: b64ToUint8(iv) as unknown as BufferSource,
      },
      aesKey,
      b64ToUint8(ciphertext) as unknown as BufferSource
    )
  } catch {
    throw new Error('Невірний пароль від файлу ключа.')
  }

  // 4. Імпорт приватного ключа ECDSA P-256
  let privateKey: CryptoKey
  try {
    privateKey = await cryptoSubtle.importKey(
      'pkcs8',
      decryptedPkcs8,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    )
  } catch (err) {
    throw new Error('Помилка імпорту приватного ключа ECDSA: ' + (err as Error).message)
  }

  // 5. Підпис байтів виклику (IEEE P1363 64-байти)
  const challengeBytes = b64ToUint8(challengeB64)
  const sigBuffer = await cryptoSubtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privateKey,
    challengeBytes as unknown as BufferSource
  )


  return uint8ToB64(new Uint8Array(sigBuffer))
}

/**
 * Генерація нової пари ключів ECDSA P-256, шифрування приватного ключа паролем
 * та повернення готового контейнера AKP-KEY-V1
 */
export async function generateKeyFile(
  userLogin: string,
  role: string,
  password: string
): Promise<{ keyFile: KeyFileContainer; filename: string }> {
  if (!password || password.length < 4) {
    throw new Error('Пароль захисту ключа має містити щонайменше 4 символи.')
  }

  const cryptoSubtle = window.crypto?.subtle
  if (!cryptoSubtle) {
    throw new Error('Web Crypto API недоступний у цьому браузері.')
  }

  // 1. Генерація асиметричної пари ключів ECDSA P-256
  const keyPair = await cryptoSubtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )

  // 2. Експорт публічного ключа (SPKI)
  const spkiBuffer = await cryptoSubtle.exportKey('spki', keyPair.publicKey)
  const spkiBytes = new Uint8Array(spkiBuffer)
  const spkiB64 = uint8ToB64(spkiBytes)

  // Форматування у стандартний PEM
  const pemLines = spkiB64.match(/.{1,64}/g) || [spkiB64]
  const publicPem = `-----BEGIN PUBLIC KEY-----\n${pemLines.join('\n')}\n-----END PUBLIC KEY-----\n`

  // 3. Обчислення відбитка SHA-256
  const fpBuffer = await cryptoSubtle.digest('SHA-256', spkiBuffer)
  const fingerprint = Array.from(new Uint8Array(fpBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  // 4. Експорт приватного ключа (PKCS#8)
  const pkcs8Buffer = await cryptoSubtle.exportKey('pkcs8', keyPair.privateKey)

  // 5. Генерація солі (16 байт) та вектора ініціалізації (12 байт)
  const salt = window.crypto.getRandomValues(new Uint8Array(16))
  const iv = window.crypto.getRandomValues(new Uint8Array(12))

  // 6. Деривація симетричного ключа AES-256-GCM з пароля
  const pwKey = await cryptoSubtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  const aesKey = await cryptoSubtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    pwKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )

  // 7. Шифрування приватного ключа
  const encryptedBuffer = await cryptoSubtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    aesKey,
    pkcs8Buffer as unknown as BufferSource
  )

  const cleanLogin = userLogin.trim().toLowerCase()
  const keyFile: KeyFileContainer = {
    format: 'AKP-KEY-V1',
    user_login: cleanLogin,
    role: role || 'VYK',
    fingerprint,
    created_at: new Date().toISOString(),
    crypto: {
      kdf: 'PBKDF2',
      hash: 'SHA-256',
      iterations: 100000,
      salt: uint8ToB64(salt),
      cipher: 'AES-256-GCM',
      iv: uint8ToB64(iv),
      ciphertext: uint8ToB64(new Uint8Array(encryptedBuffer)),
      public_key: publicPem,
    },
  }

  const filename = `akp_${cleanLogin}.key`
  return { keyFile, filename }
}

/**
 * Ініціює завантаження файлу .key на комп'ютер користувача
 */
export function downloadKeyFile(keyFile: KeyFileContainer, filename?: string): void {
  const name = filename || `akp_${keyFile.user_login.toLowerCase()}.key`
  const blob = new Blob([JSON.stringify(keyFile, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
