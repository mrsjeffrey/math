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
let modalSelectedExpectations = [];


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

  try {
    ensureCourse(selectedCourse);
    bindEvents();
    renderAll();

    const exp = document.getElementById("ar-exp");
    if (exp) exp.dataset.empty = "true";

    // Sync course pill UI on load
    document.querySelectorAll(".course-pill").forEach(p => {
      p.classList.toggle("active", p.dataset.course === selectedCourse);
    });

    // ✅ restore scroll AFTER render
    const restore = window.__PLANNER_RESTORE__;
    if (restore && typeof restore.scrollY === "number") {
      // double rAF = wait for layout/paint
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.scrollTo(0, restore.scrollY);
          console.log("[PLANNER] scroll restored to", restore.scrollY);

          sessionStorage.removeItem("plannerState");
        });
      });
    }
  } catch (err) {
    console.error("[PLANNER] init failed:", err);
  } finally {
    // ✅ ALWAYS unhide page, even if something crashed
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
    state.ui.linkLibrary ||= []; 

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

      // Export / Import (single handler — no duplicates)
    document.addEventListener("click", (e) => {
      const exportBtn = e.target.closest(".export-backup-btn");
      if (exportBtn) {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `planner-backup-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }

      const importBtn = e.target.closest(".import-backup-btn");
      if (importBtn) {
        e.preventDefault();
        e.stopPropagation();

        const fileInput = document.getElementById("planner-backup-file");
        if (!fileInput) return;

        fileInput.value = ""; // allow picking same file again

        // Delay one tick to avoid “double open” / weird focus issues
        setTimeout(() => fileInput.click(), 0);
        return;
      }
    });


    document.addEventListener("click", e => {
      const menu = document.querySelector(".course-pill-menu");
      if (!menu) return;

      const clickedExportImport = e.target.closest(".pill-dropdown button");
      if (clickedExportImport) return; // don’t toggle menu when pressing Export/Import

      if (menu.contains(e.target)) {
        menu.classList.toggle("open");
      } else {
        menu.classList.remove("open");
      }
    });

  /* ---------- CLICK ---------- */
  document.addEventListener("click", e => {

 const addRes = e.target.closest(".add-resource-btn");
  if (addRes) {
    const clusterId = addRes.dataset.clusterId;
    const dayId = addRes.dataset.dayId;
    if (!clusterId || !dayId) return;

    openAddResourceModal({ clusterId, dayId });
    return;
  }

  // Modal close (X or Cancel)
  const modalAction = e.target.closest("[data-modal-action]");
  if (modalAction) {
    const action = modalAction.dataset.modalAction;

    if (action === "close" || action === "cancel") {
      closeAddResourceModal();
      return;
    }

    if (action === "save") {
      const target = document.getElementById("add-resource-target");
      const clusterId = target?.dataset.clusterId;
      const dayId = target?.dataset.dayId;
      if (!clusterId || !dayId) return;

      const day = getDay(selectedCourse, clusterId, dayId);
      if (!day) return;

      const type = document.getElementById("ar-type")?.value || "Other";
      const title = (document.getElementById("ar-title")?.value || "").trim();
      const urlRaw = document.getElementById("ar-url")?.value || "";
      const url = normalizeUrl(urlRaw);

      if (!url) {
        alert("Please enter a valid URL (starting with https://).");
        return;
      }

      const expectations = Array.isArray(modalSelectedExpectations)
        ? modalSelectedExpectations.slice(0, 10)
        : [];

      day.resources ||= [];
      day.resources.push({
        _rid: makeId("r"),
        kind: "custom",
        type,
        title: title || url,
        link: url,
        expectations
      });

      saveState();
      closeAddResourceModal();
      renderAll();
      return;
    }
  }

  // Clicking the backdrop closes modal
  if (e.target && e.target.id === "add-resource-backdrop") {
    closeAddResourceModal();
    return;
  }


      // Export one cluster to PDF
    // Export ONE cluster (print existing planner UI)
    const expOne = e.target.closest(".export-cluster-pdf-btn");
    if (expOne) {
      const clusterId = expOne.dataset.clusterId;
      if (!clusterId) return;

      printClusters([clusterId]);
      return;
    }

    // Export ALL clusters
    if (e.target.closest(".export-all-pdf-btn")) {
      const ids = getAllClusterIdsOnPage();
      if (!ids.length) return;

      printClusters(ids);
      return;
    }

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

    // Remove expectation chip
    const x = e.target.closest(".chip-x");
    if (x) {
      const chip = x.closest(".ar-exp-chip");
      const code = (chip?.dataset?.expChip || "").trim();

      const idx = modalSelectedExpectations.findIndex(v => String(v).trim() === code);
      if (idx !== -1) modalSelectedExpectations.splice(idx, 1);

      renderSelectedExpectationsChips(modalSelectedExpectations);

      // reset dropdown option (if you disabled it)
      const sel = document.getElementById("ar-exp");
      if (sel) {
        const opt = Array.from(sel.options).find(o => o.value === code);
        if (opt) opt.disabled = false;
      }
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
// Resource drop
document.addEventListener("drop", (e) => {
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

  const kind = payload.kind;

  const clusterEl = dayRow.closest(".planner-cluster");
  if (!clusterEl) return;

  const clusterId = clusterEl.dataset.clusterId;
  const dayId = dayRow.dataset.dayId;

  const day = getDay(selectedCourse, clusterId, dayId);
  if (!day) return;

  day.resources ||= [];

  /* ─────────────────────────────
     CASE 1: CUSTOM LINK DROP
     (no contextId required)
  ───────────────────────────── */
  if (kind === "custom") {
    const c = payload.custom || {};
    const link = (c.link || "").trim();
    if (!link) return;

    const title = (c.title || link).trim();
    const type = (c.type || "Link").trim();

    // Prevent duplicates (same link + title)
    const exists = day.resources.some(r =>
      r.kind === "custom" &&
      (r.link || "") === link &&
      (r.title || "") === title
    );
    if (exists) return;

    day.resources.push({
      _rid: crypto.randomUUID(),
      kind: "custom",
      type,
      title,
      link,
      expectations: Array.isArray(c.expectations) ? c.expectations : []
    });

    // MOVE: planner -> planner (remove from old)
    if (payload.source === "planner" && payload.from && payload.rid) {
      const fromDay = getDay(selectedCourse, payload.from.clusterId, payload.from.dayId);
      if (fromDay) {
        fromDay.resources = (fromDay.resources || []).filter(r => r._rid !== payload.rid);
      }
    }

    saveState();
    renderAll();
    return;
  }

  /* ─────────────────────────────
     CASE 2: YAML / BANKED RESOURCES
     (needs contextId + kind)
  ───────────────────────────── */
  const contextId = payload.contextId || payload.resourceId;
  const index = payload.index ?? undefined;

  if (!contextId || !kind) return;

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
  if (payload.source === "planner" && payload.from && payload.rid) {
    const fromDay = getDay(selectedCourse, payload.from.clusterId, payload.from.dayId);
    if (fromDay) {
      fromDay.resources = (fromDay.resources || []).filter(r => r._rid !== payload.rid);
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

document.addEventListener("change", e => {
  if (e.target.id !== "ar-exp") return;

  const sel = e.target;
  const code = sel.value;

  if (!code) {
    sel.dataset.empty = "true";
    return;
  }

  sel.dataset.empty = "false";

  // max 10
  if (modalSelectedExpectations.length >= 10) {
    alert("Max 10 expectations.");
    sel.value = "";
    sel.dataset.empty = "true";
    return;
  }

  if (!modalSelectedExpectations.includes(code)) {
    modalSelectedExpectations.push(code);
    renderSelectedExpectationsChips(modalSelectedExpectations);

    const opt = Array.from(sel.options).find(o => o.value === code);
    if (opt) opt.disabled = true;
  }

  sel.value = "";
  sel.dataset.empty = "true";
});

document.getElementById("planner-backup-file")
  .addEventListener("change", function(e) {

    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = function(event) {
      try {
        const imported = JSON.parse(event.target.result);

        if (!imported.courses) {
          alert("Invalid planner file.");
          return;
        }

        if (!confirm("Import will replace your planner. Continue?")) {
          return;
        }

        state = imported;
        saveState();
        renderAll();

      } catch {
        alert("Invalid file format.");
      }
    };

    reader.readAsText(file);
    e.target.value = "";
  });


}

/* =========================================================
   RENDER
========================================================= */

function renderAll() {
  ensureCourse(selectedCourse);
  const course = state.courses[selectedCourse];

  clustersWrap.innerHTML = `
    <div class="planner-toolbar no-print">
      <div class="toolbar-left">
        <!-- leave empty for now -->
      </div>
    </div>

    ${course.clusters.map(renderCluster).join("")}

    <div class="planner-course-actions no-print">
      <button class="add-cluster-btn">+ Add Cluster</button>
      <button class="add-cluster-btn">Export Course as PDF</button>
    </div>

    ${renderAddResourceModal()}
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
        <div class="cluster-footer-left">
          <button class="add-day-btn">+ Add Day</button>

          <button 
            class="export-cluster-pdf-btn"
            data-cluster-id="${cluster.id}"
          >
            Export PDF
          </button>
        </div>

        <button class="delete-cluster-btn">
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
        <button class="add-resource-btn" data-cluster-id="${escapeAttr(clusterId)}" data-day-id="${escapeAttr(day.id)}">+ Add Resource</button>

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

function renderAddResourceModal() {
  return `
    <div class="modal-backdrop" id="add-resource-backdrop" aria-hidden="true">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="add-resource-title">
        <div class="modal-header">
          <div class="modal-title" id="add-resource-title">Add Resource</div>
          <button class="modal-x" data-modal-action="close" aria-label="Close">✕</button>
        </div>

        <div class="modal-body">
          <div class="modal-grid">
            <label class="modal-field">
              <span>Type</span>
              <select id="ar-type" required>
                <option value="" disabled selected hidden>Select type…</option>
                ${getCustomResourceTypeOptions().map(t =>
                  `<option value="${escapeAttr(t)}">${escapeHtml(t)}</option>`
                ).join("")}
              </select>

            </label>

            <label class="modal-field">
              <span>Title</span>
              <input id="ar-title" type="text" placeholder="e.g., Unit 2 Practice Worksheet" />
            </label>

            <label class="modal-field modal-span-2">
              <span>URL</span>
              <input id="ar-url" type="text" placeholder="https://..." />
            </label>

            <label class="modal-field modal-span-2">
              <span>Expectations</span>

              <div class="ar-exp-wrap">
                <div id="ar-exp-selected" class="ar-exp-selected"></div>

                <select id="ar-exp">
                  <option value="" disabled selected hidden>Add an expectation…<option>
                  ${getExpectationsForSelectedCourse().map(code =>
                    `<option value="${escapeAttr(code)}">${escapeHtml(code)}</option>`
                  ).join("")}
                </select>

                <div class="modal-help">Click an expectation to add it. Click a tag to remove.</div>
              </div>
            </label>

          </div>
        </div>

        <div class="modal-actions">
          <button class="modal-btn" data-modal-action="cancel">Cancel</button>
          <button class="modal-btn modal-primary" data-modal-action="save">Save</button>
        </div>

        <div id="add-resource-target" data-cluster-id="" data-day-id="" style="display:none;"></div>
      </div>
    </div>
  `;
}
function renderSelectedExpectationsChips(list) {
  const wrap = document.getElementById("ar-exp-selected");
  if (!wrap) return;

  wrap.innerHTML = (list || []).map(code => `
    <button type="button" class="ar-exp-chip" data-exp-chip="${escapeAttr(code)}">
      ${escapeHtml(code)} <span class="chip-x">×</span>
    </button>
  `).join("");
}

function getCustomResourceTypeOptions() {
  return ["Worksheet", "Slides", "Video", "Activity", "Assessment", "Other"];
}

function getExpectationsForSelectedCourse() {
  // Pull expectations codes from your existing RESOURCES map
  // This keeps it simple + avoids building a new expectations list.
  const set = new Set();

  Object.values(RESOURCES || {}).forEach(ctx => {
    (ctx.expectations?.[selectedCourse] || []).forEach(e => set.add(e));
  });

  // sorted for dropdown
  return [...set].sort((a, b) => a.localeCompare(b));
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
  // ✅ CUSTOM LINK CARD
  if (ref?.kind === "custom") {
    const dragJson = escapeAttr(JSON.stringify({
      source: "planner",
      kind: "custom",
      rid: ref._rid,
      from: { clusterId, dayId: day.id },
      custom: {
        title: ref.title || "",
        link: ref.link || "",
        type: ref.type || "Link",
        expectations: Array.isArray(ref.expectations) ? ref.expectations : []
      }
    }));

    const exps = Array.isArray(ref.expectations) ? ref.expectations : [];

    return `
      <div class="planner-resource-card"
           draggable="true"
           data-drag-resource="${dragJson}">

        <div class="planner-resource-header">
          <span class="planner-resource-kind">${escapeHtml(ref.type || "Link")}</span>

          <button
            class="mini-remove"
            data-cluster-id="${escapeAttr(clusterId)}"
            data-day-id="${escapeAttr(day.id)}"
            data-rid="${escapeAttr(ref._rid)}"
            aria-label="Remove resource">×</button>
        </div>

        <div class="planner-resource-title">
          <a href="${escapeAttr(ref.link)}" target="_blank" rel="noopener">
            ${escapeHtml(ref.title || ref.link)}
          </a>
        </div>

        <div class="planner-resource-tags">
          ${exps.map(e => {
            const strand = String(e).charAt(0).toLowerCase();
            return `<span class="exp-tag strand-${strand}">${escapeHtml(e)}</span>`;
          }).join("")}
        </div>

      </div>
    `;
  }


  // 2) Existing YAML-backed resources
  const ctx = RESOURCES[ref.contextId];
  const res = resolveResource(ref);
  if (!ctx || !res) return "";

  const expectations = ctx.expectations?.[selectedCourse] || [];

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
    // YAML resources
    (RESOURCES?.[r.contextId]?.expectations?.[selectedCourse] || []).forEach(e => set.add(e));

    // Custom resources
    (r.expectations || []).forEach(e => set.add(e));
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

function toAbsoluteLink(href) {
  if (!href) return "";

  const s = String(href).trim();

  // Already absolute or special scheme
  if (/^(https?:)?\/\//i.test(s)) return s;
  if (/^(mailto:|tel:|#)/i.test(s)) return s;

  // Convert relative or site-relative -> absolute on your domain
  try {
    return new URL(s, window.location.origin).href;
  } catch {
    return s;
  }
}

function getAllClusterIdsOnPage() {
  return [...document.querySelectorAll(".planner-cluster[data-cluster-id]")]
    .map(el => el.dataset.clusterId)
    .filter(Boolean);
}

function enterPrintMode(targetClusterIds) {
  document.body.classList.add("printing");

  document.querySelectorAll(".planner-cluster[data-cluster-id]").forEach(el => {
    const id = el.dataset.clusterId;
    el.classList.toggle("print-target", targetClusterIds.includes(id));
  });
}

function exitPrintMode() {
  document.body.classList.remove("printing");
  document.querySelectorAll(".planner-cluster").forEach(el => {
    el.classList.remove("print-target");
  });
}

/**
 * Print selected clusters then restore UI.
 * Uses afterprint + a fallback timeout for browsers that don’t fire afterprint reliably.
 */
function printClusters(targetClusterIds) {
  enterPrintMode(targetClusterIds);

  const restore = () => {
    exitPrintMode();
    window.removeEventListener("afterprint", restore);
  };

  window.addEventListener("afterprint", restore);

  // Print on next tick to ensure DOM updates apply
  setTimeout(() => {
    window.print();

    // Fallback restore (covers some Safari/Chromium edge cases)
    setTimeout(() => {
      if (document.body.classList.contains("printing")) restore();
    }, 1500);
  }, 50);
}

function ensureLinkLibrary() {
  state.ui ||= {};
  state.ui.linkLibrary ||= [];
  return state.ui.linkLibrary;
}

function makeId(prefix="lk") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUrl(raw) {
  if (!raw) return "";
  const s = String(raw).trim();

  // reject obvious local paths
  if (/^[a-zA-Z]:\\/.test(s) || s.startsWith("file://")) return "";

  // add https:// if user pastes "www...." or "drive.google.com/..."
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) {
    return "https://" + s.replace(/^\/+/, "");
  }
  return s;
}

function addLinkToLibrary({ title, url }) {
  const lib = ensureLinkLibrary();
  const cleanUrl = normalizeUrl(url);
  if (!cleanUrl) return null;

  // de-dupe by url
  const existing = lib.find(x => x.url === cleanUrl);
  if (existing) {
    existing.title = title?.trim() || existing.title;
    existing.lastUsedAt = Date.now();
    return existing;
  }

  const item = {
    id: makeId("lk"),
    title: (title || "").trim() || cleanUrl,
    url: cleanUrl,
    tags: [],
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };

  lib.unshift(item);
  saveState();
  return item;
}

function touchLibraryItem(id) {
  const lib = ensureLinkLibrary();
  const item = lib.find(x => x.id === id);
  if (!item) return null;
  item.lastUsedAt = Date.now();
  saveState();
  return item;
}

function searchLibrary(q) {
  const lib = ensureLinkLibrary();
  const s = (q || "").trim().toLowerCase();
  if (!s) return lib.slice(0, 25);

  return lib
    .filter(x =>
      (x.title || "").toLowerCase().includes(s) ||
      (x.url || "").toLowerCase().includes(s)
    )
    .slice(0, 50);
}

function openAddResourceModal({ clusterId, dayId }) {
  const backdrop = document.getElementById("add-resource-backdrop");
  const target = document.getElementById("add-resource-target");
  if (!backdrop || !target) return;

  target.dataset.clusterId = clusterId || "";
  target.dataset.dayId = dayId || "";

  // reset fields
  document.getElementById("ar-type").value = "";
  document.getElementById("ar-title").value = "";
  document.getElementById("ar-url").value = "";
  modalSelectedExpectations = [];
  renderSelectedExpectationsChips(modalSelectedExpectations);

  const expSel = document.getElementById("ar-exp");
  if (expSel) {
    expSel.value = "";
    // re-enable all options
    Array.from(expSel.options).forEach(o => o.disabled = false);
  }


  backdrop.classList.add("open");
  backdrop.setAttribute("aria-hidden", "false");

  setTimeout(() => document.getElementById("ar-title")?.focus(), 0);
}

function closeAddResourceModal() {
  const backdrop = document.getElementById("add-resource-backdrop");
  if (!backdrop) return;
  backdrop.classList.remove("open");
  backdrop.setAttribute("aria-hidden", "true");
}
