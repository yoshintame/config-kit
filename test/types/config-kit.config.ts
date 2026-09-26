import { defineConfigKit } from '@yoshintame/config-kit'
import { z } from 'zod'

const publicSchema = z.object({
  backend: z.object({ apiUrl: z.string() }),
  flag: z.boolean().default(false),
})

const config = defineConfigKit({
  schemas: {
    public: publicSchema,
    server: publicSchema.extend({
      devServer: z.object({ backendUrl: z.url() }),
    }),
    build: z.object({
      msw: z.boolean().default(false),
      token: z.string().optional(),
    }),
  },
  onInvalid(_error, { renderDefault, kind }) {
    if (kind === 'placeholder') return { backend: { apiUrl: '/api' } }
    renderDefault()
  },
  sensitive: ['build.token'],
})

export default config

declare module '@yoshintame/config-kit' {
  interface Register {
    config: typeof config
  }
}
