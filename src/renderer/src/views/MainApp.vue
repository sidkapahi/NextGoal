<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import gearIcon from '../assets/icon-settings.svg'
import StatusPill from '../components/StatusPill.vue'
import GoalBoost from '../components/GoalBoost.vue'
import ConfirmOverlay from '../components/ConfirmOverlay.vue'

// Monochrome 16px platform glyphs for the Total Subs card.
import twitchLogo from '../assets/ui-twitch.svg'
import kickLogo from '../assets/ui-kick.svg'
import youtubeLogo from '../assets/ui-youtube.svg'

const router = useRouter()

const PLATFORM_META = {
  twitch: { label: 'Twitch', logo: twitchLogo },
  kick: { label: 'Kick', logo: kickLogo },
  youtube: { label: 'YouTube', logo: youtubeLogo },
}
// Total Subs icon order follows the design (twitch · kick · youtube).
const ICON_ORDER = ['twitch', 'kick', 'youtube']

const count = ref(0)
const session = ref(0)
const goal = ref(5)
const tracking = ref(false)
const synced = ref(false)
const increment = ref(5)
const defaultIncrement = ref(5)
const obsOnline = ref(true) // optimistic until the open-probe reports back
const obsSource = ref('')
const platforms = ref([])
const totals = ref({ per: {}, sum: 0, hasAny: false })

// Which Total Subs platform icon is hovered (reveals its per-platform figure).
const hoverPlatform = ref(null)

const confirmingReset = ref(false)

const cleanups = []
let onFocus = null

onMounted(async () => {
  if (!window.ng) return
  const s = await window.ng.getState()
  count.value = s.count
  session.value = s.session ?? s.count
  goal.value = s.goal
  tracking.value = s.tracking
  synced.value = !!s.synced
  increment.value = s.increment
  defaultIncrement.value = s.cfg?.increment ?? s.increment
  obsSource.value = s.cfg?.obsSource || ''
  platforms.value = s.platforms || []
  if (s.totals) totals.value = s.totals

  cleanups.push(
    window.ng.onCountChanged(({ count: c, goal: g, synced: sy, session: se, platforms: p }) => {
      count.value = c
      goal.value = g
      if (typeof sy === 'boolean') synced.value = sy
      if (typeof se === 'number') session.value = se
      if (p) platforms.value = p
    })
  )
  cleanups.push(window.ng.onTrackingChanged((v) => (tracking.value = v)))
  cleanups.push(window.ng.onObsStatus(({ online }) => (obsOnline.value = !!online)))
  cleanups.push(window.ng.onTotalsChanged((t) => (totals.value = t)))
  cleanups.push(window.ng.onAuthExpired(() => {}))

  // On-demand freshness (no background timers): refresh totals + probe OBS on
  // open and whenever the window regains focus.
  refreshOnShow()
  onFocus = () => refreshOnShow()
  window.addEventListener('focus', onFocus)
})

onUnmounted(() => {
  cleanups.forEach((fn) => fn && fn())
  if (onFocus) window.removeEventListener('focus', onFocus)
})

async function refreshOnShow() {
  window.ng.refreshTotals()
  const r = await window.ng.obsPing()
  if (r && typeof r.online === 'boolean') obsOnline.value = r.online
}

// ---- health pill (precedence) ----
const anyConnected = computed(() => platforms.value.some((p) => p.connected))
const health = computed(() => {
  if (tracking.value) return { label: 'Live', tone: 'live' }
  if (!anyConnected.value) return { label: 'No Channels', tone: 'warn' }
  if (!obsSource.value) return { label: 'No Source Selected', tone: 'warn' }
  if (!obsOnline.value) return { label: 'OBS Offline', tone: 'warn' }
  return { label: 'Ready', tone: 'ok' }
})
// OBS being offline (or no source picked) no longer blocks Start — the counter
// runs and OBS catches up when it reconnects. Only a connected channel is
// required.
const canStart = computed(() => tracking.value || anyConnected.value)

// ---- subs cards ----
// Which card drives the counter: 'total' when synced to all-time totals,
// otherwise 'session' (subs gained this session).
const activeCard = computed(() => (synced.value ? 'total' : 'session'))
const sessionDisplay = computed(() =>
  tracking.value || session.value > 0 ? String(session.value) : '-'
)

// Platforms whose total counts (connected + "Add in total"), in icon order.
const includedIcons = computed(() =>
  ICON_ORDER.filter((id) => {
    const p = platforms.value.find((x) => x.id === id)
    return p && p.connected && p.enabled
  })
)
const totalLabel = computed(() =>
  hoverPlatform.value ? PLATFORM_META[hoverPlatform.value].label : 'Total Subs'
)
const totalValue = computed(() => {
  if (hoverPlatform.value) {
    const v = totals.value.per?.[hoverPlatform.value]
    return v == null ? '-' : String(v)
  }
  return totals.value.hasAny ? String(totals.value.sum) : '-'
})

// ---- actions ----
function toggle() {
  tracking.value ? window.ng.stopTracking() : window.ng.startTracking()
}
function bumpCount(n) {
  window.ng.adjustCount(n)
}
function bumpGoal(n) {
  window.ng.adjustGoal(n)
}
function setBoost(v) {
  increment.value = v
  window.ng.setSessionGoal({ increment: v })
}
function doReset() {
  // Reset the goal boost back to the saved default and zero the session count.
  window.ng.setSessionGoal({ increment: defaultIncrement.value })
  increment.value = defaultIncrement.value
  window.ng.resetCount()
  confirmingReset.value = false
}
// Pick which source drives the counter. Selecting Total Subs syncs to the live
// all-time totals; selecting Current Session counts subs gained from now. The
// backend returns the resulting `synced` state (and pushes count-changed), so a
// failed sync (e.g. no platform connected) simply leaves the selection as-is.
async function selectCard(card) {
  if (activeCard.value === card) return
  const res = await window.ng.syncSubCount(card === 'total')
  if (res && typeof res.synced === 'boolean') synced.value = res.synced
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
        <StatusPill :label="health.label" :tone="health.tone" />
      </div>
      <button class="icon-btn" aria-label="Settings" @click="openSettings">
        <span class="icon gear" :style="{ '--icon': `url(${gearIcon})` }"></span>
      </button>
    </header>

    <div class="body">
      <GoalBoost :increment="increment" @set="setBoost" />

      <!-- COUNTER: +/- stacked over/under each number, brand slash between -->
      <div class="counter">
        <div class="num-col">
          <button class="pm pm--count" aria-label="Add to count" @click="bumpCount(1)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <span class="num count" :class="{ live: tracking }">{{ count }}</span>
          <button class="pm pm--count" aria-label="Subtract from count" @click="bumpCount(-1)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
          </button>
        </div>
        <span class="num slash">/</span>
        <div class="num-col">
          <button class="pm pm--goal" aria-label="Raise goal" @click="bumpGoal(1)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <span class="num goal">{{ goal }}</span>
          <button class="pm pm--goal" aria-label="Lower goal" @click="bumpGoal(-1)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
          </button>
        </div>
      </div>

      <!-- SUBS: current session + all-time total -->
      <section class="subs">
        <span class="subs-label">SUBS</span>
        <div class="subs-row">
          <button
            type="button"
            class="sub-card"
            :class="{ active: activeCard === 'session' }"
            :aria-pressed="activeCard === 'session'"
            @click="selectCard('session')"
          >
            <div class="sub-top">
              <span class="sub-title">Current Session</span>
            </div>
            <div class="sub-bottom">
              <span class="sub-value" :class="{ live: tracking && activeCard === 'session' }">{{ sessionDisplay }}</span>
              <span v-if="activeCard === 'session'" class="active">ACTIVE</span>
            </div>
          </button>

          <button
            type="button"
            class="sub-card total"
            :class="{ active: activeCard === 'total' }"
            :aria-pressed="activeCard === 'total'"
            @click="selectCard('total')"
          >
            <div class="sub-top">
              <span class="sub-title">{{ totalLabel }}</span>
              <div v-if="includedIcons.length" class="icons">
                <img
                  v-for="id in includedIcons"
                  :key="id"
                  :src="PLATFORM_META[id].logo"
                  :alt="PLATFORM_META[id].label"
                  class="plat-icon"
                  :class="{ dim: hoverPlatform && hoverPlatform !== id }"
                  width="16"
                  height="16"
                  @mouseenter="hoverPlatform = id"
                  @mouseleave="hoverPlatform = null"
                />
              </div>
            </div>
            <div class="sub-bottom">
              <span class="sub-value" :class="{ live: tracking && activeCard === 'total' }">{{ totalValue }}</span>
              <span v-if="activeCard === 'total'" class="active">ACTIVE</span>
            </div>
          </button>
        </div>
      </section>
    </div>

    <footer class="foot">
      <button
        class="btn btn--lg foot-start"
        :class="tracking ? 'btn--danger' : 'btn--primary'"
        :disabled="!canStart"
        @click="toggle"
      >
        {{ tracking ? 'Stop' : 'Start' }}
      </button>
      <button class="btn btn--secondary btn--lg foot-reset" @click="confirmingReset = true">
        Reset
      </button>
    </footer>

    <ConfirmOverlay
      v-if="confirmingReset"
      title="Would you like to reset?"
      body="This will reset your selected goal boost to default and your current session count to 0."
      confirm-label="Reset"
      cancel-label="Nevermind"
      @confirm="doReset"
      @cancel="confirmingReset = false"
    />
  </div>
</template>

<style scoped>
.wrap { height: 100%; display: flex; flex-direction: column; position: relative; }

.head { display: flex; align-items: center; justify-content: space-between; padding: 40px 40px 0; }
.brand { display: flex; align-items: center; gap: var(--s-3); }

.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
  border: 0; background: transparent; border-radius: var(--r-md); cursor: pointer; color: var(--text-secondary);
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
.icon-btn:hover { background: var(--hover); color: var(--text); }
.gear { width: 28px; height: 28px; }

.body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--s-6); padding: 40px; min-height: 0; }

/* Counter — Figma: gap 4 between columns; each column gap 28; number 128px;
   count text/primary (green when live), slash Light, goal brand. +/- 24px. */
.counter { display: flex; align-items: center; justify-content: center; gap: var(--s-1);
  padding: var(--s-4) var(--s-6); }
.num-col { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; }
.num { font-size: 128px; line-height: 1; font-weight: 700; letter-spacing: -1.1px; font-variant-numeric: tabular-nums; }
.num.count { color: var(--text); }
.num.count.live { color: var(--status-ok); }
.num.goal { color: var(--primary); }
.num.slash { color: var(--text); font-weight: 300; }

.pm { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px;
  padding: 0; border: 0; background: transparent; cursor: pointer;
  transition: transform var(--dur) var(--ease), opacity var(--dur) var(--ease); }
.pm svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2;
  stroke-linecap: round; stroke-linejoin: round; }
.pm--count { color: var(--text); }
.pm--goal { color: var(--primary); }
.pm:hover { opacity: .8; }
.pm:active { transform: scale(.92); }
.pm:focus-visible { outline: none; box-shadow: var(--focus); border-radius: var(--r-full); }

/* SUBS */
.subs { display: flex; flex-direction: column; gap: var(--s-3); width: 380px; align-self: center; }
.subs-label { font-size: 13px; line-height: 1.4; font-weight: 500; color: var(--text-secondary); }
.subs-row { display: flex; gap: var(--s-3); align-items: stretch; }
.sub-card { background: var(--surface-sunken); border: 1px solid var(--border); border-radius: var(--r-lg);
  padding: 10px var(--s-4); display: flex; flex-direction: column; gap: var(--s-2); flex: 1 1 0; min-width: 0;
  font-family: inherit; text-align: left; cursor: pointer; appearance: none;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease); }
.sub-card.total { flex: 0 0 184px; }
.sub-card:hover { border-color: var(--border-strong, var(--text-muted)); }
.sub-card.active { border-color: var(--status-ok); }
.sub-card:focus-visible { outline: none; box-shadow: var(--focus); }
.sub-top { display: flex; align-items: center; gap: var(--s-2); min-height: 20px; }
.sub-title { flex: 1 1 auto; font-size: 13px; line-height: 1.4; font-weight: 500; color: var(--text-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* ACTIVE sits on the value row, aligned to the number (not the title). */
.sub-bottom { display: flex; align-items: baseline; justify-content: space-between; gap: var(--s-2); }
.active { flex: 0 0 auto; font-size: 11px; line-height: 1.3; font-weight: 500; letter-spacing: .06em; color: var(--status-ok); }
.sub-value { font-size: 20px; line-height: 1.3; font-weight: 500; letter-spacing: -0.2px; color: var(--text);
  font-variant-numeric: tabular-nums; }
.sub-value.live { color: var(--status-ok); }
.icons { display: flex; align-items: center; gap: var(--s-1); flex: 0 0 auto; }
.plat-icon { display: block; cursor: default; transition: opacity var(--dur) var(--ease); }
.plat-icon.dim { opacity: .35; }

/* Figma: Start grows to fill, Reset is a fixed 108px; gap 12. */
.foot { display: flex; gap: var(--s-3); padding: var(--s-4) 40px var(--s-8); }
.foot-start { flex: 1 1 0; }
.foot-reset { flex: 0 0 108px; }
</style>
