// User-facing changelog: the single source of truth for the in-app "What's
// new" modal, the generated CHANGELOG.md and the GitHub release notes
// (scripts/generate-changelog-md.mjs / generate-release-notes.mjs). Entries
// are coarse outcome statements a driver cares about - never commit-level
// detail; wording follows .claude/rules/voice.md. Maintained by the changelog
// skill (.claude/skills/changelog/SKILL.md), newest first.
//
// Texts live here as data, NOT as I18nKey entries: the dictionary is baked
// into every prerendered page's i18n island, so routing the ever-growing
// changelog history through it would bloat every page. This module is loaded
// lazily by the modal; the entry bundle only carries latest.ts for the badge.
// No runtime imports - scripts import this file under Node type stripping.

import type { Lang } from "../i18n/index.js";

/** What kind of change an entry announces; drives the icon in the modal and
 *  the group label in the generated markdown. */
export type ChangelogCategory = "support" | "feature" | "improvement" | "fix";

export interface ChangelogEntry {
    /** "<yyyy-mm-dd>.<n>" - see src/changelog/id.ts for the contract. */
    id: string;
    category: ChangelogCategory;
    /** One coarse sentence per locale. English is the source of truth for
     *  meaning (voice.md); the markdown generators emit the English text. */
    text: Record<Lang, string>;
}

export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
    {
        id: "2026-08-08.1",
        category: "support",
        text: {
            en: "Beferich dashcams are now supported — the GPS track is read straight from the video files.",
            ru: "Поддержаны регистраторы Beferich — GPS-трек читается прямо из видеофайлов.",
            de: "Beferich-Dashcams werden jetzt unterstützt — der GPS-Track wird direkt aus den Videodateien gelesen.",
            es: "Ya hay soporte para las dashcams Beferich: el track GPS se lee directamente de los archivos de vídeo.",
            fr: "Les dashcams Beferich sont désormais prises en charge — la trace GPS est lue directement dans les fichiers vidéo.",
            pl: "Kamery Beferich są już obsługiwane — ślad GPS jest odczytywany prosto z plików wideo.",
            pt: "As dashcams Beferich agora são compatíveis — a trilha GPS é lida direto dos arquivos de vídeo.",
            zh: "现已支持 Beferich 行车记录仪——GPS 轨迹直接从视频文件中读取。",
            ja: "Beferich のドライブレコーダーに対応しました。GPS トラックは動画ファイルから直接読み取ります。",
            ko: "이제 Beferich 블랙박스를 지원합니다. GPS 트랙을 영상 파일에서 바로 읽어옵니다.",
        },
    },
    {
        id: "2026-08-07.1",
        category: "improvement",
        text: {
            en: "On iPhone and iPad, picking a folder now warns that it copies your recordings — and offers picking just the files you need.",
            ru: "На iPhone и iPad выбор папки теперь предупреждает, что записи будут скопированы, — и предлагает выбрать только нужные файлы.",
            de: "Auf iPhone und iPad warnt die Ordnerauswahl jetzt, dass sie deine Aufnahmen kopiert — und bietet an, nur die benötigten Dateien auszuwählen.",
            es: "En iPhone y iPad, elegir una carpeta ahora avisa de que copiará tus grabaciones y ofrece elegir solo los archivos que necesitas.",
            fr: "Sur iPhone et iPad, le choix d'un dossier prévient désormais qu'il copie tes enregistrements — et propose de ne choisir que les fichiers utiles.",
            pl: "Na iPhonie i iPadzie wybór folderu ostrzega teraz, że skopiuje nagrania — i proponuje wybranie tylko potrzebnych plików.",
            pt: "No iPhone e iPad, escolher uma pasta agora avisa que suas gravações serão copiadas — e oferece escolher só os arquivos necessários.",
            zh: "在 iPhone 和 iPad 上，选择文件夹时会提示将复制你的录像，并提供只选择所需文件的选项。",
            ja: "iPhone・iPad でフォルダを選ぶと、録画がコピーされることを事前に知らせ、必要なファイルだけ選ぶ方法も提案します。",
            ko: "iPhone과 iPad에서 폴더를 선택하면 녹화가 복사된다는 안내가 표시되고, 필요한 파일만 선택하는 방법도 제안합니다.",
        },
    },
    {
        id: "2026-08-04.3",
        category: "improvement",
        text: {
            en: "Trip names, notes and markers save to a notes file next to your recordings and load back on their own.",
            ru: "Названия поездок, заметки и маркеры сохраняются в файл заметок рядом с записями и подхватываются сами.",
            de: "Namen, Notizen und Marker von Fahrten werden in einer Notizdatei neben deinen Aufnahmen gespeichert und von selbst wieder geladen.",
            es: "Los nombres, notas y marcadores de los trayectos se guardan en un archivo de notas junto a tus grabaciones y se cargan solos.",
            fr: "Les noms, notes et marqueurs de trajets sont enregistrés dans un fichier de notes à côté de tes enregistrements et se rechargent tout seuls.",
            pl: "Nazwy, notatki i znaczniki przejazdów zapisują się w pliku notatek obok nagrań i same się wczytują.",
            pt: "Nomes, notas e marcadores das viagens são salvos em um arquivo de notas junto às gravações e carregados de volta sozinhos.",
            zh: "行程名称、笔记和标记会保存到录像旁的笔记文件中，并自动加载。",
            ja: "走行の名前・メモ・マーカーは録画と同じ場所のメモファイルに保存され、次回自動で読み込まれます。",
            ko: "주행 이름, 메모, 마커가 녹화 옆의 메모 파일에 저장되고 자동으로 다시 불러와집니다.",
        },
    },
    {
        id: "2026-08-04.2",
        category: "feature",
        text: {
            en: "Settings now show how much space the recordings cache takes — with a size limit and one-click clearing.",
            ru: "В настройках теперь видно, сколько места занимает кэш записей, — с лимитом размера и очисткой в один клик.",
            de: "Die Einstellungen zeigen jetzt, wie viel Platz der Aufnahmen-Cache belegt — mit Größenlimit und Leeren per Klick.",
            es: "Los ajustes ahora muestran cuánto espacio ocupa la caché de grabaciones, con límite de tamaño y borrado en un clic.",
            fr: "Les réglages montrent désormais l'espace occupé par le cache des enregistrements — avec une limite de taille et un vidage en un clic.",
            pl: "W ustawieniach widać teraz, ile miejsca zajmuje pamięć podręczna nagrań — z limitem rozmiaru i czyszczeniem jednym kliknięciem.",
            pt: "Os ajustes agora mostram quanto espaço o cache de gravações ocupa — com limite de tamanho e limpeza em um clique.",
            zh: "设置中现在可以看到录像缓存占用的空间——支持设置大小上限，一键清除。",
            ja: "設定で録画キャッシュの使用容量を確認できるようになりました。上限の指定もワンクリックでの削除もできます。",
            ko: "설정에서 녹화 캐시가 차지하는 공간을 확인할 수 있습니다. 크기 제한과 한 번의 클릭으로 비우기도 지원합니다.",
        },
    },
    {
        id: "2026-08-04.1",
        category: "feature",
        text: {
            en: "Speed, coordinates and GPS status get their own row under the player — hide it from the view menu if you don't need it.",
            ru: "Скорость, координаты и статус GPS — теперь отдельный ряд под плеером; спрятать его можно в меню «Вид».",
            de: "Tempo, Koordinaten und GPS-Status haben jetzt eine eigene Zeile unter dem Player — ausblendbar über das Ansicht-Menü.",
            es: "La velocidad, las coordenadas y el estado del GPS tienen su propia fila bajo el reproductor; se puede ocultar desde el menú Vista.",
            fr: "Vitesse, coordonnées et état GPS ont leur propre ligne sous le lecteur — masquable depuis le menu Vue.",
            pl: "Prędkość, współrzędne i stan GPS mają teraz własny wiersz pod odtwarzaczem — można go ukryć w menu widoku.",
            pt: "Velocidade, coordenadas e estado do GPS ganharam uma linha própria abaixo do player — dá para ocultar no menu Vista.",
            zh: "速度、坐标和 GPS 状态移到了播放器下方的独立一行——可在视图菜单中隐藏。",
            ja: "速度・座標・GPS の状態はプレーヤー下の専用行に移動しました。表示メニューから非表示にもできます。",
            ko: "속도, 좌표, GPS 상태가 플레이어 아래 전용 줄로 이동했습니다. 보기 메뉴에서 숨길 수 있습니다.",
        },
    },
];
