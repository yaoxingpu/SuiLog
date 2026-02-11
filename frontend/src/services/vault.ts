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

export type VaultBackup = {
  version: 1
  address: string
  meta: VaultMeta
  exportedAt: number
}

function storageKey(address: string) {
  return `${STORAGE_PREFIX}${address}`
}

function sessionKey(address: string) {
  return `${SESSION_PREFIX}${address}`
}

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) {
    binary += String.fromCharCode(b)
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
    const cipherArray = new Uint8Array(cipher)
    const cipherPayload = cipherArray.buffer
    const raw = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      passwordKey,
      cipherPayload
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

  // Re-wrap vault key with a new password; does not change vault key itself
  static async changePassword(address: string, oldPassword: string, newPassword: string): Promise<void> {
    const meta = VaultService.loadMeta(address)
    if (!meta) {
      throw new Error("未找到保险库")
    }
    const saltOld = fromBase64(meta.salt)
    const ivOld = fromBase64(meta.iv)
    const cipherOld = fromBase64(meta.cipher)
    const oldKey = await CryptoService.deriveKeyFromPassword(oldPassword, saltOld, meta.iterations)
    const cipherOldPayload = new Uint8Array(cipherOld).buffer
    const raw = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivOld as unknown as BufferSource },
      oldKey,
      cipherOldPayload
    )

    const saltNew = window.crypto.getRandomValues(new Uint8Array(16))
    const ivNew = window.crypto.getRandomValues(new Uint8Array(12))
    const newKey = await CryptoService.deriveKeyFromPassword(newPassword, saltNew, ITERATIONS)
    const cipherNew = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: ivNew as unknown as BufferSource },
      newKey,
      raw
    )

    const newMeta: VaultMeta = {
      version: 1,
      salt: toBase64(saltNew),
      iv: toBase64(ivNew),
      cipher: toBase64(new Uint8Array(cipherNew)),
      iterations: ITERATIONS,
      createdAt: Date.now()
    }
    localStorage.setItem(storageKey(address), JSON.stringify(newMeta))
    const vaultKey = await CryptoService.importKey(new Uint8Array(raw))
    await VaultService.saveSessionKey(address, vaultKey)
  }

  static exportVault(address: string): string {
    const meta = VaultService.loadMeta(address)
    if (!meta) throw new Error("未找到保险库")
    const backup: VaultBackup = {
      version: 1,
      address,
      meta,
      exportedAt: Date.now()
    }
    return JSON.stringify(backup)
  }

  static importVault(address: string, payload: string) {
    let parsed: VaultBackup
    try {
      parsed = JSON.parse(payload) as VaultBackup
    } catch {
      throw new Error("备份文件格式错误")
    }
    if (!parsed || parsed.version !== 1 || !parsed.meta) {
      throw new Error("备份版本不兼容")
    }
    if (parsed.address !== address) {
      throw new Error("备份与当前地址不匹配")
    }
    if (parsed.meta.version !== 1) {
      throw new Error("保险库版本不兼容")
    }
    localStorage.setItem(storageKey(address), JSON.stringify(parsed.meta))
    VaultService.clearSessionKey(address)
  }
}
