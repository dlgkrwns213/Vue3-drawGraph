<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { bfs, dfs, dijkstra } from '../utils/functions.js';

const TOOLBAR_HEIGHT = 100;
const NODE_RADIUS = 25;
const MIN_NODE_DISTANCE = 80;
const ANIMATION_DELAY = 500;
const RESET_DELAY = 1000;

const graphRoot = ref(null);
const nodes = ref([]);
const lines = ref([]);
const selectedNode = ref(null);
const currentLine = ref(null);
const graphConnections = ref([]);
const inputFields = ref([]);
const userDone = ref([]);
const startIdx = ref(-1);
const nodeSelecting = ref([]);
const nodeSelected = ref([]);
const isProcessing = ref(false);
const nodeOrders = ref([]);

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
  nodes.value.push({ x, y });
  userDone.value.push('node');
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
  const from = Math.min(fromIndex, toIndex) + 1;
  const to = Math.max(fromIndex, toIndex) + 1;
  const isDuplicate = graphConnections.value.some(
    ([existingFrom, existingTo]) => existingFrom === from && existingTo === to,
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
    x: (line.x1 + line.x2) / 2,
    y: (line.y1 + line.y2) / 2,
    value: 1,
  });
  graphConnections.value.push([from, to, 1]);
  userDone.value.push('line');
}

function updateGraphConnection(index) {
  const connection = graphConnections.value[index];
  if (!connection) return;

  const parsedWeight = Number(inputFields.value[index].value);
  connection[2] = Number.isFinite(parsedWeight) ? parsedWeight : 1;
  inputFields.value[index].value = connection[2];
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

function cancelUserDone() {
  if (isProcessing.value) return;

  const done = userDone.value.pop();
  if (!done) {
    alert('처음 상태입니다.');
    return;
  }

  if (done === 'node') {
    nodes.value.pop();
    nodeOrders.value.pop();
    cancelCurrentLine();
    normalizeStartNode();
    return;
  }

  lines.value.pop();
  inputFields.value.pop();
  graphConnections.value.pop();
}

function cancelAllUserDone() {
  if (isProcessing.value) return;

  userDone.value = [];
  nodes.value = [];
  lines.value = [];
  inputFields.value = [];
  graphConnections.value = [];
  nodeOrders.value = [];
  nodeSelecting.value = [];
  nodeSelected.value = [];
  startIdx.value = -1;
  cancelCurrentLine();
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

    <button class="back-button" type="button" aria-label="undo" @click.stop="cancelUserDone">
      <font-awesome-icon :icon="['fas', 'backward-step']" />
    </button>

    <button
      class="back-button back-button-all"
      type="button"
      aria-label="reset graph"
      @click.stop="cancelAllUserDone"
    >
      <font-awesome-icon :icon="['fas', 'backward-fast']" />
    </button>

    <svg class="graph-canvas" @click="handleClick">
      <line
        v-for="(line, index) in lines"
        :key="`line-${index}`"
        :x1="line.x1"
        :y1="line.y1 - TOOLBAR_HEIGHT"
        :x2="line.x2"
        :y2="line.y2 - TOOLBAR_HEIGHT"
        stroke="white"
        stroke-width="2"
      />
      <line
        v-if="currentLine"
        :x1="currentLine.x1"
        :y1="currentLine.y1 - TOOLBAR_HEIGHT"
        :x2="currentLine.x2"
        :y2="currentLine.y2 - TOOLBAR_HEIGHT"
        stroke="white"
        stroke-width="2"
        stroke-dasharray="5,5"
      />
    </svg>

    <div
      v-for="(input, index) in inputFields"
      :key="`input-${index}`"
      class="input-field"
      :style="{ left: `${input.x - 10}px`, top: `${input.y}px` }"
    >
      <input
        v-model.number="input.value"
        type="number"
        min="0"
        step="1"
        aria-label="edge weight"
        @input="updateGraphConnection(index)"
        @keyup.enter="updateGraphConnection(index)"
        @click.stop
      />
    </div>

    <div
      v-for="(node, index) in nodes"
      :key="`node-${index}`"
      class="node"
      :class="{
        'node-selecting': nodeSelecting.includes(index + 1),
        'node-selected': nodeSelected.includes(index + 1),
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
.back-button:hover {
  background-color: rgb(64, 64, 64);
}

.back-button {
  width: 40px;
  height: 30px;
  border: 0;
  border-radius: 6px;
  background-color: transparent;
  color: white;
  z-index: 99;
  position: absolute;
  top: 110px;
  right: 50px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 25px;
}

.back-button-all {
  right: 10px;
}

.graph-canvas {
  position: absolute;
  top: 100px;
  left: 0;
  width: 100%;
  height: calc(100% - 100px);
}

.input-field {
  position: absolute;
  z-index: 3;
}

.input-field input {
  width: 60px;
  border: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 0;
  background-color: rgba(44, 44, 44, 0.85);
  color: white;
  padding: 5px;
  font-size: 12px;
  text-align: center;
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
