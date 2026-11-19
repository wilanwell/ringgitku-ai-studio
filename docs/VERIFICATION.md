# Verification

Date: 19 November 2026 (Asia/Kuala_Lumpur).

## Observed in the Google AI Studio app

- The earlier scanner failures were accompanied by Gemini 503/high-demand responses and aborted requests in the visible backend logs.
- The OCR model was changed from `gemini-4-hydrogen` to `gemini-3.5-flash-lite` and saved as a manual-edit checkpoint. The exported server was checked against that current checkpoint.
- A built-in coffee-shop sample reached the actual review screen with total USD17.90, subtotal16.50, tax1.40 and three line items.
- A synthetic Malaysian receipt returned Kopi Kita, 18 November 2026, MYR18.50, tax0, Cash and the expected two line items. Saving and reloading preserved that transaction.
- On an Android phone, a physical receipt reached review after a retry. Its MYR27.75 total matched the original, and saving updated the dashboard. The physical receipt and raw phone recording are not included here.
- A camera-preview failure recovered after closing excess tabs/refreshing. Its exact cause was not established; no camera-code fix is claimed for that incident.

## Repository checks

- `npm install --ignore-scripts --no-audit --no-fund`: initially failed because exported esbuild `^0.25.0` did not satisfy the Vite 8.3.8 optional peer range. Aligned esbuild to `^0.28.2`; installation then passed and generated `package-lock.json`. The old Bun lockfile is omitted because npm is the documented package manager.
- `npm run lint`: passed (`tsc --noEmit`).
- `npm run build`: passed, including PWA manifest and service-worker generation. Warnings remain about a large JavaScript chunk and Vite's future native config-loader support for `__dirname`.
- `npm start` with Node24, `NODE_ENV=production` and `PORT=4175`: started successfully. Health, HTML, manifest and required icon/sample assets were checked through HTTP.
- Source scan found no strings matching common Gemini/GitHub token or private-key patterns. `.env.example` contains placeholders, and local environment files are ignored. This is a targeted upload-preparation check, not a full security audit.

Live Gemini scans above were performed in AI Studio; no local Gemini API key was configured and no new Gemini request was made during repository preparation.

## Mobile screenshot capture

- Added five screenshots of the responsive UI using a mobile-sized desktop-browser viewport: overview, scanner, saved-receipt photo review, editable details and export.
- Captures use the existing synthetic Kopi Kita transaction, MYR18.50. No new Gemini API request, expense save, export download or physical-phone regression test was performed for this documentation update.

## Not established

- Full regression coverage across Android, iOS, browsers and installation modes.
- Reliable behaviour under all offline transitions or a deliberately full storage quota.
- Guaranteed provider availability, accuracy across all receipts, measured financial savings or measured time savings.
- Successful publication of a new deployment or cross-device/cloud synchronisation.
