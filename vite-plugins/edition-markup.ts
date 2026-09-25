import type { Plugin } from "vite";

export function editionMarkupPlugin(): Plugin {
    return {
        name: "dashcamigo-edition-markup",
        transformIndexHtml: {
            order: "pre",
            handler: (html) =>
                html
                    .replace(/<!-- portable-only:start -->[\s\S]*?<!-- portable-only:end -->/g, "")
                    .replace(/<!-- web-only:(?:start|end) -->/g, ""),
        },
    };
}
