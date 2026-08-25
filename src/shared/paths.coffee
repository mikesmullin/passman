###
Vault path rules (main process):
- Absolute paths stay absolute.
- Anything else is relative to process.cwd() (where Passman was launched).
- When we can, we store paths relative to cwd so vaults travel with the project.
###
import { isAbsolute, relative, resolve, basename, sep } from "path"

###
Directory used for relative vault paths.
Prefer PASSMAN_CWD (set by the global `passman` launcher so vaults stay
next to where you invoked the command, even when the app binary lives elsewhere).
###
export workspaceRoot = ->
  fromEnv = process.env.PASSMAN_CWD?.trim()
  if fromEnv then fromEnv else process.cwd()

# Resolve a stored path to an absolute filesystem path.
export resolveVaultPath = (stored) ->
  p = (stored or "").trim()
  throw new Error "Path is empty" unless p
  if isAbsolute p then resolve p else resolve workspaceRoot(), p

###
Normalize a path for storage in vault metadata / UI.
Absolute paths outside cwd stay absolute; paths under cwd become relative.
###
export storeVaultPath = (input) ->
  p = (input or "").trim()
  throw new Error "Path is empty" unless p
  abs = if isAbsolute p then resolve p else resolve workspaceRoot(), p
  rel = relative workspaceRoot(), abs
  # Outside cwd (or different drive on Windows) → keep absolute
  return abs if rel.startsWith("..") or isAbsolute rel
  # Prefer ./file.kdbx style only when needed; plain relative is fine
  rel.split(sep).join("/") or basename abs

# Safe default filename from vault display name.
export defaultVaultFileName = (name) ->
  base = (name or "passman")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) or "passman"
  if base.endsWith ".kdbx" then base else "#{base}.kdbx"

export defaultVaultStoredPath = (name) ->
  # Always relative to cwd — never under home/userData.
  defaultVaultFileName name
