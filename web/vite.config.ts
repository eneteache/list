import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Rutas relativas: funciona tanto en local (/) como publicado en GitHub
  // Pages bajo un subpath (usuario.github.io/repo/), sin tener que fijar el
  // nombre del repo aquí — la app no usa rutas de cliente (solo pestañas por
  // estado), así que no hace falta más que esto.
  base: './',
})
