###
Headless vault demo — proves create/edit/save/load without the GUI.

  bun run demo:vault
###
import { join } from "path"
import { mkdirSync, writeFileSync, readFileSync } from "fs"
import * as vault from "../src/shared/vault.coffee"

outDir = join import.meta.dir, "..", "tmp", "demo-vaults"
mkdirSync outDir, recursive: true
path = join outDir, "hello.kdbx"
password = "demo-master-password"

console.log "== Passman vault demo =="

open = await vault.createVault "Hello Passman", password
console.log "created:", vault.metaOf open

vault.upsertEntry open,
  title: "Example.com"
  username: "demo"
  password: "p@ssw0rd"
  url: "https://example.com"
  notes: "Created by scripts/vault-demo.coffee"

vault.upsertEntry open,
  title: "Wi-Fi"
  username: "home"
  password: "super-secret-wifi"
  url: ""
  notes: ""

bytes = await vault.saveVaultBytes open
writeFileSync path, Buffer.from bytes
console.log "saved:", path, "(#{bytes.byteLength} bytes)"
console.log "kdbx magic ok:", vault.isKdbxMagic bytes

reopened = await vault.loadVault (Uint8Array.from readFileSync path).buffer, password, path
entries = vault.listEntries reopened.db
console.log "loaded entries:"
for e in entries
  console.log "  - #{e.title}  user=#{e.username}  pass=#{e.password}"

console.log "meta:", vault.metaOf reopened
console.log "OK — create/edit/save/load works"
