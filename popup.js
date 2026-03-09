let currentTabId = null;
let capturedHierarchy = [];
let ignoredClasses = new Set();
let multiPaths = [];

function updateToggleVisual(checked) {
    const wrapper = document.getElementById("setup-toggle-wrapper");
    if (wrapper) wrapper.classList.toggle("setup-toggle--active", checked);
}

function showToast(message, duration = 1800) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("toast--visible");
    setTimeout(() => { toast.classList.remove("toast--visible"); }, duration);
}

async function init() {
    let tabId = null;

    const urlParams = new URLSearchParams(window.location.search);
    const isEmbedded = urlParams.has("embedded");

    if (urlParams.has("tabId")) {

        tabId = parseInt(urlParams.get("tabId"), 10);


        document.getElementById("dock-to-page").style.display = "none";

    } else {

        document.getElementById("dock-to-page").addEventListener("click", () => {
            if (!currentTabId) {
                showToast("No active page connection");
                return;
            }
            const popupUrl = chrome.runtime.getURL("popup.html");
            const ignoredArr = Array.from(ignoredClasses).join(",");
            chrome.tabs.sendMessage(currentTabId, {
                action: "injectOverlay",
                position: "bottom-right",
                url: `${popupUrl}?tabId=${currentTabId}&ignored=${encodeURIComponent(ignoredArr)}&embedded=true`
            });
            window.close();
        });

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) {
            document.getElementById("hierarchy").innerHTML =
                `<div class="hierarchy-tree__empty">
                    <span class="hierarchy-tree__empty-icon" aria-hidden="true">⚠️</span>
                    <span class="hierarchy-tree__empty-text">Cannot be used on this page.</span>
                </div>`;
            return;
        }
        tabId = tab.id;
    }

    currentTabId = tabId;


    function sendHeartbeat() {
        chrome.tabs.sendMessage(currentTabId, { action: "heartbeat" }).catch(() => { });
    }
    sendHeartbeat();
    setTimeout(sendHeartbeat, 100);
    setTimeout(sendHeartbeat, 300);
    setTimeout(sendHeartbeat, 600);
    setInterval(sendHeartbeat, 800);


    function ignoreAllClasses(hierarchy) {
        ignoredClasses.clear();
        hierarchy.forEach(item => {
            if (item.classes) {
                item.classes.split(/\s+/).forEach(c => { if (c) ignoredClasses.add(c); });
            }
        });
    }

    function fetchStatus() {
        chrome.tabs.sendMessage(currentTabId, { action: "getStatus" }, (response) => {
            if (chrome.runtime.lastError) return;
            if (response) {
                if (response.textSelectionMode) {
                    document.getElementById("text-mode-checkbox").checked = true;
                    updateToggleVisual(true);
                }
                if (response.hierarchy && response.hierarchy.length > 0) {
                    capturedHierarchy = response.hierarchy;
                    ignoreAllClasses(capturedHierarchy);
                    renderHierarchy();
                }
                if (response.multiPaths) {
                    multiPaths = response.multiPaths;
                    renderMultiPaths();
                }
            }


            if (urlParams.has("ignored")) {
                const passedIgnored = urlParams.get("ignored");
                if (passedIgnored) {
                    passedIgnored.split(",").forEach(c => ignoredClasses.add(c));
                    renderHierarchy();
                }
            }
        });
    }
    fetchStatus();

    if (isEmbedded) {
        setTimeout(fetchStatus, 500);
        setTimeout(fetchStatus, 1200);
    }


    const textModeCB = document.getElementById("text-mode-checkbox");
    textModeCB.addEventListener("change", (e) => {
        updateToggleVisual(e.target.checked);
        chrome.tabs.sendMessage(currentTabId, { action: "setTextSelectionMode", enabled: e.target.checked });
    });


    chrome.runtime.onMessage.addListener((msg, sender) => {
        if (msg.action === "elementClicked" && sender.tab && sender.tab.id === currentTabId) {
            capturedHierarchy = msg.hierarchy;
            ignoreAllClasses(capturedHierarchy);
            renderHierarchy();
        }
    });


    document.getElementById("paint-all").addEventListener("click", handlePaintAll);

    function handlePaintAll() {
        if (capturedHierarchy.length === 0) return;
        const selectors = capturedHierarchy
            .map(item => {
                const valid = item.classes ? item.classes.split(/\s+/).filter(c => c && !ignoredClasses.has(c)) : [];
                return valid.length > 0 ? "." + valid.map(c => CSS.escape(c)).join(".") : null;
            })
            .filter(s => s !== null);

        if (selectors.length > 0) {
            chrome.tabs.sendMessage(currentTabId, { action: "paint", selector: selectors.join(", ") });
            showToast("Painting " + selectors.length + " selector(s)");
        } else {
            showToast("No classes left to paint");
        }
    }


    document.getElementById("test-selector").addEventListener("click", handleTestSelector);

    function handleTestSelector() {
        const selector = document.getElementById("custom-selector").value.trim();
        if (selector) {
            chrome.tabs.sendMessage(currentTabId, { action: "paint", selector });
            showToast("Testing selector");
        }
    }


    document.getElementById("copy-path").addEventListener("click", () => {
        const text = document.getElementById("path-select").value;
        navigator.clipboard.writeText(text).then(() => {
            showToast("Path copied to clipboard");
        });
    });


    document.getElementById("global-select-all").addEventListener("click", () => {
        ignoredClasses.clear();
        renderHierarchy();
    });

    document.getElementById("global-deselect-all").addEventListener("click", () => {
        capturedHierarchy.forEach(item => {
            if (item.classes) {
                item.classes.split(/\s+/).forEach(c => { if (c) ignoredClasses.add(c); });
            }
        });
        renderHierarchy();
    });


    document.getElementById("store-path").addEventListener("click", () => {
        const selector = document.getElementById("path-select").value.trim();
        if (selector && !multiPaths.includes(selector)) {
            multiPaths.push(selector);
            chrome.tabs.sendMessage(currentTabId, { action: "storeMultiPath", path: selector });
            renderMultiPaths();
            showToast("Path stored");
        }
    });

    document.getElementById("reset-multi-path").addEventListener("click", () => {
        multiPaths = [];
        chrome.tabs.sendMessage(currentTabId, { action: "resetMultiPath" });
        renderMultiPaths();
        showToast("Multi context cleared");
    });

    document.getElementById("copy-multi-path").addEventListener("click", () => {
        const text = document.getElementById("multi-path-select").value;
        navigator.clipboard.writeText(text).then(() => {
            showToast("Multi paths copied");
        });
    });

    document.getElementById("paint-multi").addEventListener("click", () => {
        if (multiPaths.length > 0) {
            chrome.tabs.sendMessage(currentTabId, { action: "paintMulti", paths: multiPaths });
            showToast("Highlighting " + multiPaths.length + " path(s)");
        }
    });

    document.getElementById("multi-path-display").addEventListener("blur", (e) => {
        let rawText = e.target.textContent;
        if (rawText.trim() === "Multiple CSS paths concatenated here...") return;
        let paths = rawText.split(",").map(s => s.trim()).filter(s => s);
        multiPaths = paths;
        chrome.tabs.sendMessage(currentTabId, { action: "updateMultiPaths", paths: multiPaths });
        renderMultiPaths();
    });
}

function updatePathSelect() {
    let pathParts = [];
    let lastWasSkipped = false;

    for (let i = capturedHierarchy.length - 1; i >= 0; i--) {
        let item = capturedHierarchy[i];
        let tagName = item.tagName.toLowerCase();
        let validClasses = item.classes ? item.classes.split(/\s+/).filter(c => c && !ignoredClasses.has(c)) : [];

        if (i !== 0 && validClasses.length === 0 && (tagName === "div" || tagName === "span" || tagName === "body" || tagName === "html")) {
            lastWasSkipped = true;
            continue;
        }

        let classStr = validClasses.map(c => `.${CSS.escape(c)}`).join("");
        let selStr = tagName + classStr;

        if (item.siblingRelation && item.prevSibling) {
            let sibValidClasses = item.prevSibling.classes ? item.prevSibling.classes.split(/\s+/).filter(c => c && !ignoredClasses.has(c)) : [];
            let sibClassStr = sibValidClasses.map(c => `.${CSS.escape(c)}`).join("");
            let psStr = item.prevSibling.tagName + sibClassStr;
            selStr = psStr + ` ${item.siblingRelation} ` + selStr;
        }

        if (pathParts.length > 0) {
            pathParts.push(lastWasSkipped ? " " : " > ");
        }
        pathParts.push(selStr);
        lastWasSkipped = false;
    }

    let finalSelector = pathParts.join("");
    document.getElementById("path-select").value = finalSelector;
    document.getElementById("custom-selector").value = finalSelector;


    const badge = document.getElementById("path-badge");
    if (badge) badge.style.display = finalSelector ? "inline-flex" : "none";
}

function renderHierarchy() {
    const container = document.getElementById("hierarchy");
    container.innerHTML = "";

    if (capturedHierarchy.length === 0) {
        container.innerHTML = `<div class="hierarchy-tree__empty">
            <span class="hierarchy-tree__empty-icon" aria-hidden="true">🔍</span>
            <span class="hierarchy-tree__empty-text">No element selected. Click an element on the page.</span>
        </div>`;
        return;
    }

    capturedHierarchy.forEach((item, index) => {
        const node = document.createElement("div");
        node.className = "hierarchy-node" + (index === 0 ? " hierarchy-node--target" : "");

        const tagName = item.tagName.toLowerCase();


        const header = document.createElement("div");
        header.className = "hierarchy-node__header";

        const tagLabel = document.createElement("span");
        tagLabel.className = "hierarchy-node__tag";
        tagLabel.innerHTML =
            `<span class="hierarchy-node__tag-role">${index === 0 ? "Target" : "Parent"}</span>` +
            `<span class="hierarchy-node__tag-name">${tagName}</span>`;
        header.appendChild(tagLabel);

        if (item.classes) {
            let classList = item.classes.split(/\s+/).filter(c => c);


            if (classList.length > 1) {
                const controls = document.createElement("div");
                controls.className = "hierarchy-node__controls";

                const selectAllBtn = document.createElement("button");
                selectAllBtn.className = "btn btn--link btn--sm";
                selectAllBtn.textContent = "Select All";
                selectAllBtn.addEventListener("click", () => {
                    classList.forEach(c => ignoredClasses.delete(c));
                    renderHierarchy();
                });

                const ignoreAllBtn = document.createElement("button");
                ignoreAllBtn.className = "btn btn--link btn--sm";
                ignoreAllBtn.textContent = "Ignore All";
                ignoreAllBtn.addEventListener("click", () => {
                    classList.forEach(c => ignoredClasses.add(c));
                    renderHierarchy();
                });

                controls.appendChild(selectAllBtn);
                controls.appendChild(ignoreAllBtn);
                header.appendChild(controls);
            }

            node.appendChild(header);


            const chipsContainer = document.createElement("div");
            chipsContainer.className = "hierarchy-node__chips";

            classList.forEach(c => {
                const chip = document.createElement("span");
                chip.className = "chip" + (ignoredClasses.has(c) ? " ignored" : "");
                chip.textContent = `.${c}`;

                chip.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (ignoredClasses.has(c)) {
                        ignoredClasses.delete(c);
                    } else {
                        ignoredClasses.add(c);
                    }
                    renderHierarchy();
                });
                chipsContainer.appendChild(chip);
            });

            node.appendChild(chipsContainer);
        } else {
            node.appendChild(header);
        }


        if (item.prevSibling) {
            const sibDiv = document.createElement("div");
            sibDiv.className = "sibling-anchor";

            const relLabel = document.createElement("span");
            relLabel.className = "sibling-anchor__label";
            relLabel.textContent = "Sibling Anchor:";
            sibDiv.appendChild(relLabel);

            const relSelect = document.createElement("select");
            relSelect.className = "sibling-anchor__select";
            relSelect.innerHTML = `
                <option value="">Off</option>
                <option value="+" ${item.siblingRelation === '+' ? 'selected' : ''}>+ Adjacent</option>
                <option value="~" ${item.siblingRelation === '~' ? 'selected' : ''}>~ General</option>
            `;
            relSelect.addEventListener("change", (e) => {
                item.siblingRelation = e.target.value;
                updatePathSelect();
            });
            sibDiv.appendChild(relSelect);

            const sibTarget = document.createElement("span");
            sibTarget.className = "sibling-anchor__target";
            let sibValidClasses = item.prevSibling.classes ? item.prevSibling.classes.split(/\s+/).filter(c => c && !ignoredClasses.has(c)) : [];
            let sibClassStr = sibValidClasses.map(c => `.${c}`).join("");
            sibTarget.textContent = `${item.prevSibling.tagName}${sibClassStr}`;
            sibDiv.appendChild(sibTarget);

            node.appendChild(sibDiv);
        }

        container.appendChild(node);
    });


    updatePathSelect();
}

function renderMultiPaths() {
    const hiddenTa = document.getElementById("multi-path-select");
    if (hiddenTa) hiddenTa.value = multiPaths.join(", ");

    const displayContainer = document.getElementById("multi-path-display");
    if (!displayContainer) return;

    displayContainer.innerHTML = "";

    const colors = [
        "hsl(220, 90%, 55%)",
        "hsl(150, 70%, 42%)",
        "hsl(340, 75%, 55%)",
        "hsl(35,  90%, 52%)",
        "hsl(270, 70%, 55%)",
    ];

    if (multiPaths.length === 0) {
        displayContainer.innerHTML = '<span class="multi-path-display__placeholder">Multiple CSS paths concatenated here...</span>';
        return;
    }

    multiPaths.forEach((path, index) => {
        let hexColor;
        if (index < colors.length) {
            hexColor = colors[index];
        } else {
            let hash = 0;
            for (let i = 0; i < path.length; i++) hash = path.charCodeAt(i) + ((hash << 5) - hash);
            hexColor = "hsl(" + (Math.abs(hash) % 360) + ", 65%, 50%)";
        }

        const span = document.createElement("span");
        span.style.color = hexColor;
        span.style.fontWeight = "600";
        span.textContent = path;
        displayContainer.appendChild(span);

        if (index < multiPaths.length - 1) {
            const comma = document.createElement("span");
            comma.style.color = "var(--text-muted)";
            comma.textContent = ", ";
            displayContainer.appendChild(comma);
        }
    });
}

init();
