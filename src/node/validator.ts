import {
  type ConfigKitSchemas,
  errorMessage,
  type ResolveSectionOptions,
  resolveSection,
  Section,
} from '../core'
import { createProcessEnvSource } from './process-env-source'

export interface ValidatorOptions
  extends Omit<ResolveSectionOptions, 'source'> {
  envVar: string
}

export function runValidator(
  config: { schemas: ConfigKitSchemas },
  { envVar, ...options }: ValidatorOptions,
): void {
  try {
    resolveSection(config, Section.Public, {
      ...options,
      source: createProcessEnvSource({ envVar }),
    })
  } catch (error) {
    console.error(errorMessage(error))
    process.exit(1)
  }
  console.log(`${envVar} is valid`)
}
