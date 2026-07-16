<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const count = ref(0)
const goal = ref(5)
const tracking = ref(false)
const status = ref('')
const connected = ref(false)
const broadcasterName = ref('')
const broadcasterAvatar = ref('')
const synced = ref(false)

const startGoal = ref(5)
const increment = ref(5)
const obsHost = ref('localhost')
const obsPort = ref(4455)
const obsSource = ref('')

const cleanups = []

onMounted(async () => {
  if (!window.ng) return
  const s = await window.ng.getState()
  count.value = s.count
  goal.value = s.goal
  tracking.value = s.tracking
  connected.value = s.connected
  broadcasterName.value = s.broadcasterName
  broadcasterAvatar.value = s.broadcasterAvatar
  synced.value = s.synced
  startGoal.value = s.cfg.startGoal
  increment.value = s.cfg.increment
  obsHost.value = s.cfg.obsHost
  obsPort.value = s.cfg.obsPort
  obsSource.value = s.cfg.obsSource

  cleanups.push(window.ng.onCountChanged(({ count: c, goal: g }) => {
    count.value = c; goal.value = g
  }))
  cleanups.push(window.ng.onTrackingChanged((v) => (tracking.value = v)))
  cleanups.push(window.ng.onStatus((m) => (status.value = m)))
  cleanups.push(window.ng.onAuthExpired((m) => { status.value = m; tracking.value = false }))
})

onUnmounted(() => cleanups.forEach((fn) => fn && fn()))

function toggle() {
  tracking.value ? window.ng.stopTracking() : window.ng.startTracking()
}
function reset() {
  window.ng.resetCount()
}
function saveGoal() {
  window.ng.saveSettings({
    startGoal: Math.max(1, Number(startGoal.value) || 1),
    increment: Math.max(1, Number(increment.value) || 1),
  })
}
async function onSync(e) {
  const on = e.target.checked
  const res = await window.ng.syncSubCount(on)
  if (res && res.ok) {
    synced.value = res.synced
    count.value = res.count
    goal.value = res.goal
  } else {
    synced.value = false
    e.target.checked = false
    if (res && res.error) status.value = res.error
  }
}
function editSetup() {
  router.push({ path: '/onboarding', query: { mode: 'edit' } })
}
</script>

<template>
  <div class="wrap">
    <header class="head">
      <div class="brand">
        <span class="t-title">NextGoal</span>
        <span class="pill">
          <span class="dot" :style="{ background: tracking ? 'var(--status-live)' : 'var(--status-ok)' }"></span>
          <span class="t-caption">{{ tracking ? 'Active' : 'Ready' }}</span>
        </span>
      </div>
      <div class="user" v-if="connected">
        <span class="t-label muted">{{ broadcasterName }}</span>
        <img v-if="broadcasterAvatar" class="avatar" :src="broadcasterAvatar" alt="" />
        <span v-else class="avatar avatar--empty"></span>
      </div>
    </header>

    <div class="body">
      <!-- SETUP -->
      <section class="col" style="gap:var(--s-2)">
        <span class="t-micro">Setup</span>
        <div class="card setup-card">
          <div class="col" style="gap:var(--s-1)">
            <span class="src"><span class="aa">Aa</span><span class="t-label">{{ obsSource || 'No source' }}</span></span>
            <span class="t-caption">{{ obsHost }}:{{ obsPort }} · Authenticated</span>
          </div>
          <button class="btn btn--ghost" @click="editSetup">Edit</button>
        </div>
      </section>

      <!-- GOAL -->
      <section class="col" style="gap:var(--s-2)">
        <span class="t-micro">Goal</span>
        <div class="row" style="gap:var(--s-3); align-items:flex-start">
          <label class="col field">
            <span class="t-label muted">Starting goal</span>
            <input type="number" min="1" v-model="startGoal" @change="saveGoal" :disabled="synced" />
          </label>
          <label class="col field">
            <span class="t-label muted">Increase by</span>
            <input type="number" min="1" v-model="increment" @change="saveGoal" />
          </label>
        </div>
      </section>

      <!-- COUNTER -->
      <div class="counter-area">
        <div class="counter">
          <span>{{ count }}</span><span class="sep">/</span><span class="goal">{{ goal }}</span>
        </div>
      </div>

      <!-- SYNC -->
      <label class="sync">
        <input type="checkbox" :checked="synced" @change="onSync" />
        <span class="t-label muted">{{ synced ? 'Synced current sub count' : 'Sync to current sub count' }}</span>
      </label>

      <div class="status t-caption">{{ status }}</div>
    </div>

    <footer class="foot">
      <button class="btn btn--secondary btn--lg foot-btn" @click="reset">Reset</button>
      <button class="btn btn--primary btn--lg foot-btn" @click="toggle">
        {{ tracking ? 'Stop' : 'Start' }}
      </button>
    </footer>
  </div>
</template>

<style scoped>
.wrap { height: 100%; display: flex; flex-direction: column; }
.muted { color: var(--text-muted); }

.head { display: flex; align-items: center; justify-content: space-between; padding: 40px 40px 0; }
.brand { display: flex; align-items: center; gap: var(--s-2); }
.user { display: flex; align-items: center; gap: var(--s-2); }
.avatar { width: 28px; height: 28px; border-radius: var(--r-full); object-fit: cover; }
.avatar--empty { background: var(--surface-raised); }

.body { flex: 1; display: flex; flex-direction: column; padding: var(--s-6) 40px; gap: var(--s-6); min-height: 0; }

.setup-card { display: flex; align-items: center; justify-content: space-between; padding: var(--s-3) var(--s-4); }
.src { display: flex; align-items: center; gap: var(--s-2); }
.aa { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: var(--r-sm);
  background: var(--surface-raised); color: var(--text-muted); font-size: 11px; font-weight: 600; }

.field { gap: var(--s-2); flex: 1; }

.counter-area { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 0; }
.counter { display: flex; align-items: baseline; gap: 2px;
  font-size: 88px; line-height: 1; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums;
  color: var(--text); }
.counter .sep { color: var(--text-muted); }
.counter .goal { color: var(--status-live); }

.sync { display: flex; align-items: center; justify-content: center; gap: var(--s-2); cursor: pointer; }
.sync input { width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer; }

.status { color: var(--text-muted); min-height: 16px; text-align: center; }

.foot { display: flex; gap: var(--s-3); padding: var(--s-5) 40px var(--s-8); }
.foot-btn { flex: 1; }
</style>
