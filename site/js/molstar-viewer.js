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

  // Reapplies the receptor/chemokine chain colors to the base (cartoon)
  // components. Mol*'s own built-in click-to-select behavior on the 3D
  // canvas re-triggers its default representation coloring (back to the
  // element/chain-id palette), so this needs to be callable again later,
  // not just once at load.
  async function applyChainColors() {
    if (!chainColors || !chainColors.length) return;
    const { MS, StructureSelectionQuery, Color } = queryMods;
    const structureRef = viewer.plugin.managers.structure.hierarchy.current.structures[0];
    if (!structureRef) return;
    for (const { chain, rgb } of chainColors) {
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

  await applyChainColors();

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

  // Adds one ball-and-stick component per chain among the given residues
  // (full side chains, not just the cartoon backbone), replacing whatever
  // was there before. A fresh component defaults to Mol*'s own element/
  // chain palette, not the grey/blue theme applied to the cartoon;
  // component.applyTheme(selection, ...) — which works fine for recoloring
  // *existing* components like the cartoon — turned out not to reliably
  // retheme a component added moments earlier in the same call, so this
  // uses component.updateRepresentationsTheme(component, ...) instead,
  // which targets the component directly rather than re-matching a
  // selection, and only ever needs one color per component (hence one
  // component per chain rather than one for the whole click). Tracked by
  // each component's state-tree ref so they can be removed again without
  // touching the base cartoon/coloring component.
  let sideChainComponentRefs = [];

  // "element-symbol" with a custom carbonColor colors carbon atoms with the
  // chain's grey/blue theme while leaving H/N/O/S (and everything else) in
  // their standard CPK element colors — a plain "uniform" theme was painting
  // every atom (not just carbon) the chain color, hiding which atoms were
  // heteroatoms.
  function sideChainColorTheme(color) {
    return { color: "element-symbol", colorParams: { carbonColor: { name: "uniform", params: { value: color } } } };
  }

  // The ball-and-stick representation's sizeTheme only scales the atom
  // spheres — confirmed live that it leaves the stick (bond) radius
  // completely unchanged. The actual stick width comes from two of the
  // representation's own type params instead: sizeFactor (the shared base
  // radius both balls and sticks scale from) and linkScale (the stick's
  // radius as a fraction of that).
  async function thickenSticks(component) {
    for (const repr of component.representations) {
      await viewer.plugin
        .build()
        .to(repr.cell.transform.ref)
        .update((old) => ({
          ...old,
          type: { ...old.type, params: { ...old.type.params, sizeFactor: 0.35, linkScale: 1 } },
        }))
        .commit();
    }
  }

  async function showSideChains(residues) {
    await clearSideChains();
    if (!residues || !residues.length) return;
    const { StructureSelectionQuery, Color } = queryMods;
    const colorByChain = new Map((chainColors || []).map(({ chain, rgb }) => [chain, Color.fromRgb(rgb[0], rgb[1], rgb[2])]));

    for (const chain of new Set(residues.map((r) => r.chain))) {
      const structureRef = viewer.plugin.managers.structure.hierarchy.current.structures[0];
      if (!structureRef) continue;
      const chainResidues = residues.filter((r) => r.chain === chain);
      const label = `Side chains (${chain})`;
      const query = new StructureSelectionQuery(label, buildResidueExpr(chainResidues));
      await viewer.plugin.managers.structure.component.add(
        { selection: query, options: { checkExisting: false, label }, representation: "ball-and-stick" },
        [structureRef]
      );
      const updated = viewer.plugin.managers.structure.hierarchy.current.structures[0];
      const comp = updated.components.find((c) => c.cell.obj && c.cell.obj.label === label);
      if (!comp) continue;
      sideChainComponentRefs.push(comp.cell.transform.ref);
      const color = colorByChain.get(chain);
      if (color !== undefined) {
        await viewer.plugin.managers.structure.component.updateRepresentationsTheme([comp], sideChainColorTheme(color));
      }
      await thickenSticks(comp);
    }
  }

  async function clearSideChains() {
    if (!sideChainComponentRefs.length) return;
    const refs = sideChainComponentRefs;
    sideChainComponentRefs = [];
    for (const ref of refs) {
      await viewer.plugin.build().delete(ref).commit();
    }
  }

  // Reapplies the per-chain color to every currently-shown side-chain
  // component, by the same "Side chains (<chain>)" label used in
  // showSideChains above.
  async function applySideChainColors() {
    if (!sideChainComponentRefs.length) return;
    const { Color } = queryMods;
    const colorByChain = new Map((chainColors || []).map(({ chain, rgb }) => [chain, Color.fromRgb(rgb[0], rgb[1], rgb[2])]));
    const current = viewer.plugin.managers.structure.hierarchy.current.structures[0];
    if (!current) return;
    for (const comp of current.components) {
      const label = comp.cell.obj && comp.cell.obj.label;
      const match = label && label.match(/^Side chains \((.+)\)$/);
      if (!match) continue;
      const color = colorByChain.get(match[1]);
      if (color === undefined) continue;
      await viewer.plugin.managers.structure.component.updateRepresentationsTheme([comp], sideChainColorTheme(color));
      await thickenSticks(comp);
    }
  }

  // Zooms the camera in on exactly the clicked residues. Deliberately does
  // NOT use plugin.managers.structure.focus.setFromLoci() — that's Mol*'s
  // own "click on the model" behavior, but it auto-adds a "Surroundings
  // (5 Å)" component pulling in every residue within 5 Å (not just the ones
  // actually in contact) and themed with Mol*'s own default chain-id
  // rainbow coloring, not ours. showSideChains above already shows exactly
  // the right residues in the right colors, so this only needs to move the
  // camera.
  function focusResidues(residues) {
    const loci = buildResidueLoci(residues);
    if (!loci || !loci.elements || !loci.elements.length) return;
    viewer.plugin.managers.camera.focusLoci(loci);
  }

  // Clicking directly on the 3D model (Mol*'s own built-in picking
  // behavior, separate from the contact diagram's click handling) resets
  // Mol*'s default representation coloring, undoing the theme above — so
  // reassert it after every canvas click.
  viewer.plugin.behaviors.interaction.click.subscribe(() => {
    applyChainColors();
    applySideChainColors();
  });

  return { viewer, highlightResidues, clearHighlight, showSideChains, clearSideChains, focusResidues };
}
