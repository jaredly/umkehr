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

const fullName = `${fmt}-${name.join('-')}`;
const dir = `.tasks/${fullName}`;
fs.mkdirSync(dir);

if (name[0] === 'bug') {
    execSync(`zed ${dir}/bug.md`);
    console.log(
        `${fullName}: can you look at [@bug.md](file://${process.cwd()}/${dir}/bug.md) and create a failing repro test? If you get stuck, stop and ask for more information, but otherwise you can proceed with a fix.`,
    );
} else {
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
}
