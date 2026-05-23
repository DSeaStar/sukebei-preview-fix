// ==UserScript==
// @name         sukebei preview
// @namespace    https://sukebei.nyaa.si/
// @version      2.0.0-codex.24
// @description  More reliable image previews for Sukebei/Nyaa list pages.
// @author       etorrent, Codex patch
// @match        https://sukebei.nyaa.si/*
// @match        http://sukebei.nyaa.si/*
// @match        https://nyaa.si/*
// @match        http://nyaa.si/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
    "use strict";

    const runFlag = "__sukebeiPreviewCodexActive";
    if (window[runFlag]) {
        return;
    }
    window[runFlag] = true;

    const MAX_PREVIEWS_PER_TORRENT = 8;
    const MAX_INLINE_PREVIEWS = 80;
    const SCRIPT_VERSION = "2.0.0-codex.24";
    const DETAIL_CONCURRENCY = 3;
    const CACHE_TTL_MS = 1000 * 60 * 60 * 3;
    const CACHE_KEY = "sukebei_preview_codex_cache_v14";
    const IMAGE_HASH_SIZE = 8;
    const IMAGE_HASH_DISTANCE = 5;
    const IMAGE_HASH_MIN_PIXELS = 4096;
    const enabledKey = "sukebei_preview_codex_enabled";
    const imageExt = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i;
    const urlPattern = /https?\s*:\s*\/\/[^\s"'<>()[\]{}]+/gi;
    const blockedImagePatterns = [
        /^https?:\/\/apiplayer\.b-cdn\.net\/images\/static_flyer\.jpg(?:[?#].*)?$/i
    ];
    const shortLinkHosts = [
        "ouo.io",
        "ouo.press"
    ];
    const imageQueryParamNames = [
        "file",
        "i",
        "img",
        "image",
        "src",
        "to",
        "u",
        "url"
    ];
    const knownHtmlImageHosts = [
        "google-images.papakatsu.co",
        "imagetwist.com",
        "imagexport.com",
        "imagehaha.com",
        "imgpv.com",
        "orangepix.is",
        "hentai-covers.site",
        "hentai-sub.com",
        "imagebam.com",
        "imgbox.com",
        "pixhost.to",
        "postimg.cc",
        "imgbb.com",
        "pixeldrain.com",
        "imgchest.com",
        "ibb.co",
        "freeimage.host",
        "1minx.com",
        "3minx.com",
        "555fap.com",
        "ai18.pics",
        "anime-jav.com",
        "chinese-pics.vip",
        "cn-av.com",
        "cnpics.org",
        "cnxxx.org",
        "cosplay18.pics",
        "cosplaytele.vip",
        "fc2ppv.me",
        "fc2ppv.stream",
        "friday.sankuai.com",
        "hentaicovid.vip",
        "hentai4f.com",
        "hentai-manga.org",
        "javball.com",
        "javbee.co",
        "javtele.net",
        "kin8-jav.com",
        "kr-av.com",
        "old-young.net",
        "pig69.com",
        "porn-pig.com",
        "sht-link.com"
    ];
    const rejectImageWords = [
        "avatar",
        "banner",
        "blank",
        "button",
        "cerrar",
        "close",
        "default",
        "favicon",
        "icon",
        "loader",
        "loading",
        "logo",
        "pixel",
        "spacer",
        "static_flyer",
        "sprite",
        "warning"
    ];

    const state = {
        cache: loadCache(),
        detailQueue: [],
        activeDetails: 0,
        imageHashScopes: new WeakMap(),
        observer: null
    };

    addStyles();
    init();

    function init() {
        const hasList = Boolean(document.querySelector(".torrent-list tbody tr"));
        const description = document.querySelector("#torrent-description");
        if (!hasList && !description) {
            return;
        }

        cleanupLegacyPreview();

        const enabled = localStorage.getItem(enabledKey) !== "0";
        addToggle(enabled);

        if (!enabled) {
            return;
        }

        state.observer = "IntersectionObserver" in window
            ? new IntersectionObserver(onPreviewVisible, { rootMargin: "900px 0px" })
            : null;

        if (hasList) {
            initListPage();
        }
        if (description) {
            initViewPage(description);
        }
    }

    function addToggle(enabled) {
        const toggle = document.createElement("label");
        toggle.className = "sp-toggle";
        toggle.innerHTML = `<input type="checkbox" ${enabled ? "checked" : ""}> preview ${SCRIPT_VERSION}`;
        document.body.appendChild(toggle);
        toggle.querySelector("input").addEventListener("change", (event) => {
            localStorage.setItem(enabledKey, event.target.checked ? "1" : "0");
            location.reload();
        });
    }

    function initListPage() {
        const rows = Array.from(document.querySelectorAll(".torrent-list tbody tr"));
        rows.forEach((row) => {
            const link = findDetailLink(row);
            if (!link) {
                return;
            }
            makeDetailLinkOpenInNewTab(link);
            const previewRow = buildPreviewRow(row);
            row.after(previewRow);
            enqueueDetail({ row, previewRow, detailUrl: link.href });
        });
        pumpDetailQueue();
    }

    function initViewPage(description) {
        removeBlockedInlineAssets(description);
        expandInlineImages(description);
    }

    function findDetailLink(row) {
        return Array.from(row.querySelectorAll("a[href*='/view/']")).find((link) => {
            return /\/view\/\d+/.test(link.getAttribute("href") || "");
        });
    }

    function makeDetailLinkOpenInNewTab(link) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
    }

    function cleanupLegacyPreview() {
        localStorage.setItem("nyaa_check", "no");
        document.querySelectorAll(".nyaa_check, tr.preview_box, tr.sp-preview-row, .sp-inline-image-container").forEach((node) => {
            node.remove();
        });
    }

    function buildPreviewRow(row) {
        const previewRow = document.createElement("tr");
        previewRow.className = "sp-preview-row sp-preview-row-hidden";
        const cell = document.createElement("td");
        cell.colSpan = Math.max(row.children.length, 1);
        cell.innerHTML = `<div class="sp-preview-box"></div>`;
        previewRow.appendChild(cell);
        return previewRow;
    }

    function enqueueDetail(task) {
        const cached = getCached(task.detailUrl);
        if (cached) {
            renderPreview(task.previewRow, cached, task.detailUrl);
            return;
        }
        state.detailQueue.push(task);
    }

    function pumpDetailQueue() {
        while (state.activeDetails < DETAIL_CONCURRENCY && state.detailQueue.length) {
            const task = state.detailQueue.shift();
            state.activeDetails += 1;
            fetchDetail(task.detailUrl)
                .then((description) => {
                    const candidates = extractCandidates(description)
                        .slice(0, 24);
                    return resolveCandidates(candidates, MAX_PREVIEWS_PER_TORRENT);
                })
                .then((items) => {
                    setCached(task.detailUrl, items);
                    renderPreview(task.previewRow, items, task.detailUrl);
                })
                .catch((error) => {
                    task.previewRow.remove();
                })
                .finally(() => {
                    state.activeDetails -= 1;
                    pumpDetailQueue();
                });
        }
    }

    async function fetchDetail(url) {
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) {
            throw new Error(`detail ${response.status}`);
        }
        const html = await response.text();
        const documentObject = new DOMParser().parseFromString(html, "text/html");
        const description = documentObject.querySelector("#torrent-description");
        return description ? decodeHtml(description.innerHTML) : "";
    }

    function expandInlineImages(root) {
        const links = Array.from(root.querySelectorAll("a[href]"));
        const claimedKeys = new Set();
        const claimedContentKeys = existingContentKeys(root);
        primeExistingImageHashes(root);
        let processed = 0;

        links.forEach((link) => {
            if (processed >= MAX_INLINE_PREVIEWS || link.dataset.spInlineProcessed === "1") {
                return;
            }
            const href = cleanUrl(link.getAttribute("href") || link.href || "");
            if (!isExpandableInlineLink(href)) {
                return;
            }

            const inlineThumb = imageCandidateFromElement(link.querySelector("img"), location.href);
            if (inlineThumb && directImageFromUrl(inlineThumb)) {
                link.dataset.spInlineProcessed = "1";
                return;
            }

            const reservedKey = previewKeyForUrl(href);
            if (reservedKey && claimedKeys.has(reservedKey)) {
                link.dataset.spInlineProcessed = "1";
                return;
            }
            if (reservedKey) {
                claimedKeys.add(reservedKey);
            }
            const reservedContentKey = previewContentKeyForUrl(href);
            if (reservedContentKey && claimedContentKeys.has(reservedContentKey)) {
                link.dataset.spInlineProcessed = "1";
                return;
            }
            if (reservedContentKey && isOfficialCoverImage(directImageFromUrl(href) || href)) {
                claimedContentKeys.add(reservedContentKey);
            }

            processed += 1;
            link.dataset.spInlineProcessed = "1";

            const container = document.createElement("div");
            container.className = "sp-inline-image-container sp-loading";
            container.innerHTML = `<div class="sp-inline-loading">loading image...</div>`;
            link.insertAdjacentElement("afterend", container);

            if (isShortLink(href)) {
                container.remove();
                return;
            }

            resolveCandidates([{ url: href, source: "inline-link", thumb: inlineThumb || "" }], 1)
                .then((items) => {
                    if (!items.length) {
                        container.remove();
                        return;
                    }
                    const itemKey = previewItemKey(items[0]);
                    if (itemKey && itemKey !== reservedKey && claimedKeys.has(itemKey)) {
                        container.remove();
                        return;
                    }
                    if (itemKey) {
                        claimedKeys.add(itemKey);
                    }
                    const itemContentKey = previewContentKey(items[0]);
                    if (itemContentKey && claimedContentKeys.has(itemContentKey) && itemContentKey !== reservedContentKey) {
                        container.remove();
                        return;
                    }
                    if (itemContentKey && isOfficialCoverImage(items[0].imageUrl)) {
                        claimedContentKeys.add(itemContentKey);
                    }
                    renderInlineImage(container, items[0], href, itemKey || reservedKey);
                })
                .catch(() => {
                    container.remove();
                });
        });
    }

    function isExpandableInlineLink(url) {
        if (!/^https?:\/\//i.test(url) || looksLikeUiAsset(url)) {
            return false;
        }
        if (isShortLink(url)) {
            return true;
        }
        if (directImageFromUrl(url) || shouldFetchHtml(url)) {
            return true;
        }
        try {
            const parsed = new URL(url);
            return imageExt.test(parsed.pathname);
        } catch {
            return false;
        }
    }

    function isShortLink(url) {
        try {
            const host = new URL(url).hostname.toLowerCase();
            return shortLinkHosts.some((domain) => host === domain || host.endsWith(`.${domain}`));
        } catch {
            return false;
        }
    }

    function removeBlockedInlineAssets(root) {
        root.querySelectorAll("img[src]").forEach((image) => {
            const src = absoluteUrl(image.getAttribute("src"), location.href);
            if (!src || !looksLikeUiAsset(src)) {
                return;
            }
            const parentLink = image.closest("a");
            image.remove();
            if (parentLink && !parentLink.textContent.trim() && !parentLink.querySelector("img")) {
                parentLink.remove();
            }
        });

        root.querySelectorAll("a[href]").forEach((link) => {
            const href = absoluteUrl(link.getAttribute("href"), location.href);
            if (href && isBlockedImageUrl(href)) {
                link.remove();
            }
        });
    }

    function renderInlineImage(container, item, originalUrl, itemKey) {
        container.classList.remove("sp-loading");
        if (itemKey) {
            container.dataset.spKey = itemKey;
        }
        container.innerHTML = "";

        const anchor = document.createElement("a");
        anchor.className = "sp-card sp-inline-card";
        if (itemKey) {
            anchor.dataset.spKey = itemKey;
        }
        anchor.href = item.pageUrl || originalUrl || item.imageUrl;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";

        const image = document.createElement("img");
        image.className = "sp-inline-image";
        image.alt = "preview image";
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        image.dataset.src = item.imageUrl;
        image.addEventListener("load", () => {
            dedupeLoadedImageByContent(image, inlinePreviewScope(container));
        }, { once: true });
        image.addEventListener("error", () => {
            recoverBrokenImage(image, item);
        });

        anchor.appendChild(image);
        container.appendChild(anchor);
        container.appendChild(buildOriginalLink(originalUrl));
        observeImage(image);
    }

    function buildOriginalLink(originalUrl) {
        const wrapper = document.createElement("div");
        wrapper.className = "sp-original-link";
        const anchor = document.createElement("a");
        anchor.href = originalUrl;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = originalUrl;
        wrapper.append("source: ", anchor);
        return wrapper;
    }

    function extractCandidates(text) {
        const candidates = [];
        const add = (url, source, thumb) => {
            const normalized = cleanUrl(url);
            if (!normalized || !/^https?:\/\//i.test(normalized)) {
                return;
            }
            candidates.push({
                url: normalized,
                source: source || "url",
                thumb: cleanUrl(thumb || "")
            });
        };

        for (const match of text.matchAll(/\[\s*!\[[^\]]*]\((https?:\/\/[^\s)]+)[^)]*\)\s*]\((https?:\/\/[^\s)]+)[^)]*\)/gi)) {
            add(match[2], "linked-image", match[1]);
        }
        for (const match of text.matchAll(/!\[[^\]]*]\((https?:\/\/[^\s)]+)[^)]*\)/gi)) {
            add(match[1], "markdown-image");
        }
        for (const match of text.matchAll(/\[[^\]]+]\((https?:\/\/[^\s)]+)[^)]*\)/gi)) {
            add(match[1], "markdown-link");
        }
        for (const match of text.matchAll(urlPattern)) {
            add(match[0], "plain-url");
        }

        return uniqueBy(candidates, (candidate) => normalizedImageKey(candidate.thumb || candidate.url));
    }

    async function resolveCandidates(candidates, limit) {
        const resolved = [];
        for (const candidate of candidates) {
            if (resolved.length >= limit) {
                break;
            }
            const directThumb = directImageFromUrl(candidate.thumb);
            const direct = directImageFromUrl(candidate.url);
            if (direct) {
                resolved.push({
                    pageUrl: candidate.url,
                    imageUrl: direct,
                    fallbackUrls: uniqueBy([directImageFallback(candidate.url), directThumb], (src) => src),
                    kind: candidate.source
                });
                continue;
            }
            if (directThumb) {
                resolved.push({
                    pageUrl: candidate.url,
                    imageUrl: directThumb,
                    fallbackUrls: uniqueBy([directImageFallback(candidate.url)], (src) => src),
                    kind: candidate.source
                });
                continue;
            }
            if (!shouldFetchHtml(candidate.url)) {
                continue;
            }
            try {
                const html = await gmGetText(candidate.url);
                const imageUrl = pickImageFromHtml(html, candidate.url);
                if (imageUrl) {
                    resolved.push({
                        pageUrl: candidate.url,
                        imageUrl,
                        fallbackUrls: uniqueBy([directImageFallback(candidate.url), directThumb], (src) => src),
                        kind: "resolved-html"
                    });
                }
            } catch (error) {
                const fallback = directImageFallback(candidate.url);
                if (fallback) {
                    resolved.push({
                        pageUrl: candidate.url,
                        imageUrl: fallback,
                        fallbackUrls: uniqueBy([directThumb], (src) => src),
                        kind: "fallback"
                    });
                }
            }
        }
        return uniqueBy(resolved, (item) => normalizedImageKey(item.imageUrl)).slice(0, limit);
    }

    function directImageFromUrl(rawUrl) {
        if (!rawUrl) {
            return "";
        }
        const url = cleanUrl(rawUrl);
        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            return "";
        }
        if (looksLikeUiAsset(parsed.href)) {
            return "";
        }
        const host = parsed.hostname.toLowerCase();
        const queryImage = imageFromQueryParam(parsed, true);
        if (queryImage) {
            return queryImage;
        }
        if (host === "google-images.papakatsu.co" && parsed.pathname.includes("/upload/image/")) {
            parsed.pathname = parsed.pathname.replace("/upload/image/", "/upload/uploads/");
            return preferFullSizeImageUrl(parsed.href);
        }
        if (host.endsWith("orangepix.is") && parsed.pathname.includes("/images/")) {
            parsed.pathname = parsed.pathname
                .replace(/\.th(\.[a-z0-9]+)$/i, "$1")
                .replace(/\.md(\.[a-z0-9]+)$/i, "$1");
            return preferFullSizeImageUrl(parsed.href);
        }
        if (isDirectImageHostAsset(parsed)) {
            return parsed.href;
        }
        const cheveretoDirect = cheveretoImageUrl(parsed);
        if (cheveretoDirect) {
            return preferFullSizeImageUrl(cheveretoDirect);
        }
        if (knownHtmlImageHosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
            if (host.endsWith("orangepix.is") && parsed.pathname.includes("/images/")) {
                return preferFullSizeImageUrl(parsed.href);
            }
            return "";
        }
        return imageExt.test(parsed.pathname) ? preferFullSizeImageUrl(parsed.href) : "";
    }

    function isDirectImageHostAsset(parsed) {
        const host = parsed.hostname.toLowerCase();
        if (host.endsWith(".imagetwist.com") && /^\/(?:th|i)\//i.test(parsed.pathname) && imageExt.test(parsed.pathname)) {
            return true;
        }
        return false;
    }

    function cheveretoImageUrl(parsed) {
        if (!/^\/upload\/(?!ib\/|en\/|images\/|Application\/)[^/]+\.(?:avif|gif|jpe?g|png|webp)$/i.test(parsed.pathname)) {
            return "";
        }
        const direct = new URL(parsed.href);
        direct.pathname = parsed.pathname.replace(/^\/upload\//i, "/upload/ib/");
        return direct.href;
    }

    function directImageFallback(rawUrl) {
        let parsed;
        try {
            parsed = new URL(rawUrl);
        } catch {
            return "";
        }
        const queryImage = imageFromQueryParam(parsed, false);
        if (queryImage && queryImage !== directImageFromUrl(rawUrl)) {
            return queryImage;
        }
        if (parsed.hostname.toLowerCase() === "google-images.papakatsu.co" && parsed.pathname.includes("/upload/image/")) {
            parsed.pathname = parsed.pathname.replace("/upload/image/", "/upload/uploads/");
            return parsed.href;
        }
        if (imageExt.test(parsed.pathname)) {
            const preferred = preferFullSizeImageUrl(parsed.href);
            if (preferred !== parsed.href) {
                return parsed.href;
            }
        }
        return "";
    }

    function shouldFetchHtml(rawUrl) {
        try {
            const parsed = new URL(rawUrl);
            const host = parsed.hostname.toLowerCase();
            if (imageFromQueryParam(parsed, false)) {
                return false;
            }
            if (cheveretoImageUrl(parsed)) {
                return true;
            }
            return knownHtmlImageHosts.some((domain) => host === domain || host.endsWith(`.${domain}`));
        } catch {
            return false;
        }
    }

    function imageFromQueryParam(parsed, preferFullSize) {
        const lowerNames = new Set(imageQueryParamNames);
        const entries = Array.from(parsed.searchParams.entries());
        const ordered = entries.slice().sort((left, right) => {
            const leftKnown = lowerNames.has(left[0].toLowerCase()) ? 0 : 1;
            const rightKnown = lowerNames.has(right[0].toLowerCase()) ? 0 : 1;
            return leftKnown - rightKnown;
        });

        for (const [name, value] of ordered) {
            const cleanedValue = cleanUrl(value);
            if (!imageExt.test(cleanedValue)) {
                continue;
            }
            const imageValue = preferFullSize ? preferFullSizePath(cleanedValue) : cleanedValue;
            if (/^https?:\/\//i.test(imageValue)) {
                return imageValue;
            }
            const copy = new URL(parsed.href);
            copy.searchParams.set(name, imageValue);
            return copy.href;
        }
        return "";
    }

    function preferFullSizeImageUrl(rawUrl) {
        const url = cleanUrl(rawUrl);
        if (!url) {
            return "";
        }
        try {
            const parsed = new URL(url);
            const queryImage = imageFromQueryParam(parsed, true);
            if (queryImage) {
                return queryImage;
            }
            parsed.pathname = preferFullSizePath(parsed.pathname);
            return parsed.href;
        } catch {
            return preferFullSizePath(url);
        }
    }

    function preferFullSizePath(value) {
        return String(value || "")
            .replace(/[_-](?:thumb|thumbnail|small|preview)(?=\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$)/i, "")
            .replace(/_s(?=\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$)/i, "")
            .replace(/_t(?=\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$)/i, "")
            .replace(/\.th(?=\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$)/i, "")
            .replace(/\.md(?=\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$)/i, "");
    }

    function pickImageFromHtml(html, pageUrl) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const metaSelectors = [
            "meta[property='og:image']",
            "meta[property='og:image:secure_url']",
            "meta[name='twitter:image']",
            "meta[name='twitter:image:src']",
            "link[rel='image_src']"
        ];
        for (const selector of metaSelectors) {
            const value = doc.querySelector(selector)?.getAttribute("content")
                || doc.querySelector(selector)?.getAttribute("href");
            const normalized = absoluteUrl(value, pageUrl);
            if (normalized && !looksLikeUiAsset(normalized)) {
                return normalized;
            }
        }

        const preferredSelectors = [
            "#img-preview",
            "#modal-image",
            "#this_image",
            "#show_image",
            "#myUniqueImg",
            "img.img-responsive",
            "img.centred",
            "img.centered",
            "img.centred_resized",
            "img[class*='main']",
            "img[id*='main']",
            "img[class*='image']",
            "img[id*='image']"
        ];
        for (const selector of preferredSelectors) {
            const image = doc.querySelector(selector);
            const src = imageCandidateFromElement(image, pageUrl);
            if (src && !looksLikeUiAsset(src)) {
                return src;
            }
        }

        const scored = Array.from(doc.querySelectorAll("img"))
            .map((image) => imageCandidateFromElement(image, pageUrl))
            .filter(Boolean)
            .filter((src) => imageExt.test(new URL(src, pageUrl).pathname))
            .filter((src) => !looksLikeUiAsset(src))
            .map((src) => ({ src, score: imageScore(src) }))
            .sort((left, right) => right.score - left.score);

        if (scored[0]?.src) {
            return scored[0].src;
        }

        const looseUrls = Array.from(html.matchAll(/https?:\/\/[^"'<> ]+\.(?:avif|jpe?g|png|webp)(?:\?[^"'<> ]*)?/gi))
            .map((match) => absoluteUrl(match[0], pageUrl))
            .filter(Boolean)
            .filter((src) => !looksLikeUiAsset(src))
            .map((src) => ({ src, score: imageScore(src) }))
            .sort((left, right) => right.score - left.score);

        return looseUrls[0]?.src || "";
    }

    function imageCandidateFromElement(image, pageUrl) {
        if (!image) {
            return "";
        }
        const values = [
            image.getAttribute("src"),
            image.getAttribute("data-src"),
            image.getAttribute("data-original"),
            image.getAttribute("data-lazy-src"),
            image.getAttribute("data-url")
        ];
        const srcset = image.getAttribute("srcset") || image.getAttribute("data-srcset");
        if (srcset) {
            const best = srcset.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean).pop();
            values.unshift(best);
        }
        for (const value of values) {
            const src = absoluteUrl(value, pageUrl);
            if (src) {
                return src;
            }
        }
        return "";
    }

    function renderPreview(previewRow, items, detailUrl) {
        const box = previewRow.querySelector(".sp-preview-box");
        const uniqueItems = dedupePreviewItems(items);
        box.classList.remove("sp-loading");
        box.textContent = "";
        if (!uniqueItems.length) {
            previewRow.remove();
            return;
        }
        const shouldHashContent = uniqueItems.length > 1;
        uniqueItems.forEach((item) => {
            const itemKey = previewItemKey(item);
            const anchor = document.createElement("a");
            anchor.className = "sp-card";
            anchor.href = item.pageUrl || item.imageUrl;
            anchor.target = "_blank";
            anchor.rel = "noopener noreferrer";
            if (itemKey) {
                anchor.dataset.spKey = itemKey;
            }

            const image = document.createElement("img");
            image.alt = "";
            image.loading = "eager";
            image.referrerPolicy = "no-referrer";
            image.dataset.src = item.imageUrl;
            image.addEventListener("load", () => {
                previewRow.classList.remove("sp-preview-row-hidden");
                if (shouldHashContent) {
                    dedupeLoadedImageByContent(image, previewRow);
                }
            }, { once: true });
            image.addEventListener("error", () => {
                clearCached(detailUrl);
                recoverBrokenImage(image, item);
            });

            anchor.appendChild(image);
            box.appendChild(anchor);
            observeImage(image);
        });
    }

    function dedupePreviewItems(items) {
        const exactUnique = uniqueBy(items || [], previewItemKey);
        const contentGroups = new Map();
        exactUnique.forEach((item) => {
            const contentKey = previewContentKey(item);
            if (!contentKey) {
                return;
            }
            const group = contentGroups.get(contentKey) || { hasOfficial: false };
            group.hasOfficial = group.hasOfficial || isOfficialCoverImage(item.imageUrl) || isOfficialCoverImage(item.pageUrl);
            contentGroups.set(contentKey, group);
        });

        const seenContentKeys = new Set();
        return exactUnique.filter((item) => {
            const contentKey = previewContentKey(item);
            if (!contentKey) {
                return true;
            }
            const group = contentGroups.get(contentKey);
            if (!group?.hasOfficial) {
                return true;
            }
            if (group?.hasOfficial && !isOfficialCoverImage(item.imageUrl) && !isOfficialCoverImage(item.pageUrl)) {
                return false;
            }
            if (seenContentKeys.has(contentKey)) {
                return false;
            }
            seenContentKeys.add(contentKey);
            return true;
        });
    }

    function previewItemKey(item) {
        if (!item) {
            return "";
        }
        return normalizedImageKey(item.imageUrl || directImageFromUrl(item.pageUrl) || item.pageUrl);
    }

    function previewKeyForUrl(url) {
        return normalizedImageKey(directImageFromUrl(url) || url);
    }

    function previewContentKey(item) {
        if (!item) {
            return "";
        }
        return contentSignatureForImage(item.imageUrl)
            || contentSignatureForImage(directImageFromUrl(item.pageUrl))
            || contentSignatureForImage(item.pageUrl);
    }

    function previewContentKeyForUrl(url) {
        return contentSignatureForImage(directImageFromUrl(url) || url);
    }

    function existingContentKeys(root) {
        const keys = new Set();
        root.querySelectorAll("img[src]").forEach((image) => {
            const src = absoluteUrl(image.getAttribute("src"), location.href);
            const key = contentSignatureForImage(src);
            if (key && isOfficialCoverImage(src)) {
                keys.add(key);
            }
        });
        return keys;
    }

    function contentSignatureForImage(rawUrl) {
        if (!rawUrl) {
            return "";
        }
        let parsed;
        try {
            parsed = new URL(cleanUrl(rawUrl));
        } catch {
            return "";
        }
        const host = parsed.hostname.toLowerCase();
        if (!isOfficialCoverHost(host) && host !== "google-images.papakatsu.co") {
            return "";
        }
        const code = javProductCodeFromPath(parsed.pathname);
        return code ? `cover:${code}` : "";
    }

    function isOfficialCoverImage(rawUrl) {
        if (!rawUrl) {
            return false;
        }
        try {
            return isOfficialCoverHost(new URL(cleanUrl(rawUrl)).hostname.toLowerCase());
        } catch {
            return false;
        }
    }

    function isOfficialCoverHost(host) {
        return host === "image.mgstage.com"
            || host === "awsimgsrc.dmm.co.jp"
            || host === "pics.dmm.co.jp";
    }

    function javProductCodeFromPath(pathname) {
        const decoded = decodeURIComponent(String(pathname || "")).toLowerCase();
        const match = decoded.match(/(?:^|[^a-z0-9])([a-z]{2,10})[-_]?(\d{2,6})(?:[^a-z0-9]|$)/i);
        if (!match) {
            return "";
        }
        const number = match[2].replace(/^0+/, "") || "0";
        return `${match[1].toLowerCase()}-${number}`;
    }

    function primeExistingImageHashes(root) {
        const scope = inlinePreviewScope(root);
        root.querySelectorAll("img[src]").forEach((image) => {
            if (image.closest(".sp-card")) {
                return;
            }
            const src = absoluteUrl(image.getAttribute("src"), location.href);
            if (!src || looksLikeUiAsset(src)) {
                return;
            }
            const track = () => {
                dedupeLoadedImageByContent(image, scope);
            };
            if (image.complete && image.naturalWidth) {
                setTimeout(track, 0);
            } else {
                image.addEventListener("load", track, { once: true });
            }
        });
    }

    function inlinePreviewScope(node) {
        return node.closest("#torrent-description") || document.body;
    }

    async function dedupeLoadedImageByContent(image, scope) {
        if (!scope || !document.documentElement.contains(image)) {
            return false;
        }
        let hash = "";
        try {
            hash = await imageContentHash(image);
        } catch {
            return false;
        }
        if (!hash || !document.documentElement.contains(image)) {
            return false;
        }

        const entries = imageHashEntries(scope);
        const duplicate = entries.find((entry) => hammingDistance(entry.hash, hash) <= IMAGE_HASH_DISTANCE);
        const isPreview = Boolean(image.closest(".sp-card"));
        if (duplicate) {
            if (isPreview) {
                markCardDuplicate(image);
            } else if (duplicate.isPreview) {
                markCardDuplicate(duplicate.image);
                entries.push({ hash, image, isPreview: false });
            }
            return true;
        }

        entries.push({ hash, image, isPreview });
        return false;
    }

    function imageHashEntries(scope) {
        const entries = (state.imageHashScopes.get(scope) || [])
            .filter((entry) => {
                return document.documentElement.contains(entry.image)
                    && !entry.image.closest(".sp-card-error");
            });
        state.imageHashScopes.set(scope, entries);
        return entries;
    }

    async function imageContentHash(image) {
        if (!image.naturalWidth || !image.naturalHeight) {
            return "";
        }
        if (image.naturalWidth * image.naturalHeight < IMAGE_HASH_MIN_PIXELS) {
            return "";
        }

        const src = image.currentSrc || image.src || image.dataset.src;
        const blob = await blobFromImageSource(src);
        if (!blob || !String(blob.type || "").startsWith("image/")) {
            return "";
        }

        const drawable = await drawableFromBlob(blob);
        const canvas = document.createElement("canvas");
        canvas.width = IMAGE_HASH_SIZE;
        canvas.height = IMAGE_HASH_SIZE;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
            return "";
        }
        context.drawImage(drawable, 0, 0, IMAGE_HASH_SIZE, IMAGE_HASH_SIZE);
        if (typeof drawable.close === "function") {
            drawable.close();
        }

        const pixels = context.getImageData(0, 0, IMAGE_HASH_SIZE, IMAGE_HASH_SIZE).data;
        const grays = [];
        for (let index = 0; index < pixels.length; index += 4) {
            grays.push((pixels[index] * 299 + pixels[index + 1] * 587 + pixels[index + 2] * 114) / 1000);
        }
        const average = grays.reduce((sum, value) => sum + value, 0) / grays.length;
        return grays.map((value) => value >= average ? "1" : "0").join("");
    }

    async function blobFromImageSource(src) {
        if (!src || /^data:/i.test(src)) {
            return null;
        }
        if (/^blob:/i.test(src)) {
            const response = await fetch(src);
            return response.ok ? response.blob() : null;
        }
        return gmGetBlob(src);
    }

    function drawableFromBlob(blob) {
        if ("createImageBitmap" in window) {
            return createImageBitmap(blob);
        }
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const image = new Image();
            image.onload = () => {
                URL.revokeObjectURL(url);
                resolve(image);
            };
            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error("image decode failed"));
            };
            image.src = url;
        });
    }

    function hammingDistance(left, right) {
        const length = Math.min(left.length, right.length);
        let distance = Math.abs(left.length - right.length);
        for (let index = 0; index < length; index += 1) {
            if (left[index] !== right[index]) {
                distance += 1;
            }
        }
        return distance;
    }

    function observeImage(image) {
        image.src = image.dataset.src;
    }

    function onPreviewVisible(entries) {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) {
                return;
            }
            const image = entry.target;
            state.observer.unobserve(image);
            if (image.dataset.src && !image.src) {
                image.src = image.dataset.src;
            }
        });
    }

    async function recoverBrokenImage(image, item) {
        const attempt = Number(image.dataset.recoverAttempt || "0") + 1;
        image.dataset.recoverAttempt = String(attempt);
        if (attempt > 4) {
            markCardError(image);
            return;
        }

        const directSources = uniqueBy([
            item.imageUrl,
            directImageFromUrl(item.pageUrl),
            directImageFallback(item.pageUrl),
            ...(Array.isArray(item.fallbackUrls) ? item.fallbackUrls : [])
        ], (src) => src);

        for (const src of directSources) {
            if (!src || looksLikeUiAsset(src)) {
                continue;
            }
            try {
                const blob = await gmGetBlob(src);
                if (!blob || !String(blob.type || "").startsWith("image/")) {
                    throw new Error("not an image");
                }
                image.src = URL.createObjectURL(blob);
                return;
            } catch {
                // Try the next recovery path.
            }
        }

        const pageSources = uniqueBy([item.pageUrl, item.imageUrl], (src) => src);
        for (const src of pageSources) {
            if (!src) {
                continue;
            }
            try {
                const html = await gmGetText(src);
                const recovered = pickImageFromHtml(html, src);
                if (recovered && !looksLikeUiAsset(recovered)) {
                    item.imageUrl = recovered;
                    image.dataset.src = recovered;
                    image.src = recovered;
                    return;
                }
            } catch {
                // Try the next candidate page.
            }
        }

        markCardError(image);
    }

    function loadImageBlob(image, src) {
        gmGetBlob(src)
            .then((blob) => {
                if (!blob || !String(blob.type || "").startsWith("image/")) {
                    throw new Error("not an image");
                }
                image.src = URL.createObjectURL(blob);
            })
            .catch(() => {
                markCardError(image);
            });
    }

    function markCardError(image) {
        const card = image.closest(".sp-card");
        card?.classList.add("sp-card-error");
        pruneEmptyPreviewRow(image);
    }

    function markCardDuplicate(image) {
        const inlineContainer = image.closest(".sp-inline-image-container");
        if (inlineContainer) {
            inlineContainer.remove();
            return;
        }
        markCardError(image);
    }

    function pruneEmptyPreviewRow(node) {
        const row = node.closest(".sp-preview-row");
        if (!row) {
            return;
        }
        const hasVisibleCard = Array.from(row.querySelectorAll(".sp-card"))
            .some((card) => !card.classList.contains("sp-card-error"));
        if (!hasVisibleCard) {
            row.remove();
        }
    }

    function gmGetText(url) {
        return gmRequest({ method: "GET", url, responseType: "text", timeout: 20000 })
            .then((response) => {
                if (response.status < 200 || response.status >= 400) {
                    throw new Error(`html ${response.status}`);
                }
                return response.responseText || "";
            });
    }

    function gmGetBlob(url) {
        return gmRequest({
            method: "GET",
            url,
            responseType: "blob",
            timeout: 25000,
            headers: { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" }
        }).then((response) => {
            if (response.status < 200 || response.status >= 400) {
                throw new Error(`image ${response.status}`);
            }
            return response.response;
        });
    }

    function gmRequest(options) {
        return new Promise((resolve, reject) => {
            const api = typeof GM !== "undefined" && GM.xmlHttpRequest
                ? GM.xmlHttpRequest
                : typeof GM_xmlhttpRequest !== "undefined"
                    ? GM_xmlhttpRequest
                    : null;
            if (!api) {
                reject(new Error("GM_xmlhttpRequest unavailable"));
                return;
            }
            const request = api({
                ...options,
                onload: resolve,
                onerror: reject,
                ontimeout: reject
            });
            if (request && typeof request.catch === "function") {
                request.then(resolve).catch(reject);
            }
        });
    }

    function cleanUrl(rawUrl) {
        if (!rawUrl) {
            return "";
        }
        return decodeHtml(String(rawUrl))
            .trim()
            .replace(/^https?\s*:\s*\/\//i, (match) => match.toLowerCase().startsWith("https") ? "https://" : "http://")
            .replace(/[),.;\]*]+$/g, "")
            .replace(/&amp;/g, "&");
    }

    function normalizedImageKey(rawUrl) {
        const url = cleanUrl(rawUrl);
        if (!url) {
            return "";
        }
        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            return url.toLowerCase();
        }

        const queryImage = imageFromQueryParam(parsed, true);
        if (queryImage) {
            try {
                parsed = new URL(queryImage);
            } catch {
                return queryImage.toLowerCase();
            }
        }

        if (parsed.hostname.toLowerCase() === "google-images.papakatsu.co" && parsed.pathname.includes("/upload/image/")) {
            parsed.pathname = parsed.pathname.replace("/upload/image/", "/upload/uploads/");
        }

        const cheveretoDirect = cheveretoImageUrl(parsed);
        if (cheveretoDirect) {
            try {
                parsed = new URL(cheveretoDirect);
            } catch {
                return cheveretoDirect.toLowerCase();
            }
        }

        parsed.hash = "";
        parsed.protocol = parsed.protocol.toLowerCase();
        parsed.hostname = parsed.hostname.toLowerCase();
        parsed.pathname = preferFullSizePath(parsed.pathname).replace(/\/{2,}/g, "/");
        return parsed.href.toLowerCase();
    }

    function absoluteUrl(value, baseUrl) {
        if (!value) {
            return "";
        }
        try {
            return new URL(cleanUrl(value), baseUrl).href;
        } catch {
            return "";
        }
    }

    function decodeHtml(value) {
        const textarea = document.createElement("textarea");
        textarea.innerHTML = String(value || "");
        return textarea.value;
    }

    function looksLikeUiAsset(url) {
        if (isBlockedImageUrl(url)) {
            return true;
        }
        const lower = url.toLowerCase();
        return rejectImageWords.some((word) => lower.includes(word));
    }

    function isBlockedImageUrl(url) {
        return blockedImagePatterns.some((pattern) => pattern.test(url));
    }

    function imageScore(url) {
        const lower = url.toLowerCase();
        let score = 0;
        if (/\/(?:i|images|uploads|upload)\//.test(lower)) score += 4;
        if (/\/upload\/ib\//.test(lower)) score += 10;
        if (/\/upload\/en\//.test(lower)) score -= 8;
        if (/\/application\/storage\//.test(lower)) score += 3;
        if (/\.(?:jpe?g|png|webp)(?:[?#]|$)/.test(lower)) score += 3;
        if (/\/th\//.test(lower) || /\.th\./.test(lower) || /_t\./.test(lower)) score -= 2;
        if (/cgi-bin\/dl\.cgi/.test(lower)) score += 6;
        return score;
    }

    function uniqueBy(items, keyFn) {
        const seen = new Set();
        const result = [];
        for (const item of items) {
            const key = keyFn(item);
            if (!key || seen.has(key)) {
                continue;
            }
            seen.add(key);
            result.push(item);
        }
        return result;
    }

    function loadCache() {
        try {
            const value = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
            if (!value || typeof value !== "object") {
                return {};
            }
            return value;
        } catch {
            return {};
        }
    }

    function getCached(key) {
        const cached = state.cache[key];
        if (!cached || Date.now() - cached.time > CACHE_TTL_MS) {
            return null;
        }
        return Array.isArray(cached.items) ? cached.items : null;
    }

    function setCached(key, items) {
        state.cache[key] = { time: Date.now(), items };
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(state.cache));
        } catch {
            state.cache = {};
        }
    }

    function clearCached(key) {
        if (!state.cache[key]) {
            return;
        }
        delete state.cache[key];
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(state.cache));
        } catch {
            state.cache = {};
        }
    }

    function addStyles() {
        const style = document.createElement("style");
        style.textContent = `
            .sp-toggle {
                position: fixed;
                right: 10px;
                top: 60px;
                z-index: 9999;
                padding: 4px 8px;
                border-radius: 4px;
                background: rgba(22, 22, 22, .86);
                color: #fff;
                font: 12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            }
            .sp-toggle input {
                margin: -1px 5px 0 0;
                vertical-align: middle;
            }
            .sp-preview-row-hidden {
                display: none !important;
            }
            .sp-preview-row > td {
                padding: 6px 8px !important;
                white-space: normal !important;
                background: #f8f8f8;
                max-width: calc(100vw - 24px);
                overflow-x: hidden;
            }
            .sp-inline-image-container {
                clear: both;
                margin: 10px 0;
                padding: 8px;
                max-width: calc(100vw - 32px);
                overflow-x: hidden;
                background: #f8f8f8;
                border: 1px solid #e2e2e2;
                border-radius: 4px;
                text-align: left;
            }
            .sp-preview-box {
                display: flex;
                align-items: flex-start;
                flex-wrap: wrap;
                gap: 8px;
                min-height: 34px;
                width: 100%;
                max-width: calc(100vw - 32px);
                overflow-x: hidden;
            }
            .sp-loading,
            .sp-inline-loading {
                align-items: center;
                color: #777;
                font-size: 12px;
            }
            .sp-inline-loading,
            .sp-original-link {
                color: #777;
                font-size: 12px;
                line-height: 1.5;
                word-break: break-all;
            }
            .sp-original-link {
                margin-top: 6px;
            }
            .sp-card {
                display: inline-block;
                width: auto;
                max-width: 100%;
                min-height: 0;
                max-height: none;
                overflow: visible;
                border: 0;
                border-radius: 0;
                background: transparent;
            }
            .sp-card img {
                display: block;
                width: auto;
                height: auto;
                max-width: min(100%, calc(100vw - 48px));
                max-height: none;
                object-fit: initial;
            }
            .sp-inline-card,
            .sp-inline-image {
                max-width: min(100%, calc(100vw - 64px));
            }
            .sp-card-error {
                display: none;
            }
        `;
        document.documentElement.appendChild(style);
    }
})();
