<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { bfs, dfs, dijkstra } from '../utils/functions.js';

const TOOLBAR_HEIGHT = 100;
const NODE_RADIUS = 25;
const MIN_NODE_DISTANCE = 80;
const DRAG_START_DISTANCE = 5;
const RELAXATION_STEPS = 8;
const RESET_DELAY = 1000;
const DISABLED_WEIGHT = null;
const MAX_INPUT_NODE_COUNT = 30;

const graphRoot = ref(null);
const nodes = ref([]);
const lines = ref([]);
const selectedNode = ref(null);
const currentLine = ref(null);
const graphConnections = ref([]);
const inputFields = ref([]);
const userDone = ref([]);
const redoStack = ref([]);
const startIdx = ref(-1);
const nodeSelecting = ref([]);
const nodeSelected = ref([]);
const isProcessing = ref(false);
const nodeOrders = ref({});
const nodeDistances = ref({});
const hoveredWeight = ref(null);
const nextEdgeId = ref(1);
const dragState = ref(null);
const shouldSuppressNodeClick = ref(false);
const traversalResult = ref(null);
const activeResultStep = ref(-1);
const graphInput = ref('5 5\n1 2 3\n1 3 2\n2 4 4\n3 4 1\n4 5 6');
const graphInputMode = ref('undirected');
const animationDelay = ref(500);
const STORAGE_KEY = 'graph-editor-saved-graphs';
const savedGraphs = ref(loadSavedGraphs());
const activeGraphId = ref(null);
const isRestoringSavedGraph = ref(false);
const isHelpOpen = ref(false);
let autoSaveTimer = null;

const hasNodes = computed(() => nodes.value.length > 0);
const selectedNodeId = computed(() => (
  selectedNode.value === null ? null : nodes.value[selectedNode.value]?.id
));
const dragNodeId = computed(() => dragState.value?.nodeId ?? null);
const statusText = computed(() => {
  if (isProcessing.value) return 'Running algorithm';
  if (dragNodeId.value) return `Moving node ${dragNodeId.value}`;
  if (selectedNodeId.value) return `Connecting from node ${selectedNodeId.value}`;
  if (startIdx.value !== -1) return `Start node ${startIdx.value}`;
  return 'Click canvas to add a node';
});

function getPointerPosition(event) {
  const rect = graphRoot.value.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function applyGraphInput() {
  if (isProcessing.value) return;

  const parsed = parseGraphInput(graphInput.value);
  if (!parsed) return;

  const { nodeCount, edges } = parsed;
  const arrangedNodes = createAutoLayoutNodes(nodeCount);
  const validNodeIds = new Set(arrangedNodes.map(node => node.id));
  const nextLines = [];
  const nextInputs = [];
  const nextConnections = [];
  let edgeId = 1;

  for (const edge of edges) {
    if (!validNodeIds.has(edge.from) || !validNodeIds.has(edge.to) || edge.from === edge.to) {
      alert(`잘못된 간선입니다: ${edge.from} ${edge.to} ${edge.weight}`);
      return;
    }

    const fromNode = arrangedNodes.find(node => node.id === edge.from);
    const toNode = arrangedNodes.find(node => node.id === edge.to);
    const isDirected = graphInputMode.value === 'directed';

    nextLines.push({
      id: edgeId,
      x1: fromNode.x,
      y1: fromNode.y,
      x2: toNode.x,
      y2: toNode.y,
    });
    nextInputs.push({
      forward: edge.weight,
      backward: isDirected ? '' : edge.weight,
    });
    nextConnections.push([
      edge.from,
      edge.to,
      edge.weight,
      isDirected ? DISABLED_WEIGHT : edge.weight,
    ]);
    edgeId += 1;
  }

  const after = {
    nodes: arrangedNodes,
    lines: nextLines,
    inputFields: nextInputs,
    graphConnections: nextConnections,
    nodeOrders: Object.fromEntries(arrangedNodes.map(node => [node.id, Number.NaN])),
    nodeDistances: {},
    nodeSelecting: nodeCount > 0 ? [1] : [],
    nodeSelected: [],
    startIdx: nodeCount > 0 ? 1 : -1,
    hoveredWeight: null,
    traversalResult: null,
    activeResultStep: -1,
    nextEdgeId: edgeId,
  };

  replaceGraphWithSnapshot(after);
}

function createGraphSnapshot() {
  return {
    nodes: nodes.value.map(node => ({ ...node })),
    lines: lines.value.map(line => ({ ...line })),
    inputFields: inputFields.value.map(input => ({ ...input })),
    graphConnections: graphConnections.value.map(connection => [...connection]),
    nodeOrders: { ...nodeOrders.value },
    nodeDistances: { ...nodeDistances.value },
    nodeSelecting: [...nodeSelecting.value],
    nodeSelected: [...nodeSelected.value],
    startIdx: startIdx.value,
    hoveredWeight: hoveredWeight.value ? { ...hoveredWeight.value } : null,
    traversalResult: traversalResult.value
      ? {
          ...traversalResult.value,
          distances: traversalResult.value.distances ? { ...traversalResult.value.distances } : null,
          sequence: traversalResult.value.isGrouped
            ? traversalResult.value.sequence.map(group => [...group])
            : [...traversalResult.value.sequence],
        }
      : null,
    activeResultStep: activeResultStep.value,
    nextEdgeId: nextEdgeId.value,
  };
}

function restoreGraphSnapshot(snapshot) {
  const normalizedSnapshot = normalizeGraphSnapshot(snapshot);
  cancelCurrentLine();
  nodes.value = normalizedSnapshot.nodes.map(node => ({ ...node }));
  lines.value = normalizedSnapshot.lines.map(line => ({ ...line }));
  inputFields.value = normalizedSnapshot.inputFields.map(input => ({ ...input }));
  graphConnections.value = normalizedSnapshot.graphConnections.map(connection => [...connection]);
  nodeOrders.value = { ...normalizedSnapshot.nodeOrders };
  nodeDistances.value = { ...normalizedSnapshot.nodeDistances };
  nodeSelecting.value = [...normalizedSnapshot.nodeSelecting];
  nodeSelected.value = [...normalizedSnapshot.nodeSelected];
  startIdx.value = normalizedSnapshot.startIdx;
  hoveredWeight.value = normalizedSnapshot.hoveredWeight ? { ...normalizedSnapshot.hoveredWeight } : null;
  traversalResult.value = normalizedSnapshot.traversalResult
    ? {
        ...normalizedSnapshot.traversalResult,
        distances: normalizedSnapshot.traversalResult.distances ? { ...normalizedSnapshot.traversalResult.distances } : null,
        sequence: normalizedSnapshot.traversalResult.isGrouped
          ? normalizedSnapshot.traversalResult.sequence.map(group => [...group])
          : [...normalizedSnapshot.traversalResult.sequence],
      }
    : null;
  activeResultStep.value = normalizedSnapshot.activeResultStep;
  nextEdgeId.value = normalizedSnapshot.nextEdgeId;
}

function createGraphSlot() {
  if (isProcessing.value) return;

  autoSaveCurrentGraph();

  const slot = createSavedGraphRecord(createEmptyGraphSnapshot());
  savedGraphs.value.unshift(slot);
  activeGraphId.value = slot.id;
  restoreSavedGraph(slot);
  persistSavedGraphs();
}

function deleteSavedGraph(graphId) {
  if (isProcessing.value) return;

  const wasActive = activeGraphId.value === graphId;
  savedGraphs.value = savedGraphs.value.filter(graph => graph.id !== graphId);

  if (wasActive) {
    const nextGraph = savedGraphs.value[0];

    if (nextGraph) {
      activeGraphId.value = nextGraph.id;
      restoreSavedGraph(nextGraph);
    } else {
      activeGraphId.value = null;
      restoreSavedGraph({ snapshot: createEmptyGraphSnapshot() });
    }
  }

  persistSavedGraphs();
}

function switchSavedGraph(graph) {
  if (isProcessing.value) return;
  if (graph.id === activeGraphId.value) return;

  autoSaveCurrentGraph();
  activeGraphId.value = graph.id;
  restoreSavedGraph(graph);
}

function autoSaveCurrentGraph() {
  const snapshot = createGraphSnapshot();

  if (!activeGraphId.value && !hasSnapshotContent(snapshot)) return;

  autoSaveGraphSnapshot(snapshot);
}

function scheduleAutoSave(snapshot) {
  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(() => {
    autoSaveGraphSnapshot(snapshot);
  }, 180);
}

function autoSaveGraphSnapshot(snapshot) {
  if (isRestoringSavedGraph.value || isProcessing.value) return;
  if (!activeGraphId.value && !hasSnapshotContent(snapshot)) return;

  const slot = ensureActiveGraphSlot(snapshot);
  slot.snapshot = normalizeGraphSnapshot(snapshot);
  slot.history = createHistorySnapshot();
  slot.updatedAt = new Date().toISOString();
  persistSavedGraphs();
}

function hasSnapshotContent(snapshot) {
  return snapshot.nodes.length > 0 || snapshot.graphConnections.length > 0;
}

function ensureActiveGraphSlot(snapshot = createEmptyGraphSnapshot()) {
  let slot = savedGraphs.value.find(graph => graph.id === activeGraphId.value);

  if (!slot) {
    slot = createSavedGraphRecord(snapshot);
    savedGraphs.value.unshift(slot);
    activeGraphId.value = slot.id;
  }

  return slot;
}

function createSavedGraphRecord(snapshot) {
  const graphNumber = savedGraphs.value.length + 1;

  return {
    id: `graph-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `Graph ${graphNumber}`,
    updatedAt: new Date().toISOString(),
    snapshot: normalizeGraphSnapshot(snapshot),
    history: createEmptyHistorySnapshot(),
  };
}

function restoreSavedGraph(graph) {
  window.clearTimeout(autoSaveTimer);
  isRestoringSavedGraph.value = true;
  restoreGraphSnapshot(graph.snapshot);
  const history = normalizeHistorySnapshot(graph.history);
  userDone.value = history.userDone;
  redoStack.value = history.redoStack;
  isRestoringSavedGraph.value = false;
}

function createEmptyHistorySnapshot() {
  return {
    userDone: [],
    redoStack: [],
  };
}

function createHistorySnapshot() {
  return {
    userDone: cloneHistoryStack(userDone.value),
    redoStack: cloneHistoryStack(redoStack.value),
  };
}

function normalizeHistorySnapshot(history = createEmptyHistorySnapshot()) {
  return {
    userDone: cloneHistoryStack(history.userDone ?? []),
    redoStack: cloneHistoryStack(history.redoStack ?? []),
  };
}

function cloneHistoryStack(stack) {
  return stack.map(action => normalizeHistoryAction(cloneValue(action)));
}

function normalizeHistoryAction(action) {
  if (!action) return action;

  if (action.before) {
    action.before = normalizeGraphSnapshot(action.before);
  }

  if (action.after) {
    action.after = normalizeGraphSnapshot(action.after);
  }

  if (action.nodeOrder === null) {
    action.nodeOrder = Number.NaN;
  }

  return action;
}

function cloneValue(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => cloneValue(item));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
  );
}

function replaceGraphWithSnapshot(nextSnapshot) {
  const before = createGraphSnapshot();
  restoreGraphSnapshot(nextSnapshot);
  pushHistory({
    type: 'replace-graph',
    before,
    after: createGraphSnapshot(),
  });
}

function createEmptyGraphSnapshot() {
  return {
    nodes: [],
    lines: [],
    inputFields: [],
    graphConnections: [],
    nodeOrders: {},
    nodeDistances: {},
    nodeSelecting: [],
    nodeSelected: [],
    startIdx: -1,
    hoveredWeight: null,
    traversalResult: null,
    activeResultStep: -1,
    nextEdgeId: 1,
  };
}

function normalizeGraphSnapshot(snapshot = {}) {
  const empty = createEmptyGraphSnapshot();
  const traversal = snapshot.traversalResult ?? null;
  const nodeOrderEntries = Object.entries(snapshot.nodeOrders ?? empty.nodeOrders)
    .map(([key, value]) => [key, value === null ? Number.NaN : value]);

  return {
    nodes: (snapshot.nodes ?? empty.nodes).map(node => ({ ...node })),
    lines: (snapshot.lines ?? empty.lines).map(line => ({ ...line })),
    inputFields: (snapshot.inputFields ?? empty.inputFields).map(input => ({ ...input })),
    graphConnections: (snapshot.graphConnections ?? empty.graphConnections).map(connection => [...connection]),
    nodeOrders: Object.fromEntries(nodeOrderEntries),
    nodeDistances: { ...(snapshot.nodeDistances ?? empty.nodeDistances) },
    nodeSelecting: [...(snapshot.nodeSelecting ?? empty.nodeSelecting)],
    nodeSelected: [...(snapshot.nodeSelected ?? empty.nodeSelected)],
    startIdx: snapshot.startIdx ?? empty.startIdx,
    hoveredWeight: snapshot.hoveredWeight ? { ...snapshot.hoveredWeight } : null,
    traversalResult: traversal
      ? {
          ...traversal,
          distances: traversal.distances ? { ...traversal.distances } : null,
          sequence: traversal.isGrouped
            ? (traversal.sequence ?? []).map(group => [...group])
            : [...(traversal.sequence ?? [])],
        }
      : null,
    activeResultStep: snapshot.activeResultStep ?? empty.activeResultStep,
    nextEdgeId: snapshot.nextEdgeId ?? empty.nextEdgeId,
  };
}

function getSavedGraphTitle(graph, index) {
  return graph.name || `Graph ${index + 1}`;
}

function getSavedGraphMeta(graph) {
  const snapshot = normalizeGraphSnapshot(graph.snapshot);
  return `${snapshot.nodes.length}N ${snapshot.graphConnections.length}E`;
}

function getPreviewBounds(snapshot) {
  const graphSnapshot = normalizeGraphSnapshot(snapshot);
  const xs = graphSnapshot.nodes.map(node => node.x);
  const ys = graphSnapshot.nodes.map(node => node.y);

  if (xs.length === 0) {
    return { minX: 0, minY: 0, width: 1, height: 1 };
  }

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    minX,
    minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  };
}

function mapPreviewPoint(point, bounds) {
  const previewWidth = 120;
  const previewHeight = 88;
  const padding = 13;
  const scale = Math.min(
    (previewWidth - padding * 2) / bounds.width,
    (previewHeight - padding * 2) / bounds.height,
  );
  const graphWidth = bounds.width * scale;
  const graphHeight = bounds.height * scale;
  const offsetX = (previewWidth - graphWidth) / 2;
  const offsetY = (previewHeight - graphHeight) / 2;

  return {
    x: offsetX + (point.x - bounds.minX) * scale,
    y: offsetY + (point.y - bounds.minY) * scale,
  };
}

function getPreviewNodes(snapshot) {
  const graphSnapshot = normalizeGraphSnapshot(snapshot);
  const bounds = getPreviewBounds(graphSnapshot);

  return graphSnapshot.nodes.map(node => ({
    ...node,
    ...mapPreviewPoint(node, bounds),
  }));
}

function getPreviewEdges(snapshot) {
  const graphSnapshot = normalizeGraphSnapshot(snapshot);
  const bounds = getPreviewBounds(graphSnapshot);
  const nodeMap = new Map(graphSnapshot.nodes.map(node => [node.id, node]));

  return graphSnapshot.graphConnections
    .map(([from, to]) => {
      const fromNode = nodeMap.get(from);
      const toNode = nodeMap.get(to);

      if (!fromNode || !toNode) return null;

      return {
        from: mapPreviewPoint(fromNode, bounds),
        to: mapPreviewPoint(toNode, bounds),
      };
    })
    .filter(Boolean);
}

function loadSavedGraphs() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function persistSavedGraphs() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(savedGraphs.value));
}

function parseGraphInput(rawInput) {
  const rows = rawInput
    .split(/\r?\n/)
    .map(row => row.trim())
    .filter(Boolean);

  if (rows.length === 0) {
    alert('그래프 입력이 비어 있습니다.');
    return null;
  }

  const header = rows[0].split(/\s+/).map(Number);
  if (header.length < 2 || !header.every(Number.isInteger)) {
    alert('첫 줄은 n m 형식이어야 합니다.');
    return null;
  }

  const [nodeCount, edgeCount] = header;
  if (nodeCount < 0 || edgeCount < 0) {
    alert('n과 m은 0 이상이어야 합니다.');
    return null;
  }

  if (nodeCount > MAX_INPUT_NODE_COUNT) {
    alert(`n은 최대 ${MAX_INPUT_NODE_COUNT}개까지 입력할 수 있습니다.`);
    return null;
  }

  const maxEdgeCount = getMaxGraphInputEdgeCount(nodeCount);
  if (edgeCount > maxEdgeCount) {
    alert(`현재 모드에서 n=${nodeCount}일 때 m은 최대 ${maxEdgeCount}개까지 가능합니다.`);
    return null;
  }

  if (rows.length - 1 < edgeCount) {
    alert(`간선 ${edgeCount}개가 필요합니다.`);
    return null;
  }

  const edges = [];
  for (let index = 0; index < edgeCount; index += 1) {
    const values = rows[index + 1].split(/\s+/).map(Number);

    if (values.length < 2 || !Number.isInteger(values[0]) || !Number.isInteger(values[1])) {
      alert(`${index + 2}번째 줄은 a b 또는 a b w 형식이어야 합니다.`);
      return null;
    }

    const weight = values.length >= 3 ? values[2] : 1;
    if (!Number.isFinite(weight)) {
      alert(`${index + 2}번째 줄의 가중치가 올바르지 않습니다.`);
      return null;
    }

    edges.push({
      from: values[0],
      to: values[1],
      weight,
    });
  }

  return { nodeCount, edges };
}

function getMaxGraphInputEdgeCount(nodeCount) {
  if (graphInputMode.value === 'directed') {
    return nodeCount * (nodeCount - 1);
  }

  return (nodeCount * (nodeCount - 1)) / 2;
}

function createAutoLayoutNodes(nodeCount) {
  const rect = graphRoot.value?.getBoundingClientRect();
  const width = rect?.width || window.innerWidth || 1000;
  const height = rect?.height || window.innerHeight || 700;
  const panelReserve = traversalResult.value ? 130 : 100;
  const centerX = width / 2;
  const centerY = TOOLBAR_HEIGHT + (height - TOOLBAR_HEIGHT - panelReserve) / 2;
  const radius = Math.max(
    MIN_NODE_DISTANCE,
    Math.min(width * 0.34, Math.max(120, (height - TOOLBAR_HEIGHT - panelReserve) * 0.36)),
  );

  if (nodeCount === 1) {
    return [{ id: 1, x: centerX, y: centerY }];
  }

  return Array.from({ length: nodeCount }, (_, index) => {
    const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / nodeCount;

    return {
      id: index + 1,
      x: clamp(centerX + Math.cos(angle) * radius, NODE_RADIUS, width - NODE_RADIUS),
      y: clamp(centerY + Math.sin(angle) * radius, TOOLBAR_HEIGHT + NODE_RADIUS, height - NODE_RADIUS),
    };
  });
}

function handleClick(event) {
  if (isProcessing.value || selectedNode.value !== null) return;

  const { x, y } = getPointerPosition(event);

  addNode(x, y);
  relaxNodePositions(nodes.value.length - 1);

  if (startIdx.value === -1) {
    setStartNode(nodes.value[nodes.value.length - 1].id);
  }
}

function addNode(x, y) {
  const node = { id: getNextNodeId(), x, y };

  nodes.value.push(node);
  nodeOrders.value[node.id] = Number.NaN;
  delete nodeDistances.value[node.id];
  pushHistory({ type: 'node', node });
}

function getNextNodeId() {
  const usedIds = new Set(nodes.value.map(node => node.id));
  let id = 1;

  while (usedIds.has(id)) {
    id += 1;
  }

  return id;
}

function connectNode(index, event) {
  if (isProcessing.value) return;

  if (shouldSuppressNodeClick.value) {
    shouldSuppressNodeClick.value = false;
    return;
  }

  if (event.ctrlKey) {
    setStartNode(nodes.value[index].id);
    cancelCurrentLine();
    return;
  }

  if (selectedNode.value === null) {
    selectedNode.value = index;
    window.addEventListener('mousemove', drawLine);
    return;
  }

  if (selectedNode.value === index) {
    setStartNode(nodes.value[index].id);
    cancelCurrentLine();
    return;
  }

  addConnection(selectedNode.value, index);
  cancelCurrentLine();
}

function startNodeDrag(index, event) {
  if (isProcessing.value || selectedNode.value !== null || event.button !== 0) return;

  const node = nodes.value[index];
  if (!node) return;

  dragState.value = {
    index,
    nodeId: node.id,
    startMouseX: event.clientX,
    startMouseY: event.clientY,
    offsetX: event.clientX - node.x,
    offsetY: event.clientY - node.y,
    didMove: false,
  };

  window.addEventListener('mousemove', dragNode);
  window.addEventListener('mouseup', stopNodeDrag);
}

function dragNode(event) {
  const state = dragState.value;
  if (!state) return;

  const distance = Math.hypot(event.clientX - state.startMouseX, event.clientY - state.startMouseY);
  if (!state.didMove && distance < DRAG_START_DISTANCE) return;

  state.didMove = true;
  shouldSuppressNodeClick.value = true;

  const node = nodes.value[state.index];
  if (!node) return;

  const rect = graphRoot.value.getBoundingClientRect();
  node.x = clamp(event.clientX - state.offsetX, NODE_RADIUS, rect.width - NODE_RADIUS);
  node.y = clamp(event.clientY - state.offsetY, TOOLBAR_HEIGHT + NODE_RADIUS, rect.height - NODE_RADIUS);

  relaxNodePositions(state.index);
  updateAllLines();
}

function stopNodeDrag() {
  if (dragState.value?.didMove) {
    shouldSuppressNodeClick.value = true;
  }

  dragState.value = null;
  window.removeEventListener('mousemove', dragNode);
  window.removeEventListener('mouseup', stopNodeDrag);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function relaxNodePositions(anchorIndex) {
  const rect = graphRoot.value.getBoundingClientRect();

  for (let step = 0; step < RELAXATION_STEPS; step += 1) {
    let moved = false;

    for (let a = 0; a < nodes.value.length; a += 1) {
      for (let b = a + 1; b < nodes.value.length; b += 1) {
        const nodeA = nodes.value[a];
        const nodeB = nodes.value[b];
        const dx = nodeB.x - nodeA.x;
        const dy = nodeB.y - nodeA.y;
        const distance = Math.hypot(dx, dy);

        if (distance >= MIN_NODE_DISTANCE) continue;

        const fallbackAngle = ((nodeA.id + nodeB.id * 137) % 360) * (Math.PI / 180);
        const unitX = distance === 0 ? Math.cos(fallbackAngle) : dx / distance;
        const unitY = distance === 0 ? Math.sin(fallbackAngle) : dy / distance;
        const overlap = MIN_NODE_DISTANCE - distance;
        const anchorA = a === anchorIndex;
        const anchorB = b === anchorIndex;

        if (anchorA && !anchorB) {
          nodeB.x = clamp(nodeB.x + unitX * overlap, NODE_RADIUS, rect.width - NODE_RADIUS);
          nodeB.y = clamp(nodeB.y + unitY * overlap, TOOLBAR_HEIGHT + NODE_RADIUS, rect.height - NODE_RADIUS);
        } else if (anchorB && !anchorA) {
          nodeA.x = clamp(nodeA.x - unitX * overlap, NODE_RADIUS, rect.width - NODE_RADIUS);
          nodeA.y = clamp(nodeA.y - unitY * overlap, TOOLBAR_HEIGHT + NODE_RADIUS, rect.height - NODE_RADIUS);
        } else {
          const push = overlap / 2;
          nodeA.x = clamp(nodeA.x - unitX * push, NODE_RADIUS, rect.width - NODE_RADIUS);
          nodeA.y = clamp(nodeA.y - unitY * push, TOOLBAR_HEIGHT + NODE_RADIUS, rect.height - NODE_RADIUS);
          nodeB.x = clamp(nodeB.x + unitX * push, NODE_RADIUS, rect.width - NODE_RADIUS);
          nodeB.y = clamp(nodeB.y + unitY * push, TOOLBAR_HEIGHT + NODE_RADIUS, rect.height - NODE_RADIUS);
        }

        moved = true;
      }
    }

    if (!moved) break;
  }
}

function updateLinesForNode(nodeId) {
  for (let index = 0; index < graphConnections.value.length; index += 1) {
    const [from, to] = graphConnections.value[index];
    const fromNode = nodes.value.find(node => node.id === from);
    const toNode = nodes.value.find(node => node.id === to);

    if (!fromNode || !toNode || (from !== nodeId && to !== nodeId)) continue;

    lines.value[index] = {
      ...lines.value[index],
      x1: fromNode.x,
      y1: fromNode.y,
      x2: toNode.x,
      y2: toNode.y,
    };
    syncLineHistory(index);
  }
}

function updateAllLines() {
  for (const node of nodes.value) {
    updateLinesForNode(node.id);
  }
}

function addConnection(fromIndex, toIndex) {
  const from = nodes.value[fromIndex].id;
  const to = nodes.value[toIndex].id;
  const minNode = Math.min(from, to);
  const maxNode = Math.max(from, to);
  const isDuplicate = graphConnections.value.some(
    ([existingFrom, existingTo]) => {
      return Math.min(existingFrom, existingTo) === minNode
        && Math.max(existingFrom, existingTo) === maxNode;
    },
  );

  if (isDuplicate) return;

  const fromNode = nodes.value[fromIndex];
  const toNode = nodes.value[toIndex];
  const line = {
    id: nextEdgeId.value,
    x1: fromNode.x,
    y1: fromNode.y,
    x2: toNode.x,
    y2: toNode.y,
  };
  nextEdgeId.value += 1;

  lines.value.push(line);
  inputFields.value.push({
    forward: 1,
    backward: 1,
  });
  graphConnections.value.push([from, to, 1, 1]);
  pushHistory({
    type: 'line',
    id: line.id,
    line,
    input: { forward: 1, backward: 1 },
    connection: [from, to, 1, 1],
  });
}

function pushHistory(action) {
  userDone.value.push(action);
  redoStack.value = [];
}

function syncLineHistory(lineIndex) {
  const lineId = lines.value[lineIndex]?.id;
  if (!lineId) return;

  for (const action of userDone.value) {
    if (action.type !== 'line') continue;

    if (action.id === lineId) {
      action.line = { ...lines.value[lineIndex] };
      action.input = { ...inputFields.value[lineIndex] };
      action.connection = [...graphConnections.value[lineIndex]];
      return;
    }
  }
}

function syncAllLineHistory() {
  for (let index = 0; index < lines.value.length; index += 1) {
    syncLineHistory(index);
  }
}

function commitWeightInput(index, direction, event) {
  updateGraphConnection(index, direction, event.currentTarget.value);
  event.currentTarget.value = getCommittedWeightInput(index, direction);
  event.currentTarget.blur();
}

function updateGraphConnection(index, direction, rawValue) {
  const connection = graphConnections.value[index];
  if (!connection) return;

  const input = inputFields.value[index];
  const targetKey = direction === 'forward' ? 'forward' : 'backward';
  const targetIndex = direction === 'forward' ? 2 : 3;
  const beforeWeight = connection[targetIndex];
  const beforeInputValue = formatWeightInput(beforeWeight);
  const parsedWeight = parseWeight(rawValue);
  const nextWeight = parsedWeight === DISABLED_WEIGHT ? DISABLED_WEIGHT : parsedWeight;
  const nextInputValue = formatWeightInput(nextWeight);

  if (beforeWeight === nextWeight) {
    input[targetKey] = nextInputValue;
    return;
  }

  setWeight(index, direction, nextWeight, nextInputValue);
  syncLineHistory(index);

  pushHistory({
    type: 'weight',
    index,
    direction,
    beforeWeight,
    beforeInputValue,
    afterWeight: nextWeight,
    afterInputValue: nextInputValue,
  });
}

function getCommittedWeightInput(index, direction) {
  const connection = graphConnections.value[index];
  if (!connection) return '';

  const targetIndex = direction === 'forward' ? 2 : 3;
  return formatWeightInput(connection[targetIndex]);
}

function formatWeightInput(weight) {
  return weight === DISABLED_WEIGHT ? '' : String(weight);
}

function setWeight(index, direction, weight, inputValue) {
  const connection = graphConnections.value[index];
  const input = inputFields.value[index];
  if (!connection || !input) return;

  const targetKey = direction === 'forward' ? 'forward' : 'backward';
  const targetIndex = direction === 'forward' ? 2 : 3;

  connection[targetIndex] = weight;
  input[targetKey] = formatWeightInput(inputValue);
}

function resetWeightInput(index, direction) {
  const connection = graphConnections.value[index];
  const input = inputFields.value[index];
  if (!connection || !input) return;

  const targetKey = direction === 'forward' ? 'forward' : 'backward';
  const targetIndex = direction === 'forward' ? 2 : 3;
  const weight = connection[targetIndex];

  input[targetKey] = formatWeightInput(weight);
}

function parseWeight(value) {
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed === '-' || trimmed.toLowerCase() === 'x') {
    return DISABLED_WEIGHT;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DISABLED_WEIGHT;
}

function drawLine(event) {
  if (selectedNode.value === null) return;

  const { x, y } = getPointerPosition(event);
  const node = nodes.value[selectedNode.value];
  currentLine.value = {
    x1: node.x,
    y1: node.y,
    x2: x,
    y2: y,
  };
}

function handleMouseDown(event) {
  if (event.button === 2) {
    event.preventDefault();
    cancelCurrentLine();
  }
}

function deleteNode(index) {
  if (isProcessing.value) return;

  const node = nodes.value[index];
  if (!node) return;

  const action = createDeleteNodeAction(index);
  applyDeleteNodeAction(action);
  pushHistory(action);
}

function deleteEdge(index) {
  if (isProcessing.value) return;

  const line = lines.value[index];
  if (!line) return;

  const action = createDeleteEdgeAction(index);
  applyDeleteEdgeAction(action);
  pushHistory(action);
}

function createDeleteEdgeAction(index) {
  return {
    type: 'delete-edge',
    index,
    line: { ...lines.value[index] },
    input: { ...inputFields.value[index] },
    connection: [...graphConnections.value[index]],
  };
}

function applyDeleteEdgeAction(action) {
  cancelCurrentLine();
  lines.value.splice(action.index, 1);
  inputFields.value.splice(action.index, 1);
  graphConnections.value.splice(action.index, 1);
  clearHoveredWeight();
  syncAllLineHistory();
}

function revertDeleteEdgeAction(action) {
  lines.value.splice(action.index, 0, { ...action.line });
  inputFields.value.splice(action.index, 0, { ...action.input });
  graphConnections.value.splice(action.index, 0, [...action.connection]);
  nextEdgeId.value = Math.max(nextEdgeId.value, action.line.id + 1);
  syncAllLineHistory();
}

function createDeleteNodeAction(index) {
  const nodeNumber = nodes.value[index].id;
  const removedEdges = [];

  graphConnections.value.forEach((connection, edgeIndex) => {
    const [from, to] = connection;
    if (from === nodeNumber || to === nodeNumber) {
      removedEdges.push({
        index: edgeIndex,
        line: { ...lines.value[edgeIndex] },
        input: { ...inputFields.value[edgeIndex] },
        connection: [...connection],
      });
    }
  });

  return {
    type: 'delete-node',
    index,
    node: { ...nodes.value[index] },
    nodeOrder: nodeOrders.value[nodeNumber],
    nodeDistance: nodeDistances.value[nodeNumber],
    startIdxBefore: startIdx.value,
    nodeSelectingBefore: [...nodeSelecting.value],
    nodeSelectedBefore: [...nodeSelected.value],
    removedEdges,
  };
}

function applyDeleteNodeAction(action) {
  const deletedNodeNumber = action.node.id;
  const removedEdgeIndexes = new Set(action.removedEdges.map(edge => edge.index));

  cancelCurrentLine();
  nodes.value.splice(action.index, 1);
  delete nodeOrders.value[deletedNodeNumber];
  delete nodeDistances.value[deletedNodeNumber];

  lines.value = lines.value.filter((_, index) => !removedEdgeIndexes.has(index));
  inputFields.value = inputFields.value.filter((_, index) => !removedEdgeIndexes.has(index));
  graphConnections.value = graphConnections.value
    .filter((_, index) => !removedEdgeIndexes.has(index));

  normalizeStartNodeAfterDelete(action.startIdxBefore, deletedNodeNumber);
  nodeSelected.value = nodeSelected.value
    .filter(node => node !== deletedNodeNumber);
  clearHoveredWeight();
  syncAllLineHistory();
}

function revertDeleteNodeAction(action) {
  nodes.value.splice(action.index, 0, { ...action.node });
  nodeOrders.value[action.node.id] = action.nodeOrder;
  if (action.nodeDistance === undefined) {
    delete nodeDistances.value[action.node.id];
  } else {
    nodeDistances.value[action.node.id] = action.nodeDistance;
  }

  for (const edge of action.removedEdges) {
    lines.value.splice(edge.index, 0, { ...edge.line });
    inputFields.value.splice(edge.index, 0, { ...edge.input });
    graphConnections.value.splice(edge.index, 0, [...edge.connection]);
    nextEdgeId.value = Math.max(nextEdgeId.value, edge.line.id + 1);
  }

  startIdx.value = action.startIdxBefore;
  nodeSelecting.value = [...action.nodeSelectingBefore];
  nodeSelected.value = [...action.nodeSelectedBefore];
  syncAllLineHistory();
}

function normalizeStartNodeAfterDelete(previousStartIdx, deletedNodeNumber) {
  if (nodes.value.length === 0) {
    startIdx.value = -1;
    nodeSelecting.value = [];
    nodeSelected.value = [];
    return;
  }

  if (previousStartIdx === -1) {
    setStartNode(getSmallestNodeId());
    return;
  }

  if (previousStartIdx === deletedNodeNumber) {
    setStartNode(getSmallestNodeId());
    return;
  }

  setStartNode(previousStartIdx);
}

function getSmallestNodeId() {
  return Math.min(...nodes.value.map(node => node.id));
}

function cancelCurrentLine() {
  selectedNode.value = null;
  currentLine.value = null;
  window.removeEventListener('mousemove', drawLine);
}

function getVisibleLine(line) {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const length = Math.hypot(dx, dy);

  if (length === 0) {
    return line;
  }

  const offsetX = (dx / length) * NODE_RADIUS;
  const offsetY = (dy / length) * NODE_RADIUS;

  return {
    x1: line.x1 + offsetX,
    y1: line.y1 + offsetY,
    x2: line.x2 - offsetX,
    y2: line.y2 - offsetY,
  };
}

function getHoverLine(line, direction) {
  const visibleLine = getVisibleLine(line);
  const dx = visibleLine.x2 - visibleLine.x1;
  const dy = visibleLine.y2 - visibleLine.y1;
  const length = Math.hypot(dx, dy);

  if (length === 0) {
    return visibleLine;
  }

  const trim = 14;
  const offsetX = (dx / length) * trim;
  const offsetY = (dy / length) * trim;

  if (direction === 'forward') {
    return {
      ...visibleLine,
      x1: visibleLine.x1 + offsetX,
      y1: visibleLine.y1 + offsetY,
    };
  }

  return {
    ...visibleLine,
    x2: visibleLine.x2 - offsetX,
    y2: visibleLine.y2 - offsetY,
  };
}

function getWeightControlStyle(index, direction) {
  const line = lines.value[index];
  if (!line) return {};

  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const length = Math.hypot(dx, dy) || 1;
  const normalX = -dy / length;
  const normalY = dx / length;
  const t = direction === 'forward' ? 0.62 : 0.38;
  const side = direction === 'forward' ? -1 : 1;
  const offset = 18;

  return {
    left: `${line.x1 + dx * t + normalX * offset * side}px`,
    top: `${line.y1 + dy * t + normalY * offset * side}px`,
  };
}

function getDirectionLabel(index, direction) {
  const connection = graphConnections.value[index];
  if (!connection) return '';

  const [from, to] = connection;
  return direction === 'forward' ? `${from}>${to}` : `${to}>${from}`;
}

function hasForwardDirection(index) {
  return graphConnections.value[index]?.[2] !== DISABLED_WEIGHT;
}

function hasBackwardDirection(index) {
  return graphConnections.value[index]?.[3] !== DISABLED_WEIGHT;
}

function setHoveredWeight(index, direction) {
  hoveredWeight.value = { index, direction };
}

function clearHoveredWeight() {
  hoveredWeight.value = null;
}

function isHoveredDirection(index, direction) {
  return hoveredWeight.value?.index === index && hoveredWeight.value?.direction === direction;
}

function cancelUserDone() {
  if (isProcessing.value) return;

  if (!undoLastAction()) {
    alert('처음 상태입니다.');
  }
}

function cancelAllUserDone() {
  if (isProcessing.value) return;

  let didUndo = false;
  while (undoLastAction()) {
    didUndo = true;
  }

  if (!didUndo) {
    return;
  }
}

function redoUserDone() {
  if (isProcessing.value) return;

  if (!redoLastAction()) {
    alert('다시 실행할 작업이 없습니다.');
  }
}

function redoAllUserDone() {
  if (isProcessing.value) return;

  while (redoLastAction()) {
    // Keep replaying until the redo stack is empty.
  }
}

function undoLastAction() {
  const action = userDone.value.pop();
  if (!action) return false;

  revertAction(action);
  redoStack.value.push(action);
  cancelCurrentLine();

  return true;
}

function redoLastAction() {
  const action = redoStack.value.pop();
  if (!action) return false;

  applyAction(action);
  userDone.value.push(action);
  cancelCurrentLine();

  return true;
}

function revertAction(action) {
  if (action.type === 'node') {
    const node = nodes.value.pop();
    if (node) {
      delete nodeOrders.value[node.id];
      delete nodeDistances.value[node.id];
    }
    normalizeStartNode();
    return;
  }

  if (action.type === 'weight') {
    setWeight(action.index, action.direction, action.beforeWeight, action.beforeInputValue);
    syncLineHistory(action.index);
    return;
  }

  if (action.type === 'delete-node') {
    revertDeleteNodeAction(action);
    return;
  }

  if (action.type === 'delete-edge') {
    revertDeleteEdgeAction(action);
    return;
  }

  if (action.type === 'replace-graph') {
    restoreGraphSnapshot(action.before);
    return;
  }

  lines.value.pop();
  inputFields.value.pop();
  graphConnections.value.pop();
}

function applyAction(action) {
  if (action.type === 'node') {
    nodes.value.push({ ...action.node });
    nodeOrders.value[action.node.id] = Number.NaN;
    delete nodeDistances.value[action.node.id];

    if (startIdx.value === -1) {
      setStartNode(action.node.id);
    }

    return;
  }

  if (action.type === 'weight') {
    setWeight(action.index, action.direction, action.afterWeight, action.afterInputValue);
    syncLineHistory(action.index);
    return;
  }

  if (action.type === 'delete-node') {
    applyDeleteNodeAction(action);
    return;
  }

  if (action.type === 'delete-edge') {
    applyDeleteEdgeAction(action);
    return;
  }

  if (action.type === 'replace-graph') {
    restoreGraphSnapshot(action.after);
    return;
  }

  lines.value.push({ ...action.line });
  inputFields.value.push({ ...action.input });
  graphConnections.value.push([...action.connection]);
  nextEdgeId.value = Math.max(nextEdgeId.value, action.line.id + 1);
}

async function clickBFSButton(groupByLevel) {
  if (!canRunAlgorithm()) return;

  await runAlgorithm(async () => {
    const { levels, orderIdx } = bfs(nodes.value, graphConnections.value, startIdx.value);
    const metrics = buildBfsLevelMetrics(levels);
    nodeDistances.value = metrics;
    setTraversalResult(groupByLevel ? 'BFS Level' : 'BFS', groupByLevel ? levels : orderIdx, groupByLevel, metrics);
    await colorNodes(groupByLevel ? levels : orderIdx, groupByLevel);
  });
}

async function clickDFSButton() {
  if (!canRunAlgorithm()) return;

  await runAlgorithm(async () => {
    const order = dfs(nodes.value, graphConnections.value, startIdx.value);
    const metrics = buildOrderMetrics(order);
    nodeDistances.value = metrics;
    setTraversalResult('DFS', order, false, metrics);
    await colorNodes(order);
  });
}

async function clickDijkstraButton() {
  if (!canRunAlgorithm()) return;

  await runAlgorithm(async () => {
    const { order, distances } = dijkstra(nodes.value, graphConnections.value, startIdx.value);
    nodeDistances.value = normalizeDistances(distances);
    setTraversalResult('Dijkstra', order, false, nodeDistances.value);
    await colorNodes(order);
  });
}

function setTraversalResult(label, sequence, isGrouped = false, distances = null) {
  traversalResult.value = {
    label,
    isGrouped,
    sequence: isGrouped ? sequence.map(group => [...group]) : [...sequence],
    distances: distances ? { ...distances } : null,
  };
  activeResultStep.value = -1;
}

function normalizeDistances(distances) {
  return Object.fromEntries(Object.entries(distances).map(([nodeId, distance]) => [
    nodeId,
    Number.isFinite(distance) ? distance : '∞',
  ]));
}

function buildBfsLevelMetrics(levels) {
  const metrics = {};

  for (let level = 0; level < levels.length; level += 1) {
    for (const nodeId of levels[level]) {
      metrics[nodeId] = level;
    }
  }

  return metrics;
}

function buildOrderMetrics(order) {
  return Object.fromEntries(order.map((nodeId, index) => [nodeId, index]));
}

function canRunAlgorithm() {
  return hasNodes.value && startIdx.value !== -1 && !isProcessing.value;
}

async function runAlgorithm(callback) {
  isProcessing.value = true;
  resetNodeOrders();
  nodeDistances.value = {};
  nodeSelected.value = [];
  cancelCurrentLine();

  try {
    await callback();
  } finally {
    isProcessing.value = false;
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitAnimationDelay() {
  const startedAt = window.performance.now();

  while (window.performance.now() - startedAt < getAnimationDelay()) {
    await delay(25);
  }
}

function getAnimationDelay() {
  const delayValue = Number(animationDelay.value);
  return Number.isFinite(delayValue) ? delayValue : 0;
}

async function colorNodes(sequence, isGrouped = false) {
  if (isGrouped) {
    for (let idx = 0; idx < sequence.length; idx += 1) {
      const currentLevel = sequence[idx];
      activeResultStep.value = idx;
      nodeSelecting.value = [...currentLevel];

      for (const node of currentLevel) {
        markNode(node, idx + 1);
      }

      await waitAnimationDelay();
    }
  } else {
    for (let idx = 0; idx < sequence.length; idx += 1) {
      const node = sequence[idx];
      activeResultStep.value = idx;
      nodeSelecting.value = [node];
      markNode(node, idx + 1);
      await waitAnimationDelay();
    }
  }

  nodeSelecting.value = [];
  activeResultStep.value = -1;
  await delay(RESET_DELAY);
  nodeSelecting.value = startIdx.value === -1 ? [] : [startIdx.value];
  nodeSelected.value = [];
}

function markNode(node, order) {
  if (!nodeSelected.value.includes(node)) {
    nodeSelected.value.push(node);
  }

  nodeOrders.value[node] = order;
}

function resetNodeOrders() {
  for (const node of nodes.value) {
    nodeOrders.value[node.id] = Number.NaN;
  }
}

function setStartNode(nodeNumber) {
  startIdx.value = nodeNumber;
  nodeSelecting.value = [nodeNumber];
}

function normalizeStartNode() {
  if (nodes.value.length === 0) {
    startIdx.value = -1;
    nodeSelecting.value = [];
    nodeSelected.value = [];
    return;
  }

  if (!nodes.value.some(node => node.id === startIdx.value)) {
    setStartNode(getSmallestNodeId());
  }
}

watch(
  () => createGraphSnapshot(),
  (snapshot) => {
    if (isRestoringSavedGraph.value) return;
    scheduleAutoSave(snapshot);
  },
  { deep: true },
);

onBeforeUnmount(() => {
  window.clearTimeout(autoSaveTimer);
  window.removeEventListener('mousemove', drawLine);
  window.removeEventListener('mousemove', dragNode);
  window.removeEventListener('mouseup', stopNodeDrag);
});
</script>

<template>
  <div ref="graphRoot" class="graph-editor" @contextmenu.prevent="handleMouseDown">
    <div v-if="isProcessing" class="overlay"></div>

    <div class="graph-toolbar">
      <h1>Graph Editor</h1>
      <button class="button" type="button" @click="clickBFSButton(false)">bfs1</button>
      <button class="button" type="button" @click="clickBFSButton(true)">bfs2</button>
      <button class="button" type="button" @click="clickDFSButton">dfs</button>
      <button class="button" type="button" @click="clickDijkstraButton">dijkstra</button>
      <label class="speed-control">
        <span>Speed</span>
        <input
          v-model.number="animationDelay"
          type="range"
          min="0"
          max="1500"
          step="20"
          aria-label="animation delay"
        />
        <output>{{ animationDelay }}ms</output>
      </label>
    </div>

    <button class="help-open-button" type="button" @click="isHelpOpen = true">Help</button>

    <div
      v-if="isHelpOpen"
      class="help-backdrop"
      role="presentation"
      @click.self="isHelpOpen = false"
    >
      <section class="help-modal" role="dialog" aria-modal="true" aria-label="graph editor help">
        <header class="help-modal-header">
          <div>
            <strong>Graph Editor Help</strong>
            <span>그래프 편집 조작 설명서</span>
          </div>
          <button type="button" aria-label="close help" @click="isHelpOpen = false">닫기</button>
        </header>

        <div class="help-content">
          <section class="help-section">
            <h2>기본 조작</h2>
            <div class="help-list">
              <article class="help-item">
                <span class="help-action">빈 화면 좌클릭</span>
                <p>새 노드를 만듭니다.</p>
              </article>
              <article class="help-item">
                <span class="help-action">노드 드래그</span>
                <p>노드를 이동합니다. 가까운 노드는 자연스럽게 밀려납니다. 이동은 undo/redo에 저장되지 않습니다.</p>
              </article>
              <article class="help-item">
                <span class="help-action">우클릭</span>
                <p>현재 간선 연결 선택을 취소합니다.</p>
              </article>
            </div>
          </section>

          <section class="help-section">
            <h2>루트와 간선</h2>
            <div class="help-list">
              <article class="help-item important">
                <span class="help-action">Ctrl + 노드 좌클릭</span>
                <p>알고리즘 시작 루트 노드를 해당 노드로 변경합니다.</p>
              </article>
              <article class="help-item">
                <span class="help-action">노드 좌클릭 -> 다른 노드 좌클릭</span>
                <p>두 노드를 잇는 간선을 만듭니다. 처음 찍은 노드는 선택 색상으로 표시됩니다.</p>
              </article>
              <article class="help-item">
                <span class="help-action">선택한 노드 다시 좌클릭</span>
                <p>간선 연결을 취소하고, 그 노드를 루트로 지정합니다.</p>
              </article>
              <article class="help-item">
                <span class="help-action">노드 우클릭</span>
                <p>노드를 삭제합니다. 연결된 간선도 함께 삭제되고 undo/redo에 저장됩니다.</p>
              </article>
              <article class="help-item">
                <span class="help-action">간선 우클릭</span>
                <p>해당 간선을 삭제합니다. 이 작업도 undo/redo에 저장됩니다.</p>
              </article>
            </div>
          </section>

          <section class="help-section">
            <h2>가중치와 방향</h2>
            <div class="help-list">
              <article class="help-item important">
                <span class="help-action">가중치 입력 후 Enter</span>
                <p>해당 방향의 가중치를 적용합니다. Enter를 누르기 전에는 값이 확정되지 않습니다.</p>
              </article>
              <article class="help-item">
                <span class="help-action">가중치 비우고 Enter</span>
                <p>해당 방향을 비활성화해서 단방향처럼 만듭니다.</p>
              </article>
              <article class="help-item">
                <span class="help-action">가중치 칸 hover</span>
                <p>그 칸이 어떤 방향의 화살표인지 빨간 강조선으로 표시합니다.</p>
              </article>
            </div>
          </section>

          <section class="help-section wide">
            <h2>입력, 실행, 저장</h2>
            <div class="help-list compact">
              <article class="help-item">
                <span class="help-action">Input Graph</span>
                <p><code>n m</code> 다음 줄부터 <code>a b w</code> 형식으로 입력합니다. <code>w</code>를 생략하면 1로 처리됩니다.</p>
              </article>
              <article class="help-item">
                <span class="help-action">양방향 / 단방향</span>
                <p>입력 그래프를 만들 때 간선을 양방향 또는 단방향으로 생성합니다.</p>
              </article>
              <article class="help-item">
                <span class="help-action">bfs1, bfs2, dfs, dijkstra</span>
                <p>현재 루트에서 알고리즘을 실행합니다. 결과 순서와 <code>d=</code> 값은 하단과 노드에 표시됩니다.</p>
              </article>
              <article class="help-item">
                <span class="help-action">Speed 바</span>
                <p>알고리즘 애니메이션 속도를 실시간으로 조절합니다.</p>
              </article>
              <article class="help-item">
                <span class="help-action">Graph Slots</span>
                <p>현재 그래프가 자동 저장됩니다. 슬롯을 누르면 전환되고, 슬롯별 undo/redo 기록도 함께 복원됩니다.</p>
              </article>
            </div>
          </section>
        </div>
      </section>
    </div>

    <div
      v-if="false && isHelpOpen"
      class="help-backdrop"
      role="presentation"
      @click.self="isHelpOpen = false"
    >
      <section class="help-modal" role="dialog" aria-modal="true" aria-label="graph editor help">
        <header class="help-modal-header">
          <div>
            <strong>Graph Editor Help</strong>
            <span>그래프 편집 조작 설명서</span>
          </div>
          <button type="button" aria-label="close help" @click="isHelpOpen = false">x</button>
        </header>

        <div class="help-content">
          <section>
            <h2>기본 조작</h2>
            <dl>
              <div>
                <dt>빈 화면 좌클릭</dt>
                <dd>새 노드를 만듭니다.</dd>
              </div>
              <div>
                <dt>노드 드래그</dt>
                <dd>노드를 이동합니다. 가까운 노드는 자연스럽게 밀려납니다. 이 이동은 undo/redo에 저장되지 않습니다.</dd>
              </div>
              <div>
                <dt>우클릭</dt>
                <dd>현재 간선 연결 선택을 취소합니다.</dd>
              </div>
            </dl>
          </section>

          <section>
            <h2>루트와 간선</h2>
            <dl>
              <div>
                <dt>Ctrl + 노드 좌클릭</dt>
                <dd>알고리즘 시작 루트 노드를 해당 노드로 변경합니다.</dd>
              </div>
              <div>
                <dt>노드 좌클릭 후 다른 노드 좌클릭</dt>
                <dd>두 노드를 잇는 간선을 만듭니다. 처음 찍은 노드는 선택 색상으로 표시됩니다.</dd>
              </div>
              <div>
                <dt>선택한 노드를 다시 좌클릭</dt>
                <dd>간선 연결을 취소하고, 그 노드를 루트로 지정합니다.</dd>
              </div>
              <div>
                <dt>노드 우클릭</dt>
                <dd>노드를 삭제합니다. 연결된 간선도 함께 삭제되고 undo/redo에 저장됩니다.</dd>
              </div>
              <div>
                <dt>간선 우클릭</dt>
                <dd>해당 간선을 삭제합니다. 이 작업도 undo/redo에 저장됩니다.</dd>
              </div>
            </dl>
          </section>

          <section>
            <h2>가중치와 방향</h2>
            <dl>
              <div>
                <dt>가중치 칸 입력 후 Enter</dt>
                <dd>해당 방향의 가중치를 적용합니다. Enter를 누르기 전에는 내부 값이 확정되지 않습니다.</dd>
              </div>
              <div>
                <dt>가중치 칸 비우고 Enter</dt>
                <dd>해당 방향을 비활성화해서 단방향처럼 만듭니다.</dd>
              </div>
              <div>
                <dt>가중치 칸에 마우스 올리기</dt>
                <dd>그 칸이 어떤 방향의 화살표인지 빨간색 강조선으로 표시합니다.</dd>
              </div>
            </dl>
          </section>

          <section>
            <h2>입력, 실행, 저장</h2>
            <dl>
              <div>
                <dt>Input Graph</dt>
                <dd><code>n m</code> 다음 줄부터 <code>a b w</code> 형식으로 입력합니다. <code>w</code>를 생략하면 1로 처리됩니다.</dd>
              </div>
              <div>
                <dt>양방향 / 단방향 버튼</dt>
                <dd>입력 그래프를 만들 때 간선을 양방향 또는 단방향으로 생성합니다.</dd>
              </div>
              <div>
                <dt>bfs1, bfs2, dfs, dijkstra</dt>
                <dd>현재 루트에서 알고리즘을 실행합니다. 결과 순서와 <code>d=</code> 값은 하단과 노드에 표시됩니다.</dd>
              </div>
              <div>
                <dt>Speed 바</dt>
                <dd>알고리즘 애니메이션 속도를 실시간으로 조절합니다.</dd>
              </div>
              <div>
                <dt>오른쪽 Graph Slots</dt>
                <dd>현재 그래프가 자동 저장됩니다. 슬롯을 누르면 그 그래프로 전환되고, 슬롯별 undo/redo 기록도 함께 복원됩니다.</dd>
              </div>
            </dl>
          </section>
        </div>
      </section>
    </div>

    <div class="history-buttons">
      <button class="history-button" type="button" aria-label="undo all" @click.stop="cancelAllUserDone">
        <font-awesome-icon :icon="['fas', 'backward-fast']" />
      </button>
      <button class="history-button" type="button" aria-label="undo" @click.stop="cancelUserDone">
        <font-awesome-icon :icon="['fas', 'backward-step']" />
      </button>
      <button class="history-button" type="button" aria-label="redo" @click.stop="redoUserDone">
        <font-awesome-icon :icon="['fas', 'forward-step']" />
      </button>
      <button class="history-button" type="button" aria-label="redo all" @click.stop="redoAllUserDone">
        <font-awesome-icon :icon="['fas', 'forward-fast']" />
      </button>
    </div>

    <div class="status-strip">
      <span class="status-dot"></span>
      <span>{{ statusText }}</span>
    </div>

    <section class="graph-input-panel" aria-label="graph text input">
      <div class="graph-input-header">
        <strong>Input Graph</strong>
        <div class="direction-toggle" aria-label="edge direction mode">
          <button
            type="button"
            :class="{ active: graphInputMode === 'undirected' }"
            @click="graphInputMode = 'undirected'"
          >
            양방향
          </button>
          <button
            type="button"
            :class="{ active: graphInputMode === 'directed' }"
            @click="graphInputMode = 'directed'"
          >
            단방향
          </button>
        </div>
      </div>
      <textarea
        v-model="graphInput"
        spellcheck="false"
        aria-label="graph input as n m then edges"
      ></textarea>
      <button class="graph-input-apply" type="button" @click="applyGraphInput">
        Draw
      </button>
    </section>

    <section class="saved-graphs-panel" aria-label="saved graphs">
      <div class="saved-graphs-header">
        <strong>Graph Slots</strong>
        <button type="button" aria-label="create graph slot" @click="createGraphSlot">+</button>
      </div>
      <div class="saved-grid">
        <div v-if="savedGraphs.length === 0" class="saved-empty">
          Change the graph to create a slot
        </div>
        <div
          v-for="(graph, index) in savedGraphs"
          :key="graph.id"
          class="saved-card-wrap"
        >
          <button
            class="saved-card"
            :class="{ active: graph.id === activeGraphId }"
            type="button"
            @click="switchSavedGraph(graph)"
          >
            <svg class="saved-preview" viewBox="0 0 120 88" aria-hidden="true">
              <line
                v-for="(edge, edgeIndex) in getPreviewEdges(graph.snapshot)"
                :key="edgeIndex"
                :x1="edge.from.x"
                :y1="edge.from.y"
                :x2="edge.to.x"
                :y2="edge.to.y"
              />
              <g
                v-for="node in getPreviewNodes(graph.snapshot)"
                :key="node.id"
              >
                <circle :cx="node.x" :cy="node.y" r="6" />
                <text :x="node.x" :y="node.y + 2">{{ node.id }}</text>
              </g>
            </svg>
            <span>{{ getSavedGraphTitle(graph, index) }}</span>
            <small>{{ getSavedGraphMeta(graph) }}</small>
          </button>
          <button
            class="saved-card-delete"
            type="button"
            aria-label="delete saved graph"
            @click.stop="deleteSavedGraph(graph.id)"
          >
            x
          </button>
        </div>
      </div>
    </section>

    <svg class="graph-canvas" @click="handleClick">
      <defs>
        <marker
          id="arrow-forward"
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" class="arrow-head"></path>
        </marker>
        <marker
          id="arrow-backward"
          markerWidth="10"
          markerHeight="10"
          refX="2"
          refY="5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 10 0 L 0 5 L 10 10 z" class="arrow-head"></path>
        </marker>
        <marker
          id="arrow-forward-active"
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" class="arrow-head-active"></path>
        </marker>
        <marker
          id="arrow-backward-active"
          markerWidth="10"
          markerHeight="10"
          refX="2"
          refY="5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 10 0 L 0 5 L 10 10 z" class="arrow-head-active"></path>
        </marker>
      </defs>

      <line
        v-for="(line, index) in lines"
        :key="`line-${index}`"
        :x1="getVisibleLine(line).x1"
        :y1="getVisibleLine(line).y1 - TOOLBAR_HEIGHT"
        :x2="getVisibleLine(line).x2"
        :y2="getVisibleLine(line).y2 - TOOLBAR_HEIGHT"
        class="edge-line"
        :marker-end="hasForwardDirection(index) ? 'url(#arrow-forward)' : null"
        :marker-start="hasBackwardDirection(index) ? 'url(#arrow-backward)' : null"
      />
      <line
        v-for="(line, index) in lines"
        :key="`line-hit-${line.id}`"
        :x1="getVisibleLine(line).x1"
        :y1="getVisibleLine(line).y1 - TOOLBAR_HEIGHT"
        :x2="getVisibleLine(line).x2"
        :y2="getVisibleLine(line).y2 - TOOLBAR_HEIGHT"
        class="edge-hit-line"
        @click.stop
        @contextmenu.stop.prevent="deleteEdge(index)"
      />
      <line
        v-for="(line, index) in lines"
        v-show="isHoveredDirection(index, 'forward') && hasForwardDirection(index)"
        :key="`line-forward-border-${index}`"
        :x1="getHoverLine(line, 'forward').x1"
        :y1="getHoverLine(line, 'forward').y1 - TOOLBAR_HEIGHT"
        :x2="getHoverLine(line, 'forward').x2"
        :y2="getHoverLine(line, 'forward').y2 - TOOLBAR_HEIGHT"
        class="edge-line-hover-border"
      />
      <line
        v-for="(line, index) in lines"
        v-show="isHoveredDirection(index, 'forward') && hasForwardDirection(index)"
        :key="`line-forward-active-${index}`"
        :x1="getHoverLine(line, 'forward').x1"
        :y1="getHoverLine(line, 'forward').y1 - TOOLBAR_HEIGHT"
        :x2="getHoverLine(line, 'forward').x2"
        :y2="getHoverLine(line, 'forward').y2 - TOOLBAR_HEIGHT"
        class="edge-line-outline"
        marker-end="url(#arrow-forward-active)"
      />
      <line
        v-for="(line, index) in lines"
        v-show="isHoveredDirection(index, 'backward') && hasBackwardDirection(index)"
        :key="`line-backward-border-${index}`"
        :x1="getHoverLine(line, 'backward').x1"
        :y1="getHoverLine(line, 'backward').y1 - TOOLBAR_HEIGHT"
        :x2="getHoverLine(line, 'backward').x2"
        :y2="getHoverLine(line, 'backward').y2 - TOOLBAR_HEIGHT"
        class="edge-line-hover-border"
      />
      <line
        v-for="(line, index) in lines"
        v-show="isHoveredDirection(index, 'backward') && hasBackwardDirection(index)"
        :key="`line-backward-active-${index}`"
        :x1="getHoverLine(line, 'backward').x1"
        :y1="getHoverLine(line, 'backward').y1 - TOOLBAR_HEIGHT"
        :x2="getHoverLine(line, 'backward').x2"
        :y2="getHoverLine(line, 'backward').y2 - TOOLBAR_HEIGHT"
        class="edge-line-outline"
        marker-start="url(#arrow-backward-active)"
      />
      <line
        v-if="currentLine"
        :x1="getVisibleLine(currentLine).x1"
        :y1="getVisibleLine(currentLine).y1 - TOOLBAR_HEIGHT"
        :x2="getVisibleLine(currentLine).x2"
        :y2="getVisibleLine(currentLine).y2 - TOOLBAR_HEIGHT"
        class="edge-line edge-line-preview"
      />
    </svg>

    <div
      v-for="(input, index) in inputFields"
      :key="`weight-${index}`"
      class="edge-weight-group"
    >
      <label
        class="edge-weight edge-weight-forward"
        :class="{
          'edge-weight-off': !hasForwardDirection(index),
          'edge-weight-hovered': isHoveredDirection(index, 'forward'),
        }"
        :style="getWeightControlStyle(index, 'forward')"
        @mouseenter="setHoveredWeight(index, 'forward')"
        @mouseleave="clearHoveredWeight"
      >
        <span>{{ getDirectionLabel(index, 'forward') }}</span>
        <input
          v-model.trim="input.forward"
          type="text"
          inputmode="decimal"
          aria-label="forward edge weight"
          title="비우면 이 방향은 끊깁니다"
          @keydown.enter.prevent="commitWeightInput(index, 'forward', $event)"
          @blur="resetWeightInput(index, 'forward')"
          @click.stop
        />
      </label>

      <label
        class="edge-weight edge-weight-backward"
        :class="{
          'edge-weight-off': !hasBackwardDirection(index),
          'edge-weight-hovered': isHoveredDirection(index, 'backward'),
        }"
        :style="getWeightControlStyle(index, 'backward')"
        @mouseenter="setHoveredWeight(index, 'backward')"
        @mouseleave="clearHoveredWeight"
      >
        <span>{{ getDirectionLabel(index, 'backward') }}</span>
        <input
          v-model.trim="input.backward"
          type="text"
          inputmode="decimal"
          aria-label="backward edge weight"
          title="비우면 이 방향은 끊깁니다"
          @keydown.enter.prevent="commitWeightInput(index, 'backward', $event)"
          @blur="resetWeightInput(index, 'backward')"
          @click.stop
        />
      </label>
    </div>

    <div
      v-for="(node, index) in nodes"
      :key="`node-${node.id}`"
      class="node"
      :class="{
        'node-selecting': nodeSelecting.includes(node.id),
        'node-selected': nodeSelected.includes(node.id),
        'node-pending': selectedNode === index,
        'node-dragging': dragNodeId === node.id,
        'node-start': startIdx === node.id && !nodeSelecting.includes(node.id),
      }"
      :style="{
        left: `${node.x}px`,
        top: `${node.y}px`,
        width: `${NODE_RADIUS * 2}px`,
        height: `${NODE_RADIUS * 2}px`,
      }"
      @mousedown.left.stop="startNodeDrag(index, $event)"
      @click.stop="connectNode(index, $event)"
      @contextmenu.stop.prevent="deleteNode(index)"
    >
      <div class="node-index">{{ node.id }}</div>
      <div
        v-if="!Number.isNaN(nodeOrders[node.id]) || nodeDistances[node.id] !== undefined"
        class="node-metrics"
      >
        <span v-if="!Number.isNaN(nodeOrders[node.id])" class="node-order">
          #{{ nodeOrders[node.id] }}
        </span>
        <span v-if="nodeDistances[node.id] !== undefined" class="node-distance">
          d={{ nodeDistances[node.id] }}
        </span>
      </div>
    </div>

    <section v-if="traversalResult" class="traversal-panel" aria-label="algorithm traversal result">
      <div class="traversal-header">
        <strong>{{ traversalResult.label }}</strong>
        <span>start {{ startIdx }}</span>
      </div>

      <div v-if="traversalResult.isGrouped" class="traversal-levels">
        <div
          v-for="(group, groupIndex) in traversalResult.sequence"
          :key="`level-${groupIndex}`"
          class="traversal-level"
          :class="{ 'traversal-active': activeResultStep === groupIndex }"
        >
          <span class="traversal-step-label">L{{ groupIndex }}</span>
          <div class="traversal-group">
            <span
              v-for="nodeId in group"
              :key="`level-${groupIndex}-node-${nodeId}`"
              class="traversal-node"
            >
              {{ nodeId }}
            </span>
          </div>
        </div>
      </div>

      <div v-else class="traversal-order">
        <div
          v-for="(nodeId, orderIndex) in traversalResult.sequence"
          :key="`order-${orderIndex}-${nodeId}`"
          class="traversal-order-item"
          :class="{ 'traversal-active': activeResultStep === orderIndex }"
        >
          <span class="traversal-step-label">{{ orderIndex + 1 }}</span>
          <span class="traversal-node">{{ nodeId }}</span>
          <span v-if="traversalResult.distances" class="traversal-distance">
            d={{ traversalResult.distances[nodeId] }}
          </span>
        </div>
      </div>

      <div v-if="traversalResult.distances" class="distance-summary">
        <span
          v-for="node in nodes"
          :key="`distance-${node.id}`"
          class="distance-chip"
          :class="{ unreachable: traversalResult.distances[node.id] === '∞' }"
        >
          {{ node.id }}: {{ traversalResult.distances[node.id] }}
        </span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.graph-editor {
  --saved-panel-width: 168px;
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
  background: rgb(44, 44, 44);
}

.graph-toolbar {
  width: 100%;
  height: 100px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.09);
  background: #24272d;
  color: white;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
  overflow-x: auto;
}

.graph-toolbar h1 {
  margin: 0 20px 0 0;
  color: white;
  font-size: 24px;
  font-weight: 600;
  line-height: 1;
}

.overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.2);
  z-index: 999;
  pointer-events: all;
}

.button {
  width: 128px;
  height: 48px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background-color: #30343b;
  color: #e5e7eb;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
}

.button:hover,
.history-button:hover {
  border-color: rgba(96, 165, 250, 0.55);
  background-color: #394150;
}

.help-open-button {
  z-index: 120;
  position: fixed;
  right: calc(var(--saved-panel-width) + 18px);
  bottom: 18px;
  width: 78px;
  height: 42px;
  border: 1px solid rgba(134, 239, 172, 0.34);
  border-radius: 8px;
  background: #1f5f4b;
  color: #dcfce7;
  font-size: 14px;
  font-weight: 900;
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.26);
}

.help-open-button:hover {
  background: #24745a;
}

.speed-control {
  flex: 0 0 260px;
  height: 48px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.055);
  color: #d1d5db;
  padding: 0 12px;
}

.speed-control span,
.speed-control output {
  font-size: 12px;
  font-weight: 800;
}

.speed-control output {
  min-width: 54px;
  color: #93c5fd;
  text-align: right;
}

.speed-control input {
  width: 100%;
  accent-color: #60a5fa;
}

.help-backdrop {
  z-index: 1000;
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(3, 7, 18, 0.74);
  padding: 20px;
}

.help-modal {
  display: flex;
  flex-direction: column;
  width: min(1100px, calc(100vw - 40px));
  max-height: calc(100vh - 40px);
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 12px;
  background: #111827;
  color: #e5e7eb;
  box-shadow: 0 26px 80px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.help-modal-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
  padding: 18px 22px;
}

.help-modal-header div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.help-modal-header strong {
  font-size: 24px;
  font-weight: 900;
  letter-spacing: 0;
}

.help-modal-header span {
  color: #9ca3af;
  font-size: 13px;
  font-weight: 700;
}

.help-modal-header button {
  min-width: 58px;
  height: 34px;
  border: 0;
  border-radius: 7px;
  background: rgba(239, 68, 68, 0.16);
  color: #fecaca;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
}

.help-content {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-content: start;
  gap: 12px;
  overflow-y: auto;
  padding: 16px;
}

.help-section {
  min-width: 0;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.052);
  padding: 14px;
}

.help-section.wide {
  grid-column: 1 / -1;
}

.help-content h2 {
  margin: 0 0 12px;
  color: #bfdbfe;
  font-size: 16px;
  font-weight: 900;
  letter-spacing: 0;
}

.help-list {
  display: grid;
  gap: 8px;
}

.help-list.compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.help-item {
  min-width: 0;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.64);
  padding: 10px;
}

.help-item.important {
  border-color: rgba(96, 165, 250, 0.38);
  background: rgba(30, 64, 175, 0.18);
}

.help-action {
  display: inline-flex;
  max-width: 100%;
  border-radius: 6px;
  background: rgba(96, 165, 250, 0.16);
  color: #dbeafe;
  padding: 4px 7px;
  font-size: 13px;
  font-weight: 900;
  line-height: 1.25;
  white-space: normal;
  overflow-wrap: anywhere;
}

.help-item p {
  margin: 8px 0 0;
  color: #cbd5e1;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.55;
  letter-spacing: 0;
  word-break: keep-all;
  overflow-wrap: anywhere;
}

.help-content code {
  border-radius: 4px;
  background: rgba(15, 23, 42, 0.82);
  color: #bfdbfe;
  padding: 1px 5px;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  white-space: normal;
}

@media (max-width: 980px) {
  .help-content {
    grid-template-columns: 1fr;
  }

  .help-list.compact {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .help-backdrop {
    padding: 10px;
  }

  .help-modal {
    width: calc(100vw - 20px);
    max-height: calc(100vh - 20px);
  }

  .help-modal-header {
    padding: 14px;
  }

  .help-modal-header strong {
    font-size: 20px;
  }

  .help-content {
    padding: 10px;
  }
}

.history-buttons {
  z-index: 99;
  position: absolute;
  top: 110px;
  right: calc(var(--saved-panel-width) + 12px);
  display: flex;
  gap: 8px;
}

.history-button {
  width: 40px;
  height: 30px;
  border: 0;
  border-radius: 6px;
  background-color: rgba(255, 255, 255, 0.06);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 25px;
}

.status-strip {
  z-index: 90;
  position: absolute;
  top: 110px;
  left: 20px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  background: rgba(20, 22, 26, 0.84);
  color: #d1d5db;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 700;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #60a5fa;
  box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.16);
}

.graph-input-panel {
  z-index: 90;
  position: absolute;
  top: 150px;
  left: 20px;
  width: 260px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  background: rgba(20, 22, 26, 0.9);
  color: white;
  padding: 10px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
}

.graph-input-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.graph-input-header strong {
  font-size: 13px;
  font-weight: 800;
}

.direction-toggle {
  display: inline-flex;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  overflow: hidden;
}

.direction-toggle button {
  height: 26px;
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

.direction-toggle button.active {
  background: #60a5fa;
  color: #07111f;
}

.graph-input-panel textarea {
  width: 100%;
  height: 112px;
  resize: vertical;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 7px;
  background: rgba(3, 7, 18, 0.58);
  color: #e5e7eb;
  padding: 8px;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.35;
  outline: 0;
}

.graph-input-panel textarea:focus {
  border-color: rgba(96, 165, 250, 0.75);
}

.graph-input-apply {
  width: 100%;
  height: 32px;
  margin-top: 8px;
  border: 0;
  border-radius: 7px;
  background: #2563eb;
  color: white;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.graph-input-apply:hover {
  background: #1d4ed8;
}

.saved-graphs-panel {
  z-index: 90;
  position: absolute;
  top: 100px;
  right: 0;
  bottom: 0;
  width: var(--saved-panel-width);
  border-left: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(15, 18, 24, 0.94);
  color: white;
  padding: 12px;
  box-shadow: -12px 0 30px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

.saved-graphs-header {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
  margin-bottom: 12px;
}

.saved-graphs-header strong {
  font-size: 13px;
  font-weight: 800;
}

.saved-graphs-header button,
.saved-card-delete {
  border: 0;
  border-radius: 7px;
  background: #374151;
  color: white;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
}

.saved-graphs-header button {
  width: 32px;
  height: 32px;
  background: #2563eb;
}

.saved-grid {
  display: grid;
  grid-template-columns: 1fr;
  align-content: start;
  gap: 10px;
  height: calc(100% - 44px);
  overflow-y: auto;
  padding-right: 2px;
}

.saved-empty {
  grid-column: 1 / -1;
  border: 1px dashed rgba(148, 163, 184, 0.28);
  border-radius: 7px;
  color: #94a3b8;
  padding: 18px 12px;
  text-align: center;
  font-size: 12px;
  font-weight: 700;
}

.saved-card-wrap {
  position: relative;
  min-width: 0;
}

.saved-card {
  width: 100%;
  aspect-ratio: 1;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.055);
  color: white;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 8px;
  text-align: left;
  overflow: hidden;
}

.saved-card.active {
  border-color: rgba(248, 113, 113, 0.9);
  box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.55);
  background: rgba(127, 29, 29, 0.28);
}

.saved-card:hover {
  border-color: rgba(96, 165, 250, 0.55);
  background: rgba(59, 130, 246, 0.16);
}

.saved-card span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 800;
}

.saved-card small {
  color: #9ca3af;
  font-size: 11px;
  font-weight: 700;
}

.saved-preview {
  width: 100%;
  flex: 1;
  min-height: 0;
}

.saved-preview line {
  stroke: rgba(203, 213, 225, 0.74);
  stroke-width: 2.4;
  stroke-linecap: round;
}

.saved-preview circle {
  fill: #60a5fa;
  stroke: rgba(15, 23, 42, 0.95);
  stroke-width: 2;
}

.saved-preview text {
  fill: white;
  font-size: 7px;
  font-weight: 900;
  dominant-baseline: middle;
  text-anchor: middle;
}

.saved-card-delete {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(127, 29, 29, 0.8);
  color: #fecaca;
  font-size: 12px;
  line-height: 1;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.saved-card-wrap:hover .saved-card-delete,
.saved-card-delete:focus-visible {
  opacity: 1;
}

.graph-canvas {
  position: absolute;
  top: 100px;
  left: 0;
  width: 100%;
  height: calc(100% - 100px);
}

.edge-weight-group {
  display: contents;
}

.edge-weight {
  position: absolute;
  transform: translate(-50%, -50%);
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 26px;
  padding: 2px 4px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 6px;
  background-color: rgba(24, 24, 24, 0.88);
  color: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.26);
  user-select: none;
}

.edge-weight span {
  min-width: 22px;
  color: #9bd5ff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
}

.edge-weight input {
  width: 28px;
  border: 0;
  border-radius: 0;
  background-color: transparent;
  color: white;
  padding: 0;
  font-size: 12px;
  text-align: center;
  outline: 0;
}

.edge-weight:hover,
.edge-weight-hovered {
  border-color: rgba(239, 68, 68, 0.86);
  background-color: rgba(58, 24, 24, 0.92);
}

.edge-weight:hover span,
.edge-weight:hover input,
.edge-weight-hovered span,
.edge-weight-hovered input,
.edge-weight input:focus {
  color: #fca5a5;
}

.edge-weight-off {
  opacity: 0.46;
}

.edge-weight-off span {
  color: #b9b9b9;
}

.node {
  background: white;
  border: 2px solid #111827;
  border-radius: 50%;
  position: absolute;
  transform: translate(-50%, -50%);
  cursor: pointer;
  display: flex;
  z-index: 2;
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.24);
  transition:
    background-color 0.12s ease,
    border-color 0.12s ease,
    box-shadow 0.12s ease,
    transform 0.12s ease;
}

.node-selected {
  background-color: #a7f3d0;
  border-color: #059669;
  box-shadow: 0 0 0 5px rgba(16, 185, 129, 0.24);
}

.node-selecting {
  background-color: #fef08a;
  border-color: #ca8a04;
  box-shadow: 0 0 0 6px rgba(234, 179, 8, 0.28);
}

.node-pending {
  background-color: #7dd3fc;
  border-color: #0ea5e9;
  box-shadow: 0 0 0 5px rgba(14, 165, 233, 0.28);
}

.node-dragging {
  border-color: #f97316;
  box-shadow:
    0 0 0 6px rgba(249, 115, 22, 0.26),
    0 12px 24px rgba(0, 0, 0, 0.34);
}

.node-start {
  border-color: #60a5fa;
}

.edge-line {
  stroke: white;
  stroke-width: 2;
}

.edge-hit-line {
  stroke: transparent;
  stroke-width: 14;
  cursor: pointer;
  pointer-events: stroke;
}

.edge-line-preview {
  stroke-dasharray: 5, 5;
}

.edge-line-outline {
  stroke: #ef4444;
  stroke-width: 2;
  stroke-linecap: round;
  pointer-events: none;
}

.edge-line-hover-border {
  stroke: black;
  stroke-width: 3.4;
  stroke-linecap: round;
  pointer-events: none;
}

.arrow-head {
  fill: white;
}

.arrow-head-active {
  fill: #ef4444;
  stroke: black;
  stroke-linejoin: round;
  stroke-width: 1.7;
}

.node-index {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1;
  font-size: 30px;
  font-weight: bold;
  color: #111827;
  padding: 2px;
  user-select: none;
}

.node-metrics {
  position: absolute;
  bottom: -34px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.node-order,
.node-distance {
  min-height: 16px;
  border-radius: 999px;
  padding: 1px 6px;
  font-size: 11px;
  font-weight: 800;
  line-height: 1.2;
}

.node-order {
  background: rgba(239, 68, 68, 0.88);
  color: white;
}

.node-distance {
  background: rgba(96, 165, 250, 0.92);
  color: #07111f;
}

.traversal-panel {
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: 20px;
  z-index: 80;
  min-height: 78px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 8px;
  background: rgba(20, 23, 29, 0.92);
  color: white;
  padding: 12px 14px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.32);
}

.traversal-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.traversal-header strong {
  color: #f8fafc;
  font-size: 14px;
  font-weight: 800;
}

.traversal-header span {
  color: #b9c4d0;
  font-size: 12px;
}

.traversal-order,
.traversal-levels {
  display: flex;
  align-items: stretch;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.traversal-order-item,
.traversal-level {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.055);
  padding: 5px 7px;
}

.traversal-level {
  align-items: flex-start;
}

.traversal-step-label {
  min-width: 22px;
  height: 22px;
  border-radius: 5px;
  background: rgba(148, 163, 184, 0.22);
  color: #cbd5e1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 800;
}

.traversal-group {
  display: inline-flex;
  gap: 5px;
}

.traversal-node {
  min-width: 28px;
  height: 24px;
  border-radius: 999px;
  background: #e5e7eb;
  color: #111827;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  font-size: 13px;
  font-weight: 800;
}

.traversal-distance {
  min-width: 34px;
  height: 22px;
  border-radius: 999px;
  background: rgba(96, 165, 250, 0.2);
  color: #bfdbfe;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 800;
}

.traversal-active {
  border-color: rgba(96, 165, 250, 0.95);
  background: rgba(30, 64, 175, 0.58);
  box-shadow: inset 0 0 0 1px rgba(147, 197, 253, 0.28);
}

.traversal-active .traversal-step-label {
  background: #60a5fa;
  color: #07111f;
}

.traversal-active .traversal-node {
  background: #bfdbfe;
}

.distance-summary {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  overflow-x: auto;
  padding-top: 8px;
  border-top: 1px solid rgba(148, 163, 184, 0.18);
}

.distance-chip {
  flex: 0 0 auto;
  min-height: 24px;
  border-radius: 999px;
  background: rgba(96, 165, 250, 0.14);
  color: #dbeafe;
  display: inline-flex;
  align-items: center;
  padding: 0 9px;
  font-size: 12px;
  font-weight: 800;
}

.distance-chip.unreachable {
  background: rgba(148, 163, 184, 0.14);
  color: #cbd5e1;
}
</style>
