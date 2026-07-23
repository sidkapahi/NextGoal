import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      commonjsOptions: { include: [/node_modules/, /src/] },
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.js') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      commonjsOptions: { include: [/node_modules/, /src/] },
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.js') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      // Emit assets as files rather than inlining. Inlined, URL-encoded SVG
      // data URIs don't resolve when used as a CSS mask-image via a variable,
      // which the recolorable +/- / gear / close / alert icons rely on.
      assetsInlineLimit: 0,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
    resolve: {
      alias: { '@': resolve(__dirname, 'src/renderer/src') },
    },
    plugins: [vue()],
  },
})
