import { expectTypeOf, test } from 'vitest'

import type * as browser from './browser'
import type * as node from './index'

test('the browser stub has the exports of the node entry', () => {
  expectTypeOf<keyof typeof browser>().toEqualTypeOf<keyof typeof node>()
  expectTypeOf<typeof browser>().toExtend<typeof node>()
})
