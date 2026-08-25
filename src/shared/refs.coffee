###
Secret references — analogous to 1Password `op://vault/item/field`.

Vault is selected via PASSMAN_VAULT, not embedded in the reference:
  passman://ITEM/FIELD

ITEM  — entry title or UUID
FIELD — password | username | url | notes | title | id

Also accepts bare `ITEM/FIELD` when parsing env values (optional scheme).
###
import { findEntryByQuery, getEntryField } from "./vault.coffee"

# Matches passman://item/field or item/field (no spaces in item for bare form).
REF_RE = /^(?:passman:\/\/)?([^/\s]+)\/(title|name|username|user|password|pass|secret|url|link|notes|note|id|uuid)$/i

export isSecretRef = (value) ->
  v = (value or "").trim()
  return false unless v
  return true if v.startsWith "passman://"
  REF_RE.test v

export parseSecretRef = (value) ->
  raw = (value or "").trim()
  m = raw.match REF_RE
  unless m
    throw new Error """Invalid secret reference: "#{value}". Expected passman://ITEM/FIELD (e.g. passman://GitHub/password)"""
  { raw, item: decodeURIComponent(m[1]), field: m[2] }

export resolveSecretRef = (vault, value) ->
  ref = parseSecretRef value
  entry = findEntryByQuery vault.db, ref.item
  unless entry
    throw new Error """No entry matching "#{ref.item}" in vault"""
  getEntryField entry, ref.field

# Replace every env value that is a secret ref; return new env + list of secret plaintexts (for optional redaction).
export resolveEnvRefs = (vault, env) ->
  out = {}
  secrets = []
  for k, v of env
    continue unless v?
    if isSecretRef v
      resolved = resolveSecretRef vault, v
      out[k] = resolved
      secrets.push resolved if resolved
    else
      out[k] = v
  { env: out, secrets }

# Parse a simple KEY=VALUE .env file (no export keyword required).
export parseEnvFile = (text) ->
  out = {}
  for line in text.split /\r?\n/
    trimmed = line.trim()
    continue if not trimmed or trimmed.startsWith "#"
    eq = trimmed.indexOf "="
    continue if eq <= 0
    key = trimmed.slice(0, eq).trim()
    val = trimmed.slice(eq + 1).trim()
    if (val.startsWith('"') and val.endsWith('"')) or (val.startsWith("'") and val.endsWith("'"))
      val = val.slice 1, -1
    out[key] = val
  out
