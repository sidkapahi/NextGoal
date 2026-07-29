<script setup>
import alertIcon from '../assets/icon-alert.svg'

// Full-window confirmation overlay (Home reset, Settings danger-zone reset).
// Reusable: caller supplies the copy and handles confirm/cancel.
defineProps({
  title: { type: String, required: true },
  body: { type: String, default: '' },
  confirmLabel: { type: String, default: 'Confirm' },
  cancelLabel: { type: String, default: 'Nevermind' },
})
const emit = defineEmits(['confirm', 'cancel'])
</script>

<template>
  <div class="overlay">
    <div class="overlay-inner">
      <span class="alert-icon" :style="{ '--icon': `url(${alertIcon})` }"></span>
      <div class="copy">
        <h2 class="t-title">{{ title }}</h2>
        <p v-if="body" class="t-body body">{{ body }}</p>
      </div>
      <div class="actions">
        <button type="button" class="cancel" @click="emit('cancel')">{{ cancelLabel }}</button>
        <button type="button" class="btn btn--danger btn--lg confirm" @click="emit('confirm')">
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Opaque cover over the whole window, content centered. */
.overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}
.overlay-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--s-5);
  max-width: 340px;
}
.alert-icon {
  width: 44px;
  height: 44px;
  display: inline-block;
  background: var(--status-error);
  -webkit-mask: var(--icon) center / contain no-repeat;
  mask: var(--icon) center / contain no-repeat;
}
.copy {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}
.body {
  color: var(--text-secondary);
}
.actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-3);
}
.cancel {
  border: 0;
  background: transparent;
  cursor: pointer;
  font: 500 13px/1.4 var(--font);
  color: var(--text-secondary);
  padding: var(--s-1) var(--s-2);
  transition: color var(--dur) var(--ease);
}
.cancel:hover {
  color: var(--text);
}
.confirm {
  min-width: 108px;
}
</style>
