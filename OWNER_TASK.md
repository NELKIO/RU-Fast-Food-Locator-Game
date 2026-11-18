# Поручение Codex владельца «Фудрадара»

Работай в репозитории `NELKIO/RU-Fast-Food-Locator-Game` с доступом владельца. Игра уже написана. Подготовь `main`, открой pull request из `feature/fast-food-locator` в `main`, проведи ревью всей игры и подготовь GitHub Pages. По умолчанию оставь проверенный PR открытым для решения владельца о выпуске. Это задание можно выполнить в новом чате с отдельным клоном. [Репозиторий](https://github.com/NELKIO/RU-Fast-Food-Locator-Game) · [Исходное игровое ТЗ](https://github.com/NELKIO/RU-Fast-Food-Locator-Game/blob/feature/fast-food-locator/Task.md)

## 1. Подготовь основу для ревью

На момент передачи, 18 ноября 2026 года, на GitHub была одна ветка `feature/fast-food-locator`, она же была веткой по умолчанию. Первый коммит `abe740c` содержит игру, `0576904` добавляет результаты сетевых испытаний. Перед началом проверь фактические ветки и актуальный SHA. Сохрани любые более поздние коммиты.

```sh
git clone --branch feature/fast-food-locator https://github.com/NELKIO/RU-Fast-Food-Locator-Game.git
cd RU-Fast-Food-Locator-Game
git fetch origin
git ls-remote --symref origin HEAD
git ls-remote --heads origin
git status --short --branch
```

**Если `main` отсутствует**, создай для неё независимый пустой первый коммит в отдельной временной папке. Затем присоедини его к истории рабочей ветки. Так GitHub сможет показать в PR все файлы игры. Создание `main` на вершине `feature` даст пустое сравнение. Команды ниже предназначены для чистого клона на ветке `feature/fast-food-locator` и оболочки Bash или Zsh.

```sh
repo_url=$(git remote get-url origin)
baseline_dir=$(mktemp -d)
git init -b main "$baseline_dir"
git -C "$baseline_dir" remote add origin "$repo_url"
git -C "$baseline_dir" commit --allow-empty -m "Initialize main for review"
git -C "$baseline_dir" push origin HEAD:refs/heads/main
```

После успешного создания `main` вернись к работе в клоне игры. При ошибке отправки заново проверь удалённые ветки. Все отправки в этом задании обычные, без принудительной перезаписи истории.

```sh
git fetch origin
git merge --ff-only origin/feature/fast-food-locator
feature_before=$(git rev-parse HEAD)
git merge --allow-unrelated-histories --no-ff origin/main -m "Connect the feature branch to main for review"
git diff --exit-code "$feature_before" HEAD --
git merge-base --is-ancestor origin/main HEAD
git diff --stat origin/main...HEAD
```

Продолжай, когда обе проверки вернут код `0`, а последняя команда покажет файлы игры, тесты, документацию и workflow. Отправь в рабочую ветку только проверенный результат.

```sh
git push origin HEAD:refs/heads/feature/fast-food-locator
```

**Если `main` уже существует**, сохрани её историю. Проверь `git merge-base origin/main origin/feature/fast-food-locator` и сравнение `git diff --stat origin/main...origin/feature/fast-food-locator`. При наличии общего предка и ожидаемого diff сразу переходи к PR. Если истории независимы, объедини `origin/main` с рабочей веткой, сохранив существующие файлы обеих сторон, и проверь результат перед отправкой. При конфликте выясни назначение различий. Если код игры уже попал в `main` и сравнение пусто, покажи владельцу SHA обеих веток и согласуй предмет ревью.

## 2. Открой PR и проведи ревью

1. Выбери `main` веткой по умолчанию в настройках репозитория. Найди открытый PR для этой пары веток или создай его с **base `main`** и **head `feature/fast-food-locator`**. Предлагаемый заголовок — «Фудрадар — карта, коллекция и сетевые дуэли». Открой **Files changed** и убедись, что там видна реализация. [Смена основной ветки](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-branches-in-your-repository/changing-the-default-branch)
2. Прочитай `Task.md`, `PLAN.md`, `DATA.md`, `P2P.md` и `README.md` в рабочей ветке. Вернись к исходникам там, где тесты могут пропустить ошибку. Особое внимание удели геолокации, кулдауну по конкретному адресу, сохранению прогресса, повторной выдаче наград и восстановлению прерванной дуэли.
3. Запиши замечания в PR с файлом, строкой, влиянием на игрока и способом воспроизведения. Исправления вноси в рабочую ветку. После каждого значимого исправления повтори соответствующую проверку. Если правила репозитория требуют независимого одобрения, автор PR может опубликовать своё содержательное ревью и пригласить второго участника для формального **Approve**. [Правила одобрения PR](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews)

Для проверок нужны Node.js 24, Python 3 и Google Chrome. Из корня репозитория выполни

```sh
npm ci
npm test
npm run test:browser
npm run test:duels
```

Запусти `npm start` в отдельном терминале. Пока игра открывается по `http://127.0.0.1:4173/`, выполни `npm run test:themes`. Добавь фактические результаты в PR. На момент передачи проходили 33 теста JavaScript, 5 тестов Python и три браузерных набора.

| Что проверить | Что должен увидеть игрок |
| --- | --- |
| Карта и визит | Адрес и расстояние до выбранной точки, обработка слабого GPS, сигнал у цели, рулетка с блюдом этой сети и переход в первый бой. У двух ресторанов независимые шестичасовые таймеры. |
| Прогресс и оформление | Коллекция, команда, опыт, активная цель и тема сохраняются после перезагрузки. Доступны шесть тем. В чёрной и белой зелёный акцент означает «Вкусно — и точка», красный — Rostic’s, жёлтый — Бургер Кинг, оранжевый — Додо. |
| Онлайн | Два игрока входят по ссылке или коду, выбирают команды и завершают один матч. Отказ одного узла позволяет играть дальше. При обрыве прямой связи работает резерв. У обоих один ID матча, у каждого одна запись результата. |

Три матча уже прошли в двух отдельных Chrome через настоящие публичные узлы, включая бой целиком через резерв. Открытая полевая проверка — один визит с GPS и одна дуэль на двух телефонах в разных мобильных сетях. Если устройства доступны, запиши результат. Иначе сохрани этот пункт в TODO. [Отчёт по сетевым испытаниям](https://github.com/NELKIO/RU-Fast-Food-Locator-Game/blob/feature/fast-food-locator/P2P.md)

## 3. Подготовь GitHub Pages и передай результат

- Проверь видимость репозитория и доступ к Actions. Исходное ТЗ предусматривает публичный репозиторий. Если он ещё закрыт, явно согласуй открытие с владельцем, так как публичной станет и история. Для публичных репозиториев GitHub Pages доступен на GitHub Free. [Настройка видимости](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility) · [Доступность Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- В **Settings → Pages → Build and deployment → Source** выбери **GitHub Actions**, когда эта настройка доступна. В репозитории уже есть `.github/workflows/pages.yml`. Проверь разрешения на публикацию, окружение `github-pages` и загрузку каталога `public/`. Workflow готовит сайт только для `main`. Ручной запуск использует сохранённый каталог, плановый запуск по понедельникам в 04:32 UTC обновляет точки для публикации. [Настройка источника Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- Передай владельцу ссылку на открытый PR, проверенный SHA, итоги ревью и тестов, статус настройки Pages и оставшиеся полевые проверки. Зафиксируй, что уже включено и что ждёт выпуска. При нехватке прав укажи конкретную настройку и одно требуемое действие владельца.

**Когда владелец даст согласие на выпуск**, слей проверенный PR, открой **Actions → Publish the game to GitHub Pages → Run workflow** и выбери `main`. Дождись успеха и открой адрес из результата шага публикации. Проверь загрузку с подпути `/RU-Fast-Food-Locator-Game/`, карту, фотографии, приглашение в дуэль и сохранение после перезагрузки. Запиши проверенный адрес игры и ссылку на запуск в отчёт, обнови TODO в `README.md` через обычный процесс ревью. Первое плановое обновление отметь после его фактического выполнения.
