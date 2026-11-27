// «Мечта. 9:59» — логика сайта. Подключается как ES-модуль (type="module"),
// поэтому ничего не попадает в глобальную область и скрипт выполняется отложенно.

/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const IS_LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);

const store = {
  get(area, key) {
    try {
      return window[area].getItem(key);
    } catch {
      return null;
    }
  },
  set(area, key, value) {
    try {
      window[area].setItem(key, String(value));
    } catch {
      /* приватный режим или storage запрещён — просто не запоминаем */
    }
  }
};

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let reduceMotion = motionQuery.matches;

// Русская типографика: короткие слова не остаются в конце строки, тире не переносится в начало.
const SHORT_WORDS = /(?<=^|[\s«(\u00A0])(в|и|с|к|о|у|а|я|не|на|по|за|из|от|до|но|ни|во|со|ко|об|обо|без|для|при|под|над|про|что|как) /giu;

function typograph(text) {
  return text.replace(SHORT_WORDS, "$1\u00A0").replace(/ (—|–)/g, "\u00A0$1");
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* Элементы                                                            */
/* ------------------------------------------------------------------ */

const atmosphereButton = $(".hero__atmosphere-button");
const heroElement = $(".hero");
const timerElement = $(".hero__timer");
const finaleElement = $("[data-timer-finale]");
const dogHeadElement = $(".hero__dog-head");
const sparkPoolElement = $(".hero__spark-pool");
const readerDialog = $(".reader-layer");
const readerSheet = $(".reader-dialog__sheet");
const readerPageElement = $(".reader-dialog__page");
const readerMetaElement = $("[data-reader-meta]");
const readerProgressElement = $("[data-reader-progress]");
const readerPrevButton = $("[data-reader-prev]");
const readerNextButton = $("[data-reader-next]");
const readerShareButton = $("[data-reader-share]");
const readerFontButtons = $$("[data-reader-font]");
const readerThemeButton = $("[data-reader-theme]");
const readerOriginImage = $("[data-reader-origin]");
const revealElements = $$("[data-reveal]");
const authorSectionElement = $("#author");
const toastElement = $("[data-toast]");
const consentElement = $("[data-consent]");

/* ------------------------------------------------------------------ */
/* Константы                                                           */
/* ------------------------------------------------------------------ */

const TIMER_DURATION_MS = (9 * 60 + 59) * 1000;
const TIMER_TICK_MS = 250;
const TIMER_STORAGE_KEY = "timer-end";
const MUSIC_FADE_DURATION_MS = 800;
const SPARK_POOL_SIZE = 6;
const SPARK_BURST_MIN_DELAY_MS = 8000;
const SPARK_BURST_MAX_DELAY_MS = 20000;
const SPARK_BURST_MIN_COUNT = 1;
const SPARK_BURST_MAX_COUNT = 3;
const SPARK_DURATION_MIN_MS = 1000;
const SPARK_DURATION_MAX_MS = 2500;
const DOG_HEAD_ANIMATION_CLASS = "is-howling";
const DOG_HEAD_ANIMATION_DURATION_MS = 7000;
const DOG_HEAD_ANIMATION_REDUCED_DURATION_MS = 2200;
const READER_CONTENT_PATH = "assets/content/fragment.json";
const READER_CLOSE_DURATION_MS = 320;
const READER_PAGE_KEY = "reader-page";
const READER_FONT_KEY = "reader-font-step";
const READER_FONT_MIN = -2;
const READER_FONT_MAX = 3;
const QUOTE_MIN_LENGTH = 12;
const QUOTE_MAX_LENGTH = 420;
const SITE_URL = "https://9-59.site/";

const AUDIO_SOURCES = {
  clock: {
    opus: "./assets/audio/ambient/clock.ogg",
    mp3: "./assets/audio/ambient/clock.mp3"
  },
  dogHowl: {
    mp3: "./assets/audio/ambient/dog-howl.mp3"
  },
  bookTrack: {
    opus: "./assets/audio/music/book-track.ogg",
    mp3: "./assets/audio/music/book-track.mp3"
  }
};

const AUDIO_VOLUME = {
  clock: 0.16,
  dogHowl: 1,
  bookTrack: 0.45
};

const CAN_PLAY_OPUS = (() => {
  const audio = document.createElement("audio");
  return typeof audio.canPlayType === "function" &&
    audio.canPlayType('audio/ogg; codecs="opus"') !== "";
})();

/* ------------------------------------------------------------------ */
/* Аналитика и согласие                                                */
/* ------------------------------------------------------------------ */

function trackEvent(eventName, parameters = {}) {
  if (!eventName) {
    return;
  }

  const payload = Object.fromEntries(
    Object.entries(parameters).filter(([, value]) => value !== undefined)
  );

  try {
    if (typeof window.gtag === "function") {
      window.gtag("event", eventName, payload);
    } else if (typeof window.plausible === "function") {
      window.plausible(eventName, { props: payload });
    } else if (window.umami?.track) {
      window.umami.track(eventName, payload);
    } else if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: eventName, ...payload });
    }
  } catch (error) {
    if (IS_LOCAL) {
      console.debug("[analytics:error]", eventName, error);
    }
    return;
  }

  if (IS_LOCAL) {
    console.debug("[analytics]", eventName, payload);
  }
}

function initializeConsent() {
  if (!consentElement) {
    return;
  }

  if (!store.get("localStorage", "analytics-consent")) {
    consentElement.hidden = false;
  }

  const decide = (granted) => {
    store.set("localStorage", "analytics-consent", granted ? "granted" : "denied");

    if (typeof window.gtag === "function") {
      window.gtag("consent", "update", {
        analytics_storage: granted ? "granted" : "denied"
      });
    }

    consentElement.hidden = true;
  };

  $("[data-consent-accept]", consentElement)?.addEventListener("click", () => decide(true));
  $("[data-consent-decline]", consentElement)?.addEventListener("click", () => decide(false));
}

function initializeAuthorAnalytics() {
  if (!authorSectionElement) {
    return;
  }

  if (!("IntersectionObserver" in window)) {
    trackEvent("author_section_view");
    return;
  }

  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) {
        return;
      }

      trackEvent("author_section_view");
      observer.disconnect();
    },
    { threshold: 0.35 }
  );

  observer.observe(authorSectionElement);
}

/* ------------------------------------------------------------------ */
/* Уведомления (popover поверх модального окна)                        */
/* ------------------------------------------------------------------ */

let toastTimeoutId = null;

function showToast(message) {
  if (!toastElement) {
    return;
  }

  toastElement.textContent = message;
  window.clearTimeout(toastTimeoutId);

  if (typeof toastElement.showPopover === "function") {
    // Пересоздаём, чтобы уведомление оказалось над уже открытым <dialog>.
    if (toastElement.matches(":popover-open")) {
      toastElement.hidePopover();
    }
    toastElement.showPopover();
  } else {
    toastElement.classList.add("is-visible");
  }

  toastTimeoutId = window.setTimeout(() => {
    if (typeof toastElement.hidePopover === "function") {
      if (toastElement.matches(":popover-open")) {
        toastElement.hidePopover();
      }
    } else {
      toastElement.classList.remove("is-visible");
    }
  }, 3200);
}

/* ------------------------------------------------------------------ */
/* Появление блоков при прокрутке                                       */
/* ------------------------------------------------------------------ */

function revealAll() {
  revealElements.forEach((element) => element.classList.add("is-visible"));
}

function initializeRevealAnimations() {
  if (!revealElements.length) {
    return;
  }

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealAll();
    return;
  }

  // Браузеры со scroll-driven animations делают всё на CSS (animation-timeline: view()).
  if (window.CSS?.supports?.("animation-timeline: view()")) {
    document.documentElement.classList.add("has-scroll-timeline");
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.2, rootMargin: "0px 0px -40px 0px" }
  );

  revealElements.forEach((element) => observer.observe(element));
}

/* ------------------------------------------------------------------ */
/* Читалка фрагмента (нативный <dialog>)                                */
/* ------------------------------------------------------------------ */

const reader = {
  content: null,
  contentPromise: null,
  pageIndex: 0,
  opening: false,
  closeTimeoutId: null,
  lastTrigger: null,
  night: store.get("localStorage", "reader-theme") === "night",
  fontStep: clampNumber(Number(store.get("localStorage", READER_FONT_KEY)) || 0, READER_FONT_MIN, READER_FONT_MAX),
  selectedQuote: "",
  closingTransition: null
};

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isValidReaderContent(data) {
  return Boolean(
    data &&
      Array.isArray(data.pages) &&
      data.pages.length > 0 &&
      data.pages.every(
        (page) =>
          Array.isArray(page?.paragraphs) &&
          page.paragraphs.every((paragraph) => typeof paragraph === "string")
      )
  );
}

function loadReaderContent() {
  if (reader.content) {
    return Promise.resolve(reader.content);
  }

  if (!reader.contentPromise) {
    reader.contentPromise = fetch(READER_CONTENT_PATH)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load fragment content: ${response.status}`);
        }

        return response.json();
      })
      .then((data) => {
        if (!isValidReaderContent(data)) {
          throw new Error("Fragment content has an unexpected shape");
        }

        reader.content = data;
        return data;
      })
      .catch((error) => {
        // Не кэшируем ошибку: следующая попытка снова пойдёт в сеть.
        reader.contentPromise = null;
        throw error;
      });
  }

  return reader.contentPromise;
}

function buildReaderCta() {
  const cta = document.createElement("div");
  cta.className = "reader-dialog__cta";

  const title = document.createElement("p");
  title.className = "reader-dialog__cta-title";
  title.textContent = "Хотите узнать, что будет дальше?";

  const text = document.createElement("p");
  text.className = "reader-dialog__cta-text";
  text.textContent = "Скачайте книгу целиком — бесплатно, в удобном формате.";

  const grid = document.createElement("div");
  grid.className = "reader-dialog__cta-grid";

  $$(".about-panel__format-card").forEach((card) => {
    grid.appendChild(card.cloneNode(true));
  });

  cta.append(title, text, grid);
  return cta;
}

function renderReaderPage(index, { animate = true, direction = 1 } = {}) {
  if (!reader.content || !readerPageElement) {
    return;
  }

  const { pages } = reader.content;
  const page = pages[index];

  if (!page) {
    return;
  }

  const paragraphs = page.paragraphs.map((paragraphText) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = typograph(paragraphText);
    return paragraph;
  });

  readerPageElement.replaceChildren(...paragraphs);
  readerPageElement.classList.toggle("is-first-page", index === 0);

  if (index === pages.length - 1) {
    readerPageElement.appendChild(buildReaderCta());
  }

  readerPageElement.classList.remove("is-transitioning", "is-turning-back");

  if (animate && !reduceMotion) {
    void readerPageElement.offsetWidth;
    readerPageElement.classList.add("is-transitioning");
    readerPageElement.classList.toggle("is-turning-back", direction < 0);
  }

  readerPageElement.scrollTop = 0;

  if (readerMetaElement) {
    readerMetaElement.textContent = `${index + 1} / ${pages.length}`;
  }

  if (readerProgressElement) {
    readerProgressElement.style.width = `${((index + 1) / pages.length) * 100}%`;
  }

  const focusedButton = document.activeElement;

  if (readerPrevButton) {
    readerPrevButton.hidden = index === 0;
  }

  if (readerNextButton) {
    readerNextButton.hidden = index === pages.length - 1;
  }

  // Если кнопка, на которой стоял фокус, исчезла — переводим фокус на текст.
  if (focusedButton instanceof HTMLElement && focusedButton.hidden) {
    readerPageElement.focus({ preventScroll: true });
  }

  hideShareButton();
  store.set("localStorage", READER_PAGE_KEY, index);
}

function changeReaderPage(direction) {
  if (!reader.content) {
    return;
  }

  const nextIndex = reader.pageIndex + direction;

  if (nextIndex < 0 || nextIndex >= reader.content.pages.length) {
    return;
  }

  reader.pageIndex = nextIndex;
  renderReaderPage(reader.pageIndex, { direction });
  playPageRustle();
}

function applyReaderFontStep() {
  readerDialog?.style.setProperty("--reader-font-scale", String(1 + reader.fontStep * 0.1));

  readerFontButtons.forEach((button) => {
    const direction = Number(button.dataset.readerFont);
    button.disabled =
      (direction < 0 && reader.fontStep <= READER_FONT_MIN) ||
      (direction > 0 && reader.fontStep >= READER_FONT_MAX);
  });
}

function applyReaderTheme() {
  readerDialog?.classList.toggle("is-night", reader.night);
  readerThemeButton?.setAttribute("aria-pressed", String(reader.night));
  readerThemeButton?.setAttribute("aria-label", reader.night ? "Дневной режим" : "Ночной режим");

  const icon = readerThemeButton?.querySelector("span");

  if (icon) {
    icon.textContent = reader.night ? "☀" : "☾";
  }
}

function toggleReaderTheme() {
  reader.night = !reader.night;
  store.set("localStorage", "reader-theme", reader.night ? "night" : "day");
  trackEvent("reader_theme", { theme: reader.night ? "night" : "day" });
  applyReaderTheme();
}

function changeReaderFont(direction) {
  reader.fontStep = clampNumber(reader.fontStep + direction, READER_FONT_MIN, READER_FONT_MAX);
  store.set("localStorage", READER_FONT_KEY, reader.fontStep);
  applyReaderFontStep();
}

function isElementInViewport(element) {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight && rect.width > 0;
}

function canMorphFromBook() {
  return (
    typeof document.startViewTransition === "function" &&
    !reduceMotion &&
    isElementInViewport(readerOriginImage)
  );
}

function setMorphNames(phase) {
  // Одно и то же имя не может быть у двух элементов одновременно.
  if (readerOriginImage) {
    readerOriginImage.style.viewTransitionName = phase === "book" ? "reader-sheet" : "";
  }

  if (readerSheet) {
    readerSheet.style.viewTransitionName = phase === "sheet" ? "reader-sheet" : "";
  }
}

function showReaderModal() {
  readerDialog.showModal();
  document.body.classList.add("reader-open");
  // showModal() сам ставит фокус на первую кнопку — переводим его на текст.
  readerPageElement?.focus({ preventScroll: true });
}

function showReaderInstantly() {
  readerDialog.classList.add("is-instant", "is-open");
  showReaderModal();
}

function finishReaderClose() {
  if (reader.closeTimeoutId !== null) {
    window.clearTimeout(reader.closeTimeoutId);
    reader.closeTimeoutId = null;
  }

  readerDialog.classList.remove("is-open", "is-closing", "is-instant");

  if (readerDialog.open) {
    readerDialog.close();
  }

  document.body.classList.remove("reader-open");
  hideShareButton();

  if (reader.lastTrigger instanceof HTMLElement && reader.lastTrigger.isConnected) {
    reader.lastTrigger.focus({ preventScroll: true });
  }
}

async function openReader(trigger) {
  if (!readerDialog || reader.opening) {
    return;
  }

  // Повторное открытие во время анимации закрытия — просто отменяем закрытие.
  if (reader.closeTimeoutId !== null) {
    window.clearTimeout(reader.closeTimeoutId);
    reader.closeTimeoutId = null;
    readerDialog.classList.remove("is-closing");
    readerDialog.classList.add("is-open");
    return;
  }

  reader.opening = true;

  // Если идёт морфинг закрытия, дожидаемся, пока окно закроется, и открываем заново.
  if (reader.closingTransition) {
    await reader.closingTransition.updateCallbackDone.catch(() => {});
  }

  if (readerDialog.open) {
    reader.opening = false;
    return;
  }

  reader.lastTrigger = trigger instanceof HTMLElement ? trigger : document.activeElement;
  trigger?.setAttribute("aria-busy", "true");

  try {
    await loadReaderContent();
  } catch {
    showToast("Не удалось загрузить фрагмент. Проверьте соединение и попробуйте ещё раз.");
    return;
  } finally {
    reader.opening = false;
    trigger?.removeAttribute("aria-busy");
  }

  const savedPage = Number(store.get("localStorage", READER_PAGE_KEY));
  reader.pageIndex = Number.isInteger(savedPage)
    ? clampNumber(savedPage, 0, reader.content.pages.length - 1)
    : 0;

  renderReaderPage(reader.pageIndex, { animate: false });
  applyReaderFontStep();
  trackEvent("fragment_open", { page: reader.pageIndex + 1 });

  if (canMorphFromBook()) {
    setMorphNames("book");
    const transition = document.startViewTransition(() => {
      setMorphNames("sheet");
      showReaderInstantly();
    });

    transition.finished.finally(() => {
      setMorphNames("none");
      readerDialog.classList.remove("is-instant");
    });
  } else if (reduceMotion) {
    showReaderInstantly();
  } else {
    showReaderModal();
    // Следующий кадр, чтобы сработал CSS-переход из закрытого состояния.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => readerDialog.classList.add("is-open"));
    });
  }
}

function closeReader() {
  if (!readerDialog?.open || reader.closeTimeoutId !== null) {
    return;
  }

  trackEvent("fragment_close", { page: reader.pageIndex + 1 });
  hideShareButton();

  if (canMorphFromBook()) {
    setMorphNames("sheet");
    const transition = document.startViewTransition(() => {
      setMorphNames("book");
      finishReaderClose();
    });

    reader.closingTransition = transition;
    transition.finished.finally(() => {
      setMorphNames("none");
      reader.closingTransition = null;
    });
    return;
  }

  if (reduceMotion) {
    finishReaderClose();
    return;
  }

  readerDialog.classList.remove("is-instant", "is-open");
  readerDialog.classList.add("is-closing");
  reader.closeTimeoutId = window.setTimeout(finishReaderClose, READER_CLOSE_DURATION_MS);
}

/* --- Цитаты --- */

function hideShareButton() {
  reader.selectedQuote = "";

  if (readerShareButton) {
    readerShareButton.hidden = true;
  }
}

function handleSelectionChange() {
  if (!readerDialog?.open || !readerShareButton || !readerPageElement) {
    return;
  }

  const selection = window.getSelection();
  const text = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
  const isInsideReader =
    selection?.rangeCount &&
    readerPageElement.contains(selection.getRangeAt(0).commonAncestorContainer);

  if (isInsideReader && text.length >= QUOTE_MIN_LENGTH && text.length <= QUOTE_MAX_LENGTH) {
    reader.selectedQuote = text;
    readerShareButton.hidden = false;
    return;
  }

  // Клик по самой кнопке может сбросить выделение — не прячем её в этот момент.
  if (document.activeElement !== readerShareButton) {
    hideShareButton();
  }
}

function wrapCanvasText(context, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let line = "";

  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;

    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });

  if (line) {
    lines.push(line);
  }

  return lines;
}

async function renderQuoteCard(quote) {
  const width = 1080;
  const height = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  try {
    await Promise.all([
      document.fonts.load('500 56px "Cormorant Garamond"'),
      document.fonts.load('400 48px "Forum"')
    ]);
  } catch {
    /* без веб-шрифтов карточка нарисуется системным serif */
  }

  const background = context.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#0d0b09");
  background.addColorStop(1, "#040404");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const glow = context.createRadialGradient(width / 2, height * 0.86, 0, width / 2, height * 0.86, width * 0.7);
  glow.addColorStop(0, "rgba(255, 150, 60, 0.18)");
  glow.addColorStop(1, "rgba(255, 150, 60, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(183, 146, 98, 0.45)";
  context.lineWidth = 2;
  context.strokeRect(60, 60, width - 120, height - 120);

  const maxTextWidth = width - 260;
  let fontSize = 60;
  let lines = [];

  do {
    context.font = `500 ${fontSize}px "Cormorant Garamond", Georgia, serif`;
    lines = wrapCanvasText(context, `«${quote}»`, maxTextWidth);
    fontSize -= 4;
  } while (lines.length * fontSize * 1.45 > height * 0.55 && fontSize > 32);

  fontSize += 4;
  const lineHeight = fontSize * 1.45;
  const blockHeight = lines.length * lineHeight;
  let y = (height - blockHeight) / 2 - 40;

  context.fillStyle = "#dfd2bf";
  context.textAlign = "center";
  context.textBaseline = "top";
  lines.forEach((line) => {
    context.fillText(line, width / 2, y);
    y += lineHeight;
  });

  context.fillStyle = "rgba(183, 146, 98, 0.7)";
  context.fillRect(width / 2 - 90, height - 330, 180, 2);

  context.fillStyle = "#b79262";
  context.font = '400 52px "Forum", Georgia, serif';
  context.fillText("МЕЧТА. 9:59", width / 2, height - 290);

  context.fillStyle = "rgba(223, 210, 191, 0.78)";
  context.font = '500 36px "Cormorant Garamond", Georgia, serif';
  context.fillText("Тимофей Бородич", width / 2, height - 220);

  context.fillStyle = "rgba(223, 210, 191, 0.5)";
  context.font = '500 30px "Cormorant Garamond", Georgia, serif';
  context.fillText("9-59.site", width / 2, height - 160);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function shareQuote() {
  const quote = reader.selectedQuote;

  if (!quote) {
    return;
  }

  const text = `«${quote}» — Тимофей Бородич, «Мечта. 9:59»`;
  const shareData = { title: "«Мечта. 9:59»", text, url: SITE_URL };
  trackEvent("quote_share", { length: quote.length });

  try {
    const blob = await renderQuoteCard(quote);
    const file = blob ? new File([blob], "mechta-9-59-quote.png", { type: "image/png" }) : null;

    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ ...shareData, files: [file] });
    } else if (typeof navigator.share === "function") {
      await navigator.share(shareData);
    } else {
      if (blob) {
        downloadBlob(blob, "mechta-9-59-quote.png");
      }

      let copied = false;

      try {
        await navigator.clipboard?.writeText(`${text}\n${SITE_URL}`);
        copied = Boolean(navigator.clipboard);
      } catch {
        copied = false;
      }

      showToast(copied ? "Цитата скопирована, карточка сохранена" : "Карточка с цитатой сохранена");
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      showToast("Не получилось поделиться цитатой");
    }
  }

  hideShareButton();
  window.getSelection()?.removeAllRanges();
}

function initializeReader() {
  if (!readerDialog) {
    return;
  }

  $$("[data-close-reader]", readerDialog).forEach((element) => {
    element.addEventListener("click", closeReader);
  });

  readerPrevButton?.addEventListener("click", () => changeReaderPage(-1));
  readerNextButton?.addEventListener("click", () => changeReaderPage(1));

  readerFontButtons.forEach((button) => {
    button.addEventListener("click", () => changeReaderFont(Number(button.dataset.readerFont)));
  });

  // Esc: вместо мгновенного закрытия — анимированное.
  readerDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeReader();
  });

  // Диалог мог закрыться в обход closeReader (например, двойной Esc) — приводим состояние в порядок.
  readerDialog.addEventListener("close", () => {
    if (readerDialog.classList.contains("is-open") || document.body.classList.contains("reader-open")) {
      finishReaderClose();
    }
  });

  readerDialog.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea")) {
      return;
    }

    if (event.key === "ArrowRight" && readerNextButton && !readerNextButton.hidden) {
      event.preventDefault();
      changeReaderPage(1);
    } else if (event.key === "ArrowLeft" && readerPrevButton && !readerPrevButton.hidden) {
      event.preventDefault();
      changeReaderPage(-1);
    }
  });

  if (readerShareButton) {
    // Не даём клику по кнопке сбросить выделенный текст.
    readerShareButton.addEventListener("pointerdown", (event) => event.preventDefault());
    readerShareButton.addEventListener("click", () => {
      void shareQuote();
    });
  }

  readerThemeButton?.addEventListener("click", toggleReaderTheme);
  document.addEventListener("selectionchange", handleSelectionChange);
  applyReaderFontStep();
  applyReaderTheme();
}

/* ------------------------------------------------------------------ */
/* Делегированные клики                                                 */
/* ------------------------------------------------------------------ */

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const download = event.target.closest("[data-analytics-event]");

  if (download instanceof HTMLElement) {
    trackEvent(download.dataset.analyticsEvent, {
      file_type: download.dataset.analyticsFileType,
      placement: download.closest(".reader-dialog") ? "reader" : "page"
    });
  }

  const contact = event.target.closest("[data-analytics-contact-type]");

  if (contact instanceof HTMLElement) {
    trackEvent("author_contact_click", { contact_type: contact.dataset.analyticsContactType });
  }

  const opener = event.target.closest("[data-open-reader]");

  if (opener instanceof HTMLElement) {
    event.preventDefault();
    void openReader(opener);
  }
});

/* ------------------------------------------------------------------ */
/* Аудио                                                               */
/* ------------------------------------------------------------------ */

const audioState = {
  initialized: false,
  ambientStarted: false,
  ambientPausedByVisibility: false,
  isHowlPlaying: false,
  interactionHandler: null,
  fadeFrameId: null,
  fadeResolve: null,
  clock: null,
  dogHowl: null,
  music: null,
  missing: new Set()
};

// click нужен для тач-устройств: pointerdown там не даёт разрешения на звук.
const AUTOPLAY_RETRY_EVENTS = ["pointerdown", "click", "keydown"];

function resolveAudioSource(key) {
  const sources = AUDIO_SOURCES[key];

  if (!sources) {
    return "";
  }

  return sources.opus && CAN_PLAY_OPUS ? sources.opus : sources.mp3 ?? "";
}

function createAudio(key, volume, { loop = false, preload = "none", assignSource = true } = {}) {
  const audio = new Audio();
  audio.preload = preload;
  audio.loop = loop;
  audio.volume = volume;

  if (assignSource) {
    audio.src = resolveAudioSource(key);
  }

  audio.addEventListener("error", () => {
    audioState.missing.add(key);
  });

  return audio;
}

function ensureAudioSource(audio, key, preload = "auto") {
  if (!audio || audio.getAttribute("src")) {
    return;
  }

  audio.src = resolveAudioSource(key);
  audio.preload = preload;
  audio.load();
}

function initializeAudio() {
  if (audioState.initialized) {
    return;
  }

  audioState.clock = createAudio("clock", AUDIO_VOLUME.clock, { loop: true });
  audioState.dogHowl = createAudio("dogHowl", AUDIO_VOLUME.dogHowl, { preload: "auto" });
  audioState.music = createAudio("bookTrack", 0, { assignSource: false });

  audioState.music.addEventListener("ended", () => {
    setTrackUi("paused");
    updateMediaSessionState("paused");
  });

  bindAutoplayRetryHandlers();
  setTrackUi("idle");
  audioState.initialized = true;
}

function bindAutoplayRetryHandlers() {
  if (audioState.interactionHandler) {
    return;
  }

  audioState.interactionHandler = () => {
    void startAmbientAudio();
  };

  AUTOPLAY_RETRY_EVENTS.forEach((eventName) => {
    document.addEventListener(eventName, audioState.interactionHandler, { passive: true });
  });
}

function removeAutoplayRetryHandlers() {
  if (!audioState.interactionHandler) {
    return;
  }

  AUTOPLAY_RETRY_EVENTS.forEach((eventName) => {
    document.removeEventListener(eventName, audioState.interactionHandler, { passive: true });
  });

  audioState.interactionHandler = null;
}

async function startAmbientAudio() {
  initializeAudio();

  if (audioState.ambientStarted || document.hidden) {
    return audioState.ambientStarted;
  }

  if (audioState.missing.has("clock")) {
    audioState.ambientStarted = true;
    removeAutoplayRetryHandlers();
    return true;
  }

  try {
    await audioState.clock.play();
    audioState.ambientStarted = true;
    removeAutoplayRetryHandlers();
    return true;
  } catch {
    return false;
  }
}

function fadeAudio(audio, targetVolume, durationMs) {
  if (audioState.fadeFrameId !== null) {
    window.cancelAnimationFrame(audioState.fadeFrameId);
    audioState.fadeFrameId = null;
  }

  // Завершаем предыдущее затухание, чтобы его промис не «висел».
  audioState.fadeResolve?.();
  audioState.fadeResolve = null;

  if (!audio) {
    return Promise.resolve();
  }

  const startVolume = audio.volume;
  const startTime = performance.now();

  return new Promise((resolve) => {
    audioState.fadeResolve = resolve;

    const step = (now) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      audio.volume = startVolume + (targetVolume - startVolume) * progress;

      if (progress < 1) {
        audioState.fadeFrameId = window.requestAnimationFrame(step);
        return;
      }

      audioState.fadeFrameId = null;
      audioState.fadeResolve = null;
      resolve();
    };

    audioState.fadeFrameId = window.requestAnimationFrame(step);
  });
}

function setTrackUi(state) {
  if (!atmosphereButton) {
    return;
  }

  const isPlaying = state === "playing";
  atmosphereButton.dataset.trackState = state;
  atmosphereButton.disabled = state === "loading";
  atmosphereButton.setAttribute("aria-busy", String(state === "loading"));
  atmosphereButton.setAttribute("aria-pressed", String(isPlaying));
  atmosphereButton.textContent = isPlaying ? "Выключить трек" : "Включить трек";
}

async function playTrack() {
  initializeAudio();
  const music = audioState.music;

  if (audioState.missing.has("bookTrack")) {
    setTrackUi("error");
    return;
  }

  if (!music.paused) {
    return;
  }

  setTrackUi("loading");
  void startAmbientAudio();
  ensureAudioSource(music, "bookTrack");
  music.volume = 0;

  try {
    await music.play();
  } catch {
    setTrackUi("error");
    return;
  }

  trackEvent("music_play");
  setTrackUi("playing");
  setupMediaSession();
  updateMediaSessionState("playing");
  await fadeAudio(music, AUDIO_VOLUME.bookTrack, MUSIC_FADE_DURATION_MS);
}

async function pauseTrack({ fade = true } = {}) {
  const music = audioState.music;

  if (!music || music.paused) {
    return;
  }

  setTrackUi("pausing");

  if (fade) {
    await fadeAudio(music, 0, MUSIC_FADE_DURATION_MS);
  }

  music.pause();
  trackEvent("music_pause");
  setTrackUi("paused");
  updateMediaSessionState("paused");
}

function toggleBookTrack() {
  initializeAudio();

  if (audioState.music.paused) {
    void playTrack();
  } else {
    void pauseTrack();
  }
}

/* --- Media Session: обложка и управление на экране блокировки --- */

let mediaSessionReady = false;

function setupMediaSession() {
  if (mediaSessionReady || !("mediaSession" in navigator) || typeof window.MediaMetadata !== "function") {
    return;
  }

  navigator.mediaSession.metadata = new window.MediaMetadata({
    title: "Трек книги «Мечта. 9:59»",
    artist: "Тимофей Бородич",
    album: "Мечта. 9:59",
    artwork: [
      { src: "assets/images/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "assets/images/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "assets/images/book-cover-current.jpg", sizes: "853x1280", type: "image/jpeg" }
    ]
  });

  const handlers = {
    play: () => void playTrack(),
    pause: () => void pauseTrack({ fade: false }),
    stop: () => void pauseTrack({ fade: false })
  };

  Object.entries(handlers).forEach(([action, handler]) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* действие не поддерживается этим браузером */
    }
  });

  mediaSessionReady = true;
}

function updateMediaSessionState(state) {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = state;
  }
}

/* ------------------------------------------------------------------ */
/* Огонь, искры, собака                                                 */
/* ------------------------------------------------------------------ */

let sparkTimeoutId = null;
let sparkElements = [];
let isDogAnimating = false;
let isHeroVisible = true;
let cinematicFireActive = false;

function initializeFireAnimation() {
  if (!heroElement || heroElement.dataset.fireAnimationInitialized === "true") {
    return;
  }

  heroElement.dataset.fireAnimationInitialized = "true";
  heroElement.classList.add("hero--fire-active");
  initializeSparks();
  scheduleNextSparkBurst();
}

function initializeSparks() {
  if (!sparkPoolElement || sparkElements.length) {
    return;
  }

  sparkElements = Array.from({ length: SPARK_POOL_SIZE }, () => {
    const spark = document.createElement("span");
    spark.className = "hero__spark";
    spark.setAttribute("aria-hidden", "true");
    spark.addEventListener("animationend", () => {
      spark.classList.remove("hero__spark--active");
    });
    sparkPoolElement.appendChild(spark);
    return spark;
  });
}

function canPlaySparks() {
  return (
    !cinematicFireActive &&
    heroElement?.dataset.fireAnimationInitialized === "true" &&
    !document.hidden &&
    !reduceMotion &&
    isHeroVisible
  );
}

function cancelScheduledSparks() {
  if (sparkTimeoutId !== null) {
    window.clearTimeout(sparkTimeoutId);
    sparkTimeoutId = null;
  }
}

function scheduleNextSparkBurst() {
  cancelScheduledSparks();

  if (!canPlaySparks()) {
    return;
  }

  const delay =
    SPARK_BURST_MIN_DELAY_MS + Math.random() * (SPARK_BURST_MAX_DELAY_MS - SPARK_BURST_MIN_DELAY_MS);

  sparkTimeoutId = window.setTimeout(() => {
    playSparkBurst();
    scheduleNextSparkBurst();
  }, delay);
}

function playSparkBurst() {
  if (!sparkElements.length || !canPlaySparks()) {
    return;
  }

  const availableSparks = sparkElements.filter(
    (spark) => !spark.classList.contains("hero__spark--active")
  );

  const sparkCount = Math.min(
    availableSparks.length,
    SPARK_BURST_MIN_COUNT +
      Math.floor(Math.random() * (SPARK_BURST_MAX_COUNT - SPARK_BURST_MIN_COUNT + 1))
  );

  availableSparks
    .sort(() => Math.random() - 0.5)
    .slice(0, sparkCount)
    .forEach((spark) => {
      const duration =
        SPARK_DURATION_MIN_MS + Math.random() * (SPARK_DURATION_MAX_MS - SPARK_DURATION_MIN_MS);

      spark.style.setProperty("--spark-size", `${0.2 + Math.random() * 0.18}rem`);
      spark.style.setProperty("--spark-left", `${34 + Math.random() * 32}%`);
      spark.style.setProperty("--spark-bottom", `${10 + Math.random() * 18}%`);
      spark.style.setProperty("--spark-drift-x", `${(-0.4 + Math.random() * 0.8).toFixed(2)}rem`);
      spark.style.setProperty("--spark-rise", `${(-(1.1 + Math.random() * 1.4)).toFixed(2)}rem`);
      spark.style.setProperty("--spark-duration", `${duration.toFixed(0)}ms`);
      void spark.offsetWidth;
      spark.classList.add("hero__spark--active");

      // Страховка: если анимация не запустилась (например, отключена в CSS),
      // искра не должна навсегда выпасть из пула.
      window.setTimeout(() => spark.classList.remove("hero__spark--active"), duration + 200);
    });
}

function playDogHeadAnimation() {
  if (!dogHeadElement || isDogAnimating) {
    return Promise.resolve();
  }

  isDogAnimating = true;
  dogHeadElement.classList.remove(DOG_HEAD_ANIMATION_CLASS);
  void dogHeadElement.offsetWidth;
  dogHeadElement.classList.add(DOG_HEAD_ANIMATION_CLASS);

  return new Promise((resolve) => {
    let timeoutId = null;

    const finish = () => {
      window.clearTimeout(timeoutId);
      dogHeadElement.removeEventListener("animationend", handleAnimationEnd);
      dogHeadElement.classList.remove(DOG_HEAD_ANIMATION_CLASS);
      isDogAnimating = false;
      resolve();
    };

    const handleAnimationEnd = (event) => {
      if (event.target === dogHeadElement && event.animationName === "dogHeadHowl") {
        finish();
      }
    };

    dogHeadElement.addEventListener("animationend", handleAnimationEnd);
    timeoutId = window.setTimeout(
      finish,
      (reduceMotion ? DOG_HEAD_ANIMATION_REDUCED_DURATION_MS : DOG_HEAD_ANIMATION_DURATION_MS) + 120
    );
  });
}

async function playDogHowl() {
  const howl = audioState.dogHowl;

  if (document.hidden || audioState.isHowlPlaying || !howl || audioState.missing.has("dogHowl")) {
    return false;
  }

  try {
    audioState.isHowlPlaying = true;
    howl.currentTime = 0;
    await howl.play();
    howl.addEventListener(
      "ended",
      () => {
        audioState.isHowlPlaying = false;
      },
      { once: true }
    );
    return true;
  } catch {
    audioState.isHowlPlaying = false;
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Таймер 9:59 и финал                                                  */
/* ------------------------------------------------------------------ */

const howledMinutes = new Set();
let countdownEndTime = 0;
let timerIntervalId = null;
let finaleShown = false;

function formatTime(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const timerDigitElements = timerElement ? $$(".hero__digit", timerElement) : [];

// Каждая цифра — отдельный span фиксированной ширины: таймер не дрожит,
// а сменившаяся цифра мягко «проявляется».
function renderTimerDigits(text) {
  const digits = text.replace(":", "");

  if (timerDigitElements.length !== 4) {
    timerElement.textContent = text;
    return;
  }

  timerDigitElements.forEach((element, index) => {
    if (element.textContent === digits[index]) {
      return;
    }

    element.textContent = digits[index];

    if (!reduceMotion && !document.hidden) {
      element.classList.remove("is-changing");
      void element.offsetWidth;
      element.classList.add("is-changing");
    }
  });
}

function getRemainingSeconds() {
  return Math.ceil(Math.max(0, countdownEndTime - Date.now()) / 1000);
}

async function playDogMinuteEvent(minutes) {
  if (!isDogAnimating) {
    window.setTimeout(() => {
      void playDogHeadAnimation();
    }, reduceMotion ? 0 : 180);
  }

  if (await playDogHowl()) {
    howledMinutes.add(minutes);
  }
}

function checkMinuteDogEvent(minutes, seconds, allowDogEvent) {
  if (
    !allowDogEvent ||
    document.hidden ||
    seconds !== 0 ||
    minutes < 1 ||
    minutes > 9 ||
    howledMinutes.has(minutes) ||
    audioState.isHowlPlaying
  ) {
    return;
  }

  void playDogMinuteEvent(minutes);
}

function showFinale() {
  if (finaleShown || !heroElement || !finaleElement) {
    return;
  }

  finaleShown = true;
  finaleElement.hidden = false;
  heroElement.classList.add("hero--finale");
  trackEvent("timer_finished");
}

function hideFinale() {
  finaleShown = false;

  if (finaleElement) {
    finaleElement.hidden = true;
  }

  heroElement?.classList.remove("hero--finale");
}

function updateTimer({ allowDogEvent = true } = {}) {
  if (!timerElement) {
    return;
  }

  const remainingSeconds = getRemainingSeconds();
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  renderTimerDigits(formatTime(remainingSeconds));
  checkMinuteDogEvent(minutes, seconds, allowDogEvent);

  if (remainingSeconds === 0) {
    if (timerIntervalId !== null) {
      window.clearInterval(timerIntervalId);
      timerIntervalId = null;
    }

    showFinale();
  }
}

function startCountdown({ restart = false } = {}) {
  if (!timerElement) {
    return;
  }

  // Время переживает перезагрузку страницы в рамках одной вкладки.
  const storedEnd = Number(store.get("sessionStorage", TIMER_STORAGE_KEY));
  const hasRunningTimer = !restart && Number.isFinite(storedEnd) && storedEnd > Date.now();

  countdownEndTime = hasRunningTimer ? storedEnd : Date.now() + TIMER_DURATION_MS;
  store.set("sessionStorage", TIMER_STORAGE_KEY, countdownEndTime);

  howledMinutes.clear();
  hideFinale();

  if (timerIntervalId !== null) {
    window.clearInterval(timerIntervalId);
  }

  updateTimer({ allowDogEvent: false });
  timerIntervalId = window.setInterval(() => updateTimer(), TIMER_TICK_MS);
}

/* ------------------------------------------------------------------ */
/* Видимость вкладки, видимость hero, настройки движения                */
/* ------------------------------------------------------------------ */

function initializeHeroVisibility() {
  if (!heroElement || !("IntersectionObserver" in window)) {
    return;
  }

  const observer = new IntersectionObserver(([entry]) => {
    isHeroVisible = Boolean(entry?.isIntersecting);
    // Пока hero не виден, CSS ставит все его анимации на паузу.
    heroElement.classList.toggle("is-offscreen", !isHeroVisible);
    scheduleNextSparkBurst();
  });

  observer.observe(heroElement);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelScheduledSparks();

    if (audioState.dogHowl && !audioState.dogHowl.paused) {
      audioState.dogHowl.pause();
      audioState.dogHowl.currentTime = 0;
    }

    audioState.isHowlPlaying = false;

    // Тиканье часов в фоне не нужно. Музыка продолжает играть: ею можно
    // управлять с экрана блокировки через Media Session.
    if (audioState.clock && !audioState.clock.paused) {
      audioState.clock.pause();
      audioState.ambientPausedByVisibility = true;
    }

    return;
  }

  updateTimer({ allowDogEvent: false });

  if (audioState.ambientPausedByVisibility) {
    audioState.ambientPausedByVisibility = false;
    void audioState.clock.play().catch(() => {});
  } else if (!audioState.ambientStarted) {
    void startAmbientAudio();
  }

  scheduleNextSparkBurst();
});

motionQuery.addEventListener?.("change", (event) => {
  reduceMotion = event.matches;

  if (reduceMotion) {
    cancelScheduledSparks();
    revealAll();
  } else {
    scheduleNextSparkBurst();
  }
});

/* ------------------------------------------------------------------ */
/* Эффекты за курсором: глубина сцены, наклон книги, отблеск на карточках */
/* ------------------------------------------------------------------ */

const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

function canUsePointerEffects() {
  return finePointer.matches && !reduceMotion;
}

// Обновляем CSS-переменные не чаще одного раза за кадр.
function rafThrottle(callback) {
  let frameId = null;
  let lastEvent = null;

  return (event) => {
    lastEvent = event;

    if (frameId !== null) {
      return;
    }

    frameId = window.requestAnimationFrame(() => {
      frameId = null;
      callback(lastEvent);
    });
  };
}

function initializeHeroParallax() {
  if (!heroElement) {
    return;
  }

  heroElement.addEventListener(
    "pointermove",
    rafThrottle((event) => {
      if (!canUsePointerEffects()) {
        return;
      }

      const rect = heroElement.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
      heroElement.style.setProperty("--px", x.toFixed(3));
      heroElement.style.setProperty("--py", y.toFixed(3));
    })
  );

  heroElement.addEventListener("pointerleave", () => {
    heroElement.style.setProperty("--px", "0");
    heroElement.style.setProperty("--py", "0");
  });
}

function initializeBookTilt() {
  $$("[data-tilt]").forEach((element) => {
    element.addEventListener(
      "pointermove",
      rafThrottle((event) => {
        if (!canUsePointerEffects()) {
          return;
        }

        const rect = element.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        element.style.setProperty("--tilt-x", ((0.5 - y) * 10).toFixed(2) + "deg");
        element.style.setProperty("--tilt-y", ((x - 0.5) * 12).toFixed(2) + "deg");
        element.style.setProperty("--glare-x", (x * 100).toFixed(1) + "%");
        element.style.setProperty("--glare-y", (y * 100).toFixed(1) + "%");
        element.classList.add("is-tilting");
      })
    );

    element.addEventListener("pointerleave", () => {
      element.classList.remove("is-tilting");
      element.style.setProperty("--tilt-x", "0deg");
      element.style.setProperty("--tilt-y", "0deg");
    });
  });
}

function initializeCardGlow() {
  document.addEventListener(
    "pointermove",
    rafThrottle((event) => {
      if (!canUsePointerEffects() || !(event.target instanceof Element)) {
        return;
      }

      const card = event.target.closest(".about-panel__format-card");

      if (!card) {
        return;
      }

      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      card.style.setProperty("--my", `${event.clientY - rect.top}px`);
    }),
    { passive: true }
  );
}

// Подпись «пишется» слева направо, когда блок автора появляется на экране.
function initializeSignature() {
  const signature = $("[data-signature]");

  if (!signature) {
    return;
  }

  if (reduceMotion || !("IntersectionObserver" in window)) {
    signature.classList.add("is-signed");
    return;
  }

  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) {
        return;
      }

      signature.classList.add("is-signed");
      observer.disconnect();
    },
    { threshold: 0.6 }
  );

  observer.observe(signature);
}

function initializeQuoteBreak() {
  const quotes = $$(".quote-break__quote");

  if (quotes.length < 2) {
    return;
  }

  const chosen = Math.floor(Math.random() * quotes.length);
  quotes.forEach((quote, index) => {
    quote.hidden = index !== chosen;
  });
}

/* ------------------------------------------------------------------ */
/* Шорох страницы: синтезируется на лету, без отдельного файла          */
/* ------------------------------------------------------------------ */

let audioContext = null;

function playPageRustle() {
  // Звук только после того, как атмосфера сайта уже зазвучала.
  if (!audioState.ambientStarted || document.hidden) {
    return;
  }

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      return;
    }

    audioContext ??= new AudioContextClass();
    const context = audioContext;
    const duration = 0.42;
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i += 1) {
      const t = i / data.length;
      // Шум с «шершавой» огибающей — как бумага, скользящая по бумаге.
      const grain = Math.random() < 0.08 ? 1.6 : 1;
      data[i] = (Math.random() * 2 - 1) * grain * Math.sin(Math.PI * Math.min(1, t * 1.6)) * (1 - t);
    }

    const source = context.createBufferSource();
    source.buffer = buffer;

    const bandpass = context.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = 2600;
    bandpass.Q.value = 0.6;

    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 900;

    const gain = context.createGain();
    gain.gain.value = 0.09;

    source.connect(bandpass).connect(highpass).connect(gain).connect(context.destination);
    void context.resume?.();
    source.start();
  } catch {
    /* звук не обязателен */
  }
}

/* ------------------------------------------------------------------ */
/* Собака: отзывается на прикосновение                                  */
/* ------------------------------------------------------------------ */

// Положение дога на исходной картинке (доли ширины и высоты 1717×916).
const DOG_BOX = { left: 0.49, top: 0.63, right: 0.79, bottom: 0.94 };
// Голова дога и точка поворота (шея) — для анимации воя.
const DOG_HEAD = { cx: 0.69, cy: 0.71, rx: 0.05, ry: 0.082, pivotX: 0.664, pivotY: 0.808 };
const HERO_IMAGE_SIZE = { width: 1717, height: 916 };

function positionDogHitArea() {
  const hit = $("[data-dog-hit]");
  const scene = $(".hero__scene");

  if (!hit || !scene || !heroElement) {
    return;
  }

  const heroWidth = heroElement.clientWidth;
  const heroHeight = heroElement.clientHeight;
  const scale = Math.max(heroWidth / HERO_IMAGE_SIZE.width, heroHeight / HERO_IMAGE_SIZE.height);
  const imageWidth = HERO_IMAGE_SIZE.width * scale;
  const imageHeight = HERO_IMAGE_SIZE.height * scale;
  const [posX = "50%", posY = "50%"] = getComputedStyle(scene).backgroundPosition.split(" ");
  const ratio = (value) => (value.endsWith("%") ? parseFloat(value) / 100 : 0.5);
  const offsetX = (heroWidth - imageWidth) * ratio(posX);
  const offsetY = (heroHeight - imageHeight) * ratio(posY);

  hit.style.left = `${offsetX + DOG_BOX.left * imageWidth}px`;
  hit.style.top = `${offsetY + DOG_BOX.top * imageHeight}px`;
  hit.style.width = `${(DOG_BOX.right - DOG_BOX.left) * imageWidth}px`;
  hit.style.height = `${(DOG_BOX.bottom - DOG_BOX.top) * imageHeight}px`;

  // Слой головы показывает ту же картинку, поэтому вырезаем именно голову дога.
  if (dogHeadElement) {
    const x = (fraction) => offsetX + fraction * imageWidth;
    const y = (fraction) => offsetY + fraction * imageHeight;
    // Мягкая маска вместо жёсткого clip-path: при повороте не видно шва.
    const mask =
      `radial-gradient(${DOG_HEAD.rx * imageWidth * 1.15}px ${DOG_HEAD.ry * imageHeight * 1.15}px at ` +
      `${x(DOG_HEAD.cx)}px ${y(DOG_HEAD.cy)}px, #000 62%, transparent 100%)`;
    dogHeadElement.style.clipPath = "none";
    dogHeadElement.style.webkitMaskImage = mask;
    dogHeadElement.style.maskImage = mask;
    dogHeadElement.style.transformOrigin = `${x(DOG_HEAD.pivotX)}px ${y(DOG_HEAD.pivotY)}px`;
  }
}

function initializeDogHit() {
  const hit = $("[data-dog-hit]");

  if (!hit) {
    return;
  }

  positionDogHitArea();
  window.addEventListener("resize", rafThrottle(positionDogHitArea));

  hit.addEventListener("click", () => {
    if (isDogAnimating) {
      return;
    }

    initializeAudio();
    trackEvent("dog_pet");
    void playDogHeadAnimation();
    void playDogHowl();
  });
}

/* ------------------------------------------------------------------ */
/* Таймер в названии вкладки, пока она в фоне                           */
/* ------------------------------------------------------------------ */

const originalTitle = document.title;
let titleIntervalId = null;

function updateTabTitle() {
  document.title = `${formatTime(getRemainingSeconds())} · Мечта. 9:59`;
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    updateTabTitle();
    titleIntervalId = window.setInterval(updateTabTitle, 1000);
    return;
  }

  window.clearInterval(titleIntervalId);
  titleIntervalId = null;
  document.title = originalTitle;
});

/* ------------------------------------------------------------------ */
/* Отклик на скачивание                                                */
/* ------------------------------------------------------------------ */

document.addEventListener("click", (event) => {
  const card = event.target instanceof Element ? event.target.closest(".about-panel__format-card") : null;

  if (!card || card.classList.contains("is-downloading")) {
    return;
  }

  const action = card.querySelector(".about-panel__format-action");
  const original = action?.textContent;
  card.classList.add("is-downloading");

  if (action) {
    action.textContent = "✓ Скачивается";
  }

  showToast("Спасибо, что читаете «Мечту»");

  window.setTimeout(() => {
    card.classList.remove("is-downloading");

    if (action && original) {
      action.textContent = original;
    }
  }, 4000);
});

/* ------------------------------------------------------------------ */
/* PWA                                                                 */
/* ------------------------------------------------------------------ */

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !(window.isSecureContext || IS_LOCAL)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

/* ------------------------------------------------------------------ */
/* Старт                                                               */
/* ------------------------------------------------------------------ */

atmosphereButton?.addEventListener("click", toggleBookTrack);
$("[data-timer-restart]")?.addEventListener("click", () => {
  trackEvent("timer_restart");
  startCountdown({ restart: true });
  timerElement?.focus({ preventScroll: true });
});

initializeConsent();
initializeRevealAnimations();
initializeAuthorAnalytics();
initializeReader();
initializeHeroVisibility();
initializeHeroParallax();
initializeBookTilt();
initializeCardGlow();
initializeQuoteBreak();
initializeSignature();
initializeDogHit();

// «Живой» огонь на WebGL. Если WebGL нет или включено «уменьшение движения» —
// остаётся прежняя CSS-анимация.
if (!reduceMotion && heroElement) {
  import("./fire.js")
    .then(({ startCinematicFire }) =>
      startCinematicFire({
        hero: heroElement,
        room: $(".hero__room"),
        scene: $(".hero__scene"),
        imageSrc: "assets/images/hero-room-v1.webp",
        isPaused: () => document.hidden || !isHeroVisible || reduceMotion
      })
    )
    .then((started) => {
      if (started) {
        cinematicFireActive = true;
        cancelScheduledSparks();
      }
    })
    .catch(() => {
      /* остаётся CSS-огонь */
    });
}

// После вступления снимаем класс, чтобы анимации не повторялись при перерисовке.
if (document.documentElement.classList.contains("intro-play")) {
  window.setTimeout(() => document.documentElement.classList.remove("intro-play"), 5200);
}
initializeFireAnimation();
initializeAudio();
startCountdown();
registerServiceWorker();
