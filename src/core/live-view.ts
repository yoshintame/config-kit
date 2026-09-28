export interface HotData {
  data: Record<string, unknown>
}

export function liveConfig<T extends object>(
  hot: HotData | undefined,
  value: T,
): T {
  if (!hot) return value
  const state = statesByHotData.get(hot.data) ?? { value }
  state.value = value
  statesByHotData.set(hot.data, state)
  return liveView(state as { value: T })
}

export function liveView<T extends object>(state: { value: T }): T {
  return new Proxy({} as T, {
    get: (_target, prop) => Reflect.get(state.value, prop),
    has: (_target, prop) => Reflect.has(state.value, prop),
    ownKeys: () => Reflect.ownKeys(state.value),
    getOwnPropertyDescriptor: (_target, prop) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(state.value, prop)
      return descriptor ? { ...descriptor, configurable: true } : undefined
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  })
}

const statesByHotData = new WeakMap<object, { value: object }>()
