// State caching
let isActive = false;
let recentlyClosed = false;
let styleTag = null;
let cachedHierarchy = [];
let isTextSelectionMode = false;
let heartbeatTimer = null;
let storedMultiPaths = [];

// Allow fetching current active state and cache via quick messages too
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "heartbeat") {
        // As long as the popup (attached or detached) is sending heartbeats, stay active
        isActive = true;
        clearTimeout(heartbeatTimer);
        heartbeatTimer = setTimeout(() => {
            isActive = false; // Turn off if popup dies
            recentlyClosed = true;
            setTimeout(() => { recentlyClosed = false; }, 500);
            removeInjectedStyles();
        }, 1500);
        sendResponse({ success: true });
    } else if (request.action === "paint") {
        injectStyles(request.selector);
    } else if (request.action === "paintMulti") {
        injectMultiStyles(request.paths);
    } else if (request.action === "getStatus") {
        sendResponse({ isActive: isActive, hasCache: cachedHierarchy.length > 0, textSelectionMode: isTextSelectionMode, hierarchy: cachedHierarchy, multiPaths: storedMultiPaths });
    } else if (request.action === "setTextSelectionMode") {
        isTextSelectionMode = request.enabled;
    } else if (request.action === "storeMultiPath") {
        if (request.path && !storedMultiPaths.includes(request.path)) {
            storedMultiPaths.push(request.path);
        }
    } else if (request.action === "resetMultiPath") {
        storedMultiPaths = [];
    } else if (request.action === "updateMultiPaths") {
        storedMultiPaths = request.paths || [];
    }
});



// Intercept click to prevent navigations even if the popup literally just closed
document.addEventListener("click", (e) => {
    if (isActive || recentlyClosed) {
        e.preventDefault();
        e.stopPropagation();
    }
}, true);

function captureHierarchy(startingElement) {
    const hierarchy = [];
    let currentElement = startingElement;

    while (currentElement && currentElement !== document.documentElement) {
        const tagName = currentElement.tagName.toLowerCase();

        // Capture and trim classes robustly
        const classes = currentElement.className && typeof currentElement.className === "string"
            ? currentElement.className.trim()
            : "";

        let prev = currentElement.previousElementSibling;
        let prevSiblingInfo = null;
        if (prev) {
            prevSiblingInfo = {
                tagName: prev.tagName.toLowerCase(),
                classes: prev.className && typeof prev.className === "string" ? prev.className.trim() : ""
            };
        }

        hierarchy.push({ tagName, classes, prevSibling: prevSiblingInfo });

        if (tagName === "body") {
            break;
        }

        currentElement = currentElement.parentElement;
    }

    // Save it in the content script memory
    cachedHierarchy = hierarchy;

    // Send the captured hierarchy back to the popup if it's active
    if (isActive) {
        chrome.runtime.sendMessage({ action: "elementClicked", hierarchy: cachedHierarchy }).catch(() => { });
    }
}

// Use mousedown instead of click to ensure we catch it before Chrome closes the popup
document.addEventListener("mousedown", (e) => {
    // If you click inside the popup (which is out of the page context anyway, but just in case), do nothing.
    if (!isActive && !recentlyClosed) return;
    if (isTextSelectionMode) return; // Handled by mouseup text selection

    captureHierarchy(e.target);
}, true); // Use capturing phase to intercept early before other scripts

// Support for Text Selection Mode capture
document.addEventListener("mouseup", (e) => {
    if (!isActive && !recentlyClosed) return;
    if (!isTextSelectionMode) return;

    setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.toString().trim() === "") return;

        let range = selection.getRangeAt(0);
        let container = range.commonAncestorContainer;
        if (container.nodeType === 3) {
            container = container.parentElement;
        }

        // Find ALL elements inside the container that are actually part of the selection
        let selectedElements = new Set();
        let walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            if (selection.containsNode(node, true) && node.textContent.trim() !== "") {
                selectedElements.add(node.parentElement);
            }
        }

        if (selectedElements.size <= 1) {
            // Fallback to normal single element capture if only 1 text node matched
            captureHierarchy(selectedElements.size === 1 ? Array.from(selectedElements)[0] : container);
            return;
        }

        // Multiple elements selected! We must find their COMMON traits (Intersection of classes)
        // rather than the Union, otherwise we generate mutually exclusive selectors like .red.blue
        let tags = new Set();
        let classIntersection = null;

        selectedElements.forEach(el => {
            tags.add(el.tagName.toLowerCase());

            let elClasses = new Set();
            if (el.className && typeof el.className === "string") {
                el.className.trim().split(/\s+/).forEach(c => {
                    if (c) elClasses.add(c);
                });
            }

            if (classIntersection === null) {
                // First element initializes the intersection
                classIntersection = new Set(elClasses);
            } else {
                // Subsequent elements reduce the intersection
                for (let c of classIntersection) {
                    if (!elClasses.has(c)) {
                        classIntersection.delete(c);
                    }
                }
            }
        });

        // If multiple different tags were selected, wrap them in CSS :is()
        let tagArr = Array.from(tags);
        let combinedTagName = tagArr.length > 1 ? ":is(" + tagArr.join(", ") + ")" : tagArr[0];
        let combinedClasses = classIntersection ? Array.from(classIntersection).join(" ") : "";

        // Build the normal hierarchy for the common ancestor container
        let hierarchy = [];
        let currentElement = container;
        while (currentElement && currentElement !== document.documentElement) {
            const tagName = currentElement.tagName.toLowerCase();
            const classes = currentElement.className && typeof currentElement.className === "string" ? currentElement.className.trim() : "";

            let prev = currentElement.previousElementSibling;
            let prevSiblingInfo = null;
            if (prev) {
                prevSiblingInfo = {
                    tagName: prev.tagName.toLowerCase(),
                    classes: prev.className && typeof prev.className === "string" ? prev.className.trim() : ""
                };
            }

            hierarchy.push({ tagName, classes, prevSibling: prevSiblingInfo });
            if (tagName === "body") break;
            currentElement = currentElement.parentElement;
        }

        // Prepend our synthesized multiple-target node to the front of the hierarchy (index 0)
        hierarchy.unshift({ tagName: combinedTagName, classes: combinedClasses, prevSibling: null });

        cachedHierarchy = hierarchy;
        if (isActive) {
            chrome.runtime.sendMessage({ action: "elementClicked", hierarchy: cachedHierarchy }).catch(() => { });
        }
    }, 10);
});

/**
 * Injects a dynamic stylesheet into the page header to highlight elements
 */
function injectStyles(selector) {
    removeInjectedStyles();

    if (!selector) return;

    styleTag = document.createElement("style");
    styleTag.id = "css-helper-injected-style";

    // Use !important to override inline or high-specificity page styles
    styleTag.textContent = `
    ${selector} {
      background-color: red !important;
      outline: 2px solid darkred !important;
      transition: all 0.2s ease-in-out !important;
    }
  `;
    document.head.appendChild(styleTag);
}

/**
 * Injects a dynamic stylesheet multiple colors based on the paths array
 */
function injectMultiStyles(paths) {
    removeInjectedStyles();

    if (!paths || paths.length === 0) return;

    styleTag = document.createElement("style");
    styleTag.id = "css-helper-injected-style";

    const baseColors = [
        { bg: "red", outline: "darkred" },
        { bg: "blue", outline: "darkblue" },
        { bg: "green", outline: "darkgreen" }
    ];

    let css = "";
    paths.forEach((path, index) => {
        let bgColor = "";
        let outlineColor = "";

        if (index < baseColors.length) {
            bgColor = baseColors[index].bg;
            outlineColor = baseColors[index].outline;
        } else {
            // Generate random hex color for additional paths
            const randomColor = "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
            bgColor = randomColor;
            outlineColor = randomColor; // Fallback to same color for outline
        }

        css += `
        ${path} {
            background-color: ${bgColor} !important;
            outline: 2px solid ${outlineColor} !important;
            transition: all 0.2s ease-in-out !important;
        }
        `;
    });

    styleTag.textContent = css;
    document.head.appendChild(styleTag);
}

/**
 * Removes the injected dynamic stylesheet
 */
function removeInjectedStyles() {
    if (styleTag && styleTag.parentNode) {
        styleTag.parentNode.removeChild(styleTag);
        styleTag = null;
    }
}
