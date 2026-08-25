import { coffeePlugin } from "./scripts/coffee-plugin.js";

// Electrobun only loads electrobun.config.ts (hardcoded). This file is
// untyped JS in a .ts shell so the bundler can take .coffee entrypoints.
export default {
	app: {
		name: "Passman",
		identifier: "dev.passman.app",
		version: "0.1.0",
	},
	build: {
		mainProcess: "cottontail",
		cottontail: {
			entrypoint: "src/bun/index.coffee",
			plugins: [coffeePlugin],
		},
		bun: {
			entrypoint: "src/bun/index.coffee",
			plugins: [coffeePlugin],
		},
		views: {
			public: {
				entrypoint: "public/index.js",
				// Wrap the bundle so m.min.js's internal `function M` (expression
				// eval) is not a global. Classic scripts + `window.M = api` would
				// otherwise overwrite it: "M is not a function".
				format: "iife",
			},
		},
		copy: {
			"public/index.html": "views/public/index.html",
			"public/index.css": "views/public/index.css",
			"assets/app-icon.svg": "views/public/app-icon.svg",
			"node_modules/@phosphor-icons/web/src/regular": "views/public/phosphor",
			"node_modules/@fontsource/manrope": "views/public/manrope",
		},
		mac: {
			bundleCEF: false,
			icons: "assets/app-icon.iconset",
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
};
