import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { VitePWA } from 'vite-plugin-pwa'

// Имя репозитория на GitHub = путь сайта на GitHub Pages (https://<user>.github.io/life-planner/).
// Если репозиторий будет назван иначе — поменять здесь.
const BASE = '/life-planner/'

export default defineConfig({
  base: BASE,
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      // theme-color задан в index.html отдельно для светлой и тёмной темы — плагин свой не добавляет.
      pwaAssets: { config: true, injectThemeColor: false },
      manifest: {
        name: 'Планер',
        short_name: 'Планер',
        description: 'Личный планер: привычки, задачи, финансы, цели',
        lang: 'ru',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'any',
        background_color: '#faf7f5',
        theme_color: '#faf7f5',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: `${BASE}index.html`,
      },
    }),
  ],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
