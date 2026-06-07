#!/usr/bin/env bun
import {execSync} from 'child_process';
import fs from 'fs';
const [_, __, ...name] = process.argv;

const now = new Date();

const minutesSince2026 = ((now.getTime() - new Date(2026, 0, 1).getTime()) / 60000) | 0;

const theoreticalMax =
    ((new Date(2100, 0, 1).getTime() - new Date(2026, 0, 1).getTime()) / 60000) | 0;

const maxLength = theoreticalMax.toString(36).length;

const fmt = minutesSince2026.toString(36).padStart(maxLength, '0');

// const fmt = `${(now.getFullYear() - 2000).toString().padStart(2, '0')}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;

const fullName = `${fmt}-${name.join('-')}`;
const dir = `.tasks/${fullName}`;
fs.mkdirSync(dir);
execSync(`zed ${dir}/task.md`);
console.log(
    `${fullName}: can you look at [@task.md](file://${process.cwd()}/${dir}/task.md) and write up a research.md, including any open questions?`,
);
console.log();
console.log(`I've answered the open questions inline.`);
console.log(
    `Can you write up a plan.md detailing what needs to be done? Split it up into logical phases if helpful.`,
);
console.log();
console.log(
    `Ok, go ahead and implement phase by phase, keeping a concise log of your progress in implementation-log.md. Be sure to call out any issues, workarounds or bugs encountered.`,
);
