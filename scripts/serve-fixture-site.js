#!/usr/bin/env node
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const root = process.env.FIXTURE_ROOT
  ? resolve(process.env.FIXTURE_ROOT)
  : resolve(__dirname, '..', 'test', 'fixtures', 'vrt-project', 'site');
const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;

const port = Number(process.env.PORT || 4173);

if (!existsSync(root)) {
  console.error(`Fixture root not found: ${root}`);
  process.exit(1);
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
};

function resolveFilePath(urlPath) {
  let pathPart = urlPath.split('?')[0].split('#')[0];
  if (!pathPart || pathPart === '/') {
    pathPart = '/index.html';
  }

  if (pathPart.endsWith('/')) {
    pathPart += 'index.html';
  }

  if (!extname(pathPart)) {
    pathPart += '.html';
  }

  const normalized = normalize(pathPart);
  const relative = normalized.startsWith('/') ? normalized.slice(1) : normalized;
  const filePath = resolve(root, relative);

  if (!filePath.startsWith(rootPrefix)) {
    return null;
  }

  return filePath;
}

const server = http.createServer((req, res) => {
  const filePath = resolveFilePath(req.url || '/');
  if (!filePath) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  if (!stats.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = extname(filePath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`Fixture site running on http://localhost:${port}`);
  console.log(`Serving: ${root}`);
});
