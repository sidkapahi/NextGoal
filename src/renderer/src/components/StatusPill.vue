<script setup>
// Header health pill: a colored dot + label. Tone drives the dot color.
//   ok   → Ready (green)      live → Live (accent orange)     warn → amber
defineProps({
  label: { type: String, required: true },
  tone: { type: String, default: 'ok' }, // 'ok' | 'live' | 'warn'
})

const TONE = {
  ok: 'var(--status-ok)',
  live: 'var(--status-live)',
  warn: 'var(--status-warn)',
}
</script>

<template>
  <span class="status-pill">
    <span class="status-dot" :style="{ background: TONE[tone] || TONE.ok }"></span>
    <span class="status-label">{{ label }}</span>
  </span>
</template>

<style scoped>
/* Figma: bg surface-raised, radius full, padding 5/9, gap 6; dot 7px;
   label 12px regular text/secondary. */
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border-radius: var(--r-full);
  background: var(--surface-raised);
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--r-full);
  flex: 0 0 auto;
}
.status-label {
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-secondary);
  white-space: nowrap;
}
</style>
