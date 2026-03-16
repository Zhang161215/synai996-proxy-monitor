# Synai996 Proxy Monitor

Chrome/Edge browser extension for viewing your NewAPI account status at a glance.

## Features

- Wallet quota overview
- Active subscription status and expiry
- Daily usage trend chart (7D / 30D)
- Today's model usage breakdown
- Recent request log list
- API key quick view and copy
- Light / dark / system theme
- Extension badge showing remaining quota percentage

## Install

1. Open `chrome://extensions/`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `/Users/user/142.93.94.219/synai996-extension`

## Required configuration

Open the extension settings page and fill in:

- `API Server URL`: usually auto-imported from your logged-in tab
- `User ID`: usually auto-imported from your logged-in tab
- `Access Token`: optional fallback, generated from your NewAPI profile page

## Auto import from current browser login

If you already opened and logged into NewAPI in the same browser:

1. Keep that NewAPI tab open
2. Open the extension settings page
3. Click `Import From Open Tab`

The extension will try to read `localStorage.user` from that page and import:

- site origin
- user ID
- username / display name
- group

## Why User ID is required

NewAPI's user authentication requires both:

- `Authorization: <access-token>`
- `New-Api-User: <user-id>`

So the extension cannot fetch self-service endpoints unless the correct user ID is provided.

If the browser session cookie is still valid, the extension can often work without manually entering an access token.
The token is kept as a fallback mode for cases where session-based requests are unavailable.

## Main APIs used

- `/api/user/self`
- `/api/subscription/self`
- `/api/token/`
- `/api/data/self`
- `/api/log/self`
- `/api/analytics/daily-ranking`

## Notes

- This extension does not modify NewAPI data.
- Data is cached locally and refreshed every 5 minutes.
- The popup can also be refreshed manually.
