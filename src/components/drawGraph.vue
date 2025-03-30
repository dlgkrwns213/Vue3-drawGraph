<script setup>
</script>

<template>
<div class="overlay" v-if="isProcessing"></div>

<div class="graph-button">
  <button class="button" @click="clickBFSButton(false)">bfs1</button>
  <button class="button" @click="clickBFSButton(true)">bfs2</button>
  <button class="button" @click="clickDFSButton()">dfs</button>
  <button class="button" @click="clickDijkstraButton()">dijkstra</button>
</div>

<div class="back-button" @click.stop="cancelUserDone">
  <font-awesome-icon :icon="['fas', 'backward-step']" />
</div>

<div
  class="back-button"
  style="right: 10px"
  @click.stop="cancelAllUserDone"
>
<font-awesome-icon :icon="['fas', 'backward-fast']" />
</div>

</template>

<style scoped>


body {
  margin: 0;
  overflow: hidden;
}

.graph-button {
  height: 100px;
  background: #333;
  color: white;
  display: flex;
  align-items: center;
  padding: 0 20px;
  font-size: 24px;
}

/* overlay 스타일 */
.overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.2);  /* 반투명 배경 */
  z-index: 999;  /* 모든 UI 요소 위에 표시 */
  pointer-events: all;  /* 마우스 이벤트를 모두 받아 처리 */
}


.button {
  width: 150px;
  height: 80%;
  border-radius: 10%;
  background-color: rgb(41, 41, 41);
  margin: 0 20px;
  color: rgb(215, 215, 215);
}

.back-button {
  width: 40px; 
  height: 30px; 
  border-radius: 10%;
  background-color: transparent;
  z-index: 99;
  position: absolute;
  top: 110px;
  right: 50px;
  cursor: pointer;
  display: flex;               /* flexbox 활성화 */
  align-items: center;         /* 수직 중앙 정렬 */
  justify-content: center;     /* 수평 중앙 정렬 */
  font-size: 25px;             /* 아이콘 크기 조정 */
}


#app {
  width: 100vw;
  height: 100vh;
  position: relative;
  background: rgb(44, 44, 44);
}

.input-field input {
  background-color: transparent;
  color: white;
  border: none;
  padding: 5px;
  font-size: 12px;
  width: 60px;
}

.input-field input::placeholder {
  color: white;
  font-size: 12px;
}

.node {
  width: 50px;
  height: 50px;
  background: white;
  border: 2px solid black;
  border-radius: 50%;
  position: absolute;
  transform: translate(-50%, -50%);
  cursor: pointer;
  display: flex;

}

.node-selected {
  background-color: rgb(88, 88, 88);
}

.node-selecting {
  background-color: yellow;
}

/* index + 1을 정확히 노드의 중앙에 표시 */
.node-index {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%); /* 중앙에 정확히 배치 */
  z-index: 1;
  font-size: 30px;
  font-weight: bold;
  color: black;
  padding: 2px;
  user-select: none;

}

/* nodeOrders[index]를 node의 아래쪽에 표시 */
.node-order {
  position: absolute;
  bottom: -15px; /* 노드 아래에 배치 */
  left: 50%;
  transform: translateX(-50%);
  color: red;
  font-size: 12px;
}

</style>