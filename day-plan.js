let daySlots = [];
let slotsError = "";
let cloudRequest = 0;
let slotEdit = null;
let writingSlot = false;
const planHours = Array.from({ length: 12 }, (_, index) => index + 8);
const planEl = id => document.getElementById(id);
const hourLabel = hour => String(hour).padStart(2, "0") + ":00";
const intervalLabel = hour => hourLabel(hour) + "–" + hourLabel(hour + 1);

function bindDayPlan() {
  planEl("backToPlan").onclick = () => { todayMode = "plan"; render(); };
  planEl("slotClose").onclick = () => closeDialog(planEl("slotDialog"));
  planEl("slotForm").onsubmit = event => {
    event.preventDefault();
    writeSlot(slotEdit, Number(planEl("slotHour").value), planEl("slotNote").value.trim());
  };
  planEl("slotRemove").onclick = () => writeSlot(slotEdit, null, "");
  planEl("slotUnstar").onclick = () => writeSlot(slotEdit, null, "", true);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && currentUser) loadCloudState().then(render);
  });
}

function renderDayPlan() {
  const root = planEl("dayPlan");
  const heading = document.createElement("h2");
  heading.textContent = "План дня";
  root.replaceChildren(heading);
  if (slotsError) {
    const retry = document.createElement("button");
    retry.className = "small-button";
    retry.textContent = "Загрузить расписание ещё раз";
    retry.onclick = () => loadCloudState().then(render);
    root.append("Не удалось загрузить расписание. ", retry);
    return;
  }
  const habits = todayItems().filter(item => item.type === "habit" && isPlannedToday(item)).sort(compareHabitOrder);
  const pending = habits.filter(item => !daySlots.some(slot => slot.habit_id === item.id));
  const subtitle = document.createElement("h3");
  subtitle.textContent = "Без времени";
  const pool = document.createElement("div");
  pool.className = "plan-list";
  if (!pending.length) pool.textContent = habits.length ? "Все выбранные привычки распределены." : "Выбери привычки звёздочкой в разделе «Привычки».";
  for (const item of pending) pool.append(planRow(null, null, item));
  const schedule = document.createElement("h3");
  schedule.textContent = "Расписание";
  const grid = document.createElement("div");
  grid.className = "plan-list";
  for (const hour of planHours) {
    const slot = daySlots.find(entry => entry.hour === hour);
    grid.append(planRow(hour, slot, habits.find(item => item.id === slot?.habit_id)));
  }
  root.append(subtitle, pool, schedule, grid);
}

function planRow(hour, slot, habit) {
  const row = document.createElement("div");
  const done = habit && isDoneToday(habit);
  row.className = "plan-row" + (habit ? " habit" : "") + (done ? " done" : "");
  const edit = { day: todayISO(), owner: currentUser?.id, hour, slot, habit };
  const label = document.createElement("button");
  label.className = "plan-label";
  label.onclick = () => editSlot(edit);
  if (hour !== null) {
    const time = document.createElement("time");
    time.textContent = intervalLabel(hour);
    label.append(time);
    if (!slot) row.dataset.freeHour = hour;
  }
  const title = document.createElement("span");
  title.textContent = (done ? "✓ " : "") + (habit?.title || slot?.note || "Свободно");
  label.append(title);
  row.append(label);
  if (habit || slot) {
    const grip = document.createElement("button");
    grip.className = "plan-grip";
    grip.textContent = "⠿";
    grip.setAttribute("aria-label", "Перенести на другое время");
    bindSlotDrag(grip, edit);
    row.append(grip);
  }
  return row;
}

function bindSlotDrag(grip, edit) {
  let dragging = false, frame, startX, startY, x, y, target;
  function track() {
    const edge = 92;
    if (y < edge || y > innerHeight - edge) window.scrollBy(0, y < edge ? -7 : 7);
    target?.classList.remove("plan-target");
    target = document.elementFromPoint(x, y)?.closest("[data-free-hour]");
    target?.classList.add("plan-target");
    frame = requestAnimationFrame(track);
  }
  grip.onpointerdown = event => {
    if (!event.isPrimary || event.button !== 0) return;
    dragging = false;
    startX = event.clientX;
    startY = event.clientY;
    grip.setPointerCapture(event.pointerId);
  };
  grip.onpointermove = event => {
    if (!grip.hasPointerCapture(event.pointerId)) return;
    x = event.clientX;
    y = event.clientY;
    if (!dragging && Math.hypot(x - startX, y - startY) > 6) { dragging = true; track(); }
  };
  grip.onpointerup = event => {
    if (!dragging) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-free-hour]");
    if (hit) writeSlot(edit, Number(hit.dataset.freeHour), edit.slot?.note || "");
  };
  grip.onlostpointercapture = () => {
    cancelAnimationFrame(frame);
    target?.classList.remove("plan-target");
  };
  grip.onclick = event => {
    if (!dragging || event.detail === 0) editSlot(edit);
    dragging = false;
  };
  grip.onpointercancel = () => { dragging = false; };
}

function editSlot(edit) {
  slotEdit = edit;
  planEl("slotTitle").textContent = edit.habit?.title || (edit.slot ? "Изменить запись" : "Новая запись");
  planEl("noteLabel").hidden = Boolean(edit.habit);
  planEl("slotNote").required = !edit.habit;
  planEl("slotNote").value = edit.slot?.note || "";
  const select = planEl("slotHour");
  select.replaceChildren();
  for (const hour of planHours) {
    if (hour !== edit.hour && daySlots.some(slot => slot.hour === hour)) continue;
    select.add(new Option(intervalLabel(hour), hour));
  }
  if (edit.hour !== null) select.value = edit.hour;
  planEl("slotForm").querySelector(".primary-button").disabled = !select.options.length;
  planEl("slotRemove").hidden = !edit.slot;
  planEl("slotRemove").textContent = edit.habit ? "Убрать время" : "Удалить запись";
  planEl("slotUnstar").hidden = !edit.habit;
  openDialog(planEl("slotDialog"));
}

async function writeSlot(edit, hour, note, unstar = false) {
  if (writingSlot || !currentUser || currentUser.id !== edit.owner || edit.day !== todayISO()) return;
  if (!edit.habit && hour !== null && !note) { planEl("slotNote").focus(); return; }
  writingSlot = true;
  try {
    if (unstar) {
      const result = await supabaseClient.from("tracker_items").update({ planned_today_at: null })
        .eq("id", edit.habit.id).eq("user_id", edit.owner).eq("planned_today_at", edit.day).select("id").single();
      if (result.error) throw result.error;
    } else {
      const table = supabaseClient.from("tracker_day_slots");
      const values = { hour, note: edit.habit ? null : note, habit_id: edit.habit?.id || null };
      let query;
      if (edit.slot) {
        query = hour === null ? table.delete() : table.update(values);
        query = query.eq("user_id", edit.owner).eq("day", edit.day).eq("hour", edit.slot.hour);
        query = edit.habit ? query.eq("habit_id", edit.habit.id) : query.eq("note", edit.slot.note);
      } else {
        query = table.insert({ ...values, day: edit.day, user_id: edit.owner });
      }
      const { error } = await query.select("hour").single();
      if (error) throw error;
    }
    if (planEl("slotDialog").open) closeDialog(planEl("slotDialog"));
  } catch (error) {
    window.alert("Не удалось сохранить изменение. " + (error.code === "23505" ? "Этот час или привычка уже заняты." : error.message));
    if (planEl("slotDialog").open) closeDialog(planEl("slotDialog"));
  } finally {
    try { await loadCloudState(); render(); } finally { writingSlot = false; }
  }
}
