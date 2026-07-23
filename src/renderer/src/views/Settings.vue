<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import closeIcon from '../assets/icon-close.svg'
import alertIcon from '../assets/icon-alert.svg'
import twitchWhite from '../assets/twitch-white.svg'
import youtubeLogo from '../assets/youtube.svg'
import kickLogo from '../assets/kick.svg'

const router = useRouter()

const tab = ref('general') // general | obs | twitch | youtube | kick

// --- platforms ---
const PLATFORMS = [
  { id: 'twitch', label: 'Twitch', logo: twitchWhite, cls: 'btn--twitch', unit: 'subs' },
  { id: 'youtube', label: 'YouTube', logo: youtubeLogo, cls: 'btn--youtube', unit: 'members' },
  { id: 'kick', label: 'Kick', logo: kickLogo, cls: 'btn--kick', unit: 'subs' },
]
// keyed by platform id → { connected, name, enabled }
const platforms = ref({
  twitch: { connected: false, name: '', enabled: true },
  youtube: { connected: false, name: '', enabled: true },
  kick: { connected: false, name: '', enabled: true },
})
// device-code prompt currently showing (twitch/youtube); kick uses the browser
const activeCode = ref({ platform: '', userCode: '', verifyUri: '' })
const meta = (id) => PLATFORMS.find((p) => p.id === id)
const anyConnected = computed(() => Object.values(platforms.value).some((p) => p.connected))

// --- general (persisted default goal settings) ---
const defStartGoal = ref(5)
const defIncrement = ref(5)
const confirmDelete = ref(false)

// --- obs ---
const obsHost = ref('localhost')
const obsPort = ref(4455)
const obsPassword = ref('')
const showPw = ref(false)
const obsSource = ref('')
const editingSource = ref(false)
const sources = ref([])
const selected = ref('')
const customName = ref('')
const obsBusy = ref(false)
const testState = ref('idle') // idle | testing | success | error

const cleanups = []

onMounted(async () => {
  if (!window.ng) return
  const s = await window.ng.getState()
  for (const p of s.platforms || []) {
    platforms.value[p.id] = { connected: p.connected, name: p.name, enabled: p.enabled }
  }
  defStartGoal.value = s.cfg.startGoal
  defIncrement.value = s.cfg.increment
  obsHost.value = s.cfg.obsHost
  obsPort.value = s.cfg.obsPort
  obsPassword.value = s.obsPassword || ''
  obsSource.value = s.cfg.obsSource || ''
  selected.value = obsSource.value

  cleanups.push(
    window.ng.onLoginOk(({ platform, name }) => {
      platforms.value[platform].connected = true
      platforms.value[platform].name = name
      if (activeCode.value.platform === platform)
        activeCode.value = { platform: '', userCode: '', verifyUri: '' }
    })
  )
})

onUnmounted(() => {
  cleanups.forEach((fn) => fn && fn())
})

// A prior test result no longer reflects the current fields once they change,
// so editing (or reselecting a source) clears it and re-enables Save.
function invalidateTest() {
  if (testState.value !== 'testing') testState.value = 'idle'
}

function close() {
  router.push('/app')
}

// ---------- General ----------
function saveGeneral() {
  window.ng.saveSettings({
    startGoal: Math.max(1, Number(defStartGoal.value) || 1),
    increment: Math.max(1, Number(defIncrement.value) || 1),
  })
  close()
}
async function resetToDefaults() {
  const cfg = await window.ng.resetDefaults()
  defStartGoal.value = cfg.startGoal
  defIncrement.value = cfg.increment
}
async function deleteData() {
  await window.ng.resetAllData()
  router.push('/onboarding')
}

// ---------- OBS ----------
async function toggleEditSource() {
  if (editingSource.value) { editingSource.value = false; return }
  obsBusy.value = true
  const res = await window.ng.obsConnect({
    host: obsHost.value, port: Number(obsPort.value), password: obsPassword.value,
  })
  obsBusy.value = false
  if (!res.ok) return // error surfaces via toast on save/test; keep the row as-is
  const list = await window.ng.obsListSources()
  sources.value = list.sources || []
  if (!selected.value && sources.value.length) selected.value = sources.value[0]
  editingSource.value = true
}
function pickSource(name) {
  selected.value = name
  editingSource.value = false
  obsSource.value = name
  invalidateTest()
}
async function addCustom() {
  const name = customName.value.trim()
  if (!name) return
  const res = await window.ng.obsCreateSource(name)
  if (res.ok) {
    if (!sources.value.includes(res.name)) sources.value.push(res.name)
    selected.value = res.name
    obsSource.value = res.name
    customName.value = ''
    editingSource.value = false
    invalidateTest()
  }
}

async function testObs() {
  if (testState.value === 'testing') return
  testState.value = 'testing'
  const conn = await window.ng.obsConnect({
    host: obsHost.value, port: Number(obsPort.value), password: obsPassword.value,
  })
  let ok = false
  if (conn.ok) {
    const res = await window.ng.obsTestSource(selected.value || obsSource.value)
    ok = !!(res && res.ok)
  }
  testState.value = ok ? 'success' : 'error'
}

async function saveObs() {
  // Don't persist settings a test just proved don't work.
  if (testState.value === 'error' || testState.value === 'testing') return
  const res = await window.ng.obsConnect({
    host: obsHost.value, port: Number(obsPort.value), password: obsPassword.value,
  })
  if (!res.ok) { testState.value = 'error'; return }
  await window.ng.obsSelectSource(selected.value || obsSource.value)
  close()
}

// ---------- Platforms ----------
async function loginPlatform(id) {
  const res = await window.ng.loginStart(id)
  if (res.error) return
  if (res.browser) return // kick opens the browser itself
  activeCode.value = { platform: id, userCode: res.userCode, verifyUri: res.verificationUri }
  window.ng.openExternal(res.verificationUri)
}
async function logoutPlatform(id) {
  await window.ng.logout(id)
  platforms.value[id].connected = false
  platforms.value[id].name = ''
}
function toggleEnabled(id) {
  const on = !platforms.value[id].enabled
  platforms.value[id].enabled = on
  window.ng.setPlatformEnabled(id, on)
}
</script>

<template>
  <div class="wrap">
    <header class="head">
      <span class="t-title">Settings</span>
      <button class="icon-btn" aria-label="Close settings" @click="close">
        <span class="icon x" :style="{ '--icon': `url(${closeIcon})` }"></span>
      </button>
    </header>

    <nav class="tabs">
      <button class="tab" :class="{ active: tab === 'general' }" @click="tab = 'general'">General</button>
      <button class="tab" :class="{ active: tab === 'obs' }" @click="tab = 'obs'">OBS</button>
      <button v-for="p in PLATFORMS" :key="p.id" class="tab" :class="{ active: tab === p.id }" @click="tab = p.id">
        {{ p.label }}
        <span v-if="platforms[p.id].enabled && !platforms[p.id].connected" class="tab-alert icon"
              :style="{ '--icon': `url(${alertIcon})` }"></span>
      </button>
    </nav>

    <!-- ============ GENERAL ============ -->
    <template v-if="tab === 'general'">
      <div class="body">
        <div class="section">
          <h2 class="t-h">Default Goal Settings</h2>
          <div class="row" style="gap:var(--s-3); align-items:flex-start">
            <label class="col field">
              <span class="t-label">Starting goal</span>
              <input type="number" min="1" v-model="defStartGoal" />
            </label>
            <label class="col field">
              <span class="t-label">Increase by</span>
              <input type="number" min="1" v-model="defIncrement" />
            </label>
          </div>
        </div>

        <div class="section">
          <div class="col" style="gap:var(--s-2)">
            <h2 class="t-h">Danger Zone</h2>
            <p class="t-body sub">Reset restores your default goal settings. Deleting removes all your data
              permanently — this can't be undone.</p>
          </div>
          <div class="row" style="gap:var(--s-3)">
            <button class="btn btn--secondary btn--lg danger-btn" @click="resetToDefaults">Reset To Defaults</button>
            <template v-if="!confirmDelete">
              <button class="btn btn--danger btn--lg danger-btn" @click="confirmDelete = true">Delete all my data</button>
            </template>
            <template v-else>
              <button class="btn btn--secondary btn--lg danger-btn" @click="confirmDelete = false">Cancel</button>
              <button class="btn btn--danger btn--lg danger-btn" @click="deleteData">Confirm delete</button>
            </template>
          </div>
        </div>
      </div>
      <footer class="foot">
        <button class="btn btn--ghost" @click="close">Cancel</button>
        <div class="grow"></div>
        <button class="btn btn--primary btn--lg" @click="saveGeneral">Save</button>
      </footer>
    </template>

    <!-- ============ OBS ============ -->
    <template v-else-if="tab === 'obs'">
      <div class="body">
        <div class="col" style="gap:var(--s-2)">
          <h2 class="t-h">Edit OBS Configuration</h2>
          <p class="t-body sub">Update the WebSocket connection details or change the source being tracked.</p>
        </div>
        <div class="section">
        <div class="row" style="gap:var(--s-3); align-items:flex-start">
          <label class="col field">
            <span class="t-label">Host Address</span>
            <input v-model="obsHost" @input="invalidateTest" />
          </label>
          <label class="col field">
            <span class="t-label">Port</span>
            <input v-model="obsPort" @input="invalidateTest" />
          </label>
        </div>
        <label class="col field">
          <span class="t-label">Password (if you set one)</span>
          <div class="pw-field">
            <input class="pw-input" :type="showPw ? 'text' : 'password'" v-model="obsPassword" @input="invalidateTest" />
            <button type="button" class="pw-toggle" @click="showPw = !showPw"
                    :aria-label="showPw ? 'Hide password' : 'Show password'">
              <svg v-if="showPw" width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2.04 12.32a1 1 0 0 1 0-.64C3.42 7.51 7.36 4.5 12 4.5c4.64 0 8.57 3.01 9.96 7.18a1 1 0 0 1 0 .64C20.58 16.49 16.64 19.5 12 19.5c-4.64 0-8.58-3.01-9.96-7.18Z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3.98 8.22A10.48 10.48 0 0 0 1.93 12c1.29 4.34 5.31 7.5 10.07 7.5.99 0 1.95-.14 2.86-.4M6.23 6.23A10.45 10.45 0 0 1 12 4.5c4.76 0 8.77 3.16 10.07 7.5a10.5 10.5 0 0 1-4.29 5.77"/>
                <path d="m3 3 18 18"/>
                <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24"/>
              </svg>
            </button>
          </div>
        </label>

        <label class="col field">
          <span class="t-label">Source</span>
          <div class="src-box">
            <div class="src-row">
              <span class="src-val"><span class="aa">Aa</span>{{ obsSource || 'No source' }}</span>
              <button type="button" class="linkbtn" :disabled="obsBusy" @click="toggleEditSource">
                {{ editingSource ? 'Close' : 'Edit' }}
              </button>
            </div>
            <div class="src-panel" v-if="editingSource">
              <button type="button" v-for="s in sources" :key="s" class="src-opt" @click="pickSource(s)">
                <span class="aa">Aa</span>{{ s }}
              </button>
              <div class="src-custom">
                <input v-model="customName" placeholder="Custom" @keyup.enter="addCustom" />
                <button type="button" class="src-add" title="Create source" @click="addCustom">+</button>
              </div>
            </div>
          </div>
        </label>
        </div>
      </div>
      <footer class="foot">
        <button class="btn btn--ghost" @click="close">Cancel</button>
        <div class="grow"></div>
        <button type="button" class="test-result" :class="testState"
                :disabled="testState === 'testing'" @click="testObs">
          <!-- The glyph is knocked out of the disc (transparent), so the page shows
               through it — not a solid white mark. -->
          <svg v-if="testState === 'success'" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <mask id="tr-ok">
              <rect width="24" height="24" fill="#000" />
              <circle cx="12" cy="12" r="10" fill="#fff" />
              <path d="m8 12 2.5 2.5L16 9" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </mask>
            <rect width="24" height="24" fill="currentColor" mask="url(#tr-ok)" />
          </svg>
          <svg v-else-if="testState === 'error'" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <mask id="tr-x">
              <rect width="24" height="24" fill="#000" />
              <circle cx="12" cy="12" r="10" fill="#fff" />
              <path d="m9 9 6 6M15 9l-6 6" stroke="#000" stroke-width="2" stroke-linecap="round" />
            </mask>
            <rect width="24" height="24" fill="currentColor" mask="url(#tr-x)" />
          </svg>
          <span>{{ testState === 'success' ? 'Success' : testState === 'error' ? 'Error'
            : testState === 'testing' ? 'Testing…' : 'Test' }}</span>
        </button>
        <button class="btn btn--primary btn--lg" :disabled="testState === 'error' || testState === 'testing'" @click="saveObs">Save</button>
      </footer>
    </template>

    <!-- ============ PLATFORM (Twitch / YouTube / Kick) ============ -->
    <template v-else-if="platforms[tab]">
      <div class="body">
        <template v-if="platforms[tab].connected">
          <div class="col" style="gap:var(--s-2)">
            <h2 class="t-h">Manage your {{ meta(tab).label }} connection</h2>
            <p class="t-body sub">Signed in{{ platforms[tab].name ? ' as ' + platforms[tab].name : '' }}. Sign out to stop counting {{ meta(tab).unit }} from {{ meta(tab).label }}.</p>
          </div>
          <label class="toggle-row">
            <input type="checkbox" :checked="platforms[tab].enabled" @change="toggleEnabled(tab)" />
            <span class="t-label">Include {{ meta(tab).label }} {{ meta(tab).unit }} in the goal</span>
          </label>
          <button class="btn plat-btn" :class="meta(tab).cls" @click="logoutPlatform(tab)">
            <img :src="meta(tab).logo" width="16" height="16" alt="" />
            Logout
          </button>
        </template>
        <template v-else>
          <div class="col" style="gap:var(--s-2)">
            <h2 class="t-h">Connect your {{ meta(tab).label }} account</h2>
            <p class="t-body sub">So NextGoal can count {{ meta(tab).unit }} from {{ meta(tab).label }}. It only reads your {{ meta(tab).unit }} count — nothing else.</p>
          </div>
          <button class="btn plat-btn" :class="meta(tab).cls" @click="loginPlatform(tab)">
            <img :src="meta(tab).logo" width="16" height="16" alt="" />
            {{ activeCode.platform === tab ? 'Reopen activation page' : 'Login with ' + meta(tab).label }}
          </button>
          <div class="card code-card" v-if="activeCode.userCode && activeCode.platform === tab">
            <span class="t-micro">Enter this code</span>
            <span class="code tabular">{{ activeCode.userCode }}</span>
            <span class="t-caption muted">to authorize {{ meta(tab).label }}</span>
          </div>
          <p v-if="activeCode.userCode && activeCode.platform === tab" class="t-caption muted">Waiting for you to authorize…</p>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.wrap { height: 100%; display: flex; flex-direction: column; }
.muted { color: var(--text-muted); }
.sub { color: var(--text-secondary); }
.grow { flex: 1; }

.head { display: flex; align-items: center; justify-content: space-between; padding: 40px 40px 0; }
.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
  border: 0; background: transparent; border-radius: var(--r-md); cursor: pointer; color: var(--text-muted);
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
.icon-btn:hover { background: var(--hover); color: var(--text); }
.x { width: 28px; height: 28px; }

.tabs { display: flex; align-items: center; gap: var(--s-1); padding: var(--s-6) 40px 0; }
.tab { display: inline-flex; align-items: center; gap: var(--s-2); height: var(--ctrl); padding: 0 14px;
  border: 1px solid transparent; border-radius: var(--r-md); background: transparent;
  color: var(--text-secondary); font: 500 13px/1.4 var(--font); cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
.tab:hover { color: var(--text); }
.tab.active { background: var(--surface-raised); border-color: var(--border); color: var(--text); }
.tab-alert { width: 15px; height: 15px; color: var(--status-error); }

.body { flex: 1; display: flex; flex-direction: column; padding: var(--s-6) 40px; gap: var(--s-6); min-height: 0; overflow-y: auto; }
.section { display: flex; flex-direction: column; gap: var(--s-4); width: 100%; }
.t-h { font-size: 20px; line-height: 1.3; font-weight: 500; letter-spacing: -0.2px; color: var(--text); }
.field { gap: 6px; flex: 1; }
.field .t-label { color: var(--text-secondary); }
.danger-btn { flex: 1; }

.foot { display: flex; align-items: center; gap: var(--s-4); padding: var(--s-5) 40px var(--s-8); }

/* password field (mirrors onboarding) */
.pw-field { display: flex; align-items: center; gap: var(--s-2); width: 100%;
  height: var(--ctrl); padding: 0 var(--s-3); background: var(--surface-sunken);
  border: 1px solid var(--border); border-radius: var(--r-md); transition: border-color var(--dur) var(--ease); }
.pw-field:hover { border-color: var(--border-strong); }
.pw-field:focus-within { border-color: var(--primary); box-shadow: var(--focus); }
.pw-field .pw-input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; background: transparent;
  color: var(--text); font: 400 14px/1 var(--font); }
.pw-field .pw-input:hover, .pw-field .pw-input:focus { border: 0; box-shadow: none; outline: none; }
.pw-toggle { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; width: 20px; height: 20px;
  padding: 0; border: 0; background: none; cursor: pointer; color: var(--text-muted); }
.pw-toggle:hover { color: var(--text-secondary); }

/* source box + inline picker */
.aa { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: var(--r-sm);
  background: var(--surface-raised); color: var(--text-muted); font-size: 11px; font-weight: 600; }
.src-box { background: var(--surface-sunken); border: 1px solid var(--border); border-radius: var(--r-md); }
.src-row { display: flex; align-items: center; justify-content: space-between; height: var(--ctrl-lg); padding: 0 var(--s-3); }
.src-val { display: flex; align-items: center; gap: var(--s-2); color: var(--text); }
.linkbtn { background: none; border: 0; color: var(--text-secondary); cursor: pointer; font: 500 13px/1.4 var(--font); padding: var(--s-1) var(--s-2); }
.linkbtn:hover:not(:disabled) { color: var(--text); }
.linkbtn:disabled { opacity: .5; cursor: default; }
.src-panel { border-top: 1px solid var(--border); padding: var(--s-1); display: flex; flex-direction: column; gap: 2px; }
.src-opt { display: flex; align-items: center; gap: var(--s-2); width: 100%; padding: var(--s-2); background: transparent;
  border: 0; color: var(--text); font: 400 14px/1 var(--font); cursor: pointer; border-radius: var(--r-sm); text-align: left; }
.src-opt:hover { background: var(--hover); }
.src-custom { display: flex; align-items: center; gap: var(--s-2); padding: var(--s-1); border-top: 1px solid var(--border); margin-top: 2px; }
.src-custom input { height: var(--ctrl-sm); }
.src-add { flex: 0 0 auto; width: var(--ctrl-sm); height: var(--ctrl-sm); border-radius: var(--r-sm);
  background: var(--primary); color: var(--on-primary); border: 0; cursor: pointer; font-size: 18px; line-height: 1; }
.src-add:hover { background: var(--primary-hover); }

/* test label in footer — icon + label (matches the onboarding test states) */
.test-result { display: inline-flex; align-items: center; gap: var(--s-1);
  border: 0; background: none; cursor: pointer; font: 500 13px/1.4 var(--font);
  color: var(--text-secondary); padding: 0 var(--s-2); }
.test-result svg { flex: 0 0 auto; }
.test-result.success { color: var(--status-ok); }
.test-result.error { color: var(--status-error); }
.test-result:disabled { cursor: default; }

/* platforms */
.plat-btn { align-self: flex-start; }
.btn--twitch { background: var(--primary); color: var(--on-primary); }
.btn--twitch:hover { background: var(--primary-hover); }
.btn--youtube { background: #fff; color: #0b0b0d; }
.btn--youtube:hover { background: #eaeaea; }
.btn--kick { background: #53fc18; color: #0b0b0d; }
.btn--kick:hover { background: #46e310; }
.toggle-row { display: flex; align-items: center; gap: var(--s-2); cursor: pointer; color: var(--text-secondary); }
.toggle-row input { width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer; }
.code-card { padding: var(--s-6); align-items: center; display: flex; flex-direction: column; gap: var(--s-2); width: 100%; }
.code { font-size: 32px; font-weight: 700; letter-spacing: 2px; }
</style>
