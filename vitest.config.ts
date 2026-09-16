import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Collectors shell out to PowerShell / top / vm_stat; the Windows path
    // alone can take several seconds on a cold first run.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
