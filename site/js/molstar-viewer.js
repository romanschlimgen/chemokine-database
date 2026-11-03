// Wraps the Mol* prebuilt Viewer (loaded globally as `molstar` via the UMD
// build in pair.html) and adds residue-level hover highlighting, driven by
// the contact diagram.
//
// Mol*'s embeddable Viewer only exposes high-level load/dispose methods, not
// a "highlight this residue" API. To build the residue selection needed for
// highlighting, this pulls in a few of Mol*'s own query-building modules as
// plain ES modules from esm.sh (no bundler available on this project). They
// are pinned to the exact same version as the UMD build; Mol*'s structure/
// query types are plain structural objects (not classes requiring
// `instanceof`), which is what makes it safe to build a query with this
// separately-loaded copy of the library and run it against a structure that
// the UMD-loaded Viewer created.
const MOLSTAR_VERSION = "4.1.0";

// Rolls the camera around its own view axis (the line from target to
// position) — i.e. rotates the rendered image in the screen plane without
// changing what's centered or how zoomed in it is. Positive angles were
// verified empirically (by projecting a fixed world point before/after) to
// roll clockwise as seen on screen, so a counterclockwise roll needs a
// negative angle.
function rollCamera(camera, angleRad) {
  const snapshot = camera.getSnapshot();
  const position = Array.from(snapshot.position);
  const target = Array.from(snapshot.target);
  const up = Array.from(snapshot.up);

  const axis = normalize([position[0] - target[0], position[1] - target[1], position[2] - target[2]]);
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const d = dot(up, axis);
  const c = cross(axis, up);
  const newUp = [
    up[0] * cos + c[0] * sin + axis[0] * d * (1 - cos),
    up[1] * cos + c[1] * sin + axis[1] * d * (1 - cos),
    up[2] * cos + c[2] * sin + axis[2] * d * (1 - cos),
  ];
  camera.setState({ up: newUp }, 0);

  function normalize(v) {
    const len = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / len, v[1] / len, v[2] / len];
  }
  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
}

let queryModulesPromise = null;
function loadQueryModules() {
  if (!queryModulesPromise) {
    queryModulesPromise = Promise.all([
      import(`https://esm.sh/molstar@${MOLSTAR_VERSION}/lib/mol-script/language/builder`),
      import(`https://esm.sh/molstar@${MOLSTAR_VERSION}/lib/mol-script/runtime/query/compiler`),
      import(`https://esm.sh/molstar@${MOLSTAR_VERSION}/lib/mol-model/structure/query/context`),
      import(`https://esm.sh/molstar@${MOLSTAR_VERSION}/lib/mol-model/structure`),
      import(`https://esm.sh/molstar@${MOLSTAR_VERSION}/lib/mol-model/loci`),
      import(`https://esm.sh/molstar@${MOLSTAR_VERSION}/lib/mol-plugin-state/helpers/structure-selection-query`),
      import(`https://esm.sh/molstar@${MOLSTAR_VERSION}/lib/mol-util/color`),
    ]).then(([builderMod, compilerMod, contextMod, structureMod, lociMod, selectionQueryMod, colorMod]) => ({
      MS: builderMod.MolScriptBuilder,
      compile: compilerMod.compile,
      QueryContext: contextMod.QueryContext,
      StructureSelection: structureMod.StructureSelection,
      EmptyLoci: lociMod.EmptyLoci,
      StructureSelectionQuery: selectionQueryMod.StructureSelectionQuery,
      Color: colorMod.Color,
    }));
  }
  return queryModulesPromise;
}

// chainColors: [{chain: 'A', rgb: [147, 149, 152]}, ...] — applied after load
// to match the receptor/chemokine logo colors instead of Mol*'s default
// per-chain palette.
export async function createStructureViewer(containerId, pdbUrl, chainColors) {
  const viewer = await molstar.Viewer.create(containerId, {
    layoutIsExpanded: false,
    layoutShowControls: false,
    layoutShowSequence: false,
    layoutShowLog: false,
    layoutShowLeftPanel: false,
    viewportShowExpand: true,
    viewportShowSelectionMode: false,
  });
  await viewer.loadStructureFromUrl(pdbUrl, "pdb", false);

  // White background (Mol*'s default is a very light grey).
  viewer.plugin.canvas3d?.setProps({ renderer: { backgroundColor: 0xffffff } });

  const canvas3d = viewer.plugin.canvas3d;
  // requestCameraReset()/orientAxes() only set a "pending" flag (and, for
  // orientAxes, rotate whatever snapshot the camera currently has) — the
  // actual fit-to-structure math runs inside canvas3d's commit(), and only
  // once per real scene commit. Called straight after loadStructureFromUrl,
  // that commit has already happened, so each request needs canvas3d's own
  // commit(true) right after it to force and synchronously resolve one;
  // otherwise it sits unconsumed and the camera stays on its placeholder
  // state (target at the origin, near-zero radius).
  canvas3d.requestCameraReset({ durationMs: 0 });
  canvas3d.commit(true);
  // PCA-based axis alignment, reliably turning an elongated structure like a
  // membrane receptor so its long axis (here, the TM helix bundle) runs
  // across the screen instead of the camera looking down it.
  viewer.plugin.managers.camera.orientAxes(undefined, 0);
  canvas3d.commit(true);
  rollCamera(canvas3d.camera, -Math.PI / 2); // 90° counterclockwise

  const queryMods = await loadQueryModules();

  if (chainColors && chainColors.length) {
    const { MS, StructureSelectionQuery, Color } = queryMods;
    for (const { chain, rgb } of chainColors) {
      const structureRef = viewer.plugin.managers.structure.hierarchy.current.structures[0];
      if (!structureRef) continue;
      const expr = MS.struct.generator.atomGroups({
        "chain-test": MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), chain]),
      });
      const query = new StructureSelectionQuery(`Chain ${chain}`, expr);
      const color = Color.fromRgb(rgb[0], rgb[1], rgb[2]);
      await viewer.plugin.managers.structure.component.applyTheme(
        { selection: query, action: { name: "color", params: { color } } },
        [structureRef]
      );
    }
  }

  function getStructure() {
    const current = viewer.plugin.managers.structure.hierarchy.current;
    if (!current.structures.length) return null;
    const cell = current.structures[0].cell;
    return (cell.obj && cell.obj.data) || null;
  }

  // residues: [{chain, resnum}, ...] — builds one combined MolScript
  // expression (OR'd across residues) shared by the hover-loci and
  // side-chain-component paths below.
  function buildResidueExpr(residues) {
    const { MS } = queryMods;
    const tests = residues.map(({ chain, resnum }) =>
      MS.core.logic.and([
        MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), chain]),
        MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_seq_id(), resnum]),
      ])
    );
    const test = tests.length === 1 ? tests[0] : MS.core.logic.or(tests);
    return MS.struct.generator.atomGroups({ "residue-test": test });
  }

  function buildResidueLoci(residues) {
    const structure = getStructure();
    if (!structure || !residues.length) return null;
    const { compile, QueryContext, StructureSelection } = queryMods;
    const query = compile(buildResidueExpr(residues));
    const result = query(new QueryContext(structure));
    return StructureSelection.toLociWithSourceUnits(result);
  }

  function highlightResidues(residues) {
    const highlights = viewer.plugin.managers.interactivity.lociHighlights;
    const loci = buildResidueLoci(residues);
    if (loci && loci.elements && loci.elements.length) {
      highlights.highlightOnly({ loci });
    } else {
      highlights.highlightOnly({ loci: queryMods.EmptyLoci });
    }
  }

  function clearHighlight() {
    viewer.plugin.managers.interactivity.lociHighlights.highlightOnly({ loci: queryMods.EmptyLoci });
  }

  // Adds a separate ball-and-stick component for the given residues (full
  // side chains, not just the cartoon backbone), replacing whatever was
  // there before. Tracked by its state-tree ref so it can be removed again
  // without touching the base cartoon/coloring component.
  let sideChainComponentRef = null;

  async function showSideChains(residues) {
    await clearSideChains();
    if (!residues || !residues.length) return;
    const structureRef = viewer.plugin.managers.structure.hierarchy.current.structures[0];
    if (!structureRef) return;
    const { StructureSelectionQuery } = queryMods;
    const query = new StructureSelectionQuery("Side chains", buildResidueExpr(residues));
    await viewer.plugin.managers.structure.component.add(
      { selection: query, options: { checkExisting: false, label: "Side chains" }, representation: "ball-and-stick" },
      [structureRef]
    );
    const updated = viewer.plugin.managers.structure.hierarchy.current.structures[0];
    const comp = updated.components.find((c) => c.cell.obj && c.cell.obj.label === "Side chains");
    sideChainComponentRef = comp ? comp.cell.transform.ref : null;
  }

  async function clearSideChains() {
    if (!sideChainComponentRef) return;
    const ref = sideChainComponentRef;
    sideChainComponentRef = null;
    await viewer.plugin.build().delete(ref).commit();
  }

  return { viewer, highlightResidues, clearHighlight, showSideChains, clearSideChains };
}
