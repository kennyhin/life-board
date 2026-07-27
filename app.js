(() => {
  const STORAGE_KEY = "life-board-todos-v1";

  const CATEGORIES = {
    personal: { label: "Personal", short: "Personal" },
    pe: { label: "Physical Education", short: "PE" },
    athletics: { label: "Athletics", short: "Athletics" },
  };

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
  };

  let todos = loadTodos();
  let recognition = null;
  let listening = false;
  let toastTimer = null;

  init();

  function init() {
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

    if (!SpeechRecognition) {
      els.voiceBtn.disabled = true;
      els.voiceHint.textContent =
        "Voice input needs Safari or Chrome on this device.";
      els.voiceHint.classList.add("is-error");
    }

    render();
  }

  function loadTodos() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveTodos() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
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

    els.sheet.hidden = false;
    els.backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => els.text.focus());
  }

  function closeSheet() {
    stopVoice();
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

    saveTodos();
    render();
    closeSheet();
    showToast(`Added to ${CATEGORIES[category].short}`);
  }

  function toggleVoice() {
    if (!SpeechRecognition) return;
    if (listening) {
      stopVoice();
      return;
    }
    startVoice();
  }

  function startVoice() {
    recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    let finalText = "";

    recognition.onstart = () => {
      listening = true;
      els.voiceBtn.setAttribute("aria-pressed", "true");
      els.voiceLabel.textContent = "Listening… tap to stop";
      els.voiceHint.textContent = `Speaking into ${CATEGORIES[selectedCategory()].label}…`;
      els.voiceHint.classList.remove("is-error");
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      const combined = `${finalText} ${interim}`.trim();
      if (combined) els.text.value = combined;
    };

    recognition.onerror = (event) => {
      const messages = {
        "not-allowed": "Microphone permission blocked. Allow mic access and try again.",
        "no-speech": "Didn't catch that — try speaking again.",
        network: "Network issue with speech recognition. Try again.",
        aborted: "Voice input stopped.",
      };
      els.voiceHint.textContent =
        messages[event.error] || `Voice error: ${event.error}`;
      els.voiceHint.classList.add("is-error");
      stopVoice(false);
    };

    recognition.onend = () => {
      stopVoice(false);
      if (els.text.value.trim()) {
        els.voiceHint.textContent =
          "Got it — set a deadline and tap Save, or keep editing.";
        els.voiceHint.classList.remove("is-error");
      }
    };

    try {
      recognition.start();
    } catch {
      els.voiceHint.textContent = "Could not start voice input. Try again.";
      els.voiceHint.classList.add("is-error");
      stopVoice(false);
    }
  }

  function stopVoice(abort = true) {
    listening = false;
    els.voiceBtn.setAttribute("aria-pressed", "false");
    els.voiceLabel.textContent = "Speak to add";
    if (recognition) {
      try {
        if (abort) recognition.abort();
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
      saveTodos();
      render();
      showToast("Moved to archive");
    });
  }

  function restoreTodo(id) {
    const todo = todos.find((t) => t.id === id);
    if (!todo) return;
    todo.archived = false;
    todo.archivedAt = null;
    saveTodos();
    render();
    showToast("Restored");
  }

  function deleteTodo(id) {
    animateLeave(id, () => {
      todos = todos.filter((t) => t.id !== id);
      saveTodos();
      render();
      showToast("Deleted");
    });
  }

  function clearArchive() {
    if (!todos.some((t) => t.archived)) return;
    todos = todos.filter((t) => !t.archived);
    saveTodos();
    render();
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
        (new Date(today) - new Date(deadline)) / (1000 * 60 * 60 * 24)
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

    const checkLabel = isArchive ? "Restore todo" : "Mark complete";
    const deleteLabel = "Delete todo";

    return `
      <article class="card ${statusClass}" data-id="${todo.id}">
        <button
          type="button"
          class="check"
          data-action="${isArchive ? "restore" : "archive"}"
          aria-checked="${isArchive ? "true" : "false"}"
          aria-label="${checkLabel}"
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
          <button type="button" class="icon-btn" data-action="delete" aria-label="${deleteLabel}">×</button>
        </div>
      </article>
    `;
  }

  function bindCardActions() {
    document.querySelectorAll(".card").forEach((card) => {
      const id = card.dataset.id;
      const todo = todos.find((t) => t.id === id);
      if (!todo) return;

      const textEl = card.querySelector(".card-text");
      textEl.textContent = todo.text;

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
