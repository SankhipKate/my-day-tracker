const state = { items: [] };
let activeView = "today";
let todayMode = "plan";
let savingOrder = false;
let doneFilter = "all";
let habitAnchor = new Date();
let habitPeriod = "week";
let editingId = "";
let currentUser = null;
let supabaseClient = null;
let authReady = false;

const urgencyLabels = { high: "Высокая", medium: "Средняя", low: "Низкая" };
const urgencyOrder = ["high", "medium", "low"];

document.addEventListener("DOMContentLoaded", async () => {
  let displayedDay = todayISO();
  function refreshDay() {
    const day = todayISO();
    if (day !== displayedDay) {
      if (toISO(habitAnchor) === displayedDay) habitAnchor = new Date();
      displayedDay = day;
      daySlots = [];
      todayMode = "plan";
      if (document.querySelector("#slotDialog").open) closeDialog(document.querySelector("#slotDialog"));
      loadCloudState().then(render);
      render();
    }
  }
  window.setInterval(refreshDay, 30000);
  document.addEventListener("visibilitychange", refreshDay);
  registerServiceWorker();
  setupSupabase();
  bindEvents();
  await initAuth();
  render();
});

function setupSupabase() {
  const config = window.MY_DAY_TRACKER_SUPABASE || {};
  if (!config.url || !config.anonKey || config.url.includes("PASTE_")) {
    authReady = true;
    setStatus("Добавь Supabase URL и anon key в supabase-config.js.");
    return;
  }
  supabaseClient = window.supabase.createClient(config.url, config.anonKey);
}

async function initAuth() {
  if (!supabaseClient) {
    authReady = true;
    return;
  }
  const { data } = await supabaseClient.auth.getSession();
  currentUser = data.session?.user || null;
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    authReady = true;
    setTimeout(() => loadCloudState().then(render), 0);
  });
  await loadCloudState();
  authReady = true;
}

function bindEvents() {
  bindDayPlan();
  document.querySelector("#habitPeriod").onchange = (event) => {
    habitPeriod = event.target.value;
    renderHabits();
  };
  document.querySelector("#previousPeriod").onclick = () => moveHabitPeriod(-1);
  document.querySelector("#nextPeriod").onclick = () => moveHabitPeriod(1);
  document.querySelector("#currentPeriod").onclick = () => {
    habitAnchor = new Date();
    renderHabits();
  };
  document.querySelector("#authForm").addEventListener("submit", authWithEmail);
  document.querySelector("#signOut").addEventListener("click", signOut);

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      activeView = button.dataset.view;
      if (activeView === "today") todayMode = "plan";
      render();
    });
  });

  document.querySelectorAll("[data-today-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      todayMode = todayMode === button.dataset.todayMode ? "plan" : button.dataset.todayMode;
      render();
    });
  });

  document.querySelectorAll("[data-done-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      doneFilter = button.dataset.doneFilter;
      render();
    });
  });

  const dialog = document.querySelector("#taskDialog");
  document.querySelector("#openAddDialog").addEventListener("click", () => {
    prepareCreateForm();
    openDialog(dialog);
    document.querySelector("#taskTitle").focus();
  });
  document.querySelector("#closeForm").onclick = () => closeDialog(dialog);
  const confirmation = document.querySelector("#deleteDialog");
  const confirmButton = document.querySelector("#confirmDelete");
  document.querySelector("#deleteItemButton").onclick = () => {
    const item = state.items.find(entry => entry.id === editingId);
    if (!item) return;
    const habit = item.type === "habit";
    confirmButton.textContent = habit ? "Удалить привычку" : "Удалить задачу";
    document.querySelector("#deleteQuestion").textContent =
      confirmButton.textContent + " «" + item.title + "»" + (habit ? " и все её отметки выполнения?" : "?");
    openDialog(confirmation);
    document.querySelector("#cancelDelete").focus();
  };
  document.querySelector("#cancelDelete").onclick = () => closeDialog(confirmation);
  confirmButton.onclick = async () => {
    if (confirmButton.disabled) return;
    confirmButton.disabled = true;
    const id = editingId;
    closeDialog(confirmation);
    closeDialog(dialog);
    try {
      await deleteItem(id);
    } catch (error) {
      window.alert("Не удалось удалить запись: " + error.message);
    } finally {
      confirmButton.disabled = false;
    }
  };
  const archiveButton = document.querySelector("#archiveItem");
  archiveButton.onclick = async () => {
    if (await setArchived(editingId, true, archiveButton)) closeDialog(dialog);
  };
  dialog.addEventListener("close", () => dialog.classList.remove("is-fallback-open"));

  document.querySelector("#clearCategory").addEventListener("click", () => {
    document.querySelector("#myTrackerCategoryInput").value = "";
  });
  document.querySelector("#exportData").addEventListener("click", exportData);
  document.querySelector("#importData").addEventListener("click", () => document.querySelector("#backupFile").click());
  document.querySelector("#backupFile").addEventListener("change", importData);

  document.querySelector("#taskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      title: form.get("title").trim(),
      type: form.get("type"),
      category: form.get("myTrackerCategoryInput").trim(),
      urgency: form.get("urgency"),
    };
    if (editingId) await updateItem(editingId, input);
    else await addItem(input);
    prepareCreateForm();
    closeDialog(dialog);
  });
}

async function authWithEmail(event) {
  event.preventDefault();
  if (!supabaseClient) return;
  const form = new FormData(event.currentTarget);
  const email = form.get("email").trim();
  const password = form.get("password");
  setStatus("Входим...");

  const signIn = await supabaseClient.auth.signInWithPassword({ email, password });
  if (!signIn.error) {
    setStatus("");
    return;
  }

  const signUp = await supabaseClient.auth.signUp({ email, password });
  if (signUp.error) setStatus(signUp.error.message);
  else setStatus("Аккаунт создан. Если Supabase попросит подтверждение email, открой письмо.");
}

async function signOut() {
  if (supabaseClient) await supabaseClient.auth.signOut();
}

async function loadCloudState() {
  const request = ++cloudRequest;
  const user = currentUser;
  const day = todayISO();
  if (!supabaseClient || !user) {
    state.items = [];
    daySlots = [];
    slotsError = "";
    return;
  }
  const [items, slots] = await Promise.all([
    supabaseClient.from("tracker_items").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabaseClient.from("tracker_day_slots").select("hour,minutes,habit_id,note").eq("user_id", user.id).eq("day", day)
  ]);
  if (request !== cloudRequest || user.id !== currentUser?.id || day !== todayISO()) return;
  state.items = (items.data || []).map(fromRow);
  daySlots = slots.data || [];
  slotsError = items.error?.message || slots.error?.message || "";
  setStatus(items.error?.message || "");
}

async function saveItem(item, importing = false) {
  if (!supabaseClient || !currentUser) return;
  const row = toRow(item);
  if (importing && Number.isInteger(item.habitOrder)) row.habit_order = item.habitOrder;
  const { error } = await supabaseClient.from("tracker_items").upsert(row);
  if (error && importing) throw error;
  if (error) setStatus(error.message);
}

function prepareCreateForm() {
  document.querySelector("#archiveItem").classList.add("is-hidden");
  document.querySelector("#deleteItemButton").classList.add("is-hidden");
  editingId = "";
  document.querySelector("#dialogTitle").textContent = "Новая запись";
  document.querySelector("#saveButton").textContent = "Добавить";
  document.querySelector("#taskForm").reset();
  document.querySelector("#editingId").value = "";
  document.querySelector("#taskUrgency").value = "medium";
  document.querySelector('input[name="type"][value="task"]').disabled = false;
  document.querySelector('input[name="type"][value="habit"]').disabled = false;
  renderCategorySuggestions();
}

function prepareEditForm(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  document.querySelector("#archiveItem").classList.remove("is-hidden");
  document.querySelector("#deleteItemButton").classList.remove("is-hidden");
  editingId = id;
  document.querySelector("#dialogTitle").textContent = "Редактировать";
  document.querySelector("#saveButton").textContent = "Сохранить";
  document.querySelector("#editingId").value = id;
  document.querySelector("#taskTitle").value = item.title;
  document.querySelector("#myTrackerCategoryInput").value = item.category || "";
  document.querySelector("#taskUrgency").value = item.urgency || "medium";
  document.querySelector(`input[name="type"][value="${item.type}"]`).checked = true;
  document.querySelector('input[name="type"][value="task"]').disabled = true;
  document.querySelector('input[name="type"][value="habit"]').disabled = true;
  renderCategorySuggestions();
}

function openDialog(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else {
    dialog.setAttribute("open", "");
    dialog.classList.add("is-fallback-open");
  }
}

function closeDialog(dialog) {
  if (typeof dialog.close === "function") dialog.close();
  else {
    dialog.removeAttribute("open");
    dialog.classList.remove("is-fallback-open");
  }
}

async function addItem(input) {
  const item = {
    id: crypto.randomUUID(),
    type: input.type,
    title: input.title,
    category: input.category,
    urgency: input.urgency,
    active: true,
    completedAt: null,
    completionDates: [],
    createdAt: new Date().toISOString(),
  };
  state.items.unshift(item);
  await saveItem(item);
  render();
}

async function updateItem(id, input) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  item.title = input.title;
  item.category = input.category;
  item.urgency = input.urgency;
  await saveItem(item);
  render();
}

async function toggleItem(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  const today = todayISO();
  if (item.type === "habit") {
    item.completionDates = item.completionDates || [];
    if (item.completionDates.includes(today)) item.completionDates = item.completionDates.filter((date) => date !== today);
    else item.completionDates.push(today);
  } else if (item.completedAt) {
    item.completedAt = null;
    item.active = true;
  } else {
    item.completedAt = today;
    item.active = false;
  }
  await saveItem(item);
  render();
}

async function togglePlanToday(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  const today = todayISO();
  const next = item.plannedTodayAt === today ? null : today;
  const { error } = await supabaseClient.from("tracker_items").update({ planned_today_at: next })
    .eq("id", id).eq("user_id", currentUser.id).select("id").single();
  if (error) { window.alert(error.message); return; }
  item.plannedTodayAt = next;
  if (!next) daySlots = daySlots.filter(slot => slot.habit_id !== id);
  render();
}

async function deleteItem(id) {
  if (!id || !supabaseClient || !currentUser) throw new Error("Требуется вход.");
  const { error } = await supabaseClient.from("tracker_items").delete()
    .eq("id", id).eq("user_id", currentUser.id).select("id").single();
  if (error) throw error;
  state.items = state.items.filter(item => item.id !== id);
  render();
}

function render() {
  document.querySelector("#todayLabel").textContent = formatLongDate(todayISO());
  document.querySelector("#authLoading").classList.toggle("is-hidden", authReady);
  document.querySelector("#authPanel").classList.toggle("is-hidden", !authReady || Boolean(currentUser));
  document.querySelector("#signOut").classList.toggle("is-hidden", !authReady || !currentUser);
  document.querySelector("#appContent").classList.toggle("is-disabled", !authReady || !currentUser);

  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === `view${capitalize(activeView)}`);
  });
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === activeView));
  syncChipState("[data-today-mode]", todayMode, "todayMode");
  syncChipState("[data-done-filter]", doneFilter, "doneFilter");
  renderToday();
  renderHabits();
  renderDone();
  renderArchive("habit");
  renderArchive("task");
  renderCategorySuggestions();
}

async function setArchived(id, archived, button) {
  const item = state.items.find(entry => entry.id === id);
  if (!item || !supabaseClient || !currentUser) return false;
  button.disabled = true;
  try {
    const { error } = await supabaseClient.from("tracker_items")
      .update({ archived }).eq("id", id).eq("user_id", currentUser.id).select("id").single();
    if (error) throw error;
    item.archived = archived;
    if (archived) daySlots = daySlots.filter(slot => slot.habit_id !== id);
    render();
    return true;
  } catch (error) {
    window.alert("Не удалось изменить архив: " + error.message);
    return false;
  } finally {
    button.disabled = false;
  }
}

function renderArchive(type) {
  const items = state.items.filter(item => item.type === type && item.archived);
  document.querySelector("#" + type + "ArchiveCount").textContent = items.length;
  const list = document.querySelector("#" + type + "ArchiveList");
  list.replaceChildren();
  if (!items.length) list.textContent = "Архив пуст";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "archive-row";
    const name = document.createElement("span");
    name.textContent = item.title;
    const dates = item.completionDates || [];
    if (type === "habit" && dates.length) {
      const last = [...dates].sort().pop();
      const info = document.createElement("small");
      info.textContent = "Последнее выполнение: " + formatLongDate(last);
      name.append(info);
    }
    const restore = document.createElement("button");
    restore.className = "small-button";
    restore.textContent = "Вернуть";
    restore.onclick = () => setArchived(item.id, false, restore);
    row.append(name, restore);
    list.append(row);
  }
}

function renderToday() {
  document.querySelector("#taskArchive").hidden = todayMode !== "tasks";
  document.querySelector("#habitArchive").hidden = todayMode !== "habits";
  const list = document.querySelector("#todayList");
  const planning = todayMode === "plan";
  document.querySelector("#backToPlan").hidden = planning;
  document.querySelector("#todayCount").hidden = planning;
  document.querySelector("#dayPlan").hidden = !planning;
  if (planning) {
    list.replaceChildren();
    setEmpty("#todayEmpty", false);
    renderDayPlan();
    return;
  }
  const items = sortTodayItems(todayItems().filter((item) => {
    if (todayMode === "tasks") return item.type === "task";
    if (todayMode === "habits") return item.type === "habit";
    return true;
  }));
  list.innerHTML = "";
  if (todayMode === "category") {
    const categories = [...new Set(items.map((item) => displayCategory(item.category)))].sort((a, b) => a.localeCompare(b, "ru"));
    categories.forEach((category) => appendGroup(list, category, items.filter((item) => displayCategory(item.category) === category)));
  } else if (todayMode === "urgency") {
    appendGroup(list, "Собираюсь сделать сегодня", items.filter(isPlannedToday));
    urgencyOrder.forEach((urgency) => appendGroup(list, urgencyLabels[urgency], items.filter((item) => !isPlannedToday(item) && item.urgency === urgency)));
  } else {
    items.forEach((item) => list.appendChild(taskCard(item)));
  }
  document.querySelector("#todayCount").textContent = `${items.length} ${pluralTasks(items.length)}`;
  setEmpty("#todayEmpty", items.length === 0);
}

function moveHabitPeriod(step) {
  const year = habitAnchor.getFullYear();
  const month = habitAnchor.getMonth();
  if (habitPeriod === "year") habitAnchor = new Date(year + step, month, 1);
  else if (habitPeriod === "month") habitAnchor = new Date(year, month + step, 1);
  else habitAnchor.setDate(habitAnchor.getDate() + 7 * step);
  renderHabits();
}

function renderHabits() {
  const grid = document.querySelector("#habitGrid");

  const year = habitAnchor.getFullYear();
  const month = habitAnchor.getMonth();
  const annual = habitPeriod === "year";
  const weekly = habitPeriod === "week";
  let dates;
  if (weekly) dates = weekDates(habitAnchor);
  else {
    const count = annual ? 12 : new Date(year, month + 1, 0).getDate();
    dates = Array.from({ length: count }, (_, i) =>
      toISO(annual ? new Date(year, i, 1) : new Date(year, month, i + 1)));
  }
  const first = dates[0];
  const last = annual ? year + "-12-31" : dates[dates.length - 1];
  const habits = state.items.filter(item => item.type === "habit" && (item.archived
    ? (item.completionDates || []).some(date => date >= first && date <= last)
    : item.active));
  const label = document.querySelector("#weekRange");
  if (weekly) label.textContent = formatLongDate(dates[0]) + " — " + formatLongDate(dates[6]);
  else label.textContent = annual ? String(year) : habitAnchor.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  grid.replaceChildren();
  grid.style.setProperty("--habit-columns", dates.length);
  function appendRow(title, values, total) {
    const row = document.createElement("div");
    row.className = "habit-row";
    const name = cell(title);
    name.classList.add("habit-name");
    row.append(name, ...values, cell(total));
    grid.append(row);
  }
  if (habits.length) {
    appendRow("", dates.map((date, i) => {
      if (weekly) return cell(weekdayLabel(date));
      if (annual) return cell(new Date(year, i, 1).toLocaleDateString("ru-RU", { month: "short" }));
      return cell(String(i + 1));
    }), "Итого");
  }
  for (const habit of habits) {
    const counts = new Map();
    for (const date of new Set(habit.completionDates || [])) {
      const key = annual ? date.slice(0, 7) : date;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let total = 0;
    const values = dates.map(date => {
      const n = counts.get(annual ? date.slice(0, 7) : date) || 0;
      total += n;
      if (annual) return cell(String(n));
      const wrapper = cell("");
      const dot = document.createElement("span");
      dot.className = "habit-dot" + (n ? " is-done" : "");
      wrapper.setAttribute("aria-label", formatLongDate(date) + (n ? ", выполнено" : ", без отметки"));
      wrapper.append(dot);
      return wrapper;
    });
    appendRow(habit.title, values, weekly ? total + "/7" : String(total));
  }
  setEmpty("#habitsEmpty", habits.length === 0);
}

function renderDone() {
  const container = document.querySelector("#doneList");
  const entries = doneEntries().filter((entry) => doneFilter === "all" || entry.type === doneFilter);
  const byDate = groupBy(entries, "date");
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  container.innerHTML = "";
  dates.forEach((date) => {
    const title = document.createElement("div");
    title.className = "done-date";
    title.textContent = formatLongDate(date);
    container.appendChild(title);
    byDate[date].forEach((entry) => container.appendChild(doneCard(entry)));
  });
  document.querySelector("#doneCount").textContent = String(entries.length);
  setEmpty("#doneEmpty", entries.length === 0);
}

function taskCard(item) {
  const done = isDoneToday(item);
  const planned = isPlannedToday(item);
  const card = document.createElement("article");
  card.className = `task-card is-${item.type}${done ? " is-done" : ""}${planned ? " is-planned-today" : ""}`;
  const check = document.createElement("button");
  check.className = "check-button";
  check.type = "button";
  check.setAttribute("aria-label", done ? "Вернуть в активные" : "Отметить выполненной");
  check.textContent = done ? "✓" : "";
  check.addEventListener("click", () => toggleItem(item.id));
  const main = document.createElement("div");
  main.className = "task-main";
  const title = document.createElement("p");
  title.className = "task-title";
  title.textContent = item.title;
  const meta = document.createElement("div");
  meta.className = "task-meta";
  meta.append(pill(displayCategory(item.category)));
  meta.append(urgencyPill(item.urgency));
  main.append(title, meta);
  const actions = document.createElement("div");
  actions.className = "card-actions";
  const plan = document.createElement("button");
  plan.className = `plan-button${planned ? " is-active" : ""}`;
  plan.type = "button";
  plan.setAttribute("aria-label", planned ? "Убрать из плана на сегодня" : "Собираюсь сделать сегодня");
  plan.textContent = planned ? "★" : "☆";
  plan.addEventListener("click", () => togglePlanToday(item.id));
  const edit = document.createElement("button");
  edit.className = "edit-button";
  edit.type = "button";
  edit.setAttribute("aria-label", "Редактировать");
  edit.textContent = "✎";
  edit.addEventListener("click", () => {
    prepareEditForm(item.id);
    openDialog(document.querySelector("#taskDialog"));
  });
  actions.append(plan, edit);
  if (todayMode === "habits" && item.type === "habit") {
    card.dataset.habitId = item.id;
    card.dataset.done = String(done);
    actions.append(habitHandle(item, card));
  }
  card.append(check, main, actions);
  return card;
}

function doneCard(entry) {
  const card = document.createElement("article");
  card.className = `task-card is-${entry.type} is-done`;
  const check = document.createElement("span");
  check.className = "check-button";
  check.textContent = "✓";
  const main = document.createElement("div");
  main.className = "task-main";
  const title = document.createElement("p");
  title.className = "task-title";
  title.textContent = entry.title;
  const meta = document.createElement("div");
  meta.className = "task-meta";
  meta.append(pill(displayCategory(entry.category)));
  meta.append(urgencyPill(entry.urgency));
  main.append(title, meta);
  card.append(check, main);
  return card;
}

function appendGroup(container, titleText, items) {
  if (!items.length) return;
  const title = document.createElement("div");
  title.className = "group-title";
  title.textContent = titleText;
  container.appendChild(title);
  const list = document.createElement("div");
  list.className = "group-list";
  items.forEach((item) => list.appendChild(taskCard(item)));
  container.appendChild(list);
}

function renderCategorySuggestions() {
  const wrapper = document.querySelector("#categorySuggestions");
  if (!wrapper) return;
  const categories = [...new Set(state.items.map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
  wrapper.innerHTML = "";
  categories.forEach((category) => {
    const button = document.createElement("button");
    button.className = "suggestion-button";
    button.type = "button";
    button.textContent = category;
    button.addEventListener("click", () => {
      document.querySelector("#myTrackerCategoryInput").value = category;
    });
    wrapper.appendChild(button);
  });
}

function todayItems() {
  return state.items.filter((item) => !item.archived && (item.active || (item.type === "task" && item.completedAt === todayISO())));
}

function compareHabitOrder(a, b) {
  const rank = (a.habitOrder ?? Infinity) - (b.habitOrder ?? Infinity);
  return rank || (b.createdAt || "").localeCompare(a.createdAt || "") || a.id.localeCompare(b.id);
}

async function moveHabit(id, targetId, after) {
  if (savingOrder || !currentUser || id === targetId) return;
  const habits = state.items.filter(item => item.type === "habit").sort(compareHabitOrder);
  const moved = habits.find(item => item.id === id);
  const ordered = habits.filter(item => item.id !== id);
  const index = ordered.findIndex(item => item.id === targetId);
  if (!moved || index < 0) return;
  ordered.splice(index + Number(after), 0, moved);
  if (ordered.every((item, i) => item === habits[i])) return;
  savingOrder = true;
  try {
    const { error } = await supabaseClient.rpc("set_tracker_habit_order", { ids: ordered.map(item => item.id) });
    if (error) throw error;
    const ranks = new Map(ordered.map((item, i) => [item.id, i + 1]));
    for (const item of state.items) {
      if (ranks.has(item.id)) item.habitOrder = ranks.get(item.id);
    }
  } catch (error) {
    window.alert("Не удалось сохранить порядок: " + error.message);
  } finally {
    savingOrder = false;
    renderToday();
  }
}

function habitHandle(item, card) {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "habit-handle";
  handle.textContent = "≡";
  handle.setAttribute("aria-label", "Переместить: " + item.title);
  handle.onpointerdown = event => {
    if (!event.isPrimary || event.button !== 0 || savingOrder) return;
    event.preventDefault();
    const pointer = event.pointerId;
    const group = [...card.parentElement.children].filter(row => row.dataset.done === card.dataset.done);
    handle.setPointerCapture(pointer);
    card.classList.add("drag-source");
    let y = event.clientY;
    let target = null;
    let after = false;
    let frame;
    function mark() {
      target?.classList.remove("drop-before", "drop-after");
      target = group.find(row => y < row.getBoundingClientRect().bottom) || group[group.length - 1];
      const rect = target.getBoundingClientRect();
      after = y >= rect.top + rect.height / 2;
      if (target !== card) target.classList.add(after ? "drop-after" : "drop-before");
    }
    function track() {
      if (y < 64) window.scrollBy(0, -8);
      else if (y > window.innerHeight - 96) window.scrollBy(0, 8);
      mark();
      frame = requestAnimationFrame(track);
    }
    handle.onpointermove = e => {
      if (e.pointerId !== pointer) return;
      y = e.clientY;
      if (!frame) track();
    };
    function finish(e) {
      if (e.pointerId !== pointer) return;
      cancelAnimationFrame(frame);
      card.classList.remove("drag-source");
      target?.classList.remove("drop-before", "drop-after");
      handle.onpointermove = handle.onpointerup = handle.onpointercancel = handle.onlostpointercapture = null;
      if (e.type === "pointerup" && target) moveHabit(item.id, target.dataset.habitId, after);
    }
    handle.onpointerup = handle.onpointercancel = handle.onlostpointercapture = finish;
  };
  handle.onkeydown = event => {
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const down = event.key === "ArrowDown";
    const target = down ? card.nextElementSibling : card.previousElementSibling;
    if (target && target.dataset.done === card.dataset.done) moveHabit(item.id, target.dataset.habitId, down);
  };
  return handle;
}

function sortTodayItems(items) {
  return [...items].sort((a, b) => {
    const doneDiff = Number(isDoneToday(a)) - Number(isDoneToday(b));
    if (doneDiff !== 0) return doneDiff;
    if (todayMode === "habits") return compareHabitOrder(a, b);
    if (todayMode === "category") {
      const categoryDiff = displayCategory(a.category).localeCompare(displayCategory(b.category), "ru");
      if (categoryDiff !== 0) return categoryDiff;
    } else if (todayMode === "urgency") {
      const urgencyDiff = urgencyRank(a) - urgencyRank(b);
      if (urgencyDiff !== 0) return urgencyDiff;
    }
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });
}

function doneEntries() {
  const entries = [];
  state.items.forEach((item) => {
    if (item.type === "task" && item.completedAt) entries.push({ ...item, date: item.completedAt });
    if (item.type === "habit") (item.completionDates || []).forEach((date) => entries.push({ ...item, date }));
  });
  return entries;
}

function fromRow(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    category: row.category || "",
    urgency: row.urgency || "medium",
    habitOrder: row.habit_order,
    archived: row.archived === true,
    active: row.active,
    completedAt: row.completed_at,
    completionDates: row.completion_dates || [],
    plannedTodayAt: row.planned_today_at,
    createdAt: row.created_at,
  };
}

function toRow(item) {
  return {
    id: item.id,
    user_id: currentUser.id,
    type: item.type,
    title: item.title,
    category: item.category || null,
    urgency: item.urgency || "medium",
    archived: item.archived === true,
    active: item.active,
    completed_at: item.completedAt,
    completion_dates: item.completionDates || [],
    planned_today_at: item.plannedTodayAt || null,
    created_at: item.createdAt || new Date().toISOString(),
  };
}

function displayCategory(category) {
  return category || "Без категории";
}

function isDoneToday(item) {
  const today = todayISO();
  if (item.type === "habit") return (item.completionDates || []).includes(today);
  return item.completedAt === today;
}

function isPlannedToday(item) {
  return item.plannedTodayAt === todayISO();
}

function urgencyRank(item) {
  const index = urgencyOrder.indexOf(item.urgency || "medium");
  return index === -1 ? 1 : index;
}

function weekDates(now) {
  const start = new Date(now);
  const mondayOffset = (now.getDay() + 6) % 7;
  start.setDate(now.getDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return toISO(date);
  });
}

function todayISO() {
  return toISO(new Date());
}

function toISO(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatLongDate(iso) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${iso}T12:00:00`));
}

function formatShortDate(iso) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00`));
}

function weekdayLabel(iso) {
  return new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(new Date(`${iso}T12:00:00`)).replace(".", "");
}

function groupBy(items, key) {
  return items.reduce((acc, item) => {
    acc[item[key]] = acc[item[key]] || [];
    acc[item[key]].push(item);
    return acc;
  }, {});
}

function cell(text) {
  const element = document.createElement("div");
  element.className = "habit-cell";
  element.textContent = text;
  return element;
}

function pill(text) {
  const element = document.createElement("span");
  element.className = "pill";
  element.textContent = text;
  return element;
}

function urgencyPill(urgency) {
  const element = pill(urgencyLabels[urgency] || "Средняя");
  element.classList.add("urgency-pill", `is-${urgency || "medium"}`);
  return element;
}

function setEmpty(selector, visible) {
  document.querySelector(selector).classList.toggle("is-visible", visible);
}

function syncChipState(selector, value, datasetKey) {
  document.querySelectorAll(selector).forEach((chip) => chip.classList.toggle("is-active", chip.dataset[datasetKey] === value));
}

function capitalize(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function pluralTasks(count) {
  if (count % 10 === 1 && count % 100 !== 11) return "задача";
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return "задачи";
  return "задач";
}

function setStatus(message) {
  document.querySelector("#authStatus").textContent = message || "";
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");
}

function exportData() {
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), app: "my-day-tracker-cloud", version: 2, state, dayPlan: { day: todayISO(), slots: daySlots } }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `daily-tracker-backup-${todayISO()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const file = event.target.files?.[0];
  if (!file || !currentUser) return;
  const reader = new FileReader();
  reader.addEventListener("load", async () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const nextState = parsed.state && Array.isArray(parsed.state.items) ? parsed.state : parsed;
      if (!Array.isArray(nextState.items)) return;
      for (const item of nextState.items) {
        await saveItem({ ...item, completionDates: item.completionDates || [], createdAt: item.createdAt || new Date().toISOString() }, true);
      }
      if (parsed.dayPlan?.day === todayISO() && parsed.dayPlan.slots?.length) {
        const rows = parsed.dayPlan.slots.map(({ hour, minutes = 60, habit_id, note }) => ({
          user_id: currentUser.id, day: todayISO(), hour, minutes, habit_id, note
        }));
        const { error } = await supabaseClient.from("tracker_day_slots")
          .upsert(rows, { onConflict: "user_id,day,hour", ignoreDuplicates: true });
        if (error) throw error;
      }
    } catch (error) {
      window.alert("Не удалось завершить импорт: " + error.message);
    } finally {
      await loadCloudState();
      render();
      event.target.value = "";
    }
  });
  reader.readAsText(file);
}
