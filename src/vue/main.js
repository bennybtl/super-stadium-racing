import { createApp } from 'vue';
import { createPinia } from 'pinia';
import '../index.css';
import AppShell from './AppShell.vue';

const app = createApp(AppShell);
app.use(createPinia());
app.mount('#vue-app');

// Export the pinia instance so game code can import it directly if needed
export { app };
