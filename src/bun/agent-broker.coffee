import { createServer } from "net"
import { chmodSync, existsSync, mkdirSync, rmSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import * as vault from "../shared/vault.coffee"

RUNTIME_DIR = join homedir(), ".config", "passman"
SOCKET_PATH = join RUNTIME_DIR, "agent.sock"

export socketPath = -> SOCKET_PATH

export createAgentBroker = ({ getOpen, persist }) ->
  server = null
  audit = []

  status = ->
    unlocked: Boolean getOpen()
    agentAccess: Boolean server
    socketPath: if server then SOCKET_PATH else null
    audit: audit.slice -20

  record = (operation, item = null, ok = true) ->
    audit.push { at: new Date().toISOString(), operation, item, ok }
    audit = audit.slice -100

  requireOpen = ->
    open = getOpen()
    throw new Error "Human action required: ask a human to open Passman, unlock the vault, and enable Accessible for agents. An agent cannot enable this access itself." unless open and server
    open

  handle = ({ id, method, params = {} }) ->
    try
      open = requireOpen()
      result = switch method
        when "vault.status" then status()
        when "entry.list"
          entries: (vault.listEntries(open.db).map (entry) ->
            id: entry.id
            title: entry.title
            username: entry.username
            url: entry.url
          )
        when "entry.read"
          entry = vault.findEntryByQuery open.db, params.item
          throw new Error "No entry matching \"#{params.item}\"" unless entry
          fields = params.fields
          throw new Error "fields must be a non-empty array" unless Array.isArray(fields) and fields.length
          aliases =
            title: "Title"
            username: "UserName"
            password: "Password"
            url: "URL"
            notes: "Notes"
          resolved = {}
          for field in fields
            if field is "id"
              resolved[field] = entry.uuid.toString()
            else
              source = aliases[field.toLowerCase()] or field
              resolved[field] = vault.readEntryFields(entry, [source])[source]
          fields: resolved
        when "entry.upsert"
          title = String(params.title or "").trim()
          throw new Error "title is required" unless title
          entry = vault.findEntryByQuery open.db, params.id or title
          unless entry
            entry = open.db.createEntry open.db.getDefaultGroup()
            entry.fields.set "Title", title
          values = params.values or {}
          values.Title = title
          plain = vault.updateEntryFields entry, values, params.protectedFields or []
          open.dirty = true
          await persist()
          entry: plain
        when "entry.delete"
          entry = vault.findEntryByQuery open.db, params.item
          throw new Error "No entry matching \"#{params.item}\"" unless entry
          title = vault.entryToPlain(entry).title
          open.db.move entry, null
          open.dirty = true
          await persist()
          deleted: title
        else throw new Error "Unknown agent method: #{method}"
      record method, params.item or params.title
      { id, ok: true, result }
    catch e
      record method, params?.item or params?.title, false
      { id, ok: false, error: e?.message or String(e) }

  enable = ->
    throw new Error "Human action required: unlock a vault in the Passman UI before enabling agent access" unless getOpen()
    return status() if server
    mkdirSync RUNTIME_DIR, recursive: true, mode: 0o700
    chmodSync RUNTIME_DIR, 0o700
    rmSync SOCKET_PATH, force: true if existsSync SOCKET_PATH
    server = createServer (socket) ->
      buffer = ""
      socket.on "data", (chunk) ->
        buffer += chunk.toString "utf8"
        while (newline = buffer.indexOf "\n") >= 0
          line = buffer.slice 0, newline
          buffer = buffer.slice newline + 1
          continue unless line.trim()
          try
            request = JSON.parse line
            handle(request).then (response) -> socket.write JSON.stringify(response) + "\n"
          catch e
            socket.write JSON.stringify({ ok: false, error: e?.message or String(e) }) + "\n"
    await new Promise (resolvePromise, reject) ->
      server.once "error", reject
      server.listen SOCKET_PATH, ->
        server.off "error", reject
        resolvePromise()
    chmodSync SOCKET_PATH, 0o600
    status()

  disable = ->
    if server
      server.close()
      server = null
    rmSync SOCKET_PATH, force: true
    status()

  { enable, disable, status }