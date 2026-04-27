#!/usr/bin/env bun
// Helper invoked by bin/ai-gauge-config; prints one "<name>|<provider>" per supported settings file.
import { discoverSettingsFiles } from './settings-discovery.js';

const args = process.argv.slice(2);
const formatWalker = args.includes('--format=walker');

const claudeDir = `${process.env.HOME}/.claude`;
const files = discoverSettingsFiles(claudeDir);

for (const f of files) {
  if (f.supported) {
    if (formatWalker) {
      if (f.provider && f.provider !== 'unknown') {
        console.log(`claude-settings:${f.name} (${f.provider})`);
      } else {
        console.log(`claude-settings:${f.name}`);
      }
    } else {
      console.log(`${f.name}|${f.provider}`);
    }
  }
}
