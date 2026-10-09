import type { Lang } from "../i18n/index.js";

export type MigrationLang = Lang;

const en = {
    title: "Save your dashcamigo notes",
    intro: "dashcamigo is moving to everydashcam.app. Save your notes here so you can restore them at the new address.",
    source: "Reading notes saved at",
    scope: "Use the same browser, profile and address where you saved your notes. Each address keeps its own copy.",
    loading: "Reading your saved notes…",
    ready: "Your notes, markers and favorites are ready to save.",
    empty: "No saved notes were found here. If you expected some, open this page in the browser, profile and address you used before. If you saved a notes backup to a file, keep that file too.",
    error: "Couldn't read your notes. Close this page and try again. If it still fails, check that this browser allows saved site data. Don't clear site data or remove the installed app; contact feedback@dashcamigo.app for help.",
    downloadError: "Couldn't save the file. Allow downloads for this site and try again.",
    saved: "Check that the notes backup is in your downloads before you continue.",
    download: "Save notes backup",
    retry: "Try again",
    next: "After saving",
    restore:
        "When the new address is available, open it directly. In Settings → Trip notes, choose “Restore notes backup…” and select the file you saved. Restoring the same file again won't create duplicates.",
    folders: "Choose your recording folders again at the new address. Your recordings stay on your device.",
    installed:
        "If you installed dashcamigo, save your notes from that app before removing it. Check your restored notes at the new address, then install the app there again.",
    privacy: "This page only reads your saved notes. Nothing is uploaded or deleted.",
    language: "Language",
} as const;

type MigrationKey = keyof typeof en;

const ru = {
    title: "Сохрани заметки dashcamigo",
    intro: "dashcamigo переезжает на everydashcam.app. Сохрани здесь заметки, чтобы восстановить их по новому адресу.",
    source: "Заметки с адреса",
    scope: "Используй тот же браузер, профиль и адрес, где сохранял заметки. На каждом адресе хранится своя копия.",
    loading: "Читаем сохранённые заметки…",
    ready: "Заметки, маркеры и избранное готовы к сохранению.",
    empty: "Здесь нет сохранённых заметок. Если они должны быть, открой эту страницу в прежнем браузере, профиле и по прежнему адресу. Если сохранял резервную копию заметок в файл, сохрани и этот файл.",
    error: "Не удалось прочитать заметки. Закрой эту страницу и попробуй снова. Если не поможет, проверь, разрешено ли браузеру сохранять данные сайтов. Не очищай данные сайта и не удаляй установленное приложение; напиши на feedback@dashcamigo.app.",
    downloadError: "Не удалось сохранить файл. Разреши скачивание файлов с этого сайта и попробуй снова.",
    saved: "Проверь, что резервная копия заметок появилась в загрузках, прежде чем продолжить.",
    download: "Сохранить резервную копию заметок",
    retry: "Попробовать снова",
    next: "После сохранения",
    restore:
        "Когда новый адрес станет доступен, открой его напрямую. В разделе «Настройки → Пометки о поездках» нажми «Восстановить копию пометок…» и выбери сохранённый файл. Повторное восстановление из того же файла не создаст дубликатов.",
    folders: "На новом адресе выбери папки с записями заново. Сами записи останутся на твоём устройстве.",
    installed:
        "Если ты установил dashcamigo, сохрани заметки из этого приложения до его удаления. Проверь восстановленные заметки по новому адресу, затем установи приложение оттуда заново.",
    privacy: "Эта страница только читает сохранённые заметки. Ничего не отправляется и не удаляется.",
    language: "Язык",
} satisfies Record<MigrationKey, string>;

const de = {
    title: "Sichere deine dashcamigo-Notizen",
    intro: "dashcamigo zieht zu everydashcam.app um. Sichere deine Notizen hier, damit du sie unter der neuen Adresse wiederherstellen kannst.",
    source: "Notizen von dieser Adresse",
    scope: "Nutze denselben Browser, dasselbe Profil und dieselbe Adresse, unter der du deine Notizen gespeichert hast. Jede Adresse hat ihre eigene Kopie.",
    loading: "Gespeicherte Notizen werden gelesen…",
    ready: "Deine Notizen, Marker und Favoriten sind bereit zum Sichern.",
    empty: "Hier wurden keine gespeicherten Notizen gefunden. Wenn du welche erwartest, öffne diese Seite im zuvor verwendeten Browser und Profil unter der bisherigen Adresse. Bewahre auch eine vorhandene Sicherungsdatei deiner Notizen auf.",
    error: "Deine Notizen konnten nicht gelesen werden. Schließe diese Seite und versuche es erneut. Falls es weiterhin nicht klappt, prüfe, ob dein Browser Website-Daten speichern darf. Lösche keine Website-Daten und entferne die installierte App nicht. Hilfe bekommst du unter feedback@dashcamigo.app.",
    downloadError:
        "Die Datei konnte nicht gespeichert werden. Erlaube Downloads für diese Website und versuche es erneut.",
    saved: "Prüfe, ob die Notizen-Sicherung in deinen Downloads liegt, bevor du fortfährst.",
    download: "Notizen-Sicherung speichern",
    retry: "Erneut versuchen",
    next: "Nach dem Sichern",
    restore:
        "Öffne die neue Adresse direkt, sobald sie verfügbar ist. Wähle unter Einstellungen → Fahrtnotizen „Notizen-Sicherung wiederherstellen…“ und dann die gespeicherte Datei. Erneutes Wiederherstellen derselben Datei erzeugt keine Duplikate.",
    folders: "Wähle deine Aufnahmeordner unter der neuen Adresse erneut aus. Deine Aufnahmen bleiben auf deinem Gerät.",
    installed:
        "Wenn du dashcamigo installiert hast, sichere deine Notizen in dieser App, bevor du sie entfernst. Prüfe die wiederhergestellten Notizen unter der neuen Adresse und installiere die App dann dort erneut.",
    privacy: "Diese Seite liest nur deine gespeicherten Notizen. Nichts wird hochgeladen oder gelöscht.",
    language: "Sprache",
} satisfies Record<MigrationKey, string>;

const es = {
    title: "Guarda tus notas de dashcamigo",
    intro: "dashcamigo se muda a everydashcam.app. Guarda tus notas aquí para poder restaurarlas en la nueva dirección.",
    source: "Notas guardadas en",
    scope: "Usa el mismo navegador, perfil y dirección donde guardaste tus notas. Cada dirección tiene su propia copia.",
    loading: "Leyendo tus notas guardadas…",
    ready: "Tus notas, marcadores y favoritos están listos para guardar.",
    empty: "No se encontraron notas guardadas aquí. Si esperabas encontrarlas, abre esta página en el navegador, perfil y dirección que usabas antes. Si tienes una copia de tus notas en un archivo, consérvala también.",
    error: "No se pudieron leer tus notas. Cierra esta página e inténtalo de nuevo. Si sigue fallando, comprueba que el navegador permita guardar datos de sitios web. No borres esos datos ni desinstales la app; escribe a feedback@dashcamigo.app para pedir ayuda.",
    downloadError: "No se pudo guardar el archivo. Permite las descargas de este sitio e inténtalo de nuevo.",
    saved: "Comprueba que la copia de notas esté en tus descargas antes de continuar.",
    download: "Guardar copia de notas",
    retry: "Intentar de nuevo",
    next: "Después de guardar",
    restore:
        "Cuando la nueva dirección esté disponible, ábrela directamente. En Ajustes → Notas de trayectos, elige «Restaurar copia de notas…» y selecciona el archivo que guardaste. Restaurar el mismo archivo de nuevo no creará duplicados.",
    folders:
        "Vuelve a elegir tus carpetas de grabaciones en la nueva dirección. Tus grabaciones permanecen en tu dispositivo.",
    installed:
        "Si instalaste dashcamigo, guarda las notas desde esa app antes de desinstalarla. Comprueba las notas restauradas en la nueva dirección y vuelve a instalar la app desde allí.",
    privacy: "Esta página solo lee tus notas guardadas. No se sube ni se elimina nada.",
    language: "Idioma",
} satisfies Record<MigrationKey, string>;

const fr = {
    title: "Sauvegarde tes notes dashcamigo",
    intro: "dashcamigo déménage vers everydashcam.app. Sauvegarde tes notes ici pour pouvoir les restaurer à la nouvelle adresse.",
    source: "Notes enregistrées à cette adresse",
    scope: "Utilise le même navigateur, le même profil et la même adresse que pour tes notes. Chaque adresse conserve sa propre copie.",
    loading: "Lecture de tes notes enregistrées…",
    ready: "Tes notes, repères et favoris sont prêts à être sauvegardés.",
    empty: "Aucune note enregistrée ici. Si tu pensais en trouver, ouvre cette page dans le navigateur et le profil que tu utilisais, à la même adresse. Si tu as une sauvegarde de tes notes dans un fichier, conserve-la aussi.",
    error: "Impossible de lire tes notes. Ferme cette page et réessaie. Si le problème persiste, vérifie que ton navigateur autorise l’enregistrement des données des sites. N’efface pas ces données et ne désinstalle pas l’app ; écris à feedback@dashcamigo.app pour obtenir de l’aide.",
    downloadError: "Impossible d’enregistrer le fichier. Autorise les téléchargements pour ce site et réessaie.",
    saved: "Vérifie que la sauvegarde des notes est dans tes téléchargements avant de continuer.",
    download: "Sauvegarder les notes",
    retry: "Réessayer",
    next: "Après la sauvegarde",
    restore:
        "Quand la nouvelle adresse sera disponible, ouvre-la directement. Dans Paramètres → Notes de trajets, choisis « Restaurer une sauvegarde de notes… » et sélectionne ton fichier. Restaurer à nouveau le même fichier ne créera pas de doublons.",
    folders:
        "Choisis à nouveau tes dossiers d’enregistrements à la nouvelle adresse. Tes enregistrements restent sur ton appareil.",
    installed:
        "Si tu as installé dashcamigo, sauvegarde tes notes depuis cette app avant de la désinstaller. Vérifie les notes restaurées à la nouvelle adresse, puis réinstalle l’app depuis celle-ci.",
    privacy: "Cette page lit uniquement tes notes enregistrées. Rien n’est envoyé ni supprimé.",
    language: "Langue",
} satisfies Record<MigrationKey, string>;

const ja = {
    title: "dashcamigo のメモを保存",
    intro: "dashcamigo は everydashcam.app に移転します。新しいアドレスで復元できるように、ここでメモを保存してください。",
    source: "メモの保存元",
    scope: "メモを保存したときと同じブラウザ、プロフィール、アドレスを使ってください。メモはアドレスごとに別々に保存されています。",
    loading: "保存済みのメモを読み込んでいます…",
    ready: "メモ、マーカー、お気に入りを保存できます。",
    empty: "ここには保存済みのメモがありません。メモがあるはずの場合は、以前使っていたブラウザ、プロフィール、アドレスでこのページを開いてください。メモのバックアップファイルがある場合は、そのファイルも保管してください。",
    error: "メモを読み込めませんでした。このページを閉じて、もう一度試してください。解決しない場合は、ブラウザでサイトデータの保存が許可されているか確認してください。サイトデータを消去したり、インストール済みのアプリを削除したりせず、feedback@dashcamigo.app にお問い合わせください。",
    downloadError: "ファイルを保存できませんでした。このサイトからのダウンロードを許可して、もう一度試してください。",
    saved: "続ける前に、ダウンロード先にメモのバックアップがあることを確認してください。",
    download: "メモのバックアップを保存",
    retry: "もう一度試す",
    next: "保存したあと",
    restore:
        "新しいアドレスが利用できるようになったら、直接開いてください。「設定 → 走行メモ」で「メモのバックアップを復元…」を選び、保存したファイルを指定してください。同じファイルを再度復元しても、メモは重複しません。",
    folders: "新しいアドレスで録画フォルダをもう一度選んでください。録画はお使いの端末に残ります。",
    installed:
        "dashcamigo をインストールしている場合は、アプリを削除する前にそのアプリからメモを保存してください。新しいアドレスで復元されたメモを確認してから、アプリを再インストールしてください。",
    privacy: "このページは保存済みのメモを読み取るだけです。アップロードや削除は行いません。",
    language: "言語",
} satisfies Record<MigrationKey, string>;

const ko = {
    title: "dashcamigo 메모 저장",
    intro: "dashcamigo가 everydashcam.app으로 이전해요. 새 주소에서 복원할 수 있도록 여기서 메모를 저장해 주세요.",
    source: "메모가 저장된 주소",
    scope: "메모를 저장했던 브라우저, 프로필, 주소를 그대로 사용해 주세요. 주소마다 메모가 따로 저장돼요.",
    loading: "저장된 메모를 읽는 중…",
    ready: "메모, 마커, 즐겨찾기를 저장할 준비가 됐어요.",
    empty: "여기에는 저장된 메모가 없어요. 메모가 있어야 한다면 이전에 사용했던 브라우저, 프로필, 주소에서 이 페이지를 열어 주세요. 메모 백업 파일이 있다면 그 파일도 보관해 주세요.",
    error: "메모를 읽지 못했어요. 이 페이지를 닫고 다시 시도해 주세요. 계속 안 되면 브라우저에서 사이트 데이터 저장을 허용하는지 확인해 주세요. 사이트 데이터를 지우거나 설치한 앱을 삭제하지 말고 feedback@dashcamigo.app으로 문의해 주세요.",
    downloadError: "파일을 저장하지 못했어요. 이 사이트의 다운로드를 허용하고 다시 시도해 주세요.",
    saved: "계속하기 전에 다운로드 폴더에 메모 백업이 있는지 확인해 주세요.",
    download: "메모 백업 저장",
    retry: "다시 시도",
    next: "저장한 다음",
    restore:
        "새 주소를 사용할 수 있게 되면 직접 열어 주세요. 설정 → 주행 메모에서 ‘메모 백업 복원…’을 선택하고 저장한 파일을 골라 주세요. 같은 파일을 다시 복원해도 중복되지 않아요.",
    folders: "새 주소에서 녹화 폴더를 다시 선택해 주세요. 녹화 파일은 기기에 그대로 남아요.",
    installed:
        "dashcamigo를 설치했다면 앱을 삭제하기 전에 그 앱에서 메모를 저장해 주세요. 새 주소에서 복원된 메모를 확인한 다음 앱을 다시 설치해 주세요.",
    privacy: "이 페이지는 저장된 메모를 읽기만 해요. 업로드하거나 삭제하지 않아요.",
    language: "언어",
} satisfies Record<MigrationKey, string>;

const pl = {
    title: "Zapisz swoje notatki dashcamigo",
    intro: "dashcamigo przenosi się na everydashcam.app. Zapisz tutaj swoje notatki, aby przywrócić je pod nowym adresem.",
    source: "Notatki zapisane pod adresem",
    scope: "Użyj tej samej przeglądarki, profilu i adresu, w których zapisujesz notatki. Każdy adres przechowuje osobną kopię.",
    loading: "Odczytywanie zapisanych notatek…",
    ready: "Twoje notatki, znaczniki i ulubione są gotowe do zapisania.",
    empty: "Nie znaleziono tu zapisanych notatek. Jeśli powinny tu być, otwórz tę stronę w poprzednio używanej przeglądarce i profilu, pod tym samym adresem. Zachowaj też wcześniejszą kopię notatek w pliku, jeśli ją masz.",
    error: "Nie udało się odczytać notatek. Zamknij tę stronę i spróbuj ponownie. Jeśli to nie pomoże, sprawdź, czy przeglądarka pozwala zapisywać dane witryn. Nie usuwaj tych danych ani zainstalowanej aplikacji; napisz na feedback@dashcamigo.app, aby uzyskać pomoc.",
    downloadError: "Nie udało się zapisać pliku. Zezwól na pobieranie z tej witryny i spróbuj ponownie.",
    saved: "Zanim przejdziesz dalej, sprawdź, czy kopia notatek jest w pobranych plikach.",
    download: "Zapisz kopię notatek",
    retry: "Spróbuj ponownie",
    next: "Po zapisaniu",
    restore:
        "Gdy nowy adres będzie dostępny, otwórz go bezpośrednio. W Ustawienia → Notatki z przejazdów wybierz „Przywróć kopię notatek…” i wskaż zapisany plik. Ponowne przywrócenie tego samego pliku nie utworzy duplikatów.",
    folders: "Pod nowym adresem ponownie wybierz foldery z nagraniami. Same nagrania pozostaną na Twoim urządzeniu.",
    installed:
        "Jeśli masz zainstalowane dashcamigo, zapisz notatki z tej aplikacji przed jej usunięciem. Sprawdź przywrócone notatki pod nowym adresem, a potem zainstaluj stamtąd aplikację ponownie.",
    privacy: "Ta strona tylko odczytuje zapisane notatki. Nic nie jest wysyłane ani usuwane.",
    language: "Język",
} satisfies Record<MigrationKey, string>;

const pt = {
    title: "Salve suas anotações do dashcamigo",
    intro: "O dashcamigo vai mudar para everydashcam.app. Salve suas anotações aqui para restaurá-las no novo endereço.",
    source: "Anotações salvas em",
    scope: "Use o mesmo navegador, perfil e endereço em que salvou suas anotações. Cada endereço guarda sua própria cópia.",
    loading: "Lendo suas anotações salvas…",
    ready: "Suas anotações, marcadores e favoritos estão prontos para salvar.",
    empty: "Nenhuma anotação salva foi encontrada aqui. Se esperava encontrar alguma, abra esta página no navegador, perfil e endereço que usava antes. Se você tem um backup das anotações em um arquivo, guarde esse arquivo também.",
    error: "Não foi possível ler suas anotações. Feche esta página e tente de novo. Se continuar falhando, confira se o navegador permite salvar dados de sites. Não apague esses dados nem remova o app instalado; escreva para feedback@dashcamigo.app para pedir ajuda.",
    downloadError: "Não foi possível salvar o arquivo. Permita downloads deste site e tente de novo.",
    saved: "Confira se o backup das anotações está nos seus downloads antes de continuar.",
    download: "Salvar backup das anotações",
    retry: "Tentar de novo",
    next: "Depois de salvar",
    restore:
        "Quando o novo endereço estiver disponível, abra-o diretamente. Em Configurações → Anotações de viagens, escolha “Restaurar backup das anotações…” e selecione o arquivo que salvou. Restaurar o mesmo arquivo de novo não criará duplicatas.",
    folders: "Escolha suas pastas de gravações novamente no novo endereço. Suas gravações ficam no seu dispositivo.",
    installed:
        "Se você instalou o dashcamigo, salve suas anotações por esse app antes de removê-lo. Confira as anotações restauradas no novo endereço e depois instale o app novamente por lá.",
    privacy: "Esta página só lê suas anotações salvas. Nada é enviado nem apagado.",
    language: "Idioma",
} satisfies Record<MigrationKey, string>;

const zh = {
    title: "保存你的 dashcamigo 备注",
    intro: "dashcamigo 即将迁移到 everydashcam.app。在这里保存备注，以便在新地址恢复。",
    source: "备注保存于",
    scope: "请使用保存备注时的浏览器、用户配置和地址。每个地址单独保存一份备注。",
    loading: "正在读取已保存的备注…",
    ready: "你的备注、标记和收藏已准备好保存。",
    empty: "这里没有找到已保存的备注。如果你认为应该有，请在之前使用的浏览器、用户配置和地址中打开此页面。如果你已将备注备份到文件，也请保留该文件。",
    error: "无法读取备注。请关闭此页面后重试。如果仍然失败，请检查浏览器是否允许保存网站数据。不要清除网站数据或卸载已安装的应用；请联系 feedback@dashcamigo.app 获取帮助。",
    downloadError: "无法保存文件。请允许此网站下载文件后重试。",
    saved: "继续之前，请确认下载文件夹中已有备注备份。",
    download: "保存备注备份",
    retry: "重试",
    next: "保存之后",
    restore:
        "新地址可用后，请直接打开。在“设置 → 行程备注”中选择“恢复备注备份…”，然后选择保存的文件。再次恢复同一文件不会产生重复条目。",
    folders: "请在新地址重新选择录像文件夹。录像仍保留在你的设备上。",
    installed:
        "如果你安装了 dashcamigo，请先从该应用保存备注，再卸载应用。在新地址确认备注已恢复后，再从那里重新安装应用。",
    privacy: "此页面仅读取已保存的备注，不会上传或删除任何内容。",
    language: "语言",
} satisfies Record<MigrationKey, string>;

const dictionaries = { de, en, es, fr, ja, ko, pl, pt, ru, zh } satisfies Record<
    MigrationLang,
    Record<MigrationKey, string>
>;

export function isMigrationLanguage(value: string | null): value is MigrationLang {
    return value !== null && Object.hasOwn(dictionaries, value);
}

export function migrationText(lang: MigrationLang, key: MigrationKey): string {
    return dictionaries[lang][key];
}

export function migrationLanguage(): MigrationLang {
    const explicit = new URLSearchParams(location.search).get("lang");
    if (isMigrationLanguage(explicit)) return explicit;
    try {
        // Recovery reads legacy preferences without changing the old origin.
        const stored = localStorage.getItem("dashcamigo:lang") ?? localStorage.getItem("everydashcam:lang");
        if (isMigrationLanguage(stored)) return stored;
    } catch {
        // Reading notes must still work when preferences are unavailable.
    }
    const browser = navigator.language.toLowerCase().split("-")[0] ?? null;
    return isMigrationLanguage(browser) ? browser : "en";
}

export function applyMigrationLanguage(lang: MigrationLang): void {
    document.documentElement.lang = lang;
    document.title = migrationText(lang, "title");
    for (const element of document.querySelectorAll<HTMLElement>("[data-migrate-copy]")) {
        const key = element.dataset.migrateCopy;
        if (key && Object.hasOwn(en, key)) element.textContent = migrationText(lang, key as MigrationKey);
    }
}
