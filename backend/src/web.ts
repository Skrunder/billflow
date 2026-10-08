import fs from 'node:fs';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';

/**
 * Serves the built web app (frontend/dist) from the API process, so the whole
 * app ships as one container. Mirrors what the nginx container used to do:
 * caching per file type, precompressed .gz files, SPA fallback to index.html,
 * the web security headers and /healthz.
 */

interface WebFile {
  file: string;
  gzip: boolean;
}

/** Every servable file, keyed by URL path. Read once: the build never changes at runtime. */
function listFiles(root: string): Map<string, WebFile> {
  const files = new Map<string, WebFile>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && !entry.name.endsWith('.gz') && !entry.name.startsWith('.')) {
        const url = '/' + path.relative(root, full).split(path.sep).join('/');
        files.set(url, { file: full, gzip: fs.existsSync(`${full}.gz`) });
      }
    }
  };
  walk(root);
  return files;
}

function cacheControl(url: string): string {
  if (url === '/sw.js') return 'no-cache, no-store, must-revalidate';
  // Vite fingerprints everything under /assets/, so a changed file gets a new name.
  if (url.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}

const TYPES: Record<string, string> = { '.webmanifest': 'application/manifest+json' };

export function webApp(root: string, options: { hsts: boolean }): Router {
  const files = listFiles(path.resolve(root));
  const index = files.get('/index.html');
  if (!index) throw new Error(`WEB_DIR ${root} has no index.html (is the web app built?)`);

  const router = Router();
  router.get('/healthz', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('text/plain').send('ok\n');
  });

  const securityHeaders = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: options.hsts ? undefined : false,
  });

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let url: string;
    try {
      url = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    if (url === '/api' || url.startsWith('/api/')) return next();

    let entry = files.get(url) ?? files.get(url.endsWith('/') ? `${url}index.html` : `${url}/index.html`);
    if (!entry) {
      // A missing file is a 404; anything else is a page of the single-page app.
      if (url.startsWith('/assets/') || path.posix.extname(url)) return next();
      entry = index;
      url = '/index.html';
    }
    const { file, gzip } = entry;
    securityHeaders(req, res, () => {
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
      res.setHeader('Cache-Control', cacheControl(url));
      if (url === '/sw.js') res.setHeader('Service-Worker-Allowed', '/');
      res.type(TYPES[path.extname(file)] ?? path.extname(file));
      const compressed = gzip && req.acceptsEncodings('gzip', 'identity') === 'gzip';
      if (gzip) res.vary('Accept-Encoding');
      if (compressed) res.setHeader('Content-Encoding', 'gzip');
      res.sendFile(compressed ? `${file}.gz` : file, { cacheControl: false, dotfiles: 'deny' }, (err) => {
        if (err && !res.headersSent) next(err);
      });
    });
  });
  return router;
}
