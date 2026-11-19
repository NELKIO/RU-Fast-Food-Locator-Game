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
//   shatter  knocks off the target's shield and guard before the blow
//
// Rarity ladder: a common fighter has one move; a rare one adds a talent; an epic one adds a
// super move (`ultimate`, 3 energy) to that; a legendary one has a talent only legendaries have.
//
// Talent fields (`trait`), each works by itself, without spending a turn:
//   armor     every blow that does not pierce is that much weaker (never below 1)
//   thorns    whoever lands a blow on the fighter loses that much HP (never knocks out)
//   regen     restores that much HP after each of the fighter's own actions, unless burning
//   rage      that much extra damage on every blow while the fighter is at half health or below
//   fireproof cannot be set on fire
//   steady    ignores weakening and energy loss
//   quick     starts the fight with that much extra energy
//   vamp      a plain hit that lands restores that much HP
//   laststand the first blow that would knock the fighter out leaves it on 1 HP (legendary)
export const RARITIES = ['common', 'rare', 'epic', 'legendary'];
export const ROLES = { striker: 'Штурмовик', allround: 'Универсал', guard: 'Защитник' };

export const FIGHTERS = {
  // Бургер Кинг — открытый огонь и гриль
  'bk-angus-parmigiano': {
    rarity: 'legendary', role: 'striker', hp: 26, attack: 7, basic: 'Мраморный удар',
    skill: { name: 'Корона пармезана', cost: 2, power: 4, pierce: true },
    ultimate: { name: 'Коронация', cost: 3, power: 6, pierce: true, shatter: true },
    trait: { name: 'Королевская стойкость', laststand: true, armor: 1 },
  },
  'bk-whopper': {
    rarity: 'epic', role: 'allround', hp: 27, attack: 5, basic: 'Удар с гриля',
    skill: { name: 'Пламя гриля', cost: 1, power: 1, burn: { dmg: 2, turns: 3 } },
    ultimate: { name: 'Королевский гриль', cost: 3, power: 1, burn: { dmg: 2, turns: 2 } },
    trait: { name: 'Закалка огнём', fireproof: true },
  },
  'bk-double-whopper': {
    rarity: 'epic', role: 'striker', hp: 23, attack: 7, basic: 'Двойной удар',
    skill: { name: 'Две котлеты', cost: 1, power: 0, execute: 2 },
    ultimate: { name: 'Двойной прожар', cost: 3, power: 6, shatter: true },
    trait: { name: 'Голодная ярость', rage: 1 },
  },
  'bk-chicken-parmesan': {
    rarity: 'rare', role: 'striker', hp: 18, attack: 6, basic: 'Хрустящий выпад',
    skill: { name: 'Сырная корочка', cost: 2, power: 1, pierce: true },
    trait: { name: 'Хрустящий азарт', rage: 3 },
  },
  'bk-onion-rings': {
    rarity: 'rare', role: 'allround', hp: 20, attack: 5, basic: 'Бросок кольца',
    skill: { name: 'Луковые слёзы', cost: 2, power: 1, weaken: 2 },
    trait: { name: 'Едкий лук', thorns: 1 },
  },
  'bk-fries': {
    rarity: 'common', role: 'striker', hp: 14, attack: 5, basic: 'Хрустящий тычок',
    skill: { name: 'Соль на рану', cost: 1, power: 2 },
  },
  'bk-cheese-sauce': {
    rarity: 'common', role: 'guard', hp: 18, attack: 3, basic: 'Брызги соуса',
    skill: { name: 'Липкий сыр', cost: 2, power: 1, weaken: 2, sap: true },
  },
  'bk-shrimps': {
    rarity: 'common', role: 'guard', hp: 16, attack: 5, basic: 'Щипок',
    skill: { name: 'Панцирь в кляре', cost: 2, shield: 6 },
  },
  'bk-cheese-medallions': {
    rarity: 'rare', role: 'striker', hp: 19, attack: 5, basic: 'Бросок медальона',
    skill: { name: 'Горячая начинка', cost: 1, power: 1, burn: { dmg: 2, turns: 4 } },
    trait: { name: 'Расплавленное сердце', fireproof: true },
  },
  'bk-shrimp-roll': {
    rarity: 'common', role: 'allround', hp: 18, attack: 4, basic: 'Удар роллом',
    skill: { name: 'Креветочный ролл', cost: 1, power: 0, shield: 2 },
  },
  'bk-sundae': {
    rarity: 'common', role: 'guard', hp: 18, attack: 3, basic: 'Шоколадные брызги',
    skill: { name: 'Холодный десерт', cost: 2, weaken: 3, heal: 3 },
  },
  // Стаканы колы: чем больше стакан, тем реже и сильнее боец
  'bk-cola-08': {
    rarity: 'epic', role: 'guard', hp: 24, attack: 5, basic: 'Ледяной всплеск',
    skill: { name: 'Ледяной фонтан', cost: 2, power: 2, weaken: 2, cleanse: true },
    ultimate: { name: 'Ледниковый период', cost: 3, power: 3, sap: true, shield: 4 },
    trait: { name: 'Холодная голова', steady: true },
  },
  'bk-cola-05': {
    rarity: 'rare', role: 'allround', hp: 24, attack: 5, basic: 'Струя колы',
    skill: { name: 'Шипучка', cost: 2, power: 2, sap: true },
    trait: { name: 'Газировка', quick: 1 },
  },
  'bk-cola-04': {
    rarity: 'common', role: 'guard', hp: 18, attack: 5, basic: 'Брызги колы',
    skill: { name: 'Глоток со льдом', cost: 2, heal: 3, cleanse: true },
  },

  // Вкусно — и точка — классика и большие порции
  'vkusno-big-hit': {
    rarity: 'legendary', role: 'guard', hp: 28, attack: 7, basic: 'Удар котлетой',
    skill: { name: 'Большой хит', cost: 2, power: 2, shield: 6 },
    ultimate: { name: 'Хит сезона', cost: 3, power: 5, shield: 7 },
    trait: { name: 'Тройная броня', armor: 1, thorns: 1 },
  },
  'vkusno-grand': {
    rarity: 'epic', role: 'allround', hp: 25, attack: 5, basic: 'Гранд-удар',
    skill: { name: 'Двойная котлета', cost: 2, power: 0, buff: 2 },
    ultimate: { name: 'Гранд-финал', cost: 3, power: 3, buff: 2 },
    trait: { name: 'Сытный укус', vamp: 2 },
  },
  'vkusno-chicken-premier': {
    rarity: 'epic', role: 'striker', hp: 23, attack: 6, basic: 'Хрустящий удар',
    skill: { name: 'Премьерная панировка', cost: 2, power: 0, shield: 2 },
    ultimate: { name: 'Премьерный выход', cost: 3, power: 5, pierce: true },
    trait: { name: 'Быстрая подача', quick: 1 },
  },
  'vkusno-big-special': {
    rarity: 'rare', role: 'allround', hp: 21, attack: 5, basic: 'Удар соусом',
    skill: { name: 'Особый рецепт', cost: 2, power: 1, heal: 2, buff: 1 },
    trait: { name: 'Секретный соус', regen: 1 },
  },
  'vkusno-chicken-hit': {
    rarity: 'rare', role: 'striker', hp: 19, attack: 5, basic: 'Куриный удар',
    skill: { name: 'Хит дня', cost: 1, power: 2, buff: 1 },
    trait: { name: 'Аппетит', vamp: 1 },
  },
  'vkusno-nuggets': {
    rarity: 'common', role: 'allround', hp: 17, attack: 4, basic: 'Наггетс',
    skill: { name: 'Макни в соус', cost: 1, power: 0, heal: 3 },
  },
  'vkusno-pie': {
    rarity: 'common', role: 'allround', hp: 16, attack: 4, basic: 'Горячая начинка',
    skill: { name: 'Осторожно, горячо', cost: 1, power: 0, burn: { dmg: 2, turns: 3 } },
  },
  'vkusno-double-cheeseburger': {
    rarity: 'rare', role: 'striker', hp: 20, attack: 6, basic: 'Сырный хлопок',
    skill: { name: 'Двойная порция', cost: 2, power: 0, execute: 3 },
    trait: { name: 'Двойной слой', armor: 1 },
  },
  'vkusno-caesar-roll': {
    rarity: 'common', role: 'allround', hp: 15, attack: 4, basic: 'Хрустящий лист',
    skill: { name: 'Соус цезарь', cost: 2, power: 1, weaken: 1, heal: 3 },
  },
  'vkusno-chocolate-cake': {
    rarity: 'common', role: 'guard', hp: 21, attack: 4, basic: 'Шоколадная крошка',
    skill: { name: 'Шоколадный слой', cost: 1, heal: 1, shield: 3 },
  },
  'vkusno-macarons': {
    rarity: 'common', role: 'guard', hp: 18, attack: 5, basic: 'Хруст безе',
    skill: { name: 'Сахарная кома', cost: 1, sap: true, heal: 2 },
  },

  // Rostic’s — острая хрустящая курица
  'rostics-chefburger': {
    rarity: 'legendary', role: 'allround', hp: 28, attack: 7, basic: 'Удар шефа',
    skill: { name: 'Фирменный рецепт', cost: 2, power: 1, heal: 4, cleanse: true },
    ultimate: { name: 'Шеф на кухне', cost: 3, power: 4, drain: true, team: 3 },
    trait: { name: 'Рука шефа', regen: 2, steady: true },
  },
  'rostics-boxmaster': {
    rarity: 'epic', role: 'striker', hp: 21, attack: 7, basic: 'Джеб',
    skill: { name: 'Ростмастер-комбо', cost: 2, power: 3, recoil: 3 },
    ultimate: { name: 'Нокаут', cost: 3, power: 5, execute: 3 },
    trait: { name: 'Плотная упаковка', armor: 1 },
  },
  'rostics-wings': {
    rarity: 'epic', role: 'striker', hp: 23, attack: 6, basic: 'Острый взмах',
    skill: { name: 'Перечный шторм', cost: 2, power: -1, burn: { dmg: 3, turns: 2 } },
    ultimate: { name: 'Огненный смерч', cost: 3, power: 5, pierce: true, burn: { dmg: 3, turns: 4 } },
    trait: { name: 'Острые перья', thorns: 1 },
  },
  'rostics-twister': {
    rarity: 'rare', role: 'allround', hp: 20, attack: 6, basic: 'Скрутка',
    skill: { name: 'Плотный ролл', cost: 2, power: 0, shield: 3 },
    trait: { name: 'Острая начинка', thorns: 1 },
  },
  'rostics-basket': {
    rarity: 'rare', role: 'guard', hp: 24, attack: 4, basic: 'Удар корзиной',
    skill: { name: 'На всю компанию', cost: 2, power: 2, team: 4 },
    trait: { name: 'Плетёные стенки', armor: 1 },
  },
  'rostics-strips': {
    rarity: 'common', role: 'striker', hp: 15, attack: 4, basic: 'Полоска',
    skill: { name: 'Тройная полоска', cost: 2, power: 6 },
  },
  'rostics-bites': {
    rarity: 'common', role: 'allround', hp: 16, attack: 5, basic: 'Укус',
    skill: { name: 'Горсть байтсов', cost: 2, power: 0, drain: true },
  },
  'rostics-drumsticks': {
    rarity: 'common', role: 'guard', hp: 18, attack: 4, basic: 'Пинок',
    skill: { name: 'Подсечка', cost: 1, power: 0, sap: true },
  },
  'rostics-chefburger-junior': {
    rarity: 'common', role: 'striker', hp: 15, attack: 5, basic: 'Мини-удар',
    skill: { name: 'Юный шеф', cost: 1, power: 0, buff: 1 },
  },
  'rostics-fries': {
    rarity: 'common', role: 'striker', hp: 16, attack: 5, basic: 'Картофельный тычок',
    skill: { name: 'Горсть фри', cost: 2, power: 1, execute: 2 },
  },
  'rostics-ice-cream-cone': {
    rarity: 'common', role: 'guard', hp: 20, attack: 3, basic: 'Холодок',
    skill: { name: 'Заморозка', cost: 1, power: 1, sap: true, cleanse: true },
  },

  // Додо Пицца — печь и сыр
  'dodo-pepperoni': {
    rarity: 'legendary', role: 'striker', hp: 27, attack: 8, basic: 'Острый ломтик',
    skill: { name: 'Острые кружки', cost: 1, power: 2, burn: { dmg: 3, turns: 3 } },
    ultimate: { name: 'Пепперони-шторм', cost: 3, power: 4, burn: { dmg: 3, turns: 2 } },
    trait: { name: 'Жар печи', rage: 3, fireproof: true },
  },
  'dodo-four-cheeses': {
    rarity: 'epic', role: 'guard', hp: 25, attack: 5, basic: 'Сырный удар',
    skill: { name: 'Сырный квартет', cost: 2, power: -1, weaken: 3, shield: 2 },
    ultimate: { name: 'Сырная крепость', cost: 3, power: 2, heal: 2, shield: 6 },
    trait: { name: 'Плотная корка', armor: 1 },
  },
  'dodo-diablo': {
    rarity: 'epic', role: 'striker', hp: 22, attack: 6, basic: 'Перчинка',
    skill: { name: 'Адское пламя', cost: 2, power: 3, burn: { dmg: 2, turns: 4 }, recoil: 1 },
    ultimate: { name: 'Адский жар', cost: 3, power: 7, burn: { dmg: 3, turns: 3 }, recoil: 2 },
    trait: { name: 'Огненный нрав', rage: 1 },
  },
  'dodo-dodster': {
    rarity: 'epic', role: 'allround', hp: 23, attack: 5, basic: 'Ролл-удар',
    skill: { name: 'Прямо из печи', cost: 2, power: 1, drain: true },
    ultimate: { name: 'Двойной додстер', cost: 3, power: 6, drain: true },
    trait: { name: 'Тёплый ролл', regen: 1 },
  },
  'dodo-carbonara': {
    rarity: 'rare', role: 'allround', hp: 22, attack: 5, basic: 'Сливочный удар',
    skill: { name: 'Сливочный соус', cost: 2, power: 2, heal: 3 },
    trait: { name: 'Сливочное спокойствие', steady: true },
  },
  'dodo-margherita': {
    rarity: 'rare', role: 'guard', hp: 21, attack: 5, basic: 'Лист базилика',
    skill: { name: 'Итальянская классика', cost: 2, heal: 2, shield: 5 },
    trait: { name: 'Свежий базилик', regen: 2 },
  },
  'dodo-bbq': {
    rarity: 'rare', role: 'allround', hp: 20, attack: 5, basic: 'Копчёный ломтик',
    skill: { name: 'Дымок барбекю', cost: 2, power: -1, burn: { dmg: 1, turns: 4 }, weaken: 2 },
    trait: { name: 'Копчёная злость', rage: 1 },
  },
  'dodo-hawaiian': {
    rarity: 'common', role: 'allround', hp: 20, attack: 4, basic: 'Ананасный кубик',
    skill: { name: 'Сладкий ананас', cost: 2, power: 1, heal: 2 },
  },
  'dodo-cheese': {
    rarity: 'common', role: 'guard', hp: 19, attack: 3, basic: 'Тянучка',
    skill: { name: 'Тянущийся сыр', cost: 2, power: 1, shield: 6 },
  },
  'dodo-oven-potatoes': {
    rarity: 'common', role: 'striker', hp: 16, attack: 4, basic: 'Печёный удар',
    skill: { name: 'Румяная корочка', cost: 1, power: 1, burn: { dmg: 1, turns: 4 } },
  },
  'dodo-cheesecake': {
    rarity: 'common', role: 'allround', hp: 18, attack: 4, basic: 'Нежный удар',
    skill: { name: 'Сладкая пауза', cost: 1, heal: 6 },
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
  if (skill.shatter) parts.push('сначала сбивает щит и защиту соперника');
  if (skill.recoil) parts.push('отдача −' + skill.recoil + ' HP себе');
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

// The talent in one sentence, from the same fields the engine reads.
export function describeTrait(trait) {
  if (!trait) return '';
  const parts = [];
  if (trait.armor) parts.push('удары без пробития слабее на ' + trait.armor);
  if (trait.thorns) parts.push('кто бьёт этого бойца, теряет ' + count(trait.thorns, HP));
  if (trait.regen) parts.push('после каждого своего хода +' + count(trait.regen, HP) + ', если не горит');
  if (trait.rage) parts.push('на половине здоровья и ниже бьёт на ' + trait.rage + ' сильнее');
  if (trait.fireproof) parts.push('не загорается');
  if (trait.steady) parts.push('не теряет ни атаку, ни энергию');
  if (trait.quick) parts.push('начинает бой с лишней энергией: +' + trait.quick);
  if (trait.vamp) parts.push('обычный удар лечит на ' + count(trait.vamp, HP));
  if (trait.laststand) parts.push('один раз за бой переживает смертельный удар с 1 HP');
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}
