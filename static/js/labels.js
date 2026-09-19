// The paper's names for the things the site shows, in one place.
//
// Keys are stable ASCII (what the manifest and tables.json carry, what sorting and
// filtering work on). Each has a plain-words name and, where the paper writes maths, a
// TeX string. Words go in the filter dropdowns, because a <select> can only hold text;
// maths goes everywhere else, rendered by KaTeX so it matches the figures.
//
// Notation follows Table 1 of the paper: three model types, six configurations.
window.Labels = (function () {
  const MODEL = {
    mlp: { name: "MLP", tex: "\\mathrm{MLP}", plain: "MLP" },
    psi: { name: "Euclidean stable DS", tex: "\\boldsymbol{\\psi}", plain: "ψ" },
    psi_m: { name: "Non-Euclidean stable DS", tex: "\\boldsymbol{\\psi}_{\\mathcal{M}}", plain: "ψ_M" },
  };
  // Configuration IDs, in the order Table 1 lists them. `name` is the same notation written
  // in Unicode rather than in words, because that is the most a <select> can carry: the
  // dropdown then reads as the table and the paper do.
  const CONFIG = {
    mspatial: { name: "\u{1D52A}\u2227 spatial", tex: "\\mathfrak{m}_{\\mathrm{spatial}}^{\\wedge}" },
    mbody: { name: "\u{1D52A}\u2227 body", tex: "\\mathfrak{m}_{\\mathrm{body}}^{\\wedge}" },
    Te: { name: "\u{1D4AF}\u2091\u2133 \u03A0\u2091", tex: "\\mathcal{T}_{\\boldsymbol{e}}\\mathcal{M}^{\\Pi_{\\boldsymbol{e}}}" },
    Tx: { name: "\u{1D4AF}\u2093\u2133 \u03A0\u2093", tex: "\\mathcal{T}_{\\boldsymbol{x}}\\mathcal{M}^{\\Pi_{\\boldsymbol{x}}}" },
    vspatial: { name: "\u2228\u{1D52A}\u2227 spatial", tex: "{}^{\\vee}\\mathfrak{m}_{\\mathrm{spatial}}^{\\wedge}" },
    vbody: { name: "\u2228\u{1D52A}\u2227 body", tex: "{}^{\\vee}\\mathfrak{m}_{\\mathrm{body}}^{\\wedge}" },
  };
  // Same models, different training data: FastUMI trimmed vs the full trajectories.
  const DATASET = {
    trimmed: { name: "Trimmed" },
    untrimmed: { name: "Untrimmed" },
    unknown: { name: "Unknown" },
  };
  // Each name says what the whole pose is, not just its orientation part: the homogeneous
  // matrix and the dual quaternion already carry the position, the other two carry it
  // alongside as a separate translation vector.
  const REPR = {
    matrices: { name: "Homogeneous matrices", tex: "\\mathrm{SE}(3)" },
    quaternions: { name: "Position with unit quaternions", tex: "\\mathbb{R}^{3}\\times\\mathcal{S}^{3}" },
    dual_quaternions: { name: "Unit dual quaternions", tex: "\\mathcal{T}\\mathcal{S}^{3}" },
    euler_angles: { name: "Position with Euler angles", tex: "\\mathbb{R}^{6}" },
  };

  const ORDER = {
    model: ["psi_m", "psi", "mlp"],
    dataset: ["trimmed", "untrimmed", "unknown"],
    config: ["mspatial", "mbody", "Te", "Tx", "vspatial", "vbody"],
    repr: ["matrices", "quaternions", "dual_quaternions", "euler_angles"],
  };

  // katex.renderToString is not cheap and the browser re-renders its whole table on every
  // sort and filter, so each distinct snippet is rendered once and the HTML reused.
  const cache = new Map();
  function tex(s) {
    if (!cache.has(s)) {
      cache.set(s, window.katex
        ? katex.renderToString(s, { throwOnError: false })
        : s.replace(/\\[a-zA-Z]+|[{}]/g, ""));
    }
    return cache.get(s);
  }

  // Task labels come from directory names and arrive lower-case; the page shows them as
  // sentences. Sorting and filtering still work on the raw value.
  const task = v => (typeof v === "string" && v ? v[0].toUpperCase() + v.slice(1) : v);

  const label = (map, key) => {
    const e = map[key];
    if (!e) return key;
    return e.tex ? tex(e.tex) : e.name;
  };

  return {
    MODEL, CONFIG, DATASET, REPR, ORDER, tex, task,
    model: key => label(MODEL, key),
    config: key => label(CONFIG, key),
    repr: key => label(REPR, key),
    dataset: key => DATASET[key]?.name ?? key,
    modelName: key => MODEL[key]?.name ?? key,
    modelPlain: key => MODEL[key]?.plain ?? key,
    configName: key => CONFIG[key]?.name ?? key,
    reprName: key => REPR[key]?.name ?? key,
    datasetName: key => DATASET[key]?.name ?? key,
    rank(dim, v) {
      const order = ORDER[dim];
      if (!order) return null;
      const i = order.indexOf(v);
      return i < 0 ? order.length : i;
    },
  };
})();
