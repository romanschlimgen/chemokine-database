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
      import(`https://esm.sh/molstar@${MOLSTAR_VERSION}/lib/mol-data/int`),
    ]).then(([builderMod, compilerMod, contextMod, structureMod, lociMod, selectionQueryMod, colorMod, intMod]) => ({
      MS: builderMod.MolScriptBuilder,
      compile: compilerMod.compile,
      QueryContext: contextMod.QueryContext,
      StructureSelection: structureMod.StructureSelection,
      StructureElement: structureMod.StructureElement,
      StructureProperties: structureMod.StructureProperties,
      EmptyLoci: lociMod.EmptyLoci,
      StructureSelectionQuery: selectionQueryMod.StructureSelectionQuery,
      Color: colorMod.Color,
      OrderedSet: intMod.OrderedSet,
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

  // The reverse of buildResidueLoci above — reads the {chain, resnum} pairs
  // back out of a loci (e.g. from a direct click on the model), so a native
  // canvas click can drive the same showSideChains/focusResidues path the
  // contact diagram's click already does. loci.elements' "indices" is a
  // packed OrderedSet, not a plain array, hence OrderedSet.forEach rather
  // than a normal loop.
  function residuesFromLoci(loci) {
    if (!loci || !loci.elements || !loci.elements.length) return [];
    const { StructureElement, StructureProperties, OrderedSet } = queryMods;
    const seen = new Set();
    const residues = [];
    for (const el of loci.elements) {
      const location = StructureElement.Location.create(loci.structure, el.unit, el.unit.elements[0]);
      OrderedSet.forEach(el.indices, (idx) => {
        location.element = el.unit.elements[idx];
        const chain = StructureProperties.chain.auth_asym_id(location);
        const resnum = StructureProperties.residue.auth_seq_id(location);
        const key = `${chain}:${resnum}`;
        if (!seen.has(key)) {
          seen.add(key);
          residues.push({ chain, resnum });
        }
      });
    }
    return residues;
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

  // One ball-and-stick component per chain among the given residues (full
  // side chains, not just the cartoon backbone), replacing whatever was
  // there before. One component per chain (rather than one for the whole
  // click) since styleSideChainComponent below only ever applies one color.
  // Tracked by each component's state-tree ref so they can be removed again
  // without touching the base cartoon/coloring component.
  let sideChainComponentRefs = [];

  // A freshly-added component briefly renders with Mol*'s own default theme
  // (and default, thin size) before any follow-up update lands — each
  // update is its own async state-tree commit, so the more of them there
  // are after component.add, the more separate "wrong" frames get painted
  // in between. This sets color, size and ignoreHydrogens together in one
  // direct state update per representation (bypassing
  // component.updateRepresentationsTheme, which only covers color — and,
  // confirmed live, silently ignores a size/sizeParams theme entirely; the
  // real size knobs are the representation's own type params: sizeFactor
  // and linkScale, the shared base radius and the stick's share of it).
  // "element-symbol" with a custom carbonColor colors carbon atoms with the
  // chain's grey/blue theme while leaving H/N/O/S in their standard CPK
  // colors — a plain "uniform" theme painted every atom one color, hiding
  // which atoms were heteroatoms.
  //
  // Takes the component's *ref*, not the component object itself —
  // component.representations (the StructureHierarchyManager's own derived
  // view) turned out to lag behind the raw state tree: confirmed live that
  // right after component.add()'s promise resolves, that array can still be
  // empty even though the representation node already exists in the tree,
  // silently skipping this whole function (0 iterations) and leaving the
  // component unstyled — intermittently, since how long the lag lasts
  // varies. Reading the representation ref(s) directly from
  // state.data.tree.children (always current the instant commit()
  // resolves) sidesteps that lag entirely.
  async function styleSideChainComponent(componentRef, color) {
    const children = viewer.plugin.state.data.tree.children.get(componentRef);
    const reprRefs = children ? children.toArray() : [];
    for (const reprRef of reprRefs) {
      await viewer.plugin
        .build()
        .to(reprRef)
        .update((old) => ({
          ...old,
          colorTheme: {
            name: "element-symbol",
            params: { ...(old.colorTheme && old.colorTheme.params), carbonColor: { name: "uniform", params: { value: color } } },
          },
          type: { ...old.type, params: { ...old.type.params, sizeFactor: 0.35, linkScale: 1, ignoreHydrogens: true } },
        }))
        .commit();
    }
  }

  // A new click (model or diagram) arriving mid-build — this has several
  // awaited state-tree commits in a row — used to leave things in a
  // half-applied state: the newer call's clearSideChains() could delete a
  // component the older call was still styling, or the older call could
  // finish styling *after* the newer call already moved on, stepping on it.
  // Each call takes a generation number and checks it's still the latest
  // before every remaining state-tree write; a superseded call just stops,
  // leaving cleanup/building to whichever call is actually current.
  let showSideChainsGeneration = 0;

  async function showSideChains(residues) {
    const generation = ++showSideChainsGeneration;
    await clearSideChains();
    if (generation !== showSideChainsGeneration) return;
    if (!residues || !residues.length) return;
    const { StructureSelectionQuery, Color } = queryMods;
    const colorByChain = new Map((chainColors || []).map(({ chain, rgb }) => [chain, Color.fromRgb(rgb[0], rgb[1], rgb[2])]));

    for (const chain of new Set(residues.map((r) => r.chain))) {
      // Checked before component.add() too, not just after: a call that's
      // been superseded while this was still in flight (component.add is
      // async) would otherwise still add its now-stale component to the
      // scene — unstyled, since the checks further down correctly skip
      // styling it, but by then it's already visible and duplicates
      // whatever the newer call added for the same chain. Confirmed live
      // (via logging) that this is exactly what produced a leftover,
      // never-restyled "Side chains (A)" after clicking two different
      // chain-A residues in a row.
      if (generation !== showSideChainsGeneration) return;
      const structureRef = viewer.plugin.managers.structure.hierarchy.current.structures[0];
      if (!structureRef) continue;
      const chainResidues = residues.filter((r) => r.chain === chain);
      const label = `Side chains (${chain})`;
      const query = new StructureSelectionQuery(label, buildResidueExpr(chainResidues));
      await viewer.plugin.managers.structure.component.add(
        { selection: query, options: { checkExisting: false, label }, representation: "ball-and-stick" },
        [structureRef]
      );
      if (generation !== showSideChainsGeneration) {
        // Too late to stop the add above, so this stale component must be
        // deleted directly — it was never tracked in sideChainComponentRefs,
        // and by now that array belongs to whichever call is current.
        const updated = viewer.plugin.managers.structure.hierarchy.current.structures[0];
        const stale = updated.components.find((c) => c.cell.obj && c.cell.obj.label === label && !sideChainComponentRefs.includes(c.cell.transform.ref));
        if (stale) viewer.plugin.build().delete(stale.cell.transform.ref).commit();
        return;
      }
      const updated = viewer.plugin.managers.structure.hierarchy.current.structures[0];
      const comp = updated.components.find((c) => c.cell.obj && c.cell.obj.label === label);
      if (!comp) continue;
      sideChainComponentRefs.push(comp.cell.transform.ref);
      const color = colorByChain.get(chain);
      if (color !== undefined) {
        await styleSideChainComponent(comp.cell.transform.ref, color);
      }
    }
  }

  // Deletes every "Side chains (...)" component currently in the hierarchy,
  // not just the ones tracked in sideChainComponentRefs — a defense against
  // any future tracking gap leaving an orphaned, never-cleaned-up component
  // (same category of bug as the one above).
  async function clearSideChains() {
    sideChainComponentRefs = [];
    const current = viewer.plugin.managers.structure.hierarchy.current.structures[0];
    if (!current) return;
    const targets = current.components.filter((c) => c.cell.obj && c.cell.obj.label && c.cell.obj.label.startsWith("Side chains ("));
    for (const t of targets) {
      await viewer.plugin.build().delete(t.cell.transform.ref).commit();
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
  // behavior, separate from the contact diagram's click handling) does two
  // things we don't want: resets the cartoon/side-chain coloring back to
  // Mol*'s own default palette, and auto-adds its own "[Focus] Target" /
  // "[Focus] Surroundings" components — a *different*, default-themed,
  // default-sized ball-and-stick overlay, independent of (and inconsistent
  // with) showSideChains above. A fixed delay after the click (e.g.
  // setTimeout(_, 150)) isn't reliable — confirmed live (via
  // plugin.state.events.object.created) that those "[Focus] *" objects are
  // built *before* ours on every click, but how long Mol*'s own async build
  // takes varies, so a guessed delay sometimes leaves them showing (wrong
  // colors, default thin size) until a later click's cleanup finally catches
  // up with the previous one. Reacting to the creation event itself, and
  // deleting immediately, has none of that timing dependency.
  viewer.plugin.state.events.object.created.subscribe((e) => {
    if (e.obj && e.obj.label && e.obj.label.startsWith("[Focus]")) {
      viewer.plugin.build().delete(e.ref).commit();
    }
  });

  viewer.plugin.behaviors.interaction.click.subscribe((e) => {
    applyChainColors();

    // Show (and zoom to) exactly the clicked residue's own side chains,
    // the same way a contact-diagram click already does; clicking empty
    // space clears them, matching the diagram's own background click.
    const residues = residuesFromLoci(e.current && e.current.loci);
    if (residues.length) {
      showSideChains(residues);
      focusResidues(residues);
    } else {
      clearSideChains();
    }
  });

  return { viewer, highlightResidues, clearHighlight, showSideChains, clearSideChains, focusResidues };
}
