 (function() {
            const TOTAL_PAGES = 38; // total real pages (1–36); even count → first & last page both solo in double mode
            const IMAGE_FOLDER = "images/";
            const IMAGE_EXT = "webp";
            const DOUBLE_DISPLAY_THRESHOLD = 900;
            const MIN_PAGES_FOR_TURN = 1;
            const PRELOAD_RADIUS = 18;
            const MAX_CONCURRENT_PRELOADS = 12;

            let pagesLoadedStatus = new Array(TOTAL_PAGES + 1).fill(false);
            let pageElements = [];
            let bookReady = false;
            let activePreloads = 0;
            let preloadQueue = [];
            let currentDisplayMode = 'single';
            let currentRealPage = 1; // the actual page number the user sees
            let lastFlipSoundTime = 0;

            const $flipbook = $("#flipbook");
            const bookArea = document.getElementById("bookArea");
            const zoomContainer = document.getElementById("zoomContainer");
            const torxLoader = document.getElementById("torxLoader");
            const progressBar = document.getElementById("loadProgressBar");
            const progressPercentSpan = document.getElementById("progressPercent");
            const zoomHint = document.getElementById("zoomHint");

            // ----- Helper: list of real pages for each display mode -----
            function getPageList(mode) {
                if (mode === 'double') {
                    // all pages 1..36 (even count → page 1 and page 36 are both singles)
                    return Array.from({
                        length: TOTAL_PAGES
                    }, (_, i) => i + 1);
                } else {
                    // single mode: skip page 2 → 1,3,4,…,36  (35 pages)
                    return [1, ...Array.from({
                        length: TOTAL_PAGES - 2
                    }, (_, i) => i + 3)];
                }
            }

            // ----- Convert between turn‑page index and real page -----
            function getRealPageFromTurn(turnPage, realPages) {
                return realPages[turnPage - 1] || 1;
            }

            function getTurnPageForReal(realPage, mode) {
                const list = getPageList(mode);
                const idx = list.indexOf(realPage);
                return idx >= 0 ? idx + 1 : 1; // fallback to 1
            }

            // ========== REALISTIC BOOK SLIDING SOUND ==========
            let audioCtx = null;

            function playFlipSound() {
                if (!bookReady) return;
                const now = Date.now();
                if (now - lastFlipSoundTime < 280) return;
                lastFlipSoundTime = now;
                try {
                    if (!audioCtx) audioCtx = new(window.AudioContext || window.webkitAudioContext)();
                    if (audioCtx.state === 'suspended') audioCtx.resume();
                    const ctxNow = audioCtx.currentTime;

                    const thumpDur = 0.09;
                    const thumpBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * thumpDur, audioCtx.sampleRate);
                    const thumpData = thumpBuffer.getChannelData(0);
                    for (let i = 0; i < thumpData.length; i++) {
                        thumpData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audioCtx.sampleRate * 0.012));
                    }
                    const thumpSource = audioCtx.createBufferSource();
                    thumpSource.buffer = thumpBuffer;
                    const thumpLowpass = audioCtx.createBiquadFilter();
                    thumpLowpass.type = "lowpass";
                    thumpLowpass.frequency.value = 300;
                    const thumpGain = audioCtx.createGain();
                    thumpGain.gain.setValueAtTime(0.45, ctxNow);
                    thumpGain.gain.exponentialRampToValueAtTime(0.001, ctxNow + thumpDur);
                    thumpSource.connect(thumpLowpass);
                    thumpLowpass.connect(thumpGain);
                    thumpGain.connect(audioCtx.destination);
                    thumpSource.start(ctxNow);
                    thumpSource.stop(ctxNow + thumpDur);

                    const slideDur = 0.38;
                    const slideBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * slideDur, audioCtx.sampleRate);
                    const slideData = slideBuffer.getChannelData(0);
                    for (let i = 0; i < slideData.length; i++) slideData[i] = (Math.random() * 2 - 1);
                    const slideSource = audioCtx.createBufferSource();
                    slideSource.buffer = slideBuffer;
                    const bpFilter = audioCtx.createBiquadFilter();
                    bpFilter.type = "bandpass";
                    bpFilter.frequency.value = 1100;
                    bpFilter.Q.value = 0.9;
                    const slideGain = audioCtx.createGain();
                    slideGain.gain.setValueAtTime(0.0, ctxNow);
                    slideGain.gain.linearRampToValueAtTime(0.32, ctxNow + 0.02);
                    slideGain.gain.linearRampToValueAtTime(0.24, ctxNow + slideDur - 0.06);
                    slideGain.gain.exponentialRampToValueAtTime(0.001, ctxNow + slideDur);
                    slideSource.connect(bpFilter);
                    bpFilter.connect(slideGain);
                    slideGain.connect(audioCtx.destination);
                    slideSource.start(ctxNow);
                    slideSource.stop(ctxNow + slideDur);

                    const swipeDur = 0.22;
                    const swipeBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * swipeDur, audioCtx.sampleRate);
                    const swipeData = swipeBuffer.getChannelData(0);
                    for (let i = 0; i < swipeData.length; i++) swipeData[i] = (Math.random() * 2 - 1);
                    const swipeSource = audioCtx.createBufferSource();
                    swipeSource.buffer = swipeBuffer;
                    const hpFilter = audioCtx.createBiquadFilter();
                    hpFilter.type = "highpass";
                    hpFilter.frequency.value = 3200;
                    const swipeGain = audioCtx.createGain();
                    swipeGain.gain.setValueAtTime(0.0, ctxNow + 0.03);
                    swipeGain.gain.linearRampToValueAtTime(0.07, ctxNow + 0.06);
                    swipeGain.gain.exponentialRampToValueAtTime(0.001, ctxNow + swipeDur);
                    swipeSource.connect(hpFilter);
                    hpFilter.connect(swipeGain);
                    swipeGain.connect(audioCtx.destination);
                    swipeSource.start(ctxNow + 0.04);
                    swipeSource.stop(ctxNow + 0.04 + swipeDur);
                } catch (e) { /* silent */ }
            }

            function unlockAudio() {
                if (!audioCtx) audioCtx = new(window.AudioContext || window.webkitAudioContext)();
                if (audioCtx.state === 'suspended') audioCtx.resume();
            }
            document.body.addEventListener("touchstart", unlockAudio, { once: true });
            document.body.addEventListener("mousedown", unlockAudio, { once: true });

            function getDisplayMode() {
                return window.innerWidth >= DOUBLE_DISPLAY_THRESHOLD ? 'double' : 'single';
            }

            function updateLoadProgress() {
                const loadedCount = pagesLoadedStatus.filter(v => v === true).length;
                const percent = Math.floor((loadedCount / TOTAL_PAGES) * 100);
                if (progressBar) progressBar.style.width = percent + "%";
                if (progressPercentSpan) progressPercentSpan.innerText = percent + "%";
                if (!bookReady && loadedCount >= MIN_PAGES_FOR_TURN) initFlipbookEarly();
            }

            function loadImageForPage(pageNum, imgElement, placeholderDiv) {
                return new Promise((resolve) => {
                    if (pagesLoadedStatus[pageNum]) { resolve(true); return; }
                    const imgSrc = `${IMAGE_FOLDER}page${pageNum}.${IMAGE_EXT}`;
                    const img = new Image();
                    img.decoding = "async";
                    img.onload = () => {
                        imgElement.src = imgSrc;
                        imgElement.classList.add("loaded");
                        if (placeholderDiv) {
                            placeholderDiv.style.opacity = "0";
                            setTimeout(() => { if (placeholderDiv.parentNode) placeholderDiv.remove(); }, 80);
                        }
                        pagesLoadedStatus[pageNum] = true;
                        updateLoadProgress();
                        resolve(true);
                    };
                    img.onerror = () => {
                        imgElement.alt = `Page ${pageNum} missing`;
                        const parent = imgElement.parentNode;
                        if (parent && !parent.querySelector(".error-fallback")) {
                            const errDiv = document.createElement("div");
                            errDiv.className = "error-fallback";
                            errDiv.innerText = `⚠️ Page ${pageNum}`;
                            errDiv.style.cssText =
                                "color:#94a3b8;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#111827;";
                            parent.appendChild(errDiv);
                        }
                        pagesLoadedStatus[pageNum] = true;
                        updateLoadProgress();
                        resolve(false);
                    };
                    img.src = imgSrc;
                });
            }

            function createPageElement(pageNum) {
                const $page = $("<div class='page'></div>");
                const placeholderDiv = document.createElement("div");
                placeholderDiv.className = "loading-placeholder";
                const $img = $("<img class='lazy-load'>");
                $img.attr("alt", `page ${pageNum}`);
                $page.append(placeholderDiv);
                $page.append($img);
                pageElements[pageNum] = { $page, imgEl: $img[0], placeEl: placeholderDiv, loaded: false };
                return $page;
            }

            function buildAllPageElements() {
                pageElements = new Array(TOTAL_PAGES + 1).fill(null);
                // create every real page (1..36) once
                for (let i = 1; i <= TOTAL_PAGES; i++) createPageElement(i);
            }

            let currentPreloadCenter = 1;
            let preloadScheduled = false;

            function scheduleSmartPreload(centerPage) {
                // centerPage is a real page number
                currentPreloadCenter = Math.min(TOTAL_PAGES, Math.max(1, centerPage));
                if (preloadScheduled) return;
                preloadScheduled = true;
                setTimeout(() => {
                    preloadScheduled = false;
                    const start = Math.max(1, currentPreloadCenter - PRELOAD_RADIUS);
                    const end = Math.min(TOTAL_PAGES, currentPreloadCenter + PRELOAD_RADIUS);
                    const toLoad = [];
                    for (let p = start; p <= end; p++)
                        if (!pagesLoadedStatus[p]) toLoad.push(p);
                    toLoad.sort((a, b) => Math.abs(a - currentPreloadCenter) - Math.abs(b - currentPreloadCenter));
                    for (let p of toLoad) {
                        if (!pagesLoadedStatus[p] && activePreloads < MAX_CONCURRENT_PRELOADS) {
                            const elem = pageElements[p];
                            if (elem && !elem.loaded) {
                                activePreloads++;
                                loadImageForPage(p, elem.imgEl, elem.placeEl).finally(() => { activePreloads--; if (elem)
                                        elem.loaded = true;
                                    processPreloadQueue(); });
                            }
                        } else if (!pagesLoadedStatus[p] && activePreloads >= MAX_CONCURRENT_PRELOADS) {
                            if (!preloadQueue.includes(p)) preloadQueue.push(p);
                        }
                    }
                }, 20);
            }

            function processPreloadQueue() {
                while (preloadQueue.length > 0 && activePreloads < MAX_CONCURRENT_PRELOADS) {
                    const next = preloadQueue.shift();
                    const elem = pageElements[next];
                    if (elem && !pagesLoadedStatus[next]) {
                        activePreloads++;
                        loadImageForPage(next, elem.imgEl, elem.placeEl).finally(() => { activePreloads--; if (elem)
                                elem.loaded = true;
                            processPreloadQueue(); });
                    }
                }
            }

            function startInitialLoading() {
                // load all real pages in the background
                for (let i = 1; i <= TOTAL_PAGES; i++) {
                    const elem = pageElements[i];
                    if (elem && !pagesLoadedStatus[i]) loadImageForPage(i, elem.imgEl, elem.placeEl).finally(() => { if (
                            elem) elem.loaded = true; });
                }
                scheduleSmartPreload(1);
            }

            function getOptimalBookSize(displayMode) {
                const areaRect = bookArea.getBoundingClientRect();
                const maxWidth = areaRect.width * 0.92;
                const maxHeight = areaRect.height * 0.92;
                if (displayMode === 'double') {
                    const ratio = 1.414;
                    let width = maxWidth,
                        height = width / ratio;
                    if (height > maxHeight) { height = maxHeight;
                        width = height * ratio; }
                    return { width: Math.floor(width), height: Math.floor(height) };
                } else {
                    const ratio = 0.707;
                    let width = maxWidth,
                        height = width / ratio;
                    if (height > maxHeight) { height = maxHeight;
                        width = height * ratio; }
                    return { width: Math.floor(width), height: Math.floor(height) };
                }
            }

            function updateCounter(realPage) {
                const counterEl = document.getElementById("pageCounter");
                const total = currentDisplayMode === 'double' ? TOTAL_PAGES : TOTAL_PAGES - 1; // 36 or 35
                if (currentDisplayMode === 'double') {
                    if (realPage <= 1) counterEl.innerText = `1 / ${total}`;
                    else if (realPage >= TOTAL_PAGES) counterEl.innerText = `${TOTAL_PAGES} / ${total}`;
                    else counterEl.innerText = `${realPage}–${realPage + 1} / ${total}`;
                } else {
                    counterEl.innerText = `${realPage} / ${total}`;
                }
                if (bookReady) scheduleSmartPreload(realPage);
            }

            function initFlipbook(displayMode, targetTurnPage) {
                if (bookReady) { try { $flipbook.turn("destroy"); } catch (e) {}
                    bookReady = false; }

                // List of real pages for this mode
                const realPages = getPageList(displayMode);
                currentDisplayMode = displayMode;

                // Build the DOM only with the needed real pages
                $flipbook.empty();
                realPages.forEach(realPage => {
                    if (pageElements[realPage] && pageElements[realPage].$page) {
                        $flipbook.append(pageElements[realPage].$page);
                    } else {
                        const newPage = createPageElement(realPage);
                        $flipbook.append(newPage.$page);
                    }
                });

                const { width, height } = getOptimalBookSize(displayMode);
                $flipbook.removeClass('display-single display-double').addClass('display-' + displayMode);

                $flipbook.turn({
                    width,
                    height,
                    autoCenter: true,
                    display: displayMode,
                    acceleration: true,
                    gradients: true,
                    elevation: 50,
                    duration: 420,
                    page: targetTurnPage || 1,
                    turnCorners: "", // Disable native corner drag – we provide full‑page drag
                    when: {
                        turning: function(e, turnPage) {
                            playFlipSound();
                            const realPage = getRealPageFromTurn(turnPage, realPages);
                            if (realPage >= 1 && realPage <= TOTAL_PAGES) scheduleSmartPreload(realPage);
                        },
                        turned: function(e, turnPage) {
                            const realPage = getRealPageFromTurn(turnPage, realPages);
                            currentRealPage = realPage;
                            updateCounter(realPage);
                            scheduleSmartPreload(realPage);
                        },
                        missing: function(e, turnPages) {
                            for (let tp of turnPages) {
                                const realPage = getRealPageFromTurn(tp, realPages);
                                if (realPage >= 1 && realPage <= TOTAL_PAGES && !pagesLoadedStatus[realPage]) {
                                    const elem = pageElements[realPage];
                                    if (elem && !elem.loaded) loadImageForPage(realPage, elem.imgEl, elem.placeEl)
                                        .finally(() => { if (elem) elem.loaded = true; });
                                }
                            }
                        }
                    }
                });

                bookReady = true;
                const initialTurnPage = targetTurnPage || 1;
                currentRealPage = getRealPageFromTurn(initialTurnPage, realPages);
                updateCounter(currentRealPage);
                resetZoomAndPan();
                scheduleSmartPreload(currentRealPage);

                if (torxLoader && torxLoader.style.display !== "none") {
                    torxLoader.style.opacity = "0";
                    setTimeout(() => { if (torxLoader) torxLoader.style.display = "none"; }, 350);
                }
                // ensure all real pages are loading
                for (let i = 1; i <= TOTAL_PAGES; i++) {
                    if (!pagesLoadedStatus[i]) {
                        const elem = pageElements[i];
                        if (elem && !elem.loaded) loadImageForPage(i, elem.imgEl, elem.placeEl).finally(() => { if (
                                elem) elem.loaded = true; });
                    }
                }
            }

            function initFlipbookEarly() {
                if (bookReady) return;
                initFlipbook(getDisplayMode(), 1);
            }

            // ─────────────── ZOOM & PAN ───────────────
            let currentZoom = 1,
                currentPanX = 0,
                currentPanY = 0;
            let initialZoom = 1,
                initialPanX = 0,
                initialPanY = 0;
            let pinchStartDistance = 0;
            let isPinching = false,
                isPanning = false;
            let lastTouchX = 0,
                lastTouchY = 0,
                lastPanX = 0,
                lastPanY = 0;
            let lastTapTime = 0,
                lastTapX = 0,
                lastTapY = 0,
                tapTimeout = null;
            let mouseIsDown = false,
                mouseStartX = 0,
                mouseStartY = 0,
                mouseMoved = false,
                mousePanX = 0,
                mousePanY = 0;

            function applyTransform(animate = false) {
                if (animate) {
                    zoomContainer.classList.add("animating");
                    setTimeout(() => zoomContainer.classList.remove("animating"), 280);
                } else zoomContainer.classList.remove("animating");
                zoomContainer.style.transform =
                    `translate3d(${currentPanX}px, ${currentPanY}px, 0) scale(${currentZoom})`;
                if (currentZoom > 1.02) {
                    $flipbook.css("pointer-events", "none");
                    zoomHint.classList.add("visible");
                } else {
                    $flipbook.css("pointer-events", "auto");
                    zoomHint.classList.remove("visible");
                    if (currentPanX !== 0 || currentPanY !== 0) {
                        currentPanX = 0;
                        currentPanY = 0;
                        zoomContainer.style.transform = `translate3d(0px, 0px, 0) scale(1)`;
                    }
                }
            }

            function resetZoomAndPan() {
                currentZoom = 1;
                currentPanX = 0;
                currentPanY = 0;
                applyTransform(true);
            }

            function getDistance(touches) {
                if (touches.length < 2) return 0;
                const dx = touches[0].clientX - touches[1].clientX;
                const dy = touches[0].clientY - touches[1].clientY;
                return Math.hypot(dx, dy);
            }

            function clampPan() {
                const containerRect = bookArea.getBoundingClientRect();
                const flipRect = document.getElementById("flipbook").getBoundingClientRect();
                const scaledW = flipRect.width * currentZoom;
                const scaledH = flipRect.height * currentZoom;
                const maxPanX = Math.max(0, (scaledW - containerRect.width) / 2);
                const maxPanY = Math.max(0, (scaledH - containerRect.height) / 2);
                currentPanX = Math.min(maxPanX, Math.max(-maxPanX, currentPanX));
                currentPanY = Math.min(maxPanY, Math.max(-maxPanY, currentPanY));
            }

            function isZoomedIn() { return currentZoom > 1.02; }

            // ─────────────── CUSTOM DRAG‑TO‑TURN (touch & mouse) ───────────────
            let dragStartX = 0,
                dragStartY = 0;
            let dragActive = false;
            let dragThreshold = 30;

            function startDrag(clientX, clientY) {
                if (!bookReady || isZoomedIn()) return false;
                dragStartX = clientX;
                dragStartY = clientY;
                dragActive = true;
                return true;
            }

            function updateDrag(clientX, clientY) {
                if (!dragActive || !bookReady || isZoomedIn()) return;
            }

            function endDrag(clientX, clientY) {
                if (!dragActive || !bookReady || isZoomedIn()) { dragActive = false; return; }
                dragActive = false;
                const dx = clientX - dragStartX;
                const dy = clientY - dragStartY;
                if (Math.abs(dx) > dragThreshold && Math.abs(dx) > Math.abs(dy) * 0.7) {
                    if (dx > 0) $flipbook.turn("previous");
                    else $flipbook.turn("next");
                }
            }

            function cancelDrag() { dragActive = false; }

            // ─────────────── TOUCH EVENTS ───────────────
            bookArea.addEventListener("touchstart", function(e) {
                if (!bookReady) return;
                const touches = e.touches;

                if (isZoomedIn() && touches.length === 1 && !isPinching && !isPanning) {
                    const now = Date.now();
                    const tx = touches[0].clientX,
                        ty = touches[0].clientY;
                    if (now - lastTapTime < 300 && Math.hypot(tx - lastTapX, ty - lastTapY) < 40) {
                        resetZoomAndPan();
                        e.preventDefault();
                        if (tapTimeout) clearTimeout(tapTimeout);
                        lastTapTime = 0;
                        return;
                    } else {
                        lastTapTime = now;
                        lastTapX = tx;
                        lastTapY = ty;
                        if (tapTimeout) clearTimeout(tapTimeout);
                        tapTimeout = setTimeout(() => { lastTapTime = 0; }, 300);
                    }
                }

                if (touches.length === 2) {
                    isPinching = true;
                    isPanning = false;
                    pinchStartDistance = getDistance(touches);
                    initialZoom = currentZoom;
                    initialPanX = currentPanX;
                    initialPanY = currentPanY;
                    e.preventDefault();
                    return;
                }

                if (touches.length === 1 && isZoomedIn()) {
                    isPanning = true;
                    isPinching = false;
                    lastTouchX = touches[0].clientX;
                    lastTouchY = touches[0].clientY;
                    lastPanX = currentPanX;
                    lastPanY = currentPanY;
                    e.preventDefault();
                    return;
                }

                if (touches.length === 1 && !isZoomedIn()) {
                    if (startDrag(touches[0].clientX, touches[0].clientY)) {
                        // allow turn.js to also receive
                    }
                }
            }, { passive: false });

            bookArea.addEventListener("touchmove", function(e) {
                if (!bookReady) return;
                const touches = e.touches;

                if (isPinching && touches.length === 2) {
                    const newDist = getDistance(touches);
                    if (pinchStartDistance > 0) {
                        let newZoom = initialZoom * (newDist / pinchStartDistance);
                        newZoom = Math.min(4.0, Math.max(1.0, newZoom));
                        if (newZoom !== currentZoom) {
                            currentZoom = newZoom;
                            currentPanX = initialPanX;
                            currentPanY = initialPanY;
                            applyTransform();
                        }
                    }
                    e.preventDefault();
                    return;
                }

                if (isPanning && touches.length === 1 && isZoomedIn()) {
                    const dx = touches[0].clientX - lastTouchX;
                    const dy = touches[0].clientY - lastTouchY;
                    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                        currentPanX = lastPanX + dx;
                        currentPanY = lastPanY + dy;
                        clampPan();
                        applyTransform();
                    }
                    e.preventDefault();
                    return;
                }

                if (dragActive && touches.length === 1 && !isZoomedIn()) {
                    updateDrag(touches[0].clientX, touches[0].clientY);
                }
            }, { passive: false });

            bookArea.addEventListener("touchend", function(e) {
                if (dragActive) {
                    const touch = e.changedTouches[0];
                    if (touch) endDrag(touch.clientX, touch.clientY);
                }
                isPinching = false;
                isPanning = false;
                pinchStartDistance = 0;
                cancelDrag();
            });

            bookArea.addEventListener("touchcancel", function(e) {
                isPinching = false;
                isPanning = false;
                pinchStartDistance = 0;
                cancelDrag();
            });

            // ─────────────── MOUSE EVENTS ───────────────
            bookArea.addEventListener("wheel", function(e) {
                if (!bookReady) return;
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.08 : 0.08;
                let newZoom = currentZoom + delta;
                newZoom = Math.min(4.0, Math.max(1.0, newZoom));
                if (newZoom !== currentZoom) {
                    const rect = bookArea.getBoundingClientRect();
                    const mouseX = e.clientX - rect.left,
                        mouseY = e.clientY - rect.top;
                    const centerX = rect.width / 2,
                        centerY = rect.height / 2;
                    const scale = newZoom / currentZoom;
                    currentPanX = mouseX - (mouseX - currentPanX - centerX) * scale - centerX;
                    currentPanY = mouseY - (mouseY - currentPanY - centerY) * scale - centerY;
                    currentZoom = newZoom;
                    clampPan();
                    applyTransform();
                }
            }, { passive: false });

            bookArea.addEventListener("mousedown", function(e) {
                if (!bookReady) return;
                if (e.button === 2) return;

                if (isZoomedIn()) {
                    mouseIsDown = true;
                    mouseStartX = e.clientX;
                    mouseStartY = e.clientY;
                    mouseMoved = false;
                    mousePanX = currentPanX;
                    mousePanY = currentPanY;
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }

                if (!isZoomedIn() && e.button === 0) {
                    if (startDrag(e.clientX, e.clientY)) {
                        // let the event propagate if needed
                    }
                }
            });

            window.addEventListener("mousemove", function(e) {
                if (!bookReady) return;
                if (mouseIsDown && isZoomedIn()) {
                    const dx = e.clientX - mouseStartX,
                        dy = e.clientY - mouseStartY;
                    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) mouseMoved = true;
                    if (mouseMoved) {
                        currentPanX = mousePanX + dx;
                        currentPanY = mousePanY + dy;
                        clampPan();
                        applyTransform();
                    }
                }
                if (dragActive && !isZoomedIn()) {
                    updateDrag(e.clientX, e.clientY);
                }
            });

            window.addEventListener("mouseup", function(e) {
                if (mouseIsDown) {
                    mouseIsDown = false;
                    mouseMoved = false;
                }
                if (dragActive) {
                    endDrag(e.clientX, e.clientY);
                    cancelDrag();
                }
            });

            bookArea.addEventListener("contextmenu", e => e.preventDefault());
            bookArea.addEventListener("dblclick", function() { if (bookReady && isZoomedIn()) resetZoomAndPan(); });

            // ─────────────── BUTTON CONTROLS ───────────────
            document.getElementById("zoomInBtn").addEventListener("click", () => {
                if (!bookReady) return;
                currentZoom = Math.min(4.0, currentZoom + 0.2);
                if (!isZoomedIn()) { currentPanX = 0;
                    currentPanY = 0; }
                applyTransform();
            });
            document.getElementById("zoomOutBtn").addEventListener("click", () => {
                if (!bookReady) return;
                currentZoom = Math.max(1.0, currentZoom - 0.2);
                if (!isZoomedIn()) { currentPanX = 0;
                    currentPanY = 0; }
                applyTransform();
            });
            document.getElementById("prevBtn").addEventListener("click", () => { if (bookReady) $flipbook.turn(
                    "previous"); });
            document.getElementById("nextBtn").addEventListener("click", () => { if (bookReady) $flipbook.turn("next"); });
            document.getElementById("downloadPDF").addEventListener("click", () => {
                const link = document.createElement("a");
                link.href = "Slock-Catalog.pdf";
                link.download = "Slock-Catalog.pdf";
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            });
            document.addEventListener("keydown", (e) => {
                if (!bookReady) return;
                if (e.key === "ArrowLeft") $flipbook.turn("previous");
                if (e.key === "ArrowRight") $flipbook.turn("next");
            });

            // ─────────────── RESIZE HANDLING ───────────────
            let resizeDebounce, lastKnownDisplayMode = getDisplayMode();
            window.addEventListener("resize", () => {
                clearTimeout(resizeDebounce);
                resizeDebounce = setTimeout(() => {
                    const newMode = getDisplayMode();
                    if (newMode !== lastKnownDisplayMode) {
                        const targetTurnPage = getTurnPageForReal(currentRealPage, newMode);
                        lastKnownDisplayMode = newMode;
                        initFlipbook(newMode, targetTurnPage);
                    } else if (bookReady) {
                        const newSize = getOptimalBookSize(newMode);
                        $flipbook.turn("size", newSize.width, newSize.height);
                        resetZoomAndPan();
                    }
                }, 300);
            });

            // ─────────────── STARTUP ───────────────
            lastKnownDisplayMode = getDisplayMode();
            buildAllPageElements();
            startInitialLoading();

            setTimeout(() => {
                if (torxLoader && torxLoader.style.display !== "none") {
                    if (!bookReady) initFlipbookEarly();
                    torxLoader.style.opacity = "0";
                    setTimeout(() => { if (torxLoader) torxLoader.style.display = "none"; }, 400);
                }
            }, 6000);

            setTimeout(() => {
                zoomHint.classList.add("visible");
                setTimeout(() => zoomHint.classList.remove("visible"), 4000);
            }, 2000);
        })();