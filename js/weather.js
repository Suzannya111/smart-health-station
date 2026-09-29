/**
 * Smart Care - Weather & Raincoat Module
 */

import { i18n } from './i18n/index.js';

/** Shorthand translator bound to the shared i18n singleton. */
const t = (key, params) => i18n.t(key, params);

const MACAU_LAT = 22.1987;
const MACAU_LON = 113.5439;

const currentDateText = document.getElementById('currentDateText');
const weatherIcon = document.getElementById('weatherIcon');
const weatherStateText = document.getElementById('weatherStateText');
const tempRainText = document.getElementById('tempRainText');
const btnRaincoat = document.getElementById('btnRaincoat');
const devWeatherSelect = document.getElementById('devWeatherSelect');

let currentWeatherMode = 'sunny';

/** BCP-47 locales used by `toLocaleDateString` for each app locale. */
const DATE_LOCALES = { 'zh-Hant': 'zh-TW', 'zh-Hans': 'zh-CN', en: 'en-US', pt: 'pt-PT' };

/** Last applied weather state, re-rendered when the language changes. */
let lastState = { state: 'sunny', temp: 26, rainProb: 0 };

function updateDateDisplay() {
  if (!currentDateText) return;
  const now = new Date();
  const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
  const dateLocale = DATE_LOCALES[i18n.getLanguage()] || 'zh-TW';
  currentDateText.textContent = `📅 ${now.toLocaleDateString(dateLocale, options)}`;
}

function showToast(message, isError = false) {
  const container = document.getElementById('toastContainer');
  if (!container) {
    alert(message);
    return;
  }
  const toast = document.createElement('div');
  toast.style.cssText = `
    background: ${isError ? '#ef4444' : '#10b981'};
    color: white; padding: 10px 16px; border-radius: 8px; margin-top: 8px;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1); font-weight: bold; font-size: 0.95rem;
  `;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function applyWeatherState(state, temp = 26, rainProb = 0) {
  currentWeatherMode = state;
  lastState = { state, temp, rainProb };

  if (state === 'sunny') {
    weatherIcon.textContent = '☀️';
    weatherStateText.textContent = t('weather.condition.sunny');
    tempRainText.textContent = t('weather.summary.tempRain', { temp, prob: rainProb });
    setRaincoatButtonActive(false);
  } else if (state === 'cloudy') {
    weatherIcon.textContent = '☁️';
    weatherStateText.textContent = t('weather.condition.cloudy');
    tempRainText.textContent = t('weather.summary.tempRain', { temp, prob: rainProb });
    setRaincoatButtonActive(false);
  } else if (state === 'rainy') {
    weatherIcon.textContent = '🌧️';
    weatherStateText.textContent = t('weather.condition.rainy');
    tempRainText.textContent = t('weather.summary.tempRain', { temp, prob: rainProb });
    setRaincoatButtonActive(true);
  }
}

function setRaincoatButtonActive(isRainy) {
  if (!btnRaincoat) return;
  if (isRainy) {
    btnRaincoat.style.backgroundColor = '#0284c7';
    btnRaincoat.style.opacity = '1';
    btnRaincoat.style.cursor = 'pointer';
  } else {
    btnRaincoat.style.backgroundColor = '#9ca3af';
    btnRaincoat.style.opacity = '0.75';
  }
}

async function fetchMacauWeather() {
  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${MACAU_LAT}&longitude=${MACAU_LON}&current=temperature_2m,rain,showers,weather_code&hourly=precipitation_probability&forecast_days=1`
    );
    const data = await response.json();

    const temp = Math.round(data.current.temperature_2m || 25);
    const rain = data.current.rain || 0;
    const rainProb = data.hourly?.precipitation_probability?.[0] || (rain > 0 ? 80 : 10);
    const weatherCode = data.current.weather_code;

    if (rain > 0 || (weatherCode >= 51 && weatherCode <= 82) || rainProb >= 60) {
      applyWeatherState('rainy', temp, rainProb);
    } else if (weatherCode >= 1 && weatherCode <= 3) {
      applyWeatherState('cloudy', temp, rainProb);
    } else {
      applyWeatherState('sunny', temp, rainProb);
    }
  } catch (err) {
    console.warn('天氣 API 連線異常，啟用預設晴天模式:', err);
    applyWeatherState('sunny', 26, 0);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateDateDisplay();
  fetchMacauWeather();

  if (btnRaincoat) {
    btnRaincoat.addEventListener('click', () => {
      if (currentWeatherMode === 'rainy') {
        showToast(t('weather.toast.raincoatDispensing'));
        
        // 觸發 ESP32 馬達 3 出料
        const m3Btn = document.querySelector('[data-motor="M3"]');
        if (m3Btn) m3Btn.click();
      } else {
        showToast(t('weather.toast.raincoatNotNeeded'), true);
      }
    });
  }

  if (devWeatherSelect) {
    devWeatherSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'auto') {
        fetchMacauWeather();
      } else if (val === 'sunny') {
        applyWeatherState('sunny', 28, 0);
        showToast(t('weather.dev.toast.sunny'));
      } else if (val === 'cloudy') {
        applyWeatherState('cloudy', 24, 20);
        showToast(t('weather.dev.toast.cloudy'));
      } else if (val === 'rainy') {
        applyWeatherState('rainy', 20, 90);
        showToast(t('weather.dev.toast.rainy'));
      }
    });
  }

  // Weather text is written imperatively, so re-render it on language change.
  i18n.onLanguageChange(() => {
    updateDateDisplay();
    applyWeatherState(lastState.state, lastState.temp, lastState.rainProb);
  });
});