<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
// Edit mode: reached from the main window's SETUP > Edit. We only re-run the OBS
// + source steps, then return to the app (no Twitch, no completeOnboarding).
const editMode = computed(() => route.query.mode === 'edit')

// step ids drive the flow
const step = ref(editMode.value ? 'websocket' : 'welcome')
const detectState = ref('looking') // looking | connected | notfound
const TOTAL = 4

const obsError = ref('')
const obsHost = ref('localhost')
const obsPort = ref(4455)
const obsPassword = ref('')

const sources = ref([])
const selected = ref('')
const customName = ref('')
const selectOpen = ref(false)
const sourceDone = ref(false)

const userCode = ref('')
const verifyUri = ref('https://www.twitch.tv/activate')
const loginError = ref('')

const testCount = ref(0)
const cleanups = []

const headerSteps = { websocket: 1, detect: 2, source: 3, twitch: 4, done: 4 }
const stepNum = computed(() => headerSteps[step.value] || 0)
const showHeader = computed(() => step.value in headerSteps)

onMounted(async () => {
  if (!window.ng) return
  cleanups.push(window.ng.onTwitchLoginOk(() => { step.value = 'done' }))
  cleanups.push(window.ng.onTwitchLoginFailed((m) => (loginError.value = m)))
  cleanups.push(window.ng.onCountChanged(({ count }) => (testCount.value = count)))
  if (editMode.value) {
    const s = await window.ng.getState()
    obsHost.value = s.cfg.obsHost
    obsPort.value = s.cfg.obsPort
    selected.value = s.cfg.obsSource || ''
  }
})
onUnmounted(() => cleanups.forEach((fn) => fn && fn()))

// ---- Step 1 -> Step 2: connect + detect ----
async function connectObs() {
  step.value = 'detect'
  detectState.value = 'looking'
  obsError.value = ''
  await window.ng.setObsPassword(obsPassword.value)
  const res = await window.ng.obsConnect({
    host: obsHost.value,
    port: Number(obsPort.value),
    password: obsPassword.value,
  })
  if (res.ok) {
    detectState.value = 'connected'
    await loadSources()
    setTimeout(() => { if (step.value === 'detect') step.value = 'source' }, 1000)
  } else {
    obsError.value = res.error || 'Could not connect.'
    detectState.value = 'notfound'
  }
}

// ---- Step 3: source ----
async function loadSources() {
  const res = await window.ng.obsListSources()
  sources.value = res.sources || []
  if (!selected.value && sources.value.length) selected.value = sources.value[0]
}
function pickSource(name) {
  selected.value = name
  selectOpen.value = false
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
  } else {
    obsError.value = res.error || 'Could not create the source.'
  }
}
async function testSource() {
  if (!selected.value) return
  await window.ng.obsTestSource(selected.value)
}
async function connectSource() {
  if (!selected.value) { obsError.value = 'Pick or create a source.'; return }
  obsError.value = ''
  const res = await window.ng.obsSelectSource(selected.value)
  if (!res.ok) { obsError.value = res.error || 'Could not set the source.'; return }
  sourceDone.value = true
  setTimeout(() => {
    if (editMode.value) router.push('/app')
    else step.value = 'twitch'
  }, 700)
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

function fireTest() { window.ng.fireTestSub() }
function finish() { window.ng.completeOnboarding() }
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
      <div class="ob-body">
        <div class="col welcome-top">
          <h1 class="t-title">Welcome to NextGoal</h1>
          <p class="t-body sub">A sub goal that raises itself. Every time you hit the target, the next one appears automatically.</p>
        </div>
        <div class="grow center">
          <svg class="carets" width="120" height="150" viewBox="0 0 120 150" fill="none" aria-hidden="true">
            <path d="M12 96 L60 52 L108 96" stroke="var(--accent-500)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M12 132 L60 88 L108 132" stroke="var(--primary)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
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
        <div class="shot">OBS · Tools › WebSocket Server Settings</div>
        <div class="row" style="gap:var(--s-3)">
          <label class="col f"><span class="t-caption">Host</span><input v-model="obsHost" /></label>
          <label class="col f" style="max-width:130px"><span class="t-caption">Port</span><input v-model="obsPort" /></label>
        </div>
        <label class="col f">
          <span class="t-caption">Password (if you set one)</span>
          <input type="password" v-model="obsPassword" placeholder="Press “Show Connect Info” in OBS" />
        </label>
      </div>
      <footer class="ob-foot row">
        <button class="btn btn--secondary" @click="backFromWebsocket">Back</button>
        <div class="grow"></div>
        <button class="btn btn--primary" @click="connectObs">Connect</button>
      </footer>
    </template>

    <!-- ============ STEP 2 — DETECTING ============ -->
    <template v-else-if="step === 'detect'">
      <div class="ob-body center grow">
        <template v-if="detectState === 'looking'">
          <div class="spinner"></div>
          <h1 class="t-title">Looking for OBS…</h1>
          <p class="t-body sub">Make sure OBS is open and the WebSocket server is enabled for port {{ obsPort }}.</p>
        </template>
        <template v-else-if="detectState === 'connected'">
          <div class="badge ok">✓</div>
          <h1 class="t-title">Connected</h1>
          <p class="t-body sub">Next, we’ve gotta connect the text source so we know where to update your sub goal + count!</p>
        </template>
        <template v-else>
          <div class="badge err">✕</div>
          <h1 class="t-title">Couldn’t find OBS</h1>
          <p class="t-body sub">Make sure your information is correct and you hit ‘Apply’ in the WebSocket settings before trying to connect to NextGoal.</p>
          <button class="btn btn--secondary" @click="connectObs">Refresh</button>
        </template>
      </div>
      <footer class="ob-foot" v-if="detectState === 'notfound'">
        <button class="linkbtn" @click="step = 'websocket'">Edit Details →</button>
      </footer>
    </template>

    <!-- ============ STEP 3 — ADD TEXT SOURCE ============ -->
    <template v-else-if="step === 'source'">
      <div class="ob-body col left">
        <div class="col" style="gap:var(--s-1)">
          <h1 class="t-title">Connect your text source</h1>
          <p class="t-body sub">We can create the text source in OBS for you. Or select one you’ve already configured.</p>
        </div>
        <div class="shot">OBS · Sources</div>
        <label class="col f">
          <span class="t-caption">Source</span>
          <div class="select" :class="{ open: selectOpen }">
            <button type="button" class="select-trigger" @click="selectOpen = !selectOpen">
              <span class="select-val"><span class="aa">Aa</span>{{ selected || 'Select a source' }}</span>
              <span class="caret">⌄</span>
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
        <button class="btn btn--ghost" @click="testSource">Test</button>
        <span v-if="sourceDone" class="pill ok-pill"><span class="dot" style="background:var(--status-ok)"></span><span class="t-caption">Success</span></span>
        <button v-else class="btn btn--primary" @click="connectSource">Connect</button>
      </footer>
    </template>

    <!-- ============ STEP 4 — TWITCH ============ -->
    <template v-else-if="step === 'twitch'">
      <div class="ob-body center grow">
        <div class="badge twitch">
          <svg width="22" height="24" viewBox="0 0 24 28" fill="none" aria-hidden="true">
            <path d="M4 0 L1 6 v20 h7 v3 h4 l3-3 h5 l4-4 V0 Z" fill="#fff"/>
            <path d="M6 4 v14 h4 V4 Z M14 4 v14 h4 V4 Z" fill="#9146FF"/>
          </svg>
        </div>
        <h1 class="t-title">Link your Twitch account</h1>
        <p class="t-body sub">So NextGoal can count subs in real time. It can only read your sub count — nothing else.</p>
        <div class="card code-card" v-if="userCode">
          <span class="t-micro">Enter this code</span>
          <span class="code tabular">{{ userCode }}</span>
          <span class="t-caption mute">at twitch.tv/activate</span>
        </div>
        <p v-if="userCode" class="t-caption mute">Waiting for you to authorize…</p>
        <p v-if="loginError" class="t-caption err">{{ loginError }}</p>
      </div>
      <footer class="ob-foot col">
        <button class="btn btn--primary btn--full btn--lg" @click="loginTwitch">
          {{ userCode ? 'Reopen twitch.tv/activate' : 'Login with Twitch' }}
        </button>
        <button class="btn btn--ghost btn--full" @click="step = 'done'">Skip for now</button>
      </footer>
    </template>

    <!-- ============ DONE ============ -->
    <template v-else-if="step === 'done'">
      <div class="ob-body center grow">
        <div class="badge ok">✓</div>
        <h1 class="t-title">Connected</h1>
        <p class="t-body sub">You’re all good to go, all that’s left is setting your starting goal and increment level.</p>
        <div class="preview"><span class="t-title">{{ testCount }}</span><span class="t-title sep">/</span><span class="t-title live">5</span></div>
      </div>
      <footer class="ob-foot col">
        <button class="btn btn--secondary btn--full" @click="fireTest">Fire a test sub</button>
        <button class="btn btn--primary btn--full btn--lg" @click="finish">Let’s go!</button>
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

.dots { display: flex; gap: 6px; }
.dots .dot { width: 6px; height: 6px; }

.center { align-items: center; text-align: center; justify-content: center; gap: var(--s-4); }
.left { gap: var(--s-4); }
.grow { flex: 1; }
.sub { color: var(--text-secondary); }
.mute { color: var(--text-muted); text-align: center; }
.err { color: var(--status-error); }
.f { gap: var(--s-2); flex: 1; }
.welcome-top { gap: var(--s-3); text-align: center; align-items: center; padding-top: var(--s-8); }
.carets { display: block; }

.badge { width: 44px; height: 44px; border-radius: var(--r-full); display: flex; align-items: center; justify-content: center; font-size: 22px; color: #fff; }
.badge.ok { background: var(--status-ok); }
.badge.err { background: var(--status-error); }
.badge.twitch { background: #9146FF; }

.spinner { width: 40px; height: 40px; border-radius: var(--r-full);
           border: 3px solid var(--surface-raised); border-top-color: var(--primary);
           animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.shot { border: 1px dashed var(--border-strong); border-radius: var(--r-md);
        background: var(--surface-sunken); color: var(--text-disabled);
        padding: 40px var(--s-4); text-align: center; font-size: 12px; }

.linkbtn { background: none; border: none; color: var(--text-secondary); cursor: pointer;
           font: 500 13px/1.4 var(--font); padding: var(--s-2); }
.linkbtn:hover { color: var(--text); }

.code-card { padding: var(--s-6); align-items: center; display: flex; flex-direction: column; gap: var(--s-2); width: 100%; }
.code { font-size: 32px; font-weight: 700; letter-spacing: 2px; }
.preview { display: flex; align-items: baseline; gap: 2px; }
.preview .sep { color: var(--text-disabled); }
.preview .live { color: var(--status-live); }
.ok-pill { background: transparent; }

/* custom source dropdown */
.select { position: relative; width: 100%; }
.select-trigger { width: 100%; height: var(--ctrl-lg); display: flex; align-items: center; justify-content: space-between;
  padding: 0 var(--s-3); background: var(--surface-sunken); border: 1px solid var(--border); border-radius: var(--r-md);
  color: var(--text); font: 400 14px/1 var(--font); cursor: pointer; }
.select.open .select-trigger { border-color: var(--primary); box-shadow: var(--focus); }
.select-val { display: flex; align-items: center; gap: var(--s-2); }
.select .caret { color: var(--text-muted); }
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
