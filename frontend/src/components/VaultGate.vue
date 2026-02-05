<script setup lang="ts">
import { ref, watch } from "vue"

type VaultStatus = "missing" | "locked" | "unlocked"

const props = defineProps<{
  status: VaultStatus
  busy?: boolean
  title?: string
  subtitle?: string
  showReset?: boolean
}>()

const emit = defineEmits<{
  (e: "create", payload: { password: string; confirm: string }): void
  (e: "unlock", password: string): void
  (e: "lock"): void
  (e: "reset"): void
}>()

const password = ref("")
const confirm = ref("")
const error = ref("")

watch(
  () => props.status,
  () => {
    password.value = ""
    confirm.value = ""
    error.value = ""
  }
)

function handleCreate() {
  error.value = ""
  if (password.value.length < 8) {
    error.value = "密码至少 8 个字符。"
    return
  }
  if (password.value !== confirm.value) {
    error.value = "两次密码不一致。"
    return
  }
  emit("create", { password: password.value, confirm: confirm.value })
}

function handleUnlock() {
  error.value = ""
  if (!password.value) {
    error.value = "请输入保险库密码。"
    return
  }
  emit("unlock", password.value)
}
</script>

<template>
  <div class="vault-panel">
    <div class="vault-header">
      <div>
        <p class="vault-title">{{ title ?? "保险库" }}</p>
        <p class="vault-subtitle">{{ subtitle ?? "加密一次，处处解锁。" }}</p>
      </div>
      <div v-if="status === 'unlocked'" class="vault-status">
        <span class="vault-dot"></span>
        已解锁
      </div>
      <div v-else class="vault-status locked">
        <span class="vault-dot"></span>
        已锁定
      </div>
    </div>

    <div v-if="status === 'missing'" class="vault-body">
      <div class="vault-field">
        <label>创建密码</label>
        <input v-model="password" type="password" placeholder="至少 8 个字符" />
      </div>
      <div class="vault-field">
        <label>确认密码</label>
        <input v-model="confirm" type="password" placeholder="再次输入确认" />
      </div>
      <button class="vault-action" :disabled="busy" @click="handleCreate">
        {{ busy ? "创建中..." : "创建保险库" }}
      </button>
      <p class="vault-hint">密码仅保存在本地设备。</p>
    </div>

    <div v-else-if="status === 'locked'" class="vault-body">
      <div class="vault-field">
        <label>保险库密码</label>
        <input v-model="password" type="password" placeholder="输入保险库密码" />
      </div>
      <button class="vault-action" :disabled="busy" @click="handleUnlock">
        {{ busy ? "解锁中..." : "解锁保险库" }}
      </button>
      <p class="vault-hint">忘记密码？可以本地重置，但旧日记将无法解密。</p>
      <button v-if="showReset" class="vault-reset" :disabled="busy" @click="emit('reset')">
        重置保险库
      </button>
    </div>

    <div v-else class="vault-body">
      <div class="vault-unlocked">
        <p>保险库就绪，可以阅读、写作与分享加密内容。</p>
        <button class="vault-ghost" :disabled="busy" @click="emit('lock')">锁定保险库</button>
      </div>
    </div>

    <p v-if="error" class="vault-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.vault-panel {
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 20px;
  padding: 20px 22px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(10px);
}

.vault-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.vault-title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.vault-subtitle {
  font-size: 13px;
  color: rgba(15, 23, 42, 0.6);
}

.vault-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #0f172a;
  background: #e2fbe8;
  border-radius: 999px;
  padding: 6px 10px;
}

.vault-status.locked {
  background: #fdecec;
  color: #7f1d1d;
}

.vault-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #22c55e;
}

.vault-status.locked .vault-dot {
  background: #ef4444;
}

.vault-body {
  display: grid;
  gap: 12px;
}

.vault-field label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: rgba(15, 23, 42, 0.65);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin-bottom: 6px;
}

.vault-field input {
  width: 100%;
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  padding: 12px 14px;
  font-size: 14px;
  background: rgba(248, 250, 252, 0.9);
}

.vault-action {
  width: 100%;
  border-radius: 12px;
  padding: 12px 16px;
  font-weight: 700;
  background: #0f172a;
  color: #fff;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.vault-action:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.2);
}

.vault-ghost {
  border: 1px solid rgba(15, 23, 42, 0.2);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
}

.vault-hint {
  font-size: 12px;
  color: rgba(15, 23, 42, 0.55);
}

.vault-error {
  margin-top: 10px;
  font-size: 12px;
  color: #b91c1c;
}

.vault-unlocked {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
  color: rgba(15, 23, 42, 0.7);
}

.vault-reset {
  border: 1px solid rgba(185, 28, 28, 0.3);
  color: #b91c1c;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  background: rgba(254, 226, 226, 0.6);
}
</style>
