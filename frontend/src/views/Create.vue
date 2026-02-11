<script setup lang="ts">
import { ref, watch, computed, onBeforeUnmount, onMounted } from "vue"
import { useRouter } from "vue-router"
import { Transaction } from "@mysten/sui/transactions"
import { useWalletStore } from "../stores/wallet"
import { useVaultStore } from "../stores/vault"
import { useDiaryStore } from "../stores/diary"
import { CryptoService } from "../services/crypto"
import { WalrusService } from "../services/walrus"
import { SUI_PACKAGE_ID, SUI_NETWORK, SUI_MOOD_BOARD_ID } from "../services/config"
import VaultGate from "../components/VaultGate.vue"

const walletStore = useWalletStore()
const vaultStore = useVaultStore()
const diaryStore = useDiaryStore()
const router = useRouter()

const title = ref("")
const content = ref("")
const mood = ref(0)
const isSubmitting = ref(false)
const status = ref("")
const vaultBusy = ref(false)
const vaultError = ref("")

const storageDuration = ref("30")
const storageCustomDays = ref("")
const storageError = ref("")
const unlockOptions = ["0", "6", "24"] as const
const unlockPreset = ref<"0" | "6" | "24" | "custom">("0")
const unlockCustomHours = ref("")
const unlockError = ref("")
const maxEpochs = 53
const epochDays = computed(() => (SUI_NETWORK === "mainnet" ? 14 : 1))
const maxDays = computed(() => epochDays.value * maxEpochs)
const storageOptions = computed(() => [7, 30, 90].filter(days => days <= maxDays.value))
const lastDraftSavedAt = ref<number | null>(null)
const hasDraft = ref(false)
let draftTimer: number | null = null
const draftKey = computed(() =>
  walletStore.currentAccount ? `suilog-draft-${walletStore.currentAccount}` : "suilog-draft-anon"
)

const isPro = computed(() => false)

onBeforeUnmount(() => {
  if (draftTimer) window.clearTimeout(draftTimer)
})

onMounted(() => {
  loadDraft()
})

function plainToHtml(text: string) {
  const safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>")
  return `<p>${safe}</p>`
}

function resolveStorageSettings() {
  let days = 0
  if (storageDuration.value === "custom") {
    days = Number(storageCustomDays.value)
  } else {
    days = Number(storageDuration.value)
  }
  if (!Number.isFinite(days) || days <= 0) {
    storageError.value = "请输入有效的保存天数。"
    return null
  }
  if (days > maxDays.value) {
    storageError.value = `最长可保存 ${maxDays.value} 天。`
    return null
  }
  storageError.value = ""
  const epochs = Math.min(maxEpochs, Math.max(1, Math.ceil(days / epochDays.value)))
  return { days, epochs }
}

function resolveUnlockMs() {
  let hours = 0
  if (unlockPreset.value === "custom") {
    hours = Number(unlockCustomHours.value)
  } else {
    hours = Number(unlockPreset.value)
  }
  if (!Number.isFinite(hours) || hours < 0) {
    unlockError.value = "请输入有效的解锁小时数。"
    return null
  }
  if (hours > 24 * 30) {
    unlockError.value = "解锁时间不可超过 30 天。"
    return null
  }
  unlockError.value = ""
  return Math.floor(hours * 60 * 60 * 1000)
}

function saveDraft() {
  if (draftTimer) window.clearTimeout(draftTimer)
  draftTimer = window.setTimeout(() => {
    const payload = {
      title: title.value,
      content: content.value,
      mood: mood.value,
      storageDuration: storageDuration.value,
      storageCustomDays: storageCustomDays.value,
      unlockPreset: unlockPreset.value,
      unlockCustomHours: unlockCustomHours.value,
      savedAt: Date.now()
    }
    try {
      localStorage.setItem(draftKey.value, JSON.stringify(payload))
      lastDraftSavedAt.value = payload.savedAt
      hasDraft.value = Boolean(title.value || content.value)
    } catch (e) {
      console.error("保存草稿失败", e)
    }
  }, 500)
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(draftKey.value)
    if (!raw) return
    const parsed = JSON.parse(raw)
    title.value = parsed.title ?? ""
    content.value = parsed.content ?? ""
    mood.value = parsed.mood ?? 0
    storageDuration.value = parsed.storageDuration ?? "30"
    storageCustomDays.value = parsed.storageCustomDays ?? ""
    unlockPreset.value = parsed.unlockPreset ?? "0"
    unlockCustomHours.value = parsed.unlockCustomHours ?? ""
    lastDraftSavedAt.value = parsed.savedAt ?? null
    hasDraft.value = true
  } catch (e) {
    console.error("读取草稿失败", e)
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(draftKey.value)
  } catch (e) {
    console.error(e)
  }
  lastDraftSavedAt.value = null
  hasDraft.value = false
}

// 媒体/专业模式暂不开放，简化写作体验

async function submit() {
  if (!walletStore.isConnected) {
    status.value = "请先连接钱包。"
    return
  }
  if (!vaultStore.vaultKey) {
    status.value = "请先解锁保险库以加密日记。"
    return
  }
  const settings = resolveStorageSettings()
  if (!settings) {
    status.value = storageError.value || "请先设置有效期。"
    return
  }
  const unlockMs = resolveUnlockMs()
  if (unlockMs === null) {
    status.value = unlockError.value || "请先设置解锁时间。"
    return
  }

  isSubmitting.value = true
  status.value = "正在加密日记..."

  try {
    const dekKey = await CryptoService.generateKey()
    const plainText = content.value.trim()

    const now = Date.now()
    const diaryData = JSON.stringify({
      version: 2,
      type: "simple",
      text: plainText,
      html: plainToHtml(content.value),
      assets: [],
      createdAt: now,
      storedAt: now,
      storageDays: settings.days,
      storageEpochs: settings.epochs,
      expiresAt: now + settings.days * 24 * 60 * 60 * 1000,
      unlockAt: now + unlockMs
    })
    const { cipherText: contentCipher, iv: contentIv } = await CryptoService.encrypt(diaryData, dekKey)
    const dekRaw = await CryptoService.exportKey(dekKey)
    const { cipherText: dekCipher, iv: dekIv } = await CryptoService.encrypt(dekRaw, vaultStore.vaultKey)

    status.value = "正在上传到 Walrus..."
    const blobId = await WalrusService.uploadBlob(new Uint8Array(contentCipher), {
      epochs: settings.epochs
    })

    status.value = "正在确认链上交易..."
    const txb = new Transaction()
    const argsBase = [
      txb.pure.string(title.value),
      txb.pure.string(blobId),
      txb.pure.vector("u8", Array.from(contentIv)),
      txb.pure.vector("u8", Array.from(new Uint8Array(dekCipher))),
      txb.pure.vector("u8", Array.from(dekIv)),
      txb.pure.u8(mood.value),
      txb.pure.u64(unlockMs)
    ] as const

    if (SUI_MOOD_BOARD_ID) {
      txb.moveCall({
        target: `${SUI_PACKAGE_ID}::diary::create_entry_with_board`,
        arguments: [...argsBase, txb.object(SUI_MOOD_BOARD_ID), txb.object("0x6")]
      })
    } else {
      txb.moveCall({
        target: `${SUI_PACKAGE_ID}::diary::create_entry_v2`,
        arguments: [...argsBase, txb.object("0x6")]
      })
    }

    await walletStore.signTransaction(txb)
    diaryStore.markDirty()
    clearDraft()
    status.value = "创建成功，正在跳转..."
    setTimeout(() => router.push("/"), 1500)
  } catch (e: any) {
    console.error(e)
    status.value = e?.message ?? "创建日记失败。"
  } finally {
    isSubmitting.value = false
  }
}

async function handleVaultCreate(payload: { password: string; confirm?: string }) {
  if (!walletStore.currentAccount) return
  vaultBusy.value = true
  vaultError.value = ""
  try {
    await vaultStore.createVault(walletStore.currentAccount, payload.password)
  } catch (e: any) {
    vaultError.value = e?.message ?? "创建保险库失败。"
  } finally {
    vaultBusy.value = false
  }
}

async function handleVaultUnlock(password: string) {
  if (!walletStore.currentAccount) return
  vaultBusy.value = true
  vaultError.value = ""
  try {
    await vaultStore.unlock(walletStore.currentAccount, password)
  } catch (e: any) {
    vaultError.value = e?.message ?? "解锁保险库失败。"
  } finally {
    vaultBusy.value = false
  }
}

function handleVaultReset() {
  if (!walletStore.currentAccount) return
  const confirmed = window.confirm(
    "重置保险库会删除本地密钥，已有日记将无法解密。继续吗？"
  )
  if (!confirmed) return
  vaultStore.clear(walletStore.currentAccount)
}

watch(
  () => walletStore.currentAccount,
  async account => {
    await vaultStore.sync(account)
  },
  { immediate: true }
)

watch([title, content, mood, storageDuration, storageCustomDays], () => {
  saveDraft()
})

watch([storageDuration, storageCustomDays], () => {
  if (storageError.value) storageError.value = ""
})

watch([unlockPreset, unlockCustomHours], () => {
  if (unlockError.value) unlockError.value = ""
})
</script>

<template>
  <div class="space-y-10 create-page" :class="{ 'pro-mode': isPro }">
    <section class="hero-shell">
      <div class="hero-card compact">
        <div>
          <p class="hero-eyebrow">新日记</p>
          <h2 class="hero-title">写下值得被记住的一刻。</h2>
          <p class="hero-subtitle">日记会被加密，存入 Walrus，并锚定在 Sui。</p>
        </div>
      </div>
    </section>

    <section>
      <VaultGate
        :status="vaultStore.status"
        :busy="vaultBusy"
        title="需要保险库"
        subtitle="保存前请创建或解锁保险库。"
        :showReset="true"
        @create="handleVaultCreate"
        @unlock="handleVaultUnlock"
        @lock="vaultStore.lock"
        @reset="handleVaultReset"
      />
      <p v-if="vaultError" class="text-red-600 text-sm mt-2">{{ vaultError }}</p>
    </section>

    <section class="entry-form">
      <div class="form-card">
        <div class="form-field">
          <label>标题</label>
          <input v-model="title" type="text" placeholder="给今天起个标题..." />
        </div>

        <div class="form-field">
          <label>内容</label>
          <textarea
            v-model="content"
            rows="8"
            placeholder="今天想写点什么？"
          ></textarea>
        </div>

        <div class="form-field">
          <label>保存有效期</label>
          <div class="modal-options">
            <button
              v-for="option in storageOptions"
              :key="option"
              :class="['pill-btn', storageDuration === String(option) ? 'active' : '']"
              @click="storageDuration = String(option)"
            >
              {{ option }}天
            </button>
            <button
              class="pill-btn"
              :class="storageDuration === 'custom' ? 'active' : ''"
              @click="storageDuration = 'custom'"
            >
              自定义
            </button>
          </div>
          <div v-if="storageDuration === 'custom'" class="share-custom">
            <input
              v-model="storageCustomDays"
              type="number"
              min="1"
              :max="maxDays"
              placeholder="输入天数"
            />
            <span class="share-custom-unit">天</span>
          </div>
          <p class="tiny-note">默认 30 天（约 {{ epochDays }} 天/epoch，最长 {{ maxDays }} 天）</p>
          <p v-if="storageError" class="text-red-600 text-xs">{{ storageError }}</p>
        </div>

        <div class="form-field">
          <label>解锁时间</label>
          <div class="modal-options">
            <button
              v-for="option in unlockOptions"
              :key="option"
              :class="['pill-btn', unlockPreset === option ? 'active' : '']"
              @click="unlockPreset = option"
            >
              {{ option === '0' ? '立即可读' : option === '6' ? '6小时后' : '24小时后' }}
            </button>
            <button
              class="pill-btn"
              :class="unlockPreset === 'custom' ? 'active' : ''"
              @click="unlockPreset = 'custom'"
            >
              自定义
            </button>
          </div>
          <div v-if="unlockPreset === 'custom'" class="share-custom">
            <input
              v-model="unlockCustomHours"
              type="number"
              min="0"
              max="720"
              placeholder="输入小时数（0-720）"
            />
            <span class="share-custom-unit">小时</span>
          </div>
          <p class="tiny-note">时间胶囊：到达解锁时间前无法解密。</p>
          <p v-if="unlockError" class="text-red-600 text-xs">{{ unlockError }}</p>
        </div>

        <div class="form-field">
          <label>你现在的心情？</label>
          <div class="mood-grid">
            <button
              v-for="i in 5"
              :key="i"
              @click="mood = i"
              :class="['mood-btn', mood === i ? 'active' : '']"
            >
              {{ ['😐', '🙂', '😊', '🤩', '🥳'][i - 1] }}
            </button>
          </div>
        </div>

        <button
          class="primary-btn w-full"
          :disabled="isSubmitting || !title || !content.trim() || mood === 0"
          @click="submit"
        >
          {{ isSubmitting ? "保存中..." : "保存到链上" }}
        </button>
        <p v-if="status" class="text-sm text-slate-500 text-center mt-3">{{ status }}</p>
        <p v-if="hasDraft" class="text-xs text-emerald-600 text-center mt-1">
          草稿已自动保存{{ lastDraftSavedAt ? ` · ${new Date(lastDraftSavedAt).toLocaleTimeString()}` : "" }}；提交失败时可以刷新恢复。
        </p>
        <p class="tiny-note text-center text-slate-400">提交交易前请确认网络与 gas 余额，防止上链失败。</p>
      </div>

      <div class="form-side">
        <div class="glass-card">
          <h4 class="section-title">数据存到哪里？</h4>
          <p class="section-subtitle">
            内容在本地加密后上传 Walrus，只把引用与元数据写入链上。
          </p>
        </div>
        <div class="glass-card">
          <h4 class="section-title">分享规则</h4>
          <p class="section-subtitle">
            分享链接使用密码加密一次性密钥，并可自动过期。
          </p>
        </div>
        <div class="glass-card">
          <h4 class="section-title">备份提醒</h4>
          <p class="section-subtitle">
            建议在首页导出一次保险库备份（JSON），防止密码遗失导致历史日记无法解密。
          </p>
        </div>
      </div>
    </section>
  </div>
</template>
