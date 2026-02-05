export class CryptoService {
  static async generateKey(): Promise<CryptoKey> {
    return window.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }

  static async encrypt(
    data: string | ArrayBuffer | Uint8Array,
    key: CryptoKey,
    iv?: Uint8Array
  ): Promise<{ cipherText: ArrayBuffer, iv: Uint8Array }> {
    const ivBytes = iv ?? window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    
    const cipherText = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: ivBytes as any },
      key,
      encoded
    );
    return { cipherText, iv: ivBytes };
  }

  static async decrypt(
    cipherText: ArrayBuffer | Uint8Array,
    key: CryptoKey,
    iv: Uint8Array
  ): Promise<ArrayBuffer> {
    const data = cipherText instanceof Uint8Array ? cipherText : new Uint8Array(cipherText)
    return window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as any },
      key,
      data
    );
  }

  static async exportKey(key: CryptoKey): Promise<Uint8Array> {
    const exported = await window.crypto.subtle.exportKey("raw", key);
    return new Uint8Array(exported);
  }

  static async importKey(raw: Uint8Array): Promise<CryptoKey> {
    return window.crypto.subtle.importKey(
      "raw",
      raw as any,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"]
    );
  }

  static async deriveKeyFromPassword(
    password: string,
    salt: Uint8Array,
    iterations = 210000
  ): Promise<CryptoKey> {
    const baseKey = await window.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }
}
