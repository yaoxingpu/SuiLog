import { CryptoService } from "./crypto"

const STORAGE_PREFIX = "suilog:vault:"
const SESSION_PREFIX = "suilog:vault-session:"
const ITERATIONS = 210000

type VaultMeta = {
  version: 1
  salt: string
  iv: string
  cipher: string
  iterations: number
  createdAt: number
}

function storageKey(address: string) {
  return `${STORAGE_PREFIX}${address}`
}

function sessionKey(address: string) {
  return `${SESSION_PREFIX}${address}`
}

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export class VaultService {
  static hasVault(address: string): boolean {
    return !!localStorage.getItem(storageKey(address))
  }

  static loadMeta(address: string): VaultMeta | null {
    const raw = localStorage.getItem(storageKey(address))
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as VaultMeta
      if (!parsed || parsed.version !== 1) return null
      return parsed
    } catch {
      return null
    }
  }

  static async createVault(address: string, password: string): Promise<CryptoKey> {
    const salt = window.crypto.getRandomValues(new Uint8Array(16))
    const vaultRaw = window.crypto.getRandomValues(new Uint8Array(32))
    const vaultKey = await CryptoService.importKey(vaultRaw)
    const passwordKey = await CryptoService.deriveKeyFromPassword(password, salt, ITERATIONS)
    const iv = window.crypto.getRandomValues(new Uint8Array(12))
    const cipher = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      passwordKey,
      vaultRaw
    )

    const meta: VaultMeta = {
      version: 1,
      salt: toBase64(salt),
      iv: toBase64(iv),
      cipher: toBase64(new Uint8Array(cipher)),
      iterations: ITERATIONS,
      createdAt: Date.now()
    }

    localStorage.setItem(storageKey(address), JSON.stringify(meta))
    return vaultKey
  }

  static async unlockVault(address: string, password: string): Promise<CryptoKey> {
    const meta = VaultService.loadMeta(address)
    if (!meta) {
      throw new Error("未找到保险库")
    }

    const salt = fromBase64(meta.salt)
    const iv = fromBase64(meta.iv)
    const cipher = fromBase64(meta.cipher)
    const passwordKey = await CryptoService.deriveKeyFromPassword(password, salt, meta.iterations)
    const raw = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      passwordKey,
      cipher
    )
    return CryptoService.importKey(new Uint8Array(raw))
  }

  static clearVault(address: string) {
    localStorage.removeItem(storageKey(address))
  }

  static async saveSessionKey(address: string, key: CryptoKey) {
    const raw = await CryptoService.exportKey(key)
    sessionStorage.setItem(sessionKey(address), toBase64(raw))
  }

  static async loadSessionKey(address: string): Promise<CryptoKey | null> {
    const raw = sessionStorage.getItem(sessionKey(address))
    if (!raw) return null
    try {
      return await CryptoService.importKey(fromBase64(raw))
    } catch {
      return null
    }
  }

  static clearSessionKey(address: string) {
    sessionStorage.removeItem(sessionKey(address))
  }
}
