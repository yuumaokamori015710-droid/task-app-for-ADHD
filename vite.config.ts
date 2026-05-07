import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GITHUB_REPOSITORY = "username/repo-name" → base = "/repo-name/"
// ローカル開発時は "/" のまま
const base = process.env.GITHUB_REPOSITORY
  ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/`
  : '/'

export default defineConfig({
  plugins: [react()],
  base,
  server: {
    host: true,
  },
})
