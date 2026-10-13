// Run with: node --import tsx tests/browser/effects-server.mts
// Open http://127.0.0.1:4319 to run mocked browser regressions automatically.
import { createServer } from "node:http";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
const bundle = await build({
  entryPoints: ["tests/browser/effects-client.tsx"],
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  alias: {
    "next/navigation": `${process.cwd()}/tests/browser/navigation.ts`,
    "next/link": `${process.cwd()}/tests/browser/link.tsx`,
  },
  plugins: [
    {
      name: "fixture-render-counts",
      setup(builder) {
        const targets: Record<string, [string, string]> = {
          "svg-canvas.tsx": ["SvgCanvas", "  const [view, setView]"],
          "chat-panel.tsx": ["ChatPanel", "  const history ="],
          "collection-manager.tsx": [
            "CollectionManager",
            "  const [collections, setCollections]",
          ],
        };
        builder.onLoad(
          {
            filter:
              /components\/(workspace|collections)\/(svg-canvas|chat-panel|collection-manager)\.tsx$/,
          },
          async ({ path }) => {
            const [name, marker] = targets[path.split("/").at(-1)!];
            const source = await readFile(path, "utf8");
            if (!source.includes(marker))
              throw new Error(`Missing render marker: ${name}`);
            return {
              contents:
                `import { recordRender } from ${JSON.stringify(`${process.cwd()}/tests/browser/render-counts.ts`)};\n` +
                source.replace(marker, `  recordRender("${name}");\n${marker}`),
              loader: "tsx",
            };
          },
        );
      },
    },
  ],
  define: { "process.env.NODE_ENV": '"development"' },
});
createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/client.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(bundle.outputFiles[0].contents);
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><title>Running effect regressions</title><h1>Effect refactor browser regressions</h1><ul id="results"></ul><div id="fixture"></div><script src="/client.js"></script>',
    );
  }
}).listen(4319, "127.0.0.1", () =>
  console.log("Browser regressions: http://127.0.0.1:4319"),
);
