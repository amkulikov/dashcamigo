const ALPHABET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const BRAND_WORD = "EVERY";
// A small display-only selection from supported-brands.ts and the DDPAI
// sidecar registry; importing either registry would pull build/parser code in.
const CAMERA_BRANDS = ["70MAI", "VIOFO", "DDPAI", "GOPRO", "MIVUE", "NAVITEL", "BLACKVUE", "THINKWARE"];
const MAX_DRUMS = 9;
const ROLL_MS = 1100;
const EXPAND_MS = 180;
const HOLD_MS = 350;
const WORD_EXIT_MS = 140;
const WORD_ENTER_MS = 180;

export function initBrandMark(): void {
    const root = document.querySelector<HTMLElement>(".topbar .edc-mark");
    const deck = root?.querySelector<HTMLElement>(".edc-mark__drums");
    if (!root || !deck) return;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const hover = matchMedia("(hover: hover)");
    const compact = matchMedia("(max-width: 600px)");
    let frame: number | undefined;
    let returnTimer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let currentWord = BRAND_WORD;
    let lastCameraBrand: string | undefined;
    let drumCount = BRAND_WORD.length;
    let orangeDrum = -1;

    // Keep the original five-drum layout width; the extra drums are clipped
    // over DASHCAM, so revealing a long name cannot move toolbar controls.
    const drums = Array.from(deck.querySelectorAll<HTMLElement>(".edc-mark__drum"));
    while (drums.length < MAX_DRUMS) {
        const drum = document.createElement("span");
        drum.className = "edc-mark__drum";
        const column = document.createElement("span");
        column.className = "edc-mark__column";
        drum.appendChild(column);
        deck.appendChild(drum);
        drums.push(drum);
    }
    const columns = drums.map((drum) => drum.querySelector<HTMLElement>(".edc-mark__column")!);
    root.classList.add("edc-mark--interactive");
    columns.forEach((column) => {
        // A second alphabet makes the final digit -> blank -> A wrap seamless.
        column.replaceChildren(
            ...Array.from(ALPHABET.repeat(2), (letter) => {
                const span = document.createElement("span");
                span.className = "edc-mark__letter";
                span.textContent = letter;
                return span;
            }),
        );
    });
    const setDrumCount = (count: number): void => {
        drumCount = count;
        root.style.setProperty("--edc-drum-count", String(count));
        const last = Math.ceil(count) - 1;
        if (last === orangeDrum) return;
        drums[orangeDrum]?.classList.remove("edc-mark__drum--last");
        drums[last]!.classList.add("edc-mark__drum--last");
        orangeDrum = last;
    };
    const setWord = (word: string): void => {
        columns.forEach((column, index) => {
            column.style.setProperty("--edc-letter-index", String(ALPHABET.indexOf(word[index] ?? " ")));
        });
        currentWord = word;
    };
    const setWordVisibility = (opacity: number): void => {
        root.style.setProperty("--edc-word-opacity", String(opacity));
    };
    const animate = (duration: number, update: (elapsed: number) => void, done: () => void): void => {
        let startedAt: number | undefined;
        root.classList.add("edc-mark--animated");
        const advance = (timestamp: number): void => {
            startedAt ??= timestamp;
            const elapsed = Math.min(duration, timestamp - startedAt);
            update(elapsed);
            if (elapsed < duration) {
                frame = requestAnimationFrame(advance);
            } else {
                frame = undefined;
                root.classList.remove("edc-mark--animated");
                done();
            }
        };
        frame = requestAnimationFrame(advance);
    };
    const ease = (progress: number): number => progress * progress * (3 - 2 * progress);
    const rollTo = (word: string, done: () => void): void => {
        const count = Math.max(currentWord.length, word.length);
        const fromCount = drumCount;
        let previousSpeed = 0;
        const rolls = columns.slice(0, count).map((column, index) => {
            const start = ALPHABET.indexOf(currentWord[index] ?? " ");
            const target = ALPHABET.indexOf(word[index] ?? " ");
            const delta = (target - start + ALPHABET.length) % ALPHABET.length;
            const across = index / (count - 1);
            // Right starts first and stops last. Only add complete turns when
            // needed to keep every right drum faster than its left neighbor.
            const delay = ROLL_MS * 0.175 * (1 - across);
            const duration = ROLL_MS * (0.5 + 0.5 * across);
            const turns = Math.max(
                delta === 0 ? 1 : 0,
                Math.ceil((previousSpeed * 1.08 * duration - delta) / ALPHABET.length),
            );
            const distance = turns * ALPHABET.length + delta;
            previousSpeed = distance / duration;
            return { column, start, target, delay, duration, distance };
        });
        animate(
            ROLL_MS,
            (elapsed) => {
                setDrumCount(fromCount + (count - fromCount) * ease(Math.min(1, elapsed / EXPAND_MS)));
                for (const roll of rolls) {
                    const progress = Math.min(1, Math.max(0, elapsed - roll.delay) / roll.duration);
                    const position =
                        progress === 1 ? roll.target : (roll.start + roll.distance * progress) % ALPHABET.length;
                    roll.column.style.setProperty("--edc-letter-index", String(position));
                }
            },
            () => {
                setWord(word);
                done();
            },
        );
    };
    const finishHover = (): void => {
        const showWord = (): void => {
            animate(
                WORD_ENTER_MS,
                (elapsed) => setWordVisibility(ease(elapsed / WORD_ENTER_MS)),
                () => {
                    busy = false;
                },
            );
        };
        const fromCount = drumCount;
        if (fromCount === BRAND_WORD.length) {
            showWord();
            return;
        }
        animate(
            EXPAND_MS,
            (elapsed) => setDrumCount(fromCount + (BRAND_WORD.length - fromCount) * ease(elapsed / EXPAND_MS)),
            showWord,
        );
    };
    const reset = (): void => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        clearTimeout(returnTimer);
        returnTimer = undefined;
        busy = false;
        root.classList.remove("edc-mark--animated");
        setWord(BRAND_WORD);
        setDrumCount(BRAND_WORD.length);
        setWordVisibility(1);
    };

    reset();
    if (!reducedMotion.matches && !compact.matches) {
        busy = true;
        rollTo(BRAND_WORD, () => {
            busy = false;
        });
    }
    root.addEventListener("mouseenter", () => {
        if (reducedMotion.matches || compact.matches || !hover.matches || busy) return;
        busy = true;
        const candidates = CAMERA_BRANDS.filter((word) => word !== lastCameraBrand);
        const word = candidates[Math.floor(Math.random() * candidates.length)]!;
        lastCameraBrand = word;
        // Let DASHCAM leave before the deck expands into its space. Its box
        // stays in the layout, keeping every toolbar control stationary.
        animate(
            WORD_EXIT_MS,
            (elapsed) => setWordVisibility(1 - ease(elapsed / WORD_EXIT_MS)),
            () => {
                rollTo(word, () => {
                    returnTimer = setTimeout(() => {
                        returnTimer = undefined;
                        rollTo(BRAND_WORD, finishHover);
                    }, HOLD_MS);
                });
            },
        );
    });
    reducedMotion.addEventListener("change", () => {
        if (reducedMotion.matches) reset();
    });
    compact.addEventListener("change", () => {
        if (compact.matches) reset();
    });
}
