/**
 * Passman UI — m.js Alpine-style templates inside an Electrobun webview.
 *
 * Load order matters:
 *  1. Show a visible shell even if RPC fails
 *  2. Mount m.js
 *  3. Wire Electrobun RPC (optional / best-effort)
 *
 * m.js is a vendored minified v3 snapshot (Electrobun has no network for CDN).
 */
import Electrobun, { Electroview } from "electrobun/view";
import M from "./m.min.js";

function showBootError(err) {
	const el = document.getElementById("boot-error");
	if (!el) return;
	const msg =
		err instanceof Error
			? `${err.name}: ${err.message}\n${err.stack || ""}`
			: String(err);
	el.textContent = `Passman UI failed to start:\n\n${msg}`;
	el.classList.add("visible");
	console.error("[passman] boot error", err);
}

function setupBrowserRpc() {
	return new Proxy(
		{},
		{
			get(_target, method) {
				return async (params = {}) => {
					const response = await fetch(`/api/${String(method)}`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(params),
					});
					const result = await response.json();
					if (!response.ok) throw new Error(result.error || response.statusText);
					return result;
				};
			},
		},
	);
}

function setupRpc() {
	if (location.protocol === "http:" || location.protocol === "https:") {
		return setupBrowserRpc();
	}
	try {
		if (!window.__electrobun) {
			window.__electrobun = {
				receiveMessageFromBun: () => {},
				receiveInternalMessageFromBun: () => {},
			};
			console.warn(
				"[passman] window.__electrobun missing — created stub (RPC may not work)",
			);
		}

		const rpc = Electroview.defineRPC({
			maxRequestTime: 60_000,
			handlers: {
				requests: {},
				messages: {},
			},
		});

		const electrobun = new Electrobun.Electroview({ rpc });
		const request = electrobun.rpc?.request;
		if (!request) {
			console.warn("[passman] Electroview rpc.request unavailable");
			return null;
		}
		return request;
	} catch (e) {
		console.error("[passman] Electroview init failed", e);
		return null;
	}
}

const api = setupRpc();

const emptyForm = () => ({
	id: null,
	title: "",
	username: "",
	password: "",
	url: "",
	notes: "",
	customFields: [],
});

function errOf(e) {
	return e instanceof Error ? e.message : String(e);
}

function formatSize(n) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMtime(iso) {
	try {
		const d = new Date(iso);
		return d.toLocaleString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return iso;
	}
}

function boot() {
	try {
	M.mount("#app", () => ({
		screen: "welcome",
		hello: api ? "Starting…" : "UI online (RPC bridge not ready)",
		cwd: "",
		status: "",
		error: "",
		busy: false,
		unlocking: false,
		saveNotice: false,
		saveNoticeLeaving: false,
		saveNoticeTimer: null,
		saveNoticeRemovalTimer: null,

		vaultName: "My Vault",
		/** Path for new vaults — relative to cwd unless absolute. User must confirm/edit. */
		createPath: "My_Vault.kdbx",
		/** When true, changing vaultName updates createPath suggestion. */
		createPathFollowsName: true,
		password: "",
		password2: "",
		openPath: "",
		showVaultOptions: false,

		localVaults: [],
		searchQuery: "",

		meta: null,
		humanAccess: false,
		agentAccess: false,
		entries: [],
		selectedId: null,
		showPassword: false,
		revealedCustomFields: {},
		form: emptyForm(),

		formatSize,
		formatMtime,

		vaultLabel(path) {
			const name = String(path || "Vault").split(/[\\/]/).pop() || "Vault";
			return name.replace(/\.kdbx$/i, "") || "Vault";
		},

		get filteredEntries() {
			const query = this.searchQuery.trim().toLowerCase();
			if (!query) return this.entries;
			return this.entries.filter((entry) =>
				[entry.title, entry.username, entry.url].some((value) =>
					String(value || "").toLowerCase().includes(query),
				),
			);
		},

		suggestPathFromName(name) {
			const base =
				(name || "passman")
					.replace(/[^\w.-]+/g, "_")
					.replace(/^_+|_+$/g, "")
					.slice(0, 64) || "passman";
			return base.endsWith(".kdbx") ? base : `${base}.kdbx`;
		},

		/**
		 * Single handler for the name field (no x-model — m.js lets only one
		 * oninput win per element, so x-model + @input cannot coexist).
		 */
		onVaultNameInput(e) {
			const v = e.target.value;
			this.vaultName = v;
			if (this.createPathFollowsName) {
				this.createPath = this.suggestPathFromName(v);
			}
		},

		/** Path field: any edit stops auto-sync from the name. */
		onCreatePathInput(e) {
			this.createPathFollowsName = false;
			this.createPath = e.target.value;
		},

		async init() {
			if (!api) {
				this.hello = "RPC unavailable";
				this.error =
					"Electrobun bridge missing — vault actions will not work until RPC is connected.";
				return;
			}
			try {
				const res = await api.hello({});
				this.hello = res.message;
				this.cwd = res.cwd;
				if (res.preferredVault) this.selectLocalVault(res.preferredVault);
			} catch (e) {
				this.hello = "RPC unavailable";
				this.error = errOf(e);
			}
			await this.refreshLocalVaults();
		},

		async refreshLocalVaults() {
			if (!api) return;
			try {
				const res = await api.listLocalVaults({
					path: this.openPath || undefined,
				});
				this.cwd = res.cwd;
				this.localVaults = res.vaults;
			} catch (e) {
				console.warn("[passman] listLocalVaults failed", e);
			}
		},

		go(screen) {
			this.clearMessages();
			this.screen = screen;
			if (screen === "create") {
				this.createPathFollowsName = true;
				this.createPath = this.suggestPathFromName(this.vaultName);
			}
			if (screen === "open" || screen === "welcome") {
				this.refreshLocalVaults();
			}
			if (screen === "open") this.focusMasterPassword();
		},

		focusMasterPassword() {
			requestAnimationFrame(() => {
				document.querySelector("#open-master-password")?.focus();
			});
		},

		toggleVaultOptions() {
			this.showVaultOptions = !this.showVaultOptions;
			if (this.showVaultOptions) this.refreshLocalVaults();
		},

		clearMessages() {
			this.error = "";
			this.status = "";
		},

		announceSaved() {
			clearTimeout(this.saveNoticeTimer);
			clearTimeout(this.saveNoticeRemovalTimer);
			this.saveNotice = true;
			this.saveNoticeLeaving = false;
			this.saveNoticeTimer = setTimeout(() => {
				this.saveNoticeLeaving = true;
				this.saveNoticeRemovalTimer = setTimeout(() => {
					this.saveNotice = false;
					this.saveNoticeLeaving = false;
				}, 300);
			}, 2700);
		},

		selectLocalVault(path) {
			this.openPath = path;
			this.screen = "open";
			this.showVaultOptions = false;
			this.clearMessages();
			this.focusMasterPassword();
		},

		async doCreate() {
			this.clearMessages();
			// Always derive from name while still following name (x-model alone
			// does not update createPath). If the user edited the path field,
			// createPathFollowsName is false and we honor createPath as typed.
			if (this.createPathFollowsName) {
				this.createPath = this.suggestPathFromName(this.vaultName);
			}
			const path = (this.createPath || "").trim();
			if (!path) {
				this.error = "Enter a file path for the vault (e.g. My_Vault.kdbx)";
				return;
			}
			if (!this.password) {
				this.error = "Enter a master password";
				return;
			}
			if (this.password !== this.password2) {
				this.error = "Passwords do not match";
				return;
			}
			this.busy = true;
			try {
				const res = await api.createVault({
					name: this.vaultName || "Passman Vault",
					password: this.password,
					path,
				});
				if (!res.ok) {
					this.error = res.error;
					return;
				}
				this.meta = res.meta;
				this.humanAccess = false;
				this.entries = [];
				this.selectedId = null;
				this.form = emptyForm();
				this.password = "";
				this.password2 = "";
				this.screen = "vault";
				this.status = "Vault created.";
				this.announceSaved();
				this.refreshLocalVaults();
			} catch (e) {
				this.error = errOf(e);
			} finally {
				this.busy = false;
			}
		},

		async pickPath() {
			this.clearMessages();
			try {
				const res = await api.pickOpenPath({});
				if (res.path) {
					this.openPath = res.path;
					this.refreshLocalVaults();
					this.focusMasterPassword();
				}
			} catch (e) {
				this.error = errOf(e);
			}
		},

		async doOpen() {
			this.clearMessages();
			if (!this.password) {
				this.error = "Enter the master password";
				return;
			}
			this.busy = true;
			this.unlocking = true;
			try {
				const [res] = await Promise.all([
					api.openVault({
						password: this.password,
						path: this.openPath || undefined,
					}),
					new Promise((resolve) => setTimeout(resolve, 1600)),
				]);
				if (!res.ok) {
					this.error = res.error;
					return;
				}
				this.meta = res.meta;
				this.humanAccess = false;
				this.entries = [];
				this.selectedId = null;
				this.form = emptyForm();
				this.password = "";
				this.screen = "vault";
			} catch (e) {
				this.error = errOf(e);
			} finally {
				this.busy = false;
				this.unlocking = false;
			}
		},

		async doSave() {
			this.clearMessages();
			this.busy = true;
			try {
				const res = await api.saveVault({});
				if (!res.ok) {
					this.error = res.error;
					return;
				}
				this.meta = res.meta;
				this.announceSaved();
				this.refreshLocalVaults();
			} catch (e) {
				this.error = errOf(e);
			} finally {
				this.busy = false;
			}
		},

		async doClose() {
			this.clearMessages();
			try {
				const res = await api.closeVault({});
				if (res.discardedUnsaved) {
					this.error =
						"Vault locked. Unsaved changes could not be written.";
				}
			} catch {
				/* ignore */
			}
			this.meta = null;
			this.humanAccess = false;
			this.agentAccess = false;
			this.entries = [];
			this.selectedId = null;
			this.form = emptyForm();
			this.screen = "open";
			this.showVaultOptions = false;
			this.refreshLocalVaults();
			this.focusMasterPassword();
		},

		selectEntry(id) {
			const entry = this.entries.find((e) => e.id === id);
			if (!entry) return;
			this.selectedId = id;
			this.showPassword = false;
			this.revealedCustomFields = {};
			this.form = {
				id: entry.id,
				title: entry.title,
				username: entry.username,
				password: entry.password,
				url: entry.url,
				notes: entry.notes,
				customFields: (entry.customFields || []).map((field) => ({
					...field,
					protected: field.protected !== false,
				})),
			};
		},

		newEntry() {
			this.selectedId = null;
			this.showPassword = true;
			this.revealedCustomFields = {};
			this.form = emptyForm();
			this.form.title = "New entry";
		},

		isCustomFieldRevealed(name) {
			return Boolean(this.revealedCustomFields[name]);
		},

		toggleCustomField(name) {
			this.revealedCustomFields = {
				...this.revealedCustomFields,
				[name]: !this.revealedCustomFields[name],
			};
		},

		async copyCustomField(field) {
			this.clearMessages();
			if (!field.value) {
				this.error = `${field.name} is empty`;
				return;
			}
			try {
				await navigator.clipboard.writeText(field.value);
				this.status = `${field.name} copied`;
			} catch (e) {
				this.error = errOf(e);
			}
		},

		generateCustomField(field) {
			const alphabet =
				"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
			const random = crypto.getRandomValues(new Uint8Array(20));
			field.value = Array.from(
				random,
				(value) => alphabet[value % alphabet.length],
			).join("");
			this.revealedCustomFields = {
				...this.revealedCustomFields,
				[field.name]: true,
			};
			this.clearMessages();
			this.status = `${field.name} generated. Save the credential when ready.`;
		},

		async copyPassword() {
			this.clearMessages();
			if (!this.form.password) {
				this.error = "This credential has no password to copy";
				return;
			}
			try {
				await navigator.clipboard.writeText(this.form.password);
				this.status = "Password copied";
			} catch (e) {
				this.error = errOf(e);
			}
		},

		generatePassword() {
			const alphabet =
				"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
			const random = crypto.getRandomValues(new Uint8Array(20));
			this.form.password = Array.from(
				random,
				(value) => alphabet[value % alphabet.length],
			).join("");
			this.showPassword = true;
			this.clearMessages();
			this.status = "Strong password generated. Save the credential when ready.";
		},

		async saveEntry() {
			this.clearMessages();
			this.busy = true;
			try {
				const res = await api.upsertEntry({
					id: this.form.id || undefined,
					title: this.form.title,
					username: this.form.username,
					password: this.form.password,
					url: this.form.url,
					notes: this.form.notes,
					customFields: this.form.customFields,
				});
				if (!res.ok) {
					this.error = res.error;
					return;
				}
				this.entries = res.entries;
				this.selectedId = res.entry.id;
				this.form.id = res.entry.id;
				const meta = await api.getMeta({});
				this.meta = meta.meta;
				this.status = "Entry updated. Save the vault when ready.";
			} catch (e) {
				this.error = errOf(e);
			} finally {
				this.busy = false;
			}
		},

		async deleteEntry() {
			if (!this.form.id) return;
			this.clearMessages();
			this.busy = true;
			try {
				const res = await api.deleteEntry({ id: this.form.id });
				if (!res.ok) {
					this.error = res.error;
					return;
				}
				this.entries = res.entries;
				this.selectedId = null;
				this.form = emptyForm();
				const meta = await api.getMeta({});
				this.meta = meta.meta;
				this.status = "Entry deleted";
			} catch (e) {
				this.error = errOf(e);
			} finally {
				this.busy = false;
			}
		},

		async setHumanAccess(enabled) {
			this.clearMessages();
			try {
				const res = await api.setHumanAccess({ enabled });
				if (!res.ok) throw new Error(res.error);
				this.humanAccess = res.humanAccess;
				if (enabled) {
					this.entries = res.entries;
				} else {
					this.entries = [];
					this.form = emptyForm();
				}
			} catch (e) {
				this.error = errOf(e);
			}
		},

		async setAgentAccess(enabled) {
			this.clearMessages();
			this.busy = true;
			try {
				const res = await api.setAgentAccess({ enabled });
				if (!res.ok) throw new Error(res.error);
				this.agentAccess = Boolean(res.agent.agentAccess);
			} catch (e) {
				this.error = errOf(e);
			} finally {
				this.busy = false;
			}
		},

		template: `
<div class="shell" :class="screen === 'vault' ? '' : 'auth-shell'" x-init="init()">
	<header class="topbar" x-show="screen === 'vault'">
    <div class="brand">
			<div class="logo"><img src="app-icon.svg" alt="" /></div>
      <div>
        <h1>Passman</h1>
				<p>Security without anxiety.</p>
      </div>
    </div>
    <div class="topbar-tools">
			<span class="badge" x-if="meta && (meta.dirty || saveNotice)"
				x-text="meta && meta.dirty ? 'unsaved' : 'saved'"
				:class="[meta && meta.dirty ? 'warn' : 'ok', saveNoticeLeaving ? 'save-leaving' : '']"></span>
			<button type="button" class="access-button" x-show="meta"
				title="Lock vault (saves first if there are unsaved changes)" aria-label="Lock vault"
				:disabled="busy" @click="doClose()"><i class="ph ph-lock" aria-hidden="true"></i></button>
			<button type="button" class="access-button" :class="humanAccess ? 'is-active' : ''"
				:aria-pressed="humanAccess" title="Accessible for humans" aria-label="Accessible for humans"
				:disabled="busy || !meta" @click="setHumanAccess(!humanAccess)"><i class="ph ph-user" aria-hidden="true"></i></button>
			<button type="button" class="access-button" :class="agentAccess ? 'is-active' : ''"
				:aria-pressed="agentAccess" title="Accessible for agents" aria-label="Accessible for agents"
				:disabled="busy || !meta" @click="setAgentAccess(!agentAccess)"><i class="ph ph-robot" aria-hidden="true"></i></button>
    </div>
  </header>

  <div x-show="error" class="msg error" x-text="error"></div>
  <div x-show="status" class="msg ok" style="white-space:pre-wrap" x-text="status"></div>

	<section class="unlock-scene" x-show="unlocking" aria-live="polite">
		<div class="unlock-illustration" aria-hidden="true">
			<svg viewBox="0 0 520 300" role="img">
				<path class="unlock-orbit orbit-one" d="M82 162c46-92 164-136 267-91 45 20 80 54 101 95" />
				<path class="unlock-orbit orbit-two" d="M65 205c92 59 224 55 313-11 28-21 50-47 66-77" />
				<circle class="unlock-star star-one" cx="96" cy="83" r="7" />
				<circle class="unlock-star star-two" cx="429" cy="226" r="5" />
				<g class="unlock-lock">
					<path class="unlock-shackle" d="M205 139v-28c0-34 25-60 56-60s56 26 56 60v28" />
					<rect x="176" y="130" width="168" height="125" rx="38" />
					<circle cx="260" cy="181" r="16" />
					<path class="unlock-keyhole" d="M252 192h16l8 32h-32l8-32Z" />
				</g>
			</svg>
		</div>
		<span class="eyebrow">Opening your vault</span>
		<h2>Making a quiet, secure space.</h2>
		<p>Your encrypted file stays on this device.</p>
	</section>

  <section class="panel hero" x-show="screen === 'welcome'">
		<div class="auth-brand"><img src="app-icon.svg" alt="" /><span>Passman</span></div>
    <h2>Hello, vault.</h2>
    <div class="row" style="justify-content:center;margin-top:1rem">
	<button type="button" class="primary" @click="go('create')"><i class="ph ph-plus-circle" aria-hidden="true"></i>New vault</button>
	<button type="button" @click="go('open')"><i class="ph ph-folder-open" aria-hidden="true"></i>Open vault</button>
    </div>

    <div class="local-vaults" x-show="localVaults.length" style="margin-top:1.5rem;text-align:left">
      <h3 class="local-heading">Vaults in this directory</h3>
      <div class="local-list">
        <template x-for="v in localVaults" :key="v.path">
          <button type="button" class="local-item" @click="selectLocalVault(v.path)">
            <span class="t mono" x-text="v.path"></span>
            <span class="u" x-text="formatSize(v.size) + ' · ' + formatMtime(v.mtime)"></span>
          </button>
        </template>
      </div>
    </div>
    <p class="muted" style="margin-top:1rem;font-size:0.85rem" x-show="cwd && !localVaults.length">
			No vaults found here.
    </p>
  </section>

  <section class="panel hero wide" x-show="screen === 'create'">
		<div class="auth-brand"><img src="app-icon.svg" alt="" /><span>Passman</span></div>
    <h2>Create vault</h2>
    <div class="stack">
	<label>Vault name
        <input type="text" :value="vaultName" placeholder="My Vault" @input="onVaultNameInput($event)" />
      </label>
      <label>File path
        <input type="text" class="mono" :value="createPath" placeholder="My_Vault.kdbx"
               @input="onCreatePathInput($event)" />
      </label>
      <p class="muted" style="font-size:0.8rem;margin:0">
				Stored relative to <span class="mono" x-text="cwd || 'the launch directory'"></span> unless you enter an absolute path.
      </p>
      <label>Master password
				<input type="password" x-model="password" autocomplete="new-password" @keyup="$event.key === 'Enter' && doCreate()" />
      </label>
      <label>Confirm password
				<input type="password" x-model="password2" autocomplete="new-password" @keyup="$event.key === 'Enter' && doCreate()" />
      </label>
      <div class="row">
		<button type="button" class="primary" :disabled="busy" @click="doCreate()"><i class="ph ph-floppy-disk" aria-hidden="true"></i>Create &amp; save</button>
		<button type="button" class="ghost" @click="go('welcome')"><i class="ph ph-arrow-left" aria-hidden="true"></i>Back</button>
      </div>
    </div>
  </section>

  <section class="panel hero wide unlock-panel" x-show="screen === 'open'">
		<div class="auth-brand"><img src="app-icon.svg" alt="" /><span>Passman</span></div>
		<div class="unlock-heading">
			<span class="eyebrow">Welcome back</span>
			<h2>Hello, vault.</h2>
			<p>Enter your master password to continue.</p>
		</div>
		<div class="selected-vault">
			<span class="selected-vault-icon"><i class="ph ph-vault" aria-hidden="true"></i></span>
			<span><small>Selected vault</small><strong x-text="vaultLabel(openPath)"></strong></span>
			<i class="ph ph-check-circle" aria-hidden="true"></i>
		</div>
		<label class="master-password">Master password
			<input id="open-master-password" type="password" x-model="password" autocomplete="current-password" autofocus @keyup="$event.key === 'Enter' && doOpen()" />
		</label>
		<button type="button" class="primary unlock-submit" :disabled="busy" @click="doOpen()"><i class="ph ph-lock-key-open" aria-hidden="true"></i>Unlock vault</button>
		<button type="button" class="vault-options-toggle" :aria-expanded="showVaultOptions" @click="toggleVaultOptions()">
			<i class="ph ph-folders" aria-hidden="true"></i>
			Choose another vault
			<i class="ph ph-caret-down disclosure-caret" :class="showVaultOptions ? 'open' : ''" aria-hidden="true"></i>
		</button>
		<div class="vault-options" x-if="showVaultOptions">
			<label>Vault file
				<span class="input-actions">
					<input type="text" x-model="openPath" class="mono" placeholder="My_Vault.kdbx or /absolute/path.kdbx" />
					<button type="button" class="icon-button" @click="pickPath()" title="Browse for vault" aria-label="Browse for vault"><i class="ph ph-folder-open" aria-hidden="true"></i></button>
					<button type="button" class="icon-button" @click="refreshLocalVaults()" title="Refresh vaults" aria-label="Refresh vaults"><i class="ph ph-arrow-clockwise" aria-hidden="true"></i></button>
				</span>
			</label>
			<p class="vault-path-help">Relative paths start from <span class="mono" x-text="cwd || 'the launch directory'"></span>.</p>
			<div class="local-vaults">
				<div class="local-heading-row">
					<h3 class="local-heading">Vaults in this folder</h3>
					<span x-text="localVaults.length"></span>
				</div>
				<div class="local-list" x-show="localVaults.length">
					<template x-for="v in localVaults" :key="v.path">
						<button type="button" class="local-item" :class="openPath === v.path ? 'active' : ''" @click="selectLocalVault(v.path)">
							<span class="local-vault-icon"><i class="ph ph-vault" aria-hidden="true"></i></span>
							<span class="local-vault-copy"><strong x-text="vaultLabel(v.name)"></strong><small x-text="formatSize(v.size) + ' · ' + formatMtime(v.mtime)"></small></span>
							<i class="ph" :class="openPath === v.path ? 'ph-check-circle' : 'ph-caret-right'" aria-hidden="true"></i>
						</button>
					</template>
				</div>
				<p class="vault-empty" x-show="!localVaults.length">No other vaults found in this folder.</p>
			</div>
			<button type="button" class="ghost create-vault-link" @click="go('create')"><i class="ph ph-plus-circle" aria-hidden="true"></i>Create a new vault</button>
		</div>
  </section>

  <section class="vault-layout" x-show="screen === 'vault'">
    <aside class="panel sidebar">
			<div class="sidebar-heading">
				<div>
					<span class="eyebrow">Personal vault</span>
					<h2 x-text="meta ? meta.name : 'Vault'"></h2>
				</div>
				<span class="count" x-text="meta ? meta.entryCount : '0'"></span>
			</div>
			<label class="search-box" x-show="humanAccess">
				<i class="ph ph-magnifying-glass" aria-hidden="true"></i>
				<input type="search" x-model="searchQuery" placeholder="Search credentials" aria-label="Search credentials" />
			</label>
			<div class="sidebar-actions" x-show="humanAccess">
				<button type="button" class="primary" :disabled="!humanAccess" @click="newEntry()"><i class="ph ph-plus" aria-hidden="true"></i>New credential</button>
				<button type="button" class="icon-button" :disabled="busy || !humanAccess" @click="doSave()" title="Save vault" aria-label="Save vault"><i class="ph ph-floppy-disk" aria-hidden="true"></i></button>
			</div>
			<div class="entry-list" x-show="humanAccess">
				<template x-for="entry in filteredEntries" :key="entry.id">
          <button type="button" class="entry-item"
                  :class="selectedId === entry.id ? 'active' : ''"
                  @click="selectEntry(entry.id)">
						<span class="entry-icon"><i class="ph ph-key" aria-hidden="true"></i></span>
						<span class="entry-copy">
							<span class="t" x-text="entry.title || 'Untitled'"></span>
							<span class="u" x-text="entry.username || entry.url || 'No username'"></span>
						</span>
						<i class="ph ph-caret-right entry-caret" aria-hidden="true"></i>
          </button>
        </template>
				<div class="empty" x-show="!filteredEntries.length">
					<svg class="empty-illustration" viewBox="0 0 180 120" aria-hidden="true">
            <path d="M29 83c15-36 45-54 82-42 21 7 31 22 42 45" />
            <rect x="59" y="34" width="65" height="62" rx="18" />
            <path d="M75 34V24c0-18 32-18 32 0v10" />
            <circle cx="92" cy="64" r="7" />
            <path d="M88 70h8l4 14H84l4-14Z" />
            <circle cx="35" cy="34" r="4" /><circle cx="145" cy="28" r="5" />
          </svg>
					<strong x-text="searchQuery ? 'No matching credentials' : 'A fresh start'"></strong>
					<span x-text="searchQuery ? 'Try a shorter name or username.' : 'Add your first credential when you are ready.'"></span>
				</div>
      </div>
    </aside>

	<main class="panel editor" x-show="humanAccess">
			<div class="editor-heading">
				<div>
					<span class="eyebrow">Credential</span>
					<h2 x-text="form.id ? (form.title || 'Untitled') : 'New credential'"></h2>
				</div>
			</div>
			<div class="form-grid">
				<label>Title
					<input type="text" x-model="form.title" />
				</label>
				<label>Username
					<input type="text" x-model="form.username" autocomplete="username" />
				</label>
			</div>
			<label>Password
        <div class="row">
          <input style="flex:1" :type="showPassword ? 'text' : 'password'" x-model="form.password" autocomplete="new-password" />
		  <button type="button" class="icon-button" @click="showPassword = !showPassword" title="Show or hide password" aria-label="Show or hide password"><i class="ph" :class="showPassword ? 'ph-eye-slash' : 'ph-eye'" aria-hidden="true"></i></button>
					<button type="button" class="icon-button" @click="copyPassword()" title="Copy password" aria-label="Copy password"><i class="ph ph-copy" aria-hidden="true"></i></button>
					<button type="button" class="icon-button" @click="generatePassword()" title="Generate password" aria-label="Generate password"><i class="ph ph-magic-wand" aria-hidden="true"></i></button>
        </div>
      </label>
      <label>URL
        <input type="url" x-model="form.url" placeholder="https://" />
      </label>
      <label>Notes
        <textarea x-model="form.notes"></textarea>
      </label>
			<section class="custom-fields" x-show="form.customFields.length">
				<div class="custom-fields-heading">
					<div><span class="eyebrow">Additional data</span><h3>Custom fields</h3></div>
					<span class="count" x-text="form.customFields.length"></span>
				</div>
				<div class="custom-field-list">
					<div class="custom-field" x-for="field in form.customFields" :key="field.name">
						<div class="custom-field-label">
							<span class="mono" x-text="field.name"></span>
							<span class="field-kind" :class="field.protected !== false ? 'secret' : 'metadata'" x-text="field.protected !== false ? 'Secret' : 'Metadata'"></span>
						</div>
						<div class="custom-secret-row" x-if="field.protected !== false">
							<input :type="isCustomFieldRevealed(field.name) ? 'text' : 'password'" x-model="field.value" autocomplete="off" :aria-label="field.name" />
							<button type="button" class="icon-button" @click="toggleCustomField(field.name)" :title="isCustomFieldRevealed(field.name) ? 'Hide ' + field.name : 'Reveal ' + field.name" :aria-label="isCustomFieldRevealed(field.name) ? 'Hide ' + field.name : 'Reveal ' + field.name"><i class="ph" :class="isCustomFieldRevealed(field.name) ? 'ph-eye-slash' : 'ph-eye'" aria-hidden="true"></i></button>
							<button type="button" class="icon-button" @click="copyCustomField(field)" :title="'Copy ' + field.name" :aria-label="'Copy ' + field.name"><i class="ph ph-copy" aria-hidden="true"></i></button>
							<button type="button" class="icon-button" @click="generateCustomField(field)" :title="'Generate ' + field.name" :aria-label="'Generate ' + field.name"><i class="ph ph-magic-wand" aria-hidden="true"></i></button>
						</div>
						<input x-if="field.protected === false" type="text" x-model="field.value" :aria-label="field.name" />
					</div>
				</div>
			</section>
      <div class="row">
		<button type="button" class="primary" :disabled="busy" @click="saveEntry()"><i class="ph ph-floppy-disk" aria-hidden="true"></i>Save entry</button>
		<button type="button" class="danger" :disabled="busy || !form.id" @click="deleteEntry()"><i class="ph ph-trash" aria-hidden="true"></i>Delete</button>
      </div>
    </main>
		<main class="panel editor" x-show="!humanAccess">
			<div class="access-empty">
					<svg class="access-illustration" viewBox="0 0 320 210" aria-hidden="true">
						<path class="cloud-line" d="M35 160c21-56 70-90 128-88 58 2 101 35 122 88" />
						<circle cx="74" cy="59" r="8" /><circle cx="253" cy="72" r="6" />
						<path class="person-head" d="M160 57a32 32 0 1 1 0 64 32 32 0 0 1 0-64Z" />
						<path class="person-body" d="M94 183c6-37 31-59 66-59s60 22 66 59" />
						<path class="heart" d="M160 157c-18-12-25-21-25-31 0-14 18-20 25-7 7-13 25-7 25 7 0 10-7 19-25 31Z" />
					</svg>
					<span class="eyebrow">Private by default</span>
					<h2>Human access is off</h2>
					<p>Your credentials are resting quietly. Turn on access when you are ready to work with them.</p>
					<button type="button" class="primary" @click="setHumanAccess(true)"><i class="ph ph-user-check" aria-hidden="true"></i>Enable human access</button>
				</div>
		</main>
  </section>
</div>
`,
	}));

		console.log("[passman] m.js view mounted", { rpc: Boolean(api) });
	} catch (e) {
		showBootError(e);
	}
}

const browserMode = location.protocol === "http:" || location.protocol === "https:";
if (browserMode) {
	window.__M_BOOT__ = boot;
	if (!window.__PASSMAN_HMR_BOOTED__) {
		window.__PASSMAN_HMR_BOOTED__ = true;
		boot();
	}
} else {
	boot();
}

if (!window.__PASSMAN_ERROR_HANDLERS__) {
	window.__PASSMAN_ERROR_HANDLERS__ = true;
	window.addEventListener("error", (ev) => {
		showBootError(ev.error || ev.message);
	});
	window.addEventListener("unhandledrejection", (ev) => {
		showBootError(ev.reason);
	});
}
