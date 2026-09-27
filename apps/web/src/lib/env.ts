import { parseServerConfig, type ServerConfig } from '@vgb/services';

let cached: ServerConfig | undefined;

/** Validated lazily so `next build` does not need runtime secrets. */
export function env(): ServerConfig {
  return (cached ??= parseServerConfig(process.env));
}
