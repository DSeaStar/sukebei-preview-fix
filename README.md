# sukebei preview fixed

A Tampermonkey userscript that adds image previews to Sukebei / Nyaa list pages.

This fork modernizes the old `sukebei preview` behavior for current image hosts. It extracts image links from torrent detail descriptions and renders previews directly below list rows.

## Features

- Shows preview images on Sukebei / Nyaa list pages.
- Supports Markdown images, plain image URLs, and image-host landing pages.
- Handles Chevereto-style hosts where `example.com/upload/file.jpg` is an HTML page and the real image is usually under `example.com/upload/ib/file.jpg`.
- Falls back to parsing image-host HTML for `og:image`, `/upload/ib/`, and `Application/storage` image URLs.
- Displays images at original size instead of forcing tiny thumbnails.
- Filters known ad or placeholder images, including `apiplayer.b-cdn.net/images/static_flyer.jpg`.
- Cleans legacy preview rows from older `sukebei preview` scripts to avoid duplicate or stale previews.
- Shows the active script version in the top-right page toggle.

## Installation

1. Install a userscript manager such as Tampermonkey.
2. Install `sukebei-preview-fixed.user.js`.
3. Open a supported page, for example:
   - `https://sukebei.nyaa.si/`
   - `https://sukebei.nyaa.si/?s=leechers&o=desc`
   - `https://nyaa.si/`
4. Confirm that the top-right toggle displays the current script version.

## Notes

- The script does not bypass short-link services such as `ouo.io`, ad-gated pages, or CAPTCHA pages.
- It only parses image links already present in the torrent description.
- Some hosts may still fail because of region blocking, hotlink protection, temporary outages, or anti-adblock behavior.
- Large original images can make list pages tall.

## Privacy

The script does not upload browsing data to any third-party service. It requests the torrent detail pages and image-host URLs already present in the page description so it can resolve and display previews.

## Credits

Based on the user experience of the original `sukebei preview` userscript by etorrent, with fixes and host-resolution improvements for current Sukebei / Nyaa image links.
