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

  // residues: [{chain, resnum}, ...] — builds one combined loci (OR'd across
  // residues) so a single hover event highlights every residue involved.
  function buildResidueLoci(residues) {
    const structure = getStructure();
    if (!structure || !residues.length) return null;
    const { MS, compile, QueryContext, StructureSelection } = queryMods;
    const tests = residues.map(({ chain, resnum }) =>
      MS.core.logic.and([
        MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), chain]),
        MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_seq_id(), resnum]),
      ])
    );
    const test = tests.length === 1 ? tests[0] : MS.core.logic.or(tests);
    const expr = MS.struct.generator.atomGroups({ "residue-test": test });
    const query = compile(expr);
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

  return { viewer, highlightResidues, clearHighlight };
}
