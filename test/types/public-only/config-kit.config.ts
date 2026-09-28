import { defineConfigKit } from '@yoshintame/config-kit'
import { z } from 'zod'

const config = defineConfigKit({
  schemas: { public: z.object({ apiUrl: z.string() }) },
})

export default config

declare module '@yoshintame/config-kit' {
  interface Register {
    config: typeof config
  }
}
