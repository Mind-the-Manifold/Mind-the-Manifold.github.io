// Results browser. One implementation, two hosts: the section on index.html and the
// full-page viewer.html. Reads results/manifest.json; the plot itself is the Plotly HTML
// that training produced, shown in an iframe.
//
// The list is windowed: only the rows on screen are in the DOM, with one spacer row above
// and one below standing in for the rest. Nearly 4,000 runs x three KaTeX cells is
// ~430,000 elements, which takes ~1.6 s to build -- and the whole table used to be rebuilt
// on every sort, filter and row click. The ~40 rows a viewport holds cost a few ms.
// The spacers are exact because every row is the same height; that height is measured from
// a real row rather than assumed, and measured again once the maths fonts have landed.
(function () {
  const root = document.getElementById("run-browser");
  if (!root) return;
  const fullscreen = document.body.classList.contains("vw-host");
  const L = window.Labels;

  // Dropdowns can only hold text, so they carry the plain-words name; everywhere else
  // shows the paper's notation.
  const DIMS = [
    { key: "model", label: "Model", name: v => L.modelName(v) },
    { key: "config", label: "Configuration", name: v => L.configName(v) },
    { key: "dataset", label: "Dataset", name: v => L.datasetName(v) },
    { key: "task_label", label: "Task", name: v => L.task(v) },
    { key: "repr", label: "Representation", name: v => L.reprName(v) },
    { key: "seed", label: "Seed" },
  ];
  // Widths are pinned (the table is laid out `fixed`) so that columns do not jump as rows
  // scroll in and out of the window. Each is just wide enough for its header and its widest
  // value, Task included: the table is then exactly as wide as its columns and is centred
  // in the list, rather than stretching one column to fill whatever room there is.
  const COLS = [
    { key: "model", label: "Model", html: v => L.model(v), w: "4.6em" },
    { key: "config", label: "Config.", html: v => L.config(v), w: "5.1em" },
    { key: "dataset", label: "Dataset", html: v => L.dataset(v), w: "6.2em" },
    { key: "task_label", label: "Task", html: v => L.task(v), w: "11em" },
    { key: "repr", label: "Repr.", html: v => L.repr(v), w: "4.5em" },
    { key: "seed", label: "Seed", num: true, w: "4.1em" },
    { key: "rmse", label: "RMSE", num: true, shade: true, w: "4.5em" },
    { key: "frechet", label: "FD", num: true, w: "3.6em" },
    { key: "dtw", label: "DTWD", num: true, w: "4.7em" },
  ];
  // Tie-breakers applied after the clicked column, so the list always reads model by model.
  const CHAIN = ["model", "config", "dataset", "repr", "task_label", "seed"];
  // Rows kept beyond each edge of the viewport, so a nudge of the wheel shows rows rather
  // than blank space before the next frame repaints.
  const OVER = 8;

  let RUNS = [];                        // every run, as the manifest lists them
  let rows = [];                        // RUNS under the current filters and sort
  let rowH = 0;                         // measured from a rendered row; 0 = not yet
  let shade = null;                     // rmse range over `rows`, for the heat column
  let win = { first: 0, last: 0 };      // the slice of `rows` currently in the DOM
  let shown = { dir: null, demo: -1 };  // what the detail pane was last built for
  let queued = false;                   // a repaint is already waiting on a frame
  const state = { filters: {}, sortKey: "model", sortDir: 1, sel: null, demo: 0 };

  root.innerHTML = `
    <div class="vw-bar">
      <div class="vw-filters">
        ${DIMS.map(d => `<label><span>${d.label}</span><select data-dim="${d.key}"></select></label>`).join("")}
      </div>
      <div class="vw-actions">
        <button type="button" class="vw-reset">Reset</button>
        <span class="vw-count"></span>
      </div>
    </div>
    <div class="vw-panes">
      <div class="vw-list"><table>
        <colgroup>${COLS.map(c => `<col style="width:${c.w}">`).join("")}</colgroup>
        <thead><tr></tr></thead><tbody></tbody></table></div>
      <div class="vw-split" role="separator" aria-orientation="vertical" tabindex="0"
           aria-label="Resize the list and the detail pane"></div>
      <div class="vw-detail"></div>
    </div>`;
  const $ = sel => root.querySelector(sel);
  const list = () => $(".vw-list");

  function compare(key, a, b) {
    if (a == null) return 1;
    if (b == null) return -1;
    const ra = L.rank(key, a), rb = L.rank(key, b);
    if (ra != null) return ra - rb;
    if (typeof a === "number") return a - b;
    return String(a).localeCompare(String(b));
  }
  function fmt(v) {
    if (v == null) return "–";
    return Math.abs(v) < 1e-3 && v !== 0 ? v.toExponential(1) : v.toFixed(3);
  }

  function initFilters() {
    for (const d of DIMS) {
      const sel = $(`select[data-dim="${d.key}"]`);
      const values = [...new Set(RUNS.map(r => r[d.key]))].sort((a, b) => compare(d.key, a, b));
      sel.innerHTML = '<option value="">All</option>' +
        values.map(v => `<option value="${v}">${d.name ? d.name(v) : v}</option>`).join("");
      sel.onchange = () => { state.filters[d.key] = sel.value; refresh(); };
    }
    $(".vw-reset").onclick = () => {
      state.filters = {};
      root.querySelectorAll("select").forEach(s => s.value = "");
      refresh();
    };
  }

  function setRows() {
    rows = RUNS.filter(r => DIMS.every(d => !state.filters[d.key] || String(r[d.key]) === state.filters[d.key]));
    const { sortKey: k, sortDir: dir } = state;
    rows.sort((a, b) => {
      let c = compare(k, a[k], b[k]) * dir;
      for (const key of CHAIN) {
        if (c) break;
        if (key !== k) c = compare(key, a[key], b[key]);
      }
      return c;
    });
    const vals = rows.map(r => r.rmse).filter(v => v != null);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    shade = vals.length && hi > lo ? { lo, hi } : null;
  }

  function renderHead() {
    const head = $("thead tr");
    head.innerHTML = COLS.map(c => {
      // The arrow is its own small glyph: at full size it costs every column 12px of
      // width it would rather give to Task.
      const arrow = state.sortKey === c.key
        ? `<span class="vw-arw">${state.sortDir === 1 ? "▲" : "▼"}</span>` : "";
      return `<th class="${c.num ? "num" : ""}" data-key="${c.key}">${c.label}${arrow}</th>`;
    }).join("");
    head.querySelectorAll("th[data-key]").forEach(th => th.onclick = () => {
      const key = th.dataset.key;
      if (state.sortKey === key) state.sortDir *= -1;
      else { state.sortKey = key; state.sortDir = 1; }
      refresh();
    });
  }

  // `i` is the row's index in `rows`, which is how a click finds its run again.
  function rowHtml(r, i) {
    const cells = COLS.map(c => {
      const v = r[c.key];
      let style = "";
      if (c.shade && v != null && shade) {
        const t = (v - shade.lo) / (shade.hi - shade.lo);
        style = ` style="background:rgba(217,119,6,${(t * 0.3).toFixed(3)})"`;
      }
      const text = c.num ? (c.key === "seed" ? v : fmt(v)) : (c.html ? c.html(v) : (v ?? "–"));
      return `<td class="${c.num ? "num" : ""}"${style}>${text}</td>`;
    }).join("");
    return `<tr class="${r === state.sel ? "sel" : ""}" data-i="${i}">${cells}</tr>`;
  }

  // Rebuild the visible slice. `force` after the rows themselves changed; without it a
  // scroll that stays inside the current window costs nothing.
  function paint(force) {
    const body = $("tbody"), el = list();
    if (!rows.length) {
      body.innerHTML = `<tr><td class="vw-empty" colspan="${COLS.length}">No runs match these filters.</td></tr>`;
      win = { first: 0, last: 0 };
      return;
    }
    // Read the scroll position before measuring: measuring means putting a single row in
    // the table, which leaves the list one row tall, and the browser clamps scrollTop to
    // what fits. It is restored once the spacers are back.
    const top = el.scrollTop;
    if (!rowH) {
      body.innerHTML = rowHtml(rows[0], 0);
      rowH = body.firstElementChild.offsetHeight || 30;
      force = true;
    }
    const first = Math.max(0, Math.floor(top / rowH) - OVER);
    const last = Math.min(rows.length, first + Math.ceil((el.clientHeight || 700) / rowH) + 2 * OVER);
    if (!force && first === win.first && last === win.last) return;
    win = { first, last };
    const pad = n => n > 0
      ? `<tr class="vw-pad" style="height:${n * rowH}px"><td colspan="${COLS.length}"></td></tr>` : "";
    body.innerHTML = pad(first) +
      rows.slice(first, last).map((r, i) => rowHtml(r, first + i)).join("") +
      pad(rows.length - last);
    if (el.scrollTop !== top) el.scrollTop = top;
  }

  // Moving the highlight is a class on one row, not a reason to rebuild the table.
  function markSelection() {
    const body = $("tbody");
    body.querySelector("tr.sel")?.classList.remove("sel");
    const i = rows.indexOf(state.sel);
    if (i >= win.first && i < win.last) body.querySelector(`tr[data-i="${i}"]`)?.classList.add("sel");
  }

  function select(r) {
    if (!r || r === state.sel) return;
    state.sel = r;
    state.demo = 0;
    markSelection();
    renderDetail();
  }

  // Scroll row `i` just inside the viewport. The header is sticky, so it covers the rows
  // beneath it and a row brought to scrollTop would sit under it.
  function reveal(i) {
    const el = list();
    const head = $("thead").offsetHeight || 0;
    const top = i * rowH;
    if (top - head < el.scrollTop) el.scrollTop = Math.max(0, top - head);
    else if (top + rowH > el.scrollTop + el.clientHeight) el.scrollTop = top + rowH - el.clientHeight;
    paint(false);
  }

  function renderDetail() {
    const el = $(".vw-detail");
    const r = state.sel;
    if (!r) {
      el.innerHTML = '<p class="vw-empty">Select a run to see its trajectories.</p>';
      shown = { dir: null, demo: -1 };
      return;
    }
    // Writing this markup re-creates the <iframe>, which reloads the plot and runs Plotly
    // again, so only do it when the run or the demo actually changed: sorting or filtering
    // must leave the plot already on screen alone.
    if (shown.dir === r.dir && shown.demo === state.demo) return;
    shown = { dir: r.dir, demo: state.demo };

    const chips = [["RMSE", r.rmse], ["FD", r.frechet], ["DTWD", r.dtw]]
      .map(([k, v]) => `<span class="vw-chip">${k}<b>${fmt(v)}</b></span>`).join("");
    // Numbered by position, not by the demonstration index: the runs the untrimmed MLP set
    // carries twice would otherwise repeat a number. They are sorted by error, so Demo 1 is
    // always the best rollout; the error itself is on hover.
    const demoBtns = r.demos.map((d, i) =>
      `<button type="button" class="vw-demo ${i === state.demo ? "active" : ""}" data-i="${i}" title="error ${d.err.toFixed(3)}">Demo ${i + 1}</button>`
    ).join("");
    const open = fullscreen ? "" :
      `<a class="vw-open" href="viewer.html?run=${encodeURIComponent(r.dir)}" target="_blank">Open full screen ↗</a>`;

    const demo = r.demos[state.demo];
    const viewer = demo ? `
      <div class="vw-toolbar"><div class="vw-demos">${demoBtns}</div>${open}</div>
      <iframe class="vw-plot" src="${encodeURI(demo.html)}" loading="lazy" title="Trajectory plot"></iframe>
      <div class="vw-imgs">
        ${demo.png ? `<figure><figcaption>Orientation error</figcaption><img src="${encodeURI(demo.png)}" loading="lazy" alt=""></figure>` : ""}
        ${/* null unless make_site.py ran with --loss-curves */ ""}
        ${r.loss_png ? `<figure><figcaption>Training loss</figcaption><img src="${encodeURI(r.loss_png)}" loading="lazy" alt=""></figure>` : ""}
      </div>`
      : '<p class="vw-empty">No trajectory plots for this run.</p>';

    el.innerHTML = `
      <div class="vw-crumb"><b>${L.model(r.model)}</b> <b>${L.config(r.config)}</b><span>${L.dataset(r.dataset)}</span><span>${L.task(r.task_label)}</span><span>${L.repr(r.repr)}</span><span>seed ${r.seed}</span></div>
      <div class="vw-chips">${chips}</div>
      ${viewer}`;
    el.querySelectorAll(".vw-demo").forEach(btn => btn.onclick = () => {
      state.demo = +btn.dataset.i;
      renderDetail();
    });
  }

  // The rows changed: re-filter, re-sort, and start again from the top of the list. The
  // selected run is kept as long as it survives the filter, so narrowing the list leaves
  // the plot being read alone.
  function refresh() {
    setRows();
    if (state.sel && !rows.includes(state.sel)) state.sel = null;
    renderHead();
    list().scrollTop = 0;
    paint(true);
    $(".vw-count").textContent = `${rows.length} / ${RUNS.length} runs`;
    renderDetail();
  }

  // The first row of the default sort, so the list opens at the top with its selection in
  // view. Anything else means arriving at a list already scrolled into the middle, which
  // reads as the page having lost its place.
  function initialSelection() {
    const want = new URLSearchParams(location.search).get("run");
    if (want) {
      const hit = RUNS.find(r => r.dir === want);
      if (hit) return hit;
    }
    return rows[0];
  }

  $("tbody").onclick = e => {
    const tr = e.target.closest("tr[data-i]");
    if (tr) select(rows[+tr.dataset.i]);
  };

  list().addEventListener("scroll", () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; paint(false); });
  });
  window.addEventListener("resize", () => paint(true));

  // The list needs the width of its table and not a pixel more; the rest belongs to the
  // plot. Measured rather than guessed, so it stays right if a column changes, and dropped
  // the moment the reader takes the divider themselves.
  let dragged = false;
  function fitList() {
    if (dragged) return;
    const el = list(), panes = $(".vw-panes"), tbl = el.querySelector("table");
    const total = panes.getBoundingClientRect().width;
    if (!tbl || !total) return;
    const want = Math.ceil(tbl.getBoundingClientRect().width) + (el.offsetWidth - el.clientWidth) + 1;
    if (want < total - 320) panes.style.setProperty("--list-w", `${want}px`);
  }

  // Drag the divider to trade list width for plot width. The width is written as a custom
  // property rather than as `grid-template-columns`, so that the stacked layout below
  // 1260px -- which sets the shorthand in a media query -- still wins over it.
  (function splitter() {
    const bar = $(".vw-split"), panes = $(".vw-panes");
    const MIN_LIST = 280, MIN_DETAIL = 320;
    const setWidth = px => {
      const total = panes.getBoundingClientRect().width;
      const w = Math.max(MIN_LIST, Math.min(px, total - MIN_DETAIL));
      panes.style.setProperty("--list-w", `${Math.round(w)}px`);
    };
    bar.addEventListener("pointerdown", e => {
      e.preventDefault();
      dragged = true;
      const left = panes.getBoundingClientRect().left;
      const move = ev => setWidth(ev.clientX - left);
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.body.classList.remove("vw-resizing");
      };
      document.body.classList.add("vw-resizing");
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });
    bar.addEventListener("keydown", e => {
      const step = e.key === "ArrowLeft" ? -24 : e.key === "ArrowRight" ? 24 : 0;
      if (!step) return;
      e.preventDefault();
      dragged = true;
      setWidth($(".vw-list").getBoundingClientRect().width + step);
    });
  })();

  window.addEventListener("keydown", e => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (/select|input|textarea/i.test(document.activeElement.tagName)) return;
    if (!rows.length) return;
    e.preventDefault();
    const i = rows.indexOf(state.sel);
    const next = e.key === "ArrowDown" ? Math.min(i + 1, rows.length - 1) : Math.max(i - 1, 0);
    reveal(next);
    select(rows[next]);
  });

  fetch("results/manifest.json")
    .then(r => { if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`); return r.json(); })
    .then(runs => {
      RUNS = runs;
      // The page says how many runs there are; only the manifest knows.
      const count = document.getElementById("run-count");
      if (count) count.textContent = RUNS.length.toLocaleString();
      initFilters();
      setRows();
      state.sel = initialSelection();
      refresh();
      const i = rows.indexOf(state.sel);
      if (i >= 0) reveal(i);
      fitList();
      // A row is 30px once KaTeX's fonts are in and shorter before, and every spacer is a
      // multiple of that height -- so the first measurement, and the scroll position it
      // implies, are both stale the moment the fonts land. Measure again and put the
      // selected run back in view, unless the reader has already scrolled elsewhere.
      const parked = list().scrollTop;
      if (document.fonts) document.fonts.ready.then(() => {
        const moved = list().scrollTop !== parked;
        rowH = 0;
        paint(true);
        if (!moved && i >= 0) reveal(i);
        fitList();
      });
    })
    .catch(err => {
      root.innerHTML = `<p class="vw-empty">The run index could not be loaded (${err.message}). Serve the site over http, not from a file:// URL.</p>`;
    });
})();
