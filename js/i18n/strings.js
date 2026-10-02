/**
 * Smart Care — translation catalogue (blueprint §6).
 *
 * Rules honoured here:
 *  - EVERY original key from `_source/original-index.html` (I18N object, line 372)
 *    is kept VERBATIM under its original name, with its original value — except the
 *    intentional threshold de-duplication described below.
 *  - `tempTip` / `alertMsg` are now `{threshold}` templates. The literal `36.0`
 *    (the original *test* value) no longer appears in any string; the number is
 *    injected at runtime from `config.thresholds.feverCelsius` (default **37.5**).
 *  - The legacy Google Maps query key has been removed (the map is now Leaflet + OSM).
 *  - New namespaced keys cover Settings / BLE / ESP32 status and feedback in all
 *    four locales.
 *  - `LEGACY_KEY_MAP` maps the original key names to their new namespaced
 *    equivalents so either style resolves (see js/i18n/index.js). Legacy keys stay
 *    the canonical storage for preserved text, so no string is duplicated.
 */

/** Locale codes — unchanged from the original app. */
export const LOCALES = Object.freeze(['zh-Hant', 'zh-Hans', 'en', 'pt']);

/** Default locale when nothing is stored in `smart_care_lang`. */
export const DEFAULT_LOCALE = 'zh-Hant';

/** Original key → new namespaced key (aliases resolve in both directions). */
export const LEGACY_KEY_MAP = Object.freeze({
  homeTitle: 'home.title',
  homeSubtitle: 'home.subtitle',
  btnNavTemp: 'home.nav.temp',
  btnNavWound: 'home.nav.wound',
  motorPanelTitle: 'motor.panel.title',
  btnM1: 'motor.m1',
  btnM2: 'motor.m2',
  btnM3: 'motor.m3',
  motorRotating: 'motor.rotating',
  motorDispensing: 'motor.dispensing',
  mapTitle: 'map.title',
  tempTitle: 'temp.title',
  tempStatusInit: 'temp.status.init',
  tempStatusConnected: 'temp.status.connected',
  btnConnectTemp: 'temp.connect',
  tempUnit: 'temp.unit',
  tempTip: 'temp.tip',
  btnBack: 'common.back',
  alertTitle: 'alert.title',
  alertMsg: 'alert.message',
  btnCloseBack: 'common.closeBack',
  woundTitle: 'wound.title',
  woundSubtitle: 'wound.subtitle'
});

/**
 * All translations.
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
export const STRINGS = Object.freeze({
  /* ===================================================================== */
  'zh-Hant': Object.freeze({
    /* ---- original keys (verbatim, templates only where noted) -------- */
    homeTitle: '全方位智慧健康站',
    homeSubtitle: '即時體溫檢測 • 多機構自動化給藥 • 鄰近醫療導航',
    btnNavTemp: '體溫量測與退熱機構',
    btnNavWound: '傷口包紮與處置機構',
    motorPanelTitle: '機構手動驅動面板 (ESP32 Wi-Fi)',
    btnM1: '馬達 1：體溫計 / 退熱貼機構',
    btnM2: '馬達 2：傷口護理 / 包紮機構',
    btnM3: '馬達 3：輔助監測 / 給藥機構',
    motorRotating: '馬達運轉中...',
    mapTitle: '📍 附近即時醫療與診所分佈',
    tempTitle: '體溫感測管理',
    tempStatusInit: '請點擊按鈕連接體溫計',
    tempStatusConnected: '體溫計已連線 ✓ 請按下測量鍵',
    btnConnectTemp: '啟動監測站 (連接體溫計)',
    tempUnit: '°C 攝氏溫度',
    tempTip: '請將體溫計對準額頭，按下按鈕直至嗶聲響起（到達 {threshold}°C 自動出貼）',
    btnBack: '返回主頁',
    alertTitle: '⚠️ 體溫超出正常標準',
    alertMsg: '你的體溫高於{threshold}度，現給你一塊退熱貼，並及早到附近的醫院或診所就診。',
    motorDispensing: '⚡ 體溫達標，馬達 1 (退熱貼機構) 驅動出貼中...',
    btnCloseBack: '關閉並返回',
    woundTitle: '傷口處理與處置機構',
    woundSubtitle: '患部檢視完畢後，可驅動馬達 2 發放傷口敷料或包紮耗材',
    /* ---- map: recent location & nearby facilities -------------------- */
    'map.locate': '📍 定位我的位置',
    'map.locate.locating': '定位中…',
    'map.location.updated': '已更新至你的最新位置',
    'map.location.stored': '顯示上次已知位置',
    'map.facilities.loading': '載入附近醫療機構…',
    'map.facilities.error': '無法載入附近醫療機構',
    'map.facilities.empty': '附近找不到醫療機構',
    'map.facility.medical': '醫療機構',
    'map.facility.type.hospital': '醫院',
    'map.facility.type.clinic': '診所',
    'map.facility.type.doctors': '醫生',
    'map.facility.type.pharmacy': '藥房',
    'map.facility.type.dentist': '牙醫',
    'map.popup.you': '你的位置',
    'map.popup.directions': '規劃路線',

    /* ---- wound: camera switching ------------------------------------- */
    'wound.camera.switch': '切換前後鏡頭',
    'wound.camera.switchToFront': '切換至前置鏡頭',
    'wound.camera.switchToBack': '切換至後置鏡頭',
    'wound.camera.switching': '正在切換鏡頭…',
    'wound.camera.single': '此裝置僅有一個鏡頭',
    'wound.camera.error': '無法切換鏡頭，請重試',

    /* ---- wound: AI disclaimer & provider errors ---------------------- */
    'wound.disclaimer':
      '⚠️ 本結果由 AI 影像模型自動產生，僅供參考，並非醫療診斷。請尋求專業醫療人員的評估與處置。',
    'wound.summaryLabel': 'AI 摘要：',
    'wound.error.missingKey':
      '尚未設定 Gemini 中繼或 API 金鑰。請擇一：至「設定 → 進階設定」填入已部署的中繼網址（推薦），或輸入 Google AI Studio 的金鑰（僅在支援 Gemini 的地區可用）。',
    'wound.error.relayNotConfigured':
      '中繼服務尚未設定 GEMINI_API_KEY 環境變數，請在部署平台補上後重新部署。',
    'wound.error.auth': 'Gemini API 金鑰無效或權限不足（HTTP 400/401/403）。請確認金鑰是否正確。',
    'wound.error.notFound': '找不到指定的 Gemini 模型（HTTP 404）。請確認模型名稱。',
    'wound.error.transport': '無法連線至 Gemini 服務（網路或 CORS 限制）。',
    'wound.error.timeout': 'Gemini 服務連線逾時。',
    'wound.error.http': 'Gemini 服務回應錯誤或資料格式無法解析。',
    'wound.error.busy': 'AI 服務暫時繁忙（免費 AI 額度可能暫時用盡），請稍後再試。',
    'wound.error.regionUnsupported':
      'Gemini 不支援你所在的地區直接呼叫——請部署／設定中繼（relay），並在「設定 → 進階設定」貼上其網址（傷口辨識 Relay 網址）；在此地區單憑 Gemini API 金鑰無法使用。',

    /* ---- weather: home panel & developer tools ----------------------- */
    'weather.condition.sunny': '晴朗',
    'weather.condition.cloudy': '多雲',
    'weather.condition.rainy': '下雨中',
    'weather.summary.tempRain': '{temp}°C | 降雨機率 {prob}%',
    'weather.date.loading': '📅 載入中...',
    'weather.location.macau': '📍 澳門特別行政區 (Macau)',
    'weather.aria.icon': '天氣狀態',
    'weather.action.raincoat': '領取雨衣',
    'weather.toast.raincoatDispensing': '🌧️ 天雨路滑，雨衣發放中 (馬達 3 驅動中)...',
    'weather.toast.raincoatNotNeeded': '☀️ 目前未達降雨標準，無須領取雨衣',
    'weather.dev.title': '⚡ 開發者測試：模擬天氣控制',
    'weather.dev.option.auto': '🌐 自動讀取澳門真實天氣 (預設)',
    'weather.dev.option.sunny': '☀️ 晴天 (Sun / 0% 雨)',
    'weather.dev.option.cloudy': '☁️ 多雲 (Cloudy / 20% 雨)',
    'weather.dev.option.rainy': '🌧️ 下雨 (Rainy / 90% 雨 - 解鎖雨衣發放)',
    'weather.dev.toast.sunny': '已切換為：晴天模式 ☀️',
    'weather.dev.toast.cloudy': '已切換為：多雲模式 ☁️',
    'weather.dev.toast.rainy': '已切換為：下雨模式 🌧️ (雨衣解鎖)',
    'weather.dev.hint': '僅供展示與測試使用；選「自動」會恢復讀取澳門即時天氣。',
    'weather.dev.toast.auto': '已恢復：自動讀取澳門即時天氣 🌐',

    /* ---- settings: shell / sections ---------------------------------- */
    'settings.open': '設定',
    'settings.title': '系統設定',
    'settings.close': '關閉',
    'settings.language.label': '語言',
    'settings.section.language': '語言與顯示',
    'settings.section.hardware': '健康套件硬體',
    'settings.section.wizard': '快速連接精靈',
    'settings.section.thresholds': '發燒門檻',
    'settings.wizard.step1': '檢查瀏覽器與安全來源',
    'settings.wizard.step2': '連接藍牙體溫計',
    'settings.wizard.step3': '設定出貼模組',
    'settings.wizard.step4': '驗證即時讀數與馬達',
    'settings.wizard.done': '完成並儲存',

    /* ---- settings: thermometer --------------------------------------- */
    'settings.thermometer.title': '藍牙體溫計',
    'settings.thermometer.connect': '連接 / 配對',
    'settings.thermometer.disconnect': '中斷連線',
    'settings.thermometer.forget': '忘記裝置',
    'settings.thermometer.reconnect': '重新連接',
    'settings.thermometer.name': '裝置名稱',
    'settings.thermometer.lastConnected': '上次連接',

    /* ---- settings: esp32 --------------------------------------------- */
    'settings.esp32.title': '出貼馬達模組',
    'settings.esp32.host': 'IP 位址 / 主機',
    'settings.esp32.protocol': '通訊協定',
    'settings.esp32.test': '測試連線',
    'settings.esp32.apply': '套用',
    'settings.esp32.testMotor': '測試馬達 1',
    'settings.esp32.hint':
      '瀏覽器以 no-cors 傳送指令，只能確認「已送出」，無法確認馬達是否真的轉動。',

    /* ---- settings: thresholds ---------------------------------------- */
    'settings.threshold.label': '發燒門檻 (°C)',
    'settings.threshold.reset': '重設為 37.5',
    'settings.threshold.hint': '預設 37.5°C；可接受範圍 30.0–45.0°C。',

    /* ---- settings: advanced / footer --------------------------------- */
    'settings.advanced.summary': '進階設定',
    'settings.advanced.serviceUuid': '服務 UUID',
    'settings.advanced.characteristicUuid': '特徵 UUID',
    'settings.advanced.acceptAll': '接受所有裝置',
    'settings.advanced.lockMs': '馬達按鈕鎖定 (毫秒)',
    'settings.advanced.woundBaseUrl': '傷口辨識 API 網址',
    'settings.advanced.woundBaseUrlHint':
      '需填入中繼服務（relay）網址：Render 用裸網址，如 https://your-service.onrender.com（結尾不加斜線）；Vercel 需含 /api，如 https://your-project.vercel.app/api。',
    'settings.advanced.woundModelId': '傷口辨識模型 ID',
    'settings.advanced.woundModelVersion': '模型版本',
    'settings.advanced.woundApiKey': 'API 金鑰',
    'settings.advanced.woundConfidence': '辨識信心門檻 (0–1)',
    'settings.advanced.woundProvider': '傷口辨識供應商',
    'settings.advanced.provider.gemini': 'Google Gemini（預設）',
    'settings.advanced.provider.roboflow': 'Roboflow',
    'settings.advanced.woundProviderHint':
      'Gemini 由瀏覽器直連，無需中繼服務；Roboflow 需搭配下方中繼網址與金鑰。',
    'settings.advanced.woundRelayUrl': '傷口辨識 Relay 網址',
    'settings.advanced.woundRelayUrlHint':
      '預設已預先設定託管的中繼（https://smart-care-wound-relay.onrender.com），通常不需修改；僅在你自行架設中繼時才需要取代為你的網址。設定後 Gemini 會改由中繼呼叫，瀏覽器無需 Gemini 金鑰。',
    'settings.advanced.geminiApiKey': 'Gemini API 金鑰',
    'settings.advanced.geminiApiKeyHint':
      '已設定中繼網址（Relay）時，請將此欄留空（金鑰只需放在中繼伺服器）；此處輸入的金鑰僅用於直連呼叫，且僅在 Google 支援的地區有效。金鑰僅儲存在此裝置的瀏覽器。',
    'settings.advanced.geminiModel': 'Gemini 模型',
    'settings.advanced.woundHint':
      '金鑰僅儲存在此裝置的瀏覽器；未設定時傷口檢驗會顯示離線模擬結果。',
    'settings.resetAll': '回復預設值',

    /* ---- common ------------------------------------------------------ */
    'common.save': '儲存',
    'common.cancel': '取消',
    'common.close': '關閉',
    'common.testing': '測試中…',
    'common.sending': '送出中…',
    'common.working': '處理中…',
    'common.fieldInvalid': '此欄位有誤',

    /* ---- BLE status -------------------------------------------------- */
    'ble.status.unsupported': '此瀏覽器不支援藍牙',
    'ble.status.insecure': '需要安全來源 (localhost 或 HTTPS)',
    'ble.status.disconnected': '未連接',
    'ble.status.connecting': '連線中…',
    'ble.status.connected': '已連接',
    'ble.status.error': '連線錯誤',
    'ble.status.reconnecting': '重新連線中…',

    /* ---- BLE errors -------------------------------------------------- */
    'ble.error.gatt': 'GATT 連線失敗',
    'ble.error.service': '找不到體溫計服務',
    'ble.error.characteristic': '找不到量測特徵',
    'ble.error.notify': '無法啟用通知',
    'ble.error.cancelled': '已取消配對',
    'ble.error.unknown': '未知的藍牙錯誤',

    /* ---- ESP32 status ------------------------------------------------ */
    'esp32.status.notConfigured': '尚未設定',
    'esp32.status.unknown': '尚未測試',
    'esp32.status.sent': '指令已送出 (無法驗證)',
    'esp32.status.error': '傳送失敗',

    /* ---- health kit -------------------------------------------------- */
    'healthkit.connect': '連接健康套件',
    'healthkit.indicator.connected': '健康套件已連線',
    'healthkit.indicator.partial': '部分硬體未連接',
    'healthkit.guide.secure': '請在 localhost 或 HTTPS 環境執行',
    'healthkit.guide.browser': '請使用 Chrome 或 Edge (Windows/Android)',

    /* ---- toasts / feedback ------------------------------------------- */
    'toast.esp32.sent': '已送出馬達指令 (無法確認是否執行)',
    'toast.ble.cancelled': '已取消配對',
    'toast.ble.connected': '體溫計已連接',
    'toast.ble.disconnected': '體溫計已中斷連線',
    'toast.ble.reconnectFailed': '無法自動重新連接，請手動連接',
    'toast.config.saved': '設定已儲存',
    'toast.config.reset': '已回復預設值',
    'toast.config.invalid': '設定有誤，請檢查欄位',
    'toast.lang.changed': '語言已切換',

    /* ---- errors ------------------------------------------------------ */
    'error.geolocation.denied': '無法取得定位，地圖顯示預設區域',
    'error.geolocation.unsupported': '此瀏覽器不支援定位功能',
    'error.geolocation.insecure': '定位功能需要安全連線 (HTTPS)',
    'error.geolocation.unavailable': '目前無法取得你的位置，請稍後再試',
    'error.geolocation.timeout': '定位逾時，請重試',
    'error.esp32.send': '無法送出指令（網路或內容安全政策阻擋）'
  }),

  /* ===================================================================== */
  'zh-Hans': Object.freeze({
    homeTitle: '全方位智慧健康站',
    homeSubtitle: '实时体温检测 • 多机构自动化给药 • 邻近医疗导航',
    btnNavTemp: '体温量测与退热机构',
    btnNavWound: '伤口包扎与处置机构',
    motorPanelTitle: '机构手动驱动面板 (ESP32 Wi-Fi)',
    btnM1: '马达 1：体温计 / 退热贴机构',
    btnM2: '马达 2：伤口护理 / 包扎机构',
    btnM3: '马达 3：辅助监测 / 给药机构',
    motorRotating: '马达运转中...',
    mapTitle: '📍 附近即时医疗与诊所分布',
    tempTitle: '体温感测管理',
    tempStatusInit: '请点击按钮连接体温计',
    tempStatusConnected: '体温计已连线 ✓ 请按下测量键',
    btnConnectTemp: '启动监测站 (连接体温计)',
    tempUnit: '°C 摄氏温度',
    tempTip: '请将体温计对准额头，按下按钮直至哔声响起（到达 {threshold}°C 自动出贴）',
    btnBack: '返回主页',
    alertTitle: '⚠️ 体温超出正常标准',
    alertMsg: '你的体温高于{threshold}度，现给你一块退热贴，并及早到附近的医院或诊所就诊。',
    motorDispensing: '⚡ 体温达标，马达 1 (退热贴机构) 驱动出贴中...',
    btnCloseBack: '关闭并返回',
    woundTitle: '伤口处理与处置机构',
    woundSubtitle: '患部检视完毕后，可驱动马达 2 发放伤口敷料或包扎耗材',
    /* ---- map: recent location & nearby facilities -------------------- */
    'map.locate': '📍 定位我的位置',
    'map.locate.locating': '定位中…',
    'map.location.updated': '已更新至你的最新位置',
    'map.location.stored': '显示上次已知位置',
    'map.facilities.loading': '加载附近医疗机构…',
    'map.facilities.error': '无法加载附近医疗机构',
    'map.facilities.empty': '附近找不到医疗机构',
    'map.facility.medical': '医疗机构',
    'map.facility.type.hospital': '医院',
    'map.facility.type.clinic': '诊所',
    'map.facility.type.doctors': '医生',
    'map.facility.type.pharmacy': '药房',
    'map.facility.type.dentist': '牙医',
    'map.popup.you': '你的位置',
    'map.popup.directions': '规划路线',

    /* ---- wound: camera switching ------------------------------------- */
    'wound.camera.switch': '切换前后摄像头',
    'wound.camera.switchToFront': '切换至前置摄像头',
    'wound.camera.switchToBack': '切换至后置摄像头',
    'wound.camera.switching': '正在切换摄像头…',
    'wound.camera.single': '此设备仅有一个摄像头',
    'wound.camera.error': '无法切换摄像头，请重试',

    /* ---- wound: AI disclaimer & provider errors ---------------------- */
    'wound.disclaimer':
      '⚠️ 本结果由 AI 图像模型自动生成，仅供参考，并非医疗诊断。请寻求专业医疗人员的评估与处置。',
    'wound.summaryLabel': 'AI 摘要：',
    'wound.error.missingKey':
      '尚未设置 Gemini 中继或 API 密钥。请任选其一：前往「设置 → 高级设置」填入已部署的中继网址（推荐），或输入 Google AI Studio 的密钥（仅在支持 Gemini 的地区可用）。',
    'wound.error.relayNotConfigured':
      '中继服务尚未设置 GEMINI_API_KEY 环境变量，请在部署平台补上后重新部署。',
    'wound.error.auth': 'Gemini API 密钥无效或权限不足（HTTP 400/401/403）。请确认密钥是否正确。',
    'wound.error.notFound': '找不到指定的 Gemini 模型（HTTP 404）。请确认模型名称。',
    'wound.error.transport': '无法连接至 Gemini 服务（网络或 CORS 限制）。',
    'wound.error.timeout': 'Gemini 服务连接超时。',
    'wound.error.http': 'Gemini 服务响应错误或数据格式无法解析。',
    'wound.error.busy': 'AI 服务暂时繁忙（免费 AI 额度可能暂时用尽），请稍后再试。',
    'wound.error.regionUnsupported':
      'Gemini 不支持你所在的地区直接调用——请部署／设置中继（relay），并在「设置 → 高级设置」粘贴其网址（伤口识别 Relay 网址）；在此地区仅凭 Gemini API 密钥无法使用。',

    /* ---- weather: home panel & developer tools ----------------------- */
    'weather.condition.sunny': '晴朗',
    'weather.condition.cloudy': '多云',
    'weather.condition.rainy': '下雨中',
    'weather.summary.tempRain': '{temp}°C | 降雨概率 {prob}%',
    'weather.date.loading': '📅 加载中...',
    'weather.location.macau': '📍 澳门特别行政区 (Macau)',
    'weather.aria.icon': '天气状态',
    'weather.action.raincoat': '领取雨衣',
    'weather.toast.raincoatDispensing': '🌧️ 天雨路滑，雨衣发放中 (马达 3 驱动中)...',
    'weather.toast.raincoatNotNeeded': '☀️ 目前未达降雨标准，无须领取雨衣',
    'weather.dev.title': '⚡ 开发者测试：模拟天气控制',
    'weather.dev.option.auto': '🌐 自动读取澳门真实天气 (默认)',
    'weather.dev.option.sunny': '☀️ 晴天 (Sun / 0% 雨)',
    'weather.dev.option.cloudy': '☁️ 多云 (Cloudy / 20% 雨)',
    'weather.dev.option.rainy': '🌧️ 下雨 (Rainy / 90% 雨 - 解锁雨衣发放)',
    'weather.dev.toast.sunny': '已切换为：晴天模式 ☀️',
    'weather.dev.toast.cloudy': '已切换为：多云模式 ☁️',
    'weather.dev.toast.rainy': '已切换为：下雨模式 🌧️ (雨衣解锁)',
    'weather.dev.hint': '仅供展示与测试使用；选「自动」会恢复读取澳门实时天气。',
    'weather.dev.toast.auto': '已恢复：自动读取澳门实时天气 🌐',

    'settings.open': '设置',
    'settings.title': '系统设置',
    'settings.close': '关闭',
    'settings.language.label': '语言',
    'settings.section.language': '语言与显示',
    'settings.section.hardware': '健康套件硬件',
    'settings.section.wizard': '快速连接向导',
    'settings.section.thresholds': '发烧门槛',
    'settings.wizard.step1': '检查浏览器与安全来源',
    'settings.wizard.step2': '连接蓝牙体温计',
    'settings.wizard.step3': '设置出贴模块',
    'settings.wizard.step4': '验证实时读数与马达',
    'settings.wizard.done': '完成并保存',

    'settings.thermometer.title': '蓝牙体温计',
    'settings.thermometer.connect': '连接 / 配对',
    'settings.thermometer.disconnect': '断开连接',
    'settings.thermometer.forget': '忘记设备',
    'settings.thermometer.reconnect': '重新连接',
    'settings.thermometer.name': '设备名称',
    'settings.thermometer.lastConnected': '上次连接',

    'settings.esp32.title': '出贴马达模块',
    'settings.esp32.host': 'IP 地址 / 主机',
    'settings.esp32.protocol': '通讯协议',
    'settings.esp32.test': '测试连接',
    'settings.esp32.apply': '应用',
    'settings.esp32.testMotor': '测试马达 1',
    'settings.esp32.hint': '浏览器以 no-cors 发送指令，只能确认「已发送」，无法确认马达是否真的转动。',

    'settings.threshold.label': '发烧门槛 (°C)',
    'settings.threshold.reset': '重置为 37.5',
    'settings.threshold.hint': '默认 37.5°C；可接受范围 30.0–45.0°C。',

    'settings.advanced.summary': '高级设置',
    'settings.advanced.serviceUuid': '服务 UUID',
    'settings.advanced.characteristicUuid': '特征 UUID',
    'settings.advanced.acceptAll': '接受所有设备',
    'settings.advanced.lockMs': '马达按钮锁定 (毫秒)',
    'settings.advanced.woundBaseUrl': '伤口识别 API 网址',
    'settings.advanced.woundBaseUrlHint':
      '需填入中继服务（relay）网址：Render 用裸网址，如 https://your-service.onrender.com（结尾不加斜线）；Vercel 需含 /api，如 https://your-project.vercel.app/api。',
    'settings.advanced.woundModelId': '伤口识别模型 ID',
    'settings.advanced.woundModelVersion': '模型版本',
    'settings.advanced.woundApiKey': 'API 密钥',
    'settings.advanced.woundConfidence': '识别置信度门槛 (0–1)',
    'settings.advanced.woundProvider': '伤口识别供应商',
    'settings.advanced.provider.gemini': 'Google Gemini（默认）',
    'settings.advanced.provider.roboflow': 'Roboflow',
    'settings.advanced.woundProviderHint':
      'Gemini 由浏览器直连，无需中继服务；Roboflow 需搭配下方中继网址与密钥。',
    'settings.advanced.woundRelayUrl': '伤口识别 Relay 网址',
    'settings.advanced.woundRelayUrlHint':
      '默认已预先设置托管的中继（https://smart-care-wound-relay.onrender.com），通常无需修改；仅在你自行搭建中继时才需要替换为你的网址。设置后 Gemini 将改由中继调用，浏览器无需 Gemini 密钥。',
    'settings.advanced.geminiApiKey': 'Gemini API 密钥',
    'settings.advanced.geminiApiKeyHint':
      '已设置中继网址（Relay）时，请将此栏留空（密钥只需放在中继服务器）；此处输入的密钥仅用于直连调用，且仅在 Google 支持的地区有效。密钥仅存储在此设备的浏览器。',
    'settings.advanced.geminiModel': 'Gemini 模型',
    'settings.advanced.woundHint': '密钥仅存储在此设备的浏览器；未设置时伤口检验会显示离线模拟结果。',
    'settings.resetAll': '恢复默认值',

    'common.save': '保存',
    'common.cancel': '取消',
    'common.close': '关闭',
    'common.testing': '测试中…',
    'common.sending': '发送中…',
    'common.working': '处理中…',
    'common.fieldInvalid': '此字段有误',

    'ble.status.unsupported': '此浏览器不支持蓝牙',
    'ble.status.insecure': '需要安全来源 (localhost 或 HTTPS)',
    'ble.status.disconnected': '未连接',
    'ble.status.connecting': '连接中…',
    'ble.status.connected': '已连接',
    'ble.status.error': '连接错误',
    'ble.status.reconnecting': '重新连接中…',

    'ble.error.gatt': 'GATT 连接失败',
    'ble.error.service': '找不到体温计服务',
    'ble.error.characteristic': '找不到测量特征',
    'ble.error.notify': '无法启用通知',
    'ble.error.cancelled': '已取消配对',
    'ble.error.unknown': '未知的蓝牙错误',

    'esp32.status.notConfigured': '尚未设置',
    'esp32.status.unknown': '尚未测试',
    'esp32.status.sent': '指令已发送 (无法验证)',
    'esp32.status.error': '发送失败',

    'healthkit.connect': '连接健康套件',
    'healthkit.indicator.connected': '健康套件已连接',
    'healthkit.indicator.partial': '部分硬件未连接',
    'healthkit.guide.secure': '请在 localhost 或 HTTPS 环境运行',
    'healthkit.guide.browser': '请使用 Chrome 或 Edge (Windows/Android)',

    'toast.esp32.sent': '已发送马达指令 (无法确认是否执行)',
    'toast.ble.cancelled': '已取消配对',
    'toast.ble.connected': '体温计已连接',
    'toast.ble.disconnected': '体温计已断开连接',
    'toast.ble.reconnectFailed': '无法自动重新连接，请手动连接',
    'toast.config.saved': '设置已保存',
    'toast.config.reset': '已恢复默认值',
    'toast.config.invalid': '设置有误，请检查字段',
    'toast.lang.changed': '语言已切换',

    'error.geolocation.denied': '无法获取定位，地图显示默认区域',
    'error.geolocation.unsupported': '此浏览器不支持定位功能',
    'error.geolocation.insecure': '定位功能需要安全连接 (HTTPS)',
    'error.geolocation.unavailable': '目前无法获取你的位置，请稍后再试',
    'error.geolocation.timeout': '定位超时，请重试',
    'error.esp32.send': '无法发送指令（网络或内容安全策略阻挡）'
  }),

  /* ===================================================================== */
  en: Object.freeze({
    homeTitle: 'Smart Healthcare Station',
    homeSubtitle: 'Real-time Body Temp • Automated Dispenser • Nearby Navigation',
    btnNavTemp: 'Temp Monitor & Cooling Patch',
    btnNavWound: 'Wound Dressing Mechanism',
    motorPanelTitle: 'Manual Motor Actuators (ESP32 Wi-Fi)',
    btnM1: 'Motor 1: Thermometer / Cooling Patch',
    btnM2: 'Motor 2: Wound Care / Dressing',
    btnM3: 'Motor 3: Aux Monitor / Medicine',
    motorRotating: 'Motor running...',
    mapTitle: '📍 Nearby Medical Facilities & Clinics',
    tempTitle: 'Temperature Monitor',
    tempStatusInit: 'Please connect thermometer',
    tempStatusConnected: 'Thermometer connected ✓ Press measure button',
    btnConnectTemp: 'Start Station (Connect Thermometer)',
    tempUnit: '°C Celsius',
    tempTip: 'Aim thermometer at forehead and press (auto-dispenses at {threshold}°C)',
    btnBack: 'Back to Home',
    alertTitle: '⚠️ Temperature Above Normal',
    alertMsg:
      'Your temperature is above {threshold}°C. A cooling patch has been dispensed. Please visit a nearby clinic promptly.',
    motorDispensing: '⚡ Threshold reached, Motor 1 dispensing patch...',
    btnCloseBack: 'Close and Return',
    woundTitle: 'Wound Care & Dressing',
    woundSubtitle: 'Trigger Motor 2 to dispense wound care dressing materials',
    /* ---- map: recent location & nearby facilities -------------------- */
    'map.locate': '📍 Show my location',
    'map.locate.locating': 'Locating…',
    'map.location.updated': 'Updated to your latest location',
    'map.location.stored': 'Showing last known location',
    'map.facilities.loading': 'Loading nearby facilities…',
    'map.facilities.error': 'Could not load nearby facilities',
    'map.facilities.empty': 'No nearby medical facilities found',
    'map.facility.medical': 'Medical facility',
    'map.facility.type.hospital': 'Hospital',
    'map.facility.type.clinic': 'Clinic',
    'map.facility.type.doctors': 'Doctor',
    'map.facility.type.pharmacy': 'Pharmacy',
    'map.facility.type.dentist': 'Dentist',
    'map.popup.you': 'You are here',
    'map.popup.directions': 'Directions',

    /* ---- wound: camera switching ------------------------------------- */
    'wound.camera.switch': 'Switch camera',
    'wound.camera.switchToFront': 'Switch to front camera',
    'wound.camera.switchToBack': 'Switch to back camera',
    'wound.camera.switching': 'Switching camera…',
    'wound.camera.single': 'Only one camera available',
    'wound.camera.error': 'Could not switch camera, please retry',

    /* ---- wound: AI disclaimer & provider errors ---------------------- */
    'wound.disclaimer':
      '⚠️ This result is generated by an AI vision model for informational reference only and is NOT a medical diagnosis. Please consult a qualified healthcare professional.',
    'wound.summaryLabel': 'AI summary:',
    'wound.error.missingKey':
      'No Gemini relay or API key set. Do one of the following: open Settings → Advanced and paste your deployed relay URL (recommended), or enter a Google AI Studio key (works only from a supported region).',
    'wound.error.relayNotConfigured':
      'The relay is missing its GEMINI_API_KEY environment variable. Set it in your hosting dashboard and redeploy.',
    'wound.error.auth':
      'Gemini API key invalid or insufficient permissions (HTTP 400/401/403). Please verify the key.',
    'wound.error.notFound':
      'The requested Gemini model was not found (HTTP 404). Please check the model name.',
    'wound.error.transport': 'Could not reach the Gemini service (network or CORS restriction).',
    'wound.error.timeout': 'The Gemini service request timed out.',
    'wound.error.http': 'Gemini service error, or the response format could not be parsed.',
    'wound.error.busy':
      'The AI service is temporarily busy (the free AI tier may be temporarily out of quota). Please try again shortly.',
    'wound.error.regionUnsupported':
      'Gemini does not support direct calls from your region — deploy/configure the relay and paste its URL in Settings → Advanced (Wound detection relay URL); a Gemini API key alone will not work in this region.',

    /* ---- weather: home panel & developer tools ----------------------- */
    'weather.condition.sunny': 'Sunny',
    'weather.condition.cloudy': 'Cloudy',
    'weather.condition.rainy': 'Rainy',
    'weather.summary.tempRain': '{temp}°C | Rain chance {prob}%',
    'weather.date.loading': '📅 Loading...',
    'weather.location.macau': '📍 Macau SAR (Macau)',
    'weather.aria.icon': 'Weather condition',
    'weather.action.raincoat': 'Get Raincoat',
    'weather.toast.raincoatDispensing': '🌧️ Slippery when wet — dispensing raincoat (Motor 3 running)...',
    'weather.toast.raincoatNotNeeded': '☀️ Rain threshold not met — no raincoat needed',
    'weather.dev.title': '⚡ Developer test: simulate weather',
    'weather.dev.option.auto': '🌐 Auto-fetch live Macau weather (default)',
    'weather.dev.option.sunny': '☀️ Sunny (Sun / 0% rain)',
    'weather.dev.option.cloudy': '☁️ Cloudy (Cloudy / 20% rain)',
    'weather.dev.option.rainy': '🌧️ Rainy (Rainy / 90% rain - unlock raincoat)',
    'weather.dev.toast.sunny': 'Switched to: Sunny mode ☀️',
    'weather.dev.toast.cloudy': 'Switched to: Cloudy mode ☁️',
    'weather.dev.toast.rainy': 'Switched to: Rainy mode 🌧️ (raincoat unlocked)',
    'weather.dev.hint': 'For demo/testing only — Auto restores live Macau weather.',
    'weather.dev.toast.auto': 'Restored: auto-fetching live Macau weather 🌐',

    'settings.open': 'Settings',
    'settings.title': 'Settings',
    'settings.close': 'Close',
    'settings.language.label': 'Language',
    'settings.section.language': 'Language & Display',
    'settings.section.hardware': 'Health Kit Hardware',
    'settings.section.wizard': 'Quick Connect Wizard',
    'settings.section.thresholds': 'Thresholds',
    'settings.wizard.step1': 'Check browser & secure context',
    'settings.wizard.step2': 'Connect the Bluetooth thermometer',
    'settings.wizard.step3': 'Configure the dispenser module',
    'settings.wizard.step4': 'Verify a live reading & the motor',
    'settings.wizard.done': 'Save and finish',

    'settings.thermometer.title': 'Bluetooth Thermometer',
    'settings.thermometer.connect': 'Connect / Pair',
    'settings.thermometer.disconnect': 'Disconnect',
    'settings.thermometer.forget': 'Forget device',
    'settings.thermometer.reconnect': 'Reconnect',
    'settings.thermometer.name': 'Device name',
    'settings.thermometer.lastConnected': 'Last connected',

    'settings.esp32.title': 'Dispenser Module',
    'settings.esp32.host': 'Host / IP',
    'settings.esp32.protocol': 'Protocol',
    'settings.esp32.test': 'Test connection',
    'settings.esp32.apply': 'Apply',
    'settings.esp32.testMotor': 'Test Motor 1',
    'settings.esp32.hint':
      'Commands are sent with mode:"no-cors", so only "sent" can be confirmed — never that the motor actually moved.',

    'settings.threshold.label': 'Fever threshold (°C)',
    'settings.threshold.reset': 'Reset to 37.5',
    'settings.threshold.hint': 'Default 37.5 °C; accepted range 30.0–45.0 °C.',

    'settings.advanced.summary': 'Advanced',
    'settings.advanced.serviceUuid': 'Service UUID',
    'settings.advanced.characteristicUuid': 'Characteristic UUID',
    'settings.advanced.acceptAll': 'Accept all devices',
    'settings.advanced.lockMs': 'Motor button lock (ms)',
    'settings.advanced.woundBaseUrl': 'Wound detection API URL',
    'settings.advanced.woundBaseUrlHint':
      'A relay is required. Render: bare origin, e.g. https://your-service.onrender.com (no trailing slash). Vercel: must include /api, e.g. https://your-project.vercel.app/api.',
    'settings.advanced.woundModelId': 'Wound detection model ID',
    'settings.advanced.woundModelVersion': 'Model version',
    'settings.advanced.woundApiKey': 'API key',
    'settings.advanced.woundConfidence': 'Confidence threshold (0–1)',
    'settings.advanced.woundProvider': 'Wound detection provider',
    'settings.advanced.provider.gemini': 'Google Gemini (default)',
    'settings.advanced.provider.roboflow': 'Roboflow',
    'settings.advanced.woundProviderHint':
      'Gemini runs browser-direct with no relay required; Roboflow uses the relay URL and key below.',
    'settings.advanced.woundRelayUrl': 'Wound detection relay URL',
    'settings.advanced.woundRelayUrlHint':
      'A hosted relay is already preconfigured by default (https://smart-care-wound-relay.onrender.com) and normally does not need changing; only replace it if you self-host your own relay. When set, Gemini is called via the relay and no Gemini key is needed in the browser.',
    'settings.advanced.geminiApiKey': 'Gemini API key',
    'settings.advanced.geminiApiKeyHint':
      'Leave this field EMPTY when a relay URL is set (the key then lives only on the relay server); a key entered here is used only for direct calls and only works from Google-supported regions. It is stored only in this browser.',
    'settings.advanced.geminiModel': 'Gemini model',
    'settings.advanced.woundHint':
      'The key is stored only in this browser; when unset, wound detection shows an offline simulated result.',
    'settings.resetAll': 'Reset to defaults',

    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.testing': 'Testing…',
    'common.sending': 'Sending…',
    'common.working': 'Working…',
    'common.fieldInvalid': 'Invalid value',

    'ble.status.unsupported': 'Bluetooth not supported',
    'ble.status.insecure': 'Secure context required (localhost or HTTPS)',
    'ble.status.disconnected': 'Disconnected',
    'ble.status.connecting': 'Connecting…',
    'ble.status.connected': 'Connected',
    'ble.status.error': 'Connection error',
    'ble.status.reconnecting': 'Reconnecting…',

    'ble.error.gatt': 'GATT connection failed',
    'ble.error.service': 'Thermometer service not found',
    'ble.error.characteristic': 'Measurement characteristic not found',
    'ble.error.notify': 'Could not start notifications',
    'ble.error.cancelled': 'Pairing cancelled',
    'ble.error.unknown': 'Unknown Bluetooth error',

    'esp32.status.notConfigured': 'Not configured',
    'esp32.status.unknown': 'Not tested',
    'esp32.status.sent': 'Command sent (unverified)',
    'esp32.status.error': 'Send failed',

    'healthkit.connect': 'Connect Health Kit',
    'healthkit.indicator.connected': 'Health Kit connected',
    'healthkit.indicator.partial': 'Some hardware disconnected',
    'healthkit.guide.secure': 'Run this app on localhost or HTTPS',
    'healthkit.guide.browser': 'Use Chrome or Edge (Windows/Android)',

    'toast.esp32.sent': 'Motor command sent (execution unverified)',
    'toast.ble.cancelled': 'Pairing cancelled',
    'toast.ble.connected': 'Thermometer connected',
    'toast.ble.disconnected': 'Thermometer disconnected',
    'toast.ble.reconnectFailed': 'Could not reconnect automatically; please connect manually',
    'toast.config.saved': 'Settings saved',
    'toast.config.reset': 'Defaults restored',
    'toast.config.invalid': 'Invalid settings — check the highlighted fields',
    'toast.lang.changed': 'Language changed',

    'error.geolocation.denied': 'Location unavailable; showing default area',
    'error.geolocation.unsupported': 'Geolocation is not supported by this browser',
    'error.geolocation.insecure': 'Location requires a secure (HTTPS) connection',
    'error.geolocation.unavailable': 'Your location is currently unavailable; please try again',
    'error.geolocation.timeout': 'Location request timed out; please retry',
    'error.esp32.send': 'Could not send the command (blocked by network or content-security policy)'
  }),

  /* ===================================================================== */
  pt: Object.freeze({
    homeTitle: 'Posto de Saúde Inteligente',
    homeSubtitle: 'Medição de Temp. • Mecanismos Automáticos • Navegação Médica',
    btnNavTemp: 'Monitor de Temp. e Adesivo',
    btnNavWound: 'Tratamento de Feridas',
    motorPanelTitle: 'Painel de Controlo dos Motores (ESP32 Wi-Fi)',
    btnM1: 'Motor 1: Termómetro / Adesivo Refrescante',
    btnM2: 'Motor 2: Tratamento de Feridas',
    btnM3: 'Motor 3: Monitorização / Medicamentos',
    motorRotating: 'Motor em movimento...',
    mapTitle: '📍 Clínicas e Hospitais nas Proximidades',
    tempTitle: 'Gestão de Temperatura',
    tempStatusInit: 'Ligue o termómetro',
    tempStatusConnected: 'Termómetro ligado ✓ Prima para medir',
    btnConnectTemp: 'Iniciar Estação (Ligar Termómetro)',
    tempUnit: '°C Graus Celsius',
    tempTip: 'Aponte para a testa e prima (dispensa automática a {threshold}°C)',
    btnBack: 'Voltar ao Início',
    alertTitle: '⚠️ Temperatura Acima do Normal',
    alertMsg:
      'A sua temperatura está acima de {threshold}°C. Foi fornecido um adesivo refrescante. Por favor, consulte um médico.',
    motorDispensing: '⚡ Limite atingido, Motor 1 a libertar adesivo...',
    btnCloseBack: 'Fechar e Voltar',
    woundTitle: 'Tratamento de Feridas',
    woundSubtitle: 'Acione o Motor 2 para dispensar pensos e materiais de tratamento',
    /* ---- map: recent location & nearby facilities -------------------- */
    'map.locate': '📍 Mostrar a minha localização',
    'map.locate.locating': 'A localizar…',
    'map.location.updated': 'Atualizado para a sua localização mais recente',
    'map.location.stored': 'A mostrar a última localização conhecida',
    'map.facilities.loading': 'A carregar unidades próximas…',
    'map.facilities.error': 'Não foi possível carregar as unidades',
    'map.facilities.empty': 'Nenhuma unidade de saúde encontrada',
    'map.facility.medical': 'Unidade de saúde',
    'map.facility.type.hospital': 'Hospital',
    'map.facility.type.clinic': 'Clínica',
    'map.facility.type.doctors': 'Médico',
    'map.facility.type.pharmacy': 'Farmácia',
    'map.facility.type.dentist': 'Dentista',
    'map.popup.you': 'A sua localização',
    'map.popup.directions': 'Direções',

    /* ---- wound: camera switching ------------------------------------- */
    'wound.camera.switch': 'Alternar câmara',
    'wound.camera.switchToFront': 'Mudar para câmara frontal',
    'wound.camera.switchToBack': 'Mudar para câmara traseira',
    'wound.camera.switching': 'A alternar câmara…',
    'wound.camera.single': 'Apenas uma câmara disponível',
    'wound.camera.error': 'Não foi possível alternar a câmara',

    /* ---- wound: AI disclaimer & provider errors ---------------------- */
    'wound.disclaimer':
      '⚠️ Este resultado é gerado por um modelo de visão de IA apenas para referência informativa e NÃO constitui um diagnóstico médico. Consulte um profissional de saúde qualificado.',
    'wound.summaryLabel': 'Resumo da IA:',
    'wound.error.missingKey':
      'Nenhum relay ou chave de API Gemini definidos. Escolha uma opção: abra Definições → Avançado e cole o URL do relay implementado (recomendado), ou introduza uma chave do Google AI Studio (só funciona numa região suportada).',
    'wound.error.relayNotConfigured':
      'O relay não tem a variável de ambiente GEMINI_API_KEY definida. Defina-a no painel de alojamento e volte a implementar.',
    'wound.error.auth':
      'Chave de API Gemini inválida ou permissões insuficientes (HTTP 400/401/403). Verifique a chave.',
    'wound.error.notFound':
      'O modelo Gemini pedido não foi encontrado (HTTP 404). Verifique o nome do modelo.',
    'wound.error.transport':
      'Não foi possível contactar o serviço Gemini (restrição de rede ou CORS).',
    'wound.error.timeout': 'O pedido ao serviço Gemini excedeu o tempo limite.',
    'wound.error.http': 'Erro do serviço Gemini, ou o formato da resposta não pôde ser analisado.',
    'wound.error.busy':
      'O serviço de IA está temporariamente ocupado (o nível gratuito de IA pode estar temporariamente sem quota). Tente novamente dentro de instantes.',
    'wound.error.regionUnsupported':
      'O Gemini não suporta chamadas diretas a partir da sua região — implemente/configure o relay e cole o URL em Definições → Avançado (URL do relay de deteção de feridas); uma chave de API Gemini, por si só, não funciona nesta região.',

    /* ---- weather: home panel & developer tools ----------------------- */
    'weather.condition.sunny': 'Céu limpo',
    'weather.condition.cloudy': 'Nublado',
    'weather.condition.rainy': 'A chover',
    'weather.summary.tempRain': '{temp}°C | Prob. de chuva {prob}%',
    'weather.date.loading': '📅 A carregar...',
    'weather.location.macau': '📍 Região Administrativa Especial de Macau (Macau)',
    'weather.aria.icon': 'Estado do tempo',
    'weather.action.raincoat': 'Obter capa de chuva',
    'weather.toast.raincoatDispensing': '🌧️ Piso molhado — a dispensar capa de chuva (Motor 3 em funcionamento)...',
    'weather.toast.raincoatNotNeeded': '☀️ Limite de chuva não atingido — não é necessária capa de chuva',
    'weather.dev.title': '⚡ Teste de programador: simular tempo',
    'weather.dev.option.auto': '🌐 Obter automaticamente o tempo real de Macau (predefinição)',
    'weather.dev.option.sunny': '☀️ Sol (Sun / 0% chuva)',
    'weather.dev.option.cloudy': '☁️ Nublado (Cloudy / 20% chuva)',
    'weather.dev.option.rainy': '🌧️ Chuva (Rainy / 90% chuva - desbloquear capa de chuva)',
    'weather.dev.toast.sunny': 'Alterado para: modo Sol ☀️',
    'weather.dev.toast.cloudy': 'Alterado para: modo Nublado ☁️',
    'weather.dev.toast.rainy': 'Alterado para: modo Chuva 🌧️ (capa de chuva desbloqueada)',
    'weather.dev.hint': 'Apenas para demonstração/testes — Auto repõe o tempo real de Macau.',
    'weather.dev.toast.auto': 'Restaurado: tempo real de Macau automático 🌐',

    'settings.open': 'Definições',
    'settings.title': 'Definições',
    'settings.close': 'Fechar',
    'settings.language.label': 'Idioma',
    'settings.section.language': 'Idioma e ecrã',
    'settings.section.hardware': 'Hardware do Health Kit',
    'settings.section.wizard': 'Assistente de ligação rápida',
    'settings.section.thresholds': 'Limites',
    'settings.wizard.step1': 'Verificar o navegador e o contexto seguro',
    'settings.wizard.step2': 'Ligar o termómetro Bluetooth',
    'settings.wizard.step3': 'Configurar o módulo dispensador',
    'settings.wizard.step4': 'Verificar a leitura e o motor',
    'settings.wizard.done': 'Guardar e concluir',

    'settings.thermometer.title': 'Termómetro Bluetooth',
    'settings.thermometer.connect': 'Ligar / Emparelhar',
    'settings.thermometer.disconnect': 'Desligar',
    'settings.thermometer.forget': 'Esquecer dispositivo',
    'settings.thermometer.reconnect': 'Religar',
    'settings.thermometer.name': 'Nome do dispositivo',
    'settings.thermometer.lastConnected': 'Última ligação',

    'settings.esp32.title': 'Módulo Dispensador',
    'settings.esp32.host': 'Anfitrião / IP',
    'settings.esp32.protocol': 'Protocolo',
    'settings.esp32.test': 'Testar ligação',
    'settings.esp32.apply': 'Aplicar',
    'settings.esp32.testMotor': 'Testar Motor 1',
    'settings.esp32.hint':
      'Os comandos são enviados com mode:"no-cors"; só é possível confirmar "enviado", nunca que o motor se moveu.',

    'settings.threshold.label': 'Limite de febre (°C)',
    'settings.threshold.reset': 'Redefinir para 37.5',
    'settings.threshold.hint': 'Predefinição 37,5 °C; intervalo aceite 30,0–45,0 °C.',

    'settings.advanced.summary': 'Avançado',
    'settings.advanced.serviceUuid': 'UUID do serviço',
    'settings.advanced.characteristicUuid': 'UUID da característica',
    'settings.advanced.acceptAll': 'Aceitar todos os dispositivos',
    'settings.advanced.lockMs': 'Bloqueio do botão (ms)',
    'settings.advanced.woundBaseUrl': 'URL da API de deteção de feridas',
    'settings.advanced.woundBaseUrlHint':
      'É necessário um relay. Render: origem simples, p. ex. https://your-service.onrender.com (sem barra final). Vercel: tem de incluir /api, p. ex. https://your-project.vercel.app/api.',
    'settings.advanced.woundModelId': 'ID do modelo de deteção de feridas',
    'settings.advanced.woundModelVersion': 'Versão do modelo',
    'settings.advanced.woundApiKey': 'Chave de API',
    'settings.advanced.woundConfidence': 'Limiar de confiança (0–1)',
    'settings.advanced.woundProvider': 'Fornecedor de deteção de feridas',
    'settings.advanced.provider.gemini': 'Google Gemini (predefinição)',
    'settings.advanced.provider.roboflow': 'Roboflow',
    'settings.advanced.woundProviderHint':
      'O Gemini funciona diretamente no navegador, sem relay; o Roboflow usa o URL e a chave abaixo.',
    'settings.advanced.woundRelayUrl': 'URL do relay de deteção de feridas',
    'settings.advanced.woundRelayUrlHint':
      'Já existe um relay alojado preconfigurado por predefinição (https://smart-care-wound-relay.onrender.com) e normalmente não precisa de ser alterado; substitua-o apenas se alojar o seu próprio relay. Quando definido, o Gemini é chamado através do relay e não é necessária nenhuma chave Gemini no navegador.',
    'settings.advanced.geminiApiKey': 'Chave de API Gemini',
    'settings.advanced.geminiApiKeyHint':
      'Deixe este campo VAZIO quando um URL de relay estiver definido (a chave fica então apenas no servidor de relay); uma chave aqui introduzida é usada apenas para chamadas diretas e só funciona em regiões suportadas pela Google. É guardada apenas neste navegador.',
    'settings.advanced.geminiModel': 'Modelo Gemini',
    'settings.advanced.woundHint':
      'A chave é guardada apenas neste navegador; quando não definida, a deteção mostra um resultado simulado offline.',
    'settings.resetAll': 'Restaurar predefinições',

    'common.save': 'Guardar',
    'common.cancel': 'Cancelar',
    'common.close': 'Fechar',
    'common.testing': 'A testar…',
    'common.sending': 'A enviar…',
    'common.working': 'A processar…',
    'common.fieldInvalid': 'Valor inválido',

    'ble.status.unsupported': 'Bluetooth não suportado',
    'ble.status.insecure': 'Contexto seguro necessário (localhost ou HTTPS)',
    'ble.status.disconnected': 'Desligado',
    'ble.status.connecting': 'A ligar…',
    'ble.status.connected': 'Ligado',
    'ble.status.error': 'Erro de ligação',
    'ble.status.reconnecting': 'A religar…',

    'ble.error.gatt': 'Falha na ligação GATT',
    'ble.error.service': 'Serviço do termómetro não encontrado',
    'ble.error.characteristic': 'Característica de medição não encontrada',
    'ble.error.notify': 'Não foi possível ativar as notificações',
    'ble.error.cancelled': 'Emparelhamento cancelado',
    'ble.error.unknown': 'Erro de Bluetooth desconhecido',

    'esp32.status.notConfigured': 'Não configurado',
    'esp32.status.unknown': 'Não testado',
    'esp32.status.sent': 'Comando enviado (não verificado)',
    'esp32.status.error': 'Falha ao enviar',

    'healthkit.connect': 'Ligar o Health Kit',
    'healthkit.indicator.connected': 'Health Kit ligado',
    'healthkit.indicator.partial': 'Hardware parcialmente ligado',
    'healthkit.guide.secure': 'Execute em localhost ou HTTPS',
    'healthkit.guide.browser': 'Utilize o Chrome ou Edge (Windows/Android)',

    'toast.esp32.sent': 'Comando enviado (execução não verificada)',
    'toast.ble.cancelled': 'Emparelhamento cancelado',
    'toast.ble.connected': 'Termómetro ligado',
    'toast.ble.disconnected': 'Termómetro desligado',
    'toast.ble.reconnectFailed': 'Não foi possível religar automaticamente; ligue manualmente',
    'toast.config.saved': 'Definições guardadas',
    'toast.config.reset': 'Predefinições restauradas',
    'toast.config.invalid': 'Definições inválidas — verifique os campos assinalados',
    'toast.lang.changed': 'Idioma alterado',

    'error.geolocation.denied': 'Localização indisponível; área predefinida',
    'error.geolocation.unsupported': 'A geolocalização não é suportada por este navegador',
    'error.geolocation.insecure': 'A localização requer uma ligação segura (HTTPS)',
    'error.geolocation.unavailable': 'A sua localização está indisponível neste momento; tente novamente',
    'error.geolocation.timeout': 'O pedido de localização excedeu o tempo; tente novamente',
    'error.esp32.send': 'Não foi possível enviar o comando (rede ou política de segurança de conteúdo)'
  })
});

export default STRINGS;
