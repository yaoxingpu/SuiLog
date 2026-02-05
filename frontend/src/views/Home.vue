<script setup lang="ts">
import { ref, watch, computed } from "vue"
import { storeToRefs } from "pinia"
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import { Transaction } from "@mysten/sui/transactions"
import { useWalletStore } from "../stores/wallet"
import { useVaultStore } from "../stores/vault"
import { useDiaryStore, type DiaryEntryView, type ShareEventView } from "../stores/diary"
import { CryptoService } from "../services/crypto"
import { WalrusService } from "../services/walrus"
import { SUI_NETWORK, SUI_PACKAGE_ID, SUI_PACKAGE_IDS } from "../services/config"
import VaultGate from "../components/VaultGate.vue"

const walletStore = useWalletStore()
const vaultStore = useVaultStore()
const diaryStore = useDiaryStore()

const {
  diaries,
  eventCursor,
  hasNextPage,
  shareEvents,
  lastLoadedAt,
  shareLoadedAt,
  dirty,
  account: diaryAccount
} = storeToRefs(diaryStore)
const isLoading = ref(false)
const isLoadingMore = ref(false)
const pageSize = 10
const decryptedContent = ref<
  Record<
    string,
    {
      type: "plain" | "rich"
      text: string
      html: string
      expiresAt?: number
      storageDays?: number
    }
  >
>({})
const vaultBusy = ref(false)
const vaultError = ref("")
const searchQuery = ref("")
const moodFilter = ref(0)
const sortOrder = ref<"desc" | "asc">("desc")

const shareOpen = ref(false)
const shareTarget = ref<DiaryEntryView | null>(null)
const sharePassword = ref("")
const shareDuration = ref("72")
const shareCustomHours = ref("")
const shareBusy = ref(false)
const shareError = ref("")
const shareLink = ref("")
const shareExpiresAt = ref<number | null>(null)
const shareLoading = ref(false)
const shareActionBusy = ref<string | null>(null)
const shareFilter = ref<"all" | "active" | "expired" | "revoked" | "deleted">("all")
const shareQuery = ref("")
const copyToast = ref("")
let copyToastTimer: number | null = null
const unlockBusy = ref<Record<string, boolean>>({})
const unlockError = ref<Record<string, string>>({})

const client = new SuiClient({ url: getFullnodeUrl(SUI_NETWORK as any) })
const readPackageIds = SUI_PACKAGE_IDS

const hasWallet = computed(() => !!walletStore.currentAccount)
const entryCount = computed(() => diaries.value.length)
const filteredCount = computed(() => filteredDiaries.value.length)

const moodEmoji = ["😐", "🙂", "😊", "🤩", "🥳"]
const moodLabels = ["平静", "温暖", "明亮", "高能", "庆祝"]

const filteredDiaries = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  let result = diaries.value.filter(entry => {
    const matchMood = moodFilter.value === 0 || entry.mood === moodFilter.value
    const matchQuery = q.length === 0 || entry.title.toLowerCase().includes(q)
    return matchMood && matchQuery
  })
  if (sortOrder.value === "asc") {
    result = [...result].sort((a, b) => a.timestamp - b.timestamp)
  }
  return result
})

const moodStats = computed(() => {
  const counts = [0, 0, 0, 0, 0]
  diaries.value.forEach(entry => {
    if (entry.mood >= 1 && entry.mood <= 5) counts[entry.mood - 1] += 1
  })
  return counts
})

const dominantMood = computed(() => {
  if (diaries.value.length === 0) return "—"
  const counts = moodStats.value
  let maxIndex = 0
  counts.forEach((count, index) => {
    if (count > counts[maxIndex]) maxIndex = index
  })
  return `${moodEmoji[maxIndex]} ${moodLabels[maxIndex]}`
})

const lastEntryDate = computed(() => {
  if (diaries.value.length === 0) return "—"
  const latest = diaries.value[0]
  return new Date(latest.timestamp).toLocaleDateString()
})

const filteredShares = computed(() => {
  const query = shareQuery.value.trim().toLowerCase()
  return shareEvents.value.filter(share => {
    const matchStatus = shareFilter.value === "all" || share.status === shareFilter.value
    const matchQuery =
      query.length === 0 ||
      share.id.toLowerCase().includes(query) ||
      share.entryId.toLowerCase().includes(query)
    return matchStatus && matchQuery
  })
})

function toU8(value: any): Uint8Array {
  if (!value) return new Uint8Array()
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) return new Uint8Array(value)
  if (typeof value === "string") {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  return new Uint8Array()
}

async function loadEntries(reset = false) {
  if (!walletStore.currentAccount) {
    diaries.value = []
    return
  }

  if (reset) {
    eventCursor.value = null
    hasNextPage.value = true
    diaries.value = []
  }

  if (readPackageIds.length > 1) {
    if (reset) isLoading.value = true
    else isLoadingMore.value = true
    await fetchOwnedEntriesFromPackages()
    isLoading.value = false
    isLoadingMore.value = false
    return
  }

  if (!hasNextPage.value) return

  if (reset) isLoading.value = true
  else isLoadingMore.value = true

  const normalizedAccount = normalizeSuiAddress(walletStore.currentAccount)
  try {
    const events = await client.queryEvents({
      query: { MoveEventType: `${SUI_PACKAGE_ID}::diary::EntryCreated` },
      cursor: eventCursor.value ?? undefined,
      limit: pageSize,
      order: "descending"
    })

    eventCursor.value = (events.nextCursor as string) ?? null
    hasNextPage.value = events.hasNextPage

    const entryIds = events.data
      .filter(event => {
        const owner = (event.parsedJson as any)?.owner as string | undefined
        if (!owner) return true
        try {
          return normalizeSuiAddress(owner) === normalizedAccount
        } catch {
          return owner === walletStore.currentAccount
        }
      })
      .map(event => String((event.parsedJson as any)?.id))
      .filter(Boolean)

    if (entryIds.length === 0) {
      if (reset) {
        await fetchOwnedEntries()
      }
      return
    }

    const objects = await client.multiGetObjects({
      ids: entryIds,
      options: { showContent: true }
    })

    const mapped = objects
      .map(obj => {
        const content = obj.data?.content as any
        if (!content?.fields) return null
        return {
          id: obj.data?.objectId as string,
          title: content.fields.title as string,
          blobId: content.fields.content_blob_id as string,
          mood: Number(content.fields.mood),
          timestamp: Number(content.fields.timestamp),
          iv: toU8(content.fields.iv),
          encryptedDek: toU8(content.fields.encrypted_dek),
          dekIv: toU8(content.fields.dek_iv),
          packageId: SUI_PACKAGE_ID
        } as DiaryEntryView
      })
      .filter(Boolean) as DiaryEntryView[]

    const merged = [...diaries.value, ...mapped]
    const unique = new Map<string, DiaryEntryView>()
    merged.forEach(item => unique.set(item.id, item))
    const sorted = Array.from(unique.values()).sort((a, b) => b.timestamp - a.timestamp)
    if (reset) {
      diaryStore.setEntries(sorted, eventCursor.value, hasNextPage.value)
    } else {
      diaryStore.updateEntries(sorted, eventCursor.value, hasNextPage.value)
    }
  } catch (e) {
    console.error(e)
    if (reset) {
      await fetchOwnedEntries()
    }
  } finally {
    isLoading.value = false
    isLoadingMore.value = false
  }
}

async function fetchOwnedEntries() {
  try {
    const { data } = await client.getOwnedObjects({
      owner: walletStore.currentAccount!,
      filter: { StructType: `${SUI_PACKAGE_ID}::diary::DiaryEntry` },
      options: { showContent: true }
    })
    const mapped = data.map(obj => {
      const content = obj.data?.content as any
      return {
        id: obj.data?.objectId as string,
        title: content.fields.title as string,
        blobId: content.fields.content_blob_id as string,
        mood: Number(content.fields.mood),
        timestamp: Number(content.fields.timestamp),
        iv: toU8(content.fields.iv),
        encryptedDek: toU8(content.fields.encrypted_dek),
        dekIv: toU8(content.fields.dek_iv),
        packageId: SUI_PACKAGE_ID
      }
    })
    const sorted = mapped.sort((a, b) => b.timestamp - a.timestamp)
    diaryStore.setEntries(sorted, null, false)
  } catch (inner) {
    console.error(inner)
  }
}

async function fetchOwnedEntriesFromPackages() {
  try {
    const results = await Promise.all(
      readPackageIds.map(pkg =>
        client.getOwnedObjects({
          owner: walletStore.currentAccount!,
          filter: { StructType: `${pkg}::diary::DiaryEntry` },
          options: { showContent: true }
        })
      )
    )
    const merged = results.flatMap((result, index) => {
      const pkg = readPackageIds[index]
      return result.data
        .map(obj => {
          const content = obj.data?.content as any
          if (!content?.fields) return null
          return {
            id: obj.data?.objectId as string,
            title: content.fields.title as string,
            blobId: content.fields.content_blob_id as string,
            mood: Number(content.fields.mood),
            timestamp: Number(content.fields.timestamp),
            iv: toU8(content.fields.iv),
            encryptedDek: toU8(content.fields.encrypted_dek),
            dekIv: toU8(content.fields.dek_iv),
            packageId: pkg
          } as DiaryEntryView
        })
        .filter(Boolean) as DiaryEntryView[]
    })
    const unique = new Map<string, DiaryEntryView>()
    merged.forEach(item => unique.set(item.id, item))
    const sorted = Array.from(unique.values()).sort((a, b) => b.timestamp - a.timestamp)
    diaryStore.setEntries(sorted, null, false)
  } catch (e) {
    console.error(e)
  }
}

async function unlock(entry: DiaryEntryView) {
  if (!vaultStore.vaultKey) {
    vaultError.value = "请先解锁保险库再解密内容。"
    unlockError.value[entry.id] = "请先解锁保险库。"
    return
  }

  try {
    unlockBusy.value[entry.id] = true
    unlockError.value[entry.id] = ""
    const dekRaw = await CryptoService.decrypt(entry.encryptedDek, vaultStore.vaultKey, entry.dekIv)
    const dekKey = await CryptoService.importKey(new Uint8Array(dekRaw))
    const blob = await WalrusService.getBlob(entry.blobId)
    const encryptedBytes = await blob.arrayBuffer()
    const decryptedBytes = await CryptoService.decrypt(encryptedBytes, dekKey, entry.iv)
    const jsonStr = new TextDecoder().decode(decryptedBytes)
    const data = JSON.parse(jsonStr)
    const type = data.type === "pro" || data.type === "rich" ? "rich" : "plain"
    const expiresAt =
      typeof data.expiresAt === "number"
        ? data.expiresAt
        : typeof data.storageDays === "number"
          ? Number(entry.timestamp) + data.storageDays * 24 * 60 * 60 * 1000
          : undefined
    decryptedContent.value[entry.id] = {
      type,
      text: data.text ?? "",
      html: data.html ?? "",
      expiresAt,
      storageDays: typeof data.storageDays === "number" ? data.storageDays : undefined
    }
  } catch (e) {
    console.error(e)
    const message = (e as Error)?.message ?? ""
    if (message.toLowerCase().includes("fetch")) {
      unlockError.value[entry.id] = "读取 Walrus 内容失败。"
    } else {
      unlockError.value[entry.id] = "解密失败，请检查保险库密码。"
    }
    vaultError.value = unlockError.value[entry.id]
  } finally {
    unlockBusy.value[entry.id] = false
  }
}

function openShare(entry: DiaryEntryView) {
  if (entry.packageId && entry.packageId !== SUI_PACKAGE_ID) {
    shareError.value = "旧版本日记暂不支持分享。"
    return
  }
  shareTarget.value = entry
  shareOpen.value = true
  sharePassword.value = ""
  shareError.value = ""
  shareLink.value = ""
  shareExpiresAt.value = null
  shareDuration.value = "72"
  shareCustomHours.value = ""
}

function closeShare() {
  shareOpen.value = false
  shareTarget.value = null
}

async function createShare() {
  if (!shareTarget.value) return
  if (!vaultStore.vaultKey) {
    shareError.value = "请先解锁保险库。"
    return
  }
  if (sharePassword.value.length < 6) {
    shareError.value = "分享密码至少 6 个字符。"
    return
  }

  shareBusy.value = true
  shareError.value = ""
  try {
    const dekRaw = await CryptoService.decrypt(
      shareTarget.value.encryptedDek,
      vaultStore.vaultKey,
      shareTarget.value.dekIv
    )
    const salt = window.crypto.getRandomValues(new Uint8Array(16))
    const shareKey = await CryptoService.deriveKeyFromPassword(sharePassword.value, salt, 160000)
    const { cipherText, iv } = await CryptoService.encrypt(dekRaw, shareKey)

    let hours = 0
    if (shareDuration.value === "custom") {
      hours = Number(shareCustomHours.value)
      if (!Number.isFinite(hours) || hours <= 0) {
        shareError.value = "请输入有效时长（小时）。"
        return
      }
      if (hours > 720) {
        shareError.value = "自定义时长不能超过 720 小时。"
        return
      }
    } else {
      hours = Number(shareDuration.value)
    }

    const durationMs = hours * 60 * 60 * 1000
    const txb = new Transaction()
    txb.moveCall({
      target: `${SUI_PACKAGE_ID}::diary::share_entry`,
      arguments: [
        txb.object(shareTarget.value.id),
        txb.pure.vector("u8", Array.from(new Uint8Array(cipherText))),
        txb.pure.vector("u8", Array.from(iv)),
        txb.pure.vector("u8", Array.from(salt)),
        txb.pure.u64(durationMs),
        txb.object("0x6")
      ]
    })

    const result = await walletStore.signTransaction(txb)
    const created = result?.objectChanges?.find(
      (change: any) =>
        change.type === "created" && String(change.objectType).includes("::diary::SharedAccess")
    )
    if (!created?.objectId) {
      throw new Error("未找到分享对象，请在浏览器查看交易结果。")
    }

    const origin = window.location.origin
    shareLink.value = `${origin}/share/${created.objectId}`
    shareExpiresAt.value = Date.now() + durationMs
    await loadShares()
  } catch (e: any) {
    console.error(e)
    shareError.value = e?.message ?? "创建分享链接失败。"
  } finally {
    shareBusy.value = false
  }
}

async function copyShareLink() {
  if (!shareLink.value) return
  try {
    await navigator.clipboard.writeText(shareLink.value)
    showCopyToast("链接已复制")
  } catch (e) {
    console.error(e)
    showCopyToast("复制失败，请手动复制")
  }
}

async function loadShares() {
  if (!walletStore.currentAccount) {
    diaryStore.setShares([])
    return
  }
  shareLoading.value = true
  try {
    const [sharedEvents, revokedEvents] = await Promise.all([
      client.queryEvents({
        query: { MoveEventType: `${SUI_PACKAGE_ID}::diary::AccessShared` },
        limit: 20,
        order: "descending"
      }),
      client
        .queryEvents({
          query: { MoveEventType: `${SUI_PACKAGE_ID}::diary::AccessRevoked` },
          limit: 20,
          order: "descending"
        })
        .catch(() => ({ data: [] as any[] }))
    ])

    const origin = window.location.origin
    const revokedSet = new Set<string>()
    revokedEvents.data
      .filter(event => (event.parsedJson as any)?.owner === walletStore.currentAccount)
      .forEach(event => {
        const json = event.parsedJson as any
        revokedSet.add(String(json.id))
      })

    const ownedEvents = sharedEvents.data
      .filter(event => {
        const owner = (event.parsedJson as any)?.owner
        return !owner || owner === walletStore.currentAccount
      })

    const createdAtMap = new Map<string, number>()
    const entryFallbackMap = new Map<string, string>()
    const ids = ownedEvents
      .map(event => {
        const json = event.parsedJson as any
        const id = String(json.id)
        const createdAt = Number((event as any).timestampMs ?? (event as any).timestamp_ms ?? Date.now())
        createdAtMap.set(id, createdAt)
        if (json.entry_id) {
          entryFallbackMap.set(id, String(json.entry_id))
        }
        return id
      })
      .filter(Boolean)

    if (ids.length === 0) {
      diaryStore.setShares([])
      return
    }

    const objects = await client.multiGetObjects({
      ids,
      options: { showContent: true }
    })

    const now = Date.now()
    const mapped = ids
      .map((id, index) => {
        const obj = objects[index]
        const content = obj?.data?.content as any
        const exists = !!content?.fields
        const entryId = exists
          ? String(content.fields.entry_id)
          : entryFallbackMap.get(id) ?? "未知"
        const expiry = exists ? Number(content.fields.expiry) : 0
        let status: ShareEventView["status"] = "active"
        if (revokedSet.has(id)) status = "revoked"
        else if (!exists) status = "deleted"
        else if (now > expiry) status = "expired"

        return {
          id,
          entryId,
          expiry,
          createdAt: createdAtMap.get(id) ?? now,
          link: `${origin}/share/${id}`,
          status,
          exists
        } as ShareEventView
      })
      .sort((a, b) => b.createdAt - a.createdAt)
    diaryStore.setShares(mapped)
  } catch (e) {
    console.error(e)
  } finally {
    shareLoading.value = false
  }
}

async function copyShareEventLink(link: string) {
  try {
    await navigator.clipboard.writeText(link)
    showCopyToast("分享链接已复制")
  } catch (e) {
    console.error(e)
    showCopyToast("复制失败，请手动复制")
  }
}

function showCopyToast(message: string) {
  copyToast.value = message
  if (copyToastTimer) {
    window.clearTimeout(copyToastTimer)
  }
  copyToastTimer = window.setTimeout(() => {
    copyToast.value = ""
  }, 2000)
}

async function extendShare(shareId: string, hours: number) {
  shareActionBusy.value = shareId
  try {
    const durationMs = hours * 60 * 60 * 1000
    const txb = new Transaction()
    txb.moveCall({
      target: `${SUI_PACKAGE_ID}::diary::extend_access`,
      arguments: [
        txb.object(shareId),
        txb.pure.u64(durationMs),
        txb.object("0x6")
      ]
    })
    await walletStore.signTransaction(txb)
    await loadShares()
  } catch (e) {
    console.error(e)
  } finally {
    shareActionBusy.value = null
  }
}

async function revokeShare(shareId: string) {
  const confirmed = window.confirm("撤销该分享链接？撤销后将立即失效。")
  if (!confirmed) return
  shareActionBusy.value = shareId
  try {
    const txb = new Transaction()
    txb.moveCall({
      target: `${SUI_PACKAGE_ID}::diary::revoke_access`,
      arguments: [txb.object(shareId)]
    })
    await walletStore.signTransaction(txb)
    await loadShares()
  } catch (e) {
    console.error(e)
  } finally {
    shareActionBusy.value = null
  }
}

async function cleanupShare(shareId: string) {
  shareActionBusy.value = shareId
  try {
    const txb = new Transaction()
    txb.moveCall({
      target: `${SUI_PACKAGE_ID}::diary::burn_expired_access`,
      arguments: [txb.object(shareId), txb.object("0x6")]
    })
    await walletStore.signTransaction(txb)
    await loadShares()
  } catch (e) {
    console.error(e)
  } finally {
    shareActionBusy.value = null
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
  decryptedContent.value = {}
}

watch(
  () => walletStore.currentAccount,
  async account => {
    await vaultStore.sync(account)
    decryptedContent.value = {}
    if (!account) {
      diaryStore.clear()
      diaries.value = []
      return
    }
    if (diaryAccount.value !== account) {
      diaryStore.clear()
      diaryStore.setAccount(account)
    }
    if (dirty.value || lastLoadedAt.value === null) {
      await loadEntries(true)
    }
    if (shareLoadedAt.value === null) {
      await loadShares()
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="space-y-10">
    <div v-if="copyToast" class="copy-toast">{{ copyToast }}</div>
    <section class="hero-shell">
      <div class="hero-card">
        <div>
          <p class="hero-eyebrow">私密链上日记</p>
          <h2 class="hero-title">你的想法，封存在 Sui。</h2>
          <p class="hero-subtitle">
            每条日记都会通过保险库加密并存储在 Walrus，你可以选择是否分享。
          </p>
        </div>
        <div class="hero-actions">
          <router-link to="/create" class="primary-btn">写一篇</router-link>
          <button class="secondary-btn" @click="loadEntries(true)">刷新</button>
        </div>
      </div>
    </section>

    <section v-if="!hasWallet" class="glass-card">
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 class="section-title">连接钱包</h3>
          <p class="section-subtitle">SuiLog 将元数据写入链上，连接后才能读取日记。</p>
        </div>
        <span class="badge">等待钱包</span>
      </div>
    </section>

    <section v-else class="space-y-4">
      <VaultGate
        :status="vaultStore.status"
        :busy="vaultBusy"
        title="保险库控制"
        subtitle="解锁一次即可读写与分享。"
        :showReset="true"
        @create="handleVaultCreate"
        @unlock="handleVaultUnlock"
        @lock="vaultStore.lock"
        @reset="handleVaultReset"
      />
      <p v-if="vaultError" class="text-red-600 text-sm">{{ vaultError }}</p>
    </section>

    <section class="insight-grid">
      <div class="glass-card">
        <p class="hero-eyebrow">已加载日记</p>
        <h3 class="insight-value">{{ entryCount }}</h3>
        <p class="section-subtitle">日记元数据已锚定链上。</p>
      </div>
      <div class="glass-card">
        <p class="hero-eyebrow">最近一次</p>
        <h3 class="insight-value">{{ lastEntryDate }}</h3>
        <p class="section-subtitle">最近写作的日期。</p>
      </div>
      <div class="glass-card">
        <p class="hero-eyebrow">心情趋势</p>
        <h3 class="insight-value">{{ dominantMood }}</h3>
        <div class="mood-bars">
          <div
            v-for="(count, index) in moodStats"
            :key="index"
            class="mood-bar"
            :style="{ width: `${Math.max(12, (count / Math.max(1, entryCount)) * 100)}%` }"
          >
            <span>{{ moodEmoji[index] }} {{ count }}</span>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-4">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h3 class="section-title">分享中心</h3>
          <p class="section-subtitle">你最近创建的分享链接。</p>
        </div>
        <button class="secondary-btn" @click="loadShares">刷新</button>
      </div>

      <div v-if="shareLoading" class="glass-card text-center py-12">
        <div class="spinner mx-auto mb-4"></div>
        <p class="text-sm text-slate-500">正在加载分享链接...</p>
      </div>

      <div v-else-if="shareEvents.length === 0" class="glass-card text-center py-10">
        <p class="text-slate-500">暂无分享，请在日记里创建。</p>
      </div>

      <div v-else class="space-y-4">
        <div class="filter-bar">
          <input v-model="shareQuery" type="text" placeholder="搜索分享或日记 ID..." class="filter-input" />
          <div class="filter-group">
            <button class="filter-pill" :class="shareFilter === 'all' ? 'active' : ''" @click="shareFilter = 'all'">
              全部
            </button>
            <button
              class="filter-pill"
              :class="shareFilter === 'active' ? 'active' : ''"
              @click="shareFilter = 'active'"
            >
              有效
            </button>
            <button
              class="filter-pill"
              :class="shareFilter === 'expired' ? 'active' : ''"
              @click="shareFilter = 'expired'"
            >
              已过期
            </button>
            <button
              class="filter-pill"
              :class="shareFilter === 'revoked' ? 'active' : ''"
              @click="shareFilter = 'revoked'"
            >
              已撤销
            </button>
            <button
              class="filter-pill"
              :class="shareFilter === 'deleted' ? 'active' : ''"
              @click="shareFilter = 'deleted'"
            >
              已删除
            </button>
          </div>
        </div>

        <div v-if="filteredShares.length === 0" class="glass-card text-center py-10">
          <p class="text-slate-500">没有符合筛选条件的分享。</p>
        </div>

        <div v-else class="share-grid">
          <div v-for="share in filteredShares" :key="share.id" class="share-card">
            <div>
              <p class="share-label">分享 ID</p>
              <p class="share-value">{{ share.id.slice(0, 8) }}...{{ share.id.slice(-6) }}</p>
              <p class="share-sub">{{ new Date(share.createdAt).toLocaleString() }}</p>
            </div>
            <div>
              <p class="share-label">到期时间</p>
              <p class="share-value">
                {{ share.exists ? new Date(share.expiry).toLocaleString() : "—" }}
              </p>
              <p class="share-sub">日记 {{ share.entryId.slice(0, 6) }}...</p>
            </div>
            <div class="share-actions">
              <span class="share-status" :class="share.status">
                {{ share.status === 'active' ? '有效' : share.status === 'expired' ? '已过期' : share.status === 'revoked' ? '已撤销' : '已删除' }}
              </span>
              <button
                class="ghost-btn"
                :disabled="shareActionBusy === share.id || share.status === 'revoked' || share.status === 'deleted'"
                @click="copyShareEventLink(share.link)"
              >
                复制链接
              </button>
              <button
                class="ghost-btn"
                :disabled="shareActionBusy === share.id || !share.exists || share.status === 'revoked'"
                @click="extendShare(share.id, 24)"
              >
                +24小时
              </button>
              <button
                class="ghost-btn"
                :disabled="shareActionBusy === share.id || !share.exists || share.status === 'revoked'"
                @click="extendShare(share.id, 72)"
              >
                +72小时
              </button>
              <button
                v-if="share.status === 'expired' && share.exists"
                class="ghost-btn"
                :disabled="shareActionBusy === share.id"
                @click="cleanupShare(share.id)"
              >
                清理
              </button>
              <button
                class="ghost-btn danger"
                :disabled="shareActionBusy === share.id || share.status === 'revoked' || share.status === 'deleted'"
                @click="revokeShare(share.id)"
              >
                撤销
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-4">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h3 class="section-title">我的日记</h3>
          <p class="section-subtitle">
            共 {{ entryCount }} 篇，显示 {{ filteredCount }} 篇
          </p>
        </div>
        <div class="entry-count">{{ entryCount }}</div>
      </div>

      <div v-if="isLoading" class="glass-card text-center py-16">
        <div class="spinner mx-auto mb-4"></div>
        <p class="text-sm text-slate-500">正在同步 Sui {{ SUI_NETWORK }}...</p>
      </div>

      <div v-else-if="diaries.length === 0" class="glass-card text-center py-16">
        <div class="text-6xl mb-4">📝</div>
        <h4 class="text-2xl font-semibold mb-2">还没有日记</h4>
        <p class="text-slate-500 mb-6">写下你的第一篇，让区块链记住这一天。</p>
        <router-link to="/create" class="primary-btn">开始写作</router-link>
      </div>

      <div v-else class="space-y-6">
        <div class="filter-bar">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索标题..."
            class="filter-input"
          />
          <div class="filter-group">
            <button
              v-for="i in 6"
              :key="i"
              :class="['filter-pill', moodFilter === (i - 1) ? 'active' : '']"
              @click="moodFilter = i - 1"
            >
              {{ i === 1 ? '全部' : moodEmoji[i - 2] }}
            </button>
          </div>
          <div class="filter-group">
            <button class="filter-pill" :class="sortOrder === 'desc' ? 'active' : ''" @click="sortOrder = 'desc'">
              最新
            </button>
            <button class="filter-pill" :class="sortOrder === 'asc' ? 'active' : ''" @click="sortOrder = 'asc'">
              最早
            </button>
          </div>
        </div>

        <div v-if="filteredDiaries.length === 0" class="glass-card text-center py-12">
          <h4 class="text-xl font-semibold mb-2">没有匹配的日记</h4>
          <p class="text-slate-500">试试其他关键词或心情筛选。</p>
        </div>

        <div v-else class="grid gap-6 md:grid-cols-2">
          <article v-for="diary in filteredDiaries" :key="diary.id" class="entry-card">
          <div class="entry-top">
            <div>
              <h4 class="entry-title">{{ diary.title }}</h4>
              <p class="entry-meta">
                {{ new Date(Number(diary.timestamp)).toLocaleDateString() }}
                ·
                {{ new Date(Number(diary.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
                <span v-if="decryptedContent[diary.id]?.expiresAt">
                  · 有效期至 {{ new Date(decryptedContent[diary.id].expiresAt!).toLocaleDateString() }}
                </span>
              </p>
            </div>
            <div class="entry-mood">{{ moodEmoji[diary.mood - 1] }}</div>
          </div>

          <div class="entry-body">
            <div v-if="decryptedContent[diary.id]" class="entry-text">
              <div
                v-if="decryptedContent[diary.id].type === 'rich'"
                class="rich-content"
                v-html="decryptedContent[diary.id].html"
              ></div>
              <p v-else>{{ decryptedContent[diary.id].text }}</p>
            </div>
            <div v-else class="space-y-2">
              <button class="unlock-btn" :disabled="unlockBusy[diary.id]" @click="unlock(diary)">
                {{ unlockBusy[diary.id] ? "解锁中..." : "解锁内容" }}
              </button>
              <p v-if="unlockError[diary.id]" class="text-xs text-red-500">
                {{ unlockError[diary.id] }}
              </p>
            </div>
          </div>

          <div class="entry-actions">
            <button
              class="ghost-btn"
              :disabled="vaultStore.status !== 'unlocked' || (diary.packageId && diary.packageId !== SUI_PACKAGE_ID)"
              :title="diary.packageId && diary.packageId !== SUI_PACKAGE_ID ? '旧版本日记暂不支持分享' : ''"
              @click="openShare(diary)"
            >
              分享
            </button>
            <span class="tiny-note">已加密 · Walrus + Sui</span>
          </div>
        </article>
        </div>

        <div v-if="hasNextPage" class="text-center">
          <button class="secondary-btn" :disabled="isLoadingMore" @click="loadEntries(false)">
            {{ isLoadingMore ? "加载中..." : "加载更多" }}
          </button>
        </div>
      </div>
    </section>

    <div v-if="shareOpen" class="modal-backdrop" @click="closeShare">
      <div class="modal-card" @click.stop>
        <div class="modal-header">
          <div>
            <h4 class="modal-title">创建分享链接</h4>
            <p class="modal-subtitle">使用密码加密一次性密钥。</p>
          </div>
          <button class="modal-close" @click="closeShare">✕</button>
        </div>

        <div class="modal-body">
          <label>分享密码</label>
          <input v-model="sharePassword" type="password" placeholder="输入分享密码" />

          <label>有效期</label>
          <div class="modal-options">
            <button
              v-for="option in ['24', '72', '168']"
              :key="option"
              :class="['pill-btn', shareDuration === option ? 'active' : '']"
              @click="shareDuration = option"
            >
              {{ option === '24' ? '24小时' : option === '72' ? '3天' : '1周' }}
            </button>
            <button
              class="pill-btn"
              :class="shareDuration === 'custom' ? 'active' : ''"
              @click="shareDuration = 'custom'"
            >
              自定义
            </button>
          </div>
          <div v-if="shareDuration === 'custom'" class="share-custom">
            <input
              v-model="shareCustomHours"
              type="number"
              min="1"
              max="720"
              placeholder="输入小时数（1-720）"
            />
            <span class="share-custom-unit">小时</span>
          </div>

          <button class="primary-btn w-full" :disabled="shareBusy" @click="createShare">
            {{ shareBusy ? '创建中...' : '生成链接' }}
          </button>

          <p v-if="shareError" class="text-red-600 text-sm">{{ shareError }}</p>

          <div v-if="shareLink" class="share-result">
            <p>分享链接</p>
            <div class="share-link">
              <span>{{ shareLink }}</span>
              <button class="ghost-btn" @click="copyShareLink">复制</button>
            </div>
            <p v-if="shareExpiresAt" class="tiny-note">
              到期时间：{{ new Date(shareExpiresAt).toLocaleString() }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
