// Every fighter is defined by hand. The menu catalog (menu.json) supplies the dish name,
// photo and official link; this table supplies what the dish does in a fight.
//
// Speed (1–9, default 5) decides who moves first: the faster lead fighter opens, and after a
// knockout the faster of the two fighters on the field takes the next turn, so it can move twice
// in a row. Equal speed keeps the usual alternation.
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
//   hits     splits the blow into that many strikes (guard softens only the first, armour every one)
//   purge    wipes the target's shield, guard and attack boosts before the blow
//   freeze   the target misses its next turn (fire thaws it)
//   sleep    the target sleeps for that many of its turns; a blow that lands wakes it
//   toxic    heartburn: the target loses 1, 2, 3, 4… HP after each of its turns until it leaves
//   leech    the target loses that much HP after each of its turns, the fighter facing it gains it
//   charge   adds that much energy to the fighter
//
// Rarity ladder: a common fighter has one move; a rare one adds a talent; an epic one adds a
// super move (`ultimate`, 3 energy) to that; a legendary one has a double talent. Each chain has
// two legendaries.
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
//   pure      sterile: no burn, heartburn, draining, freeze or sleep (one meme fighter only)
//   intimidate lowers the opposing fighter's attack by that much when this one comes onto the field
//   moxie     attack +N after it knocks out an opposing fighter
//   refresh   restores N HP when it leaves the field
//   fresh     takes half damage while at full health
//   parting   knocked out by a blow, it takes N HP from the attacker (never knocks it out)
//   opener    its first blow after coming onto the field is N stronger
//   snack     once per battle, on dropping to half health or below, restores N HP
//   breaker   plain hits go through guard
//
// Transformation (`transform`, a few fighters, a purple mark in the collection): a battle move for
// `cost` energy, once per battle. `effect` acts at once like a free skill; then hp, attack and speed
// are added to the fighter's own, and `skill`, `ultimate` or `trait` (when given) replace the old
// ones. `look` is the menu id whose picture shows the new form.
export const RARITIES = ['common', 'rare', 'epic', 'legendary'];
export const ROLES = { striker: 'Штурмовик', allround: 'Универсал', guard: 'Защитник' };

export const FIGHTERS = {
  // Бургер Кинг — открытый огонь и гриль
  'bk-angus-parmigiano': {
    rarity: 'legendary', role: 'striker', hp: 26, attack: 7, speed: 2, basic: 'Мраморный удар',
    skill: { name: 'Корона пармезана', cost: 2, power: 3, pierce: true },
    ultimate: { name: 'Коронация', cost: 3, power: 5, pierce: true, shatter: true },
    trait: { name: 'Королевский аппетит', laststand: true, moxie: 1 },
  },
  'bk-whopper': {
    rarity: 'epic', role: 'allround', hp: 25, attack: 5, speed: 5, basic: 'Удар с гриля',
    skill: { name: 'Пламя гриля', cost: 1, power: 2, burn: { dmg: 3, turns: 2 } },
    ultimate: { name: 'Королевский гриль', cost: 3, power: 8, burn: { dmg: 3, turns: 2 } },
    trait: { name: 'Закалка огнём', fireproof: true },
  },
  'bk-double-whopper': {
    rarity: 'epic', role: 'striker', hp: 26, attack: 7, speed: 2, basic: 'Двойной удар',
    skill: { name: 'Две котлеты', cost: 2, power: 3, hits: 3 },
    ultimate: { name: 'Двойной прожар', cost: 3, power: 8, shatter: true },
    trait: { name: 'Голодный азарт', moxie: 1 },
  },
  'bk-chicken-parmesan': {
    rarity: 'rare', role: 'striker', hp: 18, attack: 6, speed: 7, basic: 'Хрустящий выпад',
    skill: { name: 'Сырная корочка', cost: 1, power: 2, pierce: true },
    trait: { name: 'Хрустящий выход', opener: 3 },
  },
  'bk-onion-rings': {
    rarity: 'rare', role: 'allround', hp: 16, attack: 5, speed: 7, basic: 'Бросок кольца',
    skill: { name: 'Луковые слёзы', cost: 1, power: 0, weaken: 3 },
    trait: { name: 'Едкий лук', thorns: 1 },
  },
  'bk-fries': {
    rarity: 'common', role: 'striker', hp: 15, attack: 5, speed: 8, basic: 'Хрустящий тычок',
    skill: { name: 'Соль на рану', cost: 1, power: 3 },
  },
  'bk-cheese-sauce': {
    rarity: 'common', role: 'guard', hp: 21, attack: 3, speed: 4, basic: 'Брызги соуса',
    skill: { name: 'Липкий сыр', cost: 2, power: 1, leech: 1, weaken: 3 },
  },
  'bk-shrimps': {
    rarity: 'common', role: 'guard', hp: 15, attack: 5, speed: 9, basic: 'Щипок',
    skill: { name: 'Панцирь в кляре', cost: 2, shield: 3 },
  },
  'bk-cheese-medallions': {
    rarity: 'rare', role: 'striker', hp: 16, attack: 6, speed: 8, basic: 'Бросок медальона',
    skill: { name: 'Горячая начинка', cost: 2, power: 6, burn: { dmg: 1, turns: 3 } },
    trait: { name: 'Расплавленное сердце', fireproof: true },
  },
  'bk-shrimp-roll': {
    rarity: 'common', role: 'allround', hp: 16, attack: 4, speed: 9, basic: 'Удар роллом',
    skill: { name: 'Креветочный ролл', cost: 2, power: 1, shield: 2 },
  },
  'bk-sundae': {
    rarity: 'common', role: 'guard', hp: 25, attack: 5, speed: 5, basic: 'Шоколадные брызги',
    skill: { name: 'Холодный десерт', cost: 2, weaken: 1, heal: 5 },
  },
  'bk-cola-08': {
    rarity: 'epic', role: 'guard', hp: 26, attack: 6, speed: 3, basic: 'Ледяной всплеск',
    skill: { name: 'Ледяной фонтан', cost: 1, power: 2, weaken: 1, cleanse: true },
    ultimate: { name: 'Ледниковый период', cost: 3, power: 3, sap: true, shield: 3 },
    trait: { name: 'Холодная голова', steady: true },
    transform: { name: 'Кола 1 л', cost: 2, hp: 8, attack: 1, look: 'bk-cola-08', effect: { name: 'Литр со льдом', sap: true, shield: 4 } },
  },
  'bk-cola-05': {
    rarity: 'rare', role: 'allround', hp: 22, attack: 5, speed: 6, basic: 'Струя колы',
    skill: { name: 'Шипучка', cost: 2, power: 3, sap: true },
    trait: { name: 'Газировка', quick: 1 },
    transform: { name: 'Кола 0,8 л', cost: 2, hp: 6, attack: 1, look: 'bk-cola-08', effect: { name: 'Долив', heal: 4 }, trait: { name: 'Холодная голова', steady: true } },
  },
  // Стаканы колы: чем больше стакан, тем реже и сильнее боец
  'bk-cola-04': {
    rarity: 'common', role: 'guard', hp: 16, attack: 5, speed: 9, basic: 'Брызги колы',
    skill: { name: 'Глоток со льдом', cost: 1, heal: 6, cleanse: true },
    transform: { name: 'Кола 0,5 л', cost: 2, hp: 6, attack: 1, look: 'bk-cola-05', effect: { name: 'Долив', heal: 4 } },
  },
  'bk-burger-box': {
    rarity: 'legendary', role: 'allround', hp: 22, attack: 7, speed: 2, basic: 'Удар коробкой',
    skill: { name: 'Микс 3 вкусов', cost: 1, power: 1, hits: 4 },
    ultimate: { name: 'Трамвай вкусов', cost: 3, power: 6, hits: 3, team: 4 },
    trait: { name: 'Три в одном', armor: 2, intimidate: 1 },
    transform: { name: 'Бокс нараспашку', cost: 2, attack: 2, effect: { name: 'Бургеры для всех', team: 4 }, skill: { name: 'Три бургера разом', cost: 1, power: 2, hits: 3 } },
  },
  'bk-big-king': {
    rarity: 'epic', role: 'striker', hp: 31, attack: 6, speed: 1, basic: 'Королевский укус',
    skill: { name: 'Двухэтажный удар', cost: 2, power: 0, hits: 4 },
    ultimate: { name: 'Королевский обед', cost: 3, power: 3, sleep: 1 },
    trait: { name: 'Королевский вид', intimidate: 2 },
  },
  'bk-wet-wipe': {
    rarity: 'epic', role: 'guard', hp: 21, attack: 7, speed: 6, basic: 'Шлепок салфеткой',
    skill: { name: 'Протереть', cost: 2, power: 1, purge: true, cleanse: true },
    ultimate: { name: 'Освежающая чистота', cost: 3, power: 3, purge: true, heal: 6, cleanse: true },
    trait: { name: 'Стерильность', pure: true },
  },
  'bk-brownie-ice-cream': {
    rarity: 'epic', role: 'allround', hp: 27, attack: 5, speed: 4, basic: 'Ложка мороженого',
    skill: { name: 'Горячее и холодное', cost: 2, power: 1, weaken: 2 },
    ultimate: { name: 'Шоколадная лавина', cost: 3, power: 6, heal: 2 },
    trait: { name: 'Сладкое спокойствие', steady: true },
    transform: { name: 'Горячий Брауни', cost: 2, attack: 2, speed: 3, look: 'bk-brownie', effect: { name: 'Мороженое в лицо', power: -2, freeze: true }, skill: { name: 'Шоколадный разгон', cost: 1, power: 2, charge: 1 }, trait: { name: 'Горячий нрав', rage: 2 } },
  },
  'bk-fish-burger': {
    rarity: 'rare', role: 'guard', hp: 22, attack: 5, speed: 4, basic: 'Рыбий хвост',
    skill: { name: 'Ледяная рыба', cost: 2, power: -1, freeze: true },
    trait: { name: 'Чешуя', armor: 1 },
  },
  'bk-brownie': {
    rarity: 'rare', role: 'striker', hp: 20, attack: 6, speed: 8, basic: 'Шоколадный тычок',
    skill: { name: 'Сахарный взрыв', cost: 2, power: 0, charge: 2 },
    trait: { name: 'Шоколадный азарт', rage: 2 },
  },
  'bk-sauce-xxl-chili-cheese': {
    rarity: 'epic', role: 'guard', hp: 26, attack: 4, speed: 2, basic: 'XXL плюх',
    skill: { name: 'Двойная порция соуса', cost: 2, power: 2, leech: 3 },
    ultimate: { name: 'Чили-взрыв', cost: 3, power: 3, toxic: true, shield: 4 },
    trait: { name: 'Бездонная банка', snack: 7 },
  },
  'bk-six-sauces': {
    rarity: 'epic', role: 'allround', hp: 24, attack: 7, speed: 5, basic: 'Соусный залп',
    skill: { name: 'Соусный сет', cost: 2, power: 1, hits: 3, weaken: 1 },
    ultimate: { name: 'Все шесть разом', cost: 3, power: 6, hits: 4, toxic: true },
    trait: { name: 'На любой вкус', regen: 1 },
  },
  'bk-cheeseburger-classic': {
    rarity: 'common', role: 'allround', hp: 19, attack: 5, speed: 4, basic: 'Сырный шлепок',
    skill: { name: 'Тянучий сыр', cost: 2, power: 1, leech: 1 },
  },
  'bk-whopper-junior': {
    rarity: 'common', role: 'striker', hp: 21, attack: 5, speed: 4, basic: 'Гриль-тычок',
    skill: { name: 'Маленький гриль', cost: 2, power: 1, burn: { dmg: 2, turns: 3 } },
    transform: { name: 'Воппер', cost: 2, hp: 8, attack: 1, look: 'bk-whopper', effect: { name: 'Подрос на гриле', heal: 4 }, skill: { name: 'Большой гриль', cost: 2, power: 2, burn: { dmg: 3, turns: 2 } } },
  },

  // Вкусно — и точка — классика и большие порции
  'vkusno-big-hit': {
    rarity: 'legendary', role: 'guard', hp: 25, attack: 6, speed: 6, basic: 'Удар котлетой',
    skill: { name: 'Большой хит', cost: 2, power: 0, shield: 5 },
    ultimate: { name: 'Хит сезона', cost: 3, power: 3, shield: 3 },
    trait: { name: 'Тройная броня', armor: 1, thorns: 1 },
  },
  'vkusno-grand': {
    rarity: 'legendary', role: 'allround', hp: 23, attack: 6, speed: 5, basic: 'Гранд-удар',
    skill: { name: 'Двойная котлета', cost: 1, power: 1, buff: 1 },
    ultimate: { name: 'Гранд-финал', cost: 3, power: 5, buff: 1 },
    trait: { name: 'Сытный укус', vamp: 2, intimidate: 1 },
  },
  'vkusno-chicken-premier': {
    rarity: 'epic', role: 'striker', hp: 20, attack: 5, speed: 9, basic: 'Хрустящий удар',
    skill: { name: 'Премьерная панировка', cost: 2, power: 2, shield: 2 },
    ultimate: { name: 'Премьерный выход', cost: 3, power: 8, pierce: true },
    trait: { name: 'Быстрая подача', opener: 3 },
  },
  'vkusno-big-special': {
    rarity: 'rare', role: 'allround', hp: 23, attack: 5, speed: 4, basic: 'Удар соусом',
    skill: { name: 'Особый рецепт', cost: 1, power: 0, heal: 1, buff: 1 },
    trait: { name: 'Секретный соус', snack: 6 },
  },
  'vkusno-chicken-hit': {
    rarity: 'rare', role: 'striker', hp: 20, attack: 5, speed: 9, basic: 'Куриный удар',
    skill: { name: 'Хит дня', cost: 2, power: 1, buff: 1 },
    trait: { name: 'Аппетит', vamp: 2 },
  },
  'vkusno-nuggets': {
    rarity: 'common', role: 'allround', hp: 19, attack: 4, speed: 9, basic: 'Наггетс',
    skill: { name: 'Макни в соус', cost: 2, power: 0, heal: 5 },
    transform: { name: 'Наггетсы ×9', cost: 2, hp: 6, effect: { name: 'Залп наггетсов', power: -2, hits: 3 } },
  },
  'vkusno-pie': {
    rarity: 'common', role: 'allround', hp: 16, attack: 5, speed: 5, basic: 'Горячая начинка',
    skill: { name: 'Осторожно, горячо', cost: 2, power: 1, burn: { dmg: 3, turns: 3 } },
  },
  'vkusno-double-cheeseburger': {
    rarity: 'rare', role: 'striker', hp: 23, attack: 6, speed: 1, basic: 'Сырный хлопок',
    skill: { name: 'Двойная порция', cost: 1, power: -1, execute: 2 },
    trait: { name: 'Двойной слой', armor: 2 },
  },
  'vkusno-caesar-roll': {
    rarity: 'common', role: 'allround', hp: 18, attack: 4, speed: 6, basic: 'Хрустящий лист',
    skill: { name: 'Соус цезарь', cost: 2, power: 0, weaken: 3, heal: 2 },
  },
  'vkusno-chocolate-cake': {
    rarity: 'common', role: 'guard', hp: 24, attack: 5, speed: 5, basic: 'Шоколадная крошка',
    skill: { name: 'Шоколадный слой', cost: 2, heal: 1, shield: 5 },
  },
  'vkusno-macarons': {
    rarity: 'common', role: 'guard', hp: 19, attack: 5, speed: 8, basic: 'Хруст безе',
    skill: { name: 'Сахарная кома', cost: 1, sleep: 1 },
  },
  'vkusno-seasoning-provence-sour-cream': {
    rarity: 'epic', role: 'allround', hp: 19, attack: 6, speed: 7, basic: 'Щепотка',
    skill: { name: 'Прованская посыпка', cost: 2, power: -1, hits: 4, weaken: 1 },
    ultimate: { name: 'Посыпать всё', cost: 3, power: 4, team: 3, buff: 2 },
    trait: { name: 'Аромат трав', quick: 1 },
  },
  'vkusno-hamburger': {
    rarity: 'common', role: 'striker', hp: 16, attack: 5, speed: 4, basic: 'Классика',
    skill: { name: 'Огурчик в лоб', cost: 1, power: 4, pierce: true },
  },

  // Rostic’s — острая хрустящая курица
  'rostics-chefburger': {
    rarity: 'legendary', role: 'allround', hp: 25, attack: 7, speed: 4, basic: 'Удар шефа',
    skill: { name: 'Фирменный рецепт', cost: 2, power: 0, heal: 5 },
    ultimate: { name: 'Шеф на кухне', cost: 3, power: 4, drain: true, team: 3 },
    trait: { name: 'Рука шефа', regen: 1, steady: true },
  },
  'rostics-boxmaster': {
    rarity: 'legendary', role: 'striker', hp: 26, attack: 7, speed: 5, basic: 'Джеб',
    skill: { name: 'Ростмастер-комбо', cost: 1, power: 4, recoil: 3 },
    ultimate: { name: 'Нокаут', cost: 3, power: 6, execute: 1 },
    trait: { name: 'Плотная упаковка', armor: 1, breaker: true },
  },
  'rostics-wings': {
    rarity: 'epic', role: 'striker', hp: 24, attack: 5, speed: 6, basic: 'Острый взмах',
    skill: { name: 'Перечный шторм', cost: 2, power: -1, burn: { dmg: 3, turns: 3 } },
    ultimate: { name: 'Огненный смерч', cost: 3, power: 5, pierce: true, burn: { dmg: 4, turns: 2 } },
    trait: { name: 'Острые перья', parting: 4 },
  },
  'rostics-twister': {
    rarity: 'rare', role: 'allround', hp: 17, attack: 5, speed: 9, basic: 'Скрутка',
    skill: { name: 'Плотный ролл', cost: 2, power: -1, shield: 5 },
    trait: { name: 'Свежая лепёшка', fresh: true },
  },
  'rostics-basket': {
    rarity: 'rare', role: 'guard', hp: 24, attack: 5, speed: 4, basic: 'Удар корзиной',
    skill: { name: 'На всю компанию', cost: 1, power: 0, team: 3 },
    trait: { name: 'Пикник на скамейке', refresh: 5 },
  },
  'rostics-strips': {
    rarity: 'common', role: 'striker', hp: 14, attack: 4, speed: 9, basic: 'Полоска',
    skill: { name: 'Тройная полоска', cost: 1, power: 3, hits: 2 },
  },
  'rostics-bites': {
    rarity: 'common', role: 'allround', hp: 17, attack: 4, speed: 9, basic: 'Укус',
    skill: { name: 'Горсть байтсов', cost: 2, power: 2, hits: 3, drain: true },
  },
  'rostics-drumsticks': {
    rarity: 'common', role: 'guard', hp: 16, attack: 5, speed: 8, basic: 'Пинок',
    skill: { name: 'Подсечка', cost: 1, power: 0, sap: true },
  },
  'rostics-chefburger-junior': {
    rarity: 'common', role: 'striker', hp: 22, attack: 5, speed: 2, basic: 'Мини-удар',
    skill: { name: 'Юный шеф', cost: 2, power: 5, buff: 1 },
    transform: { name: 'Шефбургер', cost: 2, hp: 8, attack: 1, look: 'rostics-chefburger', effect: { name: 'Повышение до шефа', heal: 5 }, skill: { name: 'Шеф на кухне', cost: 2, power: 3, heal: 3 } },
  },
  'rostics-fries': {
    rarity: 'common', role: 'striker', hp: 14, attack: 5, speed: 9, basic: 'Картофельный тычок',
    skill: { name: 'Горсть фри', cost: 1, power: 1, execute: 4 },
  },
  'rostics-ice-cream-cone': {
    rarity: 'common', role: 'guard', hp: 23, attack: 4, speed: 2, basic: 'Холодок',
    skill: { name: 'Заморозка', cost: 1, power: 1, sap: true, cleanse: true },
    transform: { name: 'Растаявший рожок', cost: 2, hp: 4, attack: 1, effect: { name: 'Липкая лужа', weaken: 2, sap: true }, skill: { name: 'Сладкая лужа', cost: 1, power: 1, weaken: 1 } },
  },

  'rostics-i-roll': {
    rarity: 'epic', role: 'allround', hp: 17, attack: 6, speed: 9, basic: 'Ролл в дорогу',
    skill: { name: 'Двойной заворот', cost: 1, power: -1, hits: 2 },
    ultimate: { name: 'Ай-Ролл на вынос', cost: 3, power: 6, hits: 3 },
    trait: { name: 'Быстрый перекус', opener: 3 },
  },
  // Додо Пицца — печь и сыр
  'dodo-pepperoni': {
    rarity: 'legendary', role: 'striker', hp: 20, attack: 7, speed: 7, basic: 'Острый ломтик',
    skill: { name: 'Острые кружки', cost: 1, power: -1, burn: { dmg: 4, turns: 4 } },
    ultimate: { name: 'Пепперони-шторм', cost: 3, power: 2, burn: { dmg: 4, turns: 4 } },
    trait: { name: 'Жар печи', rage: 2, fireproof: true },
  },
  'dodo-four-cheeses': {
    rarity: 'epic', role: 'guard', hp: 22, attack: 5, speed: 6, basic: 'Сырный удар',
    skill: { name: 'Сырный квартет', cost: 2, power: 2, weaken: 1, shield: 3 },
    ultimate: { name: 'Сырная крепость', cost: 3, power: 2, heal: 3, shield: 5 },
    trait: { name: 'Нетронутая корка', fresh: true },
  },
  'dodo-diablo': {
    rarity: 'epic', role: 'striker', hp: 17, attack: 6, speed: 8, basic: 'Перчинка',
    skill: { name: 'Адское пламя', cost: 1, power: 2, burn: { dmg: 4, turns: 3 }, recoil: 1 },
    ultimate: { name: 'Адский жар', cost: 3, power: 5, toxic: true, recoil: 3 },
    trait: { name: 'Огненный нрав', rage: 1 },
  },
  'dodo-dodster': {
    rarity: 'epic', role: 'allround', hp: 17, attack: 6, speed: 9, basic: 'Ролл-удар',
    skill: { name: 'Прямо из печи', cost: 2, power: 0, drain: true },
    ultimate: { name: 'Двойной додстер', cost: 3, power: 2, hits: 2, drain: true },
    trait: { name: 'Тёплый ролл', regen: 2 },
  },
  'dodo-carbonara': {
    rarity: 'rare', role: 'allround', hp: 28, attack: 4, speed: 5, basic: 'Сливочный удар',
    skill: { name: 'Сливочный соус', cost: 2, power: 3, heal: 4 },
    trait: { name: 'Второе блюдо', refresh: 5 },
  },
  'dodo-margherita': {
    rarity: 'rare', role: 'guard', hp: 22, attack: 4, speed: 9, basic: 'Лист базилика',
    skill: { name: 'Итальянская классика', cost: 2, heal: 2, shield: 7 },
    trait: { name: 'Свежий базилик', regen: 2 },
  },
  'dodo-bbq': {
    rarity: 'rare', role: 'allround', hp: 18, attack: 4, speed: 5, basic: 'Копчёный ломтик',
    skill: { name: 'Дымок барбекю', cost: 1, power: 1, burn: { dmg: 1, turns: 2 }, weaken: 2 },
    trait: { name: 'Копчёная злость', rage: 1 },
  },
  'dodo-hawaiian': {
    rarity: 'common', role: 'allround', hp: 21, attack: 5, speed: 3, basic: 'Ананасный кубик',
    skill: { name: 'Сладкий ананас', cost: 1, power: -1, heal: 3 },
  },
  'dodo-cheese': {
    rarity: 'common', role: 'guard', hp: 15, attack: 4, speed: 7, basic: 'Тянучка',
    skill: { name: 'Тянущийся сыр', cost: 2, power: 4, shield: 8 },
  },
  'dodo-oven-potatoes': {
    rarity: 'common', role: 'striker', hp: 12, attack: 5, speed: 8, basic: 'Печёный удар',
    skill: { name: 'Румяная корочка', cost: 1, power: 2, burn: { dmg: 2, turns: 3 } },
  },
  'dodo-cheesecake': {
    rarity: 'common', role: 'allround', hp: 27, attack: 5, speed: 1, basic: 'Нежный удар',
    skill: { name: 'Сладкая пауза', cost: 1, heal: 8 },
  },
  'dodo-cheesy-chicken': {
    rarity: 'legendary', role: 'guard', hp: 26, attack: 5, speed: 6, basic: 'Сырная волна',
    skill: { name: 'Сырные нити', cost: 2, power: 1, leech: 2 },
    ultimate: { name: 'Сырная лавина', cost: 3, power: 7, shield: 6 },
    trait: { name: 'Нежное сердце', regen: 1, laststand: true },
  },
  'dodo-starter-cheese': {
    rarity: 'rare', role: 'striker', hp: 28, attack: 5, speed: 6, basic: 'Хрустящий край',
    skill: { name: 'Конверт с сюрпризом', cost: 1, power: 0, shatter: true },
    trait: { name: 'Хрустящий таран', breaker: true },
  },
  'dodo-syrniki': {
    rarity: 'common', role: 'guard', hp: 16, attack: 5, speed: 3, basic: 'Тёплый сырник',
    skill: { name: 'Утро со сметаной', cost: 1, sleep: 2, heal: 1 },
  },
  'dodo-beak': {
    rarity: 'common', role: 'striker', hp: 16, attack: 5, speed: 7, basic: 'Тычок клювом',
    skill: { name: 'Клевок-клевок-клевок', cost: 1, power: 0, hits: 2 },
    transform: { name: 'Птица Додо', cost: 2, hp: 6, attack: 2, speed: 1, effect: { name: 'Расправленные крылья', power: 0 }, skill: { name: 'Клювом по-взрослому', cost: 1, power: 1, hits: 3 } },
  },
  'dodo-muffin': {
    rarity: 'common', role: 'guard', hp: 21, attack: 4, speed: 4, basic: 'Шоколадный кусь',
    skill: { name: 'Три шоколада', cost: 2, heal: 4, charge: 1 },
    transform: { name: 'Разломанный маффин', cost: 2, attack: 2, effect: { name: 'Шоколадный взрыв', power: 2, hits: 2 }, skill: { name: 'Тёплая начинка', cost: 1, power: 1, heal: 3 } },
  },
};

// Ids that earlier versions could save in a profile, mapped to their replacements.
export const RENAMED = {
  'bk-sauce-sweet-sour': 'bk-six-sauces',
  'bk-sauce-garlic': 'bk-six-sauces',
  'bk-sauce-ketchup': 'bk-six-sauces',
  'bk-sauce-mustard': 'bk-six-sauces',
  'bk-sauce-curry': 'bk-six-sauces',
  'bk-sauce-1000-islands': 'bk-six-sauces',
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
  // What happens before the blow reads first.
  if (skill.shatter) parts.push('сначала сбивает щит и защиту соперника');
  if (skill.purge) parts.push('сначала стирает с соперника щит, защиту и усиления атаки');
  if (Number.isFinite(skill.power)) {
    parts.push(count(Math.max(0, attack + skill.power), { one: 'урон', few: 'урона', many: 'урона', other: 'урона' }) + (skill.pierce ? ' сквозь защиту' : ''));
  }
  if (skill.hits > 1) parts.push('серией из ' + skill.hits + ' ударов');
  if (skill.execute) parts.push('+' + skill.execute + ' по раненому сопернику');
  if (skill.burn) parts.push('поджигает на ' + count(skill.burn.turns, TURNS) + ' соперника: −' + skill.burn.dmg + ' HP за ход');
  if (skill.weaken) parts.push('атака соперника −' + skill.weaken);
  if (skill.sap) parts.push('соперник теряет всю энергию');
  if (skill.drain) parts.push('лечит на половину урона');
  if (skill.heal) parts.push('лечит себя на ' + count(skill.heal, HP));
  if (skill.team) parts.push('лечит всю команду на ' + count(skill.team, HP));
  if (skill.shield) parts.push('щит на ' + skill.shield);
  if (skill.buff) parts.push('своя атака +' + skill.buff);
  if (skill.freeze) parts.push('замораживает: соперник пропускает ход');
  if (skill.sleep) parts.push('усыпляет на ' + count(skill.sleep, TURNS) + ' (удар будит)');
  if (skill.toxic) parts.push('изжога: соперник теряет 1, 2, 3… HP за ход, пока не уйдёт с арены');
  if (skill.leech) parts.push('вытягивает ' + count(skill.leech, HP) + ' за ход себе, пока соперник на арене');
  if (skill.charge) parts.push('своя энергия +' + skill.charge);
  if (skill.cleanse) parts.push('снимает с себя поджог, изжогу и вытягивание');
  if (skill.recoil) parts.push('отдача −' + skill.recoil + ' HP себе');
  const lead = parts.filter(part => part.startsWith('сначала')).length;
  if (lead && parts.length > lead) parts[lead] = 'затем ' + parts[lead];
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
  if (trait.pure) parts.push('не поддаётся поджогу, изжоге, вытягиванию, заморозке и сну');
  if (trait.intimidate) parts.push('при выходе на арену снижает атаку соперника на ' + trait.intimidate);
  if (trait.moxie) parts.push('после нокаута соперника атака +' + trait.moxie);
  if (trait.refresh) parts.push('уходя с арены, восстанавливает ' + count(trait.refresh, HP));
  if (trait.fresh) parts.push('при полном здоровье получает вдвое меньше урона');
  if (trait.parting) parts.push('выбывая от удара, отнимает у обидчика ' + count(trait.parting, HP));
  if (trait.opener) parts.push('первый удар после выхода на арену сильнее на ' + trait.opener);
  if (trait.snack) parts.push('один раз за бой на половине здоровья восстанавливает ' + count(trait.snack, HP));
  if (trait.breaker) parts.push('обычный удар пробивает защиту');
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

// The transformation in one or two sentences: what happens at once, then what the new form brings.
export function describeTransform(transform, attack) {
  if (!transform) return '';
  const now = transform.effect ? describeSkill(transform.effect, attack + (transform.attack ?? 0)).replace(/\.$/, '') : '';
  const stats = [];
  if (transform.hp) stats.push('здоровье ' + (transform.hp > 0 ? '+' : '') + transform.hp);
  if (transform.attack) stats.push('атака ' + (transform.attack > 0 ? '+' : '') + transform.attack);
  if (transform.speed) stats.push('скорость ' + (transform.speed > 0 ? '+' : '') + transform.speed);
  const parts = [];
  if (now) parts.push('Сразу: ' + now.charAt(0).toLowerCase() + now.slice(1) + '.');
  if (stats.length) parts.push('Дальше ' + stats.join(', ') + '.');
  if (transform.skill) parts.push('Новый приём «' + transform.skill.name + '»: ' + describeSkill(transform.skill, attack + (transform.attack ?? 0)).replace(/^./, c => c.toLowerCase()));
  if (transform.ultimate) parts.push('Новый суперприём «' + transform.ultimate.name + '»: ' + describeSkill(transform.ultimate, attack + (transform.attack ?? 0)).replace(/^./, c => c.toLowerCase()));
  if (transform.trait) parts.push('Талант «' + (transform.trait.name ?? 'новый') + '»: ' + describeTrait(transform.trait).replace(/^./, c => c.toLowerCase()));
  return parts.join(' ');
}
