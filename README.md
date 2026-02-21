# SAL Scanner PWA

A lightweight progressive web app used by SAL team members during Melbourne Tour 2026 to scan QR codes on items and process dispatch/return transactions on the spot.

Hosted on GitHub Pages: https://udaykapur.github.io/sal-scanner-mel2026/

## How it works

1. Operator opens the app on their phone and scans a QR label on an item
2. The app looks up the item details from the backend (Google Apps Script web app)
3. Operator selects dispatch or return, enters quantities and team member names
4. Transaction is recorded in the Google Sheet, a PDF receipt is generated, and a Telegram notification is sent

Supports both single-item scanning and batch mode (process multiple items for a team in one go).

## Files

- `index.html` - Single page app with scan, dispatch, return, and batch mode views
- `app.js` - All application logic, API calls, camera/QR handling
- `manifest.json` - PWA manifest for install-to-homescreen

## Deployment

This repo is deployed via GitHub Pages from the `main` branch root. Any push to `main` updates the live app within a couple of minutes.

The app needs the Apps Script web app URL set in `app.js` (the `API_URL` constant) to connect to the backend. That URL comes from deploying the Apps Script project as a web app — see the main [gsheets-automation](https://github.com/udaykapur/tour2026-sal-gsheets-automation) repo for setup details.

## Usage notes

- Works best on mobile Chrome or Safari (camera access required for QR scanning)
- Can be added to the home screen as an app via the browser's "Add to Home Screen" option
- No login needed — the web app endpoint handles auth via the Google account that deployed it
- Batch mode lets you select a team, tick off items, and process them all at once with a single PDF
