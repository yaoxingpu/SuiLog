<script setup lang="ts">
import { onMounted, ref } from "vue"
import { useWalletStore } from "./stores/wallet"

const walletStore = useWalletStore()
const showWalletList = ref(false)

onMounted(() => {
  walletStore.init()
})

function toggleConnect() {
  if (walletStore.wallets.length === 0) {
    alert("未检测到 Sui 钱包，请安装 Sui Wallet 或 Suiet。")
    return
  }
  showWalletList.value = !showWalletList.value
}

function selectWallet(name: string) {
  walletStore.connect(name)
  showWalletList.value = false
}
</script>

<template>
  <div class="app-root" @click="showWalletList = false">
    <div class="bg-orbs"></div>
    <header class="app-header">
      <div class="brand" @click="$router.push('/')">
        <span class="brand-icon">SL</span>
        <div>
          <h1 class="brand-title">SuiLog</h1>
          <p class="brand-subtitle">Sui 上的加密日记</p>
        </div>
      </div>

      <nav class="app-nav">
        <router-link to="/" class="nav-link" active-class="active">我的日记</router-link>
        <router-link to="/create" class="nav-link" active-class="active">写一篇</router-link>
      </nav>

      <div class="wallet-area" @click.stop>
        <div v-if="walletStore.currentAccount" class="wallet-chip">
          <span class="wallet-dot"></span>
          <span class="wallet-address">
            {{ walletStore.currentAccount.slice(0, 6) }}...{{ walletStore.currentAccount.slice(-4) }}
          </span>
          <button class="wallet-disconnect" @click="walletStore.disconnect">断开连接</button>
        </div>
        <div v-else class="relative">
          <button class="primary-btn" @click="toggleConnect">
            <span>🔌</span>
            连接钱包
          </button>

          <div v-if="showWalletList" class="wallet-dropdown">
            <div class="wallet-dropdown-head">选择钱包</div>
            <div
              v-for="wallet in walletStore.wallets"
              :key="wallet.name"
              class="wallet-option"
              @click="selectWallet(wallet.name)"
            >
              <img :src="wallet.icon" alt="icon" />
              <span>{{ wallet.name }}</span>
            </div>
          </div>
        </div>
      </div>
    </header>

    <main class="app-main container mx-auto px-4 py-12">
      <router-view></router-view>
    </main>

    <footer class="app-footer">
      <div class="container mx-auto px-4">
        <p>
          基于 Sui + Walrus 构建 ·
          <span>默认加密</span>
        </p>
      </div>
    </footer>
  </div>
</template>
