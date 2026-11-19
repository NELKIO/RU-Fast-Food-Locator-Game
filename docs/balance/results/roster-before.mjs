// Every fighter is defined by hand. The menu catalog (menu.json) supplies the dish name,
// photo and official link; this table supplies what the dish does in a fight.
//
// Skill fields, all optional:
//   cost     energy needed (1–3)
//   power    bonus damage on top of the fighter's attack; omit for a skill that deals no damage
//   pierce   ignores the target's guard
//   burn     {dmg, turns}: the target loses dmg HP after each of its own next turns
//   heal     restores the fighter's own HP
//   drain    restores half of the damage dealt
//   shield   absorbs that much incoming damage until it is used up
//   buff     raises the fighter's own attack for the rest of the fight
//   weaken   lowers the target's attack for the rest of the fight (never below 1)
//   sap      empties the target's energy
//   team     restores HP to every living fighter of the team, benched ones included
//   execute  extra damage when the target is at half health or below
//   recoil   the fighter takes this much damage itself (never knocks itself out)
//   cleanse  removes burning from the fighter
export const RARITIES = ['common', 'rare', 'epic', 'legendary'];
export const ROLES = { striker: 'Штурмовик', allround: 'Универсал', guard: 'Защитник' };

export const FIGHTERS = {
  // Бургер Кинг — открытый огонь и гриль
  'bk-angus-parmigiano': {
    rarity: 'legendary', role: 'striker', hp: 27, attack: 7, basic: 'Мраморный удар',
    skill: { name: 'Корона пармезана', cost: 3, power: 6, pierce: true, buff: 1 },
  },
  'bk-whopper': {
    rarity: 'epic', role: 'allround', hp: 25, attack: 6, basic: 'Удар с гриля',
    skill: { name: 'Пламя гриля', cost: 2, power: 1, burn: { dmg: 3, turns: 3 } },
  },
  'bk-double-whopper': {
    rarity: 'epic', role: 'striker', hp: 24, attack: 7, basic: 'Двойной удар',
    skill: { name: 'Две котлеты', cost: 2, power: 2, execute: 4 },
  },
  'bk-chicken-parmesan': {
    rarity: 'rare', role: 'striker', hp: 19, attack: 6, basic: 'Хрустящий выпад',
    skill: { name: 'Сырная корочка', cost: 2, power: 3, pierce: true },
  },
  'bk-onion-rings': {
    rarity: 'rare', role: 'allround', hp: 20, attack: 5, basic: 'Бросок кольца',
    skill: { name: 'Луковые слёзы', cost: 2, power: 1, weaken: 2 },
  },
  'bk-fries': {
    rarity: 'common', role: 'striker', hp: 16, attack: 5, basic: 'Хрустящий тычок',
    skill: { name: 'Соль на рану', cost: 1, power: 2 },
  },
  'bk-cheese-sauce': {
    rarity: 'common', role: 'guard', hp: 20, attack: 3, basic: 'Брызги соуса',
    skill: { name: 'Липкий сыр', cost: 2, power: 1, sap: true, weaken: 1 },
  },
  'bk-shrimps': {
    rarity: 'common', role: 'allround', hp: 17, attack: 4, basic: 'Щипок',
    skill: { name: 'Панцирь в кляре', cost: 2, shield: 7 },
  },
  'bk-cheese-medallions': {
    rarity: 'rare', role: 'striker', hp: 19, attack: 6, basic: 'Бросок медальона',
    skill: { name: 'Горячая начинка', cost: 2, power: 2, burn: { dmg: 2, turns: 2 } },
  },
  'bk-shrimp-roll': {
    rarity: 'common', role: 'allround', hp: 17, attack: 4, basic: 'Удар роллом',
    skill: { name: 'Креветочный ролл', cost: 2, power: 1, shield: 4 },
  },
  'bk-sundae': {
    rarity: 'common', role: 'guard', hp: 18, attack: 3, basic: 'Шоколадные брызги',
    skill: { name: 'Холодный десерт', cost: 2, weaken: 1, heal: 4 },
  },
  // Стаканы колы: чем больше стакан, тем реже и сильнее боец
  'bk-cola-08': {
    rarity: 'epic', role: 'guard', hp: 25, attack: 6, basic: 'Ледяной всплеск',
    skill: { name: 'Ледяной фонтан', cost: 2, power: 2, weaken: 2, cleanse: true },
  },
  'bk-cola-05': {
    rarity: 'rare', role: 'allround', hp: 20, attack: 5, basic: 'Струя колы',
    skill: { name: 'Шипучка', cost: 2, power: 2, sap: true },
  },
  'bk-cola-04': {
    rarity: 'common', role: 'guard', hp: 18, attack: 3, basic: 'Брызги колы',
    skill: { name: 'Глоток со льдом', cost: 1, heal: 3, cleanse: true },
  },

  // Вкусно — и точка — классика и большие порции
  'vkusno-big-hit': {
    rarity: 'legendary', role: 'guard', hp: 30, attack: 6, basic: 'Удар котлетой',
    skill: { name: 'Большой хит', cost: 3, power: 5, shield: 5 },
  },
  'vkusno-grand': {
    rarity: 'epic', role: 'allround', hp: 25, attack: 6, basic: 'Гранд-удар',
    skill: { name: 'Двойная котлета', cost: 2, power: 2, buff: 2 },
  },
  'vkusno-chicken-premier': {
    rarity: 'epic', role: 'striker', hp: 22, attack: 7, basic: 'Хрустящий удар',
    skill: { name: 'Премьерная панировка', cost: 2, power: 3, shield: 3 },
  },
  'vkusno-big-special': {
    rarity: 'rare', role: 'allround', hp: 21, attack: 5, basic: 'Удар соусом',
    skill: { name: 'Особый рецепт', cost: 2, power: 1, buff: 1, heal: 3 },
  },
  'vkusno-chicken-hit': {
    rarity: 'rare', role: 'striker', hp: 19, attack: 6, basic: 'Куриный удар',
    skill: { name: 'Хит дня', cost: 2, power: 2, buff: 1 },
  },
  'vkusno-nuggets': {
    rarity: 'common', role: 'allround', hp: 17, attack: 4, basic: 'Наггетс',
    skill: { name: 'Макни в соус', cost: 1, power: 1, heal: 2 },
  },
  'vkusno-pie': {
    rarity: 'common', role: 'allround', hp: 16, attack: 4, basic: 'Горячая начинка',
    skill: { name: 'Осторожно, горячо', cost: 2, power: 1, burn: { dmg: 2, turns: 3 } },
  },

  'vkusno-double-cheeseburger': {
    rarity: 'rare', role: 'striker', hp: 20, attack: 6, basic: 'Сырный хлопок',
    skill: { name: 'Двойная порция', cost: 2, power: 2, execute: 3 },
  },
  'vkusno-caesar-roll': {
    rarity: 'common', role: 'allround', hp: 17, attack: 4, basic: 'Хрустящий лист',
    skill: { name: 'Соус цезарь', cost: 2, power: 1, heal: 2, weaken: 1 },
  },
  'vkusno-chocolate-cake': {
    rarity: 'common', role: 'guard', hp: 19, attack: 3, basic: 'Шоколадная крошка',
    skill: { name: 'Шоколадный слой', cost: 2, shield: 4, heal: 2 },
  },
  'vkusno-macarons': {
    rarity: 'common', role: 'guard', hp: 19, attack: 3, basic: 'Хруст безе',
    skill: { name: 'Сахарная кома', cost: 2, sap: true, heal: 3 },
  },

  // Rostic’s — острая хрустящая курица
  'rostics-chefburger': {
    rarity: 'legendary', role: 'allround', hp: 28, attack: 7, basic: 'Удар шефа',
    skill: { name: 'Фирменный рецепт', cost: 3, power: 5, heal: 6 },
  },
  'rostics-boxmaster': {
    rarity: 'epic', role: 'striker', hp: 23, attack: 7, basic: 'Джеб',
    skill: { name: 'Ростмастер-комбо', cost: 2, power: 5, recoil: 2 },
  },
  'rostics-wings': {
    rarity: 'epic', role: 'striker', hp: 21, attack: 6, basic: 'Острый взмах',
    skill: { name: 'Перечный шторм', cost: 2, power: 2, burn: { dmg: 3, turns: 2 } },
  },
  'rostics-twister': {
    rarity: 'rare', role: 'allround', hp: 20, attack: 5, basic: 'Скрутка',
    skill: { name: 'Плотный ролл', cost: 2, power: 2, shield: 4 },
  },
  'rostics-basket': {
    rarity: 'rare', role: 'guard', hp: 24, attack: 4, basic: 'Удар корзиной',
    skill: { name: 'На всю компанию', cost: 2, team: 5 },
  },
  'rostics-strips': {
    rarity: 'common', role: 'striker', hp: 16, attack: 5, basic: 'Полоска',
    skill: { name: 'Тройная полоска', cost: 2, power: 3 },
  },
  'rostics-bites': {
    rarity: 'common', role: 'allround', hp: 17, attack: 4, basic: 'Укус',
    skill: { name: 'Горсть байтсов', cost: 1, power: 1, drain: true },
  },
  'rostics-drumsticks': {
    rarity: 'common', role: 'guard', hp: 20, attack: 4, basic: 'Пинок',
    skill: { name: 'Подсечка', cost: 2, power: 1, sap: true },
  },
  'rostics-chefburger-junior': {
    rarity: 'common', role: 'striker', hp: 16, attack: 5, basic: 'Мини-удар',
    skill: { name: 'Юный шеф', cost: 2, power: 2, buff: 1 },
  },
  'rostics-fries': {
    rarity: 'common', role: 'striker', hp: 16, attack: 5, basic: 'Картофельный тычок',
    skill: { name: 'Горсть фри', cost: 1, power: 1, execute: 2 },
  },
  'rostics-ice-cream-cone': {
    rarity: 'common', role: 'guard', hp: 19, attack: 3, basic: 'Холодок',
    skill: { name: 'Заморозка', cost: 2, sap: true, weaken: 1, cleanse: true },
  },

  // Додо Пицца — печь и сыр
  'dodo-pepperoni': {
    rarity: 'legendary', role: 'striker', hp: 27, attack: 7, basic: 'Острый ломтик',
    skill: { name: 'Острые кружки', cost: 3, power: 4, burn: { dmg: 3, turns: 3 } },
  },
  'dodo-four-cheeses': {
    rarity: 'epic', role: 'guard', hp: 25, attack: 6, basic: 'Сырный удар',
    skill: { name: 'Сырный квартет', cost: 2, power: 1, weaken: 2, shield: 3 },
  },
  'dodo-diablo': {
    rarity: 'epic', role: 'striker', hp: 22, attack: 7, basic: 'Перчинка',
    skill: { name: 'Адское пламя', cost: 2, power: 4, burn: { dmg: 2, turns: 2 }, recoil: 2 },
  },
  'dodo-dodster': {
    rarity: 'epic', role: 'allround', hp: 23, attack: 6, basic: 'Ролл-удар',
    skill: { name: 'Прямо из печи', cost: 2, power: 3, drain: true },
  },
  'dodo-carbonara': {
    rarity: 'rare', role: 'allround', hp: 21, attack: 5, basic: 'Сливочный удар',
    skill: { name: 'Сливочный соус', cost: 2, power: 2, heal: 4 },
  },
  'dodo-margherita': {
    rarity: 'rare', role: 'guard', hp: 23, attack: 4, basic: 'Лист базилика',
    skill: { name: 'Итальянская классика', cost: 2, shield: 5, heal: 3 },
  },
  'dodo-bbq': {
    rarity: 'rare', role: 'allround', hp: 21, attack: 5, basic: 'Копчёный ломтик',
    skill: { name: 'Дымок барбекю', cost: 2, power: 1, weaken: 1, burn: { dmg: 2, turns: 3 } },
  },
  'dodo-hawaiian': {
    rarity: 'common', role: 'allround', hp: 18, attack: 4, basic: 'Ананасный кубик',
    skill: { name: 'Сладкий ананас', cost: 2, power: 1, heal: 3 },
  },
  'dodo-cheese': {
    rarity: 'common', role: 'guard', hp: 20, attack: 4, basic: 'Тянучка',
    skill: { name: 'Тянущийся сыр', cost: 2, power: 1, sap: true },
  },
  'dodo-oven-potatoes': {
    rarity: 'common', role: 'striker', hp: 16, attack: 5, basic: 'Печёный удар',
    skill: { name: 'Румяная корочка', cost: 1, power: 1, execute: 3 },
  },
  'dodo-cheesecake': {
    rarity: 'common', role: 'allround', hp: 18, attack: 3, basic: 'Нежный удар',
    skill: { name: 'Сладкая пауза', cost: 2, heal: 7 },
  },
};

// Ids that earlier versions could save in a profile, mapped to their replacements.
export const RENAMED = {
  'bk-cheeseburger': 'bk-chicken-parmesan',
  'vkusno-fries': 'vkusno-nuggets',
};

const plural = new Intl.PluralRules('ru');
function count(n, forms) {
  return n + ' ' + forms[plural.select(n)];
}
const HP = { one: 'HP', few: 'HP', many: 'HP', other: 'HP' };
const TURNS = { one: 'ход', few: 'хода', many: 'ходов', other: 'хода' };
const ENERGY = { one: 'энергия', few: 'энергии', many: 'энергии', other: 'энергии' };

export function energyLabel(cost) {
  return count(cost, ENERGY);
}

// One readable sentence built from the same fields the engine uses, so the text cannot drift.
export function describeSkill(skill, attack) {
  if (!skill) return '';
  const parts = [];
  if (Number.isFinite(skill.power)) {
    parts.push(count(Math.max(0, attack + skill.power), { one: 'урон', few: 'урона', many: 'урона', other: 'урона' }) + (skill.pierce ? ' сквозь защиту' : ''));
  }
  if (skill.execute) parts.push('+' + skill.execute + ' по раненому сопернику');
  if (skill.burn) parts.push('поджигает: −' + skill.burn.dmg + ' HP после каждого из ' + count(skill.burn.turns, TURNS) + ' соперника');
  if (skill.weaken) parts.push('атака соперника −' + skill.weaken);
  if (skill.sap) parts.push('соперник теряет всю энергию');
  if (skill.drain) parts.push('лечит на половину урона');
  if (skill.heal) parts.push('лечит себя на ' + count(skill.heal, HP));
  if (skill.team) parts.push('лечит всю команду на ' + count(skill.team, HP));
  if (skill.shield) parts.push('щит на ' + skill.shield);
  if (skill.buff) parts.push('своя атака +' + skill.buff);
  if (skill.cleanse) parts.push('тушит поджог');
  if (skill.recoil) parts.push('отдача −' + skill.recoil + ' HP себе');
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}
