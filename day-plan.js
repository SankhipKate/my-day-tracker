let daySlots = [];
let slotsError = "";
let cloudRequest = 0;
let slotEdit = null;
let writingSlot = false;
const planHours = Array.from({ length: 26 }, (_, index) => index / 2 + 8);
const planEl = id => document.getElementById(id);
const hourLabel = hour => String(Math.floor(hour)).padStart(2, "0") + (hour % 1 ? ":30" : ":00");
const intervalLabel = (hour, minutes = 30) => hourLabel(hour) + "–" + hourLabel(hour + minutes / 60);

function fitsSlot(start, minutes, original) {
  const end = start + minutes / 60;
  return start >= 8 && end <= 21 && !daySlots.some(slot =>
    slot !== original && slot.hour < end && start < slot.hour + slot.minutes / 60);
}

function bindDayPlan() {
  planEl("backToPlan").onclick = () => { todayMode = "plan"; render(); };
  planEl("slotClose").onclick = () => closeDialog(planEl("slotDialog"));
  planEl("slotForm").onsubmit = event => {
    event.preventDefault();
    writeSlot(slotEdit, Number(planEl("slotHour").value), planEl("slotNote").value.trim(), false, Number(planEl("slotMinutes").value));
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
  const planned = todayItems().filter(isPlannedToday).sort(compareHabitOrder);
  const pending = planned.filter(item => !daySlots.some(slot => slot.habit_id === item.id));
  const subtitle = document.createElement("h3");
  subtitle.textContent = "Без времени";
  const pool = document.createElement("div");
  pool.className = "plan-list";
  if (!pending.length) pool.textContent = planned.length ? "Все выбранные дела распределены." : "Отметь звёздочкой задачу или привычку на сегодня.";
  for (const item of pending) pool.append(planRow(null, null, item));
  const schedule = document.createElement("h3");
  schedule.textContent = "Расписание";
  const grid = document.createElement("div");
  grid.className = "plan-list plan-schedule";
  for (const hour of planHours) {
    const slot = daySlots.find(entry => entry.hour <= hour && hour < entry.hour + entry.minutes / 60);
    if (slot && slot.hour !== hour) continue;
    grid.append(planRow(hour, slot, planned.find(item => item.id === slot?.habit_id)));
  }
  root.append(subtitle, pool, schedule, grid);
}

function planRow(hour, slot, item) {
  const row = document.createElement("div");
  const done = item && isDoneToday(item);
  row.className = "plan-row" + (item ? " " + item.type : "") + (done ? " done" : "");
  const edit = { day: todayISO(), owner: currentUser?.id, hour: slot?.hour ?? hour, slot, item };
  const label = document.createElement("button");
  label.className = "plan-label";
  label.onclick = () => editSlot(edit);
  if (hour !== null) {
    const time = document.createElement("time");
    time.textContent = intervalLabel(hour, slot?.minutes);
    if (slot?.minutes === 60) row.classList.add("plan-hour");
    label.append(time);
    row.dataset.startHour = hour;
    if (!slot) row.dataset.freeHour = hour;
  }
  const title = document.createElement("span");
  title.textContent = (done ? "✓ " : "") + (item?.title || slot?.note || "Свободно");
  label.append(title);
  row.append(label);
  if (item || slot) {
    const grip = document.createElement("button");
    grip.className = "plan-grip";
    grip.textContent = "⠿";
    grip.setAttribute("aria-label", "Перенести на другое время");
    bindSlotDrag(row, grip, edit);
    row.append(grip);
  }
  return row;
}

// Keep the gesture alive while the list scrolls and the finger leaves the source row.
function bindSlotDrag(row, grip, edit) {
  let suppressClick = false;
  const minutes = edit.slot?.minutes || 30;
  const title = edit.item?.title || edit.slot?.note;
  grip.onclick = () => editSlot(edit);
  row.addEventListener("click", event => {
    if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  function begin(x, y, immediate) {
    let frame, timer, ghost, target, moved = false;
    const startX = x, startY = y;
    function dropHour() {
      const start = Number(target.dataset.startHour);
      if (target !== row || edit.slot?.minutes !== 60) return start;
      const rect = target.getBoundingClientRect();
      return y >= rect.top + rect.height / 2 ? start + 0.5 : start;
    }
    function mark() {
      target?.classList.remove("plan-target");
      target = document.elementFromPoint(x, y)?.closest("[data-start-hour]");
      if (target && !fitsSlot(dropHour(), minutes, edit.slot)) target = null;
      target?.classList.add("plan-target");
    }
    function paint() {
      ghost.style.left = Math.max(8, Math.min(x - 40, innerWidth - ghost.offsetWidth - 8)) + "px";
      ghost.style.top = Math.max(4, y - ghost.offsetHeight - 12) + "px";
      if (moved && y < 72) window.scrollBy(0, -8);
      if (moved && y > innerHeight - 100) window.scrollBy(0, 8);
      mark();
      frame = requestAnimationFrame(paint);
    }
    function lift() {
      ghost = document.createElement("div");
      ghost.className = "plan-drag-preview";
      ghost.textContent = title;
      document.body.append(ghost);
      paint();
    }
    if (immediate) lift();
    else timer = setTimeout(lift, 320);
    return {
      move(nx, ny) {
        x = nx; y = ny;
        if (Math.hypot(x - startX, y - startY) > 4) moved = true;
        if (moved && !ghost) clearTimeout(timer);
        return Boolean(ghost);
      },
      end(drop) {
        clearTimeout(timer);
        cancelAnimationFrame(frame);
        if (ghost) mark();
        const hour = target ? dropHour() : null;
        suppressClick = Boolean(ghost && moved);
        setTimeout(() => { suppressClick = false; }, 400);
        target?.classList.remove("plan-target");
        ghost?.remove();
        if (drop && moved && hour !== null && hour !== edit.slot?.hour)
          writeSlot(edit, hour, edit.slot?.note || "", false, minutes);
      }
    };
  }
  row.addEventListener("touchstart", start => {
    if (start.touches.length !== 1) return;
    const touch = start.changedTouches[0];
    const onGrip = grip.contains(start.target);
    const gesture = begin(touch.clientX, touch.clientY, onGrip);
    const finger = event => Array.from(event.changedTouches).find(t => t.identifier === touch.identifier);
    function move(event) {
      const t = finger(event);
      if (t && gesture.move(t.clientX, t.clientY) && event.cancelable) event.preventDefault();
    }
    function end(event) {
      const t = finger(event);
      if (!t) return;
      gesture.move(t.clientX, t.clientY);
      gesture.end(event.type === "touchend");
      window.removeEventListener("touchmove", move, true);
      window.removeEventListener("touchend", end, true);
      window.removeEventListener("touchcancel", end, true);
    }
    window.addEventListener("touchmove", move, { capture: true, passive: false });
    window.addEventListener("touchend", end, true);
    window.addEventListener("touchcancel", end, true);
  }, { passive: true });
  grip.addEventListener("pointerdown", event => {
    if (event.pointerType === "touch" || event.button !== 0) return;
    const gesture = begin(event.clientX, event.clientY, true);
    function move(e) { if (e.pointerId === event.pointerId) gesture.move(e.clientX, e.clientY); }
    function end(e) {
      if (e.pointerId !== event.pointerId) return;
      move(e);
      gesture.end(e.type === "pointerup");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });
}

function editSlot(edit) {
  slotEdit = edit;
  planEl("slotTitle").textContent = edit.item?.title || (edit.slot ? "Изменить запись" : "Новая запись");
  planEl("noteLabel").hidden = Boolean(edit.item);
  planEl("slotNote").required = !edit.item;
  planEl("slotNote").value = edit.slot?.note || "";
  const select = planEl("slotHour");
  const duration = planEl("slotMinutes");
  duration.value = edit.slot?.minutes || 30;
  function updateHours(preferred) {
    select.replaceChildren();
    const minutes = Number(duration.value);
    for (const hour of planHours) {
      if (fitsSlot(hour, minutes, edit.slot))
        select.add(new Option(intervalLabel(hour, minutes), hour));
    }
    if (preferred != null && fitsSlot(Number(preferred), minutes, edit.slot)) select.value = preferred;
    planEl("slotForm").querySelector(".primary-button").disabled = !select.options.length;
  }
  duration.onchange = () => updateHours(select.value || edit.hour);
  updateHours(edit.hour);
  planEl("slotRemove").hidden = !edit.slot;
  planEl("slotRemove").textContent = edit.item ? "Убрать время" : "Удалить запись";
  planEl("slotUnstar").hidden = !edit.item;
  openDialog(planEl("slotDialog"));
}

async function writeSlot(edit, hour, note, unstar = false, minutes = edit.slot?.minutes || 30) {
  if (writingSlot || !currentUser || currentUser.id !== edit.owner || edit.day !== todayISO()) return;
  if (!edit.item && hour !== null && !note) { planEl("slotNote").focus(); return; }
  writingSlot = true;
  try {
    if (unstar) {
      const result = await supabaseClient.from("tracker_items").update({ planned_today_at: null })
        .eq("id", edit.item.id).eq("user_id", edit.owner).eq("planned_today_at", edit.day).select("id").single();
      if (result.error) throw result.error;
    } else {
      const table = supabaseClient.from("tracker_day_slots");
      const values = { hour, minutes, note: edit.item ? null : note, habit_id: edit.item?.id || null };
      let query;
      if (edit.slot) {
        query = hour === null ? table.delete() : table.update(values);
        query = query.eq("user_id", edit.owner).eq("day", edit.day).eq("hour", edit.slot.hour).eq("minutes", edit.slot.minutes);
        query = edit.item ? query.eq("habit_id", edit.item.id) : query.eq("note", edit.slot.note);
      } else {
        query = table.insert({ ...values, day: edit.day, user_id: edit.owner });
      }
      const { error } = await query.select("hour").single();
      if (error) throw error;
    }
    if (planEl("slotDialog").open) closeDialog(planEl("slotDialog"));
  } catch (error) {
    window.alert("Не удалось сохранить изменение. " + (["23505", "23P01"].includes(error.code) ? "Время занято или у дела уже есть место в расписании." : error.message));
    if (planEl("slotDialog").open) closeDialog(planEl("slotDialog"));
  } finally {
    try { await loadCloudState(); render(); } finally { writingSlot = false; }
  }
}
