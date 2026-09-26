import { defineConfigKit } from '@yoshintame/config-kit'
import { z } from 'zod'

defineConfigKit({
  schemas: { public: z.object({ a: z.string() }) },
  // @ts-expect-error
  onInvalid: () => ({ a: 1 }),
  // @ts-expect-error
  sensitive: ['public.a'],
})
