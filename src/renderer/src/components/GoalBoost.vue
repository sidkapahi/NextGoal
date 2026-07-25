<script setup>
import { ref, computed, nextTick } from 'vue'

// GOAL BOOST — the amount the goal auto-raises by (the session `increment`).
// Preset chips + a CUSTOM slot. The active value renders large in brand color
// with a leading "+"; the rest are muted. CUSTOM opens an inline number input.
const props = defineProps({
  increment: { type: Number, required: true },
})
const emit = defineEmits(['set'])

const PRESETS = [5, 10, 25, 50, 100, 1000]

const isPreset = computed(() => PRESETS.includes(props.increment))

const editing = ref(false)
const draft = ref('')
const inputEl = ref(null)

function pick(v) {
  editing.value = false
  emit('set', v)
}

async function openCustom() {
  draft.value = isPreset.value ? '' : String(props.increment)
  editing.value = true
  await nextTick()
  inputEl.value?.focus()
  inputEl.value?.select()
}

function applyCustom() {
  const v = Math.max(1, Math.floor(Number(draft.value) || 0))
  editing.value = false
  if (v >= 1) emit('set', v)
}
</script>

<template>
  <div class="goal-boost">
    <span class="gb-label">GOAL BOOST</span>
    <div class="gb-row">
      <button
        v-for="p in PRESETS"
        :key="p"
        type="button"
        class="gb-chip"
        :class="{ active: isPreset && increment === p }"
        @click="pick(p)"
      >
        {{ isPreset && increment === p ? `+${p}` : p }}
      </button>

      <!-- CUSTOM slot: shows the active custom value, or the CUSTOM affordance -->
      <input
        v-if="editing"
        ref="inputEl"
        v-model="draft"
        type="number"
        min="1"
        class="gb-custom-input"
        @keyup.enter="applyCustom"
        @keyup.esc="editing = false"
        @blur="applyCustom"
      />
      <button
        v-else-if="!isPreset"
        type="button"
        class="gb-chip active"
        @click="openCustom"
      >
        +{{ increment }}
      </button>
      <button v-else type="button" class="gb-custom" @click="openCustom">CUSTOM</button>
    </div>
  </div>
</template>

<style scoped>
/* Figma: column gap 8, centered; label 13 medium text/secondary;
   row gap 16; active value 20 medium primary; presets 13 medium muted;
   CUSTOM 13 medium disabled, underlined. */
.goal-boost {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-2);
}
.gb-label {
  font-size: 13px;
  line-height: 1.4;
  font-weight: 500;
  color: var(--text-secondary);
}
.gb-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-4);
}
.gb-chip {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-family: var(--font);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--text-muted);
  padding: 0;
  transition: color var(--dur) var(--ease);
}
.gb-chip:hover {
  color: var(--text-secondary);
}
.gb-chip.active {
  font-size: 20px;
  line-height: 1.3;
  letter-spacing: -0.2px;
  color: var(--primary);
}
.gb-custom {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-family: var(--font);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--text-disabled);
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: color var(--dur) var(--ease);
}
.gb-custom:hover {
  color: var(--text-secondary);
}
.gb-custom-input {
  width: 64px;
  height: var(--ctrl-sm);
  text-align: center;
  padding: 0 var(--s-1);
  font-variant-numeric: tabular-nums;
}
</style>
