# Passman

KeePass-compatible password manager: Electrobun desktop UI + **op-inspired CLI**.

<img width="968" height="710" alt="image" src="https://github.com/user-attachments/assets/385eb7ef-1021-451f-9cde-bda2caae5162" />

| Layer | Choice |
|-------|--------|
| Language | CoffeeScript (CLI / main process); ES6 (webview) |
| Desktop shell | [Electrobun](https://github.com/blackboardsh/electrobun) |
| UI framework | [m-js](https://github.com/mikesmullin/m-js) v3 (vendored minified snapshot) |
| Vault format | KeePass **KDBX** via [kdbxweb](https://github.com/keeweb/kdbxweb) |
| CLI model | 1Password `op read` / `op run` style; vault via **env only** |

## Setup

```bash
bun install
chmod +x bin/passman
bun run link:global   # ~/.local/bin/passman
```

## Flags / env

| Name | Meaning |
|------|---------|
| `PASSMAN_VAULT` | Preferred vault path for the desktop UI; falls back to `~/.config/passman/config.yaml` |
| `-v` / `--verbose` | Diagnostics on stderr (desktop **and** CLI) |

There is **no** `--vault` flag — always:

```bash
export PASSMAN_VAULT=./example.kdbx
```

When `PASSMAN_VAULT` is unset, Passman falls back to
`~/.config/passman/config.yaml`:

```yaml
vault: ~/agent.kdbx
```

The preferred-vault setting only helps the desktop UI preselect a file; it does
not grant CLI, MCP, or library access.
After a successful desktop unlock, Passman remembers that vault in this config
and selects it automatically on the next launch.

## Desktop Access

Master passwords are entered only in the desktop UI. After opening a vault, use
the explicit UI toggles to enable either human entry access, agent access, or
both. Agent access is revoked when toggled off, the vault locks, or Passman
closes.

The entry editor includes custom KDBX fields. Stored protected values are masked
and provide reveal, copy, and generate controls. Plain KDBX string fields are
shown as metadata; fields without a known classification default to protected.

When agent access is enabled, the CLI and MCP server proxy requests to the
running desktop process. They never accept a master password, password file, or
direct KDBX path.

### Secret references

Vault is `PASSMAN_VAULT`, **not** part of the URI:

```text
passman://ITEM/FIELD
```

| Part | Meaning |
|------|---------|
| `ITEM` | Entry title or UUID |
| `FIELD` | `password` \| `username` \| `url` \| `notes` \| `title` \| `id` |

Example `.env` for `passman run --env-file`:

```bash
DATABASE_URL=passman://Postgres/password
API_TOKEN=passman://Stripe/password
```

## Desktop UI

```bash
passman              # quiet
passman gui
passman web          # browser development UI at http://127.0.0.1:4545
passman -v           # verbose diagnostics
passman --verbose
```

Use `passman web --port 4546` to select another port. The browser view serves
the same UI with m-js hot module replacement: JavaScript and CSS changes apply
without a page refresh. Local vault operations work there; native file dialogs
and agent access remain exclusive to Electrobun.

GUI vault paths are relative to the directory you launched from (`PASSMAN_CWD`).

## Library

For Bun applications, import `src/lib.mjs` to access the desktop agent broker.
Passman must be open with Accessible for agents enabled first.

```js
import { openVault, readFields, updateFields } from '/absolute/path/to/passman/src/lib.mjs';

const vault = await openVault(); // Connects to the running Passman desktop process.
const fields = await readFields(vault, 'Entry title', ['api_token', 'expires_at']);
await updateFields(vault, 'Entry title', { api_token: 'rotated-value' });
```

`updateFields` writes values as protected KeePass fields by default and supports
custom field names. Pass `{ protectedFields: [...] }` to store non-secret KDBX
metadata fields such as a credential refresh epoch.

## MCP

Run a local MCP stdio server with `passman mcp` while Accessible for agents is
enabled in the desktop UI. It exposes tools to list entry metadata, explicitly read entry
fields, and update protected fields; write tool responses never echo values.
