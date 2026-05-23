# sukebei preview fixed

A Tampermonkey userscript that adds image previews to Sukebei / Nyaa list pages.

This fork modernizes the old `sukebei preview` behavior for current image hosts. It extracts image links from torrent detail descriptions and renders previews directly below list rows.

## Features

- Shows preview images on Sukebei / Nyaa list pages.
- Expands supported image links directly inside `Sukebei / Nyaa /view/*` detail pages.
- Opens torrent detail links from list pages in a new tab.
- Supports Markdown images, plain image URLs, and image-host landing pages.
- Handles Chevereto-style hosts where `example.com/upload/file.jpg` is an HTML page and the real image is usually under `example.com/upload/ib/file.jpg`.
- Handles redirect-style image links where the real image filename is stored in a query parameter, such as `rdrctit.php?to=..._s.jpg`.
- Falls back to parsing image-host HTML for `og:image`, `/upload/ib/`, and `Application/storage` image URLs.
- Normalizes duplicate image links, including spaced `https ://` URLs and host-specific real-image rewrites.
- Deduplicates once more before rendering list previews, so stale cache entries or equivalent URL variants do not show the same image twice.
- Prefers full-size image filenames over common thumbnail suffixes such as `_s`, `_t`, `.th`, and `.md`, with the original thumbnail URL kept as a fallback.
- Displays images at original size when possible, then scales them down responsively so the full image stays visible inside the browser viewport.
- Keeps list pages compact by hiding preview rows until images are found and removing rows whose images all fail to load.
- Filters known ad or placeholder images, including `apiplayer.b-cdn.net/images/static_flyer.jpg`.
- Cleans legacy preview rows from older `sukebei preview` scripts to avoid duplicate or stale previews.
- Shows the active script version in the top-right page toggle.

## Installation

1. Install a userscript manager such as Tampermonkey.
2. Install `sukebei-preview-fixed.user.js`.
3. Open a supported page, for example:
   - `https://sukebei.nyaa.si/`
   - `https://sukebei.nyaa.si/?s=leechers&o=desc`
   - `https://sukebei.nyaa.si/view/1234567`
   - `https://nyaa.si/`
4. Confirm that the top-right toggle displays the current script version.
5. On detail pages, supported image links inside the description are expanded inline below the original link.

## Notes

- The script does not bypass short-link services such as `ouo.io`, ad-gated pages, or CAPTCHA pages. Detail pages show these as manual links when they cannot be expanded.
- It only parses image links already present in the torrent description.
- Some hosts may still fail because of region blocking, hotlink protection, temporary outages, or anti-adblock behavior.
- Large original images can make list pages tall.

## Privacy

The script does not upload browsing data to any third-party service. It requests the torrent detail pages and image-host URLs already present in the page description so it can resolve and display previews.

## Credits

Based on the user experience of the original `sukebei preview` userscript by etorrent, with fixes and host-resolution improvements for current Sukebei / Nyaa image links.
