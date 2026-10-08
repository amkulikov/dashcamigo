import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build, normalizePath, type Plugin } from "vite";

/** Keep recovery assets independent of the viewer, including its shared chunks. */
export function migrationPagePlugin(): Plugin {
    let root: string;
    return {
        name: "dashcamigo-migration-page",
        configResolved(config) {
            root = config.root;
        },
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const path = (req.url ?? "").split("?")[0];
                if (path !== "/migrate/" && path !== "/migrate/index.html") return next();
                // The viewer's HTML transforms expect its own bootstrap and
                // locale island. Recovery has neither and uses Vite's TS server.
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(readFileSync(resolve(root, "migrate/index.html"), "utf8"));
            });
        },
        async generateBundle() {
            const result = await build({
                configFile: false,
                envFile: false,
                root: resolve(root, "migrate"),
                base: "./",
                publicDir: false,
                logLevel: "warn",
                build: {
                    write: false,
                    target: "es2022",
                    modulePreload: { polyfill: false },
                },
                plugins: [{
                    name: "migration-runtime-boundary",
                    generateBundle(_options, bundle) {
                        for (const item of Object.values(bundle)) {
                            if (item.type !== "chunk") continue;
                            for (const [id, module] of Object.entries(item.modules)) {
                                if (module.renderedLength === 0) continue;
                                const path = normalizePath(id);
                                if (/\/src\/(?:app\.ts|ui\/|sentry|analytics)|\/node_modules\/@sentry\//.test(path)) {
                                    this.error(`migration page imports a hosted application module: ${path}`);
                                }
                            }
                        }
                    },
                }],
            });
            if (!("output" in result)) throw new Error("migration build did not produce one output");
            for (const item of result.output) {
                this.emitFile({
                    type: "asset",
                    fileName: `migrate/${item.fileName}`,
                    source: item.type === "chunk" ? item.code : item.source,
                });
            }
        },
    };
}
