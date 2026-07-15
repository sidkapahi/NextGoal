import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import Onboarding from './views/Onboarding.vue'
import MainApp from './views/MainApp.vue'
import './styles/tokens.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/onboarding', component: Onboarding },
    { path: '/app', component: MainApp },
    { path: '/:pathMatch(.*)*', redirect: '/app' },
  ],
})

createApp(App).use(router).mount('#app')
