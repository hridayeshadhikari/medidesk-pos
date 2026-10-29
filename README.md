# MediDesk

A desktop point-of-sale application for pharmacies, built with Electron, Express, and NeDB. Manage products, customers, and sales from a single workspace, with data saved locally.

## Features

- Product catalog with search, barcode entry, and category filters.
- Cart with individual product cards, quantity controls, discounts, and tax calculation.
- Checkout controls that remain visible while cart items scroll.
- Cash, card, and UPI payment recording.
- Hold and resume sales through Open tabs.
- Inventory management with stock levels and expiry information.
- Customer and user management, with navigation permissions.
- Order history, transaction filters, and CSV exports.
- Printable receipts with configurable store details, logo, and footer.
- Database and upload backup/restore through the desktop File menu.
- Settings for a local workspace or a network POS terminal.

Payment methods record how a sale was paid; they do not process payments through a payment gateway.

## Getting started

Install Node.js and npm, then run these commands from the project directory:

```sh
npm ci
npm start
```

The existing GitHub Actions workflows use Node.js 20. The desktop application starts its Express API on port `3210` by default.

Open the application through Electron using `npm start`. Opening `index.html` directly in a browser does not connect the application to its database.

### First login

A new database initializes an administrator account when you first sign in:

| Field | Default |
| --- | --- |
| Username | `admin` |
| Password | `admin` |

Change the default password in **Users** after signing in. Existing installations keep their current accounts and data.

### Choose a different API port

On macOS or Linux:

```sh
PORT=3211 npm start
```

On Windows PowerShell:

```powershell
$env:PORT = "3211"
npm start
```

## Development and checks

```sh
# Run unit tests without requiring Watchman
npm test -- --runInBand --watchman=false

# Run the Electron integration smoke check
npx electron tests/workspace-smoke.cjs
```

The smoke check uses a temporary database and an available port. It requires a working graphical Electron environment.

## Packaging

```sh
# Package the desktop application
npm run package

# Build installers for the current platform
npm run make
```

Packaged applications are written under `out/`; installer artifacts are written under `out/make/`.

The Forge configuration includes ZIP archives, Windows Squirrel/MSI installers, Linux DEB/RPM packages, and macOS DMG images. Available outputs depend on the host operating system and installed packaging tools. Linux builds use `fakeroot`, `rpm`, and `dpkg`; see [.github/workflows/build.yml](.github/workflows/build.yml) for the current build setup.

Set your author details in `package.json` before distributing installers. Configure signing separately if required for your release.

Automatic updates and GitHub publishing are currently disabled. The release workflow builds installers and uploads them as GitHub Actions artifacts.

## Project structure

```text
api/                   Express routes and local database access
assets/css/            Shared styles
assets/js/             Workspace data adapter, desktop menus, and utilities
assets/images/         Application icons and images
installers/            Windows installation event handling
tests/                 Unit tests and Electron smoke check
index.html             Main desktop workspace
index1.html            Standalone reference prototype with in-memory data
server.js              Express API startup
start.js               Electron main process
forge.config.js        Desktop packaging configuration
```

## Local data

Database files are stored under `<Electron appData>/MediDesk/server/databases`, and uploaded files are stored under `<Electron appData>/MediDesk/uploads`. Electron also stores application settings separately through `electron-store`.

Use **File → Backup** to export a database/upload archive. **File → Restore** replaces the current database and uploads with the selected backup. These archives cover the database and uploads; they are not a complete export of all application preferences.

## Current limitations

- The API uses HTTP and does not enforce session authentication on its data routes. User navigation permissions are enforced in the frontend. Network deployment needs additional access controls.
- Inventory does not provide separate quantities for multiple batches of the same product.
- Installer builds, receipt printing, and desktop menus depend on the operating system and local environment.

