/* =========================================================
   PRE-PAINT PLANNER RESTORE (HIDE PAGE)
========================================================= */
(function () {
  const raw = sessionStorage.getItem("plannerState");
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);

    // Only restore if we are currently on the planner page
    if (!location.pathname.includes("/planner")) return;

    window.__PLANNER_RESTORE__ = parsed;

    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }

    document.documentElement.classList.add("planner-restore");
  } catch (e) {
    console.warn("[PLANNER] restore parse failed", e);
  }
})();

/* =========================================================
   PLANNER.JS — YAML-ALIGNED RESOURCE MODEL
   + Row reorder with placeholder gap
   ========================================================= */

const STORAGE_KEY = "cc_planner_v4";
const RESOURCES = window.RESOURCES || {};

let state = loadState();
let selectedCourse = state.ui?.selectedCourse || "MDH1W";

// Only override if we are restoring from planner navigation
if (window.__PLANNER_RESTORE__?.course) {
  selectedCourse = window.__PLANNER_RESTORE__.course;
}

let activeDropTarget = null;

/* ---------- Day reorder (placeholder-gap) ---------- */
let draggedDay = null;            // { clusterId, dayId }
let dayPlaceholder = document.createElement("div");
dayPlaceholder.className = "day-drop-placeholder";
const DAY_DND_TYPE = "application/x-cc-day";


/* ---------- DOM ---------- */
const clustersWrap = document.querySelector(".planner-clusters");

/* =========================================================
   INIT
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  if (!clustersWrap) return;

  ensureCourse(selectedCourse);
  bindEvents();
  renderAll();

  // Sync course pill UI on load
  document.querySelectorAll(".course-pill").forEach(p => {
    p.classList.toggle(
      "active",
      p.dataset.course === selectedCourse
    );
  });

  // ✅ restore scroll AFTER render
  const restore = window.__PLANNER_RESTORE__;
  if (restore && typeof restore.scrollY === "number") {
    // double rAF = wait for layout/paint
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo(0, restore.scrollY);
        console.log("[PLANNER] scroll restored to", restore.scrollY);

        // unhide page
        document.documentElement.classList.remove("planner-restore");

        sessionStorage.removeItem("plannerState");

      });
    });
  } else {
    // no restore needed; ensure visible
    document.documentElement.classList.remove("planner-restore");
  }
});


/* =========================================================
   STATE
========================================================= */

function freshState() {
  return { ui: {}, courses: {} };
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || freshState();
  } catch {
    return freshState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function ensureCourse(courseId) {
  state.courses ||= {};
  if (!state.courses[courseId]) {
    state.courses[courseId] = { clusters: [newCluster()] };
  }
}

function newCluster() {
  return { id: crypto.randomUUID(), title: "", days: [newDay()] };
}

function newDay() {
  return {
    id: crypto.randomUUID(),
    date: "",
    topic: "",
    notes: "",
    resources: [] // references only
  };
}

function getCluster(courseId, clusterId) {
  return state.courses?.[courseId]?.clusters.find(c => c.id === clusterId) || null;
}

function getDay(courseId, clusterId, dayId) {
  return getCluster(courseId, clusterId)?.days.find(d => d && d.id === dayId) || null;
}

/* =========================================================
   EVENTS
========================================================= */

function bindEvents() {
  // Switch course via pill bar
  document.addEventListener("click", e => {
    const pill = e.target.closest(".course-pill");
    if (!pill) return;

    const courseId = pill.dataset.course;
    if (!courseId || courseId === selectedCourse) return;

    // Update selected course
    selectedCourse = courseId;

    // Persist UI choice
    state.ui ||= {};
    state.ui.selectedCourse = courseId;

    // Ensure course exists
    ensureCourse(courseId);

    saveState();

    // Update active pill styling
    document.querySelectorAll(".course-pill")
      .forEach(p => p.classList.toggle(
        "active",
        p.dataset.course === courseId
      ));

    // Re-render planner for this course
    renderAll();
  });

  /* ---------- CLICK ---------- */
  document.addEventListener("click", e => {
    // Add cluster
    if (e.target.closest(".add-cluster-btn")) {
      state.courses[selectedCourse].clusters.push(newCluster());
      saveState();
      renderAll();
      return;
    }

    // Add day (auto-fill date based on last day; skip weekends)
    if (e.target.closest(".add-day-btn")) {
      const clusterEl = e.target.closest(".planner-cluster");
      if (!clusterEl) return;

      const clusterId = clusterEl.dataset.clusterId;
      const cl = getCluster(selectedCourse, clusterId);
      if (!cl) return;

      const lastDay = cl.days.at(-1);
      const day = newDay();

      if (lastDay?.date) {
        day.date = getNextSchoolDate(lastDay.date);
      }

      cl.days.push(day);
      saveState();
      renderAll();
      return;
    }

    // Delete cluster (with confirmation)
    if (e.target.closest(".delete-cluster-btn")) {
      const clusterEl = e.target.closest(".planner-cluster");
      if (!clusterEl) return;

      const clusterId = clusterEl.dataset.clusterId;
      const clusters = state.courses[selectedCourse].clusters;

      const cluster = clusters.find(c => c.id === clusterId);
      if (!cluster) return;

      if (clusters.length <= 1) {
        alert("You must have at least one cluster.");
        return;
      }

      const name = cluster.title?.trim() || "this";
      const confirmed = window.confirm(`Are you sure you want to delete the "${name}" cluster?`);
      if (!confirmed) return;

      state.courses[selectedCourse].clusters = clusters.filter(c => c.id !== clusterId);
      saveState();
      renderAll();
      return;
    }

    // Delete day row
    if (e.target.closest(".day-remove")) {
      const row = e.target.closest(".day-row[data-day-id]");
      if (!row) return;

      const clusterId = row.dataset.clusterId;
      const dayId = row.dataset.dayId;

      const cluster = getCluster(selectedCourse, clusterId);
      if (!cluster) return;

      cluster.days = cluster.days.filter(d => d && d.id !== dayId);

      saveState();
      renderAll();
      return;
    }

    // Remove mini resource
    const rm = e.target.closest(".mini-remove");
    if (rm) {
      const clusterId = rm.dataset.clusterId;
      const dayId = rm.dataset.dayId;
      const rid = rm.dataset.rid;

      const day = getDay(selectedCourse, clusterId, dayId);
      if (!day) return;

      day.resources = (day.resources || []).filter(r => r._rid !== rid);
      saveState();
      renderAll();
      return;
    }
  });

  /* ---------- INPUT ---------- */
  document.addEventListener("input", e => {
    // Cluster title
    if (e.target.classList.contains("cluster-title")) {
      const clusterEl = e.target.closest(".planner-cluster");
      if (!clusterEl) return;

      const cluster = getCluster(selectedCourse, clusterEl.dataset.clusterId);
      if (!cluster) return;

      cluster.title = e.target.value || "";
      saveState();
      return;
    }

    // Day fields
    const row = e.target.closest(".day-row[data-day-id]");
    if (!row) return;

    const day = getDay(selectedCourse, row.dataset.clusterId, row.dataset.dayId);
    if (!day) return;

    if (e.target.classList.contains("day-date")) day.date = e.target.value || "";
    if (e.target.classList.contains("day-topic")) day.topic = e.target.value || "";
    if (e.target.classList.contains("day-notes")) day.notes = e.target.value || "";

    saveState();
  });

  /* =======================================================
     DRAGSTART — DAY reorder OR RESOURCE drag
     ======================================================= */
    document.addEventListener("dragstart", e => {
      // 1) RESOURCE drag (planner card)
      // 1) RESOURCE drag (planner card)
      const plannerCard = e.target.closest(".planner-resource-card");
      if (plannerCard?.dataset?.dragResource) {
        const payload = safeJsonParse(plannerCard.dataset.dragResource);
        if (!payload) return;

        e.dataTransfer.setData("application/json", JSON.stringify(payload));
        e.dataTransfer.effectAllowed = "move";

        // Optional: set drag image to the card itself (safe)
        if (e.dataTransfer.setDragImage) {
          e.dataTransfer.setDragImage(plannerCard, 10, 10);
        }

        return;
      }


    // 2) RESOURCE drag (bank item)
    const bankItem = e.target.closest(".bank-item");
    if (bankItem?.dataset?.dragResource) {
      const payload = safeJsonParse(bankItem.dataset.dragResource);
      if (!payload) return;

      e.dataTransfer.setData("application/json", JSON.stringify(payload));
      e.dataTransfer.effectAllowed = "copy";
      return;
    }

    // 3) DAY reorder drag (row)
    const row = e.target.closest(".day-row[data-day-id]");
    if (!row) return;

    // ❌ Do not interfere with resource dragging or inputs
    if (e.target.closest(".planner-resource-card")) return;
    if (e.target.closest("button, a, input, textarea")) return;

    draggedDay = {
      clusterId: row.dataset.clusterId,
      dayId: row.dataset.dayId,
      rowEl: row
    };

    requestAnimationFrame(() => {row.classList.add("dragging");});


    e.dataTransfer.setData(DAY_DND_TYPE, JSON.stringify(draggedDay));
    e.dataTransfer.effectAllowed = "move";
  });

  /* =======================================================
     DRAGOVER — placeholder gap for day reorder
     ======================================================= */
  document.addEventListener("dragover", e => {
    // Day reorder drag?
    const isDayReorder = e.dataTransfer?.types?.includes(DAY_DND_TYPE);
    if (!isDayReorder) return;

    // ✅ Allow drop anywhere inside the cluster (prevents 🚫 cursor)
    const clusterEl = e.target.closest(".planner-cluster");
    if (!clusterEl) return;

    e.preventDefault(); // 🔑 THIS removes the "no entry" cursor

    // Must be same cluster as dragged day
    if (!draggedDay || clusterEl.dataset.clusterId !== draggedDay.clusterId) return;

    ensureDayPlaceholder();

    // If hovering the placeholder itself, do nothing (keeps position stable)
    if (e.target.closest(".day-drop-placeholder")) {
      return;
    }

    const row = e.target.closest(".day-row[data-day-id]");
    if (!row) return;

    const rect = row.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;

    // Insert placeholder before or after hovered row
    if (before) {
      if (dayPlaceholder.nextSibling !== row) {
        clusterEl.insertBefore(dayPlaceholder, row);
      }
    } else {
      if (row.nextSibling !== dayPlaceholder) {
        clusterEl.insertBefore(dayPlaceholder, row.nextSibling);
      }
    }
  });


  /* =======================================================
     DROP — finalize day reorder using placeholder position
     ======================================================= */
  /* =======================================================
   DROP — finalize day reorder using placeholder DOM position
   (FIXED: no off-by-one at top/bottom)
   ======================================================= */
/* =======================================================
   DROP — finalize day reorder using placeholder DOM position
   (FIXED: up + down both work)
   ======================================================= */
document.addEventListener("drop", e => {
  const isDayReorder = e.dataTransfer?.types?.includes(DAY_DND_TYPE);
  if (!isDayReorder) return;

  if (!draggedDay || !dayPlaceholder) return;

  const clusterEl = dayPlaceholder.closest(".planner-cluster");
  if (!clusterEl) {
    cleanupDayReorderUI();
    return;
  }

  const clusterId = clusterEl.dataset.clusterId;
  if (clusterId !== draggedDay.clusterId) {
    cleanupDayReorderUI();
    return;
  }

  e.preventDefault();

  const cluster = getCluster(selectedCourse, clusterId);
  if (!cluster) {
    cleanupDayReorderUI();
    return;
  }

  const fromIndex = cluster.days.findIndex(d => d.id === draggedDay.dayId);
  if (fromIndex === -1) {
    cleanupDayReorderUI();
    return;
  }

  // DOM order INCLUDING placeholder, EXCLUDING dragged row
  const visualItems = Array.from(
    clusterEl.querySelectorAll(".day-row[data-day-id], .day-drop-placeholder")
  ).filter(el => {
    return !(el.classList.contains("day-row") &&
             el.dataset.dayId === draggedDay.dayId);
  });

  const toIndex = visualItems.indexOf(dayPlaceholder);
  if (toIndex === -1) {
    cleanupDayReorderUI();
    return;
  }

  const [moved] = cluster.days.splice(fromIndex, 1);
  cluster.days.splice(toIndex, 0, moved);

  saveState();
  renderAll();
  cleanupDayReorderUI();
});



  document.addEventListener("dragend", () => {
    cleanupDayReorderUI();
  });

  /* =======================================================
     RESOURCE DRAGOVER / DROP (your existing behavior)
     ======================================================= */

     
  document.addEventListener("dragleave", e => {
    const row = e.target.closest(".day-row[data-day-id]");
    if (!row) return;

    if (!row.contains(e.relatedTarget)) {
      row.classList.remove("drag-hover");
    }
  });

  document.addEventListener("bank:remove-from-planner", e => {
    const { from, rid } = e.detail;
    if (!from || !rid) return;

    const day = getDay(selectedCourse, from.clusterId, from.dayId);
    if (!day) return;

    day.resources = day.resources.filter(r => r._rid !== rid);
    saveState();
    renderAll();
  });

  // Resource drop
  document.addEventListener("drop", e => {
    // If this is a day reorder drop, ignore resource logic
    if (e.dataTransfer?.types?.includes(DAY_DND_TYPE)) return;

    const dayRow = e.target.closest(".day-row[data-day-id]");
    if (!dayRow) return;

    e.preventDefault();
    dayRow.classList.remove("drag-hover");

    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;

    const payload = safeJsonParse(raw);
    if (!payload) return;

    const contextId = payload.contextId || payload.resourceId;
    const kind = payload.kind;
    const index = payload.index ?? undefined;

    if (!contextId || !kind) return;

    const clusterEl = dayRow.closest(".planner-cluster");
    if (!clusterEl) return;

    const clusterId = clusterEl.dataset.clusterId;
    const dayId = dayRow.dataset.dayId;

    const day = getDay(selectedCourse, clusterId, dayId);
    if (!day) return;

    day.resources ||= [];

    const exists = day.resources.some(r =>
      r.contextId === contextId &&
      r.kind === kind &&
      (r.index ?? undefined) === (index ?? undefined)
    );
    if (exists) return;

    day.resources.push({
      contextId,
      kind,
      index,
      _rid: crypto.randomUUID()
    });

    // MOVE: planner -> planner (remove from old)
    if (payload.source === "planner" && payload.from) {
      const fromDay = getDay(selectedCourse, payload.from.clusterId, payload.from.dayId);
      if (fromDay) {
        fromDay.resources = fromDay.resources.filter(r => r._rid !== payload.rid);
      }
    }

    saveState();
    renderAll();
  });

  // Resource drag hover (only when dragging JSON resources)
document.addEventListener("dragover", e => {
  // Ignore day reordering drags
  if (e.dataTransfer?.types?.includes(DAY_DND_TYPE)) return;

  const row = e.target.closest(".day-row[data-day-id]");
  if (!row) return;

  // Allow drop
  e.preventDefault();

  // Highlight row
  row.classList.add("drag-hover");
});


}

/* =========================================================
   RENDER
========================================================= */

function renderAll() {
  ensureCourse(selectedCourse);
  const course = state.courses[selectedCourse];

  clustersWrap.innerHTML = `
    ${course.clusters.map(renderCluster).join("")}
    <button class="add-cluster-btn">+ Add Cluster</button>
  `;
}

function renderCluster(cluster) {
  return `
    <div class="planner-cluster" data-cluster-id="${escapeAttr(cluster.id)}">

      <input
        class="cluster-title"
        value="${escapeAttr(cluster.title || "")}"
        placeholder="Cluster title"
      />

      <!-- COLUMN HEADERS -->
      <div class="day-row day-header">
        <div>Date</div>
        <div>Topic</div>
        <div>Expectations</div>
        <div>Resources</div>
        <div>Notes</div>
        <div></div>
      </div>

      ${cluster.days.map(d => renderDay(cluster.id, d)).join("")}

      <div class="cluster-footer">
        <button class="add-day-btn">+ Add Day</button>
        <button class="delete-cluster-btn" title="Delete cluster">
          Delete Cluster
        </button>
      </div>

    </div>
  `;
}

function renderDay(clusterId, day) {
  if (!day) return "";

  return `
    <div class="day-row"
         draggable="true"
         data-cluster-id="${escapeAttr(clusterId)}"
         data-day-id="${escapeAttr(day.id)}">

      <input type="date"
             class="day-date"
             value="${escapeAttr(day.date || "")}">

      <input class="day-topic"
             value="${escapeAttr(day.topic || "")}"
             placeholder="Topic">

      <div class="expectations-cell">
        ${renderExpectations(day)}
      </div>

      <div class="resource-cell">
        ${(day.resources || []).map(r => renderMini(r, clusterId, day)).join("")}
        <button class="add-resource-btn">+ Add Resource</button>
      </div>

      <input class="day-notes"
             value="${escapeAttr(day.notes || "")}"
             placeholder="Notes">

      <button class="day-remove" title="Delete day">×</button>
    </div>
  `;
}

function ensureDayPlaceholder() {
  if (dayPlaceholder) return;
  dayPlaceholder = document.createElement("div");
  dayPlaceholder.className = "day-drop-placeholder";
}

/* =========================================================
   DATE HELPERS
========================================================= */

function getNextSchoolDate(prevDateStr) {
  if (!prevDateStr) return "";

  const d = new Date(prevDateStr);
  if (isNaN(d)) return "";

  d.setDate(d.getDate() + 1);

  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }

  return d.toISOString().split("T")[0];
}

function cleanupDayReorderUI() {
  document.querySelectorAll(".day-row.dragging")
    .forEach(r => r.classList.remove("dragging"));

  if (dayPlaceholder?.parentNode) {
    dayPlaceholder.parentNode.removeChild(dayPlaceholder);
  }

  draggedDay = null;
}

/* =========================================================
   RESOURCES (YAML-DRIVEN)
========================================================= */

function resolveResource(ref) {
  const ctx = RESOURCES[ref.contextId];
  if (!ctx) return null;

  if (ref.kind === "practice") {
    return ctx.practice?.[ref.index];
  }
  return ctx[ref.kind];
}

function renderMini(ref, clusterId, day) {
  const ctx = RESOURCES[ref.contextId];
  const res = resolveResource(ref);
  if (!ctx || !res) return "";

  const expectations = ctx.expectations || [];

  const dragJson = escapeAttr(JSON.stringify({
    source: "planner",
    contextId: ref.contextId,
    kind: ref.kind,
    index: ref.index,
    rid: ref._rid,
    from: { clusterId, dayId: day.id }
  }));

  return `
    <div class="planner-resource-card"
      draggable="true"
      data-drag-resource="${dragJson}">

      <div class="planner-resource-header">
        <span class="planner-resource-kind">${humanize(ref.kind)}</span>

        <button
          class="mini-remove"
          data-cluster-id="${escapeAttr(clusterId)}"
          data-day-id="${escapeAttr(day.id)}"
          data-rid="${escapeAttr(ref._rid)}"
          aria-label="Remove resource">
          ×
        </button>
      </div>

      <div class="planner-resource-title">
        <a href="${escapeAttr(res.link)}" target="_blank">
          ${escapeHtml(res.title)}
        </a>
      </div>

      <div class="planner-resource-tags">
        ${expectations.map(e => {
          const strand = e.charAt(0).toLowerCase();
          return `<span class="exp-tag strand-${strand}">${escapeHtml(e)}</span>`;
        }).join("")}
      </div>

    </div>
  `;
}


function renderExpectations(day) {
  const set = new Set();

  (day.resources || []).forEach(r => {
    RESOURCES?.[r.contextId]?.expectations?.forEach(e => set.add(e));
  });

  if (!set.size) return "—";

  return [...set].map(e => {
    const strand = e.charAt(0).toLowerCase();
    return `<span class="exp-tag strand-${strand}">${escapeHtml(e)}</span>`;
  }).join("");
}

/* =========================================================
   SAVE PAGE AND SCROLL
========================================================= */

function savePlannerState() {
  const state = {
    course: selectedCourse || null,
    scrollY: window.scrollY
  };

  console.log("[PLANNER] saving state", state);
  sessionStorage.setItem("plannerState", JSON.stringify(state));
}


// Save when navigating away
document.addEventListener("click", e => {
  const link = e.target.closest("a, button");
  if (!link) return;

  // Ignore clicks that stay on planner
  const href = link.getAttribute("href") || "";
  if (!href || href.includes("/planner")) return;

  savePlannerState();
});

// Safety net
window.addEventListener("beforeunload", savePlannerState);


/* =========================================================
   UTIL
========================================================= */

function humanize(s) {
  return String(s || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[c]));
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
