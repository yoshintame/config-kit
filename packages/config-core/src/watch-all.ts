import type { SyncConfigSource } from './source'

export function watchAll(
  sources: SyncConfigSource[],
): Pick<SyncConfigSource, 'watch'> {
  const watchers = sources.flatMap((source) =>
    source.watch ? [source.watch.bind(source)] : [],
  )
  return watchers.length === 0
    ? {}
    : {
        watch(onChange) {
          const unwatchers = watchers.map((watch) => watch(onChange))
          return () => {
            for (const unwatch of unwatchers) unwatch()
          }
        },
      }
}
