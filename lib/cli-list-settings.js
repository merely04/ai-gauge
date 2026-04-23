#!/usr/bin/env bun
// Helper invoked by bin/ai-gauge-config; prints one "<name>|<provider>" per supported settings file.
import { discoverSettingsFiles } from './settings-discovery.js';

const claudeDir = `${process.env.HOME}/.claude`;
const files = discoverSettingsFiles(claudeDir);

for (const f of files) {
  if (f.supported) {
    console.log(`${f.name}|${f.provider}`);
  }
}
