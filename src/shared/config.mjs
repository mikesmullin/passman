import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, resolve } from 'path';
import { parse, stringify } from 'yaml';

export const CONFIG_PATH = resolve(homedir(), '.config', 'passman', 'config.yaml');

function expandHome(path) {
  return path === '~' || path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : path;
}

export function configuredVaultPath(explicitPath) {
  const fromArgument = String(explicitPath || '').trim();
  if (fromArgument) return existingConfiguredFile(resolve(expandHome(fromArgument)));

  const fromEnv = String(process.env.PASSMAN_VAULT || '').trim();
  if (fromEnv) return existingConfiguredFile(resolve(expandHome(fromEnv)));

  if (!existsSync(CONFIG_PATH)) return null;
  const config = parse(readFileSync(CONFIG_PATH, 'utf8'));
  const fromConfig = String(config?.vault || '').trim();
  return fromConfig ? existingConfiguredFile(resolve(expandHome(fromConfig))) : null;
}

function existingConfiguredFile(path) {
  try {
    return statSync(path).isFile() ? path : null;
  } catch {
    return null;
  }
}

export function rememberVaultPath(vaultPath) {
  const absolutePath = resolve(expandHome(String(vaultPath || '').trim()));
  const current = existsSync(CONFIG_PATH) ? parse(readFileSync(CONFIG_PATH, 'utf8')) : {};
  const config = current && typeof current === 'object' ? current : {};
  config.vault = absolutePath;
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, stringify(config), { mode: 0o600 });
  return absolutePath;
}