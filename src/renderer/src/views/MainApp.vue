<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'

const count = ref(0)
const goal = ref(5)
const tracking = ref(false)
const status = ref('Idle')
const connected = ref(false)
const broadcasterName = ref('')
const pinned = ref(false)

const startGoal = ref(5)
const increment = ref(5)

const cleanups = []

onMounted(async () => {
  if (!window.ng) return
  const s = await window.ng.getState()
  count.value = s.count
  goal.value = s.goal
  tracking.value = s.tracking
  connected.value = s.connected
  broadcasterName.value = s.broadcasterName
  startGoal.value = s.cfg.startGoal
  increment.value = s.cfg.increment

  cleanups.push(window.ng.onCountChanged(({ count: c, goal: g }) => {
    count.value = c; goal.value = g
  }))
  cleanups.push(window.ng.onTrackingChanged((v) => (tracking.value = v)))
  cleanups.push(window.ng.onStatus((m) => (status.value = m)))
  cleanups.push(window.ng.onAuthExpired((m) => { status.value = m; tracking.value = false }))
})

onUnmounted(() => cleanups.forEach((fn) => fn && fn()))

const remaining = computed(() => Math.max(0, goal.value - count.value))

function toggle() {
  tracking.value ? window.ng.stopTracking() : window.ng.startTracking()
}
function saveGoal() {
  window.ng.saveSettings({
    startGoal: Math.max(1, Number(startGoal.value) || 1),
    increment: Math.max(1, Number(increment.value) || 1),
  })
}
function togglePin() {
  pinned.value = !pinned.value
  window.ng.setPinned(pinned.value)
}
</script>

<template>
  <div class="wrap">
    <div class="titlebar">
      <span class="t-label">NextGoal</span>
      <div class="grow"></div>
      <button class="icon-btn" :class="{ active: pinned }" title="Pin" @click="togglePin">📌</button>
      <button class="icon-btn" title="Hide" @click="window.ng.hideFlyout()">—</button>
    </div>

    <div class="body col">
      <div class="row">
        <span class="pill">
          <span class="dot" :style="{ background: tracking ? 'var(--status-live)' : 'var(--status-idle)' }"></span>
          <span class="t-caption">{{ tracking ? 'Live' : 'Idle' }}</span>
        </span>
        <span class="t-caption" v-if="connected">Connected as {{ broadcasterName }}</span>
        <span class="t-caption" v-else>Not connected</span>
      </div>

      <div class="card counter-card col">
        <div class="counter-nums">
          <span class="t-counter">{{ count }}</span>
          <span class="t-counter sep">/</span>
          <span class="t-counter goal">{{ goal }}</span>
        </div>
        <span class="t-caption">{{ remaining }} more to the next tier</span>
      </div>

      <div class="col" style="gap:var(--s-3)">
        <span class="t-micro">Goal</span>
        <div class="row" style="align-items:flex-end">
          <label class="col field">
            <span class="t-label">Starting goal</span>
            <input type="number" min="1" v-model="startGoal" @change="saveGoal" />
          </label>
          <label class="col field">
            <span class="t-label">Increase by</span>
            <input type="number" min="1" v-model="increment" @change="saveGoal" />
          </label>
        </div>
      </div>

      <div class="row adjust">
        <button class="btn btn--secondary" @click="window.ng.adjustCount(1)">+1</button>
        <button class="btn btn--secondary" @click="window.ng.adjustCount(-1)">-1</button>
        <button class="btn btn--ghost" @click="window.ng.resetCount()">Reset</button>
      </div>

      <div class="grow"></div>
      <div class="status t-caption">{{ status }}</div>

      <div class="row">
        <button class="btn btn--primary btn--full btn--lg" @click="toggle">
          {{ tracking ? 'Stop' : 'Start' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap { height: 100%; display: flex; flex-direction: column; }
.titlebar {
  display: flex; align-items: center; gap: var(--s-2);
  padding: var(--s-2) var(--s-3); background: var(--surface);
  -webkit-app-region: drag;
}
.icon-btn {
  -webkit-app-region: no-drag;
  background: transparent; border: none; color: var(--text-muted);
  cursor: pointer; padding: 4px 6px; border-radius: var(--r-sm); font-size: 13px;
}
.icon-btn:hover { background: var(--hover); }
.icon-btn.active { color: var(--brand-300); }
.body { flex: 1; padding: var(--s-5); gap: var(--s-5); }
.counter-card { padding: var(--s-6); align-items: center; gap: var(--s-2); }
.counter-nums { display: flex; align-items: baseline; gap: 2px; }
.counter-nums .sep { color: var(--text-disabled); font-weight: 400; }
.counter-nums .goal { color: var(--status-live); }
.field { gap: var(--s-2); flex: 1; }
.adjust { gap: var(--s-2); }
.status { color: var(--text-muted); min-height: 16px; }
</style>
