import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { getWallets, type Wallet } from '@mysten/wallet-standard'
import { SUI_NETWORK } from '../services/config'

const LAST_WALLET_KEY = 'suilog:last_wallet'

export const useWalletStore = defineStore('wallet', () => {
  const wallets = shallowRef<Wallet[]>([])
  const currentWallet = shallowRef<Wallet | null>(null)
  const currentAccount = ref<string | null>(null)
  const isConnected = computed(() => !!currentAccount.value)
  let autoConnectAttempted = false

  function init() {
    // Initial fetch
    wallets.value = [...getWallets().get()]

    // Listen for new wallets
    getWallets().on('register', () => {
      wallets.value = [...getWallets().get()]
      attemptAutoConnect()
    })

    attemptAutoConnect()
  }

  async function connect(walletName: string, options?: Record<string, unknown>) {
    const wallet = wallets.value.find(w => w.name === walletName)
    if (!wallet) return

    try {
      // @ts-ignore
      const connectFeature = wallet.features['standard:connect'] as any
      if (connectFeature) {
        const result = await connectFeature.connect(options ?? {})
        currentWallet.value = wallet
        currentAccount.value = result.accounts[0].address
        localStorage.setItem(LAST_WALLET_KEY, wallet.name)
      }
    } catch (e) {
      console.error('Failed to connect', e)
    }
  }

  function attemptAutoConnect() {
    if (autoConnectAttempted) return
    const lastWalletName = localStorage.getItem(LAST_WALLET_KEY)
    if (!lastWalletName) return

    const wallet = wallets.value.find(w => w.name === lastWalletName)
    if (!wallet) return

    autoConnectAttempted = true
    connect(lastWalletName, { silent: true }).catch(() => {
      // ignore silent connect failures
    })
  }

  async function signTransaction(tx: any, options?: Record<string, unknown>) {
    if (!currentWallet.value) throw new Error('No wallet connected')

    const signFeature = currentWallet.value.features['sui:signAndExecuteTransactionBlock'] as any
    if (signFeature) {
      return await signFeature.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        account: currentWallet.value.accounts[0],
        chain: `sui:${SUI_NETWORK}`,
        options: {
          showEffects: true,
          showObjectChanges: true,
          ...(options ?? {})
        }
      })
    }
    throw new Error('Wallet does not support signing')
  }

  async function signMessage(message: Uint8Array) {
    if (!currentWallet.value) throw new Error('No wallet connected')

    const signFeature = currentWallet.value.features['sui:signMessage'] as any
    if (signFeature) {
      return await signFeature.signMessage({
        message,
        account: currentWallet.value.accounts[0]
      })
    }
    throw new Error('Wallet does not support signing message')
  }

  async function disconnect() {
    if (currentWallet.value) {
      const disconnectFeature = currentWallet.value.features['standard:disconnect'] as any
      if (disconnectFeature?.disconnect) {
        try {
          await disconnectFeature.disconnect()
        } catch (e) {
          console.error('Failed to disconnect', e)
        }
      }
    }
    currentWallet.value = null
    currentAccount.value = null
    localStorage.removeItem(LAST_WALLET_KEY)
  }

  return {
    wallets,
    currentWallet,
    currentAccount,
    isConnected,
    init,
    connect,
    disconnect,
    signTransaction,
    signMessage
  }
})
