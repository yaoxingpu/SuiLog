<script setup lang="ts">
import { ref, computed, onMounted } from "vue"
import { useRoute } from "vue-router"
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client"
import { CryptoService } from "../services/crypto"
import { WalrusService } from "../services/walrus"
import { SUI_NETWORK } from "../services/config"

type ShareMeta = {
  entryId: string
  encryptedKey: Uint8Array
  keyIv: Uint8Array
  keySalt: Uint8Array
  expiry: number
}

type EntryMeta = {
  title: string
  blobId: string
  iv: Uint8Array
  mood: number
  timestamp: number
}

const route = useRoute()
const shareId = route.params.id as string
const client = new SuiClient({ url: getFullnodeUrl(SUI_NETWORK as any) })

const isLoading = ref(true)
const error = ref("")
const shareMeta = ref<ShareMeta | null>(null)
const entryMeta = ref<EntryMeta | null>(null)
const password = ref("")
const decryptedText = ref("")
const decryptedHtml = ref("")
const decryptedType = ref<"plain" | "rich">("plain")
const decrypting = ref(false)

const isExpired = computed(() => {
  if (!shareMeta.value) return false
  return Date.now() > shareMeta.value.expiry
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

async function loadShare() {
  isLoading.value = true
  try {
    const shareObj = await client.getObject({
      id: shareId,
      options: { showContent: true }
    })
    const shareContent = shareObj.data?.content as any
    if (!shareContent?.fields) {
      throw new Error("分享不存在。")
    }

    const fields = shareContent.fields
    const entryId = fields.entry_id as string
    shareMeta.value = {
      entryId,
      encryptedKey: toU8(fields.encrypted_key),
      keyIv: toU8(fields.key_iv),
      keySalt: toU8(fields.key_salt),
      expiry: Number(fields.expiry)
    }

    const entryObj = await client.getObject({
      id: entryId,
      options: { showContent: true }
    })
    const entryContent = entryObj.data?.content as any
    if (!entryContent?.fields) {
      throw new Error("日记不存在。")
    }
    const entryFields = entryContent.fields
    entryMeta.value = {
      title: entryFields.title as string,
      blobId: entryFields.content_blob_id as string,
      iv: toU8(entryFields.iv),
      mood: Number(entryFields.mood),
      timestamp: Number(entryFields.timestamp)
    }
  } catch (e: any) {
    console.error(e)
    const message = String(e?.message ?? "")
    if (message.toLowerCase().includes("not found") || message.toLowerCase().includes("not exist")) {
      error.value = "分享已撤销或已不存在。"
    } else {
      error.value = message || "加载分享失败。"
    }
  } finally {
    isLoading.value = false
  }
}

async function decryptShare() {
  if (!shareMeta.value || !entryMeta.value) return
  if (isExpired.value) {
    error.value = "该分享已过期。"
    return
  }
  if (!password.value) {
    error.value = "请输入分享密码。"
    return
  }

  decrypting.value = true
  error.value = ""
  try {
    const shareKey = await CryptoService.deriveKeyFromPassword(password.value, shareMeta.value.keySalt, 160000)
    const dekRaw = await CryptoService.decrypt(
      shareMeta.value.encryptedKey,
      shareKey,
      shareMeta.value.keyIv
    )
    const dekKey = await CryptoService.importKey(new Uint8Array(dekRaw))
    const blob = await WalrusService.getBlob(entryMeta.value.blobId)
    const encryptedBytes = await blob.arrayBuffer()
    const decryptedBytes = await CryptoService.decrypt(encryptedBytes, dekKey, entryMeta.value.iv)
    const jsonStr = new TextDecoder().decode(decryptedBytes)
    const data = JSON.parse(jsonStr)
    decryptedType.value = data.type === "pro" || data.type === "rich" ? "rich" : "plain"
    decryptedText.value = data.text ?? ""
    decryptedHtml.value = data.html ?? ""
  } catch (e: any) {
    console.error(e)
    error.value = e?.message ?? "解密失败。"
  } finally {
    decrypting.value = false
  }
}

onMounted(loadShare)
</script>

<template>
  <div class="share-shell">
    <div class="share-card">
      <div v-if="isLoading" class="text-center py-12">
        <div class="spinner mx-auto mb-4"></div>
        <p class="text-sm text-slate-500">正在加载分享内容...</p>
      </div>

      <div v-else-if="error" class="text-center py-12">
        <div class="text-4xl mb-4">⚠️</div>
        <p class="text-slate-600">{{ error }}</p>
      </div>

      <div v-else-if="entryMeta" class="space-y-6">
        <div class="share-header">
          <div>
            <p class="hero-eyebrow">分享日记</p>
            <h2 class="text-3xl font-semibold">{{ entryMeta.title }}</h2>
            <p class="text-sm text-slate-500">
              {{ new Date(entryMeta.timestamp).toLocaleString() }} · {{ ['😐','🙂','😊','🤩','🥳'][entryMeta.mood - 1] }}
            </p>
            <p v-if="shareMeta" class="text-xs text-slate-400 mt-1">
              到期时间：{{ new Date(shareMeta.expiry).toLocaleString() }}
            </p>
          </div>
          <span class="badge" :class="isExpired ? 'badge-danger' : 'badge-ok'">
            {{ isExpired ? '已过期' : '有效' }}
          </span>
        </div>

        <div v-if="decryptedText || decryptedHtml" class="share-content">
          <div v-if="decryptedType === 'rich'" class="rich-content" v-html="decryptedHtml"></div>
          <p v-else>{{ decryptedText }}</p>
        </div>

        <div v-else class="share-unlock">
          <label>分享密码</label>
          <input v-model="password" type="password" placeholder="输入密码解锁" />
          <button class="primary-btn w-full" :disabled="decrypting || isExpired" @click="decryptShare">
            {{ decrypting ? "解锁中..." : "解锁内容" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
