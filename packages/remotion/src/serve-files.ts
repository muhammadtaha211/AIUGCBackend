import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

/**
 * Remotion only accepts http(s) sources (its asset downloader rejects anything
 * else), but every path in the render contract is a local file the handler
 * already downloaded. So serve exactly those files on loopback for the
 * lifetime of one render — no files outside the list are reachable.
 * Range requests are supported because the browser's video element asks for
 * them when probing metadata.
 */

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

export interface ServedFiles {
  /** One URL per input file, same order. */
  urls: string[];
  close: () => Promise<void>;
}

export async function serveLocalFiles(files: string[]): Promise<ServedFiles> {
  const server = createServer((req, res) => {
    const index = Number(path.parse(decodeURIComponent(req.url ?? "")).name);
    const file = files[index];
    if (!file) {
      res.writeHead(404).end();
      return;
    }

    const size = statSync(file).size;
    const headers: Record<string, string> = {
      "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "accept-ranges": "bytes",
      "access-control-allow-origin": "*",
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, headers).end();
      return;
    }
    if (req.method === "HEAD") {
      res.writeHead(200, { ...headers, "content-length": String(size) }).end();
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (!match) {
      res.writeHead(200, { ...headers, "content-length": String(size) });
      createReadStream(file).pipe(res);
      return;
    }

    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start >= size || end < start) {
      res.writeHead(416, { ...headers, "content-range": `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, {
      ...headers,
      "content-range": `bytes ${start}-${end}/${size}`,
      "content-length": String(end - start + 1),
    });
    createReadStream(file, { start, end }).pipe(res);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    urls: files.map((file, i) => `http://127.0.0.1:${port}/${i}${path.extname(file)}`),
    close: () =>
      new Promise<void>((resolve) => {
        // Chrome keeps sockets alive; without this close() never fires.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
