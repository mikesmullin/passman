import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "path";
import { watch } from "chokidar";
import {
	configuredVaultPath,
	rememberVaultPath,
} from "../src/shared/config.mjs";
import * as vault from "../src/shared/vault.coffee";
import {
	defaultVaultStoredPath,
	resolveVaultPath,
	storeVaultPath,
} from "../src/shared/paths.coffee";

const projectRoot = resolve(import.meta.dir, "..");
const publicRoot = join(projectRoot, "public");
const phosphorRoot = join(
	projectRoot,
	"node_modules/@phosphor-icons/web/src/regular",
);
const manropeRoot = join(projectRoot, "node_modules/@fontsource/manrope");
const vaultRoot = resolve(process.env.PASSMAN_CWD || process.cwd());
let openVault = null;
let humanAccess = false;
const sockets = new Set();

function option(name, fallback) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : fallback;
}

const hostname = option("--host", process.env.PASSMAN_WEB_HOST || "127.0.0.1");
const port = Number(option("--port", process.env.PASSMAN_WEB_PORT || "4545"));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	throw new Error(`Invalid web port: ${port}`);
}

function storedPath(absolutePath) {
	const localPath = relative(vaultRoot, absolutePath);
	return localPath && !localPath.startsWith("..") && !isAbsolute(localPath)
		? localPath
		: absolutePath;
}

function listLocalVaults(selectedPath) {
	const directory = selectedPath
		? dirname(isAbsolute(selectedPath) ? selectedPath : resolve(vaultRoot, selectedPath))
		: vaultRoot;
	const vaults = [];
	for (const name of readdirSync(directory)) {
		if (!name.toLowerCase().endsWith(".kdbx")) continue;
		const absolutePath = join(directory, name);
		try {
			const stats = statSync(absolutePath);
			if (!stats.isFile()) continue;
			const head = readFileSync(absolutePath).subarray(0, 4);
			if (
				head.length < 4 ||
				head[0] !== 0x03 ||
				head[1] !== 0xd9 ||
				head[2] !== 0xa2 ||
				head[3] !== 0x9a
			) {
				continue;
			}
			vaults.push({
				path: storedPath(absolutePath),
				absolutePath,
				name,
				size: stats.size,
				mtime: stats.mtime.toISOString(),
			});
		} catch {
			// Skip files that disappear or become unreadable during discovery.
		}
	}
	return vaults.sort((left, right) => right.mtime.localeCompare(left.mtime));
}

function readVault(absolutePath) {
	const data = readFileSync(absolutePath);
	return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function vaultMeta() {
	return openVault
		? vault.metaOf(openVault, resolveVaultPath(openVault.path))
		: null;
}

async function persistOpenVault() {
	if (!openVault) throw new Error("No vault is open");
	if (!openVault.path) {
		openVault.path = defaultVaultStoredPath(
			openVault.db.meta.name || "passman",
		);
	}
	openVault.path = storeVaultPath(openVault.path);
	const absolutePath = resolveVaultPath(openVault.path);
	mkdirSync(dirname(absolutePath), { recursive: true });
	writeFileSync(absolutePath, Buffer.from(await vault.saveVaultBytes(openVault)));
	return openVault.path;
}

function json(value, status = 200) {
	return Response.json(value, {
		status,
		headers: { "cache-control": "no-store" },
	});
}

async function handleApi(request, method) {
	if (request.method !== "POST") {
		return json({ error: "Method not allowed" }, 405);
	}
	let params = {};
	try {
		params = await request.json();
	} catch {
		// Requests without parameters use an empty object.
	}
	if (method === "hello") {
		return json({
			ok: true,
			message: vaultRoot,
			cwd: vaultRoot,
			preferredVault: configuredVaultPath(),
		});
	}
	if (method === "listLocalVaults") {
		const directory = params.path
			? dirname(
					isAbsolute(params.path)
						? params.path
						: resolve(vaultRoot, params.path),
				)
			: vaultRoot;
		return json({ cwd: directory, vaults: listLocalVaults(params.path) });
	}
	try {
		if (method === "openVault") {
			const stored = storeVaultPath(params.path || "");
			const absolutePath = resolveVaultPath(stored);
			if (!existsSync(absolutePath)) {
				return json({ ok: false, error: `File not found: ${stored}` });
			}
			const data = readVault(absolutePath);
			if (!vault.isKdbxMagic(data)) {
				return json({ ok: false, error: "Not a KeePass .kdbx file" });
			}
			openVault = await vault.loadVault(data, params.password, stored);
			humanAccess = false;
			rememberVaultPath(absolutePath);
			return json({ ok: true, meta: vaultMeta(), entries: [] });
		}
		if (method === "createVault") {
			const stored = storeVaultPath(params.path || "");
			const absolutePath = resolveVaultPath(stored);
			if (existsSync(absolutePath)) {
				return json({ ok: false, error: `File already exists: ${stored}` });
			}
			openVault = await vault.createVault(
				params.name || "Passman Vault",
				params.password,
				stored,
			);
			humanAccess = false;
			await persistOpenVault();
			rememberVaultPath(absolutePath);
			return json({ ok: true, meta: vaultMeta() });
		}
		if (method === "saveVault") {
			if (!openVault) return json({ ok: false, error: "No vault is open" });
			if (params.path) openVault.path = storeVaultPath(params.path);
			await persistOpenVault();
			return json({ ok: true, meta: vaultMeta() });
		}
		if (method === "closeVault") {
			const savedPath = openVault?.dirty
				? await persistOpenVault()
				: openVault?.path || null;
			openVault = null;
			humanAccess = false;
			return json({ ok: true, savedPath, discardedUnsaved: false });
		}
		if (method === "getMeta") {
			return json({
				meta: vaultMeta(),
				humanAccess,
				agent: { agentAccess: false },
			});
		}
		if (method === "setHumanAccess") {
			if (!openVault) return json({ ok: false, error: "No vault is open" });
			humanAccess = Boolean(params.enabled);
			return json({
				ok: true,
				humanAccess,
				entries: humanAccess ? vault.listEntries(openVault.db) : [],
			});
		}
		if (method === "upsertEntry") {
			if (!openVault || !humanAccess) {
				return json({ ok: false, error: "Human access is disabled" });
			}
			const entry = vault.upsertEntry(openVault, params);
			return json({
				ok: true,
				entry,
				entries: vault.listEntries(openVault.db),
			});
		}
		if (method === "deleteEntry") {
			if (!openVault || !humanAccess) {
				return json({ ok: false, error: "Human access is disabled" });
			}
			if (!vault.deleteEntry(openVault, params.id)) {
				return json({ ok: false, error: "Entry not found" });
			}
			return json({ ok: true, entries: vault.listEntries(openVault.db) });
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const invalidKey = error?.code === "InvalidKey" || /invalid\s*key/i.test(message);
		return json({
			ok: false,
			error: invalidKey ? "Wrong master password" : message,
		});
	}
	return json(
		{
			ok: false,
			error: `${method} is only available in the Electrobun app`,
		},
		501,
	);
}

const mimeTypes = {
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".svg": "image/svg+xml",
	".ttf": "font/ttf",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

function serveFile(path) {
	return new Response(Bun.file(path), {
		headers: {
			"content-type": mimeTypes[extname(path)] || "application/octet-stream",
			"cache-control": "no-store",
		},
	});
}

async function browserBundle() {
	const result = await Bun.build({
		entrypoints: [join(publicRoot, "index.js")],
		target: "browser",
		format: "esm",
		plugins: [
			{
				name: "external-m-js-runtime",
				setup(build) {
					build.onResolve({ filter: /^\.\/m\.min\.js$/ }, () => ({
						path: "/m.min.js",
						external: true,
					}));
				},
			},
		],
		sourcemap: "inline",
		minify: false,
	});
	if (!result.success) {
		const details = result.logs.map(String).join("\n");
		return new Response(details, { status: 500 });
	}
	return new Response(result.outputs[0], {
		headers: {
			"content-type": "text/javascript; charset=utf-8",
			"cache-control": "no-store",
		},
	});
}

const server = Bun.serve({
	hostname,
	port,
	websocket: {
		open(socket) {
			sockets.add(socket);
			socket.send(JSON.stringify({ type: "connected" }));
		},
		close(socket) {
			sockets.delete(socket);
		},
		message() {},
	},
	async fetch(request) {
		const { pathname } = new URL(request.url);
		if (pathname === "/__m_hmr") {
			return server.upgrade(request)
				? undefined
				: new Response("WebSocket upgrade required", { status: 426 });
		}
		if (pathname.startsWith("/api/")) {
			return handleApi(request, pathname.slice(5));
		}
		if (pathname === "/" || pathname === "/index.html") {
			const html = readFileSync(join(publicRoot, "index.html"), "utf8")
				.replaceAll("views://public/", "/")
				.replace(
					'<script src="index.js"',
					'<script type="module" data-hmr-entry src="/index.js"',
				)
				.replace(
					"</head>",
					'<link rel="icon" href="/app-icon.svg" type="image/svg+xml" /><script type="module" src="/m-hot-client.js"></script></head>',
				);
			return new Response(html, {
				headers: {
					"content-type": "text/html; charset=utf-8",
					"cache-control": "no-store",
				},
			});
		}
		if (pathname === "/index.js") return browserBundle();
		if (pathname === "/m.min.js") {
			return serveFile(join(publicRoot, "m.min.js"));
		}
		if (pathname === "/m-hot-client.js") {
			return serveFile(join(projectRoot, "scripts/m-hot-client.js"));
		}
		if (pathname === "/index.css") {
			return serveFile(join(publicRoot, "index.css"));
		}
		if (pathname === "/app-icon.svg") {
			return serveFile(join(projectRoot, "assets/app-icon.svg"));
		}
		if (pathname.startsWith("/phosphor/")) {
			const asset = resolve(phosphorRoot, pathname.slice("/phosphor/".length));
			if (asset.startsWith(`${phosphorRoot}/`)) return serveFile(asset);
		}
		if (pathname.startsWith("/manrope/")) {
			const asset = resolve(manropeRoot, pathname.slice("/manrope/".length));
			if (asset.startsWith(`${manropeRoot}/`)) return serveFile(asset);
		}
		return new Response("Not found", { status: 404 });
	},
});

const watcher = watch(publicRoot, { ignoreInitial: true });
watcher.on("all", (event, file) => {
	if (event !== "add" && event !== "change" && event !== "unlink") return;
	const changedPath = `/${relative(publicRoot, file).split("\\").join("/")}`;
	const message = JSON.stringify({ type: "change", path: changedPath });
	for (const socket of sockets) socket.send(message);
});

console.log(`Passman web UI: ${server.url}`);
console.log(`Working directory: ${vaultRoot}`);