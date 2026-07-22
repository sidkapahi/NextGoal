<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import gearIcon from '../assets/icon-settings.svg'
import plusIcon from '../assets/icon-plus.svg'
import minusIcon from '../assets/icon-minus.svg'

const router = useRouter()

const count = ref(0)
const goal = ref(5)
const tracking = ref(false)
const synced = ref(false)

const startGoal = ref(5)
const increment = ref(5)

const cleanups = []

onMounted(async () => {
  if (!window.ng) return
  const s = await window.ng.getState()
  count.value = s.count
  goal.value = s.goal
  tracking.value = s.tracking
  synced.value = s.synced
  startGoal.value = s.startGoal
  increment.value = s.increment

  cleanups.push(window.ng.onCountChanged(({ count: c, goal: g }) => {
    count.value = c; goal.value = g
  }))
  cleanups.push(window.ng.onTrackingChanged((v) => (tracking.value = v)))
  cleanups.push(window.ng.onAuthExpired(() => { tracking.value = false }))
})

onUnmounted(() => cleanups.forEach((fn) => fn && fn()))

// Starting goal is locked while live (session base is fixed) and while synced
// (the base comes from the sub total, not the starting goal).
const startLocked = computed(() => tracking.value || synced.value)

function toggle() {
  tracking.value ? window.ng.stopTracking() : window.ng.startTracking()
}
function reset() {
  if (tracking.value) return
  window.ng.resetCount()
}
function saveGoal() {
  window.ng.setSessionGoal({
    startGoal: Math.max(1, Number(startGoal.value) || 1),
    increment: Math.max(1, Number(increment.value) || 1),
  })
}
function bumpCount(n) { window.ng.adjustCount(n) }
function bumpGoal(n) { window.ng.adjustGoal(n) }

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
  }
}

function openSettings() {
  router.push('/settings')
}
</script>

<template>
  <div class="wrap">
    <header class="head">
      <div class="brand">
        <span class="t-title">NextGoal</span>
        <span class="pill">
          <span class="dot" :style="{ background: tracking ? 'var(--status-ok)' : 'var(--primary)' }"></span>
          <span class="t-caption">{{ tracking ? 'Live' : 'Ready' }}</span>
        </span>
      </div>
      <button class="icon-btn" aria-label="Settings" @click="openSettings">
        <span class="icon gear" :style="{ '--icon': `url(${gearIcon})` }"></span>
      </button>
    </header>

    <div class="body">
      <!-- GOAL INPUTS (live session values) -->
      <div class="goal-row">
        <label class="col field">
          <span class="t-label muted">Starting goal</span>
          <input type="number" min="1" v-model="startGoal" @change="saveGoal" :disabled="startLocked" />
        </label>
        <label class="col field">
          <span class="t-label muted">Increase by</span>
          <input type="number" min="1" v-model="increment" @change="saveGoal" />
        </label>
      </div>

      <!-- COUNTER with +/- above & below each number -->
      <div class="counter-area">
        <div class="counter" :class="{ synced }">
          <button class="pm pm--count" aria-label="Add to count" @click="bumpCount(1)">
            <span class="icon" :style="{ '--icon': `url(${plusIcon})` }"></span>
          </button>
          <span class="spacer"></span>
          <button class="pm pm--goal" aria-label="Raise goal" @click="bumpGoal(1)">
            <span class="icon" :style="{ '--icon': `url(${plusIcon})` }"></span>
          </button>

          <span class="num count">{{ count }}</span>
          <span class="num slash">/</span>
          <span class="num goal">{{ goal }}</span>

          <button class="pm pm--count" aria-label="Subtract from count" @click="bumpCount(-1)">
            <span class="icon" :style="{ '--icon': `url(${minusIcon})` }"></span>
          </button>
          <span class="spacer"></span>
          <button class="pm pm--goal" aria-label="Lower goal" @click="bumpGoal(-1)">
            <span class="icon" :style="{ '--icon': `url(${minusIcon})` }"></span>
          </button>
        </div>
      </div>

      <!-- SYNC -->
      <label class="sync" :class="{ on: synced }">
        <input type="checkbox" :checked="synced" @change="onSync" />
        <span class="t-label">Sync total sub count</span>
      </label>
    </div>

    <footer class="foot">
      <button
        class="btn btn--lg foot-start"
        :class="tracking ? 'btn--danger' : 'btn--primary'"
        @click="toggle"
      >
        {{ tracking ? 'Stop' : 'Start' }}
      </button>
      <button class="btn btn--secondary btn--lg foot-reset" :disabled="tracking" @click="reset">Reset</button>
    </footer>
  </div>
</template>

<style scoped>
.wrap { height: 100%; display: flex; flex-direction: column; }
.muted { color: var(--text-muted); }

.head { display: flex; align-items: center; justify-content: space-between; padding: 40px 40px 0; }
.brand { display: flex; align-items: center; gap: var(--s-2); }

.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
  border: 0; background: transparent; border-radius: var(--r-md); cursor: pointer; color: var(--text-muted);
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
.icon-btn:hover { background: var(--hover); color: var(--text); }
.gear { width: 20px; height: 20px; }

.body { flex: 1; display: flex; flex-direction: column; padding: var(--s-6) 40px; gap: var(--s-4); min-height: 0; }

.goal-row { display: flex; gap: var(--s-3); align-items: flex-start; }
.field { gap: var(--s-2); flex: 1; }
.field input:disabled { opacity: .5; cursor: not-allowed; }

/* Counter: 3 columns (count | slash | goal) × 3 rows (plus | number | minus). */
.counter-area { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 0; }
.counter {
  display: grid;
  grid-template-columns: auto auto auto;
  grid-template-rows: auto auto auto;
  align-items: center; justify-items: center;
  column-gap: var(--s-5);
}
.num { font-size: 104px; line-height: 1; font-weight: 700; letter-spacing: -.02em;
  font-variant-numeric: tabular-nums; }
.num.count { color: var(--text); }
.num.slash { color: var(--text-muted); }
.num.goal { color: var(--primary); }
.spacer { width: 1px; }

/* Synced: the count number and its +/- turn green; the goal stays brand. */
.counter.synced .num.count { color: var(--status-ok); }
.counter.synced .pm--count { color: var(--status-ok); }

.pm { display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; padding: 0; border: 0; background: transparent; cursor: pointer;
  transition: transform var(--dur) var(--ease), opacity var(--dur) var(--ease); }
.pm .icon { width: 32px; height: 32px; }
.pm--count { color: var(--text); }
.pm--goal { color: var(--primary); }
.pm:hover { opacity: .8; }
.pm:active { transform: scale(.92); }
.pm:focus-visible { outline: none; box-shadow: var(--focus); border-radius: var(--r-full); }

.sync { display: flex; align-items: center; justify-content: center; gap: var(--s-2); cursor: pointer;
  color: var(--text-muted); }
.sync.on { color: var(--status-ok); }
.sync input { width: 18px; height: 18px; accent-color: var(--status-ok); cursor: pointer; }

.foot { display: flex; gap: var(--s-3); padding: var(--s-5) 40px var(--s-8); }
.foot-start { flex: 1.9; }
.foot-reset { flex: 1; }
</style>
