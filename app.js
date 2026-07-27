(() => {
  const STORAGE_KEY = "life-board-todos-v1";
  const META_KEY = "life-board-meta-v1";
  // Same-origin on Netlify; GH Pages falls back to the Netlify API host below.
  const SYNC_API_CANDIDATES = [
    "/api/todos",
    "https://life-board-kennyhin.netlify.app/api/todos",
  ];

  const CATEGORIES = {
    personal: { label: "Personal", short: "Personal" },
    pe: { label: "Physical Education", short: "PE" },
    athletics: { label: "Athletics", short: "Athletics" },
  };

  const STOP_PATTERN = /(?:^|[\s,.!?])stop(?:[\s,.!?]*)$/i;

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  const els = {
    openAdd: document.getElementById("open-add"),
    sheet: document.getElementById("add-sheet"),
    backdrop: document.getElementById("sheet-backdrop"),
    closeSheet: document.getElementById("close-sheet"),
    cancelAdd: document.getElementById("cancel-add"),
    form: document.getElementById("add-form"),
    text: document.getElementById("todo-text"),
    deadline: document.getElementById("todo-deadline"),
    voiceBtn: document.getElementById("voice-btn"),
    voiceLabel: document.getElementById("voice-label"),
    voiceHint: document.getElementById("voice-hint"),
    archiveToggle: document.getElementById("archive-toggle"),
    archivePanel: document.getElementById("archive-panel"),
    clearArchive: document.getElementById("clear-archive"),
    toast: document.getElementById("toast"),
    syncStatus: document.getElementById("sync-status"),
  };

  let todos = loadLocalTodos();
  let updatedAt = loadLocalMeta().updatedAt || 0;
  let recognition = null;
  let listening = false;
  let wantListening = false;
  let finalVoiceText = "";
  let toastTimer = null;
  let syncApi = null;
  let saveTimer = null;
  let pollTimer = null;
  let syncing = false;

  init();

  async function init() {
    els.deadline.value = todayISO();
    els.deadline.min = todayISO();

    els.openAdd.addEventListener("click", () => openSheet());
    els.closeSheet.addEventListener("click", closeSheet);
    els.cancelAdd.addEventListener("click", closeSheet);
    els.backdrop.addEventListener("click", closeSheet);
    els.form.addEventListener("submit", onSubmit);
    els.voiceBtn.addEventListener("click", toggleVoice);
    els.archiveToggle.addEventListener("click", toggleArchive);
    els.clearArchive.addEventListener("click", clearArchive);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !els.sheet.hidden) closeSheet();
    });

    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEY || e.key === META_KEY) {
        todos = loadLocalTodos();
        updatedAt = loadLocalMeta().updatedAt || updatedAt;
        render();
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") pullRemote();
    });

    if (!SpeechRecognition) {
      els.voiceBtn.disabled = true;
      els.voiceHint.textContent =
        "Voice input needs Safari or Chrome on this device.";
      els.voiceHint.classList.add("is-error");
    }

    render();
    setSyncStatus("Connecting…");
    syncApi = await resolveSyncApi();
    await pullRemote(true);
    startPolling();
  }

  async function resolveSyncApi() {
    for (const url of SYNC_API_CANDIDATES) {
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (res.ok) return url;
      } catch {
        /* try next */
      }
    }
    return null;
  }

  function loadLocalTodos() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function loadLocalMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function persistLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
      localStorage.setItem(
        META_KEY,
        JSON.stringify({ updatedAt })
      );
    } catch {
      setSyncStatus("Storage full — couldn’t save on this device");
      showToast("Couldn’t save on this device");
    }
  }

  function queueSave() {
    updatedAt = Date.now();
    persistLocal();
    render();
    setSyncStatus(syncApi ? "Saving…" : "Saved on this device only");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => pushRemote(), 280);
  }

  async function pushRemote() {
    if (!syncApi || syncing) return;
    syncing = true;
    try {
      const res = await fetch(syncApi, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ todos, updatedAt }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.todos)) {
        todos = data.todos;
        updatedAt = data.updatedAt || updatedAt;
        persistLocal();
        render();
      }
      setSyncStatus("Synced across your devices");
    } catch {
      setSyncStatus("Offline — saved on this device");
    } finally {
      syncing = false;
    }
  }

  async function pullRemote(isInitial = false) {
    if (!syncApi) {
      setSyncStatus("Saved on this device only");
      return;
    }
    try {
      const res = await fetch(syncApi, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const remoteTodos = Array.isArray(data.todos) ? data.todos : [];
      const remoteUpdatedAt = Number(data.updatedAt) || 0;

      if (remoteUpdatedAt > updatedAt) {
        todos = remoteTodos;
        updatedAt = remoteUpdatedAt;
        persistLocal();
        render();
        setSyncStatus("Synced across your devices");
      } else if (updatedAt > remoteUpdatedAt && todos.length) {
        await pushRemote();
      } else {
        setSyncStatus("Synced across your devices");
        if (isInitial && !todos.length && remoteTodos.length) {
          todos = remoteTodos;
          updatedAt = remoteUpdatedAt;
          persistLocal();
          render();
        }
      }
    } catch {
      setSyncStatus("Offline — using this device");
    }
  }

  function startPolling() {
    clearInterval(pollTimer);
    if (!syncApi) return;
    pollTimer = setInterval(() => {
      if (document.visibilityState === "visible" && !listening) pullRemote();
    }, 12000);
  }

  function setSyncStatus(message) {
    if (els.syncStatus) els.syncStatus.textContent = message;
  }

  function todayISO() {
    const d = new Date();
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60 * 1000);
    return local.toISOString().slice(0, 10);
  }

  function uid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function openSheet(prefill = {}) {
    els.form.reset();
    els.deadline.value = prefill.deadline || todayISO();
    els.text.value = prefill.text || "";
    const cat = prefill.category || "personal";
    const radio = els.form.querySelector(`input[name="category"][value="${cat}"]`);
    if (radio) radio.checked = true;
    finalVoiceText = "";

    els.sheet.hidden = false;
    els.backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => els.text.focus());
  }

  function closeSheet() {
    stopVoice(true);
    els.sheet.hidden = true;
    els.backdrop.hidden = true;
    document.body.style.overflow = "";
  }

  function selectedCategory() {
    const checked = els.form.querySelector('input[name="category"]:checked');
    return checked ? checked.value : "personal";
  }

  function onSubmit(e) {
    e.preventDefault();
    const text = els.text.value.trim();
    const deadline = els.deadline.value;
    const category = selectedCategory();

    if (!text || !deadline) return;

    todos.unshift({
      id: uid(),
      text,
      category,
      deadline,
      archived: false,
      createdAt: Date.now(),
      archivedAt: null,
    });

    queueSave();
    closeSheet();
    showToast(`Added to ${CATEGORIES[category].short}`);
  }

  function toggleVoice() {
    if (!SpeechRecognition) return;
    if (listening || wantListening) {
      stopVoice(true);
      els.voiceHint.textContent =
        "Stopped. Edit the text if needed, set a deadline, then Save.";
      els.voiceHint.classList.remove("is-error");
      return;
    }
    startVoice();
  }

  function startVoice() {
    wantListening = true;
    finalVoiceText = els.text.value.trim();
    beginRecognition();
  }

  function beginRecognition() {
    if (!wantListening || !SpeechRecognition) return;

    recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      listening = true;
      els.voiceBtn.setAttribute("aria-pressed", "true");
      els.voiceLabel.textContent = "Listening… say “stop”";
      els.voiceHint.textContent = `Recording for ${CATEGORIES[selectedCategory()].label}. Say “stop” when finished.`;
      els.voiceHint.classList.remove("is-error");
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const chunk = result[0].transcript;
        if (result.isFinal) {
          finalVoiceText = `${finalVoiceText} ${chunk}`.trim();
          if (STOP_PATTERN.test(finalVoiceText)) {
            finalVoiceText = finalVoiceText.replace(STOP_PATTERN, "").trim();
            els.text.value = finalVoiceText;
            stopVoice(true);
            els.voiceHint.textContent =
              "Got it — set a deadline and tap Save, or keep editing.";
            els.voiceHint.classList.remove("is-error");
            return;
          }
        } else {
          interim += chunk;
        }
      }

      const live = `${finalVoiceText} ${interim}`.trim();
      if (STOP_PATTERN.test(live)) {
        const cleaned = live.replace(STOP_PATTERN, "").trim();
        els.text.value = cleaned;
        finalVoiceText = cleaned;
        stopVoice(true);
        els.voiceHint.textContent =
          "Got it — set a deadline and tap Save, or keep editing.";
        els.voiceHint.classList.remove("is-error");
        return;
      }
      if (live) els.text.value = live;
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted") return;
      if (event.error === "no-speech" && wantListening) return;

      const messages = {
        "not-allowed": "Microphone permission blocked. Allow mic access and try again.",
        "no-speech": "Didn’t catch that — try speaking again.",
        network: "Network issue with speech recognition. Try again.",
      };
      els.voiceHint.textContent =
        messages[event.error] || `Voice error: ${event.error}`;
      els.voiceHint.classList.add("is-error");
      if (event.error === "not-allowed") stopVoice(true);
    };

    recognition.onend = () => {
      listening = false;
      recognition = null;
      // Browsers often end continuous sessions early — keep going until user says stop
      if (wantListening) {
        window.setTimeout(() => {
          if (wantListening) beginRecognition();
        }, 180);
        return;
      }
      els.voiceBtn.setAttribute("aria-pressed", "false");
      els.voiceLabel.textContent = "Start speaking";
    };

    try {
      recognition.start();
    } catch {
      window.setTimeout(() => {
        if (wantListening) beginRecognition();
      }, 300);
    }
  }

  function stopVoice(fromUser = false) {
    wantListening = false;
    listening = false;
    els.voiceBtn.setAttribute("aria-pressed", "false");
    els.voiceLabel.textContent = "Start speaking";
    if (recognition) {
      try {
        if (fromUser) recognition.abort();
        else recognition.stop();
      } catch {
        /* ignore */
      }
      recognition = null;
    }
  }

  function archiveTodo(id) {
    const todo = todos.find((t) => t.id === id);
    if (!todo || todo.archived) return;
    animateLeave(id, () => {
      todo.archived = true;
      todo.archivedAt = Date.now();
      queueSave();
      showToast("Moved to archive");
    });
  }

  function restoreTodo(id) {
    const todo = todos.find((t) => t.id === id);
    if (!todo) return;
    todo.archived = false;
    todo.archivedAt = null;
    queueSave();
    showToast("Restored");
  }

  function deleteTodo(id) {
    animateLeave(id, () => {
      todos = todos.filter((t) => t.id !== id);
      queueSave();
      showToast("Deleted");
    });
  }

  function clearArchive() {
    if (!todos.some((t) => t.archived)) return;
    todos = todos.filter((t) => !t.archived);
    queueSave();
    showToast("Archive cleared");
  }

  function toggleArchive() {
    const open = els.archiveToggle.getAttribute("aria-expanded") === "true";
    els.archiveToggle.setAttribute("aria-expanded", String(!open));
    els.archivePanel.hidden = open;
  }

  function animateLeave(id, done) {
    const card = document.querySelector(`[data-id="${id}"]`);
    if (!card) {
      done();
      return;
    }
    card.classList.add("is-leaving");
    window.setTimeout(done, 220);
  }

  function deadlineStatus(deadline) {
    const today = todayISO();
    if (deadline < today) return "overdue";
    if (deadline === today) return "due-soon";
    const inTwo = new Date();
    inTwo.setDate(inTwo.getDate() + 2);
    const offset = inTwo.getTimezoneOffset();
    const local = new Date(inTwo.getTime() - offset * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    if (deadline <= local) return "due-soon";
    return "ok";
  }

  function formatDeadline(deadline) {
    const [y, m, d] = deadline.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const today = todayISO();
    if (deadline === today) return "Due today";
    if (deadline < today) {
      const days = Math.round(
        (Date.parse(today) - Date.parse(deadline)) / (1000 * 60 * 60 * 24)
      );
      return days === 1 ? "1 day overdue" : `${days} days overdue`;
    }
    return date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  function sortActive(a, b) {
    if (a.deadline !== b.deadline) return a.deadline.localeCompare(b.deadline);
    return b.createdAt - a.createdAt;
  }

  function render() {
    const active = todos.filter((t) => !t.archived).sort(sortActive);
    const archived = todos
      .filter((t) => t.archived)
      .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));

    for (const key of Object.keys(CATEGORIES)) {
      const list = document.querySelector(`[data-list="${key}"]`);
      const items = active.filter((t) => t.category === key);
      document.querySelector(`[data-count="${key}"]`).textContent = String(
        items.length
      );
      list.innerHTML = items.length
        ? items.map((t) => cardHTML(t, false)).join("")
        : `<p class="empty">Nothing here yet</p>`;
    }

    const archiveList = document.querySelector('[data-list="archive"]');
    document.querySelector('[data-count="archive"]').textContent = String(
      archived.length
    );
    archiveList.innerHTML = archived.length
      ? archived.map((t) => cardHTML(t, true)).join("")
      : `<p class="empty">Completed todos show up here</p>`;
    els.clearArchive.hidden = archived.length === 0;

    bindCardActions();
  }

  function cardHTML(todo, isArchive) {
    const status = deadlineStatus(todo.deadline);
    const statusClass =
      !isArchive && status === "overdue"
        ? "is-overdue"
        : !isArchive && status === "due-soon"
          ? "is-due-soon"
          : "";
    const deadlineClass =
      !isArchive && status === "overdue"
        ? "is-overdue"
        : !isArchive && status === "due-soon"
          ? "is-due-soon"
          : "";

    return `
      <article class="card ${statusClass}" data-id="${todo.id}">
        <button
          type="button"
          class="check"
          data-action="${isArchive ? "restore" : "archive"}"
          aria-checked="${isArchive ? "true" : "false"}"
          aria-label="${isArchive ? "Restore todo" : "Mark complete"}"
          role="checkbox"
        ></button>
        <div class="card-body">
          <p class="card-text"></p>
          <div class="card-meta">
            <span class="badge-cat" data-cat="${todo.category}">${CATEGORIES[todo.category].short}</span>
            <span class="deadline ${deadlineClass}">${formatDeadline(todo.deadline)}</span>
          </div>
        </div>
        <div class="card-actions">
          <button type="button" class="icon-btn" data-action="delete" aria-label="Delete todo">×</button>
        </div>
      </article>
    `;
  }

  function bindCardActions() {
    document.querySelectorAll(".card").forEach((card) => {
      const id = card.dataset.id;
      const todo = todos.find((t) => t.id === id);
      if (!todo) return;

      card.querySelector(".card-text").textContent = todo.text;

      card.querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const action = btn.dataset.action;
          if (action === "archive") archiveTodo(id);
          if (action === "restore") restoreTodo(id);
          if (action === "delete") deleteTodo(id);
        });
      });
    });
  }

  function showToast(message) {
    els.toast.hidden = false;
    els.toast.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 2200);
  }
})();
