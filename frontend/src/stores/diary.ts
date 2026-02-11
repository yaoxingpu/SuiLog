import { defineStore } from "pinia"
import { ref } from "vue"

export type DiaryEntryView = {
  id: string
  title: string
  blobId: string
  mood: number
  timestamp: number
  iv: Uint8Array
  encryptedDek: Uint8Array
  dekIv: Uint8Array
  packageId?: string
  unlockAt?: number
}

export type ShareEventView = {
  id: string
  entryId: string
  expiry: number
  createdAt: number
  link: string
  status: "active" | "expired" | "revoked" | "deleted"
  exists: boolean
}

export const useDiaryStore = defineStore("diary", () => {
  const account = ref<string | null>(null)
  const diaries = ref<DiaryEntryView[]>([])
  const eventCursor = ref<string | null>(null)
  const hasNextPage = ref(true)
  const lastLoadedAt = ref<number | null>(null)
  const shareEvents = ref<ShareEventView[]>([])
  const shareLoadedAt = ref<number | null>(null)
  const dirty = ref(false)

  function setAccount(next: string | null) {
    account.value = next
  }

  function setEntries(list: DiaryEntryView[], cursor: string | null, nextPage: boolean) {
    diaries.value = list
    eventCursor.value = cursor
    hasNextPage.value = nextPage
    lastLoadedAt.value = Date.now()
    dirty.value = false
  }

  function updateEntries(list: DiaryEntryView[], cursor: string | null, nextPage: boolean) {
    diaries.value = list
    eventCursor.value = cursor
    hasNextPage.value = nextPage
    lastLoadedAt.value = Date.now()
  }

  function setShares(list: ShareEventView[]) {
    shareEvents.value = list
    shareLoadedAt.value = Date.now()
  }

  function markDirty() {
    dirty.value = true
  }

  function clear() {
    diaries.value = []
    shareEvents.value = []
    eventCursor.value = null
    hasNextPage.value = true
    lastLoadedAt.value = null
    shareLoadedAt.value = null
    dirty.value = false
    account.value = null
  }

  return {
    account,
    diaries,
    eventCursor,
    hasNextPage,
    lastLoadedAt,
    shareEvents,
    shareLoadedAt,
    dirty,
    setAccount,
    setEntries,
    updateEntries,
    setShares,
    markDirty,
    clear
  }
})
