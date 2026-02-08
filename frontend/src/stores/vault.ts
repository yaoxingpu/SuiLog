import { defineStore } from "pinia"
import { ref, shallowRef } from "vue"
import { VaultService } from "../services/vault"

type VaultStatus = "missing" | "locked" | "unlocked"

export const useVaultStore = defineStore("vault", () => {
  const status = ref<VaultStatus>("locked")
  const vaultKey = shallowRef<CryptoKey | null>(null)
  const currentAccount = ref<string | null>(null)
  let syncInFlight: Promise<void> | null = null

  function reset() {
    status.value = "locked"
    vaultKey.value = null
    currentAccount.value = null
  }

  async function sync(account: string | null) {
    if (syncInFlight) {
      await syncInFlight
    }

    syncInFlight = (async () => {
      if (!account) {
        reset()
        return
      }

      if (currentAccount.value === account && status.value === "unlocked" && vaultKey.value) {
        return
      }

      currentAccount.value = account
      const sessionKey = await VaultService.loadSessionKey(account)
      if (sessionKey) {
        vaultKey.value = sessionKey
        status.value = "unlocked"
        return
      }

      vaultKey.value = null
      status.value = VaultService.hasVault(account) ? "locked" : "missing"
    })()

    await syncInFlight
    syncInFlight = null
  }

  async function createVault(account: string, password: string) {
    const key = await VaultService.createVault(account, password)
    vaultKey.value = key
    status.value = "unlocked"
    await VaultService.saveSessionKey(account, key)
  }

  async function unlock(account: string, password: string) {
    const key = await VaultService.unlockVault(account, password)
    vaultKey.value = key
    status.value = "unlocked"
    await VaultService.saveSessionKey(account, key)
  }

  async function changePassword(account: string, oldPassword: string, newPassword: string) {
    await VaultService.changePassword(account, oldPassword, newPassword)
    // vault key stays the same; ensure session key present
    const metaKey = await VaultService.unlockVault(account, newPassword)
    vaultKey.value = metaKey
    status.value = "unlocked"
    await VaultService.saveSessionKey(account, metaKey)
  }

  function exportBackup(account: string): string {
    return VaultService.exportVault(account)
  }

  function importBackup(account: string, payload: string) {
    VaultService.importVault(account, payload)
    status.value = "locked"
    vaultKey.value = null
    VaultService.clearSessionKey(account)
  }

  function lock() {
    vaultKey.value = null
    if (currentAccount.value) {
      status.value = "locked"
      VaultService.clearSessionKey(currentAccount.value)
    }
  }

  function clear(account: string) {
    VaultService.clearVault(account)
    VaultService.clearSessionKey(account)
    sync(account)
  }

  return {
    status,
    vaultKey,
    currentAccount,
    sync,
    createVault,
    unlock,
    changePassword,
    lock,
    clear,
    exportBackup,
    importBackup
  }
})
