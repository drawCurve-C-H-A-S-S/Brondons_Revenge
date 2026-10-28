/* global devlogTopics */
(() => {
  const escapeHtml = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );
  const artwork = (topic) => `../src/assets/loading/${topic.image}`;
  const pageId = document.body.dataset.page;
  const number = (index) => String(index + 1).padStart(2, "0");

  if (pageId === "index") {
    document.getElementById("topic-grid").innerHTML = devlogTopics
      .map(
        (topic, index) => `
      <a class="topic-card" href="${topic.id}.html" aria-labelledby="title-${topic.id}">
        <div class="card-art">
          <img src="${artwork(topic)}" alt="" loading="lazy" width="640" height="360" />
          <span class="card-number">${number(index)}</span>
        </div>
        <div class="card-content">
          <span class="card-category">${escapeHtml(topic.category)}</span>
          <h3 id="title-${topic.id}">${escapeHtml(topic.title)}</h3>
          <p>${escapeHtml(topic.teaser)}</p>
          <div class="card-action">Open chapter <span aria-hidden="true">&rarr;</span></div>
        </div>
      </a>`,
      )
      .join("");
    return;
  }

  const index = devlogTopics.findIndex((topic) => topic.id === pageId);
  if (index < 0) {
    document.getElementById("main").textContent =
      "This devlog chapter could not be found. Use All topics to return to the index.";
    console.error("[Devlog] Unknown chapter:", pageId);
    return;
  }
  const topic = devlogTopics[index];
  const clip = `shots/${topic.id}.mp4`;
  const previous = devlogTopics[index - 1];
  const next = devlogTopics[index + 1];
  const chapterLink = (entry, label) =>
    `<a href="${entry ? `${entry.id}.html` : "index.html"}"><span>${label}</span><strong>${entry ? escapeHtml(entry.title) : "All topics"}</strong></a>`;
  const music =
    topic.id === "music"
      ? `
    <section class="listen-panel" aria-labelledby="listen-title">
      <h2 id="listen-title">Listen to the score</h2>
      <p>Two original in-game tracks. No autoplay, no narration: hear the contrast for yourself.</p>
      <div class="audio-grid">
        <figure><figcaption>01 / Stealth</figcaption><audio controls preload="none" aria-label="Stealth music" src="../src/assets/bgm/Stealth1.ogg"></audio></figure>
        <figure><figcaption>02 / Planet</figcaption><audio controls preload="none" aria-label="Planet music" src="../src/assets/bgm/Planetbfm.ogg"></audio></figure>
      </div>
    </section>`
      : "";

  document.getElementById("main").innerHTML = `
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="index.html">All topics</a><span aria-hidden="true">/</span><span aria-current="page">${escapeHtml(topic.title)}</span></nav>
    <header class="topic-heading">
      <span class="chapter-label">CHAPTER ${number(index)} / ${number(devlogTopics.length - 1)}</span>
      <h1>${escapeHtml(topic.title)}</h1>
      <p>${escapeHtml(topic.intro)}</p>
    </header>
    <section class="video-panel" aria-label="${escapeHtml(topic.title)} gameplay video">
      <div class="panel-bar"><span>01 / See it in action</span><span id="clip-badge">Gameplay recording</span></div>
      <video id="gameplay-video" controls playsinline preload="metadata" poster="${artwork(topic)}" aria-label="${escapeHtml(topic.title)} gameplay">
        Your browser does not support embedded video. <a href="${clip}">Download the gameplay clip</a>.
      </video>
      <div class="video-notes">
        <p class="media-status" id="media-status" role="status">Loading chapter recording...</p>
        <p><strong>In this clip:</strong> ${escapeHtml(topic.footage)}</p>
        <details class="video-tools">
          <summary>Add or preview a recording</summary>
          <p>To publish this chapter's video, save it as <code>storyboard/${clip}</code> and reload. MP4 with H.264 video is recommended.</p>
          <label for="clip-file">Or preview a local video (only in this tab; not uploaded or saved):</label>
          <input id="clip-file" type="file" accept="video/*,.mp4,.webm,.mov" aria-describedby="media-status" />
        </details>
      </div>
    </section>
    ${music}
    <div class="topic-intro">
      <section class="explanation" aria-labelledby="how-title"><h2 id="how-title">What is going on?</h2>${topic.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</section>
      <aside class="design-note"><h2>${escapeHtml(topic.noteTitle)}</h2><p>${escapeHtml(topic.note)}</p></aside>
    </div>
    <section aria-labelledby="code-title">
      <div class="breakdown-header"><div><p class="eyebrow">02 / Under the hood</p><h2 id="code-title" class="breakdown-heading">From gameplay to code.</h2></div><p>Source excerpts / not standalone programs</p></div>
      ${topic.snippets
        .map(
          (snippet) => `
        <article class="snippet">
          <h3>${escapeHtml(snippet.title)}</h3>
          <p>${escapeHtml(snippet.explanation)}</p>
          <a class="source-link" href="../${encodeURI(snippet.file)}">${escapeHtml(snippet.file)} <span>/ ${escapeHtml(snippet.symbol)} / ${snippet.language || "TypeScript"}</span></a>
          <pre tabindex="0" aria-label="${escapeHtml(snippet.title)} source excerpt"><code>${escapeHtml(snippet.code)}</code></pre>
        </article>`,
        )
        .join("")}
    </section>
    <nav class="chapter-nav" aria-label="Chapters">${chapterLink(previous, previous ? "Previous chapter" : "Back to the hub")}${chapterLink(next, next ? "Next chapter" : "Back to the hub")}</nav>`;

  const video = document.getElementById("gameplay-video");
  const status = document.getElementById("media-status");
  const badge = document.getElementById("clip-badge");
  let localUrl = null;
  let localName = null;
  video.addEventListener("loadedmetadata", () => {
    badge.textContent = localName ? "Local preview" : "Gameplay recording";
    status.textContent = localName
      ? `Previewing ${localName}. This selection is not saved; add the chapter file to publish it.`
      : "Recording ready. Press play to watch.";
  });
  video.addEventListener("error", () => {
    badge.textContent = localName ? "Preview unavailable" : "Recording pending";
    status.textContent = localName
      ? `Could not play ${localName}. Try an H.264 MP4 or a browser-supported WebM file.`
      : `No playable chapter recording at ${clip}. Add the clip or choose a local preview below. The image is game artwork, not video footage.`;
  });
  document.getElementById("clip-file").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (localUrl) URL.revokeObjectURL(localUrl);
    localName = file.name;
    localUrl = URL.createObjectURL(file);
    status.textContent = `Loading local preview: ${file.name}...`;
    video.src = localUrl;
    video.load();
  });
  document.querySelectorAll("audio").forEach((audio) => {
    audio.addEventListener("error", () => {
      const message = document.createElement("p");
      message.setAttribute("role", "alert");
      message.textContent =
        "This track could not be loaded. Check that the original audio asset is available.";
      audio.replaceWith(message);
    });
  });
  window.addEventListener("pagehide", (event) => {
    if (localUrl && !event.persisted) URL.revokeObjectURL(localUrl);
  });
  video.src = clip;
})();
