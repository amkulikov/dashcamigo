// Machine-translated content for the 8 community locales of the competitor
// "alternative-to" pages (de, es, fr, ja, ko, pl, pt, zh). English and
// Russian are hand-written inline in alternative-pages.ts; this file holds the
// rest, split out to keep that file readable (same pattern as
// vendor-community-faq.ts). Parity with the en/ru source is enforced at build
// time by assertAltLocaleParity().
//
// Generated from the alt-pages-localize translation workflows. LLM translations
// are final for community locales (project policy: no native-review gate). The
// comparison-table marks (yes/no/partial) are forced from the English source at
// generation time, so only the translated text varies per locale - the factual
// verdicts cannot drift. To re-translate, re-run the workflow and regenerate.

import type { AltIndexLocale, AltLocaleContent, AltSharedLabels, AltSlug } from "./alternative-pages.js";
import type { Lang } from "../src/i18n/index.js";

export const COMMUNITY_ALT_CONTENT: Record<AltSlug, Partial<Record<Lang, AltLocaleContent>>> = {
    "registratorviewer": {
        "de": {
            "title": "RegistratorViewer-Alternative — kostenloser Dashcam-Player im Browser | dashcamigo",
            "metaDescription": "Eine kostenlose, gepflegte RegistratorViewer-Alternative im Browser für Windows, Mac, Linux und mobil — GPS-Karte, Geschwindigkeitsdiagramm und eine Karte ohne API-Schlüssel, der ablaufen kann. Keine Installation.",
            "ogTitle": "RegistratorViewer-Alternative — kostenlos, im Browser",
            "ogDescription": "RegistratorViewer ist ein großartiger, aber seit 2015 nicht mehr gepflegter Windows-Player, dessen eingebaute Karte nicht mehr funktioniert. dashcamigo ist die gepflegte, plattformübergreifende Alternative im Browser.",
            "h1": "Eine kostenlose RegistratorViewer-Alternative, die noch Updates bekommt — und eine Karte, die funktioniert",
            "lead": "RegistratorViewer (auch bekannt als DATAKAM Player) war einer der besten kostenlosen Dashcam-Player seiner Zeit — aber seit Jahren gibt es keine Updates mehr, er ist Windows-zentriert, und seine eingebaute Google-Karte funktioniert nicht mehr, seit Google den kostenlosen, schlüssellosen Zugriff auf seine Maps-API beendete. dashcamigo macht da weiter, wo er aufgehört hat: ein gepflegter Player im Browser mit synchroner GPS-Karte, einem Diagramm für Geschwindigkeit und G-Kraft und einer schlüssellosen Karte, bei der kein API-Schlüssel ablaufen kann.",
            "cardHint": "Kostenlos, aber seit 2015 ohne Updates — und die eingebaute Karte funktioniert nicht mehr",
            "whatItIs": "RegistratorViewer (und als DATAKAM Player für DATAKAM-Kameras gebündelt) ist ein kostenloser Desktop-Player für Windows, der seiner Zeit wirklich voraus war — verlustfreies Schneiden und Zusammenfügen, durchgängige Wiedergabe über Dateigrenzen hinweg, ein GPS-Track mit Geschwindigkeits- und G-Sensor-Diagrammen, Einzelbildaufnahme mit GPS im EXIF des Fotos und Track-Export nach GPX, KML und SRT. Viele Aufnahmen spielt er immer noch problemlos ab. Der Haken ist die Langlebigkeit: Die Entwicklung endete 2015, die ursprüngliche Website ist verschwunden, und die eingebaute Google-Karte funktioniert nicht mehr, seit Google den schlüssellosen Zugriff auf die Maps-API beendete — sie heute wiederzubeleben, erfordert eine Anpassung der Windows-Registry oder einen inoffiziellen Community-Build. Eine offizielle Lösung gibt es nicht, weil das Projekt nicht mehr gepflegt wird und der Quellcode nie veröffentlicht wurde.",
            "comparisonIntro": "RegistratorViewer ist im Jahr 2015 eingefroren. So schneidet dashcamigo bei den Dingen ab, die am schlechtesten gealtert sind — und bei denen, wo beide schlicht gleichauf liegen.",
            "compareRows": [
                {
                    "dimension": "Preis",
                    "us": {
                        "mark": "yes",
                        "note": "Kostenlos"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Kostenlos"
                    }
                },
                {
                    "dimension": "Läuft auf Mac, Linux & mobil",
                    "us": {
                        "mark": "yes",
                        "note": "Jeder aktuelle Browser"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Windows-zentriert (es gibt einen separaten, eingeschränkten Mac-Build)"
                    }
                },
                {
                    "dimension": "Wird noch gepflegt",
                    "us": {
                        "mark": "yes",
                        "note": "Aktiv weiterentwickelt"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Keine Updates seit 2015"
                    }
                },
                {
                    "dimension": "Eingebaute Karte",
                    "us": {
                        "mark": "yes",
                        "note": "Live, schlüssellos — kein API-Schlüssel, der ablaufen kann"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Funktioniert nach Googles API-Änderung nicht mehr; braucht eine manuelle Reparatur"
                    }
                },
                {
                    "dimension": "Geschwindigkeits- & G-Kraft-Diagramm",
                    "us": {
                        "mark": "yes",
                        "note": "Ja"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Ja"
                    }
                },
                {
                    "dimension": "Schneiden & Export",
                    "us": {
                        "mark": "yes",
                        "note": "Schneiden + MP4 mit GPS, plus .gpx"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Verlustfreier Schnitt + GPX/KML/SRT"
                    }
                },
                {
                    "dimension": "Nichts zu installieren",
                    "us": {
                        "mark": "yes",
                        "note": "Öffnet im Browser"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Portable .exe, keine Installation"
                    }
                }
            ],
            "whenStayTitle": "Wann sich RegistratorViewer noch lohnt",
            "whenStay": "RegistratorViewer unterstützt eine lange Liste älterer und weniger bekannter Kameras, die dashcamigo noch nicht einliest, kann einen ganzen Ordner voller Clips verlustfrei zu einer einzigen Datei zusammenfügen, repariert beschädigte Aufnahmen und läuft als Desktop-App vollständig offline. Wenn du auf Windows bist, deine Kamera auf seiner Kompatibilitätsliste steht und du seine Karte bereits zum Laufen gebracht hast, ist er immer noch ein fähiges Tool. Und wenn dashcamigo deine Kamera noch nicht einliest, schick uns einfach ein Beispiel an feedback@dashcamigo.app — wir ergänzen Formate anhand echter Aufnahmen, und wir wollen, dass es jede Dashcam unterstützt.",
            "ctaPrimary": "Deine Aufnahmen öffnen",
            "faq": [
                {
                    "q": "Ist dashcamigo ein vollwertiger Ersatz für RegistratorViewer?",
                    "a": "Für die Kernaufgabe — Dashcam-Aufnahmen mit einer GPS-Karte, einem Geschwindigkeits- und G-Kraft-Diagramm öffnen und einen Clip schneiden — ja, und es läuft in jedem aktuellen Browser, ohne dass etwas zu installieren ist. RegistratorViewer hat immer noch eine breitere Liste älterer Geräte und ein paar Spezialfunktionen (verlustfreies Zusammenfügen mehrerer Dateien, Reparatur beschädigter Dateien); dashcamigo konzentriert sich auf ein gepflegtes, plattformübergreifendes Erlebnis mit einer Karte, die weiter funktioniert."
                },
                {
                    "q": "Warum funktioniert die Karte von RegistratorViewer nicht mehr?",
                    "a": "Seine eingebaute Routenkarte stellte Google Maps über eine eingebettete Internet-Explorer-Ansicht dar. Als Google den kostenlosen, schlüssellosen Zugriff auf seine Maps-API beendete, begann die Karte zu versagen, und die Website, die einen Teil des Karten-Skripts hostete, ging offline. Da das Projekt nicht mehr gepflegt wird und der Quellcode nie veröffentlicht wurde, gibt es keine offizielle Lösung — nur manuelle Registry-Bearbeitungen oder inoffizielle Community-Builds. dashcamigo umgeht das ganze Problem: Seine Karte ist schlüsselloses MapLibre + OpenFreeMap, es gibt also keinen API-Schlüssel, der ablaufen könnte."
                },
                {
                    "q": "Funktioniert dashcamigo auf Mac, Linux oder meinem Smartphone?",
                    "a": "Ja. Es läuft im Browser, also funktionieren Windows, macOS, Linux und mobil alle. RegistratorViewer ist Windows-zentriert; sein Mac-Build ist eine separate, funktional eingeschränkte App, die hauptsächlich über Drittanbieter-Spiegel verteilt wird."
                },
                {
                    "q": "Werden meine Aufnahmen irgendwohin hochgeladen?",
                    "a": "Nein. dashcamigo hat keinen Server für deine Aufnahmen. Dein Browser liest die Dateien direkt von deinem Gerät — es wird nichts hochgeladen. Dieselbe Privatsphäre wie bei einem Desktop-Player, nur ohne dass du einen installieren musst."
                },
                {
                    "q": "Ist dashcamigo kostenlos wie RegistratorViewer?",
                    "a": "Ja, völlig kostenlos — kein Konto, keine kostenpflichtige Stufe, kein Testlimit."
                }
            ]
        },
        "es": {
            "title": "Alternativa a RegistratorViewer — visor de dashcam gratuito en tu navegador | dashcamigo",
            "metaDescription": "Una alternativa a RegistratorViewer gratuita y con mantenimiento que funciona en tu navegador en Windows, Mac, Linux y móvil — mapa GPS, gráfico de velocidad y un mapa sin clave de API que pueda caducar. Sin instalar.",
            "ogTitle": "Alternativa a RegistratorViewer — gratis, en tu navegador",
            "ogDescription": "RegistratorViewer es un gran visor de Windows sin mantenimiento desde hace tiempo (última actualización en 2015) cuyo mapa integrado ya no funciona. dashcamigo es la alternativa con mantenimiento, multiplataforma y en el navegador.",
            "h1": "Una alternativa gratuita a RegistratorViewer que sigue recibiendo actualizaciones — y un mapa que funciona",
            "lead": "RegistratorViewer (también conocido como DATAKAM Player) fue uno de los mejores visores de dashcam gratuitos de su época — pero lleva años sin actualizaciones, está pensado primero para Windows y su mapa integrado de Google dejó de funcionar cuando Google cerró el acceso gratuito y sin clave a su API de Maps. dashcamigo retoma donde lo dejó: un visor en el navegador y con mantenimiento, con un mapa GPS sincronizado, un gráfico de velocidad y fuerza G y un mapa sin claves — no hay ninguna clave de API que pueda caducar.",
            "cardHint": "Gratis, pero sin mantenimiento desde 2015 — y su mapa integrado ya no funciona",
            "whatItIs": "RegistratorViewer (y distribuido como DATAKAM Player para las cámaras DATAKAM) es un visor gratuito de escritorio para Windows que realmente se adelantó a su tiempo — corte y unión sin pérdidas, reproducción continua entre archivos, una traza GPS con gráficos de velocidad y sensor G, captura de fotogramas con el GPS en los EXIF de la foto y exportación de la traza a GPX, KML y SRT. Todavía reproduce bien muchas grabaciones. El problema es su longevidad: el desarrollo se detuvo en 2015, el sitio web original desapareció y el mapa de Google integrado se rompió cuando Google terminó con el acceso sin clave a la API de Maps — revivirlo ahora requiere un ajuste en el registro de Windows o una compilación no oficial de la comunidad. No hay una solución oficial, porque el proyecto ya no tiene mantenimiento y su código fuente nunca se publicó.",
            "comparisonIntro": "RegistratorViewer está congelado en 2015. Así se compara dashcamigo en lo que peor ha envejecido — y en lo que simplemente está a la par.",
            "compareRows": [
                {
                    "dimension": "Precio",
                    "us": {
                        "mark": "yes",
                        "note": "Gratis"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Gratis"
                    }
                },
                {
                    "dimension": "Funciona en Mac, Linux y móvil",
                    "us": {
                        "mark": "yes",
                        "note": "Cualquier navegador moderno"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Pensado primero para Windows (existe una compilación de Mac aparte y limitada)"
                    }
                },
                {
                    "dimension": "Sigue con mantenimiento",
                    "us": {
                        "mark": "yes",
                        "note": "En desarrollo activo"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Sin actualizaciones desde 2015"
                    }
                },
                {
                    "dimension": "Mapa integrado",
                    "us": {
                        "mark": "yes",
                        "note": "En vivo, sin claves — ninguna clave de API que pueda caducar"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Se rompió tras el cambio de API de Google; necesita un arreglo manual"
                    }
                },
                {
                    "dimension": "Gráfico de velocidad y fuerza G",
                    "us": {
                        "mark": "yes",
                        "note": "Sí"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Sí"
                    }
                },
                {
                    "dimension": "Recortar y exportar",
                    "us": {
                        "mark": "yes",
                        "note": "Recorte + MP4 con GPS, además de .gpx"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Corte sin pérdidas + GPX/KML/SRT"
                    }
                },
                {
                    "dimension": "Nada que instalar",
                    "us": {
                        "mark": "yes",
                        "note": "Se abre en el navegador"
                    },
                    "them": {
                        "mark": "partial",
                        "note": ".exe portable, sin instalación"
                    }
                }
            ],
            "whenStayTitle": "Cuándo merece la pena seguir con RegistratorViewer",
            "whenStay": "RegistratorViewer admite una larga lista de cámaras antiguas y poco conocidas que dashcamigo aún no procesa, puede unir sin pérdidas una carpeta entera de clips en un solo archivo, repara grabaciones dañadas y funciona totalmente sin conexión como aplicación de escritorio. Si estás en Windows, tu cámara está en su lista de compatibilidad y ya tienes el mapa funcionando, sigue siendo una herramienta capaz. Y si dashcamigo aún no lee tu cámara, envía una muestra a feedback@dashcamigo.app — añadimos formatos a partir de grabaciones reales, y queremos que sea compatible con todas las dashcam.",
            "ctaPrimary": "Abre tus grabaciones",
            "faq": [
                {
                    "q": "¿Es dashcamigo un reemplazo directo de RegistratorViewer?",
                    "a": "Para lo esencial — abrir grabaciones de dashcam con un mapa GPS, un gráfico de velocidad y fuerza G, y recortar un clip — sí, y funciona en cualquier navegador moderno sin instalar nada. RegistratorViewer todavía tiene una lista de dispositivos heredados más amplia y algunas funciones especializadas (unión multiarchivo sin pérdidas, reparación de archivos dañados); dashcamigo se centra en una experiencia con mantenimiento, multiplataforma y con un mapa que sigue funcionando."
                },
                {
                    "q": "¿Por qué dejó de funcionar el mapa de RegistratorViewer?",
                    "a": "Su mapa de ruta integrado mostraba Google Maps a través de una vista incrustada de Internet Explorer. Cuando Google terminó con el acceso gratuito sin clave a su API de Maps, el mapa empezó a fallar, y el sitio que alojaba parte del script del mapa se desconectó. Como el proyecto no tiene mantenimiento y nunca se publicó su código fuente, no hay solución oficial — solo ediciones manuales del registro o compilaciones no oficiales de la comunidad. dashcamigo evita todo el problema: su mapa es MapLibre + OpenFreeMap sin claves, así que no hay ninguna clave de API que pueda caducar."
                },
                {
                    "q": "¿Funciona dashcamigo en Mac, Linux o en mi teléfono?",
                    "a": "Sí. Funciona en el navegador, así que Windows, macOS, Linux y móvil funcionan todos. RegistratorViewer está pensado primero para Windows; su compilación para Mac es una aplicación aparte y con funciones limitadas que se distribuye principalmente a través de réplicas de terceros."
                },
                {
                    "q": "¿Se subirán mis grabaciones a algún sitio?",
                    "a": "No. dashcamigo no tiene servidor. Tu navegador lee los archivos directamente desde tu dispositivo — no se sube nada. La misma privacidad que un visor de escritorio, pero sin instalar ninguno."
                },
                {
                    "q": "¿Es dashcamigo gratis como RegistratorViewer?",
                    "a": "Sí, completamente gratis — sin cuenta, sin plan de pago, sin límite de prueba."
                }
            ]
        },
        "fr": {
            "title": "Alternative à RegistratorViewer — lecteur de dashcam gratuit dans votre navigateur | dashcamigo",
            "metaDescription": "Une alternative à RegistratorViewer, gratuite et maintenue, dans le navigateur — Windows, Mac, Linux, mobile. Carte GPS, courbe de vitesse. Sans installation.",
            "ogTitle": "Alternative à RegistratorViewer — gratuite, dans votre navigateur",
            "ogDescription": "RegistratorViewer est un excellent lecteur Windows, mais non maintenu depuis 2015, dont la carte intégrée ne fonctionne plus. dashcamigo est l'alternative maintenue, multiplateforme et dans le navigateur.",
            "h1": "Une alternative gratuite à RegistratorViewer qui reçoit encore des mises à jour — et une carte qui fonctionne",
            "lead": "RegistratorViewer (aussi connu sous le nom de DATAKAM Player) a été l'un des meilleurs lecteurs de dashcam gratuits de son époque — mais il n'a plus reçu de mise à jour depuis des années, il est conçu d'abord pour Windows, et sa carte Google intégrée a cessé de fonctionner après que Google a mis fin à l'accès gratuit et sans clé à son API Maps. dashcamigo prend le relais là où il s'est arrêté : un lecteur maintenu, dans le navigateur, avec une carte GPS synchronisée, une courbe de vitesse et de force G, et une carte sans clé — aucune clé d'API qui puisse expirer.",
            "cardHint": "Gratuit, mais non maintenu depuis 2015 — et sa carte ne fonctionne plus",
            "whatItIs": "RegistratorViewer (fourni sous le nom de DATAKAM Player pour les caméras DATAKAM) est un lecteur de bureau gratuit pour Windows qui était vraiment en avance sur son temps — découpe et assemblage sans perte, lecture continue d'un fichier à l'autre, un tracé GPS avec courbes de vitesse et de capteur G, capture d'image avec le GPS dans l'EXIF de la photo, et export du tracé en GPX, KML et SRT. Il lit encore très bien beaucoup d'enregistrements. Le hic, c'est la longévité : le développement s'est arrêté en 2015, le site d'origine a disparu, et la carte Google intégrée a cessé de fonctionner quand Google a mis fin à l'accès à l'API Maps sans clé — la faire revivre aujourd'hui demande une retouche du registre Windows ou une version communautaire non officielle. Il n'existe pas de correctif officiel, car le projet n'est plus maintenu et son code source n'a jamais été publié.",
            "comparisonIntro": "RegistratorViewer est figé en 2015. Voici comment dashcamigo se compare sur les points qui ont le plus mal vieilli — et sur ceux où ils sont tout simplement à égalité.",
            "compareRows": [
                {
                    "dimension": "Prix",
                    "us": {
                        "mark": "yes",
                        "note": "Gratuit"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Gratuit"
                    }
                },
                {
                    "dimension": "Fonctionne sur Mac, Linux et mobile",
                    "us": {
                        "mark": "yes",
                        "note": "N'importe quel navigateur moderne"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Conçu d'abord pour Windows (une version Mac séparée et limitée existe)"
                    }
                },
                {
                    "dimension": "Toujours maintenu",
                    "us": {
                        "mark": "yes",
                        "note": "Activement développé"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Aucune mise à jour depuis 2015"
                    }
                },
                {
                    "dimension": "Carte intégrée",
                    "us": {
                        "mark": "yes",
                        "note": "En direct, sans clé — aucune clé d'API qui puisse expirer"
                    },
                    "them": {
                        "mark": "no",
                        "note": "A cessé de fonctionner après le changement d'API de Google ; nécessite un correctif manuel"
                    }
                },
                {
                    "dimension": "Courbe de vitesse et de force G",
                    "us": {
                        "mark": "yes",
                        "note": "Oui"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Oui"
                    }
                },
                {
                    "dimension": "Découpe et export",
                    "us": {
                        "mark": "yes",
                        "note": "Découpe + MP4 avec GPS, plus un .gpx"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Découpe sans perte + GPX/KML/SRT"
                    }
                },
                {
                    "dimension": "Rien à installer",
                    "us": {
                        "mark": "yes",
                        "note": "S'ouvre dans le navigateur"
                    },
                    "them": {
                        "mark": "partial",
                        "note": ".exe portable, sans installation"
                    }
                }
            ],
            "whenStayTitle": "Quand RegistratorViewer mérite encore d'être gardé",
            "whenStay": "RegistratorViewer prend en charge une longue liste de caméras anciennes et moins connues que dashcamigo ne décode pas encore, sait assembler sans perte tout un dossier de clips en un seul fichier, répare les enregistrements abîmés, et tourne entièrement hors ligne comme application de bureau. Si vous êtes sous Windows, que votre caméra est dans sa liste de compatibilité et que vous avez déjà fait marcher sa carte, c'est encore un outil capable. Et si dashcamigo ne lit pas encore votre caméra, envoyez un échantillon à feedback@dashcamigo.app — on ajoute les formats à partir d'enregistrements réels, et on veut qu'il prenne en charge toutes les dashcams.",
            "ctaPrimary": "Ouvrir vos enregistrements",
            "faq": [
                {
                    "q": "dashcamigo est-il un remplaçant direct de RegistratorViewer ?",
                    "a": "Pour l'essentiel — ouvrir des enregistrements de dashcam avec une carte GPS, une courbe de vitesse et de force G, et découper un clip — oui, et il tourne dans n'importe quel navigateur moderne, sans rien à installer. RegistratorViewer dispose encore d'une liste d'appareils anciens plus large et de quelques fonctions spécialisées (assemblage multi-fichiers sans perte, réparation de fichiers abîmés) ; dashcamigo, lui, mise sur une expérience maintenue, multiplateforme, avec une carte qui continue de fonctionner."
                },
                {
                    "q": "Pourquoi la carte de RegistratorViewer a-t-elle cessé de fonctionner ?",
                    "a": "Sa carte d'itinéraire intégrée affichait Google Maps via une vue Internet Explorer embarquée. Quand Google a mis fin à l'accès gratuit sans clé à son API Maps, la carte a commencé à échouer, et le site qui hébergeait une partie du script de la carte est passé hors ligne. Comme le projet n'est plus maintenu et que ses sources n'ont jamais été publiées, il n'existe pas de correctif officiel — seulement des retouches manuelles du registre ou des builds communautaires non officielles. dashcamigo évite tout le problème : sa carte repose sur MapLibre + OpenFreeMap sans clé, donc il n'y a aucune clé d'API qui puisse expirer."
                },
                {
                    "q": "dashcamigo fonctionne-t-il sur Mac, Linux ou mon téléphone ?",
                    "a": "Oui. Il tourne dans le navigateur, donc Windows, macOS, Linux et les appareils mobiles fonctionnent tous. RegistratorViewer est conçu d'abord pour Windows ; sa version Mac est une application séparée, aux fonctions limitées, distribuée surtout via des miroirs tiers."
                },
                {
                    "q": "Mes enregistrements seront-ils téléversés quelque part ?",
                    "a": "Non. dashcamigo n'a pas de serveur. Votre navigateur lit les fichiers directement sur votre appareil — rien n'est téléversé. La même confidentialité qu'un lecteur de bureau, mais sans en installer un."
                },
                {
                    "q": "dashcamigo est-il gratuit comme RegistratorViewer ?",
                    "a": "Oui, entièrement gratuit — pas de compte, pas de palier payant, pas de limite d'essai."
                }
            ]
        },
        "ja": {
            "title": "RegistratorViewerの代替 — ブラウザで動く無料ドラレコビューア | dashcamigo",
            "metaDescription": "メンテされ続けるRegistratorViewerの無料代替。Windows・Mac・Linux・モバイルのブラウザで動作 — GPSマップ、速度グラフ、期限切れになるAPIキーのないマップ。インストール不要。",
            "ogTitle": "RegistratorViewerの代替 — 無料、ブラウザで",
            "ogDescription": "RegistratorViewerは優秀だが2015年から更新が止まっているWindows用ビューアで、内蔵マップはもう動きません。dashcamigoはメンテされ続けるクロスプラットフォームのブラウザ代替です。",
            "h1": "今も更新が続くRegistratorViewerの無料代替 — そして、ちゃんと動くマップ",
            "lead": "RegistratorViewer（DATAKAM Playerとしても知られる）は、当時最高クラスの無料ドラレコビューアの一つでした。しかし何年も更新がなく、Windowsが主軸で、内蔵のGoogleマップはGoogleがMaps APIの無料・キー不要のアクセスを終了してから動かなくなりました。dashcamigoはその続きを引き受けます — メンテされ続けるブラウザ内ビューアで、同期したGPSマップ、速度とGフォースのグラフ、そして期限切れになるAPIキーのない、キー不要のマップを備えています。",
            "cardHint": "無料だが2015年から更新なし — しかも内蔵マップは動かない",
            "whatItIs": "RegistratorViewerは（DATAKAMカメラ向けにはDATAKAM Playerとして同梱される）無料のWindowsデスクトップビューアで、まさに時代を先取りしていました — 無劣化のカット＆結合、ファイルをまたいだ連続再生、速度とGセンサーのグラフ付きのGPSトラック、写真のEXIFにGPSを記録するフレームキャプチャ、そしてトラックのGPX・KML・SRTへのエクスポート。今でも多くの録画を問題なく再生します。難点は寿命です — 開発は2015年に止まり、元のウェブサイトはなくなり、アプリ内のGoogleマップはGoogleがキー不要のMaps APIアクセスを終了したときに壊れました — 今これを復活させるにはWindowsレジストリの調整か、非公式のコミュニティビルドが必要です。公式の修正はありません。プロジェクトはメンテされておらず、ソースコードも公開されなかったからです。",
            "comparisonIntro": "RegistratorViewerは2015年で時が止まっています。最も老朽化した部分で — そして単に互角な部分で — dashcamigoがどう比べられるかを示します。",
            "compareRows": [
                {
                    "dimension": "価格",
                    "us": {
                        "mark": "yes",
                        "note": "無料"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "無料"
                    }
                },
                {
                    "dimension": "Mac・Linux・モバイルで動く",
                    "us": {
                        "mark": "yes",
                        "note": "あらゆるモダンブラウザ"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Windows主軸（機能限定の別のMacビルドはある）"
                    }
                },
                {
                    "dimension": "今もメンテされている",
                    "us": {
                        "mark": "yes",
                        "note": "活発に開発中"
                    },
                    "them": {
                        "mark": "no",
                        "note": "2015年以来更新なし"
                    }
                },
                {
                    "dimension": "内蔵マップ",
                    "us": {
                        "mark": "yes",
                        "note": "ライブ、キー不要 — 期限切れになるAPIキーなし"
                    },
                    "them": {
                        "mark": "no",
                        "note": "GoogleのAPI変更で壊れた。手動修正が必要"
                    }
                },
                {
                    "dimension": "速度とGフォースのグラフ",
                    "us": {
                        "mark": "yes",
                        "note": "あり"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "あり"
                    }
                },
                {
                    "dimension": "トリミングとエクスポート",
                    "us": {
                        "mark": "yes",
                        "note": "トリミング＋GPS付きMP4、さらに.gpx"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "無劣化カット＋GPX/KML/SRT"
                    }
                },
                {
                    "dimension": "インストール不要",
                    "us": {
                        "mark": "yes",
                        "note": "ブラウザで開く"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "ポータブルな.exe、インストール不要"
                    }
                }
            ],
            "whenStayTitle": "RegistratorViewerを手元に残す価値がある場合",
            "whenStay": "RegistratorViewerは、dashcamigoがまだ解析できない古めの・あまり知られていないカメラの長いリストに対応し、クリップが入ったフォルダーまるごとを無劣化で1ファイルに結合でき、壊れた録画を修復し、デスクトップアプリとして完全オフラインで動作します。Windowsを使っていて、お使いのカメラがその互換リストにあり、すでにマップを動かせているなら、今でも有能なツールです。そして、もしdashcamigoがまだお使いのカメラを読み取れなくても、サンプルをfeedback@dashcamigo.appまで送ってください — 私たちは実際の録画からフォーマットを追加しており、すべてのドラレコに対応させたいと思っています。",
            "ctaPrimary": "録画を開く",
            "faq": [
                {
                    "q": "dashcamigoはRegistratorViewerをそのまま置き換えられますか？",
                    "a": "中核となる仕事 — GPSマップ、速度とGフォースのグラフ付きでドラレコ録画を開き、クリップをトリミングすること — については、はい、しかもインストール不要であらゆるモダンブラウザで動きます。RegistratorViewerは依然として広いレガシー機器リストといくつかの専門機能（無劣化の複数ファイル結合、壊れたファイルの修復）を持っています。dashcamigoは、ちゃんと動き続けるマップを備えた、メンテされ続けるクロスプラットフォームな体験に注力しています。"
                },
                {
                    "q": "なぜRegistratorViewerのマップは動かなくなったのですか？",
                    "a": "内蔵のルートマップは、埋め込まれたInternet ExplorerのビューでGoogleマップを描画していました。Googleがキー不要のMaps APIへの無料アクセスを終了すると、マップは動作しなくなり始め、マップスクリプトの一部をホストしていたサイトもオフラインになりました。プロジェクトはメンテされておらず、ソースコードも公開されなかったため、公式の修正はありません — レジストリの手動編集か、非公式のコミュニティビルドだけです。dashcamigoはこの問題をまるごと回避します — マップはキー不要のMapLibre＋OpenFreeMapなので、期限切れになるAPIキーがそもそもありません。"
                },
                {
                    "q": "dashcamigoはMac、Linux、私のスマホで動きますか？",
                    "a": "はい。ブラウザで動くので、Windows、macOS、Linux、モバイルすべてで使えます。RegistratorViewerはWindowsが主軸で、Macビルドは主にサードパーティのミラー経由で配布される、機能限定の別アプリです。"
                },
                {
                    "q": "私の録画はどこかにアップロードされますか？",
                    "a": "いいえ。dashcamigo には録画を受け取るサーバーがありません。ブラウザがデバイス上のファイルを直接読み取るため、何もアップロードされません。デスクトップビューアと同じプライバシーを、インストールなしで。"
                },
                {
                    "q": "dashcamigoはRegistratorViewerのように無料ですか？",
                    "a": "はい、完全無料です — アカウント不要、有料プランなし、試用期限なし。"
                }
            ]
        },
        "ko": {
            "title": "RegistratorViewer 대안 — 브라우저에서 쓰는 무료 블랙박스 뷰어 | dashcamigo",
            "metaDescription": "Windows, Mac, Linux, 모바일 브라우저에서 돌아가는 무료·유지보수 중인 RegistratorViewer 대안 — GPS 지도, 속도 차트, 만료될 API 키가 없는 지도. 설치 불필요.",
            "ogTitle": "RegistratorViewer 대안 — 무료, 브라우저에서",
            "ogDescription": "RegistratorViewer는 훌륭하지만 2015년 이후 업데이트가 없는 Windows 뷰어로, 내장 지도가 더 이상 작동하지 않습니다. dashcamigo는 유지보수되는 크로스플랫폼 브라우저 대안입니다.",
            "h1": "여전히 업데이트되는 무료 RegistratorViewer 대안 — 그리고 제대로 작동하는 지도",
            "lead": "RegistratorViewer(DATAKAM Player라고도 불림)는 당대 최고의 무료 블랙박스 뷰어 중 하나였습니다. 하지만 몇 년째 업데이트가 없고, Windows 위주이며, 내장 Google 지도는 Google이 Maps API 무료·키 없는 접근을 종료한 뒤로 작동을 멈췄습니다. dashcamigo는 그 자리를 이어받습니다 — 동기화된 GPS 지도, 속도와 G 포스 차트, 그리고 만료될 API 키가 없는, 키 없는 지도를 갖춘, 유지보수되는 브라우저 뷰어입니다.",
            "cardHint": "무료지만 2015년 이후 업데이트 없음 — 그리고 내장 지도가 작동하지 않음",
            "whatItIs": "RegistratorViewer(DATAKAM 카메라용으로는 DATAKAM Player로 번들 제공)는 시대를 앞서간 무료 Windows 데스크톱 뷰어였습니다 — 무손실 컷·이어붙이기, 파일 경계를 넘는 연속 재생, 속도와 G 센서 그래프가 있는 GPS 트랙, 사진 EXIF에 GPS를 담는 프레임 캡처, GPX·KML·SRT로의 트랙 내보내기까지 가능했죠. 지금도 많은 녹화 영상을 잘 재생합니다. 문제는 수명입니다 — 개발은 2015년에 멈췄고, 원래 웹사이트는 사라졌으며, 내장 Google 지도는 Google이 키 없는 Maps API 접근을 종료하면서 작동을 멈췄습니다. 지금 이를 되살리려면 Windows 레지스트리 수정이나 비공식 커뮤니티 빌드가 필요합니다. 공식 수정본은 없습니다 — 프로젝트가 더 이상 유지보수되지 않고 소스도 공개된 적이 없기 때문입니다.",
            "comparisonIntro": "RegistratorViewer는 2015년에 멈춰 있습니다. 가장 심하게 낡은 부분에서 — 그리고 그저 비등한 부분에서 — dashcamigo가 어떻게 비교되는지 보세요.",
            "compareRows": [
                {
                    "dimension": "가격",
                    "us": {
                        "mark": "yes",
                        "note": "무료"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "무료"
                    }
                },
                {
                    "dimension": "Mac, Linux, 모바일에서 실행",
                    "us": {
                        "mark": "yes",
                        "note": "최신 브라우저 어디서나"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Windows 위주(별도의 제한된 Mac 빌드가 있음)"
                    }
                },
                {
                    "dimension": "지금도 유지보수됨",
                    "us": {
                        "mark": "yes",
                        "note": "활발히 개발 중"
                    },
                    "them": {
                        "mark": "no",
                        "note": "2015년 이후 업데이트 없음"
                    }
                },
                {
                    "dimension": "내장 지도",
                    "us": {
                        "mark": "yes",
                        "note": "실시간, 키 없음 — 만료될 API 키 없음"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Google API 변경 후 작동 중단; 수동 수정 필요"
                    }
                },
                {
                    "dimension": "속도와 G 포스 차트",
                    "us": {
                        "mark": "yes",
                        "note": "있음"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "있음"
                    }
                },
                {
                    "dimension": "잘라내기와 내보내기",
                    "us": {
                        "mark": "yes",
                        "note": "GPS 포함 MP4 잘라내기, 그리고 .gpx"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "무손실 컷 + GPX/KML/SRT"
                    }
                },
                {
                    "dimension": "설치할 것 없음",
                    "us": {
                        "mark": "yes",
                        "note": "브라우저에서 열림"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "포터블 .exe, 설치 불필요"
                    }
                }
            ],
            "whenStayTitle": "그래도 RegistratorViewer를 곁에 둘 만한 경우",
            "whenStay": "RegistratorViewer는 dashcamigo가 아직 파싱하지 못하는 오래되고 덜 알려진 카메라를 폭넓게 지원하고, 폴더 하나에 든 클립 전체를 무손실로 단일 파일로 이어붙일 수 있으며, 깨진 녹화를 복구하고, 데스크톱 앱으로 완전히 오프라인에서 돌아갑니다. Windows를 쓰고, 카메라가 호환 목록에 있으며, 이미 지도를 작동시켜 둔 상태라면 여전히 쓸 만한 도구입니다. 그리고 dashcamigo가 아직 사용하시는 카메라를 읽지 못한다면 feedback@dashcamigo.app으로 샘플을 보내주세요 — 우리는 실제 녹화 파일을 받아 형식을 추가하고 있고, 모든 블랙박스를 지원하는 것이 목표입니다.",
            "ctaPrimary": "내 녹화 영상 열기",
            "faq": [
                {
                    "q": "dashcamigo는 RegistratorViewer를 그대로 대체할 수 있나요?",
                    "a": "핵심 작업 — GPS 지도, 속도와 G 포스 차트로 블랙박스 녹화를 열고 클립을 잘라내는 일 — 에 대해서는 그렇습니다. 게다가 설치할 것 없이 최신 브라우저 어디서나 돌아갑니다. RegistratorViewer는 여전히 더 넓은 레거시 기기 목록과 몇 가지 전문 기능(무손실 다중 파일 이어붙이기, 깨진 파일 복구)을 갖추고 있습니다. dashcamigo는 지도가 계속 작동하는, 유지보수되는 크로스플랫폼 경험에 집중합니다."
                },
                {
                    "q": "RegistratorViewer의 지도는 왜 작동을 멈췄나요?",
                    "a": "내장 경로 지도는 임베디드 Internet Explorer 뷰를 통해 Google 지도를 렌더링했습니다. Google이 Maps API의 키 없는 무료 접근을 종료하자 지도가 작동을 멈추기 시작했고, 지도 스크립트 일부를 호스팅하던 사이트도 오프라인이 됐습니다. 프로젝트가 유지보수되지 않고 소스도 공개된 적이 없어 공식 수정본은 없습니다 — 수동 레지스트리 편집이나 비공식 커뮤니티 빌드뿐이죠. dashcamigo는 이 문제 전체를 피해 갑니다 — 지도가 키 없는 MapLibre + OpenFreeMap이라 만료될 API 키 자체가 없습니다."
                },
                {
                    "q": "dashcamigo는 Mac, Linux, 제 휴대폰에서도 작동하나요?",
                    "a": "네. 브라우저에서 돌아가므로 Windows, macOS, Linux, 모바일 모두 작동합니다. RegistratorViewer는 Windows 위주이고, 그 Mac 빌드는 주로 서드파티 미러로 배포되는 별개의 기능 제한 앱입니다."
                },
                {
                    "q": "제 녹화 영상이 어딘가로 업로드되나요?",
                    "a": "아니요. dashcamigo에는 녹화 영상을 받을 서버가 없습니다. 브라우저가 기기의 파일을 직접 읽어서 아무것도 업로드되지 않습니다. 데스크톱 뷰어와 같은 수준의 프라이버시를, 설치 없이 누립니다."
                },
                {
                    "q": "dashcamigo도 RegistratorViewer처럼 무료인가요?",
                    "a": "네, 완전 무료입니다 — 계정도, 유료 등급도, 체험판 제한도 없습니다."
                }
            ]
        },
        "pl": {
            "title": "Alternatywa dla RegistratorViewer — darmowy odtwarzacz kamery samochodowej w przeglądarce | dashcamigo",
            "metaDescription": "Darmowa, wciąż rozwijana alternatywa dla RegistratorViewer działająca w przeglądarce na Windows, Mac, Linux i mobilnych — mapa GPS, wykres prędkości i mapa bez klucza API, który mógłby wygasnąć. Bez instalacji.",
            "ogTitle": "Alternatywa dla RegistratorViewer — za darmo, w przeglądarce",
            "ogDescription": "RegistratorViewer to świetny, ale od dawna nierozwijany odtwarzacz na Windows (ostatnia aktualizacja w 2015 roku), którego wbudowana mapa już nie działa. dashcamigo to rozwijana, wieloplatformowa alternatywa w przeglądarce.",
            "h1": "Darmowa alternatywa dla RegistratorViewer, która wciąż dostaje aktualizacje — i z mapą, która działa",
            "lead": "RegistratorViewer (znany też jako DATAKAM Player) był jednym z najlepszych darmowych odtwarzaczy nagrań z kamer samochodowych swoich czasów — ale od lat nie dostał żadnej aktualizacji, jest przede wszystkim pod Windows, a wbudowana mapa Google przestała działać po tym, jak Google zlikwidował darmowy dostęp bez klucza do swojego Maps API. dashcamigo podejmuje pałeczkę tam, gdzie tamten skończył: rozwijany odtwarzacz w przeglądarce z synchronizowaną mapą GPS, wykresem prędkości i przeciążeń oraz mapą bez kluczy, w której żaden klucz API nie może wygasnąć.",
            "cardHint": "Darmowy, ale nierozwijany od 2015 roku — i z niedziałającą mapą",
            "whatItIs": "RegistratorViewer (rozprowadzany też jako DATAKAM Player do kamer DATAKAM) to darmowy odtwarzacz na pulpit Windows, który naprawdę wyprzedzał swoją epokę — bezstratne cięcie i łączenie, ciągłe odtwarzanie przez granice plików, ścieżka GPS z wykresami prędkości i czujnika G, przechwytywanie klatki z GPS w danych EXIF zdjęcia oraz eksport trasy do GPX, KML i SRT. Wiele nagrań wciąż odtwarza bez problemu. Haczyk tkwi w długowieczności: rozwój zatrzymał się w 2015 roku, oryginalna strona zniknęła, a wbudowana mapa Google przestała działać, gdy Google zakończył dostęp do Maps API bez klucza — przywrócenie jej teraz wymaga modyfikacji rejestru Windows albo nieoficjalnej, społecznościowej kompilacji. Nie ma oficjalnej poprawki, bo projekt nie jest już rozwijany, a jego kod źródłowy nigdy nie został udostępniony.",
            "comparisonIntro": "RegistratorViewer zatrzymał się w 2015 roku. Oto jak dashcamigo wypada w tym, co zestarzało się najgorzej — i w tym, gdzie po prostu są na równi.",
            "compareRows": [
                {
                    "dimension": "Cena",
                    "us": {
                        "mark": "yes",
                        "note": "Za darmo"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Za darmo"
                    }
                },
                {
                    "dimension": "Działa na Mac, Linux i urządzeniach mobilnych",
                    "us": {
                        "mark": "yes",
                        "note": "Dowolna nowoczesna przeglądarka"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Przede wszystkim Windows (istnieje osobna, okrojona wersja na Mac)"
                    }
                },
                {
                    "dimension": "Wciąż rozwijany",
                    "us": {
                        "mark": "yes",
                        "note": "Aktywnie rozwijany"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Brak aktualizacji od 2015 roku"
                    }
                },
                {
                    "dimension": "Wbudowana mapa",
                    "us": {
                        "mark": "yes",
                        "note": "Na żywo, bez kluczy — żaden klucz API nie wygaśnie"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Przestała działać po zmianie API Google; wymaga ręcznej naprawy"
                    }
                },
                {
                    "dimension": "Wykres prędkości i przeciążeń",
                    "us": {
                        "mark": "yes",
                        "note": "Tak"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Tak"
                    }
                },
                {
                    "dimension": "Przycinanie i eksport",
                    "us": {
                        "mark": "yes",
                        "note": "Przycinanie + MP4 z GPS, plus .gpx"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Bezstratne cięcie + GPX/KML/SRT"
                    }
                },
                {
                    "dimension": "Nic do zainstalowania",
                    "us": {
                        "mark": "yes",
                        "note": "Otwiera się w przeglądarce"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Przenośny plik .exe, bez instalacji"
                    }
                }
            ],
            "whenStayTitle": "Kiedy RegistratorViewer wciąż warto trzymać pod ręką",
            "whenStay": "RegistratorViewer obsługuje długą listę starszych i mniej znanych kamer, których dashcamigo jeszcze nie parsuje, potrafi bezstratnie połączyć cały folder klipów w jeden plik, naprawia uszkodzone nagrania i działa w pełni offline jako program na pulpit. Jeśli jesteś na Windows, Twoja kamera jest na jego liście zgodności, a mapę masz już uruchomioną — to wciąż solidne narzędzie. A jeśli dashcamigo jeszcze nie czyta Twojej kamery, wyślij próbkę na feedback@dashcamigo.app — dodajemy formaty na podstawie prawdziwych nagrań i chcemy, żeby obsługiwał każdy wideorejestrator.",
            "ctaPrimary": "Otwórz swoje nagrania",
            "faq": [
                {
                    "q": "Czy dashcamigo to zamiennik RegistratorViewer w stosunku 1:1?",
                    "a": "Do podstawowego zadania — otwarcia nagrań z kamery z mapą GPS, wykresem prędkości i przeciążeń oraz przycięcia klipu — tak, i działa to w dowolnej nowoczesnej przeglądarce bez instalacji. RegistratorViewer wciąż ma szerszą, wieloletnią listę urządzeń i kilka specjalistycznych funkcji (bezstratne łączenie wielu plików, naprawa uszkodzonych plików); dashcamigo stawia na rozwijane, wieloplatformowe doświadczenie z mapą, która działa dalej."
                },
                {
                    "q": "Dlaczego mapa w RegistratorViewer przestała działać?",
                    "a": "Wbudowana mapa trasy renderowała Mapy Google przez osadzony widok Internet Explorera. Gdy Google zakończył darmowy dostęp do swojego Maps API bez klucza, mapa zaczęła się sypać, a strona, która hostowała część skryptu mapy, przestała działać. Ponieważ projekt nie jest rozwijany i jego kod źródłowy nigdy nie został udostępniony, nie ma oficjalnej poprawki — tylko ręczne edycje rejestru albo nieoficjalne, społecznościowe kompilacje. dashcamigo omija cały ten problem: jego mapa to MapLibre + OpenFreeMap bez kluczy, więc nie ma żadnego klucza API, który mógłby wygasnąć."
                },
                {
                    "q": "Czy dashcamigo działa na Mac, Linux lub moim telefonie?",
                    "a": "Tak. Działa w przeglądarce, więc Windows, macOS, Linux i urządzenia mobilne — wszystko działa. RegistratorViewer jest przede wszystkim pod Windows; jego wersja na Mac to osobna aplikacja z okrojonymi funkcjami, rozprowadzana głównie przez zewnętrzne kopie lustrzane."
                },
                {
                    "q": "Czy moje nagrania będą gdzieś wysyłane?",
                    "a": "Nie. dashcamigo nie ma serwera, na który trafiałyby nagrania. Przeglądarka odczytuje pliki bezpośrednio z twojego urządzenia — nic nie jest wysyłane. Taka sama prywatność jak w odtwarzaczu na pulpit, ale bez instalowania go."
                },
                {
                    "q": "Czy dashcamigo jest darmowe, tak jak RegistratorViewer?",
                    "a": "Tak, całkowicie za darmo — bez konta, bez płatnego planu, bez ograniczeń wersji próbnej."
                }
            ]
        },
        "pt": {
            "title": "Alternativa ao RegistratorViewer — visualizador de dashcam gratuito no seu navegador | dashcamigo",
            "metaDescription": "Uma alternativa gratuita e atualizada ao RegistratorViewer que roda no seu navegador no Windows, Mac, Linux e celular — mapa GPS, gráfico de velocidade e um mapa sem chave de API para expirar. Sem instalação.",
            "ogTitle": "Alternativa ao RegistratorViewer — grátis, no navegador",
            "ogDescription": "O RegistratorViewer é um ótimo visualizador para Windows, mas sem manutenção há muito tempo (última atualização em 2015) e com o mapa integrado fora do ar. O dashcamigo é a alternativa mantida, multiplataforma e no navegador.",
            "h1": "Uma alternativa gratuita ao RegistratorViewer que ainda recebe atualizações — e um mapa que funciona",
            "lead": "O RegistratorViewer (também conhecido como DATAKAM Player) foi um dos melhores visualizadores de dashcam gratuitos da sua época — mas ele há anos não recebe atualizações, é voltado primeiro ao Windows, e seu mapa integrado do Google parou de funcionar depois que o Google encerrou o acesso gratuito e sem chave à sua API do Maps. O dashcamigo continua de onde ele parou: um visualizador no navegador, atualizado, com mapa GPS sincronizado, um gráfico de velocidade e força G, e um mapa sem chave — nenhuma chave de API para expirar.",
            "cardHint": "Gratuito, mas sem atualizações desde 2015 — e seu mapa integrado não funciona mais",
            "whatItIs": "O RegistratorViewer (distribuído também como DATAKAM Player para as câmeras DATAKAM) é um visualizador de desktop gratuito para Windows que estava genuinamente à frente do seu tempo — corte e junção sem perdas, reprodução contínua através dos arquivos, um trajeto GPS com gráficos de velocidade e sensor G, captura de quadro com GPS nos dados EXIF da foto, e exportação do trajeto para GPX, KML e SRT. Ele ainda reproduz muitas gravações sem problemas. O detalhe é a longevidade: o desenvolvimento parou em 2015, o site original sumiu, e o mapa do Google dentro do app quebrou quando o Google encerrou o acesso sem chave à API do Maps — revivê-lo agora exige um ajuste no registro do Windows ou uma compilação não oficial da comunidade. Não há correção oficial, porque o projeto não é mais mantido e seu código-fonte nunca foi lançado.",
            "comparisonIntro": "O RegistratorViewer está congelado em 2015. Veja como o dashcamigo se compara nas coisas que envelheceram pior — e nas que estão simplesmente empatadas.",
            "compareRows": [
                {
                    "dimension": "Preço",
                    "us": {
                        "mark": "yes",
                        "note": "Grátis"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Grátis"
                    }
                },
                {
                    "dimension": "Roda no Mac, Linux e celular",
                    "us": {
                        "mark": "yes",
                        "note": "Qualquer navegador moderno"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Voltado primeiro ao Windows (existe uma compilação separada e limitada para Mac)"
                    }
                },
                {
                    "dimension": "Ainda recebe manutenção",
                    "us": {
                        "mark": "yes",
                        "note": "Em desenvolvimento ativo"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Sem atualizações desde 2015"
                    }
                },
                {
                    "dimension": "Mapa integrado",
                    "us": {
                        "mark": "yes",
                        "note": "Ao vivo, sem chave — nenhuma chave de API para expirar"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Parou de funcionar após a mudança na API do Google; precisa de correção manual"
                    }
                },
                {
                    "dimension": "Gráfico de velocidade e força G",
                    "us": {
                        "mark": "yes",
                        "note": "Sim"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Sim"
                    }
                },
                {
                    "dimension": "Corte e exportação",
                    "us": {
                        "mark": "yes",
                        "note": "Corte + MP4 com GPS, além de .gpx"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Corte sem perdas + GPX/KML/SRT"
                    }
                },
                {
                    "dimension": "Nada para instalar",
                    "us": {
                        "mark": "yes",
                        "note": "Abre no navegador"
                    },
                    "them": {
                        "mark": "partial",
                        "note": ".exe portátil, sem instalação"
                    }
                }
            ],
            "whenStayTitle": "Quando o RegistratorViewer ainda vale a pena manter",
            "whenStay": "O RegistratorViewer dá suporte a uma longa lista de câmeras mais antigas e menos conhecidas que o dashcamigo ainda não interpreta, consegue juntar sem perdas uma pasta inteira de clipes em um único arquivo, repara gravações danificadas e roda totalmente offline como um app de desktop. Se você está no Windows, sua câmera está na lista de compatibilidade dele e você já tem o mapa funcionando, ele ainda é uma ferramenta capaz. E se o dashcamigo ainda não lê a sua câmera, mande uma amostra para feedback@dashcamigo.app — a gente adiciona formatos a partir de gravações reais e quer que ele dê suporte a todas as dashcams.",
            "ctaPrimary": "Abra suas gravações",
            "faq": [
                {
                    "q": "O dashcamigo é um substituto direto para o RegistratorViewer?",
                    "a": "Para a tarefa principal — abrir gravações de dashcam com mapa GPS, um gráfico de velocidade e força G, e cortar um clipe — sim, e ele roda em qualquer navegador moderno sem nada para instalar. O RegistratorViewer ainda tem uma lista mais ampla de dispositivos legados e alguns recursos especializados (junção de múltiplos arquivos sem perdas, reparo de arquivos danificados); o dashcamigo foca em uma experiência atualizada, multiplataforma e com um mapa que continua funcionando."
                },
                {
                    "q": "Por que o mapa do RegistratorViewer parou de funcionar?",
                    "a": "Seu mapa de rota integrado renderizava o Google Maps através de uma visualização incorporada do Internet Explorer. Quando o Google encerrou o acesso gratuito sem chave à sua API do Maps, o mapa começou a falhar, e o site que hospedava parte do script do mapa saiu do ar. Como o projeto está sem manutenção e o código-fonte nunca foi liberado, não há correção oficial — apenas edições manuais no registro ou compilações não oficiais da comunidade. O dashcamigo evita todo o problema: seu mapa é o MapLibre + OpenFreeMap sem chave, então não há nenhuma chave de API para expirar."
                },
                {
                    "q": "O dashcamigo funciona no Mac, Linux ou no meu celular?",
                    "a": "Sim. Ele roda no navegador, então Windows, macOS, Linux e celular funcionam. O RegistratorViewer é voltado primeiro ao Windows; sua compilação para Mac é um app separado e com recursos limitados, distribuído principalmente por espelhos de terceiros."
                },
                {
                    "q": "Minhas gravações serão enviadas para algum lugar?",
                    "a": "Não. O dashcamigo não tem servidor para receber suas gravações. Seu navegador lê os arquivos direto do seu dispositivo — nada é enviado. A mesma privacidade de um visualizador de desktop, mas sem precisar instalar um."
                },
                {
                    "q": "O dashcamigo é gratuito como o RegistratorViewer?",
                    "a": "Sim, totalmente gratuito — sem conta, sem plano pago, sem limite de teste."
                }
            ]
        },
        "zh": {
            "title": "RegistratorViewer 替代方案——浏览器里的免费行车记录仪播放器 | dashcamigo",
            "metaDescription": "免费且持续维护的 RegistratorViewer 替代方案，在浏览器中运行，支持 Windows、Mac、Linux 和移动端——GPS 地图、速度图表，还有一张不会失效的地图。无需安装。",
            "ogTitle": "RegistratorViewer 替代方案——免费，在浏览器里",
            "ogDescription": "RegistratorViewer 是一款出色但自 2015 年起停止维护的 Windows 播放器，地图已失效。dashcamigo 是持续维护、跨平台、在浏览器里运行的替代方案。",
            "h1": "一款仍在更新的免费 RegistratorViewer 替代方案——还有一张能用的地图",
            "lead": "RegistratorViewer（又名 DATAKAM Player）曾是同时代最好的免费行车记录仪播放器之一。但它已多年没有更新，以 Windows 为先，而且内置的 Google 地图在 Google 取消对其 Maps API 的免费无密钥访问后便无法使用了。dashcamigo 从它停下的地方接力：一款持续维护、在浏览器里运行的播放器，配有同步的 GPS 地图、速度与 G 力图表，以及一张无需密钥、不会失效的地图。",
            "cardHint": "免费，但自 2015 年起停止维护——而且地图已失效",
            "whatItIs": "RegistratorViewer（并以 DATAKAM Player 之名捆绑给 DATAKAM 摄像头）是一款免费的 Windows 桌面播放器，确实领先于它的时代——无损剪切与拼接、跨文件连续播放、带速度和 G 传感器曲线的 GPS 轨迹、把 GPS 写入照片 EXIF 的帧捕获，以及把轨迹导出为 GPX、KML 和 SRT。它至今仍能正常播放许多录像。问题在于寿命：开发在 2015 年停止，原网站已消失，内置的 Google 地图在 Google 终止无密钥的 Maps API 访问后失效了——如今想让它重新工作，需要改 Windows 注册表，或使用社区做的非官方版本。没有官方修复，因为该项目已不再维护，且源代码从未公开。",
            "comparisonIntro": "RegistratorViewer 停在了 2015 年。下面看看 dashcamigo 在那些老化得最厉害的地方表现如何——以及在那些两者打平的地方。",
            "compareRows": [
                {
                    "dimension": "价格",
                    "us": {
                        "mark": "yes",
                        "note": "免费"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "免费"
                    }
                },
                {
                    "dimension": "可在 Mac、Linux 和移动端运行",
                    "us": {
                        "mark": "yes",
                        "note": "任意现代浏览器"
                    },
                    "them": {
                        "mark": "no",
                        "note": "以 Windows 为先（另有一个功能受限的独立 Mac 版本）"
                    }
                },
                {
                    "dimension": "仍在维护",
                    "us": {
                        "mark": "yes",
                        "note": "积极开发中"
                    },
                    "them": {
                        "mark": "no",
                        "note": "自 2015 年起无更新"
                    }
                },
                {
                    "dimension": "内置地图",
                    "us": {
                        "mark": "yes",
                        "note": "实时、无需密钥——不会失效"
                    },
                    "them": {
                        "mark": "no",
                        "note": "在 Google API 变更后失效；需要手动修复"
                    }
                },
                {
                    "dimension": "速度与 G 力图表",
                    "us": {
                        "mark": "yes",
                        "note": "有"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "有"
                    }
                },
                {
                    "dimension": "剪切与导出",
                    "us": {
                        "mark": "yes",
                        "note": "剪切 + 带 GPS 的 MP4，外加 .gpx"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "无损剪切 + GPX/KML/SRT"
                    }
                },
                {
                    "dimension": "无需安装任何东西",
                    "us": {
                        "mark": "yes",
                        "note": "在浏览器里打开"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "便携式 .exe，无需安装"
                    }
                }
            ],
            "whenStayTitle": "什么时候 RegistratorViewer 仍值得留着",
            "whenStay": "RegistratorViewer 支持一长串 dashcamigo 尚未解析的老旧和小众摄像头，能把整个文件夹的片段无损拼接成单个文件，可修复损坏的录像，并作为桌面应用完全离线运行。如果你在 Windows 上，你的摄像头在它的兼容列表里，而且你已经让它的地图工作起来了，那它仍然是一款有实力的工具。而且，如果 dashcamigo 还读不出你的摄像头，把样片发到 feedback@dashcamigo.app — 我们根据真实录像来添加格式，我们希望它能支持每一款行车记录仪。",
            "ctaPrimary": "打开你的录像",
            "faq": [
                {
                    "q": "dashcamigo 能直接替代 RegistratorViewer 吗？",
                    "a": "就核心任务而言——用 GPS 地图、速度与 G 力图表打开行车记录仪录像，并剪切片段——可以，而且它在任意现代浏览器里运行，无需安装。RegistratorViewer 仍有更广的旧设备列表和几个专门功能（多文件无损拼接、损坏文件修复）；dashcamigo 专注于持续维护、跨平台的体验，配一张始终能用的地图。"
                },
                {
                    "q": "RegistratorViewer 的地图为什么不能用了？",
                    "a": "它的内置路线地图是通过嵌入式 Internet Explorer 视图来渲染 Google Maps 的。当 Google 终止对其 Maps API 的免费无密钥访问后，地图开始出错，而托管部分地图脚本的网站也下线了。由于该项目已不再维护，且源代码从未公开，没有官方修复——只能手动改注册表或用非官方的社区版本。dashcamigo 整个绕开了这个问题：它的地图是无需密钥的 MapLibre + OpenFreeMap，所以没有会过期的 API 密钥。"
                },
                {
                    "q": "dashcamigo 能在 Mac、Linux 或我的手机上用吗？",
                    "a": "可以。它在浏览器里运行，所以 Windows、macOS、Linux 和移动端都能用。RegistratorViewer 以 Windows 为先；它的 Mac 版本是一个功能受限的独立应用，主要通过第三方镜像分发。"
                },
                {
                    "q": "我的录像会被上传到什么地方吗？",
                    "a": "不会。dashcamigo 没有用于接收录像的服务器。浏览器会直接读取你设备上的文件，什么都不会上传。隐私和桌面播放器一样，但不用安装。"
                },
                {
                    "q": "dashcamigo 像 RegistratorViewer 一样免费吗？",
                    "a": "是的，完全免费——无需账户，没有付费版，也没有试用限制。"
                }
            ]
        }
    },
    "dashcam-viewer": {
        "de": {
            "title": "Dashcam Viewer-Alternative — kostenlos, ohne Installation, im Browser | dashcamigo",
            "metaDescription": "Eine kostenlose Dashcam Viewer-Alternative im Browser — keine Lizenzgebühr, keine Installation. GPS-Karte, Geschwindigkeitsdiagramm und ein 3-Kanal-Raster. Nichts wird hochgeladen.",
            "ogTitle": "Kostenlose Dashcam Viewer-Alternative — im Browser",
            "ogDescription": "Dashcam Viewer ist eine ausgereifte, kostenpflichtige Desktop-App. dashcamigo ist die kostenlose Alternative im Browser ohne Installation, mit schlüsselloser Karte und einem 3-Kanal-Raster.",
            "h1": "Eine kostenlose Dashcam Viewer-Alternative — im Browser, nichts zu installieren",
            "lead": "Dashcam Viewer von Earthshine ist ein ausgefeilter, markenübergreifender Desktop-Player — und ein kostenpflichtiger, mit einer stark eingeschränkten kostenlosen Stufe. dashcamigo erledigt die alltägliche Aufgabe kostenlos, in deinem Browser: SD-Karte öffnen, die Fahrt auf einer GPS-Karte mit Geschwindigkeits- und G-Kraft-Diagramm sehen, Front, Heck und Innenraum synchron abspielen und einen Clip schneiden. Keine Installation, kein Lizenzcode, nichts wird hochgeladen.",
            "cardHint": "Ausgereifte, kostenpflichtige Desktop-App; wir sind die kostenlose im Browser",
            "whatItIs": "Dashcam Viewer (und Dashcam Viewer Plus / Pro) von Earthshine Software ist eine ausgereifte, aktiv gepflegte Desktop-Anwendung für Windows und macOS, die einen sehr breiten Katalog an Dashcam-Modellen unterstützt. Es ist ein wirklich tiefgehendes Tool — synchronisiertes Video, eine GPS-Karte und detaillierte Diagrammansichten für Geschwindigkeit, Distanz, Höhe, Satellitenanzahl und mehr, mit GPS-Export in mehreren Formaten. Es ist ein einmaliger, kostenpflichtiger Kauf mit einer stark eingeschränkten kostenlosen Stufe; es installiert sich nativ und wird mit einem Lizenzcode freigeschaltet, der nach dem Kauf per E-Mail zugeschickt wird.",
            "comparisonIntro": "Dashcam Viewer geht bei forensischen Details tiefer. Hier hat ein kostenloses Browser-Tool beim alltäglichen Anschauen die Nase vorn.",
            "compareRows": [
                {
                    "dimension": "Preis",
                    "us": {
                        "mark": "yes",
                        "note": "Kostenlos"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Kostenpflichtig, einmalige Lizenz (eingeschränkte kostenlose Stufe)"
                    }
                },
                {
                    "dimension": "Wie du es nutzt",
                    "us": {
                        "mark": "yes",
                        "note": "Im Browser — nichts zu installieren"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Installation + Lizenzcode per E-Mail"
                    }
                },
                {
                    "dimension": "Plattformen",
                    "us": {
                        "mark": "yes",
                        "note": "Windows, Mac, Linux, mobil"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Windows- & macOS-Desktop"
                    }
                },
                {
                    "dimension": "GPS-Karte",
                    "us": {
                        "mark": "yes",
                        "note": "Schlüssellos — kein API-Schlüssel, der ablaufen kann"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Online-Anbieter; Google Maps entfernt, MapQuest als Standard"
                    }
                },
                {
                    "dimension": "Kanäle gleichzeitig",
                    "us": {
                        "mark": "yes",
                        "note": "3-Kanal-Raster (Front/Heck/Innenraum)"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Bis zu 2 Kanäle"
                    }
                },
                {
                    "dimension": "Unterstützte Kameras",
                    "us": {
                        "mark": "partial",
                        "note": "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware + weitere"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Sehr breiter Katalog"
                    }
                },
                {
                    "dimension": "Schneiden & Export mit GPS",
                    "us": {
                        "mark": "yes",
                        "note": "Ja"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Ja"
                    }
                },
                {
                    "dimension": "Nichts wird hochgeladen",
                    "us": {
                        "mark": "yes",
                        "note": "Nur lokal"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Nur lokal"
                    }
                }
            ],
            "whenStayTitle": "Wann Dashcam Viewer der bessere Kauf ist",
            "whenStay": "Wenn du die breiteste Kameraabdeckung willst, tiefe forensische Details — Höhe, Satellitenanzahl, HDOP, per Reverse-Geocoding ermittelte Geotags — oder eine dedizierte Desktop-App, die du ohne Browser offline ausführen kannst, dann ist Dashcam Viewer seinen Preis wert. Es wird aktiv gepflegt und unterstützt viele Marken, die dashcamigo noch nicht abdeckt. dashcamigo zielt auf den häufigen Fall: kostenlos, sofort, im Browser.",
            "ctaPrimary": "Deine Aufnahmen öffnen",
            "faq": [
                {
                    "q": "Ist dashcamigo wirklich kostenlos? Wo ist der Haken?",
                    "a": "Es ist kostenlos, ohne kostenpflichtige Stufe und ohne Konto — es gibt keinen Haken. Es gibt auch keinen Server für deine Aufnahmen: Dein Browser liest die Dateien direkt von deinem Gerät; nichts wird hochgeladen. Wir verkaufen weder dein Videomaterial noch deine Daten."
                },
                {
                    "q": "Kann dashcamigo dieselben Kameras öffnen wie Dashcam Viewer?",
                    "a": "Für viele beliebte Marken — 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware und weitere — ja. Dashcam Viewer unterstützt einen breiteren Katalog. Wenn deine Kamera Standard-MP4, -MOV oder -MPEG-TS mit eingebettetem GPS schreibt, stehen die Chancen gut, dass es einfach funktioniert; die Seite mit den unterstützten Kameras listet auf, was abgedeckt ist. Wenn dashcamigo deine Kamera noch nicht liest, schick ein Beispiel an feedback@dashcamigo.app — wir ergänzen Formate anhand echter Aufnahmen."
                },
                {
                    "q": "Hat die Karte von dashcamigo das Problem, das Dashcam Viewer mit Google Maps hatte?",
                    "a": "Nein. Dashcam Viewer musste Google Maps fallen lassen, als Google seine Maps-API änderte (jetzt ist MapQuest Standard, mit OpenStreetMap in der Pro-Stufe). dashcamigo verwendet schlüsselloses MapLibre + OpenFreeMap, es gibt also keinen Anbieter-Schlüssel, der ablaufen könnte — die Karte funktioniert einfach."
                },
                {
                    "q": "Kann es Front und Heck (und Innenraum) gleichzeitig anzeigen?",
                    "a": "Ja — dashcamigo spielt ein synchronisiertes 3-Kanal-Raster ab. Dashcam Viewer zeigt über alle Stufen hinweg bis zu zwei Kanäle gleichzeitig an."
                },
                {
                    "q": "Muss ich etwas installieren oder eine Lizenz kaufen?",
                    "a": "Weder noch. Öffne dashcamigo.app, zieh deinen SD-Karten-Ordner hinein, und deine Fahrten erscheinen. Kein Installer, kein Lizenzcode, kein PayPal."
                }
            ]
        },
        "es": {
            "title": "Alternativa a Dashcam Viewer — gratis, sin instalar, en tu navegador | dashcamigo",
            "metaDescription": "Una alternativa a Dashcam Viewer gratuita que funciona en tu navegador — sin cuota de licencia, sin instalar. Mapa GPS, gráfico de velocidad y una rejilla de 3 canales. Nada se sube.",
            "ogTitle": "Alternativa gratuita a Dashcam Viewer — en tu navegador",
            "ogDescription": "Dashcam Viewer es una aplicación de escritorio madura y de pago. dashcamigo es la alternativa gratuita, sin instalar y en el navegador, con un mapa sin claves y una rejilla de 3 canales.",
            "h1": "Una alternativa gratuita a Dashcam Viewer — en tu navegador, sin nada que instalar",
            "lead": "Dashcam Viewer de Earthshine es un reproductor de escritorio pulido y multimarca — y de pago, con una capa gratuita muy limitada. dashcamigo hace el trabajo del día a día gratis y en tu navegador: abre la tarjeta SD, mira el trayecto en un mapa GPS con un gráfico de velocidad y fuerza G, reproduce el frontal, el trasero y el interior sincronizados, y recorta un clip. Sin instalar, sin código de licencia, sin subir nada.",
            "cardHint": "App de escritorio madura y de pago; nosotros somos la gratuita del navegador",
            "whatItIs": "Dashcam Viewer (y Dashcam Viewer Plus / Pro) de Earthshine Software es una aplicación de escritorio madura y con mantenimiento activo para Windows y macOS que admite un catálogo muy amplio de modelos de dashcam. Es una herramienta realmente profunda — vídeo sincronizado, un mapa GPS y vistas de gráficos detalladas para velocidad, distancia, altitud, número de satélites y más, con exportación de GPS en varios formatos. Es una compra única y de pago con una capa gratuita muy limitada; se instala de forma nativa y se desbloquea con un código de licencia que se envía por correo tras la compra.",
            "comparisonIntro": "Dashcam Viewer profundiza más en el detalle forense. Aquí es donde una herramienta gratuita en el navegador tiene ventaja para la visualización del día a día.",
            "compareRows": [
                {
                    "dimension": "Precio",
                    "us": {
                        "mark": "yes",
                        "note": "Gratis"
                    },
                    "them": {
                        "mark": "no",
                        "note": "De pago, licencia única (capa gratuita limitada)"
                    }
                },
                {
                    "dimension": "Cómo se ejecuta",
                    "us": {
                        "mark": "yes",
                        "note": "En el navegador — nada que instalar"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Instalación + código de licencia por correo"
                    }
                },
                {
                    "dimension": "Plataformas",
                    "us": {
                        "mark": "yes",
                        "note": "Windows, Mac, Linux, móvil"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Escritorio Windows y macOS"
                    }
                },
                {
                    "dimension": "Mapa GPS",
                    "us": {
                        "mark": "yes",
                        "note": "Sin claves — ninguna clave de API que pueda caducar"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Proveedor en línea; Google Maps retirado, MapQuest por defecto"
                    }
                },
                {
                    "dimension": "Canales a la vez",
                    "us": {
                        "mark": "yes",
                        "note": "Rejilla de 3 canales (frontal/trasero/interior)"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Hasta 2 canales"
                    }
                },
                {
                    "dimension": "Cámaras compatibles",
                    "us": {
                        "mark": "partial",
                        "note": "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware y más"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Catálogo muy amplio"
                    }
                },
                {
                    "dimension": "Recortar y exportar con GPS",
                    "us": {
                        "mark": "yes",
                        "note": "Sí"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Sí"
                    }
                },
                {
                    "dimension": "Nada se sube",
                    "us": {
                        "mark": "yes",
                        "note": "Solo local"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Solo local"
                    }
                }
            ],
            "whenStayTitle": "Cuándo Dashcam Viewer es la mejor compra",
            "whenStay": "Si quieres la mayor cobertura de cámaras, un detalle forense profundo — altitud, número de satélites, HDOP, geoetiquetas con geocodificación inversa — o una aplicación de escritorio dedicada que puedas usar sin conexión y sin navegador, Dashcam Viewer se gana su precio. Tiene mantenimiento activo y admite muchas marcas que dashcamigo aún no. dashcamigo apunta al caso común: gratis, al instante, en el navegador.",
            "ctaPrimary": "Abre tus grabaciones",
            "faq": [
                {
                    "q": "¿De verdad dashcamigo es gratis? ¿Cuál es la trampa?",
                    "a": "Es gratis sin plan de pago y sin cuenta — no hay trampa. Tampoco hay servidor: tu navegador lee los archivos directamente desde tu dispositivo; no se sube nada. No vendemos tus grabaciones ni tus datos."
                },
                {
                    "q": "¿Puede dashcamigo abrir las mismas cámaras que Dashcam Viewer?",
                    "a": "Para muchas marcas populares — 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware y más — sí. Dashcam Viewer admite un catálogo más amplio. Si tu cámara escribe MP4, MOV o MPEG-TS estándar con el GPS integrado, hay buenas probabilidades de que funcione sin más; la página de cámaras compatibles indica qué está cubierto. Si dashcamigo aún no lee tu cámara, envía una muestra a feedback@dashcamigo.app — añadimos formatos a partir de grabaciones reales."
                },
                {
                    "q": "¿Tiene el mapa de dashcamigo el problema que tuvo Dashcam Viewer con Google Maps?",
                    "a": "No. Dashcam Viewer tuvo que retirar Google Maps cuando Google cambió su API de Maps (ahora usa MapQuest por defecto, con OpenStreetMap en la capa Pro). dashcamigo usa MapLibre + OpenFreeMap sin claves, así que no hay ninguna clave de proveedor que pueda caducar — el mapa simplemente funciona."
                },
                {
                    "q": "¿Puede mostrar el frontal y el trasero (y el interior) al mismo tiempo?",
                    "a": "Sí — dashcamigo reproduce una rejilla sincronizada de 3 canales. Dashcam Viewer muestra hasta dos canales a la vez en todas sus capas."
                },
                {
                    "q": "¿Necesito instalar algo o comprar una licencia?",
                    "a": "Ninguna de las dos cosas. Abre dashcamigo.app, suelta la carpeta de tu tarjeta SD y aparecen tus trayectos. Sin instalador, sin código de licencia, sin PayPal."
                }
            ]
        },
        "fr": {
            "title": "Alternative à Dashcam Viewer — gratuite, sans installation, dans votre navigateur | dashcamigo",
            "metaDescription": "Une alternative gratuite à Dashcam Viewer qui tourne dans votre navigateur — sans frais de licence, sans installation. Carte GPS, courbe de vitesse et grille à 3 canaux. Rien n'est téléversé.",
            "ogTitle": "Alternative gratuite à Dashcam Viewer — dans votre navigateur",
            "ogDescription": "Dashcam Viewer est une application de bureau payante et aboutie. dashcamigo est l'alternative gratuite, sans installation, dans le navigateur, avec une carte sans clé et une grille à 3 canaux.",
            "h1": "Une alternative gratuite à Dashcam Viewer — dans votre navigateur, rien à installer",
            "lead": "Dashcam Viewer, d'Earthshine, est un lecteur de bureau soigné et multimarque — et payant, avec une version gratuite très limitée. dashcamigo fait le travail du quotidien gratuitement, dans votre navigateur : ouvrez la carte SD, voyez le trajet sur une carte GPS avec une courbe de vitesse et de force G, lisez l'avant, l'arrière et l'habitacle en synchro, et découpez un clip. Pas d'installation, pas de code de licence, rien n'est téléversé.",
            "cardHint": "Application de bureau payante et aboutie ; nous, c'est gratuit dans le navigateur",
            "whatItIs": "Dashcam Viewer (et Dashcam Viewer Plus / Pro) d'Earthshine Software est une application de bureau aboutie et activement maintenue pour Windows et macOS, qui prend en charge un très large catalogue de modèles de dashcams. C'est un outil vraiment poussé — vidéo synchronisée, carte GPS, et des graphiques détaillés de vitesse, distance, altitude, nombre de satellites et plus encore, avec export GPS dans plusieurs formats. C'est un achat unique et payant avec une version gratuite très limitée ; il s'installe en natif et se déverrouille avec un code de licence envoyé par e-mail après l'achat.",
            "comparisonIntro": "Dashcam Viewer va plus loin dans le détail forensique. Voici là où un outil gratuit dans le navigateur prend l'avantage pour le visionnage de tous les jours.",
            "compareRows": [
                {
                    "dimension": "Prix",
                    "us": {
                        "mark": "yes",
                        "note": "Gratuit"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Payant, licence unique (version gratuite limitée)"
                    }
                },
                {
                    "dimension": "Comment on le lance",
                    "us": {
                        "mark": "yes",
                        "note": "Dans le navigateur — rien à installer"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Installation + code de licence par e-mail"
                    }
                },
                {
                    "dimension": "Plateformes",
                    "us": {
                        "mark": "yes",
                        "note": "Windows, Mac, Linux, mobile"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Bureau Windows et macOS"
                    }
                },
                {
                    "dimension": "Carte GPS",
                    "us": {
                        "mark": "yes",
                        "note": "Sans clé — aucune clé d'API qui puisse expirer"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Fournisseur en ligne ; Google Maps abandonné, MapQuest par défaut"
                    }
                },
                {
                    "dimension": "Canaux en même temps",
                    "us": {
                        "mark": "yes",
                        "note": "Grille à 3 canaux (avant/arrière/habitacle)"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Jusqu'à 2 canaux"
                    }
                },
                {
                    "dimension": "Caméras prises en charge",
                    "us": {
                        "mark": "partial",
                        "note": "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware + d'autres"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Catalogue très large"
                    }
                },
                {
                    "dimension": "Découpe et export avec GPS",
                    "us": {
                        "mark": "yes",
                        "note": "Oui"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Oui"
                    }
                },
                {
                    "dimension": "Rien n'est téléversé",
                    "us": {
                        "mark": "yes",
                        "note": "Tout en local"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Tout en local"
                    }
                }
            ],
            "whenStayTitle": "Quand Dashcam Viewer est le meilleur achat",
            "whenStay": "Si vous voulez la plus large couverture de caméras, un détail forensique poussé — altitude, nombre de satellites, HDOP, géotags géocodés en inverse — ou une application de bureau dédiée que vous pouvez lancer hors ligne sans navigateur, Dashcam Viewer vaut son prix. Il est activement maintenu et prend en charge de nombreuses marques que dashcamigo ne gère pas encore. dashcamigo vise le cas courant : gratuit, instantané, dans le navigateur.",
            "ctaPrimary": "Ouvrir vos enregistrements",
            "faq": [
                {
                    "q": "dashcamigo est-il vraiment gratuit ? Où est le piège ?",
                    "a": "Il est gratuit, sans palier payant et sans compte — il n'y a pas de piège. Il n'y a pas non plus de serveur : votre navigateur lit les fichiers directement sur votre appareil ; rien n'est téléversé. Nous ne vendons ni vos images ni vos données."
                },
                {
                    "q": "dashcamigo ouvre-t-il les mêmes caméras que Dashcam Viewer ?",
                    "a": "Pour beaucoup de marques populaires — 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware et d'autres — oui. Dashcam Viewer prend en charge un catalogue plus large. Si votre caméra écrit du MP4, MOV ou MPEG-TS standard avec un GPS intégré, il y a de bonnes chances que ça marche directement ; la page des caméras prises en charge liste ce qui est couvert. Si dashcamigo ne lit pas encore votre caméra, envoyez un échantillon à feedback@dashcamigo.app — nous ajoutons des formats à partir d'enregistrements réels."
                },
                {
                    "q": "La carte de dashcamigo a-t-elle le problème qu'a eu Dashcam Viewer avec Google Maps ?",
                    "a": "Non. Dashcam Viewer a dû abandonner Google Maps quand Google a changé son API Maps (il utilise désormais MapQuest par défaut, avec OpenStreetMap sur le palier Pro). dashcamigo utilise MapLibre + OpenFreeMap sans clé, donc il n'y a aucune clé de fournisseur qui puisse expirer — la carte fonctionne, tout simplement."
                },
                {
                    "q": "Peut-il afficher l'avant et l'arrière (et l'habitacle) en même temps ?",
                    "a": "Oui — dashcamigo lit une grille synchronisée à 3 canaux. Dashcam Viewer affiche jusqu'à deux canaux à la fois, sur tous ses paliers."
                },
                {
                    "q": "Dois-je installer quelque chose ou acheter une licence ?",
                    "a": "Ni l'un ni l'autre. Ouvrez dashcamigo.app, déposez le dossier de votre carte SD, et vos trajets apparaissent. Pas d'installeur, pas de code de licence, pas de PayPal."
                }
            ]
        },
        "ja": {
            "title": "Dashcam Viewerの代替 — 無料、インストール不要、ブラウザで | dashcamigo",
            "metaDescription": "ブラウザで動くDashcam Viewerの無料代替 — ライセンス料不要、インストール不要。GPSマップ、速度グラフ、3チャンネルのグリッド。何もアップロードされません。",
            "ogTitle": "無料のDashcam Viewer代替 — ブラウザで",
            "ogDescription": "Dashcam Viewerは成熟した有料デスクトップアプリです。dashcamigoは、キー不要のマップと3チャンネルのグリッドを備えた、無料・インストール不要のブラウザ代替です。",
            "h1": "無料のDashcam Viewer代替 — ブラウザで、インストール不要",
            "lead": "EarthshineのDashcam Viewerは、洗練されたマルチブランド対応のデスクトッププレーヤー — そして有料で、無料版は厳しく制限されています。dashcamigoは日々の仕事を無料で、ブラウザでこなします — SDカードを開き、速度とGフォースのグラフ付きのGPSマップで走行を見て、フロント・リア・室内を同期再生し、クリップをトリミングする。インストール不要、ライセンスコード不要、何もアップロードされません。",
            "cardHint": "成熟した有料デスクトップアプリ。こちらは無料のブラウザ版",
            "whatItIs": "Earthshine SoftwareによるDashcam Viewer（およびDashcam Viewer Plus / Pro）は、WindowsとmacOS向けの成熟した、活発にメンテされているデスクトップアプリケーションで、非常に幅広いドラレコモデルに対応しています。これは本当に奥深いツールです — 同期した映像、GPSマップ、そして速度・距離・標高・衛星数などの詳細なプロット表示に、複数形式のGPSエクスポートを備えています。買い切り型の有料アプリで、無料版は厳しく制限されています。ネイティブにインストールされ、購入後にメールで送られるライセンスコードでロック解除します。",
            "comparisonIntro": "Dashcam Viewerはフォレンジックな細部でより深く掘り下げます。日常的な視聴では無料のブラウザツールに分があるところを示します。",
            "compareRows": [
                {
                    "dimension": "価格",
                    "us": {
                        "mark": "yes",
                        "note": "無料"
                    },
                    "them": {
                        "mark": "no",
                        "note": "有料、買い切りライセンス（無料版は制限あり）"
                    }
                },
                {
                    "dimension": "実行方法",
                    "us": {
                        "mark": "yes",
                        "note": "ブラウザで — インストール不要"
                    },
                    "them": {
                        "mark": "no",
                        "note": "インストール＋メールで届くライセンスコード"
                    }
                },
                {
                    "dimension": "プラットフォーム",
                    "us": {
                        "mark": "yes",
                        "note": "Windows、Mac、Linux、モバイル"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "WindowsとmacOSのデスクトップ"
                    }
                },
                {
                    "dimension": "GPSマップ",
                    "us": {
                        "mark": "yes",
                        "note": "キー不要 — 期限切れになるAPIキーなし"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "オンラインプロバイダ。Googleマップは廃止、MapQuestがデフォルト"
                    }
                },
                {
                    "dimension": "同時表示チャンネル数",
                    "us": {
                        "mark": "yes",
                        "note": "3チャンネルのグリッド（フロント/リア/室内）"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "最大2チャンネル"
                    }
                },
                {
                    "dimension": "対応カメラ",
                    "us": {
                        "mark": "partial",
                        "note": "70mai、Viofo、BlackVue、GoPro、Garmin、Vantrue、Thinkwareほか"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "非常に幅広いカタログ"
                    }
                },
                {
                    "dimension": "GPS付きのトリミングとエクスポート",
                    "us": {
                        "mark": "yes",
                        "note": "あり"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "あり"
                    }
                },
                {
                    "dimension": "何もアップロードしない",
                    "us": {
                        "mark": "yes",
                        "note": "ローカルのみ"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "ローカルのみ"
                    }
                }
            ],
            "whenStayTitle": "Dashcam Viewerの方が買う価値がある場合",
            "whenStay": "最も広いカメラ対応、深いフォレンジックな細部 — 標高、衛星数、HDOP、逆ジオコーディングされたジオタグ — が欲しい場合や、ブラウザなしでオフラインで動かせる専用デスクトップアプリが欲しい場合、Dashcam Viewerはその価格に見合います。活発にメンテされ、dashcamigoがまだ対応していない多くのブランドをサポートしています。dashcamigoはよくあるケースを狙っています — 無料で、すぐに、ブラウザで。",
            "ctaPrimary": "録画を開く",
            "faq": [
                {
                    "q": "dashcamigoは本当に無料ですか？ 裏があるのでは？",
                    "a": "有料プランもアカウントもなしで無料です — 裏はありません。録画を受け取るサーバーもありません。ブラウザがデバイス上のファイルを直接読み取るため、何もアップロードされません。あなたの映像やデータを売ることもありません。"
                },
                {
                    "q": "dashcamigoはDashcam Viewerと同じカメラを開けますか？",
                    "a": "多くの人気ブランド — 70mai、Viofo、BlackVue、GoPro、Garmin、Vantrue、Thinkwareなど — については、はい。Dashcam Viewerはより広いカタログに対応しています。お使いのカメラがGPSを埋め込んだ標準的なMP4、MOV、MPEG-TSを書き出すなら、そのまま動く可能性が高いです。対応カメラのページでカバー範囲を確認できます。dashcamigoがまだお使いのカメラを読めない場合は、サンプルをfeedback@dashcamigo.appに送ってください。実際の録画をもとにフォーマットを追加します。"
                },
                {
                    "q": "dashcamigoのマップには、Dashcam ViewerがGoogleマップで抱えた問題がありますか？",
                    "a": "いいえ。Dashcam ViewerはGoogleがMaps APIを変更したときにGoogleマップを手放さざるを得ませんでした（現在はMapQuestがデフォルトで、Pro版ではOpenStreetMap）。dashcamigoはキー不要のMapLibre＋OpenFreeMapを使うので、期限切れになるプロバイダのキーがありません — マップはただ動きます。"
                },
                {
                    "q": "フロントとリア（と室内）を同時に表示できますか？",
                    "a": "はい — dashcamigoは同期した3チャンネルのグリッドを再生します。Dashcam Viewerは全プランで一度に最大2チャンネルを表示します。"
                },
                {
                    "q": "何かをインストールしたりライセンスを買ったりする必要がありますか？",
                    "a": "どちらも不要です。dashcamigo.appを開き、SDカードのフォルダーをドロップすれば走行が現れます。インストーラーなし、ライセンスコードなし、PayPalなし。"
                }
            ]
        },
        "ko": {
            "title": "Dashcam Viewer 대안 — 무료, 설치 없이, 브라우저에서 | dashcamigo",
            "metaDescription": "브라우저에서 돌아가는 무료 Dashcam Viewer 대안 — 라이선스 비용 없이, 설치 없이. GPS 지도, 속도 차트, 3채널 그리드. 아무것도 업로드되지 않음.",
            "ogTitle": "무료 Dashcam Viewer 대안 — 브라우저에서",
            "ogDescription": "Dashcam Viewer는 완성도 높은 유료 데스크톱 앱입니다. dashcamigo는 키 없는 지도와 3채널 그리드를 갖춘 무료·무설치 브라우저 대안입니다.",
            "h1": "무료 Dashcam Viewer 대안 — 브라우저에서, 설치할 것 없이",
            "lead": "Earthshine의 Dashcam Viewer는 완성도 높은 멀티 브랜드 데스크톱 플레이어이자 유료 프로그램입니다(기능이 빡빡하게 제한된 무료 등급 포함). dashcamigo는 일상적인 작업을 무료로, 브라우저에서 해냅니다 — SD 카드를 열고, GPS 지도에서 속도와 G 포스 차트와 함께 주행을 보고, 전방·후방·실내를 동기화 재생하고, 클립을 잘라냅니다. 설치도, 라이선스 코드도, 업로드도 없습니다.",
            "cardHint": "완성도 높은 유료 데스크톱 앱; 우리는 무료 브라우저 버전",
            "whatItIs": "Earthshine Software의 Dashcam Viewer(및 Dashcam Viewer Plus / Pro)는 매우 폭넓은 블랙박스 모델을 지원하는, 완성도 높고 활발히 유지보수되는 Windows·macOS용 데스크톱 애플리케이션입니다. 진정으로 깊이 있는 도구입니다 — 동기화된 영상, GPS 지도, 그리고 속도·거리·고도·위성 수 등에 대한 상세한 플롯 뷰에 다중 포맷 GPS 내보내기까지 갖췄죠. 기능이 빡빡하게 제한된 무료 등급이 있는 유료 일회성 구매 방식이며, 네이티브로 설치되고 구매 후 이메일로 받은 라이선스 코드로 잠금이 해제됩니다.",
            "comparisonIntro": "Dashcam Viewer는 포렌식 디테일에서 더 깊이 들어갑니다. 일상적인 시청에서는 무료 브라우저 도구가 어디서 앞서는지 보세요.",
            "compareRows": [
                {
                    "dimension": "가격",
                    "us": {
                        "mark": "yes",
                        "note": "무료"
                    },
                    "them": {
                        "mark": "no",
                        "note": "유료, 일회성 라이선스(제한된 무료 등급)"
                    }
                },
                {
                    "dimension": "실행 방식",
                    "us": {
                        "mark": "yes",
                        "note": "브라우저에서 — 설치할 것 없음"
                    },
                    "them": {
                        "mark": "no",
                        "note": "설치 + 이메일로 받은 라이선스 코드"
                    }
                },
                {
                    "dimension": "플랫폼",
                    "us": {
                        "mark": "yes",
                        "note": "Windows, Mac, Linux, 모바일"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Windows·macOS 데스크톱"
                    }
                },
                {
                    "dimension": "GPS 지도",
                    "us": {
                        "mark": "yes",
                        "note": "키 없음 — 만료될 API 키 없음"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "온라인 제공자; Google 지도 제외, 기본값 MapQuest"
                    }
                },
                {
                    "dimension": "동시 채널 수",
                    "us": {
                        "mark": "yes",
                        "note": "3채널 그리드(전방/후방/실내)"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "최대 2채널"
                    }
                },
                {
                    "dimension": "지원 카메라",
                    "us": {
                        "mark": "partial",
                        "note": "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware 외 다수"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "매우 폭넓은 카탈로그"
                    }
                },
                {
                    "dimension": "GPS 포함 잘라내기·내보내기",
                    "us": {
                        "mark": "yes",
                        "note": "있음"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "있음"
                    }
                },
                {
                    "dimension": "아무것도 업로드되지 않음",
                    "us": {
                        "mark": "yes",
                        "note": "로컬 전용"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "로컬 전용"
                    }
                }
            ],
            "whenStayTitle": "Dashcam Viewer가 더 나은 선택인 경우",
            "whenStay": "가장 넓은 카메라 지원, 깊이 있는 포렌식 디테일 — 고도, 위성 수, HDOP, 역지오코딩된 지오태그 — 또는 브라우저 없이 오프라인으로 돌릴 수 있는 전용 데스크톱 앱을 원한다면 Dashcam Viewer는 그 값어치를 합니다. 활발히 유지보수되고, dashcamigo가 아직 지원하지 않는 많은 브랜드를 다룹니다. dashcamigo는 흔한 경우를 노립니다 — 무료로, 즉시, 브라우저에서.",
            "ctaPrimary": "내 녹화 영상 열기",
            "faq": [
                {
                    "q": "dashcamigo가 정말 무료인가요? 함정이 있나요?",
                    "a": "유료 등급도 계정도 없는 무료입니다 — 함정은 없습니다. 녹화 영상을 받을 서버도 없습니다. 브라우저가 기기의 파일을 직접 읽어서 아무것도 업로드되지 않습니다. 저희는 여러분의 영상이나 데이터를 팔지 않습니다."
                },
                {
                    "q": "dashcamigo는 Dashcam Viewer와 같은 카메라를 열 수 있나요?",
                    "a": "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware 등 많은 인기 브랜드는 가능합니다. Dashcam Viewer는 더 넓은 카탈로그를 지원합니다. 카메라가 GPS를 내장한 표준 MP4, MOV, MPEG-TS로 기록한다면 그냥 잘 작동할 가능성이 높습니다. 지원 카메라 페이지에서 무엇이 다뤄지는지 확인할 수 있습니다. dashcamigo가 아직 당신의 카메라를 읽지 못한다면 feedback@dashcamigo.app으로 샘플을 보내주세요 — 실제 녹화를 바탕으로 포맷을 추가합니다."
                },
                {
                    "q": "dashcamigo의 지도에도 Dashcam Viewer가 Google 지도에서 겪은 문제가 있나요?",
                    "a": "아니요. Dashcam Viewer는 Google이 Maps API를 변경하자 Google 지도를 빼야 했습니다(현재는 기본값 MapQuest, Pro 등급에서 OpenStreetMap). dashcamigo는 키 없는 MapLibre + OpenFreeMap을 쓰므로 만료될 제공자 키가 없습니다 — 지도가 그냥 작동합니다."
                },
                {
                    "q": "전방과 후방(그리고 실내)을 동시에 볼 수 있나요?",
                    "a": "네 — dashcamigo는 동기화된 3채널 그리드를 재생합니다. Dashcam Viewer는 모든 등급에서 한 번에 최대 두 채널을 표시합니다."
                },
                {
                    "q": "뭔가 설치하거나 라이선스를 사야 하나요?",
                    "a": "둘 다 아닙니다. dashcamigo.app을 열고 SD 카드 폴더를 끌어다 놓으면 주행이 나타납니다. 설치 프로그램도, 라이선스 코드도, PayPal도 없습니다."
                }
            ]
        },
        "pl": {
            "title": "Alternatywa dla Dashcam Viewer — za darmo, bez instalacji, w przeglądarce | dashcamigo",
            "metaDescription": "Darmowa alternatywa dla Dashcam Viewer działająca w przeglądarce — bez opłaty licencyjnej, bez instalacji. Mapa GPS, wykres prędkości i siatka 3 kanałów. Nic nie jest wysyłane.",
            "ogTitle": "Darmowa alternatywa dla Dashcam Viewer — w przeglądarce",
            "ogDescription": "Dashcam Viewer to dojrzała, płatna aplikacja na pulpit. dashcamigo to darmowa alternatywa w przeglądarce, bez instalacji, z mapą bez kluczy i siatką 3 kanałów.",
            "h1": "Darmowa alternatywa dla Dashcam Viewer — w przeglądarce, nic do zainstalowania",
            "lead": "Dashcam Viewer od Earthshine to dopracowany, wielomarkowy odtwarzacz na pulpit — i to płatny, z mocno ograniczoną darmową wersją. dashcamigo wykonuje codzienne zadanie za darmo, w Twojej przeglądarce: otwórz kartę SD, zobacz przejazd na mapie GPS z wykresem prędkości i przeciążeń, odtwórz przód, tył i wnętrze w synchronizacji oraz przytnij klip. Bez instalacji, bez kodu licencyjnego, nic nie jest wysyłane.",
            "cardHint": "Dojrzała, płatna aplikacja na pulpit; my jesteśmy tą darmową, w przeglądarce",
            "whatItIs": "Dashcam Viewer (oraz Dashcam Viewer Plus / Pro) od Earthshine Software to dojrzała, aktywnie rozwijana aplikacja na pulpit dla Windows i macOS, która obsługuje bardzo szeroki katalog modeli kamer samochodowych. To naprawdę dogłębne narzędzie — zsynchronizowane wideo, mapa GPS oraz szczegółowe wykresy prędkości, dystansu, wysokości, liczby satelitów i nie tylko, z eksportem GPS w wielu formatach. To płatny zakup jednorazowy z mocno ograniczoną darmową wersją; instaluje się natywnie i odblokowuje kodem licencyjnym przesłanym mailem po zakupie.",
            "comparisonIntro": "Dashcam Viewer idzie głębiej w szczegóły śledcze. Oto gdzie darmowe narzędzie w przeglądarce ma przewagę w codziennym oglądaniu.",
            "compareRows": [
                {
                    "dimension": "Cena",
                    "us": {
                        "mark": "yes",
                        "note": "Za darmo"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Płatne, jednorazowa licencja (ograniczona darmowa wersja)"
                    }
                },
                {
                    "dimension": "Jak się go uruchamia",
                    "us": {
                        "mark": "yes",
                        "note": "W przeglądarce — nic do zainstalowania"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Instalacja + kod licencyjny mailem"
                    }
                },
                {
                    "dimension": "Platformy",
                    "us": {
                        "mark": "yes",
                        "note": "Windows, Mac, Linux, mobilne"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Pulpit Windows i macOS"
                    }
                },
                {
                    "dimension": "Mapa GPS",
                    "us": {
                        "mark": "yes",
                        "note": "Bez kluczy — żaden klucz API nie wygaśnie"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Dostawca online; Google Maps usunięte, MapQuest domyślnie"
                    }
                },
                {
                    "dimension": "Kanały jednocześnie",
                    "us": {
                        "mark": "yes",
                        "note": "Siatka 3 kanałów (przód/tył/wnętrze)"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Do 2 kanałów"
                    }
                },
                {
                    "dimension": "Obsługiwane kamery",
                    "us": {
                        "mark": "partial",
                        "note": "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware i inne"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Bardzo szeroki katalog"
                    }
                },
                {
                    "dimension": "Przycinanie i eksport z GPS",
                    "us": {
                        "mark": "yes",
                        "note": "Tak"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Tak"
                    }
                },
                {
                    "dimension": "Nic nie jest wysyłane",
                    "us": {
                        "mark": "yes",
                        "note": "Tylko lokalnie"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Tylko lokalnie"
                    }
                }
            ],
            "whenStayTitle": "Kiedy Dashcam Viewer to lepszy wybór",
            "whenStay": "Jeśli chcesz najszerszej obsługi kamer, dogłębnych szczegółów śledczych — wysokość, liczba satelitów, HDOP, geotagi z odwrotnym geokodowaniem — albo dedykowanej aplikacji na pulpit, którą uruchomisz offline bez przeglądarki, Dashcam Viewer wart jest swojej ceny. Jest aktywnie rozwijany i obsługuje wiele marek, których dashcamigo jeszcze nie. dashcamigo celuje w typowy przypadek: za darmo, od razu, w przeglądarce.",
            "ctaPrimary": "Otwórz swoje nagrania",
            "faq": [
                {
                    "q": "Czy dashcamigo jest naprawdę darmowe? W czym haczyk?",
                    "a": "Jest darmowe, bez płatnego planu i bez konta — nie ma haczyka. Nie ma też serwera, na który trafiałyby nagrania: przeglądarka odczytuje pliki bezpośrednio z twojego urządzenia; nic nie jest wysyłane. Nie sprzedajemy Twoich nagrań ani Twoich danych."
                },
                {
                    "q": "Czy dashcamigo otworzy te same kamery co Dashcam Viewer?",
                    "a": "Dla wielu popularnych marek — 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware i innych — tak. Dashcam Viewer obsługuje szerszy katalog. Jeśli Twoja kamera zapisuje standardowy MP4, MOV lub MPEG-TS z wbudowanym GPS, jest spora szansa, że po prostu zadziała; strona z obsługiwanymi kamerami wymienia, co jest objęte. Jeśli dashcamigo jeszcze nie odczytuje Twojej kamery, wyślij próbkę na feedback@dashcamigo.app — dodajemy formaty na podstawie prawdziwych nagrań."
                },
                {
                    "q": "Czy mapa dashcamigo ma problem, który Dashcam Viewer miał z Google Maps?",
                    "a": "Nie. Dashcam Viewer musiał porzucić Google Maps, gdy Google zmienił swoje Maps API (teraz domyślnie korzysta z MapQuest, a z OpenStreetMap w wersji Pro). dashcamigo używa MapLibre + OpenFreeMap bez kluczy, więc nie ma żadnego klucza dostawcy, który mógłby wygasnąć — mapa po prostu działa."
                },
                {
                    "q": "Czy może pokazać przód i tył (oraz wnętrze) jednocześnie?",
                    "a": "Tak — dashcamigo odtwarza zsynchronizowaną siatkę 3 kanałów. Dashcam Viewer wyświetla do dwóch kanałów naraz we wszystkich swoich planach."
                },
                {
                    "q": "Czy muszę cokolwiek instalować lub kupować licencję?",
                    "a": "Ani jedno, ani drugie. Otwórz dashcamigo.app, upuść folder z karty SD, a Twoje przejazdy się pojawią. Bez instalatora, bez kodu licencyjnego, bez PayPala."
                }
            ]
        },
        "pt": {
            "title": "Alternativa ao Dashcam Viewer — grátis, sem instalação, no seu navegador | dashcamigo",
            "metaDescription": "Uma alternativa gratuita ao Dashcam Viewer que roda no seu navegador — sem taxa de licença, sem instalação. Mapa GPS, gráfico de velocidade e grade de 3 canais. Nada é enviado.",
            "ogTitle": "Alternativa gratuita ao Dashcam Viewer — no seu navegador",
            "ogDescription": "O Dashcam Viewer é um app de desktop pago e maduro. O dashcamigo é a alternativa gratuita, sem instalação e no navegador, com mapa sem chave e grade de 3 canais.",
            "h1": "Uma alternativa gratuita ao Dashcam Viewer — no seu navegador, sem nada para instalar",
            "lead": "O Dashcam Viewer, da Earthshine, é um player de desktop refinado e multimarca — e pago, com um plano gratuito bem restrito. O dashcamigo faz a tarefa do dia a dia de graça, no seu navegador: abra o cartão SD, veja a viagem em um mapa GPS com gráfico de velocidade e força G, reproduza frente, traseira e interior em sincronia, e corte um clipe. Sem instalação, sem código de licença, nada é enviado.",
            "cardHint": "App de desktop pago e maduro; nós somos o gratuito no navegador",
            "whatItIs": "O Dashcam Viewer (e o Dashcam Viewer Plus / Pro) da Earthshine Software é um aplicativo de desktop maduro e com manutenção ativa para Windows e macOS, que dá suporte a um catálogo muito amplo de modelos de dashcam. É uma ferramenta genuinamente profunda — vídeo sincronizado, um mapa GPS, e visualizações de gráfico detalhadas para velocidade, distância, altitude, número de satélites e mais, com exportação de GPS em vários formatos. É uma compra única e paga com um plano gratuito bem restrito; ele instala de forma nativa e é desbloqueado com um código de licença enviado por e-mail após a compra.",
            "comparisonIntro": "O Dashcam Viewer vai mais fundo no detalhe forense. Veja onde uma ferramenta gratuita no navegador leva vantagem na visualização do dia a dia.",
            "compareRows": [
                {
                    "dimension": "Preço",
                    "us": {
                        "mark": "yes",
                        "note": "Grátis"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Pago, licença única (plano gratuito limitado)"
                    }
                },
                {
                    "dimension": "Como você o executa",
                    "us": {
                        "mark": "yes",
                        "note": "No navegador — nada para instalar"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Instalação + código de licença por e-mail"
                    }
                },
                {
                    "dimension": "Plataformas",
                    "us": {
                        "mark": "yes",
                        "note": "Windows, Mac, Linux, celular"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Desktop Windows e macOS"
                    }
                },
                {
                    "dimension": "Mapa GPS",
                    "us": {
                        "mark": "yes",
                        "note": "Sem chave — nenhuma chave de API para expirar"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Provedor online; Google Maps removido, MapQuest por padrão"
                    }
                },
                {
                    "dimension": "Canais ao mesmo tempo",
                    "us": {
                        "mark": "yes",
                        "note": "Grade de 3 canais (frente/traseira/interior)"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Até 2 canais"
                    }
                },
                {
                    "dimension": "Câmeras compatíveis",
                    "us": {
                        "mark": "partial",
                        "note": "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware e mais"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Catálogo muito amplo"
                    }
                },
                {
                    "dimension": "Corte e exportação com GPS",
                    "us": {
                        "mark": "yes",
                        "note": "Sim"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Sim"
                    }
                },
                {
                    "dimension": "Nada é enviado",
                    "us": {
                        "mark": "yes",
                        "note": "Apenas local"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Apenas local"
                    }
                }
            ],
            "whenStayTitle": "Quando o Dashcam Viewer é a melhor compra",
            "whenStay": "Se você quer a maior cobertura de câmeras, detalhe forense profundo — altitude, número de satélites, HDOP, geotags com geocodificação reversa — ou um app de desktop dedicado que você pode rodar offline sem navegador, o Dashcam Viewer vale o seu preço. Ele recebe manutenção ativa e dá suporte a muitas marcas que o dashcamigo ainda não tem. O dashcamigo mira no caso comum: grátis, instantâneo, no navegador.",
            "ctaPrimary": "Abra suas gravações",
            "faq": [
                {
                    "q": "O dashcamigo é realmente gratuito? Qual é a pegadinha?",
                    "a": "Ele é gratuito, sem plano pago e sem conta — não há pegadinha. Também não há servidor para receber suas gravações: seu navegador lê os arquivos direto do seu dispositivo; nada é enviado. Não vendemos suas filmagens nem seus dados."
                },
                {
                    "q": "O dashcamigo abre as mesmas câmeras que o Dashcam Viewer?",
                    "a": "Para muitas marcas populares — 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware e mais — sim. O Dashcam Viewer dá suporte a um catálogo mais amplo. Se a sua câmera grava em MP4, MOV ou MPEG-TS padrão com GPS embutido, há uma boa chance de simplesmente funcionar; a página de câmeras compatíveis lista o que é coberto. Se o dashcamigo ainda não lê a sua câmera, envie uma amostra para feedback@dashcamigo.app — adicionamos formatos a partir de gravações reais."
                },
                {
                    "q": "O mapa do dashcamigo tem o problema que o Dashcam Viewer teve com o Google Maps?",
                    "a": "Não. O Dashcam Viewer teve que remover o Google Maps quando o Google mudou sua API do Maps (agora ele usa o MapQuest por padrão, com OpenStreetMap no plano Pro). O dashcamigo usa o MapLibre + OpenFreeMap sem chave, então não há nenhuma chave de provedor para expirar — o mapa simplesmente funciona."
                },
                {
                    "q": "Ele pode mostrar frente e traseira (e interior) ao mesmo tempo?",
                    "a": "Sim — o dashcamigo reproduz uma grade sincronizada de 3 canais. O Dashcam Viewer exibe até dois canais ao mesmo tempo em todos os seus planos."
                },
                {
                    "q": "Preciso instalar algo ou comprar uma licença?",
                    "a": "Nenhum dos dois. Abra o dashcamigo.app, solte a pasta do seu cartão SD e suas viagens aparecem. Sem instalador, sem código de licença, sem PayPal."
                }
            ]
        },
        "zh": {
            "title": "Dashcam Viewer 替代方案——免费、无需安装、在浏览器里 | dashcamigo",
            "metaDescription": "一款免费的 Dashcam Viewer 替代方案，在浏览器中运行——无需授权费，无需安装。GPS 地图、速度图表和三通道网格。什么都不上传。",
            "ogTitle": "免费的 Dashcam Viewer 替代方案——在浏览器里",
            "ogDescription": "Dashcam Viewer 是一款成熟的付费桌面应用。dashcamigo 是免费、无需安装、在浏览器里运行的替代方案，配有无需密钥的地图和三通道网格。",
            "h1": "免费的 Dashcam Viewer 替代方案——在浏览器里，无需安装",
            "lead": "Earthshine 的 Dashcam Viewer 是一款打磨精良、支持多品牌的桌面播放器——也是一款付费软件（免费版限制严格）。dashcamigo 免费在浏览器里完成日常工作：打开 SD 卡，在 GPS 地图上看到行程，配上速度与 G 力图表，同步播放前、后和车内画面，并剪切片段。无需安装，无需授权码，什么都不上传。",
            "cardHint": "成熟的付费桌面应用；我们是免费的浏览器版",
            "whatItIs": "Earthshine Software 的 Dashcam Viewer（以及 Dashcam Viewer Plus / Pro）是一款成熟、积极维护的桌面应用，适用于 Windows 和 macOS，支持非常广泛的行车记录仪型号。它确实是一款很深入的工具——同步视频、GPS 地图，以及速度、距离、海拔、卫星数等详尽的图表视图，还支持多格式的 GPS 导出。它是一款一次性付费购买，免费版限制严格；它原生安装，并用购买后通过电子邮件发送的授权码激活。",
            "comparisonIntro": "Dashcam Viewer 在取证级的细节上更深入。下面看看在日常观看上，一款免费的浏览器工具优势在哪里。",
            "compareRows": [
                {
                    "dimension": "价格",
                    "us": {
                        "mark": "yes",
                        "note": "免费"
                    },
                    "them": {
                        "mark": "no",
                        "note": "付费，一次性授权（免费版受限）"
                    }
                },
                {
                    "dimension": "如何运行",
                    "us": {
                        "mark": "yes",
                        "note": "在浏览器里——无需安装"
                    },
                    "them": {
                        "mark": "no",
                        "note": "安装 + 邮件发来的授权码"
                    }
                },
                {
                    "dimension": "平台",
                    "us": {
                        "mark": "yes",
                        "note": "Windows、Mac、Linux、移动端"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Windows 和 macOS 桌面"
                    }
                },
                {
                    "dimension": "GPS 地图",
                    "us": {
                        "mark": "yes",
                        "note": "无需密钥——不会失效"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "在线提供商；已弃用 Google Maps，默认 MapQuest"
                    }
                },
                {
                    "dimension": "同时显示的通道数",
                    "us": {
                        "mark": "yes",
                        "note": "三通道网格（前/后/车内）"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "最多 2 个通道"
                    }
                },
                {
                    "dimension": "支持的摄像头",
                    "us": {
                        "mark": "partial",
                        "note": "70mai、Viofo、BlackVue、GoPro、Garmin、Vantrue、Thinkware 等"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "非常广泛的目录"
                    }
                },
                {
                    "dimension": "带 GPS 的剪切与导出",
                    "us": {
                        "mark": "yes",
                        "note": "有"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "有"
                    }
                },
                {
                    "dimension": "什么都不上传",
                    "us": {
                        "mark": "yes",
                        "note": "仅在本地"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "仅在本地"
                    }
                }
            ],
            "whenStayTitle": "什么时候 Dashcam Viewer 更值得买",
            "whenStay": "如果你想要最广的摄像头覆盖、取证级的深度细节——海拔、卫星数、HDOP、反向地理编码的地理标签——或一款不用浏览器、可离线运行的专用桌面应用，Dashcam Viewer 物有所值。它积极维护，支持许多 dashcamigo 暂时还不支持的品牌。dashcamigo 瞄准的是常见场景：免费、即开即用、在浏览器里。",
            "ctaPrimary": "打开你的录像",
            "faq": [
                {
                    "q": "dashcamigo 真的免费吗？有什么套路？",
                    "a": "它免费，没有付费版，也不用账户——没有套路。也没有用于接收录像的服务器：浏览器会直接读取你设备上的文件，什么都不会上传。我们不会出售你的录像或你的数据。"
                },
                {
                    "q": "dashcamigo 能打开和 Dashcam Viewer 一样的摄像头吗？",
                    "a": "对许多热门品牌——70mai、Viofo、BlackVue、GoPro、Garmin、Vantrue、Thinkware 等——可以。Dashcam Viewer 支持更广的目录。如果你的摄像头写的是带内嵌 GPS 的标准 MP4、MOV 或 MPEG-TS，很有可能直接就能用；支持的摄像头页面列出了具体覆盖范围。如果 dashcamigo 还读不了你的摄像头，发个样本到 feedback@dashcamigo.app——我们会根据真实录像补充格式。"
                },
                {
                    "q": "dashcamigo 的地图会有 Dashcam Viewer 当年用 Google Maps 时遇到的问题吗？",
                    "a": "不会。Dashcam Viewer 在 Google 更改其 Maps API 时不得不弃用 Google Maps（现在默认是 MapQuest，Pro 版上是 OpenStreetMap）。dashcamigo 使用无需密钥的 MapLibre + OpenFreeMap，没有会过期的提供商密钥——地图就是能用。"
                },
                {
                    "q": "它能同时显示前后（和车内）画面吗？",
                    "a": "可以——dashcamigo 同步播放三通道网格。Dashcam Viewer 在它所有的版本里都最多同时显示两个通道。"
                },
                {
                    "q": "我需要安装什么或购买授权吗？",
                    "a": "都不用。打开 dashcamigo.app，拖入你的 SD 卡文件夹，行程就出现了。没有安装程序，没有授权码，也没有 PayPal。"
                }
            ]
        }
    },
    "vlc": {
        "de": {
            "title": "Dashcam-GPS anzeigen, das VLC nicht darstellen kann — kostenlos, im Browser | dashcamigo",
            "metaDescription": "VLC spielt Dashcam-Videos ab, zeigt aber weder GPS noch Karte. dashcamigo ergänzt GPS-Karte, Geschwindigkeits-Diagramm und Mehrkanal-Ansicht — kostenlos, im Browser.",
            "ogTitle": "Dashcam-GPS-Karte für Aufnahmen, die VLC nicht lesen kann",
            "ogDescription": "VLC ist ein großartiger universeller Player, aber er hat kein Dashcam-GPS, keine Karte und keine Geschwindigkeitsanzeige. dashcamigo liest die Telemetrie aus und zeigt sie an — kostenlos, im Browser.",
            "h1": "VLC spielt das Video ab — dashcamigo ergänzt die GPS-Karte, die VLC nicht anzeigen kann",
            "lead": "VLC öffnet bereitwillig jede Dashcam-Datei, aber beim Bild ist Schluss: keine GPS-Karte, keine Geschwindigkeit oder G-Kraft, keine Front/Heck-Synchronisation. Diese Telemetrie steckt in deinen Aufnahmen — dashcamigo liest sie aus und zeichnet eine Live-Karte und ein Diagramm neben dem Video, kostenlos und im Browser. Behalte VLC für alles andere; nimm dashcamigo, wenn die Aufnahmen ihr GPS brauchen.",
            "cardHint": "Ein großartiger universeller Player — aber er zeigt kein Dashcam-GPS",
            "whatItIs": "VLC vom gemeinnützigen VideoLAN ist der universelle Mediaplayer — kostenlos, quelloffen und in der Lage, praktisch jedes Video auf praktisch jedem Betriebssystem abzuspielen, Smartphones inklusive. Für Dashcam-Clips macht ihn das zu einer zuverlässigen Möglichkeit, einfach das Bild anzuschauen. Was er bewusst nicht tut: Dashcam-Telemetrie verstehen. Er hat keine GPS-Karte, keine Geschwindigkeits- oder G-Kraft-Anzeige, keine Mehrkanal-Synchronisation, und er fasst eine Karte voller Clips nicht zu einer Fahrt zusammen. Die einzige Möglichkeit, eine Standort- oder Geschwindigkeitsanzeige \"über\" VLC zu bekommen, ist, zuerst mit einem anderen Tool eine externe Untertiteldatei zu erzeugen — eine flache Texteinblendung, keine interaktive Karte.",
            "comparisonIntro": "VLC und dashcamigo sind nicht wirklich Konkurrenten — VLC spielt das Video ab, dashcamigo legt die Dashcam-Ebene obendrauf. So teilt sich das auf.",
            "compareRows": [
                {
                    "dimension": "Spielt das Video ab",
                    "us": {
                        "mark": "yes",
                        "note": "Ja"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Spielt praktisch jedes Format ab"
                    }
                },
                {
                    "dimension": "GPS-Route auf einer Karte",
                    "us": {
                        "mark": "yes",
                        "note": "Live, synchronisiert"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Keine Karte"
                    }
                },
                {
                    "dimension": "Geschwindigkeits- & G-Kraft-Diagramm",
                    "us": {
                        "mark": "yes",
                        "note": "Ja"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Nein"
                    }
                },
                {
                    "dimension": "Liest eingebettetes Dashcam-GPS",
                    "us": {
                        "mark": "yes",
                        "note": "Automatisch"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Nur über einen externen Untertitel aus einem anderen Tool"
                    }
                },
                {
                    "dimension": "Front/Heck/Innenraum synchron",
                    "us": {
                        "mark": "yes",
                        "note": "3-Kanal-Raster"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Ein Stream nach dem anderen"
                    }
                },
                {
                    "dimension": "Fasst Clips zu Fahrten zusammen",
                    "us": {
                        "mark": "yes",
                        "note": "Ja"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Nur Playlist"
                    }
                },
                {
                    "dimension": "Clip mit GPS schneiden & exportieren",
                    "us": {
                        "mark": "yes",
                        "note": "Ja"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Kein Telemetrie-Export"
                    }
                },
                {
                    "dimension": "Preis",
                    "us": {
                        "mark": "yes",
                        "note": "Kostenlos & quelloffen"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Kostenlos & quelloffen"
                    }
                }
            ],
            "whenStayTitle": "Nutze VLC weiterhin für",
            "whenStay": "VLC ist das bessere Tool, wann immer du einfach nur eine Datei abspielen musst: Er ist quelloffen, läuft auf jedem Betriebssystem und öffnet Formate und Codecs, die sonst nichts öffnet. dashcamigo versucht gar nicht, ihn als allgemeinen Player zu ersetzen — es ist der dashcam-fähige Begleiter, der das GPS, die Geschwindigkeit und die G-Kraft ausliest, die VLC ignoriert. Viele Leute nutzen beides: VLC, um einen Clip kurz anzuschauen, dashcamigo, um eine ganze Fahrt mit ihrer Karte durchzugehen.",
            "ctaPrimary": "Deine Aufnahmen öffnen",
            "faq": [
                {
                    "q": "Kann VLC das GPS, die Geschwindigkeit oder die Route meiner Dashcam anzeigen?",
                    "a": "Nein. VLC spielt das Video ab, hat aber keine eingebaute GPS-Karte, keine Geschwindigkeitsanzeige und keine Telemetrie-Einblendung. Der einzige Umweg besteht darin, mit separater Software eine Untertiteldatei (.srt) zu erstellen und sie als Text einzublenden — eine interaktive Karte gibt es nicht. dashcamigo liest das eingebettete GPS direkt aus und zeigt eine Live-Karte und ein Geschwindigkeits-/G-Kraft-Diagramm synchron zur Wiedergabe an."
                },
                {
                    "q": "Muss ich aufhören, VLC zu nutzen?",
                    "a": "Überhaupt nicht — sie erledigen unterschiedliche Aufgaben. VLC ist der beste universelle Player; dashcamigo ist der dashcam-fähige Viewer. Nutze VLC für die allgemeine Wiedergabe und dashcamigo, wenn du die Route, Geschwindigkeit und Mehrkanal-Ansicht willst."
                },
                {
                    "q": "Ist dashcamigo kostenlos und privat wie VLC?",
                    "a": "Ja. dashcamigo ist kostenlos, ohne Konto, quelloffen unter der AGPL-3.0 und hat keinen Server für deine Aufnahmen — dein Browser liest die Dateien direkt von deinem Gerät; nichts wird hochgeladen. VLC ist ebenfalls kostenlos, quelloffen und lokal; in diesen Punkten sind sie gleichauf."
                },
                {
                    "q": "Von welchen Dashcams liest dashcamigo das GPS aus?",
                    "a": "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware und weitere — alles, was sein GPS in das MP4, MOV oder MPEG-TS in einem Format schreibt, das dashcamigo erkennt. VLC ist bei der Wiedergabe markenunabhängig, liest aber nichts von dieser Telemetrie."
                },
                {
                    "q": "Funktioniert es in meinem Browser, ohne dass ich etwas installiere?",
                    "a": "Ja — öffne dashcamigo.app und zieh deinen SD-Karten-Ordner hinein. Nichts zu installieren. VLC dagegen ist eine App, die du installierst (auch wenn sie auf fast jeder Plattform läuft)."
                }
            ]
        },
        "es": {
            "title": "Ver el GPS de la dashcam que VLC no puede mostrar — gratis, en tu navegador | dashcamigo",
            "metaDescription": "VLC reproduce el vídeo de dashcam pero no muestra GPS, velocidad ni mapa. dashcamigo añade el mapa GPS, el gráfico de velocidad y fuerza G y la vista multicanal — gratis, en tu navegador.",
            "ogTitle": "Mapa GPS de dashcam para grabaciones que VLC no lee",
            "ogDescription": "VLC es un gran reproductor universal, pero no tiene GPS de dashcam, mapa ni capa de velocidad. dashcamigo lee la telemetría y la muestra — gratis, en el navegador.",
            "h1": "VLC reproduce el vídeo — dashcamigo añade el mapa GPS que VLC no puede mostrar",
            "lead": "VLC abrirá encantado cualquier archivo de dashcam, pero se queda en la imagen: ni mapa GPS, ni velocidad o fuerza G, ni sincronización frontal/trasera. Esa telemetría está dentro de tus grabaciones — dashcamigo la lee y dibuja un mapa y un gráfico en vivo junto al vídeo, gratis y en tu navegador. Quédate con VLC para todo lo demás; usa dashcamigo cuando la grabación necesite su GPS.",
            "cardHint": "Un gran reproductor universal — pero no muestra el GPS de la dashcam",
            "whatItIs": "VLC, de la organización sin ánimo de lucro VideoLAN, es el reproductor multimedia universal — gratuito, de código abierto y capaz de reproducir prácticamente cualquier vídeo en prácticamente cualquier sistema operativo, teléfonos incluidos. Para los clips de dashcam, eso lo convierte en una forma fiable de simplemente ver la imagen. Lo que deliberadamente no hace es entender la telemetría de la dashcam: no tiene mapa GPS, ni lectura de velocidad o fuerza G, ni sincronización multicanal, y no agrupará una tarjeta llena de clips en un trayecto. La única forma de conseguir una marca de ubicación o velocidad \"a través de\" VLC es generar primero un archivo de subtítulos externo con otra herramienta — una capa de texto plano, no un mapa interactivo.",
            "comparisonIntro": "VLC y dashcamigo no son realmente rivales — VLC reproduce el vídeo, dashcamigo añade la capa de dashcam por encima. Así se reparten el trabajo.",
            "compareRows": [
                {
                    "dimension": "Reproduce el vídeo",
                    "us": {
                        "mark": "yes",
                        "note": "Sí"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Reproduce prácticamente cualquier formato"
                    }
                },
                {
                    "dimension": "Ruta GPS en un mapa",
                    "us": {
                        "mark": "yes",
                        "note": "En vivo, sincronizada"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Sin mapa"
                    }
                },
                {
                    "dimension": "Gráfico de velocidad y fuerza G",
                    "us": {
                        "mark": "yes",
                        "note": "Sí"
                    },
                    "them": {
                        "mark": "no",
                        "note": "No"
                    }
                },
                {
                    "dimension": "Lee el GPS integrado de la dashcam",
                    "us": {
                        "mark": "yes",
                        "note": "Automáticamente"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Solo mediante un subtítulo externo de otra herramienta"
                    }
                },
                {
                    "dimension": "Frontal/trasero/interior sincronizados",
                    "us": {
                        "mark": "yes",
                        "note": "Rejilla de 3 canales"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Una transmisión a la vez"
                    }
                },
                {
                    "dimension": "Agrupa los clips en trayectos",
                    "us": {
                        "mark": "yes",
                        "note": "Sí"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Solo lista de reproducción"
                    }
                },
                {
                    "dimension": "Recortar y exportar un clip con GPS",
                    "us": {
                        "mark": "yes",
                        "note": "Sí"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Sin exportación de telemetría"
                    }
                },
                {
                    "dimension": "Precio",
                    "us": {
                        "mark": "yes",
                        "note": "Gratis y de código abierto"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Gratis y de código abierto"
                    }
                }
            ],
            "whenStayTitle": "Sigue usando VLC para",
            "whenStay": "VLC es la mejor herramienta siempre que solo necesites reproducir un archivo: es de código abierto, funciona en cualquier sistema operativo y abre formatos y códecs que ninguna otra cosa abrirá. dashcamigo no intenta sustituirlo como reproductor general — es el compañero especializado en dashcam que lee el GPS, la velocidad y la fuerza G que VLC ignora. Mucha gente usa ambos: VLC para echar un vistazo a un clip, dashcamigo para revisar un trayecto entero con su mapa.",
            "ctaPrimary": "Abre tus grabaciones",
            "faq": [
                {
                    "q": "¿Puede VLC mostrar el GPS, la velocidad o la ruta de mi dashcam?",
                    "a": "No. VLC reproduce el vídeo pero no tiene mapa GPS integrado, indicador de velocidad ni capa de telemetría. La única solución alternativa es crear un archivo de subtítulos (.srt) con un programa aparte y superponerlo como texto — no hay mapa interactivo. dashcamigo lee el GPS integrado directamente y muestra un mapa en vivo y un gráfico de velocidad/fuerza G sincronizado con la reproducción."
                },
                {
                    "q": "¿Tengo que dejar de usar VLC?",
                    "a": "En absoluto — hacen trabajos distintos. VLC es el mejor reproductor universal; dashcamigo es el visor especializado en dashcam. Usa VLC para la reproducción general y dashcamigo cuando quieras la ruta, la velocidad y la vista multicanal."
                },
                {
                    "q": "¿Es dashcamigo gratuito y privado como VLC?",
                    "a": "Sí. dashcamigo es gratis, sin cuenta, de código abierto bajo la licencia AGPL-3.0, y no tiene servidor — tu navegador lee los archivos directamente desde tu dispositivo; no se sube nada. VLC también es gratuito, de código abierto y local; en esos puntos están a la par."
                },
                {
                    "q": "¿De qué dashcams lee el GPS dashcamigo?",
                    "a": "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware y más — cualquiera que escriba su GPS en el MP4, MOV o MPEG-TS en un formato que dashcamigo reconozca. VLC es indiferente a la marca para la reproducción, pero no lee nada de esta telemetría."
                },
                {
                    "q": "¿Funciona en mi navegador sin instalar nada?",
                    "a": "Sí — abre dashcamigo.app y suelta la carpeta de tu tarjeta SD. Nada que instalar. VLC, en cambio, es una aplicación que instalas (aunque funciona en casi todas las plataformas)."
                }
            ]
        },
        "fr": {
            "title": "Voir le GPS de dashcam que VLC ne peut pas afficher — gratuit, dans votre navigateur | dashcamigo",
            "metaDescription": "VLC lit la vidéo de dashcam mais n'affiche ni GPS, ni vitesse, ni carte. dashcamigo ajoute la carte GPS, la courbe de vitesse et de force G et la vue multicanal — gratuit, dans votre navigateur.",
            "ogTitle": "Carte GPS de dashcam pour les images que VLC ne sait pas lire",
            "ogDescription": "VLC est un excellent lecteur universel, mais il n'a ni GPS, ni carte, ni surimpression de vitesse pour la dashcam. dashcamigo lit la télémétrie et l'affiche — gratuit, dans le navigateur.",
            "h1": "VLC lit la vidéo — dashcamigo ajoute la carte GPS que VLC ne peut pas afficher",
            "lead": "VLC ouvrira sans problème n'importe quel fichier de dashcam, mais il s'arrête à l'image : pas de carte GPS, pas de vitesse ni de force G, pas de synchro avant/arrière. Cette télémétrie est pourtant à l'intérieur de vos enregistrements — dashcamigo la lit et trace une carte et une courbe en direct à côté de la vidéo, gratuitement et dans votre navigateur. Gardez VLC pour tout le reste ; utilisez dashcamigo quand les images ont besoin de leur GPS.",
            "cardHint": "Un excellent lecteur universel — mais il n'affiche aucun GPS de dashcam",
            "whatItIs": "VLC, signé par l'association à but non lucratif VideoLAN, est le lecteur multimédia universel — gratuit, open source, et capable de lire pratiquement n'importe quelle vidéo sur pratiquement n'importe quel système d'exploitation, téléphones inclus. Pour les clips de dashcam, c'est donc un moyen fiable de simplement regarder l'image. Ce qu'il ne fait délibérément pas, c'est comprendre la télémétrie de dashcam : il n'a pas de carte GPS, pas d'affichage de vitesse ni de force G, pas de synchro multicanal, et il ne regroupe pas une carte pleine de clips en un trajet. Le seul moyen d'obtenir un repère de position ou de vitesse \"à travers\" VLC est de générer d'abord un fichier de sous-titres externe avec un autre outil — une surimpression de texte plat, pas une carte interactive.",
            "comparisonIntro": "VLC et dashcamigo ne sont pas vraiment des rivaux — VLC lit la vidéo, dashcamigo ajoute la couche dashcam par-dessus. Voici le partage des rôles.",
            "compareRows": [
                {
                    "dimension": "Lit la vidéo",
                    "us": {
                        "mark": "yes",
                        "note": "Oui"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Lit pratiquement n'importe quel format"
                    }
                },
                {
                    "dimension": "Itinéraire GPS sur une carte",
                    "us": {
                        "mark": "yes",
                        "note": "En direct, synchronisé"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Pas de carte"
                    }
                },
                {
                    "dimension": "Courbe de vitesse et de force G",
                    "us": {
                        "mark": "yes",
                        "note": "Oui"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Non"
                    }
                },
                {
                    "dimension": "Lit le GPS de dashcam intégré",
                    "us": {
                        "mark": "yes",
                        "note": "Automatiquement"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Uniquement via un sous-titre externe créé par un autre outil"
                    }
                },
                {
                    "dimension": "Avant/arrière/habitacle en synchro",
                    "us": {
                        "mark": "yes",
                        "note": "Grille à 3 canaux"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Un flux à la fois"
                    }
                },
                {
                    "dimension": "Regroupe les clips en trajets",
                    "us": {
                        "mark": "yes",
                        "note": "Oui"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Liste de lecture uniquement"
                    }
                },
                {
                    "dimension": "Découpe et export d'un clip avec GPS",
                    "us": {
                        "mark": "yes",
                        "note": "Oui"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Pas d'export de télémétrie"
                    }
                },
                {
                    "dimension": "Prix",
                    "us": {
                        "mark": "yes",
                        "note": "Gratuit et open source"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Gratuit et open source"
                    }
                }
            ],
            "whenStayTitle": "Continuez à utiliser VLC pour",
            "whenStay": "VLC est le meilleur outil dès qu'il s'agit simplement de lire un fichier : il est open source, tourne sur tous les OS, et ouvre des formats et des codecs que rien d'autre ne prend en charge. dashcamigo ne cherche pas à le remplacer comme lecteur généraliste — c'est le compagnon spécialisé dashcam qui lit le GPS, la vitesse et la force G que VLC ignore. Beaucoup de gens utilisent les deux : VLC pour jeter un œil à un clip, dashcamigo pour revoir tout un trajet avec sa carte.",
            "ctaPrimary": "Ouvrir vos enregistrements",
            "faq": [
                {
                    "q": "VLC peut-il afficher le GPS, la vitesse ou l'itinéraire de ma dashcam ?",
                    "a": "Non. VLC lit la vidéo mais n'a ni carte GPS intégrée, ni indicateur de vitesse, ni surimpression de télémétrie. La seule solution de contournement est de créer un fichier de sous-titres (.srt) avec un logiciel séparé et de l'afficher sous forme de texte — il n'y a pas de carte interactive. dashcamigo lit directement le GPS intégré et affiche une carte en direct et une courbe vitesse/force G synchronisée avec la lecture."
                },
                {
                    "q": "Dois-je arrêter d'utiliser VLC ?",
                    "a": "Pas du tout — ils font des choses différentes. VLC est le meilleur lecteur universel ; dashcamigo est le lecteur spécialisé dashcam. Utilisez VLC pour la lecture générale et dashcamigo quand vous voulez l'itinéraire, la vitesse et la vue multicanal."
                },
                {
                    "q": "dashcamigo est-il gratuit et privé comme VLC ?",
                    "a": "Oui. dashcamigo est gratuit, sans compte, open source sous licence AGPL-3.0, et il n'a pas de serveur — votre navigateur lit les fichiers directement sur votre appareil ; rien n'est téléversé. VLC est lui aussi gratuit, open source et local ; sur ces points, ils sont à égalité."
                },
                {
                    "q": "De quelles dashcams dashcamigo lit-il le GPS ?",
                    "a": "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware et d'autres — tout ce qui écrit son GPS dans le MP4, le MOV ou le MPEG-TS dans un format que dashcamigo reconnaît. VLC est indifférent à la marque pour la lecture, mais ne lit rien de cette télémétrie."
                },
                {
                    "q": "Fonctionne-t-il dans mon navigateur sans rien installer ?",
                    "a": "Oui — ouvrez dashcamigo.app et déposez le dossier de votre carte SD. Rien à installer. VLC, à l'inverse, est une application que l'on installe (même si elle tourne sur presque toutes les plateformes)."
                }
            ]
        },
        "ja": {
            "title": "VLCでは見られないドラレコのGPSを表示 — 無料、ブラウザで | dashcamigo",
            "metaDescription": "VLCはドラレコ映像を再生しますが、GPS・速度・マップは表示しません。dashcamigoはGPSマップ、速度＆Gフォースのグラフ、マルチチャンネル表示を追加 — 無料、ブラウザで。",
            "ogTitle": "VLCが読めない映像のためのドラレコGPSマップ",
            "ogDescription": "VLCは優れた万能プレーヤーですが、ドラレコのGPS・マップ・速度オーバーレイはありません。dashcamigoはテレメトリを読み取って表示します — 無料、ブラウザで。",
            "h1": "VLCは映像を再生する — dashcamigoはVLCが出せないGPSマップを足す",
            "lead": "VLCはどんなドラレコファイルでも喜んで開きますが、絵で止まります — GPSマップなし、速度やGフォースなし、フロント/リアの同期なし。そのテレメトリはあなたの録画の中にあります — dashcamigoがそれを読み取り、映像の隣にライブのマップとグラフを描きます。無料で、ブラウザで。それ以外はVLCを使い続け、映像にそのGPSが必要なときにdashcamigoを使ってください。",
            "cardHint": "優れた万能プレーヤー — でもドラレコのGPSは表示しない",
            "whatItIs": "非営利のVideoLANによるVLCは万能メディアプレーヤーです — 無料、オープンソースで、ほぼあらゆるOS（スマホ含む）でほぼあらゆる動画を再生できます。ドラレコのクリップにとっては、これは絵をただ見るための信頼できる手段になります。あえてやらないのは、ドラレコのテレメトリを理解することです — GPSマップなし、速度やGフォースの表示なし、マルチチャンネルの同期なし、カードいっぱいのクリップを1つの走行にまとめることもしません。VLC「を通して」位置や速度のスタンプを得る唯一の方法は、まず別のツールで外部の字幕ファイルを生成することです — それはフラットなテキストオーバーレイであって、インタラクティブなマップではありません。",
            "comparisonIntro": "VLCとdashcamigoは実はライバルではありません — VLCが映像を再生し、dashcamigoがその上にドラレコの層を足します。住み分けはこうです。",
            "compareRows": [
                {
                    "dimension": "映像を再生する",
                    "us": {
                        "mark": "yes",
                        "note": "あり"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "事実上あらゆる形式を再生"
                    }
                },
                {
                    "dimension": "マップ上のGPSルート",
                    "us": {
                        "mark": "yes",
                        "note": "ライブ、同期"
                    },
                    "them": {
                        "mark": "no",
                        "note": "マップなし"
                    }
                },
                {
                    "dimension": "速度とGフォースのグラフ",
                    "us": {
                        "mark": "yes",
                        "note": "あり"
                    },
                    "them": {
                        "mark": "no",
                        "note": "なし"
                    }
                },
                {
                    "dimension": "埋め込みのドラレコGPSを読む",
                    "us": {
                        "mark": "yes",
                        "note": "自動で"
                    },
                    "them": {
                        "mark": "no",
                        "note": "別ツールが作る外部字幕経由のみ"
                    }
                },
                {
                    "dimension": "フロント/リア/室内を同期",
                    "us": {
                        "mark": "yes",
                        "note": "3チャンネルのグリッド"
                    },
                    "them": {
                        "mark": "no",
                        "note": "一度に1ストリームのみ"
                    }
                },
                {
                    "dimension": "クリップを走行にまとめる",
                    "us": {
                        "mark": "yes",
                        "note": "あり"
                    },
                    "them": {
                        "mark": "no",
                        "note": "プレイリストのみ"
                    }
                },
                {
                    "dimension": "GPS付きでクリップをトリミング・エクスポート",
                    "us": {
                        "mark": "yes",
                        "note": "あり"
                    },
                    "them": {
                        "mark": "no",
                        "note": "テレメトリのエクスポートなし"
                    }
                },
                {
                    "dimension": "価格",
                    "us": {
                        "mark": "yes",
                        "note": "無料＆オープンソース"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "無料＆オープンソース"
                    }
                }
            ],
            "whenStayTitle": "VLCを使い続けるべき場面",
            "whenStay": "ファイルをただ再生したいときは、VLCの方が良いツールです — オープンソースで、あらゆるOSで動き、ほかでは開けない形式やコーデックも開きます。dashcamigoは汎用プレーヤーとしてVLCを置き換えようとはしません — VLCが無視するGPS・速度・Gフォースを読み取る、ドラレコ対応の相棒です。両方を使う人はたくさんいます — クリップをちらっと見るならVLC、マップ付きで走行まるごとを見直すならdashcamigo。",
            "ctaPrimary": "録画を開く",
            "faq": [
                {
                    "q": "VLCで私のドラレコのGPS、速度、ルートを表示できますか？",
                    "a": "いいえ。VLCは映像を再生しますが、内蔵のGPSマップ、速度メーター、テレメトリオーバーレイはありません。唯一の回避策は、別のソフトで字幕（.srt）ファイルを作り、それをテキストとして重ねることです — インタラクティブなマップはありません。dashcamigoは埋め込みのGPSを直接読み取り、再生に同期したライブマップと速度/Gフォースのグラフを表示します。"
                },
                {
                    "q": "VLCの使用をやめないといけませんか？",
                    "a": "まったく必要ありません — 役割が違います。VLCは最高の万能プレーヤー、dashcamigoはドラレコ対応のビューアです。一般的な再生にはVLCを、ルート・速度・マルチチャンネル表示が欲しいときにはdashcamigoを使ってください。"
                },
                {
                    "q": "dashcamigoはVLCのように無料でプライベートですか？",
                    "a": "はい。dashcamigoはアカウント不要で無料、AGPL-3.0のオープンソースで、録画を受け取るサーバーはありません — ブラウザがデバイス上のファイルを直接読み取るため、何もアップロードされません。VLCも無料、オープンソースで、ローカルです。その点では互角です。"
                },
                {
                    "q": "dashcamigoはどのドラレコからGPSを読み取れますか？",
                    "a": "70mai、Viofo、BlackVue、GoPro、Garmin、Vantrue、Thinkwareなど — dashcamigoが認識する形式でMP4、MOV、MPEG-TSにGPSを書き込むものなら何でも。VLCは再生についてはブランドを問いませんが、このテレメトリはまったく読みません。"
                },
                {
                    "q": "何もインストールせずにブラウザで動きますか？",
                    "a": "はい — dashcamigo.appを開いてSDカードのフォルダーをドロップするだけ。インストール不要です。一方VLCはインストールが必要なアプリです（ほぼあらゆるプラットフォームで動きますが）。"
                }
            ]
        },
        "ko": {
            "title": "VLC가 못 보여주는 블랙박스 GPS 보기 — 무료, 브라우저에서 | dashcamigo",
            "metaDescription": "VLC는 블랙박스 영상을 재생하지만 GPS, 속도, 지도는 보여주지 못합니다. dashcamigo가 GPS 지도, 속도·G 포스 차트, 다채널 뷰를 더합니다 — 무료, 브라우저에서.",
            "ogTitle": "VLC가 못 읽는 영상의 블랙박스 GPS 지도",
            "ogDescription": "VLC는 훌륭한 만능 플레이어지만 블랙박스 GPS, 지도, 속도 오버레이가 없습니다. dashcamigo는 그 텔레메트리를 읽어 보여줍니다 — 무료, 브라우저에서.",
            "h1": "VLC는 영상을 재생하고 — dashcamigo는 VLC가 못 보여주는 GPS 지도를 더합니다",
            "lead": "VLC는 어떤 블랙박스 파일이든 척척 열지만 화면까지가 끝입니다 — GPS 지도도, 속도나 G 포스도, 전방/후방 동기화도 없습니다. 그 텔레메트리는 녹화 영상 안에 들어 있습니다 — dashcamigo가 그것을 읽어 영상 옆에 실시간 지도와 차트를 그려 줍니다. 무료로, 브라우저에서요. 나머지는 VLC로 계속 쓰세요. 영상에 GPS가 필요할 때 dashcamigo를 쓰면 됩니다.",
            "cardHint": "훌륭한 만능 플레이어 — 하지만 블랙박스 GPS는 보여주지 못함",
            "whatItIs": "비영리 단체 VideoLAN이 만든 VLC는 만능 미디어 플레이어입니다 — 무료, 오픈소스이며 휴대폰을 포함해 사실상 모든 운영체제에서 사실상 모든 영상을 재생할 수 있습니다. 블랙박스 클립이라면 그저 화면을 보기에 믿음직한 수단이 되죠. VLC가 의도적으로 하지 않는 것은 블랙박스 텔레메트리를 이해하는 일입니다 — GPS 지도도, 속도나 G 포스 표시도, 다채널 동기화도 없고, 카드 가득한 클립을 하나의 주행으로 묶어 주지도 않습니다. VLC \"를 통해\" 위치나 속도 표시를 얻는 유일한 방법은 다른 도구로 먼저 외부 자막 파일을 만드는 것뿐인데, 그것은 인터랙티브 지도가 아니라 평면 텍스트 오버레이입니다.",
            "comparisonIntro": "VLC와 dashcamigo는 사실 경쟁 관계가 아닙니다 — VLC는 영상을 재생하고, dashcamigo는 그 위에 블랙박스 레이어를 더합니다. 역할이 이렇게 나뉩니다.",
            "compareRows": [
                {
                    "dimension": "영상 재생",
                    "us": {
                        "mark": "yes",
                        "note": "있음"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "거의 모든 포맷 재생"
                    }
                },
                {
                    "dimension": "지도 위 GPS 경로",
                    "us": {
                        "mark": "yes",
                        "note": "실시간, 동기화"
                    },
                    "them": {
                        "mark": "no",
                        "note": "지도 없음"
                    }
                },
                {
                    "dimension": "속도와 G 포스 차트",
                    "us": {
                        "mark": "yes",
                        "note": "있음"
                    },
                    "them": {
                        "mark": "no",
                        "note": "없음"
                    }
                },
                {
                    "dimension": "내장 블랙박스 GPS 읽기",
                    "us": {
                        "mark": "yes",
                        "note": "자동으로"
                    },
                    "them": {
                        "mark": "no",
                        "note": "다른 도구로 만든 외부 자막을 통해서만"
                    }
                },
                {
                    "dimension": "전방/후방/실내 동기화",
                    "us": {
                        "mark": "yes",
                        "note": "3채널 그리드"
                    },
                    "them": {
                        "mark": "no",
                        "note": "한 번에 한 스트림"
                    }
                },
                {
                    "dimension": "클립을 주행으로 묶기",
                    "us": {
                        "mark": "yes",
                        "note": "있음"
                    },
                    "them": {
                        "mark": "no",
                        "note": "재생목록뿐"
                    }
                },
                {
                    "dimension": "GPS 포함 클립 잘라내기·내보내기",
                    "us": {
                        "mark": "yes",
                        "note": "있음"
                    },
                    "them": {
                        "mark": "no",
                        "note": "텔레메트리 내보내기 없음"
                    }
                },
                {
                    "dimension": "가격",
                    "us": {
                        "mark": "yes",
                        "note": "무료·오픈소스"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "무료·오픈소스"
                    }
                }
            ],
            "whenStayTitle": "VLC를 계속 쓰면 좋은 경우",
            "whenStay": "그냥 파일을 재생해야 할 때라면 언제나 VLC가 더 나은 도구입니다 — 오픈소스이고, 모든 OS에서 돌아가며, 다른 무엇도 열지 못하는 포맷과 코덱을 엽니다. dashcamigo는 범용 플레이어로서 VLC를 대체하려 하지 않습니다 — VLC가 무시하는 GPS, 속도, G 포스를 읽어 주는 블랙박스 전용 동반자입니다. 많은 사람이 둘 다 씁니다 — 클립을 흘긋 볼 때는 VLC, 지도와 함께 주행 전체를 살펴볼 때는 dashcamigo요.",
            "ctaPrimary": "내 녹화 영상 열기",
            "faq": [
                {
                    "q": "VLC가 제 블랙박스의 GPS, 속도, 경로를 보여줄 수 있나요?",
                    "a": "아니요. VLC는 영상을 재생하지만 내장 GPS 지도, 속도계, 텔레메트리 오버레이가 없습니다. 유일한 우회 방법은 별도 소프트웨어로 자막(.srt) 파일을 만들어 텍스트로 덧입히는 것뿐인데 — 인터랙티브 지도는 없습니다. dashcamigo는 내장 GPS를 직접 읽어 재생과 동기화된 실시간 지도와 속도/G 포스 차트를 보여줍니다."
                },
                {
                    "q": "VLC를 그만 써야 하나요?",
                    "a": "전혀요 — 둘은 하는 일이 다릅니다. VLC는 최고의 만능 플레이어이고, dashcamigo는 블랙박스 전용 뷰어입니다. 일반 재생에는 VLC를, 경로·속도·다채널 뷰가 필요할 때는 dashcamigo를 쓰세요."
                },
                {
                    "q": "dashcamigo는 VLC처럼 무료이고 프라이버시를 지키나요?",
                    "a": "네. dashcamigo는 계정 없이 무료이고 AGPL-3.0 오픈소스이며 녹화 영상을 받을 서버가 없습니다 — 브라우저가 기기의 파일을 직접 읽어서 아무것도 업로드되지 않습니다. VLC 역시 무료, 오픈소스, 로컬입니다. 그 점에서는 둘이 대등합니다."
                },
                {
                    "q": "dashcamigo는 어떤 블랙박스에서 GPS를 읽나요?",
                    "a": "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware 등 — GPS를 MP4, MOV, MPEG-TS 안에 dashcamigo가 인식하는 형식으로 기록하는 것이라면 무엇이든요. VLC는 재생에서는 브랜드를 가리지 않지만 이 텔레메트리는 전혀 읽지 못합니다."
                },
                {
                    "q": "아무것도 설치하지 않고 제 브라우저에서 작동하나요?",
                    "a": "네 — dashcamigo.app을 열고 SD 카드 폴더를 끌어다 놓으면 됩니다. 설치할 것이 없습니다. 반면 VLC는 설치하는 앱입니다(거의 모든 플랫폼에서 돌아가긴 하지만요)."
                }
            ]
        },
        "pl": {
            "title": "Zobacz GPS z kamery, którego VLC nie pokaże — za darmo, w przeglądarce | dashcamigo",
            "metaDescription": "VLC odtwarza wideo z kamery samochodowej, ale nie pokazuje GPS, prędkości ani mapy. dashcamigo dodaje mapę GPS, wykres prędkości i przeciążeń oraz widok wielokanałowy — za darmo, w przeglądarce.",
            "ogTitle": "Mapa GPS z kamery dla nagrań, których VLC nie odczyta",
            "ogDescription": "VLC to świetny uniwersalny odtwarzacz, ale nie ma GPS, mapy ani nakładki prędkości z kamery. dashcamigo czyta telemetrię i ją pokazuje — za darmo, w przeglądarce.",
            "h1": "VLC odtwarza wideo — dashcamigo dodaje mapę GPS, której VLC nie pokaże",
            "lead": "VLC chętnie otworzy każdy plik z kamery samochodowej, ale kończy na obrazie: bez mapy GPS, bez prędkości i przeciążeń, bez synchronizacji przodu i tyłu. Ta telemetria siedzi w Twoich nagraniach — dashcamigo ją czyta i rysuje mapę na żywo oraz wykres obok wideo, za darmo i w przeglądarce. Zostaw VLC do wszystkiego innego; użyj dashcamigo, gdy nagranie potrzebuje swojego GPS.",
            "cardHint": "Świetny uniwersalny odtwarzacz — ale nie pokazuje GPS z kamery",
            "whatItIs": "VLC od organizacji non-profit VideoLAN to uniwersalny odtwarzacz multimediów — darmowy, otwartoźródłowy i zdolny odtworzyć praktycznie każde wideo na praktycznie każdym systemie operacyjnym, łącznie z telefonami. W przypadku klipów z kamery to niezawodny sposób, żeby po prostu obejrzeć obraz. Czego celowo nie robi, to rozumienia telemetrii kamery: nie ma mapy GPS, nie ma odczytu prędkości ani przeciążeń, nie ma synchronizacji wielu kanałów i nie pogrupuje karty pełnej klipów w jeden przejazd. Jedynym sposobem na uzyskanie znacznika lokalizacji lub prędkości \"przez\" VLC jest wcześniejsze wygenerowanie zewnętrznego pliku napisów innym narzędziem — płaskiej nakładki tekstowej, a nie interaktywnej mapy.",
            "comparisonIntro": "VLC i dashcamigo nie są tak naprawdę rywalami — VLC odtwarza wideo, a dashcamigo dokłada na wierzch warstwę kamery samochodowej. Oto jak dzielą się rolami.",
            "compareRows": [
                {
                    "dimension": "Odtwarza wideo",
                    "us": {
                        "mark": "yes",
                        "note": "Tak"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Odtwarza praktycznie każdy format"
                    }
                },
                {
                    "dimension": "Trasa GPS na mapie",
                    "us": {
                        "mark": "yes",
                        "note": "Na żywo, zsynchronizowana"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Brak mapy"
                    }
                },
                {
                    "dimension": "Wykres prędkości i przeciążeń",
                    "us": {
                        "mark": "yes",
                        "note": "Tak"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Nie"
                    }
                },
                {
                    "dimension": "Czyta wbudowany GPS kamery",
                    "us": {
                        "mark": "yes",
                        "note": "Automatycznie"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Tylko przez zewnętrzne napisy z innego narzędzia"
                    }
                },
                {
                    "dimension": "Przód/tył/wnętrze w synchronizacji",
                    "us": {
                        "mark": "yes",
                        "note": "Siatka 3 kanałów"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Jeden strumień naraz"
                    }
                },
                {
                    "dimension": "Grupuje klipy w przejazdy",
                    "us": {
                        "mark": "yes",
                        "note": "Tak"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Tylko playlista"
                    }
                },
                {
                    "dimension": "Przycina i eksportuje klip z GPS",
                    "us": {
                        "mark": "yes",
                        "note": "Tak"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Brak eksportu telemetrii"
                    }
                },
                {
                    "dimension": "Cena",
                    "us": {
                        "mark": "yes",
                        "note": "Za darmo i otwartoźródłowy"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Za darmo i otwartoźródłowy"
                    }
                }
            ],
            "whenStayTitle": "Zostaw VLC do",
            "whenStay": "VLC jest lepszym narzędziem zawsze, gdy musisz po prostu odtworzyć plik: jest otwartoźródłowy, działa na każdym systemie i otwiera formaty oraz kodeki, których nie weźmie nic innego. dashcamigo nie próbuje go zastąpić jako ogólnego odtwarzacza — to towarzysz zorientowany na kamerę samochodową, który czyta GPS, prędkość i przeciążenia ignorowane przez VLC. Wiele osób korzysta z obu: VLC, by zerknąć na klip, dashcamigo, by przeanalizować cały przejazd z mapą.",
            "ctaPrimary": "Otwórz swoje nagrania",
            "faq": [
                {
                    "q": "Czy VLC może pokazać GPS, prędkość lub trasę z mojej kamery?",
                    "a": "Nie. VLC odtwarza wideo, ale nie ma wbudowanej mapy GPS, wskaźnika prędkości ani nakładki telemetrii. Jedynym obejściem jest stworzenie pliku napisów (.srt) osobnym oprogramowaniem i nałożenie go jako tekstu — nie ma interaktywnej mapy. dashcamigo czyta wbudowany GPS bezpośrednio i pokazuje mapę na żywo oraz wykres prędkości/przeciążeń zsynchronizowany z odtwarzaniem."
                },
                {
                    "q": "Czy muszę przestać używać VLC?",
                    "a": "Wcale nie — robią różne rzeczy. VLC to najlepszy uniwersalny odtwarzacz; dashcamigo to przeglądarka zorientowana na kamerę samochodową. Używaj VLC do ogólnego odtwarzania, a dashcamigo, gdy chcesz trasę, prędkość i widok wielokanałowy."
                },
                {
                    "q": "Czy dashcamigo jest darmowe i prywatne jak VLC?",
                    "a": "Tak. dashcamigo jest darmowe, bez konta, otwartoźródłowe na licencji AGPL-3.0 i nie ma serwera, na który trafiałyby nagrania — przeglądarka odczytuje pliki bezpośrednio z twojego urządzenia; nic nie jest wysyłane. VLC też jest darmowy, otwartoźródłowy i lokalny; w tych punktach są na równi."
                },
                {
                    "q": "Z których kamer dashcamigo czyta GPS?",
                    "a": "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware i innych — wszystkiego, co zapisuje swój GPS w MP4, MOV lub MPEG-TS w formacie, który dashcamigo rozpoznaje. VLC jest niezależny od marki przy odtwarzaniu, ale nie czyta żadnej z tej telemetrii."
                },
                {
                    "q": "Czy działa w mojej przeglądarce bez instalowania czegokolwiek?",
                    "a": "Tak — otwórz dashcamigo.app i upuść folder z karty SD. Nic do zainstalowania. VLC natomiast to aplikacja, którą się instaluje (choć działa na niemal każdej platformie)."
                }
            ]
        },
        "pt": {
            "title": "Veja o GPS da dashcam que o VLC não mostra — grátis, no seu navegador | dashcamigo",
            "metaDescription": "O VLC reproduz vídeo de dashcam, mas não mostra GPS, velocidade nem mapa. O dashcamigo adiciona o mapa GPS, o gráfico de velocidade e força G e a visão multicanal — grátis, no seu navegador.",
            "ogTitle": "Mapa GPS de dashcam para filmagens que o VLC não lê",
            "ogDescription": "O VLC é um ótimo player universal, mas não tem GPS, mapa nem sobreposição de velocidade de dashcam. O dashcamigo lê a telemetria e a exibe — grátis, no navegador.",
            "h1": "O VLC reproduz o vídeo — o dashcamigo adiciona o mapa GPS que o VLC não mostra",
            "lead": "O VLC abre tranquilamente qualquer arquivo de dashcam, mas para na imagem: sem mapa GPS, sem velocidade ou força G, sem sincronia entre frente e traseira. Essa telemetria está dentro das suas gravações — o dashcamigo a lê e desenha um mapa e um gráfico ao vivo ao lado do vídeo, grátis e no seu navegador. Continue usando o VLC para todo o resto; use o dashcamigo quando a filmagem precisar do seu GPS.",
            "cardHint": "Um ótimo player universal — mas não mostra o GPS da dashcam",
            "whatItIs": "O VLC, da organização sem fins lucrativos VideoLAN, é o player de mídia universal — gratuito, de código aberto, e capaz de reproduzir praticamente qualquer vídeo em praticamente qualquer sistema operacional, celulares incluídos. Para clipes de dashcam, isso o torna uma forma confiável de simplesmente assistir à imagem. O que ele deliberadamente não faz é entender a telemetria da dashcam: não tem mapa GPS, não tem leitura de velocidade ou força G, não tem sincronia multicanal, e não agrupa um cartão cheio de clipes em uma viagem. A única forma de obter uma marcação de localização ou velocidade \"através\" do VLC é gerar antes um arquivo de legenda externo com outra ferramenta — uma sobreposição de texto plano, não um mapa interativo.",
            "comparisonIntro": "O VLC e o dashcamigo não são realmente rivais — o VLC reproduz o vídeo, o dashcamigo adiciona a camada de dashcam por cima. Veja como ficam os papéis.",
            "compareRows": [
                {
                    "dimension": "Reproduz o vídeo",
                    "us": {
                        "mark": "yes",
                        "note": "Sim"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Reproduz praticamente qualquer formato"
                    }
                },
                {
                    "dimension": "Rota GPS em um mapa",
                    "us": {
                        "mark": "yes",
                        "note": "Ao vivo, sincronizada"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Sem mapa"
                    }
                },
                {
                    "dimension": "Gráfico de velocidade e força G",
                    "us": {
                        "mark": "yes",
                        "note": "Sim"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Não"
                    }
                },
                {
                    "dimension": "Lê o GPS embutido da dashcam",
                    "us": {
                        "mark": "yes",
                        "note": "Automaticamente"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Apenas via uma legenda externa de outra ferramenta"
                    }
                },
                {
                    "dimension": "Frente/traseira/interior em sincronia",
                    "us": {
                        "mark": "yes",
                        "note": "Grade de 3 canais"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Um stream por vez"
                    }
                },
                {
                    "dimension": "Agrupa clipes em viagens",
                    "us": {
                        "mark": "yes",
                        "note": "Sim"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Apenas playlist"
                    }
                },
                {
                    "dimension": "Corte e exportação de um clipe com GPS",
                    "us": {
                        "mark": "yes",
                        "note": "Sim"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Sem exportação de telemetria"
                    }
                },
                {
                    "dimension": "Preço",
                    "us": {
                        "mark": "yes",
                        "note": "Grátis e de código aberto"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Grátis e de código aberto"
                    }
                }
            ],
            "whenStayTitle": "Continue usando o VLC para",
            "whenStay": "O VLC é a melhor ferramenta sempre que você só precisa reproduzir um arquivo: é de código aberto, roda em todos os sistemas operacionais, e abre formatos e codecs que mais nada abre. O dashcamigo não tenta substituí-lo como player geral — ele é o companheiro especializado em dashcam que lê o GPS, a velocidade e a força G que o VLC ignora. Muita gente usa os dois: o VLC para dar uma olhada num clipe, o dashcamigo para revisar uma viagem inteira com o seu mapa.",
            "ctaPrimary": "Abra suas gravações",
            "faq": [
                {
                    "q": "O VLC pode mostrar o GPS, a velocidade ou a rota da minha dashcam?",
                    "a": "Não. O VLC reproduz o vídeo, mas não tem mapa GPS integrado, medidor de velocidade nem sobreposição de telemetria. A única solução alternativa é criar um arquivo de legenda (.srt) com outro software e sobrepô-lo como texto — não há mapa interativo. O dashcamigo lê o GPS embutido diretamente e mostra um mapa ao vivo e um gráfico de velocidade/força G sincronizados com a reprodução."
                },
                {
                    "q": "Preciso parar de usar o VLC?",
                    "a": "De jeito nenhum — eles fazem trabalhos diferentes. O VLC é o melhor player universal; o dashcamigo é o visualizador especializado em dashcam. Use o VLC para reprodução geral e o dashcamigo quando quiser a rota, a velocidade e a visão multicanal."
                },
                {
                    "q": "O dashcamigo é gratuito e privado como o VLC?",
                    "a": "Sim. O dashcamigo é gratuito, sem conta, de código aberto sob a licença AGPL-3.0, e não tem servidor para receber suas gravações — seu navegador lê os arquivos direto do seu dispositivo; nada é enviado. O VLC também é gratuito, de código aberto e local; nesses pontos eles estão empatados."
                },
                {
                    "q": "De quais dashcams o dashcamigo lê o GPS?",
                    "a": "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware e mais — qualquer uma que grave o seu GPS dentro do MP4, MOV ou MPEG-TS em um formato que o dashcamigo reconheça. O VLC é agnóstico de marca para reprodução, mas não lê nada dessa telemetria."
                },
                {
                    "q": "Ele funciona no meu navegador sem instalar nada?",
                    "a": "Sim — abra o dashcamigo.app e solte a pasta do seu cartão SD. Nada para instalar. O VLC, por outro lado, é um app que você instala (embora rode em quase todas as plataformas)."
                }
            ]
        },
        "zh": {
            "title": "查看 VLC 显示不了的行车记录仪 GPS——免费，在浏览器里 | dashcamigo",
            "metaDescription": "VLC 能播放行车记录仪视频，但不显示 GPS、速度或地图。dashcamigo 补上 GPS 地图、速度与 G 力图表和多通道视图——免费，在浏览器里。",
            "ogTitle": "VLC 读不出的录像的行车记录仪 GPS 地图",
            "ogDescription": "VLC 是一款出色的通用播放器，但它没有行车记录仪 GPS、地图或速度叠加。dashcamigo 读取这份遥测数据并展示出来——免费，在浏览器里。",
            "h1": "VLC 负责播放视频——dashcamigo 补上 VLC 显示不了的 GPS 地图",
            "lead": "VLC 乐意打开任何行车记录仪文件，但它止步于画面：没有 GPS 地图，没有速度或 G 力，没有前后同步。那份遥测数据就藏在你的录像里——dashcamigo 读取它，并在视频旁边绘制实时地图和图表，免费且在浏览器里。其余事情继续用 VLC；当录像需要它的 GPS 时，用 dashcamigo。",
            "cardHint": "一款出色的通用播放器——但它不显示行车记录仪 GPS",
            "whatItIs": "VLC 由非营利组织 VideoLAN 开发，是通用媒体播放器——免费、开源，几乎能在任何操作系统上播放几乎任何视频，手机也包括在内。对于行车记录仪片段，这让它成为单纯看画面的可靠方式。它刻意不做的，是理解行车记录仪的遥测数据：它没有 GPS 地图，没有速度或 G 力读数，没有多通道同步，也不会把装满片段的整张卡归为一段行程。想要“通过”VLC 得到位置或速度标记，唯一的办法是先用别的工具生成一个外部字幕文件——那是一层扁平的文字叠加，而不是一张交互式地图。",
            "comparisonIntro": "VLC 和 dashcamigo 其实算不上对手——VLC 负责播放视频，dashcamigo 在上面叠加行车记录仪那一层。下面看看分工。",
            "compareRows": [
                {
                    "dimension": "播放视频",
                    "us": {
                        "mark": "yes",
                        "note": "有"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "几乎任何格式都能播"
                    }
                },
                {
                    "dimension": "地图上的 GPS 路线",
                    "us": {
                        "mark": "yes",
                        "note": "实时、同步"
                    },
                    "them": {
                        "mark": "no",
                        "note": "没有地图"
                    }
                },
                {
                    "dimension": "速度与 G 力图表",
                    "us": {
                        "mark": "yes",
                        "note": "有"
                    },
                    "them": {
                        "mark": "no",
                        "note": "没有"
                    }
                },
                {
                    "dimension": "读取内嵌的行车记录仪 GPS",
                    "us": {
                        "mark": "yes",
                        "note": "自动"
                    },
                    "them": {
                        "mark": "no",
                        "note": "只能靠另一个工具生成的外部字幕"
                    }
                },
                {
                    "dimension": "前/后/车内同步",
                    "us": {
                        "mark": "yes",
                        "note": "三通道网格"
                    },
                    "them": {
                        "mark": "no",
                        "note": "一次只能一路流"
                    }
                },
                {
                    "dimension": "把片段归为行程",
                    "us": {
                        "mark": "yes",
                        "note": "有"
                    },
                    "them": {
                        "mark": "no",
                        "note": "只有播放列表"
                    }
                },
                {
                    "dimension": "剪切并导出带 GPS 的片段",
                    "us": {
                        "mark": "yes",
                        "note": "有"
                    },
                    "them": {
                        "mark": "no",
                        "note": "不支持遥测数据导出"
                    }
                },
                {
                    "dimension": "价格",
                    "us": {
                        "mark": "yes",
                        "note": "免费且开源"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "免费且开源"
                    }
                }
            ],
            "whenStayTitle": "继续用 VLC 来做这些",
            "whenStay": "只要你需要单纯播放一个文件，VLC 就是更好的工具：它开源，能在每种操作系统上运行，还能打开别的软件打不开的格式和编解码器。dashcamigo 不试图取代它作为通用播放器——它是懂行车记录仪的搭档，读取 VLC 忽略的 GPS、速度和 G 力。很多人两个都用：用 VLC 瞄一眼片段，用 dashcamigo 配着地图回顾整段行程。",
            "ctaPrimary": "打开你的录像",
            "faq": [
                {
                    "q": "VLC 能显示我的行车记录仪 GPS、速度或路线吗？",
                    "a": "不能。VLC 播放视频，但没有内置的 GPS 地图、速度表或遥测叠加。唯一的变通办法是用单独的软件生成一个字幕（.srt）文件，再把它作为文字叠加上去——没有交互式地图。dashcamigo 直接读取内嵌的 GPS，并显示与播放同步的实时地图和速度/G 力图表。"
                },
                {
                    "q": "我必须不再用 VLC 吗？",
                    "a": "完全不用——它们做的是不同的事。VLC 是最好的通用播放器；dashcamigo 是懂行车记录仪的查看器。用 VLC 做一般播放，当你想要路线、速度和多通道视图时用 dashcamigo。"
                },
                {
                    "q": "dashcamigo 像 VLC 一样免费和私密吗？",
                    "a": "是的。dashcamigo 免费，无需账户，以 AGPL-3.0 开源，而且它没有用于接收录像的服务器——浏览器会直接读取你设备上的文件，什么都不会上传。VLC 也免费、开源且本地运行；在这些点上它们打平。"
                },
                {
                    "q": "dashcamigo 能读取哪些行车记录仪的 GPS？",
                    "a": "70mai、Viofo、BlackVue、GoPro、Garmin、Vantrue、Thinkware 等——凡是把 GPS 写进 MP4、MOV 或 MPEG-TS、且格式被 dashcamigo 识别的，都能读。VLC 播放时不在意品牌，但完全不读这份遥测数据。"
                },
                {
                    "q": "它能在我的浏览器里运行、无需安装任何东西吗？",
                    "a": "可以——打开 dashcamigo.app，拖入你的 SD 卡文件夹。无需安装。相比之下，VLC 是一款需要安装的应用（不过它几乎能在每个平台上运行）。"
                }
            ]
        }
    },
    "telemetry-overlay": {
        "de": {
            "title": "Telemetry Overlay-Alternative — kostenloses Dashcam-GPS-Overlay im Browser | dashcamigo",
            "metaDescription": "Kostenlose Browser-Alternative zu Telemetry Overlay — liest GPS von der Karte, zeigt eine Live-Karte, brennt ein Tempo-Overlay ein. Ohne Installation, ohne Lizenzgebühr.",
            "ogTitle": "Kostenlose Telemetry Overlay-Alternative für Dashcam-Aufnahmen",
            "ogDescription": "Telemetry Overlay ist ein kostenpflichtiges Desktop-Overlay-Tool. Für Dashcam-Aufnahmen liest dashcamigo das GPS und brennt ein Geschwindigkeits-/Karten-Overlay ein — kostenlos, im Browser.",
            "h1": "Eine kostenlose Alternative zu Telemetry Overlay im Browser — für Dashcam-Aufnahmen",
            "lead": "Telemetry Overlay ist ein leistungsstarkes, kostenpflichtiges Desktop-Tool, um Anzeigen auf Action-Cam-Videos zu brennen. Wenn deine Aufnahmen von einer Dashcam stammen und du einfach nur Route, Geschwindigkeit und G-Kraft sehen willst — und vielleicht ein einfaches Geschwindigkeits- und Karten-Overlay einbrennen — dann macht dashcamigo das kostenlos, in deinem Browser, und liest das GPS direkt von der Karte. Keine Lizenz, keine Installation. Für tiefgehende Anzeigen-Produktion ist Telemetry Overlay weiterhin das fähigere Tool.",
            "cardHint": "Kostenpflichtiges Desktop-Overlay-Tool; wir lesen Dashcam-GPS kostenlos im Browser",
            "whatItIs": "Telemetry Overlay (von Goprotelemetryextractor) ist eine kostenpflichtige Desktop-App für Windows, macOS und Linux, die anpassbare Geschwindigkeits-, GPS- und Sensor-Anzeigen auf Video brennt und das Ergebnis exportiert. Sie ist primär auf Action-Cams ausgelegt — GoPro, DJI, Insta360, Garmin — mit einer tiefen Anzeigen-Bibliothek und breiter Unterstützung von Datenformaten (GPX, FIT, NMEA und mehr) sowie einer In-App-Karte von Mapbox. Die Vollversion ist ein kostenpflichtiger Einmalkauf (mit einer Testversion mit Wasserzeichen); Dashcam-GPS wird über einen generischen Extraktionspfad gelesen, der standardmäßig aus ist. Es ist ein Render- und Export-Tool, kein interaktiver Player zum Durchsuchen einer Karte voller Clips.",
            "comparisonIntro": "Telemetry Overlay geht bei den Anzeigen tiefer. Hier hat ein kostenloses Browser-Tool speziell für Dashcam-Aufnahmen die Nase vorn.",
            "compareRows": [
                {
                    "dimension": "Preis",
                    "us": {
                        "mark": "yes",
                        "note": "Kostenlos"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Kostenpflichtig, Einmal-Lizenz (Testversion mit Wasserzeichen)"
                    }
                },
                {
                    "dimension": "Wie du es nutzt",
                    "us": {
                        "mark": "yes",
                        "note": "Im Browser — nichts zu installieren"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Desktop-Installation (Windows/Mac/Linux)"
                    }
                },
                {
                    "dimension": "Liest Dashcam-GPS von der Karte",
                    "us": {
                        "mark": "yes",
                        "note": "Automatisch"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Generische Extraktion, standardmäßig aus"
                    }
                },
                {
                    "dimension": "Eingebaute Karte",
                    "us": {
                        "mark": "yes",
                        "note": "Schlüssellose Live-Karte"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Mapbox (mit Schlüssel, kostenpflichtige Stufe)"
                    }
                },
                {
                    "dimension": "Geschwindigkeits- & GPS-Overlay + Export",
                    "us": {
                        "mark": "yes",
                        "note": "Geschwindigkeit, Koordinaten, Minikarte"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Tiefe Anzeigen-Bibliothek"
                    }
                },
                {
                    "dimension": "Anzeigen-Tiefe & zusätzliche Sensoren",
                    "us": {
                        "mark": "partial",
                        "note": "Geschwindigkeit, GPS, G-Kraft"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Hunderte Anzeigen, viele Quellen"
                    }
                }
            ],
            "whenStayTitle": "Wann Telemetry Overlay das bessere Tool ist",
            "whenStay": "Telemetry Overlay ist das bessere Tool, wenn du ein ausgefeiltes Overlay-Video produzieren willst — es hat eine weitaus tiefere Anzeigen-Bibliothek, unterstützt Action-Cams (GoPro, DJI, Insta360) und viele externe Datenformate (GPX, FIT, NMEA) und exportiert in sendetaugliche Formate (ProRes, Alpha-PNG). Das Overlay von dashcamigo ist bewusst einfach gehalten: Geschwindigkeit, Koordinaten und eine Minikarte, eingebrannt auf deinen Dashcam-Clip. Für die Anzeigen-Produktion bei Action-Cams ist Telemetry Overlay (ein kostenpflichtiges, installiertes Tool) die richtige Wahl; für kostenlose, sofortige Dashcam-Durchsicht und ein einfaches Overlay im Browser passt dashcamigo.",
            "ctaPrimary": "Deine Aufnahmen öffnen",
            "faq": [
                {
                    "q": "Ist dashcamigo ein kostenloser Ersatz für Telemetry Overlay?",
                    "a": "Für Dashcam-Aufnahmen größtenteils: Es liest das eingebettete GPS von der Karte, zeigt eine Live-Karte und ein Geschwindigkeits-/G-Kraft-Diagramm und kann ein Overlay aus Geschwindigkeit, Koordinaten und Minikarte auf einen exportierten Clip brennen — kostenlos, im Browser. Es reicht nicht an die tiefe Anzeigen-Bibliothek von Telemetry Overlay, dessen Action-Cam-Quellen (GoPro/DJI/Insta360) oder sendetaugliche Exportformate heran. Für ein einfaches Dashcam-Overlay ist es eine kostenlose Alternative; für anspruchsvolle Anzeigen-Produktion ist Telemetry Overlay fähiger."
                },
                {
                    "q": "Liest Telemetry Overlay Dashcam-GPS?",
                    "a": "Ja, aber über einen generischen Extraktionspfad, der standardmäßig aus ist und in den Einstellungen aktiviert werden muss, wobei die Zuverlässigkeit je nach Modell variiert. dashcamigo liest gängige Dashcam-GPS-Formate (70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware und mehr) automatisch, sobald du den Ordner hineinziehst."
                },
                {
                    "q": "Was kostet Telemetry Overlay im Vergleich zu dashcamigo?",
                    "a": "Die Vollversion von Telemetry Overlay ist ein einmaliger, kostenpflichtiger Kauf (eine Testversion mit Wasserzeichen ist verfügbar). dashcamigo ist kostenlos, ohne Konto und ohne kostenpflichtige Stufe."
                },
                {
                    "q": "Kann ich dashcamigo im Browser nutzen, ohne etwas zu installieren?",
                    "a": "Ja — öffne dashcamigo.app und zieh deinen SD-Karten-Ordner hinein. Telemetry Overlay ist eine Desktop-App, die du unter Windows, macOS oder Linux installierst; es gibt keine Browser- oder Mobil-Version."
                },
                {
                    "q": "Ist die Karte in dashcamigo kostenlos?",
                    "a": "Ja. Die Karte von dashcamigo ist schlüsselloses MapLibre + OpenFreeMap, eingebaut und kostenlos. Die In-App-Karte und das Satellitenbild von Telemetry Overlay kommen von Mapbox, einem kommerziellen Anbieter mit Schlüssel, und Karten-/GPS-Bilder sind aus dessen kostenloser Testversion ausgeschlossen."
                }
            ]
        },
        "es": {
            "title": "Alternativa a Telemetry Overlay — overlay de GPS de dashcam gratis en tu navegador | dashcamigo",
            "metaDescription": "Alternativa gratuita a Telemetry Overlay en el navegador: lee el GPS de la tarjeta, muestra un mapa en vivo y quema un overlay de velocidad. Sin instalar, sin cuota de licencia.",
            "ogTitle": "Alternativa gratis a Telemetry Overlay para dashcam",
            "ogDescription": "Telemetry Overlay es una herramienta de overlay de escritorio de pago. Para grabaciones de dashcam, dashcamigo lee el GPS y quema un overlay de velocidad/mapa gratis, en tu navegador.",
            "h1": "Una alternativa gratuita y en el navegador a Telemetry Overlay — para grabaciones de dashcam",
            "lead": "Telemetry Overlay es una potente herramienta de escritorio de pago para quemar indicadores sobre vídeo de cámaras de acción. Si tu material es de una dashcam y solo quieres ver la ruta, la velocidad y la fuerza G — y quizá quemar un overlay sencillo de velocidad y mapa — dashcamigo lo hace gratis, en tu navegador, leyendo el GPS directamente desde la tarjeta. Sin licencia, sin instalar. Para una producción profunda de indicadores, Telemetry Overlay sigue siendo la herramienta más capaz.",
            "cardHint": "Herramienta de overlay de escritorio de pago; nosotros leemos el GPS de la dashcam gratis en el navegador",
            "whatItIs": "Telemetry Overlay (de Goprotelemetryextractor) es una app de escritorio de pago para Windows, macOS y Linux que quema indicadores personalizables de velocidad, GPS y sensores sobre el vídeo y exporta el resultado. Está pensada ante todo para cámaras de acción — GoPro, DJI, Insta360, Garmin — con una biblioteca profunda de indicadores y amplia compatibilidad con formatos de datos (GPX, FIT, NMEA y más), y un mapa interno servido por Mapbox. La versión completa es una compra única de pago (con una prueba con marca de agua); el GPS de dashcam se lee mediante una vía de extracción genérica desactivada por defecto. Es una herramienta de renderizado y exportación, no un visor interactivo para revisar una tarjeta llena de clips.",
            "comparisonIntro": "Telemetry Overlay va más a fondo en los indicadores. Aquí es donde una herramienta gratuita en el navegador tiene ventaja específicamente para grabaciones de dashcam.",
            "compareRows": [
                {
                    "dimension": "Precio",
                    "us": {
                        "mark": "yes",
                        "note": "Gratis"
                    },
                    "them": {
                        "mark": "no",
                        "note": "De pago, licencia única (prueba con marca de agua)"
                    }
                },
                {
                    "dimension": "Cómo se ejecuta",
                    "us": {
                        "mark": "yes",
                        "note": "En el navegador — nada que instalar"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Instalación de escritorio (Windows/Mac/Linux)"
                    }
                },
                {
                    "dimension": "Lee el GPS de la dashcam desde la tarjeta",
                    "us": {
                        "mark": "yes",
                        "note": "Automáticamente"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Extracción genérica, desactivada por defecto"
                    }
                },
                {
                    "dimension": "Mapa integrado",
                    "us": {
                        "mark": "yes",
                        "note": "Mapa en vivo sin claves"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Mapbox (con clave, plan de pago)"
                    }
                },
                {
                    "dimension": "Overlay de velocidad y GPS + exportación",
                    "us": {
                        "mark": "yes",
                        "note": "Velocidad, coordenadas, minimapa"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Biblioteca profunda de indicadores"
                    }
                },
                {
                    "dimension": "Profundidad de indicadores y sensores extra",
                    "us": {
                        "mark": "partial",
                        "note": "Velocidad, GPS, fuerza G"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Cientos de indicadores, muchas fuentes"
                    }
                }
            ],
            "whenStayTitle": "Cuándo Telemetry Overlay es la mejor herramienta",
            "whenStay": "Telemetry Overlay es la mejor herramienta cuando quieres producir un vídeo con overlay pulido — tiene una biblioteca de indicadores mucho más profunda, admite cámaras de acción (GoPro, DJI, Insta360) y muchos formatos de datos externos (GPX, FIT, NMEA), y exporta en formatos de calidad profesional (ProRes, PNG con alfa). El overlay de dashcamigo es deliberadamente sencillo: velocidad, coordenadas y un minimapa quemados sobre tu clip de dashcam. Para la producción de indicadores con cámara de acción, Telemetry Overlay (una herramienta de pago e instalada) es la opción correcta; para una revisión de dashcam gratuita e instantánea y un overlay básico en el navegador, dashcamigo encaja.",
            "ctaPrimary": "Abre tus grabaciones",
            "faq": [
                {
                    "q": "¿Es dashcamigo un reemplazo gratuito de Telemetry Overlay?",
                    "a": "Para grabaciones de dashcam, en su mayor parte: lee el GPS incrustado desde la tarjeta, muestra un mapa en vivo y una gráfica de velocidad/fuerza G, y puede quemar un overlay de velocidad, coordenadas y minimapa sobre un clip exportado — gratis, en el navegador. No iguala la biblioteca profunda de indicadores de Telemetry Overlay, sus fuentes de cámaras de acción (GoPro/DJI/Insta360) ni sus formatos de exportación profesionales. Para un overlay sencillo de dashcam es una alternativa gratuita; para la producción avanzada de indicadores, Telemetry Overlay es más capaz."
                },
                {
                    "q": "¿Telemetry Overlay lee el GPS de la dashcam?",
                    "a": "Sí, pero a través de una vía de extracción genérica que está desactivada por defecto y debe habilitarse en los Ajustes, con una fiabilidad que varía según el modelo. dashcamigo lee los formatos de GPS de dashcam más comunes (70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware y más) automáticamente cuando sueltas la carpeta."
                },
                {
                    "q": "¿Cuánto cuesta Telemetry Overlay frente a dashcamigo?",
                    "a": "La versión completa de Telemetry Overlay es una compra única de pago (hay una prueba con marca de agua). dashcamigo es gratis, sin cuenta y sin plan de pago."
                },
                {
                    "q": "¿Puedo usar dashcamigo en el navegador sin instalar nada?",
                    "a": "Sí — abre dashcamigo.app y suelta la carpeta de tu tarjeta SD. Telemetry Overlay es una app de escritorio que instalas en Windows, macOS o Linux; no tiene versión para navegador ni para móvil."
                },
                {
                    "q": "¿El mapa de dashcamigo es gratis?",
                    "a": "Sí. El mapa de dashcamigo es MapLibre + OpenFreeMap sin claves, integrado y gratuito. El mapa interno y las imágenes de satélite de Telemetry Overlay vienen de Mapbox, un proveedor comercial con clave, y las imágenes de mapa/GPS quedan fuera de su prueba gratuita."
                }
            ]
        },
        "fr": {
            "title": "Alternative à Telemetry Overlay — un overlay GPS gratuit pour dashcam dans votre navigateur | dashcamigo",
            "metaDescription": "Alternative gratuite à Telemetry Overlay, dans le navigateur — lit le GPS de la carte, affiche une carte en direct, incruste vitesse et mini-carte. Sans frais de licence.",
            "ogTitle": "Alternative gratuite à Telemetry Overlay pour dashcam",
            "ogDescription": "Telemetry Overlay est un outil d'overlay payant pour le bureau. Pour les vidéos de dashcam, dashcamigo lit le GPS et incruste un overlay vitesse/carte gratuitement, dans votre navigateur.",
            "h1": "Une alternative gratuite à Telemetry Overlay, dans le navigateur — pour les vidéos de dashcam",
            "lead": "Telemetry Overlay est un outil de bureau puissant et payant qui incruste des jauges sur les vidéos d'action-cam. Si vos images viennent d'une dashcam et que vous voulez simplement voir le trajet, la vitesse et la force G — et peut-être incruster un overlay simple vitesse-et-carte — dashcamigo le fait gratuitement, dans votre navigateur, en lisant le GPS directement sur la carte SD. Pas de licence, pas d'installation. Pour la production poussée de jauges, Telemetry Overlay reste l'outil le plus capable.",
            "cardHint": "Outil d'overlay payant pour le bureau ; nous lisons le GPS de la dashcam gratuitement dans le navigateur",
            "whatItIs": "Telemetry Overlay (de Goprotelemetryextractor) est une application de bureau payante pour Windows, macOS et Linux qui incruste sur la vidéo des jauges personnalisables de vitesse, de GPS et de capteurs, puis exporte le résultat. Elle est pensée d'abord pour les caméras d'action — GoPro, DJI, Insta360, Garmin — avec une bibliothèque de jauges très fournie et une large prise en charge des formats de données (GPX, FIT, NMEA et d'autres), ainsi qu'une carte intégrée servie par Mapbox. La version complète est un achat unique payant (avec un essai filigrané) ; le GPS de dashcam se lit via un chemin d'extraction générique désactivé par défaut. C'est un outil de rendu et d'export, pas un lecteur interactif pour parcourir une carte SD pleine de clips.",
            "comparisonIntro": "Telemetry Overlay va plus loin sur les jauges. Voici là où un outil gratuit dans le navigateur prend l'avantage, spécifiquement pour les vidéos de dashcam.",
            "compareRows": [
                {
                    "dimension": "Prix",
                    "us": {
                        "mark": "yes",
                        "note": "Gratuit"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Payant, achat unique (essai filigrané)"
                    }
                },
                {
                    "dimension": "Comment on l'utilise",
                    "us": {
                        "mark": "yes",
                        "note": "Dans le navigateur — rien à installer"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Installation sur le bureau (Windows/Mac/Linux)"
                    }
                },
                {
                    "dimension": "Lit le GPS de la dashcam sur la carte SD",
                    "us": {
                        "mark": "yes",
                        "note": "Automatiquement"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Extraction générique, désactivée par défaut"
                    }
                },
                {
                    "dimension": "Carte intégrée",
                    "us": {
                        "mark": "yes",
                        "note": "Carte en direct, sans clé"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Mapbox (avec clé, palier payant)"
                    }
                },
                {
                    "dimension": "Overlay vitesse et GPS + export",
                    "us": {
                        "mark": "yes",
                        "note": "Vitesse, coordonnées, mini-carte"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Bibliothèque de jauges très fournie"
                    }
                },
                {
                    "dimension": "Richesse des jauges et capteurs additionnels",
                    "us": {
                        "mark": "partial",
                        "note": "Vitesse, GPS, force G"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Des centaines de jauges, de nombreuses sources"
                    }
                }
            ],
            "whenStayTitle": "Quand Telemetry Overlay est le meilleur outil",
            "whenStay": "Telemetry Overlay est le meilleur outil quand vous voulez produire une vidéo soignée avec overlay — il dispose d'une bibliothèque de jauges bien plus profonde, prend en charge les caméras d'action (GoPro, DJI, Insta360) et de nombreux formats de données externes (GPX, FIT, NMEA), et exporte dans des formats de qualité broadcast (ProRes, PNG alpha). L'overlay de dashcamigo est volontairement simple : vitesse, coordonnées et mini-carte incrustées sur votre clip de dashcam. Pour la production de jauges en action-cam, Telemetry Overlay (un outil payant et installé) est le bon choix ; pour une consultation gratuite et instantanée des vidéos de dashcam avec un overlay basique dans le navigateur, dashcamigo convient.",
            "ctaPrimary": "Ouvrir vos enregistrements",
            "faq": [
                {
                    "q": "dashcamigo est-il un remplaçant gratuit de Telemetry Overlay ?",
                    "a": "Pour les vidéos de dashcam, en grande partie oui : il lit le GPS intégré sur la carte SD, affiche une carte en direct et un graphique de vitesse/force G, et peut incruster un overlay vitesse, coordonnées et mini-carte sur un clip exporté — gratuitement, dans le navigateur. Il n'égale pas la bibliothèque de jauges très fournie de Telemetry Overlay, ses sources de caméras d'action (GoPro/DJI/Insta360) ni ses formats d'export broadcast. Pour un overlay de dashcam simple, c'est une alternative gratuite ; pour la production avancée de jauges, Telemetry Overlay est plus capable."
                },
                {
                    "q": "Telemetry Overlay lit-il le GPS de dashcam ?",
                    "a": "Oui, mais via un chemin d'extraction générique désactivé par défaut, qu'il faut activer dans les réglages, avec une fiabilité qui varie selon le modèle. dashcamigo lit automatiquement les formats GPS de dashcam courants (70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware et d'autres) dès que vous déposez le dossier."
                },
                {
                    "q": "Combien coûte Telemetry Overlay par rapport à dashcamigo ?",
                    "a": "La version complète de Telemetry Overlay est un achat unique payant (un essai filigrané est disponible). dashcamigo est gratuit, sans compte et sans palier payant."
                },
                {
                    "q": "Puis-je utiliser dashcamigo dans le navigateur sans rien installer ?",
                    "a": "Oui — ouvrez dashcamigo.app et déposez le dossier de votre carte SD. Telemetry Overlay est une application de bureau que vous installez sur Windows, macOS ou Linux ; il n'a pas de version navigateur ni mobile."
                },
                {
                    "q": "La carte est-elle gratuite dans dashcamigo ?",
                    "a": "Oui. La carte de dashcamigo, c'est MapLibre + OpenFreeMap sans clé, intégrée et gratuite. La carte intégrée et l'imagerie satellite de Telemetry Overlay viennent de Mapbox, un fournisseur commercial à clé, et l'imagerie carte/GPS est exclue de son essai gratuit."
                }
            ]
        },
        "ja": {
            "title": "Telemetry Overlay の代替 — ブラウザで動く無料のドラレコGPSオーバーレイ | dashcamigo",
            "metaDescription": "ドラレコ映像向けの、ブラウザで動く無料のTelemetry Overlay代替。カードからGPSを読み取り、ライブマップを表示し、速度＆ミニマップのオーバーレイを焼き込みます。インストール不要、ライセンス料不要。",
            "ogTitle": "ドラレコ映像向け無料のTelemetry Overlay代替",
            "ogDescription": "Telemetry Overlay は有料のデスクトップ用オーバーレイツール。ドラレコ映像なら、dashcamigo がGPSを読み取り、速度／マップのオーバーレイをブラウザで無料で焼き込みます。",
            "h1": "Telemetry Overlay の無料・ブラウザ代替 — ドラレコ映像のために",
            "lead": "Telemetry Overlay は、アクションカメラ映像にゲージを焼き込む強力な有料デスクトップツールです。映像がドラレコのもので、ルート・速度・G値をただ見たいだけ — そしてシンプルな速度とマップのオーバーレイを焼き込みたい程度 — なら、dashcamigo がそれをブラウザで無料で行い、GPSをカードから直接読み取ります。ライセンスも、インストールも不要です。本格的なゲージ制作なら、Telemetry Overlay のほうが依然として高機能なツールです。",
            "cardHint": "有料のデスクトップ用オーバーレイツール。当方はドラレコGPSをブラウザで無料で読み取り",
            "whatItIs": "Telemetry Overlay（Goprotelemetryextractor 製）は、Windows・macOS・Linux 向けの有料デスクトップアプリで、カスタマイズ可能な速度・GPS・センサーのゲージを動画に焼き込み、結果を書き出します。GoPro、DJI、Insta360、Garmin といったアクションカメラを第一に据え、奥行きのあるゲージライブラリと幅広いデータ形式（GPX、FIT、NMEA など）に対応し、Mapbox 配信のアプリ内マップを備えています。フル版は買い切りの有料版で（ウォーターマーク付きトライアルあり）、ドラレコGPSはデフォルトでオフの汎用抽出経路で読み取られます。これはレンダリングと書き出しのツールであって、カード一杯のクリップをスクラブして見るためのインタラクティブなビューアではありません。",
            "comparisonIntro": "Telemetry Overlay はゲージの面でより深掘りしています。ドラレコ映像に限れば、無料のブラウザツールが優位に立つのはこんなところです。",
            "compareRows": [
                {
                    "dimension": "価格",
                    "us": {
                        "mark": "yes",
                        "note": "無料"
                    },
                    "them": {
                        "mark": "no",
                        "note": "有料の買い切りライセンス（ウォーターマーク付きトライアル）"
                    }
                },
                {
                    "dimension": "起動方法",
                    "us": {
                        "mark": "yes",
                        "note": "ブラウザで — インストール不要"
                    },
                    "them": {
                        "mark": "no",
                        "note": "デスクトップにインストール（Windows/Mac/Linux）"
                    }
                },
                {
                    "dimension": "カードからドラレコGPSを読み取り",
                    "us": {
                        "mark": "yes",
                        "note": "自動で"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "汎用抽出、デフォルトでオフ"
                    }
                },
                {
                    "dimension": "内蔵マップ",
                    "us": {
                        "mark": "yes",
                        "note": "キー不要のライブマップ"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Mapbox（キー必要、有料プラン）"
                    }
                },
                {
                    "dimension": "速度＆GPSオーバーレイ＋書き出し",
                    "us": {
                        "mark": "yes",
                        "note": "速度、座標、ミニマップ"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "奥行きのあるゲージライブラリ"
                    }
                },
                {
                    "dimension": "ゲージの深さと追加センサー",
                    "us": {
                        "mark": "partial",
                        "note": "速度、GPS、G値"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "数百のゲージ、多数のソース"
                    }
                }
            ],
            "whenStayTitle": "Telemetry Overlay のほうが優れているとき",
            "whenStay": "洗練されたオーバーレイ動画を制作したいときは、Telemetry Overlay のほうが優れたツールです。はるかに奥行きのあるゲージライブラリを持ち、アクションカメラ（GoPro、DJI、Insta360）や多数の外部データ形式（GPX、FIT、NMEA）に対応し、放送品質の形式（ProRes、アルファ付きPNG）で書き出せます。dashcamigo のオーバーレイはあえてシンプルです — ドラレコのクリップに速度・座標・ミニマップを焼き込みます。アクションカメラのゲージ制作には、Telemetry Overlay（有料・インストール型のツール）が正解です。無料で即座に、ブラウザでドラレコ映像を確認し、基本的なオーバーレイを乗せたいなら、dashcamigo が合います。",
            "ctaPrimary": "録画を開く",
            "faq": [
                {
                    "q": "dashcamigo は Telemetry Overlay の無料の代替になりますか？",
                    "a": "ドラレコ映像については、おおむねなります。カードから埋め込みGPSを読み取り、ライブマップと速度／G値のチャートを表示し、エクスポートするクリップに速度・座標・ミニマップのオーバーレイを焼き込めます — ブラウザで無料です。Telemetry Overlay の奥行きのあるゲージライブラリ、アクションカメラのソース（GoPro／DJI／Insta360）、放送向けの書き出し形式には及びません。シンプルなドラレコのオーバーレイなら無料の代替ですが、高度なゲージ制作には Telemetry Overlay のほうが高機能です。"
                },
                {
                    "q": "Telemetry Overlay はドラレコGPSを読み取りますか？",
                    "a": "読み取りますが、デフォルトでオフの汎用抽出経路を通じてで、設定で有効化する必要があり、信頼性は機種によって異なります。dashcamigo は、フォルダをドロップすると一般的なドラレコのGPS形式（70mai、Viofo、BlackVue、GoPro、Garmin、Vantrue、Thinkware など）を自動で読み取ります。"
                },
                {
                    "q": "Telemetry Overlay と dashcamigo の費用はどれくらい違いますか？",
                    "a": "Telemetry Overlay のフル版は買い切りの有料版です（ウォーターマーク付きトライアルあり）。dashcamigo は無料で、アカウントも有料プランもありません。"
                },
                {
                    "q": "何もインストールせずにブラウザで dashcamigo を使えますか？",
                    "a": "はい — dashcamigo.app を開いて、SDカードのフォルダをドロップするだけです。Telemetry Overlay は Windows、macOS、Linux にインストールするデスクトップアプリで、ブラウザ版やモバイル版はありません。"
                },
                {
                    "q": "dashcamigo のマップは無料ですか？",
                    "a": "はい。dashcamigo のマップはキー不要の MapLibre + OpenFreeMap で、内蔵かつ無料です。Telemetry Overlay のアプリ内マップと衛星画像は、キーが必要な商用プロバイダー Mapbox から提供され、マップ／GPS画像は無料トライアルでは制限されています。"
                }
            ]
        },
        "ko": {
            "title": "Telemetry Overlay 대안 — 브라우저에서 쓰는 무료 블랙박스 GPS 오버레이 | dashcamigo",
            "metaDescription": "블랙박스 영상을 위한 무료 브라우저 기반 Telemetry Overlay 대안 — 카드에서 GPS를 읽어 실시간 지도를 보여주고 속도·미니맵 오버레이를 입힙니다. 설치 불필요, 라이선스 비용 없음.",
            "ogTitle": "블랙박스 영상을 위한 무료 Telemetry Overlay 대안",
            "ogDescription": "Telemetry Overlay는 유료 데스크톱 오버레이 도구입니다. 블랙박스 영상이라면, dashcamigo가 GPS를 읽어 속도/지도 오버레이를 무료로, 브라우저에서 입혀 줍니다.",
            "h1": "무료 브라우저 기반 Telemetry Overlay 대안 — 블랙박스 영상을 위한",
            "lead": "Telemetry Overlay는 액션캠 영상에 게이지를 입혀 주는 강력한 유료 데스크톱 도구입니다. 영상이 블랙박스에서 나온 것이고 그저 경로, 속도, G 포스를 보고 싶을 뿐이라면 — 그리고 어쩌면 간단한 속도·지도 오버레이를 입히고 싶다면 — dashcamigo가 그 일을 무료로, 브라우저에서, 카드에서 GPS를 바로 읽어 해냅니다. 라이선스도, 설치도 없습니다. 깊이 있는 게이지 제작이라면 Telemetry Overlay가 여전히 더 강력한 도구입니다.",
            "cardHint": "유료 데스크톱 오버레이 도구; 우리는 블랙박스 GPS를 브라우저에서 무료로 읽습니다",
            "whatItIs": "Telemetry Overlay(Goprotelemetryextractor 제작)는 Windows, macOS, Linux용 유료 데스크톱 앱으로, 맞춤형 속도·GPS·센서 게이지를 영상에 입히고 그 결과물을 내보냅니다. 액션캠 우선이며 — GoPro, DJI, Insta360, Garmin — 깊이 있는 게이지 라이브러리와 폭넓은 데이터 형식 지원(GPX, FIT, NMEA 등), 그리고 Mapbox가 제공하는 인앱 지도를 갖췄습니다. 정식 버전은 유료 일회성 구매이며(워터마크가 있는 체험판 제공), 블랙박스 GPS는 기본적으로 꺼져 있는 범용 추출 경로를 통해 읽힙니다. 카드 한가득 든 클립을 스크럽하는 인터랙티브 뷰어가 아니라, 렌더링과 내보내기를 위한 도구입니다.",
            "comparisonIntro": "Telemetry Overlay는 게이지에서 더 깊이 들어갑니다. 특히 블랙박스 영상에서 무료 브라우저 도구가 유리한 지점을 보세요.",
            "compareRows": [
                {
                    "dimension": "가격",
                    "us": {
                        "mark": "yes",
                        "note": "무료"
                    },
                    "them": {
                        "mark": "no",
                        "note": "유료 일회성 라이선스(워터마크 체험판)"
                    }
                },
                {
                    "dimension": "실행 방식",
                    "us": {
                        "mark": "yes",
                        "note": "브라우저에서 — 설치할 것 없음"
                    },
                    "them": {
                        "mark": "no",
                        "note": "데스크톱 설치(Windows/Mac/Linux)"
                    }
                },
                {
                    "dimension": "카드에서 블랙박스 GPS 읽기",
                    "us": {
                        "mark": "yes",
                        "note": "자동으로"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "범용 추출, 기본적으로 꺼짐"
                    }
                },
                {
                    "dimension": "내장 지도",
                    "us": {
                        "mark": "yes",
                        "note": "키 없는 실시간 지도"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Mapbox(키 필요, 유료 등급)"
                    }
                },
                {
                    "dimension": "속도·GPS 오버레이 + 내보내기",
                    "us": {
                        "mark": "yes",
                        "note": "속도, 좌표, 미니맵"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "깊이 있는 게이지 라이브러리"
                    }
                },
                {
                    "dimension": "게이지 깊이와 추가 센서",
                    "us": {
                        "mark": "partial",
                        "note": "속도, GPS, G 포스"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "수백 가지 게이지, 다양한 소스"
                    }
                }
            ],
            "whenStayTitle": "Telemetry Overlay가 더 나은 도구일 때",
            "whenStay": "정교하게 다듬은 오버레이 영상을 만들고 싶다면 Telemetry Overlay가 더 나은 도구입니다 — 훨씬 깊이 있는 게이지 라이브러리를 갖췄고, 액션캠(GoPro, DJI, Insta360)과 다양한 외부 데이터 형식(GPX, FIT, NMEA)을 지원하며, 방송급 형식(ProRes, 알파 PNG)으로 내보냅니다. dashcamigo의 오버레이는 의도적으로 단순합니다 — 블랙박스 클립에 속도, 좌표, 미니맵을 입히는 정도죠. 액션캠 게이지 제작이라면 Telemetry Overlay(유료, 설치형 도구)가 올바른 선택입니다. 무료로 즉시 블랙박스를 살펴보고 브라우저에서 기본 오버레이를 입히는 일이라면 dashcamigo가 잘 맞습니다.",
            "ctaPrimary": "내 녹화 영상 열기",
            "faq": [
                {
                    "q": "dashcamigo는 Telemetry Overlay의 무료 대체품인가요?",
                    "a": "블랙박스 영상에 한해서는 대체로 그렇습니다 — 카드에서 내장 GPS를 읽어 실시간 지도와 속도/G 포스 차트를 보여주고, 내보내는 클립에 속도, 좌표, 미니맵 오버레이를 입힐 수 있습니다. 무료로, 브라우저에서요. 다만 Telemetry Overlay의 깊이 있는 게이지 라이브러리, 액션캠 소스(GoPro/DJI/Insta360), 방송용 내보내기 형식까지 따라가지는 못합니다. 단순한 블랙박스 오버레이라면 무료 대안이고, 고급 게이지 제작이라면 Telemetry Overlay가 더 강력합니다."
                },
                {
                    "q": "Telemetry Overlay는 블랙박스 GPS를 읽나요?",
                    "a": "네, 다만 기본적으로 꺼져 있어 설정에서 켜야 하는 범용 추출 경로를 통해서이고, 신뢰도는 모델마다 다릅니다. dashcamigo는 폴더를 끌어다 놓으면 흔한 블랙박스 GPS 형식(70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware 등)을 자동으로 읽습니다."
                },
                {
                    "q": "Telemetry Overlay와 dashcamigo의 비용은 얼마인가요?",
                    "a": "Telemetry Overlay 정식 버전은 유료 일회성 구매입니다(워터마크가 있는 체험판이 제공됩니다). dashcamigo는 무료이며, 계정도 유료 등급도 없습니다."
                },
                {
                    "q": "아무것도 설치하지 않고 브라우저에서 dashcamigo를 쓸 수 있나요?",
                    "a": "네 — dashcamigo.app을 열고 SD 카드 폴더를 끌어다 놓으세요. Telemetry Overlay는 Windows, macOS, Linux에 설치하는 데스크톱 앱이며, 브라우저나 모바일 버전이 없습니다."
                },
                {
                    "q": "dashcamigo의 지도는 무료인가요?",
                    "a": "네. dashcamigo의 지도는 키 없는 MapLibre + OpenFreeMap으로, 내장되어 있고 무료입니다. Telemetry Overlay의 인앱 지도와 위성 이미지는 키가 필요한 상용 제공자인 Mapbox에서 오며, 지도/GPS 이미지는 무료 체험판에서 제외됩니다."
                }
            ]
        },
        "pl": {
            "title": "Alternatywa dla Telemetry Overlay — darmowa nakładka GPS z wideorejestratora w przeglądarce | dashcamigo",
            "metaDescription": "Darmowa przeglądarkowa alternatywa dla Telemetry Overlay — czyta GPS prosto z karty, pokazuje żywą mapę i nakłada prędkość oraz minimapę. Bez instalacji, bez opłaty licencyjnej.",
            "ogTitle": "Darmowa alternatywa dla Telemetry Overlay do nagrań z wideorejestratora",
            "ogDescription": "Telemetry Overlay to płatne narzędzie desktopowe do nakładek. Dla nagrań z wideorejestratora dashcamigo czyta GPS i nakłada prędkość/mapę za darmo, w przeglądarce.",
            "h1": "Darmowa, działająca w przeglądarce alternatywa dla Telemetry Overlay — do nagrań z wideorejestratora",
            "lead": "Telemetry Overlay to potężne, płatne narzędzie desktopowe do wypalania wskaźników na wideo z kamer sportowych. Jeśli Twoje nagranie pochodzi z wideorejestratora i chcesz po prostu zobaczyć trasę, prędkość i przeciążenia — a może wypalić prostą nakładkę z prędkością i mapą — dashcamigo robi to za darmo, w przeglądarce, czytając GPS prosto z karty. Bez licencji, bez instalacji. Do głębokiej produkcji wskaźników Telemetry Overlay wciąż jest bardziej wszechstronnym narzędziem.",
            "cardHint": "Płatne narzędzie desktopowe do nakładek; my czytamy GPS z wideorejestratora za darmo w przeglądarce",
            "whatItIs": "Telemetry Overlay (od Goprotelemetryextractor) to płatna aplikacja desktopowa na Windows, macOS i Linux, która wypala na wideo konfigurowalne wskaźniki prędkości, GPS i czujników, a następnie eksportuje wynik. Jest tworzona przede wszystkim z myślą o kamerach sportowych — GoPro, DJI, Insta360, Garmin — z bogatą biblioteką wskaźników i szerokim wsparciem formatów danych (GPX, FIT, NMEA i innych) oraz wbudowaną mapą serwowaną przez Mapbox. Pełna wersja to płatny, jednorazowy zakup (z okresem próbnym ze znakiem wodnym); GPS z wideorejestratora jest czytany przez ogólną ścieżkę ekstrakcji, domyślnie wyłączoną. To narzędzie do renderowania i eksportu, a nie interaktywna przeglądarka do przewijania całej karty pełnej klipów.",
            "comparisonIntro": "Telemetry Overlay idzie głębiej w kwestii wskaźników. Oto gdzie darmowe narzędzie przeglądarkowe ma przewagę konkretnie przy nagraniach z wideorejestratora.",
            "compareRows": [
                {
                    "dimension": "Cena",
                    "us": {
                        "mark": "yes",
                        "note": "Za darmo"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Płatna, licencja jednorazowa (okres próbny ze znakiem wodnym)"
                    }
                },
                {
                    "dimension": "Jak się uruchamia",
                    "us": {
                        "mark": "yes",
                        "note": "W przeglądarce — nic do instalowania"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Instalacja na desktop (Windows/Mac/Linux)"
                    }
                },
                {
                    "dimension": "Czyta GPS z wideorejestratora prosto z karty",
                    "us": {
                        "mark": "yes",
                        "note": "Automatycznie"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Ogólna ekstrakcja, domyślnie wyłączona"
                    }
                },
                {
                    "dimension": "Wbudowana mapa",
                    "us": {
                        "mark": "yes",
                        "note": "Żywa mapa bez kluczy"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Mapbox (z kluczem, płatny plan)"
                    }
                },
                {
                    "dimension": "Nakładka prędkości i GPS + eksport",
                    "us": {
                        "mark": "yes",
                        "note": "Prędkość, współrzędne, minimapa"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Bogata biblioteka wskaźników"
                    }
                },
                {
                    "dimension": "Głębia wskaźników i dodatkowe czujniki",
                    "us": {
                        "mark": "partial",
                        "note": "Prędkość, GPS, przeciążenia"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Setki wskaźników, wiele źródeł"
                    }
                }
            ],
            "whenStayTitle": "Kiedy Telemetry Overlay jest lepszym narzędziem",
            "whenStay": "Telemetry Overlay jest lepszym narzędziem, gdy chcesz stworzyć dopracowane wideo z nakładką — ma znacznie bogatszą bibliotekę wskaźników, obsługuje kamery sportowe (GoPro, DJI, Insta360) i wiele zewnętrznych formatów danych (GPX, FIT, NMEA) oraz eksportuje do formatów klasy broadcast (ProRes, alpha PNG). Nakładka w dashcamigo jest celowo prosta: prędkość, współrzędne i minimapa wypalone na klipie z wideorejestratora. Do produkcji wskaźników z kamery sportowej Telemetry Overlay (płatne, instalowane narzędzie) jest właściwym wyborem; do darmowego, błyskawicznego przeglądania nagrań z wideorejestratora i podstawowej nakładki w przeglądarce sprawdza się dashcamigo.",
            "ctaPrimary": "Otwórz swoje nagrania",
            "faq": [
                {
                    "q": "Czy dashcamigo to darmowy zamiennik Telemetry Overlay?",
                    "a": "Dla nagrań z wideorejestratora w większości tak: czyta wbudowany GPS z karty, pokazuje żywą mapę oraz wykres prędkości i przeciążeń, a także potrafi wypalić na eksportowanym klipie nakładkę z prędkością, współrzędnymi i minimapą — za darmo, w przeglądarce. Nie dorównuje bogatej bibliotece wskaźników Telemetry Overlay, źródłom z kamer sportowych (GoPro/DJI/Insta360) ani formatom eksportu klasy broadcast. Do prostej nakładki dla wideorejestratora to darmowa alternatywa; do zaawansowanej produkcji wskaźników Telemetry Overlay jest bardziej wszechstronny."
                },
                {
                    "q": "Czy Telemetry Overlay czyta GPS z wideorejestratora?",
                    "a": "Tak, ale przez ogólną ścieżkę ekstrakcji, która jest domyślnie wyłączona i musi zostać włączona w ustawieniach, a niezawodność różni się w zależności od modelu. dashcamigo czyta popularne formaty GPS wideorejestratorów (70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware i inne) automatycznie, gdy tylko przeciągniesz folder."
                },
                {
                    "q": "Ile kosztuje Telemetry Overlay w porównaniu z dashcamigo?",
                    "a": "Pełna wersja Telemetry Overlay to płatny, jednorazowy zakup (dostępny jest okres próbny ze znakiem wodnym). dashcamigo jest darmowe, bez konta i bez płatnych planów."
                },
                {
                    "q": "Czy mogę używać dashcamigo w przeglądarce bez instalowania czegokolwiek?",
                    "a": "Tak — otwórz dashcamigo.app i przeciągnij folder z karty SD. Telemetry Overlay to aplikacja desktopowa, którą instalujesz na Windows, macOS lub Linuksie; nie ma wersji przeglądarkowej ani mobilnej."
                },
                {
                    "q": "Czy mapa w dashcamigo jest darmowa?",
                    "a": "Tak. Mapa dashcamigo to MapLibre + OpenFreeMap bez kluczy, wbudowana i darmowa. Mapa i zdjęcia satelitarne w Telemetry Overlay pochodzą z Mapbox, komercyjnego dostawcy wymagającego klucza, a obrazy mapy/GPS są niedostępne w darmowym okresie próbnym."
                }
            ]
        },
        "pt": {
            "title": "Alternativa ao Telemetry Overlay — overlay de GPS de dashcam gratuito no seu navegador | dashcamigo",
            "metaDescription": "Alternativa gratuita ao Telemetry Overlay, no navegador — lê o GPS do cartão, mostra um mapa ao vivo e grava um overlay de velocidade. Sem instalação, sem taxa de licença.",
            "ogTitle": "Alternativa gratuita ao Telemetry Overlay para dashcam",
            "ogDescription": "O Telemetry Overlay é uma ferramenta de overlay de desktop paga. Para gravações de dashcam, o dashcamigo lê o GPS e grava um overlay de velocidade/mapa grátis, no seu navegador.",
            "h1": "Uma alternativa gratuita ao Telemetry Overlay, no navegador — para gravações de dashcam",
            "lead": "O Telemetry Overlay é uma ferramenta de desktop poderosa e paga para gravar medidores em vídeos de câmeras de ação. Se a sua gravação é de uma dashcam e você só quer ver a rota, a velocidade e a força G — e talvez gravar um overlay simples de velocidade e mapa —, o dashcamigo faz isso grátis, no seu navegador, lendo o GPS direto do cartão. Sem licença, sem instalação. Para produção avançada de medidores, o Telemetry Overlay continua sendo a ferramenta mais capaz.",
            "cardHint": "Ferramenta de overlay de desktop paga; nós lemos o GPS da dashcam grátis no navegador",
            "whatItIs": "O Telemetry Overlay (da Goprotelemetryextractor) é um app de desktop pago para Windows, macOS e Linux que grava medidores personalizáveis de velocidade, GPS e sensores em vídeos e exporta o resultado. Ele é voltado primeiro a câmeras de ação — GoPro, DJI, Insta360, Garmin — com uma biblioteca de medidores profunda e amplo suporte a formatos de dados (GPX, FIT, NMEA e mais), e um mapa no app servido pelo Mapbox. A versão completa é uma compra única paga (com um teste com marca-d'água); o GPS de dashcam é lido por um caminho de extração genérico, desativado por padrão. É uma ferramenta de renderização e exportação, não um visualizador interativo para percorrer um cartão cheio de clipes.",
            "comparisonIntro": "O Telemetry Overlay vai mais fundo nos medidores. Veja onde uma ferramenta gratuita de navegador leva vantagem especificamente para gravações de dashcam.",
            "compareRows": [
                {
                    "dimension": "Preço",
                    "us": {
                        "mark": "yes",
                        "note": "Grátis"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Paga, licença única (teste com marca-d'água)"
                    }
                },
                {
                    "dimension": "Como você roda",
                    "us": {
                        "mark": "yes",
                        "note": "No navegador — nada para instalar"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Instalação no desktop (Windows/Mac/Linux)"
                    }
                },
                {
                    "dimension": "Lê o GPS da dashcam direto do cartão",
                    "us": {
                        "mark": "yes",
                        "note": "Automaticamente"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Extração genérica, desativada por padrão"
                    }
                },
                {
                    "dimension": "Mapa integrado",
                    "us": {
                        "mark": "yes",
                        "note": "Mapa ao vivo sem chave"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Mapbox (com chave, plano pago)"
                    }
                },
                {
                    "dimension": "Overlay de velocidade e GPS + exportação",
                    "us": {
                        "mark": "yes",
                        "note": "Velocidade, coordenadas, minimapa"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Biblioteca de medidores profunda"
                    }
                },
                {
                    "dimension": "Profundidade de medidores e sensores extras",
                    "us": {
                        "mark": "partial",
                        "note": "Velocidade, GPS, força G"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Centenas de medidores, muitas fontes"
                    }
                }
            ],
            "whenStayTitle": "Quando o Telemetry Overlay é a melhor ferramenta",
            "whenStay": "O Telemetry Overlay é a melhor ferramenta quando você quer produzir um vídeo com overlay caprichado — ele tem uma biblioteca de medidores muito mais profunda, dá suporte a câmeras de ação (GoPro, DJI, Insta360) e a muitos formatos de dados externos (GPX, FIT, NMEA), e exporta formatos de qualidade de transmissão (ProRes, PNG com alfa). O overlay do dashcamigo é deliberadamente simples: velocidade, coordenadas e um minimapa gravados sobre o seu clipe de dashcam. Para produção de medidores de câmera de ação, o Telemetry Overlay (uma ferramenta paga e instalada) é a escolha certa; para uma revisão de dashcam gratuita e instantânea e um overlay básico no navegador, o dashcamigo encaixa.",
            "ctaPrimary": "Abra suas gravações",
            "faq": [
                {
                    "q": "O dashcamigo é um substituto gratuito para o Telemetry Overlay?",
                    "a": "Para gravações de dashcam, na maior parte: ele lê o GPS embutido direto do cartão, mostra um mapa ao vivo e um gráfico de velocidade/força G, e pode gravar um overlay de velocidade, coordenadas e minimapa em um clipe exportado — grátis, no navegador. Ele não iguala a biblioteca de medidores profunda do Telemetry Overlay, as fontes de câmeras de ação (GoPro/DJI/Insta360) ou os formatos de exportação de transmissão. Para um overlay simples de dashcam, é uma alternativa gratuita; para produção avançada de medidores, o Telemetry Overlay é mais capaz."
                },
                {
                    "q": "O Telemetry Overlay lê o GPS de dashcam?",
                    "a": "Sim, mas por um caminho de extração genérico que vem desativado por padrão e precisa ser ativado nas Configurações, com confiabilidade variando conforme o modelo. O dashcamigo lê formatos comuns de GPS de dashcam (70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware e mais) automaticamente quando você solta a pasta."
                },
                {
                    "q": "Quanto custa o Telemetry Overlay em comparação ao dashcamigo?",
                    "a": "A versão completa do Telemetry Overlay é uma compra única paga (há um teste com marca-d'água disponível). O dashcamigo é gratuito, sem conta e sem plano pago."
                },
                {
                    "q": "Posso usar o dashcamigo no navegador sem instalar nada?",
                    "a": "Sim — abra dashcamigo.app e solte a pasta do seu cartão SD. O Telemetry Overlay é um app de desktop que você instala no Windows, macOS ou Linux; ele não tem versão para navegador ou celular."
                },
                {
                    "q": "O mapa é gratuito no dashcamigo?",
                    "a": "Sim. O mapa do dashcamigo é o MapLibre + OpenFreeMap sem chave, integrado e gratuito. O mapa no app e as imagens de satélite do Telemetry Overlay vêm do Mapbox, um provedor comercial com chave, e as imagens de mapa/GPS ficam fora do seu teste gratuito."
                }
            ]
        },
        "zh": {
            "title": "Telemetry Overlay 替代方案 — 浏览器里免费的行车记录仪 GPS 叠加 | dashcamigo",
            "metaDescription": "面向行车记录仪素材、在浏览器里运行的免费 Telemetry Overlay 替代方案 — 从存储卡读取 GPS，显示实时地图，并烧录速度与小地图叠加。无需安装，无需授权费。",
            "ogTitle": "面向行车记录仪素材的免费 Telemetry Overlay 替代方案",
            "ogDescription": "Telemetry Overlay 是一款付费的桌面叠加工具。针对行车记录仪素材，dashcamigo 在浏览器里免费读取 GPS 并烧录速度/地图叠加。",
            "h1": "免费、在浏览器里运行的 Telemetry Overlay 替代方案 — 面向行车记录仪素材",
            "lead": "Telemetry Overlay 是一款功能强大的付费桌面工具，用于把仪表烧录到运动相机视频上。如果你的素材来自行车记录仪，而你只想看路线、速度和 G 力 — 也许再烧录一个简单的速度加地图叠加 — dashcamigo 在浏览器里免费完成这件事，直接从存储卡读取 GPS。无需授权，无需安装。论深度仪表制作，Telemetry Overlay 仍然是更强的工具。",
            "cardHint": "付费的桌面叠加工具；我们在浏览器里免费读取行车记录仪 GPS",
            "whatItIs": "Telemetry Overlay（由 Goprotelemetryextractor 出品）是一款面向 Windows、macOS 和 Linux 的付费桌面应用，可把可自定义的速度、GPS 和传感器仪表烧录到视频上并导出成片。它以运动相机为先 — GoPro、DJI、Insta360、Garmin — 拥有深厚的仪表库和广泛的数据格式支持（GPX、FIT、NMEA 等），并配有由 Mapbox 提供的应用内地图。完整版是付费的一次性买断（提供带水印的试用）；行车记录仪 GPS 通过一条通用的提取路径读取，且默认关闭。它是一个渲染并导出的工具，而不是用来翻看整张存储卡片段的交互式播放器。",
            "comparisonIntro": "Telemetry Overlay 在仪表上更深入。下面看看在行车记录仪素材这件事上，一个免费浏览器工具的优势在哪里。",
            "compareRows": [
                {
                    "dimension": "价格",
                    "us": {
                        "mark": "yes",
                        "note": "免费"
                    },
                    "them": {
                        "mark": "no",
                        "note": "付费，一次性授权（带水印试用）"
                    }
                },
                {
                    "dimension": "运行方式",
                    "us": {
                        "mark": "yes",
                        "note": "在浏览器里 — 无需安装"
                    },
                    "them": {
                        "mark": "no",
                        "note": "桌面安装（Windows/Mac/Linux）"
                    }
                },
                {
                    "dimension": "从存储卡读取行车记录仪 GPS",
                    "us": {
                        "mark": "yes",
                        "note": "自动"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "通用提取，默认关闭"
                    }
                },
                {
                    "dimension": "内置地图",
                    "us": {
                        "mark": "yes",
                        "note": "无需密钥的实时地图"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Mapbox（需密钥，付费层）"
                    }
                },
                {
                    "dimension": "速度与 GPS 叠加 + 导出",
                    "us": {
                        "mark": "yes",
                        "note": "速度、坐标、小地图"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "深厚的仪表库"
                    }
                },
                {
                    "dimension": "仪表深度与额外传感器",
                    "us": {
                        "mark": "partial",
                        "note": "速度、GPS、G 力"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "数百种仪表，多种数据源"
                    }
                }
            ],
            "whenStayTitle": "什么时候 Telemetry Overlay 是更好的工具",
            "whenStay": "当你想制作一段精致的叠加视频时，Telemetry Overlay 是更好的工具 — 它拥有深厚得多的仪表库，支持运动相机（GoPro、DJI、Insta360）和许多外部数据格式（GPX、FIT、NMEA），并能导出广播级格式（ProRes、alpha PNG）。dashcamigo 的叠加是有意保持简单的：把速度、坐标和一张小地图烧录到你的行车记录仪片段上。对于运动相机的仪表制作，Telemetry Overlay（一款付费、需安装的工具）是正确的选择；对于免费、即时的行车记录仪查看以及浏览器里的基础叠加，dashcamigo 正合适。",
            "ctaPrimary": "打开你的录像",
            "faq": [
                {
                    "q": "dashcamigo 是 Telemetry Overlay 的免费替代品吗？",
                    "a": "针对行车记录仪素材，基本是：它从存储卡读取内嵌的 GPS，显示实时地图和速度/G 力图表，并能把速度、坐标和小地图叠加烧录到导出的片段上 — 免费，在浏览器里。它无法媲美 Telemetry Overlay 深厚的仪表库、运动相机数据源（GoPro/DJI/Insta360）或广播级导出格式。对于简单的行车记录仪叠加，它是一个免费替代方案；对于进阶的仪表制作，Telemetry Overlay 更强。"
                },
                {
                    "q": "Telemetry Overlay 能读取行车记录仪 GPS 吗？",
                    "a": "可以，但要通过一条默认关闭、需在设置里启用的通用提取路径，可靠性因型号而异。dashcamigo 在你拖入文件夹时会自动读取常见的行车记录仪 GPS 格式（70mai、Viofo、BlackVue、GoPro、Garmin、Vantrue、Thinkware 等）。"
                },
                {
                    "q": "Telemetry Overlay 和 dashcamigo 各要多少钱？",
                    "a": "Telemetry Overlay 完整版是付费的一次性买断（提供带水印的试用）。dashcamigo 免费，无需账户，也没有付费层。"
                },
                {
                    "q": "我能在浏览器里使用 dashcamigo 而不安装任何东西吗？",
                    "a": "可以 — 打开 dashcamigo.app，把你 SD 卡里的文件夹拖进去即可。Telemetry Overlay 是一款需要安装在 Windows、macOS 或 Linux 上的桌面应用；它没有浏览器版或移动版。"
                },
                {
                    "q": "dashcamigo 里的地图是免费的吗？",
                    "a": "是的。dashcamigo 的地图是无需密钥的 MapLibre + OpenFreeMap，内置且免费。Telemetry Overlay 的应用内地图和卫星影像来自 Mapbox 这家需密钥的商业供应商，且地图/GPS 影像在其免费试用中被屏蔽。"
                }
            ]
        }
    },
    "dashware": {
        "de": {
            "title": "DashWare-Alternative — kostenlos, gepflegt, im Browser | dashcamigo",
            "metaDescription": "DashWare ist kostenlos, aber verwaist (2017) und nur für Windows. dashcamigo ist die gepflegte Browser-Alternative, die Dashcam-GPS liest und eine echte Karte zeigt.",
            "ogTitle": "DashWare-Alternative — gepflegt, im Browser",
            "ogDescription": "DashWare wird seit 2017 nicht mehr aktualisiert, läuft nur unter Windows und hat keine Live-Karte. dashcamigo liest Dashcam-GPS und zeigt eine echte schlüssellose Karte — kostenlos, im Browser.",
            "h1": "Eine gepflegte DashWare-Alternative im Browser — mit einer echten Karte",
            "lead": "DashWare war ein beliebtes kostenloses Telemetrie-Overlay-Tool, aber GoPro hat es nach 2017 nicht mehr aktualisiert, es läuft nur unter Windows und es hatte nie eine echte In-App-Karte — nur eine Tracklinie, die man über einen manuell erstellten Karten-Screenshot legte. dashcamigo ist die gepflegte Alternative im Browser für Dashcam-Aufnahmen: Es liest das GPS von der Karte und zeigt eine schlüssellose Live-Karte mit einem Geschwindigkeits- und G-Kraft-Diagramm. Zum Bauen eigener Anzeigen-Overlays ist der Editor von DashWare allerdings nach wie vor ein Tool anderer Art.",
            "cardHint": "Kostenlos, aber verwaist (2017), nur Windows, keine Live-Karte",
            "whatItIs": "DashWare, von GoPro übernommen, ist ein kostenloser Windows-Editor für Telemetrie-Overlays: Du bringst ein Video plus ein separates Daten-Log (GPS, Herzfrequenz, Drehzahl) mit, und es brennt eine große Bibliothek anpassbarer Anzeigen auf das Material. Sein Anzeigen-Editor und die breite Unterstützung von Datenloggern waren seine Stärke. Aber die Entwicklung stoppte 2017 — es ist ungepflegt, nur unter Windows (auf dem Mac braucht es eine virtuelle Maschine), es liest kein eingebettetes GPS von Consumer-Dashcams (das Video ist nur eine Hintergrundebene) und es schafft es nicht einmal, GPS aus neueren GoPro-Modellen zu extrahieren. Seine \"Karte\" ist eine 2D-Tracklinie ohne Kartenkacheln; DashWares eigene FAQ rät dir, einen Screenshot von Google oder Bing zu machen und ihn manuell darunterzulegen.",
            "comparisonIntro": "DashWare und dashcamigo erledigen unterschiedliche Aufgaben, aber für das Anschauen von Dashcam-Aufnahmen mit einer Karte sieht der Vergleich so aus.",
            "compareRows": [
                {
                    "dimension": "Preis",
                    "us": {
                        "mark": "yes",
                        "note": "Kostenlos"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Kostenlos"
                    }
                },
                {
                    "dimension": "Noch gepflegt",
                    "us": {
                        "mark": "yes",
                        "note": "Aktiv entwickelt"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Verwaist seit 2017"
                    }
                },
                {
                    "dimension": "Läuft auf Mac, Linux & mobil",
                    "us": {
                        "mark": "yes",
                        "note": "Jeder moderne Browser"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Nur Windows (Mac über eine VM)"
                    }
                },
                {
                    "dimension": "Wie du es nutzt",
                    "us": {
                        "mark": "yes",
                        "note": "Im Browser"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Desktop-Installation (.exe)"
                    }
                },
                {
                    "dimension": "Liest Dashcam-GPS von der Karte",
                    "us": {
                        "mark": "yes",
                        "note": "Automatisch"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Braucht eine separate Datendatei"
                    }
                },
                {
                    "dimension": "Live-Karte",
                    "us": {
                        "mark": "yes",
                        "note": "Schlüssellos, eingebaut"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Keine Live-Karte — Tracklinie + manueller Screenshot"
                    }
                },
                {
                    "dimension": "Eigene Anzeigen-Overlays",
                    "us": {
                        "mark": "partial",
                        "note": "Geschwindigkeit, GPS, Minikarte"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Große Anzeigen-Bibliothek + Editor"
                    }
                }
            ],
            "whenStayTitle": "Wann DashWare weiterhin Sinn ergibt",
            "whenStay": "DashWares Stärke war sein Anzeigen-Editor und eine große Bibliothek anpassbarer Anzeigen für Action-Sport- und Rennsport-Creator, gespeist aus Datenloggern (GPS, Herzfrequenz, Drehzahl, Rundenzeiten). Wenn du einen solchen Workflow hast, unter Windows bist und dich ungepflegte Software nicht stört, kann sein Overlay-Editor immer noch Dinge, die dashcamigo nicht kann. dashcamigo ist kein Tool zum Erstellen von Anzeigen — es ist ein gepflegter Dashcam-Viewer im Browser, der eingebettetes GPS liest und eine echte Live-Karte zeigt, also genau das, was DashWare nie hatte.",
            "ctaPrimary": "Deine Aufnahmen öffnen",
            "faq": [
                {
                    "q": "Wird DashWare noch aktualisiert?",
                    "a": "Nein. GoPro hat DashWare 2017 nicht mehr aktualisiert; es ist faktisch verwaist und schafft es nicht einmal, GPS aus neueren GoPro-Kameras zu lesen. dashcamigo wird aktiv entwickelt."
                },
                {
                    "q": "Macht dashcamigo Telemetrie-Overlays wie DashWare?",
                    "a": "Teilweise. dashcamigo kann ein Overlay aus Geschwindigkeit, Koordinaten und Minikarte auf einen exportierten Clip brennen, aber es hat nicht die große eigene Anzeigen-Bibliothek von DashWare oder dessen Anzeigen-Editor. Es konzentriert sich darauf, Dashcam-GPS auf einer Live-Karte und in einem Diagramm zu lesen und anzuzeigen — was DashWare von einer Dashcam-Karte aus nicht kann."
                },
                {
                    "q": "Warum hat DashWare keine Karte?",
                    "a": "Von Haus aus — DashWare hat nie eine Live-Karte eingebettet (in seiner FAQ werden die Lizenzkosten für Karten-APIs angeführt) und zeichnet nur eine 2D-Tracklinie; um einen Kartenhintergrund zu bekommen, musst du einen Screenshot von Google oder Bing machen und ihn manuell darunterlegen. dashcamigo hat eine echte, interaktive, schlüssellose Karte (MapLibre + OpenFreeMap) eingebaut."
                },
                {
                    "q": "Läuft es auf dem Mac oder im Browser?",
                    "a": "dashcamigo läuft in jedem modernen Browser unter Windows, macOS, Linux und mobil. DashWare läuft nur unter Windows; auf einem Mac braucht es eine virtuelle Windows-Maschine."
                },
                {
                    "q": "Wird mein Material hochgeladen?",
                    "a": "Nein. dashcamigo liest deine Dateien direkt von deinem Gerät — es wird nichts hochgeladen. DashWare ist ebenfalls lokal; beide behalten dein Material auf deinem Rechner."
                }
            ]
        },
        "es": {
            "title": "Alternativa a DashWare — gratis, mantenida, en tu navegador | dashcamigo",
            "metaDescription": "DashWare es gratuito pero está abandonado (2017) y solo para Windows. dashcamigo es la alternativa mantenida en el navegador: lee el GPS y muestra un mapa real.",
            "ogTitle": "Alternativa a DashWare — mantenida, en tu navegador",
            "ogDescription": "DashWare no se actualiza desde 2017, es solo para Windows y no tiene mapa en vivo. dashcamigo lee el GPS de la dashcam y muestra un mapa real sin claves — gratis, en el navegador.",
            "h1": "Una alternativa a DashWare mantenida y en el navegador — con un mapa real",
            "lead": "DashWare fue una popular herramienta gratuita de overlay de telemetría, pero GoPro dejó de actualizarla después de 2017, es solo para Windows y nunca tuvo un mapa interno de verdad — solo una línea de recorrido que superponías sobre una captura de mapa hecha a mano. dashcamigo es la alternativa mantenida y en el navegador para grabaciones de dashcam: lee el GPS desde la tarjeta y muestra un mapa en vivo y sin claves con una gráfica de velocidad y fuerza G. Eso sí, para crear overlays de indicadores personalizados, el editor de DashWare sigue siendo otro tipo de herramienta.",
            "cardHint": "Gratis pero abandonada (2017), solo para Windows, sin mapa en vivo",
            "whatItIs": "DashWare, adquirida por GoPro, es un editor gratuito de overlay de telemetría para Windows: traes un vídeo más un registro de datos aparte (GPS, ritmo cardíaco, RPM) y quema una amplia biblioteca de indicadores personalizables sobre el material. Su editor de indicadores y su amplia compatibilidad con registradores de datos eran su punto fuerte. Pero el desarrollo se detuvo en 2017 — no tiene mantenimiento, es solo para Windows (en Mac necesita una máquina virtual), no lee el GPS incrustado de las dashcams de consumo (el vídeo es solo una capa de fondo) e incluso falla al extraer el GPS de los modelos de GoPro más nuevos. Su \"mapa\" es una línea de recorrido en 2D sin teselas de mapa; el propio FAQ de DashWare te dice que hagas una captura de Google o Bing y la superpongas manualmente.",
            "comparisonIntro": "DashWare y dashcamigo hacen trabajos distintos, pero para ver grabaciones de dashcam con un mapa, así es como se comparan.",
            "compareRows": [
                {
                    "dimension": "Precio",
                    "us": {
                        "mark": "yes",
                        "note": "Gratis"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Gratis"
                    }
                },
                {
                    "dimension": "Sigue mantenida",
                    "us": {
                        "mark": "yes",
                        "note": "En desarrollo activo"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Abandonada desde 2017"
                    }
                },
                {
                    "dimension": "Funciona en Mac, Linux y móvil",
                    "us": {
                        "mark": "yes",
                        "note": "Cualquier navegador moderno"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Solo Windows (Mac mediante una VM)"
                    }
                },
                {
                    "dimension": "Cómo se ejecuta",
                    "us": {
                        "mark": "yes",
                        "note": "En el navegador"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Instalación de escritorio (.exe)"
                    }
                },
                {
                    "dimension": "Lee el GPS de la dashcam desde la tarjeta",
                    "us": {
                        "mark": "yes",
                        "note": "Automáticamente"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Necesita un archivo de datos aparte"
                    }
                },
                {
                    "dimension": "Mapa en vivo",
                    "us": {
                        "mark": "yes",
                        "note": "Sin claves, integrado"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Sin mapa en vivo — línea de recorrido + captura manual"
                    }
                },
                {
                    "dimension": "Overlays de indicadores personalizados",
                    "us": {
                        "mark": "partial",
                        "note": "Velocidad, GPS, minimapa"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Amplia biblioteca de indicadores + editor"
                    }
                }
            ],
            "whenStayTitle": "Cuándo DashWare sigue teniendo sentido",
            "whenStay": "El punto fuerte de DashWare era su editor de indicadores y su amplia biblioteca de indicadores personalizables para creadores de deportes de acción y carreras, alimentados por registradores de datos (GPS, ritmo cardíaco, RPM, cronómetros de vuelta). Si tienes ese tipo de flujo de trabajo, estás en Windows y no te importa un software sin mantenimiento, su editor de overlays todavía hace cosas que dashcamigo no hace. dashcamigo no es una herramienta de creación de indicadores — es un visor de dashcam mantenido y en el navegador que lee el GPS incrustado y muestra un mapa en vivo real, que es justo lo que DashWare nunca tuvo.",
            "ctaPrimary": "Abre tus grabaciones",
            "faq": [
                {
                    "q": "¿DashWare sigue actualizándose?",
                    "a": "No. GoPro dejó de actualizar DashWare en 2017; está prácticamente abandonada e incluso falla al leer el GPS de las cámaras GoPro más nuevas. dashcamigo está en desarrollo activo."
                },
                {
                    "q": "¿dashcamigo hace overlays de telemetría como DashWare?",
                    "a": "En parte. dashcamigo puede quemar un overlay de velocidad, coordenadas y minimapa sobre un clip exportado, pero no tiene la amplia biblioteca de indicadores de DashWare ni su editor de indicadores. Se centra en leer y mostrar el GPS de la dashcam en un mapa en vivo y una gráfica, algo que DashWare no puede hacer desde una tarjeta de dashcam."
                },
                {
                    "q": "¿Por qué DashWare no tiene mapa?",
                    "a": "Es a propósito — DashWare nunca integró un mapa en vivo (su FAQ cita el coste de la licencia de la API de mapas) y solo dibuja una línea de recorrido en 2D; para conseguir un fondo de mapa tienes que hacer una captura de Google o Bing y superponerla manualmente. dashcamigo tiene un mapa real, interactivo y sin claves (MapLibre + OpenFreeMap) integrado."
                },
                {
                    "q": "¿Funciona en Mac o en el navegador?",
                    "a": "dashcamigo funciona en cualquier navegador moderno en Windows, macOS, Linux y móvil. DashWare es solo para Windows; en un Mac necesita una máquina virtual con Windows."
                },
                {
                    "q": "¿Se subirá mi material a algún sitio?",
                    "a": "No. dashcamigo lee tus archivos directamente desde tu dispositivo — no se sube nada. DashWare también es local; ambas mantienen tu material en tu máquina."
                }
            ]
        },
        "fr": {
            "title": "Alternative à DashWare — gratuite, maintenue, dans votre navigateur | dashcamigo",
            "metaDescription": "DashWare est gratuit mais abandonné (2017) et limité à Windows. dashcamigo est l'alternative maintenue dans le navigateur : lit le GPS et affiche une vraie carte.",
            "ogTitle": "Alternative à DashWare — maintenue, dans le navigateur",
            "ogDescription": "DashWare n'a plus été mis à jour depuis 2017, fonctionne uniquement sous Windows et n'a pas de carte en direct. dashcamigo lit le GPS de dashcam et affiche une vraie carte sans clé — gratuitement, dans le navigateur.",
            "h1": "Une alternative à DashWare maintenue, dans le navigateur — avec une vraie carte",
            "lead": "DashWare était un outil d'overlay de télémétrie gratuit et populaire, mais GoPro a cessé de le mettre à jour après 2017, il fonctionne uniquement sous Windows, et il n'a jamais eu de vraie carte intégrée — juste une ligne de trace à superposer sur une capture d'écran de carte faite à la main. dashcamigo est l'alternative maintenue, dans le navigateur, pour les vidéos de dashcam : il lit le GPS sur la carte SD et affiche une carte en direct, sans clé, avec un graphique de vitesse et de force G. Pour construire des overlays de jauges personnalisés, en revanche, l'éditeur de DashWare reste un outil d'un autre genre.",
            "cardHint": "Gratuit mais abandonné (2017), uniquement Windows, sans carte en direct",
            "whatItIs": "DashWare, racheté par GoPro, est un éditeur d'overlays de télémétrie gratuit sous Windows : vous apportez une vidéo plus un journal de données séparé (GPS, fréquence cardiaque, régime moteur) et il incruste sur les images une large bibliothèque de jauges personnalisables. Son éditeur de jauges et sa large prise en charge des enregistreurs de données étaient ses points forts. Mais le développement s'est arrêté en 2017 — il n'est plus maintenu, fonctionne uniquement sous Windows (sur Mac il faut une machine virtuelle), il ne lit pas le GPS intégré des dashcams grand public (la vidéo n'est qu'un simple calque de fond), et il échoue même à extraire le GPS des GoPro plus récentes. Sa « carte » est une ligne de trace 2D sans tuiles cartographiques ; la propre FAQ de DashWare vous dit de faire une capture d'écran de Google ou Bing et de la superposer à la main.",
            "comparisonIntro": "DashWare et dashcamigo font des choses différentes, mais pour visionner des vidéos de dashcam avec une carte, voici comment ils se comparent.",
            "compareRows": [
                {
                    "dimension": "Prix",
                    "us": {
                        "mark": "yes",
                        "note": "Gratuit"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Gratuit"
                    }
                },
                {
                    "dimension": "Toujours maintenu",
                    "us": {
                        "mark": "yes",
                        "note": "Développé activement"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Abandonné depuis 2017"
                    }
                },
                {
                    "dimension": "Fonctionne sur Mac, Linux et mobile",
                    "us": {
                        "mark": "yes",
                        "note": "Tout navigateur moderne"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Uniquement Windows (Mac via une VM)"
                    }
                },
                {
                    "dimension": "Comment on l'utilise",
                    "us": {
                        "mark": "yes",
                        "note": "Dans le navigateur"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Installation sur le bureau (.exe)"
                    }
                },
                {
                    "dimension": "Lit le GPS de la dashcam sur la carte SD",
                    "us": {
                        "mark": "yes",
                        "note": "Automatiquement"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Nécessite un fichier de données séparé"
                    }
                },
                {
                    "dimension": "Carte en direct",
                    "us": {
                        "mark": "yes",
                        "note": "Sans clé, intégrée"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Pas de carte en direct — ligne de trace + capture d'écran manuelle"
                    }
                },
                {
                    "dimension": "Overlays de jauges personnalisés",
                    "us": {
                        "mark": "partial",
                        "note": "Vitesse, GPS, mini-carte"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Large bibliothèque de jauges + éditeur"
                    }
                }
            ],
            "whenStayTitle": "Quand DashWare a encore du sens",
            "whenStay": "Le point fort de DashWare était son éditeur de jauges et sa large bibliothèque de jauges personnalisables pour les créateurs de sport d'action et de course, alimentés par des enregistreurs de données (GPS, fréquence cardiaque, régime moteur, chronos de tour). Si vous avez ce genre de flux de travail, que vous êtes sous Windows et que les logiciels non maintenus ne vous dérangent pas, son éditeur d'overlays fait encore des choses que dashcamigo ne fait pas. dashcamigo n'est pas un outil de création de jauges — c'est un lecteur de dashcam maintenu, dans le navigateur, qui lit le GPS intégré et affiche une vraie carte en direct, exactement ce que DashWare n'a jamais eu.",
            "ctaPrimary": "Ouvrir vos enregistrements",
            "faq": [
                {
                    "q": "DashWare est-il encore mis à jour ?",
                    "a": "Non. GoPro a cessé de mettre à jour DashWare en 2017 ; il est de fait abandonné et échoue même à lire le GPS des GoPro plus récentes. dashcamigo est développé activement."
                },
                {
                    "q": "dashcamigo fait-il des overlays de télémétrie comme DashWare ?",
                    "a": "En partie. dashcamigo peut incruster un overlay vitesse, coordonnées et mini-carte sur un clip exporté, mais il n'a pas la large bibliothèque de jauges de DashWare ni son éditeur de jauges. Il se concentre sur la lecture et l'affichage du GPS de dashcam sur une carte en direct et un graphique, ce que DashWare ne sait pas faire à partir d'une carte SD de dashcam."
                },
                {
                    "q": "Pourquoi DashWare n'a-t-il pas de carte ?",
                    "a": "C'est un choix de conception — DashWare n'a jamais intégré de carte en direct (sa FAQ invoque le coût de licence des API cartographiques) et ne dessine qu'une ligne de trace 2D ; pour obtenir un fond de carte, vous devez faire une capture d'écran de Google ou Bing et la superposer à la main. dashcamigo intègre une vraie carte interactive, sans clé (MapLibre + OpenFreeMap)."
                },
                {
                    "q": "Fonctionne-t-il sur Mac ou dans le navigateur ?",
                    "a": "dashcamigo fonctionne dans tout navigateur moderne sur Windows, macOS, Linux et mobile. DashWare fonctionne uniquement sous Windows ; sur un Mac, il lui faut une machine virtuelle Windows."
                },
                {
                    "q": "Mes vidéos seront-elles téléversées ?",
                    "a": "Non. dashcamigo lit vos fichiers directement sur votre appareil — rien n'est téléversé. DashWare est également local ; tous deux gardent vos vidéos sur votre machine."
                }
            ]
        },
        "ja": {
            "title": "DashWare の代替 — 無料・更新中、ブラウザで | dashcamigo",
            "metaDescription": "DashWare は無料ですが放置（2017年）された、Windows専用でライブマップのないテレメトリツールです。dashcamigo は更新中のブラウザ代替で、ドラレコGPSを読み取り本物のマップを表示します。",
            "ogTitle": "DashWare の代替 — 更新中、ブラウザで",
            "ogDescription": "DashWare は2017年以降更新されておらず、Windows専用でライブマップがありません。dashcamigo はドラレコGPSを読み取り、キー不要の本物のマップを表示します — ブラウザで無料。",
            "h1": "更新中のブラウザ DashWare 代替 — 本物のマップ付き",
            "lead": "DashWare は人気のあった無料のテレメトリ・オーバーレイツールでしたが、GoPro が2017年以降の更新を止め、Windows専用で、本物のアプリ内マップは一度も備わっていませんでした — あったのは、手動で用意したマップのスクリーンショットに重ねるトラックの線だけです。dashcamigo はドラレコ映像向けの更新中のブラウザ代替で、カードからGPSを読み取り、速度とG値のチャート付きでキー不要のライブマップを表示します。ただし、カスタムなゲージオーバーレイを組み立てるなら、DashWare のエディタは依然として別種のツールです。",
            "cardHint": "無料だが放置（2017年）、Windows専用、ライブマップなし",
            "whatItIs": "DashWare は、GoPro に買収された無料の Windows 用テレメトリ・オーバーレイエディタです。動画と別個のデータログ（GPS、心拍数、回転数）を持ち込むと、豊富なカスタマイズ可能なゲージのライブラリを映像に焼き込みます。そのゲージエディタと幅広いデータロガー対応が強みでした。しかし開発は2017年に止まりました — メンテナンスされておらず、Windows専用（Mac には仮想マシンが必要）で、コンシューマー向けドラレコの埋め込みGPSは読み取れず（動画は単なる背景レイヤー扱い）、新しい GoPro 機種からのGPS抽出すら失敗します。その「マップ」はマップタイルのない2Dのトラックの線で、DashWare 自身のFAQが、Google や Bing をスクリーンショットして手動で重ねるよう案内しています。",
            "comparisonIntro": "DashWare と dashcamigo は別の仕事をしますが、ドラレコ映像をマップ付きで見るという点では、両者はこう並びます。",
            "compareRows": [
                {
                    "dimension": "価格",
                    "us": {
                        "mark": "yes",
                        "note": "無料"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "無料"
                    }
                },
                {
                    "dimension": "更新中",
                    "us": {
                        "mark": "yes",
                        "note": "活発に開発中"
                    },
                    "them": {
                        "mark": "no",
                        "note": "2017年以降放置"
                    }
                },
                {
                    "dimension": "Mac・Linux・モバイルで動作",
                    "us": {
                        "mark": "yes",
                        "note": "最新のブラウザならどれでも"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Windows専用（Mac は仮想マシン経由）"
                    }
                },
                {
                    "dimension": "起動方法",
                    "us": {
                        "mark": "yes",
                        "note": "ブラウザで"
                    },
                    "them": {
                        "mark": "no",
                        "note": "デスクトップにインストール（.exe）"
                    }
                },
                {
                    "dimension": "カードからドラレコGPSを読み取り",
                    "us": {
                        "mark": "yes",
                        "note": "自動で"
                    },
                    "them": {
                        "mark": "no",
                        "note": "別個のデータファイルが必要"
                    }
                },
                {
                    "dimension": "ライブマップ",
                    "us": {
                        "mark": "yes",
                        "note": "キー不要、内蔵"
                    },
                    "them": {
                        "mark": "no",
                        "note": "ライブマップなし — トラックの線＋手動スクリーンショット"
                    }
                },
                {
                    "dimension": "カスタムなゲージオーバーレイ",
                    "us": {
                        "mark": "partial",
                        "note": "速度、GPS、ミニマップ"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "豊富なゲージのライブラリ＋エディタ"
                    }
                }
            ],
            "whenStayTitle": "DashWare が依然として理にかなうとき",
            "whenStay": "DashWare の強みは、そのゲージエディタと、データロガー（GPS、心拍数、回転数、ラップタイマー）から供給される、アクションスポーツやレースの制作者向けの豊富なカスタマイズ可能なゲージのライブラリでした。そういうワークフローを持ち、Windows を使っていて、メンテナンスされていないソフトでも気にしないなら、そのオーバーレイエディタは dashcamigo にはできないことを今もできます。dashcamigo はゲージ作成ツールではありません — 埋め込みGPSを読み取り、本物のライブマップを表示する、更新中のブラウザ・ドラレコビューアであり、それはまさに DashWare が一度も持たなかったものです。",
            "ctaPrimary": "録画を開く",
            "faq": [
                {
                    "q": "DashWare はまだ更新されていますか？",
                    "a": "いいえ。GoPro は2017年に DashWare の更新を止めました。実質的に放置されており、新しい GoPro カメラからのGPS読み取りすら失敗します。dashcamigo は活発に開発されています。"
                },
                {
                    "q": "dashcamigo は DashWare のようなテレメトリ・オーバーレイをしますか？",
                    "a": "部分的に。dashcamigo はエクスポートするクリップに速度・座標・ミニマップのオーバーレイを焼き込めますが、DashWare の豊富なカスタムゲージのライブラリやそのゲージエディタは備えていません。ドラレコGPSをライブマップとチャート上で読み取って表示することに注力しており、それは DashWare がドラレコのカードからはできないことです。"
                },
                {
                    "q": "なぜ DashWare にはマップがないのですか？",
                    "a": "設計上です — DashWare はライブマップを一度も埋め込んでおらず（FAQは map-API のライセンス費用を理由に挙げています）、描くのは2Dのトラックの線だけです。マップの背景を得るには、Google や Bing をスクリーンショットして手動で重ねる必要があります。dashcamigo は、本物のインタラクティブでキー不要のマップ（MapLibre + OpenFreeMap）を内蔵しています。"
                },
                {
                    "q": "Mac やブラウザで動きますか？",
                    "a": "dashcamigo は Windows、macOS、Linux、モバイルの最新ブラウザならどれでも動きます。DashWare は Windows専用で、Mac では Windows の仮想マシンが必要です。"
                },
                {
                    "q": "私の映像はアップロードされますか？",
                    "a": "いいえ。dashcamigo はデバイス上のファイルを直接読み取ります — 何もアップロードされません。DashWare もローカルで動きます。どちらも映像をあなたのマシン内に保ちます。"
                }
            ]
        },
        "ko": {
            "title": "DashWare 대안 — 무료, 유지보수 중, 브라우저에서 | dashcamigo",
            "metaDescription": "DashWare는 무료지만 방치된(2017) Windows 전용 텔레메트리 도구로 실시간 지도가 없습니다. dashcamigo는 블랙박스 GPS를 읽고 진짜 지도를 보여주는, 유지보수되는 브라우저 대안입니다.",
            "ogTitle": "DashWare 대안 — 유지보수 중, 브라우저에서",
            "ogDescription": "DashWare는 2017년 이후 업데이트가 없고 Windows 전용이며 실시간 지도가 없습니다. dashcamigo는 블랙박스 GPS를 읽고 키 없는 진짜 지도를 보여줍니다 — 무료로, 브라우저에서.",
            "h1": "유지보수되는 브라우저 기반 DashWare 대안 — 진짜 지도와 함께",
            "lead": "DashWare는 인기 있던 무료 텔레메트리 오버레이 도구였지만, GoPro가 2017년 이후 업데이트를 중단했고, Windows 전용이며, 진짜 인앱 지도가 한 번도 없었습니다 — 수동으로 찍은 지도 스크린샷 위에 트랙 선을 겹쳐 올리는 정도였죠. dashcamigo는 블랙박스 영상을 위한, 유지보수되는 브라우저 대안입니다 — 카드에서 GPS를 읽어 속도와 G 포스 차트와 함께 실시간 키 없는 지도를 보여줍니다. 다만 맞춤형 게이지 오버레이를 만드는 일이라면 DashWare의 에디터는 여전히 종류가 다른 도구입니다.",
            "cardHint": "무료지만 방치됨(2017), Windows 전용, 실시간 지도 없음",
            "whatItIs": "GoPro에 인수된 DashWare는 무료 Windows 텔레메트리 오버레이 에디터입니다 — 영상과 별도의 데이터 로그(GPS, 심박수, RPM)를 가져오면 다양한 맞춤형 게이지 라이브러리를 영상에 입혀 줍니다. 게이지 에디터와 폭넓은 데이터 로거 지원이 강점이었죠. 하지만 개발은 2017년에 멈췄습니다 — 유지보수되지 않고, Windows 전용이며(Mac은 가상 머신이 필요), 소비자용 블랙박스의 내장 GPS를 읽지 못하고(영상은 그저 배경 레이어일 뿐), 심지어 최신 GoPro 모델에서도 GPS를 추출하지 못합니다. 그 \"지도\"는 지도 타일이 없는 2D 트랙 선이며, DashWare 자체 FAQ는 Google이나 Bing을 스크린샷으로 찍어 수동으로 겹쳐 올리라고 안내합니다.",
            "comparisonIntro": "DashWare와 dashcamigo는 서로 다른 일을 하지만, 지도와 함께 블랙박스 영상을 보는 일이라면 둘이 어떻게 나란히 서는지 보세요.",
            "compareRows": [
                {
                    "dimension": "가격",
                    "us": {
                        "mark": "yes",
                        "note": "무료"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "무료"
                    }
                },
                {
                    "dimension": "지금도 유지보수됨",
                    "us": {
                        "mark": "yes",
                        "note": "활발히 개발 중"
                    },
                    "them": {
                        "mark": "no",
                        "note": "2017년 이후 방치됨"
                    }
                },
                {
                    "dimension": "Mac, Linux, 모바일에서 실행",
                    "us": {
                        "mark": "yes",
                        "note": "최신 브라우저 어디서나"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Windows 전용(Mac은 VM 경유)"
                    }
                },
                {
                    "dimension": "실행 방식",
                    "us": {
                        "mark": "yes",
                        "note": "브라우저에서"
                    },
                    "them": {
                        "mark": "no",
                        "note": "데스크톱 설치(.exe)"
                    }
                },
                {
                    "dimension": "카드에서 블랙박스 GPS 읽기",
                    "us": {
                        "mark": "yes",
                        "note": "자동으로"
                    },
                    "them": {
                        "mark": "no",
                        "note": "별도의 데이터 파일 필요"
                    }
                },
                {
                    "dimension": "실시간 지도",
                    "us": {
                        "mark": "yes",
                        "note": "키 없음, 내장"
                    },
                    "them": {
                        "mark": "no",
                        "note": "실시간 지도 없음 — 트랙 선 + 수동 스크린샷"
                    }
                },
                {
                    "dimension": "맞춤형 게이지 오버레이",
                    "us": {
                        "mark": "partial",
                        "note": "속도, GPS, 미니맵"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "다양한 게이지 라이브러리 + 에디터"
                    }
                }
            ],
            "whenStayTitle": "그래도 DashWare가 합리적일 때",
            "whenStay": "DashWare의 강점은 게이지 에디터와 액션 스포츠·레이싱 제작자를 위한 다양한 맞춤형 게이지 라이브러리였으며, 데이터 로거(GPS, 심박수, RPM, 랩 타이머)에서 데이터를 공급받았습니다. 그런 워크플로를 가지고 있고, Windows를 쓰며, 유지보수되지 않는 소프트웨어가 괜찮다면, 그 오버레이 에디터는 여전히 dashcamigo가 하지 못하는 일을 해냅니다. dashcamigo는 게이지를 만드는 도구가 아닙니다 — 내장 GPS를 읽어 진짜 실시간 지도를 보여주는, 유지보수되는 브라우저 기반 블랙박스 뷰어이며, 이것이야말로 DashWare에는 한 번도 없던 것입니다.",
            "ctaPrimary": "내 녹화 영상 열기",
            "faq": [
                {
                    "q": "DashWare는 지금도 업데이트되나요?",
                    "a": "아니요. GoPro는 2017년에 DashWare 업데이트를 중단했습니다. 사실상 방치되었고, 심지어 최신 GoPro 카메라에서도 GPS를 읽지 못합니다. dashcamigo는 활발히 개발 중입니다."
                },
                {
                    "q": "dashcamigo도 DashWare처럼 텔레메트리 오버레이를 하나요?",
                    "a": "부분적으로요. dashcamigo는 내보내는 클립에 속도, 좌표, 미니맵 오버레이를 입힐 수 있지만, DashWare의 다양한 맞춤형 게이지 라이브러리나 게이지 에디터는 없습니다. dashcamigo는 블랙박스 GPS를 읽어 실시간 지도와 차트에 보여주는 데 집중하며, 이는 DashWare가 블랙박스 카드에서는 하지 못하는 일입니다."
                },
                {
                    "q": "DashWare에는 왜 지도가 없나요?",
                    "a": "설계상 그렇습니다 — DashWare는 실시간 지도를 한 번도 내장한 적이 없고(FAQ에서 지도 API 라이선스 비용을 이유로 듭니다) 2D 트랙 선만 그립니다. 지도 배경을 얻으려면 Google이나 Bing을 스크린샷으로 찍어 수동으로 겹쳐 올려야 하죠. dashcamigo에는 진짜 인터랙티브 키 없는 지도(MapLibre + OpenFreeMap)가 내장되어 있습니다."
                },
                {
                    "q": "Mac이나 브라우저에서 돌아가나요?",
                    "a": "dashcamigo는 Windows, macOS, Linux, 모바일의 모든 최신 브라우저에서 돌아갑니다. DashWare는 Windows 전용이고, Mac에서는 Windows 가상 머신이 필요합니다."
                },
                {
                    "q": "제 영상이 업로드되나요?",
                    "a": "아니요. dashcamigo는 기기의 파일을 직접 읽습니다 — 아무것도 업로드되지 않습니다. DashWare도 로컬이며, 둘 다 영상을 사용자의 기기에 둡니다."
                }
            ]
        },
        "pl": {
            "title": "Alternatywa dla DashWare — darmowa, rozwijana, w przeglądarce | dashcamigo",
            "metaDescription": "DashWare jest darmowy, ale porzucony (2017) i tylko na Windows. dashcamigo to rozwijana alternatywa w przeglądarce: czyta GPS i pokazuje prawdziwą mapę.",
            "ogTitle": "Alternatywa dla DashWare — rozwijana, w przeglądarce",
            "ogDescription": "DashWare nie był aktualizowany od 2017, działa tylko na Windows i nie ma żywej mapy. dashcamigo czyta GPS z wideorejestratora i pokazuje prawdziwą mapę bez kluczy — za darmo, w przeglądarce.",
            "h1": "Rozwijana, działająca w przeglądarce alternatywa dla DashWare — z prawdziwą mapą",
            "lead": "DashWare był popularnym, darmowym narzędziem do nakładek telemetrii, ale GoPro przestało go aktualizować po 2017 roku, działa tylko na Windows i nigdy nie miał prawdziwej wbudowanej mapy — jedynie linię trasy nakładaną na ręcznie zrobiony zrzut ekranu mapy. dashcamigo to rozwijana, działająca w przeglądarce alternatywa dla nagrań z wideorejestratora: czyta GPS z karty i pokazuje żywą mapę bez kluczy wraz z wykresem prędkości i przeciążeń. Do budowania własnych nakładek wskaźników edytor DashWare to jednak wciąż narzędzie innego rodzaju.",
            "cardHint": "Darmowy, ale porzucony (2017), tylko Windows, bez żywej mapy",
            "whatItIs": "DashWare, przejęty przez GoPro, to darmowy edytor nakładek telemetrii na Windows: przynosisz wideo plus osobny log danych (GPS, tętno, obroty), a on wypala na materiale obszerną bibliotekę konfigurowalnych wskaźników. Jego siłą był edytor wskaźników i szerokie wsparcie loggerów danych. Ale rozwój zatrzymał się w 2017 roku — jest nierozwijany, działa tylko na Windows (na Macu potrzebna jest maszyna wirtualna), nie czyta wbudowanego GPS z konsumenckich wideorejestratorów (wideo jest dla niego tylko warstwą tła), a nawet nie potrafi wyciągnąć GPS z nowszych modeli GoPro. Jego „mapa” to dwuwymiarowa linia trasy bez kafelków mapy; własny FAQ DashWare radzi zrobić zrzut ekranu z Google lub Bing i podłożyć go ręcznie.",
            "comparisonIntro": "DashWare i dashcamigo robią różne rzeczy, ale jeśli chodzi o oglądanie nagrań z wideorejestratora z mapą, oto jak wypadają obok siebie.",
            "compareRows": [
                {
                    "dimension": "Cena",
                    "us": {
                        "mark": "yes",
                        "note": "Za darmo"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Za darmo"
                    }
                },
                {
                    "dimension": "Wciąż rozwijany",
                    "us": {
                        "mark": "yes",
                        "note": "Aktywnie rozwijany"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Porzucony od 2017"
                    }
                },
                {
                    "dimension": "Działa na Mac, Linux i mobilnym",
                    "us": {
                        "mark": "yes",
                        "note": "Dowolna nowoczesna przeglądarka"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Tylko Windows (Mac przez maszynę wirtualną)"
                    }
                },
                {
                    "dimension": "Jak się uruchamia",
                    "us": {
                        "mark": "yes",
                        "note": "W przeglądarce"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Instalacja na desktop (.exe)"
                    }
                },
                {
                    "dimension": "Czyta GPS z wideorejestratora prosto z karty",
                    "us": {
                        "mark": "yes",
                        "note": "Automatycznie"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Wymaga osobnego pliku z danymi"
                    }
                },
                {
                    "dimension": "Żywa mapa",
                    "us": {
                        "mark": "yes",
                        "note": "Bez kluczy, wbudowana"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Brak żywej mapy — linia trasy + ręczny zrzut ekranu"
                    }
                },
                {
                    "dimension": "Własne nakładki wskaźników",
                    "us": {
                        "mark": "partial",
                        "note": "Prędkość, GPS, minimapa"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Obszerna biblioteka wskaźników + edytor"
                    }
                }
            ],
            "whenStayTitle": "Kiedy DashWare wciąż ma sens",
            "whenStay": "Siłą DashWare był jego edytor wskaźników i obszerna biblioteka konfigurowalnych wskaźników dla twórców sportów ekstremalnych i wyścigów, zasilanych z loggerów danych (GPS, tętno, obroty, pomiar okrążeń). Jeśli masz taki workflow, pracujesz na Windows i nie przeszkadza Ci nierozwijane oprogramowanie, jego edytor nakładek wciąż robi rzeczy, których nie robi dashcamigo. dashcamigo nie jest narzędziem do tworzenia wskaźników — to rozwijana, działająca w przeglądarce przeglądarka wideorejestratora, która czyta wbudowany GPS i pokazuje prawdziwą żywą mapę, czyli dokładnie to, czego DashWare nigdy nie miał.",
            "ctaPrimary": "Otwórz swoje nagrania",
            "faq": [
                {
                    "q": "Czy DashWare jest jeszcze aktualizowany?",
                    "a": "Nie. GoPro przestało aktualizować DashWare w 2017 roku; jest praktycznie porzucony i nawet z nowszych kamer GoPro nie czyta GPS. dashcamigo jest aktywnie rozwijany."
                },
                {
                    "q": "Czy dashcamigo robi nakładki telemetrii jak DashWare?",
                    "a": "Częściowo. dashcamigo potrafi wypalić na eksportowanym klipie nakładkę z prędkością, współrzędnymi i minimapą, ale nie ma obszernej biblioteki wskaźników DashWare ani jego edytora wskaźników. Skupia się na czytaniu i pokazywaniu GPS z wideorejestratora na żywej mapie i wykresie, czego DashWare nie potrafi zrobić z karty wideorejestratora."
                },
                {
                    "q": "Dlaczego DashWare nie ma mapy?",
                    "a": "Z założenia — DashWare nigdy nie wbudował żywej mapy (jego FAQ powołuje się na koszt licencji map-API) i rysuje tylko dwuwymiarową linię trasy; aby uzyskać tło mapy, trzeba zrobić zrzut ekranu z Google lub Bing i podłożyć go ręcznie. dashcamigo ma wbudowaną prawdziwą, interaktywną mapę bez kluczy (MapLibre + OpenFreeMap)."
                },
                {
                    "q": "Czy działa na Macu albo w przeglądarce?",
                    "a": "dashcamigo działa w dowolnej nowoczesnej przeglądarce na Windows, macOS, Linuksie i mobilnym. DashWare działa tylko na Windows; na Macu potrzebuje wirtualnej maszyny z Windows."
                },
                {
                    "q": "Czy moje nagrania będą wysyłane gdziekolwiek?",
                    "a": "Nie. dashcamigo odczytuje pliki bezpośrednio z twojego urządzenia — nic nie jest wysyłane. DashWare również działa lokalnie; oba trzymają Twoje nagrania na Twoim komputerze."
                }
            ]
        },
        "pt": {
            "title": "Alternativa ao DashWare — gratuita, atualizada, no seu navegador | dashcamigo",
            "metaDescription": "O DashWare é gratuito, mas abandonado (2017) e só para Windows. O dashcamigo é a alternativa atualizada, no navegador: lê o GPS e mostra um mapa de verdade.",
            "ogTitle": "Alternativa ao DashWare — atualizada, no navegador",
            "ogDescription": "O DashWare não recebe atualizações desde 2017, é só para Windows e não tem mapa ao vivo. O dashcamigo lê o GPS da dashcam e mostra um mapa de verdade sem chave — grátis, no navegador.",
            "h1": "Uma alternativa ao DashWare atualizada e no navegador — com um mapa de verdade",
            "lead": "O DashWare foi uma ferramenta de overlay de telemetria gratuita e popular, mas a GoPro parou de atualizá-la depois de 2017, ela é só para Windows, e nunca teve um mapa de verdade no app — apenas uma linha de trajeto que você sobrepunha a uma captura de tela de mapa feita manualmente. O dashcamigo é a alternativa atualizada, no navegador, para gravações de dashcam: ele lê o GPS direto do cartão e mostra um mapa ao vivo sem chave com um gráfico de velocidade e força G. Para montar overlays de medidores personalizados, porém, o editor do DashWare ainda é um tipo de ferramenta diferente.",
            "cardHint": "Gratuita, mas abandonada (2017), só para Windows, sem mapa ao vivo",
            "whatItIs": "O DashWare, adquirido pela GoPro, é um editor de overlay de telemetria gratuito para Windows: você traz um vídeo mais um log de dados separado (GPS, frequência cardíaca, RPM) e ele grava uma ampla biblioteca de medidores personalizáveis sobre a gravação. Seu editor de medidores e o amplo suporte a registradores de dados eram a força dele. Mas o desenvolvimento parou em 2017 — está sem manutenção, é só para Windows (no Mac precisa de uma máquina virtual), não lê o GPS embutido de dashcams de consumo (o vídeo é apenas uma camada de fundo), e até falha em extrair o GPS de modelos GoPro mais novos. Seu \"mapa\" é uma linha de trajeto em 2D sem tiles de mapa; o próprio FAQ do DashWare manda você fazer uma captura de tela do Google ou do Bing e sobrepô-la manualmente.",
            "comparisonIntro": "O DashWare e o dashcamigo fazem trabalhos diferentes, mas para visualizar gravações de dashcam com um mapa, veja como eles se comparam.",
            "compareRows": [
                {
                    "dimension": "Preço",
                    "us": {
                        "mark": "yes",
                        "note": "Grátis"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Grátis"
                    }
                },
                {
                    "dimension": "Ainda recebe manutenção",
                    "us": {
                        "mark": "yes",
                        "note": "Em desenvolvimento ativo"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Abandonado desde 2017"
                    }
                },
                {
                    "dimension": "Roda no Mac, Linux e celular",
                    "us": {
                        "mark": "yes",
                        "note": "Qualquer navegador moderno"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Só para Windows (Mac via VM)"
                    }
                },
                {
                    "dimension": "Como você roda",
                    "us": {
                        "mark": "yes",
                        "note": "No navegador"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Instalação no desktop (.exe)"
                    }
                },
                {
                    "dimension": "Lê o GPS da dashcam direto do cartão",
                    "us": {
                        "mark": "yes",
                        "note": "Automaticamente"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Precisa de um arquivo de dados separado"
                    }
                },
                {
                    "dimension": "Mapa ao vivo",
                    "us": {
                        "mark": "yes",
                        "note": "Sem chave, integrado"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Sem mapa ao vivo — linha de trajeto + captura de tela manual"
                    }
                },
                {
                    "dimension": "Overlays de medidores personalizados",
                    "us": {
                        "mark": "partial",
                        "note": "Velocidade, GPS, minimapa"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Ampla biblioteca de medidores + editor"
                    }
                }
            ],
            "whenStayTitle": "Quando o DashWare ainda faz sentido",
            "whenStay": "A força do DashWare era seu editor de medidores e sua ampla biblioteca de medidores personalizáveis para criadores de esportes de ação e corrida, alimentados por registradores de dados (GPS, frequência cardíaca, RPM, cronômetros de volta). Se você tem esse tipo de fluxo de trabalho, está no Windows e não se incomoda com software sem manutenção, o editor de overlay dele ainda faz coisas que o dashcamigo não faz. O dashcamigo não é uma ferramenta de autoria de medidores — é um visualizador de dashcam atualizado, no navegador, que lê o GPS embutido e mostra um mapa ao vivo de verdade, que é exatamente o que o DashWare nunca teve.",
            "ctaPrimary": "Abra suas gravações",
            "faq": [
                {
                    "q": "O DashWare ainda é atualizado?",
                    "a": "Não. A GoPro parou de atualizar o DashWare em 2017; ele está efetivamente abandonado e até falha em ler o GPS de câmeras GoPro mais novas. O dashcamigo está em desenvolvimento ativo."
                },
                {
                    "q": "O dashcamigo faz overlays de telemetria como o DashWare?",
                    "a": "Em parte. O dashcamigo pode gravar um overlay de velocidade, coordenadas e minimapa em um clipe exportado, mas não tem a ampla biblioteca de medidores do DashWare nem o seu editor de medidores. Ele foca em ler e mostrar o GPS da dashcam em um mapa ao vivo e um gráfico, o que o DashWare não consegue fazer a partir de um cartão de dashcam."
                },
                {
                    "q": "Por que o DashWare não tem mapa?",
                    "a": "É por design — o DashWare nunca embutiu um mapa ao vivo (seu FAQ cita o custo de licenciamento da API de mapas) e só desenha uma linha de trajeto em 2D; para ter um fundo de mapa, você tem que fazer uma captura de tela do Google ou do Bing e sobrepô-la manualmente. O dashcamigo tem um mapa de verdade, interativo e sem chave (MapLibre + OpenFreeMap) integrado."
                },
                {
                    "q": "Ele roda no Mac ou no navegador?",
                    "a": "O dashcamigo roda em qualquer navegador moderno no Windows, macOS, Linux e celular. O DashWare é só para Windows; em um Mac, ele precisa de uma máquina virtual com Windows."
                },
                {
                    "q": "Minha gravação será enviada?",
                    "a": "Não. O dashcamigo lê os arquivos direto do seu dispositivo — nada é enviado. O DashWare também é local; ambos mantêm sua gravação na sua máquina."
                }
            ]
        },
        "zh": {
            "title": "DashWare 替代方案 — 免费、持续维护、在浏览器里运行 | dashcamigo",
            "metaDescription": "DashWare 是一款免费但已停止维护（2017）、仅限 Windows、没有实时地图的遥测工具。dashcamigo 是持续维护、在浏览器里运行的替代方案，读取行车记录仪 GPS 并显示真正的地图。",
            "ogTitle": "DashWare 替代方案 — 持续维护，在浏览器里运行",
            "ogDescription": "DashWare 自 2017 年起未再更新，仅限 Windows 且没有实时地图。dashcamigo 读取行车记录仪 GPS 并显示真正的无密钥地图 — 免费，在浏览器里。",
            "h1": "持续维护、在浏览器里运行的 DashWare 替代方案 — 带一张真正的地图",
            "lead": "DashWare 曾是一款流行的免费遥测叠加工具，但 GoPro 在 2017 年后停止了更新，它仅限 Windows，而且从来没有真正的应用内地图 — 只有一条轨迹线，需要你叠在手动截取的地图截图之上。dashcamigo 是面向行车记录仪素材、持续维护、在浏览器里运行的替代方案：它从存储卡读取 GPS，并显示一张实时、无需密钥的地图，配有速度与 G 力图表。不过，论构建自定义仪表叠加，DashWare 的编辑器仍是另一类工具。",
            "cardHint": "免费但已停止维护（2017），仅限 Windows，没有实时地图",
            "whatItIs": "DashWare 被 GoPro 收购，是一款免费的 Windows 遥测叠加编辑器：你提供一段视频外加一份独立的数据日志（GPS、心率、转速），它便把丰富的可自定义仪表库烧录到画面上。它的仪表编辑器和广泛的数据记录器支持是其强项。但开发在 2017 年就停了下来 — 它已无人维护，仅限 Windows（Mac 需要虚拟机），它不读取消费级行车记录仪的内嵌 GPS（对它而言视频只是一个背景图层），甚至从较新的 GoPro 型号上也提取不到 GPS。它的“地图”是一条没有地图瓦片的 2D 轨迹线；DashWare 自己的 FAQ 让你截图 Google 或 Bing 再手动叠加。",
            "comparisonIntro": "DashWare 和 dashcamigo 做的是不同的工作，但就带地图查看行车记录仪素材而言，下面是它们的对比。",
            "compareRows": [
                {
                    "dimension": "价格",
                    "us": {
                        "mark": "yes",
                        "note": "免费"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "免费"
                    }
                },
                {
                    "dimension": "仍在维护",
                    "us": {
                        "mark": "yes",
                        "note": "积极开发中"
                    },
                    "them": {
                        "mark": "no",
                        "note": "自 2017 年起已停止维护"
                    }
                },
                {
                    "dimension": "可在 Mac、Linux 和移动端运行",
                    "us": {
                        "mark": "yes",
                        "note": "任何现代浏览器"
                    },
                    "them": {
                        "mark": "no",
                        "note": "仅限 Windows（Mac 需通过虚拟机）"
                    }
                },
                {
                    "dimension": "运行方式",
                    "us": {
                        "mark": "yes",
                        "note": "在浏览器里"
                    },
                    "them": {
                        "mark": "no",
                        "note": "桌面安装（.exe）"
                    }
                },
                {
                    "dimension": "从存储卡读取行车记录仪 GPS",
                    "us": {
                        "mark": "yes",
                        "note": "自动"
                    },
                    "them": {
                        "mark": "no",
                        "note": "需要一份独立的数据文件"
                    }
                },
                {
                    "dimension": "实时地图",
                    "us": {
                        "mark": "yes",
                        "note": "无需密钥，内置"
                    },
                    "them": {
                        "mark": "no",
                        "note": "没有实时地图 — 轨迹线 + 手动截图"
                    }
                },
                {
                    "dimension": "自定义仪表叠加",
                    "us": {
                        "mark": "partial",
                        "note": "速度、GPS、小地图"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "丰富的仪表库 + 编辑器"
                    }
                }
            ],
            "whenStayTitle": "什么时候 DashWare 仍然有意义",
            "whenStay": "DashWare 的强项是它的仪表编辑器和面向极限运动与赛车创作者的丰富可自定义仪表库，数据来自数据记录器（GPS、心率、转速、圈速计时器）。如果你有这类工作流，又在 Windows 上，且不介意无人维护的软件，它的叠加编辑器仍能做到 dashcamigo 做不到的事。dashcamigo 不是一款仪表创作工具 — 它是一款持续维护、在浏览器里运行的行车记录仪查看器，读取内嵌 GPS 并显示一张真正的实时地图，而这正是 DashWare 从来没有过的。",
            "ctaPrimary": "打开你的录像",
            "faq": [
                {
                    "q": "DashWare 还在更新吗？",
                    "a": "没有了。GoPro 在 2017 年停止更新 DashWare；它实际上已被弃置，甚至读取不到较新 GoPro 相机的 GPS。dashcamigo 在积极开发中。"
                },
                {
                    "q": "dashcamigo 像 DashWare 那样做遥测叠加吗？",
                    "a": "部分能。dashcamigo 可以把速度、坐标和小地图叠加烧录到导出的片段上，但它没有 DashWare 丰富的自定义仪表库，也没有它的仪表编辑器。它专注于读取并在实时地图和图表上显示行车记录仪 GPS，而这是 DashWare 从行车记录仪存储卡上做不到的。"
                },
                {
                    "q": "为什么 DashWare 没有地图？",
                    "a": "这是设计如此 — DashWare 从未内嵌实时地图（其 FAQ 提到地图 API 的授权费用），只画一条 2D 轨迹线；要得到地图背景，你得截图 Google 或 Bing 再手动叠加。dashcamigo 内置了一张真正的、交互式的、无需密钥的地图（MapLibre + OpenFreeMap）。"
                },
                {
                    "q": "它能在 Mac 上或浏览器里运行吗？",
                    "a": "dashcamigo 在 Windows、macOS、Linux 和移动端的任何现代浏览器里都能运行。DashWare 仅限 Windows；在 Mac 上需要一台 Windows 虚拟机。"
                },
                {
                    "q": "我的素材会被上传吗？",
                    "a": "不会。dashcamigo 会直接读取你设备上的文件 — 什么都不会上传。DashWare 也是本地运行的；两者都把你的素材留在你自己的机器上。"
                }
            ]
        }
    },
    "racerender": {
        "de": {
            "title": "RaceRender-Alternative — kostenlos, ohne Wasserzeichen, im Browser | dashcamigo",
            "metaDescription": "RaceRenders Gratis-Stufe stempelt ein Logo ein und begrenzt Clips auf 3 Minuten. dashcamigo zeigt Dashcam-GPS auf einer Live-Karte — kostenlos, ohne Wasserzeichen.",
            "ogTitle": "Kostenlose RaceRender-Alternative für Dashcam-Aufnahmen",
            "ogDescription": "RaceRender ist ein Desktop-Editor für Motorsport-Overlays (kostenlose Stufe: Logo + 3-Min-Limit). Für Dashcam-Aufnahmen liest dashcamigo das GPS und zeigt eine Live-Karte kostenlos, im Browser.",
            "h1": "Eine kostenlose RaceRender-Alternative im Browser — für Dashcam-Aufnahmen",
            "lead": "RaceRender ist ein fähiges Desktop-Tool zum Bauen von Motorsport-Telemetrievideos — aber seine kostenlose Edition stempelt ein Logo ein und begrenzt die Ausgabe auf drei Minuten, die vollständige Entfernung erfordert eine kostenpflichtige Lizenz, und meist erwartet es eine separate Datenlogger-Datei. Für Dashcam-Aufnahmen liest dashcamigo das GPS direkt von der Karte und zeigt eine schlüssellose Live-Karte mit einem Geschwindigkeits- und G-Kraft-Diagramm, kostenlos und in deinem Browser, ohne Wasserzeichen und ohne Längenbegrenzung. Für tiefgehende Rennsport-Overlay-Produktion geht RaceRender weiter.",
            "cardHint": "Desktop-Editor für Rennsport-Overlays; kostenlose Stufe hat Logo + 3-Min-Limit",
            "whatItIs": "RaceRender (von HP Tuners) ist eine Desktop-Anwendung für Windows und macOS, die Telemetrie-Overlays zusammenstellt — Anzeigen, Karten, Multi-Kamera-Layouts — und ein fertiges Motorsport-Video rendert. Es ist kamera- und datenquellenunabhängig (GoPro, VIRB, Sony sowie CSV-, VBO-, NMEA-, GPX-, FIT-Logs) und für Trackday- und Rennsport-Creator gebaut, üblicherweise gepaart mit einer Logging-App wie TrackAddict oder Harry's LapTimer. Es ist freemium und einmalig: Die kostenlose Edition stempelt ein RaceRender-Logo ein und begrenzt die Ausgabe auf 3 Minuten; das Logo vollständig zu entfernen erfordert die kostenpflichtige Edition. Seine Streckenkarte ist eine lokale Linie, gezeichnet aus den Daten — es gibt keine eingebaute interaktive Basiskarte.",
            "comparisonIntro": "RaceRender ist ein Editor für Rennsport-Overlays; dashcamigo ist ein Dashcam-Viewer. Für das Anschauen von Dashcam-Aufnahmen mit einer Karte sieht die Aufteilung so aus.",
            "compareRows": [
                {
                    "dimension": "Preis",
                    "us": {
                        "mark": "yes",
                        "note": "Kostenlos"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Kostenlose Stufe (Logo + 3-Min-Limit); kostenpflichtiges Einmal-Upgrade"
                    }
                },
                {
                    "dimension": "Wasserzeichen auf kostenloser Ausgabe",
                    "us": {
                        "mark": "yes",
                        "note": "Keines"
                    },
                    "them": {
                        "mark": "no",
                        "note": "RaceRender-Logo (nur in der kostenpflichtigen Edition entfernt)"
                    }
                },
                {
                    "dimension": "Wie du es nutzt",
                    "us": {
                        "mark": "yes",
                        "note": "Im Browser"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Desktop-Installation (Windows/Mac)"
                    }
                },
                {
                    "dimension": "Läuft auf Mobilgeräten",
                    "us": {
                        "mark": "yes",
                        "note": "Ja"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Nur Desktop"
                    }
                },
                {
                    "dimension": "Liest Dashcam-GPS von der Karte",
                    "us": {
                        "mark": "yes",
                        "note": "Automatisch"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Erwartet eine separate Datendatei"
                    }
                },
                {
                    "dimension": "Eingebaute interaktive Karte",
                    "us": {
                        "mark": "yes",
                        "note": "Schlüssellose Live-Karte"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Lokale Tracklinie, keine Basiskarte"
                    }
                },
                {
                    "dimension": "Tiefe der Rennsport-Overlay-Produktion",
                    "us": {
                        "mark": "partial",
                        "note": "Einfaches Geschwindigkeits-/GPS-Overlay"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Rundenzeiten, Multi-Kamera, 4K"
                    }
                }
            ],
            "whenStayTitle": "Wann RaceRender das bessere Tool ist",
            "whenStay": "RaceRender ist dafür gebaut, ausgefeilte Motorsport-Videos zu produzieren: Runden- und Vorhersage-Timing, ein eigener Anzeigen-Designer, Multi-Kamera-Compositing, 360-Video und Ausgabe bis zu 4K gehen weit über dashcamigo hinaus. Wenn du einen Trackday- oder Rennsport-Schnitt machst und eine Datenlogger-Datei hast, ist es das richtige Tool (und die einmalige Lizenz ist überschaubar). dashcamigo ist kein Rennvideo-Editor — es ist ein kostenloser Dashcam-Viewer im Browser, der eingebettetes GPS automatisch von der Karte liest und eine Live-Karte zeigt, ohne Installation und ohne Wasserzeichen.",
            "ctaPrimary": "Deine Aufnahmen öffnen",
            "faq": [
                {
                    "q": "Ist dashcamigo eine kostenlose RaceRender-Alternative?",
                    "a": "Für das Anschauen von Dashcam-Aufnahmen mit einer Karte und einem einfachen Overlay ja — und das ohne Wasserzeichen oder Längenbegrenzung, kostenlos, im Browser. Für die Motorsport-Produktion (Rundenzeiten, Multi-Kamera, eigene Anzeigen, 4K-Render) ist RaceRender weitaus fähiger; dashcamigo versucht gar nicht, das zu erreichen."
                },
                {
                    "q": "Fügt die kostenlose Version von RaceRender ein Wasserzeichen hinzu?",
                    "a": "Ja — die kostenlose Edition stempelt ein RaceRender-Logo ein und begrenzt die Ausgabe auf 3 Minuten; das Logo vollständig zu entfernen erfordert die kostenpflichtige Edition. dashcamigo fügt kein Wasserzeichen hinzu und hat keine Längenbegrenzung."
                },
                {
                    "q": "Kann RaceRender das GPS meiner Dashcam direkt lesen?",
                    "a": "Es liest GPS, das in manchen Action-Cam-Dateien eingebettet ist, aber für Dashcams erwartet es in der Regel eine separate Datenlogger-Datei, statt das GPS automatisch von der Karte zu extrahieren. dashcamigo liest gängige Dashcam-GPS-Formate automatisch, sobald du den Ordner hineinziehst."
                },
                {
                    "q": "Muss dashcamigo installiert werden?",
                    "a": "Nein — es läuft in jedem modernen Browser unter Windows, Mac, Linux und mobil. RaceRender ist eine Desktop-App für Windows und macOS, ohne Browser- oder Mobil-Version."
                },
                {
                    "q": "Hat RaceRender eine Live-Karte wie dashcamigo?",
                    "a": "RaceRender zeichnet eine Tracklinie lokal aus den GPS-Daten, aber es hat keine eingebaute interaktive Basiskarte (jeder Satellitenhintergrund ist ein statisches Bild, das du selbst lieferst). dashcamigo hat eine echte interaktive schlüssellose Karte (MapLibre + OpenFreeMap) eingebaut."
                }
            ]
        },
        "es": {
            "title": "Alternativa a RaceRender — gratis, sin marca de agua, en tu navegador | dashcamigo",
            "metaDescription": "El plan gratuito de RaceRender pone un logo y limita los clips a 3 minutos. dashcamigo muestra el GPS en un mapa en vivo en el navegador — gratis, sin marca de agua.",
            "ogTitle": "Alternativa gratis a RaceRender para dashcam",
            "ogDescription": "RaceRender es un editor de overlays de automovilismo para escritorio (gratis: logo + límite de 3 min). Para grabaciones de dashcam, dashcamigo lee el GPS y muestra un mapa en vivo gratis, en el navegador.",
            "h1": "Una alternativa a RaceRender gratuita y en el navegador — para grabaciones de dashcam",
            "lead": "RaceRender es una herramienta de escritorio capaz para crear vídeos de telemetría de automovilismo — pero su edición gratuita pone un logo y limita la salida a tres minutos, eliminarlo del todo requiere una licencia de pago, y normalmente espera un archivo de registrador de datos aparte. Para grabaciones de dashcam, dashcamigo lee el GPS directamente desde la tarjeta y muestra un mapa en vivo y sin claves con una gráfica de velocidad y fuerza G, gratis y en tu navegador, sin marca de agua y sin límite de duración. Para una producción profunda de overlays de carreras, RaceRender llega más lejos.",
            "cardHint": "Editor de overlays de carreras de escritorio; la versión gratis tiene logo + límite de 3 min",
            "whatItIs": "RaceRender (de HP Tuners) es una aplicación de escritorio para Windows y macOS que compone overlays de telemetría — indicadores, mapas, diseños multicámara — y renderiza un vídeo de automovilismo terminado. Es agnóstica respecto a la cámara y la fuente de datos (GoPro, VIRB, Sony, además de registros CSV, VBO, NMEA, GPX, FIT) y está hecha para creadores de track-days y carreras, normalmente combinada con una app de registro como TrackAddict o Harry's LapTimer. Es freemium y de pago único: la edición Free pone un logo de RaceRender y limita la salida a 3 minutos; eliminar el logo por completo requiere la edición de pago. Su mapa de circuito es una línea local dibujada a partir de los datos — no hay un mapa base interactivo integrado.",
            "comparisonIntro": "RaceRender es un editor de overlays de carreras; dashcamigo es un visor de dashcam. Para ver grabaciones de dashcam con un mapa, así se reparten los papeles.",
            "compareRows": [
                {
                    "dimension": "Precio",
                    "us": {
                        "mark": "yes",
                        "note": "Gratis"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Versión gratis (logo + límite de 3 min); actualización de pago único"
                    }
                },
                {
                    "dimension": "Marca de agua en la salida gratuita",
                    "us": {
                        "mark": "yes",
                        "note": "Ninguna"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Logo de RaceRender (se elimina solo en la edición de pago)"
                    }
                },
                {
                    "dimension": "Cómo se ejecuta",
                    "us": {
                        "mark": "yes",
                        "note": "En el navegador"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Instalación de escritorio (Windows/Mac)"
                    }
                },
                {
                    "dimension": "Funciona en móvil",
                    "us": {
                        "mark": "yes",
                        "note": "Sí"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Solo escritorio"
                    }
                },
                {
                    "dimension": "Lee el GPS de la dashcam desde la tarjeta",
                    "us": {
                        "mark": "yes",
                        "note": "Automáticamente"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Espera un archivo de datos aparte"
                    }
                },
                {
                    "dimension": "Mapa interactivo integrado",
                    "us": {
                        "mark": "yes",
                        "note": "Mapa en vivo sin claves"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Línea de circuito local, sin mapa base"
                    }
                },
                {
                    "dimension": "Profundidad de producción de overlays de carreras",
                    "us": {
                        "mark": "partial",
                        "note": "Overlay básico de velocidad/GPS"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Cronometraje de vueltas, multicámara, 4K"
                    }
                }
            ],
            "whenStayTitle": "Cuándo RaceRender es la mejor herramienta",
            "whenStay": "RaceRender está hecho para producir vídeos de automovilismo pulidos: cronometraje de vueltas y predictivo, un diseñador de indicadores personalizado, composición multicámara, vídeo 360 y salida de hasta 4K van mucho más allá de dashcamigo. Si estás montando un track-day o una edición de carreras y tienes un archivo de registrador de datos, es la herramienta correcta (y la licencia de pago único es modesta). dashcamigo no es un editor de vídeo de carreras — es un visor de dashcam gratuito y en el navegador que lee automáticamente el GPS incrustado desde la tarjeta y muestra un mapa en vivo, sin instalar y sin marca de agua.",
            "ctaPrimary": "Abre tus grabaciones",
            "faq": [
                {
                    "q": "¿Es dashcamigo una alternativa gratuita a RaceRender?",
                    "a": "Para ver grabaciones de dashcam con un mapa y un overlay básico, sí — y sin marca de agua ni límite de duración, gratis, en el navegador. Para la producción de automovilismo (cronometraje de vueltas, multicámara, indicadores personalizados, render en 4K), RaceRender es mucho más capaz; dashcamigo no intenta igualar eso."
                },
                {
                    "q": "¿La versión gratuita de RaceRender añade una marca de agua?",
                    "a": "Sí — la edición Free pone un logo de RaceRender y limita la salida a 3 minutos; eliminar el logo por completo requiere la edición de pago. dashcamigo no añade ninguna marca de agua y no tiene límite de duración."
                },
                {
                    "q": "¿Puede RaceRender leer el GPS de mi dashcam directamente?",
                    "a": "Lee el GPS incrustado en algunos archivos de cámaras de acción, pero para dashcams normalmente espera un archivo de registrador de datos aparte en lugar de extraer automáticamente el GPS desde la tarjeta. dashcamigo lee los formatos de GPS de dashcam más comunes automáticamente cuando sueltas la carpeta."
                },
                {
                    "q": "¿dashcamigo necesita instalación?",
                    "a": "No — funciona en cualquier navegador moderno en Windows, Mac, Linux y móvil. RaceRender es una app de escritorio para Windows y macOS, sin versión para navegador ni para móvil."
                },
                {
                    "q": "¿Tiene RaceRender un mapa en vivo como dashcamigo?",
                    "a": "RaceRender dibuja una línea de circuito localmente a partir de los datos de GPS, pero no tiene un mapa base interactivo integrado (cualquier fondo de satélite es una imagen estática que tú aportas). dashcamigo tiene un mapa real, interactivo y sin claves (MapLibre + OpenFreeMap) integrado."
                }
            ]
        },
        "fr": {
            "title": "Alternative à RaceRender — gratuite, sans filigrane, dans votre navigateur | dashcamigo",
            "metaDescription": "La version gratuite de RaceRender appose un logo et limite les clips à 3 minutes. dashcamigo affiche le GPS sur une carte en direct — gratuit, sans filigrane.",
            "ogTitle": "Alternative gratuite à RaceRender pour dashcam",
            "ogDescription": "RaceRender est un éditeur d'overlays de sport automobile pour le bureau (version gratuite : logo + limite de 3 min). Pour les vidéos de dashcam, dashcamigo lit le GPS et affiche une carte en direct gratuitement, dans le navigateur.",
            "h1": "Une alternative à RaceRender gratuite, dans le navigateur — pour les vidéos de dashcam",
            "lead": "RaceRender est un outil de bureau capable pour construire des vidéos de télémétrie de sport automobile — mais son édition gratuite appose un logo et limite la sortie à trois minutes, sa suppression complète nécessite une licence payante, et il attend généralement un fichier d'enregistreur de données séparé. Pour les vidéos de dashcam, dashcamigo lit le GPS directement sur la carte SD et affiche une carte en direct, sans clé, avec un graphique de vitesse et de force G, gratuitement et dans votre navigateur, sans filigrane et sans limite de durée. Pour la production poussée d'overlays de course, RaceRender va plus loin.",
            "cardHint": "Éditeur d'overlays de course pour le bureau ; la version gratuite a un logo + une limite de 3 min",
            "whatItIs": "RaceRender (de HP Tuners) est une application de bureau pour Windows et macOS qui compose des overlays de télémétrie — jauges, cartes, dispositions multi-caméras — et rend une vidéo de sport automobile finalisée. Il est indépendant de la caméra et de la source de données (GoPro, VIRB, Sony, plus les journaux CSV, VBO, NMEA, GPX, FIT) et il est conçu pour les créateurs de track-days et de course, généralement associé à une application d'enregistrement comme TrackAddict ou Harry's LapTimer. Il est freemium et en achat unique : l'édition gratuite appose un logo RaceRender et limite la sortie à 3 minutes ; supprimer entièrement le logo nécessite l'édition payante. Sa carte de circuit est une ligne locale tracée à partir des données — il n'y a pas de fond de carte interactif intégré.",
            "comparisonIntro": "RaceRender est un éditeur d'overlays de course ; dashcamigo est un lecteur de dashcam. Pour visionner des vidéos de dashcam avec une carte, voici comment les rôles se répartissent.",
            "compareRows": [
                {
                    "dimension": "Prix",
                    "us": {
                        "mark": "yes",
                        "note": "Gratuit"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Version gratuite (logo + limite de 3 min) ; mise à niveau payante unique"
                    }
                },
                {
                    "dimension": "Filigrane sur la sortie gratuite",
                    "us": {
                        "mark": "yes",
                        "note": "Aucun"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Logo RaceRender (supprimé uniquement dans l'édition payante)"
                    }
                },
                {
                    "dimension": "Comment on l'utilise",
                    "us": {
                        "mark": "yes",
                        "note": "Dans le navigateur"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Installation sur le bureau (Windows/Mac)"
                    }
                },
                {
                    "dimension": "Fonctionne sur mobile",
                    "us": {
                        "mark": "yes",
                        "note": "Oui"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Bureau uniquement"
                    }
                },
                {
                    "dimension": "Lit le GPS de la dashcam sur la carte SD",
                    "us": {
                        "mark": "yes",
                        "note": "Automatiquement"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Attend un fichier de données séparé"
                    }
                },
                {
                    "dimension": "Carte interactive intégrée",
                    "us": {
                        "mark": "yes",
                        "note": "Carte en direct, sans clé"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Ligne de trace locale, sans fond de carte"
                    }
                },
                {
                    "dimension": "Profondeur de production d'overlays de course",
                    "us": {
                        "mark": "partial",
                        "note": "Overlay vitesse/GPS basique"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Chronométrage de tours, multi-caméra, 4K"
                    }
                }
            ],
            "whenStayTitle": "Quand RaceRender est le meilleur outil",
            "whenStay": "RaceRender est conçu pour produire des vidéos de sport automobile soignées : chronométrage de tour et prédictif, concepteur de jauges personnalisées, compositing multi-caméras, vidéo 360 et sortie jusqu'en 4K vont bien au-delà de dashcamigo. Si vous réalisez un montage de track-day ou de course et que vous avez un fichier d'enregistreur de données, c'est le bon outil (et la licence en achat unique est modeste). dashcamigo n'est pas un éditeur de vidéos de course — c'est un lecteur de dashcam gratuit, dans le navigateur, qui lit automatiquement le GPS intégré sur la carte SD et affiche une carte en direct, sans installation et sans filigrane.",
            "ctaPrimary": "Ouvrir vos enregistrements",
            "faq": [
                {
                    "q": "dashcamigo est-il une alternative gratuite à RaceRender ?",
                    "a": "Pour visionner des vidéos de dashcam avec une carte et un overlay basique, oui — et sans filigrane ni limite de durée, gratuitement, dans le navigateur. Pour la production de sport automobile (chronométrage de tours, multi-caméra, jauges personnalisées, rendu 4K), RaceRender est bien plus capable ; dashcamigo ne cherche pas à l'égaler."
                },
                {
                    "q": "La version gratuite de RaceRender ajoute-t-elle un filigrane ?",
                    "a": "Oui — l'édition gratuite appose un logo RaceRender et limite la sortie à 3 minutes ; supprimer entièrement le logo nécessite l'édition payante. dashcamigo n'ajoute aucun filigrane et n'a pas de limite de durée."
                },
                {
                    "q": "RaceRender peut-il lire directement le GPS de ma dashcam ?",
                    "a": "Il lit le GPS intégré dans certains fichiers d'action-cam, mais pour les dashcams il attend généralement un fichier d'enregistreur de données séparé plutôt que d'extraire automatiquement le GPS sur la carte SD. dashcamigo lit automatiquement les formats GPS de dashcam courants dès que vous déposez le dossier."
                },
                {
                    "q": "dashcamigo a-t-il besoin d'être installé ?",
                    "a": "Non — il fonctionne dans tout navigateur moderne sur Windows, Mac, Linux et mobile. RaceRender est une application de bureau pour Windows et macOS, sans version navigateur ni mobile."
                },
                {
                    "q": "RaceRender a-t-il une carte en direct comme dashcamigo ?",
                    "a": "RaceRender trace une ligne de circuit localement à partir des données GPS, mais il n'a pas de fond de carte interactif intégré (tout arrière-plan satellite est une image statique que vous fournissez). dashcamigo intègre une vraie carte interactive sans clé (MapLibre + OpenFreeMap)."
                }
            ]
        },
        "ja": {
            "title": "RaceRender の代替 — 無料・ウォーターマークなし、ブラウザで | dashcamigo",
            "metaDescription": "RaceRender の無料版はロゴを刻印し、クリップを3分に制限します。ドラレコ映像なら、dashcamigo がカードからGPSを読み取り、ブラウザで無料でライブマップを表示します — ウォーターマークなし、インストールなし。",
            "ogTitle": "ドラレコ映像向け無料のRaceRender代替",
            "ogDescription": "RaceRender はデスクトップ用のモータースポーツ・オーバーレイエディタ（無料版：ロゴ＋3分制限）。ドラレコ映像なら、dashcamigo がGPSを読み取り、ブラウザで無料でライブマップを表示します。",
            "h1": "無料・ブラウザの RaceRender 代替 — ドラレコ映像のために",
            "lead": "RaceRender はモータースポーツのテレメトリ動画を組み立てる高機能なデスクトップツールですが、その無料エディションはロゴを刻印し、出力を3分に制限し、ロゴの完全な除去には有料ライセンスが必要で、たいてい別個のデータロガーのファイルを前提とします。ドラレコ映像なら、dashcamigo がカードから直接GPSを読み取り、速度とG値のチャート付きでキー不要のライブマップを、ブラウザで無料で、ウォーターマークも長さ制限もなく表示します。本格的なレースオーバーレイ制作なら、RaceRender はさらに先を行きます。",
            "cardHint": "デスクトップ用レースオーバーレイエディタ。無料版はロゴ＋3分制限あり",
            "whatItIs": "RaceRender（HP Tuners 製）は、Windows と macOS 向けのデスクトップアプリケーションで、テレメトリ・オーバーレイ — ゲージ、マップ、マルチカメラのレイアウト — を構成し、仕上がったモータースポーツ動画をレンダリングします。カメラとデータソースを問わず（GoPro、VIRB、Sony、加えて CSV、VBO、NMEA、GPX、FIT のログ）、トラックデイやレースの制作者向けに作られており、通常は TrackAddict や Harry's LapTimer のようなロギングアプリと組み合わせて使います。フリーミアムかつ買い切りです。無料エディションは RaceRender のロゴを刻印し、出力を3分に制限します。ロゴを完全に除去するには 有料エディションが必要です。そのトラックマップはデータから描かれるローカルの線で、内蔵のインタラクティブなベースマップはありません。",
            "comparisonIntro": "RaceRender はレースオーバーレイのエディタ、dashcamigo はドラレコのビューアです。ドラレコ映像をマップ付きで見るという点では、役割はこう分かれます。",
            "compareRows": [
                {
                    "dimension": "価格",
                    "us": {
                        "mark": "yes",
                        "note": "無料"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "無料版（ロゴ＋3分制限）。買い切りの有料アップグレード"
                    }
                },
                {
                    "dimension": "無料出力のウォーターマーク",
                    "us": {
                        "mark": "yes",
                        "note": "なし"
                    },
                    "them": {
                        "mark": "no",
                        "note": "RaceRender のロゴ（有料エディションでのみ除去）"
                    }
                },
                {
                    "dimension": "起動方法",
                    "us": {
                        "mark": "yes",
                        "note": "ブラウザで"
                    },
                    "them": {
                        "mark": "no",
                        "note": "デスクトップにインストール（Windows/Mac）"
                    }
                },
                {
                    "dimension": "モバイルで動作",
                    "us": {
                        "mark": "yes",
                        "note": "はい"
                    },
                    "them": {
                        "mark": "no",
                        "note": "デスクトップのみ"
                    }
                },
                {
                    "dimension": "カードからドラレコGPSを読み取り",
                    "us": {
                        "mark": "yes",
                        "note": "自動で"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "別個のデータファイルを前提"
                    }
                },
                {
                    "dimension": "内蔵のインタラクティブマップ",
                    "us": {
                        "mark": "yes",
                        "note": "キー不要のライブマップ"
                    },
                    "them": {
                        "mark": "no",
                        "note": "ローカルのトラックの線、ベースマップなし"
                    }
                },
                {
                    "dimension": "レースオーバーレイ制作の深さ",
                    "us": {
                        "mark": "partial",
                        "note": "基本的な速度／GPSオーバーレイ"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "ラップタイミング、マルチカメラ、4K"
                    }
                }
            ],
            "whenStayTitle": "RaceRender のほうが優れたツールであるとき",
            "whenStay": "RaceRender は洗練されたモータースポーツ動画の制作のために作られています。ラップタイミングと予測タイミング、カスタムゲージのデザイナー、マルチカメラの合成、360度動画、最大4Kの出力は、dashcamigo の域をはるかに超えます。トラックデイやレースの編集を作っていて、データロガーのファイルがあるなら、これが正解のツールです（しかも買い切りライセンスは控えめな価格です）。dashcamigo はレース動画のエディタではありません — カードから埋め込みGPSを自動で読み取り、ライブマップを表示する、無料・ブラウザのドラレコビューアであり、インストールもウォーターマークもありません。",
            "ctaPrimary": "録画を開く",
            "faq": [
                {
                    "q": "dashcamigo は無料の RaceRender 代替ですか？",
                    "a": "ドラレコ映像をマップと基本的なオーバーレイ付きで見るなら、はい — しかもウォーターマークも長さ制限もなく、ブラウザで無料です。モータースポーツの制作（ラップタイミング、マルチカメラ、カスタムゲージ、4Kレンダリング）なら RaceRender のほうがはるかに高機能で、dashcamigo はそれに張り合おうとはしません。"
                },
                {
                    "q": "RaceRender の無料版はウォーターマークを付けますか？",
                    "a": "はい — 無料エディションは RaceRender のロゴを刻印し、出力を3分に制限します。ロゴを完全に除去するには 有料エディションが必要です。dashcamigo はウォーターマークを付けず、長さ制限もありません。"
                },
                {
                    "q": "RaceRender は私のドラレコのGPSを直接読み取れますか？",
                    "a": "一部のアクションカメラのファイルに埋め込まれたGPSは読み取りますが、ドラレコについては概して、カードからGPSを自動抽出するのではなく、別個のデータロガーのファイルを前提とします。dashcamigo は、フォルダをドロップすると一般的なドラレコのGPS形式を自動で読み取ります。"
                },
                {
                    "q": "dashcamigo はインストールが必要ですか？",
                    "a": "いいえ — Windows、Mac、Linux、モバイルの最新ブラウザならどれでも動きます。RaceRender は Windows と macOS 向けのデスクトップアプリで、ブラウザ版やモバイル版はありません。"
                },
                {
                    "q": "RaceRender には dashcamigo のようなライブマップがありますか？",
                    "a": "RaceRender はGPSデータからローカルにトラックの線を描きますが、内蔵のインタラクティブなベースマップはありません（衛星背景はいずれも自分で用意する静止画像です）。dashcamigo は、本物のインタラクティブでキー不要のマップ（MapLibre + OpenFreeMap）を内蔵しています。"
                }
            ]
        },
        "ko": {
            "title": "RaceRender 대안 — 무료, 워터마크 없음, 브라우저에서 | dashcamigo",
            "metaDescription": "RaceRender 무료 등급은 로고를 찍고 클립을 3분으로 제한합니다. 블랙박스 영상이라면 dashcamigo가 카드에서 GPS를 읽어 브라우저에서 실시간 지도를 무료로 보여줍니다 — 워터마크도, 설치도 없이.",
            "ogTitle": "블랙박스 영상을 위한 무료 RaceRender 대안",
            "ogDescription": "RaceRender는 데스크톱 모터스포츠 오버레이 에디터입니다(무료 등급: 로고 + 3분 제한). 블랙박스 영상이라면 dashcamigo가 GPS를 읽어 실시간 지도를 무료로, 브라우저에서 보여줍니다.",
            "h1": "무료 브라우저 기반 RaceRender 대안 — 블랙박스 영상을 위한",
            "lead": "RaceRender는 모터스포츠 텔레메트리 영상을 만드는 유능한 데스크톱 도구입니다 — 하지만 무료 에디션은 로고를 찍고 출력을 3분으로 제한하며, 완전 제거에는 유료 라이선스가 필요하고, 보통 별도의 데이터 로거 파일을 기대합니다. 블랙박스 영상이라면 dashcamigo가 카드에서 GPS를 바로 읽어 속도와 G 포스 차트와 함께 실시간 키 없는 지도를 보여줍니다 — 무료로, 브라우저에서, 워터마크도 길이 제한도 없이. 깊이 있는 레이스 오버레이 제작이라면 RaceRender가 더 멀리 나아갑니다.",
            "cardHint": "데스크톱 레이스 오버레이 에디터; 무료 등급은 로고 + 3분 제한",
            "whatItIs": "RaceRender(HP Tuners 제작)는 Windows와 macOS용 데스크톱 애플리케이션으로, 텔레메트리 오버레이 — 게이지, 지도, 멀티카메라 레이아웃 — 를 구성해 완성된 모터스포츠 영상을 렌더링합니다. 카메라와 데이터 소스를 가리지 않으며(GoPro, VIRB, Sony, 그리고 CSV, VBO, NMEA, GPX, FIT 로그), 트랙데이와 레이싱 제작자를 위해 만들어져 보통 TrackAddict나 Harry's LapTimer 같은 로깅 앱과 함께 씁니다. 프리미엄(freemium)이자 일회성입니다 — 무료 에디션은 RaceRender 로고를 찍고 출력을 3분으로 제한하며, 로고를 완전히 제거하려면 유료 에디션이 필요합니다. 그 트랙 지도는 데이터로부터 그려지는 로컬 선이며, 내장 인터랙티브 베이스 맵은 없습니다.",
            "comparisonIntro": "RaceRender는 레이스 오버레이 에디터이고, dashcamigo는 블랙박스 뷰어입니다. 지도와 함께 블랙박스 영상을 보는 일이라면 역할이 이렇게 나뉩니다.",
            "compareRows": [
                {
                    "dimension": "가격",
                    "us": {
                        "mark": "yes",
                        "note": "무료"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "무료 등급(로고 + 3분 제한); 일회성 유료 업그레이드"
                    }
                },
                {
                    "dimension": "무료 출력물의 워터마크",
                    "us": {
                        "mark": "yes",
                        "note": "없음"
                    },
                    "them": {
                        "mark": "no",
                        "note": "RaceRender 로고(유료 에디션에서만 제거됨)"
                    }
                },
                {
                    "dimension": "실행 방식",
                    "us": {
                        "mark": "yes",
                        "note": "브라우저에서"
                    },
                    "them": {
                        "mark": "no",
                        "note": "데스크톱 설치(Windows/Mac)"
                    }
                },
                {
                    "dimension": "모바일에서 실행",
                    "us": {
                        "mark": "yes",
                        "note": "있음"
                    },
                    "them": {
                        "mark": "no",
                        "note": "데스크톱 전용"
                    }
                },
                {
                    "dimension": "카드에서 블랙박스 GPS 읽기",
                    "us": {
                        "mark": "yes",
                        "note": "자동으로"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "별도의 데이터 파일을 기대함"
                    }
                },
                {
                    "dimension": "내장 인터랙티브 지도",
                    "us": {
                        "mark": "yes",
                        "note": "키 없는 실시간 지도"
                    },
                    "them": {
                        "mark": "no",
                        "note": "로컬 트랙 선, 베이스 맵 없음"
                    }
                },
                {
                    "dimension": "레이스 오버레이 제작 깊이",
                    "us": {
                        "mark": "partial",
                        "note": "기본 속도/GPS 오버레이"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "랩 타이밍, 멀티캠, 4K"
                    }
                }
            ],
            "whenStayTitle": "RaceRender가 더 나은 도구일 때",
            "whenStay": "RaceRender는 정교하게 다듬은 모터스포츠 영상을 만들기 위해 설계되었습니다 — 랩 타이밍과 예측 타이밍, 맞춤형 게이지 디자이너, 멀티카메라 합성, 360 영상, 최대 4K 출력까지 dashcamigo를 훌쩍 넘어섭니다. 트랙데이나 레이싱 편집을 만들고 데이터 로거 파일이 있다면, 이것이 올바른 도구입니다(그리고 일회성 라이선스는 비싸지 않습니다). dashcamigo는 레이스 영상 에디터가 아닙니다 — 카드에서 내장 GPS를 자동으로 읽어 실시간 지도를 보여주는, 무료 브라우저 기반 블랙박스 뷰어이며, 설치도 워터마크도 없습니다.",
            "ctaPrimary": "내 녹화 영상 열기",
            "faq": [
                {
                    "q": "dashcamigo는 무료 RaceRender 대안인가요?",
                    "a": "지도와 기본 오버레이로 블랙박스 영상을 보는 일이라면 그렇습니다 — 게다가 워터마크도 길이 제한도 없이, 무료로, 브라우저에서요. 모터스포츠 제작(랩 타이밍, 멀티카메라, 맞춤형 게이지, 4K 렌더링)이라면 RaceRender가 훨씬 강력하며, dashcamigo는 그것을 따라가려 하지 않습니다."
                },
                {
                    "q": "RaceRender 무료 버전은 워터마크를 추가하나요?",
                    "a": "네 — 무료 에디션은 RaceRender 로고를 찍고 출력을 3분으로 제한하며, 로고를 완전히 제거하려면 유료 에디션이 필요합니다. dashcamigo는 워터마크를 추가하지 않고 길이 제한도 없습니다."
                },
                {
                    "q": "RaceRender가 제 블랙박스 GPS를 직접 읽을 수 있나요?",
                    "a": "일부 액션캠 파일에 내장된 GPS는 읽지만, 블랙박스의 경우 보통 카드에서 GPS를 자동 추출하기보다 별도의 데이터 로거 파일을 기대합니다. dashcamigo는 폴더를 끌어다 놓으면 흔한 블랙박스 GPS 형식을 자동으로 읽습니다."
                },
                {
                    "q": "dashcamigo는 설치가 필요한가요?",
                    "a": "아니요 — Windows, Mac, Linux, 모바일의 모든 최신 브라우저에서 돌아갑니다. RaceRender는 Windows와 macOS용 데스크톱 앱이며, 브라우저나 모바일 버전이 없습니다."
                },
                {
                    "q": "RaceRender에도 dashcamigo 같은 실시간 지도가 있나요?",
                    "a": "RaceRender는 GPS 데이터로부터 트랙 선을 로컬에서 그리지만, 내장 인터랙티브 베이스 맵은 없습니다(위성 배경은 사용자가 직접 제공하는 정적 이미지입니다). dashcamigo에는 진짜 인터랙티브 키 없는 지도(MapLibre + OpenFreeMap)가 내장되어 있습니다."
                }
            ]
        },
        "pl": {
            "title": "Alternatywa dla RaceRender — darmowa, bez znaku wodnego, w przeglądarce | dashcamigo",
            "metaDescription": "Darmowa wersja RaceRender nabija logo i ogranicza klipy do 3 minut. dashcamigo czyta GPS z karty i pokazuje żywą mapę za darmo w przeglądarce — bez znaku wodnego.",
            "ogTitle": "Darmowa alternatywa dla RaceRender do nagrań z wideorejestratora",
            "ogDescription": "RaceRender to desktopowy edytor nakładek motorsportowych (darmowa wersja: logo + limit 3 min). Dla nagrań z wideorejestratora dashcamigo czyta GPS i pokazuje żywą mapę za darmo, w przeglądarce.",
            "h1": "Darmowa, działająca w przeglądarce alternatywa dla RaceRender — do nagrań z wideorejestratora",
            "lead": "RaceRender to wszechstronne narzędzie desktopowe do tworzenia motorsportowych wideo z telemetrią — ale jego darmowa edycja nabija logo i ogranicza wynik do trzech minut, pełne usunięcie wymaga płatnej licencji, a zazwyczaj oczekuje osobnego pliku z loggera danych. Dla nagrań z wideorejestratora dashcamigo czyta GPS prosto z karty i pokazuje żywą mapę bez kluczy wraz z wykresem prędkości i przeciążeń, za darmo i w przeglądarce, bez znaku wodnego i bez limitu długości. Do głębokiej produkcji nakładek wyścigowych RaceRender idzie dalej.",
            "cardHint": "Desktopowy edytor nakładek wyścigowych; darmowa wersja ma logo + limit 3 min",
            "whatItIs": "RaceRender (od HP Tuners) to aplikacja desktopowa na Windows i macOS, która składa nakładki telemetrii — wskaźniki, mapy, układy wielokamerowe — i renderuje gotowe wideo motorsportowe. Jest niezależny od kamery i źródła danych (GoPro, VIRB, Sony, plus logi CSV, VBO, NMEA, GPX, FIT) i zbudowany dla twórców track-dayów i wyścigów, zwykle w parze z aplikacją do logowania, jak TrackAddict czy Harry's LapTimer. Jest freemium i jednorazowy: darmowa edycja nabija logo RaceRender i ogranicza wynik do 3 minut; całkowite usunięcie logo wymaga edycji płatnej. Jego mapa trasy to lokalna linia rysowana z danych — nie ma wbudowanej interaktywnej mapy podkładowej.",
            "comparisonIntro": "RaceRender to edytor nakładek wyścigowych; dashcamigo to przeglądarka wideorejestratora. Jeśli chodzi o oglądanie nagrań z wideorejestratora z mapą, oto podział ról.",
            "compareRows": [
                {
                    "dimension": "Cena",
                    "us": {
                        "mark": "yes",
                        "note": "Za darmo"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Darmowa wersja (logo + limit 3 min); jednorazowe płatne ulepszenie"
                    }
                },
                {
                    "dimension": "Znak wodny na darmowym wyniku",
                    "us": {
                        "mark": "yes",
                        "note": "Brak"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Logo RaceRender (usuwane tylko w edycji płatnej)"
                    }
                },
                {
                    "dimension": "Jak się uruchamia",
                    "us": {
                        "mark": "yes",
                        "note": "W przeglądarce"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Instalacja na desktop (Windows/Mac)"
                    }
                },
                {
                    "dimension": "Działa na mobilnym",
                    "us": {
                        "mark": "yes",
                        "note": "Tak"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Tylko desktop"
                    }
                },
                {
                    "dimension": "Czyta GPS z wideorejestratora prosto z karty",
                    "us": {
                        "mark": "yes",
                        "note": "Automatycznie"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Oczekuje osobnego pliku z danymi"
                    }
                },
                {
                    "dimension": "Wbudowana interaktywna mapa",
                    "us": {
                        "mark": "yes",
                        "note": "Żywa mapa bez kluczy"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Lokalna linia trasy, bez mapy podkładowej"
                    }
                },
                {
                    "dimension": "Głębia produkcji nakładek wyścigowych",
                    "us": {
                        "mark": "partial",
                        "note": "Podstawowa nakładka prędkości/GPS"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Pomiar okrążeń, wiele kamer, 4K"
                    }
                }
            ],
            "whenStayTitle": "Kiedy RaceRender jest lepszym narzędziem",
            "whenStay": "RaceRender jest stworzony do produkcji dopracowanych wideo motorsportowych: pomiar okrążeń i czas predykcyjny, własny projektant wskaźników, kompozycja wielokamerowa, wideo 360 i wynik do 4K wykraczają daleko poza dashcamigo. Jeśli montujesz materiał z track-dayu albo wyścigu i masz plik z loggera danych, to właściwe narzędzie (a jednorazowa licencja jest skromna). dashcamigo nie jest edytorem wideo wyścigowego — to darmowa, działająca w przeglądarce przeglądarka wideorejestratora, która automatycznie czyta wbudowany GPS z karty i pokazuje żywą mapę, bez instalacji i bez znaku wodnego.",
            "ctaPrimary": "Otwórz swoje nagrania",
            "faq": [
                {
                    "q": "Czy dashcamigo to darmowa alternatywa dla RaceRender?",
                    "a": "Do oglądania nagrań z wideorejestratora z mapą i podstawową nakładką — tak, i to bez znaku wodnego oraz limitu długości, za darmo, w przeglądarce. Do produkcji motorsportowej (pomiar okrążeń, wiele kamer, własne wskaźniki, render w 4K) RaceRender jest znacznie bardziej wszechstronny; dashcamigo nawet nie próbuje temu dorównać."
                },
                {
                    "q": "Czy darmowa wersja RaceRender dodaje znak wodny?",
                    "a": "Tak — darmowa edycja nabija logo RaceRender i ogranicza wynik do 3 minut; całkowite usunięcie logo wymaga edycji płatnej. dashcamigo nie dodaje znaku wodnego i nie ma limitu długości."
                },
                {
                    "q": "Czy RaceRender potrafi czytać GPS z mojego wideorejestratora bezpośrednio?",
                    "a": "Czyta GPS wbudowany w niektóre pliki z kamer sportowych, ale w przypadku wideorejestratorów zwykle oczekuje osobnego pliku z loggera danych, zamiast automatycznie wyciągać GPS z karty. dashcamigo czyta popularne formaty GPS wideorejestratorów automatycznie, gdy tylko przeciągniesz folder."
                },
                {
                    "q": "Czy dashcamigo wymaga instalacji?",
                    "a": "Nie — działa w dowolnej nowoczesnej przeglądarce na Windows, Mac, Linuksie i mobilnym. RaceRender to aplikacja desktopowa na Windows i macOS, bez wersji przeglądarkowej ani mobilnej."
                },
                {
                    "q": "Czy RaceRender ma żywą mapę jak dashcamigo?",
                    "a": "RaceRender rysuje linię trasy lokalnie z danych GPS, ale nie ma wbudowanej interaktywnej mapy podkładowej (każde tło satelitarne to statyczny obraz, który dostarczasz sam). dashcamigo ma wbudowaną prawdziwą, interaktywną mapę bez kluczy (MapLibre + OpenFreeMap)."
                }
            ]
        },
        "pt": {
            "title": "Alternativa ao RaceRender — gratuita, sem marca-d'água, no seu navegador | dashcamigo",
            "metaDescription": "O plano gratuito do RaceRender carimba um logo e limita os clipes a 3 minutos. O dashcamigo mostra um mapa ao vivo grátis no navegador — sem marca-d'água.",
            "ogTitle": "Alternativa gratuita ao RaceRender para dashcam",
            "ogDescription": "O RaceRender é um editor de overlay de automobilismo de desktop (plano gratuito: logo + limite de 3 min). Para gravações de dashcam, o dashcamigo lê o GPS e mostra um mapa ao vivo grátis, no navegador.",
            "h1": "Uma alternativa ao RaceRender gratuita e no navegador — para gravações de dashcam",
            "lead": "O RaceRender é uma ferramenta de desktop capaz para montar vídeos de telemetria de automobilismo — mas sua edição gratuita carimba um logo e limita a saída a três minutos, a remoção completa exige uma licença paga, e ele normalmente espera um arquivo de registrador de dados separado. Para gravações de dashcam, o dashcamigo lê o GPS direto do cartão e mostra um mapa ao vivo sem chave com um gráfico de velocidade e força G, grátis e no seu navegador, sem marca-d'água e sem limite de duração. Para produção avançada de overlays de corrida, o RaceRender vai mais longe.",
            "cardHint": "Editor de overlay de corrida de desktop; o plano gratuito tem logo + limite de 3 min",
            "whatItIs": "O RaceRender (da HP Tuners) é um app de desktop para Windows e macOS que compõe overlays de telemetria — medidores, mapas, layouts multicâmera — e renderiza um vídeo de automobilismo finalizado. Ele é indiferente à câmera e à fonte de dados (GoPro, VIRB, Sony, além de logs CSV, VBO, NMEA, GPX, FIT) e foi feito para criadores de track-day e corrida, geralmente em par com um app de registro como o TrackAddict ou o Harry's LapTimer. É freemium e de pagamento único: a edição Free carimba um logo do RaceRender e limita a saída a 3 minutos; remover o logo completamente exige a edição paga. Seu mapa de pista é uma linha local desenhada a partir dos dados — não há mapa base interativo integrado.",
            "comparisonIntro": "O RaceRender é um editor de overlay de corrida; o dashcamigo é um visualizador de dashcam. Para visualizar gravações de dashcam com um mapa, veja como eles se dividem.",
            "compareRows": [
                {
                    "dimension": "Preço",
                    "us": {
                        "mark": "yes",
                        "note": "Grátis"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Plano gratuito (logo + limite de 3 min); atualização paga única"
                    }
                },
                {
                    "dimension": "Marca-d'água na saída gratuita",
                    "us": {
                        "mark": "yes",
                        "note": "Nenhuma"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Logo do RaceRender (removido apenas na edição paga)"
                    }
                },
                {
                    "dimension": "Como você roda",
                    "us": {
                        "mark": "yes",
                        "note": "No navegador"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Instalação no desktop (Windows/Mac)"
                    }
                },
                {
                    "dimension": "Roda no celular",
                    "us": {
                        "mark": "yes",
                        "note": "Sim"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Só desktop"
                    }
                },
                {
                    "dimension": "Lê o GPS da dashcam direto do cartão",
                    "us": {
                        "mark": "yes",
                        "note": "Automaticamente"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "Espera um arquivo de dados separado"
                    }
                },
                {
                    "dimension": "Mapa interativo integrado",
                    "us": {
                        "mark": "yes",
                        "note": "Mapa ao vivo sem chave"
                    },
                    "them": {
                        "mark": "no",
                        "note": "Linha de trajeto local, sem mapa base"
                    }
                },
                {
                    "dimension": "Profundidade de produção de overlay de corrida",
                    "us": {
                        "mark": "partial",
                        "note": "Overlay básico de velocidade/GPS"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "Cronometragem de voltas, multicâmera, 4K"
                    }
                }
            ],
            "whenStayTitle": "Quando o RaceRender é a melhor ferramenta",
            "whenStay": "O RaceRender foi feito para produzir vídeos de automobilismo caprichados: cronometragem de voltas e preditiva, um designer de medidores personalizado, composição multicâmera, vídeo 360 e saída de até 4K vão bem além do dashcamigo. Se você está fazendo uma edição de track-day ou de corrida e tem um arquivo de registrador de dados, ele é a ferramenta certa (e a licença de pagamento único é modesta). O dashcamigo não é um editor de vídeo de corrida — é um visualizador de dashcam gratuito, no navegador, que lê automaticamente o GPS embutido do cartão e mostra um mapa ao vivo, sem instalação e sem marca-d'água.",
            "ctaPrimary": "Abra suas gravações",
            "faq": [
                {
                    "q": "O dashcamigo é uma alternativa gratuita ao RaceRender?",
                    "a": "Para visualizar gravações de dashcam com um mapa e um overlay básico, sim — e sem marca-d'água ou limite de duração, grátis, no navegador. Para produção de automobilismo (cronometragem de voltas, multicâmera, medidores personalizados, renderização em 4K), o RaceRender é muito mais capaz; o dashcamigo não tenta igualar isso."
                },
                {
                    "q": "A versão gratuita do RaceRender adiciona marca-d'água?",
                    "a": "Sim — a edição Free carimba um logo do RaceRender e limita a saída a 3 minutos; remover o logo completamente exige a edição paga. O dashcamigo não adiciona marca-d'água e não tem limite de duração."
                },
                {
                    "q": "O RaceRender consegue ler o GPS da minha dashcam diretamente?",
                    "a": "Ele lê o GPS embutido em alguns arquivos de câmeras de ação, mas para dashcams ele geralmente espera um arquivo de registrador de dados separado em vez de extrair o GPS automaticamente do cartão. O dashcamigo lê formatos comuns de GPS de dashcam automaticamente quando você solta a pasta."
                },
                {
                    "q": "O dashcamigo precisa ser instalado?",
                    "a": "Não — ele roda em qualquer navegador moderno no Windows, Mac, Linux e celular. O RaceRender é um app de desktop para Windows e macOS, sem versão para navegador ou celular."
                },
                {
                    "q": "O RaceRender tem um mapa ao vivo como o dashcamigo?",
                    "a": "O RaceRender desenha uma linha de trajeto localmente a partir dos dados de GPS, mas não tem um mapa base interativo integrado (qualquer fundo de satélite é uma imagem estática que você fornece). O dashcamigo tem um mapa de verdade, interativo e sem chave (MapLibre + OpenFreeMap) integrado."
                }
            ]
        },
        "zh": {
            "title": "RaceRender 替代方案 — 免费、无水印、在浏览器里运行 | dashcamigo",
            "metaDescription": "RaceRender 的免费版会打上 logo 并把片段限制在 3 分钟。针对行车记录仪素材，dashcamigo 从存储卡读取 GPS 并在浏览器里免费显示实时地图 — 无水印，无需安装。",
            "ogTitle": "面向行车记录仪素材的免费 RaceRender 替代方案",
            "ogDescription": "RaceRender 是一款桌面赛车运动叠加编辑器（免费版：logo + 3 分钟上限）。针对行车记录仪素材，dashcamigo 在浏览器里免费读取 GPS 并显示实时地图。",
            "h1": "免费、在浏览器里运行的 RaceRender 替代方案 — 面向行车记录仪素材",
            "lead": "RaceRender 是一款功能不俗的桌面工具，用于制作赛车运动遥测视频 — 但它的免费版会打上一个 logo 并把输出限制在三分钟，彻底去除需要付费授权，而且它通常需要一份独立的数据记录器文件。针对行车记录仪素材，dashcamigo 直接从存储卡读取 GPS，并显示一张实时、无需密钥的地图，配有速度与 G 力图表，免费且在浏览器里，没有水印，也没有时长上限。论深度赛车叠加制作，RaceRender 走得更远。",
            "cardHint": "桌面赛车叠加编辑器；免费版带 logo + 3 分钟上限",
            "whatItIs": "RaceRender（由 HP Tuners 出品）是一款面向 Windows 和 macOS 的桌面应用，用于合成遥测叠加 — 仪表、地图、多机位布局 — 并渲染出一段成片的赛车运动视频。它对相机和数据源不挑（GoPro、VIRB、Sony，外加 CSV、VBO、NMEA、GPX、FIT 日志），为赛道日和赛车创作者打造，通常搭配 TrackAddict 或 Harry's LapTimer 这类记录应用使用。它采用免费增值加一次性买断模式：免费版会打上一个 RaceRender logo 并把输出限制在 3 分钟；要彻底去除 logo 需要 付费版。它的赛道地图是依据数据在本地画出的一条线 — 没有内置的交互式底图。",
            "comparisonIntro": "RaceRender 是一款赛车叠加编辑器；dashcamigo 是一款行车记录仪查看器。就带地图查看行车记录仪素材而言，下面是它们的分工。",
            "compareRows": [
                {
                    "dimension": "价格",
                    "us": {
                        "mark": "yes",
                        "note": "免费"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "免费层（logo + 3 分钟上限）；一次性付费升级"
                    }
                },
                {
                    "dimension": "免费输出上的水印",
                    "us": {
                        "mark": "yes",
                        "note": "无"
                    },
                    "them": {
                        "mark": "no",
                        "note": "RaceRender logo（仅在付费版中去除）"
                    }
                },
                {
                    "dimension": "运行方式",
                    "us": {
                        "mark": "yes",
                        "note": "在浏览器里"
                    },
                    "them": {
                        "mark": "no",
                        "note": "桌面安装（Windows/Mac）"
                    }
                },
                {
                    "dimension": "可在移动端运行",
                    "us": {
                        "mark": "yes",
                        "note": "可以"
                    },
                    "them": {
                        "mark": "no",
                        "note": "仅限桌面"
                    }
                },
                {
                    "dimension": "从存储卡读取行车记录仪 GPS",
                    "us": {
                        "mark": "yes",
                        "note": "自动"
                    },
                    "them": {
                        "mark": "partial",
                        "note": "需要一份独立的数据文件"
                    }
                },
                {
                    "dimension": "内置交互式地图",
                    "us": {
                        "mark": "yes",
                        "note": "无需密钥的实时地图"
                    },
                    "them": {
                        "mark": "no",
                        "note": "本地轨迹线，无底图"
                    }
                },
                {
                    "dimension": "赛车叠加制作深度",
                    "us": {
                        "mark": "partial",
                        "note": "基础的速度/GPS 叠加"
                    },
                    "them": {
                        "mark": "yes",
                        "note": "圈速计时、多机位、4K"
                    }
                }
            ],
            "whenStayTitle": "什么时候 RaceRender 是更好的工具",
            "whenStay": "RaceRender 为制作精致的赛车运动视频而生：圈速与预测计时、自定义仪表设计器、多机位合成、360 视频以及最高 4K 输出，都远超 dashcamigo。如果你正在做赛道日或赛车的剪辑，并有一份数据记录器文件，它就是正确的工具（而且一次性授权也不贵）。dashcamigo 不是赛车视频编辑器 — 它是一款免费、在浏览器里运行的行车记录仪查看器，自动从存储卡读取内嵌 GPS 并显示实时地图，无需安装，没有水印。",
            "ctaPrimary": "打开你的录像",
            "faq": [
                {
                    "q": "dashcamigo 是 RaceRender 的免费替代方案吗？",
                    "a": "就带地图和基础叠加查看行车记录仪素材而言，是的 — 而且没有水印或时长上限，免费，在浏览器里。对于赛车运动制作（圈速计时、多机位、自定义仪表、4K 渲染），RaceRender 要强大得多；dashcamigo 并不试图与之比拼。"
                },
                {
                    "q": "RaceRender 的免费版会加水印吗？",
                    "a": "会 — 免费版会打上一个 RaceRender logo 并把输出限制在 3 分钟；要彻底去除 logo 需要 付费版。dashcamigo 不加任何水印，也没有时长上限。"
                },
                {
                    "q": "RaceRender 能直接读取我行车记录仪的 GPS 吗？",
                    "a": "它能读取部分运动相机文件中内嵌的 GPS，但对于行车记录仪，它通常需要一份独立的数据记录器文件，而不是自动从存储卡提取 GPS。dashcamigo 在你拖入文件夹时会自动读取常见的行车记录仪 GPS 格式。"
                },
                {
                    "q": "dashcamigo 需要安装吗？",
                    "a": "不需要 — 它在 Windows、Mac、Linux 和移动端的任何现代浏览器里都能运行。RaceRender 是一款面向 Windows 和 macOS 的桌面应用，没有浏览器版或移动版。"
                },
                {
                    "q": "RaceRender 像 dashcamigo 那样有实时地图吗？",
                    "a": "RaceRender 依据 GPS 数据在本地画出一条轨迹线，但它没有内置的交互式底图（任何卫星背景都是你自己提供的静态图片）。dashcamigo 内置了一张真正的、交互式的、无需密钥的地图（MapLibre + OpenFreeMap）。"
                }
            ]
        }
    },
    "navitel-dvr-player": {
    "de": {
        "title": "Navitel DVR Player-Alternative — kostenlos, plattformübergreifend, im Browser | dashcamigo",
        "metaDescription": "Eine kostenlose, plattformübergreifende Navitel DVR Player-Alternative im Browser — Windows, Mac, Linux, mobil. Liest Navitel und viele andere Dashcams, GPS-Karte, ohne Installation.",
        "ogTitle": "Kostenlose Navitel DVR Player-Alternative — im Browser",
        "ogDescription": "Navitel DVR Player ist ein kostenloser, reiner Windows-Player für Navitel-Kameras. dashcamigo ist die plattformübergreifende Alternative im Browser, die viele Marken liest.",
        "h1": "Eine kostenlose, plattformübergreifende Navitel DVR Player-Alternative — im Browser",
        "lead": "Navitel DVR Player ist Navitels eigener kostenloser Desktop-Player — und ein wirklich fähiger, mit GPS-Karte, Geschwindigkeits- und Höhendiagrammen und Track-Export in mehreren Formaten. Der Haken: Er läuft nur unter Windows und ist um Navitels eigene Kameras herum gebaut. dashcamigo erledigt die alltägliche Aufgabe in deinem Browser auf jedem Gerät: SD-Karte öffnen, die Fahrt auf einer schlüssellosen GPS-Karte mit einem Diagramm für Geschwindigkeit und G-Kraft sehen, Front, Heck und Innenraum synchron abspielen und einen Clip zuschneiden — für Navitel-Kameras und viele andere Marken gleichermaßen. Nichts zu installieren.",
        "cardHint": "Kostenloser offizieller Player — aber nur Windows und Navitel-first",
        "whatItIs": "Navitel DVR Player von Navitel ist eine kostenlose Desktop-Anwendung für Windows für Besitzer von Navitel-Dashcams. Ein solides Werkzeug: Er spielt MOV-, AVI-, MP4- und TS-Aufnahmen ab, zeigt die Route auf einer Karte mit Geschwindigkeits- und Höhendiagrammen, springt per Klick auf einen Punkt der Karte zum passenden Moment im Video, sortiert Aufnahmen in Fahrten, Parken und Ereignisse, schneidet und speichert Fragmente und exportiert den GPS-Track in fünf Formaten — NMEA, KML, CSV, GPX und PLT — und er kann sogar nach Firmware-Updates für Navitel-Kameras suchen. Zwei ehrliche Grenzen für alle anderen: Er läuft nur unter Windows, und Navitel selbst schreibt, dass nicht garantiert ist, dass alle Funktionen mit fremden Rekordern arbeiten — und seine GPS-Karte braucht die separaten .NMEA-Track-Dateien der Kamera, neben das Video kopiert.",
        "comparisonIntro": "Beide sind kostenlos, und für eine Navitel-Kamera geht der offizielle Player in die Tiefe. Hier hat ein Tool im Browser, das mehrere Hersteller liest, die Nase vorn.",
        "compareRows": [
            {
                "dimension": "Preis",
                "us": {
                    "mark": "yes",
                    "note": "Kostenlos"
                },
                "them": {
                    "mark": "yes",
                    "note": "Kostenlos"
                }
            },
            {
                "dimension": "Läuft auf Mac, Linux & mobil",
                "us": {
                    "mark": "yes",
                    "note": "Jeder aktuelle Browser"
                },
                "them": {
                    "mark": "no",
                    "note": "Nur Windows"
                }
            },
            {
                "dimension": "Nichts zu installieren",
                "us": {
                    "mark": "yes",
                    "note": "Öffnet im Browser"
                },
                "them": {
                    "mark": "no",
                    "note": "Desktop-Installation (Windows)"
                }
            },
            {
                "dimension": "Welche Kameras er liest",
                "us": {
                    "mark": "yes",
                    "note": "Navitel, 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware + mehr"
                },
                "them": {
                    "mark": "partial",
                    "note": "Navitel-first; andere Marken ohne Garantie"
                }
            },
            {
                "dimension": "Front/Heck/Innenraum gleichzeitig",
                "us": {
                    "mark": "yes",
                    "note": "3-Kanal-Raster"
                },
                "them": {
                    "mark": "partial",
                    "note": "Front + Heck"
                }
            },
            {
                "dimension": "GPS-Track-Exportformate",
                "us": {
                    "mark": "partial",
                    "note": "GPX + MP4 mit GPS darin"
                },
                "them": {
                    "mark": "yes",
                    "note": "NMEA, KML, CSV, GPX, PLT"
                }
            },
            {
                "dimension": "Eingebaute Karte",
                "us": {
                    "mark": "yes",
                    "note": "Live, schlüssellos — kein API-Schlüssel, der ablaufen kann"
                },
                "them": {
                    "mark": "yes",
                    "note": "Eingebaute Routenkarte"
                }
            }
        ],
        "whenStayTitle": "Wann Navitel DVR Player die bessere Wahl ist",
        "whenStay": "Wenn du eine Navitel-Dashcam besitzt, ist der hauseigene Player genau dafür gemacht: Er sucht und installiert Firmware-Updates für Navitel-Modelle, exportiert deinen Track in fünf Formaten (NMEA, KML, CSV, GPX, PLT), zeigt Geschwindigkeits- und Höhendiagramme und läuft als Desktop-App vollständig offline. dashcamigo liest Navitel-GPS ebenfalls — neben 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware und mehr — aber für ein reines Navitel-Setup geht das offizielle Tool am tiefsten. Und wenn dashcamigo deine Kamera noch nicht liest, schick uns ein Beispiel an feedback@dashcamigo.app — wir ergänzen Formate anhand echter Aufnahmen.",
        "ctaPrimary": "Deine Aufnahmen öffnen",
        "faq": [
            {
                "q": "Ist dashcamigo ein Ersatz für Navitel DVR Player?",
                "a": "Für die alltägliche Aufgabe — eine Fahrt mit GPS-Karte, einem Geschwindigkeits- und G-Kraft-Diagramm öffnen, mehrere Kanäle abspielen und einen Clip schneiden — ja, kostenlos und in jedem Browser, und es liest auch Navitel-GPS. Speziell für eine Kamera der Marke Navitel geht der offizielle Player tiefer (Firmware-Updates, Track-Export in fünf Formaten), daher behalten viele Navitel-Besitzer beide."
            },
            {
                "q": "Liest dashcamigo das GPS meiner Navitel-Dashcam?",
                "a": "Ja — Navitel gehört zu den unterstützten Formaten. Zieh den gesamten SD-Karten-Ordner hinein, und es liest den Track und zeichnet ihn auf der Karte ein, genauso wie bei 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware und anderen."
            },
            {
                "q": "Funktioniert dashcamigo auf Mac, Linux oder meinem Smartphone?",
                "a": "Ja. Es läuft im Browser, also funktionieren Windows, macOS, Linux und mobil alle. Navitel DVR Player läuft nur unter Windows."
            },
            {
                "q": "Muss ich es installieren oder spezielle Dateien kopieren?",
                "a": "Keine Installation — öffne dashcamigo.app und zieh den gesamten SD-Karten-Ordner hinein; es findet Video und GPS automatisch. Navitel DVR Player ist eine Desktop-App, die du installierst, und für die Karte will er das Video samt der separaten .NMEA-Track-Datei mitkopiert haben."
            },
            {
                "q": "Ist dashcamigo kostenlos und privat wie Navitel DVR Player?",
                "a": "Ja — kostenlos, kein Konto und kein Server für deine Aufnahmen: Dein Browser liest die Dateien direkt von deinem Gerät; nichts wird hochgeladen. Beide Tools sind kostenlos; dashcamigo spart dir zusätzlich die Installation."
            }
        ]
    },
    "es": {
        "title": "Alternativa a Navitel DVR Player — gratis, multiplataforma, en tu navegador | dashcamigo",
        "metaDescription": "Alternativa gratuita a Navitel DVR Player en tu navegador — Windows, Mac, Linux, móvil. Lee Navitel y muchas otras dashcam, mapa GPS, sin instalar.",
        "ogTitle": "Alternativa gratuita a Navitel DVR Player — en tu navegador",
        "ogDescription": "Navitel DVR Player es un reproductor gratuito solo para Windows, hecho para las cámaras Navitel. dashcamigo es la alternativa multiplataforma y en el navegador que lee muchas marcas.",
        "h1": "Una alternativa gratuita y multiplataforma a Navitel DVR Player — en tu navegador",
        "lead": "Navitel DVR Player es el propio reproductor de escritorio gratuito de Navitel — y uno realmente capaz, con mapa GPS, gráficos de velocidad y altitud y exportación de la traza en varios formatos. El inconveniente es que es solo para Windows y está pensado en torno a las cámaras de la propia Navitel. dashcamigo hace la tarea de cada día en tu navegador, en cualquier dispositivo: abre la tarjeta SD, ve el trayecto en un mapa GPS sin claves con un gráfico de velocidad y fuerza G, reproduce delantera, trasera e interior en sincronía y recorta un clip — tanto para cámaras Navitel como para muchas otras marcas. Nada que instalar.",
        "cardHint": "Reproductor oficial gratuito — pero solo para Windows y centrado en Navitel",
        "whatItIs": "Navitel DVR Player, de Navitel, es una aplicación de escritorio gratuita para Windows para los dueños de dashcam Navitel. Es una herramienta sólida: reproduce grabaciones MOV, AVI, MP4 y TS, muestra la ruta en un mapa con gráficos de velocidad y altitud, permite hacer clic en un punto del mapa para saltar el vídeo a ese momento, ordena las grabaciones en trayectos, aparcamiento y eventos, corta y guarda fragmentos y exporta la traza GPS en cinco formatos — NMEA, KML, CSV, GPX y PLT — e incluso puede comprobar actualizaciones de firmware para las cámaras Navitel. Dos límites honestos para todos los demás: es solo para Windows, y la propia Navitel dice que no puede garantizar que todas las funciones trabajen con grabadores que no sean Navitel — su mapa GPS necesita que los archivos de traza .NMEA separados de la cámara se copien junto al vídeo.",
        "comparisonIntro": "Los dos son gratis, y para una cámara Navitel el reproductor oficial llega muy lejos. Aquí es donde una herramienta multimarca y en el navegador lleva ventaja.",
        "compareRows": [
            {
                "dimension": "Precio",
                "us": {
                    "mark": "yes",
                    "note": "Gratis"
                },
                "them": {
                    "mark": "yes",
                    "note": "Gratis"
                }
            },
            {
                "dimension": "Funciona en Mac, Linux y móvil",
                "us": {
                    "mark": "yes",
                    "note": "Cualquier navegador moderno"
                },
                "them": {
                    "mark": "no",
                    "note": "Solo para Windows"
                }
            },
            {
                "dimension": "Nada que instalar",
                "us": {
                    "mark": "yes",
                    "note": "Se abre en el navegador"
                },
                "them": {
                    "mark": "no",
                    "note": "Instalación de escritorio (Windows)"
                }
            },
            {
                "dimension": "Cámaras que lee",
                "us": {
                    "mark": "yes",
                    "note": "Navitel, 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware y más"
                },
                "them": {
                    "mark": "partial",
                    "note": "Navitel primero; otras marcas sin garantía"
                }
            },
            {
                "dimension": "Delantera/trasera/interior a la vez",
                "us": {
                    "mark": "yes",
                    "note": "Cuadrícula de 3 canales"
                },
                "them": {
                    "mark": "partial",
                    "note": "Delantera + trasera"
                }
            },
            {
                "dimension": "Formatos de exportación de la traza GPS",
                "us": {
                    "mark": "partial",
                    "note": "GPX + MP4 con el GPS dentro"
                },
                "them": {
                    "mark": "yes",
                    "note": "NMEA, KML, CSV, GPX, PLT"
                }
            },
            {
                "dimension": "Mapa integrado",
                "us": {
                    "mark": "yes",
                    "note": "En vivo, sin claves — ninguna clave de API que pueda caducar"
                },
                "them": {
                    "mark": "yes",
                    "note": "Mapa de ruta integrado"
                }
            }
        ],
        "whenStayTitle": "Cuándo Navitel DVR Player es la mejor opción",
        "whenStay": "Si tienes una dashcam Navitel, el reproductor del propio fabricante está hecho a medida para ella: comprueba e instala actualizaciones de firmware para los modelos Navitel, exporta tu traza en cinco formatos (NMEA, KML, CSV, GPX, PLT), muestra gráficos de velocidad y altitud y funciona totalmente sin conexión como aplicación de escritorio. dashcamigo también lee el GPS de Navitel — junto al de 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware y más — pero para un montaje solo de Navitel, la herramienta oficial llega más a fondo. Y si dashcamigo aún no lee tu cámara, envía una muestra a feedback@dashcamigo.app — añadimos formatos a partir de grabaciones reales.",
        "ctaPrimary": "Abre tus grabaciones",
        "faq": [
            {
                "q": "¿Es dashcamigo un reemplazo de Navitel DVR Player?",
                "a": "Para la tarea de cada día — abrir un trayecto con un mapa GPS, un gráfico de velocidad y fuerza G, reproducción multicanal y recortar un clip — sí, gratis y en cualquier navegador, y también lee el GPS de Navitel. Concretamente para una cámara de marca Navitel, el reproductor oficial llega más a fondo (actualizaciones de firmware, exportación de la traza en cinco formatos), así que muchos dueños de Navitel se quedan con ambos."
            },
            {
                "q": "¿Lee dashcamigo el GPS de mi dashcam Navitel?",
                "a": "Sí — Navitel está entre los formatos compatibles. Suelta toda la carpeta de la tarjeta SD y lee la traza y la dibuja en el mapa, igual que hace con 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware y otras."
            },
            {
                "q": "¿Funciona dashcamigo en Mac, Linux o en mi teléfono?",
                "a": "Sí. Funciona en el navegador, así que Windows, macOS, Linux y móvil funcionan todos. Navitel DVR Player es solo para Windows."
            },
            {
                "q": "¿Necesito instalarlo o copiar archivos especiales?",
                "a": "Nada que instalar — abre dashcamigo.app y suelta toda la carpeta de la tarjeta SD; encuentra el vídeo y el GPS automáticamente. Navitel DVR Player es una aplicación de escritorio que se instala, y para el mapa quiere que copies el vídeo junto a su archivo de traza .NMEA separado."
            },
            {
                "q": "¿Es dashcamigo gratis y privado como Navitel DVR Player?",
                "a": "Sí — gratis, sin cuenta y sin servidor: tu navegador lee los archivos directamente desde tu dispositivo; no se sube nada. Las dos herramientas son gratuitas; dashcamigo además se salta la instalación."
            }
        ]
    },
    "fr": {
        "title": "Alternative à Navitel DVR Player — gratuite, multiplateforme, dans votre navigateur | dashcamigo",
        "metaDescription": "Alternative gratuite à Navitel DVR Player dans le navigateur — Windows, Mac, Linux, mobile. Lit Navitel et d'autres dashcams. Carte GPS, sans installation.",
        "ogTitle": "Alternative gratuite à Navitel DVR Player — navigateur",
        "ogDescription": "Navitel DVR Player est un lecteur gratuit, réservé à Windows, conçu pour les caméras Navitel. dashcamigo est l'alternative multiplateforme, dans le navigateur, qui lit beaucoup de marques.",
        "h1": "Une alternative gratuite et multiplateforme à Navitel DVR Player — dans votre navigateur",
        "lead": "Navitel DVR Player est le lecteur de bureau gratuit signé Navitel — et il est vraiment capable, avec une carte GPS, des courbes de vitesse et d'altitude, et un export du tracé en plusieurs formats. Le hic, c'est qu'il est réservé à Windows et pensé autour des caméras maison de Navitel. dashcamigo fait le travail du quotidien dans votre navigateur, sur n'importe quel appareil : ouvrez la carte SD, voyez le trajet sur une carte GPS sans clé avec une courbe de vitesse et de force G, lisez l'avant, l'arrière et l'intérieur en synchro, et découpez un clip — pour les caméras Navitel comme pour bien d'autres marques. Rien à installer.",
        "cardHint": "Lecteur officiel gratuit — mais réservé à Windows et pensé pour Navitel",
        "whatItIs": "Navitel DVR Player, signé Navitel, est une application de bureau gratuite pour Windows destinée aux propriétaires de dashcams Navitel. C'est un outil solide : il lit les enregistrements MOV, AVI, MP4 et TS, affiche l'itinéraire sur une carte avec des courbes de vitesse et d'altitude, permet de cliquer un point sur la carte pour amener la vidéo à ce moment-là, classe les enregistrements en trajets, stationnements et événements, découpe et enregistre des fragments, et exporte le tracé GPS en cinq formats — NMEA, KML, CSV, GPX et PLT — et il sait même vérifier les mises à jour de firmware des caméras Navitel. Deux limites honnêtes pour tous les autres : il est réservé à Windows, et Navitel précise qu'il ne peut pas garantir que toutes les fonctions marchent avec des enregistreurs d'autres marques — sa carte GPS a besoin que les fichiers de tracé .NMEA propres à la caméra soient copiés à côté de la vidéo.",
        "comparisonIntro": "Les deux sont gratuits, et pour une caméra Navitel le lecteur officiel va loin. Voici les points où un outil dans le navigateur, multimarque, a l'avantage.",
        "compareRows": [
            {
                "dimension": "Prix",
                "us": {
                    "mark": "yes",
                    "note": "Gratuit"
                },
                "them": {
                    "mark": "yes",
                    "note": "Gratuit"
                }
            },
            {
                "dimension": "Fonctionne sur Mac, Linux et mobile",
                "us": {
                    "mark": "yes",
                    "note": "N'importe quel navigateur moderne"
                },
                "them": {
                    "mark": "no",
                    "note": "Réservé à Windows"
                }
            },
            {
                "dimension": "Rien à installer",
                "us": {
                    "mark": "yes",
                    "note": "S'ouvre dans le navigateur"
                },
                "them": {
                    "mark": "no",
                    "note": "Installation de bureau (Windows)"
                }
            },
            {
                "dimension": "Caméras prises en charge",
                "us": {
                    "mark": "yes",
                    "note": "Navitel, 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware + d'autres"
                },
                "them": {
                    "mark": "partial",
                    "note": "Navitel d'abord ; autres marques non garanties"
                }
            },
            {
                "dimension": "Avant/arrière/intérieur en même temps",
                "us": {
                    "mark": "yes",
                    "note": "Grille à 3 canaux"
                },
                "them": {
                    "mark": "partial",
                    "note": "Avant + arrière"
                }
            },
            {
                "dimension": "Formats d'export du tracé GPS",
                "us": {
                    "mark": "partial",
                    "note": "GPX + MP4 avec le GPS à l'intérieur"
                },
                "them": {
                    "mark": "yes",
                    "note": "NMEA, KML, CSV, GPX, PLT"
                }
            },
            {
                "dimension": "Carte intégrée",
                "us": {
                    "mark": "yes",
                    "note": "En direct, sans clé — aucune clé d'API qui puisse expirer"
                },
                "them": {
                    "mark": "yes",
                    "note": "Carte d'itinéraire intégrée"
                }
            }
        ],
        "whenStayTitle": "Quand Navitel DVR Player est le meilleur choix",
        "whenStay": "Si vous possédez une dashcam Navitel, le lecteur maison est taillé pour elle : il vérifie et installe les mises à jour de firmware des modèles Navitel, exporte votre tracé en cinq formats (NMEA, KML, CSV, GPX, PLT), affiche des courbes de vitesse et d'altitude, et tourne entièrement hors ligne comme application de bureau. dashcamigo lit aussi le GPS Navitel — aux côtés de 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware et d'autres — mais pour un parc uniquement Navitel, l'outil officiel va le plus loin. Et si dashcamigo ne lit pas encore votre caméra, envoyez un échantillon à feedback@dashcamigo.app — on ajoute les formats à partir d'enregistrements réels.",
        "ctaPrimary": "Ouvrir vos enregistrements",
        "faq": [
            {
                "q": "dashcamigo est-il un remplaçant de Navitel DVR Player ?",
                "a": "Pour le travail du quotidien — ouvrir un trajet avec une carte GPS, une courbe de vitesse et de force G, une lecture multicanal et le découpage d'un clip — oui, gratuitement et dans n'importe quel navigateur, et il lit aussi le GPS Navitel. Pour une caméra de marque Navitel en particulier, le lecteur officiel va plus loin (mises à jour de firmware, export du tracé en cinq formats), donc beaucoup de propriétaires Navitel gardent les deux."
            },
            {
                "q": "dashcamigo lit-il le GPS de ma dashcam Navitel ?",
                "a": "Oui — Navitel fait partie des formats pris en charge. Déposez tout le dossier de la carte SD et il lit le tracé puis le dessine sur la carte, exactement comme pour 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware et d'autres."
            },
            {
                "q": "dashcamigo fonctionne-t-il sur Mac, Linux ou mon téléphone ?",
                "a": "Oui. Il tourne dans le navigateur, donc Windows, macOS, Linux et mobile fonctionnent tous. Navitel DVR Player est réservé à Windows."
            },
            {
                "q": "Dois-je l'installer ou copier des fichiers particuliers ?",
                "a": "Aucune installation — ouvrez dashcamigo.app et déposez tout le dossier de la carte SD ; il trouve la vidéo et le GPS automatiquement. Navitel DVR Player est une application de bureau que vous installez, et pour la carte il a besoin que la vidéo soit copiée avec son fichier de tracé .NMEA séparé."
            },
            {
                "q": "dashcamigo est-il gratuit et confidentiel comme Navitel DVR Player ?",
                "a": "Oui — gratuit, sans compte, et sans serveur : votre navigateur lit les fichiers directement sur votre appareil ; rien n'est téléversé. Les deux outils sont gratuits ; dashcamigo se passe en plus de l'installation."
            }
        ]
    },
    "ja": {
        "title": "Navitel DVR Playerの代替 — 無料、クロスプラットフォーム、ブラウザで | dashcamigo",
        "metaDescription": "ブラウザで動く無料・クロスプラットフォームのNavitel DVR Player代替 — Windows・Mac・Linux・モバイル。Navitelほか多くのドラレコを読み込み、GPSマップ、インストール不要。",
        "ogTitle": "Navitel DVR Playerの無料代替 — ブラウザで",
        "ogDescription": "Navitel DVR PlayerはNavitelカメラ向けに作られた無料のWindows専用プレーヤーです。dashcamigoは多くのブランドを読み込む、クロスプラットフォームのブラウザ代替です。",
        "h1": "無料・クロスプラットフォームのNavitel DVR Player代替 — ブラウザで",
        "lead": "Navitel DVR PlayerはNavitel自身による無料のデスクトッププレーヤーで、しかも本当に有能です — GPSマップ、速度と高度のグラフ、複数フォーマットでのトラックエクスポートを備えています。難点は、Windows専用で、Navitel自社のカメラを中心に作られていることです。dashcamigoは日常の仕事をどんなデバイスのブラウザでもこなします — SDカードを開き、キー不要のGPSマップ上で速度とGフォースのグラフ付きの走行を確認し、フロント・リア・室内を同期再生し、クリップを切り出す — Navitelカメラでも、多くの他ブランドでも同じように。インストールするものは何もありません。",
        "cardHint": "無料の公式プレーヤー — ただしWindows専用でNavitel優先",
        "whatItIs": "Navitel DVR PlayerはNavitel製の、Navitelドラレコのオーナー向けの無料 Windows デスクトップアプリです。しっかりしたツールです — MOV、AVI、MP4、TSの録画を再生し、ルートを速度と高度のグラフ付きでマップに表示し、マップ上の地点をクリックすると動画をその瞬間まで飛ばせ、録画を走行・駐車・イベントに振り分け、フラグメントを切り出して保存し、GPSトラックを5つのフォーマット — NMEA、KML、CSV、GPX、PLT — でエクスポートし、Navitelカメラのファームウェア更新の確認までできます。それ以外の人にとっての2つの正直な制限 — Windows専用であること、そしてNavitel自身が他社レコーダーで全機能が動く保証はないと述べていること — そのGPSマップにはカメラの別の.NMEAトラックファイルを動画と並べてコピーする必要があります。",
        "comparisonIntro": "どちらも無料で、Navitelカメラなら公式プレーヤーは深く掘り下げます。ここからは、ブラウザで動くマルチベンダーのツールが優位な点を示します。",
        "compareRows": [
            {
                "dimension": "価格",
                "us": {
                    "mark": "yes",
                    "note": "無料"
                },
                "them": {
                    "mark": "yes",
                    "note": "無料"
                }
            },
            {
                "dimension": "Mac・Linux・モバイルで動く",
                "us": {
                    "mark": "yes",
                    "note": "あらゆるモダンブラウザ"
                },
                "them": {
                    "mark": "no",
                    "note": "Windows専用"
                }
            },
            {
                "dimension": "インストール不要",
                "us": {
                    "mark": "yes",
                    "note": "ブラウザで開く"
                },
                "them": {
                    "mark": "no",
                    "note": "デスクトップにインストール（Windows）"
                }
            },
            {
                "dimension": "読み込めるカメラ",
                "us": {
                    "mark": "yes",
                    "note": "Navitel、70mai、Viofo、BlackVue、GoPro、Garmin、Vantrue、Thinkwareほか"
                },
                "them": {
                    "mark": "partial",
                    "note": "Navitel優先。他ブランドは保証なし"
                }
            },
            {
                "dimension": "フロント・リア・室内を同時に",
                "us": {
                    "mark": "yes",
                    "note": "3チャンネルのグリッド"
                },
                "them": {
                    "mark": "partial",
                    "note": "フロント＋リア"
                }
            },
            {
                "dimension": "GPSトラックのエクスポート形式",
                "us": {
                    "mark": "partial",
                    "note": "GPX＋GPS付きMP4"
                },
                "them": {
                    "mark": "yes",
                    "note": "NMEA、KML、CSV、GPX、PLT"
                }
            },
            {
                "dimension": "内蔵マップ",
                "us": {
                    "mark": "yes",
                    "note": "ライブ、キー不要 — 期限切れになるAPIキーなし"
                },
                "them": {
                    "mark": "yes",
                    "note": "内蔵のルートマップ"
                }
            }
        ],
        "whenStayTitle": "Navitel DVR Playerの方が良い選択になる場合",
        "whenStay": "Navitelのドラレコをお使いなら、メーカー自身のプレーヤーはそれ専用に作られています — Navitelモデルのファームウェア更新を確認してインストールし、トラックを5つのフォーマット（NMEA、KML、CSV、GPX、PLT）でエクスポートし、速度と高度のグラフを表示し、デスクトップアプリとして完全オフラインで動作します。dashcamigoもNavitelのGPSを読み込みます — 70mai、Viofo、BlackVue、GoPro、Garmin、Vantrue、Thinkwareなどと並んで — ですが、Navitelだけの構成なら公式ツールが最も深く掘り下げます。そして、もしdashcamigoがまだお使いのカメラを読み取れなくても、サンプルをfeedback@dashcamigo.appまで送ってください — 私たちは実際の録画からフォーマットを追加しています。",
        "ctaPrimary": "録画を開く",
        "faq": [
            {
                "q": "dashcamigoはNavitel DVR Playerの置き換えになりますか？",
                "a": "日常の仕事 — GPSマップ、速度とGフォースのグラフ付きで走行を開き、複数チャンネルで再生し、クリップを切り出すこと — については、はい、無料でどんなブラウザでも動き、NavitelのGPSも読み込みます。Navitelブランドのカメラに限れば、公式プレーヤーの方が深く掘り下げます（ファームウェア更新、5フォーマットのトラックエクスポート）。そのため多くのNavitelオーナーは両方を使い続けています。"
            },
            {
                "q": "dashcamigoは私のNavitelドラレコのGPSを読み込みますか？",
                "a": "はい — Navitelは対応フォーマットの一つです。SDカードのフォルダーをまるごとドロップすれば、トラックを読み取ってマップに描きます — 70mai、Viofo、BlackVue、GoPro、Garmin、Vantrue、Thinkwareなどと同じように。"
            },
            {
                "q": "dashcamigoはMac、Linux、私のスマホで動きますか？",
                "a": "はい。ブラウザで動くので、Windows、macOS、Linux、モバイルすべてで使えます。Navitel DVR PlayerはWindows専用です。"
            },
            {
                "q": "インストールしたり特別なファイルをコピーしたりする必要がありますか？",
                "a": "インストール不要です — dashcamigo.appを開いてSDカードのフォルダーをまるごとドロップすれば、動画とGPSを自動で見つけます。Navitel DVR Playerはインストールするデスクトップアプリで、マップには動画とその別の.NMEAトラックファイルを並べてコピーする必要があります。"
            },
            {
                "q": "dashcamigoはNavitel DVR Playerのように無料でプライベートですか？",
                "a": "はい — 無料、アカウント不要、録画を受け取るサーバーもありません。ブラウザがデバイス上のファイルを直接読み取るため、何もアップロードされません。どちらのツールも無料です。dashcamigoはさらにインストールも不要です。"
            }
        ]
    },
    "ko": {
        "title": "Navitel DVR Player 대안 — 무료, 크로스플랫폼, 브라우저에서 | dashcamigo",
        "metaDescription": "브라우저에서 돌아가는 무료 크로스플랫폼 Navitel DVR Player 대안 — Windows, Mac, Linux, 모바일. Navitel과 여러 블랙박스를 읽고 GPS 지도까지, 설치 불필요.",
        "ogTitle": "무료 Navitel DVR Player 대안 — 브라우저에서",
        "ogDescription": "Navitel DVR Player는 Navitel 카메라용으로 만들어진 무료 Windows 전용 플레이어입니다. dashcamigo는 여러 브랜드를 읽는 크로스플랫폼 브라우저 대안입니다.",
        "h1": "무료 크로스플랫폼 Navitel DVR Player 대안 — 브라우저에서",
        "lead": "Navitel DVR Player는 Navitel이 직접 만든 무료 데스크톱 플레이어이고, GPS 지도·속도와 고도 그래프·다중 형식 트랙 내보내기까지 갖춘 제법 유능한 도구입니다. 다만 Windows 전용이고 Navitel 자체 카메라를 중심으로 설계되어 있다는 점이 걸립니다. dashcamigo는 어떤 기기에서든 브라우저로 일상의 작업을 해냅니다 — SD 카드를 열고, 속도와 G 포스 차트가 곁들여진 키 없는 GPS 지도에서 주행을 확인하고, 전방·후방·실내를 동기화해 재생하고, 클립을 잘라내는 일을, Navitel 카메라든 다른 여러 브랜드든 똑같이요. 설치할 것도 없습니다.",
        "cardHint": "무료 공식 플레이어 — 하지만 Windows 전용에 Navitel 우선",
        "whatItIs": "Navitel이 만든 Navitel DVR Player는 Navitel 블랙박스 사용자를 위한 무료 Windows 데스크톱 애플리케이션입니다. 탄탄한 도구죠 — MOV, AVI, MP4, TS 녹화를 재생하고, 속도와 고도 그래프와 함께 경로를 지도에 표시하며, 지도 위 한 지점을 클릭하면 영상을 그 순간으로 이동시키고, 녹화를 주행·주차·이벤트로 분류하고, 조각을 잘라 저장하며, GPS 트랙을 다섯 가지 형식 — NMEA, KML, CSV, GPX, PLT — 으로 내보내고, Navitel 카메라의 펌웨어 업데이트까지 확인할 수 있습니다. 그 외 모두에게는 솔직한 한계가 둘 있습니다 — Windows 전용이라는 점, 그리고 Navitel 스스로 자사 외 블랙박스에서는 모든 기능이 작동한다고 보장하지 못한다고 밝힌 점입니다. 게다가 GPS 지도를 쓰려면 카메라의 별도 .NMEA 트랙 파일을 영상 옆에 함께 복사해 두어야 합니다.",
        "comparisonIntro": "둘 다 무료이고, Navitel 카메라라면 공식 플레이어가 깊이 들어갑니다. 브라우저 기반 멀티벤더 도구가 우위에 서는 지점은 여기입니다.",
        "compareRows": [
            {
                "dimension": "가격",
                "us": {
                    "mark": "yes",
                    "note": "무료"
                },
                "them": {
                    "mark": "yes",
                    "note": "무료"
                }
            },
            {
                "dimension": "Mac, Linux, 모바일에서 실행",
                "us": {
                    "mark": "yes",
                    "note": "최신 브라우저 어디서나"
                },
                "them": {
                    "mark": "no",
                    "note": "Windows 전용"
                }
            },
            {
                "dimension": "설치할 것 없음",
                "us": {
                    "mark": "yes",
                    "note": "브라우저에서 열림"
                },
                "them": {
                    "mark": "no",
                    "note": "데스크톱 설치(Windows)"
                }
            },
            {
                "dimension": "읽을 수 있는 카메라",
                "us": {
                    "mark": "yes",
                    "note": "Navitel, 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware 등"
                },
                "them": {
                    "mark": "partial",
                    "note": "Navitel 우선; 다른 브랜드는 보장 안 됨"
                }
            },
            {
                "dimension": "전방/후방/실내 동시 재생",
                "us": {
                    "mark": "yes",
                    "note": "3채널 그리드"
                },
                "them": {
                    "mark": "partial",
                    "note": "전방 + 후방"
                }
            },
            {
                "dimension": "GPS 트랙 내보내기 형식",
                "us": {
                    "mark": "partial",
                    "note": "GPX + GPS 내장 MP4"
                },
                "them": {
                    "mark": "yes",
                    "note": "NMEA, KML, CSV, GPX, PLT"
                }
            },
            {
                "dimension": "내장 지도",
                "us": {
                    "mark": "yes",
                    "note": "실시간, 키 없음 — 만료될 API 키 없음"
                },
                "them": {
                    "mark": "yes",
                    "note": "내장 경로 지도"
                }
            }
        ],
        "whenStayTitle": "Navitel DVR Player가 더 나은 선택인 경우",
        "whenStay": "Navitel 블랙박스를 쓰신다면, 제조사가 직접 만든 플레이어가 그 기기에 맞춰져 있습니다 — Navitel 모델의 펌웨어 업데이트를 확인하고 설치하며, 트랙을 다섯 가지 형식(NMEA, KML, CSV, GPX, PLT)으로 내보내고, 속도와 고도 그래프를 보여주며, 데스크톱 앱으로 완전히 오프라인에서 돌아갑니다. dashcamigo도 Navitel GPS를 읽습니다 — 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware 등과 함께요 — 하지만 Navitel만 쓰는 구성이라면 공식 도구가 가장 깊이 들어갑니다. 그리고 dashcamigo가 아직 사용하시는 카메라를 읽지 못한다면 feedback@dashcamigo.app으로 샘플을 보내주세요 — 우리는 실제 녹화 파일을 받아 형식을 추가하고 있습니다.",
        "ctaPrimary": "내 녹화 영상 열기",
        "faq": [
            {
                "q": "dashcamigo는 Navitel DVR Player를 대체할 수 있나요?",
                "a": "일상의 작업 — GPS 지도와 속도·G 포스 차트로 주행을 열고, 다중 채널로 재생하고, 클립을 잘라내는 일 — 에 대해서는 그렇습니다. 무료이고 어떤 브라우저에서나 돌아가며, Navitel GPS도 읽습니다. 다만 Navitel 브랜드 카메라에 한해서는 공식 플레이어가 더 깊이 들어가므로(펌웨어 업데이트, 다섯 가지 형식 트랙 내보내기), 적지 않은 Navitel 사용자가 둘 다 함께 씁니다."
            },
            {
                "q": "dashcamigo가 제 Navitel 블랙박스의 GPS를 읽나요?",
                "a": "네 — Navitel은 지원 형식에 포함됩니다. SD 카드 폴더를 통째로 끌어다 놓으면 트랙을 읽어 지도에 그려줍니다. 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware 등에 대해 하는 것과 똑같이요."
            },
            {
                "q": "dashcamigo는 Mac, Linux, 제 휴대폰에서도 작동하나요?",
                "a": "네. 브라우저에서 돌아가므로 Windows, macOS, Linux, 모바일 모두 작동합니다. Navitel DVR Player는 Windows 전용입니다."
            },
            {
                "q": "설치하거나 특별한 파일을 복사해야 하나요?",
                "a": "설치는 필요 없습니다 — dashcamigo.app을 열고 SD 카드 폴더를 통째로 끌어다 놓으면 영상과 GPS를 자동으로 찾습니다. Navitel DVR Player는 설치해야 하는 데스크톱 앱이고, 지도를 쓰려면 영상과 별도의 .NMEA 트랙 파일을 함께 복사해 두기를 요구합니다."
            },
            {
                "q": "dashcamigo도 Navitel DVR Player처럼 무료이고 프라이버시를 지키나요?",
                "a": "네 — 무료이고, 계정도 없고, 녹화 영상을 받을 서버도 없습니다. 브라우저가 기기의 파일을 직접 읽어서 아무것도 업로드되지 않습니다. 두 도구 모두 무료이고, dashcamigo는 거기에 더해 설치도 건너뜁니다."
            }
        ]
    },
    "pl": {
        "title": "Alternatywa dla Navitel DVR Player — za darmo, wieloplatformowo, w przeglądarce | dashcamigo",
        "metaDescription": "Darmowa, wieloplatformowa alternatywa dla Navitel DVR Player w przeglądarce — Windows, Mac, Linux, mobilne. Czyta Navitel i wiele innych kamer, mapa GPS, bez instalacji.",
        "ogTitle": "Darmowa alternatywa dla Navitel DVR Player — w przeglądarce",
        "ogDescription": "Navitel DVR Player to darmowy odtwarzacz tylko na Windows, zrobiony pod kamery Navitel. dashcamigo to wieloplatformowa alternatywa w przeglądarce, która czyta wiele marek.",
        "h1": "Darmowa, wieloplatformowa alternatywa dla Navitel DVR Player — w przeglądarce",
        "lead": "Navitel DVR Player to własny, darmowy odtwarzacz na pulpit od Navitel — i naprawdę dobry, z mapą GPS, wykresami prędkości i wysokości oraz eksportem trasy w wielu formatach. Haczyk w tym, że działa tylko na Windows i jest zbudowany wokół kamer samej Navitel. dashcamigo wykonuje codzienną robotę w przeglądarce na dowolnym urządzeniu: otwierasz kartę SD, widzisz przejazd na mapie GPS bez kluczy z wykresem prędkości i przeciążeń, odtwarzasz przód, tył i wnętrze w synchronizacji oraz przycinasz klip — i dla kamer Navitel, i dla wielu innych marek. Nic do zainstalowania.",
        "cardHint": "Darmowy oficjalny odtwarzacz — ale tylko Windows i pod Navitel",
        "whatItIs": "Navitel DVR Player autorstwa Navitel to darmowa aplikacja na pulpit Windows dla właścicieli kamer Navitel. To solidne narzędzie: odtwarza nagrania MOV, AVI, MP4 i TS, pokazuje trasę na mapie z wykresami prędkości i wysokości, pozwala kliknąć punkt na mapie, by przeskoczyć wideo do tego momentu, sortuje nagrania na przejazdy, postoje i zdarzenia, tnie i zapisuje fragmenty oraz eksportuje ścieżkę GPS w pięciu formatach — NMEA, KML, CSV, GPX i PLT — a potrafi nawet sprawdzać aktualizacje oprogramowania kamer Navitel. Dwa szczere ograniczenia dla całej reszty: działa tylko na Windows, a Navitel sama pisze, że nie gwarantuje działania każdej funkcji z rejestratorami innych marek — jego mapa GPS potrzebuje osobnych plików ścieżki .NMEA z kamery, skopiowanych obok wideo.",
        "comparisonIntro": "Oba są darmowe, a dla kamery Navitel oficjalny odtwarzacz kopie głęboko. Oto gdzie przewagę ma narzędzie w przeglądarce, czytające wielu producentów.",
        "compareRows": [
            {
                "dimension": "Cena",
                "us": {
                    "mark": "yes",
                    "note": "Za darmo"
                },
                "them": {
                    "mark": "yes",
                    "note": "Za darmo"
                }
            },
            {
                "dimension": "Działa na Mac, Linux i urządzeniach mobilnych",
                "us": {
                    "mark": "yes",
                    "note": "Dowolna nowoczesna przeglądarka"
                },
                "them": {
                    "mark": "no",
                    "note": "Tylko Windows"
                }
            },
            {
                "dimension": "Nic do zainstalowania",
                "us": {
                    "mark": "yes",
                    "note": "Otwiera się w przeglądarce"
                },
                "them": {
                    "mark": "no",
                    "note": "Instalacja na pulpicie (Windows)"
                }
            },
            {
                "dimension": "Jakie kamery czyta",
                "us": {
                    "mark": "yes",
                    "note": "Navitel, 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware i inne"
                },
                "them": {
                    "mark": "partial",
                    "note": "Najpierw Navitel; inne marki bez gwarancji"
                }
            },
            {
                "dimension": "Przód/tył/wnętrze naraz",
                "us": {
                    "mark": "yes",
                    "note": "Siatka 3 kanałów"
                },
                "them": {
                    "mark": "partial",
                    "note": "Przód + tył"
                }
            },
            {
                "dimension": "Formaty eksportu ścieżki GPS",
                "us": {
                    "mark": "partial",
                    "note": "GPX + MP4 z GPS w środku"
                },
                "them": {
                    "mark": "yes",
                    "note": "NMEA, KML, CSV, GPX, PLT"
                }
            },
            {
                "dimension": "Wbudowana mapa",
                "us": {
                    "mark": "yes",
                    "note": "Na żywo, bez kluczy — żaden klucz API nie wygaśnie"
                },
                "them": {
                    "mark": "yes",
                    "note": "Wbudowana mapa trasy"
                }
            }
        ],
        "whenStayTitle": "Kiedy Navitel DVR Player jest lepszym wyborem",
        "whenStay": "Jeśli masz kamerę Navitel, odtwarzacz producenta jest zrobiony właśnie pod nią: sprawdza i instaluje aktualizacje oprogramowania modeli Navitel, eksportuje ścieżkę w pięciu formatach (NMEA, KML, CSV, GPX, PLT), pokazuje wykresy prędkości i wysokości oraz działa w pełni offline jako program na pulpit. dashcamigo też czyta GPS z Navitel — obok 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware i innych — ale dla zestawu wyłącznie z Navitel oficjalne narzędzie kopie najgłębiej. A jeśli dashcamigo jeszcze nie czyta Twojej kamery, wyślij próbkę na feedback@dashcamigo.app — dodajemy formaty na podstawie prawdziwych nagrań.",
        "ctaPrimary": "Otwórz swoje nagrania",
        "faq": [
            {
                "q": "Czy dashcamigo to zamiennik Navitel DVR Player?",
                "a": "Do codziennego zadania — otwarcia przejazdu z mapą GPS, wykresem prędkości i przeciążeń, odtwarzaniem wielokanałowym i przycięciem klipu — tak, za darmo i w dowolnej przeglądarce, a GPS z Navitel też czyta. Konkretnie dla kamery marki Navitel oficjalny odtwarzacz kopie głębiej (aktualizacje oprogramowania, eksport ścieżki w pięciu formatach), więc wielu właścicieli Navitel trzyma oba."
            },
            {
                "q": "Czy dashcamigo czyta GPS z mojej kamery Navitel?",
                "a": "Tak — Navitel jest wśród obsługiwanych formatów. Przeciągnij cały folder z karty SD, a odczyta ścieżkę i narysuje ją na mapie — tak samo jak dla 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware i innych."
            },
            {
                "q": "Czy dashcamigo działa na Mac, Linux lub moim telefonie?",
                "a": "Tak. Działa w przeglądarce, więc Windows, macOS, Linux i urządzenia mobilne — wszystko działa. Navitel DVR Player jest tylko na Windows."
            },
            {
                "q": "Czy muszę go instalować albo kopiować specjalne pliki?",
                "a": "Bez instalacji — otwórz dashcamigo.app i przeciągnij cały folder z karty SD; sam znajdzie wideo i GPS. Navitel DVR Player to aplikacja na pulpit, którą się instaluje, a do mapy potrzebuje skopiowanego wideo wraz z osobnym plikiem ścieżki .NMEA."
            },
            {
                "q": "Czy dashcamigo jest darmowy i prywatny jak Navitel DVR Player?",
                "a": "Tak — za darmo, bez konta i bez serwera na nagrania: przeglądarka odczytuje pliki bezpośrednio z twojego urządzenia; nic nie jest wysyłane. Oba narzędzia są darmowe; dashcamigo dodatkowo obywa się bez instalacji."
            }
        ]
    },
    "pt": {
        "title": "Alternativa ao Navitel DVR Player — grátis, multiplataforma, no navegador | dashcamigo",
        "metaDescription": "Alternativa gratuita e multiplataforma ao Navitel DVR Player no navegador — Windows, Mac, Linux, celular. Lê Navitel e muitas outras dashcams, mapa GPS, sem instalação.",
        "ogTitle": "Alternativa grátis ao Navitel DVR Player — no navegador",
        "ogDescription": "O Navitel DVR Player é um player gratuito só para Windows, feito para as câmeras Navitel. O dashcamigo é a alternativa multiplataforma, no navegador, que lê muitas marcas.",
        "h1": "Uma alternativa gratuita e multiplataforma ao Navitel DVR Player — no navegador",
        "lead": "O Navitel DVR Player é o player de desktop gratuito da própria Navitel — e bem competente, com mapa GPS, gráficos de velocidade e altitude e exportação de trajeto em vários formatos. O porém é que ele só roda no Windows e foi feito em torno das câmeras da própria Navitel. O dashcamigo faz a tarefa do dia a dia no seu navegador, em qualquer dispositivo: abra o cartão SD, veja a viagem num mapa GPS sem chave com gráfico de velocidade e força G, reproduza frente, traseira e interior em sincronia, e corte um trecho — tanto para câmeras Navitel quanto para muitas outras marcas. Nada para instalar.",
        "cardHint": "Player oficial gratuito — mas só para Windows e voltado à Navitel",
        "whatItIs": "O Navitel DVR Player, da Navitel, é um aplicativo de desktop gratuito para Windows para donos de dashcams Navitel. É uma ferramenta sólida: reproduz gravações MOV, AVI, MP4 e TS, mostra a rota num mapa com gráficos de velocidade e altitude, permite clicar num ponto do mapa para saltar o vídeo até aquele momento, organiza as gravações em viagens, estacionamento e eventos, corta e salva fragmentos, e exporta o trajeto GPS em cinco formatos — NMEA, KML, CSV, GPX e PLT — e ele ainda consegue verificar atualizações de firmware das câmeras Navitel. Dois limites honestos para todos os demais: ele só roda no Windows, e a própria Navitel diz que não pode garantir que todos os recursos funcionem com registradores de outras marcas — seu mapa GPS precisa dos arquivos de trajeto .NMEA separados da câmera copiados junto com o vídeo.",
        "comparisonIntro": "Ambos são gratuitos, e para uma câmera Navitel o player oficial vai fundo. Veja onde uma ferramenta no navegador e multimarca leva vantagem.",
        "compareRows": [
            {
                "dimension": "Preço",
                "us": {
                    "mark": "yes",
                    "note": "Grátis"
                },
                "them": {
                    "mark": "yes",
                    "note": "Grátis"
                }
            },
            {
                "dimension": "Roda no Mac, Linux e celular",
                "us": {
                    "mark": "yes",
                    "note": "Qualquer navegador moderno"
                },
                "them": {
                    "mark": "no",
                    "note": "Só Windows"
                }
            },
            {
                "dimension": "Nada para instalar",
                "us": {
                    "mark": "yes",
                    "note": "Abre no navegador"
                },
                "them": {
                    "mark": "no",
                    "note": "Instalação de desktop (Windows)"
                }
            },
            {
                "dimension": "Câmeras que lê",
                "us": {
                    "mark": "yes",
                    "note": "Navitel, 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware e mais"
                },
                "them": {
                    "mark": "partial",
                    "note": "Voltado primeiro à Navitel; outras marcas sem garantia"
                }
            },
            {
                "dimension": "Frente/traseira/interior ao mesmo tempo",
                "us": {
                    "mark": "yes",
                    "note": "Grade de 3 canais"
                },
                "them": {
                    "mark": "partial",
                    "note": "Frente + traseira"
                }
            },
            {
                "dimension": "Formatos de exportação do trajeto GPS",
                "us": {
                    "mark": "partial",
                    "note": "GPX + MP4 com GPS dentro"
                },
                "them": {
                    "mark": "yes",
                    "note": "NMEA, KML, CSV, GPX, PLT"
                }
            },
            {
                "dimension": "Mapa integrado",
                "us": {
                    "mark": "yes",
                    "note": "Ao vivo, sem chave — nenhuma chave de API para expirar"
                },
                "them": {
                    "mark": "yes",
                    "note": "Mapa de rota integrado"
                }
            }
        ],
        "whenStayTitle": "Quando o Navitel DVR Player é a melhor escolha",
        "whenStay": "Se você tem uma dashcam Navitel, o player do próprio fabricante foi feito sob medida para ela: verifica e instala atualizações de firmware dos modelos Navitel, exporta seu trajeto em cinco formatos (NMEA, KML, CSV, GPX, PLT), mostra gráficos de velocidade e altitude e roda totalmente offline como um app de desktop. O dashcamigo também lê o GPS da Navitel — junto com 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware e mais — mas para um conjunto só de Navitel, a ferramenta oficial vai mais fundo. E se o dashcamigo ainda não lê a sua câmera, mande uma amostra para feedback@dashcamigo.app — a gente adiciona formatos a partir de gravações reais.",
        "ctaPrimary": "Abra suas gravações",
        "faq": [
            {
                "q": "O dashcamigo é um substituto para o Navitel DVR Player?",
                "a": "Para a tarefa do dia a dia — abrir uma viagem com mapa GPS, um gráfico de velocidade e força G, reprodução multicanal e cortar um trecho — sim, grátis e em qualquer navegador, e ele também lê o GPS da Navitel. Para uma câmera da marca Navitel especificamente, o player oficial vai mais fundo (atualizações de firmware, exportação de trajeto em cinco formatos), então muitos donos de Navitel mantêm os dois."
            },
            {
                "q": "O dashcamigo lê o GPS da minha dashcam Navitel?",
                "a": "Sim — a Navitel está entre os formatos suportados. Solte a pasta inteira do cartão SD e ele lê o trajeto e o desenha no mapa, igual ao que faz com 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware e outras."
            },
            {
                "q": "O dashcamigo funciona no Mac, Linux ou no meu celular?",
                "a": "Sim. Ele roda no navegador, então Windows, macOS, Linux e celular funcionam. O Navitel DVR Player é só para Windows."
            },
            {
                "q": "Preciso instalar algo ou copiar arquivos especiais?",
                "a": "Sem instalação — abra o dashcamigo.app e solte a pasta inteira do cartão SD; ele encontra o vídeo e o GPS automaticamente. O Navitel DVR Player é um app de desktop que você instala, e para o mapa ele precisa que o vídeo seja copiado junto com seu arquivo de trajeto .NMEA separado."
            },
            {
                "q": "O dashcamigo é gratuito e privado como o Navitel DVR Player?",
                "a": "Sim — gratuito, sem conta e sem servidor para as gravações: seu navegador lê os arquivos direto do seu dispositivo; nada é enviado. As duas ferramentas são gratuitas; o dashcamigo ainda dispensa a instalação."
            }
        ]
    },
    "zh": {
        "title": "Navitel DVR Player 替代方案——免费、跨平台，在浏览器里 | dashcamigo",
        "metaDescription": "免费、跨平台的 Navitel DVR Player 替代方案，在浏览器里运行——Windows、Mac、Linux、移动端。读取 Navitel 及众多其他行车记录仪，GPS 地图，无需安装。",
        "ogTitle": "免费 Navitel DVR Player 替代方案——在浏览器里",
        "ogDescription": "Navitel DVR Player 是一款免费、仅限 Windows、专为 Navitel 摄像头打造的播放器。dashcamigo 是跨平台、在浏览器里运行、能读取众多品牌的替代方案。",
        "h1": "一款免费、跨平台的 Navitel DVR Player 替代方案——在浏览器里",
        "lead": "Navitel DVR Player 是 Navitel 自家的免费桌面播放器——而且确实有两把刷子：配有 GPS 地图、速度和高度图表，以及多格式轨迹导出。问题在于它只能在 Windows 上运行，并且是围绕 Navitel 自家的摄像头打造的。dashcamigo 在任意设备的浏览器里完成日常这件事：打开 SD 卡，在一张无需密钥的 GPS 地图上看到行程，配速度与 G 力图表，同步播放前置、后置和车内画面，再剪出一段——既支持 Navitel 摄像头，也支持众多其他品牌。无需安装任何东西。",
        "cardHint": "免费的官方播放器——但仅限 Windows，且以 Navitel 为先",
        "whatItIs": "Navitel DVR Player 由 Navitel 出品，是一款面向 Navitel 行车记录仪用户的免费 Windows 桌面应用。它是个扎实的工具：能播放 MOV、AVI、MP4 和 TS 录像，在地图上显示路线并配速度和高度图表，点击地图上的某个点即可把视频跳转到那一刻，把录像归类为行程、停车和事件，剪切并保存片段，还能以五种格式导出 GPS 轨迹——NMEA、KML、CSV、GPX 和 PLT，它甚至还能为 Navitel 摄像头检查固件更新。对其他所有人来说有两个诚实的限制：它只能在 Windows 上运行，而且 Navitel 自己也说无法保证每项功能都能在非 Navitel 记录仪上正常工作——它的 GPS 地图需要把摄像头单独的 .NMEA 轨迹文件复制到视频旁边。",
        "comparisonIntro": "两者都免费，而且对于 Navitel 摄像头，官方播放器钻得很深。下面看看一款在浏览器里运行、支持多品牌的工具在哪里更有优势。",
        "compareRows": [
            {
                "dimension": "价格",
                "us": {
                    "mark": "yes",
                    "note": "免费"
                },
                "them": {
                    "mark": "yes",
                    "note": "免费"
                }
            },
            {
                "dimension": "可在 Mac、Linux 和移动端运行",
                "us": {
                    "mark": "yes",
                    "note": "任意现代浏览器"
                },
                "them": {
                    "mark": "no",
                    "note": "仅限 Windows"
                }
            },
            {
                "dimension": "无需安装任何东西",
                "us": {
                    "mark": "yes",
                    "note": "在浏览器里打开"
                },
                "them": {
                    "mark": "no",
                    "note": "桌面安装（Windows）"
                }
            },
            {
                "dimension": "能读取的摄像头",
                "us": {
                    "mark": "yes",
                    "note": "Navitel、70mai、Viofo、BlackVue、GoPro、Garmin、Vantrue、Thinkware 等更多"
                },
                "them": {
                    "mark": "partial",
                    "note": "以 Navitel 为先；其他品牌不保证"
                }
            },
            {
                "dimension": "前置/后置/车内同时显示",
                "us": {
                    "mark": "yes",
                    "note": "3 通道网格"
                },
                "them": {
                    "mark": "partial",
                    "note": "前置 + 后置"
                }
            },
            {
                "dimension": "GPS 轨迹导出格式",
                "us": {
                    "mark": "partial",
                    "note": "GPX + 内嵌 GPS 的 MP4"
                },
                "them": {
                    "mark": "yes",
                    "note": "NMEA、KML、CSV、GPX、PLT"
                }
            },
            {
                "dimension": "内置地图",
                "us": {
                    "mark": "yes",
                    "note": "实时、无需密钥——不会失效"
                },
                "them": {
                    "mark": "yes",
                    "note": "内置路线地图"
                }
            }
        ],
        "whenStayTitle": "什么时候 Navitel DVR Player 是更好的选择",
        "whenStay": "如果你拥有一台 Navitel 行车记录仪，厂商自家的播放器就是为它量身打造的：它能为 Navitel 型号检查并安装固件更新，以五种格式（NMEA、KML、CSV、GPX、PLT）导出你的轨迹，显示速度和高度图表，并作为桌面应用完全离线运行。dashcamigo 也读取 Navitel 的 GPS——同时还有 70mai、Viofo、BlackVue、GoPro、Garmin、Vantrue、Thinkware 等等——但对于只有 Navitel 的配置，官方工具钻得最深。而且，如果 dashcamigo 还读不出你的摄像头，把样片发到 feedback@dashcamigo.app——我们根据真实录像来添加格式。",
        "ctaPrimary": "打开你的录像",
        "faq": [
            {
                "q": "dashcamigo 能替代 Navitel DVR Player 吗？",
                "a": "就日常这件事而言——用 GPS 地图、速度与 G 力图表打开行程，多通道播放并剪出一段片段——可以，免费且在任意浏览器里，而且它也读取 Navitel 的 GPS。但具体到 Navitel 品牌的摄像头，官方播放器钻得更深（固件更新、五种格式的轨迹导出），所以不少 Navitel 用户两者都留着。"
            },
            {
                "q": "dashcamigo 能读取我 Navitel 行车记录仪的 GPS 吗？",
                "a": "可以——Navitel 在受支持的格式之列。把整个 SD 卡文件夹拖进去，它就会读取轨迹并画在地图上，跟它处理 70mai、Viofo、BlackVue、GoPro、Garmin、Vantrue、Thinkware 等品牌时一样。"
            },
            {
                "q": "dashcamigo 能在 Mac、Linux 或我的手机上用吗？",
                "a": "可以。它在浏览器里运行，所以 Windows、macOS、Linux 和移动端都能用。Navitel DVR Player 只能在 Windows 上运行。"
            },
            {
                "q": "我需要安装它或复制特殊文件吗？",
                "a": "无需安装——打开 dashcamigo.app 并把整个 SD 卡文件夹拖进去；它会自动找到视频和 GPS。Navitel DVR Player 是一款需要安装的桌面应用，而且为了显示地图，它需要把视频连同其单独的 .NMEA 轨迹文件一起复制过去。"
            },
            {
                "q": "dashcamigo 像 Navitel DVR Player 一样免费且私密吗？",
                "a": "是的——免费、无需账户，也没有用于接收录像的服务器：浏览器会直接读取你设备上的文件，什么都不会上传。两款工具都免费；dashcamigo 还省去了安装。"
            }
        ]
    }
},
    "camgeoplayer": {
    "de": {
        "title": "CamGeoPlayer-Alternative — kostenlos, ohne Download, im Browser | dashcamigo",
        "metaDescription": "Eine kostenlose CamGeoPlayer-Alternative im Browser — kein großer Download, kein .NET. GPS-Karte, Geschwindigkeitsdiagramm, Mehrkanal und Clip-Export. Nichts zu installieren.",
        "ogTitle": "Kostenlose CamGeoPlayer-Alternative — im Browser",
        "ogDescription": "CamGeoPlayer ist ein kostenloser Indie-Windows-Player, der dein Dashcam-GPS auf einer Karte zeigt. dashcamigo macht das im Browser — plus Geschwindigkeitsdiagramm und Clip-Export.",
        "h1": "Eine kostenlose CamGeoPlayer-Alternative — im Browser, und sie kann mehr",
        "lead": "CamGeoPlayer ist eine kostenlose kleine Windows-App, die das GPS in deinen Dashcam-Videos ausliest und die Route auf einer Karte einzeichnet — die Antwort eines einzelnen Entwicklers auf kostenpflichtige Player mit Testlimits. dashcamigo macht dasselbe in deinem Browser, ganz ohne Download, und ergänzt das, was CamGeoPlayer nicht hat: ein Diagramm für Geschwindigkeit und G-Kraft, Front/Heck/Innenraum synchron, automatisch gruppierte Fahrten und Clip-Export mit dem GPS direkt darin. Dieselbe Idee — dein GPS auslesen und auf einer Karte zeigen — weitergedacht und auf dem aktuellen Stand gehalten.",
        "cardHint": "Kostenloser Indie-Windows-Player; noch frühe Beta",
        "whatItIs": "CamGeoPlayer ist eine kostenlose Windows-App (braucht .NET) eines unabhängigen Entwicklers, entstanden, nachdem er bestehende GPS-Player nur kostenpflichtig oder umständlich fand. Du lädst eine Warteschlange von Videos, und sie spielt sie nacheinander ab, liest das in jedem eingebettete GPS aus und zeichnet die gesamte Fahrt auf einer OpenStreetMap-Karte ein, mit einem Marker, der sich synchron zur Wiedergabe bewegt — sie holt das GPS über ExifTool und nutzt Leaflet für die Karte. Einen Installer gibt es nicht: Du lädst ein großes Zip herunter, entpackst es und startest die .exe (manche Antivirenprogramme schlagen Alarm, was der Entwickler mit der eingebetteten Browser-Engine und dem mitgelieferten exiftool erklärt). Er sagt offen, dass es früh dran ist — der aktuelle Build ist eine frühe Beta, ohne neueren öffentlichen Release.",
        "comparisonIntro": "Beide sind kostenlos und beide zeichnen dein GPS auf eine Karte. Hier ist, was dashcamigo dazu legt — und wo es einfacher zu starten ist.",
        "compareRows": [
            {
                "dimension": "Preis",
                "us": {
                    "mark": "yes",
                    "note": "Kostenlos"
                },
                "them": {
                    "mark": "yes",
                    "note": "Kostenlos"
                }
            },
            {
                "dimension": "Läuft auf Mac, Linux & mobil",
                "us": {
                    "mark": "yes",
                    "note": "Jeder aktuelle Browser"
                },
                "them": {
                    "mark": "no",
                    "note": "Nur Windows (braucht .NET)"
                }
            },
            {
                "dimension": "Nichts zu installieren oder herunterzuladen",
                "us": {
                    "mark": "yes",
                    "note": "Öffnet im Browser"
                },
                "them": {
                    "mark": "partial",
                    "note": "Großes Zip, entpacken und starten"
                }
            },
            {
                "dimension": "Wird noch aktualisiert",
                "us": {
                    "mark": "yes",
                    "note": "Aktiv weiterentwickelt"
                },
                "them": {
                    "mark": "no",
                    "note": "Noch frühe Beta, kein neuerer Release"
                }
            },
            {
                "dimension": "GPS-Route auf einer Karte",
                "us": {
                    "mark": "yes",
                    "note": "Live, synchron"
                },
                "them": {
                    "mark": "yes",
                    "note": "Leaflet + OpenStreetMap"
                }
            },
            {
                "dimension": "Geschwindigkeits- & G-Kraft-Diagramm",
                "us": {
                    "mark": "yes",
                    "note": "Ja"
                },
                "them": {
                    "mark": "no",
                    "note": "Nur Karte"
                }
            },
            {
                "dimension": "Front/Heck/Innenraum synchron",
                "us": {
                    "mark": "yes",
                    "note": "3-Kanal-Raster"
                },
                "them": {
                    "mark": "no",
                    "note": "Spielt ein Video nach dem anderen"
                }
            },
            {
                "dimension": "Clip schneiden & mit GPS exportieren",
                "us": {
                    "mark": "yes",
                    "note": "Ja"
                },
                "them": {
                    "mark": "no",
                    "note": "Nur Player"
                }
            }
        ],
        "whenStayTitle": "Wann CamGeoPlayer eine gute Wahl ist",
        "whenStay": "CamGeoPlayer ist ein sympathisches Werkzeug für genau einen Zweck: kostenlos, von einem einzelnen Entwickler aus demselben Bedürfnis heraus gemacht, und einmal entpackt läuft es als eigenständige Windows-App vollständig offline. Wenn du auf Windows bist, einfach dein Video mit seiner Route auf einer Karte sehen willst und dich eine App nicht stört, die noch eine frühe Beta ist, erledigt sie diese eine Aufgabe schlicht und einfach. dashcamigo zielt breiter — plattformübergreifend und mobil, ein Diagramm für Geschwindigkeit und G-Kraft, Mehrkanal-Synchronisation, automatische Fahrtgruppierung und Clip-Export — und wird aktiv gepflegt.",
        "ctaPrimary": "Deine Aufnahmen öffnen",
        "faq": [
            {
                "q": "Ist dashcamigo eine kostenlose Alternative zu CamGeoPlayer?",
                "a": "Ja — beide sind kostenlos, aber dashcamigo läuft in jedem Browser ganz ohne Download (kein großes Zip, kein .NET) und ergänzt ein Diagramm für Geschwindigkeit und G-Kraft, Front/Heck/Innenraum synchron, automatische Fahrtgruppierung und Clip-Export — zusätzlich zur Video-und-Karten-Ansicht, die CamGeoPlayer bietet."
            },
            {
                "q": "Wird CamGeoPlayer noch aktualisiert?",
                "a": "Es ist immer noch eine frühe Beta, ohne neueren öffentlichen Release — ein kostenloses Nebenprojekt eines einzelnen Entwicklers, der offen sagte, dass es frühe Software ist. dashcamigo wird aktiv weiterentwickelt."
            },
            {
                "q": "Löst dashcamigo wie CamGeoPlayer eine Antiviren-Warnung aus?",
                "a": "Nein. Die Antiviren-Warnungen bei CamGeoPlayer kommen von der Browser-Engine und dem exiftool-Programm, die in seinem Zip mitgeliefert werden; der Entwickler erklärt, dass das die Ursache ist und nichts Schädliches passiert. dashcamigo ist einfach eine Webseite — nichts herunterzuladen, nichts zu installieren, nichts auf eine Whitelist zu setzen."
            },
            {
                "q": "Läuft dashcamigo auf dem Mac oder im Browser?",
                "a": "Ja — in jedem aktuellen Browser unter Windows, macOS, Linux und mobil. CamGeoPlayer ist nur für Windows und braucht .NET."
            },
            {
                "q": "Liest dashcamigo das GPS wie CamGeoPlayer aus dem Video aus?",
                "a": "Ja — es liest das in gängigen Dashcam-Dateien eingebettete GPS automatisch aus und zeichnet eine Live-Karte, ergänzt dann ein zur Wiedergabe synchrones Diagramm für Geschwindigkeit und G-Kraft, eine Mehrkanal-Ansicht und Clip-Export. CamGeoPlayer liest eingebettetes GPS und zeigt es mit einem bewegten Marker auf einer OpenStreetMap-Karte; dashcamigo denkt dieselbe Idee weiter."
            }
        ]
    },
    "es": {
        "title": "Alternativa a CamGeoPlayer — gratis, sin descargas, en tu navegador | dashcamigo",
        "metaDescription": "Una alternativa a CamGeoPlayer gratuita que funciona en tu navegador — sin descarga pesada ni .NET. Mapa GPS, gráfico de velocidad, multicanal y exportación. Sin instalar.",
        "ogTitle": "Alternativa gratis a CamGeoPlayer — en tu navegador",
        "ogDescription": "CamGeoPlayer es un visor indie gratuito para Windows que muestra el GPS de tu dashcam en un mapa. dashcamigo lo hace en el navegador — además de un gráfico de velocidad y exportación de clips.",
        "h1": "Una alternativa gratuita a CamGeoPlayer — en tu navegador, y hace más",
        "lead": "CamGeoPlayer es una pequeña aplicación gratuita para Windows que lee el GPS de tus vídeos de dashcam y dibuja la ruta en un mapa — la respuesta de un solo desarrollador a los visores de pago con límites de prueba. dashcamigo hace lo mismo en tu navegador, sin nada que descargar, y añade lo que CamGeoPlayer no tiene: un gráfico de velocidad y fuerza G, frontal/trasera/interior sincronizadas, viajes agrupados automáticamente y exportación de clips con el GPS dentro. La misma idea — leer tu GPS y mostrarlo en un mapa — llevada más lejos, y con mantenimiento al día.",
        "cardHint": "Visor indie gratuito para Windows; todavía en beta temprana",
        "whatItIs": "CamGeoPlayer es una aplicación gratuita para Windows (necesita .NET) de un desarrollador independiente, que la creó tras encontrar que los visores de GPS existentes eran de pago o poco prácticos. Cargas una cola de vídeos y los reproduce uno tras otro, leyendo el GPS incrustado en cada uno y dibujando todo el trayecto en un mapa de OpenStreetMap con un marcador que se mueve sincronizado con la reproducción — usa ExifTool para extraer el GPS y Leaflet para el mapa. No hay instalador: descargas un zip grande, lo descomprimes y ejecutas el .exe (algunos antivirus lo marcan, lo que el desarrollador explica que viene del motor de navegador y de exiftool incluidos dentro). Es honesto sobre lo temprano que es — la compilación actual es una beta temprana, sin ninguna versión pública más reciente.",
        "comparisonIntro": "Ambos son gratuitos y ambos leen tu GPS sobre un mapa. Esto es lo que dashcamigo añade — y dónde es más sencillo de ejecutar.",
        "compareRows": [
            {
                "dimension": "Precio",
                "us": {
                    "mark": "yes",
                    "note": "Gratis"
                },
                "them": {
                    "mark": "yes",
                    "note": "Gratis"
                }
            },
            {
                "dimension": "Funciona en Mac, Linux y móvil",
                "us": {
                    "mark": "yes",
                    "note": "Cualquier navegador moderno"
                },
                "them": {
                    "mark": "no",
                    "note": "Solo Windows (necesita .NET)"
                }
            },
            {
                "dimension": "Nada que descargar ni instalar",
                "us": {
                    "mark": "yes",
                    "note": "Se abre en el navegador"
                },
                "them": {
                    "mark": "partial",
                    "note": "Zip grande, descomprimir y ejecutar"
                }
            },
            {
                "dimension": "Sigue con actualizaciones",
                "us": {
                    "mark": "yes",
                    "note": "En desarrollo activo"
                },
                "them": {
                    "mark": "no",
                    "note": "Todavía en beta temprana, sin versión más reciente"
                }
            },
            {
                "dimension": "Ruta GPS en un mapa",
                "us": {
                    "mark": "yes",
                    "note": "En vivo, sincronizada"
                },
                "them": {
                    "mark": "yes",
                    "note": "Leaflet + OpenStreetMap"
                }
            },
            {
                "dimension": "Gráfico de velocidad y fuerza G",
                "us": {
                    "mark": "yes",
                    "note": "Sí"
                },
                "them": {
                    "mark": "no",
                    "note": "Solo mapa"
                }
            },
            {
                "dimension": "Frontal/trasera/interior sincronizadas",
                "us": {
                    "mark": "yes",
                    "note": "Cuadrícula de 3 canales"
                },
                "them": {
                    "mark": "no",
                    "note": "Reproduce un vídeo a la vez"
                }
            },
            {
                "dimension": "Recortar y exportar un clip con GPS",
                "us": {
                    "mark": "yes",
                    "note": "Sí"
                },
                "them": {
                    "mark": "no",
                    "note": "Solo visor"
                }
            }
        ],
        "whenStayTitle": "Cuándo CamGeoPlayer es una buena opción",
        "whenStay": "CamGeoPlayer es una herramienta de un solo propósito que cae bien: gratuita, hecha por un desarrollador que rascaba su propia picazón, y una vez descomprimida funciona como una aplicación de Windows autónoma, totalmente sin conexión. Si estás en Windows, solo quieres tu vídeo con su ruta en un mapa y no te molesta una aplicación que sigue en beta temprana, hace ese único trabajo de forma sencilla. dashcamigo apunta más amplio — multiplataforma y móvil, un gráfico de velocidad y fuerza G, sincronización multicanal, agrupación automática en viajes y exportación de clips — y tiene mantenimiento activo.",
        "ctaPrimary": "Abre tus grabaciones",
        "faq": [
            {
                "q": "¿Es dashcamigo una alternativa gratuita a CamGeoPlayer?",
                "a": "Sí — ambos son gratuitos, pero dashcamigo funciona en cualquier navegador sin nada que descargar (ni zip grande ni .NET), y añade un gráfico de velocidad y fuerza G, frontal/trasera/interior sincronizadas, agrupación automática en viajes y exportación de clips por encima de la vista de vídeo y mapa que ofrece CamGeoPlayer."
            },
            {
                "q": "¿CamGeoPlayer sigue recibiendo actualizaciones?",
                "a": "Sigue siendo una beta temprana, sin ninguna versión pública más reciente — es un proyecto paralelo gratuito de un solo desarrollador, que fue claro en que es software incipiente. dashcamigo está en desarrollo activo."
            },
            {
                "q": "¿Provocará dashcamigo una advertencia del antivirus como CamGeoPlayer?",
                "a": "No. Las alertas de antivirus de CamGeoPlayer vienen del motor de navegador y del programa exiftool que incluye dentro de su zip; el desarrollador explica que esa es la causa y que no ocurre nada dañino. dashcamigo es solo una página web — nada que descargar, nada que instalar, nada que añadir a la lista blanca."
            },
            {
                "q": "¿Funciona dashcamigo en Mac o en el navegador?",
                "a": "Sí — cualquier navegador moderno en Windows, macOS, Linux y móvil. CamGeoPlayer es solo para Windows y necesita .NET."
            },
            {
                "q": "¿Lee dashcamigo el GPS del vídeo como CamGeoPlayer?",
                "a": "Sí — lee automáticamente el GPS incrustado en los archivos de dashcam más comunes y dibuja un mapa en vivo, y luego añade un gráfico de velocidad y fuerza G sincronizado con la reproducción, vista multicanal y exportación de clips. CamGeoPlayer lee el GPS incrustado y lo muestra en un mapa de OpenStreetMap con un marcador en movimiento; dashcamigo lleva la misma idea más lejos."
            }
        ]
    },
    "fr": {
        "title": "Alternative à CamGeoPlayer — gratuit, sans téléchargement, dans votre navigateur | dashcamigo",
        "metaDescription": "Une alternative gratuite à CamGeoPlayer dans votre navigateur — sans gros téléchargement, sans .NET. Carte GPS, courbe de vitesse, multicanal et export de clip.",
        "ogTitle": "Alternative gratuite à CamGeoPlayer — dans le navigateur",
        "ogDescription": "CamGeoPlayer est un lecteur Windows indé et gratuit qui montre le GPS de votre dashcam sur une carte. dashcamigo le fait dans le navigateur — avec en plus une courbe de vitesse et l'export de clip.",
        "h1": "Une alternative gratuite à CamGeoPlayer — dans votre navigateur, et qui fait plus",
        "lead": "CamGeoPlayer est une petite application Windows gratuite qui lit le GPS de vos vidéos de dashcam et trace l'itinéraire sur une carte — la réponse d'un seul développeur face aux lecteurs payants bridés par leur version d'essai. dashcamigo fait la même chose dans votre navigateur, sans rien à télécharger, et ajoute ce que CamGeoPlayer n'a pas : une courbe de vitesse et de force G, l'avant/l'arrière/l'intérieur en synchro, les trajets regroupés automatiquement, et l'export de clip avec le GPS conservé à l'intérieur. La même idée — lire votre GPS, le montrer sur une carte — poussée plus loin et tenue à jour.",
        "cardHint": "Lecteur Windows indé et gratuit ; encore en bêta précoce",
        "whatItIs": "CamGeoPlayer est une application Windows gratuite (nécessite .NET) signée par un développeur indépendant, qui l'a créée après avoir trouvé les lecteurs GPS existants payants ou peu pratiques. Vous chargez une file de vidéos et il les lit l'une après l'autre, lisant le GPS intégré à chacune et dessinant tout le trajet sur une carte OpenStreetMap avec un marqueur qui se déplace en synchro avec la lecture — il s'appuie sur ExifTool pour extraire le GPS et sur Leaflet pour la carte. Il n'y a pas d'installeur : vous téléchargez un gros zip, vous le décompressez et vous lancez le .exe (certains antivirus le signalent, ce que le développeur explique par le moteur de navigateur et exiftool embarqués à l'intérieur). Il assume d'être à un stade précoce — la version actuelle est une bêta précoce, sans version publique plus récente.",
        "comparisonIntro": "Les deux sont gratuits et les deux lisent votre GPS sur une carte. Voici ce que dashcamigo ajoute — et là où il est plus simple à faire tourner.",
        "compareRows": [
            {
                "dimension": "Prix",
                "us": {
                    "mark": "yes",
                    "note": "Gratuit"
                },
                "them": {
                    "mark": "yes",
                    "note": "Gratuit"
                }
            },
            {
                "dimension": "Fonctionne sur Mac, Linux et mobile",
                "us": {
                    "mark": "yes",
                    "note": "N'importe quel navigateur moderne"
                },
                "them": {
                    "mark": "no",
                    "note": "Windows uniquement (nécessite .NET)"
                }
            },
            {
                "dimension": "Rien à télécharger ni à installer",
                "us": {
                    "mark": "yes",
                    "note": "S'ouvre dans le navigateur"
                },
                "them": {
                    "mark": "partial",
                    "note": "Gros zip, à décompresser et lancer"
                }
            },
            {
                "dimension": "Toujours mis à jour",
                "us": {
                    "mark": "yes",
                    "note": "Activement développé"
                },
                "them": {
                    "mark": "no",
                    "note": "Encore en bêta précoce, aucune version plus récente"
                }
            },
            {
                "dimension": "Itinéraire GPS sur une carte",
                "us": {
                    "mark": "yes",
                    "note": "En direct, synchronisé"
                },
                "them": {
                    "mark": "yes",
                    "note": "Leaflet + OpenStreetMap"
                }
            },
            {
                "dimension": "Courbe de vitesse et de force G",
                "us": {
                    "mark": "yes",
                    "note": "Oui"
                },
                "them": {
                    "mark": "no",
                    "note": "Carte uniquement"
                }
            },
            {
                "dimension": "Avant/arrière/intérieur en synchro",
                "us": {
                    "mark": "yes",
                    "note": "Grille à 3 canaux"
                },
                "them": {
                    "mark": "no",
                    "note": "Lit une seule vidéo à la fois"
                }
            },
            {
                "dimension": "Découper et exporter un clip avec le GPS",
                "us": {
                    "mark": "yes",
                    "note": "Oui"
                },
                "them": {
                    "mark": "no",
                    "note": "Lecteur uniquement"
                }
            }
        ],
        "whenStayTitle": "Quand CamGeoPlayer est un bon choix",
        "whenStay": "CamGeoPlayer est un outil monotâche attachant : gratuit, fait par un seul développeur qui grattait la même démangeaison, et une fois décompressé il tourne comme une application Windows autonome, entièrement hors ligne. Si vous êtes sous Windows, que vous voulez juste votre vidéo avec son itinéraire sur une carte, et que ça ne vous dérange pas une application encore en bêta précoce, il fait ce travail-là tout simplement. dashcamigo voit plus large — multiplateforme et mobile, une courbe de vitesse et de force G, la synchro multicanal, le regroupement automatique des trajets et l'export de clip — et il est activement maintenu.",
        "ctaPrimary": "Ouvrir vos enregistrements",
        "faq": [
            {
                "q": "dashcamigo est-il une alternative gratuite à CamGeoPlayer ?",
                "a": "Oui — les deux sont gratuits, mais dashcamigo tourne dans n'importe quel navigateur sans rien à télécharger (ni gros zip, ni .NET), et il ajoute une courbe de vitesse et de force G, l'avant/l'arrière/l'intérieur en synchro, le regroupement automatique des trajets et l'export de clip par-dessus la vue vidéo-et-carte qu'offre CamGeoPlayer."
            },
            {
                "q": "CamGeoPlayer est-il encore mis à jour ?",
                "a": "C'est encore une bêta précoce, sans version publique plus récente — un projet annexe gratuit d'un seul développeur, qui a clairement annoncé qu'il s'agissait d'un logiciel à un stade précoce. dashcamigo, lui, est activement développé."
            },
            {
                "q": "dashcamigo va-t-il déclencher une alerte antivirus comme CamGeoPlayer ?",
                "a": "Non. Les alertes antivirus de CamGeoPlayer viennent du moteur de navigateur et du programme exiftool qu'il embarque dans son zip ; le développeur explique que c'est la cause et que rien de nuisible ne se produit. dashcamigo n'est qu'une page web — rien à télécharger, rien à installer, rien à mettre en liste blanche."
            },
            {
                "q": "dashcamigo fonctionne-t-il sur Mac ou dans le navigateur ?",
                "a": "Oui — dans n'importe quel navigateur moderne sur Windows, macOS, Linux et mobile. CamGeoPlayer est réservé à Windows et nécessite .NET."
            },
            {
                "q": "dashcamigo lit-il le GPS de la vidéo comme CamGeoPlayer ?",
                "a": "Oui — il lit automatiquement le GPS intégré aux fichiers de dashcam courants et trace une carte en direct, puis ajoute une courbe de vitesse et de force G synchronisée avec la lecture, une vue multicanal et l'export de clip. CamGeoPlayer lit le GPS intégré et l'affiche sur une carte OpenStreetMap avec un marqueur mobile ; dashcamigo pousse la même idée plus loin."
            }
        ]
    },
    "ja": {
        "title": "CamGeoPlayerの代替 — 無料、ダウンロード不要、ブラウザで | dashcamigo",
        "metaDescription": "ブラウザで動くCamGeoPlayerの無料代替 — 大きなダウンロードも.NETも不要。GPSマップ、速度グラフ、マルチチャンネル、クリップのエクスポート。インストール不要。",
        "ogTitle": "CamGeoPlayerの無料代替 — ブラウザで",
        "ogDescription": "CamGeoPlayerはドラレコのGPSをマップに表示する無料のインディーWindowsビューア。dashcamigoはそれをブラウザで実現 — さらに速度グラフとクリップのエクスポートも。",
        "h1": "CamGeoPlayerの無料代替 — ブラウザで動き、もっとできる",
        "lead": "CamGeoPlayerは、ドラレコ映像に埋め込まれたGPSを読み取り、ルートをマップに描く無料の小さなWindowsアプリ — 試用制限つきの有料ビューアに対する、一人の開発者なりの答えです。dashcamigoは同じことをブラウザで、何もダウンロードせずに行い、CamGeoPlayerにはない要素を加えます — 速度とGフォースのグラフ、フロント/リア/車内の同期、自動でまとめられるトリップ、そしてGPSを内部に保持したままのクリップのエクスポート。GPSを読んでマップに表示するという同じ発想を、さらに先へ進め、メンテし続けています。",
        "cardHint": "無料のインディーWindowsビューア。まだ初期ベータ",
        "whatItIs": "CamGeoPlayerは、独立系の開発者による無料のWindowsアプリ（.NETが必要）で、既存のGPSビューアが有料だったり使いにくかったりすることに気づいて作られました。動画のキューを読み込ませると一本ずつ順に再生し、それぞれに埋め込まれたGPSを読み取って、再生と同期して動くマーカーとともに行程全体をOpenStreetMapのマップに描きます — GPSの抽出にはExifTool、マップにはLeafletを使っています。インストーラーはなく、大きなzipをダウンロードして解凍し、.exeを実行する方式です（一部のアンチウイルスが警告を出しますが、開発者は内部に同梱されたブラウザエンジンとexiftoolが原因だと説明しています）。まだ初期段階であることをはっきり認めており、最新ビルドは初期ベータで、それより新しい公開版はありません。",
        "comparisonIntro": "どちらも無料で、どちらもGPSをマップに読み込みます。ここでは、dashcamigoが何を加えるか — そして、どこがより手軽に動かせるかを示します。",
        "compareRows": [
            {
                "dimension": "価格",
                "us": {
                    "mark": "yes",
                    "note": "無料"
                },
                "them": {
                    "mark": "yes",
                    "note": "無料"
                }
            },
            {
                "dimension": "Mac・Linux・モバイルで動く",
                "us": {
                    "mark": "yes",
                    "note": "あらゆるモダンブラウザ"
                },
                "them": {
                    "mark": "no",
                    "note": "Windows専用（.NETが必要）"
                }
            },
            {
                "dimension": "ダウンロードもインストールも不要",
                "us": {
                    "mark": "yes",
                    "note": "ブラウザで開く"
                },
                "them": {
                    "mark": "partial",
                    "note": "大きなzip、解凍して実行"
                }
            },
            {
                "dimension": "今もアップデートされている",
                "us": {
                    "mark": "yes",
                    "note": "活発に開発中"
                },
                "them": {
                    "mark": "no",
                    "note": "まだ初期ベータ、新しい版なし"
                }
            },
            {
                "dimension": "GPSルートをマップに",
                "us": {
                    "mark": "yes",
                    "note": "ライブ、同期"
                },
                "them": {
                    "mark": "yes",
                    "note": "Leaflet ＋ OpenStreetMap"
                }
            },
            {
                "dimension": "速度とGフォースのグラフ",
                "us": {
                    "mark": "yes",
                    "note": "あり"
                },
                "them": {
                    "mark": "no",
                    "note": "マップのみ"
                }
            },
            {
                "dimension": "フロント/リア/車内の同期",
                "us": {
                    "mark": "yes",
                    "note": "3チャンネルのグリッド"
                },
                "them": {
                    "mark": "no",
                    "note": "動画を一本ずつ再生"
                }
            },
            {
                "dimension": "GPS付きでクリップをトリミング・エクスポート",
                "us": {
                    "mark": "yes",
                    "note": "あり"
                },
                "them": {
                    "mark": "no",
                    "note": "ビューアのみ"
                }
            }
        ],
        "whenStayTitle": "CamGeoPlayerで十分な場合",
        "whenStay": "CamGeoPlayerは好感の持てる単機能ツールです — 無料で、同じ不満を抱えた一人の開発者の手によるもので、いったん解凍してしまえば自己完結したWindowsアプリとして完全オフラインで動きます。Windowsを使っていて、ただ映像とそのルートをマップで見たいだけで、まだ初期ベータのアプリでも構わないなら、その一つの仕事をシンプルにこなしてくれます。dashcamigoはもっと広くを狙っています — クロスプラットフォームでモバイルにも対応し、速度とGフォースのグラフ、マルチチャンネルの同期、自動のトリップまとめ、クリップのエクスポートを備え、そして活発にメンテされています。",
        "ctaPrimary": "録画を開く",
        "faq": [
            {
                "q": "dashcamigoはCamGeoPlayerの無料代替になりますか？",
                "a": "はい — どちらも無料ですが、dashcamigoは何もダウンロードせず（大きなzipも.NETも不要）あらゆるブラウザで動き、CamGeoPlayerが提供する動画＋マップの表示に加えて、速度とGフォースのグラフ、フロント/リア/車内の同期、自動のトリップまとめ、クリップのエクスポートを備えています。"
            },
            {
                "q": "CamGeoPlayerは今もアップデートされていますか？",
                "a": "今も初期ベータのままで、それより新しい公開版はありません — 一人の開発者による無料のサイドプロジェクトで、初期のソフトウェアであることを率直に認めていました。dashcamigoは活発に開発されています。"
            },
            {
                "q": "dashcamigoはCamGeoPlayerのようにアンチウイルスの警告を出しますか？",
                "a": "いいえ。CamGeoPlayerのアンチウイルス警告は、zipの中に同梱されたブラウザエンジンとexiftoolプログラムが原因です。開発者はそれが理由であり、有害なことは何も起きていないと説明しています。dashcamigoはただのウェブページです — ダウンロードするものも、インストールするものも、ホワイトリストに加えるものもありません。"
            },
            {
                "q": "dashcamigoはMacやブラウザで動きますか？",
                "a": "はい — Windows、macOS、Linux、モバイルのあらゆるモダンブラウザで動きます。CamGeoPlayerはWindows専用で、.NETが必要です。"
            },
            {
                "q": "dashcamigoはCamGeoPlayerのように動画からGPSを読み取りますか？",
                "a": "はい — 一般的なドラレコファイルに埋め込まれたGPSを自動で読み取ってライブのマップを描き、さらに再生と同期した速度とGフォースのグラフ、マルチチャンネル表示、クリップのエクスポートを加えます。CamGeoPlayerは埋め込まれたGPSを読み取り、動くマーカーとともにOpenStreetMapのマップに表示します。dashcamigoは同じ発想をさらに先へ進めています。"
            }
        ]
    },
    "ko": {
        "title": "CamGeoPlayer 대안 — 무료, 다운로드 없이 브라우저에서 | dashcamigo",
        "metaDescription": "브라우저에서 돌아가는 무료 CamGeoPlayer 대안 — 큰 다운로드도, .NET도 없습니다. GPS 지도, 속도 차트, 멀티채널, 클립 내보내기. 설치 불필요.",
        "ogTitle": "무료 CamGeoPlayer 대안 — 브라우저에서",
        "ogDescription": "CamGeoPlayer는 블랙박스 GPS를 지도에 보여주는 무료 인디 Windows 뷰어입니다. dashcamigo는 이를 브라우저에서 — 게다가 속도 차트와 클립 내보내기까지 — 해냅니다.",
        "h1": "무료 CamGeoPlayer 대안 — 브라우저에서, 게다가 더 많은 일을",
        "lead": "CamGeoPlayer는 블랙박스 영상 속 GPS를 읽어 지도에 경로를 그려주는 작은 무료 Windows 앱입니다 — 체험판 제한이 걸린 유료 뷰어들에 대한 한 개발자의 답이었죠. dashcamigo는 같은 일을 브라우저에서, 다운로드할 것 하나 없이 해내고, CamGeoPlayer에 없는 부분을 더합니다 — 속도와 G 포스 차트, 전방·후방·실내 동기화, 자동 여행 묶음, 그리고 GPS를 안에 담은 클립 내보내기. 같은 발상 — GPS를 읽어 지도에 보여주기 — 을 더 멀리, 그리고 계속 최신으로 유지한 셈입니다.",
        "cardHint": "무료 인디 Windows 뷰어; 아직 초기 베타",
        "whatItIs": "CamGeoPlayer는 독립 개발자가 만든 무료 Windows 앱(.NET 필요)으로, 기존 GPS 뷰어들이 유료거나 불편한 걸 발견하고 직접 만든 도구입니다. 영상 목록을 불러오면 하나씩 차례로 재생하면서 각 영상에 내장된 GPS를 읽고, 재생과 동기화돼 움직이는 마커와 함께 전체 여정을 OpenStreetMap 지도 위에 그립니다 — GPS는 ExifTool로 뽑아내고 지도는 Leaflet으로 그립니다. 설치 프로그램은 없습니다: 큰 zip을 내려받아 압축을 풀고 .exe를 실행하면 됩니다(일부 백신이 경고를 띄우는데, 개발자는 안에 번들된 브라우저 엔진과 exiftool 때문이라고 설명합니다). 초기 단계임을 솔직하게 밝히고 있죠 — 현재 빌드는 초기 베타이고, 그보다 새로운 공개 릴리스는 없습니다.",
        "comparisonIntro": "둘 다 무료고, 둘 다 GPS를 지도에 읽어들입니다. 여기 dashcamigo가 더하는 것 — 그리고 어디서 더 간단히 돌아가는지 — 를 보세요.",
        "compareRows": [
            {
                "dimension": "가격",
                "us": {
                    "mark": "yes",
                    "note": "무료"
                },
                "them": {
                    "mark": "yes",
                    "note": "무료"
                }
            },
            {
                "dimension": "Mac, Linux, 모바일에서 실행",
                "us": {
                    "mark": "yes",
                    "note": "최신 브라우저 어디서나"
                },
                "them": {
                    "mark": "no",
                    "note": "Windows 전용(.NET 필요)"
                }
            },
            {
                "dimension": "다운로드도 설치도 없음",
                "us": {
                    "mark": "yes",
                    "note": "브라우저에서 열림"
                },
                "them": {
                    "mark": "partial",
                    "note": "큰 zip, 압축 풀고 실행"
                }
            },
            {
                "dimension": "지금도 업데이트됨",
                "us": {
                    "mark": "yes",
                    "note": "활발히 개발 중"
                },
                "them": {
                    "mark": "no",
                    "note": "아직 초기 베타, 새 릴리스 없음"
                }
            },
            {
                "dimension": "지도 위 GPS 경로",
                "us": {
                    "mark": "yes",
                    "note": "실시간, 동기화됨"
                },
                "them": {
                    "mark": "yes",
                    "note": "Leaflet + OpenStreetMap"
                }
            },
            {
                "dimension": "속도와 G 포스 차트",
                "us": {
                    "mark": "yes",
                    "note": "있음"
                },
                "them": {
                    "mark": "no",
                    "note": "지도만"
                }
            },
            {
                "dimension": "전방·후방·실내 동기화",
                "us": {
                    "mark": "yes",
                    "note": "3채널 그리드"
                },
                "them": {
                    "mark": "no",
                    "note": "한 번에 영상 하나만 재생"
                }
            },
            {
                "dimension": "GPS 포함 클립 잘라내고 내보내기",
                "us": {
                    "mark": "yes",
                    "note": "있음"
                },
                "them": {
                    "mark": "no",
                    "note": "뷰어 전용"
                }
            }
        ],
        "whenStayTitle": "CamGeoPlayer가 괜찮은 선택인 경우",
        "whenStay": "CamGeoPlayer는 호감 가는 단일 목적 도구입니다: 무료고, 같은 불편을 겪은 한 개발자가 직접 만들었으며, 압축을 풀고 나면 완전히 오프라인으로 돌아가는 자기 완결형 Windows 앱입니다. Windows를 쓰고, 그저 영상과 그 경로를 지도 위에서 보고 싶고, 아직 초기 베타인 앱이라도 개의치 않는다면, 그 한 가지 일을 간단하게 해냅니다. dashcamigo는 더 넓게 — 크로스플랫폼과 모바일, 속도와 G 포스 차트, 멀티채널 동기화, 자동 여행 묶음과 클립 내보내기 — 를 겨냥하고, 활발히 유지보수됩니다.",
        "ctaPrimary": "내 녹화 영상 열기",
        "faq": [
            {
                "q": "dashcamigo는 CamGeoPlayer의 무료 대안인가요?",
                "a": "네 — 둘 다 무료지만, dashcamigo는 다운로드할 것 하나 없이(큰 zip도, .NET도 없이) 최신 브라우저 어디서나 돌아가고, CamGeoPlayer가 제공하는 영상·지도 보기 위에 속도와 G 포스 차트, 전방·후방·실내 동기화, 자동 여행 묶음, 클립 내보내기를 더합니다."
            },
            {
                "q": "CamGeoPlayer는 지금도 업데이트되나요?",
                "a": "아직 초기 베타이고 그보다 새로운 공개 릴리스는 없습니다 — 한 개발자의 무료 사이드 프로젝트로, 초기 소프트웨어임을 솔직하게 밝혔습니다. dashcamigo는 활발히 개발됩니다."
            },
            {
                "q": "dashcamigo도 CamGeoPlayer처럼 백신 경고를 띄우나요?",
                "a": "아니요. CamGeoPlayer의 백신 경고는 zip 안에 번들된 브라우저 엔진과 exiftool 프로그램에서 비롯되며, 개발자는 그게 원인이고 해로운 일은 일어나지 않는다고 설명합니다. dashcamigo는 그저 웹 페이지일 뿐입니다 — 다운로드할 것도, 설치할 것도, 예외에 추가할 것도 없습니다."
            },
            {
                "q": "dashcamigo는 Mac이나 브라우저에서 돌아가나요?",
                "a": "네 — Windows, macOS, Linux, 모바일의 최신 브라우저 어디서나요. CamGeoPlayer는 Windows 전용이고 .NET이 필요합니다."
            },
            {
                "q": "dashcamigo도 CamGeoPlayer처럼 영상에서 GPS를 읽나요?",
                "a": "네 — 흔한 블랙박스 파일에 내장된 GPS를 자동으로 읽어 실시간 지도를 그리고, 거기에 재생과 동기화된 속도·G 포스 차트, 멀티채널 보기, 클립 내보내기를 더합니다. CamGeoPlayer는 내장 GPS를 읽어 움직이는 마커와 함께 OpenStreetMap 지도 위에 보여주고, dashcamigo는 같은 발상을 더 멀리 가져갑니다."
            }
        ]
    },
    "pl": {
        "title": "Alternatywa dla CamGeoPlayer — za darmo, bez pobierania, w przeglądarce | dashcamigo",
        "metaDescription": "Darmowa alternatywa dla CamGeoPlayer w przeglądarce — bez dużego pobierania, bez .NET. Mapa GPS, wykres prędkości, wielokanałowość i eksport klipu. Nic do instalowania.",
        "ogTitle": "Darmowa alternatywa dla CamGeoPlayer — w przeglądarce",
        "ogDescription": "CamGeoPlayer to darmowy, niezależny odtwarzacz na Windows pokazujący GPS kamery na mapie. dashcamigo robi to w przeglądarce — plus wykres prędkości i eksport klipu.",
        "h1": "Darmowa alternatywa dla CamGeoPlayer — w przeglądarce, i potrafi więcej",
        "lead": "CamGeoPlayer to darmowa, niewielka aplikacja na Windows, która czyta GPS w nagraniach z kamery samochodowej i rysuje trasę na mapie — odpowiedź jednego programisty na płatne odtwarzacze z ograniczeniami wersji próbnej. dashcamigo robi to samo w przeglądarce, bez żadnego pobierania, i dodaje to, czego CamGeoPlayer nie ma: wykres prędkości i przeciążeń, przód/tył/wnętrze w synchronizacji, automatyczne grupowanie w trasy oraz eksport klipu z GPS w środku. Ta sama idea — odczytać GPS, pokazać go na mapie — tylko posunięta dalej i wciąż utrzymywana.",
        "cardHint": "Darmowy, niezależny odtwarzacz na Windows; wciąż wczesna beta",
        "whatItIs": "CamGeoPlayer to darmowa aplikacja na Windows (wymaga .NET) autorstwa niezależnego programisty, który napisał ją, gdy okazało się, że istniejące przeglądarki GPS są płatne albo niewygodne. Ładujesz kolejkę nagrań, a ona odtwarza je jedno po drugim, czytając GPS osadzony w każdym z nich i rysując całą podróż na mapie OpenStreetMap ze znacznikiem, który porusza się w synchronizacji z odtwarzaniem — GPS pobiera przez ExifTool, a mapę renderuje na Leaflet. Nie ma instalatora: pobierasz duży zip, rozpakowujesz i uruchamiasz .exe (niektóre antywirusy go oznaczają, co twórca tłumaczy wbudowanym w środku silnikiem przeglądarki i programem exiftool). Otwarcie przyznaje, że to wczesna wersja — obecna kompilacja to wczesna beta, bez nowszego publicznego wydania.",
        "comparisonIntro": "Oba są darmowe i oba czytają Twój GPS na mapę. Oto co dashcamigo dodaje — i gdzie jest prostszy w uruchomieniu.",
        "compareRows": [
            {
                "dimension": "Cena",
                "us": {
                    "mark": "yes",
                    "note": "Za darmo"
                },
                "them": {
                    "mark": "yes",
                    "note": "Za darmo"
                }
            },
            {
                "dimension": "Działa na Mac, Linux i urządzeniach mobilnych",
                "us": {
                    "mark": "yes",
                    "note": "Dowolna nowoczesna przeglądarka"
                },
                "them": {
                    "mark": "no",
                    "note": "Tylko Windows (wymaga .NET)"
                }
            },
            {
                "dimension": "Nic do pobierania ani instalowania",
                "us": {
                    "mark": "yes",
                    "note": "Otwiera się w przeglądarce"
                },
                "them": {
                    "mark": "partial",
                    "note": "Duży zip, rozpakować i uruchomić"
                }
            },
            {
                "dimension": "Wciąż aktualizowany",
                "us": {
                    "mark": "yes",
                    "note": "Aktywnie rozwijany"
                },
                "them": {
                    "mark": "no",
                    "note": "Wciąż wczesna beta, brak nowszego wydania"
                }
            },
            {
                "dimension": "Trasa GPS na mapie",
                "us": {
                    "mark": "yes",
                    "note": "Na żywo, w synchronizacji"
                },
                "them": {
                    "mark": "yes",
                    "note": "Leaflet + OpenStreetMap"
                }
            },
            {
                "dimension": "Wykres prędkości i przeciążeń",
                "us": {
                    "mark": "yes",
                    "note": "Tak"
                },
                "them": {
                    "mark": "no",
                    "note": "Tylko mapa"
                }
            },
            {
                "dimension": "Przód/tył/wnętrze w synchronizacji",
                "us": {
                    "mark": "yes",
                    "note": "Siatka 3 kanałów"
                },
                "them": {
                    "mark": "no",
                    "note": "Odtwarza jedno wideo naraz"
                }
            },
            {
                "dimension": "Przytnij i wyeksportuj klip z GPS",
                "us": {
                    "mark": "yes",
                    "note": "Tak"
                },
                "them": {
                    "mark": "no",
                    "note": "Tylko odtwarzacz"
                }
            }
        ],
        "whenStayTitle": "Kiedy CamGeoPlayer to dobry wybór",
        "whenStay": "CamGeoPlayer to sympatyczne narzędzie do jednego zadania: darmowe, zrobione przez jednego programistę z tą samą bolączką, i po rozpakowaniu działa jako samodzielna aplikacja na Windows, w pełni offline. Jeśli jesteś na Windows, chcesz po prostu zobaczyć swoje wideo z trasą na mapie i nie przeszkadza Ci aplikacja, która wciąż jest wczesną betą — robi to jedno zadanie prosto. dashcamigo celuje szerzej — wieloplatformowo i mobilnie, wykres prędkości i przeciążeń, synchronizacja wielu kanałów, automatyczne grupowanie w trasy i eksport klipu — i jest aktywnie utrzymywany.",
        "ctaPrimary": "Otwórz swoje nagrania",
        "faq": [
            {
                "q": "Czy dashcamigo to darmowa alternatywa dla CamGeoPlayer?",
                "a": "Tak — oba są darmowe, ale dashcamigo działa w dowolnej przeglądarce bez żadnego pobierania (ani dużego zipa, ani .NET) i dodaje wykres prędkości i przeciążeń, przód/tył/wnętrze w synchronizacji, automatyczne grupowanie w trasy oraz eksport klipu ponad widok wideo-i-mapa, który oferuje CamGeoPlayer."
            },
            {
                "q": "Czy CamGeoPlayer jest wciąż aktualizowany?",
                "a": "To wciąż wczesna beta, bez nowszego publicznego wydania — darmowy projekt poboczny jednego programisty, który otwarcie uprzedził, że to wczesne oprogramowanie. dashcamigo jest aktywnie rozwijany."
            },
            {
                "q": "Czy dashcamigo wywoła ostrzeżenie antywirusa, tak jak CamGeoPlayer?",
                "a": "Nie. Antywirus oznacza CamGeoPlayer z powodu silnika przeglądarki i programu exiftool, które są wbudowane w jego zip; twórca tłumaczy, że to one są przyczyną i że nie dzieje się nic szkodliwego. dashcamigo to po prostu strona internetowa — nic do pobierania, nic do instalowania, nic do dodawania na listę wyjątków."
            },
            {
                "q": "Czy dashcamigo działa na Mac lub w przeglądarce?",
                "a": "Tak — w dowolnej nowoczesnej przeglądarce na Windows, macOS, Linux i urządzeniach mobilnych. CamGeoPlayer jest tylko pod Windows i wymaga .NET."
            },
            {
                "q": "Czy dashcamigo czyta GPS z wideo, tak jak CamGeoPlayer?",
                "a": "Tak — automatycznie czyta GPS osadzony w popularnych plikach kamer samochodowych i rysuje mapę na żywo, a potem dodaje wykres prędkości i przeciążeń zsynchronizowany z odtwarzaniem, widok wielokanałowy i eksport klipu. CamGeoPlayer czyta osadzony GPS i pokazuje go na mapie OpenStreetMap z poruszającym się znacznikiem; dashcamigo rozwija tę samą ideę dalej."
            }
        ]
    },
    "pt": {
        "title": "Alternativa ao CamGeoPlayer — grátis, sem download, no seu navegador | dashcamigo",
        "metaDescription": "Uma alternativa gratuita ao CamGeoPlayer que roda no navegador — sem download pesado, sem .NET. Mapa GPS, gráfico de velocidade, multicanal e exportação de clipe.",
        "ogTitle": "Alternativa gratuita ao CamGeoPlayer — no navegador",
        "ogDescription": "O CamGeoPlayer é um visualizador indie gratuito para Windows que mostra o GPS da sua dashcam num mapa. O dashcamigo faz isso no navegador — e ainda traz gráfico de velocidade e exportação de clipe.",
        "h1": "Uma alternativa gratuita ao CamGeoPlayer — no navegador, e que faz mais",
        "lead": "O CamGeoPlayer é um pequeno app gratuito para Windows que lê o GPS dos vídeos da sua dashcam e traça a rota num mapa — a resposta de um único desenvolvedor aos visualizadores pagos com limite de teste. O dashcamigo faz o mesmo no seu navegador, sem nada para baixar, e adiciona as partes que o CamGeoPlayer não tem: um gráfico de velocidade e força G, frente/traseira/interior em sincronia, viagens agrupadas automaticamente e exportação de clipe com o GPS mantido dentro. A mesma ideia — ler o seu GPS, mostrar num mapa — levada mais longe e mantida atualizada.",
        "cardHint": "Visualizador indie gratuito para Windows; ainda em beta inicial",
        "whatItIs": "O CamGeoPlayer é um app gratuito para Windows (precisa do .NET) feito por um desenvolvedor independente, que o criou depois de descobrir que os visualizadores de GPS existentes eram pagos ou trabalhosos. Você carrega uma fila de vídeos e ele os reproduz um após o outro, lendo o GPS embutido em cada um e desenhando a viagem inteira num mapa do OpenStreetMap com um marcador que se move em sincronia com a reprodução — ele usa o ExifTool para extrair o GPS e o Leaflet para o mapa. Não há instalador: você baixa um zip grande, descompacta e roda o .exe (alguns antivírus o sinalizam, o que o desenvolvedor explica vir do motor de navegador e do exiftool embutidos dentro dele). Ele é franco sobre estar no início — a versão atual é uma beta inicial, sem nenhum lançamento público mais novo.",
        "comparisonIntro": "Os dois são gratuitos e os dois leem o seu GPS para um mapa. Veja o que o dashcamigo adiciona — e onde é mais simples de rodar.",
        "compareRows": [
            {
                "dimension": "Preço",
                "us": {
                    "mark": "yes",
                    "note": "Grátis"
                },
                "them": {
                    "mark": "yes",
                    "note": "Grátis"
                }
            },
            {
                "dimension": "Roda no Mac, Linux e celular",
                "us": {
                    "mark": "yes",
                    "note": "Qualquer navegador moderno"
                },
                "them": {
                    "mark": "no",
                    "note": "Só Windows (precisa do .NET)"
                }
            },
            {
                "dimension": "Nada para baixar ou instalar",
                "us": {
                    "mark": "yes",
                    "note": "Abre no navegador"
                },
                "them": {
                    "mark": "partial",
                    "note": "zip grande, descompactar e rodar"
                }
            },
            {
                "dimension": "Ainda recebe atualizações",
                "us": {
                    "mark": "yes",
                    "note": "Em desenvolvimento ativo"
                },
                "them": {
                    "mark": "no",
                    "note": "Ainda em beta inicial, sem versão mais nova"
                }
            },
            {
                "dimension": "Rota GPS num mapa",
                "us": {
                    "mark": "yes",
                    "note": "Ao vivo, sincronizada"
                },
                "them": {
                    "mark": "yes",
                    "note": "Leaflet + OpenStreetMap"
                }
            },
            {
                "dimension": "Gráfico de velocidade e força G",
                "us": {
                    "mark": "yes",
                    "note": "Sim"
                },
                "them": {
                    "mark": "no",
                    "note": "Só o mapa"
                }
            },
            {
                "dimension": "Frente/traseira/interior em sincronia",
                "us": {
                    "mark": "yes",
                    "note": "Grade de 3 canais"
                },
                "them": {
                    "mark": "no",
                    "note": "Reproduz um vídeo por vez"
                }
            },
            {
                "dimension": "Cortar e exportar um clipe com GPS",
                "us": {
                    "mark": "yes",
                    "note": "Sim"
                },
                "them": {
                    "mark": "no",
                    "note": "Apenas visualizador"
                }
            }
        ],
        "whenStayTitle": "Quando o CamGeoPlayer é uma boa escolha",
        "whenStay": "O CamGeoPlayer é uma ferramenta simpática de propósito único: gratuita, feita por um desenvolvedor coçando a mesma coceira, e, depois de descompactado, roda como um app autossuficiente para Windows, totalmente offline. Se você está no Windows, só quer o seu vídeo com a rota num mapa e não se importa com um app que ainda está em beta inicial, ele faz esse único trabalho de forma simples. O dashcamigo mira mais amplo — multiplataforma e mobile, um gráfico de velocidade e força G, sincronização multicanal, agrupamento automático de viagens e exportação de clipe — e recebe manutenção ativa.",
        "ctaPrimary": "Abra suas gravações",
        "faq": [
            {
                "q": "O dashcamigo é uma alternativa gratuita ao CamGeoPlayer?",
                "a": "Sim — os dois são gratuitos, mas o dashcamigo roda em qualquer navegador sem nada para baixar (sem zip grande, sem .NET), e adiciona um gráfico de velocidade e força G, frente/traseira/interior em sincronia, agrupamento automático de viagens e exportação de clipe por cima da visão de vídeo-e-mapa que o CamGeoPlayer oferece."
            },
            {
                "q": "O CamGeoPlayer ainda recebe atualizações?",
                "a": "Ela ainda é uma beta inicial, sem nenhum lançamento público mais novo — é um projeto paralelo gratuito de um único desenvolvedor, que foi franco ao dizer que é software em estágio inicial. O dashcamigo está em desenvolvimento ativo."
            },
            {
                "q": "O dashcamigo vai disparar um aviso de antivírus como o CamGeoPlayer?",
                "a": "Não. Os alertas de antivírus do CamGeoPlayer vêm do motor de navegador e do programa exiftool que ele embute dentro do seu zip; o desenvolvedor explica que essa é a causa e que nada de prejudicial acontece. O dashcamigo é apenas uma página web — nada para baixar, nada para instalar, nada para colocar na lista de exceções."
            },
            {
                "q": "O dashcamigo roda no Mac ou no navegador?",
                "a": "Sim — em qualquer navegador moderno no Windows, macOS, Linux e celular. O CamGeoPlayer é só para Windows e precisa do .NET."
            },
            {
                "q": "O dashcamigo lê o GPS do vídeo como o CamGeoPlayer?",
                "a": "Sim — ele lê automaticamente o GPS embutido nos arquivos comuns de dashcam e desenha um mapa ao vivo, e então adiciona um gráfico de velocidade e força G sincronizado com a reprodução, visão multicanal e exportação de clipe. O CamGeoPlayer lê o GPS embutido e o mostra num mapa do OpenStreetMap com um marcador em movimento; o dashcamigo leva a mesma ideia mais longe."
            }
        ]
    },
    "zh": {
        "title": "CamGeoPlayer 替代方案——免费、无需下载，在浏览器里运行 | dashcamigo",
        "metaDescription": "免费的 CamGeoPlayer 替代方案，在浏览器里运行——无需大文件下载，无需 .NET。GPS 地图、速度图表、多通道和片段导出。什么都不用安装。",
        "ogTitle": "免费 CamGeoPlayer 替代方案——在浏览器里",
        "ogDescription": "CamGeoPlayer 是一款免费的独立 Windows 播放器，把你的行车记录仪 GPS 显示在地图上。dashcamigo 在浏览器里做到这一点——还多了速度图表和片段导出。",
        "h1": "免费的 CamGeoPlayer 替代方案——在浏览器里运行，而且能做得更多",
        "lead": "CamGeoPlayer 是一款免费的小巧 Windows 应用，它读取行车记录仪视频里的 GPS，并把路线绘制在地图上——一位开发者对那些带试用限制的付费播放器给出的回答。dashcamigo 在浏览器里做同样的事，什么都不用下载，还补上了 CamGeoPlayer 没有的部分：速度与 G 力图表，前/后/车内同步，自动归并成行程，以及把 GPS 一同保留在内的片段导出。同样的思路——读取你的 GPS、显示在地图上——只是走得更远，并且持续更新。",
        "cardHint": "免费的独立 Windows 播放器；仍是早期测试版",
        "whatItIs": "CamGeoPlayer 是一款免费的 Windows 应用（需要 .NET），由一位独立开发者编写——他在发现现有的 GPS 播放器要么收费、要么难用之后做了它。你载入一个视频队列，它会一个接一个地播放，读取每段视频里内嵌的 GPS，并在一张 OpenStreetMap 地图上画出整段旅程，标记会随播放同步移动——它用 ExifTool 提取 GPS，用 Leaflet 渲染地图。没有安装程序：你下载一个大 zip，解压后运行 .exe（有些杀毒软件会报警，开发者解释说这来自捆绑在内的浏览器引擎和 exiftool）。他坦率地承认这还是早期版本——当前的构建是早期测试版，此后再没有更新的公开版本。",
        "comparisonIntro": "两者都免费，也都把你的 GPS 读到地图上。下面看看 dashcamigo 多了什么——以及在哪些地方它运行起来更简单。",
        "compareRows": [
            {
                "dimension": "价格",
                "us": {
                    "mark": "yes",
                    "note": "免费"
                },
                "them": {
                    "mark": "yes",
                    "note": "免费"
                }
            },
            {
                "dimension": "可在 Mac、Linux 和移动端运行",
                "us": {
                    "mark": "yes",
                    "note": "任意现代浏览器"
                },
                "them": {
                    "mark": "no",
                    "note": "仅限 Windows（需要 .NET）"
                }
            },
            {
                "dimension": "无需下载或安装任何东西",
                "us": {
                    "mark": "yes",
                    "note": "在浏览器里打开"
                },
                "them": {
                    "mark": "partial",
                    "note": "大 zip，解压后运行"
                }
            },
            {
                "dimension": "仍在更新",
                "us": {
                    "mark": "yes",
                    "note": "积极开发中"
                },
                "them": {
                    "mark": "no",
                    "note": "仍是早期测试版，无更新版本"
                }
            },
            {
                "dimension": "地图上的 GPS 路线",
                "us": {
                    "mark": "yes",
                    "note": "实时、同步"
                },
                "them": {
                    "mark": "yes",
                    "note": "Leaflet + OpenStreetMap"
                }
            },
            {
                "dimension": "速度与 G 力图表",
                "us": {
                    "mark": "yes",
                    "note": "有"
                },
                "them": {
                    "mark": "no",
                    "note": "只有地图"
                }
            },
            {
                "dimension": "前/后/车内同步",
                "us": {
                    "mark": "yes",
                    "note": "3 通道网格"
                },
                "them": {
                    "mark": "no",
                    "note": "一次只播放一段视频"
                }
            },
            {
                "dimension": "剪切并导出带 GPS 的片段",
                "us": {
                    "mark": "yes",
                    "note": "有"
                },
                "them": {
                    "mark": "no",
                    "note": "仅供观看"
                }
            }
        ],
        "whenStayTitle": "什么时候 CamGeoPlayer 是个不错的选择",
        "whenStay": "CamGeoPlayer 是一款讨人喜欢的单一用途工具：免费，由一位为了同一个痛点而动手的开发者打造，一旦解压完毕，它就作为一个自包含的 Windows 应用完全离线运行。如果你在 Windows 上，只想看你的视频外加一张带路线的地图，又不介意一款仍是早期测试版的应用，那它把这一件事做得很简单。dashcamigo 的目标更宽——跨平台和移动端、速度与 G 力图表、多通道同步、自动归并行程以及片段导出——而且它在持续维护。",
        "ctaPrimary": "打开你的录像",
        "faq": [
            {
                "q": "dashcamigo 是 CamGeoPlayer 的免费替代方案吗？",
                "a": "是的——两者都免费，但 dashcamigo 在任意浏览器里运行，什么都不用下载（没有大 zip，也没有 .NET），而且在 CamGeoPlayer 提供的「视频加地图」之上，还补上了速度与 G 力图表、前/后/车内同步、自动归并行程以及片段导出。"
            },
            {
                "q": "CamGeoPlayer 还在更新吗？",
                "a": "它仍是早期测试版，此后再没有更新的公开版本——这是一位开发者的免费业余项目，他坦率地说明了这是早期软件。dashcamigo 在积极开发中。"
            },
            {
                "q": "dashcamigo 会像 CamGeoPlayer 那样触发杀毒警告吗？",
                "a": "不会。CamGeoPlayer 的杀毒报警来自它 zip 内捆绑的浏览器引擎和 exiftool 程序；开发者解释说这就是原因，并没有任何有害的事情发生。dashcamigo 只是一个网页——什么都不用下载，什么都不用安装，什么都不用加入白名单。"
            },
            {
                "q": "dashcamigo 能在 Mac 上或在浏览器里运行吗？",
                "a": "可以——在 Windows、macOS、Linux 和移动端上的任意现代浏览器里都行。CamGeoPlayer 仅限 Windows，并且需要 .NET。"
            },
            {
                "q": "dashcamigo 会像 CamGeoPlayer 那样从视频里读取 GPS 吗？",
                "a": "会——它自动读取常见行车记录仪文件里内嵌的 GPS 并绘制一张实时地图，然后再加上与播放同步的速度与 G 力图表、多通道视图以及片段导出。CamGeoPlayer 读取内嵌的 GPS，并在一张 OpenStreetMap 地图上用一个移动的标记显示出来；dashcamigo 把同样的思路推得更远。"
            }
        ]
    }
}
};

export const COMMUNITY_ALT_LABELS: Partial<Record<Lang, AltSharedLabels>> = {
    "de": {
        "backToPlayer": "← Zurück zum Player",
        "breadcrumbHome": "Start",
        "breadcrumbAlternatives": "Alternativen",
        "whatItIsHeading": "Was ist {name}?",
        "comparisonHeading": "{name} im Vergleich zu dashcamigo",
        "compareColUs": "dashcamigo",
        "officialSiteLabel": "Offizielle Website ↗",
        "howHeading": "Zu dashcamigo wechseln",
        "howSteps": [
            "Nimm die SD-Karte aus der Dashcam und steck sie in deinen Computer.",
            "Öffne dashcamigo.app in einem aktuellen Browser.",
            "Zieh den ganzen SD-Karten-Ordner auf die Seite — sie erkennt, gruppiert und spielt alles ab."
        ],
        "howSecondaryCta": "Jetzt ausprobieren",
        "faqHeading": "Häufige Fragen",
        "otherToolsHeading": "Weitere Tools, die dashcamigo ersetzt",
        "camerasLink": "Unterstützte Kameras",
        "footerPrivacy": "Datenschutzerklärung",
        "footerTerms": "Nutzungsbedingungen",
        "footerHome": "dashcamigo.app"
    },
    "es": {
        "backToPlayer": "← Volver al reproductor",
        "breadcrumbHome": "Inicio",
        "breadcrumbAlternatives": "Alternativas",
        "whatItIsHeading": "¿Qué es {name}?",
        "comparisonHeading": "{name} frente a dashcamigo",
        "compareColUs": "dashcamigo",
        "officialSiteLabel": "Sitio oficial ↗",
        "howHeading": "Cambiar a dashcamigo",
        "howSteps": [
            "Saca la tarjeta SD de la dashcam y conéctala al ordenador.",
            "Abre dashcamigo.app en cualquier navegador moderno.",
            "Arrastra toda la carpeta de la tarjeta SD a la página — la detecta, la agrupa y la reproduce."
        ],
        "howSecondaryCta": "Pruébalo ahora",
        "faqHeading": "Preguntas frecuentes",
        "otherToolsHeading": "Otras herramientas que dashcamigo sustituye",
        "camerasLink": "Cámaras compatibles",
        "footerPrivacy": "Política de privacidad",
        "footerTerms": "Términos de uso",
        "footerHome": "dashcamigo.app"
    },
    "fr": {
        "backToPlayer": "← Retour au lecteur",
        "breadcrumbHome": "Accueil",
        "breadcrumbAlternatives": "Alternatives",
        "whatItIsHeading": "Qu'est-ce que {name} ?",
        "comparisonHeading": "{name} face à dashcamigo",
        "compareColUs": "dashcamigo",
        "officialSiteLabel": "Site officiel ↗",
        "howHeading": "Passer à dashcamigo",
        "howSteps": [
            "Sortez la carte SD de la dashcam et branchez-la sur votre ordinateur.",
            "Ouvrez dashcamigo.app dans n'importe quel navigateur moderne.",
            "Glissez tout le dossier de la carte SD sur la page — il détecte, regroupe et lit tout seul."
        ],
        "howSecondaryCta": "Essayer maintenant",
        "faqHeading": "Questions fréquentes",
        "otherToolsHeading": "Les autres outils que dashcamigo remplace",
        "camerasLink": "Caméras prises en charge",
        "footerPrivacy": "Politique de confidentialité",
        "footerTerms": "Conditions d'utilisation",
        "footerHome": "dashcamigo.app"
    },
    "ja": {
        "backToPlayer": "← プレーヤーに戻る",
        "breadcrumbHome": "ホーム",
        "breadcrumbAlternatives": "代替ツール",
        "whatItIsHeading": "{name}とは？",
        "comparisonHeading": "{name} と dashcamigo の比較",
        "compareColUs": "dashcamigo",
        "officialSiteLabel": "公式サイト ↗",
        "howHeading": "dashcamigoへの乗り換え",
        "howSteps": [
            "ドライブレコーダーからSDカードを取り出して、パソコンに挿します。",
            "お使いのモダンブラウザでdashcamigo.appを開きます。",
            "SDカードのフォルダーをまるごとページにドラッグするだけ — 自動で検出・グループ化して再生します。"
        ],
        "howSecondaryCta": "今すぐ試す",
        "faqHeading": "よくある質問",
        "otherToolsHeading": "dashcamigoが置き換えるその他のツール",
        "camerasLink": "対応カメラ",
        "footerPrivacy": "プライバシーポリシー",
        "footerTerms": "利用規約",
        "footerHome": "dashcamigo.app"
    },
    "ko": {
        "backToPlayer": "← 플레이어로 돌아가기",
        "breadcrumbHome": "홈",
        "breadcrumbAlternatives": "대안",
        "whatItIsHeading": "{name}란?",
        "comparisonHeading": "{name}와 dashcamigo 비교",
        "compareColUs": "dashcamigo",
        "officialSiteLabel": "공식 사이트 ↗",
        "howHeading": "dashcamigo로 전환하기",
        "howSteps": [
            "블랙박스에서 SD 카드를 빼서 컴퓨터에 꽂으세요.",
            "최신 브라우저에서 dashcamigo.app을 여세요.",
            "SD 카드 폴더 전체를 페이지 위로 끌어다 놓으면 — 알아서 인식하고 묶어서 재생합니다."
        ],
        "howSecondaryCta": "지금 사용해 보기",
        "faqHeading": "자주 묻는 질문",
        "otherToolsHeading": "dashcamigo가 대체하는 다른 도구",
        "camerasLink": "지원 카메라",
        "footerPrivacy": "개인정보 처리방침",
        "footerTerms": "이용약관",
        "footerHome": "dashcamigo.app"
    },
    "pl": {
        "backToPlayer": "← Powrót do odtwarzacza",
        "breadcrumbHome": "Strona główna",
        "breadcrumbAlternatives": "Alternatywy",
        "whatItIsHeading": "Czym jest {name}?",
        "comparisonHeading": "{name} a dashcamigo",
        "compareColUs": "dashcamigo",
        "officialSiteLabel": "Oficjalna strona ↗",
        "howHeading": "Przejście na dashcamigo",
        "howSteps": [
            "Wyjmij kartę SD z kamery i włóż ją do komputera.",
            "Otwórz dashcamigo.app w dowolnej nowoczesnej przeglądarce.",
            "Przeciągnij cały folder z karty SD na stronę — wszystko wykryje, pogrupuje i odtworzy."
        ],
        "howSecondaryCta": "Wypróbuj teraz",
        "faqHeading": "Najczęstsze pytania",
        "otherToolsHeading": "Inne programy, które zastępuje dashcamigo",
        "camerasLink": "Obsługiwane kamery",
        "footerPrivacy": "Polityka prywatności",
        "footerTerms": "Warunki korzystania",
        "footerHome": "dashcamigo.app"
    },
    "pt": {
        "backToPlayer": "← Voltar ao player",
        "breadcrumbHome": "Início",
        "breadcrumbAlternatives": "Alternativas",
        "whatItIsHeading": "O que é o {name}?",
        "comparisonHeading": "{name} x dashcamigo",
        "compareColUs": "dashcamigo",
        "officialSiteLabel": "Site oficial ↗",
        "howHeading": "Migrando para o dashcamigo",
        "howSteps": [
            "Tire o cartão SD da câmera e conecte-o ao seu computador.",
            "Abra o dashcamigo.app em qualquer navegador moderno.",
            "Arraste a pasta inteira do cartão SD para a página — ele detecta, agrupa e reproduz."
        ],
        "howSecondaryCta": "Experimente agora",
        "faqHeading": "Perguntas frequentes",
        "otherToolsHeading": "Outras ferramentas que o dashcamigo substitui",
        "camerasLink": "Câmeras compatíveis",
        "footerPrivacy": "Política de privacidade",
        "footerTerms": "Termos de uso",
        "footerHome": "dashcamigo.app"
    },
    "zh": {
        "backToPlayer": "← 返回播放器",
        "breadcrumbHome": "首页",
        "breadcrumbAlternatives": "替代方案",
        "whatItIsHeading": "{name} 是什么？",
        "comparisonHeading": "{name} 对比 dashcamigo",
        "compareColUs": "dashcamigo",
        "officialSiteLabel": "官方网站 ↗",
        "howHeading": "切换到 dashcamigo",
        "howSteps": [
            "从行车记录仪取出 SD 卡，插入你的电脑。",
            "用任意现代浏览器打开 dashcamigo.app。",
            "把整个 SD 卡文件夹拖到页面上——它会自动识别、分组并播放。"
        ],
        "howSecondaryCta": "立即试用",
        "faqHeading": "常见问题",
        "otherToolsHeading": "dashcamigo 还能替代的工具",
        "camerasLink": "支持的摄像头",
        "footerPrivacy": "隐私政策",
        "footerTerms": "使用条款",
        "footerHome": "dashcamigo.app"
    }
};

export const COMMUNITY_ALT_INDEX: Partial<Record<Lang, AltIndexLocale>> = {
    "de": {
        "title": "Kostenlose Alternativen zu Dashcam-Playern — im Browser | dashcamigo",
        "metaDescription": "dashcamigo ist eine kostenlose Alternative im Browser zu beliebten Dashcam-Tools wie RegistratorViewer, Dashcam Viewer und VLC — GPS-Karte, Geschwindigkeitsdiagramm, keine Installation.",
        "ogTitle": "Kostenlose Dashcam-Player-Alternative im Browser",
        "ogDescription": "So schlägt sich dashcamigo gegen RegistratorViewer, Dashcam Viewer und VLC — kostenlos, im Browser, mit einer GPS-Karte ohne API-Schlüssel, der ablaufen kann.",
        "h1": "Kostenlose Alternativen zu beliebten Dashcam-Tools — direkt im Browser",
        "lead": "Du steigst von einem anderen Dashcam-Player um? dashcamigo spielt deine Aufnahmen im Browser ab — kostenlos, ohne Installation — mit synchroner GPS-Karte, einem Geschwindigkeits- und G-Kraft-Diagramm und Mehrkanal-Wiedergabe. So schlägt es sich gegen die Tools, die heute im Einsatz sind."
    },
    "es": {
        "title": "Alternativas gratuitas a los visores de dashcam — en tu navegador | dashcamigo",
        "metaDescription": "dashcamigo es una alternativa gratuita y en el navegador a herramientas de dashcam populares como RegistratorViewer, Dashcam Viewer y VLC — mapa GPS, gráfico de velocidad, sin instalar.",
        "ogTitle": "Alternativa gratuita en el navegador a los visores de dashcam",
        "ogDescription": "Mira cómo se compara dashcamigo con RegistratorViewer, Dashcam Viewer y VLC — gratis, en el navegador y con un mapa GPS sin clave de API que pueda caducar.",
        "h1": "Alternativas gratuitas y en el navegador a las herramientas de dashcam más populares",
        "lead": "¿Vienes de otro visor de dashcam? dashcamigo reproduce tus grabaciones en el navegador — gratis, sin instalar nada — con un mapa GPS sincronizado, un gráfico de velocidad y fuerza G y reproducción multicanal. Así es como se compara con las herramientas que la gente usa hoy."
    },
    "fr": {
        "title": "Alternatives gratuites aux lecteurs de dashcam — dans votre navigateur | dashcamigo",
        "metaDescription": "dashcamigo est une alternative gratuite et dans le navigateur aux outils dashcam populaires comme RegistratorViewer, Dashcam Viewer et VLC — carte GPS, courbe de vitesse, sans installation.",
        "ogTitle": "Alternative gratuite aux lecteurs de dashcam, dans le navigateur",
        "ogDescription": "Découvrez comment dashcamigo se compare à RegistratorViewer, Dashcam Viewer et VLC — gratuit, dans le navigateur, avec une carte GPS sans clé d'API qui puisse expirer.",
        "h1": "Des alternatives gratuites et dans le navigateur aux outils dashcam populaires",
        "lead": "Vous quittez un autre lecteur de dashcam ? dashcamigo lit vos enregistrements dans le navigateur — gratuit, rien à installer — avec une carte GPS synchronisée, une courbe de vitesse et de force G, et une lecture multicanal. Voici comment il se compare aux outils que les gens utilisent aujourd'hui."
    },
    "ja": {
        "title": "ドライブレコーダー再生ソフトの無料代替 — ブラウザで動く | dashcamigo",
        "metaDescription": "dashcamigoは、RegistratorViewer・Dashcam Viewer・VLCといった人気のドラレコツールの無料ブラウザ代替 — GPSマップ、速度グラフ、インストール不要。",
        "ogTitle": "ドラレコ再生ソフトの無料ブラウザ代替",
        "ogDescription": "dashcamigoがRegistratorViewer・Dashcam Viewer・VLCとどう違うかを比較 — 無料、ブラウザで動作、期限切れになるAPIキーのないGPSマップ付き。",
        "h1": "人気のドラレコツールの、無料でブラウザで動く代替",
        "lead": "別のドラレコ再生ソフトから乗り換え？ dashcamigoはあなたの録画をブラウザで再生します — 無料、インストール不要 — 同期したGPSマップ、速度とGフォースのグラフ、マルチチャンネル再生付き。今みんなが使っているツールとどう比べられるか、ここで確かめてください。"
    },
    "ko": {
        "title": "블랙박스 뷰어의 무료 대안 — 브라우저에서 바로 | dashcamigo",
        "metaDescription": "dashcamigo는 RegistratorViewer, Dashcam Viewer, VLC 같은 인기 블랙박스 도구의 무료 브라우저 대안입니다 — GPS 지도, 속도 차트, 설치 불필요.",
        "ogTitle": "블랙박스 뷰어의 무료 브라우저 대안",
        "ogDescription": "dashcamigo가 RegistratorViewer, Dashcam Viewer, VLC와 어떻게 다른지 비교해 보세요 — 무료, 브라우저에서, 만료될 API 키가 없는 GPS 지도까지.",
        "h1": "인기 블랙박스 도구의 무료 브라우저 대안",
        "lead": "다른 블랙박스 뷰어에서 갈아타시나요? dashcamigo는 녹화 영상을 브라우저에서 바로 재생합니다 — 무료, 설치 불필요 — 동기화된 GPS 지도, 속도와 G 포스 차트, 다채널 재생까지 갖췄습니다. 오늘날 사람들이 쓰는 도구들과 어떻게 비교되는지 확인해 보세요."
    },
    "pl": {
        "title": "Darmowe alternatywy dla odtwarzaczy z kamer samochodowych — w przeglądarce | dashcamigo",
        "metaDescription": "dashcamigo to darmowa, działająca w przeglądarce alternatywa dla popularnych narzędzi do kamer samochodowych, takich jak RegistratorViewer, Dashcam Viewer i VLC — mapa GPS, wykres prędkości, bez instalacji.",
        "ogTitle": "Darmowa alternatywa dla odtwarzaczy kamer — w przeglądarce",
        "ogDescription": "Zobacz, jak dashcamigo wypada na tle RegistratorViewer, Dashcam Viewer i VLC — za darmo, w przeglądarce, z mapą GPS bez klucza API, który mógłby wygasnąć.",
        "h1": "Darmowe alternatywy dla popularnych narzędzi do kamer samochodowych — w przeglądarce",
        "lead": "Przesiadasz się z innego odtwarzacza nagrań z kamery samochodowej? dashcamigo odtwarza Twoje nagrania w przeglądarce — za darmo, bez instalacji — z synchronizowaną mapą GPS, wykresem prędkości i przeciążeń oraz odtwarzaniem wielokanałowym. Oto jak wypada na tle narzędzi, których ludzie używają dzisiaj."
    },
    "pt": {
        "title": "Alternativas gratuitas a visualizadores de dashcam — no seu navegador | dashcamigo",
        "metaDescription": "O dashcamigo é uma alternativa gratuita e no navegador a ferramentas populares de dashcam como RegistratorViewer, Dashcam Viewer e VLC — mapa GPS, gráfico de velocidade, sem instalação.",
        "ogTitle": "Alternativa gratuita no navegador a visualizadores de dashcam",
        "ogDescription": "Veja como o dashcamigo se compara ao RegistratorViewer, Dashcam Viewer e VLC — grátis, no navegador, com um mapa GPS sem chave de API para expirar.",
        "h1": "Alternativas gratuitas e no navegador a ferramentas populares de dashcam",
        "lead": "Vindo de outro visualizador de dashcam? O dashcamigo reproduz suas gravações no navegador — grátis, sem nada para instalar — com um mapa GPS sincronizado, um gráfico de velocidade e força G, e reprodução multicanal. Veja como ele se compara às ferramentas que as pessoas usam hoje."
    },
    "zh": {
        "title": "行车记录仪播放器的免费替代方案——就在你的浏览器里 | dashcamigo",
        "metaDescription": "dashcamigo 是 RegistratorViewer、Dashcam Viewer、VLC 等热门行车记录仪工具的免费浏览器版替代方案——GPS 地图、速度图表，无需安装。",
        "ogTitle": "行车记录仪播放器的免费浏览器版替代方案",
        "ogDescription": "看看 dashcamigo 与 RegistratorViewer、Dashcam Viewer 和 VLC 的对比——免费、在浏览器里运行，配一张不会失效的 GPS 地图。",
        "h1": "热门行车记录仪工具的免费浏览器版替代方案",
        "lead": "正打算从别的行车记录仪播放器换过来？dashcamigo 直接在浏览器里播放你的录像——免费，无需安装——配有同步的 GPS 地图、速度与 G 力图表，以及多通道播放。下面看看它与大家今天在用的工具相比如何。"
    }
};
