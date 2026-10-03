/**
 * A tiny static server for the fixture site, so tests scan a site whose
 * problems are known and never change.
 *
 *   node test/fixture-server.ts [port]     serve until stopped
 */
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixture");
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".txt": "text/plain", ".png": "image/png" };

export function startFixture(port = 0): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    const file = join(ROOT, path === "/" ? "index.html" : path);
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>Not found</title><h1>Not found</h1>");
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolve({ server, base: `http://127.0.0.1:${actual}` });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { base } = await startFixture(Number(process.argv[2] ?? 4173));
  process.stderr.write(`fixture at ${base}\n`);
}
