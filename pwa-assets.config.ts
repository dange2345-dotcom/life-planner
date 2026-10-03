import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Иконки (PWA, apple-touch-icon, favicon) генерируются при сборке из public/icon.svg.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    apple: {
      ...minimal2023Preset.apple,
      padding: 0,
      resizeOptions: { background: '#cfe4f5', fit: 'contain' },
    },
    maskable: {
      ...minimal2023Preset.maskable,
      padding: 0, // поля уже заложены в самом icon.svg
      resizeOptions: { background: '#cfe4f5', fit: 'contain' },
    },
  },
  images: ['public/icon.svg'],
})
