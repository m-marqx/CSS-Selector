
let isActive = false;
let recentlyClosed = false;
let styleTag = null;
let cachedHierarchy = [];
let isTextSelectionMode = false;
let heartbeatTimer = null;
let storedMultiPaths = [];


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "heartbeat") {
        isActive = true;
        clearTimeout(heartbeatTimer);
        heartbeatTimer = setTimeout(() => {
            isActive = false;
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
    } else if (request.action === "injectOverlay") {
        injectOverlayPanel(request.url, request.position);
    } else if (request.action === "removeOverlay") {
        removeOverlayPanel();
    } else if (request.action === "moveOverlay") {
        moveOverlayPanel(request.position);
    }
});

let overlayContainer = null;

function getPositionStyles(position) {
    const base = { position: "fixed", zIndex: "2147483647" };
    switch (position) {
        case "top-left": return { ...base, top: "16px", left: "16px", bottom: "auto", right: "auto" };
        case "top-right": return { ...base, top: "16px", right: "16px", bottom: "auto", left: "auto" };
        case "center-left": return { ...base, top: "50%", left: "16px", bottom: "auto", right: "auto", transform: "translateY(-50%)" };
        case "center-right": return { ...base, top: "50%", right: "16px", bottom: "auto", left: "auto", transform: "translateY(-50%)" };
        case "bottom-left": return { ...base, bottom: "16px", left: "16px", top: "auto", right: "auto" };
        case "bottom-right": return { ...base, bottom: "16px", right: "16px", top: "auto", left: "auto" };
        default: return { ...base, top: "16px", right: "16px", bottom: "auto", left: "auto" };
    }
}

function injectOverlayPanel(url, position) {

    removeOverlayPanel();

    overlayContainer = document.createElement("div");
    overlayContainer.id = "css-helper-overlay-root";
    const shadow = overlayContainer.attachShadow({ mode: "open" });

    const wrapper = document.createElement("div");
    wrapper.id = "overlay-wrapper";

    const posStyles = getPositionStyles(position);
    Object.assign(wrapper.style, posStyles, {
        width: "380px",
        height: "620px",
        borderRadius: "12px",
        overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.24), 0 2px 8px rgba(0,0,0,0.12)",
        border: "1px solid rgba(255,255,255,0.15)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, sans-serif",
        transition: "box-shadow 0.2s ease"
    });

    const toolbar = document.createElement("div");
    Object.assign(toolbar.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 10px",
        background: "#1e293b",
        color: "white",
        fontSize: "12px",
        cursor: "grab",
        userSelect: "none",
        flexShrink: "0"
    });

    const dragLabel = document.createElement("span");
    dragLabel.textContent = "⠿ CSS Selector";
    dragLabel.style.fontWeight = "600";

    const toolbarRight = document.createElement("div");
    toolbarRight.style.display = "flex";
    toolbarRight.style.alignItems = "center";
    toolbarRight.style.gap = "6px";

    const posSelect = document.createElement("select");
    posSelect.style.cssText = "padding:2px 4px;border-radius:4px;border:1px solid #475569;background:#334155;color:white;font-size:11px;cursor:pointer;";
    const positions = [
        ["top-right", "↗ Top Right"], ["top-left", "↖ Top Left"],
        ["center-right", "→ Center Right"], ["center-left", "← Center Left"],
        ["bottom-right", "↘ Bottom Right"], ["bottom-left", "↙ Bottom Left"]
    ];
    positions.forEach(([val, label]) => {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = label;
        if (val === position) opt.selected = true;
        posSelect.appendChild(opt);
    });
    posSelect.addEventListener("change", () => {
        const newPos = getPositionStyles(posSelect.value);
        wrapper.style.top = "auto";
        wrapper.style.right = "auto";
        wrapper.style.bottom = "auto";
        wrapper.style.left = "auto";
        wrapper.style.transform = "none";
        Object.assign(wrapper.style, newPos);
    });

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = "background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;padding:4px 6px;line-height:1;border-radius:4px;";
    closeBtn.addEventListener("mouseenter", () => { closeBtn.style.color = "#ef4444"; closeBtn.style.background = "rgba(239,68,68,0.15)"; });
    closeBtn.addEventListener("mouseleave", () => { closeBtn.style.color = "#94a3b8"; closeBtn.style.background = "none"; });
    closeBtn.addEventListener("mousedown", (e) => {
        e.stopPropagation();
    });
    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeOverlayPanel();
    });

    toolbarRight.appendChild(posSelect);
    toolbarRight.appendChild(closeBtn);
    toolbar.appendChild(dragLabel);
    toolbar.appendChild(toolbarRight);

    let isDragging = false;
    let dragOffsetX = 0, dragOffsetY = 0;

    toolbar.addEventListener("mousedown", (e) => {
        if (closeBtn.contains(e.target) || posSelect.contains(e.target)) return;
        isDragging = true;
        toolbar.style.cursor = "grabbing";
        const rect = wrapper.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;

        wrapper.style.top = rect.top + "px";
        wrapper.style.left = rect.left + "px";
        wrapper.style.right = "auto";
        wrapper.style.bottom = "auto";
        wrapper.style.transform = "none";
        e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        wrapper.style.top = (e.clientY - dragOffsetY) + "px";
        wrapper.style.left = (e.clientX - dragOffsetX) + "px";
    });

    document.addEventListener("mouseup", () => {
        if (isDragging) {
            isDragging = false;
            toolbar.style.cursor = "grab";
        }
    });

    const iframe = document.createElement("iframe");
    iframe.src = url;
    Object.assign(iframe.style, {
        width: "100%",
        flex: "1",
        border: "none",
        background: "white"
    });
    iframe.setAttribute("allow", "clipboard-write");

    const resizeHandle = document.createElement("div");
    resizeHandle.style.cssText = "position:absolute;bottom:0;right:0;width:16px;height:16px;cursor:se-resize;z-index:10;";
    resizeHandle.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="#94a3b8"><path d="M14 14H10V12H12V10H14V14ZM14 8H12V6H14V8Z"/></svg>';

    let isResizing = false;
    resizeHandle.addEventListener("mousedown", (e) => {
        isResizing = true;
        e.preventDefault();
        e.stopPropagation();
    });
    document.addEventListener("mousemove", (e) => {
        if (!isResizing) return;
        const rect = wrapper.getBoundingClientRect();
        wrapper.style.width = Math.max(300, e.clientX - rect.left) + "px";
        wrapper.style.height = Math.max(400, e.clientY - rect.top) + "px";
    });
    document.addEventListener("mouseup", () => { isResizing = false; });

    wrapper.appendChild(toolbar);
    wrapper.appendChild(iframe);
    wrapper.appendChild(resizeHandle);
    shadow.appendChild(wrapper);
    document.body.appendChild(overlayContainer);
}

function removeOverlayPanel() {
    if (overlayContainer && overlayContainer.parentNode) {
        overlayContainer.parentNode.removeChild(overlayContainer);
        overlayContainer = null;
    }
}

function moveOverlayPanel(position) {
    if (!overlayContainer) return;
    const shadow = overlayContainer.shadowRoot;
    if (!shadow) return;
    const wrapper = shadow.getElementById("overlay-wrapper");
    if (!wrapper) return;
    const newPos = getPositionStyles(position);
    wrapper.style.top = "auto";
    wrapper.style.right = "auto";
    wrapper.style.bottom = "auto";
    wrapper.style.left = "auto";
    wrapper.style.transform = "none";
    Object.assign(wrapper.style, newPos);
}




function isOverlayEvent(target) {
    return overlayContainer && (overlayContainer === target || overlayContainer.contains(target));
}

document.addEventListener("click", (e) => {
    if (isOverlayEvent(e.target)) return;
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


    cachedHierarchy = hierarchy;


    if (isActive) {
        chrome.runtime.sendMessage({ action: "elementClicked", hierarchy: cachedHierarchy }).catch(() => { });
    }
}


document.addEventListener("mousedown", (e) => {
    if (isOverlayEvent(e.target)) return;
    if (!isActive && !recentlyClosed) return;
    if (isTextSelectionMode) return;

    captureHierarchy(e.target);
}, true);


document.addEventListener("mouseup", (e) => {
    if (isOverlayEvent(e.target)) return;
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


        let selectedElements = new Set();
        let walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            if (selection.containsNode(node, true) && node.textContent.trim() !== "") {
                selectedElements.add(node.parentElement);
            }
        }

        if (selectedElements.size <= 1) {

            captureHierarchy(selectedElements.size === 1 ? Array.from(selectedElements)[0] : container);
            return;
        }



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

                classIntersection = new Set(elClasses);
            } else {

                for (let c of classIntersection) {
                    if (!elClasses.has(c)) {
                        classIntersection.delete(c);
                    }
                }
            }
        });


        let tagArr = Array.from(tags);
        let combinedTagName = tagArr.length > 1 ? ":is(" + tagArr.join(", ") + ")" : tagArr[0];
        let combinedClasses = classIntersection ? Array.from(classIntersection).join(" ") : "";


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


        hierarchy.unshift({ tagName: combinedTagName, classes: combinedClasses, prevSibling: null });

        cachedHierarchy = hierarchy;
        if (isActive) {
            chrome.runtime.sendMessage({ action: "elementClicked", hierarchy: cachedHierarchy }).catch(() => { });
        }
    }, 10);
});

function injectStyles(selector) {
    removeInjectedStyles();

    if (!selector) return;

    styleTag = document.createElement("style");
    styleTag.id = "css-helper-injected-style";


    styleTag.textContent = `
    ${selector} {
      background-color: red !important;
      outline: 2px solid darkred !important;
      transition: all 0.2s ease-in-out !important;
    }
  `;
    document.head.appendChild(styleTag);
}

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

            const randomColor = "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
            bgColor = randomColor;
            outlineColor = randomColor;
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

function removeInjectedStyles() {
    if (styleTag && styleTag.parentNode) {
        styleTag.parentNode.removeChild(styleTag);
        styleTag = null;
    }
}
