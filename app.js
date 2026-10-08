const state = { items: [] };
let activeView = "today";
let todayMode = "urgency";
let taskGroup = "urgency";
let doneFilter = "all";
let editingId = "";
let currentUser = null;
let supabaseClient = null;
let authReady = false;

const urgencyLabels = { high: "Высокая", medium: "Средняя", low: "Низкая" };
const urgencyOrder = ["high", "medium", "low"];

document.addEventListener("DOMContentLoaded", async () => {
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
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    authReady = true;
    await loadCloudState();
    render();
  });
  await loadCloudState();
  authReady = true;
}

function bindEvents() {
  document.querySelector("#authForm").addEventListener("submit", authWithEmail);
  document.querySelector("#signOut").addEventListener("click", signOut);

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      activeView = button.dataset.view;
      render();
    });
  });

  document.querySelectorAll("[data-today-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      todayMode = button.dataset.todayMode;
      render();
    });
  });

  document.querySelectorAll("[data-task-group]").forEach((button) => {
    button.addEventListener("click", () => {
      taskGroup = button.dataset.taskGroup;
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
  state.items = [];
  if (!supabaseClient || !currentUser) return;
  const { data, error } = await supabaseClient.from("tracker_items").select("*").order("created_at", { ascending: false });
  if (error) {
    setStatus(error.message);
    return;
  }
  state.items = data.map(fromRow);
  setStatus("");
}

async function saveItem(item) {
  if (!supabaseClient || !currentUser) return;
  const { error } = await supabaseClient.from("tracker_items").upsert(toRow(item));
  if (error) setStatus(error.message);
}

function prepareCreateForm() {
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
  item.plannedTodayAt = item.plannedTodayAt === today ? null : today;
  await saveItem(item);
  render();
}

async function deleteItem(id) {
  const index = state.items.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  state.items.splice(index, 1);
  if (supabaseClient) {
    const { error } = await supabaseClient.from("tracker_items").delete().eq("id", id);
    if (error) setStatus(error.message);
  }
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
  syncChipState("[data-task-group]", taskGroup, "taskGroup");
  syncChipState("[data-done-filter]", doneFilter, "doneFilter");
  renderToday();
  renderTasks();
  renderHabits();
  renderDone();
  renderCategorySuggestions();
}

function renderToday() {
  const list = document.querySelector("#todayList");
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

function renderTasks() {
  const container = document.querySelector("#tasksList");
  const tasks = state.items.filter((item) => item.type === "task" && item.active);
  container.innerHTML = "";
  if (taskGroup === "urgency") urgencyOrder.forEach((urgency) => appendGroup(container, urgencyLabels[urgency], tasks.filter((item) => item.urgency === urgency)));
  else {
    const categories = [...new Set(tasks.map((item) => displayCategory(item.category)))].sort((a, b) => a.localeCompare(b, "ru"));
    categories.forEach((category) => appendGroup(container, category, tasks.filter((item) => displayCategory(item.category) === category)));
  }
  setEmpty("#tasksEmpty", tasks.length === 0);
}

function renderHabits() {
  const grid = document.querySelector("#habitGrid");
  const habits = state.items.filter((item) => item.type === "habit" && item.active);
  const week = weekDates();
  document.querySelector("#weekRange").textContent = `${formatShortDate(week[0])} - ${formatShortDate(week[6])}`;
  grid.innerHTML = "";
  if (habits.length) {
    const header = document.createElement("div");
    header.className = "habit-row";
    header.appendChild(cell(""));
    week.forEach((date) => header.appendChild(cell(weekdayLabel(date))));
    header.appendChild(cell("Итого"));
    grid.appendChild(header);
  }
  habits.forEach((habit) => {
    const row = document.createElement("div");
    row.className = "habit-row";
    const name = cell(habit.title);
    name.classList.add("habit-name");
    row.appendChild(name);
    let total = 0;
    week.forEach((date) => {
      const done = (habit.completionDates || []).includes(date);
      if (done) total += 1;
      const wrapper = cell("");
      const dot = document.createElement("span");
      dot.className = `habit-dot${done ? " is-done" : ""}`;
      wrapper.appendChild(dot);
      row.appendChild(wrapper);
    });
    const totalCell = cell(`${total}/7`);
    totalCell.classList.add("habit-total");
    row.appendChild(totalCell);
    grid.appendChild(row);
  });
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
  edit.textContent = "Edit";
  edit.addEventListener("click", () => {
    prepareEditForm(item.id);
    openDialog(document.querySelector("#taskDialog"));
  });
  const remove = document.createElement("button");
  remove.className = "delete-button";
  remove.type = "button";
  remove.setAttribute("aria-label", "Удалить");
  remove.textContent = "×";
  remove.addEventListener("click", () => deleteItem(item.id));
  actions.append(plan, edit, remove);
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
  return state.items.filter((item) => item.type === "habit" ? item.active : item.active || item.completedAt === todayISO());
}

function sortTodayItems(items) {
  return [...items].sort((a, b) => {
    const doneDiff = Number(isDoneToday(a)) - Number(isDoneToday(b));
    if (doneDiff !== 0) return doneDiff;
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

function weekDates() {
  const now = new Date();
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
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), app: "my-day-tracker-cloud", version: 1, state }, null, 2);
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
        await saveItem({ ...item, completionDates: item.completionDates || [], createdAt: item.createdAt || new Date().toISOString() });
      }
      await loadCloudState();
      render();
    } finally {
      event.target.value = "";
    }
  });
  reader.readAsText(file);
}
