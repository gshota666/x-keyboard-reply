(() => {
  "use strict";

  const COLUMN = '[data-testid="primaryColumn"]';
  const POST = 'article[data-testid="tweet"]';
  const REPLY = '[data-testid="reply"]';
  const LIKE = 'button[data-testid="like"], [role="button"][data-testid="like"]';
  const UNLIKE = '[data-testid="unlike"]';
  const DIALOG = '[role="dialog"], [role="alertdialog"]';
  const EDITOR = '[data-testid="tweetTextarea_0"][contenteditable="true"], ' +
    '[data-testid="tweetTextarea_0"] [contenteditable="true"]';
  const SEND = '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]';
  const TYPEAHEAD = '[role="listbox"], [data-testid="typeaheadDropdown"]';
  const TOAST = '[data-testid="toast"], [role="status"], [role="alert"]';
  const STORAGE_PREFIX = "xkr:replied:";
  const INTERACTIVE = [
    "input", "textarea", "select", "button", "a[href]", "summary",
    '[contenteditable]:not([contenteditable="false"])', '[role="button"]',
    '[role="link"]', '[role="textbox"]', '[role="combobox"]',
    '[role="tab"]', '[role="slider"]', '[role="menuitem"]', '[role="option"]',
    "video", "audio",
  ].join(", ");
  const HOME = /^\/home\/?$/;
  const COMPOSE = /^\/compose\/(post|tweet)\/?$/;
  const REPLY_LABEL = /^(reply|回复|回覆|回復)$/i;
  let column = null;
  let tab = null;
  let selected = null;
  let pending = null;
  let reply = null;
  let submission = null;
  let returnToPost = null;
  let alignmentFrame = null;
  const repliedIds = new Set();
  const lastSubmit = new WeakMap();
  let frame = null;
  let compositionTarget = null;
  let deferredSend = null;

  function visible(element) {
    return element.isConnected &&
      !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility === "visible";
  }

  function enabled(element) {
    return element instanceof HTMLElement && visible(element) &&
      !element.matches(":disabled, [disabled]") &&
      !element.closest('[aria-disabled="true"], [aria-busy="true"]');
  }

  function timelinePosts() {
    return [...(column?.querySelectorAll(POST) ?? [])].filter(
      (post) => !post.parentElement.closest(POST) && !post.closest(DIALOG),
    );
  }

  function posts() {
    return timelinePosts().filter(visible);
  }

  function statusId(link) {
    if (!(link instanceof HTMLAnchorElement)) return null;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return null;
    return /^\/(?:[^/]+|i\/web)\/status\/(\d+)\/?$/.exec(url.pathname)?.[1] ?? null;
  }

  function postId(post) {
    for (const time of post.querySelectorAll("time")) {
      if (time.closest(POST) !== post) continue;
      const card = time.closest('[role="link"]:not(a), [data-testid="card.wrapper"]');
      if (card && card !== post && post.contains(card)) continue;
      const id = statusId(time.closest("a[href]"));
      if (id) return id;
    }
    return null;
  }

  function unmark() {
    const element = selected?.element;
    if (!element) return;
    element.removeAttribute("data-xkr-selected");
    if (selected.addedTabIndex && element.getAttribute("tabindex") === "-1") {
      element.removeAttribute("tabindex");
    }
  }

  function select(post, moveFocus = false) {
    unmark();
    selected = post ? { element: post, id: postId(post), addedTabIndex: false } : null;
    if (!post) return;
    post.setAttribute("data-xkr-selected", "");
    if (!moveFocus) return;
    if (!post.hasAttribute("tabindex")) {
      post.setAttribute("tabindex", "-1");
      selected.addedTabIndex = true;
    }
    post.focus({ preventScroll: true });
    post.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }

  function visibleDialogs() {
    return [...document.querySelectorAll(DIALOG)].filter(visible);
  }

  function uniqueInside(dialog, selector) {
    const matches = [...dialog.querySelectorAll(selector)].filter(
      (item) => item.closest(DIALOG) === dialog && visible(item),
    );
    return matches.length === 1 ? matches[0] : null;
  }

  function hasReplyLabel(button) {
    return REPLY_LABEL.test(button.textContent.trim()) ||
      REPLY_LABEL.test(button.getAttribute("aria-label")?.trim() ?? "");
  }

  function isExpectedReply(url, dialog, button, id) {
    const routeId = url.searchParams.get("in_reply_to");
    if (routeId) return COMPOSE.test(url.pathname) && routeId === id;
    if (id && [...dialog.querySelectorAll("time")].some(
      (time) => statusId(time.closest("a[href]")) === id,
    )) return true;
    return hasReplyLabel(button);
  }

  function hasOpenTypeahead(editor, dialog) {
    // X keeps these ARIA references even when the suggestions aren't mounted.
    const activeOption = document.getElementById(editor.getAttribute("aria-activedescendant") || "");
    if (activeOption && visible(activeOption)) return true;
    const controlledIds = (editor.getAttribute("aria-controls") || "").trim().split(/\s+/);
    for (const id of controlledIds) {
      const list = document.getElementById(id);
      if (list && visible(list) && (list.matches(TYPEAHEAD) ||
        [...list.querySelectorAll(`${TYPEAHEAD}, [role="option"]`)].some(visible))) return true;
    }
    return [...dialog.querySelectorAll(TYPEAHEAD)].some(visible);
  }

  function toastSignature(toast) {
    const links = [...toast.querySelectorAll("a[href]")];
    return [toast.textContent.trim(), ...links.map((link) => link.href)].join("\n");
  }

  function isSendConfirmation(toast, parentId) {
    const text = toast.textContent.trim().replace(/\s+/g, " ");
    if (/^(?:your )?(?:post|reply|tweet) (?:was |has been )?(?:sent|posted|published)\b/i.test(text) ||
      /^(?:(?:你|您)的)?(?:回复|回覆|回復|帖子|貼文|贴文|推文)(?:已(?:成功)?(?:发送|發送|发出|發出|发布|發佈|發布)|(?:发送|發送|发布|發佈|發布)成功)/.test(text) ||
      /^(?:发送|發送|发布|發佈|發布)成功(?:[。！!\s]|$)/.test(text)) return true;
    // Some locales use a different success message but link directly to the new post.
    return toast.matches('[data-testid="toast"]') && [...toast.querySelectorAll("a[href]")].some((link) => {
      const id = statusId(link);
      return id && id !== parentId &&
        /^(?:view(?: (?:post|reply|tweet))?|查看(?:帖子|推文|回复)?|檢視|瀏覽)$/i.test(link.textContent.trim());
    });
  }

  function watchSubmission(button) {
    const dialog = button.closest(DIALOG);
    const expected = reply?.dialog === dialog ? reply : pending;
    if (!dialog || !expected?.id || !hasReplyLabel(button) || !enabled(button) ||
      !isExpectedReply(new URL(location.href), dialog, button, expected.id)) return;
    const previous = new Map([...document.querySelectorAll(TOAST)]
      .filter(visible).map((toast) => [toast, toastSignature(toast)]));
    const expires = performance.now() + 20000;
    submission = { id: expected.id, previous, expires };
    returnToPost = { id: expected.id, post: expected.post, dialog, expires };
  }

  function checkSubmission() {
    if (!submission) return;
    if (performance.now() >= submission.expires) {
      submission = null;
      return;
    }
    const { id, previous } = submission;
    const confirmed = [...document.querySelectorAll(TOAST)].some((toast) =>
      visible(toast) && previous.get(toast) !== toastSignature(toast) && isSendConfirmation(toast, id));
    if (!confirmed) return;

    submission = null;
    if (!repliedIds.has(id)) {
      repliedIds.add(id);
      chrome.storage.local.set({ [STORAGE_PREFIX + id]: true }).catch(() => {});
    }
    scheduleSync();
  }

  function likeSelectedPost(event) {
    const post = selectedPostInView();
    if (!post) return;
    consume(event);
    if (event.repeat) return;
    if ([...post.querySelectorAll(UNLIKE)].some((button) => button.closest(POST) === post && visible(button))) {
      return;
    }
    const buttons = [...post.querySelectorAll(LIKE)].filter(
      (button) => button.closest(POST) === post && enabled(button) &&
        button.getAttribute("aria-pressed") !== "true",
    );
    if (buttons.length === 1) buttons[0].click();
  }

  function findOriginalPost({ id, post }) {
    if (post && column?.contains(post) && postId(post) === id && visible(post)) return post;
    return timelinePosts().find((item) => postId(item) === id && visible(item));
  }

  function cancelAlignment() {
    if (alignmentFrame !== null) cancelAnimationFrame(alignmentFrame);
    alignmentFrame = null;
  }

  function alignOriginalPost(post, id) {
    cancelAlignment();
    if (selected?.element !== post) select(post);
    const options = { block: "start", inline: "nearest", behavior: "instant" };
    post.scrollIntoView(options);

    // X can restore focus/scroll on the frame after closing its composer.
    alignmentFrame = requestAnimationFrame(() => {
      alignmentFrame = requestAnimationFrame(() => {
        alignmentFrame = null;
        if (!HOME.test(location.pathname) || visibleDialogs().length) return;
        const current = findOriginalPost({ id, post });
        if (!current) return;
        const top = parseFloat(getComputedStyle(current).scrollMarginBlockStart) || 0;
        if (Math.abs(current.getBoundingClientRect().top - top) > 2) current.scrollIntoView(options);
      });
    });
  }

  function applyReplyEffects(home) {
    const onTimelineRoute = home || COMPOSE.test(location.pathname);
    if (returnToPost && (!onTimelineRoute || performance.now() >= returnToPost.expires)) returnToPost = null;
    if (!home || !column) return;

    if (returnToPost && !visible(returnToPost.dialog) && !visibleDialogs().length) {
      const post = findOriginalPost(returnToPost);
      if (post) {
        const { id } = returnToPost;
        returnToPost = null;
        alignOriginalPost(post, id);
      }
    }
    if (!repliedIds.size && !column.querySelector("[data-xkr-replied]")) return;
    for (const post of timelinePosts()) {
      post.toggleAttribute("data-xkr-replied", repliedIds.has(postId(post)));
    }
  }

  function sync() {
    const url = new URL(location.href);
    const home = HOME.test(url.pathname);
    const onReplyRoute = home || COMPOSE.test(url.pathname);

    if (reply && (!onReplyRoute || !visible(reply.dialog))) reply = null;
    if (pending && (!onReplyRoute || performance.now() >= pending.expires)) pending = null;

    const nextColumn = home || (onReplyRoute && (pending || reply))
      ? document.querySelector(COLUMN) : null;
    if (nextColumn !== column) {
      column?.removeAttribute("data-xkr-home");
      column = nextColumn;
      column?.setAttribute("data-xkr-home", "");
    }
    if (home) {
      const active = column?.querySelector('[role="tab"][aria-selected="true"]');
      const nextTab = active ? `${active.getAttribute("href")}|${active.textContent.trim()}` : null;
      if (tab !== null && nextTab !== null && tab !== nextTab) select(null);
      if (nextTab !== null) tab = nextTab;
      if (!pending && !reply && selected && (!column?.contains(selected.element) ||
        !selected.element.hasAttribute("data-xkr-selected") ||
        (selected.id && postId(selected.element) !== selected.id))) {
        const id = selected.id;
        const replacement = id && posts().find((post) => postId(post) === id);
        if (replacement || !id) select(replacement || null);
        else unmark(); // Keep the ID so a temporarily unmounted post can be recovered.
      }
    } else if (!onReplyRoute || (!pending && !reply)) {
      select(null);
      tab = null;
    }
    applyReplyEffects(home);

    if (!pending) return;
    for (const dialog of visibleDialogs()) {
      const editor = uniqueInside(dialog, EDITOR);
      const button = uniqueInside(dialog, SEND);
      if (editor && button && isExpectedReply(url, dialog, button, pending.id)) {
        reply = { dialog, id: pending.id, post: pending.post };
        const focus = pending.focus;
        pending = null;
        if (focus && !editor.contains(document.activeElement)) editor.focus({ preventScroll: true });
        break;
      }
    }
  }

  function scheduleSync() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      sync();
    });
  }

  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onScreen(post) {
    const { top, bottom } = post.getBoundingClientRect();
    return bottom > 66 && top < innerHeight;
  }

  function navigate(event) {
    const items = posts();
    if (!items.length) return;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const index = items.indexOf(selected?.element);
    let next;
    if (index >= 0 && onScreen(items[index])) {
      next = items[index + direction];
    } else {
      const inView = items.filter(onScreen);
      next = direction === 1 ? inView[0] : inView.at(-1);
    }
    // At the edge of the mounted timeline, native scrolling can reveal more posts.
    if (!next) return;
    consume(event);
    select(next, true);
  }

  function selectedPostInView() {
    const post = selected?.element;
    if (post && column?.contains(post) && visible(post) && onScreen(post) &&
      (!selected.id || postId(post) === selected.id)) return post;
    return null;
  }

  function openReply(event) {
    const post = selectedPostInView();
    if (!post) return;
    const button = [...post.querySelectorAll(REPLY)].find(
      (item) => item.closest(POST) === post && enabled(item),
    );
    if (!button) return;
    consume(event);
    if (event.repeat) return;
    pending = { id: selected.id, post, focus: true, expires: performance.now() + 6000 };
    button.click();
    scheduleSync();
  }

  function replyComposer(target, dialogs) {
    const dialog = target?.closest(DIALOG);
    if (!dialog || !dialogs.includes(dialog) || (reply && reply.dialog !== dialog)) return;
    if (dialogs.some((other) => other !== dialog && !other.contains(dialog))) return;
    const editor = uniqueInside(dialog, EDITOR);
    if (!editor || !editor.contains(target) || hasOpenTypeahead(editor, dialog)) return;

    const button = uniqueInside(dialog, SEND);
    if (!button) return;
    // Space-opened replies can be checked against the selected post. For a native
    // click, the actual dialog's Reply button distinguishes it from a new post.
    const expected = reply || pending;
    if (expected ? !isExpectedReply(new URL(location.href), dialog, button, expected.id)
      : !hasReplyLabel(button)) return;
    return { dialog, editor, button };
  }

  function submitReply({ dialog, button }) {
    if (!enabled(button) || performance.now() - (lastSubmit.get(dialog) ?? -Infinity) < 2500) return;
    lastSubmit.set(dialog, performance.now());
    watchSubmission(button);
    button.click();
  }

  function cancelDeferredSend() {
    if (!deferredSend) return;
    deferredSend.observer.disconnect();
    clearTimeout(deferredSend.timeout);
    deferredSend = null;
  }

  function waitForReplyButton({ dialog, editor }) {
    const href = location.href;
    const text = editor.textContent;
    const deadline = performance.now() + 220;
    const observer = new MutationObserver(() => {
      if (performance.now() >= deadline || location.href !== href ||
        !editor.contains(document.activeElement) || editor.textContent !== text) return cancelDeferredSend();
      const composer = replyComposer(editor, visibleDialogs());
      if (!composer || composer.dialog !== dialog || composer.editor !== editor) return cancelDeferredSend();
      if (!enabled(composer.button)) return;
      cancelDeferredSend();
      submitReply(composer);
    });
    observer.observe(dialog, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["disabled", "aria-disabled", "aria-busy"],
    });
    deferredSend = { observer, timeout: setTimeout(cancelDeferredSend, 220) };
  }

  function sendReply(event, dialogs) {
    const composer = replyComposer(event.target instanceof Element ? event.target : null, dialogs);
    if (!composer) return;
    consume(event);
    if (event.repeat) return;
    cancelDeferredSend();
    const { dialog, editor, button } = composer;
    const hasText = /[^\s\u200B\uFEFF]/.test(editor.textContent);
    const hasMedia = [...dialog.querySelectorAll('[data-testid="attachments"]')].some(visible);
    if ((!hasText && !hasMedia) ||
      performance.now() - (lastSubmit.get(dialog) ?? -Infinity) < 2500) return;
    if (enabled(button)) submitReply(composer);
    else waitForReplyButton(composer);
  }

  window.addEventListener("click", (event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const send = event.target.closest(SEND);
    if (send) {
      watchSubmission(send);
      return;
    }
    if (!HOME.test(location.pathname)) return;
    const trigger = event.target.closest(REPLY);
    const post = trigger?.closest(POST);
    if (!post || !column?.contains(post) || post.closest(DIALOG) ||
      post.parentElement.closest(POST) || !enabled(trigger)) return;
    const id = postId(post);
    if (!id) return;
    pending = { id, post, focus: false, expires: performance.now() + 6000 };
    scheduleSync();
  }, true);

  window.addEventListener("keydown", (event) => {
    const { key } = event;
    if (event.isTrusted) cancelAlignment();
    if (deferredSend && (key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey)) {
      cancelDeferredSend();
    }
    if (!event.isTrusted || !["ArrowUp", "ArrowDown", " ", "Enter", "Escape", "x", "X"].includes(key) ||
      event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      compositionTarget === event.target || event.isComposing || event.keyCode === 229) return;

    const home = HOME.test(location.pathname);
    if (!home && !pending && !reply && !(key === "Enter" && COMPOSE.test(location.pathname))) return;
    sync();
    const dialogs = visibleDialogs();
    if (key === "Enter") {
      if (home || COMPOSE.test(location.pathname)) sendReply(event, dialogs);
      return;
    }
    if (key === "Escape") {
      pending = null;
      returnToPost = null;
      return;
    }
    if (!column || !home || dialogs.length || reply) return;
    if (pending) {
      if (key === " ") consume(event);
      return;
    }
    if ([...document.querySelectorAll('[role="menu"]')].some(visible)) return;

    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest(INTERACTIVE);
    // X can restore focus to the original reply button after closing its dialog.
    if (control && !control.matches(POST) &&
      !(control.matches(REPLY) && control.closest(POST) === selected?.element)) return;

    if (key === " ") openReply(event);
    else if (key === "x" || key === "X") likeSelectedPost(event);
    else navigate(event);
  }, true);

  window.addEventListener("compositionstart", (event) => {
    cancelDeferredSend();
    compositionTarget = event.target;
  }, true);
  window.addEventListener("compositionend", (event) => {
    if (compositionTarget === event.target) compositionTarget = null;
  }, true);
  window.addEventListener("focusout", (event) => {
    if (compositionTarget === event.target) compositionTarget = null;
    cancelDeferredSend();
  }, true);
  window.addEventListener("input", cancelDeferredSend, true);
  window.addEventListener("blur", () => {
    compositionTarget = null;
    cancelDeferredSend();
  });
  window.addEventListener("pointerdown", () => {
    cancelAlignment();
    cancelDeferredSend();
    if (pending) {
      sync();
      pending = null;
    }
  }, true);
  window.addEventListener("wheel", cancelAlignment, { passive: true, capture: true });
  window.addEventListener("touchstart", cancelAlignment, { passive: true, capture: true });
  window.addEventListener("popstate", scheduleSync);
  window.navigation?.addEventListener("currententrychange", scheduleSync);
  new MutationObserver(() => {
    checkSubmission();
    if (column || pending || reply || returnToPost || HOME.test(location.pathname)) scheduleSync();
  }).observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-selected", "aria-hidden", "hidden"],
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    let updated = false;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (!key.startsWith(STORAGE_PREFIX)) continue;
      const id = key.slice(STORAGE_PREFIX.length);
      if (newValue === true) repliedIds.add(id);
      else repliedIds.delete(id);
      updated = true;
    }
    if (updated) scheduleSync();
  });
  chrome.storage.local.get(null).then((values) => {
    for (const [key, value] of Object.entries(values)) {
      if (key.startsWith(STORAGE_PREFIX) && value === true) repliedIds.add(key.slice(STORAGE_PREFIX.length));
    }
    scheduleSync();
  }).catch(() => {});
  sync();
})();
