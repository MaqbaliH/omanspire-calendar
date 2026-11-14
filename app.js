(() => {
  "use strict";

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const IS_LOCAL_HOST =
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost";

  const state = {
    staticTeamMode: !IS_LOCAL_HOST,
    syncedAtMuscat: "",
    lastFingerprint: "",
    contentDigest: "",
    liveSync: null,
    inspectorBusy: false,
    showEmptyDaysMobile: false,
    items: [],
    stats: {},
    months: [],
    campaigns: [],
    serverTimeMuscat: "",
    todayDateStr: "",
    view: "calendar",         // "calendar" | "pipeline"
    channelFilter: "all",     // "all" | "website" | "instagram"
    categoryFilter: "all",
    campaignFilter: "all",
    backlogTab: "drafts",     // "drafts" | "ready"
    backlogSearch: "",
    backlogMonth: "Nov-2026",
    calYear: 2026,
    calMonth: 10,             // 0-indexed (10 = November)
    activeStoryId: null,
    activeDetail: null,
    activeSlideIdx: 0,
    pickerDateStr: null,
  };

  const el = (id) => document.getElementById(id);

  function computeLiveMuscatIso() {
    // Shift UTC ms by +4 hours (Muscat UTC+04:00, no DST)
    const muscatMs = Date.now() + 4 * 3600 * 1000;
    const d = new Date(muscatMs);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mi = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
  }

  function mediaUrl(relPath) {
    if (!relPath) return "";
    if (/^https?:\/\//i.test(relPath)) return relPath;
    if (state.staticTeamMode) {
      return `./${relPath.replace(/^\.?\//, "")}`;
    }
    return `/api/media?path=${encodeURIComponent(relPath)}`;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showToast(msg, isError = false) {
    const wrap = el("toastContainer");
    const node = document.createElement("div");
    node.className = `toast${isError ? " toast-err" : ""}`;
    node.textContent = msg;
    wrap.appendChild(node);
    setTimeout(() => {
      node.remove();
    }, 4500);
  }

  function splitIsoDateTime(isoStr) {
    if (!isoStr || typeof isoStr !== "string" || isoStr.length < 10) {
      return { date: "", time: "" };
    }
    return {
      date: isoStr.slice(0, 10),
      time: isoStr.length >= 16 ? isoStr.slice(11, 16) : "",
    };
  }

  function addMinutesToTimeStr(timeHHMM, minsToAdd) {
    if (!timeHHMM || !timeHHMM.includes(":")) return "19:50";
    const [hh, mm] = timeHHMM.split(":").map((n) => parseInt(n, 10));
    if (Number.isNaN(hh) || Number.isNaN(mm)) return "19:50";
    const total = (hh * 60 + mm + minsToAdd + 1440) % 1440;
    const nh = String(Math.floor(total / 60)).padStart(2, "0");
    const nm = String(total % 60).padStart(2, "0");
    return `${nh}:${nm}`;
  }

  function formatHumanDate(dateStr) {
    if (!dateStr) return "Unscheduled";
    const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dow = SHORT_DAYS[dt.getUTCDay()];
    return `${dow}, ${d} ${SHORT_MONTHS[m - 1]} ${y}`;
  }

  function relativeDayLabel(dateStr) {
    if (!dateStr || !state.todayDateStr) return "";
    const [ty, tm, td] = state.todayDateStr.split("-").map((n) => parseInt(n, 10));
    const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
    const t0 = Date.UTC(ty, tm - 1, td);
    const t1 = Date.UTC(y, m - 1, d);
    const diff = Math.round((t1 - t0) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
    if (diff > 1) return `In ${diff} days`;
    return `${Math.abs(diff)}d ago`;
  }

  function stateLabel(st) {
    switch (st) {
      case "scheduled": return "Scheduled";
      case "published": return "Live / Sent";
      case "planned": return "Planned (Local)";
      case "draft": return "Server Draft";
      case "ready": return "Ready in Queue";
      default: return "Missing";
    }
  }

  function applyTeamModeChrome() {
    document.body.classList.toggle("team-readonly", state.staticTeamMode);
    const pill = el("modeBadgePill");
    const hint = document.querySelector(".legend-hint");
    const capArea = el("inspCaptionInput");

    if (state.staticTeamMode) {
      if (pill) {
        const syncSplit = splitIsoDateTime(state.syncedAtMuscat);
        pill.textContent = syncSplit.date
          ? `TEAM LIVE VIEW · SYNCED ${syncSplit.date} ${syncSplit.time} GST`
          : "TEAM LIVE VIEW · READ-ONLY";
      }
      if (hint) {
        hint.innerHTML = "Click any story card on the calendar, pipeline, or queue to preview <strong>4:5 Carousel slides</strong>, <strong>9:16 Story</strong>, <strong>Caption</strong>, and <strong>Website Article</strong>.";
      }
      if (capArea) capArea.readOnly = true;
      el("adminPlanControls")?.classList.add("hidden");
      el("teamReadOnlyPanel")?.classList.remove("hidden");
    } else {
      if (pill) pill.textContent = "LOCAL WORKSPACE SOURCE ONLY";
      if (capArea) capArea.readOnly = false;
      el("adminPlanControls")?.classList.remove("hidden");
      el("teamReadOnlyPanel")?.classList.add("hidden");
    }
  }

  function reconcileLiveStatesWithClock(items, liveIso) {
    let upWeb = 0;
    let upIg = 0;
    let liveWeb = 0;
    let liveIg = 0;
    let drafts = 0;

    for (const it of items) {
      if (it.website.state === "scheduled" && it.website.scheduled_local && it.website.scheduled_local <= liveIso) {
        it.website.state = "published";
      }
      if (it.instagram.state === "scheduled" && it.instagram.scheduled_local && it.instagram.scheduled_local <= liveIso) {
        it.instagram.state = "published";
      }

      if (it.website.state === "scheduled" || it.website.state === "planned") upWeb++;
      if (it.instagram.state === "scheduled" || it.instagram.state === "planned") upIg++;
      if (it.website.state === "published") liveWeb++;
      if (it.instagram.state === "published") liveIg++;
      if (!it.has_calendar_slot && (it.website.state === "draft" || it.instagram.state === "draft")) drafts++;
    }

    state.stats = {
      ...state.stats,
      upcoming_website: upWeb,
      upcoming_instagram: upIg,
      live_website: liveWeb,
      live_instagram: liveIg,
      pushed_drafts: drafts,
    };
  }

  function matchesTopFilters(item) {
    if (state.categoryFilter !== "all" && item.category !== state.categoryFilter) {
      return false;
    }
    if (state.campaignFilter !== "all" && (item.plan?.campaign || "") !== state.campaignFilter) {
      return false;
    }
    if (state.channelFilter === "website") {
      return item.website.state !== "missing";
    }
    if (state.channelFilter === "instagram") {
      return item.instagram.state !== "missing";
    }
    return true;
  }

  function updateLiveSyncIndicator(syncObj) {
    if (!syncObj || state.staticTeamMode) return;
    state.liveSync = syncObj;
    const pill = el("liveSyncPill");
    const txt = el("liveSyncText");
    if (!pill || !txt) return;

    pill.classList.remove("is-syncing", "is-error");
    if (syncObj.state === "syncing") {
      pill.classList.add("is-syncing");
      txt.textContent = "SYNCING TO LIVE…";
      pill.title = syncObj.message || "Pushing latest schedule to GitHub Pages…";
    } else if (syncObj.state === "error") {
      pill.classList.add("is-error");
      txt.textContent = "LIVE SYNC CHECK";
      pill.title = syncObj.message || "Live sync encountered an error";
    } else {
      const sp = splitIsoDateTime(syncObj.last_synced_at_muscat);
      txt.textContent = sp.time ? `AUTO-SYNC LIVE · ${sp.time}` : "AUTO-SYNC LIVE";
      pill.title = `${syncObj.message || "Auto-sync active"} — Click to open live GitHub Pages team calendar`;
    }
  }

  function syncBacklogBackdrop() {
    const grid = el("workspaceGrid");
    const backdrop = el("backlogBackdrop");
    if (!grid || !backdrop) return;
    const isOpen = !grid.classList.contains("backlog-collapsed");
    const isOverlayMode = window.innerWidth <= 1180;
    backdrop.classList.toggle("hidden", !(isOpen && isOverlayMode));
  }

  // --- Data Fetch ---
  async function loadDashboardData(preserveCalendarMonth = true, silent = false) {
    try {
      let data = null;
      if (!state.staticTeamMode) {
        try {
          const res = await fetch("/api/dashboard", { cache: "no-store" });
          if (res.ok) {
            data = await res.json();
          } else {
            state.staticTeamMode = true;
          }
        } catch (_e) {
          state.staticTeamMode = true;
        }
      }

      if (state.staticTeamMode && !data) {
        const res = await fetch(`./data/dashboard.json?t=${Date.now()}`, { cache: "no-store" });
        data = await res.json();
      }

      if (!data || !data.success) throw new Error(data?.message || "Failed to load calendar data");

      state.staticTeamMode = Boolean(data.static_team_mode) || state.staticTeamMode;
      state.syncedAtMuscat = data.synced_at_muscat || "";
      if (data.fingerprint) state.lastFingerprint = data.fingerprint;
      if (data.content_digest) state.contentDigest = data.content_digest;
      if (data.live_sync) updateLiveSyncIndicator(data.live_sync);
      state.items = data.items || [];
      state.stats = data.stats || {};
      state.months = data.months || [];
      state.campaigns = data.campaigns || [];

      const liveIso = computeLiveMuscatIso();
      state.serverTimeMuscat = state.staticTeamMode ? liveIso : (data.server_time_muscat || liveIso);
      state.todayDateStr = state.serverTimeMuscat.slice(0, 10);

      reconcileLiveStatesWithClock(state.items, state.serverTimeMuscat);
      applyTeamModeChrome();

      if (!preserveCalendarMonth && state.todayDateStr) {
        const [yy, mm] = state.todayDateStr.split("-").map((n) => parseInt(n, 10));
        state.calYear = yy;
        state.calMonth = mm - 1;
      }

      renderHeaderStats();
      populateFilterDropdowns();
      renderAll();
    } catch (err) {
      if (!silent) {
        showToast(`Load error: ${err.message}`, true);
      }
    }
  }

  function renderHeaderStats() {
    const s = state.stats;
    el("statUpcomingWeb").textContent = s.upcoming_website ?? 0;
    el("statUpcomingIg").textContent = s.upcoming_instagram ?? 0;
    el("statLiveTotal").textContent = `${s.live_website ?? 0}W · ${s.live_instagram ?? 0}IG`;
    el("statDrafts").textContent = s.pushed_drafts ?? 0;

    if (state.serverTimeMuscat) {
      const { date, time } = splitIsoDateTime(state.serverTimeMuscat);
      el("clockDisplay").textContent = `${formatHumanDate(date)} · ${time} GST`;
    }
  }

  function populateFilterDropdowns() {
    const campSel = el("campaignFilter");
    const prevCamp = state.campaignFilter;
    campSel.innerHTML = `<option value="all">All Plans / Series</option>` +
      state.campaigns.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    if (state.campaigns.includes(prevCamp)) {
      campSel.value = prevCamp;
    } else {
      state.campaignFilter = "all";
    }

    const dl = el("campaignSuggestions");
    if (dl) {
      dl.innerHTML = state.campaigns.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");
    }

    const mSel = el("backlogMonthFilter");
    const prevM = state.backlogMonth;
    mSel.innerHTML =
      state.months.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("") +
      `<option value="all">All Workspace Months</option>`;
    if (state.months.includes(prevM) || prevM === "all") {
      mSel.value = prevM;
    } else if (state.months.length) {
      state.backlogMonth = state.months[0];
      mSel.value = state.backlogMonth;
    }
  }

  function renderAll() {
    renderBacklog();
    if (state.view === "calendar") {
      renderCalendarGrid();
    } else {
      renderPipelineView();
    }
  }

  // --- Backlog Sidebar (Drafts & Ready) ---
  function getBacklogPools() {
    const drafts = [];
    const ready = [];

    for (const item of state.items) {
      if (item.has_calendar_slot) continue;
      if (item.website.state === "draft" || item.instagram.state === "draft") {
        drafts.push(item);
      } else if (!item.is_pushed_any && (item.has_html || item.slide_count > 0)) {
        ready.push(item);
      }
    }

    const sortBacklog = (a, b) => {
      const pinDiff = Number(b.plan?.pinned_to_pipeline || 0) - Number(a.plan?.pinned_to_pipeline || 0);
      if (pinDiff !== 0) return pinDiff;
      return (b.mtime_local || "").localeCompare(a.mtime_local || "");
    };

    drafts.sort(sortBacklog);
    ready.sort(sortBacklog);
    return { drafts, ready };
  }

  function renderBacklog() {
    const { drafts, ready } = getBacklogPools();
    el("countTabDrafts").textContent = drafts.length;
    el("countTabReady").textContent = ready.length;
    el("backlogBadgeCount").textContent = drafts.length + (state.staticTeamMode ? ready.length : 0);

    const activePool = state.backlogTab === "drafts" ? drafts : ready;
    const q = state.backlogSearch.trim().toLowerCase();

    const filtered = activePool.filter((it) => {
      if (state.backlogMonth !== "all" && it.month_folder !== state.backlogMonth) {
        return false;
      }
      if (!matchesTopFilters(it)) return false;
      if (q) {
        const hay = `${it.title} ${it.slug} ${it.edition_folder} ${it.category} ${it.plan?.campaign || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const container = el("backlogList");
    if (!filtered.length) {
      container.innerHTML = `<div class="empty-state">No matching stories in this view.<br/><small>Switch month filter to "All Workspace Months" to browse other editions.</small></div>`;
      return;
    }

    const draggableAttr = state.staticTeamMode ? "false" : "true";

    container.innerHTML = filtered
      .map((it) => {
        const thumb = it.cover_image || it.feed_poster;
        const wpBadge = it.website.state === "draft" ? `<span class="pill-mini pill-web">WP DRAFT</span>` : "";
        const igBadge = it.instagram.state === "draft" ? `<span class="pill-mini pill-ig">IG DRAFT</span>` : "";
        const pinBadge = it.plan?.pinned_to_pipeline ? `<span style="color:var(--gold-bright);font-weight:800;">★ Pinned</span>` : "";
        return `
          <div class="backlog-card" draggable="${draggableAttr}" data-story-id="${escapeHtml(it.id)}" style="--desk-accent:${escapeHtml(it.accent)}">
            ${thumb ? `<img class="backlog-thumb" src="${mediaUrl(thumb)}" alt="" loading="lazy" />` : `<div class="backlog-thumb"></div>`}
            <div class="backlog-info">
              <h4>${escapeHtml(it.title)}</h4>
              <div class="backlog-submeta">
                <span>${escapeHtml(it.category)}</span>
                <span>·</span>
                <span>${escapeHtml(it.edition_folder)}</span>
                ${pinBadge}
              </div>
              <div class="backlog-submeta">
                ${wpBadge}
                ${igBadge}
                ${!wpBadge && !igBadge ? `<span>${it.slide_count} slides</span>` : ""}
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    container.querySelectorAll(".backlog-card").forEach((card) => {
      const id = card.getAttribute("data-story-id");
      card.addEventListener("click", () => {
        if (window.innerWidth <= 1180) {
          el("workspaceGrid")?.classList.add("backlog-collapsed");
          syncBacklogBackdrop();
        }
        openInspector(id);
      });
      if (!state.staticTeamMode) {
        card.addEventListener("dragstart", (ev) => {
          ev.dataTransfer.setData("text/plain", id);
          ev.dataTransfer.effectAllowed = "move";
        });
      }
    });
  }

  // --- Calendar Grid View ---
  function buildDateEventMap() {
    const map = new Map();

    const pushEntry = (dateStr, entry) => {
      if (!map.has(dateStr)) map.set(dateStr, []);
      map.get(dateStr).push(entry);
    };

    for (const item of state.items) {
      if (!matchesTopFilters(item)) continue;

      const wpSplit = splitIsoDateTime(item.website.scheduled_local);
      const igSplit = splitIsoDateTime(item.instagram.scheduled_local);

      const allowWeb = state.channelFilter !== "instagram" && Boolean(wpSplit.date);
      const allowIg = state.channelFilter !== "website" && Boolean(igSplit.date);

      if (allowWeb && allowIg && wpSplit.date === igSplit.date) {
        const earliest = wpSplit.time && igSplit.time
          ? (wpSplit.time < igSplit.time ? wpSplit.time : igSplit.time)
          : (wpSplit.time || igSplit.time || "00:00");
        pushEntry(wpSplit.date, {
          item,
          showWeb: true,
          showIg: true,
          webTime: wpSplit.time,
          igTime: igSplit.time,
          sortTime: earliest,
        });
      } else {
        if (allowWeb) {
          pushEntry(wpSplit.date, {
            item,
            showWeb: true,
            showIg: false,
            webTime: wpSplit.time,
            igTime: "",
            sortTime: wpSplit.time || "00:00",
          });
        }
        if (allowIg) {
          pushEntry(igSplit.date, {
            item,
            showWeb: false,
            showIg: true,
            webTime: "",
            igTime: igSplit.time,
            sortTime: igSplit.time || "00:00",
          });
        }
      }
    }

    for (const list of map.values()) {
      list.sort((a, b) => a.sortTime.localeCompare(b.sortTime));
    }
    return map;
  }

  function renderCalendarGrid() {
    el("currentMonthLabel").textContent = `${MONTH_NAMES[state.calMonth]} ${state.calYear}`;
    const grid = el("calendarGrid");
    grid.classList.toggle("show-empty-days", state.showEmptyDaysMobile);
    const dateMap = buildDateEventMap();

    const firstOfMonth = new Date(Date.UTC(state.calYear, state.calMonth, 1));
    const startDow = firstOfMonth.getUTCDay();
    const daysInMonth = new Date(Date.UTC(state.calYear, state.calMonth + 1, 0)).getUTCDate();

    const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;
    const startUtc = Date.UTC(state.calYear, state.calMonth, 1 - startDow);

    const cellsHtml = [];
    let activeDaysInMonth = 0;

    for (let i = 0; i < totalCells; i++) {
      const cellDt = new Date(startUtc + i * 86400000);
      const cy = cellDt.getUTCFullYear();
      const cm = cellDt.getUTCMonth();
      const cd = cellDt.getUTCDate();
      const dowLabel = `${SHORT_DAYS[cellDt.getUTCDay()].toUpperCase()} · ${SHORT_MONTHS[cm].toUpperCase()}`;
      const dateStr = `${cy}-${String(cm + 1).padStart(2, "0")}-${String(cd).padStart(2, "0")}`;
      const isOtherMonth = cm !== state.calMonth;
      const isToday = dateStr === state.todayDateStr;
      const entries = dateMap.get(dateStr) || [];
      if (!isOtherMonth && entries.length > 0) {
        activeDaysInMonth++;
      }

      const eventsHtml = entries
        .map(({ item, showWeb, showIg, webTime, igTime }) => {
          const thumb = item.cover_image || item.feed_poster;
          const isPlannedOnly =
            (!showWeb || item.website.state === "planned") &&
            (!showIg || item.instagram.state === "planned");

          const webChip = showWeb
            ? `<span class="slot-chip slot-web ${item.website.state === "planned" ? "slot-planned" : ""} ${item.website.state === "published" ? "slot-published" : ""}">
                 <span class="state-dot state-${item.website.state}"></span>WEB ${escapeHtml(webTime)}
               </span>`
            : "";

          const storyTime = splitIsoDateTime(item.instagram.story_scheduled_local).time;
          const igChip = showIg
            ? `<span class="slot-chip slot-ig ${item.instagram.state === "planned" ? "slot-planned" : ""} ${item.instagram.state === "published" ? "slot-published" : ""}" title="${storyTime ? `9:16 Story at ${storyTime} GST` : "4:5 Feed Carousel"}">
                 <span class="state-dot state-${item.instagram.state}"></span>IG ${escapeHtml(igTime)}${storyTime && storyTime !== igTime ? ` +S` : ""}
               </span>`
            : "";

          return `
            <div class="cal-card ${isPlannedOnly ? "is-planned-only" : ""}" data-story-id="${escapeHtml(item.id)}" style="--desk-accent:${escapeHtml(item.accent)}">
              <div class="cal-card-head">
                ${thumb ? `<img class="cal-thumb" src="${mediaUrl(thumb)}" alt="" loading="lazy" />` : `<div class="cal-thumb"></div>`}
                <div class="cal-title">${escapeHtml(item.title)}</div>
              </div>
              <div class="cal-channels">
                ${webChip}
                ${igChip}
              </div>
              ${item.plan?.campaign ? `<div class="cal-campaign-tag">${escapeHtml(item.plan.campaign)}</div>` : ""}
            </div>
          `;
        })
        .join("");

      cellsHtml.push(`
        <div class="day-cell ${isOtherMonth ? "other-month" : ""} ${isToday ? "is-today" : ""} ${entries.length ? "has-events" : "empty-day"}" data-date="${dateStr}">
          <div class="day-cell-top">
            <span class="day-num">
              <span>${cd}</span>
              <span class="day-dow-mobile">${dowLabel}</span>
              ${isToday ? `<span class="today-tag">TODAY</span>` : ""}
            </span>
            <button type="button" class="btn-day-add" data-add-date="${dateStr}">+ Plan</button>
          </div>
          <div class="day-events">${eventsHtml}</div>
        </div>
      `);
    }

    const mobSummary = el("mobileCalSummary");
    if (mobSummary) {
      mobSummary.textContent = `${activeDaysInMonth} active publishing ${activeDaysInMonth === 1 ? "day" : "days"} in ${SHORT_MONTHS[state.calMonth]}`;
    }
    const mobBtn = el("btnToggleEmptyDays");
    if (mobBtn) {
      mobBtn.textContent = state.showEmptyDaysMobile ? "Active Days Only" : "Show All Days";
    }

    if (activeDaysInMonth === 0 && !state.showEmptyDaysMobile) {
      const hasTodayInMonth = state.todayDateStr && state.todayDateStr.startsWith(`${state.calYear}-${String(state.calMonth + 1).padStart(2, "0")}`);
      if (!hasTodayInMonth) {
        cellsHtml.push(`<div class="empty-state day-dow-mobile" style="padding:18px;text-align:center;">No scheduled posts in ${MONTH_NAMES[state.calMonth]} ${state.calYear} yet. Tap <strong>Show All Days</strong> above to view dates.</div>`);
      }
    }

    grid.innerHTML = cellsHtml.join("");

    grid.querySelectorAll(".cal-card").forEach((card) => {
      card.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openInspector(card.getAttribute("data-story-id"));
      });
    });

    if (!state.staticTeamMode) {
      grid.querySelectorAll(".btn-day-add").forEach((btn) => {
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openDayPicker(btn.getAttribute("data-add-date"));
        });
      });

      grid.querySelectorAll(".day-cell").forEach((cell) => {
        const targetDate = cell.getAttribute("data-date");
        cell.addEventListener("dragover", (ev) => {
          ev.preventDefault();
          cell.classList.add("drag-over");
        });
        cell.addEventListener("dragleave", () => {
          cell.classList.remove("drag-over");
        });
        cell.addEventListener("drop", (ev) => {
          ev.preventDefault();
          cell.classList.remove("drag-over");
          const storyId = ev.dataTransfer.getData("text/plain");
          if (storyId) {
            openInspector(storyId, targetDate);
          }
        });
      });
    }
  }

  // --- Plan Pipeline (Roadmap & Archive) View ---
  function renderPipelineRow(item, mode = "upcoming") {
    const cover = item.cover_image || item.feed_poster;
    const wpSplit = splitIsoDateTime(item.website.scheduled_local);
    const igSplit = splitIsoDateTime(item.instagram.scheduled_local);
    const stSplit = splitIsoDateTime(item.instagram.story_scheduled_local);
    const primaryDate = wpSplit.date || igSplit.date;

    const miniSlides = (item.slides || [])
      .slice(0, 5)
      .map((s) => `<img src="${mediaUrl(s)}" alt="" loading="lazy" />`)
      .join("");

    const actionLabel = state.staticTeamMode
      ? "Preview Package"
      : (mode === "pinned" ? "Assign Date" : "Inspect / Edit");

    return `
      <div class="pipe-row" data-story-id="${escapeHtml(item.id)}" style="--desk-accent:${escapeHtml(item.accent)}">
        <div class="pipe-date-col">
          <div class="pipe-day">${primaryDate ? formatHumanDate(primaryDate) : escapeHtml(item.edition_folder)}</div>
          <div class="pipe-rel">${primaryDate ? escapeHtml(relativeDayLabel(primaryDate)) : "Unassigned Slot"}</div>
        </div>
        ${cover ? `<img class="pipe-cover" src="${mediaUrl(cover)}" alt="" loading="lazy" />` : `<div class="pipe-cover"></div>`}
        <div class="pipe-main">
          <h4>${escapeHtml(item.title)}</h4>
          <div class="pipe-meta-line">
            <span style="color:${escapeHtml(item.accent)};font-weight:800;">${escapeHtml(item.category.toUpperCase())}</span>
            <span>·</span>
            <span>${escapeHtml(item.edition_folder)}</span>
            ${item.plan?.campaign ? `<span>·</span><span style="color:var(--gold-bright);font-weight:700;">${escapeHtml(item.plan.campaign)}</span>` : ""}
          </div>
          ${miniSlides ? `<div class="pipe-mini-slides">${miniSlides}</div>` : ""}
        </div>
        <div class="pipe-channel-box pipe-channel-web">
          <div class="pipe-channel-top">
            <span class="pill-mini pill-web">WEBSITE</span>
            <span class="status-badge st-${item.website.state}">${stateLabel(item.website.state)}</span>
          </div>
          <div class="pipe-time">${wpSplit.date ? `${wpSplit.date} · ${wpSplit.time} GST` : "No date assigned"}</div>
        </div>
        <div class="pipe-channel-box pipe-channel-ig">
          <div class="pipe-channel-top">
            <span class="pill-mini pill-ig">@OMANSPIRE.OM</span>
            <span class="status-badge st-${item.instagram.state}">${stateLabel(item.instagram.state)}</span>
          </div>
          <div class="pipe-time">
            ${igSplit.date ? `${igSplit.date} · ${igSplit.time} GST` : "No date assigned"}
            ${stSplit.time && stSplit.time !== igSplit.time ? `<br/><small>Story: ${stSplit.time} GST</small>` : ""}
          </div>
        </div>
        <div class="pipe-action-col">
          <button type="button" class="btn btn-xs">${actionLabel}</button>
        </div>
      </div>
    `;
  }

  function renderPipelineView() {
    const upcoming = [];
    const pinned = [];
    const published = [];

    for (const item of state.items) {
      if (!matchesTopFilters(item)) continue;

      const isUpcoming =
        item.website.state === "scheduled" ||
        item.website.state === "planned" ||
        item.instagram.state === "scheduled" ||
        item.instagram.state === "planned";

      const isPublished =
        !isUpcoming &&
        (item.website.state === "published" || item.instagram.state === "published");

      if (isUpcoming) {
        upcoming.push(item);
      } else if (isPublished) {
        published.push(item);
      } else if (item.plan?.pinned_to_pipeline) {
        pinned.push(item);
      }
    }

    upcoming.sort((a, b) => (a.primary_sort_ts || "").localeCompare(b.primary_sort_ts || ""));
    published.sort((a, b) => (b.primary_sort_ts || "").localeCompare(a.primary_sort_ts || ""));

    el("upcomingCountBadge").textContent = `${upcoming.length} stories`;
    el("pinnedCountBadge").textContent = `${pinned.length} stories`;
    el("publishedCountBadge").textContent = `${published.length} stories`;

    el("upcomingPipelineList").innerHTML = upcoming.length
      ? upcoming.map((it) => renderPipelineRow(it, "upcoming")).join("")
      : `<div class="empty-state">No upcoming scheduled or planned stories match the current filter.</div>`;

    el("pinnedPipelineList").innerHTML = pinned.length
      ? pinned.map((it) => renderPipelineRow(it, "pinned")).join("")
      : `<div class="empty-state">No unscheduled stories pinned to the pipeline.</div>`;

    el("publishedPipelineList").innerHTML = published.length
      ? published.map((it) => renderPipelineRow(it, "published")).join("")
      : `<div class="empty-state">No published workspace stories match the current filter.</div>`;

    document.querySelectorAll("#pipelineViewSection .pipe-row").forEach((row) => {
      row.addEventListener("click", () => openInspector(row.getAttribute("data-story-id")));
    });
  }

  // --- Day Quick Picker Modal ---
  function openDayPicker(dateStr) {
    if (state.staticTeamMode) return;
    state.pickerDateStr = dateStr;
    el("dayPickerTitle").textContent = `Assign Story to ${formatHumanDate(dateStr)}`;
    el("dayPickerSearch").value = "";
    renderDayPickerList("");
    el("dayPickerBackdrop").classList.remove("hidden");
    el("dayPickerSearch").focus();
  }

  function renderDayPickerList(query) {
    const { drafts, ready } = getBacklogPools();
    const candidates = [...drafts, ...ready];
    const q = query.trim().toLowerCase();
    const list = candidates.filter((it) => {
      if (!q) return true;
      return `${it.title} ${it.edition_folder} ${it.category} ${it.plan?.campaign || ""}`
        .toLowerCase()
        .includes(q);
    }).slice(0, 40);

    const wrap = el("dayPickerList");
    if (!list.length) {
      wrap.innerHTML = `<div class="empty-state">No unscheduled stories match "${escapeHtml(query)}".</div>`;
      return;
    }

    wrap.innerHTML = list
      .map((it) => {
        const thumb = it.cover_image || it.feed_poster;
        const badge = it.is_pushed_any
          ? `<span class="pill-mini pill-web">PUSHED DRAFT</span>`
          : `<span class="mono-badge">FOLDER READY</span>`;
        return `
          <div class="backlog-card" data-pick-id="${escapeHtml(it.id)}" style="--desk-accent:${escapeHtml(it.accent)};cursor:pointer;">
            ${thumb ? `<img class="backlog-thumb" src="${mediaUrl(thumb)}" alt="" loading="lazy" />` : `<div class="backlog-thumb"></div>`}
            <div class="backlog-info">
              <h4>${escapeHtml(it.title)}</h4>
              <div class="backlog-submeta">
                <span>${escapeHtml(it.category)}</span>
                <span>·</span>
                <span>${escapeHtml(it.edition_folder)}</span>
                ${badge}
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    wrap.querySelectorAll("[data-pick-id]").forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.getAttribute("data-pick-id");
        const targetDate = state.pickerDateStr;
        el("dayPickerBackdrop").classList.add("hidden");
        openInspector(id, targetDate);
      });
    });
  }

  // --- Editorial Inspector & Plan Editor ---
  async function openInspector(storyId, prefillDateStr = null) {
    try {
      let data = null;
      if (state.staticTeamMode) {
        const summaryItem = state.items.find((x) => x.id === storyId);
        if (!summaryItem || !summaryItem.story_hash) {
          throw new Error("Story bundle not found");
        }
        const res = await fetch(`./data/stories/${encodeURIComponent(summaryItem.story_hash)}.json`, { cache: "no-store" });
        data = await res.json();
        // Keep live clock-reconciled states from summaryItem
        if (data && data.story) {
          data.story.website.state = summaryItem.website.state;
          data.story.instagram.state = summaryItem.instagram.state;
        }
      } else {
        const res = await fetch(`/api/story?id=${encodeURIComponent(storyId)}`, { cache: "no-store" });
        data = await res.json();
      }

      if (!data || !data.success) throw new Error(data?.message || "Could not load story detail");

      state.activeStoryId = storyId;
      state.activeDetail = data;
      state.activeSlideIdx = 0;

      populateInspector(data.story, data.detail, prefillDateStr);
      el("inspectorBackdrop").classList.remove("hidden");
    } catch (err) {
      showToast(`Inspector error: ${err.message}`, true);
    }
  }

  function renderTeamReadOnlyInspector(story) {
    const panel = el("teamReadOnlyPanel");
    if (!panel) return;

    const wpSplit = splitIsoDateTime(story.website.scheduled_local);
    const igSplit = splitIsoDateTime(story.instagram.scheduled_local);
    const stSplit = splitIsoDateTime(story.instagram.story_scheduled_local);

    const wpTimeLabel = wpSplit.date
      ? `${formatHumanDate(wpSplit.date)} · ${wpSplit.time} GST`
      : "Unscheduled";
    const igTimeLabel = igSplit.date
      ? `${formatHumanDate(igSplit.date)} · ${igSplit.time} GST`
      : "Unscheduled";
    const storyTimeLabel = stSplit.date
      ? `${formatHumanDate(stSplit.date)} · ${stSplit.time} GST`
      : (story.has_story_poster ? "Included" : "—");

    panel.innerHTML = `
      <div class="plan-card">
        <div class="plan-card-head">
          <span class="section-eyebrow eyebrow-gold">EDITORIAL PLAN OVERVIEW</span>
          ${story.plan?.pinned_to_pipeline ? `<span class="mono-badge" style="color:var(--gold-bright);">★ Pinned Series</span>` : ""}
        </div>
        <div class="team-kv-row">
          <span class="team-kv-label">Series / Campaign</span>
          <span class="team-kv-val">${escapeHtml(story.plan?.campaign || "Daily Editorial")}</span>
        </div>
        <div class="team-kv-row">
          <span class="team-kv-label">Source Edition</span>
          <span class="team-kv-val">${escapeHtml(story.edition_folder)}</span>
        </div>
        <div class="team-kv-row">
          <span class="team-kv-label">Editorial Desk</span>
          <span class="team-kv-val" style="color:${escapeHtml(story.accent)};font-weight:700;">${escapeHtml(story.category)}</span>
        </div>
        ${story.plan?.notes ? `<div class="team-note-box">${escapeHtml(story.plan.notes)}</div>` : ""}
      </div>

      <div class="plan-card channel-card-web">
        <div class="channel-card-top">
          <div>
            <span class="pill-mini pill-web">WEBSITE</span>
            <h4>omanspire.om</h4>
          </div>
          <span class="status-badge st-${story.website.state}">${stateLabel(story.website.state)}</span>
        </div>
        <div class="team-kv-row">
          <span class="team-kv-label">Scheduled Slot</span>
          <span class="team-kv-val">${escapeHtml(wpTimeLabel)}</span>
        </div>
        ${story.website.post_id ? `
        <div class="team-kv-row">
          <span class="team-kv-label">WordPress Post ID</span>
          <span class="team-kv-val">#${escapeHtml(story.website.post_id)}</span>
        </div>` : ""}
        ${story.website.permalink ? `
        <div class="receipt-links" style="margin-top:4px;">
          <a href="${escapeHtml(story.website.permalink)}" target="_blank" rel="noopener">Open Post on omanspire.om &nearr;</a>
        </div>` : ""}
      </div>

      <div class="plan-card channel-card-ig">
        <div class="channel-card-top">
          <div>
            <span class="pill-mini pill-ig">INSTAGRAM</span>
            <h4>@omanspire.om</h4>
          </div>
          <span class="status-badge st-${story.instagram.state}">${stateLabel(story.instagram.state)}</span>
        </div>
        <div class="team-kv-row">
          <span class="team-kv-label">4:5 Carousel (${story.slide_count} slides)</span>
          <span class="team-kv-val">${escapeHtml(igTimeLabel)}</span>
        </div>
        <div class="team-kv-row">
          <span class="team-kv-label">9:16 Story Poster</span>
          <span class="team-kv-val">${escapeHtml(storyTimeLabel)}</span>
        </div>
      </div>
    `;
  }

  function populateInspector(story, detail, prefillDateStr = null) {
    if (el("inspActionFeedback")) {
      el("inspActionFeedback").textContent = "";
      el("inspActionFeedback").classList.remove("is-error");
    }

    const catPill = el("inspCategoryPill");
    catPill.textContent = story.category.toUpperCase();
    catPill.style.borderLeft = `3px solid ${story.accent}`;
    el("inspEditionPath").textContent = story.id;
    el("inspTitle").textContent = detail.extracted_title || story.title;

    // 1. Carousel Preview
    renderCarouselSlideView();
    el("inspCaptionInput").value = detail.instagram_caption || "";

    // 2. Story Poster & Cover Art
    const stWrap = el("storyPosterWrap");
    if (story.story_poster) {
      stWrap.innerHTML = `<img id="inspStoryImg" src="${mediaUrl(story.story_poster)}" alt="9:16 Story Poster" />`;
    } else {
      stWrap.innerHTML = `<div class="empty-state">No 9:16 instagram_story_poster.png in folder.</div>`;
    }

    const covWrap = el("coverArtWrap");
    if (story.cover_image) {
      covWrap.innerHTML = `<img id="inspCoverImg" src="${mediaUrl(story.cover_image)}" alt="1:1 Cover Artwork" />`;
    } else {
      covWrap.innerHTML = `<div class="empty-state">No 1:1 cover .jpg in folder.</div>`;
    }

    // 3. Website Article & SEO
    const seo = detail.seo_metadata || {};
    el("inspSeoBox").innerHTML = `
      <div><strong>SEO Title:</strong> ${escapeHtml(seo.seo_title || story.seo_title || "—")}</div>
      <div><strong>Slug:</strong> <span class="mono-inline">${escapeHtml(story.slug || "—")}</span></div>
      <div><strong>Meta Description:</strong> ${escapeHtml(seo.meta_description || story.meta_description || "—")}</div>
      <div><strong>Focus Keyword:</strong> ${escapeHtml(seo.focus_keyword || "—")}</div>
    `;
    el("inspArticleBody").innerHTML = detail.article_html
      ? (detail.excerpt ? `<p><em>${escapeHtml(detail.excerpt)}</em></p>` : "") + detail.article_html
      : `<div class="empty-state">No article_wordpress.html found in this story folder.</div>`;

    if (state.staticTeamMode) {
      renderTeamReadOnlyInspector(story);
      return;
    }

    // 4. Local Admin Plan Metadata & Schedule Inputs
    el("planPinCheckbox").checked = Boolean(story.plan?.pinned_to_pipeline);
    el("planCampaignInput").value = story.plan?.campaign || "";
    el("planNotesInput").value = story.plan?.notes || "";

    const webBadge = el("inspWebStatusBadge");
    webBadge.textContent = stateLabel(story.website.state);
    webBadge.className = `status-badge st-${story.website.state}`;

    const webLinks = [];
    if (story.website.post_id) {
      webLinks.push(`<span class="mono-dim">Post #${story.website.post_id}</span>`);
    }
    if (story.website.permalink) {
      webLinks.push(`<a href="${escapeHtml(story.website.permalink)}" target="_blank" rel="noopener">Open Website Post &nearr;</a>`);
    }
    if (story.website.edit_url) {
      webLinks.push(`<a href="${escapeHtml(story.website.edit_url)}" target="_blank" rel="noopener">WP Admin Edit &nearr;</a>`);
    }
    el("inspWebLinks").innerHTML = webLinks.join(" · ");

    const igBadge = el("inspIgStatusBadge");
    igBadge.textContent = stateLabel(story.instagram.state);
    igBadge.className = `status-badge st-${story.instagram.state}`;

    const igLinks = [];
    if (story.instagram.carousel_post_id) {
      igLinks.push(`<span class="mono-dim">Carousel ID: ${escapeHtml(story.instagram.carousel_post_id.slice(0, 10))}…</span>`);
    }
    if (story.instagram.story_post_id) {
      igLinks.push(`<span class="mono-dim">Story ID: ${escapeHtml(story.instagram.story_post_id.slice(0, 10))}…</span>`);
    }
    el("inspIgLinks").innerHTML = igLinks.join(" · ");

    const wpCurrent = splitIsoDateTime(story.website.scheduled_local);
    const igCurrent = splitIsoDateTime(story.instagram.scheduled_local);
    const stCurrent = splitIsoDateTime(story.instagram.story_scheduled_local);

    const fallbackDate = prefillDateStr || wpCurrent.date || igCurrent.date || state.todayDateStr;
    el("wpDateInput").value = prefillDateStr || wpCurrent.date || fallbackDate;
    el("wpTimeInput").value = wpCurrent.time || "16:30";

    el("igDateInput").value = prefillDateStr || igCurrent.date || fallbackDate;
    el("igTimeInput").value = igCurrent.time || "19:30";
    el("storyTimeInput").value = stCurrent.time || addMinutesToTimeStr(el("igTimeInput").value, 20);
    el("includeStoryCheckbox").checked = Boolean(story.has_story_poster);

    if (prefillDateStr) {
      setFeedback(`Pre-filled schedule date ${formatHumanDate(prefillDateStr)} — click Save Local Plan or Push!`, false);
    }
  }

  function renderCarouselSlideView() {
    if (!state.activeDetail) return;
    const slides = state.activeDetail.story.slides || [];
    const fallback = state.activeDetail.story.cover_image;
    const list = slides.length ? slides : (fallback ? [fallback] : []);

    const mainImg = el("carouselMainImg");
    const counter = el("carouselCounter");
    const strip = el("carouselFilmstrip");

    if (!list.length) {
      mainImg.removeAttribute("src");
      counter.textContent = "00 / 00";
      strip.innerHTML = "";
      return;
    }

    if (state.activeSlideIdx >= list.length) state.activeSlideIdx = 0;
    if (state.activeSlideIdx < 0) state.activeSlideIdx = list.length - 1;

    mainImg.src = mediaUrl(list[state.activeSlideIdx]);
    counter.textContent = `${String(state.activeSlideIdx + 1).padStart(2, "0")} / ${String(list.length).padStart(2, "0")}`;

    strip.innerHTML = list
      .map(
        (rel, idx) =>
          `<img class="film-thumb ${idx === state.activeSlideIdx ? "active" : ""}" data-slide-idx="${idx}" src="${mediaUrl(rel)}" alt="Slide ${idx + 1}" />`
      )
      .join("");

    strip.querySelectorAll(".film-thumb").forEach((th) => {
      th.addEventListener("click", () => {
        state.activeSlideIdx = parseInt(th.getAttribute("data-slide-idx"), 10);
        renderCarouselSlideView();
      });
    });
  }

  function setFeedback(msg, isError = false) {
    const box = el("inspActionFeedback");
    if (!box) return;
    box.textContent = msg;
    box.classList.toggle("is-error", isError);
  }

  function collectPlanPayload() {
    const wpDate = el("wpDateInput").value;
    const wpTime = el("wpTimeInput").value || "16:30";
    const igDate = el("igDateInput").value;
    const igTime = el("igTimeInput").value || "19:30";
    const stTime = el("storyTimeInput").value || addMinutesToTimeStr(igTime, 20);
    const incStory = el("includeStoryCheckbox").checked;

    return {
      id: state.activeStoryId,
      campaign: el("planCampaignInput").value.trim(),
      notes: el("planNotesInput").value.trim(),
      pinned_to_pipeline: el("planPinCheckbox").checked,
      wp_local: wpDate ? `${wpDate}T${wpTime}:00` : "",
      ig_local: igDate ? `${igDate}T${igTime}:00` : "",
      story_local: igDate && incStory ? `${igDate}T${stTime}:00` : "",
      include_story_poster: incStory,
      instagram_caption: el("inspCaptionInput").value,
    };
  }

  function setInspectorBusy(busy) {
    state.inspectorBusy = busy;
    [
      "btnSaveLocalPlan",
      "btnPushWpSchedule",
      "btnPushWpDraft",
      "btnPushWpNow",
      "btnPushIgSchedule",
      "btnPushIgDraft",
      "btnPushBothScheduled",
    ].forEach((id) => {
      const b = el(id);
      if (b) b.disabled = busy;
    });
  }

  async function saveLocalPlan(clearDates = false) {
    if (state.staticTeamMode || !state.activeStoryId) return;
    const p = collectPlanPayload();
    setInspectorBusy(true);
    setFeedback(clearDates ? "Clearing local plan dates…" : "Saving local plan to content_plan.json…");
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: p.id,
          campaign: p.campaign,
          notes: p.notes,
          pinned_to_pipeline: p.pinned_to_pipeline,
          planned_wp_local: clearDates ? "" : p.wp_local,
          planned_ig_local: clearDates ? "" : p.ig_local,
          planned_story_local: clearDates ? "" : p.story_local,
          instagram_caption: p.instagram_caption,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed saving local plan");
      setFeedback(clearDates ? "Cleared local plan dates." : "Saved to local plan (content_plan.json).");
      showToast(clearDates ? "Local plan dates cleared" : "Saved to local plan!");
      await loadDashboardData(true);
      await openInspector(state.activeStoryId);
    } catch (err) {
      setFeedback(err.message, true);
      showToast(err.message, true);
    } finally {
      setInspectorBusy(false);
    }
  }

  async function pushWordPressAction(mode) {
    if (state.staticTeamMode || !state.activeStoryId) return;
    const p = collectPlanPayload();
    setInspectorBusy(true);
    setFeedback(`Pushing Website (${mode}) to omanspire.om…`);
    try {
      await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: p.id,
          campaign: p.campaign,
          notes: p.notes,
          pinned_to_pipeline: p.pinned_to_pipeline,
        }),
      });

      const res = await fetch("/api/push/wordpress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: p.id,
          mode,
          wp_local: p.wp_local,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.result?.message || data.message || "WordPress push failed");
      setFeedback(`Website updated (${data.story.website.state})!`);
      showToast(`omanspire.om updated: ${stateLabel(data.story.website.state)}`);
      await loadDashboardData(true);
      await openInspector(state.activeStoryId);
    } catch (err) {
      setFeedback(err.message, true);
      showToast(err.message, true);
    } finally {
      setInspectorBusy(false);
    }
  }

  async function pushBufferAction(mode) {
    if (state.staticTeamMode || !state.activeStoryId) return;
    const p = collectPlanPayload();
    setInspectorBusy(true);
    setFeedback(`Pushing @omanspire.om (${mode}) via Buffer…`);
    try {
      await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: p.id,
          campaign: p.campaign,
          notes: p.notes,
          pinned_to_pipeline: p.pinned_to_pipeline,
        }),
      });

      const res = await fetch("/api/push/buffer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: p.id,
          mode,
          ig_local: p.ig_local,
          story_local: p.story_local,
          include_story_poster: p.include_story_poster,
          instagram_caption: p.instagram_caption,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.result?.message || data.message || "Buffer push failed");
      setFeedback(`@omanspire.om updated (${data.story.instagram.state})!`);
      showToast(`@omanspire.om updated: ${stateLabel(data.story.instagram.state)}`);
      await loadDashboardData(true);
      await openInspector(state.activeStoryId);
    } catch (err) {
      setFeedback(err.message, true);
      showToast(err.message, true);
    } finally {
      setInspectorBusy(false);
    }
  }

  async function pushBothChannelsScheduled() {
    if (state.staticTeamMode || !state.activeStoryId) return;
    const p = collectPlanPayload();
    if (!p.wp_local || !p.ig_local) {
      setFeedback("Please set both Website and @omanspire.om schedule dates/times.", true);
      return;
    }
    setInspectorBusy(true);
    setFeedback("Scheduling & pushing BOTH omanspire.om + @omanspire.om…");
    try {
      const res = await fetch("/api/push/both", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: p.id,
          mode: "schedule",
          wp_local: p.wp_local,
          ig_local: p.ig_local,
          story_local: p.story_local,
          include_story_poster: p.include_story_poster,
          instagram_caption: p.instagram_caption,
          campaign: p.campaign,
          notes: p.notes,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        const msg = data.wordpress?.message || data.buffer?.message || "Dual push encountered an error";
        throw new Error(msg);
      }
      setFeedback("Both Website & @omanspire.om scheduled successfully!");
      showToast("Scheduled on both omanspire.om & @omanspire.om!");
      await loadDashboardData(true);
      await openInspector(state.activeStoryId);
    } catch (err) {
      setFeedback(err.message, true);
      showToast(err.message, true);
    } finally {
      setInspectorBusy(false);
    }
  }

  // --- Event Listeners ---
  function bindEvents() {
    document.querySelectorAll("[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.view = btn.getAttribute("data-view");
        document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b === btn));
        el("calendarViewSection").classList.toggle("active", state.view === "calendar");
        el("pipelineViewSection").classList.toggle("active", state.view === "pipeline");
        el("calendarNavGroup").classList.toggle("nav-hidden", state.view !== "calendar");
        renderAll();
      });
    });

    el("btnToggleEmptyDays")?.addEventListener("click", () => {
      state.showEmptyDaysMobile = !state.showEmptyDaysMobile;
      renderCalendarGrid();
    });

    el("btnPrevMonth").addEventListener("click", () => {
      state.calMonth--;
      if (state.calMonth < 0) {
        state.calMonth = 11;
        state.calYear--;
      }
      renderCalendarGrid();
    });

    el("btnNextMonth").addEventListener("click", () => {
      state.calMonth++;
      if (state.calMonth > 11) {
        state.calMonth = 0;
        state.calYear++;
      }
      renderCalendarGrid();
    });

    el("btnToday").addEventListener("click", () => {
      if (state.todayDateStr) {
        const [yy, mm] = state.todayDateStr.split("-").map((n) => parseInt(n, 10));
        state.calYear = yy;
        state.calMonth = mm - 1;
        renderCalendarGrid();
      }
    });

    document.querySelectorAll("#channelFilterGroup .seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.channelFilter = btn.getAttribute("data-channel");
        document.querySelectorAll("#channelFilterGroup .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
        renderAll();
      });
    });

    el("categoryFilter").addEventListener("change", (ev) => {
      state.categoryFilter = ev.target.value;
      renderAll();
    });

    el("campaignFilter").addEventListener("change", (ev) => {
      state.campaignFilter = ev.target.value;
      renderAll();
    });

    const toggleBacklog = () => {
      el("workspaceGrid").classList.toggle("backlog-collapsed");
      syncBacklogBackdrop();
    };
    el("btnToggleBacklog").addEventListener("click", toggleBacklog);
    el("btnCloseBacklog").addEventListener("click", toggleBacklog);
    el("backlogBackdrop")?.addEventListener("click", () => {
      el("workspaceGrid").classList.add("backlog-collapsed");
      syncBacklogBackdrop();
    });
    window.addEventListener("resize", syncBacklogBackdrop);

    document.querySelectorAll(".backlog-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        state.backlogTab = tab.getAttribute("data-btab");
        document.querySelectorAll(".backlog-tab").forEach((t) => t.classList.toggle("active", t === tab));
        renderBacklog();
      });
    });

    el("backlogSearch").addEventListener("input", (ev) => {
      state.backlogSearch = ev.target.value;
      renderBacklog();
    });

    el("backlogMonthFilter").addEventListener("change", (ev) => {
      state.backlogMonth = ev.target.value;
      renderBacklog();
    });

    el("btnRefresh").addEventListener("click", () => {
      loadDashboardData(true);
      showToast("Calendar data refreshed");
    });

    el("btnSyncGithub")?.addEventListener("click", async () => {
      const btn = el("btnSyncGithub");
      btn.disabled = true;
      btn.textContent = "Syncing…";
      showToast("Building static bundle & syncing to GitHub Pages…");
      try {
        const res = await fetch("/api/sync-github", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || "GitHub sync failed");
        showToast(data.message || "Synced to GitHub Pages!");
      } catch (err) {
        showToast(err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = "Sync Team Page";
      }
    });

    el("btnVerifyConn")?.addEventListener("click", async () => {
      showToast("Checking omanspire.om & Buffer connections…");
      try {
        const res = await fetch("/api/check-connections");
        const data = await res.json();
        const wpOk = data.wordpress?.success;
        const bfOk = data.buffer?.success;
        showToast(
          `Website: ${wpOk ? "Connected ✓" : "Error"} · Buffer (@omanspire.om): ${bfOk ? "Connected ✓" : "Error"}`,
          !wpOk || !bfOk
        );
      } catch (err) {
        showToast(`API check error: ${err.message}`, true);
      }
    });

    el("btnCloseDayPicker").addEventListener("click", () => el("dayPickerBackdrop").classList.add("hidden"));
    el("dayPickerBackdrop").addEventListener("click", (ev) => {
      if (ev.target === el("dayPickerBackdrop")) el("dayPickerBackdrop").classList.add("hidden");
    });
    el("dayPickerSearch").addEventListener("input", (ev) => renderDayPickerList(ev.target.value));

    el("btnCloseInspector").addEventListener("click", () => el("inspectorBackdrop").classList.add("hidden"));
    el("inspectorBackdrop").addEventListener("click", (ev) => {
      if (ev.target === el("inspectorBackdrop")) el("inspectorBackdrop").classList.add("hidden");
    });

    document.querySelectorAll(".ptab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-ptab");
        document.querySelectorAll(".ptab").forEach((b) => b.classList.toggle("active", b === btn));
        el("paneCarousel").classList.toggle("active", target === "carousel");
        el("paneStory").classList.toggle("active", target === "story");
        el("paneArticle").classList.toggle("active", target === "article");
      });
    });

    el("btnSlidePrev").addEventListener("click", () => {
      state.activeSlideIdx--;
      renderCarouselSlideView();
    });
    el("btnSlideNext").addEventListener("click", () => {
      state.activeSlideIdx++;
      renderCarouselSlideView();
    });

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        el("inspectorBackdrop").classList.add("hidden");
        el("dayPickerBackdrop").classList.add("hidden");
        if (window.innerWidth <= 1180) {
          el("workspaceGrid")?.classList.add("backlog-collapsed");
          syncBacklogBackdrop();
        }
      } else if (!el("inspectorBackdrop").classList.contains("hidden")) {
        const tag = (document.activeElement?.tagName || "").toLowerCase();
        if (tag !== "input" && tag !== "textarea") {
          if (ev.key === "ArrowLeft") {
            state.activeSlideIdx--;
            renderCarouselSlideView();
          } else if (ev.key === "ArrowRight") {
            state.activeSlideIdx++;
            renderCarouselSlideView();
          }
        }
      }
    });

    el("btnCopyCaption").addEventListener("click", async () => {
      const txt = el("inspCaptionInput").value;
      if (!txt) return;
      await navigator.clipboard.writeText(txt);
      showToast("Instagram caption copied to clipboard");
    });

    document.querySelectorAll(".preset-chips").forEach((group) => {
      const targetId = group.getAttribute("data-target-time");
      group.querySelectorAll(".chip-btn").forEach((chip) => {
        chip.addEventListener("click", () => {
          const val = chip.getAttribute("data-time");
          el(targetId).value = val;
          if (targetId === "igTimeInput") {
            el("storyTimeInput").value = addMinutesToTimeStr(val, 20);
          }
        });
      });
    });

    el("igTimeInput")?.addEventListener("change", (ev) => {
      el("storyTimeInput").value = addMinutesToTimeStr(ev.target.value, 20);
    });

    el("wpDateInput")?.addEventListener("change", (ev) => {
      if (!el("igDateInput").value) {
        el("igDateInput").value = ev.target.value;
      }
    });

    el("btnSaveLocalPlan")?.addEventListener("click", () => saveLocalPlan(false));
    el("btnClearLocalPlan")?.addEventListener("click", () => saveLocalPlan(true));
    el("btnPushWpSchedule")?.addEventListener("click", () => pushWordPressAction("schedule"));
    el("btnPushWpDraft")?.addEventListener("click", () => pushWordPressAction("draft"));
    el("btnPushWpNow")?.addEventListener("click", () => pushWordPressAction("publish"));
    el("btnPushIgSchedule")?.addEventListener("click", () => pushBufferAction("schedule"));
    el("btnPushIgDraft")?.addEventListener("click", () => pushBufferAction("draft"));
    el("btnPushBothScheduled")?.addEventListener("click", () => pushBothChannelsScheduled());
  }

  function startAutoSyncPolling() {
    // Auto-collapse backlog drawer on compact viewports so calendar takes center stage
    if (window.innerWidth <= 1180) {
      el("workspaceGrid")?.classList.add("backlog-collapsed");
    }
    syncBacklogBackdrop();

    const checkUpdates = async () => {
      if (document.visibilityState !== "visible" || state.inspectorBusy) return;

      if (!state.staticTeamMode) {
        try {
          const res = await fetch("/api/version", { cache: "no-store" });
          if (!res.ok) return;
          const v = await res.json();
          if (v.live_sync) updateLiveSyncIndicator(v.live_sync);
          if (v.server_time_muscat) {
            state.serverTimeMuscat = v.server_time_muscat;
            state.todayDateStr = v.server_time_muscat.slice(0, 10);
            reconcileLiveStatesWithClock(state.items, state.serverTimeMuscat);
            renderHeaderStats();
          }
          if (v.fingerprint && state.lastFingerprint && v.fingerprint !== state.lastFingerprint) {
            state.lastFingerprint = v.fingerprint;
            await loadDashboardData(true, true);
            showToast("Calendar auto-updated with latest schedule");
          }
        } catch (_e) {
          // Quietly ignore transient network blips
        }
      } else {
        try {
          const liveIso = computeLiveMuscatIso();
          state.serverTimeMuscat = liveIso;
          state.todayDateStr = liveIso.slice(0, 10);
          reconcileLiveStatesWithClock(state.items, liveIso);
          renderHeaderStats();

          const res = await fetch(`./data/dashboard.json?t=${Date.now()}`, { cache: "no-store" });
          if (!res.ok) return;
          const d = await res.json();
          if (d && d.content_digest && state.contentDigest && d.content_digest !== state.contentDigest) {
            state.contentDigest = d.content_digest;
            await loadDashboardData(true, true);
            showToast("Live calendar updated");
          }
        } catch (_e) {
          // Quietly ignore transient network blips
        }
      }
    };

    // Poll every 4s locally, or every 30s on static GitHub Pages
    setInterval(checkUpdates, IS_LOCAL_HOST ? 4000 : 30000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        checkUpdates();
      }
    });
  }

  bindEvents();
  startAutoSyncPolling();
  loadDashboardData(false);
})();
