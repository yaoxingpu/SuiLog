<script setup lang="ts">
import "@wangeditor/editor/dist/css/style.css"
import { ref, watch, shallowRef, computed, onBeforeUnmount } from "vue"
import { useRouter } from "vue-router"
import { Transaction } from "@mysten/sui/transactions"
import { useWalletStore } from "../stores/wallet"
import { useVaultStore } from "../stores/vault"
import { useDiaryStore } from "../stores/diary"
import { CryptoService } from "../services/crypto"
import { WalrusService } from "../services/walrus"
import { SUI_PACKAGE_ID, SUI_NETWORK } from "../services/config"
import VaultGate from "../components/VaultGate.vue"
import { Editor, Toolbar } from "@wangeditor/editor-for-vue"
import type { IDomEditor, IEditorConfig, IToolbarConfig } from "@wangeditor/editor"

const walletStore = useWalletStore()
const vaultStore = useVaultStore()
const diaryStore = useDiaryStore()
const router = useRouter()

const title = ref("")
const content = ref("")
const editorMode = ref<"simple" | "pro">("simple")
const showPreview = ref(true)
const mood = ref(0)
const isSubmitting = ref(false)
const status = ref("")
const vaultBusy = ref(false)
const vaultError = ref("")

const editorRef = shallowRef<IDomEditor | null>(null)
const valueHtml = ref("")
const mediaStatus = ref("")
const audioInputRef = ref<HTMLInputElement | null>(null)
const storageDuration = ref("30")
const storageCustomDays = ref("")
const storageError = ref("")
const maxEpochs = 53
const epochDays = computed(() => (SUI_NETWORK === "mainnet" ? 14 : 1))
const maxDays = computed(() => epochDays.value * maxEpochs)
const storageOptions = computed(() => [7, 30, 90].filter(days => days <= maxDays.value))

type AssetItem = {
  blobId: string
  kind: "image" | "video" | "audio"
  mime: string
  name: string
  size: number
  url: string
}

const assets = ref<AssetItem[]>([])
const isPro = computed(() => editorMode.value === "pro")

const toolbarConfig: Partial<IToolbarConfig> = {}

const editorConfig: Partial<IEditorConfig> = {
  placeholder: "开始专业写作...",
  MENU_CONF: {
    uploadImage: {
      customUpload: async (file: File, insertFn: (url: string, alt: string, href: string) => void) => {
        const asset = await uploadFile(file, "image")
        insertFn(asset.url, asset.name, asset.url)
      }
    },
    uploadVideo: {
      customUpload: async (file: File, insertFn: (url: string, poster?: string) => void) => {
        const asset = await uploadFile(file, "video")
        insertFn(asset.url, "")
      }
    }
  }
}


function handleCreated(editor: IDomEditor) {
  editorRef.value = editor
}

onBeforeUnmount(() => {
  if (editorRef.value) {
    editorRef.value.destroy()
    editorRef.value = null
  }
  document.body.classList.remove("pro-editor")
})

function plainToHtml(text: string) {
  const safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>")
  return `<p>${safe}</p>`
}

function htmlToPlain(html: string) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html")
    return doc.body.textContent ?? ""
  } catch {
    return ""
  }
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

async function uploadFile(file: File, kind: AssetItem["kind"]): Promise<AssetItem> {
  mediaStatus.value = "正在上传媒体..."
  try {
    const settings = resolveStorageSettings()
    if (!settings) {
      mediaStatus.value = storageError.value || "请先设置有效期。"
      throw new Error(mediaStatus.value)
    }
    const blobId = await WalrusService.uploadBlob(file, { epochs: settings.epochs })
    const url = WalrusService.getPublicUrl(blobId)
    const asset: AssetItem = {
      blobId,
      kind,
      mime: file.type,
      name: file.name,
      size: file.size,
      url
    }
    assets.value = [...assets.value, asset]
    mediaStatus.value = ""
    return asset
  } catch (e) {
    console.error(e)
    mediaStatus.value = "媒体上传失败"
    throw e
  }
}

async function handleAudioUpload(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  try {
    const asset = await uploadFile(file, "audio")
    ;(editorRef.value as any)?.dangerouslyInsertHtml(
      `<p><audio controls src="${asset.url}"></audio></p>`
    )
  } catch (e) {
    console.error(e)
    mediaStatus.value = "音频上传失败"
  } finally {
    target.value = ""
  }
}

function triggerAudioUpload() {
  audioInputRef.value?.click()
}

function getProText() {
  const text = editorRef.value?.getText() ?? htmlToPlain(valueHtml.value)
  return text.trim()
}

function switchMode(next: "simple" | "pro") {
  // 专业编写暂时隐藏，保持简单模式
  editorMode.value = "simple"
  document.body.classList.remove("pro-editor")
}

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

  isSubmitting.value = true
  status.value = "正在加密日记..."

  try {
    const dekKey = await CryptoService.generateKey()
    const plainText = editorMode.value === "pro" ? getProText() : content.value.trim()

    const now = Date.now()
    const diaryData = JSON.stringify({
      version: 2,
      type: editorMode.value,
      text: plainText,
      html: editorMode.value === "pro" ? valueHtml.value : plainToHtml(content.value),
      assets: editorMode.value === "pro" ? assets.value : [],
      createdAt: now,
      storedAt: now,
      storageDays: settings.days,
      storageEpochs: settings.epochs,
      expiresAt: now + settings.days * 24 * 60 * 60 * 1000
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
    txb.moveCall({
      target: `${SUI_PACKAGE_ID}::diary::create_entry`,
      arguments: [
        txb.pure.string(title.value),
        txb.pure.string(blobId),
        txb.pure.vector("u8", Array.from(contentIv)),
        txb.pure.vector("u8", Array.from(new Uint8Array(dekCipher))),
        txb.pure.vector("u8", Array.from(dekIv)),
        txb.pure.u8(mood.value),
        txb.object("0x6")
      ]
    })

    await walletStore.signTransaction(txb)
    diaryStore.markDirty()
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

watch([storageDuration, storageCustomDays], () => {
  if (storageError.value) storageError.value = ""
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
          :disabled="isSubmitting || !title || (editorMode === 'simple' ? !content.trim() : !getProText()) || mood === 0"
          @click="submit"
        >
          {{ isSubmitting ? "保存中..." : "保存到链上" }}
        </button>
        <p v-if="status" class="text-sm text-slate-500 text-center mt-3">{{ status }}</p>
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
      </div>
    </section>
  </div>
</template>
