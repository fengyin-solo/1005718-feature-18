import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import './styles/global.css'
// 缺陷处置已改用独立底稿：启动时先读一次，把数据投影同步到通用底稿，看板首次进入就有数。
import { listDefects } from './data/defect-store'

listDefects()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
