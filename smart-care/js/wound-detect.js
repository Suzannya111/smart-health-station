// js/wound-detect.js

import { getConfig } from './config.js';

// ==========================================
// 1. 設定參數
// ==========================================

/** 請求逾時（毫秒）：避免網路卡住時無限等待。 */
const FETCH_TIMEOUT_MS = 30000;
/** 信心門檻後備值（實際以 config.woundAi.confidenceThreshold 為準）。 */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;

/**
 * 無法取得真實預測結果的原因，用於選擇對應的離線模擬提示。
 * @readonly
 */
const FALLBACK_REASON = Object.freeze({
  OFFLINE: 'offline', // navigator.onLine === false
  NO_KEY: 'no-key', // 未設定 / 設定不完整的 API 金鑰
  TIMEOUT: 'timeout', // AbortController 逾時
  TRANSPORT: 'transport', // TypeError：網路中斷或 CORS 被阻擋
  AUTH: 'auth', // HTTP 401 / 403：金鑰無效（JSON 錯誤）
  NOT_FOUND: 'not-found', // HTTP 404：找不到模型或版本
  HTTP: 'http', // 其他非 2xx 狀態，或 2xx 但內容非 JSON
  BLOCKED: 'blocked' // 非 JSON（HTML）回應：防火牆 / Cloudflare 封鎖頁
});

let videoStream = null;

/**
 * 傷口辨識的錯誤型別：攜帶 `reason`（FALLBACK_REASON）以便分流處理。
 */
class WoundDetectionError extends Error {
  /**
   * @param {string} reason
   * @param {string} message
   */
  constructor(reason, message) {
    super(message);
    this.name = 'WoundDetectionError';
    this.reason = reason;
  }
}

/**
 * 讀取傷口辨識設定。config.js 為單一來源（不再硬編碼端點 / 金鑰）。
 * @returns {{ baseUrl: string, modelId: string, version: string,
 *             apiKey: string, confidenceThreshold: number }}
 */
function getWoundAiConfig() {
  let ai = {};
  try {
    ai = getConfig()?.woundAi || {};
  } catch (error) {
    console.warn('[wound] 無法讀取設定，改用預設值。', error);
  }

  const threshold = Number(ai.confidenceThreshold);
  return {
    baseUrl: String(ai.baseUrl || '').trim().replace(/\/+$/, ''),
    modelId: String(ai.modelId || '').trim(),
    version: String(ai.version || '').trim(),
    apiKey: String(ai.apiKey || '').trim(),
    confidenceThreshold: Number.isFinite(threshold) ? threshold : DEFAULT_CONFIDENCE_THRESHOLD
  };
}

/**
 * 判斷回應內容是否為 HTML / 防火牆封鎖頁（例如 Cloudflare block page），
 * 而非 API 的 JSON 錯誤。用於區分「金鑰無效」與「連線被防火牆阻擋」。
 * @param {string} contentType 回應的 Content-Type（呼叫端已轉為小寫）
 * @param {string} text 回應內文（原始字串）
 * @returns {boolean}
 */
function looksLikeBlockPage(contentType, text) {
  const body = typeof text === 'string' ? text : '';
  if (String(contentType || '').includes('text/html')) return true;

  if (body.trimStart().startsWith('<')) return true;

  const lower = body.toLowerCase();
  return (
    lower.includes('sorry, you have been blocked') ||
    lower.includes('unable to access') ||
    lower.includes('attention required') ||
    lower.includes('cloudflare')
  );
}

/**
 * 呼叫 Roboflow serverless 端點取得預測結果。
 * 失敗時一律丟出帶 `reason` 的 {@link WoundDetectionError}。
 * @param {{ baseUrl: string, modelId: string, version: string, apiKey: string }} cfg
 * @param {string} base64Data 純 base64（不含 data URI 前綴）
 * @returns {Promise<{ predictions?: Array<object> }>}
 */
async function requestPredictions(cfg, base64Data) {
  // 離線優先判斷：不必浪費一次註定失敗的請求。
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new WoundDetectionError(FALLBACK_REASON.OFFLINE, '目前離線');
  }

  // 未設定金鑰或設定不完整時不送出請求（改走離線模擬）。
  if (!cfg.apiKey) {
    throw new WoundDetectionError(FALLBACK_REASON.NO_KEY, '未設定 API 金鑰');
  }
  if (!cfg.baseUrl || !cfg.modelId || !cfg.version) {
    throw new WoundDetectionError(FALLBACK_REASON.NO_KEY, '傷口辨識 API 設定不完整');
  }

  // 以標準 query 傳遞金鑰，避免觸發 OPTIONS preflight；
  // 直接呼叫（不使用任何第三方 CORS 代理）。
  const endpoint =
    `${cfg.baseUrl}/${cfg.modelId}/${cfg.version}?api_key=${encodeURIComponent(cfg.apiKey)}`;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  if (controller) timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: base64Data,
      ...(controller ? { signal: controller.signal } : {})
    });
  } catch (error) {
    if (error && (error.name === 'AbortError' || error.code === 20)) {
      throw new WoundDetectionError(FALLBACK_REASON.TIMEOUT, `請求逾時（${FETCH_TIMEOUT_MS} ms）`);
    }
    // TypeError === 網路中斷或 CORS 被阻擋（原始 "Failed to fetch" 來源）。
    throw new WoundDetectionError(
      FALLBACK_REASON.TRANSPORT,
      '無法連線至傷口辨識服務（網路或 CORS 限制）'
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  // 內文僅讀取一次：成功路徑解析 JSON，失敗路徑用來判斷是否為 HTML / 封鎖頁。
  let text = '';
  try {
    text = await response.text();
  } catch (error) {
    text = '';
  }

  const contentType = String(response.headers?.get('content-type') || '').toLowerCase();
  if (looksLikeBlockPage(contentType, text)) {
    throw new WoundDetectionError(
      FALLBACK_REASON.BLOCKED,
      `AI 服務的防火牆阻擋了連線（HTTP ${response.status}）`
    );
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new WoundDetectionError(FALLBACK_REASON.AUTH, `API 金鑰無效（HTTP ${response.status}）`);
    }
    if (response.status === 404) {
      throw new WoundDetectionError(
        FALLBACK_REASON.NOT_FOUND,
        '找不到指定的模型或版本（HTTP 404）'
      );
    }
    throw new WoundDetectionError(FALLBACK_REASON.HTTP, `伺服器回應錯誤（HTTP ${response.status}）`);
  }

  // 2xx：必須是合法 JSON 才視為成功，維持原有回傳契約。
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new WoundDetectionError(FALLBACK_REASON.HTTP, '伺服器回傳的資料格式無法解析');
  }
}

/**
 * 產生符合 Roboflow 回應形狀的離線模擬結果，供畫面渲染使用。
 * 形狀：`{ predictions: [{ x, y, width, height, class, confidence }], simulated: true }`
 * @param {number} width  目前畫布寬度（像素）
 * @param {number} height 目前畫布高度（像素）
 * @returns {{ simulated: true, predictions: Array<{x:number,y:number,width:number,height:number,class:string,confidence:number}> }}
 */
function buildMockResult(width, height) {
  const w = Math.round(width * 0.34);
  const h = Math.round(height * 0.34);
  return {
    simulated: true,
    predictions: [
      { x: Math.round(width * 0.5), y: Math.round(height * 0.55), width: w, height: h, class: 'wound', confidence: 0.82 },
      { x: Math.round(width * 0.28), y: Math.round(height * 0.32), width: Math.round(w * 0.6), height: Math.round(h * 0.6), class: 'wound', confidence: 0.61 }
    ]
  };
}

/**
 * 依失敗原因回傳可讀的帶頭提示（Traditional Chinese，與檔案既有風格一致）。
 * @param {string} reason
 * @returns {string}
 */
function fallbackHeadline(reason) {
  switch (reason) {
    case FALLBACK_REASON.OFFLINE:
      return '📴 目前離線，無法連線至 AI 服務。';
    case FALLBACK_REASON.NO_KEY:
      return '🔑 尚未設定傷口辨識 API 金鑰。';
    case FALLBACK_REASON.TIMEOUT:
      return '⏱️ AI 服務連線逾時。';
    case FALLBACK_REASON.AUTH:
      return '🔒 API 金鑰無效或已失效。';
    case FALLBACK_REASON.BLOCKED:
      return '🚫 AI 服務的防火牆阻擋了連線（HTTP 403）。這通常不是金鑰問題——請改用其他網路或代理服務後再試。';
    case FALLBACK_REASON.NOT_FOUND:
      return '🧭 找不到指定的傷口辨識模型。';
    case FALLBACK_REASON.TRANSPORT:
      return '📡 無法連線至 AI 服務（網路或 CORS 限制）。';
    default:
      return '⚠️ AI 服務暫時無法使用。';
  }
}

// ==========================================
// 2. 初始化元件與事件綁定
// ==========================================
export function initWoundDetection() {
  const video = document.getElementById('woundVideo');
  const canvas = document.getElementById('woundCanvas');
  const btnStartCamera = document.getElementById('btnStartCamera');
  const btnCaptureAnalyze = document.getElementById('btnCaptureAnalyze');
  const woundStatusText = document.getElementById('woundStatusText');

  if (!video || !btnStartCamera || !btnCaptureAnalyze) {
    console.warn("傷口辨識 DOM 尚未就緒");
    return;
  }

  // --- 開啟 / 重啟相機 ---
  btnStartCamera.addEventListener('click', async () => {
    if (canvas) canvas.style.display = "none";
    if (video) video.style.display = "block";

    woundStatusText.textContent = "正在請求相機權限...";
    woundStatusText.style.color = "#4b5563";

    try {
      if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
      }

      videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });

      video.srcObject = videoStream;
      btnCaptureAnalyze.disabled = false;
      btnStartCamera.textContent = "🔄 重啟相機";
      woundStatusText.textContent = "相機已就緒！對準患部後點擊「拍照並檢驗傷口」。";
      woundStatusText.style.color = "#2563eb";
    } catch (err) {
      console.error("相機失敗:", err);
      woundStatusText.textContent = "無法啟動相機，請檢查權限。";
      woundStatusText.style.color = "#dc2626";
    }
  });

  // --- 拍照與檢測 ---
  btnCaptureAnalyze.addEventListener('click', async () => {
    if (!video.videoWidth || !video.videoHeight) return;

    // 1. 截取影格
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 取得 base64 純內容
    const base64Data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

    woundStatusText.textContent = "AI 正在分析影像特徵...";
    woundStatusText.style.color = "#d97706";
    btnCaptureAnalyze.disabled = true;

    try {
      const cfg = getWoundAiConfig();

      // 2. 取得預測結果：連線失敗時改用「離線模擬」，永不顯示原始 "Failed to fetch"。
      let result;
      let simulatedReason = null;
      try {
        result = await requestPredictions(cfg, base64Data);
        console.log("辨識成功，回傳數據:", result);
      } catch (error) {
        simulatedReason =
          error instanceof WoundDetectionError ? error.reason : FALLBACK_REASON.TRANSPORT;
        console.warn(`[wound] 改用離線模擬（原因：${simulatedReason}）:`, error);
        result = buildMockResult(canvas.width, canvas.height);
      }

      // 3. 過濾出符合門檻的傷口
      const validPredictions = (result.predictions || []).filter(
        (p) => Number(p.confidence) >= cfg.confidenceThreshold
      );

      // 4. 切換顯示畫布並畫框（模擬結果以琥珀色標示，區別於真實的紅框）
      canvas.style.display = "block";
      video.style.display = "none";

      ctx.lineWidth = 3;
      ctx.strokeStyle = result.simulated ? "#d97706" : "#ef4444";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = "bold 16px sans-serif";

      validPredictions.forEach((pred) => {
        const x = pred.x - pred.width / 2;
        const y = pred.y - pred.height / 2;
        ctx.strokeRect(x, y, pred.width, pred.height);
        ctx.fillText(`${pred.class} (${Math.round(pred.confidence * 100)}%)`, x, y > 20 ? y - 5 : y + 20);
      });

      // 5a. 模擬結果：明確標示，且「不」驅動實體機構（避免依假結果出料）。
      if (result.simulated) {
        woundStatusText.textContent =
          `${fallbackHeadline(simulatedReason)}以離線模擬結果顯示 ${validPredictions.length} 處疑似傷口（僅供示範，未驅動機構）。`;
        woundStatusText.style.color = "#d97706";
        return;
      }

      // 5b. 真實結果：若有傷口，啟動馬達 2 (G5/G18)
      if (validPredictions.length > 0) {
        woundStatusText.textContent = `⚠️ 偵測到 ${validPredictions.length} 處傷口患部！正在發放敷料 (馬達 2 啟動)...`;
        woundStatusText.style.color = "#dc2626";

        const motorSuccess = await triggerMotor2();
        if (motorSuccess) {
          woundStatusText.textContent = "✅ 包紮材料發放完成，請取用並消毒護理。";
          woundStatusText.style.color = "#16a34a";
        } else {
          woundStatusText.textContent = "⚠️ 已標記傷口，但連線 ESP32 失敗，請確認 Wi-Fi 連線。";
          woundStatusText.style.color = "#dc2626";
        }
      } else {
        woundStatusText.textContent = "ℹ️ 未檢測到明顯傷口，無需出料。";
        woundStatusText.style.color = "#4b5563";
      }

    } catch (error) {
      // 僅在渲染 / 流程本身出錯時才會到這裡（傳輸錯誤已由離線模擬吸收）。
      console.error("傷口辨識流程錯誤:", error);
      woundStatusText.textContent = "檢測失敗：無法完成傷口辨識流程，請稍後重試。";
      woundStatusText.style.color = "#dc2626";
    } finally {
      btnCaptureAnalyze.disabled = false;
    }
  });
}

// ==========================================
// 3. 驅動 ESP32 馬達 2
// ==========================================
/**
 * 驅動傷口護理馬達 2（`m2/fwd`）。
 * 端點一律取自 `config.esp32.baseUrl`（與設定頁面儲存的來源一致），
 * 不再用硬編碼 IP 覆寫使用者設定；未設定時直接回傳 false。
 * @returns {Promise<boolean>} 請求是否成功送出（不代表馬達已實際轉動）
 */
async function triggerMotor2() {
  let baseUrl = '';
  try {
    baseUrl = String(getConfig()?.esp32?.baseUrl || '').replace(/\/+$/, '');
  } catch (error) {
    console.warn('[wound] 無法讀取 ESP32 設定:', error);
  }

  if (!baseUrl) {
    console.warn('馬達 2 未設定：請先在設定中設定出貼馬達模組的 IP / 主機。');
    return false;
  }

  const targetUrl = `${baseUrl}/m2/fwd`;

  try {
    const res = await fetch(targetUrl, {
      method: "GET",
      mode: "cors"
    });
    return res.ok;
  } catch (err) {
    console.error("ESP32 連線失敗:", err);
    return false;
  }
}
