import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Mirrors the `Content-Security-Policy` header in firebase.json and
 * vercel.json. `style-src` needs 'unsafe-inline' because the production
 * build inlines the entry stylesheet (see inlineEntryStylesheet below)
 * and React sets a couple of inline style properties
 * (src/components/home/Hero.jsx); everything else is locked to this
 * origin plus the two services the app actually talks to — Firebase and
 * Cloudinary.
 *
 * This is the policy production really sends. `npm run preview` serves
 * the real build and gets it verbatim, so anything it would block in
 * production is blocked here too.
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: https://res.cloudinary.com https://picsum.photos",
  "connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseinstallations.googleapis.com https://api.cloudinary.com",
].join('; ');

/**
 * The dev server needs one directive relaxed, and it is not optional.
 *
 * `@vitejs/plugin-react` injects an inline <script type="module">
 * preamble into the page during development to install React Refresh.
 * `script-src 'self'` blocks it, React never bootstraps, and `npm run
 * dev` serves the static shell from index.html with no stylesheet and
 * no app — a blank-looking page and a CSP error in the console, with
 * nothing to suggest the config is the cause.
 *
 * That happened: the policy above was added to both servers at once and
 * broke `npm run dev` outright. Dev therefore gets 'unsafe-inline' for
 * scripts only.
 *
 * What that costs is small and worth naming: a stray inline <script> in
 * application code would not be caught here. It would still be caught
 * by `npm run preview`, which runs the strict policy against the real
 * build. Every other directive — connect-src, img-src, font-src — is
 * identical in both, so the change this is really guarding against
 * (someone adding a third-party origin) still fails fast in dev.
 */
const DEV_CSP = PRODUCTION_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");

/**
 * Removes the static app shell when running `npm run dev`.
 *
 * The shell exists so the production page has something to paint before
 * React mounts, and that only works because the production build inlines
 * the stylesheet into the same HTML document (see inlineEntryStylesheet
 * below) — markup and styles arrive together, in one response.
 *
 * The dev server does neither. Vite serves CSS by having JavaScript
 * inject it at runtime, so there is no stylesheet in the document at
 * all until main.jsx has run. The shell therefore painted completely
 * unstyled on every refresh — raw Times New Roman and a full-width
 * logo — and only snapped into place once React mounted. In production
 * that flash cannot happen; in development it happened every time,
 * which is both unpleasant to work against and actively misleading,
 * because it looks exactly like the app having failed to load.
 *
 * Stripping it in dev costs nothing: its whole purpose is the first
 * paint of a cold production visit, which the dev server does not
 * simulate anyway. `npm run preview` serves the real build, shell
 * included, and is where that behaviour should be checked.
 */
function devStripsAppShell() {
  const SHELL = /[ \t]*<!-- app-shell:start -->[\s\S]*?<!-- app-shell:end -->\n?/;

  return {
    name: 'dev-strips-app-shell',
    apply: 'serve',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace(SHELL, '');
      },
    },
  };
}

/**
 * Fails the build if index.html's static app shell no longer matches the
 * real Hero component (NEW-23).
 *
 * index.html carries a plain-HTML copy of the hero so the page paints
 * before React mounts — see the comment above #root there. Duplicated
 * copy drifts: someone edits the headline in Hero.jsx, the shell keeps
 * the old wording, and every visitor sees the old headline flash before
 * the new one replaces it. Nothing would catch that at runtime, so it is
 * caught here instead, at the one moment both files are read together.
 */
function assertHeroShellMatches() {
  const normalize = (text) =>
    text
      .replace(/&mdash;|&#8212;/g, '—')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const checks = [
    {
      label: 'headline',
      inJsx: /<h1 className="hero__headline">([\s\S]*?)<\/h1>/,
      inHtml: /<h1 class="hero__headline">([\s\S]*?)<\/h1>/,
    },
    {
      label: 'subtext',
      inJsx: /<p className="hero__subtext">([\s\S]*?)<\/p>/,
      inHtml: /<p class="hero__subtext">([\s\S]*?)<\/p>/,
    },
  ];

  return {
    name: 'assert-hero-shell-matches',
    apply: 'build',
    buildStart() {
      const jsx = readFileSync('src/components/home/Hero.jsx', 'utf8');
      const html = readFileSync('index.html', 'utf8');

      for (const { label, inJsx, inHtml } of checks) {
        const fromComponent = jsx.match(inJsx);
        const fromShell = html.match(inHtml);

        if (!fromComponent || !fromShell) {
          const missing = fromComponent ? 'index.html' : 'src/components/home/Hero.jsx';
          throw new Error(
            `Hero shell check: could not find the ${label} in ${missing}. ` +
              'If the hero markup was restructured, update this check in vite.config.js.'
          );
        }

        const expected = normalize(fromComponent[1]);
        const actual = normalize(fromShell[1]);
        if (expected !== actual) {
          throw new Error(
            [
              `Hero shell check: the ${label} in index.html no longer matches Hero.jsx.`,
              `  Hero.jsx:   ${expected}`,
              `  index.html: ${actual}`,
              'Update the static shell in index.html so the pre-React paint does',
              'not show stale copy.',
            ].join(String.fromCharCode(10))
          );
        }
      }
    },
  };
}

/**
 * Moves the stylesheet ahead of the JavaScript in the built HTML
 * (NEW-23).
 *
 * Vite emits the entry <script> and its <link rel="modulepreload"> tags
 * before the <link rel="stylesheet">. For an app that renders entirely
 * in JavaScript that ordering is harmless, but index.html now carries a
 * static app shell that can paint on its own — and it can only paint
 * once the stylesheet has arrived. With the original order the browser
 * discovered the CSS after it had already queued ~101 kB of
 * high-priority JavaScript, so the one resource standing between the
 * user and a painted page was waiting behind the resources that were
 * supposed to be non-blocking. First Contentful Paint was still
 * arriving around 2.6s on a throttled connection despite the content
 * being right there in the HTML.
 *
 * Reordering changes nothing about what is downloaded — only the order
 * the browser learns about it, which is enough to let the shell paint
 * while the JavaScript is still on its way.
 */
function stylesheetFirst() {
  const STYLESHEET = /[ \t]*<link[^>]+rel="stylesheet"[^>]*>\n?/g;
  const FIRST_SCRIPT = /[ \t]*<script[^>]+type="module"[^>]*><\/script>\n?/;

  return {
    name: 'stylesheet-first',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      const stylesheets = html.match(STYLESHEET);
      if (!stylesheets) return html;

      const firstScript = html.match(FIRST_SCRIPT);
      if (!firstScript) return html;

      // Drop them from where Vite put them, then re-insert immediately
      // before the entry script so the browser requests them first.
      const withoutStylesheets = html.replace(STYLESHEET, '');
      return withoutStylesheets.replace(
        FIRST_SCRIPT,
        (script) => stylesheets.join('') + script
      );
    },
  };
}

/**
 * Inlines the entry stylesheet into index.html (NEW-23).
 *
 * After the static app shell was added, the stylesheet was the single
 * remaining render-blocking resource on the page: Lighthouse's
 * `render-blocking-resources` audit listed it and nothing else. The
 * content was already in the HTML, so the browser had everything it
 * needed to paint except the rules describing it — and fetching those
 * meant a second round-trip whose bytes had to share a throttled
 * connection with ~103 kB of high-priority JavaScript requested in the
 * same breath.
 *
 * Inlining removes that request entirely: the HTML response now carries
 * everything the first paint needs, so the shell paints as soon as the
 * document arrives instead of one round-trip later.
 *
 * The trade-off is that the CSS is no longer a separately cacheable,
 * content-hashed file, so a repeat visitor re-downloads it with the
 * HTML. That costs about 10 kB gzipped per visit. It is worth it here
 * because this is a single-page app — there is one HTML document for
 * the whole site, so the stylesheet was only ever fetched once per
 * visit anyway, and the hashed .js chunks (which are far larger) keep
 * their own long-lived cache entries.
 *
 * Only the entry stylesheet is inlined. The lazily-loaded admin chunks
 * bring their own CSS, which stays external and on-demand.
 */
function inlineEntryStylesheet() {
  return {
    name: 'inline-entry-stylesheet',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html;

        return html.replace(
          /[ \t]*<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>\n?/g,
          (tag, href) => {
            const assetKey = href.replace(/^\//, '');
            const asset = ctx.bundle[assetKey];
            if (!asset || asset.type !== 'asset') return tag;

            // Leave the emitted .css file in place: a stale HTML page
            // held in someone's cache may still reference it.
            return `  <style>${String(asset.source).trim()}</style>\n`;
          }
        );
      },
    },
  };
}

// Vite configuration.
// Base path is read from an environment variable so the same build can be
// deployed at the domain root or under a sub-path without code changes.

export default defineConfig({
  plugins: [react(), devStripsAppShell(), assertHeroShellMatches(), stylesheetFirst(), inlineEntryStylesheet()],
  base: process.env.VITE_BASE_PATH || '/',
  /**
   * Security audit 2026-09-18 (SEC-01): the Content-Security-Policy that
   * firebase.json and vercel.json send in production is mirrored onto
   * the dev and preview servers, so a change that the policy would block
   * (an inline script, a new third-party origin) fails here rather than
   * silently in production, where nobody is watching the console.
   *
   * Keep this string and the two deploy configs in step — if you add an
   * external service, all three need the new origin.
   */
  server: {
    port: 5173,
    headers: { 'Content-Security-Policy': DEV_CSP },
  },
  preview: {
    // The real build, under the real policy.
    headers: { 'Content-Security-Policy': PRODUCTION_CSP },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    /**
     * Fix (BUG-20): the storefront shipped as a single 824 kB chunk
     * (217 kB gzipped) with a Rollup size warning — the admin routes
     * were already split out, but React, the router and the whole
     * Firebase SDK all landed in one file that every customer had to
     * download before anything rendered.
     *
     * Splitting the big, rarely-changing vendors into their own chunks
     * means a deploy that only touches app code no longer invalidates
     * the vendor bundles in customers' caches, and the browser can fetch
     * them in parallel.
     */
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // Auth is only ever needed by the admin route (see
          // components/admin/AdminRoot.jsx), so it gets its own chunk
          // rather than riding along in the Firestore bundle every
          // customer downloads (NEW-23).
          if (id.includes('@firebase/auth') || id.includes('firebase/auth')) {
            return 'vendor-firebase-auth';
          }
          // re2js and idb have no 'firebase' in their paths but are
          // reachable only from @firebase/firestore — re2js alone is
          // 247 kB of regex engine this app never calls. Naming them
          // here keeps them in the same on-demand chunk as Firestore
          // instead of the catch-all `vendor` chunk, which the entry
          // chunk would then have to load eagerly (NEW-23).
          if (
            id.includes('firebase') ||
            id.includes('@firebase') ||
            id.includes('@grpc') ||
            id.includes('re2js') ||
            id.includes('/idb/')
          ) {
            return 'vendor-firebase';
          }
          if (id.includes('react-router')) return 'vendor-router';
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('scheduler')) {
            return 'vendor-react';
          }
          return 'vendor';
        },
      },
    },
  },
});
