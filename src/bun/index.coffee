###
Passman main process (Electrobun / Cottontail).
Owns the open vault in memory and exposes file + vault RPCs to the webview.

Paths: relative paths are always against process.cwd() (launch directory).
Absolute paths are used as-is. We never default to home/userData.
###
import { BrowserView, BrowserWindow, Utils } from "electrobun/bun"
import {
  existsSync
  readFileSync
  writeFileSync
  mkdirSync
  readdirSync
  statSync
} from "fs"
import { basename, dirname, join } from "path"
import * as vault from "../shared/vault.coffee"
import {
  defaultVaultStoredPath
  resolveVaultPath
  storeVaultPath
  workspaceRoot
} from "../shared/paths.coffee"
import { createAgentBroker } from "./agent-broker.coffee"
import { configuredVaultPath, rememberVaultPath } from "../shared/config.mjs"

# Desktop diagnostics only when PASSMAN_VERBOSE=1 (passman -v / --verbose).
VERBOSE = process.env.PASSMAN_VERBOSE is "1" or process.env.PASSMAN_VERBOSE is "true"

vlog = (args...) ->
  console.log args... if VERBOSE

open = null
humanAccess = false

noVaultError = ->
  { ok: false, error: "No vault is open" }

ensureParent = (absPath) ->
  mkdirSync dirname(absPath), recursive: true

readAbs = (absPath) ->
  buf = readFileSync absPath
  buf.buffer.slice buf.byteOffset, buf.byteOffset + buf.byteLength

writeAbs = (absPath, data) ->
  ensureParent absPath
  writeFileSync absPath, Buffer.from data

metaFor = (v) ->
  abs = if v.path then resolveVaultPath v.path else null
  vault.metaOf v, abs

persistOpen = ->
  throw new Error "No vault is open" unless open
  unless open.path
    open.path = defaultVaultStoredPath open.db.meta.name or "passman"
  # Normalize storage form (relative when under cwd)
  open.path = storeVaultPath open.path
  abs = resolveVaultPath open.path
  data = await vault.saveVaultBytes open
  writeAbs abs, data
  open.dirty = false
  open.written = true
  vlog "[passman] vault written:", open.path, "→", abs
  open.path

agentBroker = createAgentBroker
  getOpen: -> open
  persist: -> await persistOpen()

listLocalVaults = (pathIn = null) ->
  cwd = workspaceRoot()
  if pathIn?.trim()
    try
      cwd = dirname resolveVaultPath(pathIn)
    catch _
      # Fall back to the launch directory.
  names = []
  try
    names = readdirSync(cwd).filter (f) -> f.toLowerCase().endsWith ".kdbx"
  catch e
    console.warn "[passman] listLocalVaults readdir failed", e
    return []

  out = []
  for name in names
    absolutePath = join cwd, name
    try
      st = statSync absolutePath
      continue unless st.isFile()
      # Quick magic check — skip non-kdbx masquerading as .kdbx
      fd = readFileSync absolutePath
      head = fd.subarray 0, 4
      continue if head.length < 4 or head[0] isnt 0x03 or head[1] isnt 0xd9 or head[2] isnt 0xa2 or head[3] isnt 0x9a
      out.push
        path: storeVaultPath absolutePath
        absolutePath: absolutePath
        name: name
        size: st.size
        mtime: st.mtime.toISOString()
    catch _
      # skip unreadable
  out.sort (a, b) -> b.mtime.localeCompare a.mtime

rpc = BrowserView.defineRPC
  maxRequestTime: 60000
  handlers:
    requests:
      hello: ->
        ok: true
        message: workspaceRoot()
        mjs: "m-js"
        cwd: workspaceRoot()
        access: agentBroker.status()
        preferredVault: configuredVaultPath()

      listLocalVaults: (params = {}) ->
        selectedPath = params?.path
        directory = if selectedPath?.trim() then dirname(resolveVaultPath(selectedPath)) else workspaceRoot()
        cwd: directory
        vaults: listLocalVaults selectedPath

      createVault: ({ name, password, path: pathIn }) ->
        try
          vaultName = name or "Passman Vault"
          raw = pathIn?.trim()
          unless raw
            return { ok: false, error: "File path is required (relative to cwd or absolute)" }
          stored = storeVaultPath raw
          abs = resolveVaultPath stored
          if existsSync abs
            return { ok: false, error: "File already exists: #{stored} (#{abs})" }
          vlog "[passman] createVault cwd=", workspaceRoot(), "stored=", stored, "abs=", abs
          open = await vault.createVault vaultName, password, stored
          humanAccess = false
          await persistOpen()
          rememberVaultPath resolveVaultPath(open.path)
          { ok: true, meta: metaFor open }
        catch e
          { ok: false, error: e?.message }

      openVault: ({ password, path }) ->
        try
          stored = path?.trim() or null
          unless stored
            chosen = await Utils.openFileDialog
              startingFolder: workspaceRoot()
              allowedFileTypes: "kdbx"
              canChooseFiles: true
              canChooseDirectory: false
              allowsMultipleSelection: false
            pick = chosen?[0] or null
            unless pick
              return { ok: false, error: "No file selected" }
            stored = storeVaultPath pick
          else
            stored = storeVaultPath stored

          abs = resolveVaultPath stored
          unless existsSync abs
            return { ok: false, error: "File not found: #{stored} (resolved #{abs})" }
          data = readAbs abs
          unless vault.isKdbxMagic data
            return { ok: false, error: "Not a KeePass .kdbx file (bad signature)" }
          open = await vault.loadVault data, password, stored
          humanAccess = false
          rememberVaultPath abs
          {
            ok: true
            meta: metaFor open
            entries: []
          }
        catch e
          msg = e?.message or String e
          code = e?.code
          if code is "InvalidKey" or /invalid key/i.test msg
            return { ok: false, error: "Wrong master password" }
          { ok: false, error: msg }

      saveVault: ({ path }) ->
        return noVaultError() unless open
        try
          open.path = storeVaultPath path if path?.trim()
          unless open.path
            open.path = defaultVaultStoredPath open.db.meta.name or "passman"
          await persistOpen()
          { ok: true, meta: metaFor open }
        catch e
          { ok: false, error: e?.message }

      closeVault: ->
        savedPath = null
        discardedUnsaved = false
        if open
          if open.dirty
            try
              savedPath = await persistOpen()
            catch e
              console.error "[passman] auto-save on lock failed", e
              discardedUnsaved = not open.written
          else
            savedPath = open.path
        humanAccess = false
        agentBroker.disable()
        open = null
        { ok: true, savedPath, discardedUnsaved }

      listEntries: ->
        return { ok: false, error: "Human access is disabled" } unless open and humanAccess
        { entries: vault.listEntries open.db }

      upsertEntry: (params) ->
        return { ok: false, error: "Human access is disabled" } unless open and humanAccess
        try
          entry = vault.upsertEntry open, params
          {
            ok: true
            entry: entry
            entries: vault.listEntries open.db
          }
        catch e
          { ok: false, error: e?.message }

      deleteEntry: ({ id }) ->
        return { ok: false, error: "Human access is disabled" } unless open and humanAccess
        ok = vault.deleteEntry open, id
        return { ok: false, error: "Entry not found" } unless ok
        { ok: true, entries: vault.listEntries open.db }

      pickOpenPath: ->
        chosen = await Utils.openFileDialog
          startingFolder: workspaceRoot()
          allowedFileTypes: "kdbx"
          canChooseFiles: true
          canChooseDirectory: false
          allowsMultipleSelection: false
        pick = chosen?[0]
        return { path: null } unless pick
        # Return stored form (relative when under cwd)
        { path: storeVaultPath pick }

      pickSavePath: ({ suggestedName }) ->
        name = suggestedName or "passman.kdbx"
        chosen = await Utils.openFileDialog
          startingFolder: workspaceRoot()
          allowedFileTypes: "kdbx"
          canChooseFiles: false
          canChooseDirectory: true
          allowsMultipleSelection: false
        dir = chosen?[0]
        return { path: null } unless dir
        file =
          if basename(name).endsWith ".kdbx"
            basename name
          else
            "#{basename name}.kdbx"
        { path: storeVaultPath join dir, file }

      getMeta: ->
        {
          meta: (if open then metaFor open else null)
          humanAccess: humanAccess
          agent: agentBroker.status()
        }

      setHumanAccess: ({ enabled }) ->
        return noVaultError() unless open
        humanAccess = Boolean enabled
        {
          ok: true
          humanAccess: humanAccess
          entries: (if humanAccess then vault.listEntries(open.db) else [])
        }

      setAgentAccess: ({ enabled }) ->
        try
          status = if enabled then await agentBroker.enable() else agentBroker.disable()
          { ok: true, agent: status }
        catch e
          { ok: false, error: e?.message or String(e) }

      agentAccessStatus: -> agentBroker.status()

    messages: {}

mainWindow = new BrowserWindow
  title: "Passman"
  url: "views://public/index.html"
  rpc: rpc
  frame:
    width: 980
    height: 720
    x: 120
    y: 80

vlog "Passman started"
vlog "Working directory (vaults):", workspaceRoot()
vlog "PASSMAN_CWD:", process.env.PASSMAN_CWD if process.env.PASSMAN_CWD

# Diagnostics only in verbose mode (passman -v / PASSMAN_VERBOSE=1).
if VERBOSE
  try
    mainWindow.webview.on "did-navigate", (event) ->
      vlog "[passman] did-navigate", JSON.stringify event

    mainWindow.webview.on "dom-ready", ->
      vlog "[passman] webview dom-ready"
      if Bun.env.PASSMAN_DEVTOOLS is "1"
        try
          mainWindow.webview.openDevTools()
          vlog "[passman] DevTools opened (PASSMAN_DEVTOOLS=1)"
        catch e
          console.warn "[passman] openDevTools failed", e
  catch e
    console.warn "[passman] could not attach webview diagnostics", e
else if Bun.env.PASSMAN_DEVTOOLS is "1"
  try
    mainWindow.webview.on "dom-ready", ->
      try
        mainWindow.webview.openDevTools()
      catch _
        # ignore
  catch _
    # ignore
