# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Guaraní Tour staff portal: a build-less, framework-less PWA (vanilla JS + one big `index.html`) served as static files (GitHub Pages, `CNAME` → app.guaranitour.com). UI text and code comments are in Spanish. There is no package.json, bundler, linter or test suite — edit files and open `index.html` through any static server (the service worker needs `http://localhost`, not `file://`).

## Architecture

- **Single page, many views.** `index.html` (~2900 lines) contains the markup for every module/view. `js/app.js` owns global state (`allPassengers`, `currentView`, shared caches for vendedores/métodos de pago/bancos), auth/session bootstrap, and hash-based routing (`navigateTo` → `_navigateToImpl`, `hashchange` listener, e.g. `#detalle/17`).
- **Classic scripts, shared global scope.** Scripts are loaded with plain `<script src>` tags at the bottom of `index.html` in a specific order (`custom-select`, `supabaseClient`, `push-notifications`, `auth`, `app`, then feature modules; Chart.js is loaded before `informes.js`). Modules call each other's functions through globals — there are no imports. Adding a module means: new `js/x.js` + `css/x.css`, a `<script>`/`<link>` in `index.html`, and its view markup.
- **Backend: Supabase** (`js/supabaseClient.js`, global `supabaseClient`, Google OAuth login in `js/auth.js`). The project is shared with a separate seat-selection app, hence the custom `storageKey`. Spanish table/column names (e.g. `vendedores.Nombre_del_vendedor`). Supabase supabase-js, html-to-image, Firebase and Chart.js come from CDNs.
- **Push notifications:** Firebase Messaging (`firebase-config.js`, `firebase-messaging-sw.js`, `js/push-notifications.js`).
- **Feature modules** map roughly 1:1 to `js/*.js` + `css/*.css` (viajes_*, pagos, recibos, facturas, marangatu, dashboard, calendario, usuarios, etc.).

## Service worker (`service-worker.js`) — important when shipping changes

- Static JS/CSS/HTML are served **cache-first** from `CACHE_NAME` (`guarani-tour-vNNN`). **NO modificar `CACHE_NAME` tras cada cambio**; solo se cambia cuando el usuario lo pida explícitamente.
- New files must be added to `STATIC_ASSETS` (note: `informes`, `facturas`, `marangatu` JS/CSS and some images are currently not listed there; missing ones are still cached lazily only for `/img/`).
- A new SW stays in "waiting" until the app banner sends `SKIP_WAITING` (no automatic `skipWaiting`); the client reloads on `controllerchange`.
- Supabase Storage images: cache-first in `CACHE_IMAGES`; other Supabase API calls: network only; CDN/fonts: cache-first in `CACHE_EXTERN`.

responde siempre en español latinoamericano, de forma concisa
