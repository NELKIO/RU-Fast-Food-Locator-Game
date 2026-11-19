// node emit.mjs best.json fighters.js  — rewrites the FIGHTERS block in place, keeping section comments.
import { readFileSync, writeFileSync } from 'node:fs';
const [bestPath, target] = process.argv.slice(2);
const F = JSON.parse(readFileSync(bestPath)).F ?? JSON.parse(readFileSync(bestPath));
const src = readFileSync(target, 'utf8');
const start = src.indexOf('export const FIGHTERS = {');
const end = src.indexOf('\n};\n', start) + 4;
const lit = v => typeof v === 'string' ? `'${v}'` : typeof v === 'object' ? '{ ' + Object.entries(v).map(([k, x]) => `${k}: ${lit(x)}`).join(', ') + ' }' : String(v);
const order = ['name', 'cost', 'power', 'pierce', 'shatter', 'execute', 'burn', 'weaken', 'sap', 'drain', 'heal', 'team', 'shield', 'buff', 'cleanse', 'recoil'];
const skill = s => lit(Object.fromEntries(Object.entries(s).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))));
const sections = { bk: '  // Бургер Кинг — открытый огонь и гриль', vkusno: '  // Вкусно — и точка — классика и большие порции', rostics: '  // Rostic’s — острая хрустящая курица', dodo: '  // Додо Пицца — печь и сыр' };
let out = 'export const FIGHTERS = {\n', last = '';
for (const [id, f] of Object.entries(F)) {
  const brand = id.split('-')[0];
  if (brand !== last) { out += (last ? '\n' : '') + sections[brand] + '\n'; last = brand; }
  out += `  '${id}': {\n    rarity: '${f.rarity}', role: '${f.role}', hp: ${f.hp}, attack: ${f.attack}, basic: '${f.basic}',\n    skill: ${skill(f.skill)},\n`;
  if (f.ultimate) out += `    ultimate: ${skill(f.ultimate)},\n`;
  if (f.trait) out += `    trait: ${lit(f.trait)},\n`;
  out += '  },\n';
}
out += '};\n';
writeFileSync(target, src.slice(0, start) + out + src.slice(end));
