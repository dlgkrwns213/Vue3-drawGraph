import Queue from './queue.js';
import MinHeap from './minHeap.js';

function makeGraph(nodes, lineGraph, options = {}) {
  const { allowNegative = false } = options;
  const nodeIds = nodes.map((node, index) => node.id ?? index + 1);
  const nodeIdSet = new Set(nodeIds);
  const maxNodeId = Math.max(0, ...nodeIds);
  const graph = Array(maxNodeId + 1).fill().map(() => []);

  for (const [u, v, rawForwardWeight, rawBackwardWeight = rawForwardWeight] of lineGraph) {
    if (!Number.isInteger(u) || !Number.isInteger(v) || !nodeIdSet.has(u) || !nodeIdSet.has(v)) {
      continue;
    }

    const forwardWeight = normalizeWeight(rawForwardWeight, allowNegative);
    const backwardWeight = normalizeWeight(rawBackwardWeight, allowNegative);

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

function normalizeWeight(weight, allowNegative = false) {
  if (weight === null || weight === '') {
    return null;
  }

  const normalizedWeight = Number(weight);

  if (!Number.isFinite(normalizedWeight) || (!allowNegative && normalizedWeight < 0)) {
    return null;
  }

  return normalizedWeight;
}

function makeDirectedEdges(nodes, lineGraph, options = {}) {
  const { allowNegative = false } = options;
  const nodeIds = nodes.map((node, index) => node.id ?? index + 1);
  const nodeIdSet = new Set(nodeIds);
  const edges = [];

  for (const [from, to, rawForwardWeight, rawBackwardWeight = rawForwardWeight] of lineGraph) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || !nodeIdSet.has(from) || !nodeIdSet.has(to)) {
      continue;
    }

    const forwardWeight = normalizeWeight(rawForwardWeight, allowNegative);
    const backwardWeight = normalizeWeight(rawBackwardWeight, allowNegative);

    if (forwardWeight !== null) {
      edges.push({ from, to, weight: forwardWeight });
    }

    if (backwardWeight !== null) {
      edges.push({ from: to, to: from, weight: backwardWeight });
    }
  }

  edges.sort((a, b) => a.weight - b.weight || a.from - b.from || a.to - b.to);

  return edges;
}

function makeUndirectedEdges(nodes, lineGraph, options = {}) {
  const { allowNegative = false } = options;
  const nodeIds = nodes.map((node, index) => node.id ?? index + 1);
  const nodeIdSet = new Set(nodeIds);
  const edgeMap = new Map();

  for (const [from, to, rawForwardWeight, rawBackwardWeight = rawForwardWeight] of lineGraph) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || !nodeIdSet.has(from) || !nodeIdSet.has(to)) {
      continue;
    }

    const minNode = Math.min(from, to);
    const maxNode = Math.max(from, to);
    const key = `${minNode}-${maxNode}`;
    const forwardWeight = normalizeWeight(rawForwardWeight, allowNegative);
    const backwardWeight = normalizeWeight(rawBackwardWeight, allowNegative);
    const availableWeights = [forwardWeight, backwardWeight].filter(weight => weight !== null);

    if (availableWeights.length === 0) continue;

    const weight = Math.min(...availableWeights);
    const previous = edgeMap.get(key);

    if (!previous || weight < previous.weight) {
      edgeMap.set(key, { from: minNode, to: maxNode, weight });
    }
  }

  return [...edgeMap.values()].sort((a, b) => a.weight - b.weight || a.from - b.from || a.to - b.to);
}

function bfs(nodes, lineGraph, startIdx = 1) {
  const graph = makeGraph(nodes, lineGraph);
  const queue = new Queue();
  const visited = Array(graph.length).fill(false);
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
  const graph = makeGraph(nodes, lineGraph);
  const dfsNodeOrder = [];
  const visited = Array(graph.length).fill(false);

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
  const graph = makeGraph(nodes, lineGraph);
  const nodeIds = nodes.map((node, index) => node.id ?? index + 1);
  const heap = new MinHeap();
  const distances = Array(graph.length).fill(Infinity);
  const nodeOrder = [];
  const steps = [];

  heap.push([0, startIdx]);
  distances[startIdx] = 0;
  steps.push({
    type: 'init',
    node: startIdx,
    distances: Object.fromEntries(nodeIds.map(nodeId => [nodeId, distances[nodeId]])),
  });

  while (!heap.isEmpty()) {
    const [dist, nowIdx] = heap.pop();

    if (distances[nowIdx] < dist) {
      continue;
    }

    nodeOrder.push(nowIdx);
    steps.push({
      type: 'visit',
      node: nowIdx,
      distances: Object.fromEntries(nodeIds.map(nodeId => [nodeId, distances[nodeId]])),
    });

    for (const [nextIdx, weight] of graph[nowIdx]) {
      if (weight < 0) {
        continue;
      }

      const nextDist = dist + weight;
      if (distances[nextIdx] > nextDist) {
        distances[nextIdx] = nextDist;
        heap.push([nextDist, nextIdx]);
        steps.push({
          type: 'relax',
          node: nextIdx,
          from: nowIdx,
          distances: Object.fromEntries(nodeIds.map(nodeId => [nodeId, distances[nodeId]])),
        });
      }
    }
  }

  return {
    order: nodeOrder,
    steps,
    distances: Object.fromEntries(nodeIds.map(nodeId => [
      nodeId,
      distances[nodeId],
    ])),
  };
}

function bellmanFord(nodes, lineGraph, startIdx = 1) {
  const nodeIds = nodes.map((node, index) => node.id ?? index + 1);
  const edges = makeDirectedEdges(nodes, lineGraph, { allowNegative: true });
  const distances = Object.fromEntries(nodeIds.map(nodeId => [nodeId, Infinity]));
  const order = [];

  distances[startIdx] = 0;

  for (let count = 0; count < nodeIds.length - 1; count += 1) {
    let updated = false;

    for (const { from, to, weight } of edges) {
      if (!Number.isFinite(distances[from])) continue;

      const nextDistance = distances[from] + weight;
      if (distances[to] > nextDistance) {
        distances[to] = nextDistance;
        updated = true;

        if (!order.includes(to)) {
          order.push(to);
        }
      }
    }

    if (!updated) break;
  }

  const hasNegativeCycle = edges.some(({ from, to, weight }) => {
    return Number.isFinite(distances[from]) && distances[to] > distances[from] + weight;
  });

  return {
    order: [startIdx, ...order.filter(nodeId => nodeId !== startIdx)],
    distances,
    hasNegativeCycle,
  };
}

function floydWarshall(nodes, lineGraph) {
  const nodeIds = nodes.map((node, index) => node.id ?? index + 1).sort((a, b) => a - b);
  const distances = Object.fromEntries(nodeIds.map(from => [
    from,
    Object.fromEntries(nodeIds.map(to => [to, from === to ? 0 : Infinity])),
  ]));
  const edges = makeDirectedEdges(nodes, lineGraph, { allowNegative: true });
  const order = [];

  for (const { from, to, weight } of edges) {
    distances[from][to] = Math.min(distances[from][to], weight);
  }

  for (const via of nodeIds) {
    order.push(via);

    for (const from of nodeIds) {
      for (const to of nodeIds) {
        if (!Number.isFinite(distances[from][via]) || !Number.isFinite(distances[via][to])) {
          continue;
        }

        distances[from][to] = Math.min(distances[from][to], distances[from][via] + distances[via][to]);
      }
    }
  }

  const hasNegativeCycle = nodeIds.some(nodeId => distances[nodeId][nodeId] < 0);

  return {
    order,
    distances,
    hasNegativeCycle,
  };
}

function kruskal(nodes, lineGraph) {
  const nodeIds = nodes.map((node, index) => node.id ?? index + 1).sort((a, b) => a - b);
  const edges = makeUndirectedEdges(nodes, lineGraph, { allowNegative: true });
  const parent = Object.fromEntries(nodeIds.map(nodeId => [nodeId, nodeId]));
  const selectedEdges = [];
  let totalWeight = 0;

  function find(nodeId) {
    if (parent[nodeId] !== nodeId) {
      parent[nodeId] = find(parent[nodeId]);
    }

    return parent[nodeId];
  }

  function union(a, b) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return false;

    parent[rootB] = rootA;
    return true;
  }

  for (const edge of edges) {
    if (union(edge.from, edge.to)) {
      selectedEdges.push(edge);
      totalWeight += edge.weight;
    }
  }

  return {
    order: edgeOrderToNodeOrder(selectedEdges),
    edges: selectedEdges,
    totalWeight,
    isConnected: nodes.length === 0 || selectedEdges.length === nodes.length - 1,
  };
}

function prim(nodes, lineGraph, startIdx = 1) {
  const graph = makeGraph(nodes, lineGraph, { allowNegative: true });
  const nodeIds = nodes.map((node, index) => node.id ?? index + 1);
  const nodeSet = new Set(nodeIds);
  const visited = new Set();
  const selectedEdges = [];
  const order = [];
  let totalWeight = 0;

  if (!nodeSet.has(startIdx)) {
    return { order, edges: selectedEdges, totalWeight, isConnected: false };
  }

  visited.add(startIdx);
  order.push(startIdx);

  while (visited.size < nodeIds.length) {
    let bestEdge = null;

    for (const from of visited) {
      for (const [to, weight] of graph[from] ?? []) {
        if (visited.has(to)) continue;

        if (!bestEdge || weight < bestEdge.weight || (weight === bestEdge.weight && to < bestEdge.to)) {
          bestEdge = { from, to, weight };
        }
      }
    }

    if (!bestEdge) break;

    visited.add(bestEdge.to);
    selectedEdges.push(bestEdge);
    order.push(bestEdge.to);
    totalWeight += bestEdge.weight;
  }

  return {
    order,
    edges: selectedEdges,
    totalWeight,
    isConnected: visited.size === nodeIds.length,
  };
}

function topologicalSort(nodes, lineGraph) {
  const nodeIds = nodes.map((node, index) => node.id ?? index + 1).sort((a, b) => a - b);
  const graph = Object.fromEntries(nodeIds.map(nodeId => [nodeId, []]));
  const indegree = Object.fromEntries(nodeIds.map(nodeId => [nodeId, 0]));
  const edges = makeDirectedEdges(nodes, lineGraph, { allowNegative: true });

  for (const { from, to } of edges) {
    graph[from].push(to);
    indegree[to] += 1;
  }

  for (const nodeId of nodeIds) {
    graph[nodeId].sort((a, b) => a - b);
  }

  const queue = nodeIds.filter(nodeId => indegree[nodeId] === 0);
  const order = [];

  while (queue.length > 0) {
    const now = queue.shift();
    order.push(now);

    for (const next of graph[now]) {
      indegree[next] -= 1;
      if (indegree[next] === 0) {
        queue.push(next);
        queue.sort((a, b) => a - b);
      }
    }
  }

  return {
    order,
    hasCycle: order.length !== nodeIds.length,
  };
}

function edgeOrderToNodeOrder(edges) {
  const order = [];

  for (const edge of edges) {
    if (!order.includes(edge.from)) order.push(edge.from);
    if (!order.includes(edge.to)) order.push(edge.to);
  }

  return order;
}

export {
  bellmanFord,
  bfs,
  dfs,
  dijkstra,
  floydWarshall,
  kruskal,
  prim,
  topologicalSort,
};
