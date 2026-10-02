// js/wound-detect.js

import { getConfig, DEFAULT_WOUND_RELAY_URL } from './config.js';
import { i18n } from './i18n/index.js';

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
  CONFIG: 'config', // 缺少必要的設定（例如未填 Gemini API 金鑰）
  NO_KEY: 'no-key', // 未設定 / 設定不完整的 API 金鑰
  TIMEOUT: 'timeout', // AbortController 逾時
  TRANSPORT: 'transport', // TypeError：網路中斷或 CORS 被阻擋
  AUTH: 'auth', // HTTP 400 / 401 / 403：金鑰無效或權限不足
  REGION: 'region', // HTTP 400 + FAILED_PRECONDITION：Gemini 不支援此地區直連
  NOT_FOUND: 'not-found', // HTTP 404：找不到模型或版本
  HTTP: 'http', // 其他非 2xx 狀態（含 429 / 5xx），或 2xx 但內容非 JSON
  BUSY: 'busy', // HTTP 503：上游 Gemini 暫時過載（高負載），建議稍後重試
  BLOCKED: 'blocked' // 非 JSON（HTML）回應：防火牆 / Cloudflare 封鎖頁
});

let videoStream = null;
/** 目前使用的鏡頭方向：'environment'（後置）或 'user'（前置）。 */
let currentFacing = 'environment';
/** 裝置是否偵測到兩個以上的鏡頭（由 enumerateDevices 判斷）。 */
let switchAvailable = false;

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
 * @returns {{ provider: string, baseUrl: string, modelId: string, version: string,
 *             apiKey: string, confidenceThreshold: number,
 *             geminiModel: string, geminiApiKey: string, relayUrl: string }}
 */
function getWoundAiConfig() {
  let ai = {};
  try {
    ai = getConfig()?.woundAi || {};
  } catch (error) {
    console.warn('[wound] 無法讀取設定，改用預設值。', error);
  }

  const threshold = Number(ai.confidenceThreshold);
  const provider = String(ai.provider || '').trim().toLowerCase();
  return {
    provider: provider === 'roboflow' ? 'roboflow' : 'gemini',
    baseUrl: String(ai.baseUrl || '').trim().replace(/\/+$/, ''),
    modelId: String(ai.modelId || '').trim(),
    version: String(ai.version || '').trim(),
    apiKey: String(ai.apiKey || '').trim(),
    confidenceThreshold: Number.isFinite(threshold) ? threshold : DEFAULT_CONFIDENCE_THRESHOLD,
    geminiModel: String(ai.geminiModel || '').trim() || 'gemini-3.8-flash',
    geminiApiKey: String(ai.geminiApiKey || '').trim(),
    // 中繼網址：去除空白與結尾斜線；空值時回退至內建的託管中繼（防禦性）。
    relayUrl:
      String(ai.relayUrl || '').trim().replace(/\/+$/, '') || DEFAULT_WOUND_RELAY_URL
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
 * 依設定的 baseUrl 產生候選端點前綴（去重、保留設定的值優先）。
 * - 設定的 baseUrl 本身（已去除結尾斜線）。
 * - 若結尾不是 `/api`，再加上 `baseUrl + '/api'`，相容 Vercel 的函式路徑。
 * 讓「裸網址（Render）」與「含 /api（Vercel）」兩種形式都能自動嘗試，
 * 使用者無須知道後端實際部署方式。
 * @param {string} baseUrl
 * @returns {string[]}
 */
function buildCandidateBaseUrls(baseUrl) {
  const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '');
  const candidates = [trimmed];
  if (!/\/api$/i.test(trimmed)) candidates.push(`${trimmed}/api`);
  // 去重並保留順序（設定的值優先）。
  return candidates.filter((value, index) => value && candidates.indexOf(value) === index);
}

/** Gemini 端點前綴（金鑰以 query 參數傳遞，避免觸發被拒的 preflight）。 */
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Gemini 直連影像分析逾時（毫秒）。 */
const GEMINI_TIMEOUT_MS = 30000;
/** 中繼模式逾時（毫秒）：Render 免費方案冷啟動約 30–60 秒，故放寬至 60 秒。 */
const RELAY_TIMEOUT_MS = 60000;

/**
 * Gemini 影像分析指令：要求以可機器解析的 JSON 回傳，並以 0–1000 正規化座標框出傷口。
 * 明確要求「找不到就回傳空陣列」，避免模型硬湊結果。
 */
const GEMINI_PROMPT = [
  '你是傷口影像標註助手。請檢視這張圖片，找出所有「可見的傷口或皮膚病變」區域。',
  '針對每個區域回傳一個物件：label（簡短標籤）、confidence（0–1 的信心分數）、',
  'box（邊界框，格式為 [ymin, xmin, ymax, xmax]，數值為 0–1000 的正規化整數）。',
  '另外回傳 summary（簡短說明）與 disclaimer（醫療免責聲明字串）。',
  '若畫面中沒有可見的傷口或病變，請回傳空的 findings 陣列，並在 summary 說明未發現。'
].join(' ');

/** Gemini responseSchema（僅支援大寫型別列舉）。 */
const GEMINI_RESPONSE_SCHEMA = Object.freeze({
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    disclaimer: { type: 'STRING' },
    findings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
          box: { type: 'ARRAY', items: { type: 'NUMBER' } }
        },
        required: ['label', 'confidence', 'box']
      }
    }
  },
  required: ['summary', 'findings']
});

/** 將任意數值夾在 [0, 1]；非有限數值視為 0。 */
function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

/**
 * 將單一 Gemini finding 轉為內部預測形狀（中心點 x/y + 寬高，皆為 0–1 正規化），
 * 與渲染程式使用的 `x,y,width,height,class,confidence` 契約一致。
 * @param {object} finding
 * @returns {{ x:number, y:number, width:number, height:number, class:string, confidence:number }|null}
 */
function geminiFindingToPrediction(finding) {
  const box = Array.isArray(finding?.box) ? finding.box : null;
  if (!box || box.length < 4) return null;

  const [rawYmin, rawXmin, rawYmax, rawXmax] = box.map(Number);
  if (![rawYmin, rawXmin, rawYmax, rawXmax].every(Number.isFinite)) return null;

  // Gemini 2.x 偵測慣例：[ymin, xmin, ymax, xmax]，正規化至 0–1000。
  // 先確保順序，再轉為中心點 + 寬高，最後夾在 [0,1]。
  const ymin = Math.min(rawYmin, rawYmax);
  const ymax = Math.max(rawYmin, rawYmax);
  const xmin = Math.min(rawXmin, rawXmax);
  const xmax = Math.max(rawXmin, rawXmax);

  const label = String(finding?.label || '').trim() || 'lesion';

  return {
    x: clamp01((xmin + xmax) / 2 / 1000),
    y: clamp01((ymin + ymax) / 2 / 1000),
    width: clamp01((xmax - xmin) / 1000),
    height: clamp01((ymax - ymin) / 1000),
    class: label,
    confidence: clamp01(finding?.confidence)
  };
}

/**
 * 將 Gemini 的 JSON 回應整併為內部結果形狀（與 Roboflow 路徑外部契約一致），
 * 並附帶 `provider` 標記（渲染端據此得知座標為正規化）。
 * @param {object} payload
 * @returns {{ provider:'gemini', predictions:Array<object>, summary:string, disclaimer:string }}
 */
function mapGeminiResult(payload) {
  const findings = Array.isArray(payload?.findings) ? payload.findings : [];
  const predictions = findings.map(geminiFindingToPrediction).filter(Boolean);
  return {
    provider: 'gemini',
    predictions,
    summary: typeof payload?.summary === 'string' ? payload.summary : '',
    disclaimer: typeof payload?.disclaimer === 'string' ? payload.disclaimer : ''
  };
}

/**
 * 安全解析中繼服務回傳的 JSON 錯誤內文；非 JSON 或讀取失敗時回傳空物件，絕不丟錯。
 * @param {Response} response
 * @returns {Promise<{ error?: string, message?: string }>}
 */
async function readRelayError(response) {
  try {
    const text = await response.text();
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

/**
 * 以 Google Gemini 分析影像。
 * - 直連模式（relayUrl 為空）：金鑰以 query 參數傳遞，僅在使用者自行提供時使用。
 * - 中繼模式（relayUrl 非空）：改呼叫中繼服務，金鑰由伺服器端附加，用戶端不持有金鑰。
 * 失敗時一律丟出帶 `reason` 的 {@link WoundDetectionError}。
 * @param {string} imageBase64 純 base64（不含 data URI 前綴）
 * @param {{ geminiModel: string, geminiApiKey: string, relayUrl: string }} cfg
 * @returns {Promise<{ provider:'gemini', predictions:Array<object>, summary:string, disclaimer:string }>}
 */
async function analyzeWithGemini(imageBase64, cfg) {
  // 離線優先：與 Roboflow 路徑一致，不浪費一次註定失敗的請求。
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new WoundDetectionError(FALLBACK_REASON.OFFLINE, '目前離線');
  }

  const relayUrl = String(cfg.relayUrl || '').trim().replace(/\/+$/, '');
  const relayMode = relayUrl !== '';
  const apiKey = String(cfg.geminiApiKey || '').trim();

  // 只有在直連模式才需要（且必須有）用戶端金鑰；中繼模式沒有用戶端金鑰。
  if (!relayMode && !apiKey) {
    // 缺少金鑰屬於「設定」問題，必須對應 CONFIG，絕不可回報為 TRANSPORT。
    throw new WoundDetectionError(FALLBACK_REASON.CONFIG, i18n.t('wound.error.missingKey'));
  }

  const model = String(cfg.geminiModel || '').trim() || 'gemini-3.8-flash';
  const url = relayMode
    ? `${relayUrl}/gemini-generate?model=${encodeURIComponent(model)}`
    : `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        parts: [
          { text: GEMINI_PROMPT },
          { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
      temperature: 0
    }
  };

  // 中繼模式使用較長逾時（Render 免費方案冷啟動約 30–60 秒）。
  const timeoutMs = relayMode ? RELAY_TIMEOUT_MS : GEMINI_TIMEOUT_MS;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  if (controller) timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {})
    });
  } catch (error) {
    if (error && (error.name === 'AbortError' || error.code === 20)) {
      throw new WoundDetectionError(FALLBACK_REASON.TIMEOUT, i18n.t('wound.error.timeout'));
    }
    // TypeError === 網路中斷或 CORS 被阻擋（原始 "Failed to fetch" 來源）。
    throw new WoundDetectionError(FALLBACK_REASON.TRANSPORT, i18n.t('wound.error.transport'));
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response.ok) {
    // 中繼專屬錯誤對應，優先於一般 HTTP 對應（內文以安全方式解析，非 JSON 也不丟錯）。
    if (relayMode) {
      const relayError = await readRelayError(response);
      if (response.status === 500 && relayError.error === 'server_misconfigured') {
        throw new WoundDetectionError(
          FALLBACK_REASON.CONFIG,
          i18n.t('wound.error.relayNotConfigured')
        );
      }
      if (response.status === 504 && relayError.error === 'upstream_timeout') {
        throw new WoundDetectionError(FALLBACK_REASON.TIMEOUT, i18n.t('wound.error.timeout'));
      }
      if (response.status === 502 && relayError.error === 'relay_error') {
        throw new WoundDetectionError(FALLBACK_REASON.HTTP, i18n.t('wound.error.http'));
      }
    }
    // 503：上游 Gemini 暫時過載（高負載）——中繼透傳與直連皆對應 BUSY，
    // 提示使用者稍後再試（與其他 5xx 的 HTTP 對應區分）。
    if (response.status === 503) {
      throw new WoundDetectionError(FALLBACK_REASON.BUSY, i18n.t('wound.error.busy'));
    }
    // 直連模式的 400：Google 會以 FAILED_PRECONDITION 表示「地區不支援」，
    // 這不是金鑰問題，必須與 AUTH 區分，避免誤導使用者。內文只讀取一次且絕不因非 JSON 丟錯。
    if (!relayMode && response.status === 400) {
      const geminiError = await readRelayError(response);
      const apiError =
        geminiError && typeof geminiError.error === 'object' ? geminiError.error : {};
      const apiStatus = String(apiError.status || '');
      const apiMessage = String(apiError.message || '').toLowerCase();
      if (apiStatus === 'FAILED_PRECONDITION' || apiMessage.includes('location is not supported')) {
        throw new WoundDetectionError(
          FALLBACK_REASON.REGION,
          i18n.t('wound.error.regionUnsupported')
        );
      }
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new WoundDetectionError(FALLBACK_REASON.AUTH, i18n.t('wound.error.auth'));
    }
    if (response.status === 404) {
      throw new WoundDetectionError(FALLBACK_REASON.NOT_FOUND, i18n.t('wound.error.notFound'));
    }
    // 429 / 5xx 與其他非 2xx 狀態。
    throw new WoundDetectionError(FALLBACK_REASON.HTTP, i18n.t('wound.error.http'));
  }

  // 內文僅讀取一次，2xx 但非 JSON 時對應 HTTP。
  let text = '';
  try {
    text = await response.text();
  } catch (error) {
    text = '';
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new WoundDetectionError(FALLBACK_REASON.HTTP, i18n.t('wound.error.http'));
  }

  const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new WoundDetectionError(FALLBACK_REASON.HTTP, i18n.t('wound.error.http'));
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new WoundDetectionError(FALLBACK_REASON.HTTP, i18n.t('wound.error.http'));
  }

  return mapGeminiResult(parsed);
}

/**
 * 呼叫 Roboflow serverless 端點取得預測結果。
 * 失敗時一律丟出帶 `reason` 的 {@link WoundDetectionError}。
 * @param {{ provider: string, baseUrl: string, modelId: string, version: string, apiKey: string }} cfg
 * @param {string} base64Data 純 base64（不含 data URI 前綴）
 * @returns {Promise<{ predictions?: Array<object> }>}
 */
async function requestPredictions(cfg, base64Data) {
  // 離線優先判斷：不必浪費一次註定失敗的請求。
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new WoundDetectionError(FALLBACK_REASON.OFFLINE, '目前離線');
  }

  // 依供應商分流：'gemini' 走瀏覽器直連；其餘（含 'roboflow' / 舊資料 / 未知）維持既有路徑。
  if (cfg.provider === 'gemini') {
    return analyzeWithGemini(base64Data, cfg);
  }

  // 未設定金鑰或設定不完整時不送出請求（改走離線模擬）。
  if (!cfg.apiKey) {
    throw new WoundDetectionError(FALLBACK_REASON.NO_KEY, '未設定 API 金鑰');
  }
  if (!cfg.baseUrl || !cfg.modelId || !cfg.version) {
    throw new WoundDetectionError(FALLBACK_REASON.NO_KEY, '傷口辨識 API 設定不完整');
  }

  // 依設定值產生候選端點，自動相容裸網址（Render）與含 `/api`（Vercel）兩種形式。
  // 以標準 query 傳遞金鑰，避免觸發 OPTIONS preflight；
  // 直接呼叫（不使用任何第三方 CORS 代理）。
  const candidates = buildCandidateBaseUrls(cfg.baseUrl);
  const query = `?api_key=${encodeURIComponent(cfg.apiKey)}`;

  let response = null;
  /** 最近一次收到的 404 / 405 回應（所有候選皆如此時仍可對應 NOT_FOUND）。 */
  let lastPathMissResponse = null;
  /** 最近一次連線層的錯誤（TypeError / AbortError）。 */
  let lastError = null;

  for (let i = 0; i < candidates.length; i += 1) {
    const endpoint = `${candidates[i]}/${cfg.modelId}/${cfg.version}${query}`;

    // 每個候選各自擁有 30s 逾時，避免前一次的計時器影響下一次嘗試。
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    if (controller) timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let attemptResponse;
    try {
      attemptResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: base64Data,
        ...(controller ? { signal: controller.signal } : {})
      });
    } catch (error) {
      // TypeError === 網路中斷或 CORS 被阻擋（原始 "Failed to fetch" 來源）；換下一個候選。
      lastError = error;
      continue;
    } finally {
      if (timer) clearTimeout(timer);
    }

    // 404 / 405 代表此 base 形式的路徑不存在，換下一個候選端點再試。
    if (attemptResponse.status === 404 || attemptResponse.status === 405) {
      lastPathMissResponse = attemptResponse;
      lastError = null;
      continue;
    }

    // 其他任何狀態（含 401/403 與其他 4xx/5xx）即採用此回應，交後續對應處理。
    response = attemptResponse;
    break;
  }

  // 若無「確定」的回應，退回最後一次的 404/405（保留 NOT_FOUND 對應）。
  if (!response) response = lastPathMissResponse;

  // 所有候選都在連線層失敗（被拒或因逾時中止）→ 保留原本的 TRANSPORT / TIMEOUT 行為。
  if (!response) {
    if (lastError && (lastError.name === 'AbortError' || lastError.code === 20)) {
      throw new WoundDetectionError(FALLBACK_REASON.TIMEOUT, `請求逾時（${FETCH_TIMEOUT_MS} ms）`);
    }
    // TypeError === 網路中斷或 CORS 被阻擋（原始 "Failed to fetch" 來源）。
    throw new WoundDetectionError(
      FALLBACK_REASON.TRANSPORT,
      '無法連線至傷口辨識服務（網路或 CORS 限制）'
    );
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
    case FALLBACK_REASON.CONFIG:
      return `⚙️ ${i18n.t('wound.error.missingKey')}`;
    case FALLBACK_REASON.NO_KEY:
      return '🔑 尚未設定傷口辨識 API 金鑰。';
    case FALLBACK_REASON.TIMEOUT:
      return '⏱️ AI 服務連線逾時。';
    case FALLBACK_REASON.AUTH:
      return '🔒 API 金鑰無效或已失效。';
    case FALLBACK_REASON.REGION:
      return `🌍 ${i18n.t('wound.error.regionUnsupported')}`;
    case FALLBACK_REASON.BLOCKED:
      return '🚫 AI 服務的防火牆阻擋了連線（HTTP 403）。這通常不是金鑰問題——請改用其他網路或代理服務後再試。';
    case FALLBACK_REASON.NOT_FOUND:
      return '🧭 找不到指定的傷口辨識模型。';
    case FALLBACK_REASON.TRANSPORT:
      return '📡 無法連線至 AI 服務（網路或 CORS 限制）。';
    case FALLBACK_REASON.BUSY:
      return `⏳ ${i18n.t('wound.error.busy')}`;
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
  const btnSwitchCamera = document.getElementById('btnSwitchCamera');
  const woundStatusText = document.getElementById('woundStatusText');

  if (!video || !btnStartCamera || !btnCaptureAnalyze) {
    console.warn("傷口辨識 DOM 尚未就緒");
    return;
  }

  /**
   * 取得（或重新取得）相機串流。可重複呼叫以切換鏡頭。
   * @param {'environment'|'user'} facing 目標鏡頭方向。
   * @param {{ plainFacingMode?: boolean }} [options] plainFacingMode 為 true 時
   *        改用純字串 facingMode（後備路徑，相容不支援 { ideal } 的裝置）。
   * @returns {Promise<MediaStream>}
   */
  async function startCamera(facing, { plainFacingMode = false } = {}) {
    // 1. 先停止舊軌道：部分裝置會因此拒絕第二次請求或回傳同一個鏡頭。
    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
      videoStream = null;
    }

    // 2. 取得新串流（預設使用 { ideal }，避免桌機的 OverconstrainedError）。
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: plainFacingMode ? facing : { ideal: facing },
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    });

    // 3. 掛載串流；iOS Safari 需要重新指定 srcObject 並明確呼叫 play()。
    video.srcObject = videoStream;
    await video.play().catch(() => {});

    // 4. 僅前置鏡頭預覽鏡像；擷取畫布維持原始像素（不做鏡像）。
    video.classList.toggle('is-mirrored', facing === 'user');

    // 5. 更新狀態，串流就緒後才允許拍照檢驗。
    currentFacing = facing;
    btnCaptureAnalyze.disabled = false;
    return videoStream;
  }

  /** 依目前鏡頭與可用性更新切換鈕的動態標題 / 無障礙標籤。 */
  function applySwitchText() {
    if (!btnSwitchCamera) return;
    if (!switchAvailable) {
      const singleLabel = i18n.t('wound.camera.single');
      btnSwitchCamera.title = singleLabel;
      btnSwitchCamera.setAttribute('aria-label', singleLabel);
      return;
    }
    const label = i18n.t(
      currentFacing === 'environment' ? 'wound.camera.switchToFront' : 'wound.camera.switchToBack'
    );
    btnSwitchCamera.title = label;
    btnSwitchCamera.setAttribute('aria-label', label);
  }

  /** 偵測可用鏡頭數量，據此啟用 / 停用切換鈕。 */
  async function refreshSwitchAvailability() {
    if (!btnSwitchCamera) return;

    // 非安全來源（navigator.mediaDevices 未定義）時保持停用。
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
      switchAvailable = false;
      btnSwitchCamera.disabled = true;
      applySwitchText();
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      switchAvailable = devices.filter(device => device.kind === 'videoinput').length >= 2;
    } catch (error) {
      console.warn("[wound] 無法列舉裝置:", error);
      switchAvailable = false;
    }

    // 少於兩個鏡頭：保持停用並顯示「僅有一個鏡頭」提示。
    // 有多個鏡頭：只有在相機串流已就緒時才啟用，避免尚未開鏡就誤觸。
    btnSwitchCamera.disabled = !switchAvailable || !videoStream;
    applySwitchText();
  }

  // --- 開啟 / 重啟相機 ---
  btnStartCamera.addEventListener('click', async () => {
    if (canvas) canvas.style.display = "none";
    if (video) video.style.display = "block";

    woundStatusText.textContent = "正在請求相機權限...";
    woundStatusText.style.color = "#4b5563";

    try {
      await startCamera(currentFacing);

      btnStartCamera.textContent = "🔄 重啟相機";
      woundStatusText.textContent = "相機已就緒！對準患部後點擊「拍照並檢驗傷口」。";
      woundStatusText.style.color = "#2563eb";

      // 取得權限後 enumerateDevices 才會回傳完整清單，於此重新偵測。
      await refreshSwitchAvailability();
    } catch (err) {
      console.error("相機失敗:", err);
      woundStatusText.textContent = "無法啟動相機，請檢查權限。";
      woundStatusText.style.color = "#dc2626";
    }
  });

  // --- 切換前後鏡頭 ---
  if (btnSwitchCamera) {
    btnSwitchCamera.addEventListener('click', async () => {
      if (!videoStream) return;

      const previousFacing = currentFacing;
      const nextFacing = currentFacing === 'environment' ? 'user' : 'environment';

      btnSwitchCamera.disabled = true;
      btnCaptureAnalyze.disabled = true;
      woundStatusText.textContent = i18n.t('wound.camera.switching');
      woundStatusText.style.color = "#4b5563";

      try {
        try {
          await startCamera(nextFacing);
        } catch (error) {
          // { ideal } 在部分裝置仍可能失敗：以純字串 facingMode 再試一次。
          if (error && (error.name === 'OverconstrainedError' || error.name === 'NotFoundError')) {
            await startCamera(nextFacing, { plainFacingMode: true });
          } else {
            throw error;
          }
        }

        woundStatusText.textContent = "相機已就緒！對準患部後點擊「拍照並檢驗傷口」。";
        woundStatusText.style.color = "#2563eb";
      } catch (error) {
        console.error("切換鏡頭失敗:", error);

        // 新鏡頭失敗時還原舊鏡頭，避免預覽畫面全黑。
        try {
          await startCamera(previousFacing);
        } catch (restoreError) {
          console.error("回復鏡頭失敗:", restoreError);
        }

        woundStatusText.textContent = i18n.t('wound.camera.error');
        woundStatusText.style.color = "#dc2626";
      } finally {
        // 先解除切換鈕鎖定，再依鏡頭數量 / 串流狀態校正。
        btnSwitchCamera.disabled = false;
        await refreshSwitchAvailability();
      }
    });

    // 初始化：偵測鏡頭能力，並在語言切換時更新動態標籤。
    refreshSwitchAvailability();
    i18n.onLanguageChange(applySwitchText);
  }

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

      // Gemini 回傳的方框為 [0,1] 正規化座標，需換算為畫布像素；
      // Roboflow 路徑已是像素座標，維持不變。
      const isNormalized = result.provider === 'gemini';

      validPredictions.forEach((pred) => {
        const centerX = isNormalized ? pred.x * canvas.width : pred.x;
        const centerY = isNormalized ? pred.y * canvas.height : pred.y;
        const boxWidth = isNormalized ? pred.width * canvas.width : pred.width;
        const boxHeight = isNormalized ? pred.height * canvas.height : pred.height;
        const x = centerX - boxWidth / 2;
        const y = centerY - boxHeight / 2;
        ctx.strokeRect(x, y, boxWidth, boxHeight);
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

      // 6. 顯示醫療免責聲明，沿用既有狀態列，不新增彈窗。
      //    Gemini 結果一律附上（模型未回傳時改用 i18n 預設字串），確保免責聲明入結果文字。
      const modelDisclaimer =
        typeof result.disclaimer === 'string' ? result.disclaimer.trim() : '';
      const resultDisclaimer = result.provider === 'gemini'
        ? modelDisclaimer || i18n.t('wound.disclaimer')
        : '';
      if (resultDisclaimer) {
        woundStatusText.textContent = `${woundStatusText.textContent} ${resultDisclaimer}`;
      }

      // 7. 附上模型摘要（僅 Gemini 且模型確實有回傳時），沿用同一狀態列。
      const modelSummary = result.provider === 'gemini'
        ? (typeof result.summary === 'string' ? result.summary.trim() : '')
        : '';
      if (modelSummary) {
        woundStatusText.textContent =
          `${woundStatusText.textContent} ${i18n.t('wound.summaryLabel')}${modelSummary}`;
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
