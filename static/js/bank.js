/* =====================================================
   CONSTANTS + STATE
   ===================================================== */

const BANK_KEY = "resourceBank";
/* =====================================================
   PULSE ANIMATION
   ===================================================== */

function pulseBank() {
  const bank = document.getElementById("bank-button");
  if (!bank) return;

  bank.classList.remove("pulse", "pulse-end");
  void bank.offsetWidth; // force reflow
  bank.classList.add("pulse");

  setTimeout(() => {
    bank.classList.remove("pulse");
    bank.classList.add("pulse-end");
  }, 300);

  setTimeout(() => {
    bank.classList.remove("pulse-end");
  }, 500);
}

/* =====================================================
   BANK STORAGE HELPERS
   ===================================================== */

function getBank() {
  return JSON.parse(localStorage.getItem(BANK_KEY)) || [];
}

function saveBank(bank) {
  localStorage.setItem(BANK_KEY, JSON.stringify(bank));
}

/* =====================================================
   BADGE
   ===================================================== */

function updateBankBadge() {
  const badge = document.querySelector("#bank-button .bank-badge");
  if (!badge) return;

  const count = getBank().length;

  badge.textContent = count > 99 ? "99+" : count;
  badge.classList.toggle("is-hidden", count === 0);
}

/* =====================================================
   DRAWER OPEN / CLOSE
   ===================================================== */

function openBank({ animate = true } = {}) {
  const drawer = document.getElementById("bank-drawer");
  if (!drawer) return;

  drawer.hidden = false;

  if (animate) {
    drawer.classList.add("animate");
    requestAnimationFrame(() => {
      drawer.classList.add("open");
    });
  } else {
    drawer.classList.remove("animate");
    drawer.classList.add("open");
  }

  localStorage.setItem("bankWasOpen", "1");
}


function closeBank() {
  const drawer = document.getElementById("bank-drawer");
  if (!drawer) return;

  drawer.classList.remove("open");
  setTimeout(() => {
    drawer.hidden = true;
  }, 250);

  localStorage.removeItem("bankWasOpen");
}

/* =====================================================
   RENDER DRAWER
   ===================================================== */

function renderBank() {
  const list = document.querySelector(".bank-list");
  const empty = document.querySelector(".bank-empty");
  const bank = getBank();

  if (!list || !empty) return;

  list.innerHTML = "";

  if (bank.length === 0) {
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";

  bank.forEach((item, index) => {
    const el = document.createElement("div");
    el.className = "bank-item";

    el.innerHTML = `
      <div class="bank-item-row bank-item-row-top">
        <span class="bank-item-type">${item.kind}</span>
        <button class="bank-item-remove" data-index="${index}">✕</button>
      </div>

      <div class="bank-item-row bank-item-row-bottom">
        <div class="bank-item-title">${item.title}</div>

        <div class="bank-item-tags">
          ${(item.curriculum || [])
            .map(tag => {
              const strand = tag.charAt(0).toLowerCase();
              return `<span class="exp-tag strand-${strand}">${tag}</span>`;
            })
            .join("")}
        </div>
      </div>
    `;

    list.appendChild(el);

  el.setAttribute("draggable", "true");

  el.dataset.dragResource = JSON.stringify({
    source: "bank",
    contextId: item.contextId,   // REQUIRED — YAML key
    kind: item.kind,             // lesson_plan | lesson_notes | practice
    index: item.index ?? null    // REQUIRED for practice
  });


  });

}

/* =====================================================
   ADD RESOURCE TO BANK
   ===================================================== */

function addResourceToBank(resource) {
  const bank = getBank();

  const contextId = resource.contextId ?? resource.resourceId;
  if (!contextId || !resource.kind) {
    console.warn("BANK REJECTED invalid resource:", resource);
    return;
  }

  /* =========================================
     🔁 RE-HYDRATE FROM YAML IF NEEDED
     ========================================= */

  let title = resource.title;
  let curriculum = resource.curriculum || [];
  let link = resource.link;

  if (resource.source === "planner") {
    const ctx = window.RESOURCES?.[contextId];
    if (!ctx) {
      console.warn("BANK: missing RESOURCES context", contextId);
      return;
    }

    let resolved;
    if (resource.kind === "practice") {
      resolved = ctx.practice?.[resource.index];
    } else {
      resolved = ctx[resource.kind];
    }

    if (!resolved) {
      console.warn("BANK: could not resolve resource", resource);
      return;
    }

    title = resolved.title;
    link = resolved.link;
    curriculum = ctx.expectations?.[selectedCourse] || [];

    // 🔔 Tell planner to remove original
    document.dispatchEvent(
      new CustomEvent("bank:remove-from-planner", {
        detail: resource
      })
    );
  }

  /* =========================================
     ✅ NORMALIZED BANK OBJECT
     ========================================= */

  const normalized = {
    source: "bank",
    contextId,
    kind: resource.kind,
    index: resource.index,
    title,
    link,
    curriculum
  };

  /* ---------- DEDUPE ---------- */
  if (
    bank.some(item =>
      item.contextId === normalized.contextId &&
      item.kind === normalized.kind &&
      item.index === normalized.index
    )
  ) {
    pulseBank();
    return;
  }

  bank.push(normalized);
  saveBank(bank);

  updateBankBadge();
  renderBank();
  pulseBank();
}


/* =====================================================
   REMOVE FROM BANK
   ===================================================== */

document.addEventListener("click", e => {
  const btn = e.target.closest(".bank-item-remove");
  if (!btn) return;

  const index = Number(btn.dataset.index);
  if (Number.isNaN(index)) return;

  const bank = getBank();
  bank.splice(index, 1);

  saveBank(bank);
  updateBankBadge();
  renderBank();
});

/* =====================================================
   ADD-TO-PLAN BUTTON CLICK
   ===================================================== */

document.addEventListener("click", e => {
  const btn = e.target.closest(".add-to-plan-btn");
  if (!btn) return;

  const card = btn.closest(".resource-master-card");
  if (!card) return;

  const links = card.querySelectorAll(".resource-link");
  if (!links.length) return;

  links.forEach(link => {
    const payload = {
      source: "catalogue",
      contextId: link.dataset.contextId,
      kind: link.dataset.kind,
      index: link.dataset.index ? Number(link.dataset.index) : undefined,
      title: link.textContent.trim(),
      link: link.href,
      curriculum: Array.from(
        card.querySelectorAll(".exp-tag")
      ).map(t => t.textContent.trim())
    };

    addResourceToBank(payload);
  });
});



/* =====================================================
   DRAG & DROP (RESOURCE → BANK BUTTON)
   ===================================================== */

document.addEventListener("dragstart", e => {
  let payload = null;

  /* =========================
     BANK → DRAG (FIRST!)
     ========================= */
  const bankItem = e.target.closest(".bank-item");
  if (bankItem) {
    payload = JSON.parse(bankItem.dataset.dragResource);
  }

  /* =========================
     PLANNER → DRAG
     ========================= */
  if (!payload) {
    const plannerCard = e.target.closest(".resource-mini-card");
    if (plannerCard) {

      payload = JSON.parse(plannerCard.dataset.dragResource);
    }
  }

  /* =========================
     CATALOGUE → DRAG
     ========================= */
  if (!payload) {
    const catalogueLink = e.target.closest(".resource-link");
    if (catalogueLink) {
      const card = catalogueLink.closest(".resource-master-card");
      if (!card) return;

      const curriculum = Array.from(
        card.querySelectorAll(".exp-tag")
      ).map(t => t.textContent.trim());

      payload = {
        source: "catalogue",
        contextId: catalogueLink.dataset.contextId,
        kind: catalogueLink.dataset.kind,
        index: catalogueLink.dataset.index
          ? Number(catalogueLink.dataset.index)
          : undefined,
        title: catalogueLink.textContent.trim(),
        link: catalogueLink.href,
        curriculum
      };

    }
  }

  if (!payload) return;

  e.dataTransfer.setData(
    "application/json",
    JSON.stringify(payload)
  );
  e.dataTransfer.effectAllowed = "copy";
});


function isDrawerOpen() {
  const drawer = document.getElementById("bank-drawer");
  return drawer && drawer.classList.contains("open");
}


/* =====================================================
   INIT
   ===================================================== */

document.addEventListener("DOMContentLoaded", () => {

  const bankButton = document.getElementById("bank-button");
  const closeBtn = document.getElementById("bank-close");
  const drawer = document.getElementById("bank-drawer");
  const wasOpen = localStorage.getItem("bankWasOpen") === "1";

  /* ===============================
     BANK BUTTON (FLOATING ICON)
     =============================== */

  if (bankButton) {
    bankButton.addEventListener("click", openBank);

    bankButton.addEventListener("dragover", e => {
      e.preventDefault();
      bankButton.classList.add("drag-hover");
    });

    bankButton.addEventListener("dragleave", () => {
      bankButton.classList.remove("drag-hover");
    });

    bankButton.addEventListener("drop", e => {
      e.preventDefault();
      bankButton.classList.remove("drag-hover");

      const data = e.dataTransfer.getData("application/json");
      if (!data) return;

      const resource = JSON.parse(data);
      addResourceToBank(resource);
    });
  }

  /* ===============================
     BANK DRAWER (OPEN STATE DROP)
     =============================== */

  if (drawer) {
    drawer.addEventListener("dragover", e => {
      e.preventDefault();
      drawer.classList.add("drag-hover");
    });

    drawer.addEventListener("dragleave", e => {
      if (!drawer.contains(e.relatedTarget)) {
        drawer.classList.remove("drag-hover");
      }
    });

    drawer.addEventListener("drop", e => {
      e.preventDefault();
      drawer.classList.remove("drag-hover");

      const data = e.dataTransfer.getData("application/json");
      if (!data) return;

      const resource = JSON.parse(data);
      addResourceToBank(resource);
    });
  }
    if (wasOpen) {
      openBank({ animate: false });
    }

  /* ===============================
     CLOSE BUTTON
     =============================== */

  if (closeBtn) {
    closeBtn.addEventListener("click", closeBank);
  }

  /* ===============================
     INIT RENDER
     =============================== */

  updateBankBadge();
  renderBank();
});
