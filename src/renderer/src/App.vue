<script setup>
import { ref, onMounted } from 'vue'

const updateReady = ref(false)
const updateVersion = ref('')

onMounted(() => {
  if (!window.ng) return
  window.ng.onUpdateDownloaded((v) => {
    updateVersion.value = v
    updateReady.value = true
  })
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
  </div>
</template>

<style scoped>
.app-shell { height: 100%; display: flex; flex-direction: column; }
.update-banner {
  display: flex; align-items: center; gap: var(--s-2);
  padding: var(--s-2) var(--s-4);
  background: var(--surface-raised);
  border-bottom: 1px solid var(--border);
}
.update-banner .t-caption { color: var(--brand-300); flex: 1; }
</style>
