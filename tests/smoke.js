async (page) => {
  page.setDefaultTimeout(6000);
  const fixture = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>X timeline fixture</title>
  <style>
    html { scroll-behavior: smooth; }
    body { margin: 0; font: 16px system-ui; background: #f8f9f9; }
    main { width: 600px; margin: auto; background: white; }
    article { min-height: 200px; padding: 16px; box-sizing: border-box; }
    article[data-post="101"] { min-height: 1280px; display: flex; flex-direction: column; align-items: flex-start; }
    article[data-post="101"] p { flex: 1; }
    nav { position: sticky; top: 0; height: 65px; background: white; }
    footer { height: 500px; }
    [aria-modal="true"] { position: fixed; inset: 25% auto auto 25%; padding: 20px; background: white; border: 2px solid #111; width: 500px; z-index: 1; }
    [contenteditable] { min-height: 40px; white-space: pre-wrap; }
  </style>
  <input aria-label="搜索">
  <button id="new">新建推文</button>
  <div data-testid="toast" role="status">回复已发送。</div>
  <main data-testid="primaryColumn">
    <nav><button role="tab" aria-selected="true">为你推荐</button><button role="tab" aria-selected="false">正在关注</button></nav>
    <div id="feed"></div>
    <footer></footer>
  </main>
  <script>
    const feed = document.querySelector('#feed');
    const primary = feed.parentElement;
    const tabs = primary.querySelectorAll('[role="tab"]');
    const toast = document.querySelector('[data-testid="toast"]');
    window.sent = [];
    window.repliesOpened = [];
    window.likeClicks = [];
    tabs.forEach(tab => tab.onclick = () => tabs.forEach(item =>
      item.setAttribute('aria-selected', String(tab === item))));
    function compose(id, trigger, mode) {
      const routeId = mode === 'wrong' ? '999' : id;
      if (mode !== 'same-route') history.pushState({}, '', '/compose/post' +
        (routeId && mode !== 'no-query' ? '?in_reply_to=' + routeId : ''));
      primary.setAttribute('aria-hidden', 'true');
      const outer = document.createElement('div');
      outer.setAttribute('role', 'dialog');
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.innerHTML = '<div data-testid="tweetTextarea_0" role="textbox" contenteditable="true"' +
        ' aria-activedescendant="typeaheadFocus-idle" aria-controls="typeaheadDropdownWrapped-9"></div>' +
        '<button data-testid="tweetButton" disabled>' + (id ? '回复' : '发帖') + '</button>';
      const editor = dialog.firstElementChild;
      const send = dialog.lastElementChild;
      const close = () => {
        outer.remove();
        primary.removeAttribute('aria-hidden');
        history.replaceState({}, '', '/home');
        trigger.focus();
      };
      editor.oninput = () => { send.disabled = !editor.textContent.trim(); };
      dialog.onkeydown = (event) => { if (event.key === 'Escape') close(); };
      send.onclick = () => {
        window.sent.push({ id, text: editor.textContent });
        if (mode === 'keep-open') {
          toast.textContent = '回复发送失败。';
          return;
        }
        close();
        const confirm = () => { toast.textContent = mode === 'same-route' ?
          'Your reply was sent.' : '你的帖子已发送。'; };
        if (id === '101' && window.sent.length === 1) {
          window.confirmLongReply = confirm;
          requestAnimationFrame(() => requestAnimationFrame(() => {
            window.scrollBy({ top: 96, behavior: 'instant' });
            window.restoredScroll = true;
          }));
        } else {
          setTimeout(confirm, 40);
        }
      };
      outer.append(dialog);
      document.body.append(outer);
      if (!id) editor.focus(); // Space-opened replies depend on the extension for autofocus.
    }
    window.addPost = (id, mode) => {
      const article = document.createElement('article');
      article.dataset.testid = 'tweet';
      article.dataset.post = id;
      article.innerHTML = '<a href="/test/status/' + id + '"><time>1h</time></a>' +
        '<p>推文 ' + id + '</p><button data-testid="reply">评论</button><button></button>';
      const like = article.lastElementChild;
      like.dataset.testid = id === '103' ? 'unlike' : 'like';
      like.onclick = () => {
        window.likeClicks.push({ id, action: like.dataset.testid });
        like.dataset.testid = like.dataset.testid === 'like' ? 'unlike' : 'like';
      };
      const button = like.previousElementSibling;
      button.onclick = () => {
        window.repliesOpened.push(id);
        setTimeout(() => compose(id, button, mode), 40);
      };
      feed.append(article);
      return article;
    };
    addPost('101', 'no-query');
    addPost('102');
    addPost('103', 'same-route');
    addPost('104', 'wrong');
    addPost('105', 'keep-open');
    document.querySelector('#new').onclick = event => compose(null, event.currentTarget);
  </script></html>`;

  // Fulfill the navigation locally: the browser loads the real extension on x.com,
  // but neither visits the real site nor sends any request with reply content.
  await page.context().route("https://x.com/**", (route) => route.fulfill({
    contentType: "text/html",
    body: fixture,
  }));
  const check = (condition, description) => {
    if (!condition) throw new Error(description);
  };
  const editor = page.locator('[data-testid="tweetTextarea_0"]');
  const selected = page.locator("[data-xkr-selected]");
  const marked = (id) => page.locator(`[data-xkr-replied][data-post="${id}"]`);
  const press = (key) => page.keyboard.press(key);
  const choose = (id) => page.locator(`[data-xkr-selected][data-post="${id}"]`).waitFor();
  const openReply = async () => {
    await press("Space");
    await editor.waitFor();
  };
  const getSent = () => page.evaluate(() => window.sent);
  const getLikeClicks = () => page.evaluate(() => window.likeClicks);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("https://x.com/home");
  await page.locator("[data-xkr-home]").waitFor();
  check(await page.locator('[data-post="101"]').evaluate(
    (element) => getComputedStyle(element).outlineStyle === "solid"), "All posts get outlines");
  await press("x");
  check((await getLikeClicks()).length === 0, "No post is liked before selection");
  await press("ArrowDown"); await choose("101");
  await press("ArrowDown"); await choose("102");
  await press("ArrowUp"); await choose("101");
  await press("ArrowDown"); await choose("102");
  await page.keyboard.down("x");
  await page.keyboard.down("x");
  await page.keyboard.up("x");
  await press("x");
  check(JSON.stringify(await getLikeClicks()) === JSON.stringify([{ id: "102", action: "like" }]),
    "X likes only the selected post and leaves existing likes intact");

  const search = page.getByRole("textbox", { name: "搜索" });
  await search.fill("搜索");
  await press("x");
  check((await search.inputValue()).includes("x") && (await getLikeClicks()).length === 1,
    "Typing x in a text box is not a shortcut");
  await press("ArrowDown");
  await choose("102");
  await press("Space");
  check(await page.evaluate(() => window.repliesOpened.length) === 0, "Search keeps native keys");
  await page.locator('[data-post="102"]').evaluate((element) => {
    document.activeElement.blur();
    const clone = element.cloneNode(true);
    clone.removeAttribute("data-xkr-selected");
    clone.removeAttribute("tabindex");
    element.replaceWith(clone);
  });
  await choose("102");
  await press("ArrowUp"); await choose("101");
  await openReply();
  await page.waitForFunction(() => document.activeElement?.dataset.testid === "tweetTextarea_0");
  await press("Enter");
  check((await getSent()).length === 0, "Empty reply is not sent");
  await page.keyboard.insertText("第一行");
  await press("Shift+Enter");
  await page.keyboard.insertText("第二行");
  check((await editor.innerText()).includes("\n"), "Shift+Enter inserts a newline");
  await editor.evaluate(el => {
    const list = document.createElement("div");
    list.setAttribute("role", "listbox");
    list.textContent = "@user";
    el.after(list);
  });
  await press("Enter");
  check((await getSent()).length === 0, "Autocomplete keeps Enter");
  await page.locator('[role="listbox"]').evaluate(el => el.remove());
  await editor.evaluate(el => {
    const wrapper = document.createElement("div");
    wrapper.id = el.getAttribute("aria-controls");
    wrapper.innerHTML = '<div role="option">@outside</div>';
    el.closest('[aria-modal="true"]').after(wrapper);
  });
  await press("Enter");
  check((await getSent()).length === 0, "A visible controlled popup outside the dialog keeps Enter");
  await page.locator('#typeaheadDropdownWrapped-9').evaluate(el => el.remove());
  await editor.evaluate(el => el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  await page.keyboard.down("Enter");
  check((await getSent()).length === 0, "Enter during composition does not send");
  await editor.evaluate(el => el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  await page.keyboard.down("Enter");
  check((await getSent()).length === 0, "Holding the IME confirmation key does not send");
  await page.keyboard.up("Enter");
  await press("Enter");
  check((await getSent())[0]?.id === "101", "The next distinct Enter sends immediately after IME confirmation");
  await editor.waitFor({ state: "detached" });
  await page.waitForFunction(() => {
    const post = document.querySelector('[data-post="101"]');
    return window.restoredScroll && Math.abs(post.getBoundingClientRect().top - 66) < 2;
  });
  check(await marked("101").count() === 0 && (await getLikeClicks()).length === 1,
    "A long post is aligned before the confirmation toast");
  await page.evaluate(() => window.confirmLongReply());
  await marked("101").waitFor();
  check((await getLikeClicks()).length === 1 &&
    await page.locator('[data-post="101"] [data-testid="like"]').count() === 1,
    "Enter only submits the reply; liking uses the dedicated shortcut");
  check(await marked("101").evaluate(el => getComputedStyle(el).outlineColor === "rgb(234, 179, 8)"),
    "A successfully replied post has a yellow border even while selected");
  check(await marked("101").evaluate(el => Math.abs(el.getBoundingClientRect().top - 66) < 2),
    "The replied post immediately jumps below the header despite the page's smooth scrolling");
  await choose("101");
  await press("ArrowDown"); await choose("102");
  await press("ArrowDown"); await choose("103");
  await openReply();
  await page.waitForFunction(() => document.activeElement?.dataset.testid === "tweetTextarea_0");
  await press("Escape");
  await editor.waitFor({ state: "detached" });
  await choose("103");
  await press("ArrowDown"); await choose("104");
  await openReply();
  await editor.fill("不应发送");
  await press("Enter");
  check((await getSent()).length === 1, "Mismatched reply URL never sends");
  await press("Escape");
  await press("ArrowDown"); await choose("105");
  await openReply();
  await editor.fill("先不发");
  await editor.evaluate(el => { el.nextElementSibling.disabled = true; });
  await press("Enter");
  await editor.fill("继续修改");
  await page.evaluate(() => new Promise(requestAnimationFrame));
  check((await getSent()).length === 1, "Editing again cancels a queued send");
  await editor.fill("只发一次");
  await page.keyboard.down("Enter");
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await press("Enter");
  check((await getSent()).length === 2, "Held and immediately repeated Enter do not duplicate replies");
  await press("Escape");
  check(await marked("105").count() === 0, "Failure and closing the dialog do not mark a post");
  check((await getLikeClicks()).length === 1, "Failed replies do not like a post");

  await page.getByRole("tab", { name: "正在关注" }).click();
  await selected.waitFor({ state: "detached" });
  await page.locator('[data-post="103"] [data-testid="reply"]').click();
  await editor.fill("鼠标打开后用回车");
  await editor.evaluate(el => { el.nextElementSibling.disabled = true; });
  const beforeEnter = await editor.innerHTML();
  await press("Enter");
  check((await getSent()).length === 2 && await editor.innerHTML() === beforeEnter,
    "A quick Enter does not insert a newline while the send button is still disabled");
  await editor.evaluate(el => { el.nextElementSibling.disabled = false; });
  await editor.waitFor({ state: "detached" });
  check((await getSent())[2]?.id === "103", "Enter sends from a mouse-opened native reply dialog");
  await marked("103").waitFor();
  check((await getLikeClicks()).length === 1, "An existing like is never toggled off");

  await page.locator('[data-post="101"] [data-testid="reply"]').click();
  await editor.fill("用原生回复按钮");
  await page.getByRole("button", { name: "回复", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.querySelector('[data-testid="toast"]').textContent === "你的帖子已发送。");
  await choose("101");
  check((await getSent())[3]?.id === "101", "Mouse send also scrolls to the replied post");
  check((await getLikeClicks()).length === 1, "Native mouse send does not auto-like");

  await page.getByRole("button", { name: "新建推文" }).click();
  await editor.fill("不要把普通推文发出去");
  await press("Enter");
  check((await getSent()).length === 4, "Normal composer is not submitted");
  await press("Escape");
  await page.evaluate(() => {
    window.addPost("106");
    history.pushState({}, "", "/explore");
    window.scrollTo(0, 0);
  });
  await page.locator("[data-xkr-home]").waitFor({ state: "detached" });
  await press("ArrowDown");
  check(await selected.count() === 0, "Navigation is limited to the home route");
  await page.evaluate(() => { document.activeElement.blur(); history.pushState({}, "", "/home"); });
  await page.locator("[data-xkr-home]").waitFor();
  await page.locator('[data-post="106"]').evaluate(el => el.scrollIntoView({ behavior: "instant" }));
  await press("ArrowUp"); await choose("106");
  await page.reload();
  await marked("101").waitFor();
  await marked("103").waitFor();
  check(await marked("105").count() === 0, "Only confirmed replies persist after refresh");
  return "PASS: selected-post X shortcut, separate Enter reply, long-post alignment, and confirmed marks";
}
