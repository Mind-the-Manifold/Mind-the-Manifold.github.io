// Renders the two paper tables from results/tables.json, and the maths in the prose.
(function () {
  const fid = document.getElementById("fidelity");
  const L = window.Labels;

  const num = (v, d = 3) => v.toFixed(d).replace(/^0\./, ".");

  function fidelityTable(t) {
    const groups = [];
    for (const c of t.columns) {
      const g = groups[groups.length - 1];
      if (g && g.model === c.model) g.n += 1; else groups.push({ model: c.model, n: 1 });
    }
    const head1 = `<tr><th></th>${groups.map(g =>
      `<th class="group" colspan="${g.n}"><span>${L.model(g.model)}</span></th>`).join("")}</tr>`;
    // `first-col`, not a :first-child rule: this header is in the second header row, and a
    // row-position selector cannot tell a real first column from the first cell of a row
    // that starts further right under a rowspan.
    const head2 = `<tr><th class="first-col">Metric</th>${t.columns.map(c => `<th>${L.config(c.config)}</th>`).join("")}</tr>`;
    const body = t.rows.map(r =>
      `<tr><td>${r.metric}</td>${r.cells.map(c =>
        `<td class="${c.best ? "best" : ""}">${num(c.mean)} ± ${num(c.sd)}</td>`).join("")}</tr>`).join("");
    return `<table class="paper-table"><thead>${head1}${head2}</thead><tbody>${body}</tbody></table>`;
  }

  // The paper's per-representation table, one table per metric so the three sit side by
  // side instead of stacking to three screens of rows. Each keeps the paper's two model
  // groups and four representation columns; a missing cell is a configuration that
  // representation is never trained in, not a gap in the data.
  function representationTable(t) {
    const cell = c => c
      ? `<td class="${c.best ? "best" : ""}">${num(c.mean)} ± ${num(c.sd)}</td>`
      : `<td class="none">—</td>`;
    return `<div class="repr-grid">` + t.blocks.map(b => {
      const head = `<tr><th class="txt first-col">Config.&nbsp;ID</th>${
        t.columns.map(r => `<th>${L.repr(r)}</th>`).join("")}</tr>`;
      const body = b.groups.map(g =>
        `<tr class="group-head"><td class="txt group" colspan="${t.columns.length + 1}">${g.label}</td></tr>` +
        g.rows.map(r => `<tr><th class="txt first-col">${L.config(r.config)}</th>${
          r.cells.map(cell).join("")}</tr>`).join("")).join("");
      return `<table class="paper-table repr-table">` +
        `<caption>${b.metric} ↓</caption><thead>${head}</thead><tbody>${body}</tbody></table>`;
    }).join("") + `</div>`;
  }

  // Hover and focus are handled in CSS; a tap has neither, so it toggles the class.
  const codeBtn = document.getElementById("code-button");
  if (codeBtn) {
    const links = codeBtn.closest(".publication-links");
    codeBtn.addEventListener("click", () => links.classList.toggle("note-open"));
    codeBtn.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); links.classList.toggle("note-open"); }
      if (e.key === "Escape") links.classList.remove("note-open");
    });
  }

  if (window.renderMathInElement) {
    renderMathInElement(document.body, {
      delimiters: [{ left: "\\(", right: "\\)", display: false }],
      throwOnError: false,
    });
  }

  // Table 1 and the key beside it are linked both ways: hovering, focusing or tapping a
  // symbol in either lights every cell and the row that share it. A row can stand for two
  // symbols (Pi_e and Pi_x, spatial and body, psi and psi_M), so `data-g` is a list.
  const methodTables = document.querySelector(".method-tables");
  if (methodTables) {
    const marks = [...methodTables.querySelectorAll("[data-g]")];
    const keys = el => el.dataset.g.split(" ");
    for (const el of marks) if (el.classList.contains("gloss")) el.tabIndex = 0;
    const mark = set => {
      for (const el of marks) el.classList.toggle("on", !!set && keys(el).some(k => set.has(k)));
    };
    const from = e => {
      const el = e.target.closest("[data-g]");
      if (el) mark(new Set(keys(el)));
    };
    methodTables.addEventListener("mouseover", from);
    methodTables.addEventListener("focusin", from);
    methodTables.addEventListener("click", from);
    methodTables.addEventListener("mouseleave", () => mark(null));
  }

  const reprEl = document.getElementById("representations");
  if (!fid && !reprEl) return;
  fetch("results/tables.json").then(r => r.json()).then(t => {
    if (reprEl && t.representations) reprEl.innerHTML = representationTable(t.representations);
    if (fid) {
      fid.innerHTML = fidelityTable(t.fidelity);
      document.getElementById("fidelity-caption").textContent =
        `Reconstruction error on the ${t.fidelity.n_tasks}-task FastUMI subset, averaged over the three representations shared by every variant, ± the standard deviation over task-by-representation cells. Lower is better; the best value in each row is bold. Leading zeros omitted.`;
    }
  }).catch(err => {
    const msg = `Tables could not be loaded (${err.message}).`;
    if (fid) fid.textContent = msg;
    if (reprEl) reprEl.textContent = msg;
  });
})();
