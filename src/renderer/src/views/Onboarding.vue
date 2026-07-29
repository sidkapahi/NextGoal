<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import obsSetupImg from '../assets/obs-setup.png'
import obsSourcesImg from '../assets/obs-sources.png'
import brandTwitch from '../assets/brand-twitch.svg'
import brandKick from '../assets/brand-kick.svg'
import brandYoutube from '../assets/brand-youtube.svg'
import alertIcon from '../assets/icon-alert.svg'
import closeIcon from '../assets/icon-close.svg'
import welcomeLogo from '../assets/welcome-logo.svg'

const route = useRoute()
const router = useRouter()
// Edit mode: reached from the main window's SETUP > Edit. We only re-run the OBS
// + source steps, then return to the app (no platforms, no completeOnboarding).
const editMode = computed(() => route.query.mode === 'edit')

// step ids drive the flow
const step = ref(editMode.value ? 'websocket' : 'welcome')
const testState = ref('idle') // idle | testing | success | error
const testPassed = ref(false) // a valid connection test has succeeded
const TOTAL = 3

const obsError = ref('')
// Which OBS field group a failed connection blamed, so it can highlight red:
// null | 'connection' (host+port) | 'password'.
const wsField = ref(null)
const obsHost = ref('localhost')
const obsPort = ref(4455)
const obsPassword = ref('')
const showPw = ref(false)

const sources = ref([])
const selected = ref('')
const customName = ref('')
const selectOpen = ref(false)
const sourceTestState = ref('idle') // idle | testing | success | error
const sourcePassed = ref(false) // a valid source test has succeeded

// Connect-platforms step (final step). Each platform can be linked; onboarding
// completes once at least one is connected. Rows mirror the Settings Channels
// tab: brand badge + name + "Add in total" + Login/Logout.
const PLATFORMS = [
  { id: 'twitch', label: 'Twitch', badge: brandTwitch },
  { id: 'kick', label: 'Kick', badge: brandKick },
  { id: 'youtube', label: 'YouTube', badge: brandYoutube },
]
const connected = ref({ twitch: false, youtube: false, kick: false })
const enabled = ref({ twitch: true, youtube: true, kick: true })
// The device-code prompt currently showing (twitch/youtube). Kick uses the
// browser, so it never populates this.
const activeCode = ref({ platform: '', userCode: '', verifyUri: '' })
const loginError = ref('')
const dismissNoChannels = ref(false)
const meta = (id) => PLATFORMS.find((p) => p.id === id)

const anyConnected = computed(() => Object.values(connected.value).some(Boolean))

const cleanups = []

const headerSteps = { websocket: 1, source: 2, platforms: 3 }
const stepNum = computed(() => headerSteps[step.value] || 0)
const showHeader = computed(() => step.value in headerSteps)

onMounted(async () => {
  if (!window.ng) return
  cleanups.push(
    window.ng.onLoginOk(({ platform }) => {
      connected.value[platform] = true
      dismissNoChannels.value = false
      if (activeCode.value.platform === platform)
        activeCode.value = { platform: '', userCode: '', verifyUri: '' }
      loginError.value = ''
    })
  )
  cleanups.push(window.ng.onLoginFailed(({ message }) => (loginError.value = message)))
  const s = await window.ng.getState()
  for (const p of s.platforms || []) {
    connected.value[p.id] = p.connected
    if (typeof p.enabled === 'boolean') enabled.value[p.id] = p.enabled
  }
  if (editMode.value) {
    obsHost.value = s.cfg.obsHost
    obsPort.value = s.cfg.obsPort
    obsPassword.value = s.obsPassword || ''
    selected.value = s.cfg.obsSource || ''
  }
})
onUnmounted(() => { cleanups.forEach((fn) => fn && fn()) })

// ---- Step 1: OBS websocket connection ----
// A wrong password fails auth; a bad host/port fails to connect at all.
function classifyConnectError(msg) {
  return /auth|password|credential|4009/i.test(msg || '') ? 'password' : 'connection'
}

async function testConnection() {
  if (testState.value === 'testing') return
  testPassed.value = false
  testState.value = 'testing'
  obsError.value = ''
  wsField.value = null
  await window.ng.setObsPassword(obsPassword.value)
  const res = await window.ng.obsConnect({
    host: obsHost.value, port: Number(obsPort.value), password: obsPassword.value,
  })
  if (res.ok) {
    await loadSources()
    testPassed.value = true
    testState.value = 'success'
  } else {
    obsError.value = res.error || 'Could not connect.'
    wsField.value = classifyConnectError(res.error)
    testState.value = 'error'
  }
}

// Editing a field invalidates a prior test result.
function resetTest() {
  testState.value = 'idle'
  testPassed.value = false
  obsError.value = ''
  wsField.value = null
}

// Next: ensure the connection works (test if not yet), then advance.
async function nextFromWebsocket() {
  if (!testPassed.value) { await testConnection(); if (!testPassed.value) return }
  if (editMode.value) router.push('/app')
  else step.value = 'source'
}

// ---- Step 2: source ----
async function loadSources() {
  const res = await window.ng.obsListSources()
  sources.value = res.sources || []
  if (!selected.value && sources.value.length) selected.value = sources.value[0]
}
function pickSource(name) {
  selected.value = name
  selectOpen.value = false
  resetSourceTest()
}
async function addCustom() {
  const name = customName.value.trim()
  if (!name) return
  const res = await window.ng.obsCreateSource(name)
  if (res.ok) {
    if (!sources.value.includes(res.name)) sources.value.push(res.name)
    selected.value = res.name
    customName.value = ''
    selectOpen.value = false
    resetSourceTest()
  } else {
    obsError.value = res.error || 'Could not create the source.'
    sourceTestState.value = 'error'
  }
}

async function testSource() {
  if (sourceTestState.value === 'testing') return
  sourcePassed.value = false
  obsError.value = ''
  if (!selected.value) {
    obsError.value = 'Pick or create a source.'
    sourceTestState.value = 'error'
    return
  }
  sourceTestState.value = 'testing'
  const res = await window.ng.obsTestSource(selected.value)
  if (res && res.ok) {
    sourcePassed.value = true
    sourceTestState.value = 'success'
  } else {
    obsError.value = (res && res.error) || 'Could not update the source.'
    sourceTestState.value = 'error'
  }
}

// Changing the selected source invalidates a prior test result.
function resetSourceTest() {
  sourceTestState.value = 'idle'
  sourcePassed.value = false
  obsError.value = ''
}

async function nextFromSource() {
  if (!sourcePassed.value) { await testSource(); if (!sourcePassed.value) return }
  const res = await window.ng.obsSelectSource(selected.value)
  if (!res.ok) { obsError.value = res.error || 'Could not set the source.'; sourceTestState.value = 'error'; return }
  if (editMode.value) router.push('/app')
  else step.value = 'platforms'
}

// ---- Step 3: connect platforms ----
async function loginPlatform(p) {
  loginError.value = ''
  const res = await window.ng.loginStart(p)
  if (res.error) { loginError.value = res.error; return }
  // Kick opens the system browser itself — nothing to show in-app.
  if (res.browser) return
  // Twitch / YouTube: show the device code and open the activation page.
  activeCode.value = { platform: p, userCode: res.userCode, verifyUri: res.verificationUri }
  window.ng.openExternal(res.verificationUri)
}
async function logoutPlatform(id) {
  await window.ng.logout(id)
  connected.value[id] = false
}
function toggleEnabled(id) {
  const on = !enabled.value[id]
  enabled.value[id] = on
  window.ng.setPlatformEnabled(id, on)
}
function finishOnboarding() {
  // Channels are optional — you can finish and run a manual session, or connect
  // one later in Settings. The warning banner still nudges, it just doesn't block.
  window.ng.completeOnboarding()
}

function backFromWebsocket() { editMode.value ? router.push('/app') : (step.value = 'welcome') }
</script>

<template>
  <div class="ob">
    <!-- HEADER: dots + step label -->
    <header class="ob-head" v-if="showHeader">
      <div class="dots">
        <span v-for="i in TOTAL" :key="i" class="dot"
              :style="{ background: (i === stepNum) ? 'var(--primary)' : 'var(--border-strong)' }"></span>
      </div>
      <span class="t-micro">Step {{ stepNum }} of {{ TOTAL }}</span>
    </header>

    <!-- ============ WELCOME ============ -->
    <template v-if="step === 'welcome'">
      <div class="ob-body welcome">
        <div class="welcome-copy">
          <h1 class="t-title">Welcome to NextGoal</h1>
          <p class="t-body sub">A sub goal that raises itself. Every time you hit the target, the next one appears automatically.</p>
        </div>
        <div class="welcome-logo">
          <img :src="welcomeLogo" width="256" height="256" alt="" />
        </div>
      </div>
      <footer class="ob-foot col">
        <p class="t-caption mute">Takes about a minute to set up.</p>
        <button class="btn btn--primary btn--full btn--lg" @click="step = 'websocket'">Next</button>
      </footer>
    </template>

    <!-- ============ STEP 1 — ENABLE WEBSOCKET ============ -->
    <template v-else-if="step === 'websocket'">
      <div class="ob-body col left">
        <div class="col" style="gap:var(--s-1)">
          <h1 class="t-title">Setup OBS</h1>
          <p class="t-body sub">Tools &gt; WebSocket Server Settings &gt; tick <strong>Enable</strong>.</p>
        </div>
        <img class="obs-shot" :src="obsSetupImg"
             alt="OBS: Tools › WebSocket Server Settings, with “Enable WebSocket server” ticked" />
        <div class="row" style="gap:var(--s-3)">
          <label class="col f" :class="{ 'f--error': wsField === 'connection' }">
            <span class="field-label">Host Address</span><input v-model="obsHost" @input="resetTest" />
          </label>
          <label class="col f" :class="{ 'f--error': wsField === 'connection' }">
            <span class="field-label">Port</span><input v-model="obsPort" @input="resetTest" />
          </label>
        </div>
        <label class="col f" :class="{ 'f--error': wsField === 'password' }">
          <span class="field-label">Password (if you set one)</span>
          <div class="pw-field">
            <input class="pw-input" :type="showPw ? 'text' : 'password'" v-model="obsPassword" @input="resetTest"
                   placeholder="Press “Show Connect Info” in OBS" />
            <button type="button" class="pw-toggle" @click="showPw = !showPw"
                    :aria-label="showPw ? 'Hide password' : 'Show password'"
                    :title="showPw ? 'Hide password' : 'Show password'">
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
      </div>
      <footer class="ob-foot row">
        <button class="btn btn--secondary" @click="backFromWebsocket">Back</button>
        <div class="grow"></div>
        <button type="button" class="test-result" :class="testState"
                :disabled="testState === 'testing'" @click="testConnection">
          <svg v-if="testState === 'success'" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <mask id="ob-ok1">
              <rect width="24" height="24" fill="#000" />
              <circle cx="12" cy="12" r="10" fill="#fff" />
              <path d="m8 12 2.5 2.5L16 9" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </mask>
            <rect width="24" height="24" fill="currentColor" mask="url(#ob-ok1)" />
          </svg>
          <svg v-else-if="testState === 'error'" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <mask id="ob-x1">
              <rect width="24" height="24" fill="#000" />
              <circle cx="12" cy="12" r="10" fill="#fff" />
              <path d="m9 9 6 6M15 9l-6 6" stroke="#000" stroke-width="2" stroke-linecap="round" />
            </mask>
            <rect width="24" height="24" fill="currentColor" mask="url(#ob-x1)" />
          </svg>
          <span>{{ testState === 'success' ? 'Success' : testState === 'error' ? 'Error'
            : testState === 'testing' ? 'Testing…' : 'Test' }}</span>
        </button>
        <button class="btn btn--primary" @click="nextFromWebsocket">Next</button>
      </footer>
    </template>

    <!-- ============ STEP 2 — ADD TEXT SOURCE ============ -->
    <template v-else-if="step === 'source'">
      <div class="ob-body col left">
        <div class="col" style="gap:var(--s-1)">
          <h1 class="t-title">Connect your text source</h1>
          <p class="t-body sub">Text (GDI+) — customize the design to fit your overlay</p>
        </div>
        <img class="obs-shot" :src="obsSourcesImg"
             alt="OBS Sources panel with the “Sub Goal” text source selected" />
        <label class="col f" :class="{ 'f--error': sourceTestState === 'error' }">
          <span class="field-label">Source</span>
          <div class="select" :class="{ open: selectOpen }">
            <button type="button" class="select-trigger" @click="selectOpen = !selectOpen">
              <span class="select-val"><span class="aa">Aa</span>{{ selected || 'Select a source' }}</span>
              <svg class="caret" width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div class="select-panel" v-if="selectOpen">
              <button type="button" v-for="s in sources" :key="s" class="select-opt" @click="pickSource(s)">
                <span class="aa">Aa</span>{{ s }}
              </button>
              <div class="select-custom">
                <input v-model="customName" placeholder="Custom" @keyup.enter="addCustom" />
                <button type="button" class="select-add" title="Create source" @click="addCustom">+</button>
              </div>
            </div>
          </div>
        </label>
      </div>
      <footer class="ob-foot row">
        <button class="btn btn--secondary" @click="step = 'websocket'">Back</button>
        <div class="grow"></div>
        <button type="button" class="test-result" :class="sourceTestState"
                :disabled="sourceTestState === 'testing'" @click="testSource">
          <svg v-if="sourceTestState === 'success'" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <mask id="ob-ok2">
              <rect width="24" height="24" fill="#000" />
              <circle cx="12" cy="12" r="10" fill="#fff" />
              <path d="m8 12 2.5 2.5L16 9" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </mask>
            <rect width="24" height="24" fill="currentColor" mask="url(#ob-ok2)" />
          </svg>
          <svg v-else-if="sourceTestState === 'error'" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <mask id="ob-x2">
              <rect width="24" height="24" fill="#000" />
              <circle cx="12" cy="12" r="10" fill="#fff" />
              <path d="m9 9 6 6M15 9l-6 6" stroke="#000" stroke-width="2" stroke-linecap="round" />
            </mask>
            <rect width="24" height="24" fill="currentColor" mask="url(#ob-x2)" />
          </svg>
          <span>{{ sourceTestState === 'success' ? 'Success' : sourceTestState === 'error' ? 'Error'
            : sourceTestState === 'testing' ? 'Testing…' : 'Test' }}</span>
        </button>
        <button class="btn btn--primary" @click="nextFromSource">Next</button>
      </footer>
    </template>

    <!-- ============ STEP 3 — CONNECT PLATFORMS ============ -->
    <template v-else-if="step === 'platforms'">
      <div class="ob-body col left">
        <div class="col" style="gap:var(--s-2)">
          <h1 class="t-title">Plug-in all your channels</h1>
          <p class="t-body sub">So NextGoal can count subs in real time. It can only read your sub count and account information.</p>
        </div>

        <div class="chan-list">
          <div v-for="p in PLATFORMS" :key="p.id" class="chan-row">
            <img class="chan-badge" :src="p.badge" width="32" height="32" alt="" />
            <span class="chan-name">{{ p.label }}</span>
            <div class="grow"></div>
            <template v-if="connected[p.id]">
              <label class="add-total">
                <input type="checkbox" :checked="enabled[p.id]" @change="toggleEnabled(p.id)" />
                <span class="t-label">Add in total</span>
              </label>
              <button class="btn btn--danger-outline" @click="logoutPlatform(p.id)">Logout</button>
            </template>
            <template v-else>
              <button class="btn btn--secondary" @click="loginPlatform(p.id)">
                {{ activeCode.platform === p.id ? 'Reopen' : 'Login' }}
              </button>
            </template>
          </div>
        </div>

        <div class="card code-card" v-if="activeCode.userCode">
          <span class="t-micro">Enter this code to authorize {{ meta(activeCode.platform).label }}</span>
          <span class="code tabular">{{ activeCode.userCode }}</span>
          <span class="t-caption mute">Waiting for you to authorize…</span>
        </div>
        <p v-if="loginError" class="t-caption err">{{ loginError }}</p>

        <div class="grow"></div>

        <div v-if="!anyConnected && !dismissNoChannels" class="banner">
          <span class="banner-ico icon" :style="{ '--icon': `url(${alertIcon})` }"></span>
          <span class="t-caption banner-text">You must have at least one channel connected to start a live session.</span>
          <button class="banner-x" aria-label="Dismiss" @click="dismissNoChannels = true">
            <span class="icon x-sm" :style="{ '--icon': `url(${closeIcon})` }"></span>
          </button>
        </div>
      </div>
      <footer class="ob-foot row">
        <button class="btn btn--secondary" @click="step = 'source'">Back</button>
        <div class="grow"></div>
        <button class="btn btn--primary btn--lg" @click="finishOnboarding">Finish</button>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.ob { height: 100%; display: flex; flex-direction: column; }
.ob-head { display: flex; flex-direction: column; align-items: center; gap: var(--s-2); padding: 40px 40px 0; }
.ob-body { flex: 1; display: flex; flex-direction: column; padding: var(--s-6) 40px; gap: var(--s-4); min-height: 0; }
.ob-foot { padding: var(--s-5) 40px var(--s-8); gap: var(--s-3); }
.ob-foot.col { align-items: stretch; }
.ob-foot.row { display: flex; align-items: center; }

.dots { display: flex; gap: 6px; }
.dots .dot { width: 6px; height: 6px; border-radius: var(--r-full); }

.left { gap: var(--s-4); }
.grow { flex: 1; }
.sub { color: var(--text-secondary); }
.mute { color: var(--text-muted); text-align: center; }
.err { color: var(--status-error); }
.f { gap: var(--s-2); flex: 1; }
/* Field-level validation: red label + red control border. */
.f--error .field-label { color: var(--status-error); }
.f--error input,
.f--error .pw-field,
.f--error .select-trigger { border-color: var(--status-error); }

.welcome { align-items: center; gap: var(--s-6); }
.welcome-copy { display: flex; flex-direction: column; align-items: center; gap: var(--s-2); text-align: center; }
.welcome-logo { flex: 1; width: 100%; min-height: 0; display: flex; align-items: center; justify-content: center; }
.welcome-logo img { width: 100%; max-width: 256px; height: auto; }

/* test result label (footer) — Test → Success/Error */
.test-result { display: inline-flex; align-items: center; gap: var(--s-1);
  padding: 0 var(--s-2); border: none; background: none; cursor: pointer;
  font: 500 13px/1.4 var(--font); color: var(--text-secondary); }
.test-result svg { flex: 0 0 auto; }
.test-result.success { color: var(--status-ok); }
.test-result.error { color: var(--status-error); }
.test-result:disabled { cursor: default; }

/* field labels — match the Inputs spec (13/medium/secondary) */
.field-label { font-size: 13px; line-height: 1.4; font-weight: 500; color: var(--text-secondary); }

/* password field with a show/hide (eye) toggle */
.pw-field { display: flex; align-items: center; gap: var(--s-2); width: 100%;
  height: var(--ctrl); padding: 0 var(--s-3); background: var(--surface-sunken);
  border: 1px solid var(--border); border-radius: var(--r-md);
  transition: border-color var(--dur) var(--ease); }
.pw-field:hover { border-color: var(--border-strong); }
.pw-field:focus-within { border-color: var(--primary); box-shadow: var(--focus); }
.pw-field .pw-input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0;
  background: transparent; color: var(--text); font: 400 14px/1 var(--font); }
.pw-field .pw-input:hover, .pw-field .pw-input:focus { border: 0; box-shadow: none; outline: none; }
.pw-toggle { flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; padding: 0; border: 0; background: none; cursor: pointer;
  color: var(--text-muted); transition: color var(--dur) var(--ease); }
.pw-toggle:hover { color: var(--text-secondary); }
.pw-toggle:focus-visible { outline: none; color: var(--text); }

/* OBS setup screenshot */
.obs-shot { display: block; width: 100%; max-width: 348px; height: auto; margin: 0 auto; }

.code-card { padding: var(--s-6); align-items: center; display: flex; flex-direction: column; gap: var(--s-2); width: 100%; }
.code { font-size: 32px; font-weight: 700; letter-spacing: 2px; }

/* custom source dropdown */
.select { position: relative; width: 100%; }
.select-trigger { width: 100%; height: var(--ctrl-lg); display: flex; align-items: center; justify-content: space-between;
  padding: 0 var(--s-3); background: var(--surface-sunken); border: 1px solid var(--border); border-radius: var(--r-md);
  color: var(--text); font: 400 14px/1 var(--font); cursor: pointer; }
.select.open .select-trigger { border-color: var(--primary); box-shadow: var(--focus); }
.select-val { display: flex; align-items: center; gap: var(--s-2); }
.select .caret { display: block; color: var(--text-muted); transition: transform var(--dur) var(--ease); }
.select.open .caret { transform: rotate(180deg); }
.aa { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: var(--r-sm);
  background: var(--surface-raised); color: var(--text-muted); font-size: 11px; font-weight: 600; }
.select-panel { position: absolute; bottom: calc(100% + 4px); left: 0; right: 0; z-index: 20;
  background: var(--surface-raised); border: 1px solid var(--border); border-radius: var(--r-md);
  padding: var(--s-1); display: flex; flex-direction: column; gap: 2px; box-shadow: 0 8px 24px rgba(0,0,0,.4); }
.select-opt { display: flex; align-items: center; gap: var(--s-2); width: 100%; padding: var(--s-2) var(--s-2);
  background: transparent; border: none; color: var(--text); font: 400 14px/1 var(--font); cursor: pointer;
  border-radius: var(--r-sm); text-align: left; }
.select-opt:hover { background: var(--hover); }
.select-custom { display: flex; align-items: center; gap: var(--s-2); padding: var(--s-1); border-top: 1px solid var(--border); margin-top: 2px; }
.select-custom input { height: var(--ctrl-sm); }
.select-add { flex: 0 0 auto; width: var(--ctrl-sm); height: var(--ctrl-sm); border-radius: var(--r-sm);
  background: var(--primary); color: var(--on-primary); border: none; cursor: pointer; font-size: 18px; line-height: 1; }
.select-add:hover { background: var(--primary-hover); }

/* connect-platforms rows (shared shape with Settings › Channels) */
.chan-list { display: flex; flex-direction: column; gap: var(--s-5); width: 100%; }
.chan-row { display: flex; align-items: center; gap: var(--s-3); width: 100%; }
.chan-badge { flex: 0 0 auto; width: 32px; height: 32px; border-radius: var(--r-full); }
.chan-name { color: var(--text); font: 400 14px/1.4 var(--font); }
.add-total { display: inline-flex; align-items: center; gap: var(--s-2); cursor: pointer; color: var(--text-secondary); }
.add-total input { width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer; }
.add-total .t-label { color: var(--text-secondary); }

/* amber warning banner (none-connected), dismissible */
.banner { display: flex; align-items: center; gap: var(--s-2); width: 100%;
  padding: var(--s-3) var(--s-4); border: 1px solid var(--warn-500, var(--status-warn));
  border-radius: var(--r-md); background: color-mix(in srgb, var(--warn-500, var(--status-warn)) 12%, transparent); }
.banner-ico { flex: 0 0 auto; width: 18px; height: 18px; color: var(--warn-500, var(--status-warn)); }
.banner-text { color: var(--warn-500, var(--status-warn)); flex: 1; }
.banner-x { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px;
  padding: 0; border: 0; background: transparent; cursor: pointer; color: var(--warn-500, var(--status-warn)); }
.banner-x:hover { opacity: .8; }
.x-sm { width: 14px; height: 14px; }
</style>
