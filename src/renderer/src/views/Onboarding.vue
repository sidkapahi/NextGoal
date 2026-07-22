<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import obsSetupImg from '../assets/obs-setup.png'
import obsSourcesImg from '../assets/obs-sources.png'
import twitchLogo from '../assets/twitch.svg'
import twitchWhite from '../assets/twitch-white.svg'
import welcomeLogo from '../assets/welcome-logo.svg'

const route = useRoute()
const router = useRouter()
// Edit mode: reached from the main window's SETUP > Edit. We only re-run the OBS
// + source steps, then return to the app (no Twitch, no completeOnboarding).
const editMode = computed(() => route.query.mode === 'edit')

// step ids drive the flow
const step = ref(editMode.value ? 'websocket' : 'welcome')
const testState = ref('idle') // idle | testing | success | error (transient label)
const testPassed = ref(false) // a valid test has succeeded — gates Connect
const TOTAL = 3

const obsError = ref('')
const obsHost = ref('localhost')
const obsPort = ref(4455)
const obsPassword = ref('')
const showPw = ref(false)

const sources = ref([])
const selected = ref('')
const customName = ref('')
const selectOpen = ref(false)
const sourceTestState = ref('idle') // idle | testing | success | error (transient label)
const sourcePassed = ref(false) // a valid source test has succeeded — gates Connect

const userCode = ref('')
const verifyUri = ref('https://www.twitch.tv/activate')
const loginError = ref('')

const cleanups = []

const headerSteps = { websocket: 1, source: 2, twitch: 3 }
const stepNum = computed(() => headerSteps[step.value] || 0)
const showHeader = computed(() => step.value in headerSteps)

onMounted(async () => {
  if (!window.ng) return
  // Twitch is the last step — once it links, jump straight into the app.
  cleanups.push(window.ng.onTwitchLoginOk(() => window.ng.completeOnboarding()))
  cleanups.push(window.ng.onTwitchLoginFailed((m) => (loginError.value = m)))
  if (editMode.value) {
    const s = await window.ng.getState()
    obsHost.value = s.cfg.obsHost
    obsPort.value = s.cfg.obsPort
    obsPassword.value = s.obsPassword || ''
    selected.value = s.cfg.obsSource || ''
  }
})
onUnmounted(() => { clearResultTimer(); clearSourceTimer(); cleanups.forEach((fn) => fn && fn()) })

// ---- Step 1: test the connection, then continue ----
// Test actually connects to OBS. Connect stays disabled until a test passes,
// and once it does we skip the old detect screen and go straight to the source
// step (sources are already loaded here). The Success/Error label is transient
// (reverts to “Test” after a few seconds); testPassed is what gates Connect.
const RESULT_MS = 5000
let resultTimer = null
function clearResultTimer() {
  if (resultTimer) { clearTimeout(resultTimer); resultTimer = null }
}

async function testConnection() {
  if (testState.value === 'testing') return
  clearResultTimer()
  testPassed.value = false
  testState.value = 'testing'
  obsError.value = ''
  await window.ng.setObsPassword(obsPassword.value)
  const res = await window.ng.obsConnect({
    host: obsHost.value,
    port: Number(obsPort.value),
    password: obsPassword.value,
  })
  if (res.ok) {
    await loadSources()
    testPassed.value = true
    testState.value = 'success'
  } else {
    obsError.value = res.error || 'Could not connect.'
    testState.value = 'error'
  }
  // Fade the result back to “Test” after a moment. A passing test keeps
  // Connect enabled via testPassed even after the label reverts.
  resultTimer = setTimeout(() => {
    if (testState.value === 'success' || testState.value === 'error') {
      testState.value = 'idle'
      obsError.value = ''
    }
    resultTimer = null
  }, RESULT_MS)
}

// Editing a field invalidates a prior test result.
function resetTest() {
  clearResultTimer()
  if (testState.value === 'idle' && !testPassed.value) return
  testState.value = 'idle'
  testPassed.value = false
  obsError.value = ''
}

function connectObs() {
  if (!testPassed.value) return
  if (editMode.value) router.push('/app')
  else step.value = 'source'
}

// ---- Step 2: source ----
// Same shape as the Setup OBS step: Test does the real check (writes sample
// text to the source so it visibly updates in OBS), Connect stays disabled
// until that passes, then commits the selection and moves on. The Success/Error
// label is transient and reverts to “Test”; sourcePassed is what gates Connect.
let sourceTimer = null
function clearSourceTimer() {
  if (sourceTimer) { clearTimeout(sourceTimer); sourceTimer = null }
}

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
  }
}

async function testSource() {
  if (sourceTestState.value === 'testing') return
  clearSourceTimer()
  sourcePassed.value = false
  obsError.value = ''
  if (!selected.value) {
    obsError.value = 'Pick or create a source.'
    sourceTestState.value = 'error'
  } else {
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
  sourceTimer = setTimeout(() => {
    if (sourceTestState.value === 'success' || sourceTestState.value === 'error') {
      sourceTestState.value = 'idle'
      obsError.value = ''
    }
    sourceTimer = null
  }, RESULT_MS)
}

// Changing the selected source invalidates a prior test result.
function resetSourceTest() {
  clearSourceTimer()
  if (sourceTestState.value === 'idle' && !sourcePassed.value) return
  sourceTestState.value = 'idle'
  sourcePassed.value = false
  obsError.value = ''
}

async function connectSource() {
  if (!sourcePassed.value) return
  const res = await window.ng.obsSelectSource(selected.value)
  if (!res.ok) { obsError.value = res.error || 'Could not set the source.'; return }
  if (editMode.value) router.push('/app')
  else step.value = 'twitch'
}

// ---- Step 4: twitch ----
async function loginTwitch() {
  loginError.value = ''
  const res = await window.ng.loginStart()
  if (res.error) { loginError.value = res.error; return }
  userCode.value = res.userCode
  verifyUri.value = res.verificationUri
  window.ng.openExternal(res.verificationUri)
}

function backFromWebsocket() { editMode.value ? router.push('/app') : (step.value = 'welcome') }
</script>

<template>
  <div class="ob" :class="{ 'ob--center': step === 'twitch' }">
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
          <p class="t-body sub">Tools › WebSocket Server Settings › tick Enable.</p>
        </div>
        <img class="obs-shot" :src="obsSetupImg"
             alt="OBS: Tools › WebSocket Server Settings, with “Enable WebSocket server” ticked" />
        <div class="row" style="gap:var(--s-3)">
          <label class="col f"><span class="field-label">Host</span><input v-model="obsHost" @input="resetTest" /></label>
          <label class="col f"><span class="field-label">Port</span><input v-model="obsPort" @input="resetTest" /></label>
        </div>
        <label class="col f">
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
        <p v-if="testState === 'error' && obsError" class="t-caption err">{{ obsError }}</p>
      </div>
      <footer class="ob-foot row">
        <button class="btn btn--secondary" @click="backFromWebsocket">Back</button>
        <div class="grow"></div>
        <!-- Test result: turns into Success/Error once run (see Figma test states).
             Both are clickable to re-test, and revert to “Test” after a few seconds. -->
        <button v-if="testState === 'success'" type="button" class="test-result ok" @click="testConnection"
                title="Test again">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <mask id="tr-ok">
              <rect width="24" height="24" fill="#000" />
              <circle cx="12" cy="12" r="10" fill="#fff" />
              <path d="m8 12 2.5 2.5L16 9" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </mask>
            <rect width="24" height="24" fill="currentColor" mask="url(#tr-ok)" />
          </svg>
          Success
        </button>
        <button v-else-if="testState === 'error'" type="button" class="test-result err" @click="testConnection"
                title="Test again">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <mask id="tr-x">
              <rect width="24" height="24" fill="#000" />
              <circle cx="12" cy="12" r="10" fill="#fff" />
              <path d="m9 9 6 6M15 9l-6 6" stroke="#000" stroke-width="2" stroke-linecap="round" />
            </mask>
            <rect width="24" height="24" fill="currentColor" mask="url(#tr-x)" />
          </svg>
          Error
        </button>
        <button v-else type="button" class="btn btn--ghost" :disabled="testState === 'testing'" @click="testConnection">
          {{ testState === 'testing' ? 'Testing…' : 'Test' }}
        </button>
        <button class="btn btn--primary" :disabled="!testPassed" @click="connectObs">Connect</button>
      </footer>
    </template>

    <!-- ============ STEP 2 — ADD TEXT SOURCE ============ -->
    <template v-else-if="step === 'source'">
      <div class="ob-body col left">
        <div class="col" style="gap:var(--s-1)">
          <h1 class="t-title">Connect your text source</h1>
          <p class="t-body sub">We can create the text source in OBS for you. Or select one you’ve already configured.</p>
        </div>
        <img class="obs-shot" :src="obsSourcesImg"
             alt="OBS Sources panel with the “Sub Goal” text source selected" />
        <label class="col f">
          <span class="t-caption">Source</span>
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
        <p v-if="obsError" class="t-caption err">{{ obsError }}</p>
      </div>
      <footer class="ob-foot row">
        <button class="btn btn--secondary" @click="step = 'websocket'">Back</button>
        <div class="grow"></div>
        <!-- Same Test → Success/Error → Connect flow as the Setup OBS step. -->
        <button v-if="sourceTestState === 'success'" type="button" class="test-result ok" @click="testSource"
                title="Test again">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <mask id="tr-ok">
              <rect width="24" height="24" fill="#000" />
              <circle cx="12" cy="12" r="10" fill="#fff" />
              <path d="m8 12 2.5 2.5L16 9" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </mask>
            <rect width="24" height="24" fill="currentColor" mask="url(#tr-ok)" />
          </svg>
          Success
        </button>
        <button v-else-if="sourceTestState === 'error'" type="button" class="test-result err" @click="testSource"
                title="Test again">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <mask id="tr-x">
              <rect width="24" height="24" fill="#000" />
              <circle cx="12" cy="12" r="10" fill="#fff" />
              <path d="m9 9 6 6M15 9l-6 6" stroke="#000" stroke-width="2" stroke-linecap="round" />
            </mask>
            <rect width="24" height="24" fill="currentColor" mask="url(#tr-x)" />
          </svg>
          Error
        </button>
        <button v-else type="button" class="btn btn--ghost" :disabled="sourceTestState === 'testing'" @click="testSource">
          {{ sourceTestState === 'testing' ? 'Testing…' : 'Test' }}
        </button>
        <button class="btn btn--primary" :disabled="!sourcePassed" @click="connectSource">Connect</button>
      </footer>
    </template>

    <!-- ============ STEP 3 — TWITCH ============ -->
    <template v-else-if="step === 'twitch'">
      <div class="ob-body center grow twitch-step">
        <!-- Top logo: the supplied twitch.svg (two-colour), used as-is. -->
        <img class="tw-logo" :src="twitchLogo" width="44" height="51" alt="Twitch" />
        <div class="twitch-copy">
          <h1 class="t-title">Link your Twitch account</h1>
          <p class="t-body sub">So NextGoal can count subs in real time. It can only read your sub count — nothing else.</p>
        </div>
        <button class="btn btn--primary" @click="loginTwitch">
          <!-- Button icon: separate white mark (twitch-white.svg). -->
          <img :src="twitchWhite" width="14" height="16" alt="" />
          {{ userCode ? 'Reopen twitch.tv/activate' : 'Login with Twitch' }}
        </button>
        <div class="card code-card" v-if="userCode">
          <span class="t-micro">Enter this code</span>
          <span class="code tabular">{{ userCode }}</span>
          <span class="t-caption mute">at twitch.tv/activate</span>
        </div>
        <p v-if="userCode" class="t-caption mute">Waiting for you to authorize…</p>
        <p v-if="loginError" class="t-caption err">{{ loginError }}</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ob { height: 100%; display: flex; flex-direction: column; }
/* Steps with no footer (e.g. Twitch) float the step header so the body centers
   in the whole window instead of only the space below the header. */
.ob--center { position: relative; }
.ob--center .ob-head { position: absolute; top: 0; left: 0; right: 0; }
.ob-head { display: flex; flex-direction: column; align-items: center; gap: var(--s-2); padding: 40px 40px 0; }
.ob-body { flex: 1; display: flex; flex-direction: column; padding: var(--s-6) 40px; gap: var(--s-4); min-height: 0; }
.ob-foot { padding: var(--s-5) 40px var(--s-8); gap: var(--s-3); }
.ob-foot.col { align-items: stretch; }

.dots { display: flex; gap: 6px; }
.dots .dot { width: 6px; height: 6px; }

.center { align-items: center; text-align: center; justify-content: center; gap: var(--s-4); }
.left { gap: var(--s-4); }
.grow { flex: 1; }
.sub { color: var(--text-secondary); }
.mute { color: var(--text-muted); text-align: center; }
.err { color: var(--status-error); }
.f { gap: var(--s-2); flex: 1; }
.welcome { align-items: center; gap: var(--s-6); }
.welcome-copy { display: flex; flex-direction: column; align-items: center; gap: var(--s-2); text-align: center; }
.welcome-logo { flex: 1; width: 100%; min-height: 0; display: flex; align-items: center; justify-content: center; }
.welcome-logo img { width: 100%; max-width: 256px; height: auto; }

.twitch-step { gap: var(--s-6); }
.tw-logo { display: block; }
.twitch-copy { display: flex; flex-direction: column; align-items: center; gap: var(--s-2); }

/* test result label (Setup OBS footer) — Test → Success/Error */
.test-result { display: inline-flex; align-items: center; gap: var(--s-1);
  padding: 0; border: none; background: none; font: 500 13px/1.4 var(--font); }
.test-result svg { flex: 0 0 auto; }
.test-result.ok { color: var(--status-ok); cursor: pointer; }
.test-result.err { color: var(--status-error); cursor: pointer; }

/* field labels — match the Inputs spec (13/medium/secondary) */
.field-label { font-size: 13px; line-height: 1.4; font-weight: 500; color: var(--text-secondary); }

/* password field with a show/hide (eye) toggle */
.pw-field { display: flex; align-items: center; gap: var(--s-2); width: 100%;
  height: var(--ctrl); padding: 0 var(--s-3); background: var(--surface-sunken);
  border: 1px solid var(--border); border-radius: var(--r-md);
  transition: border-color var(--dur) var(--ease); }
.pw-field:hover { border-color: var(--border-strong); }
.pw-field:focus-within { border-color: var(--primary); box-shadow: var(--focus); }
/* the inner input is bare — the wrapper carries the box styling */
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

.linkbtn { background: none; border: none; color: var(--text-secondary); cursor: pointer;
           font: 500 13px/1.4 var(--font); padding: var(--s-2); }
.linkbtn:hover { color: var(--text); }

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
.select-panel { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20;
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
</style>
