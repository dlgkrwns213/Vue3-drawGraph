import Queue from './queue.js';
import MinHeap from './minHeap.js';

function makeGraph(n, lineGraph) {
  const graph = Array(n + 1).fill().map(() => []);

  for (const [u, v, rawForwardWeight, rawBackwardWeight = rawForwardWeight] of lineGraph) {
    if (!Number.isInteger(u) || !Number.isInteger(v) || u < 1 || v < 1 || u > n || v > n) {
      continue;
    }

    const forwardWeight = normalizeWeight(rawForwardWeight);
    const backwardWeight = normalizeWeight(rawBackwardWeight);

    if (forwardWeight !== null) {
      graph[u].push([v, forwardWeight]);
    }

    if (backwardWeight !== null) {
      graph[v].push([u, backwardWeight]);
    }
  }

  graph.forEach((line) => line.sort((a, b) => a[0] - b[0]));

  return graph;
}

function normalizeWeight(weight) {
  if (weight === null || weight === '') {
    return null;
  }

  const normalizedWeight = Number(weight);

  if (!Number.isFinite(normalizedWeight) || normalizedWeight < 0) {
    return null;
  }

  return normalizedWeight;
}

function bfs(nodes, lineGraph, startIdx = 1) {
  const n = nodes.length;
  const graph = makeGraph(n, lineGraph);
  const queue = new Queue();
  const visited = Array(n + 1).fill(false);
  const sameLevel = [];
  const orderIdx = [];
  const levels = [];
  let level = 0;

  queue.push([startIdx, 0]);
  visited[startIdx] = true;

  while (!queue.isEmpty()) {
    const [nowIdx, nowLevel] = queue.pop();

    if (level !== nowLevel) {
      level = nowLevel;
      levels.push([...sameLevel]);
      sameLevel.length = 0;
    }

    sameLevel.push(nowIdx);
    orderIdx.push(nowIdx);

    for (const [nextIdx] of graph[nowIdx]) {
      if (!visited[nextIdx]) {
        visited[nextIdx] = true;
        queue.push([nextIdx, nowLevel + 1]);
      }
    }
  }

  if (sameLevel.length > 0) {
    levels.push([...sameLevel]);
  }

  return { levels, orderIdx };
}

function dfs(nodes, lineGraph, startIdx = 1) {
  const n = nodes.length;
  const graph = makeGraph(n, lineGraph);
  const dfsNodeOrder = [];
  const visited = Array(n + 1).fill(false);

  visited[startIdx] = true;
  dfsRecur(startIdx, dfsNodeOrder, visited, graph);

  return dfsNodeOrder;
}

function dfsRecur(nowIdx, dfsNodeOrder, visited, graph) {
  dfsNodeOrder.push(nowIdx);

  for (const [nextIdx] of graph[nowIdx]) {
    if (!visited[nextIdx]) {
      visited[nextIdx] = true;
      dfsRecur(nextIdx, dfsNodeOrder, visited, graph);
    }
  }
}

function dijkstra(nodes, lineGraph, startIdx = 1) {
  const n = nodes.length;
  const graph = makeGraph(n, lineGraph);
  const heap = new MinHeap();
  const distances = Array(n + 1).fill(Infinity);
  const nodeOrder = [];

  heap.push([0, startIdx]);
  distances[startIdx] = 0;

  while (!heap.isEmpty()) {
    const [dist, nowIdx] = heap.pop();

    if (distances[nowIdx] < dist) {
      continue;
    }

    nodeOrder.push(nowIdx);

    for (const [nextIdx, weight] of graph[nowIdx]) {
      if (weight < 0) {
        continue;
      }

      const nextDist = dist + weight;
      if (distances[nextIdx] > nextDist) {
        distances[nextIdx] = nextDist;
        heap.push([nextDist, nextIdx]);
      }
    }
  }

  return nodeOrder;
}

export { bfs, dfs, dijkstra };
