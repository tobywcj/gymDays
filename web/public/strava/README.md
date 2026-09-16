# Strava brand assets

This directory is where Strava's official brand assets should live, so the
`<ConnectWithStravaButton />` and `<PoweredByStrava />` React components can
serve them via `<img src="/strava/...">`.

Strava's brand guidelines (https://developers.strava.com/guidelines/) require
the exact official artwork — do not redraw or recolor. Download them once
from the brand page and drop them here:

## Required files

| Filename                                       | Source                                                | Used by                       |
|------------------------------------------------|-------------------------------------------------------|-------------------------------|
| `btn_strava_connect_with_orange_x2.png`        | Strava brand guidelines, "Connect with Strava" button | `ConnectWithStravaButton.tsx` |
| `api_logo_pwrdBy_strava_horiz_orange.png`      | Strava brand guidelines, "Powered by Strava" wordmark | `PoweredByStrava.tsx`         |

Canonical source: https://developers.strava.com/guidelines/ → "Brand Resources".
Strava ships several colorways of each — the orange "Powered by Strava" pairs
well with gymDays' dark UI; swap to the white variant
(`api_logo_pwrdBy_strava_horiz_white.png`) and update the import path in
`components/strava/PoweredByStrava.tsx` if you change the surrounding palette.

## Fallback behavior

If a file is missing, the matching React component renders an in-app fallback
(orange pill button with the word "Strava", or a small "Powered by Strava"
text wordmark). This keeps the UI from breaking during development, but the
fallback is **not** brand-compliant and must be replaced with the official
asset before Strava reviews the app for the multi-athlete rate-limit increase.
