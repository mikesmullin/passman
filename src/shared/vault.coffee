###
Thin wrapper around kdbxweb for KeePass-compatible .kdbx vaults.

KeePassXC (see tmp/keypass/src/format/) implements KDBX3/4 readers/writers
in C++. For this POC we use kdbxweb, the same format library used by KeeWeb,
so files interoperate with KeePass / KeePassXC when AES-KDF is used.

Default KDBX4 creation uses Argon2; kdbxweb needs an external Argon2 impl.
We switch new vaults to AES-KDF (KDBX-compatible) so the POC works out of
the box. Opening Argon2 vaults still needs argon2 wired up later.
###
import * as kdbxweb from "kdbxweb"

fieldText = (entry, name) ->
  value = entry.fields.get name
  return "" unless value?
  return value if typeof value is "string"
  return value.getText() if typeof value.getText is "function"
  String value

STANDARD_FIELDS = new Set ["Title", "UserName", "Password", "URL", "Notes"]

customFieldsOf = (entry) ->
  out = []
  for [name, value] from entry.fields.entries()
    continue if STANDARD_FIELDS.has name
    out.push
      name: name
      value: fieldText entry, name
      protected: typeof value?.getText is "function"
  out.sort (a, b) -> a.name.localeCompare b.name

setField = (entry, name, value, protect = false) ->
  if protect
    entry.fields.set name, kdbxweb.ProtectedValue.fromString(value ? "")
  else
    entry.fields.set name, value ? ""

export entryId = (entry) ->
  entry.uuid.toString()

export entryToPlain = (entry) ->
  id: entryId entry
  title: fieldText entry, "Title"
  username: fieldText entry, "UserName"
  password: fieldText entry, "Password"
  url: fieldText entry, "URL"
  notes: fieldText entry, "Notes"
  customFields: customFieldsOf entry

# Collect entries from the default group (skip recycle bin).
export listEntries = (db) ->
  root = db.getDefaultGroup()
  recycle = db.meta.recycleBinUuid?.toString?() ? null
  out = []

  walk = (group) ->
    return if recycle and group.uuid.toString() is recycle
    for e in group.entries
      out.push entryToPlain e
    for g in group.groups
      walk g

  walk root
  out.sort (a, b) -> a.title.localeCompare b.title

export metaOf = (v, absolutePath = null) ->
  name: v.db.meta.name or "Vault"
  path: v.path
  absolutePath: absolutePath
  dirty: v.dirty
  written: v.written
  entryCount: listEntries(v.db).length

export createVault = (name, password, path = null) ->
  throw new Error "Master password is required" unless password
  credentials = new kdbxweb.Credentials kdbxweb.ProtectedValue.fromString password
  db = kdbxweb.Kdbx.create credentials, name or "Passman Vault"
  # AES-KDF avoids needing an Argon2 WASM backend for the POC.
  db.setKdf kdbxweb.Consts.KdfId.Aes
  db.meta.generator = "Passman"
  { db, path, dirty: true, written: false, password }

export loadVault = (data, password, path = null) ->
  throw new Error "Master password is required" unless password
  credentials = new kdbxweb.Credentials kdbxweb.ProtectedValue.fromString password
  db = await kdbxweb.Kdbx.load data, credentials
  { db, path, dirty: false, written: Boolean(path), password }

export saveVaultBytes = (v) ->
  # Re-apply credentials in case the user rotated the password later.
  credentials = new kdbxweb.Credentials kdbxweb.ProtectedValue.fromString v.password
  v.db.credentials = credentials
  data = await v.db.save()
  v.dirty = false
  v.written = true
  data

export findEntry = (db, id) ->
  root = db.getDefaultGroup()
  stack = [root]
  while stack.length
    group = stack.pop()
    for e in group.entries
      return e if e.uuid.toString() is id
    for g in group.groups
      stack.push g
  null

# Find by UUID or exact title (case-sensitive first, then case-insensitive).
export findEntryByQuery = (db, query) ->
  q = (query or "").trim()
  return null unless q
  byId = findEntry db, q
  return byId if byId

  all = listEntries db
  exact = all.find (e) -> e.title is q
  return findEntry db, exact.id if exact

  lower = q.toLowerCase()
  ci = all.filter (e) -> e.title.toLowerCase() is lower
  return findEntry db, ci[0].id if ci.length is 1
  if ci.length > 1
    throw new Error """Ambiguous title "#{q}" matches #{ci.length} entries; use UUID instead"""
  null

FIELD_ALIASES =
  title: "title"
  name: "title"
  username: "username"
  user: "username"
  userName: "username"
  password: "password"
  pass: "password"
  secret: "password"
  url: "url"
  link: "url"
  notes: "notes"
  note: "notes"
  id: "id"
  uuid: "id"

export normalizeField = (field) ->
  key = (field or "").trim()
  mapped = FIELD_ALIASES[key] or FIELD_ALIASES[key.toLowerCase()]
  unless mapped
    throw new Error """Unknown field "#{field}". Use: title, username, password, url, notes, id"""
  mapped

export getEntryField = (entry, field) ->
  f = normalizeField field
  plain =
    if entry and typeof entry is "object" and entry.fields? and typeof entry.fields.get is "function"
      entryToPlain entry
    else
      entry
  switch f
    when "title" then plain.title
    when "username" then plain.username
    when "password" then plain.password
    when "url" then plain.url
    when "notes" then plain.notes
    when "id" then plain.id

export readEntryFields = (entry, fields) ->
  out = {}
  for field in fields
    out[field] = fieldText entry, field
  out

export updateEntryFields = (entry, values, protectedFields = []) ->
  protectedNames = new Set protectedFields
  for field, value of values
    setField entry, field, String(value ? ""), protectedNames.has field
  entry.times.update()
  entryToPlain entry

export upsertEntry = (vault, input) ->
  entry = if input.id then findEntry vault.db, input.id else null

  if entry
    entry.pushHistory()
  else
    entry = vault.db.createEntry vault.db.getDefaultGroup()

  setField entry, "Title", input.title or "Untitled"
  setField entry, "UserName", input.username or ""
  setField entry, "Password", input.password or "", true
  setField entry, "URL", input.url or ""
  setField entry, "Notes", input.notes or ""
  if Array.isArray input.customFields
    for field in input.customFields
      name = String(field?.name or "").trim()
      continue unless name and not STANDARD_FIELDS.has name
      setField entry, name, String(field?.value ? ""), field?.protected isnt false
  entry.times.update()

  vault.dirty = true
  entryToPlain entry

export deleteEntry = (vault, id) ->
  entry = findEntry vault.db, id
  return false unless entry
  vault.db.remove entry
  vault.dirty = true
  true

# KeePass file signature bytes (little-endian 0x9AA2D903).
export isKdbxMagic = (data) ->
  u8 = if data instanceof Uint8Array then data else new Uint8Array data
  u8.length >= 4 and u8[0] is 0x03 and u8[1] is 0xd9 and u8[2] is 0xa2 and u8[3] is 0x9a
