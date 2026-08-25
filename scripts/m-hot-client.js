/**
 * Browser-only HMR client following the official m-js v3 hot-client protocol.
 * Source contract: https://github.com/mikesmullin/m-js/blob/v3/src/hot-client.js
 */
const protocol = location.protocol === "https:" ? "wss" : "ws";
const socketUrl = `${protocol}://${location.host}/__m_hmr`;

function reloadCss(href) {
	const clean = href.split("?")[0];
	const links = document.querySelectorAll('link[rel="stylesheet"]');
	let found = false;
	for (const link of links) {
		const url = new URL(link.href, location.href);
		if (
			url.pathname === clean ||
			url.pathname.endsWith(clean) ||
			clean.endsWith(url.pathname)
		) {
			const next = link.cloneNode();
			next.href = `${url.pathname}?t=${Date.now()}`;
			next.onload = () => link.remove();
			link.parentNode.insertBefore(next, link.nextSibling);
			found = true;
		}
	}
	if (!found) {
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = `${clean}?t=${Date.now()}`;
		document.head.appendChild(link);
	}
}

async function reloadJs(path) {
	const cacheBust = Date.now();
	if (path && (path.startsWith("/") || path.startsWith("./"))) {
		const url = path.startsWith("/") ? path : `/${path}`;
		try {
			await import(`${url}?t=${cacheBust}`);
		} catch {
			// The boot hook retries the complete entry bundle below.
		}
	}
	if (typeof window.__M_BOOT__ === "function") {
		try {
			await window.__M_BOOT__(cacheBust);
			return;
		} catch (error) {
			console.error("[m.hmr] boot failed, reloading", error);
			location.reload();
			return;
		}
	}
	const entry = document.querySelector("script[data-hmr-entry]");
	const source = entry?.getAttribute("src") || "/index.js";
	try {
		await import(`${source.split("?")[0]}?t=${cacheBust}`);
	} catch (error) {
		console.error("[m.hmr] import failed, reloading", error);
		location.reload();
	}
}

function connect() {
	let socket;
	try {
		socket = new WebSocket(socketUrl);
	} catch (error) {
		console.warn("[m.hmr] websocket unavailable", error);
		return;
	}
	socket.addEventListener("open", () => {
		document.documentElement.dataset.hmr = "connected";
	});
	socket.addEventListener("message", async (event) => {
		let message;
		try {
			message = JSON.parse(event.data);
		} catch {
			return;
		}
		if (message.type !== "change") return;
		const path = message.path || "";
		document.documentElement.dataset.hmr = "updating";
		document.documentElement.dataset.hmrFile = path;
		try {
			if (/\.css$/i.test(path)) {
				reloadCss(path.startsWith("/") ? path : `/${path}`);
			} else if (/\.(js|mjs|ts)$/i.test(path)) {
				await reloadJs(path);
			} else if (/\.html$/i.test(path)) {
				location.reload();
				return;
			}
		} finally {
			document.documentElement.dataset.hmr = "connected";
			window.dispatchEvent(new CustomEvent("m:hmr", { detail: { path } }));
		}
	});
	socket.addEventListener("close", () => {
		document.documentElement.dataset.hmr = "disconnected";
		setTimeout(connect, 1000);
	});
	socket.addEventListener("error", () => socket.close());
}

if (!window.__M_HMR_STARTED__) {
	window.__M_HMR_STARTED__ = true;
	connect();
}