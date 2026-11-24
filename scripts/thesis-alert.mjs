#!/usr/bin/env node
/**
 * Crash-thesis alert check — polls the local WealthEngine API and posts a
 * macOS notification for alert conditions that are NEW since the last run
 * (e.g. Crash Radar + credit stress lining up). Intended for a daily
 * LaunchAgent; safe to run by hand:  npm run alert:thesis
 *
 * State is kept in ~/.wealthengine/thesis-alerts.json so an alert fires once
 * when it appears, not every day it stays active.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { diffAlerts } from '../src/engine/crashThesis.js';

const API = process.env.WEALTHENGINE_API || 'http://localhost:3001';
const STATE_DIR = path.join(os.homedir(), '.wealthengine');
const STATE_FILE = path.join(STATE_DIR, 'thesis-alerts.json');
const OFFLINE_NOTICE_MS = 3 * 86400000;

const readState = () => {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { activeKeys: [] }; }
};
const writeState = (s) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
};
const notify = (title, message) => {
  if (process.platform !== 'darwin') return;
  const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  execFileSync('osascript', ['-e', `display notification "${esc(message)}" with title "WealthEngine" subtitle "${esc(title)}" sound name "Glass"`]);
};
const stamp = () => new Date().toISOString();

const state = readState();
let data;
try {
  const res = await fetch(`${API}/thesis/karsan?refresh=1`, { signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  data = await res.json();
} catch (err) {
  console.error(`[${stamp()}] WealthEngine API unreachable at ${API}: ${err.message}`);
  if (!state.offlineNoticeAt || Date.now() - Date.parse(state.offlineNoticeAt) > OFFLINE_NOTICE_MS) {
    notify('Alert check skipped', 'WealthEngine server is not running (npm run server), so crash/credit alerts could not be checked.');
    writeState({ ...state, offlineNoticeAt: stamp() });
  }
  process.exit(0);
}

const alerts = Array.isArray(data.alerts) ? data.alerts : [];
const fresh = diffAlerts(alerts, state.activeKeys);
for (const a of fresh) notify(a.title, a.message);

console.log(`[${stamp()}] ${data.headline || ''}`);
console.log(`  active: ${alerts.map((a) => a.key).join(', ') || 'none'} | new: ${fresh.map((a) => a.key).join(', ') || 'none'}`);
if (data.credit) console.log(`  credit: ${data.credit.detail}`);

writeState({ activeKeys: alerts.map((a) => a.key), lastRun: stamp(), lastHeadline: data.headline, offlineNoticeAt: null });
