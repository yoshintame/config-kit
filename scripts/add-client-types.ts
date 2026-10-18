import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'

const index = 'dist/index.d.ts'

copyFileSync('client.d.ts', 'dist/client.d.ts')
writeFileSync(
  index,
  `/// <reference path="./client.d.ts" />\n${readFileSync(index, 'utf-8')}`,
)
