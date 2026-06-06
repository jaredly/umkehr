import {execSync} from 'child_process';
import fs from 'fs';
const [_, __, name] = process.argv;

const count = fs.readdirSync('.tasks/000-archive').length + fs.readdirSync('.tasks').length - 1;

const fullName = `${count.toString().padStart(3, '0')}-${name}`;
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
    `Ok, go ahead and implement, keeping a concise log of your progress in implementation-log.md`,
);
