<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const updateReady = ref(false)
const updateVersion = ref('')

// Transient error/warning toast. Replaces the old inline "status" line — any
// genuine problem (OBS write failure, auth expired, unencrypted-storage warning)
// slides in at the top and fades on its own; nothing shows when all is well.
const toast = ref('')
const toastKind = ref('error') // 'error' | 'warn'
let toastTimer = null
const cleanups = []

function showToast(msg, kind = 'error') {
  if (!msg) return
  toast.value = msg
  toastKind.value = kind
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 6000)
}

onMounted(() => {
  if (!window.ng) return
  cleanups.push(window.ng.onUpdateDownloaded((v) => {
    updateVersion.value = v
    updateReady.value = true
  }))
  cleanups.push(window.ng.onStatus((m) => showToast(m, 'error')))
  cleanups.push(window.ng.onWarning((m) => showToast(m, 'warn')))
  cleanups.push(window.ng.onAuthExpired((m) => showToast(m, 'error')))
})

onUnmounted(() => {
  if (toastTimer) clearTimeout(toastTimer)
  cleanups.forEach((fn) => fn && fn())
})

function install() {
  window.ng.installUpdate()
}
</script>

<template>
  <div class="app-shell">
    <div v-if="updateReady" class="update-banner">
      <span class="t-caption">Version {{ updateVersion }} is ready.</span>
      <button class="btn btn--primary" style="height:26px" @click="install">Restart & update</button>
      <button class="btn btn--ghost" style="height:26px" @click="updateReady = false">Later</button>
    </div>
    <router-view />
    <transition name="toast">
      <div v-if="toast" class="toast" :class="`toast--${toastKind}`" role="status">
        <span class="t-caption">{{ toast }}</span>
        <button class="toast-x" aria-label="Dismiss" @click="toast = ''">&times;</button>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.app-shell { height: 100%; display: flex; flex-direction: column; position: relative; }
.update-banner {
  display: flex; align-items: center; gap: var(--s-2);
  padding: var(--s-2) var(--s-4);
  background: var(--surface-raised);
  border-bottom: 1px solid var(--border);
}
.update-banner .t-caption { color: var(--brand-300); flex: 1; }

.toast {
  position: absolute; left: var(--s-4); right: var(--s-4); top: var(--s-4); z-index: 50;
  display: flex; align-items: center; gap: var(--s-2);
  padding: var(--s-2) var(--s-3);
  background: var(--surface-raised); border: 1px solid var(--border);
  border-radius: var(--r-md); box-shadow: 0 8px 24px rgba(0, 0, 0, .4);
}
.toast--error { border-color: var(--err-500); }
.toast--warn { border-color: var(--warn-500); }
.toast .t-caption { flex: 1; color: var(--text); }
.toast--error .t-caption { color: var(--err-500); }
.toast--warn .t-caption { color: var(--warn-500); }
.toast-x { flex: 0 0 auto; background: none; border: 0; cursor: pointer;
  color: var(--text-muted); font-size: 18px; line-height: 1; padding: 0 4px; }
.toast-x:hover { color: var(--text); }

.toast-enter-active, .toast-leave-active { transition: opacity var(--dur) var(--ease), transform var(--dur) var(--ease); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
