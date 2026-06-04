import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';

window.batchApi?.bootMark?.('renderer-main-start');
createApp(App).mount('#app');
