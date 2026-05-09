<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { bfs, dfs, dijkstra } from '../utils/functions.js';

const TOOLBAR_HEIGHT = 100;
const NODE_RADIUS = 25;
const MIN_NODE_DISTANCE = 80;
const DRAG_START_DISTANCE = 5;
const RELAXATION_STEPS = 8;
const RESET_DELAY = 1000;
const DISABLED_WEIGHT = null;

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

  const before = createGraphSnapshot();
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

  restoreGraphSnapshot(after);
  pushHistory({
    type: 'replace-graph',
    before,
    after: createGraphSnapshot(),
  });
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
  cancelCurrentLine();
  nodes.value = snapshot.nodes.map(node => ({ ...node }));
  lines.value = snapshot.lines.map(line => ({ ...line }));
  inputFields.value = snapshot.inputFields.map(input => ({ ...input }));
  graphConnections.value = snapshot.graphConnections.map(connection => [...connection]);
  nodeOrders.value = { ...snapshot.nodeOrders };
  nodeDistances.value = { ...snapshot.nodeDistances };
  nodeSelecting.value = [...snapshot.nodeSelecting];
  nodeSelected.value = [...snapshot.nodeSelected];
  startIdx.value = snapshot.startIdx;
  hoveredWeight.value = snapshot.hoveredWeight ? { ...snapshot.hoveredWeight } : null;
  traversalResult.value = snapshot.traversalResult
    ? {
        ...snapshot.traversalResult,
        distances: snapshot.traversalResult.distances ? { ...snapshot.traversalResult.distances } : null,
        sequence: snapshot.traversalResult.isGrouped
          ? snapshot.traversalResult.sequence.map(group => [...group])
          : [...snapshot.traversalResult.sequence],
      }
    : null;
  activeResultStep.value = snapshot.activeResultStep;
  nextEdgeId.value = snapshot.nextEdgeId;
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

onBeforeUnmount(() => {
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

.history-buttons {
  z-index: 99;
  position: absolute;
  top: 110px;
  right: 10px;
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
