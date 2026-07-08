import type { ConceptAliasRecord, KnowledgeCard } from "../types.js";
import {
  createAutomaticConceptAliases,
  createConceptAliasResolver,
  normalizeConceptKey,
  normalizeConceptLabel
} from "./conceptAliases.js";

export type SkillTreeNodeImportance = "required" | "optional";
export type SkillTreeNodeStatus = "mastered" | "learning" | "gap";

export interface BuildSkillTreeInput {
  goalConcept: string;
  cards: readonly KnowledgeCard[];
  conceptAliases?: readonly ConceptAliasRecord[];
  knownConcepts?: readonly string[];
}

export interface SkillTreeEdge {
  id: string;
  source: string;
  target: string;
  sourceConcept: string;
  targetConcept: string;
  weight: number;
  postIds: string[];
}

export interface SkillTreeNode {
  id: string;
  concept: string;
  layer: number;
  importance: SkillTreeNodeImportance;
  status: SkillTreeNodeStatus;
  mastered: boolean;
  gap: boolean;
  postIds: string[];
  prerequisiteIds: string[];
  dependentIds: string[];
  requiresInCount: number;
}

export interface SkillTreeLayer {
  index: number;
  nodeIds: string[];
  completed: boolean;
}

export interface SkillTreeView {
  goalConcept: string;
  goalId: string;
  nodes: SkillTreeNode[];
  layers: SkillTreeLayer[];
  edges: SkillTreeEdge[];
  droppedEdges: SkillTreeEdge[];
  gapConcepts: string[];
  progress: {
    mastered: number;
    total: number;
    percent: number;
  };
}

export interface SkillTreeBuildResult {
  tree: SkillTreeView | null;
  reason?: string;
}

interface EdgeDraft {
  id: string;
  source: string;
  target: string;
  sourceConcept: string;
  targetConcept: string;
  weight: number;
  postIds: string[];
}

interface ConceptCoverage {
  label: string;
  postIds: string[];
}

export function buildSkillTree(input: BuildSkillTreeInput): SkillTreeBuildResult {
  const aliases = [...(input.conceptAliases ?? []), ...createAutomaticConceptAliases(input.cards, input.conceptAliases)];
  const resolver = createConceptAliasResolver(aliases);
  const labelByKey = new Map<string, string>();
  const coverageByKey = new Map<string, ConceptCoverage>();
  const graphConceptKeys = new Set<string>();
  const edgeByPair = new Map<string, EdgeDraft>();

  const rememberLabel = (concept: string): { key: string; label: string } => {
    const resolved = normalizeConceptLabel(resolver.resolveConcept(concept));
    const key = normalizeConceptKey(resolved);

    if (!key) {
      return { key: "", label: resolved };
    }

    labelByKey.set(key, chooseConceptLabel([labelByKey.get(key), resolved].filter(isString)));
    graphConceptKeys.add(key);

    return { key, label: labelByKey.get(key) ?? resolved };
  };

  for (const card of input.cards) {
    const isContentCard = card.kind !== "connection_note";

    for (const concept of card.concepts ?? []) {
      const { key, label } = rememberLabel(concept);

      if (!key || !isContentCard) {
        continue;
      }

      const coverage = coverageByKey.get(key) ?? { label, postIds: [] };

      coverage.label = chooseConceptLabel([coverage.label, label]);
      coverage.postIds = uniqueSorted([...coverage.postIds, card.id]).slice(0, 5);
      coverageByKey.set(key, coverage);
    }

    for (const edge of card.graphEdges ?? []) {
      const source = rememberLabel(edge.sourceConcept);
      const target = rememberLabel(edge.targetConcept);

      if (edge.relation !== "requires" || !source.key || !target.key) {
        continue;
      }

      if (source.key === target.key) {
        continue;
      }

      const pairKey = `${source.key}\u0000${target.key}`;
      const existing = edgeByPair.get(pairKey);
      const edgeId = existing ? chooseEdgeId([existing.id, edge.id]) : edge.id;
      const weight = Number.isFinite(edge.weight) ? edge.weight : 0;

      edgeByPair.set(pairKey, {
        id: edgeId,
        source: source.key,
        target: target.key,
        sourceConcept: labelByKey.get(source.key) ?? source.label,
        targetConcept: labelByKey.get(target.key) ?? target.label,
        weight: (existing?.weight ?? 0) + weight,
        postIds: uniqueSorted([...(existing?.postIds ?? []), card.id]).slice(0, 5)
      });
    }
  }

  const graphConceptKeysBeforeGoal = new Set(graphConceptKeys);
  const goal = rememberLabel(input.goalConcept);

  if (!goal.key || !graphConceptKeysBeforeGoal.has(goal.key)) {
    return {
      tree: null,
      reason: "goal_not_in_graph"
    };
  }

  const allEdges = Array.from(edgeByPair.values()).map(toSkillTreeEdge);
  const initialClosure = collectPrerequisiteClosure(goal.key, allEdges);
  const relevantEdges = allEdges.filter((edge) => initialClosure.has(edge.source) && initialClosure.has(edge.target));
  const { edges: acyclicEdges, droppedEdges } = breakCycles(initialClosure, relevantEdges);
  const closure = collectPrerequisiteClosure(goal.key, acyclicEdges);
  const edges = acyclicEdges.filter((edge) => closure.has(edge.source) && closure.has(edge.target));

  for (const key of closure) {
    if (!labelByKey.has(key)) {
      labelByKey.set(key, coverageByKey.get(key)?.label ?? key);
    }
  }

  const prerequisiteIdsByNode = new Map<string, Set<string>>();
  const dependentIdsByNode = new Map<string, Set<string>>();
  const requiresInCountByNode = new Map<string, number>();

  for (const key of closure) {
    prerequisiteIdsByNode.set(key, new Set());
    dependentIdsByNode.set(key, new Set());
    requiresInCountByNode.set(key, 0);
  }

  for (const edge of edges) {
    prerequisiteIdsByNode.get(edge.source)?.add(edge.target);
    dependentIdsByNode.get(edge.target)?.add(edge.source);
    requiresInCountByNode.set(edge.target, (requiresInCountByNode.get(edge.target) ?? 0) + 1);
  }

  const layerByNode = assignLayers(closure, prerequisiteIdsByNode, dependentIdsByNode);
  const knownKeys = new Set(
    (input.knownConcepts ?? [])
      .map((concept) => normalizeConceptKey(resolver.resolveConcept(concept)))
      .filter(Boolean)
  );
  const directPrerequisiteIds = prerequisiteIdsByNode.get(goal.key) ?? new Set<string>();

  const nodes = Array.from(closure)
    .map((key) => {
      const postIds = coverageByKey.get(key)?.postIds ?? [];
      const mastered = knownKeys.has(key);
      const gap = !mastered && isGapConcept(key, postIds, prerequisiteIdsByNode);
      const prerequisiteIds = Array.from(prerequisiteIdsByNode.get(key) ?? []).sort(compareText);
      const dependentIds = Array.from(dependentIdsByNode.get(key) ?? []).sort(compareText);
      const importance =
        key === goal.key || directPrerequisiteIds.has(key) || (requiresInCountByNode.get(key) ?? 0) >= 2
          ? "required"
          : "optional";

      return {
        id: key,
        concept: labelByKey.get(key) ?? key,
        layer: layerByNode.get(key) ?? 0,
        importance,
        status: mastered ? "mastered" : gap ? "gap" : "learning",
        mastered,
        gap,
        postIds,
        prerequisiteIds,
        dependentIds,
        requiresInCount: requiresInCountByNode.get(key) ?? 0
      } satisfies SkillTreeNode;
    })
    .sort((left, right) => left.layer - right.layer || compareText(left.concept, right.concept));

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const layers = Array.from(new Set(nodes.map((node) => node.layer)))
    .sort((left, right) => left - right)
    .map((index) => {
      const layerNodes = nodes.filter((node) => node.layer === index);

      return {
        index,
        nodeIds: layerNodes.map((node) => node.id),
        completed: layerNodes.length > 0 && layerNodes.every((node) => node.mastered)
      };
    });
  const mastered = nodes.filter((node) => node.mastered).length;
  const total = nodes.length;

  return {
    tree: {
      goalConcept: labelByKey.get(goal.key) ?? goal.label,
      goalId: goal.key,
      nodes,
      layers,
      edges: edges
        .filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))
        .sort(compareEdgesForOutput),
      droppedEdges: droppedEdges.sort(compareEdgesForOutput),
      gapConcepts: nodes.filter((node) => node.gap).map((node) => node.concept),
      progress: {
        mastered,
        total,
        percent: total ? Math.round((mastered / total) * 100) : 0
      }
    }
  };
}

function collectPrerequisiteClosure(goalKey: string, edges: readonly SkillTreeEdge[]): Set<string> {
  const bySource = new Map<string, SkillTreeEdge[]>();

  for (const edge of edges) {
    const records = bySource.get(edge.source) ?? [];

    records.push(edge);
    bySource.set(edge.source, records);
  }

  const closure = new Set<string>();
  const stack = [goalKey];

  while (stack.length) {
    const key = stack.pop();

    if (!key || closure.has(key)) {
      continue;
    }

    closure.add(key);

    for (const edge of (bySource.get(key) ?? []).sort(compareEdgesForOutput)) {
      if (!closure.has(edge.target)) {
        stack.push(edge.target);
      }
    }
  }

  return closure;
}

function breakCycles(
  nodeIds: ReadonlySet<string>,
  inputEdges: readonly SkillTreeEdge[]
): { edges: SkillTreeEdge[]; droppedEdges: SkillTreeEdge[] } {
  let edges = [...inputEdges];
  const droppedEdges: SkillTreeEdge[] = [];

  while (true) {
    const cyclicComponents = findCyclicComponents(nodeIds, edges);

    if (!cyclicComponents.length) {
      break;
    }

    const drops = cyclicComponents.flatMap((component) => {
      const componentEdges = edges.filter((edge) => component.has(edge.source) && component.has(edge.target));

      return componentEdges.sort(compareEdgesForDrop).slice(0, 1);
    });
    const dropIds = new Set(drops.map((edge) => edge.id));

    droppedEdges.push(...drops);
    edges = edges.filter((edge) => !dropIds.has(edge.id));
  }

  return { edges, droppedEdges };
}

function findCyclicComponents(nodeIds: ReadonlySet<string>, edges: readonly SkillTreeEdge[]): Array<Set<string>> {
  const nodes = Array.from(nodeIds).sort(compareText);
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    adjacency.set(node, []);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue;
    }

    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target].sort(compareText));
  }

  const indexByNode = new Map<string, number>();
  const lowlinkByNode = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: Array<Set<string>> = [];
  let index = 0;

  const strongConnect = (node: string) => {
    indexByNode.set(node, index);
    lowlinkByNode.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of adjacency.get(node) ?? []) {
      if (!indexByNode.has(next)) {
        strongConnect(next);
        lowlinkByNode.set(node, Math.min(lowlinkByNode.get(node) ?? 0, lowlinkByNode.get(next) ?? 0));
      } else if (onStack.has(next)) {
        lowlinkByNode.set(node, Math.min(lowlinkByNode.get(node) ?? 0, indexByNode.get(next) ?? 0));
      }
    }

    if (lowlinkByNode.get(node) !== indexByNode.get(node)) {
      return;
    }

    const component = new Set<string>();
    let current: string | undefined;

    do {
      current = stack.pop();

      if (current) {
        onStack.delete(current);
        component.add(current);
      }
    } while (current && current !== node);

    if (component.size > 1 || edges.some((edge) => edge.source === node && edge.target === node)) {
      components.push(component);
    }
  };

  for (const node of nodes) {
    if (!indexByNode.has(node)) {
      strongConnect(node);
    }
  }

  return components.sort((left, right) => compareText(Array.from(left).sort(compareText)[0] ?? "", Array.from(right).sort(compareText)[0] ?? ""));
}

function assignLayers(
  nodeIds: ReadonlySet<string>,
  prerequisiteIdsByNode: ReadonlyMap<string, ReadonlySet<string>>,
  dependentIdsByNode: ReadonlyMap<string, ReadonlySet<string>>
): Map<string, number> {
  const unresolvedPrerequisiteCount = new Map<string, number>();
  const ready = Array.from(nodeIds)
    .filter((node) => {
      const count = prerequisiteIdsByNode.get(node)?.size ?? 0;

      unresolvedPrerequisiteCount.set(node, count);
      return count === 0;
    })
    .sort(compareText);
  const layerByNode = new Map<string, number>();

  while (ready.length) {
    const node = ready.shift() ?? "";
    const nodeLayer = layerByNode.get(node) ?? 0;

    for (const dependent of Array.from(dependentIdsByNode.get(node) ?? []).sort(compareText)) {
      layerByNode.set(dependent, Math.max(layerByNode.get(dependent) ?? 0, nodeLayer + 1));
      unresolvedPrerequisiteCount.set(dependent, (unresolvedPrerequisiteCount.get(dependent) ?? 0) - 1);

      if (unresolvedPrerequisiteCount.get(dependent) === 0) {
        ready.push(dependent);
        ready.sort(compareText);
      }
    }
  }

  for (const node of nodeIds) {
    if (!layerByNode.has(node)) {
      layerByNode.set(node, 0);
    }
  }

  return layerByNode;
}

function isGapConcept(
  key: string,
  postIds: readonly string[],
  prerequisiteIdsByNode: ReadonlyMap<string, ReadonlySet<string>>
): boolean {
  // Thin supply: nothing covers the concept, or it has a single card and the
  // graph knows no prerequisites to break it down further.
  return postIds.length === 0 || (postIds.length === 1 && (prerequisiteIdsByNode.get(key)?.size ?? 0) === 0);
}

function toSkillTreeEdge(edge: EdgeDraft): SkillTreeEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceConcept: edge.sourceConcept,
    targetConcept: edge.targetConcept,
    weight: Math.round(edge.weight * 1000) / 1000,
    postIds: edge.postIds
  };
}

function chooseConceptLabel(labels: readonly string[]): string {
  return labels
    .map((label) => normalizeConceptLabel(label))
    .filter(Boolean)
    .sort((left, right) => left.length - right.length || compareText(left, right))[0] ?? "";
}

function chooseEdgeId(ids: readonly string[]): string {
  return ids.filter(Boolean).sort(compareText)[0] ?? "requires-edge";
}

function compareEdgesForDrop(left: SkillTreeEdge, right: SkillTreeEdge): number {
  return left.weight - right.weight || compareText(left.id, right.id);
}

function compareEdgesForOutput(left: SkillTreeEdge, right: SkillTreeEdge): number {
  return compareText(left.sourceConcept, right.sourceConcept) || compareText(left.targetConcept, right.targetConcept) || compareText(left.id, right.id);
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort(compareText);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
