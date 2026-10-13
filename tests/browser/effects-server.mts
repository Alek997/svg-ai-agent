// Run with: node --import tsx tests/browser/effects-server.mts
// Open http://127.0.0.1:4319 to run mocked browser regressions automatically.
import { createServer } from "node:http";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["tests/browser/effects-client.tsx"],
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  alias: { "next/navigation": `${process.cwd()}/tests/browser/navigation.ts` },
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
