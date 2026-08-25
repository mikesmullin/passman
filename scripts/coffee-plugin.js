/**
 * Bun loader for CoffeeScript (runtime + Bun.build).
 * Used via bunfig.toml preload and electrobun.config.ts plugins.
 *
 * Import the standalone compiler by relative path. Electrobun's CLI is a
 * bundled Bun that cannot resolve bare `coffeescript` from node_modules.
 */
import { plugin } from "bun";
import { compile } from "../node_modules/coffeescript/lib/coffeescript-browser-compiler-modern/coffeescript.js";

export const coffeePlugin = {
	name: "coffeescript",
	setup(build) {
		build.onLoad({ filter: /\.coffee$/ }, async (args) => {
			const source = await Bun.file(args.path).text();
			const contents = compile(source, {
				bare: true,
				header: false,
				filename: args.path,
				inlineMap: true,
			});
			return { contents, loader: "js" };
		});
	},
};

plugin(coffeePlugin);
