// app.mjs — tech-tree graph island: d3 wiring + interactions around the pure
// layouts. Mounted by TechTreeGraph.astro with the build-time resolved graph.
import { forceCenter, forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation } from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import { STATUS_ORDER, STATUS_RADIUS, TRAY, collapseSkills, treeLayout } from "./layouts.mjs";

const R = { capability: 16, "skill-cluster": 11, module: 10, integration: 9, standard: 9, skill: 7, idea: 7 };
const VIEWS = ["hybrid", "constellation", "techtree", "tree"];
const BLOCK_ORDER = [...STATUS_ORDER, ...TRAY]; // status blocks, roadmap order
const byParentLabel = (a, b) =>
  (a.parent ?? "").localeCompare(b.parent ?? "") || a.label.localeCompare(b.label);

export function mountTechTree(host, graph) {
  const svgEl = host.querySelector("svg");
  const blocksEl = host.querySelector("[data-blocks]");
  const panel = host.querySelector("[data-panel]");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const expanded = new Set();
  const hidden = { status: new Set(), type: new Set() }; // toggled OFF by chips
  const urlView = new URLSearchParams(location.search).get("view");
  let view = VIEWS.includes(urlView) ? urlView : "hybrid";
  let sim = null;
  let nodeSel = null;
  let edgeSel = null;
  let links = [];

  const svg = select(svgEl);
  const g = svg.append("g");
  const zoomBehavior = zoom().scaleExtent([0.3, 4]).on("zoom", (ev) => g.attr("transform", ev.transform));
  svg.call(zoomBehavior);

  function render() {
    const data = collapseSkills(graph, expanded);
    if (view === "techtree") {
      renderBlocks(data);
      return;
    }
    renderGraph(data);
  }

  function renderGraph(data) {
    blocksEl.hidden = true;
    svgEl.style.display = "";
    const { width, height } = svgEl.getBoundingClientRect();
    const nodes = data.nodes.map((n) => ({ ...n }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    links = data.edges
      .filter((e) => byId.has(e.from) && byId.has(e.to))
      .map((e) => ({ kind: e.kind, source: byId.get(e.from), target: byId.get(e.to) }));
    sim?.stop();
    g.selectAll("*").remove();

    edgeSel = g
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("class", (d) => `edge edge-${d.kind}`);
    nodeSel = g
      .append("g")
      .selectAll("g")
      .data(nodes, (d) => d.id)
      .join("g")
      .attr("class", (d) => `node status-${d.status} type-${d.type}${d.id === graph.meta.root ? " root" : ""}`)
      .attr("tabindex", 0)
      .on("click", (_, d) => onSelect(d))
      .on("keydown", (ev, d) => ev.key === "Enter" && onSelect(d))
      .on("mouseenter", (_, d) => setFocus(d))
      .on("mouseleave", () => setFocus(null));
    nodeSel.append("circle").attr("class", "halo").attr("r", (d) => (R[d.type] ?? 8) + 7);
    nodeSel.append("circle").attr("class", "dot").attr("r", (d) => R[d.type] ?? 8);
    nodeSel
      .append("text")
      .attr("class", "label")
      .attr("dy", (d) => (R[d.type] ?? 8) + 13)
      .attr("text-anchor", "middle")
      .text((d) => d.label);

    const place = () => {
      edgeSel
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);
      nodeSel.attr("transform", (d) => `translate(${d.x},${d.y})`);
    };

    if (view === "tree") {
      const pos = treeLayout(data, width, height, graph.meta.root);
      for (const n of nodes) Object.assign(n, pos.get(n.id) ?? { x: width / 2, y: height / 2 });
      place();
      sim = null;
    } else {
      const radius = Math.min(width, height) * 0.45;
      sim = forceSimulation(nodes)
        .force("link", forceLink(links).distance(70).strength(0.4))
        .force("charge", forceManyBody().strength(-170))
        .force("center", forceCenter(width / 2, height / 2))
        .force("collide", forceCollide().radius((d) => (R[d.type] ?? 8) + 15));
      if (view === "hybrid") {
        sim.force(
          "radial",
          forceRadial(
            (d) => (d.id === graph.meta.root ? 0 : radius * (STATUS_RADIUS[d.status] ?? 0.6)),
            width / 2,
            height / 2,
          ).strength(0.9),
        );
      }
      if (reduced) {
        sim.stop();
        sim.tick(300);
        place();
      } else {
        sim.on("tick", place);
      }
    }
    applyGraphFilters();
  }

  // Modular blocks view: a responsive HTML card grid, grouped by status.
  function renderBlocks(data) {
    sim?.stop();
    sim = null;
    svgEl.style.display = "none";
    blocksEl.hidden = false;
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    links = data.edges
      .filter((e) => byId.has(e.from) && byId.has(e.to))
      .map((e) => ({ kind: e.kind, source: byId.get(e.from), target: byId.get(e.to) }));
    const groups = BLOCK_ORDER.map((status) => ({
      status,
      nodes: data.nodes.filter((n) => n.status === status).sort(byParentLabel),
    })).filter((grp) => grp.nodes.length);

    // Trusted build-time data from data/tech-tree.yaml — no user-supplied content flows here.
    blocksEl.innerHTML = groups
      .map(
        (grp) => `
      <section class="tt-block status-${grp.status}">
        <header class="tt-block-head"><span class="pip" aria-hidden="true"></span>${grp.status}<span class="tt-block-count">${grp.nodes.length}</span></header>
        <div class="tt-grid">
          ${grp.nodes
            .map((n) => {
              const type = n.type === "skill-cluster" ? "skills" : n.type;
              return `<button class="tt-card status-${n.status} type-${n.type}" data-id="${n.id}" data-status="${n.status}" data-type="${n.type === "skill-cluster" ? "skill" : n.type}">
              <span class="tt-card-type">${type}</span>
              <span class="tt-card-label">${n.label}</span>
            </button>`;
            })
            .join("")}
        </div>
      </section>`,
      )
      .join("");

    for (const card of blocksEl.querySelectorAll("[data-id]")) {
      card.addEventListener("click", () => onSelect(byId.get(card.dataset.id)));
    }
    applyBlockFilters();
  }

  function applyBlockFilters() {
    for (const card of blocksEl.querySelectorAll(".tt-card")) {
      card.hidden = hidden.status.has(card.dataset.status) || hidden.type.has(card.dataset.type);
    }
    for (const sec of blocksEl.querySelectorAll(".tt-block")) {
      sec.hidden = ![...sec.querySelectorAll(".tt-card")].some((c) => !c.hidden);
    }
  }

  function onSelect(d) {
    if (d.type === "skill-cluster") {
      expanded.add(d.parent);
      render();
      return;
    }
    const nbrs = neighbors(d);
    const rows = [
      `<p class="tt-status"><span class="pip status-${d.status}"></span>${d.status} <span class="src">via ${d.statusSource}</span></p>`,
      d.summary ? `<p>${d.summary}</p>` : "",
      d.links?.length ? `<p>${(d.links ?? []).map((l) => `<a href="${l.href}">${l.label}</a>`).join(" · ")}</p>` : "",
      d.driving?.length ? `<p class="src">driving: ${(d.driving ?? []).join(", ")}</p>` : "",
      nbrs.length ? `<p class="src">connected: ${nbrs.join(", ")}</p>` : "",
    ];
    // Trusted build-time data from data/tech-tree.yaml — do NOT route user-supplied content through this innerHTML.
    panel.innerHTML = `<button data-close>×</button><p class="tt-type">${d.type}</p><h2>${d.label}</h2>${rows.join("")}`;
    panel.hidden = false;
    panel.querySelector("[data-close]").addEventListener("click", () => (panel.hidden = true));
  }

  function neighbors(d) {
    const out = [];
    for (const l of links) {
      if (l.source.id === d.id) out.push(`${l.kind} → ${l.target.label}`);
      else if (l.target.id === d.id) out.push(`${l.source.label} → ${l.kind}`);
    }
    return out;
  }

  function setFocus(d) {
    if (!d) {
      nodeSel.classed("dim", false);
      edgeSel.classed("dim", false);
      return;
    }
    const near = new Set([d.id]);
    for (const l of links) {
      if (l.source.id === d.id) near.add(l.target.id);
      if (l.target.id === d.id) near.add(l.source.id);
    }
    nodeSel.classed("dim", (n) => !near.has(n.id));
    edgeSel.classed("dim", (l) => l.source.id !== d.id && l.target.id !== d.id);
  }

  function applyGraphFilters() {
    const nodeHidden = (n) =>
      hidden.status.has(n.status) || hidden.type.has(n.type === "skill-cluster" ? "skill" : n.type);
    nodeSel.classed("hide", nodeHidden);
    edgeSel.classed("hide", (l) => nodeHidden(l.source) || nodeHidden(l.target));
  }

  // Chip toggles route to whichever view is live.
  function applyFilters() {
    if (view === "techtree") applyBlockFilters();
    else applyGraphFilters();
  }

  // Toolbar wiring
  for (const btn of host.querySelectorAll("[data-view]")) {
    btn.addEventListener("click", () => {
      view = btn.dataset.view;
      for (const b of host.querySelectorAll("[data-view]")) b.classList.toggle("active", b === btn);
      history.replaceState(null, "", `?view=${view}`);
      svg.call(zoomBehavior.transform, zoomIdentity);
      render();
    });
    btn.classList.toggle("active", btn.dataset.view === view);
  }
  for (const chip of host.querySelectorAll("[data-filter-status],[data-filter-type]")) {
    chip.addEventListener("click", () => {
      const [set, val] = chip.dataset.filterStatus
        ? [hidden.status, chip.dataset.filterStatus]
        : [hidden.type, chip.dataset.filterType];
      set.has(val) ? set.delete(val) : set.add(val);
      chip.classList.toggle("off", set.has(val));
      applyFilters();
    });
  }

  let resizeTimer;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => render(), 150);
  });
  render();
}
