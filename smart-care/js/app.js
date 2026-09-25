/**
 * Smart Care — application bootstrap (blueprint §8.1 / S14).
 *
 * This REPLACES the placeholder entry point. Pipeline:
 *   1. load the persisted config (never throws; corrupt JSON → defaults)
 *   2. point i18n at it and restore the persisted language (`smart_care_lang`)
 *   3. build the two device clients (Web Bluetooth + ESP32 no-cors)
 *   4. build + initialise router / settings / header / maps / views
 *   5. apply translations once more after the modules have taken ownership of
 *      the dynamic status nodes
 *   6. surface graceful-degradation guidance (unsupported browser / insecure)
 *   7. attempt a best-effort silent BLE reconnect (never guaranteed)
 *
 * Nothing is exported: this module exists purely to wire the app up.
 */

import { bus } from './core/bus.js';
import { ready } from './core/dom.js';
import { setTranslator, showToast } from './core/toast.js';
import { loadConfig, getStoredLanguage } from './config.js';
import { i18n } from './i18n/index.js';
import { createThermometerClient } from './devices/ble-thermometer.js';
import { createEsp32Client } from './devices/esp32-client.js';
import { createRouter } from './ui/router.js';
import { createHeader } from './ui/header.js';
import { createMaps } from './ui/maps.js';
import { createViews } from './ui/views.js';
import { createSettings } from './ui/settings.js';
import { initWoundDetection } from './wound-detect.js';

/** One-time console + toast guidance for unsupported / insecure environments. */
function reportEnvironment(thermo) {
  const reason = typeof thermo.getSupportReason === 'function' ? thermo.getSupportReason() : 'ok';
  if (reason === 'insecure-context') {
    showToast('healthkit.guide.secure', { type: 'warning', duration: 6000 });
  } else if (reason === 'unsupported-browser') {
    showToast('healthkit.guide.browser', { type: 'warning', duration: 6000 });
  }
}

function bootstrap() {
  // 1 + 2 — restore persisted config + language.
  const config = loadConfig();
  i18n.setConfig(config);
  setTranslator(i18n.t); // toasts may be given i18n keys
  i18n.setLanguage(getStoredLanguage(), { persist: true, apply: true });

  // 3 — device clients. Both default to the shared config module + shared bus.
  const thermo = createThermometerClient({ bus, i18n });
  const esp32 = createEsp32Client({ bus });

  // 4 — UI modules (all depend on the shared bus, clients and router).
  const router = createRouter({ bus, container: document.getElementById('viewContainer') });
  const settings = createSettings({ bus, i18n, thermo, esp32 });
  const header = createHeader({ bus, i18n, onOpenSettings: () => settings.open() });
  const maps = createMaps({ bus, i18n, router });
  const views = createViews({ bus, i18n, router, thermo, esp32 });

  // Order matters: consumers subscribe to the bus BEFORE the router emits the
  // initial `view:changed` (which lazily loads the Home map).
  settings.init();
  header.init();
  maps.init();
  views.init();
  router.init();

  // 5 — final translation pass (dynamic nodes removed their data-i18n hooks).
  i18n.applyToDOM();

  // 6 — graceful degradation messaging.
  reportEnvironment(thermo);

  // 7 — best-effort silent reconnect (requires navigator.bluetooth.getDevices()).
  if (typeof thermo.isSupported === 'function' && thermo.isSupported()) {
    Promise.resolve(thermo.trySilentReconnect()).catch(() => {});
  }
  // 初始化傷口辨識功能
  initWoundDetection();
}

ready(bootstrap);
