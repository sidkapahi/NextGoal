<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

// step ids drive the flow; auto-detect decides whether 'websocket' is shown
const step = ref('welcome')
const TOTAL = 4

const obsConnected = ref(false)
const obsError = ref('')
const obsHost = ref('localhost')
const obsPort = ref(4455)
const obsPassword = ref('')
const sourceName = ref('Sub Goal')
const sourceCreated = ref(false)

const userCode = ref('')
const verifyUri = ref('https://www.twitch.tv/activate')
const loginError = ref('')
const loggedIn = ref(false)
const loginName = ref('')

const testCount = ref(0)
const cleanups = []

const stepIndex = computed(() => {
  return { welcome: 0, detect: 1, websocket: 1, source: 2, twitch: 3, done: 3 }[step.value] ?? 0
})

onMounted(() => {
  if (!window.ng) return
  cleanups.push(window.ng.onTwitchLoginOk(({ name }) => {
    loggedIn.value = true
    loginName.value = name
    step.value = 'done'
  }))
  cleanups.push(window.ng.onTwitchLoginFailed((m) => (loginError.value = m)))
  cleanups.push(window.ng.onCountChanged(({ count }) => (testCount.value = count)))
})
onUnmounted(() => cleanups.forEach((fn) => fn && fn()))

async function startDetect() {
  step.value = 'detect'
  obsError.value = ''
  const ok = await window.ng.obsAutoDetect()
  if (ok) {
    obsConnected.value = true
    step.value = 'source'
  } else {
    step.value = 'websocket'
  }
}

async function connectManual() {
  obsError.value = ''
  await window.ng.setObsPassword(obsPassword.value)
  const res = await window.ng.obsConnect({
    host: obsHost.value,
    port: Number(obsPort.value),
    password: obsPassword.value,
  })
  if (res.ok) {
    obsConnected.value = true
    step.value = 'source'
  } else {
    obsError.value = res.error || 'Could not connect.'
  }
}

async function addSource() {
  const res = await window.ng.obsCreateSource(sourceName.value)
  if (res.ok) {
    sourceCreated.value = true
    step.value = 'twitch'
  } else {
    obsError.value = res.error || 'Could not create the source.'
  }
}
function skipSource() {
  step.value = 'twitch'
}

async function loginTwitch() {
  loginError.value = ''
  const res = await window.ng.loginStart()
  if (res.error) { loginError.value = res.error; return }
  userCode.value = res.userCode
  verifyUri.value = res.verificationUri
  window.ng.openExternal(res.verificationUri)
}

function skip(next) { step.value = next }
function fireTest() { window.ng.fireTestSub() }
function finish() { window.ng.completeOnboarding() }
</script>

<template>
  <div class="ob">
    <div class="dots" v-if="step !== 'welcome'">
      <span v-for="i in TOTAL" :key="i" class="dot"
            :style="{ background: (i - 1) === stepIndex ? 'var(--primary)' : 'var(--border-strong)' }"></span>
    </div>

    <!-- WELCOME -->
    <template v-if="step === 'welcome'">
      <div class="center grow">
        <div class="mark">▶▶</div>
        <h1 class="t-title">Welcome to NextGoal</h1>
        <p class="t-body sub">A sub goal that raises itself. Every time you hit the target, the next one appears automatically.</p>
      </div>
      <p class="t-caption mute">Takes about a minute to set up.</p>
      <button class="btn btn--primary btn--full btn--lg" @click="startDetect">Get started</button>
    </template>

    <!-- DETECTING -->
    <template v-else-if="step === 'detect'">
      <div class="center grow">
        <div class="spinner"></div>
        <h1 class="t-title">Looking for OBS…</h1>
        <p class="t-body sub">Make sure OBS is open. We check the default connection automatically.</p>
      </div>
      <p class="t-caption mute">This only takes a moment.</p>
    </template>

    <!-- WEBSOCKET FALLBACK -->
    <template v-else-if="step === 'websocket'">
      <div class="grow col left">
        <h1 class="t-title">Turn on the OBS WebSocket</h1>
        <p class="t-body sub">In OBS: Tools › WebSocket Server Settings › tick Enable.</p>
        <div class="shot">Screenshot: Tools ›  WebSocket Server Settings</div>
        <div class="row">
          <label class="col f"><span class="t-caption">Host</span><input v-model="obsHost" /></label>
          <label class="col f" style="max-width:90px"><span class="t-caption">Port</span><input v-model="obsPort" /></label>
        </div>
        <label class="col f"><span class="t-caption">Password (if you set one)</span><input type="password" v-model="obsPassword" placeholder="Show Connect Info in OBS" /></label>
        <p v-if="obsError" class="t-caption err">{{ obsError }}</p>
      </div>
      <div class="row">
        <button class="btn btn--secondary" @click="startDetect">Retry auto-detect</button>
        <div class="grow"></div>
        <button class="btn btn--primary" @click="connectManual">Connect</button>
      </div>
    </template>

    <!-- ADD SOURCE -->
    <template v-else-if="step === 'source'">
      <div class="grow col left">
        <span class="pill"><span class="dot" style="background:var(--status-ok)"></span><span class="t-caption">OBS connected</span></span>
        <h1 class="t-title">Add the goal to your scene</h1>
        <p class="t-body sub">We can create the text source in OBS for you. It lands on your current scene, ready to position.</p>
        <div class="shot">Screenshot: the text source on your OBS canvas</div>
        <label class="col f"><span class="t-caption">Source name</span><input v-model="sourceName" /></label>
        <p v-if="obsError" class="t-caption err">{{ obsError }}</p>
      </div>
      <div class="row">
        <button class="btn btn--ghost" @click="skipSource">I’ll do it myself</button>
        <div class="grow"></div>
        <button class="btn btn--primary" @click="addSource">Add it to my scene</button>
      </div>
    </template>

    <!-- TWITCH -->
    <template v-else-if="step === 'twitch'">
      <div class="center grow">
        <h1 class="t-title">Connect your Twitch account</h1>
        <p class="t-body sub">So NextGoal can count subs in real time. It can only read your sub count — nothing else.</p>
        <div class="card code-card" v-if="userCode">
          <span class="t-micro">Enter this code</span>
          <span class="code tabular">{{ userCode }}</span>
          <span class="t-caption mute">at twitch.tv/activate</span>
        </div>
        <p v-if="userCode" class="t-caption mute">Waiting for you to authorize…</p>
        <p v-if="loginError" class="t-caption err">{{ loginError }}</p>
      </div>
      <button class="btn btn--primary btn--full btn--lg" @click="loginTwitch">
        {{ userCode ? 'Reopen twitch.tv/activate' : 'Login with Twitch' }}
      </button>
      <button class="btn btn--ghost btn--full" @click="skip('done')">Skip for now</button>
    </template>

    <!-- DONE -->
    <template v-else-if="step === 'done'">
      <div class="center grow">
        <div class="check">✓</div>
        <h1 class="t-title">You’re all set</h1>
        <p class="t-body sub">Fire a test sub to watch it move on your OBS canvas before you go live.</p>
        <div class="preview"><span class="t-title">{{ testCount }}</span><span class="t-title sep">/</span><span class="t-title live">5</span></div>
      </div>
      <button class="btn btn--primary btn--full btn--lg" @click="fireTest">Fire a test sub</button>
      <button class="btn btn--ghost btn--full" @click="finish">Go to app</button>
    </template>
  </div>
</template>

<style scoped>
.ob { height: 100%; display: flex; flex-direction: column; align-items: stretch;
      padding: 40px; gap: var(--s-5); }
.dots { display: flex; gap: 6px; justify-content: center; }
.dots .dot { width: 6px; height: 6px; }
.center { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--s-4); justify-content: center; }
.left { gap: var(--s-3); }
.grow { flex: 1; }
.sub { color: var(--text-secondary); }
.mute { color: var(--text-muted); text-align: center; }
.err { color: var(--status-error); }
.f { gap: var(--s-2); flex: 1; }
.mark { width: 64px; height: 64px; border-radius: 16px; background: var(--primary);
        display: flex; align-items: center; justify-content: center; color: #fff; font-size: 22px; }
.check { width: 56px; height: 56px; border-radius: var(--r-full); background: var(--status-ok);
         display: flex; align-items: center; justify-content: center; color: #fff; font-size: 26px; }
.spinner { width: 40px; height: 40px; border-radius: var(--r-full);
           border: 3px solid var(--surface-raised); border-top-color: var(--primary);
           animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.shot { border: 1px dashed var(--border-strong); border-radius: var(--r-md);
        background: var(--surface-sunken); color: var(--text-disabled);
        padding: 28px var(--s-4); text-align: center; font-size: 12px; }
.code-card { padding: var(--s-6); align-items: center; display: flex; flex-direction: column; gap: var(--s-2); width: 100%; }
.code { font-size: 32px; font-weight: 700; letter-spacing: 2px; }
.preview { display: flex; align-items: baseline; gap: 2px; }
.preview .sep { color: var(--text-disabled); }
.preview .live { color: var(--status-live); }
</style>
