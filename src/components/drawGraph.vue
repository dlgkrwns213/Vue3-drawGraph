<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { bfs, dfs, dijkstra } from '../utils/functions.js';

const TOOLBAR_HEIGHT = 100;
const NODE_RADIUS = 25;
const MIN_NODE_DISTANCE = 80;
const ANIMATION_DELAY = 500;
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
const nodeOrders = ref([]);
const hoveredWeight = ref(null);

const hasNodes = computed(() => nodes.value.length > 0);

function getPointerPosition(event) {
  const rect = graphRoot.value.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function handleClick(event) {
  if (isProcessing.value || selectedNode.value !== null) return;

  const { x, y } = getPointerPosition(event);

  for (const node of nodes.value) {
    const distance = Math.hypot(x - node.x, y - node.y);
    if (distance <= MIN_NODE_DISTANCE) {
      alert('Too close');
      return;
    }
  }

  addNode(x, y);
  nodeOrders.value.push(Number.NaN);

  if (startIdx.value === -1) {
    setStartNode(1);
  }
}

function addNode(x, y) {
  const node = { x, y };

  nodes.value.push(node);
  pushHistory({ type: 'node', node });
}

function connectNode(index, event) {
  if (isProcessing.value) return;

  if (event.ctrlKey) {
    setStartNode(index + 1);
    cancelCurrentLine();
    return;
  }

  if (selectedNode.value === null) {
    selectedNode.value = index;
    window.addEventListener('mousemove', drawLine);
    return;
  }

  if (selectedNode.value === index) {
    setStartNode(index + 1);
    cancelCurrentLine();
    return;
  }

  addConnection(selectedNode.value, index);
  cancelCurrentLine();
}

function addConnection(fromIndex, toIndex) {
  const from = fromIndex + 1;
  const to = toIndex + 1;
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
    x1: fromNode.x,
    y1: fromNode.y,
    x2: toNode.x,
    y2: toNode.y,
  };

  lines.value.push(line);
  inputFields.value.push({
    forward: 1,
    backward: 1,
  });
  graphConnections.value.push([from, to, 1, 1]);
  pushHistory({
    type: 'line',
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
  let currentLineIndex = -1;

  for (const action of userDone.value) {
    if (action.type !== 'line') continue;

    currentLineIndex += 1;
    if (currentLineIndex === lineIndex) {
      action.input = { ...inputFields.value[lineIndex] };
      action.connection = [...graphConnections.value[lineIndex]];
      return;
    }
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
    nodes.value.pop();
    nodeOrders.value.pop();
    normalizeStartNode();
    return;
  }

  if (action.type === 'weight') {
    setWeight(action.index, action.direction, action.beforeWeight, action.beforeInputValue);
    syncLineHistory(action.index);
    return;
  }

  lines.value.pop();
  inputFields.value.pop();
  graphConnections.value.pop();
}

function applyAction(action) {
  if (action.type === 'node') {
    nodes.value.push({ ...action.node });
    nodeOrders.value.push(Number.NaN);

    if (startIdx.value === -1) {
      setStartNode(1);
    }

    return;
  }

  if (action.type === 'weight') {
    setWeight(action.index, action.direction, action.afterWeight, action.afterInputValue);
    syncLineHistory(action.index);
    return;
  }

  lines.value.push({ ...action.line });
  inputFields.value.push({ ...action.input });
  graphConnections.value.push([...action.connection]);
}

async function clickBFSButton(groupByLevel) {
  if (!canRunAlgorithm()) return;

  await runAlgorithm(async () => {
    const { levels, orderIdx } = bfs(nodes.value, graphConnections.value, startIdx.value);
    await colorNodes(groupByLevel ? levels : orderIdx, groupByLevel);
  });
}

async function clickDFSButton() {
  if (!canRunAlgorithm()) return;

  await runAlgorithm(async () => {
    await colorNodes(dfs(nodes.value, graphConnections.value, startIdx.value));
  });
}

async function clickDijkstraButton() {
  if (!canRunAlgorithm()) return;

  await runAlgorithm(async () => {
    await colorNodes(dijkstra(nodes.value, graphConnections.value, startIdx.value));
  });
}

function canRunAlgorithm() {
  return hasNodes.value && startIdx.value !== -1 && !isProcessing.value;
}

async function runAlgorithm(callback) {
  isProcessing.value = true;
  nodeOrders.value.fill(Number.NaN);
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

async function colorNodes(sequence, isGrouped = false) {
  if (isGrouped) {
    for (let idx = 0; idx < sequence.length; idx += 1) {
      const currentLevel = sequence[idx];
      nodeSelecting.value = [...currentLevel];

      for (const node of currentLevel) {
        markNode(node, idx + 1);
      }

      await delay(ANIMATION_DELAY);
    }
  } else {
    for (let idx = 0; idx < sequence.length; idx += 1) {
      const node = sequence[idx];
      nodeSelecting.value = [node];
      markNode(node, idx + 1);
      await delay(ANIMATION_DELAY);
    }
  }

  nodeSelecting.value = [];
  await delay(RESET_DELAY);
  nodeSelecting.value = startIdx.value === -1 ? [] : [startIdx.value];
  nodeSelected.value = [];
}

function markNode(node, order) {
  if (!nodeSelected.value.includes(node)) {
    nodeSelected.value.push(node);
  }

  nodeOrders.value[node - 1] = order;
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

  if (startIdx.value > nodes.value.length) {
    setStartNode(nodes.value.length);
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', drawLine);
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
      :key="`node-${index}`"
      class="node"
      :class="{
        'node-selecting': nodeSelecting.includes(index + 1),
        'node-selected': nodeSelected.includes(index + 1),
        'node-pending': selectedNode === index,
      }"
      :style="{
        left: `${node.x}px`,
        top: `${node.y}px`,
        width: `${NODE_RADIUS * 2}px`,
        height: `${NODE_RADIUS * 2}px`,
      }"
      @click.stop="connectNode(index, $event)"
      @contextmenu.prevent="handleMouseDown"
    >
      <div class="node-index">{{ index + 1 }}</div>
      <div v-if="!Number.isNaN(nodeOrders[index])" class="node-order">
        {{ nodeOrders[index] }}
      </div>
    </div>
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
  background: #333;
  color: white;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 0 20px;
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
  width: 150px;
  height: 80%;
  border: 1px solid #555;
  border-radius: 8px;
  background-color: rgb(41, 41, 41);
  color: rgb(215, 215, 215);
  font-size: 20px;
  cursor: pointer;
}

.button:hover,
.history-button:hover {
  background-color: rgb(64, 64, 64);
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
  background-color: transparent;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 25px;
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
  border: 2px solid black;
  border-radius: 50%;
  position: absolute;
  transform: translate(-50%, -50%);
  cursor: pointer;
  display: flex;
  z-index: 2;
}

.node-selected {
  background-color: rgb(88, 88, 88);
}

.node-selecting {
  background-color: yellow;
}

.node-pending {
  background-color: #7dd3fc;
  border-color: #0ea5e9;
  box-shadow: 0 0 0 5px rgba(14, 165, 233, 0.28);
}

.edge-line {
  stroke: white;
  stroke-width: 2;
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
  color: black;
  padding: 2px;
  user-select: none;
}

.node-order {
  position: absolute;
  bottom: -18px;
  left: 50%;
  transform: translateX(-50%);
  color: #ff5656;
  font-size: 12px;
  font-weight: 700;
}
</style>
