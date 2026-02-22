let currentTabId = null;
let capturedHierarchy = [];
let ignoredClasses = new Set(); // Stores strings of ignored auto-generated classes
let multiPaths = [];

async function init() {
    let tabId = null;

    // Check if we are running in a detached window
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('tabId')) {
        tabId = parseInt(urlParams.get('tabId'), 10);

        // Setup popup window state
        document.getElementById('pin-popup').style.display = 'none';
        const aotBtn = document.getElementById('always-on-top');
        aotBtn.style.display = 'inline-block';

        let isAlwaysOnTop = urlParams.get('aot') === 'true';
        aotBtn.textContent = isAlwaysOnTop ? "✅ Pinned to Top" : "📌 Stay on Top";

        // Enforce the always on top state immediately
        chrome.windows.getCurrent((win) => {
            chrome.windows.update(win.id, { alwaysOnTop: isAlwaysOnTop });
        });

        // Toggle state when clicked
        aotBtn.addEventListener('click', () => {
            isAlwaysOnTop = !isAlwaysOnTop;
            chrome.windows.getCurrent((win) => {
                chrome.windows.update(win.id, { alwaysOnTop: isAlwaysOnTop });
            });
            aotBtn.textContent = isAlwaysOnTop ? "✅ Pinned to Top" : "📌 Stay on Top";
        });
    } else {
        // Get active tab in normal popup mode
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) {
            document.getElementById("hierarchy").innerHTML = "<div class='empty-state'>Cannot be used on this page.</div>";
            return;
        }
        tabId = tab.id;
    }

    currentTabId = tabId;

    // Send a regular heartbeat to keep content.js 'active' capturing clicks
    setInterval(() => {
        chrome.tabs.sendMessage(currentTabId, { action: "heartbeat" }).catch(() => { });
    }, 800);
    chrome.tabs.sendMessage(currentTabId, { action: "heartbeat" }).catch(() => { });

    // Proactively ask content script if it already has a cache loaded
    chrome.tabs.sendMessage(currentTabId, { action: "getStatus" }, (response) => {
        if (chrome.runtime.lastError) return; // ignore connection errors while warming up
        if (response) {
            if (response.textSelectionMode) {
                document.getElementById("text-mode-checkbox").checked = true;
            }
            if (response.hierarchy && response.hierarchy.length > 0) {
                capturedHierarchy = response.hierarchy;
                renderHierarchy();
            }
            if (response.multiPaths) {
                multiPaths = response.multiPaths;
                renderMultiPaths();
            }
        }

        // Recover ignored classes from detached window URL params
        if (urlParams.has('ignored')) {
            const passedIgnored = urlParams.get('ignored');
            if (passedIgnored) {
                passedIgnored.split(',').forEach(c => ignoredClasses.add(c));
                renderHierarchy();
            }
        }
    });

    document.getElementById("text-mode-checkbox").addEventListener("change", (e) => {
        chrome.tabs.sendMessage(currentTabId, { action: "setTextSelectionMode", enabled: e.target.checked });
    });

    // Listen for messages from the content script (clicked elements tracking)
    chrome.runtime.onMessage.addListener((msg, sender) => {
        if (msg.action === "elementClicked" && sender.tab && sender.tab.id === currentTabId) {
            capturedHierarchy = msg.hierarchy;
            renderHierarchy();
        }
    });

    // UI Event Listeners
    document.getElementById("paint-all").addEventListener("click", () => {
        if (capturedHierarchy.length === 0) return;

        // Construct a selector from all captured classes (excluding ignored ones)
        const selectors = capturedHierarchy
            .map(item => {
                const valid = item.classes ? item.classes.split(/\s+/).filter(c => c && !ignoredClasses.has(c)) : [];
                return valid.length > 0 ? "." + valid.map(c => CSS.escape(c)).join(".") : null;
            })
            .filter(s => s !== null); // Removing any levels that became entirely ignored

        if (selectors.length > 0) {
            chrome.tabs.sendMessage(currentTabId, {
                action: "paint",
                selector: selectors.join(", ")
            });
        } else {
            alert("No classes left to paint because they are all ignored or empty.");
        }
    });

    document.getElementById("test-selector").addEventListener("click", () => {
        const selector = document.getElementById("custom-selector").value.trim();
        if (selector) {
            chrome.tabs.sendMessage(currentTabId, {
                action: "paint",
                selector: selector
            });
        }
    });

    document.getElementById("copy-path").addEventListener("click", () => {
        const ta = document.getElementById("path-select");
        ta.select();
        document.execCommand('copy'); // Fallback for simple popup context
        const copyBtn = document.getElementById("copy-path");
        const originalText = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = originalText; }, 1500);
    });

    document.getElementById("pin-popup").addEventListener("click", () => {
        // Pass the tab connection AND the ignored classes over to the pinned window
        const ignoredArr = Array.from(ignoredClasses).join(',');

        chrome.windows.create({
            url: `popup.html?tabId=${currentTabId}&ignored=${encodeURIComponent(ignoredArr)}&aot=true`,
            type: "panel",
            width: 380,
            height: 640
        });
        window.close(); // Close the current disappearing popup
    });

    // Global Select All / Ignore All Listeners
    document.getElementById("global-select-all").addEventListener("click", () => {
        ignoredClasses.clear();
        renderHierarchy();
    });

    document.getElementById("global-deselect-all").addEventListener("click", () => {
        capturedHierarchy.forEach(item => {
            if (item.classes) {
                item.classes.split(/\s+/).forEach(c => {
                    if (c) ignoredClasses.add(c);
                });
            }
        });
        renderHierarchy();
    });

    // Multi Context Event Listeners
    document.getElementById("store-path").addEventListener("click", () => {
        const selector = document.getElementById("path-select").value.trim();
        if (selector && !multiPaths.includes(selector)) {
            multiPaths.push(selector);
            chrome.tabs.sendMessage(currentTabId, { action: "storeMultiPath", path: selector });
            renderMultiPaths();
        }
    });

    document.getElementById("reset-multi-path").addEventListener("click", () => {
        multiPaths = [];
        chrome.tabs.sendMessage(currentTabId, { action: "resetMultiPath" });
        renderMultiPaths();
    });

    document.getElementById("copy-multi-path").addEventListener("click", () => {
        const ta = document.getElementById("multi-path-select");
        ta.select();
        document.execCommand('copy');
        const copyBtn = document.getElementById("copy-multi-path");
        const originalText = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = originalText; }, 1500);
    });

    document.getElementById("paint-multi").addEventListener("click", () => {
        if (multiPaths.length > 0) {
            chrome.tabs.sendMessage(currentTabId, {
                action: "paintMulti",
                paths: multiPaths
            });
        }
    });

    document.getElementById("multi-path-display").addEventListener("blur", (e) => {
        // Parse the manual user string modifications out of the visible display
        let rawText = e.target.textContent;
        if (rawText.trim() === "Multiple CSS paths concatenated here...") return;

        let paths = rawText.split(',').map(s => s.trim()).filter(s => s);
        multiPaths = paths;
        chrome.tabs.sendMessage(currentTabId, { action: "updateMultiPaths", paths: multiPaths });
        renderMultiPaths();
    });
}

function updatePathSelect() {
    let pathParts = [];
    let lastWasSkipped = false;

    // Reverse because hierarchy is [target, parent, grandparent, ... body]
    for (let i = capturedHierarchy.length - 1; i >= 0; i--) {
        let item = capturedHierarchy[i];
        let tagName = item.tagName.toLowerCase();
        let validClasses = item.classes ? item.classes.split(/\s+/).filter(c => c && !ignoredClasses.has(c)) : [];

        // Skip unimportant wrappers unless it's the target element itself
        if (i !== 0 && validClasses.length === 0 && (tagName === "div" || tagName === "span" || tagName === "body" || tagName === "html")) {
            lastWasSkipped = true;
            continue; // Skip this unidentifiable parent node
        }

        let classStr = validClasses.map(c => `.${CSS.escape(c)}`).join("");
        let selStr = tagName + classStr;

        // Apply Sibling Relationship logic if the user selected + or ~
        if (item.siblingRelation && item.prevSibling) {
            let sibValidClasses = item.prevSibling.classes ? item.prevSibling.classes.split(/\s+/).filter(c => c && !ignoredClasses.has(c)) : [];
            let sibClassStr = sibValidClasses.map(c => `.${CSS.escape(c)}`).join("");
            let psStr = item.prevSibling.tagName + sibClassStr;
            selStr = psStr + ` ${item.siblingRelation} ` + selStr;
        }

        if (pathParts.length > 0) {
            // " > " enforces direct child. But if we skipped intermediate parents, they are now descendants, requiring " ".
            pathParts.push(lastWasSkipped ? " " : " > ");
        }
        pathParts.push(selStr);
        lastWasSkipped = false;
    }

    let finalSelector = pathParts.join("");
    document.getElementById("path-select").value = finalSelector;
    document.getElementById("custom-selector").value = finalSelector; // Also auto-fill the tester
}

function renderHierarchy() {
    const container = document.getElementById("hierarchy");
    container.innerHTML = "";

    if (capturedHierarchy.length === 0) {
        container.innerHTML = "<div class='empty-state'>No element selected.</div>";
        return;
    }

    capturedHierarchy.forEach((item, index) => {
        const div = document.createElement("div");
        div.className = "class-item";

        const tagName = item.tagName.toLowerCase();

        const label = document.createElement("span");
        label.style.fontWeight = "bold";
        label.textContent = (index === 0 ? "Target: " : "Parent: ") + tagName;
        div.appendChild(label);

        if (item.classes) {
            let classList = item.classes.split(/\s+/).filter(c => c);

            // Per-element Select All / Ignore All controls
            if (classList.length > 1) {
                const controlsContainer = document.createElement("div");
                controlsContainer.className = "item-controls";

                const selectAllBtn = document.createElement("button");
                selectAllBtn.textContent = "(Select All)";
                selectAllBtn.addEventListener("click", () => {
                    classList.forEach(c => ignoredClasses.delete(c));
                    renderHierarchy();
                });

                const ignoreAllBtn = document.createElement("button");
                ignoreAllBtn.textContent = "(Ignore All)";
                ignoreAllBtn.addEventListener("click", () => {
                    classList.forEach(c => ignoredClasses.add(c));
                    renderHierarchy();
                });

                controlsContainer.appendChild(selectAllBtn);
                controlsContainer.appendChild(ignoreAllBtn);
                div.appendChild(controlsContainer);
            }

            // Line break before chips
            div.appendChild(document.createElement("br"));

            classList.forEach(c => {
                const chip = document.createElement("span");
                // If the class is ignored, add the 'ignored' stylesheet class
                chip.className = "chip" + (ignoredClasses.has(c) ? " ignored" : "");
                chip.textContent = `.${c}`;

                // Toggle ignored status onclick
                chip.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (ignoredClasses.has(c)) {
                        ignoredClasses.delete(c);
                    } else {
                        ignoredClasses.add(c);
                    }
                    // Re-render UI and path select
                    renderHierarchy();
                });
                div.appendChild(chip);
            });
        }

        // Render Sibling Controller
        if (item.prevSibling) {
            const siblingDiv = document.createElement("div");
            siblingDiv.style.marginTop = "6px";
            siblingDiv.style.padding = "4px 6px";
            siblingDiv.style.background = "#eef2f5";
            siblingDiv.style.borderRadius = "4px";
            siblingDiv.style.fontSize = "11px";

            const relLabel = document.createElement("span");
            relLabel.textContent = "Anchored to Sibling: ";
            siblingDiv.appendChild(relLabel);

            const relSelect = document.createElement("select");
            relSelect.style.fontSize = "10px";
            relSelect.style.border = "1px solid #ccc";
            relSelect.style.borderRadius = "3px";
            relSelect.style.cursor = "pointer";
            relSelect.innerHTML = `
                <option value="">Off</option>
                <option value="+" ${item.siblingRelation === '+' ? 'selected' : ''}>+ Adjacent</option>
                <option value="~" ${item.siblingRelation === '~' ? 'selected' : ''}>~ General</option>
            `;
            relSelect.addEventListener("change", (e) => {
                item.siblingRelation = e.target.value;
                updatePathSelect();
            });
            siblingDiv.appendChild(relSelect);

            const sibTarget = document.createElement("span");
            let sibValidClasses = item.prevSibling.classes ? item.prevSibling.classes.split(/\s+/).filter(c => c && !ignoredClasses.has(c)) : [];
            let sibClassStr = sibValidClasses.map(c => `.${c}`).join("");
            sibTarget.textContent = ` ${item.prevSibling.tagName}${sibClassStr}`;
            sibTarget.style.marginLeft = "6px";
            sibTarget.style.color = "#666";
            sibTarget.style.wordBreak = "break-all";
            siblingDiv.appendChild(sibTarget);

            div.appendChild(siblingDiv);
        }

        container.appendChild(div);
    });

    // Recompile path whenever we render hierarchy
    updatePathSelect();
}

function renderMultiPaths() {
    const hiddenTa = document.getElementById("multi-path-select");
    if (hiddenTa) hiddenTa.value = multiPaths.join(", ");

    const displayContainer = document.getElementById("multi-path-display");
    if (!displayContainer) return;

    displayContainer.innerHTML = "";

    const colors = ["#ef4444", "#3b82f6", "#22c55e"]; // red, blue, green

    if (multiPaths.length === 0) {
        displayContainer.innerHTML = '<span style="color: #999; font-style: italic;">Multiple CSS paths concatenated here...</span>';
        return;
    }

    multiPaths.forEach((path, index) => {
        let hexColor = "";
        if (index < colors.length) {
            hexColor = colors[index];
        } else {
            // Predictable random-ish based on path string to stop flashing
            let hash = 0;
            for (let i = 0; i < path.length; i++) hash = path.charCodeAt(i) + ((hash << 5) - hash);
            hexColor = "#" + (hash & 0x00FFFFFF).toString(16).padStart(6, '0');
        }

        const span = document.createElement("span");
        span.style.color = hexColor;
        span.style.fontWeight = "bold";
        span.textContent = path;

        displayContainer.appendChild(span);

        if (index < multiPaths.length - 1) {
            const comma = document.createElement("span");
            comma.style.color = "#333";
            comma.textContent = ", ";
            displayContainer.appendChild(comma);
        }
    });
}

init();
