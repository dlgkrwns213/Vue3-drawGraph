import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'

// FontAwesome 관련 패키지들
import { library } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import {
  faBackwardFast,
  faBackwardStep,
  faForwardFast,
  faForwardStep,
} from '@fortawesome/free-solid-svg-icons';

library.add(faBackwardFast, faBackwardStep, faForwardFast, faForwardStep);

const app = createApp(App);

app.component('font-awesome-icon', FontAwesomeIcon);

app.mount('#app');
